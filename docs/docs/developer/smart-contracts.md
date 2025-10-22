---
title: Smart Contract Reference
sidebar_label: Smart Contracts
description: Detailed reference for the DCA Crypto smart contracts, including key functions, parameters, and interoperability notes.
---

# Smart Contract Reference

This section summarises the public interface of the deployed contracts. Every function or event listed here is covered by the ABI conformance tests under `contracts/test/*.abi.spec.ts`.

## DcaManager

Owns position lifecycle, guard configuration, and accounting.

### Initialization

`initialize(address positionNFT, address positionStorage, address priceOracle, address treasury, address baseAsset)`

- Registers the NFT contract, metadata storage proxy, price oracle, treasury timelock, and the base asset used for SELL flows (WBTC in production).
- Grants default admin / pauser / executor / keeper / router / oracle / treasurer roles to the initial caller.
- Emits no events; re-initialisation reverts with `Initializable: contract is already initialized`.

### Core mutators

| Function | Purpose | Notes |
| --- | --- | --- |
| `createPosition(CreatePositionParams params)` | Mints a `PositionNFT`, persists metadata, schedules the first execution. | Emits `PositionCreated`. Quote token must be explicitly allowed. |
| `modify(uint256 positionId, ModifyPositionParams params)` | Updates slippage, venue, gas caps, beneficiaries, price guards, or MEV preference. | Emits dedicated update events before `PositionModified`. |
| `pause(uint256 positionId)` / `resume(uint256 positionId)` | Toggles execution status. | `pause` sets `pausedAt` and seeds an emergency unlock timestamp. |
| `cancel(uint256 positionId)` | Permanently stops the strategy, burns the NFT, and removes metadata. | Emits `PositionCanceled`. |
| `deposit(uint256 positionId, address token, uint256 amount)` | Adds idle balances. | `token` must align with position direction (quote for BUY, base for SELL). |
| `withdraw(uint256 positionId, address token, uint256 amount, address to)` | Withdraws idle balances back to the owner/beneficiary. | Emits `Withdrawn`. |
| `emergencyWithdraw(uint256 positionId)` | Two-step escape hatch. First call arms a delay, second call (after delay) releases funds and cancels the position. | Emits `EmergencyWithdrawn`. |

### Read helpers

| Function | Returns | Notes |
| --- | --- | --- |
| `getPosition(uint256 positionId)` | Full `Position` struct (see `AGENTS.md` glossary). | Reverts with `PositionNotFound()` if missing. |
| `getPositionBalance(uint256 positionId, address token)` | Individual token balance for the position. | Use the quote token address for BUY idle balances and the base asset for SELL balances. |
| `positionsByOwner(address owner)` | Dynamic array of position IDs. | Mirrors the `PositionStorage` tracking. |
| `isPositionEligible(uint256 positionId)` | `(bool eligible, string reason)` used by executors to pre-screen. | Reasons map to the strings asserted in `Executor.test.ts`. |

### Configuration knobs

- `setProtocolConfig(ProtocolConfig config)` – updates protocol fee %, execution fee floor, gas premium %, fee collector address, and default referral %. Emits `ProtocolConfigUpdated`.
- `setVenueConfig(uint16 venue, address adapter)` – registers a new adapter address for the venue enum.
- `setCircuitBreakerConfig(uint256 dailyLimitUsd, uint16 priceMovementBps)` – adjusts global circuit breaker thresholds.
- `setKeeperRegistry(address chainlinkRegistry, address gelatoRegistry)` – updates automation registries.
- `setQuoteTokenAllowed(address token, bool allowed)` – allow/deny quote assets.

All setter functions are protected by the appropriate role (see `Roles` library) and bump the per-position execution nonce when relevant.

### Events

See [Events & Telemetry](../reference/events.md) for the complete list. Key emissions include `PositionCreated`, `PositionExecuted`, `ExecutionSkipped`, and the various guard update events.

## PositionNFT

- Upgradeable ERC-721 that tracks strategy ownership. Metadata is stored off-chain and referenced via `baseURI` or per-token overrides.
- Roles:
  - `MINTER_ROLE` and `BURNER_ROLE` granted to `DcaManager`.
  - `METADATA_ROLE` for token URI overrides.
- Default base URI: `https://metadata.dca-crypto.invalid/positions/`.
- Revert semantics match OpenZeppelin v4 expectations (`ERC721: mint to the zero address`, `ERC721: token already minted`, `ERC721: invalid token ID`, etc.) so legacy tests and integrations continue to work.
- Direct transfers call back into `DcaManager.onPositionTransfer` to keep position tracking in sync.

## Executor

Keeper entry point enforcing guard rails before routing swaps.

### Key functions

| Function | Purpose |
| --- | --- |
| `execute(uint256 positionId)` | Executes a single position. |
| `batchExecute(uint256[] calldata positionIds)` | Batches multiple positions in one transaction. |
| `checkUpkeep(bytes calldata)` / `performUpkeep(bytes calldata)` | Chainlink Automation integration. |
| `executePublic(uint256 positionId)` | Public fallback after the grace period. Sends a small ETH tip when successful. |
| `calculateFees(uint256 positionId, uint256 notionalUsd)` | Returns `(protocolFee, executionFee)` using current protocol config. |
| `estimateSlippage(uint256 positionId, uint16 routeHint)` | Provides the stored slippage and a simple price impact estimate. |
| `selectRoute(uint256 positionId)` | Determines the venue and encoded routing data. |
| `validateOracleStaleness()` | Checks Chainlink freshness for the base asset. |
| `validateGasCaps(uint256 positionId)` | Ensures base/priority fee caps are satisfied. |

