import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFullSystemFixture } from "../../fixtures/deployments";
import { advanceTime } from "../../helpers/utils";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * CoWAdapter Contract Tests
 *
 * Tests cover:
 * - Order creation and submission
 * - Partial fill support (key feature)
 * - MEV protection verification
 * - Order settlement and cancellation
 * - Batch auction participation
 * - Price estimation
 * - Error handling
 */
describe("CoWAdapter", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "CoWAdapter");
  });

  describe("Deployment and Initialization", function () {
    it("should deploy with correct CoW Settlement reference", async function () {
      const { cowAdapter, dexs } = await loadFixture(deployFullSystemFixture);

      expect(await cowAdapter.cowSettlement()).to.equal(await dexs.cowSettlement.getAddress());
    });

    it("should set correct adapter type", async function () {
      const { cowAdapter } = await loadFixture(deployFullSystemFixture);

      expect(await cowAdapter.adapterType()).to.equal("COW_PROTOCOL");
    });

    it("should support MEV protection", async function () {
      const { cowAdapter } = await loadFixture(deployFullSystemFixture);

      expect(await cowAdapter.supportsMEVProtection()).to.be.true;
    });
  });

  describe("Order Creation", function () {
    it("should create valid CoW order", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell", // sell order
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      // Approve CoW Settlement
      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      await expect(cowAdapter.connect(user1).createOrder(orderParams))
        .to.emit(cowAdapter, "OrderCreated")
        .withArgs(expect.any(String), orderParams.sellToken, orderParams.buyToken);
    });

    it("should return order ID on creation", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder.staticCall(orderParams);

      expect(orderId).to.not.equal(ethers.ZeroHash);
    });

    it("should set order as partially fillable", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("5000", 6), // Large amount
        buyAmount: ethers.parseUnits("0.12", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("5", 6),
        kind: "sell",
        partiallyFillable: true, // Enable partial fills
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      const order = await cowAdapter.getOrder(orderId);

      expect(order.partiallyFillable).to.be.true;
    });

    it("should revert if sell amount is zero", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: 0,
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: 0,
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await expect(cowAdapter.connect(user1).createOrder(orderParams)).to.be.revertedWith(
        "Amount must be greater than zero"
      );
    });

    it("should revert if validTo is in the past", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) - 3600, // Past
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await expect(cowAdapter.connect(user1).createOrder(orderParams)).to.be.revertedWith(
        "Order expired"
      );
    });
  });

  describe("Partial Fill Support", function () {
    it("should track partial fill progress", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("10000", 6),
        buyAmount: ethers.parseUnits("0.24", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("10", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      // Simulate partial fill
      const fillAmount = ethers.parseUnits("0.12", 8); // 50% fill

      await cowAdapter.simulatePartialFill(orderId, fillAmount);

      const fillStatus = await cowAdapter.getPartialFillStatus(orderId);

      expect(fillStatus.filledAmount).to.equal(fillAmount);
      expect(fillStatus.isComplete).to.be.false;
    });

    it("should mark order as complete when fully filled", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      // Fill completely
      await cowAdapter.simulatePartialFill(orderId, orderParams.buyAmount);

      const fillStatus = await cowAdapter.getPartialFillStatus(orderId);

      expect(fillStatus.filledAmount).to.equal(orderParams.buyAmount);
      expect(fillStatus.isComplete).to.be.true;
    });

    it("should allow multiple partial fills", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("10000", 6),
        buyAmount: ethers.parseUnits("0.24", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("10", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      // First fill: 25%
      await cowAdapter.simulatePartialFill(orderId, ethers.parseUnits("0.06", 8));

      // Second fill: 25%
      await cowAdapter.simulatePartialFill(orderId, ethers.parseUnits("0.06", 8));

      // Third fill: 50%
      await cowAdapter.simulatePartialFill(orderId, ethers.parseUnits("0.12", 8));

      const fillStatus = await cowAdapter.getPartialFillStatus(orderId);

      expect(fillStatus.filledAmount).to.equal(ethers.parseUnits("0.24", 8));
      expect(fillStatus.isComplete).to.be.true;
    });

    it("should revert if partial fills disabled", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false, // Disabled
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      await expect(
        cowAdapter.simulatePartialFill(orderId, ethers.parseUnits("0.012", 8))
      ).to.be.revertedWith("Partial fills not allowed");
    });
  });

  describe("MEV Protection", function () {
    it("should verify order has MEV protection", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      const isMEVProtected = await cowAdapter.isMEVProtected(orderId);

      expect(isMEVProtected).to.be.true;
    });

    it("should participate in batch auction", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      const batchId = await cowAdapter.getBatchId(orderId);

      expect(batchId).to.not.equal(0);
    });
  });

  describe("Order Settlement", function () {
    it("should settle order successfully", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      const balanceBefore = await tokens.wbtc.balanceOf(user1.address);

      await expect(cowAdapter.settleOrder(orderId))
        .to.emit(cowAdapter, "OrderSettled")
        .withArgs(orderId, expect.any(BigInt));

      const balanceAfter = await tokens.wbtc.balanceOf(user1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should get settlement time for order", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      const settlementTime = await cowAdapter.getSettlementTime(orderId);

      expect(settlementTime).to.be.gt(0);
    });

    it("should revert if order already settled", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      await cowAdapter.settleOrder(orderId);

      await expect(cowAdapter.settleOrder(orderId)).to.be.revertedWith("Order already settled");
    });
  });

  describe("Order Cancellation", function () {
    it("should cancel order successfully", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: true,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      await expect(cowAdapter.connect(user1).cancelOrder(orderId))
        .to.emit(cowAdapter, "OrderCancelled")
        .withArgs(orderId);
    });

    it("should revert if non-owner tries to cancel", async function () {
      const { cowAdapter, tokens, user1, user2 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      await expect(cowAdapter.connect(user2).cancelOrder(orderId)).to.be.revertedWith(
        "Not order owner"
      );
    });
  });

  describe("Quote and Price Estimation", function () {
    it("should provide quote for order", async function () {
      const { cowAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const quote = await cowAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        ethers.parseUnits("1000", 6)
      );

      expect(quote.amountOut).to.be.gt(0);
      expect(quote.priceImpact).to.be.gte(0);
    });

    it("should estimate price impact for large orders", async function () {
      const { cowAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const smallQuote = await cowAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        ethers.parseUnits("100", 6)
      );

      const largeQuote = await cowAdapter.quote(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress(),
        ethers.parseUnits("10000", 6)
      );

      // CoW should have lower price impact than traditional AMM
      expect(largeQuote.priceImpact).to.be.lte(smallQuote.priceImpact * 5n); // Within reason
    });

    it("should check if asset pair is supported", async function () {
      const { cowAdapter, tokens } = await loadFixture(deployFullSystemFixture);

      const isSupported = await cowAdapter.supportsAssetPair(
        await tokens.usdc.getAddress(),
        await tokens.wbtc.getAddress()
      );

      expect(isSupported).to.be.true;
    });
  });

  describe("Error Handling", function () {
    it("should revert if order is expired", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: ethers.parseUnits("1000", 6),
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 60, // 1 minute
        appData: ethers.ZeroHash,
        feeAmount: ethers.parseUnits("1", 6),
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      await tokens.usdc
        .connect(user1)
        .approve(await cowAdapter.cowSettlement(), orderParams.sellAmount + orderParams.feeAmount);

      const orderId = await cowAdapter.connect(user1).createOrder(orderParams);

      // Advance time past expiry
      await advanceTime(120);

      await expect(cowAdapter.settleOrder(orderId)).to.be.revertedWith("Order expired");
    });

    it("should handle insufficient balance gracefully", async function () {
      const { cowAdapter, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      const balance = await tokens.usdc.balanceOf(user1.address);
      const excessiveAmount = balance + ethers.parseUnits("1", 6);

      const orderParams = {
        sellToken: await tokens.usdc.getAddress(),
        buyToken: await tokens.wbtc.getAddress(),
        sellAmount: excessiveAmount,
        buyAmount: ethers.parseUnits("0.024", 8),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: ethers.ZeroHash,
        feeAmount: 0,
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      };

      // Approve even though balance is insufficient
      await tokens.usdc.connect(user1).approve(await cowAdapter.cowSettlement(), excessiveAmount);

      await expect(cowAdapter.connect(user1).createOrder(orderParams)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });
  });
});
