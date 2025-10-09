import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture, deployMinimalFixture } from "../../fixtures/deployments";
import { setupMockPriceFeeds, createMockPriceData } from "../../helpers/mocks";
import { advanceTime } from "../../helpers/utils";
import {
  ROLES,
  MAX_ORACLE_STALENESS,
  BTC_PRICE_USD,
  ETH_PRICE_USD,
  USDC_PRICE_USD,
} from "../../helpers/constants";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * PriceOracle Contract Tests
 *
 * Tests cover:
 * - Chainlink price feed integration
 * - TWAP calculations
 * - Price validation and staleness checks
 * - Deviation detection
 * - Depeg detection for stablecoins
 * - Multi-source price aggregation
 * - Oracle management (add/remove/update feeds)
 */
describe("PriceOracle", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "PriceOracle");
  });
  describe("Deployment and Initialization", function () {
    it("should deploy successfully", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      expect(await priceOracle.getAddress()).to.not.equal(ethers.ZeroAddress);
    });

    it("should set max staleness", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      expect(await priceOracle.maxStaleness()).to.equal(MAX_ORACLE_STALENESS);
    });
  });

  describe("Chainlink Price Feeds", function () {
    it("should get BTC/USD price from Chainlink", async function () {
      const { priceOracle, priceFeeds, tokens } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getChainlinkPrice(
        await priceFeeds.btcUsdFeed.getAddress()
      );

      expect(price).to.equal(BTC_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should get ETH/USD price from Chainlink", async function () {
      const { priceOracle, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getChainlinkPrice(
        await priceFeeds.ethUsdFeed.getAddress()
      );

      expect(price).to.equal(ETH_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should get USDC/USD price from Chainlink", async function () {
      const { priceOracle, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getChainlinkPrice(
        await priceFeeds.usdcUsdFeed.getAddress()
      );

      expect(price).to.equal(USDC_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should revert if price feed address is invalid", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle.getChainlinkPrice(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid price feed");
    });

    it("should revert if price is zero or negative", async function () {
      const { deployer } = await loadFixture(deployMinimalFixture);

      const PriceOracle = await ethers.getContractFactory("PriceOracle");
      const priceOracle = await PriceOracle.deploy();

      // Deploy mock feed with zero price
      const MockChainlinkFeed = await ethers.getContractFactory("MockChainlinkAggregator");
      const feed = await MockChainlinkFeed.deploy(8, 0); // Zero price

      await expect(
        priceOracle.getChainlinkPrice(await feed.getAddress())
      ).to.be.revertedWith("Invalid price");
    });
  });

  describe("Price Feed Management", function () {
    it("should allow admin to add price feed", async function () {
      const { priceOracle, tokens, priceFeeds, deployer } =
        await loadFixture(deployBaseSystemFixture);

      const newToken = await tokens.dai.getAddress();
      const newFeed = await priceFeeds.usdcUsdFeed.getAddress(); // Reuse USDC feed for DAI

      await expect(priceOracle.connect(deployer).addPriceFeed(newToken, newFeed))
        .to.emit(priceOracle, "PriceFeedAdded")
        .withArgs(newToken, newFeed);

      expect(await priceOracle.getPriceFeed(newToken)).to.equal(newFeed);
    });

    it("should allow admin to update price feed", async function () {
      const { priceOracle, tokens, priceFeeds, deployer } =
        await loadFixture(deployBaseSystemFixture);

      const token = await tokens.wbtc.getAddress();
      const newFeed = await priceFeeds.ethUsdFeed.getAddress();

      await expect(priceOracle.connect(deployer).updatePriceFeed(token, newFeed))
        .to.emit(priceOracle, "PriceFeedUpdated")
        .withArgs(token, newFeed);

      expect(await priceOracle.getPriceFeed(token)).to.equal(newFeed);
    });

    it("should allow admin to remove price feed", async function () {
      const { priceOracle, tokens, deployer } = await loadFixture(deployBaseSystemFixture);

      const token = await tokens.wbtc.getAddress();

      await expect(priceOracle.connect(deployer).removePriceFeed(token))
        .to.emit(priceOracle, "PriceFeedRemoved")
        .withArgs(token);

      expect(await priceOracle.getPriceFeed(token)).to.equal(ethers.ZeroAddress);
    });

    it("should revert if non-admin tries to add feed", async function () {
      const { priceOracle, tokens, priceFeeds, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle
          .connect(user1)
          .addPriceFeed(await tokens.dai.getAddress(), await priceFeeds.usdcUsdFeed.getAddress())
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should revert if adding feed for zero address token", async function () {
      const { priceOracle, priceFeeds, deployer } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle
          .connect(deployer)
          .addPriceFeed(ethers.ZeroAddress, await priceFeeds.btcUsdFeed.getAddress())
      ).to.be.revertedWith("Invalid token address");
    });

    it("should revert if adding zero address feed", async function () {
      const { priceOracle, tokens, deployer } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle.connect(deployer).addPriceFeed(await tokens.dai.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid feed address");
    });
  });

  describe("Price Staleness Validation", function () {
    it("should validate fresh price data", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const currentTime = Math.floor(Date.now() / 1000);

      const valid = await priceOracle.validatePriceStaleness(currentTime);

      expect(valid).to.be.true;
    });

    it("should reject stale price data", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const staleTime = Math.floor(Date.now() / 1000) - MAX_ORACLE_STALENESS - 100;

      const valid = await priceOracle.validatePriceStaleness(staleTime);

      expect(valid).to.be.false;
    });

    it("should allow admin to update max staleness", async function () {
      const { priceOracle, deployer } = await loadFixture(deployBaseSystemFixture);

      const newStaleness = 3600; // 1 hour

      await priceOracle.connect(deployer).setMaxStaleness(newStaleness);

      expect(await priceOracle.maxStaleness()).to.equal(newStaleness);
    });
  });

  describe("Price Deviation Validation", function () {
    it("should validate prices within deviation limit", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("40000", 8); // $40,000
      const price2 = ethers.parseUnits("40200", 8); // $40,200 (0.5% diff)
      const maxDeviationBps = 100; // 1%

      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      expect(valid).to.be.true;
      expect(deviationBps).to.be.lte(maxDeviationBps);
    });

    it("should reject prices exceeding deviation limit", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("40000", 8); // $40,000
      const price2 = ethers.parseUnits("41000", 8); // $41,000 (2.5% diff)
      const maxDeviationBps = 100; // 1%

      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      expect(valid).to.be.false;
      expect(deviationBps).to.be.gt(maxDeviationBps);
    });

    it("should calculate deviation in basis points correctly", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("100", 8);
      const price2 = ethers.parseUnits("101", 8); // 1% difference

      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        200 // 2% max
      );

      expect(deviationBps).to.equal(100); // 1% = 100 bps
      expect(valid).to.be.true;
    });

    it("should handle zero prices safely", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        0,
        ethers.parseUnits("100", 8),
        100
      );

      expect(valid).to.be.false;
    });
  });

  describe("Stable Token Depeg Detection", function () {
    it("should detect when stablecoin is pegged", async function () {
      const { priceOracle, tokens } = await loadFixture(deployBaseSystemFixture);

      const [isDepegged, deviationBps] = await priceOracle.checkDepeg(
        await tokens.usdc.getAddress(),
        100 // 1% threshold
      );

      expect(isDepegged).to.be.false;
      expect(deviationBps).to.be.lte(100);
    });

    it("should detect when stablecoin is depegged", async function () {
      const { priceOracle, tokens, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      // Set USDC price to $0.97 (3% depeg)
      await priceFeeds.usdcUsdFeed.updateAnswer(ethers.parseUnits("0.97", 8));

      const [isDepegged, deviationBps] = await priceOracle.checkDepeg(
        await tokens.usdc.getAddress(),
        100 // 1% threshold
      );

      expect(isDepegged).to.be.true;
      expect(deviationBps).to.be.gt(100);
    });

    it("should handle upward depeg", async function () {
      const { priceOracle, tokens, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      // Set USDC price to $1.03 (3% upward depeg)
      await priceFeeds.usdcUsdFeed.updateAnswer(ethers.parseUnits("1.03", 8));

      const [isDepegged, deviationBps] = await priceOracle.checkDepeg(
        await tokens.usdc.getAddress(),
        100 // 1% threshold
      );

      expect(isDepegged).to.be.true;
      expect(deviationBps).to.be.gt(100);
    });
  });

  describe("TWAP Calculations", function () {
    it("should calculate Uniswap V3 TWAP", async function () {
      const { priceOracle, dexs } = await loadFixture(deployBaseSystemFixture);

      const twapWindow = 3600; // 1 hour

      const twapPrice = await priceOracle.getUniswapV3TWAP(
        await dexs.uniswapPool.getAddress(),
        twapWindow
      );

      expect(twapPrice).to.be.gt(0);
    });

    it("should calculate TWAP for token pair", async function () {
      const { priceOracle, tokens, dexs } = await loadFixture(deployBaseSystemFixture);

      const token0 = await tokens.usdc.getAddress();
      const token1 = await tokens.wbtc.getAddress();
      const fee = 3000; // 0.3%
      const twapWindow = 3600;

      const twapPrice = await priceOracle.getTWAP(token0, token1, fee, twapWindow);

      expect(twapPrice).to.be.gt(0);
    });

    it("should revert if TWAP window is zero", async function () {
      const { priceOracle, dexs } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle.getUniswapV3TWAP(await dexs.uniswapPool.getAddress(), 0)
      ).to.be.revertedWith("Invalid TWAP window");
    });

    it("should revert if pool address is invalid", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle.getUniswapV3TWAP(ethers.ZeroAddress, 3600)
      ).to.be.revertedWith("Invalid pool address");
    });
  });

  describe("Price Aggregation", function () {
    it("should aggregate prices from multiple sources", async function () {
      const { priceOracle, tokens } = await loadFixture(deployBaseSystemFixture);

      const [price, confidence] = await priceOracle.getAggregatedPrice(
        await tokens.wbtc.getAddress(),
        95 // 95% confidence
      );

      expect(price).to.be.gt(0);
      expect(confidence).to.be.gte(95);
    });

    it("should return lower confidence when sources disagree", async function () {
      const { priceOracle, tokens, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      // Update one feed to significantly different price
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("35000", 8));

      const [price, confidence] = await priceOracle.getAggregatedPrice(
        await tokens.wbtc.getAddress(),
        95
      );

      expect(confidence).to.be.lt(95);
    });
  });

  describe("Convenience Functions", function () {
    it("should get BTC price directly", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getBTCPrice();

      expect(price).to.equal(BTC_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should get ETH price directly", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getETHPrice();

      expect(price).to.equal(ETH_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should get USDC price directly", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getUSDCPrice();

      expect(price).to.equal(USDC_PRICE_USD);
      expect(timestamp).to.be.gt(0);
    });

    it("should get WBTC price directly", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const [price, timestamp] = await priceOracle.getWBTCPrice();

      expect(price).to.be.gt(0);
      expect(timestamp).to.be.gt(0);
    });
  });

  describe("Access Control", function () {
    it("should only allow oracle admin to update settings", async function () {
      const { priceOracle, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle.connect(user1).setMaxStaleness(7200)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should only allow oracle admin to manage feeds", async function () {
      const { priceOracle, tokens, priceFeeds, user1 } =
        await loadFixture(deployBaseSystemFixture);

      await expect(
        priceOracle
          .connect(user1)
          .addPriceFeed(await tokens.dai.getAddress(), await priceFeeds.usdcUsdFeed.getAddress())
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should allow admin to grant oracle admin role", async function () {
      const { priceOracle, deployer, user1 } = await loadFixture(deployBaseSystemFixture);

      await priceOracle.connect(deployer).grantRole(ROLES.ORACLE_ADMIN, user1.address);

      expect(await priceOracle.hasRole(ROLES.ORACLE_ADMIN, user1.address)).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("should handle price updates during high volatility", async function () {
      const { priceOracle, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      // Simulate rapid price updates
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("41000", 8));
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("39000", 8));
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("40500", 8));

      const [price, timestamp] = await priceOracle.getChainlinkPrice(
        await priceFeeds.btcUsdFeed.getAddress()
      );

      expect(price).to.equal(ethers.parseUnits("40500", 8));
    });

    it("should handle very small price differences", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("1.000000", 8);
      const price2 = ethers.parseUnits("1.000001", 8);

      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        10 // 0.1%
      );

      expect(valid).to.be.true;
      expect(deviationBps).to.be.lt(1); // Less than 1 bps
    });

    it("should handle very large prices", async function () {
      const { priceOracle, priceFeeds } = await loadFixture(deployBaseSystemFixture);

      const largePrice = ethers.parseUnits("1000000", 8); // $1M BTC

      await priceFeeds.btcUsdFeed.updateAnswer(largePrice);

      const [price, timestamp] = await priceOracle.getChainlinkPrice(
        await priceFeeds.btcUsdFeed.getAddress()
      );

      expect(price).to.equal(largePrice);
    });
  });
});
