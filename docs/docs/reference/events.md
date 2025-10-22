---
title: Events & Telemetry
sidebar_label: Events
description: Catalogue of DCA Crypto contract events, their payloads, and usage in analytics pipelines.
---

# Events & Telemetry

All events emitted by the protocol use indexed parameters on identifiers and accounts to make filtering inexpensive. Subscribe via your preferred RPC/WebSocket provider or consume them through The Graph.

## Position lifecycle (DcaManager)

| Event | Description |
| --- | --- |
| `PositionCreated(uint256 indexed positionId, address indexed owner, CreatePositionParams params)` | Fired when a strategy is created. Includes the full parameter struct for downstream indexing. |
| `PositionModified(uint256 indexed positionId, ModifyPositionParams params)` | Emitted after mutable guards/beneficiary fields change. |
| `PositionSlippageUpdated(uint256 indexed positionId, uint16 oldValue, uint16 newValue)` | Per-position slippage override. |
| `PositionVenueUpdated(uint256 indexed positionId, uint16 oldValue, uint16 newValue)` | Venue preference change (AUTO / UNIV3 / COW / AGGREGATOR). |
| `PositionGasCapsUpdated(uint256 indexed positionId, uint64 maxBaseFeeWei, uint64 maxPriorityFeeWei)` | Custom gas caps for execution. |
| `PositionPriceGuardsUpdated(uint256 indexed positionId, uint128 priceFloorUsd, uint128 priceCapUsd)` | Price guard adjustments. |
| `PositionBeneficiaryUpdated(uint256 indexed positionId, address oldBeneficiary, address newBeneficiary)` | Ownership of proceeds redirected. |
| `PositionPaused(uint256 indexed positionId)` / `PositionResumed(uint256 indexed positionId)` | Execution toggled. |
| `PositionCanceled(uint256 indexed positionId)` | Strategy closed; NFT is burned. |
| `PositionExecuted(uint256 indexed positionId, uint256 quoteUsed, uint256 baseUsed, uint256 quoteReceived, uint256 baseReceived, uint64 nextExecAt)` | Emits from the manager after each fill with settlement deltas. |
| `EmergencyWithdrawn(uint256 indexed positionId, address indexed to, uint256 quoteAmount, uint256 baseAmount)` | Emergency exit finalised. |
| `ExecNonceBumped(uint256 indexed positionId, uint64 oldNonce, uint64 newNonce)` | Nonce incremented following guard mutations. |
| `QuoteTokenAllowed(address indexed token, bool allowed)` | Protocol-level allow list updated. |
| `ActivePositionsReconciled(uint256 oldCount, uint256 newCount)` | Admin reconciliation of the active counter. |

## Funds movement

| Event | Description |
| --- | --- |
| `Deposited(uint256 indexed positionId, address indexed token, uint256 amount)` | Idle funds moved into the manager. |
| `Withdrawn(uint256 indexed positionId, address indexed token, uint256 amount, address indexed to)` | Funds withdrawn (either idle quote/base or residual proceeds). |

## Execution telemetry (Executor)

| Event | Description |
| --- | --- |
| `PositionExecuted(uint256 indexed positionId)` | Successful execution through the executor. |
| `ExecutionSkipped(uint256 indexed positionId, string reason)` | Guards or environment prevented execution. Reason strings match the enum in `ExecutionReason`. |
| `ExecutionDetails(uint256 indexed positionId, address indexed keeper, uint256 gasUsed, bytes routePath, int256 priceImpactBps, uint256 twapWindow, uint256 oracleTimestamp)` | Rich analytics payload per execution attempt. |

## Configuration & governance (DcaManager)

| Event | Description |
| --- | --- |
| `ProtocolConfigUpdated(ProtocolConfig config)` | Global fee knobs updated. |
| `KeeperRegistryUpdated(address chainlinkRegistry, address gelatoRegistry)` | Automation registries refreshed. |
| `VenueConfigUpdated(uint16 venue, address adapter)` | Adapter mapping adjusted. |

