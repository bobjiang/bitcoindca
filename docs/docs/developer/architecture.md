---
title: Architecture Overview
sidebar_label: Architecture
description: High-level view of contracts, automation, routing, and off-chain components that make up DCA Crypto.
---

# Architecture Overview

DCA Crypto is a layered system that harmonises on-chain smart contracts with off-chain automation and analytics. This page condenses `architecture.md` while linking to implementation specifics.

## Component map

- **Smart contracts**
  - `DcaManager` — Position lifecycle, guard configuration, accounting, limits.
  - `PositionNFT` — ERC-721 ownership tokens with metadata stored separately for upgrade safety.
  - `Executor` — Non-reentrant execution entrypoint for keepers (Chainlink, Gelato, public).
  - `PriceOracle` — Aggregates Chainlink feeds and Uniswap v3 TWAPs.
  - `Router adapters` — `UniV3Adapter`, `CowAdapter`, `OneInchAdapter`.
  - `Treasury` — Multisig/timelock-controlled fee sink.
- **Automation layer**
  - **Chainlink Automation** — Primary scheduler, monitors `nextExecAt`.
  - **Gelato** — Secondary scheduler replicating checks.
  - **Public fallback** — Anyone can execute after a grace window, collecting a capped tip.
- **Off-chain services**
  - **Subgraph / Indexers** — Index events for analytics.
  - **Monitoring** — Sentry, Prometheus, or custom infra consuming `ExecutionDetails`.
  - **Notifications** — EPNS/webhook for user alerts.

> Refer to `/architecture.md` for full diagrams, circuit breaker matrices, and deployment topologies.

## Execution flow

1. User creates a position via `DcaManager.createPosition`.
2. Automation stack watches `nextExecAt`.
3. Executor enforces guards and dispatches to the appropriate router.
4. Router interacts with DEX venue (Uniswap v3, CoW, 1inch).
5. Settlement updates balances and emits events.
6. Off-chain indexers persist events for UI dashboards and analytics.

## Deployment topology

- **Proxy pattern** — UUPS proxies for upgradability. The behaviour tests assert the correctness of proxy addresses using Hardhat’s `upgrades` helper.
- **Multisig + timelock** — Administrative actions require multisig approval and optional delay.
- **Router permissions** — Only whitelisted adapters can be invoked via `setVenueConfig`.

## Data contracts

- **Position storage** — Lives in a dedicated storage contract to preserve layout across upgrades.
- **Telemetry** — Events capture status, gas usage, and route decisions. `ExecutionDetails` includes route path bytes and price impact bps for analytics pipelines.
- **System configuration** — Structs such as `ProtocolConfig`, `CircuitBreakerConfig`, and `VenueConfig` allow fine-grained adjustments without redeploying contracts.

## Frontend integration

- Next.js app (`frontend` workspace) uses `wagmi` and `viem` for contract reads/writes.
- Safe App mode injects Safe SDK, with guards preventing non-owner submissions.
- Real-time data sourced from on-chain reads + subgraph caches for historical execution metrics.

## Further reading

- [Smart Contract Reference](./smart-contracts.md)
- [Integration Guide](./integration-guide.md)
- [Testing Playbooks](./testing.md)
- Root documents: [`architecture.md`](https://github.com/bobjiang/dcacrypto/blob/main/architecture.md), [`user-flow.md`](https://github.com/bobjiang/dcacrypto/blob/main/user-flow.md), [`AGENTS.md`](https://github.com/bobjiang/dcacrypto/blob/main/AGENTS.md)
