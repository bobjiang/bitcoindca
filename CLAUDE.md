# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Bitcoin and Ethereum Dollar Cost Averaging (DCA) application. The repository is currently in its initial state with minimal structure.

## Project Repository Structure

```
apps/web/
  app/
    (public)/         # marketing/docs pages (SSR/ISR)
    dashboard/        # protected console (SPA/RSC compliant)
      positions/
      create/
      settings/
    api/              # minimal server routes if needed
  components/
    forms/            # RHF + zod schemas
    charts/
    tables/
    web3/
  lib/
    abis/
    wagmi.ts          # client, chains, transports
    viem.ts
    subgraph.ts
    formatters.ts     # amounts, prices, bps
    guards.ts         # client-side validation mirrors
  styles/
  tests/
packages/
  ui/                 # shared design system tokens/components
  config/             # eslint, tsconfig, tailwind presets
```

# Bitcoin DCA on Ethereum — Merged Requirements (v0.3)

0) Goals & Scope
	•	Goal: Non-custodial automated DCA to buy/sell WBTC on daily/weekly/monthly cadence using USDC (default) or other supported stable tokens (like USDT, DAI etc).
	•	Venues: AUTO routing (Uniswap v3 ↔ CoW ↔ 1inch) with MEV protection.
	•	Automation: Chainlink Automation primary; Gelato fallback; optional public execution with tip after a grace window.
	•	Security posture: Long TWAP, multi-oracle checks, strict slippage, circuit breakers, position/volume limits.

⸻

1) Core User Flows

Create Position (BUY or SELL)
	•	Select direction (BUY: quote→WBTC, SELL: WBTC→quote).
	•	Amount per period (BUY: quote in token units or USD-equiv; SELL: WBTC units or USD-equiv).
	•	Frequency: daily / weekly / monthly.
	•	StartAt / EndAt (UTC).
	•	Guards: slippageBps, priceCapUsd (BUY), priceFloorUsd (SELL), depeg guard on quote/stable.
	•	Routing: Venue.AUTO by default; advanced users can pin UNIV3_ONLY | COW_ONLY | AGGREGATOR.
	•	MEV mode: PRIVATE (Flashbots) or PUBLIC with tight slippage (default PRIVATE).
	•	Gas caps: maxBaseFeeWei, maxPriorityFeeWei (optional overrides).

Manage Position
	•	Deposit / Withdraw (idle balances & accumulated fills) anytime; permit2 supported.
	•	Pause / Resume / Modify (modify only safe fields: slippage, venue, gas caps, guards, beneficiary).
	•	Cancel (no more executions; withdraw remaining funds).
	•	Emergency Withdraw (time-delayed; see §6.4).

⸻

2) Smart Contract Architecture

NOTE: For the smart contract, if there are any re-usable contract or library from https://docs.openzeppelin.com/contracts , please choose it.

Contracts
	1.	DcaManager (UUPS)
	•	Creates positions (mints PositionNFT), stores internal balances, authorizes executors/routers, enforces limits and circuit breakers.
	2.	PositionNFT (ERC-721)
	•	Metadata reads from PositionStorage (separate upgradable storage) to avoid NFT logic conflicts.
	3.	Executor
	•	Keeper entrypoint. Enforces guards, selects route, executes swaps, updates accounting, schedules next run. nonReentrant on all externals.
	4.	Router Adapters
	•	UniV3Adapter, CowAdapter (partial fills allowed), OneInchAdapter.
	5.	PriceOracle
	•	Wraps Chainlink (BTC/USD, ETH/USD, USDC/USD, WBTC/BTC) + Uniswap v3 TWAP utilities.
	6.	Treasury
	•	Fee sink with 2/3 multisig & timelock.

Storage (packed)

