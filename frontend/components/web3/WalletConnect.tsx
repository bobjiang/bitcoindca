"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance } from "wagmi";
import { formatAmount, shortenAddress } from "@/lib/utils";

export function WalletConnect() {
  const { address, chain, isConnecting, isReconnecting } = useAccount();
  const { data: balance, isLoading: isBalanceLoading } = useBalance({
    address,
    query: {
      enabled: Boolean(address),
    },
  });

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md">
      <ConnectButton />

      {address && (
        <div className="w-full border border-border rounded-lg p-6 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Network</span>
            <span className="font-medium">
              {chain?.name || "Unknown"}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Chain ID</span>
            <span className="font-medium">{chain?.id || "-"}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Balance</span>
            <span className="font-medium">
              {isBalanceLoading
                ? "Loading…"
                : balance
                ? `${formatAmount(balance.value, balance.decimals, 4)} ${balance.symbol}`
                : "-"}
            </span>
          </div>

          <div className="pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground">Connected Address</div>
            <div className="font-mono text-sm mt-1 break-all">{shortenAddress(address, 6)}</div>
            <div className="text-xs text-muted-foreground">
              {isConnecting || isReconnecting ? "Syncing wallet…" : address}
            </div>
          </div>
        </div>
      )}

      {!address && (
        <div className="text-center text-sm text-muted-foreground">
          <p>Connect your wallet to view account details</p>
        </div>
      )}
    </div>
  );
}
