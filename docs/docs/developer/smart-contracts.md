---
title: Smart Contract Reference
sidebar_label: Smart Contracts
description: Detailed reference for the DCA Crypto smart contracts, including key functions, parameters, and interoperability notes.
---

# Smart Contract Reference

This section summarises the public interface of the audited smart contracts. It draws on the ABI tests under `contracts/test/*.abi.spec.ts` to ensure accuracy.

## DcaManager

Responsible for position lifecycle, accounting, and guard configuration.

### Key functions

| Function | Purpose | Notes |
| --- | --- | --- |
| `initialize(address admin, address executor, address priceOracle, address treasury)` | Proxy initialiser | Reverts on re-initialisation (see `system.behavior.spec.ts`). |
| `createPosition(CreatePositionParams params)` | Create and schedule a new position | Mints a `PositionNFT`, emits `PositionCreated`. |
| `modify(uint256 positionId, ModifyParams params)` | Adjust mutable fields | Immutable fields revert with custom errors. |
| `pause(uint256 positionId)` / `resume(uint256 positionId)` | Toggle execution | Emits `Paused` / `Resumed`. |
| `cancel(uint256 positionId)` | Close a position | Burns the NFT and refunds balances. |
| `deposit(uint256 positionId, address token, uint256 amount)` | Add idle balances | Token must match position direction. |
| `withdraw(uint256 positionId, address token, uint256 amount, address to)` | Remove funds | Enforces ownership/beneficiary checks. |
| `emergencyWithdraw(uint256 positionId)` | Initiate delayed exit | Requires timelock before completion. |
| `getPosition(uint256 positionId)` | Returns full position struct | Used by dashboard tables. |
| `getPositionBalance(uint256 positionId)` | Returns `(quoteBal, baseBal)` | Aligns with `PositionView` in frontend. |
| `positionsByOwner(address owner)` | Enumerate positions | Enables pagination in UI. |

### Configuration structs

- `ProtocolConfig`: protocol fee bps, execution fee, fee collector, referral defaults.
- `CircuitBreakerConfig`: global caps, min size, depeg limits.
- `VenueConfig`: adapter addresses, MEV defaults.

Setters (`setProtocolConfig`, `setCircuitBreakerConfig`, `setVenueConfig`, `setKeeperRegistry`) are role-gated and covered by ABI tests.

## PositionNFT

- ERC-721 token minted on `createPosition`.  
- Metadata fetched from off-chain storage to avoid upgrade conflicts.  
- Roles `MINTER_ROLE` / `BURNER_ROLE` restricted to the manager.

## Executor

Entry point for keepers. All external functions are `nonReentrant`.

| Function | Purpose | Highlights |
| --- | --- | --- |
| `execute(uint256 positionId)` | Trigger a single position | Validates guardrails, selects venue, settles balances. |
| `batchExecute(uint256[] calldata positionIds)` | Multi-position execution | Used by Chainlink Automation to amortise gas. |
| `simulate(uint256 positionId)` | Static-call helper | Off-chain simulation for monitoring tools. |
| `setKeeper(address keeper, bool allowed)` | Manage authorised executors | Gated by `KEEPER_ROLE`. |

Events:

- `ExecutionCompleted(uint256 positionId, address keeper)`
- `ExecutionSkipped(uint256 positionId, string reason)`
- `ExecutionDetails(uint256 positionId, address keeper, uint256 gasUsed, bytes routePath, int256 priceImpactBps, uint256 twapWindow, uint256 oracleTimestamp)`

## PriceOracle

Combines Chainlink feeds and Uniswap v3 TWAPs.

| Function | Description |
| --- | --- |
| `getQuoteUsd(address token)` | Returns USD price with 8 decimals. |
| `getTwap(address pool, uint32 window)` | Calculates TWAP price/seconds using Uniswap v3 observations. |
| `validatePrice(address base, address quote, uint32 window, uint16 deviationBps)` | Returns `(bool ok, uint256 priceUsd, uint256 deviationBps)` used by the executor. |

ABI tests (`contracts/test/oracle.abi.spec.ts`) ensure function availability and event signatures.

## Treasury

- Holds protocol execution fees.
- Exposes `withdraw(address token, uint256 amount, address to)` and timelocked `schedule/execute` operations.
- Uses OpenZeppelin `AccessControl` with `TREASURER_ROLE` and `FEE_COLLECTOR_ROLE`.

## Router adapters

| Adapter | Responsibility | Notes |
| --- | --- | --- |
| `UniV3Adapter` | Exact-input swaps across specified fee tiers | Supports Flashbots private transactions. |
| `CowAdapter` | Submits orders to CoW Protocol | Handles partial fills and settlement callbacks. |
| `OneInchAdapter` | Integrates with 1inch API payloads | Used when Auto routing favours aggregator liquidity. |

Adapters have minimal mutable state and forward custom errors back to the executor. Review `contracts/test/routerAdapters.abi.spec.ts` for exposed function names and events.

## TypeScript bindings

Generated via TypeChain (`pnpm -F contracts typechain`). Example usage:

```typescript title="frontend/lib/actions/createPosition.ts"
import { DcaManager__factory, type IDcaManager } from "@bitcoindca/contracts/typechain";
import { getWalletClient } from "wagmi/actions";
import { CONTRACT_ADDRESSES } from "../config";

export async function createPosition(params: IDcaManager.CreatePositionParamsStruct) {
  const wallet = await getWalletClient();
  if (!wallet) throw new Error("Wallet not connected");

  const manager = DcaManager__factory.connect(CONTRACT_ADDRESSES.DCA_MANAGER, wallet as any);
  return manager.createPosition(params);
}
```

The bindings share types with the documentation examples, improving copy/paste fidelity.
