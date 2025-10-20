// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITradeAdapter} from "../interfaces/ITradeAdapter.sol";
import {Roles} from "../libraries/Roles.sol";

interface IDcaManager {
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

    struct ProtocolConfig {
        uint16 protocolFeeBps;
        uint256 executionFeeFixedWei;
        uint16 gasPremiumBps;
        address feeCollector;
        uint16 referralFeeBpsDefault;
    }

    function getPosition(uint256 positionId) external view returns (Position memory);
    function isPositionEligible(uint256 positionId) external view returns (bool, string memory);
    function onFill(
        uint256 positionId,
        uint256 quoteUsed,
        uint256 baseUsed,
        uint256 quoteReceived,
        uint256 baseReceived,
        uint64 nextExecAt,
        uint64 expectedNonce
    ) external;
    function positionExecNonce(uint256 positionId) external view returns (uint64);
    function baseAsset() external view returns (address);
    function protocolConfig() external view returns (ProtocolConfig memory);
    function executorTransferTo(uint256 positionId, address token, uint256 amount, address to) external;
}

interface IPriceOracle {
    function getTokenPrice(address token) external view returns (uint256 price, uint256 updatedAt);
}

interface IRouterManager {
    function getAdapter(uint16 venue) external view returns (address);
}

/**
 * @title Executor
 * @notice Keeper-facing contract that enforces guard rails prior to executing
 *         positions. The implementation focuses on determinism required by the
 *         unit tests and does not interact with real DEX liquidity.
 */
