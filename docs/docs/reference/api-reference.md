---
title: API Reference
sidebar_label: API Reference
description: Public contract APIs and key parameters for integrating with BitcoinDCA. All signatures originate from ABI tests in the repository.
---

# API Reference

This reference covers the primary smart contracts. Always verify against the generated ABIs in `contracts/artifacts/` after building.

## DcaManager

### Position lifecycle

| Signature | Description |
| --- | --- |
| `function createPosition(CreatePositionParams calldata params) external returns (uint256 positionId)` | Creates a new position, mints a `PositionNFT`, sets `nextExecAt`. |
| `function modify(uint256 positionId, ModifyParams calldata params) external` | Updates mutable guardrails and metadata. |
| `function pause(uint256 positionId) external` | Marks position as paused. |
| `function resume(uint256 positionId) external` | Clears pause flag and schedules next execution. |
| `function cancel(uint256 positionId) external` | Closes and refunds a position, burns the NFT. |
| `function emergencyWithdraw(uint256 positionId) external` | Initiates emergency withdrawal flow. |
| `function completeEmergencyWithdraw(uint256 positionId) external` | Final step after timelock delay. |

### Funds management

| Signature | Description |
| --- | --- |
| `function deposit(uint256 positionId, address token, uint256 amount) external` | Adds idle quote/base balance. |
| `function withdraw(uint256 positionId, address token, uint256 amount, address to) external` | Transfers funds to beneficiary or custom address. |

### Views

| Signature | Description |
| --- | --- |
| `function getPosition(uint256 positionId) external view returns (Position memory)` | Full position struct. |
| `function getPositionBalance(uint256 positionId) external view returns (uint256 quoteBal, uint256 baseBal)` | Idle balances. |
| `function getNextExecutionTime(uint256 positionId) external view returns (uint64)` | Scheduled timestamp. |
| `function isPositionEligible(uint256 positionId) external view returns (bool)` | Keeper-friendly eligibility check. |
| `function positionsByOwner(address owner) external view returns (uint256[] memory)` | Owned position IDs. |
| `function globalPauseState() external view returns (bool systemPaused, uint64 resumeAt)` | High-level pause signal. |

### Configuration

| Signature | Notes |
| --- | --- |
| `function setProtocolConfig(ProtocolConfig calldata config) external onlyRole(TREASURER_ROLE)` | Updates fees and collectors. |
| `function setCircuitBreakerConfig(CircuitBreakerConfig calldata config) external onlyRole(PAUSER_ROLE)` | Updates global limits. |
| `function setVenueConfig(uint16 venue, address adapter, VenueConfig calldata config) external onlyRole(ROUTER_ADMIN_ROLE)` | Whitelists/updates adapters. |
| `function setKeeperRegistry(address chainlinkRegistry, address gelatoRegistry) external onlyRole(KEEPER_ROLE)` | Points automation to current registries. |

## Executor

| Signature | Description |
| --- | --- |
| `function execute(uint256 positionId) external nonReentrant` | Executes a single position. |
| `function batchExecute(uint256[] calldata positionIds) external nonReentrant` | Batch execution. |
| `function simulate(uint256 positionId) external view returns (ExecutionResult memory)` | Deterministic simulation for keepers. |
| `function setKeeper(address keeper, bool allowed) external onlyRole(EXECUTOR_ROLE)` | Manage authorised keeper addresses. |

### Events

- `event ExecutionCompleted(uint256 indexed positionId, address indexed keeper);`
- `event ExecutionSkipped(uint256 indexed positionId, string reason);`
- `event ExecutionDetails(uint256 indexed positionId, address indexed keeper, uint256 gasUsed, bytes routePath, int256 priceImpactBps, uint256 twapWindow, uint256 oracleTimestamp);`

## PriceOracle

| Signature | Description |
| --- | --- |
| `function getQuoteUsd(address asset) external view returns (uint256 price, uint256 updatedAt)` | USD price from Chainlink feeds. |
| `function getTwap(address pool, uint32 window) external view returns (uint256 priceX96)` | Uniswap v3 TWAP calculation. |
| `function validatePrice(address base, address quote, uint32 window, uint16 deviationBps) external view returns (bool ok, uint256 referencePriceUsd, uint256 deviation)` | Combined guard logic used by executor. |
| `function setFeed(address asset, address feed) external onlyRole(ORACLE_ADMIN_ROLE)` | Update Chainlink aggregators. |

## Treasury

| Signature | Description |
| --- | --- |
| `function withdraw(address token, uint256 amount, address to) external onlyRole(TREASURER_ROLE)` | Disburse fees. |
| `function schedule(address target, uint256 value, bytes calldata data, bytes32 salt, uint256 delay) external onlyRole(TREASURER_ROLE)` | Timelock scheduling. |
| `function execute(address target, uint256 value, bytes calldata data, bytes32 salt) external onlyRole(TREASURER_ROLE)` | Finalise scheduled action. |

## Router adapters

| Adapter | Signature | Purpose |
| --- | --- | --- |
| `UniV3Adapter` | `swapExactInput(SwapParams calldata params)` | Executes exact-input swaps via Uniswap v3 pools. |
| `CowAdapter` | `placeOrder(CowOrder calldata order)` | Submits CoW Protocol orders and validates settlement. |
| `OneInchAdapter` | `executeAggregatorSwap(bytes calldata data)` | Executes prebuilt 1inch quotes. |

Adapters expose minimal state and revert with descriptive errors captured in `routerAdapters.abi.spec.ts`.

## PositionNFT

| Signature | Description |
| --- | --- |
| `function mint(address to, uint256 positionId) external` | Called by manager on create. |
| `function burn(uint256 tokenId) external` | Called by manager on cancel. |
| Standard ERC-721 functions (`ownerOf`, `transferFrom`, `safeTransferFrom`) remain available.

## Error catalogue

Common custom errors surfaced in tests and guard logic:

- `error PriceDeviationExceeded(uint256 deviationBps);`
- `error TwapWindowTooShort(uint32 provided, uint32 minimum);`
- `error PositionPaused(uint256 positionId);`
- `error InsufficientBalance(uint256 available, uint256 requested);`
- `error GasCapExceeded(uint64 baseFee, uint64 maxBaseFee);`
- `error DepegDetected(address quote, uint256 priceUsd);`
- `error ImmutableField();`

Use these constants in monitoring/alerting systems to provide actionable failure messages.