struct Position {
  address owner;
  address beneficiary;
  address quote;            // e.g., USDC
  bool    isBuy;
  uint16  freq;             // 0=daily,1=weekly,2=monthly
  uint16  venue;            // 0=AUTO,1=UNIV3_ONLY,2=COW_ONLY,3=AGGREGATOR
  uint16  slippageBps;      // default 50 (0.5%)
  uint32  twapWindow;       // default 3600 (1h)
  uint16  maxPriceDeviationBps; // vs oracle/TWAP, default 100 (1%)
  uint64  nextExecAt;       // UTC
  uint64  startAt;          // immutable
  uint64  endAt;            // 0 if none
  uint32  periodsExec;
  uint128 amountPerPeriod;  // BUY: quote; SELL: WBTC
  uint128 priceFloorUsd;    // SELL guard; 0 none
  uint128 priceCapUsd;      // BUY guard; 0 none
  bool    paused;
  uint64  maxBaseFeeWei;    // optional
  uint64  maxPriorityFeeWei;// optional
}
mapping(uint256 => uint256) quoteBal;
mapping(uint256 => uint256) baseBal;

System Limits (DoS protection)

uint256 public maxPositionsPerUser = 10;
uint256 public maxGlobalPositions  = 10_000 (ramp gradually);
uint256 public minPositionSizeUsd  = 100e6 (USDC 6dp) // enforce via oracle


⸻

3) Execution Logic

Eligibility
	•	block.timestamp >= nextExecAt
	•	!paused
	•	Sufficient internal balance (incl. protocol fee + exec fee headroom).

Guards (must all pass)
	•	Oracle staleness ≤ 30 min.
	•	TWAP window: ≥ twapWindow (default 1h).
	•	Deviation caps: |DEXPrice - TWAP| ≤ maxPriceDeviationBps AND |TWAP - Oracle| ≤ maxPriceDeviationBps.
	•	Stable depeg: |oracle(quote/USD)-1| ≤ 1% (else skip).
	•	Price cap/floor: BUY only if oracle(BTC/USD) ≤ priceCapUsd (if >0). SELL only if oracle(BTC/USD) ≥ priceFloorUsd (if >0).
	•	Gas caps: baseFee and priorityFee ≤ per-position caps when set.

Routing (AUTO policy)
	1.	If notional ≥ $5k or Uni slippage estimate > slippageBps → CoW (partial fills OK).
	2.	Else Uni v3 with private tx (Flashbots).
	3.	If revert (liquidity/slippage) → 1inch fallback.
	4.	If still fail → skip, no schedule advance, emit ExecutionSkipped(reason).

Partial Fills Policy
	•	Allowed only via CoW. Uni/1inch: fill-or-revert.

Accounting
	•	BUY: deduct amountIn + protocolFee + execFeeWei; credit baseBal with WBTC received.
	•	SELL: deduct WBTC in; credit quoteBal.
	•	Fees:
	•	Protocol fee: notional * feeBps / 1e4 (tiered 10–30 bps; default 20 bps).
	•	Exec fee: executionFeeFixed + gasPremiumBps * notional / 1e4 (see FeeConfig).
	•	Schedule:
	•	nextExecAt = nextScheduled(startAt, freq, periodsExec+1) with calendar-aware monthly (clamp to month end).
	•	periodsExec++.
	•	End: If endAt != 0 && block.timestamp >= endAt → auto-pause after cycle.

⸻

4) Fees & Incentives

FeeConfig

struct FeeConfig {
  uint16  protocolFeeBps;         // default 20 bps
  uint256 executionFeeFixedWei;   // base keeper fee
  uint16  gasPremiumBps;          // dynamic premium vs notional
  address feeCollector;           // treasury
  uint16  referralFeeBpsDefault;  // share of protocolFee
}
mapping(address referrer => uint16 customBps); // optional overrides

	•	Keeper incentives:
	•	Chainlink/Gelato paid from exec fee.
	•	Public execution fallback: after grace=6h post-window start, anyone can execute and claim tipWei (from exec fee). Add per-position cooldown to prevent griefing.

⸻

