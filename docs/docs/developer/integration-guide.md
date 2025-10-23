---
title: Integration Guide
sidebar_label: Integration Guide
description: Implement keepers, monitoring, Safe App flows, and external notifications on top of DCA Crypto.
---

# Integration Guide

This guide targets developers building on top of the protocol—keepers, dashboards, analytics, and treasury automation.

## Keeper integration

### Chainlink Automation

- Register the `Executor` contract with your Chainlink registrar.
- `checkUpkeep`-style simulations rely on `Executor.simulate(positionId)` and `DcaManager.isPositionEligible`.
- Batch multiple `positionIds` via `Executor.batchExecute` to optimise gas.
- Chainlink nodes need `KEEPER_ROLE`. Grant via multisig:

```solidity title="scripts/grantKeeper.ts"
await executor.grantRole(EXECUTOR_ROLE, chainlinkRegistry);
await executor.grantRole(KEEPER_ROLE, chainlinkRegistry);
```

### Gelato fallback

- Mirror Chainlink conditions in Gelato tasks.  
- Respect the same grace period defined in `PROTOCOL_CONSTANTS.executionGracePeriodSeconds`.  
- Use the `ExecutionSkipped` event to stop retries if a guard is repeatedly tripping.

### Public execution

- Executors can expose a UI toggle allowing community members to trigger `execute` after the grace window.  
- Check skip reasons to avoid burning gas (`PRICE_DEVIATION`, `GAS_CAP`, `DEPEG`).  
- The public path halves slippage tolerance; notify users accordingly.

### Manual execution & Flashbots Protect

- Use `pnpm --filter ./contracts execute -- --position 123` to submit a one-off transaction against the configured network.  
- Set `EXEC_PRIVATE=true` (or pass `--private`) alongside `FLASHBOTS_RELAY` / `FLASHBOTS_AUTH_KEY` to route through Flashbots Protect.  
- The dashboard exposes a dev-only toggle that persists to `localStorage`, while production builds honour `NEXT_PUBLIC_EXEC_PRIVATE`.  
- Both the Hardhat helper and frontend API require `EXECUTOR_PRIVATE_KEY` and `NEXT_PUBLIC_EXECUTOR_ADDRESS` to be present.

## Indexing & analytics

- Subscribe to the events defined in [Reference > Events](../reference/events.md).
- The `ExecutionDetails` event includes:
  - `gasUsed`
  - `routePath`
  - `priceImpactBps`
  - `twapWindow`
  - `oracleTimestamp`
- Store historical executions to compute realised cost basis per position.
- Fetch per-position balances via `getPositionBalance(positionId)`—this is the same data the dashboard uses.

### Edge case monitoring

Leverage the test suite to understand expected behaviour:

- `contracts/test/security/MEVProtection.test.ts` documents reasons emitted when private execution fails.
- `contracts/test/security/DOSProtection.test.ts` showcases pause/circuit breaker events.
- `contracts/test/system.behavior.spec.ts` demonstrates the expected state transitions after success and skip.

## Safe App considerations

- Safe mode verifies `msg.sender` matches a Safe module or owner depending on configuration.  
- Support batched transactions (create + deposit) via Safe’s multi-send.  
- Respect Safe’s nonce management to avoid stuck positions.  
- Provide a review screen summarising guards and limits before creation—mirroring the UI prevents misconfiguration.

## Notifications & webhooks

- Publish execution summaries to EPNS or custom webhook endpoints:

```json title="Webhook payload"
{
  "positionId": "42",
  "owner": "0xabc...",
  "keeper": "0xdef...",
  "status": "EXECUTED",
  "amountIn": "500000000",
  "amountOut": "8732100",
  "venue": "AUTO",
  "priceUsd": "71600.23",
  "nextExecAt": 1735336800,
  "skipReason": null
}
```

- On skips, populate `status: "SKIPPED"` and set `skipReason` to one of the canonical strings (see `frontend/lib/protocol.ts` `EXECUTION_REASONS`).

## Deployment automation

- Deployment scripts live in `contracts/scripts`.  
- Provide environment variables for each network (`CHAINLINK_REGISTRAR`, `GELATO_AUTOMATE`, `FLASHBOTS_RELAY`).  
- Run `pnpm --filter ./contracts deploy --network mainnet` with multisig sign-off.

## Working with docs

- Add custom integration guides under `docs/docs/developer/` and update `sidebars.ts`.  
- Run `pnpm -F docs build` to confirm no broken links before publishing.  
- If integration changes modify public signatures, update the [Smart Contract Reference](./smart-contracts.md) and [API Reference](../reference/api-reference.md) concurrently.
