import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFullSystemFixture, deployMinimalFixture } from "../../fixtures/deployments";
import { setupMockDEXs } from "../../helpers/mocks";
import { advanceTime, calculateSlippage, encodeRoutePath } from "../../helpers/utils";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";
import { ROLES } from "../../helpers/constants";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * UniV3Adapter Contract Tests
 *
 * Tests cover:
 * - Swap execution with various fee tiers
 * - TWAP calculations
 * - Slippage protection
 * - Flashbots integration
 * - Liquidity checks
 * - Error handling
 * - Price impact estimation
 * - Gas optimization
 */
describe("UniV3Adapter", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "UniV3Adapter");
  });

  describe("Deployment and Initialization", function () {
    it("should deploy with correct Uniswap router reference", async function () {
      const { uniV3Adapter, dexs } = await loadFixture(deployFullSystemFixture);

      expect(await uniV3Adapter.uniswapRouter()).to.equal(await dexs.uniswapRouter.getAddress());
    });

    it("should set correct adapter type", async function () {
      const { uniV3Adapter } = await loadFixture(deployFullSystemFixture);

      expect(await uniV3Adapter.adapterType()).to.equal("UNISWAP_V3");
    });
  });

  describe("Swap Execution", function () {
    it("should execute basic swap successfully", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6); // 100 USDC
      const minAmountOut = ethers.parseUnits("0.0024", 8); // ~0.0025 WBTC with slippage

      // Approve adapter
      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: minAmountOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams))
        .to.emit(uniV3Adapter, "SwapExecuted")
        .withArgs(
          swapParams.tokenIn,
          swapParams.tokenOut,
          swapParams.amountIn,
          expect.any(BigInt),
          user1.address
        );
    });

    it("should return actual amount out", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: minAmountOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      const amountOut = await uniV3Adapter.connect(user1).executeSwap.staticCall(swapParams);

      expect(amountOut).to.be.gte(minAmountOut);
    });

    it("should transfer output tokens to recipient", async function () {
      const { uniV3Adapter, tokens, user1, user2 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const balanceBefore = await tokens.wbtc.balanceOf(user2.address);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: minAmountOut,
        recipient: user2.address, // Different recipient
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await uniV3Adapter.connect(user1).executeSwap(swapParams);

      const balanceAfter = await tokens.wbtc.balanceOf(user2.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should revert if slippage exceeds limit", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const unrealisticMinOut = ethers.parseUnits("1", 8); // Unrealistically high

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: unrealisticMinOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "Too little received"
      );
    });

    it("should revert if deadline has passed", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: minAmountOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) - 3600, // Past deadline
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "Transaction too old"
      );
    });

    it("should handle zero input amount", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn: 0,
        amountOutMinimum: 0,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "Amount must be greater than zero"
      );
    });
  });

  describe("Fee Tier Selection", function () {
    it("should get optimal fee tier for pair", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const optimalFee = await uniV3Adapter.getOptimalFeeTier(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        ethers.parseUnits("100", 6)
      );

      // Should return one of: 500 (0.05%), 3000 (0.3%), 10000 (1%)
      expect([500, 3000, 10000]).to.include(Number(optimalFee));
    });

    it("should select low fee tier for stable pairs", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const feeTier = await uniV3Adapter.getOptimalFeeTier(
        await tokens.usdc.getAddress(),
        await tokens.dai.getAddress(),
        ethers.parseUnits("1000", 6)
      );

      expect(feeTier).to.equal(500); // 0.05% for stable pairs
    });

    it("should select higher fee tier for volatile pairs", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const feeTier = await uniV3Adapter.getOptimalFeeTier(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        ethers.parseUnits("100", 6)
      );

      expect(feeTier).to.be.gte(3000); // At least 0.3% for volatile pairs
    });

    it("should consider pool liquidity in tier selection", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const smallAmount = ethers.parseUnits("10", 6);
      const largeAmount = ethers.parseUnits("10000", 6);

      const smallFee = await uniV3Adapter.getOptimalFeeTier(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        smallAmount
      );

      const largeFee = await uniV3Adapter.getOptimalFeeTier(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount
      );

      // For large amounts, might need higher fee tier pools with more liquidity
      expect(largeFee).to.be.gte(smallFee);
    });
  });

  describe("TWAP Calculations", function () {
    it("should calculate TWAP price for pool", async function () {
      const { uniV3Adapter, dexs } = await loadFixture(deployFullSystemFixture);

      const twapWindow = 3600; // 1 hour

      const twapPrice = await uniV3Adapter.getTWAP(
        await dexs.uniswapPool.getAddress(),
        twapWindow
      );

      expect(twapPrice).to.be.gt(0);
    });

    it("should return consistent TWAP over short window", async function () {
      const { uniV3Adapter, dexs } = await loadFixture(deployFullSystemFixture);

      const twap1 = await uniV3Adapter.getTWAP(await dexs.uniswapPool.getAddress(), 300); // 5 min
      const twap2 = await uniV3Adapter.getTWAP(await dexs.uniswapPool.getAddress(), 300);

      expect(twap1).to.equal(twap2);
    });

    it("should reflect price changes in TWAP over time", async function () {
      const { uniV3Adapter, dexs, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const twapBefore = await uniV3Adapter.getTWAP(await dexs.uniswapPool.getAddress(), 300);

      // Execute large swap to change price
      const largeSwap = ethers.parseUnits("5000", 6);
      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), largeSwap);

      await uniV3Adapter.connect(user1).executeSwap({
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn: largeSwap,
        amountOutMinimum: 0,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      });

      // Advance time
      await advanceTime(600); // 10 minutes

      const twapAfter = await uniV3Adapter.getTWAP(await dexs.uniswapPool.getAddress(), 300);

      expect(twapAfter).to.not.equal(twapBefore);
    });

    it("should revert if TWAP window is too short", async function () {
      const { uniV3Adapter, dexs } = await loadFixture(deployFullSystemFixture);

      await expect(
        uniV3Adapter.getTWAP(await dexs.uniswapPool.getAddress(), 0)
      ).to.be.revertedWith("Invalid TWAP window");
    });

    it("should revert if pool doesn't exist", async function () {
      const { uniV3Adapter } = await loadFixture(deployFullSystemFixture);

      await expect(
        uniV3Adapter.getTWAP(ethers.ZeroAddress, 3600)
      ).to.be.revertedWith("Invalid pool");
    });
  });

  describe("Quote and Price Impact", function () {
    it("should provide accurate quote for swap", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      const quote = await uniV3Adapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        3000 // 0.3% fee
      );

      expect(quote.amountOut).to.be.gt(0);
      expect(quote.priceImpact).to.be.gte(0);
    });

    it("should estimate price impact correctly", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const smallAmount = ethers.parseUnits("10", 6);
      const largeAmount = ethers.parseUnits("10000", 6);

      const smallQuote = await uniV3Adapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        smallAmount,
        3000
      );

      const largeQuote = await uniV3Adapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        largeAmount,
        3000
      );

      // Large swap should have higher price impact
      expect(largeQuote.priceImpact).to.be.gt(smallQuote.priceImpact);
    });

    it("should check if pair is supported", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const isSupported = await uniV3Adapter.supportsAssetPair(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress()
      );

      expect(isSupported).to.be.true;
    });

    it("should return false for unsupported pairs", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      // Use random address as unsupported token
      const randomToken = ethers.Wallet.createRandom().address;

      const isSupported = await uniV3Adapter.supportsAssetPair(
        await tokens.usdc.getAddress(),
        randomToken
      );

      expect(isSupported).to.be.false;
    });
  });

  describe("Flashbots Integration", function () {
    it("should execute swap via Flashbots", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);
      const minAmountOut = ethers.parseUnits("0.0024", 8);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const flashbotsParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: minAmountOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
        useFlashbots: true,
      };

      await expect(uniV3Adapter.connect(user1).executeSwapWithFlashbots(flashbotsParams))
        .to.emit(uniV3Adapter, "FlashbotsSwapExecuted")
        .withArgs(flashbotsParams.tokenIn, flashbotsParams.tokenOut, flashbotsParams.amountIn);
    });

    it("should provide MEV protection with Flashbots", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("1000", 6);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      // Get quote without Flashbots
      const normalQuote = await uniV3Adapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        3000
      );

      // Execute with Flashbots should get at least as good a price
      const flashbotsParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: normalQuote.amountOut,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
        useFlashbots: true,
      };

      await expect(
        uniV3Adapter.connect(user1).executeSwapWithFlashbots(flashbotsParams)
      ).to.not.be.reverted;
    });
  });

  describe("Liquidity Checks", function () {
    it("should check if pool has sufficient liquidity", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      const hasLiquidity = await uniV3Adapter.checkLiquidity(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        amountIn,
        3000
      );

      expect(hasLiquidity).to.be.true;
    });

    it("should return false for insufficient liquidity", async function () {
      const { uniV3Adapter, tokens } = await loadFixture(deployFullSystemFixture);

      const massiveAmount = ethers.parseUnits("1000000000", 6); // 1 billion USDC

      const hasLiquidity = await uniV3Adapter.checkLiquidity(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        massiveAmount,
        3000
      );

      expect(hasLiquidity).to.be.false;
    });
  });

  describe("Error Handling", function () {
    it("should revert if insufficient allowance", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      // Don't approve

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: 0,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "ERC20: insufficient allowance"
      );
    });

    it("should revert if insufficient balance", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const balance = await tokens.usdc.balanceOf(user1.address);
      const excessiveAmount = balance + ethers.parseUnits("1", 6);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), excessiveAmount);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn: excessiveAmount,
        amountOutMinimum: 0,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });

    it("should revert if recipient is zero address", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("100", 6);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: 0,
        recipient: ethers.ZeroAddress,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      await expect(uniV3Adapter.connect(user1).executeSwap(swapParams)).to.be.revertedWith(
        "Invalid recipient"
      );
    });
  });

  describe("Gas Optimization", function () {
    it("should use gas efficiently for small swaps", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const amountIn = ethers.parseUnits("10", 6);

      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), amountIn);

      const swapParams = {
        tokenIn: await tokens.usdc.getAddress(),
        tokenOut: await tokens.wbtc.getAddress(),
        amountIn,
        amountOutMinimum: 0,
        recipient: user1.address,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        sqrtPriceLimitX96: 0,
      };

      const tx = await uniV3Adapter.connect(user1).executeSwap(swapParams);
      const receipt = await tx.wait();

      // Gas should be reasonable (< 200k for simple swap)
      expect(receipt.gasUsed).to.be.lt(200000n);
    });

    it("should batch multiple swaps efficiently", async function () {
      const { uniV3Adapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const swaps = [
        {
          tokenIn: await tokens.usdc.getAddress(),
          tokenOut: await tokens.wbtc.getAddress(),
          amountIn: ethers.parseUnits("50", 6),
          amountOutMinimum: 0,
          recipient: user1.address,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          sqrtPriceLimitX96: 0,
        },
        {
          tokenIn: await tokens.usdc.getAddress(),
          tokenOut: await tokens.wbtc.getAddress(),
          amountIn: ethers.parseUnits("50", 6),
          amountOutMinimum: 0,
          recipient: user1.address,
          deadline: Math.floor(Date.now() / 1000) + 3600,
          sqrtPriceLimitX96: 0,
        },
      ];

      const totalAmount = ethers.parseUnits("100", 6);
      await tokens.usdc.connect(user1).approve(await uniV3Adapter.getAddress(), totalAmount);

      const tx = await uniV3Adapter.connect(user1).batchSwap(swaps);
      const receipt = await tx.wait();

      // Batched swaps should be more efficient than individual swaps
      expect(receipt.gasUsed).to.be.lt(350000n); // Less than 2x individual swap
    });
  });
});
