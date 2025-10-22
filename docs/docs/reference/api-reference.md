---
title: API Reference
sidebar_label: API Reference
description: Public contract APIs and key parameters for integrating with DCA Crypto. All signatures originate from ABI tests in the repository.
---

# API Reference

Use this guide when interacting with the contracts directly or generating client bindings. Every signature listed below is enforced by the ABI tests under `contracts/test/*.abi.spec.ts`.

## DcaManager

### Lifecycle

| Signature | Description |
| --- | --- |
| `function initialize(address positionNFT, address positionStorage, address priceOracle, address treasury, address baseAsset) external initializer` | Proxy initialiser. Grants roles to the caller and stores contract addresses. |
| `function createPosition(CreatePositionParams calldata params) external returns (uint256 positionId)` | Creates a new strategy, mints the NFT, schedules the first execution. |
| `function modify(uint256 positionId, ModifyPositionParams calldata params) external` | Updates mutable guards, beneficiaries, venue preference, and MEV flag. |
| `function pause(uint256 positionId) external` / `function resume(uint256 positionId) external` | Toggles the execution flag. |
| `function cancel(uint256 positionId) external` | Cancels a position, burns the NFT, and stops future executions. |
| `function emergencyWithdraw(uint256 positionId) external` | First call arms the delay. After the unlock timestamp the same function releases funds and cancels the position. |

### Funds management

| Signature | Description |
| --- | --- |
| `function deposit(uint256 positionId, address token, uint256 amount) external` | Adds idle balances for upcoming executions. |
| `function withdraw(uint256 positionId, address token, uint256 amount, address to) external` | Withdraws idle balances to the beneficiary or a custom address. |

### Views

| Signature | Description |
| --- | --- |
| `function getPosition(uint256 positionId) external view returns (Position memory)` | Full position struct. |
| `function getPositionBalance(uint256 positionId, address token) external view returns (uint256)` | Idle balance for the given token (quote for BUY, base for SELL). |
| `function getNextExecutionTime(uint256 positionId) external view returns (uint64)` | Timestamp used by keepers and UI. |
| `function isPositionEligible(uint256 positionId) external view returns (bool eligible, string memory reason)` | Keeper-friendly eligibility check. |
| `function positionsByOwner(address owner) external view returns (uint256[] memory)` | Enumerates owned IDs. |
| `function globalPauseState() external view returns (GlobalPauseState memory)` | Returns `GlobalPauseState({ allPaused: bool })`. |

### Configuration

| Signature | Notes |
| --- | --- |
| `function setProtocolConfig(ProtocolConfig calldata config) external onlyRole(Roles.TREASURER)` | Adjusts protocol fee %, execution fee floor, gas premium %, fee collector, referral default. |
| `function setCircuitBreakerConfig(uint256 dailyLimitUsd, uint16 priceMovementBps) external onlyRole(Roles.PAUSER)` | Updates the global daily volume limit and price movement guard. |
| `function setVenueConfig(uint16 venue, address adapter) external onlyRole(Roles.ROUTER_ADMIN)` | Registers or updates the adapter for a venue enum value. |
| `function setKeeperRegistry(address chainlinkRegistry, address gelatoRegistry) external onlyRole(Roles.KEEPER)` | Updates automation registries. |
| `function setQuoteTokenAllowed(address token, bool allowed) external onlyRole(Roles.DEFAULT_ADMIN)` | Adds/removes quote tokens. |

## Executor

| Signature | Description |
| --- | --- |
| `function execute(uint256 positionId) external onlyRole(Roles.EXECUTOR) whenNotPaused returns (bool success)` | Executes a single position. |
| `function batchExecute(uint256[] calldata positionIds) external onlyRole(Roles.EXECUTOR) whenNotPaused returns (ExecutionResult[] memory results)` | Executes multiple positions. |
| `function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData)` | Chainlink Automation check. |
| `function performUpkeep(bytes calldata performData) external onlyRole(Roles.KEEPER) whenNotPaused` | Chainlink Automation callback. |
| `function executePublic(uint256 positionId) external whenNotPaused returns (bool success)` | Public execution path after the grace period. |
| `function calculateFees(uint256 positionId, uint256 notionalUsd) external view returns (uint256 protocolFee, uint256 executionFee)` | Helper for UI/monitoring. |
| `function estimateSlippage(uint256 positionId, uint16 routeHint) external view returns (uint256 slippageBps, uint256 priceImpact)` | Provides guardrails used by dashboards. |
| `function selectRoute(uint256 positionId) external view returns (uint16 venue, bytes memory routeData)` | Exposes routing decision for analytics. |

Events: `PositionExecuted(uint256 indexed positionId)`, `ExecutionSkipped(uint256 indexed positionId, string reason)`, `ExecutionDetails(...)`.

## PriceOracle

| Signature | Description |
| --- | --- |
| `function initialize(address admin) external initializer` | Optional proxy initialiser (constructor already sets the deployer). |
| `function setFeed(address token, address feed) external onlyRole(Roles.ORACLE_ADMIN)` | Adds or updates a Chainlink feed. |
| `function registerUniswapPool(address token0, address token1, uint24 fee, address pool) external onlyRole(Roles.ORACLE_ADMIN)` | Stores UniV3 pools for TWAP sources. |
| `function setMaxStaleness(uint256 newMaxStaleness) external onlyRole(Roles.ORACLE_ADMIN)` | Adjusts staleness threshold. |
| `function configureAlias(bytes32 aliasKey, address token) external onlyRole(Roles.ORACLE_ADMIN)` | Adds symbol→token mappings. |
| `function setReferencePrice(address token, uint256 price) external onlyRole(Roles.ORACLE_ADMIN)` | Seeds reference prices used in confidence scoring. |
| `function latestPrice(address token) external view returns (uint256 price)` | Returns the latest Chainlink price (reverts if stale). |
| `function latestPriceUnsafe(address token) external view returns (uint256 price, uint256 updatedAt)` | Same as above without the staleness check. |
| `function twap(address tokenIn, address tokenOut, uint24 fee, uint32 window) external view returns (uint256)` | Returns the configured TWAP. |
| `function isOracleFresh(address token) external view returns (bool)` | Convenience wrapper around the staleness check. |
| `function getDeviationBps(uint256 price1, uint256 price2) external pure returns (uint256 deviationBps)` | Symmetric deviation helper. |

