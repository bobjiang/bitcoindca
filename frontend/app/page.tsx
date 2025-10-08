"use client";

import { WalletConnect } from "@/components/web3/WalletConnect";
import { StrategyWizard } from "@/features/strategy/StrategyWizard";
import { PositionsDashboard } from "@/features/dashboard/PositionsDashboard";
import { useAccount } from "wagmi";

export default function Home() {
  const { address, isConnected } = useAccount();

  return (
    <main className="flex min-h-screen flex-col items-center bg-background py-16">
      <div className="w-full max-w-6xl px-6">
        <header className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Bitcoin DCA</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Non-custodial automated DCA for WBTC and ETH with venue-aware execution, price guards, and Safe support.
          </p>
        </header>

        <div className="mt-10 flex flex-col items-center gap-6">
          <WalletConnect />

          {!isConnected && (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              Connect your wallet to access the strategy wizard and positions dashboard.
            </div>
          )}
        </div>

        {isConnected && (
          <section className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <StrategyWizard />
            <PositionsDashboard />
          </section>
        )}

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Guardrails-first",
              description:
                "TWAP validation, multi-oracle checks, price caps/floors, and circuit breakers baked into every execution.",
            },
            {
              title: "Execution routing",
              description:
                "Auto routes between Uniswap v3, CoW Protocol, and 1inch with MEV-protected order flow by default.",
            },
            {
              title: "Compliant automation",
              description:
                "Chainlink Automation primary, Gelato backup, and public execution after a grace window to avoid griefing.",
            },
          ].map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
