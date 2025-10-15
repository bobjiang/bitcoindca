---
title: Events & Telemetry
sidebar_label: Events
description: Catalogue of BitcoinDCA contract events, their payloads, and usage in analytics pipelines.
---

# Events & Telemetry

All events use indexed parameters for efficient filtering. Subscribe via your preferred RPC/WebSocket provider or leverage The Graph.

## Position lifecycle

| Event | Description |
| --- | --- |
| `event PositionCreated(uint256 indexed positionId, address indexed owner, CreatePositionParams params);` | Fired on `createPosition`. Includes full parameter payload. |
| `event PositionModified(uint256 indexed positionId, ModifyParams params);` | Fired on `modify`. |
| `event PositionPaused(uint256 indexed positionId);` | Pause flag set. |
| `event PositionResumed(uint256 indexed positionId);` | Pause cleared. |
| `event PositionCanceled(uint256 indexed positionId);` | Position closed, NFT burned. |
| `event PositionEmergencyWithdrawn(uint256 indexed positionId, address indexed owner);` | Emergency exit finalised. |

## Funds movement

| Event | Description |
| --- | --- |
| `event Deposited(uint256 indexed positionId, address indexed token, uint256 amount);` | Funds added via `deposit`. |
| `event Withdrawn(uint256 indexed positionId, address indexed token, uint256 amount, address to);` | Funds withdrawn. |

## Execution telemetry

| Event | Description |
| --- | --- |
| `event ExecutionCompleted(uint256 indexed positionId, address indexed keeper);` | Successful execution. |
| `event ExecutionSkipped(uint256 indexed positionId, string reason);` | Guard failure. Reason strings map to constants (`PRICE_DEVIATION`, `GAS_CAP`, `DEPEG`, `PAUSED`, etc.). |
| `event ExecutionDetails(uint256 indexed positionId, address indexed keeper, uint256 gasUsed, bytes routePath, int256 priceImpactBps, uint256 twapWindow, uint256 oracleTimestamp);` | Rich telemetry for analytics. |

## Configuration & governance

| Event | Description |
| --- | --- |
| `event ProtocolConfigUpdated(ProtocolConfig newConfig);` | Fee changes. |
| `event CircuitBreakerTriggered(string reason, uint256 timestamp);` | System-level guard engaged. |
| `event CircuitBreakerConfigUpdated(CircuitBreakerConfig newConfig);` | Limit adjustments. |
| `event RouterAdapterUpdated(uint16 venue, address adapter);` | Router permissions updated. |
| `event OracleFeedUpdated(address token, address feed);` | Chainlink feed change. |
| `event KeeperRegistryUpdated(address chainlink, address gelato);` | Automation registry updates. |

## Treasury

| Event | Description |
| --- | --- |
| `event FeeConfigurationUpdated(FeeConfig newConfig);` | Execution fee parameters updated. |
| `event FeeWithdrawn(address indexed token, uint256 amount, address indexed to);` | Treasury disbursement. |
| `event TimelockScheduled(bytes32 indexed id, address target, uint256 value, bytes data, uint256 executeAt);` | Timelock action scheduled. |
| `event TimelockExecuted(bytes32 indexed id);` | Timelock completed. |

## Event ordering best practices

- Store block timestamps alongside raw event data to reconstruct execution cadence.
- Use `ExecutionSkipped` reasons to trigger alerts. `contracts/test/security/DOSProtection.test.ts` illustrates the mapping.
- For analytics dashboards, enrich events with oracle data at the time of execution to show TWAP vs execution price.
- Index `PositionCreated` → `PositionNFT` transfer logs to maintain an authoritative position ownership history.

## Sample listener (TypeScript)

```typescript title="listeners/executionFeed.ts"
import { ethers } from "ethers";
import DcaManager from "@bitcoindca/contracts/abis/DcaManager.json";
import Executor from "@bitcoindca/contracts/abis/Executor.json";

const provider = new ethers.WebSocketProvider(process.env.RPC_WS!);
const executor = new ethers.Contract(process.env.EXECUTOR!, Executor.abi, provider);

executor.on("ExecutionCompleted", (positionId, keeper, event) => {
  console.log("Executed", {
    positionId: positionId.toString(),
    keeper,
    txHash: event.transactionHash,
  });
});

executor.on("ExecutionSkipped", (positionId, reason) => {
  console.warn("Skipped", positionId.toString(), reason);
});
```

The ABI paths align with the generated artifacts from `pnpm -F contracts build`.
