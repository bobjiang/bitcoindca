import { NextRequest, NextResponse } from "next/server";
import {
  Address,
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  http,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";

const EXECUTOR_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "positionId", type: "uint256" }],
    name: "execute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function normalisePrivateKey(key: string): `0x${string}` {
  return key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`);
}

function resolveChain(chainId: number) {
  switch (chainId) {
    case 1:
      return mainnet;
    case 11155111:
      return sepolia;
    default:
      throw new Error(`Unsupported chain id for executor API: ${chainId}`);
  }
}

function resolveRpcUrl(chainId: number): string | undefined {
  if (process.env.RPC_URL) {
    return process.env.RPC_URL;
  }
  if (chainId === 1) {
    return (
      process.env.MAINNET_RPC_URL ||
      (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : undefined)
    );
  }
  if (chainId === 11155111) {
    return (
      process.env.SEPOLIA_RPC_URL ||
      (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://eth-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : undefined)
    );
  }
  return undefined;
}

function parsePositionId(raw: unknown): bigint {
  if (typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return BigInt(raw);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return BigInt(raw.trim());
  }
  throw new Error("positionId must be provided as a number or bigint");
}

function parsePrivateFlag(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalised = raw.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalised)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalised)) {
      return false;
    }
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const positionId = parsePositionId(body?.positionId);

    const privateFlag = parsePrivateFlag(body?.usePrivate);
    const isPrivate =
      privateFlag ?? (process.env.EXEC_PRIVATE ?? "false").toLowerCase() === "true";

    const executorAddress = (process.env.NEXT_PUBLIC_EXECUTOR_ADDRESS || "").trim();
    if (!executorAddress) {
      return NextResponse.json({ error: "NEXT_PUBLIC_EXECUTOR_ADDRESS is not configured" }, { status: 500 });
    }

    const signerKey =
      process.env.EXECUTOR_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.DEPLOYER_KEY;
    if (!signerKey) {
      return NextResponse.json(
        { error: "EXECUTOR_PRIVATE_KEY must be configured on the server to submit executions" },
        { status: 500 }
      );
    }

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
    const chain = resolveChain(chainId);

    const rpcUrl = resolveRpcUrl(chainId);
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "RPC_URL / MAINNET_RPC_URL / SEPOLIA_RPC_URL is required for execution" },
        { status: 500 }
      );
    }

    const executor = executorAddress as Address;
    const account = privateKeyToAccount(normalisePrivateKey(signerKey));
    const transport = http(rpcUrl);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const txData = encodeFunctionData({
      abi: EXECUTOR_ABI,
      functionName: "execute",
      args: [positionId],
    });

    const gas = await publicClient.estimateGas({
      account: account.address,
      to: executor,
      data: txData,
    });

    const nonce = await publicClient.getTransactionCount({ address: account.address });
    const fees = await publicClient.estimateFeesPerGas();
    const maxPriorityFeePerGas =
      fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > 0n
        ? fees.maxPriorityFeePerGas
        : parseGwei("1");
    const maxFeePerGas =
      fees.maxFeePerGas && fees.maxFeePerGas > maxPriorityFeePerGas
        ? fees.maxFeePerGas
        : maxPriorityFeePerGas + parseGwei("2");

    const baseRequest = {
      account,
      to: executor,
      data: txData,
      gas,
      nonce,
      chainId: chain.id,
      maxFeePerGas,
      maxPriorityFeePerGas,
    } as const;

    if (isPrivate) {
      const rawTx = await walletClient.signTransaction(baseRequest);
      const relayUrl =
        process.env.FLASHBOTS_RELAY ||
        process.env.NEXT_PUBLIC_FLASHBOTS_RELAY ||
        "https://relay.flashbots.net";
      const authKey = process.env.FLASHBOTS_AUTH_KEY;
      const authAccount = authKey ? privateKeyToAccount(normalisePrivateKey(authKey)) : account;

      const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "eth_sendPrivateTransaction" as const,
        params: [rawTx],
      };

      const payloadString = JSON.stringify(payload);
      const headerSignature = await authAccount.signMessage({ message: payloadString });

      const response = await fetch(relayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Flashbots-Signature": `${authAccount.address}:${headerSignature}`,
        },
        body: payloadString,
      });

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message ?? "Flashbots relay returned an error");
      }

      if (!json.result || typeof json.result !== "string") {
        throw new Error("Unexpected response from Flashbots relay");
      }

      return NextResponse.json({ hash: json.result, mode: "private" });
    }

    const hash = await walletClient.sendTransaction(baseRequest);
    return NextResponse.json({ hash, mode: "public" });
  } catch (error) {
    console.error("[execute-api]", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
