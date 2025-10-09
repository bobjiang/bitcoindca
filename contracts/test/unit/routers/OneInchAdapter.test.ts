import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFullSystemFixture } from "../../fixtures/deployments";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * OneInchAdapter Contract Tests
 *
 * Tests cover:
 * - Multi-DEX aggregation
 * - Optimal route finding
 * - Fallback swap execution
 * - Multi-hop routing
 * - Error handling and recovery
 * - Gas optimization
 */
describe("OneInchAdapter", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "OneInchAdapter");
  });

  describe("Deployment and Initialization", function () {
    it("should deploy with correct 1inch router reference", async function () {
      const { oneInchAdapter, dexs } = await loadFixture(deployFullSystemFixture);

      expect(await oneInchAdapter.oneInchRouter()).to.equal(
        await dexs.oneInchRouter.getAddress()
      );
    });

    it("should set correct adapter type", async function () {
      const { oneInchAdapter } = await loadFixture(deployFullSystemFixture);

      expect(await oneInchAdapter.adapterType()).to.equal("ONE_INCH_AGGREGATOR");
    });

    it("should support multi-DEX routing", async function () {
      const { oneInchAdapter } = await loadFixture(deployFullSystemFixture);

      expect(await oneInchAdapter.supportsMultiDEX()).to.be.true;
    });
  });

  describe("Swap Execution", function () {
    it("should execute swap via 1inch aggregator", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: minAmountOut,
        flags: 0,
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams))
        .to.emit(oneInchAdapter, "SwapExecuted")
        .withArgs(swapParams.srcToken, swapParams.dstToken, swapParams.amount);
    });

    it("should return actual amount out", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: minAmountOut,
        flags: 0,
        recipient: user1.address,
      };

      const amountOut = await oneInchAdapter.connect(user1).swap.staticCall(swapParams);

      expect(amountOut).to.be.gte(minAmountOut);
    });

    it("should use optimal route from multiple DEXs", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("1000", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      // Get route distribution
      const route = await oneInchAdapter.getOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn
      );

      expect(route.dexs.length).to.be.gt(0);
      expect(route.distribution.length).to.be.gt(0);
    });

    it("should handle slippage protection", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const unrealisticMinOut = ethers.parseUnits("1", 8); // Too high

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: unrealisticMinOut,
        flags: 0,
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams)).to.be.revertedWith(
        "Return amount is not enough"
      );
    });
  });

  describe("Multi-Hop Routing", function () {
    it("should execute multi-hop swap", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      // USDC -> WETH -> WBTC (multi-hop)
      const multiHopParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 1, // Enable multi-hop
        recipient: user1.address,
        path: [
          await tokens.usdc.getAddress(),
          await tokens.weth.getAddress(),
          await tokens.wbtc.getAddress(),
        ],
      };

      await expect(oneInchAdapter.connect(user1).swapMultiHop(multiHopParams)).to.emit(
        oneInchAdapter,
        "MultiHopSwapExecuted"
      );
    });

    it("should optimize path for best price", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      // Direct route
      const directRoute = await oneInchAdapter.getExpectedReturn(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        10, // 10 parts for distribution
        0
      );

      // Multi-hop route (if better)
      const multiHopRoute = await oneInchAdapter.getExpectedReturnMultiHop(
        [
          await tokens.usdc.getAddress(),
          await tokens.weth.getAddress(),
          await tokens.wbtc.getAddress(),
        ],
        amountIn,
        10,
        0
      );

      // Should return whichever is better
      expect(directRoute.returnAmount).to.be.gt(0);
      expect(multiHopRoute.returnAmount).to.be.gt(0);
    });

    it("should handle complex routing paths", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("1000", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const complexPath = [
        await tokens.usdc.getAddress(),
        await tokens.dai.getAddress(),
        await tokens.weth.getAddress(),
        await tokens.wbtc.getAddress(),
      ];

      const multiHopParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 1,
        recipient: user1.address,
        path: complexPath,
      };

      await expect(oneInchAdapter.connect(user1).swapMultiHop(multiHopParams)).to.not.be.reverted;
    });
  });

  describe("Optimal Route Finding", function () {
    it("should find best route across multiple DEXs", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("1000", 6);

      const route = await oneInchAdapter.getOptimalRoute(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn
      );

      expect(route.dexs).to.not.be.empty;
      expect(route.expectedReturn).to.be.gt(0);
    });

    it("should distribute swap across multiple DEXs for better price", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const largeAmount = ethers.parseUnits("10000", 6);

      const expectedReturn = await oneInchAdapter.getExpectedReturn(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount,
        10, // Split into 10 parts
        0
      );

      // Should use multiple DEXs for large amount
      expect(expectedReturn.distribution.length).to.be.gt(0);

      // At least 2 DEXs should be used for large amount
      const nonZeroDistribution = expectedReturn.distribution.filter((d: bigint) => d > 0n);
      expect(nonZeroDistribution.length).to.be.gte(2);
    });

    it("should compare routes and select best one", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("500", 6);

      // Get expected returns with different part counts
      const parts5 = await oneInchAdapter.getExpectedReturn(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        5,
        0
      );

      const parts10 = await oneInchAdapter.getExpectedReturn(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        10,
        0
      );

      // More parts should give equal or better return (with more precision)
      expect(parts10.returnAmount).to.be.gte(parts5.returnAmount);
    });
  });

  describe("Fallback Scenarios", function () {
    it("should use 1inch when primary DEX fails", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      // Simulate fallback scenario
      const fallbackParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 2, // Fallback mode
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swapFallback(fallbackParams))
        .to.emit(oneInchAdapter, "FallbackSwapExecuted")
        .withArgs(fallbackParams.srcToken, fallbackParams.dstToken);
    });

    it("should retry with different route on failure", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      // Should succeed even if one route fails
      await expect(oneInchAdapter.connect(user1).swapWithRetry(swapParams)).to.not.be.reverted;
    });
  });

  describe("Quote and Price Estimation", function () {
    it("should provide accurate quote", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      const quote = await oneInchAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn
      );

      expect(quote.amountOut).to.be.gt(0);
      expect(quote.priceImpact).to.be.gte(0);
      expect(quote.gasEstimate).to.be.gt(0);
    });

    it("should estimate gas costs accurately", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const smallAmount = ethers.parseUnits("10", 6);
      const largeAmount = ethers.parseUnits("10000", 6);

      const smallQuote = await oneInchAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        smallAmount
      );

      const largeQuote = await oneInchAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount
      );

      // Large swaps may use more DEXs and consume more gas
      expect(largeQuote.gasEstimate).to.be.gte(smallQuote.gasEstimate);
    });

    it("should estimate price impact", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const smallAmount = ethers.parseUnits("10", 6);
      const largeAmount = ethers.parseUnits("10000", 6);

      const smallQuote = await oneInchAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        smallAmount
      );

      const largeQuote = await oneInchAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount
      );

      // Large swap should have higher price impact
      expect(largeQuote.priceImpact).to.be.gt(smallQuote.priceImpact);
    });

    it("should check if asset pair is supported", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const isSupported = await oneInchAdapter.supportsAssetPair(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress()
      );

      expect(isSupported).to.be.true;
    });
  });

  describe("Error Handling", function () {
    it("should revert if insufficient allowance", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      // Don't approve

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams)).to.be.revertedWith(
        "ERC20: insufficient allowance"
      );
    });

    it("should revert if insufficient balance", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const balance = await tokens.usdc.balanceOf(user1.address);
      const excessiveAmount = balance + ethers.parseUnits("1", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), excessiveAmount);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: excessiveAmount,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });

    it("should handle unsupported token pairs gracefully", async function () {
      const { oneInchAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const randomToken = ethers.Wallet.createRandom().address;

      const isSupported = await oneInchAdapter.supportsAssetPair(
        await tokens.usdc.getAddress(),
        randomToken
      );

      expect(isSupported).to.be.false;
    });

    it("should revert if no liquidity available", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const massiveAmount = ethers.parseUnits("1000000000", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), massiveAmount);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: massiveAmount,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams)).to.be.revertedWith(
        "Insufficient liquidity"
      );
    });

    it("should revert if recipient is zero address", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 0,
        recipient: ethers.ZeroAddress,
      };

      await expect(oneInchAdapter.connect(user1).swap(swapParams)).to.be.revertedWith(
        "Invalid recipient"
      );
    });
  });

  describe("Gas Optimization", function () {
    it("should optimize gas for single-DEX swaps", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("10", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      const tx = await oneInchAdapter.connect(user1).swap(swapParams);
      const receipt = await tx.wait();

      // Gas should be reasonable for simple swap
      expect(receipt.gasUsed).to.be.lt(250000n);
    });

    it("should minimize gas for multi-DEX splits", async function () {
      const { oneInchAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("5000", 6);

      await tokens.usdc.connect(user1).approve(await oneInchAdapter.getAddress(), amountIn);

      const swapParams = {
        srcToken: await tokens.usdc.getAddress(),
        dstToken: await tokens.wbtc.getAddress(),
        amount: amountIn,
        minReturnAmount: 0,
        flags: 0,
        recipient: user1.address,
      };

      const tx = await oneInchAdapter.connect(user1).swap(swapParams);
      const receipt = await tx.wait();

      // Should be efficient even with multiple DEXs
      expect(receipt.gasUsed).to.be.lt(500000n);
    });
  });
});
