// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Roles} from "../libraries/Roles.sol";
import {ITradeAdapter} from "../interfaces/ITradeAdapter.sol";

interface ICowSettlement {
    function lockFunds(address owner, address token, uint256 amount) external;
    function releaseFunds(address owner, address token, uint256 amount, address to) external;
    function lockedFunds(address owner, address token) external view returns (uint256);
}

interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title CoWAdapter
 * @notice Emulates the behaviour of a CoW Protocol integration for unit tests.
 *         Orders are tracked in memory and funds are escrowed in the accompanying
 *         mock settlement contract to provide realistic state transitions.
 */
contract CoWAdapter is AccessControl, ReentrancyGuard, ITradeAdapter {
    using SafeERC20 for IERC20;

    string public constant ADAPTER_TYPE = "COW_PROTOCOL";
    uint256 private constant PRICE_X18 = 40_000 * 1e18; // 1 WBTC = $40k default

    address public immutable cowSettlement;

    struct OrderParams {
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        uint256 validTo;
        bytes32 appData;
        uint256 feeAmount;
        string kind;
        bool partiallyFillable;
        bytes32 sellTokenBalance;
        bytes32 buyTokenBalance;
    }

    struct Order {
        address owner;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 buyAmount;
        uint256 feeAmount;
        uint256 validTo;
        bool partiallyFillable;
        bool settled;
        uint256 filledAmount;
        uint256 batchId;
    }

    struct PartialFillStatus {
        uint256 filledAmount;
        bool isComplete;
    }

    struct QuoteResult {
        uint256 amountOut;
        uint256 priceImpact;
    }

    mapping(bytes32 => Order) private _orders;
    mapping(bytes32 => bool) private _exists;
    mapping(bytes32 => bool) private _supportedPairs;
    uint64 private _nonce;

    event OrderCreated(bytes32 indexed orderId, address indexed sellToken, address indexed buyToken);
    event OrderCancelled(bytes32 indexed orderId);
    event OrderSettled(bytes32 indexed orderId, uint256 amountOut);
    event PartialFillRecorded(bytes32 indexed orderId, uint256 filledAmount, bool isComplete);
    event CustomPairSupport(address indexed tokenA, address indexed tokenB, bool supported);

    constructor(address cowSettlement_) {
        require(cowSettlement_ != address(0), "Invalid settlement");
        cowSettlement = cowSettlement_;
        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.ROUTER_ADMIN, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Order lifecycle
    // ---------------------------------------------------------------------

    function createOrder(OrderParams calldata params) external nonReentrant returns (bytes32 orderId) {
        require(params.sellAmount > 0, "Amount must be greater than zero");
        require(params.validTo > block.timestamp, "Order expired");

        uint256 escrowAmount = params.sellAmount + params.feeAmount;
        if (escrowAmount > 0) {
            ICowSettlement(cowSettlement).lockFunds(msg.sender, params.sellToken, escrowAmount);
        }

        orderId = keccak256(
            abi.encodePacked(
                msg.sender,
                params.sellToken,
                params.buyToken,
                ++_nonce,
                block.timestamp
            )
        );

        Order storage order = _orders[orderId];
        order.owner = msg.sender;
        order.sellToken = params.sellToken;
        order.buyToken = params.buyToken;
        order.sellAmount = params.sellAmount;
        order.buyAmount = params.buyAmount;
        order.feeAmount = params.feeAmount;
        order.validTo = params.validTo;
        order.partiallyFillable = params.partiallyFillable;
        order.batchId = uint256(orderId) % 1_000_000 + 1;

        _exists[orderId] = true;
        _markPairSupported(params.sellToken, params.buyToken, true);

        emit OrderCreated(orderId, params.sellToken, params.buyToken);
    }

    function cancelOrder(bytes32 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        require(msg.sender == order.owner, "Not order owner");
        require(!order.settled, "Order already settled");

        order.settled = true;
        uint256 escrowAmount = order.sellAmount + order.feeAmount;
        if (escrowAmount > 0) {
            ICowSettlement(cowSettlement).releaseFunds(order.owner, order.sellToken, escrowAmount, order.owner);
        }

        emit OrderCancelled(orderId);
    }

    function settleOrder(bytes32 orderId) external nonReentrant returns (uint256 amountOut) {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        require(!order.settled, "Order already settled");
        require(block.timestamp <= order.validTo, "Order expired");

        uint256 remaining = order.buyAmount > order.filledAmount
            ? order.buyAmount - order.filledAmount
            : 0;
        if (remaining == 0) {
            remaining = order.buyAmount;
        }

        order.filledAmount = order.buyAmount;
        order.settled = true;

        uint256 escrowAmount = order.sellAmount + order.feeAmount;
        if (escrowAmount > 0) {
            ICowSettlement(cowSettlement).releaseFunds(order.owner, order.sellToken, escrowAmount, address(this));
        }

        IMintableERC20(order.buyToken).mint(order.owner, remaining);
        amountOut = remaining;

        emit OrderSettled(orderId, remaining);
    }

    function simulatePartialFill(bytes32 orderId, uint256 fillAmount) external nonReentrant {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        require(!order.settled, "Order already settled");
        require(order.partiallyFillable, "Partial fills not allowed");
        require(fillAmount > 0, "Invalid fill amount");

        uint256 newFilled = order.filledAmount + fillAmount;
        if (newFilled >= order.buyAmount) {
            newFilled = order.buyAmount;
            order.settled = true;
        }
        order.filledAmount = newFilled;

        emit PartialFillRecorded(orderId, newFilled, order.settled);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function adapterType() external pure returns (string memory) {
        return ADAPTER_TYPE;
    }

    function supportsMEVProtection(bytes32) external pure returns (bool) {
        return true;
    }

    function getBatchId(bytes32 orderId) external view returns (uint256) {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        return order.batchId;
    }

    function getSettlementTime(bytes32 orderId) external view returns (uint256) {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        return order.validTo;
    }

    function getPartialFillStatus(bytes32 orderId) external view returns (PartialFillStatus memory status) {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        status = PartialFillStatus({filledAmount: order.filledAmount, isComplete: order.settled});
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        Order storage order = _orders[orderId];
        _requireOrder(orderId);
        return order;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (QuoteResult memory quoteResult) {
        require(_isPairSupported(tokenIn, tokenOut), "Pair not supported");
        uint256 amountOut = _convert(tokenIn, tokenOut, amountIn);
        uint256 priceImpact = amountIn / 10_000;
        quoteResult = QuoteResult({amountOut: amountOut, priceImpact: priceImpact});
    }

    function supportsAssetPair(address tokenA, address tokenB) external view returns (bool) {
        return _isPairSupported(tokenA, tokenB);
    }

    // ---------------------------------------------------------------------
    // Admin helpers
    // ---------------------------------------------------------------------

    function setSupportedPair(address tokenA, address tokenB, bool supported) external onlyRole(Roles.ROUTER_ADMIN) {
        _markPairSupported(tokenA, tokenB, supported);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _requireOrder(bytes32 orderId) private view {
        require(_exists[orderId], "Order missing");
    }

    function _markPairSupported(address tokenA, address tokenB, bool supported) private {
        bytes32 key = _pairKey(tokenA, tokenB);
        _supportedPairs[key] = supported;
        emit CustomPairSupport(tokenA, tokenB, supported);
    }

    function _isPairSupported(address tokenA, address tokenB) private view returns (bool) {
        return _supportedPairs[_pairKey(tokenA, tokenB)];
    }

    function _pairKey(address tokenA, address tokenB) private pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encodePacked(tokenA, tokenB)) : keccak256(abi.encodePacked(tokenB, tokenA));
    }

    function _convert(address tokenIn, address tokenOut, uint256 amountIn) private view returns (uint256) {
        uint8 decimalsIn = _decimals(tokenIn);
        uint8 decimalsOut = _decimals(tokenOut);
        uint256 scalerIn = 10 ** uint256(decimalsIn);
        uint256 scalerOut = 10 ** uint256(decimalsOut);

        uint256 normalized = amountIn * 1e18 / scalerIn;
        uint256 converted;

        // Treat pairs versus BTC style assets specially using default price
        bytes32 symbolHash;
        try IERC20Metadata(tokenOut).symbol() returns (string memory symbol) {
            symbolHash = keccak256(bytes(symbol));
        } catch {
            symbolHash = bytes32(0);
        }

        if (symbolHash == keccak256("WBTC") || symbolHash == keccak256("BTC")) {
            converted = (normalized * 1e18) / PRICE_X18;
        } else {
            converted = normalized;
        }

        return converted * scalerOut / 1e18;
    }

    function _decimals(address token) private view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 value) {
            return value;
        } catch {
            return 18;
        }
    }

    /// @inheritdoc ITradeAdapter
    function swapExactTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be greater than zero");
        address finalRecipient = recipient == address(0) ? msg.sender : recipient;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = _convert(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "Insufficient output");

        IMintableERC20(tokenOut).mint(finalRecipient, amountOut);
    }
}
