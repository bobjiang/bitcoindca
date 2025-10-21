---
title: Glossary
sidebar_label: Glossary
description: Definitions of recurring DCA Crypto terminology, guard parameters, and contract components.
---

# Glossary

- **Auto Venue** — Dynamic router selection across Uniswap v3, CoW Protocol, and 1inch. Picks the venue that satisfies guards with the best execution price while favouring private order flow.
- **Base Asset** — The asset you accumulate when the position is a **buy** (WBTC or ETH). When selling, the base is what you are unwinding.
- **Beneficiary** — Address that receives withdrawn or settled funds; can differ from the owner.
- **Chainlink Automation** — Primary keeper network triggering DCA executions based on `nextExecAt`.
- **Circuit Breaker** — Manager-level guard that halts execution when system-wide thresholds (global position cap, depeg detection) are tripped.
- **CoW Adapter** — Router adapter integrating with CoW Protocol batch auctions. Supports partial fills while maintaining MEV protection.
- **Depeg Guard** — Validation that quote stablecoins (USDC) still trade within an allowed deviation from $1 using Chainlink feeds.
- **Emergency Withdraw** — Time-delayed escape hatch that unlocks funds irrespective of execution state. Emits `EmergencyWithdrawn`.
- **Executor** — Keeper entry-point contract that validates guards, calls router adapters, and updates accounting.
- **Frequency** — Interval for DCA execution (daily = 0, weekly = 1, monthly = 2). Stored as `uint16` in `Position`.
- **Gelato** — Fallback automation network mirroring Chainlink tasks to ensure redundancy.
- **Idle Balance (quote/base)** — Funds held against the position and tracked via the manager’s `quoteBal` / `baseBal` mappings.
- **MAX Price Deviation Bps** — Position-level guard comparing execution price to Chainlink & TWAP references. Default 100 = 1%.
- **MEV Mode** — Execution mode toggled between PRIVATE (Flashbots / CoW) and PUBLIC (on-chain with stricter slippage).
- **Position** — Struct representing a DCA strategy. Owned by the wallet holding the corresponding `PositionNFT`.
- **PositionNFT** — ERC-721 token minted on `createPosition`. Ownership controls permissions for modify/pause/resume.
- **Price Cap / Floor** — Optional absolute USD bounds that force the executor to skip execution if breached.
- **Protocol Fee** — Basis points fee routed to the Treasury on successful executions.
- **Router Adapter** — Stateless contract that abstracts venue-specific logic (Uniswap v3 swap, CoW order submission, 1inch execution).
- **Slippage Bps** — Maximum tolerable difference between expected and realised execution price per position.
- **TWAP Window** — Lookback duration (≥3600s) used when comparing on-chain TWAP against oracle prices.
- **Venue** — Execution setting chosen per position: AUTO, UNIV3_ONLY, COW_ONLY, AGGREGATOR (1inch).