5) Circuit Breakers & Emergency
	•	Global: pause all, or per-asset/per-venue.
	•	Market breakers (auto):
	•	maxDailyVolumeUsd (e.g., $10M) → pause when exceeded.
	•	maxPriceMovementBps in 1h (e.g., 2000 = 20%) → auto-pause affected asset/venue.
	•	Emergency Withdraw:
	•	If no successful execution and position paused for ≥ 7 days, user may emergencyWithdrawAll(id) (idle balances + accumulated assets). Never touches in-flight swaps.

⸻

6) Keeper & Throughput
	•	Primary: Chainlink Automation: checkUpkeep() batches by time window.
	•	Backup: Mirrored Gelato task.
	•	Batching: batchExecute(uint256[] ids) with per-tx gas cap; group by venue/path for efficiency.

⸻

7) Events & Analytics

Core Events
	•	PositionCreated(id, owner, isBuy, quote, amountPerPeriod, freq, venue, startAt, endAt)
	•	PositionModified(id, fieldMask)
	•	Deposited(id, token, amount) / Withdrawn(id, token, amount, to)
	•	Executed(id, idx, venue, inTok, inAmt, outTok, outAmt, priceUsd, protoFeeBps, execFeeWei)
	•	ExecutionSkipped(id, reason)
	•	Paused(id) / Resumed(id) / Canceled(id)

ExecutionDetails (extended telemetry)

event ExecutionDetails(
  uint256 indexed positionId,
  address keeper,
  uint256 gasUsed,
  bytes   routePath,       // encoded pools/fees or CoW order id
  int256  priceImpactBps,  // vs TWAP
  uint256 twapWindow,
  uint256 oracleTimestamp
);

	•	Subgraph metrics: notional traded, avg execution vs TWAP, skip rate, fee take, success rate, per-venue split.

⸻

8) UX & API
	•	Creation templates: CONSERVATIVE (0.3% slippage; 2h TWAP), BALANCED (0.5%; 1h), AGGRESSIVE (1%; 30m).
	•	Live estimates: estimateTotalCost(params) returns protocol fees, exec fee guess, slippage estimate, route likelihood.
	•	Health panel:
	•	executionRate %, avgSlippage bps, gasEfficiency vs median.
	•	Withdrawals: accumulated WBTC/quote withdrawable anytime (not during execute).
	•	CSV export: tx hash, timestamp, in/out, net price, fees, route, keeper.

⸻

9) Tokens & Routing
	•	Quote tokens: USDC (default), DAI, USDT, WETH; ETH supported via WETH wrap/unwrap.
	•	Base token: WBTC (v1); plan optional tBTC in v2.
	•	Venues:
	•	AUTO cascade (CoW ↔ Uni ↔ 1inch) per §3.
	•	Uniswap v3 pool selection: scan fee tiers, depth, TWAP; prefer lowest price impact.

⸻

10) Security Requirements
	•	NonReentrant on all externals mutating state.
	•	Checks-Effects-Interactions pattern; no untrusted delegatecall.
	•	Permit2 approvals with time-boxed allowances.
	•	Formal verification of invariants:
	•	Conservation of value (no value creation).
	•	Fees non-negative and within caps.
	•	Schedule monotonicity.
	•	Audits pre-mainnet; bug bounty live (Immunefi).

⸻

11) Compliance & Ops
	•	No KYC v1; ToS & risk disclosures; frontend geo-blocks as needed.
	•	Runbooks: keeper outage, oracle staleness, venue pause, incident comms.
	•	Upgrade safety: 48h timelock; Guardian can pause; publish diffs and audit addendum.

⸻