### Events

- `PositionExecuted(uint256 indexed positionId)`
- `ExecutionSkipped(uint256 indexed positionId, string reason)`
- `ExecutionDetails(uint256 indexed positionId, address indexed keeper, uint256 gasUsed, bytes routePath, int256 priceImpactBps, uint256 twapWindow, uint256 oracleTimestamp)`

## PriceOracle

Aggregates Chainlink feeds and optional Uniswap v3 TWAP sources.

### Initialization & administration

- `initialize(address admin)` – optional proxy initialiser; constructor calls `_initialize(msg.sender)` for convenience.
- `setFeed(address token, address feed)` – adds or updates a Chainlink aggregator.
- `registerUniswapPool(address token0, address token1, uint24 fee, address pool)` – stores TWAP pools (both directions).
- `setMaxStaleness(uint256 seconds)` – adjusts the freshness threshold (default 30 minutes).
- `configureAlias(bytes32 aliasKey, address token)` / `configureAliasString(string symbol, address token)` – maintain user-friendly lookup keys.
- `setReferencePrice(address token, uint256 price)` – seeds a reference price used to compute confidence levels.

### Read API

| Function | Description |
| --- | --- |
| `latestPrice(address token)` | Returns the latest Chainlink price (reverts if stale). |
| `latestPriceUnsafe(address token)` | Returns price + timestamp without enforcing staleness. |
| `twap(address tokenIn, address tokenOut, uint24 fee, uint32 window)` | Reads the configured Uniswap TWAP. |
| `isOracleFresh(address token)` | Boolean indicating whether the stored feed is within the staleness window. |
| `getDeviationBps(uint256 price1, uint256 price2)` | Helper for symmetric deviation calculations. |
| `getTokenPrice(address token)` | Returns `(price, updatedAt)` with staleness validation. |

All administrative entry points require the `ORACLE_ADMIN` role; the ABI test `oracle.abi.spec.ts` enforces the function list.

## Treasury

Timelocked fee sink that distributes protocol and referral earnings.

- Inherits `TimelockController` with a 2-day minimum delay in the reference deployment.
- Roles granted on deployment: proposer/executor to the multisig signers, `TREASURER_ROLE` and `FEE_COLLECTOR_ROLE` to both the timelock and the supplied admin.
- `initialize(FeeConfig config)` wires the initial percentages (protocol fee bps, execution fee floor, gas premium bps, fee collector, referral defaults, and whether referrals sit on top of the protocol fee). The shipped defaults are 30 bps (0.3%) protocol fee, 10 bps gas premium, and 50% referral share carved out of the protocol fee.
- `collectFees(address token, uint256 amount)` and `distributeFees(address[] recipients, uint256[] amounts, address token)` are guarded by `whenNotPaused`.
- `setProtocolFeeBps(uint16)`, `setReferralFeeBps(uint16)`, `setReferralFeeOnTop(bool)`, `setFeeCollector(address)`, and `setCustomReferralFee(address referrer, uint16 bps)` adjust fee splits. Referral rates remain percentages (0–100), and `setReferralFeeOnTop` toggles whether that percentage is carved out of or applied on top of the protocol fee.
- `calculateFees(address referrer, uint256 notionalUsd)` returns a `(protocolShare, referralShare)` breakdown for a given notional amount, respecting the `referralFeeOnTop` flag.
- `registerKeeperPayment` / `claimKeeperPayment` manage ETH incentives for executors.
- Emits `FeeCollected`, `FeeDistributed`, `ProtocolFeeUpdated`, `ReferralFeeUpdated`, `ReferralFeeModeUpdated`, `FeeCollectorUpdated`, `EmergencyWithdraw`, `KeeperPaymentRegistered`, `KeeperPaymentClaimed`, and `CustomReferralFeeSet`. The base `TimelockController` still emits `CallScheduled` / `CallExecuted`.

## Router adapters

All adapters implement the common `ITradeAdapter` interface:

```solidity
function swapExactTokens(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minAmountOut,
    address recipient
) external returns (uint256 amountOut);
```

### UniV3Adapter

- Wraps the Uniswap v3 router with helper structs for exact input swaps.
- Supports flashbots mode via `executeSwapWithFlashbots`.
- Maintains an internal registry of pools and exposes helpers: `registerPool`, `quote`, `checkLiquidity`, `getTWAP`, `getOptimalFeeTier`, and `adapterType`.

### CowAdapter

- Simulates CoW Protocol order submission for tests.
- Tracks orders in memory, supports partial fills, cancellation, and settlement through methods such as `createOrder`, `simulatePartialFill`, `settleOrder`, and `cancelOrder`.
- Implements the common `swapExactTokens` interface to match executor expectations.

### OneInchAdapter

- Emulates the 1inch aggregator with deterministic routing.
- Provides helpers: `swap`, `swapFallback`, `swapMultiHop`, `swapWithRetry`, `getOptimalRoute`, `getExpectedReturn`, and `supportsAssetPair`.
- `swapExactTokens` funnels through `_performSwap` so guard logic (slippage, approvals) remains centralised.

Each adapter exposes `adapterType()` so the executor can log the venue in `ExecutionDetails`.

## TypeScript bindings

Generate bindings via TypeChain: `pnpm --filter ./contracts typechain`.

Example usage:

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

The generated factories share the same types our ABI tests and documentation examples rely on, keeping integration friction low.
