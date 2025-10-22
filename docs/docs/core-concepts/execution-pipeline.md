---
title: Execution Pipeline
sidebar_label: Execution Pipeline
description: Follow the end-to-end flow from keeper scheduling through guard validation, routing, settlement, and telemetry emission.
---

# Execution Pipeline

DCA Crypto relies on a layered automation stack to guarantee timely execution while prioritising safety and MEV resistance.

## Schedule flow

1. `nextExecAt` is initialised when a position is created or resumed.
2. Chainlink Automation monitors `checkUpkeep`-style conditions off-chain. When a position becomes eligible (time reached, funds available, guards healthy), the keeper submits a transaction to `Executor.execute`.
3. If Chainlink misses the window, Gelato tasks kick in using mirrored conditions.
4. After a configurable grace period, anyone can execute publicly. Public execution tightens slippage tolerances and charges a capped tip to discourage griefing.

The helper `isPositionEligible` (covered in `contracts/test/dcaManager.abi.spec.ts`) offers a lightweight call for keepers to pre-filter candidates.

## `Executor.execute` steps

1. **Eligibility check** — Re-validates time window and the paused state.
2. **Oracle validation** — Reads Chainlink feeds (USDC/USD, BTC/USD, ETH/USD, WBTC/BTC) and compares against Uniswap v3 TWAP data. Stale or deviating prices revert with custom errors (`StaleOracle`, `PriceDeviationExceeded`).
3. **Gas guard** — If the current base fee or priority fee exceeds the position's limit, execution aborts with reason `GAS_CAP`.
4. **Routing** — Selects adapter based on position venue:
   - **AUTO** — Ask routing engine to evaluate liquidity and slippage.  
   - **UNIV3_ONLY** — Direct swap against configured pools.  
   - **COW_ONLY** — Submit order to CoW batch auction (supports partial fills).  
   - **AGGREGATOR** — Use 1inch API pathing via the `OneInchAdapter`.
5. **Settlement** — Updates manager balances, increments `periodsExec`, schedules the next timestamp, and collects protocol fees.
6. **Telemetry** — Emits `ExecutionDetails` with gas usage, route path, price impact, and data points for monitoring systems.

Execution success and skipped cases are validated in the behaviour and security tests:

```typescript title="contracts/test/security/MEVProtection.test.ts"
await expect(executor.connect(keeper).execute(positionId))
  .to.emit(executor, "PositionExecuted")
  .withArgs(positionId);

await expect(executor.connect(keeper).execute(positionIdWithBadPrice))
  .to.emit(executor, "ExecutionSkipped")
  .withArgs(positionIdWithBadPrice, "PRICE_DEVIATION");
```

## MEV posture

- **Private routing:** Flashbots bundles and CoW batch auctions prevent back-running and sandwich attacks whenever possible.
- **Fallback public routing:** Enforces stricter slippage (`slippageBps / 2`) and tags executions so the analytics layer can flag degraded venues.
- **Record keeping:** Events track `venue`, `mode`, `priceUsd`, and `gasUsed`, giving operators and users a clear audit trail.

## Failure handling

- **Guard failure:** Emits `ExecutionSkipped`. The position stays active, and `nextExecAt` is delayed by one interval. Historical skips feed into analytics to spot persistent issues.
- **Routing error:** Adapters bubble up custom errors (e.g., `CowOrderNotFilled`). The executor maps them to skip reasons and avoids double-spending gas.
- **Oracle discrepancy:** Circuit breaker can trigger `CircuitBreakerTriggered` to pause the system globally until the multisig intervenes.
- **Automation outage:** Gelato and public execution ensure liveness, while the treasury funds emergency tips if required.

## Observability

- **Events:** `ExecutionDetails` provides structured payloads for monitors.  
- **Position views:** `getPosition` and `getPositionBalance` power the frontend dashboard (`frontend` package).  
- **Testing hooks:** Fixtures in `contracts/test/fixtures/deployments.ts` deploy a full stack for simulation, letting you reproduce pipeline states cheaply.