12) Limits & Phased Rollout
	•	M0 (Weeks 1–2):
	•	Uni v3 BUY-only (USDC↔WBTC), daily cadence, PRIVATE tx, manual keeper, subgraph v0, system limits enforced.
	•	M1 (Weeks 3–6):
	•	SELL, all cadences, Chainlink+Gelato, PositionNFT+Storage split, CSV export, fee switch, batchExecute, public fallback with tip.
	•	M2 (Weeks 7–10):
	•	CoW routing (partial fills), AUTO router, extended telemetry, circuit breakers, audit + bounty, mainnet beta with caps:
	•	maxGlobalPositions=100, maxPerUser=5, $10k max per position, $1M daily cap.
	•	M3 (Post-GA):
	•	Gradual cap increases, Dune/Graph dashboards, L2 readiness, tBTC option.

⸻

13) Clean ABI (final)

function createPosition(CreateParams calldata p) external returns (uint256 id);
function deposit(uint256 id, address token, uint256 amt) external;
function withdraw(uint256 id, address token, uint256 amt, address to) external;

function pause(uint256 id) external;
function resume(uint256 id) external;
function modify(uint256 id, ModifyParams calldata p) external;
function cancel(uint256 id) external;

function eligible(uint256 id) external view returns (bool);
function execute(uint256 id) external returns (ExecutionResult memory);
function batchExecute(uint256[] calldata ids) external returns (ExecutionResult[] memory);

function quoteNext(uint256 id) external view returns (TradeQuote memory);
function estimateTotalCost(CreateParams calldata p) external view returns (FeeEstimate memory);

function checkLiquidity(uint256 id) external view
  returns (bool hasLiquidity, uint256 expectedSlippageBps, bytes memory optimalPath);


⸻

14) Open Items (tracked)
	•	Tiered fee schedule bands & referral exact math.
	•	Default twapWindow per venue and notional (heuristics vs user override).
	•	Public execution cooldown constants and grief-prevention analytics thresholds.

⸻

Bottom line

Yes—the review comments make sense and are now merged. This v0.3 spec is execution-ready, security-tight, and ops-friendly. If you want, I can ship:
	•	a Foundry scaffold (contracts + adapters + invariant tests),
	•	a subgraph schema (Positions, Fills, ExecutionDetails), and
	•	a Next.js create-flow with Permit2 + PRIVATE tx toggle.



# Tech stacks

Primary (most sensible) stack

App framework
	•	Next.js (15+) + React 18 + TypeScript — file-based routing, RSC, great DX, easy SSR/ISR for public pages (docs, FAQs, ToS), and solid deployment to Vercel or your own Node.

Web3 + wallets
	•	wagmi v2 + viem — modern, type-safe, faster than ethers, first-class for contract reads/writes, events, and ABI types.
	•	RainbowKit (or Web3Modal if you prefer vendor-agnostic) — clean wallet UX, supports WalletConnect v2, Ledger, Coinbase Wallet.
	•	@safe-global/safe-apps-sdk — if you want a Safe app mode for treasuries/multisigs.

Data & caching
	•	TanStack Query — retries, dedup, caching of reads (pairs well with wagmi).
	•	The Graph + urql (or Apollo) for your subgraph (Positions, Fills, ExecutionDetails).

Forms & validation
	•	react-hook-form + zod — strong runtime validation for strategy creation (amounts, slippage, price guards).

State & UI
	•	Zustand (lightweight app state) + Tailwind CSS + shadcn/ui (Radix based) — fast to ship a clean, accessible console.
	•	Lucide-react for icons.

Charts & tables
	•	Recharts (easy) or ECharts (powerful) for cost-basis and fill history.
	•	TanStack Table for execution logs with virtualized rows.

Dates & i18n
	•	date-fns (no moment bloat) + i18next if you’ll localize.

Notifications & telemetry
	•	Push Protocol (EPNS) or email/webhook via your backend for fill/skip alerts.
	•	Sentry for FE errors; PostHog or Plausible for product analytics.

Monorepo & tooling
	•	Turborepo + pnpm, ESLint/Prettier, Husky + lint-staged.
	•	Vitest + React Testing Library + Playwright for e2e.
	•	Storybook for strategy form components.

⸻

