---
title: Position Model
sidebar_label: Position Model
description: Understand how BitcoinDCA represents strategies, balances, and limits inside the DcaManager contract.
---

# Position Model

Every strategy in BitcoinDCA is stored as a `Position` struct within the `DcaManager`. Each position is linked to a `PositionNFT` that grants ownership rights and governs authorisation for modifications.

```solidity title="contracts/storage/PositionStorage.sol"
struct Position {
  address owner;
  address beneficiary;
  address quote;
  bool    isBuy;
  uint16  freq;
  uint16  venue;
  uint16  slippageBps;
  uint32  twapWindow;
  uint16  maxPriceDeviationBps;
  uint64  nextExecAt;
  uint64  startAt;
  uint64  endAt;
  uint32  periodsExec;
  uint128 amountPerPeriod;
  uint128 priceFloorUsd;
  uint128 priceCapUsd;
  bool    paused;
  uint64  maxBaseFeeWei;
  uint64  maxPriorityFeeWei;
}
mapping(uint256 => uint256) quoteBal;
mapping(uint256 => uint256) baseBal;
```

## Lifecycle

1. **Create** — A wallet (or Safe) calls `createPosition`. The manager mints a `PositionNFT`, stores parameters, and schedules the first execution via `nextExecAt`.
2. **Fund** — Users deposit assets via `deposit`, increasing `quoteBal` (for buys) or `baseBal` (for sells).
3. **Execute** — Keepers call `Executor.execute(positionId)` once `nextExecAt` is reached. The executor validates guards, routes the swap, updates balances, and emits telemetry.
4. **Modify** — Owners may adjust guard parameters, MEV mode, or beneficiary through `modify`. Immutable fields (quote, base, startAt) remain locked.
5. **Pause / Resume** — Temporarily halt execution without withdrawing. Resume recalculates `nextExecAt` based on the configured frequency.
6. **Cancel** — Closes the position and refunds balances to the beneficiary.
7. **Emergency Withdraw** — After a timelock delay, owners can pull funds irrespective of executor state, guaranteeing liveness in adverse conditions.

## Frequency and timing

- `freq` encodes daily (0), weekly (1), or monthly (2).  
- `startAt` ensures the first execution does not trigger before a specific timestamp.  
- `nextExecAt` is updated after each execution using the helper schedule logic in the manager; skipped executions requeue for the next interval.

The behaviour test [`contracts/test/system.behavior.spec.ts`](https://github.com/bobjiang/bitcoindca/blob/main/contracts/test/system.behavior.spec.ts) demonstrates the full lifecycle by creating a weekly USDC→WBTC position, funding it, waiting for the execution window, and verifying that:

```typescript title="contracts/test/system.behavior.spec.ts"
await expect(executor.connect(keeper).execute(positionId))
  .to.emit(executor, "ExecutionCompleted")
  .withArgs(positionId, await keeper.getAddress());
```

## Guardrails

- **Slippage:** Stored per position and clamped by the manager-wide maximum.
- **TWAP window & deviation:** Protects against sudden price spikes by comparing against both Chainlink and on-chain TWAP prices.
- **Price caps / floors:** Hard USD guard rails for aggressive market movements.
- **Gas caps:** Optional `maxBaseFeeWei` and `maxPriorityFeeWei` values prevent execution when the network is congested.

Guard enforcement is validated in `contracts/test/security/DOSProtection.test.ts` and `contracts/test/system.behavior.spec.ts`. When a guard trips, the executor emits:

```typescript title="contracts/test/system.behavior.spec.ts"
await expect(executor.connect(keeper).execute(positionId))
  .to.emit(executor, "ExecutionSkipped")
  .withArgs(positionId, "PRICE_DEVIATION");
```

## Accounting

- Deposits and withdrawals adjust `quoteBal` and `baseBal`.
- Executions consume quote (buys) or base (sells) funds and accrue the counter-asset into the opposite balance.
- Protocol fees are calculated per execution and forwarded to the Treasury.

Both balances are queryable via `getPositionBalance(positionId)` which returns the latest quote/base reserves for UI rendering.
