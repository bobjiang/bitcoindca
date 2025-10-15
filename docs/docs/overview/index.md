---
title: Welcome to BitcoinDCA
sidebar_label: Introduction
slug: /
description: Learn what BitcoinDCA is, the problems it solves, and how the platform automates non-custodial dollar-cost averaging for WBTC and ETH.
---

# BitcoinDCA Documentation

BitcoinDCA is a non-custodial automation layer that runs disciplined dollar-cost averaging (DCA) strategies for WBTC and ETH using stablecoins (USDC by default). It routes trades across Uniswap v3, CoW Protocol, and 1inch, prioritising MEV-safe execution with Chainlink Automation as the primary scheduler and Gelato plus public execution as fallbacks.

## Who this guide is for

- **End-users** who want predictable crypto exposure through recurring buys or sells with robust guardrails.
- **Developers** who integrate the protocol, extend the smart contracts, or operate keeper infrastructure.

## Why BitcoinDCA?

- **Non-custodial:** Funds remain in user-controlled smart contract positions secured by PositionNFTs.
- **Execution quality:** TWAP pricing, multi-oracle checks, depeg guards, and MEV-protected routing.
- **Automation:** Scheduled by Chainlink Automation, with Gelato and tip-based public execution as resilient fallbacks.
- **Safety rails:** Circuit breakers, per-user limits, pause levers, and emergency withdrawal pathways.

## Platform pillars

### Smart contract layer

- `DcaManager` (UUPS upgradeable) orchestrates position lifecycle, balance accounting, limits, and guard configuration.
- `Executor` validates guards and routes orders via adapter contracts (`UniV3Adapter`, `CowAdapter`, `OneInchAdapter`).
- `PriceOracle` blends Chainlink feeds with UniV3 TWAP data to detect price deviation or staleness.
- `PositionNFT` (ERC-721) represents ownership; metadata is kept in dedicated storage to allow logic upgrades.
- `Treasury` collects protocol fees with multisig/timelock controls.

### Automation & routing

1. **Primary:** Chainlink Automation monitors `nextExecAt` for each position.
2. **Fallback:** Gelato mirrors tasks and triggers if Chainlink is delayed.
3. **Grace period:** After a short grace window, anyone can execute publicly with a capped tip.
4. **Routing:** Auto mode selects the best venue based on liquidity, slippage bounds, and MEV posture. Manual venues lock execution to Uniswap v3, CoW, or 1inch respectively.

### Security posture

- **Guards:** Per-position slippage, TWAP deviation, Chainlink deviation, stablecoin peg checks.
- **Circuit breakers:** Global or asset-specific pauses, max positions per user, global position caps, minimum trade size.
- **Reentrancy & auth:** Every external mutative entry-point is `nonReentrant` and role-gated.
- **Emergency ops:** Delayed `emergencyWithdraw`, treasury timelock controls, and comprehensive telemetry events.

## Documentation map

- **Overview:** Quickstarts, glossary, and core concepts.
- **User Guides:** Step-by-step instructions for creating, funding, and supervising DCA strategies.
- **Developer Guides:** Architectural deep dives, integration patterns, and testing/playbooks.
- **Reference:** Function signatures, events, and configuration matrices.
- **Operations:** FAQ, troubleshooting runbooks, and operational checklists.

Use the persistent left navigation or the global search (press `/`) to jump to specific topics.

## Staying up to date

- Track protocol changes in `CHANGELOG.md` (root of the Git repository).
- Watch the [`contracts/test`](https://github.com/bobjiang/bitcoindca/tree/main/contracts/test) suite for new behaviours and edge cases.
- Subscribe to the community channel for release notes and incident reports.
