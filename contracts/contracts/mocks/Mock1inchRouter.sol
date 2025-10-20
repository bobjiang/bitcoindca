// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Mock1inchRouter
 * @notice Lightweight 1inch style router used exclusively in unit tests. It
 *         exposes a deterministic price feed that can be tweaked by tests and
 *         performs basic token swaps by minting the destination asset. The
 *         real aggregation logic is implemented inside the adapter under test;
 *         this mock simply provides a predictable environment.
 */
contract Mock1inchRouter {
    uint256 public priceX18 = 40_000 * 1e18; // default price: 1 WBTC = 40k quote units

    event PriceUpdated(uint256 priceX18);
    event SwapPerformed(address indexed caller, address indexed srcToken, address indexed dstToken, uint256 amountIn, uint256 amountOut);

    /**
     * @notice Allows tests to adjust the reference price (scaled by 1e18).
     */
    function setPrice(uint256 newPriceX18) external {
        require(newPriceX18 > 0, "Invalid price");
        priceX18 = newPriceX18;
        emit PriceUpdated(newPriceX18);
    }

    /**
     * @notice Performs a naive swap by transferring the input tokens from the
     *         caller and returning the deterministic output amount. The adapter
     *         handles actual distribution; this helper simply emits an event so
     *         tests can assert behaviour when needed.
     */
    function swap(address srcToken, address dstToken, uint256 amountIn, address payer) external returns (uint256 amountOut) {
        require(srcToken != address(0) && dstToken != address(0), "Invalid token");
        require(payer != address(0), "Invalid payer");
        require(amountIn > 0, "Zero amount");

        IERC20(srcToken).transferFrom(payer, address(this), amountIn);

        // dst amount = amountIn / price (assumes src is 6dp stable, dst 8dp asset)
        amountOut = (amountIn * 1e18) / priceX18;

        emit SwapPerformed(msg.sender, srcToken, dstToken, amountIn, amountOut);
    }

    /**
     * @notice Pure helper that returns the deterministic quote calculation used
     *         internally. Adapters can rely on this for expected return checks.
     */
    function getExpectedReturn(uint256 amountIn) external view returns (uint256) {
        if (priceX18 == 0) return 0;
        return (amountIn * 1e18) / priceX18;
    }
}
