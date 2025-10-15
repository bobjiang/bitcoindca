---
title: Manage Positions & Balances
sidebar_label: Manage Positions
description: Learn how to pause, resume, modify, and withdraw from BitcoinDCA positions with full guard awareness.
---

# Manage Positions & Balances

Once a position is live, you have fine-grained controls to react to markets or liquidity needs.

## Pause and resume

- **Pause:** Halts new executions without touching deposited funds. Useful for volatile markets.  
  - UI action calls `pause(positionId)`.  
  - The executor emits `ExecutionSkipped(positionId, "PAUSED")` if keepers attempt execution while paused.  
  - Covered by `contracts/test/security/DOSProtection.test.ts`.

- **Resume:** Restarts scheduling, recalculating `nextExecAt` to the next valid window.

## Modify parameters

`modify(positionId, ModifyParams)` lets you adjust guardrails without recreating the position. Mutable fields include:

- `slippageBps`
- `maxPriceDeviationBps`
- `twapWindow`
- `priceCapUsd` / `priceFloorUsd`
- `venue`
- `MEV mode`
- `maxBaseFeeWei` / `maxPriorityFeeWei`
- `beneficiary`

Immutable fields (quote/base assets, amount per period, start/end times) require cancelling and creating a new position. Attempting to modify them reverts with `ImmutableField()` as enforced in `contracts/test/dcaManager.abi.spec.ts`.

## Top up or withdraw balances

- **Deposit:**  
  ```typescript title="frontend/hooks/usePositionActions.tsx"
  await manager.deposit(positionId, tokenAddress, amount);
  ```
  Increases idle funds. Deposits are idempotent and may be batched.

- **Withdraw:**  
  ```solidity title="contracts/interfaces/IDcaManager.sol"
  function withdraw(
    uint256 positionId,
    address token,
    uint256 amount,
    address to
  ) external;
  ```
  Lets owners reclaim excess funds or collected base asset. `to` defaults to the beneficiary when called from the UI.

Withdrawals emit `Withdrawn(positionId, token, amount, to)` which the dashboard displays in the activity timeline.

## Cancel a position

- Calls `cancel(positionId)` to close the strategy.  
- Refunds remaining balances to the beneficiary.  
- Burns the `PositionNFT`.  
- Execution attempts afterwards revert with `PositionNotActive`.

## Emergency withdrawal

- `emergencyWithdraw(positionId)` starts a two-step process:  
  1. Arm the withdrawal with a timelock delay (recorded on-chain).  
  2. After the delay, call `completeEmergencyWithdraw` to transfer all funds.
- Intended for venue outages or severe oracle issues.
- Validated by `contracts/test/security/Reentrancy.test.ts` to ensure state integrity.

## Monitoring executions

- The activity feed renders `ExecutionCompleted`, `ExecutionSkipped`, `Deposited`, and `Withdrawn` events.  
- The dashboard compares TWAP vs execution price, highlighting deviations beyond tolerated bounds.  
- For custom tooling, subscribe to events in the [Reference > Events](../reference/events.md) section.

## Notifications

- Optional integrations with EPNS/Webhooks (see [Integration Guide](../developer/integration-guide.md#notifications--webhooks)) can alert you when executions succeed or guards trip.

## Best practices

- Keep at least 3 execution periods’ worth of liquidity in the position to avoid churn.  
- Review guard failures promptly; persistent `PRICE_DEVIATION` may indicate stale or mispriced feeds.  
- If you rely on the public executor fallback, revisit gas caps to balance speed vs cost.
