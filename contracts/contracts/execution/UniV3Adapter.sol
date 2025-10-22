// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LegacyAccessControl} from "../libraries/LegacyAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Roles} from "../libraries/Roles.sol";
import {ITradeAdapter} from "../interfaces/ITradeAdapter.sol";

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

interface IUniswapV3PoolView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function lastPriceX18() external view returns (uint256);
    function liquidity() external view returns (uint256);
    function getAveragePrice(uint32 window) external view returns (uint256);
}

/**
 * @title UniV3Adapter
 * @notice Thin wrapper around a Uniswap v3 style router that provides extra
 *         helpers required by the executor and unit tests. The adapter keeps a
 *         registry of pools so it can offer TWAP/quoter utilities without
 *         relying on external state.
 */
contract UniV3Adapter is LegacyAccessControl, ReentrancyGuard, Pausable, ITradeAdapter {
    using SafeERC20 for IERC20;

    string public constant ADAPTER_TYPE = "UNISWAP_V3";

    address public immutable uniswapRouter;

    struct PoolInfo {
        address pool;
        bool forward; // true when tokenIn -> tokenOut matches pool.token0 -> token1
        bool exists;
    }

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
        uint160 sqrtPriceLimitX96;
    }

    struct FlashbotsSwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
        uint160 sqrtPriceLimitX96;
        bool useFlashbots;
    }

    struct QuoteResult {
        uint256 amountOut;
        uint256 priceImpact;
    }

    mapping(bytes32 => PoolInfo) private _pools;

    event PoolRegistered(address indexed tokenIn, address indexed tokenOut, uint24 fee, address pool);
    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient);
    event FlashbotsSwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn);

    constructor(address uniswapRouter_) {
        require(uniswapRouter_ != address(0), "Invalid router");
        uniswapRouter = uniswapRouter_;

        _grantRole(Roles.DEFAULT_ADMIN, msg.sender);
        _grantRole(Roles.ROUTER_ADMIN, msg.sender);
        _grantRole(Roles.PAUSER, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Pool Registry
    // ---------------------------------------------------------------------

    function registerPool(address tokenIn, address tokenOut, uint24 fee, address pool) external onlyRole(Roles.ROUTER_ADMIN) {
        require(tokenIn != address(0) && tokenOut != address(0) && pool != address(0), "Invalid parameters");
        bytes32 forwardKey = _poolKey(tokenIn, tokenOut, fee);
        bytes32 reverseKey = _poolKey(tokenOut, tokenIn, fee);

        IUniswapV3PoolView poolView = IUniswapV3PoolView(pool);
        address token0 = poolView.token0();
        address token1 = poolView.token1();
        require((token0 == tokenIn && token1 == tokenOut) || (token0 == tokenOut && token1 == tokenIn), "Token mismatch");

        _pools[forwardKey] = PoolInfo({pool: pool, forward: token0 == tokenIn, exists: true});
        _pools[reverseKey] = PoolInfo({pool: pool, forward: token0 == tokenOut, exists: true});

        emit PoolRegistered(tokenIn, tokenOut, fee, pool);
    }

    function supportsAssetPair(address tokenIn, address tokenOut) external view returns (bool) {
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i = 0; i < fees.length; i++) {
            if (_pools[_poolKey(tokenIn, tokenOut, fees[i])].exists) {
                return true;
            }
        }
        return false;
    }

    // ---------------------------------------------------------------------
    // Swap APIs
    // ---------------------------------------------------------------------

    function executeSwap(SwapParams calldata params) public nonReentrant whenNotPaused returns (uint256 amountOut) {
        SwapParams memory local = SwapParams({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            amountOutMinimum: params.amountOutMinimum,
            recipient: params.recipient,
            deadline: params.deadline,
            sqrtPriceLimitX96: params.sqrtPriceLimitX96
        });
        amountOut = _executeSwapInternal(local);
    }

    function executeSwapWithFlashbots(FlashbotsSwapParams calldata params) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(params.useFlashbots, "Flashbots flag required");
        SwapParams memory local = SwapParams({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            amountOutMinimum: params.amountOutMinimum,
            recipient: params.recipient,
            deadline: params.deadline,
            sqrtPriceLimitX96: params.sqrtPriceLimitX96
        });
        amountOut = _executeSwapInternal(local);
        emit FlashbotsSwapExecuted(params.tokenIn, params.tokenOut, params.amountIn);
    }

    function batchSwap(SwapParams[] calldata swaps) external nonReentrant whenNotPaused {
        uint256 length = swaps.length;
        require(length > 0, "Empty batch");
        for (uint256 i = 0; i < length; i++) {
            SwapParams memory local = SwapParams({
                tokenIn: swaps[i].tokenIn,
                tokenOut: swaps[i].tokenOut,
                amountIn: swaps[i].amountIn,
                amountOutMinimum: swaps[i].amountOutMinimum,
                recipient: swaps[i].recipient,
                deadline: swaps[i].deadline,
                sqrtPriceLimitX96: swaps[i].sqrtPriceLimitX96
            });
            _executeSwapInternal(local);
        }
    }

    function _executeSwapInternal(SwapParams memory params) internal returns (uint256 amountOut) {
        require(params.recipient != address(0), "Invalid recipient");
        require(params.amountIn > 0, "Amount must be greater than zero");

        (PoolInfo memory info, uint24 fee) = _resolvePool(params.tokenIn, params.tokenOut);

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenIn).forceApprove(uniswapRouter, params.amountIn);

        amountOut = IUniswapV3Router(uniswapRouter).exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: fee,
                recipient: params.recipient,
                deadline: params.deadline,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMinimum,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96
            })
        );

        IERC20(params.tokenIn).forceApprove(uniswapRouter, 0);

        emit SwapExecuted(params.tokenIn, params.tokenOut, params.amountIn, amountOut, params.recipient);
    }

    /// @inheritdoc ITradeAdapter
    function swapExactTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        SwapParams memory params = SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOutMinimum: minAmountOut,
            recipient: recipient == address(0) ? msg.sender : recipient,
            deadline: block.timestamp + 300,
            sqrtPriceLimitX96: 0
        });
        amountOut = _executeSwapInternal(params);
    }

    // ---------------------------------------------------------------------
    // View helpers
    // ---------------------------------------------------------------------

    function adapterType() external pure returns (string memory) {
        return ADAPTER_TYPE;
    }

    function getTWAP(address pool, uint32 window) external view returns (uint256) {
        require(pool != address(0), "Invalid pool");
        require(window > 0, "Invalid TWAP window");
        return IUniswapV3PoolView(pool).getAveragePrice(window);
    }

    function getOptimalFeeTier(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint24) {
        if (_isStable(tokenIn) && _isStable(tokenOut)) {
            return 500;
        }
        if (amountIn > 5_000 * 1e6) { // large swaps favour deeper liquidity pools
            return 3000;
        }
        return 3000;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee) external view returns (QuoteResult memory quoteResult) {
        PoolInfo memory info = _pools[_poolKey(tokenIn, tokenOut, fee)];
        require(info.exists, "Pool not registered");

        (uint256 amountOut, uint256 priceImpact) = _computeQuote(info, tokenIn, tokenOut, amountIn);
        quoteResult = QuoteResult({amountOut: amountOut, priceImpact: priceImpact});
    }

    function checkLiquidity(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee) external view returns (bool) {
        PoolInfo memory info = _pools[_poolKey(tokenIn, tokenOut, fee)];
        if (!info.exists) {
            return false;
        }

        uint256 liquidity = IUniswapV3PoolView(info.pool).liquidity();
        return amountIn <= liquidity;
    }

    // ---------------------------------------------------------------------
    // Pause controls
    // ---------------------------------------------------------------------

    function pause() external onlyRole(Roles.PAUSER) {
        _pause();
    }

    function unpause() external onlyRole(Roles.PAUSER) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _resolvePool(address tokenIn, address tokenOut) internal view returns (PoolInfo memory info, uint24 fee) {
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i = 0; i < fees.length; i++) {
            bytes32 key = _poolKey(tokenIn, tokenOut, fees[i]);
            if (_pools[key].exists) {
                return (_pools[key], fees[i]);
            }
        }
        revert("Pool not registered");
    }

    function _computeQuote(PoolInfo memory info, address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256 amountOut, uint256 priceImpact) {
        IUniswapV3PoolView pool = IUniswapV3PoolView(info.pool);
        uint256 priceX18 = pool.lastPriceX18();
        require(priceX18 > 0, "Invalid price");

        uint256 decimalsIn = _decimals(tokenIn);
        uint256 decimalsOut = _decimals(tokenOut);

        if (info.forward) {
            amountOut = (amountIn * priceX18) / 1e18;
            if (decimalsOut > decimalsIn) {
                uint256 diff = decimalsOut - decimalsIn;
                amountOut = amountOut * (10 ** diff);
            } else if (decimalsOut < decimalsIn) {
                uint256 diff = decimalsIn - decimalsOut;
                amountOut = amountOut / (10 ** diff);
            }
        } else {
            uint256 scaled = (amountIn * 1e18) / priceX18;
            if (decimalsOut > decimalsIn) {
                uint256 diff = decimalsOut - decimalsIn;
                amountOut = scaled * (10 ** diff);
            } else if (decimalsOut < decimalsIn) {
                uint256 diff = decimalsIn - decimalsOut;
                amountOut = scaled / (10 ** diff);
            } else {
                amountOut = scaled;
            }
        }

        uint256 liquidity = pool.liquidity();
        if (liquidity == 0) {
            priceImpact = amountIn;
        } else {
            priceImpact = (amountIn * 1e4) / (liquidity + 1);
        }
    }

    function _poolKey(address tokenIn, address tokenOut, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut, fee));
    }

    function _decimals(address token) private view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 value) {
            return value;
        } catch {
            return 18;
        }
    }

    function _isStable(address token) private view returns (bool) {
        bytes32 symbolHash;
        try IERC20Metadata(token).symbol() returns (string memory symbol) {
            symbolHash = keccak256(bytes(symbol));
        } catch {
            return false;
        }
        return symbolHash == keccak256("USDC") || symbolHash == keccak256("USDT") || symbolHash == keccak256("DAI");
    }
}
