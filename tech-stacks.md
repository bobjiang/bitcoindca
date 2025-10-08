
# Tech stacks

Primary (most sensible) stack

## App framework

- Next.js (15+) + React 18 + TypeScript 
— file-based routing, RSC, great DX, easy SSR/ISR for public pages (docs, FAQs, ToS), and 
- solid deployment to Vercel or your own Node.

## Web3 + wallets

- scaffold - https://docs.scaffoldeth.io/
- hardhat- https://hardhat.org/
- wagmi v2 + viem — modern, type-safe, faster than ethers, first-class for contract reads/writes, events, and ABI types.
- RainbowKit (or Web3Modal if you prefer vendor-agnostic) — clean wallet UX, supports WalletConnect v2, Ledger, Coinbase Wallet.
- @safe-global/safe-apps-sdk — if you want a Safe app mode for treasuries/multisigs.

## Data & caching

- TanStack Query — retries, dedup, caching of reads (pairs well with wagmi).
- The Graph + urql (or Apollo) for your subgraph (Positions, Fills, ExecutionDetails).

## Forms & validation

- react-hook-form + zod — strong runtime validation for strategy creation (amounts, slippage, price guards).

## State & UI

- Zustand (lightweight app state) + Tailwind CSS + shadcn/ui (Radix based) — fast to ship a clean, accessible console.
- Lucide-react for icons.

## Charts & tables

- Recharts (easy) or ECharts (powerful) for cost-basis and fill history.
- TanStack Table for execution logs with virtualized rows.

## Dates & i18n

- date-fns (no moment bloat) + i18next if you’ll localize.

## Notifications & telemetry

- Push Protocol (EPNS) or email/webhook via your backend for fill/skip alerts.
- Sentry for FE errors; PostHog or Plausible for product analytics.

## Monorepo & tooling

- Turborepo + pnpm, ESLint/Prettier, Husky + lint-staged.
- Vitest + React Testing Library + Playwright for e2e.
- Storybook for strategy form components.

## Key frontend features to implement (non-negotiable)

- Strategy Wizard (3–4 steps)

	1.	Direction & asset amounts (BUY/SELL, per-period amount, USD-equiv toggle)
	2.	Cadence & schedule (daily/weekly/monthly, start/end)
	3.	Guards (slippage, price floor/cap, TWAP profile template)
	4.	Review & sign (Permit2 approval → create tx)

- Positions dashboard
- Cards: status, next run (local time), period progress, avg cost (TWAP vs realized), balances, fees paid.
- Actions: deposit/withdraw, pause/resume, modify, cancel, export CSV.
- Execution log
- Table with tx hash, venue (Uni/CoW/1inch), in/out, price, fees, price impact bps, keeper, gas used.
- Health & limits
- Global/position caps, depeg warnings, oracle staleness banner, circuit-breaker status.
- Safe App mode
- Detect Safe context and switch flow to multisig (proposing txs instead of direct send).

### Recommended library choices (pin these)
- wagmi: ^2.x
- viem: ^2.x
- @rainbow-me/rainbowkit: latest
- @safe-global/safe-apps-sdk: latest
- @tanstack/react-query: ^5.x
- react-hook-form: ^7.x + zod ^3.x
- @tanstack/react-table: ^8.x
- recharts or echarts-for-react
- date-fns ^3.x
- tailwindcss ^3.x + shadcn/ui

## Dev UX tips specific to this dApp

- Decimal hell prevention: centralize formatAmount(token, raw) & parseAmount(token, ui) with token metadata (decimals) and stick to bigint via viem.
- Optimistic UI carefully: only optimistic after tx enters mempool; reflect pending state and revert cleanly.
- Subgraph + live events: consume historical via subgraph, overlay live fills using watchContractEvent to feel realtime.
- Guard previews: show user what will skip execution (e.g., price floor/cap, depeg, gas caps) before they sign.
- CSV export: generate client-side from subgraph + local cache; include fiat rates used at execution.
