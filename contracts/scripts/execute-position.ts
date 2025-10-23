import { ethers, deployments } from "hardhat";
import { getAddress, parseUnits, Wallet } from "ethers";
import { Executor__factory } from "../typechain-types";

type CliValue = string | boolean;
type CliArgs = Record<string, CliValue>;

const DEFAULT_FLASHBOTS_RELAY = "https://relay.flashbots.net";

function parseCliArgs(): CliArgs {
  const rawArgs = process.argv.slice(2);
  const parsed: CliArgs = {};

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) {
      // Ignore positional params for now
      continue;
    }

    const [flag, rawValue] = arg.split("=", 2);
    const key = flag.slice(2);

    if (rawValue !== undefined) {
      parsed[key] = rawValue;
      continue;
    }

    const next = rawArgs[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function parseBoolean(value: CliValue | undefined): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalised)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalised)) {
      return false;
    }
  }
  return undefined;
}

function normalisePrivateKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function sendPrivateTransaction(rawTx: string, relayUrl: string, authSigner: Wallet) {
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "eth_sendPrivateTransaction" as const,
    params: [rawTx],
  };

  const body = JSON.stringify(payload);
  const signature = await authSigner.signMessage(body);

  const response = await fetch(relayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flashbots-Signature": `${authSigner.address}:${signature}`,
    },
    body,
  });

  const json = await response.json();
  if (json.error) {
    throw new Error(`Flashbots RPC error: ${json.error.message ?? JSON.stringify(json.error)}`);
  }

  if (!json.result || typeof json.result !== "string") {
    throw new Error(`Unexpected Flashbots RPC response: ${JSON.stringify(json)}`);
  }

  return json.result as string;
}

async function main() {
  const cli = parseCliArgs();

  const rawPositionArg = (cli.position ?? cli.positionId) as string | undefined;
  if (!rawPositionArg) {
    throw new Error("Missing --position argument");
  }

  let positionId: bigint;
  try {
    positionId = BigInt(rawPositionArg);
  } catch (error) {
    throw new Error(`Invalid --position value (${rawPositionArg}): ${(error as Error).message}`);
  }

  const cliPrivate = parseBoolean(cli.private);
  const envPrivate = (process.env.EXEC_PRIVATE ?? "false").toLowerCase() === "true";
  const usePrivateRelay = cliPrivate ?? envPrivate;

  const dryRun = parseBoolean(cli["dry-run"] ?? cli.dryrun) ?? false;

  const executorEnv = (cli.executor ?? process.env.EXECUTOR_ADDRESS) as string | undefined;
  let executorAddress: string | undefined;
  if (executorEnv) {
    executorAddress = getAddress(executorEnv);
  } else {
    try {
      const deployment = await deployments.get("Executor");
      executorAddress = getAddress(deployment.address);
    } catch {
      executorAddress = undefined;
    }
  }

  if (!executorAddress) {
    throw new Error(
      "Executor address not provided. Pass --executor, set EXECUTOR_ADDRESS, or deploy via hardhat-deploy."
    );
  }

  const signingKey =
    process.env.EXECUTOR_PRIVATE_KEY ??
    process.env.PRIVATE_KEY ??
    process.env.DEPLOYER_KEY; // fallback for local dev

  if (!signingKey) {
    throw new Error("Set EXECUTOR_PRIVATE_KEY (or PRIVATE_KEY) to sign the execution transaction.");
  }

  const provider = ethers.provider;
  const network = await provider.getNetwork();

  const executorSigner = new Wallet(normalisePrivateKey(signingKey), provider);
  const executorContract = Executor__factory.connect(executorAddress, executorSigner);

  const request = await executorContract.populateTransaction.execute(positionId);
  const gasLimit = await executorContract.estimateGas.execute(positionId);

  const feeData = await provider.getFeeData();
  const priorityFee = feeData.maxPriorityFeePerGas ?? parseUnits("2", "gwei");
  const maxFee = feeData.maxFeePerGas ?? (priorityFee + parseUnits("3", "gwei"));

  request.gasLimit = gasLimit;
  request.maxPriorityFeePerGas = priorityFee > 0n ? priorityFee : parseUnits("1", "gwei");
  request.maxFeePerGas =
    maxFee > request.maxPriorityFeePerGas! ? maxFee : request.maxPriorityFeePerGas! + parseUnits("2", "gwei");
  request.nonce = await provider.getTransactionCount(executorSigner.address);
  request.chainId = Number(network.chainId);
  request.type = 2;
  request.value = request.value ?? 0n;

  console.log("=== Executor.execute preview ===");
  console.log("Position ID:", positionId.toString());
  console.log("Executor:", executorAddress);
  console.log("Signer:", executorSigner.address);
  console.log("Network:", network.name, "(chainId =", network.chainId.toString() + ")");
  console.log("Gas limit:", gasLimit.toString());
  console.log("Max priority fee (wei):", request.maxPriorityFeePerGas?.toString());
  console.log("Max fee (wei):", request.maxFeePerGas?.toString());
  console.log("Nonce:", request.nonce);
  console.log("Private relay:", usePrivateRelay ? "enabled" : "disabled");
  console.log("================================");

  if (dryRun) {
    console.log("Dry-run flag enabled. Transaction not broadcast.");
    return;
  }

  if (usePrivateRelay) {
    const relayUrl =
      process.env.FLASHBOTS_RELAY ??
      process.env.NEXT_PUBLIC_FLASHBOTS_RELAY ??
      DEFAULT_FLASHBOTS_RELAY;
    const authKey = process.env.FLASHBOTS_AUTH_KEY;
    const authSigner = authKey
      ? new Wallet(normalisePrivateKey(authKey), provider)
      : executorSigner;

    const rawTx = await executorSigner.signTransaction(request);
    const hash = await sendPrivateTransaction(rawTx, relayUrl, authSigner);

    console.log(`Submitted private tx to Flashbots relay (${relayUrl}): ${hash}`);
    console.log("Tip: use eth_cancelPrivateTransaction with the same auth signer to cancel if required.");
    return;
  }

  const response = await executorSigner.sendTransaction(request);
  console.log(`Broadcast public transaction: ${response.hash}`);
  const receipt = await response.wait();
  console.log("Transaction mined in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
