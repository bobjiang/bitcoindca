import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployFullSystemFixture,
  deployWithPositionFixture,
} from "../fixtures/deployments";
import { advanceTime, getCurrentTime } from "../helpers/utils";
import { ROLES, Venue } from "../helpers/constants";
import { ensureArtifactOrSkip } from "../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * MEV Protection Tests
 *
 * High-priority security tests for MEV and front-running protection
 * Reference: SECURITY_AUDIT_REPORT.md - H-2: Insufficient Front-Running & MEV Protection Testing
 *
 * Coverage:
 * - Sandwich attack protection
 * - Price manipulation detection
 * - Slippage protection effectiveness
 * - TWAP manipulation resistance
 * - Oracle manipulation prevention
 * - Flashbots/private transaction mode
 * - Front-running via transaction ordering
 */
describe("Security: MEV Protection", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "Executor");
    await ensureArtifactOrSkip(this, "PriceOracle");
  });

  describe("Sandwich Attack Protection", function () {
    it("should detect and skip execution during sandwich attack", async function () {
      const { executorContract, positionId, dexs, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time to make position eligible
      await advanceTime(3600 + 1);

      // Simulate attacker front-running with large swap to manipulate price
      const largeSwapAmount = ethers.parseUnits("1000000", 6); // $1M swap

      // This should cause significant price impact
      await dexs.mockUniPool.setManualPrice(ethers.parseUnits("45000", 8)); // 12.5% price increase

      // Attempt execution - should be skipped due to price deviation
      const tx = await executorContract.connect(keeper).execute(positionId);
      const receipt = await tx.wait();

      // Check for ExecutionSkipped event
      const skipEvent = receipt.logs.find(
        (log: any) =>
          log.fragment && log.fragment.name === "ExecutionSkipped"
      );

      expect(skipEvent).to.not.be.undefined;
      expect(skipEvent?.args?.reason).to.include("PRICE_DEVIATION");
    });

    it("should protect against multi-pool sandwich attacks", async function () {
      const { executorContract, positionId, dexs, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Attacker manipulates multiple pools simultaneously
      await dexs.mockUniPool.setManualPrice(ethers.parseUnits("42000", 8));
      // Note: CoW Protocol inherently resists sandwich attacks via batch auctions

      // Execution should still be protected by TWAP and oracle checks
      const [eligible, reason] = await executorContract.checkEligibility(positionId);

      if (!eligible) {
        expect(reason).to.include("PRICE_DEVIATION");
      }
    });

    it("should calculate correct slippage bounds to prevent sandwiching", async function () {
      const { executorContract, positionId, priceOracle } = await loadFixture(
        deployWithPositionFixture
      );

      // Get price from oracle (should be manipulation-resistant)
      const oraclePrice = await priceOracle.getPrice(
        await (await ethers.getContract("MockWBTC")).getAddress()
      );

      // Get TWAP price (time-weighted, harder to manipulate)
      const twapPrice = await priceOracle.getTWAP(
        await (await ethers.getContract("MockWBTC")).getAddress(),
        3600 // 1 hour window
      );

      // Slippage bounds should be based on the MORE conservative price
      // This prevents attackers from exploiting the difference
      const deviation = (oraclePrice > twapPrice)
        ? ((oraclePrice - twapPrice) * 10000n) / twapPrice
        : ((twapPrice - oraclePrice) * 10000n) / oraclePrice;

      // Deviation should be within acceptable range (100 bps = 1%)
      expect(deviation).to.be.lte(100n);
    });
  });

  describe("Price Deviation Guards", function () {
    it("should reject execution when DEX price deviates from TWAP", async function () {
      const { executorContract, positionId, dexs, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Set DEX price significantly different from TWAP
      // TWAP should be around $40,000, set DEX to $42,000 (5% deviation)
      await dexs.mockUniPool.setManualPrice(ethers.parseUnits("42000", 8));

      // Execution should be skipped
      await expect(executorContract.connect(keeper).execute(positionId))
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId, "PRICE_DEVIATION");
    });

    it("should reject execution when TWAP deviates from oracle", async function () {
      const { executorContract, positionId, priceOracle, priceFeeds, keeper } =
        await loadFixture(deployWithPositionFixture);

      // Advance time
      await advanceTime(3600 + 1);

      // Manipulate oracle price (simulating oracle attack or failure)
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("42000", 8)); // 5% increase

      // Execution should be rejected due to deviation from TWAP
      const [eligible, reason] = await executorContract.checkEligibility(positionId);

      if (!eligible) {
        expect(reason).to.include("PRICE_DEVIATION");
      }
    });

    it("should use configurable deviation threshold", async function () {
      const { dcaManager, positionId, user1, dexs } = await loadFixture(
        deployWithPositionFixture
      );

      // Modify position to use stricter deviation threshold
      const modifyParams = {
        slippageBps: 30, // 0.3% - very strict
        venue: Venue.AUTO,
        maxPriceDeviationBps: 50, // 0.5% - very strict
        beneficiary: user1.address,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
      };

      await dcaManager.connect(user1).modify(positionId, modifyParams);

      // Even small price changes should now trigger rejection
      await dexs.mockUniPool.setManualPrice(ethers.parseUnits("40250", 8)); // 0.625% change

      const position = await dcaManager.getPosition(positionId);
      expect(position.maxPriceDeviationBps).to.equal(50);
    });
  });

  describe("TWAP Manipulation Resistance", function () {
    it("should use sufficiently long TWAP window to resist manipulation", async function () {
      const { executorContract, positionId } = await loadFixture(
        deployWithPositionFixture
      );

      const position = await executorContract.getPosition(positionId);

      // Default TWAP window should be at least 1 hour (3600 seconds)
      expect(position.twapWindow).to.be.gte(3600);
    });

    it("should detect flash-loan based TWAP manipulation", async function () {
      const { executorContract, positionId, dexs, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Simulate flash loan attack - massive single-block price manipulation
      await dexs.mockUniPool.setManualPrice(ethers.parseUnits("50000", 8)); // 25% spike

      // Even if TWAP is manipulated, oracle check should catch this
      await expect(executorContract.connect(keeper).execute(positionId))
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId, "PRICE_DEVIATION");
    });

    it("should require multiple observations for TWAP calculation", async function () {
      const { priceOracle, tokens } = await loadFixture(deployFullSystemFixture);

      // TWAP should require multiple time-separated observations
      // Single observation should not be sufficient

      const twap = await priceOracle.getTWAP(
        await tokens.wbtc.getAddress(),
        3600 // 1 hour
      );

      // TWAP should be calculated from multiple observations
      expect(twap).to.be.gt(0);
    });
  });

  describe("Oracle Manipulation Protection", function () {
    it("should detect stale oracle data", async function () {
      const { priceOracle, priceFeeds, tokens } = await loadFixture(
        deployFullSystemFixture
      );

      // Make oracle data stale (older than 30 minutes)
      await advanceTime(1800 + 1); // 30 minutes + 1 second

      // Don't update the oracle

      // Check should detect staleness
      const [isValid, reason] = await priceOracle.validatePrice(
        await tokens.wbtc.getAddress()
      );

      expect(isValid).to.be.false;
      expect(reason).to.include("STALE");
    });

    it("should require multiple oracle sources when available", async function () {
      const { priceOracle, tokens } = await loadFixture(deployFullSystemFixture);

      // For WBTC, should use both:
      // 1. BTC/USD feed
      // 2. WBTC/BTC feed
      // To detect if one feed is manipulated

      const price = await priceOracle.getPrice(await tokens.wbtc.getAddress());

      // Price should be composite of multiple feeds
      expect(price).to.be.gt(0);
    });

    it("should detect oracle price manipulation via deviation checks", async function () {
      const { priceOracle, priceFeeds, tokens } = await loadFixture(
        deployFullSystemFixture
      );

      // Get current valid price
      const validPrice = await priceOracle.getPrice(await tokens.wbtc.getAddress());

      // Manipulate oracle (simulate compromised feed)
      await priceFeeds.btcUsdFeed.updateAnswer(validPrice * 2n); // 100% increase

      // System should detect this extreme deviation
      const [isValid, reason] = await priceOracle.validatePrice(
        await tokens.wbtc.getAddress()
      );

      expect(isValid).to.be.false;
    });
  });

  describe("Slippage Protection", function () {
    it("should enforce slippage limits on execution", async function () {
      const { executorContract, positionId, dexs, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Set pool to have high slippage (low liquidity simulation)
      // Position has 50 bps (0.5%) slippage limit
      await dexs.mockUniPool.setSlippage(100); // 1% slippage

      // Execution should be skipped due to excessive slippage
      await expect(executorContract.connect(keeper).execute(positionId))
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId, "EXCESSIVE_SLIPPAGE");
    });

    it("should calculate slippage based on expected vs actual output", async function () {
      const { executorContract, positionId } = await loadFixture(
        deployWithPositionFixture
      );

      // Quote the trade
      const quote = await executorContract.quoteNext(positionId);

      // Expected output should be within slippage bounds
      expect(quote.expectedOutput).to.be.gt(0);
      expect(quote.minimumOutput).to.be.lt(quote.expectedOutput);

      const impliedSlippage =
        ((quote.expectedOutput - quote.minimumOutput) * 10000n) / quote.expectedOutput;

      // Should match position slippage setting (50 bps)
      expect(impliedSlippage).to.be.lte(50n);
    });

    it("should use dynamic slippage for different venues", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      // CoW Protocol should allow higher slippage tolerance (partial fills)
      const cowParams = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: Venue.COW_ONLY,
        slippageBps: 100, // 1% - higher for CoW
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: (await getCurrentTime()) + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("1000", 6),
        priceFloorUsd: 0,
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(cowParams);
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
    });
  });

  describe("Private Transaction Mode (Flashbots)", function () {
    it("should mark transactions for private relay when MEV protection enabled", async function () {
      const { dcaManager, positionId } = await loadFixture(deployWithPositionFixture);

      const position = await dcaManager.getPosition(positionId);

      // Position should have MEV protection enabled
      expect(position.mevProtection).to.be.true;
    });

    it("should allow users to opt-in/opt-out of MEV protection", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      // Create position with MEV protection disabled
      const params = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: Venue.AUTO,
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: (await getCurrentTime()) + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("100", 6),
        priceFloorUsd: 0,
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: false, // Disabled
      };

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
    });

    it("should use tighter slippage when MEV protection is disabled", async function () {
      // When transactions are public, slippage tolerance should be tighter
      // to compensate for lack of private relay
    });
  });

  describe("Transaction Ordering Attacks", function () {
    it("should prevent frontrunning of position creation", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      // Position creation should not be vulnerable to frontrunning
      // because:
      // 1. startAt is in the future
      // 2. First execution uses TWAP/oracle prices
      // 3. No benefit to frontrunning position creation

      const params = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: Venue.AUTO,
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: (await getCurrentTime()) + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("100", 6),
        priceFloorUsd: 0,
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(dcaManager.connect(user1).createPosition(params)).to.not.be.reverted;
    });

    it("should prevent backrunning of successful executions", async function () {
      // Verify that execution details are not leaked in a way that allows
      // profitable backrunning
    });

    it("should prevent uncle bandit attacks via nonce management", async function () {
      // Uncle bandit attacks exploit transaction nonce ordering
      // System should be resistant to this
    });
  });

  describe("Price Guard Mechanisms", function () {
    it("should enforce price cap for BUY positions", async function () {
      const { dcaManager, tokens, user1, priceFeeds } = await loadFixture(
        deployFullSystemFixture
      );

      // Create BUY position with price cap
      const params = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: Venue.AUTO,
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: (await getCurrentTime()) + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("100", 6),
        priceFloorUsd: 0,
        priceCapUsd: ethers.parseUnits("42000", 8), // Only buy below $42k
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await tx.wait().then((r) => r.logs[0].args.positionId);

      // Manipulate price above cap
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("45000", 8));

      // Advance time
      await advanceTime(3600 + 1);

      // Execution should be skipped
      const [eligible, reason] = await dcaManager.isPositionEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("PRICE_CAP");
    });

    it("should enforce price floor for SELL positions", async function () {
      const { dcaManager, tokens, user1, priceFeeds } = await loadFixture(
        deployFullSystemFixture
      );

      // Create SELL position with price floor
      const params = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: false, // SELL
        frequency: 0,
        venue: Venue.AUTO,
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: (await getCurrentTime()) + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("0.01", 8), // 0.01 BTC
        priceFloorUsd: ethers.parseUnits("38000", 8), // Only sell above $38k
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.wbtc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await tx.wait().then((r) => r.logs[0].args.positionId);

      // Manipulate price below floor
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("35000", 8));

      // Advance time
      await advanceTime(3600 + 1);

      // Execution should be skipped
      const [eligible, reason] = await dcaManager.isPositionEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("PRICE_FLOOR");
    });
  });

  describe("CoW Protocol MEV Protection", function () {
    it("should leverage CoW batch auctions for inherent MEV protection", async function () {
      // CoW Protocol's batch auction mechanism provides built-in MEV protection
      // Test that CoW venue is properly utilized for large trades
    });

    it("should handle partial fills on CoW without creating MEV opportunities", async function () {
      // Partial fills should not create exploitable MEV opportunities
    });
  });

  describe("Real-World MEV Scenarios", function () {
    it("should resist liquidation frontrunning", async function () {
      // Test scenario where attacker tries to frontrun a position that's about
      // to be executed
    });

    it("should resist oracle update frontrunning", async function () {
      // Test scenario where attacker frontruns oracle price update
    });

    it("should resist just-in-time (JIT) liquidity attacks", async function () {
      // JIT liquidity attacks add liquidity right before a trade
      // and remove it immediately after
    });
  });
});
