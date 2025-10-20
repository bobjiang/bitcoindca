// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockUniswapV3Pool
 * @notice Simplified Uniswap V3 pool model used for deterministic adapter/oracle tests.
 *         Tracks token pair metadata, configurable liquidity and maintains a rolling set
 *         of price observations to support TWAP style computations.
 */
contract MockUniswapV3Pool {
    struct Observation {
        uint32 timestamp;
        uint256 priceX18; // token1 per token0 scaled by 1e18
    }

    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    uint256 public liquidity; // pseudo-liquidity metric for tests
    uint256 public lastPriceX18;

    Observation[] internal _observations;

    event PriceRecorded(uint256 priceX18, uint32 timestamp);
    event LiquidityUpdated(uint256 liquidity);

    constructor(address token0_, address token1_, uint24 fee_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
        // Default to 40k token1 per token0 when deployed (e.g. USDC→WBTC)
        lastPriceX18 = 40_000 * 1e18;
        _observations.push(Observation({timestamp: uint32(block.timestamp), priceX18: lastPriceX18}));
        liquidity = 10_000_000 * 1e6; // arbitrary large default
    }

    function recordPrice(uint256 priceX18) external {
        lastPriceX18 = priceX18;
        _observations.push(Observation({timestamp: uint32(block.timestamp), priceX18: priceX18}));
        emit PriceRecorded(priceX18, uint32(block.timestamp));
    }

    function recordSwap(uint256 amountIn, uint256 amountOut) external {
        if (amountIn == 0 || amountOut == 0) {
            return;
        }

        uint256 priceX18 = (amountOut * 1e18) / amountIn;
        lastPriceX18 = priceX18;
        _observations.push(Observation({timestamp: uint32(block.timestamp), priceX18: priceX18}));
        emit PriceRecorded(priceX18, uint32(block.timestamp));

        if (amountIn > liquidity / 10) {
            // crude liquidity depletion model
            liquidity = liquidity > amountIn ? liquidity - amountIn : 0;
            emit LiquidityUpdated(liquidity);
        }
    }

    function setLiquidity(uint256 newLiquidity) external {
        liquidity = newLiquidity;
        emit LiquidityUpdated(newLiquidity);
    }

    function observationCount() external view returns (uint256) {
        return _observations.length;
    }

    function getAveragePrice(uint32 window) external view returns (uint256) {
        require(window > 0, "Invalid window");
        uint256 cutoff = block.timestamp - window;
        uint256 sum;
        uint256 count;

        for (uint256 i = _observations.length; i > 0; ) {
            Observation memory obs = _observations[i - 1];
            if (obs.timestamp < cutoff) {
                break;
            }
            sum += obs.priceX18;
            count += 1;
            unchecked {
                --i;
            }
        }

        if (count == 0) {
            return lastPriceX18;
        }

        return sum / count;
    }
}