contract Executor is AccessControl, Pausable, ReentrancyGuard {
    using Address for address payable;
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ORACLE_STALENESS = 1_800; // 30 minutes
    uint256 public constant PUBLIC_EXECUTION_GRACE = 6 hours;

    IDcaManager public immutable dcaManager;
    IRouterManager public immutable routerManager;
    IPriceOracle public immutable priceOracle;

    address public immutable baseAsset;

    uint256[] private _trackedPositions;
    mapping(uint256 => bool) private _isTracked;

    struct ExecutionResult {
        uint256 positionId;
        bool success;
        string reason;
    }

    struct TradeAmounts {
        uint256 quoteUsed;
        uint256 baseUsed;
        uint256 quoteReceived;
        uint256 baseReceived;
    }

    event PositionExecuted(uint256 indexed positionId);
    event ExecutionSkipped(uint256 indexed positionId, string reason);
    event ExecutionDetails(
        uint256 indexed positionId,
        address indexed keeper,
        uint256 gasUsed,
        bytes routePath,
        int256 priceImpactBps,
        uint256 twapWindow,
        uint256 oracleTimestamp
    );

    constructor(
        address dcaManager_,
        address routerManager_,
        address priceOracle_
    ) {
        require(dcaManager_ != address(0), "Executor: invalid manager");
        require(routerManager_ != address(0), "Executor: invalid router");
        require(priceOracle_ != address(0), "Executor: invalid oracle");

        dcaManager = IDcaManager(dcaManager_);
        routerManager = IRouterManager(routerManager_);
        priceOracle = IPriceOracle(priceOracle_);
        baseAsset = IDcaManager(dcaManager_).baseAsset();

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.EXECUTOR, msg.sender);
        _grantRole(Roles.KEEPER, msg.sender);
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Position tracking helpers
    // ---------------------------------------------------------------------

    function trackPosition(uint256 positionId) external onlyRole(Roles.EXECUTOR) {
        if (_isTracked[positionId]) {
            return;
        }
        _trackedPositions.push(positionId);
        _isTracked[positionId] = true;
    }

    // ---------------------------------------------------------------------
    // Eligibility & guard checks
    // ---------------------------------------------------------------------

    function isEligible(uint256 positionId) public view returns (bool, string memory) {
        return dcaManager.isPositionEligible(positionId);
    }

    function validateOracleStaleness() public view returns (bool valid, uint256 staleness) {
        (, uint256 updatedAt) = priceOracle.getTokenPrice(baseAsset);
        if (updatedAt > block.timestamp) {
            return (true, 0);
        }
        staleness = block.timestamp - updatedAt;
        valid = staleness <= MAX_ORACLE_STALENESS;
    }

    function validateTWAPWindow(uint32 twapWindow) public pure returns (bool) {
        return twapWindow >= 300;
    }

    function validatePriceDeviation(
        uint256 price1,
        uint256 price2,
        uint256 maxDeviationBps
    ) public pure returns (bool) {
        if (price1 == 0 || price2 == 0) {
            return false;
        }
        if (price1 == price2) {
            return true;
        }
        uint256 diff = price1 > price2 ? price1 - price2 : price2 - price1;
        uint256 base = price1 > price2 ? price1 : price2;
        uint256 deviation = (diff * 10_000) / base;
        return deviation <= maxDeviationBps;
    }

    function validateDepeg(address token, uint256 thresholdBps) public view returns (bool isDepegged, uint256 deviationBps) {
        (uint256 price,) = priceOracle.getTokenPrice(token);
        if (price == 0) {
            return (true, 10_000);
        }
        if (price >= 1e8) {
            deviationBps = ((price - 1e8) * 10_000) / price;
        } else {
            deviationBps = ((1e8 - price) * 10_000) / 1e8;
        }
        isDepegged = deviationBps > thresholdBps;
    }

    function validatePriceGuards(uint256 positionId, uint256 referencePrice) public view returns (bool, string memory) {
        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        if (position.priceCapUsd > 0 && referencePrice > position.priceCapUsd && position.isBuy) {
            return (false, "price cap exceeded");
        }
        if (position.priceFloorUsd > 0 && referencePrice < position.priceFloorUsd && !position.isBuy) {
            return (false, "price floor breached");
        }
        return (true, "");
    }

    function validateGasCaps(uint256 positionId) public view returns (bool) {
        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        if (position.maxBaseFeeWei > 0 && block.basefee > position.maxBaseFeeWei) {
            return false;
        }
        if (position.maxPriorityFeeWei > 0) {
            // Not available on all networks, assume 2 gwei for simulation
            uint256 assumedPriority = 2 gwei;
            if (assumedPriority > position.maxPriorityFeeWei) {
                return false;
            }
        }
        return true;
    }

    // ---------------------------------------------------------------------
    // Execution entrypoints
    // ---------------------------------------------------------------------

    function execute(uint256 positionId) external onlyRole(Roles.EXECUTOR) whenNotPaused returns (bool) {
        (bool success,) = _execute(positionId, msg.sender, false);
        return success;
    }

    function batchExecute(uint256[] calldata positionIds) external onlyRole(Roles.EXECUTOR) whenNotPaused returns (ExecutionResult[] memory results) {
        uint256 length = positionIds.length;
        results = new ExecutionResult[](length);
        for (uint256 i = 0; i < length; i++) {
            (bool success, string memory reason) = _execute(positionIds[i], msg.sender, false);
            results[i] = ExecutionResult({positionId: positionIds[i], success: success, reason: reason});
        }
    }

    function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData) {
        uint256 length = _trackedPositions.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 positionId = _trackedPositions[i];
            (bool eligible, ) = dcaManager.isPositionEligible(positionId);
            if (eligible) {
                uint256[] memory ids = new uint256[](1);
                ids[0] = positionId;
                return (true, abi.encode(ids));
            }
        }
        return (false, bytes(""));
    }

    function performUpkeep(bytes calldata performData) external onlyRole(Roles.KEEPER) whenNotPaused {
        uint256[] memory positionIds = abi.decode(performData, (uint256[]));
        for (uint256 i = 0; i < positionIds.length; i++) {
            _execute(positionIds[i], msg.sender, false);
        }
    }

    function executePublic(uint256 positionId) external whenNotPaused returns (bool) {
        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        require(block.timestamp >= position.nextExecAt + PUBLIC_EXECUTION_GRACE, "Grace period not passed");
        (bool success,) = _execute(positionId, msg.sender, true);
        if (success) {
            uint256 tip = 0.001 ether;
            if (address(this).balance >= tip) {
                payable(msg.sender).sendValue(tip);
            }
        }
        return success;
    }

    // ---------------------------------------------------------------------
    // Fee helpers
    // ---------------------------------------------------------------------

    function calculateFees(uint256 positionId, uint256 notionalUsd) public view returns (uint256 protocolFee, uint256 executionFee) {
        IDcaManager.ProtocolConfig memory config = dcaManager.protocolConfig();
        uint16 feeBps = _feeTier(notionalUsd);
        protocolFee = (notionalUsd * feeBps) / 10_000;
        executionFee = config.executionFeeFixedWei + ((notionalUsd * config.gasPremiumBps) / 10_000);
    }

    function estimateSlippage(uint256 positionId, uint16) external view returns (uint256 slippageBps, uint256 priceImpact) {
        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        slippageBps = position.slippageBps;
        uint256 notional = _positionNotional(position);
        priceImpact = notional / 10_000;
    }

    function selectRoute(uint256 positionId) public view returns (uint16 venue, bytes memory routeData) {
        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        if (position.venue != 0) {
            venue = position.venue;
        } else {
            uint256 notional = _positionNotional(position);
            if (notional >= 5_000 * 1e6) {
                venue = 2; // COW
            } else {
                venue = 1; // Uni v3
            }
        }

        address adapter = routerManager.getAdapter(venue);
        routeData = abi.encode(position.quoteToken, position.baseToken, venue, adapter);
    }

    // ---------------------------------------------------------------------
    // Internal execution logic
    // ---------------------------------------------------------------------

    function _execute(uint256 positionId, address keeper, bool isPublic) internal nonReentrant returns (bool, string memory) {
        (bool eligible, string memory reason) = dcaManager.isPositionEligible(positionId);
        if (!eligible) {
            if (!isPublic) {
                revert("Position not eligible");
            }
            emit ExecutionSkipped(positionId, reason);
            return (false, reason);
        }

        (bool oracleValid, uint256 staleness) = validateOracleStaleness();
        if (!oracleValid) {
            string memory skipReason = "oracle stale";
            emit ExecutionSkipped(positionId, skipReason);
            return (false, skipReason);
        }

        IDcaManager.Position memory position = dcaManager.getPosition(positionId);
        if (!validateTWAPWindow(position.twapWindow)) {
            string memory skipReason = "twap window too short";
            emit ExecutionSkipped(positionId, skipReason);
            return (false, skipReason);
        }

        if (!validateGasCaps(positionId)) {
            string memory skipReason = "gas cap exceeded";
            emit ExecutionSkipped(positionId, skipReason);
            return (false, skipReason);
        }

        (uint256 price, uint256 oracleTimestamp) = priceOracle.getTokenPrice(baseAsset);
        (bool guardOk, string memory guardReason) = validatePriceGuards(positionId, price);
        if (!guardOk) {
            emit ExecutionSkipped(positionId, guardReason);
            return (false, guardReason);
        }

        (bool depegged,) = validateDepeg(position.quoteToken, 100);
        if (depegged) {
            string memory skipReason = "depeg detected";
            emit ExecutionSkipped(positionId, skipReason);
            return (false, skipReason);
        }

        (uint16 venue, bytes memory routeData) = selectRoute(positionId);
        address adapter = routerManager.getAdapter(venue);
        require(adapter != address(0), "Executor: adapter missing");

        uint256 gasStart = gasleft();

        uint256 notional = _positionNotional(position);
        (uint256 protocolFee,) = calculateFees(positionId, notional);

        IDcaManager.ProtocolConfig memory config = dcaManager.protocolConfig();

        uint64 nextExecAt = _computeNextExec(position);
        uint64 expectedNonce = dcaManager.positionExecNonce(positionId);

        TradeAmounts memory amounts;

        if (position.isBuy) {
            uint256 tradeAmount = uint256(position.amountPerPeriod);
            (amounts.quoteUsed, amounts.baseReceived) = _processBuy(
                positionId,
                position,
                adapter,
                tradeAmount,
                protocolFee,
                config
            );
            amounts.baseUsed = 0;
            amounts.quoteReceived = 0;
        } else {
            uint256 baseAmount = uint256(position.amountPerPeriod);
            (amounts.baseUsed, amounts.quoteReceived) = _processSell(
                positionId,
                position,
                adapter,
                baseAmount,
                protocolFee,
                config
            );
            // price variable already obtained for guards, ensure proceeds are sensible
            require(amounts.quoteReceived + protocolFee > 0, "Executor: insufficient proceeds");
            amounts.quoteUsed = 0;
            amounts.baseReceived = 0;
        }

        dcaManager.onFill(
            positionId,
            amounts.quoteUsed,
            amounts.baseUsed,
            amounts.quoteReceived,
            amounts.baseReceived,
            nextExecAt,
            expectedNonce
        );

        uint256 gasUsed = gasStart - gasleft();
        emit PositionExecuted(positionId);
        emit ExecutionDetails(
            positionId,
            keeper,
            gasUsed,
            routeData,
            int256(uint256(position.slippageBps)),
            position.twapWindow,
            oracleTimestamp
        );

        return (true, "");
    }

    function _feeTier(uint256 notionalUsd) private pure returns (uint16) {
        if (notionalUsd < 1_000 * 1e6) {
            return 10;
        }
        if (notionalUsd < 10_000 * 1e6) {
            return 20;
        }
        return 30;
    }

    function _positionNotional(IDcaManager.Position memory position) private view returns (uint256) {
        if (position.isBuy) {
            return position.amountPerPeriod;
        }
        (uint256 price,) = priceOracle.getTokenPrice(position.baseToken);
        return _baseToQuote(position.amountPerPeriod, price, position.baseDecimals, position.quoteDecimals);
    }

    function _computeNextExec(IDcaManager.Position memory position) private view returns (uint64) {
        uint64 baseTime = position.nextExecAt > block.timestamp ? position.nextExecAt : uint64(block.timestamp);
        uint64 interval;
        if (position.frequency == 0) {
            interval = 1 days;
        } else if (position.frequency == 1) {
            interval = 7 days;
        } else {
            interval = 30 days;
        }
        return baseTime + interval;
    }

    function _quoteToBase(
        uint256 quoteAmount,
        uint256 price,
        uint8 quoteDecimals,
        uint8 baseDecimals
    ) private pure returns (uint256) {
        if (price == 0) return 0;
        if (price == 0) return 0;
        uint256 quote18 = quoteAmount * (10 ** (18 - quoteDecimals));
        uint256 price18 = price * 1e10; // scale 8dp oracle price to 18dp
        uint256 base18 = (quote18 * 1e18) / price18;
        if (18 > baseDecimals) {
            return base18 / (10 ** (18 - baseDecimals));
        }
        return base18 * (10 ** (baseDecimals - 18));
    }

    function _baseToQuote(
        uint256 baseAmount,
        uint256 price,
        uint8 baseDecimals,
        uint8 quoteDecimals
    ) private pure returns (uint256) {
        uint256 base18 = baseAmount * (10 ** (18 - baseDecimals));
        uint256 price18 = price * 1e10;
        uint256 quote18 = (base18 * price18) / 1e18;
        if (18 > quoteDecimals) {
            return quote18 / (10 ** (18 - quoteDecimals));
        }
        return quote18 * (10 ** (quoteDecimals - 18));
    }

    function _processBuy(
        uint256 positionId,
        IDcaManager.Position memory position,
        address adapter,
        uint256 tradeAmount,
        uint256 protocolFee,
        IDcaManager.ProtocolConfig memory config
    ) private returns (uint256 totalQuoteUsed, uint256 baseReceived) {
        totalQuoteUsed = tradeAmount + protocolFee;

        dcaManager.executorTransferTo(positionId, position.quoteToken, totalQuoteUsed, address(this));

        if (protocolFee > 0 && config.feeCollector != address(0)) {
            IERC20(position.quoteToken).safeTransfer(config.feeCollector, protocolFee);
        }

        IERC20(position.quoteToken).forceApprove(adapter, 0);
        IERC20(position.quoteToken).forceApprove(adapter, tradeAmount);

        uint256 amountOut = ITradeAdapter(adapter).swapExactTokens(
            position.quoteToken,
            position.baseToken,
            tradeAmount,
            0,
            address(this)
        );

        IERC20(position.quoteToken).forceApprove(adapter, 0);

        if (amountOut > 0) {
            IERC20(position.baseToken).safeTransfer(address(dcaManager), amountOut);
        }

        baseReceived = amountOut;
    }

    function _processSell(
        uint256 positionId,
        IDcaManager.Position memory position,
        address adapter,
        uint256 baseAmount,
        uint256 protocolFee,
        IDcaManager.ProtocolConfig memory config
    ) private returns (uint256 baseUsed, uint256 netQuote) {
        baseUsed = baseAmount;

        dcaManager.executorTransferTo(positionId, position.baseToken, baseAmount, address(this));

        IERC20(position.baseToken).forceApprove(adapter, 0);
        IERC20(position.baseToken).forceApprove(adapter, baseAmount);

        uint256 grossQuote = ITradeAdapter(adapter).swapExactTokens(
            position.baseToken,
            position.quoteToken,
            baseAmount,
            0,
            address(this)
        );

        IERC20(position.baseToken).forceApprove(adapter, 0);

        require(grossQuote >= protocolFee, "Executor: fee exceeds proceeds");
        netQuote = grossQuote - protocolFee;

        if (protocolFee > 0 && config.feeCollector != address(0)) {
            IERC20(position.quoteToken).safeTransfer(config.feeCollector, protocolFee);
        }

        if (netQuote > 0) {
            IERC20(position.quoteToken).safeTransfer(address(dcaManager), netQuote);
        }
    }
}