## Treasury

All treasury actions are subject to the `TimelockController` delay unless otherwise noted.

| Signature | Description |
| --- | --- |
| `function initialize(FeeConfig calldata config) external` | One-off initialiser (reverts if called twice). Referral fields are percentages (0–100). |
| `function collectFees(address token, uint256 amount) external whenNotPaused onlyRole(FEE_COLLECTOR_ROLE)` | Pulls protocol fees into the timelock. |
| `function distributeFees(address[] calldata recipients, uint256[] calldata amounts, address token) external whenNotPaused onlyRole(TREASURER_ROLE)` | Distributes ERC-20 balances, emitting `FeeDistributed`. |
| `function withdraw(address token, uint256 amount, address to) external onlyRole(TREASURER_ROLE)` | Direct withdrawal (also available via timelock scheduling). |
| `function pauseContract() external onlyRole(PAUSER_ROLE)` / `function unpauseContract() external onlyRole(PAUSER_ROLE)` | Emergency stop for fee collection/distribution. |
| `function registerKeeperPayment(address keeper, uint256 amount) external onlyRole(TREASURER_ROLE)` | Accrues ETH incentives. |
| `function claimKeeperPayment() external` | Claim accrued ETH incentive. |
| `function setProtocolFeeBps(uint16 newBps) external onlyRole(TREASURER_ROLE)` | Updates protocol fee percentage (0–100). |
| `function setReferralFeeBps(uint16 newBps) external onlyRole(TREASURER_ROLE)` | Updates default referral percentage (0–100). |
| `function setReferralFeeOnTop(bool onTop) external onlyRole(TREASURER_ROLE)` | Toggles whether referral rewards are applied on top of (vs carved out of) the protocol fee. |
| `function setFeeCollector(address newCollector) external onlyRole(TREASURER_ROLE)` | Updates fee collector and role membership. |
| `function setCustomReferralFee(address referrer, uint16 bps) external onlyRole(TREASURER_ROLE)` | Overrides referral percentage (0–100). |
| `function calculateFees(address referrer, uint256 notionalUsd) external view returns (uint256 protocolShare, uint256 referralShare)` | Utility view that returns the protocol net share and referral reward for a notional amount. |

## Router adapters

All adapters share the following core function:

`function swapExactTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) external returns (uint256 amountOut);`

| Adapter | Additional helpers | Notes |
| --- | --- | --- |
| `UniV3Adapter` | `registerPool`, `executeSwap`, `executeSwapWithFlashbots`, `batchSwap`, `quote`, `checkLiquidity`, `getTWAP`, `getOptimalFeeTier`, `adapterType` | Wraps the Uniswap v3 router with deterministic quoting. |
| `CowAdapter` | `createOrder`, `cancelOrder`, `settleOrder`, `simulatePartialFill`, `adapterType` | Mimics CoW Protocol settlement and partial-fill logic. |
| `OneInchAdapter` | `swap`, `swapMultiHop`, `swapFallback`, `swapWithRetry`, `getOptimalRoute`, `getExpectedReturn`, `supportsAssetPair`, `adapterType` | Deterministic 1inch-style aggregator with multi-DEX distribution. |

The `RouterManager` exposes `addRouterAdapter(uint16 venue, address adapter)`, `updateRouterAdapter`, `removeRouterAdapter`, `getAdapter(uint16 venue)`, and `registeredVenues()` to maintain the mapping.

## PositionNFT

| Signature | Description |
| --- | --- |
| `function initialize(string memory name_, string memory symbol_, address positionStorage_) external initializer` | UUPS initialiser. |
| `function setManager(address manager_) external onlyRole(DEFAULT_ADMIN_ROLE)` | Registers `DcaManager` as the transfer hook. |
| `function mint(address to, uint256 tokenId) external onlyRole(MINTER_ROLE)` | Mints the NFT; reverts on zero address or existing ID. |
| `function burn(uint256 tokenId) external onlyRole(BURNER_ROLE)` | Burns an existing token. |
| `function setBaseURI(string memory newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE)` | Updates the base metadata URI. |
| `function setTokenURI(uint256 tokenId, string calldata tokenURI_) external onlyRole(METADATA_ROLE)` | Stores a token-specific URI override. |

Standard ERC-721 read/transfer functions are available and preserve the legacy revert messages asserted in the unit tests.

## Common revert messages

The test suite validates the following core revert strings and custom errors. Use them for monitoring and integration debugging.

- `AccessControl: account … is missing role …`
- `Initializable: contract is already initialized`
- `Treasury: referral fee too high`
- `Pausable: paused`
- `ERC721: mint to the zero address`
- `ERC721: token already minted`
- `ERC721: invalid token ID`
- Custom errors from `DcaManager` (`PositionNotFound()`, `QuoteTokenNotAllowed()`, `MaxPositionsPerUserExceeded()`, etc.) are listed in `contracts/contracts/core/DcaManager.sol`.
