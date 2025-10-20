// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Roles} from "../libraries/Roles.sol";

interface IPositionNFT {
    function mint(address to, uint256 tokenId) external;
    function burn(uint256 tokenId) external;
}

interface IPositionStorage {
    struct Metadata {
        address owner;
        address beneficiary;
        address quote;
        bool isBuy;
        uint16 frequency;
        uint16 venue;
        uint16 slippageBps;
        uint128 amountPerPeriod;
        uint64 startAt;
        uint64 endAt;
    }

    function setPositionMetadata(uint256 positionId, Metadata calldata metadata) external;
    function removePositionMetadata(uint256 positionId) external;
}

interface IPriceOracle {
    function getTokenPrice(address token) external view returns (uint256 price, uint256 updatedAt);
}

/**
 * @title DcaManager
 * @notice Core position lifecycle manager for the Bitcoin DCA MVP. Manages deposits, withdrawals,
 *         execution guard rails, and coordination with PositionNFT ownership.
 */
contract DcaManager is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 private constant USD_DECIMALS = 6;
    uint256 private constant ORACLE_DECIMALS = 8;

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------
    error PositionNotFound();
    error QuoteTokenNotAllowed();
    error NotOwner();
    error NotBeneficiary();
    error InvalidAmount();
    error MaxPositionsPerUserExceeded();
    error MaxGlobalPositionsExceeded();
    error SlippageTooHigh();
    error PositionAlreadyPaused();
    error PositionNotPaused();
    error PositionAlreadyCanceled();
    error EmergencyDelayPending(uint256 unlockAt);
    error ExecNonceMismatch(uint64 expected, uint64 actual);
    error TransferNotAllowed();
    error UnauthorizedSender();
    error InsufficientQuoteBalance();
    error InsufficientBaseBalance();
    error InvalidParameter();

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------
    event PositionCreated(
        uint256 indexed positionId,
        address indexed owner,
        CreatePositionParams params
    );
    event PositionModified(uint256 indexed positionId, ModifyPositionParams params);
    event PositionSlippageUpdated(uint256 indexed positionId, uint16 oldValue, uint16 newValue);
    event PositionVenueUpdated(uint256 indexed positionId, uint16 oldValue, uint16 newValue);
    event PositionGasCapsUpdated(uint256 indexed positionId, uint64 maxBaseFeeWei, uint64 maxPriorityFeeWei);
    event PositionPriceGuardsUpdated(uint256 indexed positionId, uint128 priceFloorUsd, uint128 priceCapUsd);
    event PositionBeneficiaryUpdated(uint256 indexed positionId, address oldBeneficiary, address newBeneficiary);
    event PositionPaused(uint256 indexed positionId);
    event PositionResumed(uint256 indexed positionId);
    event PositionCanceled(uint256 indexed positionId);
    event PositionExecuted(
        uint256 indexed positionId,
        uint256 quoteUsed,
        uint256 baseUsed,
        uint256 quoteReceived,
        uint256 baseReceived,
        uint64 nextExecAt
    );
    event Deposited(uint256 indexed positionId, address indexed token, uint256 amount);
    event Withdrawn(uint256 indexed positionId, address indexed token, uint256 amount, address indexed to);
    event ProtocolConfigUpdated(ProtocolConfig config);
    event KeeperRegistryUpdated(address chainlinkRegistry, address gelatoRegistry);
    event VenueConfigUpdated(uint16 venue, address adapter);
    event ExecNonceBumped(uint256 indexed positionId, uint64 oldNonce, uint64 newNonce);
    event QuoteTokenAllowed(address indexed token, bool allowed);
    event EmergencyWithdrawn(
        uint256 indexed positionId,
        address indexed to,
        uint256 quoteAmount,
        uint256 baseAmount
    );
    event ActivePositionsReconciled(uint256 oldCount, uint256 newCount);

    // -----------------------------------------------------------------------
    // Structs
    // -----------------------------------------------------------------------

    struct CreatePositionParams {
        address owner;
        address beneficiary;
        address quoteToken;
        bool isBuy;
        uint16 frequency;
        uint16 venue;
        uint16 slippageBps;
        uint32 twapWindow;
        uint16 maxPriceDeviationBps;
        uint64 startAt;
        uint64 endAt;
        uint128 amountPerPeriod;
        uint128 priceFloorUsd;
        uint128 priceCapUsd;
        uint64 maxBaseFeeWei;
        uint64 maxPriorityFeeWei;
        bool mevProtection;
    }

    struct ModifyPositionParams {
        uint16 slippageBps;
        uint16 venue;
        uint64 maxBaseFeeWei;
        uint64 maxPriorityFeeWei;
        uint128 priceFloorUsd;
        uint128 priceCapUsd;
        address beneficiary;
        bool mevProtection;
    }

    struct ProtocolConfig {
        uint16 protocolFeeBps;
        uint256 executionFeeFixedWei;
        uint16 gasPremiumBps;
        address feeCollector;
        uint16 referralFeeBpsDefault;
    }

    struct Position {
        address owner;
        address beneficiary;
        address quoteToken;
        address baseToken;
        uint128 amountPerPeriod;
        uint128 priceFloorUsd;
        uint128 priceCapUsd;
        uint64 nextExecAt;
        uint64 startAt;
        uint64 endAt;
        uint64 pausedAt;
        uint64 emergencyUnlockAt;
        uint64 execNonce;
        uint32 periodsExecuted;
        uint32 twapWindow;
        uint16 frequency;
        uint16 venue;
        uint16 slippageBps;
        uint16 maxPriceDeviationBps;
        uint64 maxBaseFeeWei;
        uint64 maxPriorityFeeWei;
        uint8 quoteDecimals;
        uint8 baseDecimals;
        bool isBuy;
        bool paused;
        bool canceled;
        bool mevProtection;
        bool exists;
    }

    struct GlobalPauseState {
        bool allPaused;
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    IPositionNFT public positionNFT;
    IPositionStorage public positionStorage;
    IPriceOracle public priceOracle;
    address public treasury;
    address public baseAsset;

    ProtocolConfig public protocolConfig;

    uint256 public nextPositionId;
    uint256 public maxPositionsPerUser;
    uint256 public maxGlobalPositions;
    uint256 public minPositionSizeUsd;
    uint256 public dailyVolumeLimitUsd;
    uint16 public maxPriceMovementBps;
    uint16 public maxSlippageBps;
    uint64 public emergencyDelay;
    uint8 public baseAssetDecimals;

    uint256 public activeGlobalPositions;

    address public chainlinkKeeperRegistry;
    address public gelatoKeeperRegistry;

    mapping(uint256 => Position) private _positions;
    mapping(uint256 => uint256) private _quoteBalances;
    mapping(uint256 => uint256) private _baseBalances;
    mapping(address => uint256[]) private _ownerPositions;
    mapping(address => mapping(uint256 => uint256)) private _ownerPositionIndex; // index + 1
    mapping(address => uint256) public userPositionCount;
    mapping(address => bool) public allowedQuoteTokens;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    function initialize(
        address positionNFT_,
        address positionStorage_,
        address priceOracle_,
        address treasury_,
        address baseAsset_
    ) external initializer {
        require(positionNFT_ != address(0), "Invalid PositionNFT");
        require(positionStorage_ != address(0), "Invalid storage");
        require(priceOracle_ != address(0), "Invalid oracle");
        require(treasury_ != address(0), "Invalid treasury");
        require(baseAsset_ != address(0), "Invalid base asset");

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.PAUSER, msg.sender);
        _grantRole(Roles.EXECUTOR, msg.sender);
        _grantRole(Roles.KEEPER, msg.sender);
        _grantRole(Roles.ROUTER_ADMIN, msg.sender);
        _grantRole(Roles.ORACLE_ADMIN, msg.sender);
        _grantRole(Roles.TREASURER, msg.sender);

        positionNFT = IPositionNFT(positionNFT_);
        positionStorage = IPositionStorage(positionStorage_);
        priceOracle = IPriceOracle(priceOracle_);
        treasury = treasury_;
        baseAsset = baseAsset_;
        baseAssetDecimals = IERC20Metadata(baseAsset_).decimals();

        maxPositionsPerUser = 10;
        maxGlobalPositions = 10_000;
        minPositionSizeUsd = 100e6; // $100 with 6 decimals
        dailyVolumeLimitUsd = 10_000_000e6; // $10M
        maxPriceMovementBps = 2000; // 20%
        maxSlippageBps = 500; // 5%
        emergencyDelay = 2 days;
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyPositionOwner(uint256 positionId) {
        Position storage position = _positions[positionId];
        if (!position.exists) revert PositionNotFound();
        if (position.owner != msg.sender) revert NotOwner();
        _;
    }

    modifier onlyPositionNFT() {
        if (msg.sender != address(positionNFT)) revert UnauthorizedSender();
        _;
    }

    // -----------------------------------------------------------------------
    // Position Lifecycle
    // -----------------------------------------------------------------------

    function createPosition(CreatePositionParams calldata params)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 positionId)
    {
        if (!allowedQuoteTokens[params.quoteToken]) revert QuoteTokenNotAllowed();
        if (params.owner != msg.sender) revert NotOwner();
        if (params.slippageBps > maxSlippageBps) revert SlippageTooHigh();
        if (params.startAt <= block.timestamp) revert InvalidParameter();
        if (params.endAt != 0 && params.endAt <= params.startAt) revert InvalidParameter();
        if (userPositionCount[params.owner] >= maxPositionsPerUser) revert MaxPositionsPerUserExceeded();
        if (activeGlobalPositions >= maxGlobalPositions) revert MaxGlobalPositionsExceeded();

        positionId = ++nextPositionId;

        Position storage position = _positions[positionId];
        position.owner = params.owner;
        position.beneficiary = params.beneficiary == address(0) ? params.owner : params.beneficiary;
        position.quoteToken = params.quoteToken;
        position.baseToken = baseAsset;
        position.amountPerPeriod = params.amountPerPeriod;
        position.priceFloorUsd = params.priceFloorUsd;
        position.priceCapUsd = params.priceCapUsd;
        position.nextExecAt = params.startAt;
        position.startAt = params.startAt;
        position.endAt = params.endAt;
        position.periodsExecuted = 0;
        position.twapWindow = params.twapWindow;
        position.frequency = params.frequency;
        position.venue = params.venue;
        position.slippageBps = params.slippageBps;
        position.maxPriceDeviationBps = params.maxPriceDeviationBps;
        position.maxBaseFeeWei = params.maxBaseFeeWei;
        position.maxPriorityFeeWei = params.maxPriorityFeeWei;
        position.isBuy = params.isBuy;
        position.mevProtection = params.mevProtection;
        position.execNonce = 1;
        position.quoteDecimals = IERC20Metadata(params.quoteToken).decimals();
        position.baseDecimals = baseAssetDecimals;
        position.exists = true;
        position.paused = false;
        position.canceled = false;
        position.pausedAt = 0;
        position.emergencyUnlockAt = 0;

        _enforceMinimumSize(position, params.amountPerPeriod);

        _persistMetadata(positionId);

        // Add position to owner tracking arrays
        _ownerPositions[params.owner].push(positionId);
        _ownerPositionIndex[params.owner][positionId] = _ownerPositions[params.owner].length;
        userPositionCount[params.owner] += 1;

        positionNFT.mint(params.owner, positionId);
        activeGlobalPositions += 1;

        emit PositionCreated(positionId, params.owner, params);
    }

    function modify(uint256 positionId, ModifyPositionParams calldata params)
        external
        whenNotPaused
        nonReentrant
        onlyPositionOwner(positionId)
    {
        Position storage position = _positions[positionId];
        if (position.canceled) revert PositionAlreadyCanceled();

        if (params.slippageBps > maxSlippageBps) revert SlippageTooHigh();

        if (params.beneficiary != address(0) && params.beneficiary != position.beneficiary) {
            address oldBeneficiary = position.beneficiary;
            position.beneficiary = params.beneficiary;
            emit PositionBeneficiaryUpdated(positionId, oldBeneficiary, params.beneficiary);
        }

        if (params.slippageBps != position.slippageBps) {
            uint16 oldSlippage = position.slippageBps;
            position.slippageBps = params.slippageBps;
            emit PositionSlippageUpdated(positionId, oldSlippage, params.slippageBps);
        }

        if (params.venue != position.venue) {
            uint16 oldVenue = position.venue;
            position.venue = params.venue;
            emit PositionVenueUpdated(positionId, oldVenue, params.venue);
        }

        if (
            params.maxBaseFeeWei != position.maxBaseFeeWei ||
            params.maxPriorityFeeWei != position.maxPriorityFeeWei
        ) {
            position.maxBaseFeeWei = params.maxBaseFeeWei;
            position.maxPriorityFeeWei = params.maxPriorityFeeWei;
            emit PositionGasCapsUpdated(positionId, params.maxBaseFeeWei, params.maxPriorityFeeWei);
        }

        if (
            params.priceFloorUsd != position.priceFloorUsd ||
            params.priceCapUsd != position.priceCapUsd
        ) {
            position.priceFloorUsd = params.priceFloorUsd;
            position.priceCapUsd = params.priceCapUsd;
            emit PositionPriceGuardsUpdated(positionId, params.priceFloorUsd, params.priceCapUsd);
        }

        position.mevProtection = params.mevProtection;

        _persistMetadata(positionId);
        emit PositionModified(positionId, params);
        _bumpExecNonce(positionId, position);
    }

    function pause(uint256 positionId)
        external
        nonReentrant
        onlyPositionOwner(positionId)
    {
        Position storage position = _positions[positionId];
        if (position.canceled) revert PositionAlreadyCanceled();
        if (position.paused) revert PositionAlreadyPaused();

        position.paused = true;
        position.pausedAt = uint64(block.timestamp);
        position.emergencyUnlockAt = uint64(block.timestamp + emergencyDelay);

        emit PositionPaused(positionId);
        _bumpExecNonce(positionId, position);
    }

    function resume(uint256 positionId)
        external
        whenNotPaused
        nonReentrant
        onlyPositionOwner(positionId)
    {
        Position storage position = _positions[positionId];
        if (position.canceled) revert PositionAlreadyCanceled();
        if (!position.paused) revert PositionNotPaused();

        position.paused = false;
        position.pausedAt = 0;
        // Don't reset emergencyUnlockAt to prevent delay manipulation
        // Once emergency delay starts, it persists until emergency withdrawal
        // position.emergencyUnlockAt = 0;

        emit PositionResumed(positionId);
        _bumpExecNonce(positionId, position);
    }

    function cancel(uint256 positionId)
        external
        nonReentrant
        onlyPositionOwner(positionId)
    {
        Position storage position = _positions[positionId];
        if (position.canceled) revert PositionAlreadyCanceled();

        position.paused = true;
        position.canceled = true;
        position.pausedAt = uint64(block.timestamp);
        position.emergencyUnlockAt = 0;
        position.nextExecAt = 0;
        position.endAt = uint64(block.timestamp);

        emit PositionCanceled(positionId);
        _bumpExecNonce(positionId, position);

        if (activeGlobalPositions > 0) {
            activeGlobalPositions -= 1;
        }

        positionNFT.burn(positionId);
        positionStorage.removePositionMetadata(positionId);
    }

    function emergencyWithdraw(uint256 positionId)
        external
        nonReentrant
        onlyPositionOwner(positionId)
    {
        Position storage position = _positions[positionId];
        if (!position.paused) revert PositionNotPaused();
        if (position.canceled) revert PositionAlreadyCanceled();

        uint256 unlockAt = position.emergencyUnlockAt;
        if (unlockAt == 0) {
            position.emergencyUnlockAt = uint64(block.timestamp + emergencyDelay);
            _bumpExecNonce(positionId, position);
            revert EmergencyDelayPending(position.emergencyUnlockAt);
        }

        if (block.timestamp < unlockAt) revert EmergencyDelayPending(unlockAt);

        uint256 quoteBal = _quoteBalances[positionId];
        uint256 baseBal = _baseBalances[positionId];

        if (quoteBal > 0) {
            _quoteBalances[positionId] = 0;
            IERC20(position.quoteToken).safeTransfer(position.owner, quoteBal);
        }
        if (baseBal > 0) {
            _baseBalances[positionId] = 0;
            IERC20(position.baseToken).safeTransfer(position.owner, baseBal);
        }

        emit EmergencyWithdrawn(positionId, position.owner, quoteBal, baseBal);

        position.paused = true;
        position.canceled = true;
        position.nextExecAt = 0;
        position.endAt = uint64(block.timestamp);

        _bumpExecNonce(positionId, position);

        if (activeGlobalPositions > 0) {
            activeGlobalPositions -= 1;
        }

        positionNFT.burn(positionId);
        positionStorage.removePositionMetadata(positionId);
    }

    // -----------------------------------------------------------------------
    // Funds Management
    // -----------------------------------------------------------------------

    function deposit(uint256 positionId, address token, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        onlyPositionOwner(positionId)
    {
        if (amount == 0) revert InvalidAmount();

        Position storage position = _positions[positionId];
        if (token == position.quoteToken) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            _quoteBalances[positionId] += amount;
        } else if (token == position.baseToken) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            _baseBalances[positionId] += amount;
        } else {
            revert QuoteTokenNotAllowed();
        }

        emit Deposited(positionId, token, amount);
    }

    function withdraw(uint256 positionId, address token, uint256 amount, address to)
        external
        nonReentrant
    {
        Position storage position = _positions[positionId];
        if (!position.exists) revert PositionNotFound();
        if (to == address(0)) revert InvalidParameter();

        bool isOwner = msg.sender == position.owner;
        bool isBeneficiary = msg.sender == position.beneficiary;

        if (token == position.quoteToken) {
            if (!isOwner) revert NotOwner();
            if (_quoteBalances[positionId] < amount) revert InsufficientQuoteBalance();
            _quoteBalances[positionId] -= amount;
            IERC20(token).safeTransfer(to, amount);
        } else if (token == position.baseToken) {
            if (!isOwner && !isBeneficiary) revert NotBeneficiary();
            if (_baseBalances[positionId] < amount) revert InsufficientBaseBalance();
            _baseBalances[positionId] -= amount;
            IERC20(token).safeTransfer(to, amount);
        } else {
            revert QuoteTokenNotAllowed();
        }

        emit Withdrawn(positionId, token, amount, to);
    }

    // -----------------------------------------------------------------------
    // Executor Hooks
    // -----------------------------------------------------------------------

    function executorTransferTo(uint256 positionId, address token, uint256 amount, address to)
        external
        onlyRole(Roles.EXECUTOR)
        nonReentrant
    {
        if (to == address(0)) revert InvalidParameter();
        Position storage position = _positions[positionId];
        if (!position.exists) revert PositionNotFound();

        if (token == position.quoteToken) {
            if (_quoteBalances[positionId] < amount) revert InsufficientQuoteBalance();
        } else if (token == position.baseToken) {
            if (_baseBalances[positionId] < amount) revert InsufficientBaseBalance();
        } else {
            revert QuoteTokenNotAllowed();
        }

        IERC20(token).safeTransfer(to, amount);
    }

    function onFill(
        uint256 positionId,
        uint256 quoteUsed,
        uint256 baseUsed,
        uint256 quoteReceived,
        uint256 baseReceived,
        uint64 nextExecAt,
        uint64 expectedNonce
    ) external onlyRole(Roles.EXECUTOR) nonReentrant {
        Position storage position = _positions[positionId];
        if (!position.exists) revert PositionNotFound();
        if (position.execNonce != expectedNonce) revert ExecNonceMismatch(position.execNonce, expectedNonce);
        if (position.canceled) revert PositionAlreadyCanceled();

        if (quoteUsed > 0) {
            if (_quoteBalances[positionId] < quoteUsed) revert InsufficientQuoteBalance();
            _quoteBalances[positionId] -= quoteUsed;
        }
        if (baseUsed > 0) {
            if (_baseBalances[positionId] < baseUsed) revert InsufficientBaseBalance();
            _baseBalances[positionId] -= baseUsed;
        }
        if (quoteReceived > 0) {
            _quoteBalances[positionId] += quoteReceived;
        }
        if (baseReceived > 0) {
            _baseBalances[positionId] += baseReceived;
        }

        position.nextExecAt = nextExecAt;
        position.periodsExecuted += 1;

        emit PositionExecuted(
            positionId,
            quoteUsed,
            baseUsed,
            quoteReceived,
            baseReceived,
            nextExecAt
        );

        _bumpExecNonce(positionId, position);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function getPosition(uint256 positionId) external view returns (Position memory) {
        if (!_positions[positionId].exists) revert PositionNotFound();
        return _positions[positionId];
    }

    function getPositionBalance(uint256 positionId, address token) external view returns (uint256) {
        if (!_positions[positionId].exists) revert PositionNotFound();
        if (token == _positions[positionId].quoteToken) {
            return _quoteBalances[positionId];
        }
        if (token == _positions[positionId].baseToken) {
            return _baseBalances[positionId];
        }
        return 0;
    }

    function positionsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownerPositions[owner];
    }

    function positionExecNonce(uint256 positionId) external view returns (uint64) {
        if (!_positions[positionId].exists) revert PositionNotFound();
        return _positions[positionId].execNonce;
    }

    function isPositionEligible(uint256 positionId) external view returns (bool eligible, string memory reason) {
        Position storage position = _positions[positionId];
        if (!position.exists) return (false, "Position does not exist");
        if (paused()) return (false, "System paused");
        if (position.canceled) return (false, "Position canceled");
        if (position.paused) return (false, "Position paused");
        if (block.timestamp < position.nextExecAt) return (false, "Start time not reached");
        if (position.endAt != 0 && block.timestamp > position.endAt) return (false, "Position expired");

        if (position.isBuy) {
            if (_quoteBalances[positionId] < position.amountPerPeriod) {
                return (false, "Insufficient balance");
            }
        } else {
            if (_baseBalances[positionId] < position.amountPerPeriod) {
                return (false, "Insufficient balance");
            }
        }

        return (true, "");
    }

    function getNextExecutionTime(uint256 positionId) external view returns (uint64) {
        if (!_positions[positionId].exists) revert PositionNotFound();
        return _positions[positionId].nextExecAt;
    }

    function globalPauseState() external view returns (GlobalPauseState memory) {
        return GlobalPauseState({allPaused: paused()});
    }

    // -----------------------------------------------------------------------
    // Administration
    // -----------------------------------------------------------------------

    function setProtocolConfig(ProtocolConfig calldata config) external onlyRole(Roles.TREASURER) {
        require(config.feeCollector != address(0), "Invalid collector");
        protocolConfig = config;
        emit ProtocolConfigUpdated(config);
    }

    function setVenueConfig(uint16 venue, address adapter) external onlyRole(Roles.ROUTER_ADMIN) {
        emit VenueConfigUpdated(venue, adapter);
    }

    function setCircuitBreakerConfig(uint256 dailyLimitUsd, uint16 priceMovementBps)
        external
        onlyRole(Roles.PAUSER)
    {
        dailyVolumeLimitUsd = dailyLimitUsd;
        maxPriceMovementBps = priceMovementBps;
    }

    function setKeeperRegistry(address chainlinkRegistry, address gelatoRegistry)
        external
        onlyRole(Roles.KEEPER)
    {
        chainlinkKeeperRegistry = chainlinkRegistry;
        gelatoKeeperRegistry = gelatoRegistry;
        emit KeeperRegistryUpdated(chainlinkRegistry, gelatoRegistry);
    }

    function pauseAll() external onlyRole(Roles.PAUSER) {
        _pause();
    }

    function unpauseAll() external onlyRole(Roles.PAUSER) {
        _unpause();
    }

    function setMaxPositionsPerUser(uint256 newLimit) external onlyRole(Roles.DEFAULT_ADMIN) {
        maxPositionsPerUser = newLimit;
    }

    function setMaxGlobalPositions(uint256 newLimit) external onlyRole(Roles.DEFAULT_ADMIN) {
        maxGlobalPositions = newLimit;
    }

    function setMinPositionSizeUsd(uint256 newMinimum) external onlyRole(Roles.DEFAULT_ADMIN) {
        minPositionSizeUsd = newMinimum;
    }

    function setDailyVolumeLimitUsd(uint256 newLimit) external onlyRole(Roles.DEFAULT_ADMIN) {
        dailyVolumeLimitUsd = newLimit;
    }

    function setMaxPriceMovementBps(uint16 newLimit) external onlyRole(Roles.DEFAULT_ADMIN) {
        maxPriceMovementBps = newLimit;
    }

    function setEmergencyDelay(uint64 newDelay) external onlyRole(Roles.DEFAULT_ADMIN) {
        emergencyDelay = newDelay;
    }

    function setQuoteTokenAllowed(address token, bool allowed) external onlyRole(Roles.DEFAULT_ADMIN) {
        allowedQuoteTokens[token] = allowed;
        emit QuoteTokenAllowed(token, allowed);
    }

    function reconcileActivePositions(uint256 newCount) external onlyRole(Roles.DEFAULT_ADMIN) {
        // Admin function to fix activeGlobalPositions drift caused by expired positions
        // Should only be used after careful off-chain calculation of actual active positions
        uint256 oldCount = activeGlobalPositions;
        activeGlobalPositions = newCount;
        emit ActivePositionsReconciled(oldCount, newCount);
    }

    // -----------------------------------------------------------------------
    // NFT Transfer Hook
    // -----------------------------------------------------------------------

    function onPositionTransfer(uint256 positionId, address from, address to) external onlyPositionNFT {
        Position storage position = _positions[positionId];
        if (!position.exists) revert PositionNotFound();

        if (from != address(0)) {
            _removeOwnerPosition(from, positionId);
            if (userPositionCount[from] > 0) {
                userPositionCount[from] -= 1;
            }
        }

        if (to == address(0)) {
            return;
        }

        if (from != address(0) && !position.paused) {
            revert TransferNotAllowed();
        }

        if (userPositionCount[to] >= maxPositionsPerUser) {
            revert MaxPositionsPerUserExceeded();
        }

        _ownerPositions[to].push(positionId);
        _ownerPositionIndex[to][positionId] = _ownerPositions[to].length;
        userPositionCount[to] += 1;
        position.owner = to;

        _persistMetadata(positionId);
    }

    // -----------------------------------------------------------------------
    // Internal Helpers
    // -----------------------------------------------------------------------

    function _bumpExecNonce(uint256 positionId, Position storage position) private {
        uint64 oldNonce = position.execNonce;
        position.execNonce = oldNonce + 1;
        emit ExecNonceBumped(positionId, oldNonce, position.execNonce);
    }

    function _persistMetadata(uint256 positionId) private {
        Position storage position = _positions[positionId];
        if (!position.exists) return;

        IPositionStorage.Metadata memory metadata = IPositionStorage.Metadata({
            owner: position.owner,
            beneficiary: position.beneficiary,
            quote: position.quoteToken,
            isBuy: position.isBuy,
            frequency: position.frequency,
            venue: position.venue,
            slippageBps: position.slippageBps,
            amountPerPeriod: position.amountPerPeriod,
            startAt: position.startAt,
            endAt: position.endAt
        });

        positionStorage.setPositionMetadata(positionId, metadata);
    }

    function _removeOwnerPosition(address owner, uint256 positionId) private {
        uint256 indexPlusOne = _ownerPositionIndex[owner][positionId];
        // Require position exists in owner's list to catch bugs early
        require(indexPlusOne > 0, "Position not in owner list");

        uint256 index = indexPlusOne - 1;
        uint256[] storage list = _ownerPositions[owner];

        // Verify data integrity before manipulation
        require(index < list.length, "Index out of bounds");
        require(list[index] == positionId, "Index corruption detected");

        uint256 lastIndex = list.length - 1;

        if (index != lastIndex) {
            uint256 movedId = list[lastIndex];
            list[index] = movedId;
            _ownerPositionIndex[owner][movedId] = index + 1;
        }

        list.pop();
        delete _ownerPositionIndex[owner][positionId];
    }

    function _enforceMinimumSize(Position storage position, uint128 amountPerPeriod) private view {
        uint256 usdValue;
        if (position.isBuy) {
            usdValue = _toUsdValue(amountPerPeriod, position.quoteDecimals, position.quoteToken);
        } else {
            usdValue = _toUsdValue(amountPerPeriod, position.baseDecimals, position.baseToken);
        }

        require(usdValue >= minPositionSizeUsd, "Position size below minimum");
    }

    function _toUsdValue(uint256 amount, uint8 tokenDecimals, address token) private view returns (uint256) {
        (uint256 price, ) = priceOracle.getTokenPrice(token);
        if (price == 0) revert InvalidParameter();

        uint256 value = (amount * price) / (10 ** tokenDecimals);

        if (ORACLE_DECIMALS > USD_DECIMALS) {
            uint256 scaleDown = ORACLE_DECIMALS - USD_DECIMALS;
            value = value / (10 ** scaleDown);
        } else if (ORACLE_DECIMALS < USD_DECIMALS) {
            uint256 scaleUp = USD_DECIMALS - ORACLE_DECIMALS;
            value = value * (10 ** scaleUp);
        }

        return value;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(Roles.DEFAULT_ADMIN) {}

    uint256[40] private __gap;
}
