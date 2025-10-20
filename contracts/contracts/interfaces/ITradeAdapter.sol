// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITradeAdapter
 * @notice Minimal interface implemented by routing adapters so the executor
 *         can perform exact-input swaps in a venue-agnostic fashion.
 */
interface ITradeAdapter {
    function swapExactTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}