## Treasury

| Event | Description |
| --- | --- |
| `FeeCollected(address indexed token, uint256 amount, address indexed collector)` | Protocol fees pulled from executors or router adapters. |
| `FeeDistributed(address indexed token, address indexed recipient, uint256 amount)` | Outbound distributions (referrals, treasury splits). |
| `Withdrawn(address indexed token, uint256 amount, address indexed to)` | Manual withdrawal executed via the timelock. |
| `FeeCollected(address indexed token, uint256 amount, address indexed collector)` | Protocol fees pulled from executors or router adapters. |
| `FeeDistributed(address indexed token, address indexed recipient, uint256 amount)` | Outbound distributions (referrals, treasury splits). |
| `ProtocolFeeUpdated(uint16 previousBps, uint16 newBps)` / `ReferralFeeUpdated(uint16 previousBps, uint16 newBps)` | Percentage caps refined (expressed in whole percentages). |
| `ReferralFeeModeUpdated(bool referralFeeOnTop)` | Indicates whether referral rewards are charged on top of, or carved out of, the protocol fee. |
| `FeeCollectorUpdated(address indexed previousCollector, address indexed newCollector)` | Fee sink changed; automatically grants/revokes `FEE_COLLECTOR_ROLE`. |
| `EmergencyWithdraw(address indexed token, uint256 amount, address indexed to)` | Emergency disbursement during incidents. |
| `KeeperPaymentRegistered(address indexed keeper, uint256 amount)` / `KeeperPaymentClaimed(address indexed keeper, uint256 amount)` | Incentive accrual and payout. |
| `CustomReferralFeeSet(address indexed referrer, uint16 bps)` | Overrides the default referral percentage for a partner. |

## Oracle telemetry (PriceOracle)

| Event | Description |
| --- | --- |
| `PriceFeedAdded(address indexed token, address indexed feed)` / `PriceFeedUpdated` / `PriceFeedRemoved` | Chainlink feed registry management. |
| `MaxStalenessUpdated(uint256 maxStaleness)` | Global staleness threshold tuned. |
| `UniswapPoolRegistered(address indexed token0, address indexed token1, uint24 fee, address pool)` | TWAP source registered for a pair. |
| `AliasConfigured(bytes32 indexed aliasKey, address indexed token)` | Symbol → token address mapping for dashboard lookups. |
| `ReferencePriceUpdated(address indexed token, uint256 price)` | Off-chain reference price seeded to adjust confidence metrics. |

## Event ordering best practices

- Store block timestamps alongside raw event data to reconstruct execution cadence. `ExecutionDetails` already carries the oracle timestamp used for guard checks.
- Use `ExecutionSkipped` reasons to trigger alerts. The security suites under `contracts/test/security/*.test.ts` map expected reason strings.
- Pair `PositionCreated` with the `Transfer` event emitted by `PositionNFT` to maintain authoritative ownership history.
- When consuming treasury events, track role assignments (`AccessControl` events) to diagnose permission errors quickly.

## Sample listener (TypeScript)

```typescript title="listeners/executionFeed.ts"
import { ethers } from "ethers";
import ExecutorAbi from "@bitcoindca/contracts/abis/Executor.json";

const provider = new ethers.WebSocketProvider(process.env.RPC_WS!);
const executor = new ethers.Contract(process.env.EXECUTOR!, ExecutorAbi, provider);

executor.on("PositionExecuted", (positionId, event) => {
  console.log("Executed", {
    positionId: positionId.toString(),
    txHash: event.transactionHash,
  });
});

executor.on("ExecutionSkipped", (positionId, reason) => {
  console.warn("Skipped", positionId.toString(), reason);
});
```

The ABI paths align with the generated artifacts from `pnpm --filter ./contracts build`.