Why this stack fits a DCA dApp
	•	Deterministic reads: viem + wagmi watch functions make it trivial to reflect on-chain state (nextExecAt, balances, fills) without hand-rolled polling.
	•	SSR where it matters: marketing/docs/FAQ render fast; app console runs as SPA for wallet flows.
	•	Type safety: zod + viem ABI types catch unit/decimals mistakes (USDC 6dp vs WBTC 8dp) before they hit mainnet users.
	•	Composable UX: shadcn/ui + Tailwind let you ship a crisp, pro console quickly (strategy wizard, dashboards, CSV export).

⸻

Key frontend features to implement (non-negotiable)
	•	Strategy Wizard (3–4 steps)
	1.	Direction & asset amounts (BUY/SELL, per-period amount, USD-equiv toggle)
	2.	Cadence & schedule (daily/weekly/monthly, start/end)
	3.	Guards (slippage, price floor/cap, TWAP profile template)
	4.	Review & sign (Permit2 approval → create tx)
	•	Positions dashboard
	•	Cards: status, next run (local time), period progress, avg cost (TWAP vs realized), balances, fees paid.
	•	Actions: deposit/withdraw, pause/resume, modify, cancel, export CSV.
	•	Execution log
	•	Table with tx hash, venue (Uni/CoW/1inch), in/out, price, fees, price impact bps, keeper, gas used.
	•	Health & limits
	•	Global/position caps, depeg warnings, oracle staleness banner, circuit-breaker status.
	•	Safe App mode
	•	Detect Safe context and switch flow to multisig (proposing txs instead of direct send).

⸻

Solid alternates (if you don’t want Next.js)
	1.	SvelteKit + TypeScript
	•	Lean, fast, great forms; use viem via community bindings, wagmi-svelte (community) or raw viem hooks.
	•	Pro: performance and smaller bundle; Con: web3 libs less mature than React.
	2.	SolidStart + TypeScript
	•	Blazing perf, signals fit live on-chain state nicely.
	•	Con: fewer off-the-shelf wallet kits; more custom glue.

If you go off React, expect extra work on wallet modals, Safe app support, and component ecosystems.

⸻

Recommended library choices (pin these)
	•	wagmi: ^2.x
	•	viem: ^2.x
	•	@rainbow-me/rainbowkit: latest
	•	@safe-global/safe-apps-sdk: latest
	•	@tanstack/react-query: ^5.x
	•	react-hook-form: ^7.x + zod ^3.x
	•	@tanstack/react-table: ^8.x
	•	recharts or echarts-for-react
	•	date-fns ^3.x
	•	tailwindcss ^3.x + shadcn/ui

⸻

Dev UX tips specific to this dApp
	•	Decimal hell prevention: centralize formatAmount(token, raw) & parseAmount(token, ui) with token metadata (decimals) and stick to bigint via viem.
	•	Optimistic UI carefully: only optimistic after tx enters mempool; reflect pending state and revert cleanly.
	•	Subgraph + live events: consume historical via subgraph, overlay live fills using watchContractEvent to feel realtime.
	•	Guard previews: show user what will skip execution (e.g., price floor/cap, depeg, gas caps) before they sign.
	•	CSV export: generate client-side from subgraph + local cache; include fiat rates used at execution.

⸻

Bootstrap commands (if you want a head start)

# Create Next app
pnpm create next-app@latest dca-web --ts --eslint --tailwind

# Add core deps
pnpm add wagmi viem @rainbow-me/rainbowkit
pnpm add @tanstack/react-query zod react-hook-form
pnpm add @tanstack/react-table recharts date-fns
pnpm add class-variance-authority clsx lucide-react
pnpm add @safe-global/safe-apps-sdk

# Dev/testing
pnpm add -D vitest @testing-library/react @types/node @types/react


⸻

If you want, I can drop a minimal Next.js + wagmi + RainbowKit scaffold with a working Create Position form, validation (zod), and a stubbed subgraph client so your team can start wiring in ABIs and contract calls immediately.