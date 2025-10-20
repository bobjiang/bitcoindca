// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Roles} from "../libraries/Roles.sol";
import {ITradeAdapter} from "../interfaces/ITradeAdapter.sol";

interface IMintableToken is IERC20 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title OneInchAdapter
 * @notice Deterministic adapter that mimics 1inch routing behaviour for tests.
 *         It distributes order flow across a curated list of virtual DEXs and
 *         provides helper quoting utilities.
 */
contract OneInchAdapter is AccessControl, ReentrancyGuard, Pausable, ITradeAdapter {
    using SafeERC20 for IERC20;

    string public constant ADAPTER_TYPE = "ONE_INCH_AGGREGATOR";
    uint256 private constant PRICE_X18 = 40_000 * 1e18;
    uint256 private constant MAX_LIQUIDITY = 1_000_000_000 * 1e6;

    address public immutable oneInchRouter;

    string[] private _dexUniverse;
    mapping(bytes32 => bool) private _supportedPairs;

    struct SwapParams {
        address srcToken;
        address dstToken;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        address recipient;
    }

    struct MultiHopParams {
        address srcToken;
        address dstToken;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        address recipient;
        address[] path;
    }

    struct RouteInfo {
        string[] dexs;
        uint256[] distribution;
        uint256 expectedReturn;
    }

    struct ExpectedReturn {
        uint256 returnAmount;
        uint256[] distribution;
    }

    struct QuoteResult {
        uint256 amountOut;
        uint256 priceImpact;
        uint256 gasEstimate;
    }

    event SwapExecuted(address indexed srcToken, address indexed dstToken, uint256 amount);
    event MultiHopSwapExecuted(address indexed srcToken, address indexed dstToken, uint256 amount);
    event FallbackSwapExecuted(address indexed srcToken, address indexed dstToken);
    event PairSupportUpdated(address indexed tokenA, address indexed tokenB, bool supported);

    constructor(address oneInchRouter_) {
        require(oneInchRouter_ != address(0), "Invalid router");
        oneInchRouter = oneInchRouter_;

        _dexUniverse = new string[](3);
        _dexUniverse[0] = "UniswapV3";
        _dexUniverse[1] = "SushiSwap";
        _dexUniverse[2] = "Balancer";

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.ROUTER_ADMIN, msg.sender);
        _grantRole(Roles.PAUSER, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Swap entrypoints
    // ---------------------------------------------------------------------

    function swap(SwapParams calldata params) public nonReentrant whenNotPaused returns (uint256 amountOut) {
        amountOut = _performSwap(params.srcToken, params.dstToken, params.amount, params.minReturnAmount, params.recipient);
        emit SwapExecuted(params.srcToken, params.dstToken, params.amount);
    }

    function swapMultiHop(MultiHopParams calldata params) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(params.recipient != address(0), "Invalid recipient");
        require(params.path.length >= 2, "Invalid path");
        require(params.path[0] == params.srcToken && params.path[params.path.length - 1] == params.dstToken, "Path mismatch");

        uint256 runningAmount = params.amount;
        for (uint256 i = 0; i < params.path.length - 1; i++) {
            runningAmount = _convert(params.path[i], params.path[i + 1], runningAmount);
        }

        require(runningAmount >= params.minReturnAmount, "Return amount is not enough");
        IMintableToken(params.dstToken).mint(params.recipient, runningAmount);

        IERC20(params.srcToken).safeTransferFrom(msg.sender, address(this), params.amount);
        emit MultiHopSwapExecuted(params.srcToken, params.dstToken, params.amount);
        return runningAmount;
    }

    function swapFallback(SwapParams calldata params) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        amountOut = _performSwap(params.srcToken, params.dstToken, params.amount, params.minReturnAmount, params.recipient);
        emit FallbackSwapExecuted(params.srcToken, params.dstToken);
    }

    function swapWithRetry(SwapParams calldata params) external whenNotPaused returns (uint256 amountOut) {
        try this.swap(params) returns (uint256 result) {
            return result;
        } catch {
            amountOut = _performSwap(params.srcToken, params.dstToken, params.amount, 0, params.recipient);
            emit SwapExecuted(params.srcToken, params.dstToken, params.amount);
        }
    }

    // ---------------------------------------------------------------------
    // Route helpers
    // ---------------------------------------------------------------------

    function getOptimalRoute(address tokenIn, address tokenOut, uint256 amountIn) external view returns (RouteInfo memory route) {
        require(_isPairSupported(tokenIn, tokenOut), "Pair not supported");
        uint256[] memory distribution = _distributionForAmount(amountIn);
        route = RouteInfo({dexs: _dexUniverse, distribution: distribution, expectedReturn: _convert(tokenIn, tokenOut, amountIn)});
    }

    function getExpectedReturn(address tokenIn, address tokenOut, uint256 amountIn, uint256 parts, uint256) external view returns (ExpectedReturn memory) {
        require(_isPairSupported(tokenIn, tokenOut), "Pair not supported");
        uint256[] memory distribution = _distributionFromParts(parts);
        uint256 returnAmount = _convert(tokenIn, tokenOut, amountIn);
        return ExpectedReturn({returnAmount: returnAmount, distribution: distribution});
    }

    function getExpectedReturnMultiHop(address[] calldata path, uint256 amountIn, uint256 parts, uint256) external view returns (ExpectedReturn memory) {
        require(path.length >= 2, "Invalid path");
        uint256 runningAmount = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            runningAmount = _convert(path[i], path[i + 1], runningAmount);
        }
        uint256[] memory distribution = _distributionFromParts(parts);
        return ExpectedReturn({returnAmount: runningAmount, distribution: distribution});
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (QuoteResult memory quoteResult) {
        require(_isPairSupported(tokenIn, tokenOut), "Pair not supported");
        uint256 amountOut = _convert(tokenIn, tokenOut, amountIn);
        uint256 priceImpact = amountIn / 5_000;
        uint256 gasEstimate = 200_000 + (_dexUniverse.length * 30_000);
        quoteResult = QuoteResult({amountOut: amountOut, priceImpact: priceImpact, gasEstimate: gasEstimate});
    }

    function supportsMultiDEX() external pure returns (bool) {
        return true;
    }

    function adapterType() external pure returns (string memory) {
        return ADAPTER_TYPE;
    }

    function supportsAssetPair(address tokenA, address tokenB) external view returns (bool) {
        return _isPairSupported(tokenA, tokenB);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setSupportedPair(address tokenA, address tokenB, bool supported) external onlyRole(Roles.ROUTER_ADMIN) {
        bytes32 key = _pairKey(tokenA, tokenB);
        _supportedPairs[key] = supported;
        emit PairSupportUpdated(tokenA, tokenB, supported);
    }

    function pause() external onlyRole(Roles.PAUSER) {
        _pause();
    }

    function unpause() external onlyRole(Roles.PAUSER) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _performSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) internal returns (uint256 amountOut) {
        require(recipient != address(0), "Invalid recipient");
        require(_isPairSupported(tokenIn, tokenOut), "Pair not supported");
        require(amountIn <= MAX_LIQUIDITY, "Insufficient liquidity");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = _convert(tokenIn, tokenOut, amountIn);
        require(amountOut >= minAmountOut, "Return amount is not enough");

        IMintableToken(tokenOut).mint(recipient, amountOut);
    }

    function _distributionForAmount(uint256 amountIn) internal view returns (uint256[] memory distribution) {
        distribution = new uint256[](_dexUniverse.length);
        if (amountIn < 1_000 * 1e6) {
            distribution[0] = 100;
        } else if (amountIn < 10_000 * 1e6) {
            distribution[0] = 60;
            distribution[1] = 40;
        } else {
            distribution[0] = 50;
            distribution[1] = 30;
            distribution[2] = 20;
        }
    }

    function _distributionFromParts(uint256 parts) internal view returns (uint256[] memory distribution) {
        distribution = new uint256[](_dexUniverse.length);
        if (parts <= 1) {
            distribution[0] = 100;
            return distribution;
        }
        distribution[0] = 50;
        if (_dexUniverse.length > 1) {
            distribution[1] = 30;
        }
        if (_dexUniverse.length > 2) {
            distribution[2] = 20;
        }
    }

    function _isPairSupported(address tokenA, address tokenB) internal view returns (bool) {
        return _supportedPairs[_pairKey(tokenA, tokenB)];
    }

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        return tokenA < tokenB ? keccak256(abi.encodePacked(tokenA, tokenB)) : keccak256(abi.encodePacked(tokenB, tokenA));
    }

    function _convert(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256) {
        uint8 decimalsIn = _decimals(tokenIn);
        uint8 decimalsOut = _decimals(tokenOut);
        uint256 scalerIn = 10 ** uint256(decimalsIn);
        uint256 scalerOut = 10 ** uint256(decimalsOut);

        uint256 normalized = amountIn * 1e18 / scalerIn;

        bytes32 outSymbol;
        try IERC20Metadata(tokenOut).symbol() returns (string memory symbol) {
            outSymbol = keccak256(bytes(symbol));
        } catch {
            outSymbol = bytes32(0);
        }

        uint256 converted;
        if (outSymbol == keccak256("WBTC") || outSymbol == keccak256("BTC")) {
            converted = (normalized * 1e18) / PRICE_X18;
        } else {
            converted = normalized;
        }

        return converted * scalerOut / 1e18;
    }

    function _decimals(address token) internal view returns (uint8) {
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
        address finalRecipient = recipient == address(0) ? msg.sender : recipient;
        amountOut = _performSwap(tokenIn, tokenOut, amountIn, minAmountOut, finalRecipient);
        emit SwapExecuted(tokenIn, tokenOut, amountIn);
    }
}
