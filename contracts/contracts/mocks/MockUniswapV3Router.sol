// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
}

interface IMockUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function lastPriceX18() external view returns (uint256);
    function recordSwap(uint256 amountIn, uint256 amountOut) external;
}

/**
 * @title MockUniswapV3Router
 * @notice Small in-memory routing mock that mimics Uniswap V3's exactInputSingle behaviour
 *         without depending on on-chain liquidity. It tracks registered pools and uses the
 *         pool's pseudo price to determine the swap output.
 */
contract MockUniswapV3Router {
    struct PoolData {
        address pool;
        bool isToken0To1;
    }

    mapping(bytes32 => PoolData) private _pools;

    event PoolRegistered(address indexed tokenIn, address indexed tokenOut, uint24 fee, address pool);

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

    function registerPool(address pool) external {
        address token0 = IMockUniswapV3Pool(pool).token0();
        address token1 = IMockUniswapV3Pool(pool).token1();
        uint24 fee = IMockUniswapV3Pool(pool).fee();

        bytes32 forwardKey = _poolKey(token0, token1, fee);
        bytes32 reverseKey = _poolKey(token1, token0, fee);

        _pools[forwardKey] = PoolData({pool: pool, isToken0To1: true});
        _pools[reverseKey] = PoolData({pool: pool, isToken0To1: false});

        emit PoolRegistered(token0, token1, fee, pool);
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        require(params.recipient != address(0), "Invalid recipient");
        require(params.deadline >= block.timestamp, "Transaction too old");
        require(params.amountIn > 0, "Amount must be greater than zero");

        bytes32 key = _poolKey(params.tokenIn, params.tokenOut, params.fee);
        PoolData memory poolData = _pools[key];
        require(poolData.pool != address(0), "Pool not registered");

        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        uint256 priceX18 = IMockUniswapV3Pool(poolData.pool).lastPriceX18();
        if (poolData.isToken0To1) {
            amountOut = (params.amountIn * priceX18) / 1e18;
            IMockUniswapV3Pool(poolData.pool).recordSwap(params.amountIn, amountOut);
        } else {
            amountOut = (params.amountIn * 1e18) / priceX18;
            IMockUniswapV3Pool(poolData.pool).recordSwap(amountOut, params.amountIn);
        }

        require(amountOut >= params.amountOutMinimum, "Too little received");
        IMintableERC20(params.tokenOut).mint(params.recipient, amountOut);
    }

    function _poolKey(address tokenIn, address tokenOut, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut, fee));
    }
}
