import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployFullSystemFixture,
  deployWithPositionFixture,
  deployMultiPositionFixture,
} from "../../fixtures/deployments";
import {
  advanceTime,
  advanceTimeTo,
  getCurrentTime,
  calculateProtocolFee,
  calculateExecutionFee,
  createDefaultModifyParams,
} from "../../helpers/utils";
import {
  ROLES,
  MAX_ORACLE_STALENESS,
  DEPEG_THRESHOLD_BPS,
  BTC_PRICE_USD,
  PUBLIC_EXECUTION_GRACE,
} from "../../helpers/constants";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * Executor Contract Tests
 *
 * Tests cover:
 * - Execution eligibility checks
 * - Guard validation (oracle staleness, TWAP, price deviation, depeg)
 * - Position execution logic
 * - Batch execution
 * - Fee calculations
 * - Route selection
 * - Chainlink Automation integration
 * - Public execution with grace period
 */
describe("Executor", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "Executor");
    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "RouterManager");
    await ensureArtifactOrSkip(this, "PriceOracle");
  });
  describe("Deployment and Initialization", function () {
    it("should deploy with correct references", async function () {
      const { executorContract, dcaManager, routerManager, priceOracle } =
        await loadFixture(deployFullSystemFixture);

      expect(await executorContract.dcaManager()).to.equal(await dcaManager.getAddress());
      expect(await executorContract.routerManager()).to.equal(await routerManager.getAddress());
      expect(await executorContract.priceOracle()).to.equal(await priceOracle.getAddress());
    });

    it("should grant executor role to executor address", async function () {
      const { executorContract, executor } = await loadFixture(deployFullSystemFixture);

      expect(await executorContract.hasRole(ROLES.EXECUTOR, executor.address)).to.be.true;
    });
  });

  describe("Execution Eligibility", function () {
    it("should return false if start time not reached", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const [eligible, reason] = await executorContract.isEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("Start time not reached");
    });

    it("should return true when all conditions met", async function () {
      const { executorContract, positionId, createParams } =
        await loadFixture(deployWithPositionFixture);

      // Advance time to start time
      await advanceTimeTo(createParams.startAt);

      const [eligible, reason] = await executorContract.isEligible(positionId);

      expect(eligible).to.be.true;
      expect(reason).to.be.empty;
    });

    it("should return false if position paused", async function () {
      const { executorContract, dcaManager, positionId, createParams, user1 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      // Pause position
      await dcaManager.connect(user1).pause(positionId);

      const [eligible, reason] = await executorContract.isEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("paused");
    });

    it("should return false if insufficient balance", async function () {
      const { executorContract, dcaManager, positionId, createParams, tokens, user1 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      // Withdraw all funds
      const balance = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );

      await dcaManager
        .connect(user1)
        .withdraw(positionId, await tokens.usdc.getAddress(), balance, user1.address);

      const [eligible, reason] = await executorContract.isEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("Insufficient balance");
    });

    it("should return false if next execution time not reached", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      // Don't advance time

      const [eligible, reason] = await executorContract.isEligible(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.not.be.empty;
    });
  });

  describe("Guard Validation", function () {
    describe("Oracle Staleness", function () {
      it("should validate oracle freshness", async function () {
        const { executorContract } = await loadFixture(deployFullSystemFixture);

        const [valid, staleness] = await executorContract.validateOracleStaleness();

        expect(valid).to.be.true;
        expect(staleness).to.be.lte(MAX_ORACLE_STALENESS);
      });

      it("should fail if oracle data is stale", async function () {
        const { executorContract, priceFeeds } = await loadFixture(deployFullSystemFixture);

        // Update oracle with stale timestamp
        await priceFeeds.btcUsdFeed.updateRoundData(
          1,
          BTC_PRICE_USD,
          Math.floor(Date.now() / 1000) - MAX_ORACLE_STALENESS - 100,
          Math.floor(Date.now() / 1000) - MAX_ORACLE_STALENESS - 100,
          1
        );

        const [valid, staleness] = await executorContract.validateOracleStaleness();

        expect(valid).to.be.false;
        expect(staleness).to.be.gt(MAX_ORACLE_STALENESS);
      });
    });

    describe("TWAP Validation", function () {
      it("should validate TWAP window", async function () {
        const { executorContract } = await loadFixture(deployFullSystemFixture);

        const twapWindow = 3600; // 1 hour

        const valid = await executorContract.validateTWAPWindow(twapWindow);

        expect(valid).to.be.true;
      });

      it("should fail if TWAP window too short", async function () {
        const { executorContract } = await loadFixture(deployFullSystemFixture);

        const twapWindow = 60; // 1 minute - too short

        const valid = await executorContract.validateTWAPWindow(twapWindow);

        expect(valid).to.be.false;
      });
    });

    describe("Price Deviation", function () {
      it("should validate price deviation within limits", async function () {
        const { executorContract } = await loadFixture(deployFullSystemFixture);

        const price1 = ethers.parseUnits("40000", 8); // $40,000
        const price2 = ethers.parseUnits("40200", 8); // $40,200 (0.5% difference)
        const maxDeviationBps = 100; // 1%

        const valid = await executorContract.validatePriceDeviation(
          price1,
          price2,
          maxDeviationBps
        );

        expect(valid).to.be.true;
      });

      it("should fail if price deviation exceeds limit", async function () {
        const { executorContract } = await loadFixture(deployFullSystemFixture);

        const price1 = ethers.parseUnits("40000", 8); // $40,000
        const price2 = ethers.parseUnits("41000", 8); // $41,000 (2.5% difference)
        const maxDeviationBps = 100; // 1%

        const valid = await executorContract.validatePriceDeviation(
          price1,
          price2,
          maxDeviationBps
        );

        expect(valid).to.be.false;
      });
    });

    describe("Stable Depeg Detection", function () {
      it("should detect stable token depeg", async function () {
        const { executorContract, tokens, priceFeeds } = await loadFixture(deployFullSystemFixture);

        // Set USDC price to $0.98 (depegged)
        await priceFeeds.usdcUsdFeed.updateAnswer(ethers.parseUnits("0.98", 8));

        const [isDepegged, deviationBps] = await executorContract.validateDepeg(
          await tokens.usdc.getAddress(),
          DEPEG_THRESHOLD_BPS
        );

        expect(isDepegged).to.be.true;
        expect(deviationBps).to.be.gt(DEPEG_THRESHOLD_BPS);
      });

      it("should pass if stable token is pegged", async function () {
        const { executorContract, tokens } = await loadFixture(deployFullSystemFixture);

        const [isDepegged, deviationBps] = await executorContract.validateDepeg(
          await tokens.usdc.getAddress(),
          DEPEG_THRESHOLD_BPS
        );

        expect(isDepegged).to.be.false;
        expect(deviationBps).to.be.lte(DEPEG_THRESHOLD_BPS);
      });
    });

    describe("Price Guards (Cap/Floor)", function () {
      it("should enforce price cap for BUY positions", async function () {
        const { executorContract, positionId, priceFeeds } =
          await loadFixture(deployWithPositionFixture);

        // Set price cap at $39,000
        const priceCap = ethers.parseUnits("39000", 8);

        // Set current BTC price to $40,000 (above cap)
        await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("40000", 8));

        const [valid, reason] = await executorContract.validatePriceGuards(positionId, priceCap);

        expect(valid).to.be.false;
        expect(reason).to.include("price cap");
      });

      it("should enforce price floor for SELL positions", async function () {
        const { executorContract, dcaManager, tokens, user1, priceFeeds } =
          await loadFixture(deployFullSystemFixture);

        // Create SELL position with price floor
        const currentTime = await getCurrentTime();
        const createParams = {
          owner: user1.address,
          beneficiary: user1.address,
          quoteToken: await tokens.usdc.getAddress(),
          isBuy: false, // SELL
          frequency: 0,
          venue: 0,
          slippageBps: 50,
          twapWindow: 3600,
          maxPriceDeviationBps: 100,
          startAt: currentTime + 3600,
          endAt: 0,
          amountPerPeriod: ethers.parseUnits("0.025", 8),
          priceFloorUsd: ethers.parseUnits("41000", 8), // $41,000 floor
          priceCapUsd: 0,
          maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
          maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
          mevProtection: true,
        };

        await tokens.wbtc
          .connect(user1)
          .approve(await dcaManager.getAddress(), ethers.MaxUint256);

        const tx = await dcaManager.connect(user1).createPosition(createParams);
        const receipt = await tx.wait();
        const event = receipt.logs.find(
          (log: any) => log.fragment && log.fragment.name === "PositionCreated"
        );
        const positionId = event.args.positionId;

        // Set current BTC price to $40,000 (below floor)
        await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("40000", 8));

        const [valid, reason] = await executorContract.validatePriceGuards(
          positionId,
          createParams.priceFloorUsd
        );

        expect(valid).to.be.false;
        expect(reason).to.include("price floor");
      });
    });

    describe("Gas Caps", function () {
      it("should validate gas price within caps", async function () {
        const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

        // Assuming current gas prices are reasonable
        const valid = await executorContract.validateGasCaps(positionId);

        expect(valid).to.be.true;
      });

      it("should fail gas validation when base fee exceeds cap", async function () {
        const { executorContract, dcaManager, positionId, user1 } =
          await loadFixture(deployWithPositionFixture);

        const lowCap = ethers.parseUnits("1", "gwei");

        const modifyParams = createDefaultModifyParams({
          beneficiary: user1.address,
          maxBaseFeeWei: lowCap,
        });

        await dcaManager.connect(user1).modify(positionId, modifyParams);

        await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x77359400"]); // 2 gwei
        await ethers.provider.send("evm_mine", []);

        const valid = await executorContract.validateGasCaps(positionId);

        expect(valid).to.be.false;
      });
    });
  });

  describe("Route Selection", function () {
    it("should select AUTO route by default", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const [venue, routeData] = await executorContract.selectRoute(positionId);

      expect(venue).to.equal(0); // AUTO
      expect(routeData).to.not.be.empty;
    });

    it("should respect venue override", async function () {
      const { dcaManager, executorContract, tokens, user1 } =
        await loadFixture(deployFullSystemFixture);

      const currentTime = await getCurrentTime();
      const createParams = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: 1, // UNIV3_ONLY
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: currentTime + 3600,
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

      const tx = await dcaManager.connect(user1).createPosition(createParams);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log: any) => log.fragment && log.fragment.name === "PositionCreated"
      );
      const positionId = event.args.positionId;

      const [venue, routeData] = await executorContract.selectRoute(positionId);

      expect(venue).to.equal(1); // UNIV3_ONLY
    });

    it("should select CoW for large positions", async function () {
      const { dcaManager, executorContract, tokens, user1 } =
        await loadFixture(deployFullSystemFixture);

      const currentTime = await getCurrentTime();
      const createParams = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: 0, // AUTO
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: currentTime + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("10000", 6), // $10,000 - large amount
        priceFloorUsd: 0,
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(createParams);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log: any) => log.fragment && log.fragment.name === "PositionCreated"
      );
      const positionId = event.args.positionId;

      const [venue, routeData] = await executorContract.selectRoute(positionId);

      // Should select CoW for large positions (notional >= $5k)
      expect(venue).to.equal(2); // COW_ONLY
    });
  });

  describe("Position Execution", function () {
    it("should execute eligible position", async function () {
      const { executorContract, positionId, createParams, executor } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      await expect(executorContract.connect(executor).execute(positionId))
        .to.emit(executorContract, "PositionExecuted")
        .withArgs(positionId);
    });

    it("should update position accounting after execution", async function () {
      const { executorContract, dcaManager, positionId, createParams, executor } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      const positionBefore = await dcaManager.getPosition(positionId);

      await executorContract.connect(executor).execute(positionId);

      const positionAfter = await dcaManager.getPosition(positionId);

      expect(positionAfter.periodsExecuted).to.equal(positionBefore.periodsExecuted + 1n);
      expect(positionAfter.nextExecAt).to.be.gt(positionBefore.nextExecAt);
    });

    it("should collect protocol fee", async function () {
      const { executorContract, treasuryContract, tokens, positionId, createParams, executor } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      const treasuryBalanceBefore = await tokens.usdc.balanceOf(await treasuryContract.getAddress());

      await executorContract.connect(executor).execute(positionId);

      const treasuryBalanceAfter = await tokens.usdc.balanceOf(await treasuryContract.getAddress());

      expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
    });

    it("should emit execution details", async function () {
      const { executorContract, positionId, createParams, executor } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      await expect(executorContract.connect(executor).execute(positionId))
        .to.emit(executorContract, "ExecutionDetails");
    });

    it("should revert if non-executor tries to execute", async function () {
      const { executorContract, positionId, createParams, user1 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      await expect(executorContract.connect(user1).execute(positionId)).to.be.revertedWith(
        "AccessControl: account"
      );
    });

    it("should revert if position not eligible", async function () {
      const { executorContract, positionId, executor } = await loadFixture(deployWithPositionFixture);

      // Don't advance time

      await expect(executorContract.connect(executor).execute(positionId)).to.be.revertedWith(
        "Position not eligible"
      );
    });

    it("should skip execution when gas caps are exceeded", async function () {
      const { executorContract, dcaManager, positionId, createParams, executor, user1 } =
        await loadFixture(deployWithPositionFixture);

      const tightCaps = createDefaultModifyParams({
        beneficiary: user1.address,
        maxBaseFeeWei: ethers.parseUnits("1", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("1", "gwei"),
      });

      await dcaManager.connect(user1).modify(positionId, tightCaps);

      await advanceTimeTo(createParams.startAt);

      await ethers.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x77359400"]); // 2 gwei
      await ethers.provider.send("evm_mine", []);

      await expect(
        executorContract.connect(executor).execute(positionId, {
          maxFeePerGas: ethers.parseUnits("6", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        })
      )
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId);
    });

    it("should skip and emit event if guards fail", async function () {
      const { executorContract, positionId, createParams, priceFeeds, executor } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      // Make oracle stale
      await priceFeeds.btcUsdFeed.updateRoundData(
        1,
        BTC_PRICE_USD,
        Math.floor(Date.now() / 1000) - MAX_ORACLE_STALENESS - 100,
        Math.floor(Date.now() / 1000) - MAX_ORACLE_STALENESS - 100,
        1
      );

      await expect(executorContract.connect(executor).execute(positionId))
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId);
    });
  });

  describe("Batch Execution", function () {
    it("should execute multiple positions in batch", async function () {
      const { executorContract, positionIds, executor } =
        await loadFixture(deployMultiPositionFixture);

      // Advance time to make positions eligible
      await advanceTime(7200); // 2 hours

      const results = await executorContract.connect(executor).batchExecute(positionIds);

      expect(results).to.have.lengthOf(positionIds.length);
    });

    it("should continue on individual failures", async function () {
      const { executorContract, positionIds, dcaManager, user1, executor } =
        await loadFixture(deployMultiPositionFixture);

      // Pause one position
      await dcaManager.connect(user1).pause(positionIds[0]);

      await advanceTime(7200);

      const results = await executorContract.connect(executor).batchExecute(positionIds);

      // First should fail (paused), others should succeed
      expect(results[0].success).to.be.false;
      expect(results[1].success).to.be.true;
    });

    it("should respect gas limits", async function () {
      const { executorContract, positionIds, executor } =
        await loadFixture(deployMultiPositionFixture);

      await advanceTime(7200);

      // Should not revert even with many positions
      await expect(
        executorContract.connect(executor).batchExecute(positionIds, {
          gasLimit: 10000000, // 10M gas limit
        })
      ).to.not.be.reverted;
    });
  });

  describe("Chainlink Automation Integration", function () {
    it("should return upkeep needed for eligible positions", async function () {
      const { executorContract, positionId, createParams } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      const [upkeepNeeded, performData] = await executorContract.checkUpkeep("0x");

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.not.be.empty;
    });

    it("should return upkeep not needed for non-eligible positions", async function () {
      const { executorContract } = await loadFixture(deployWithPositionFixture);

      // Don't advance time

      const [upkeepNeeded, performData] = await executorContract.checkUpkeep("0x");

      expect(upkeepNeeded).to.be.false;
    });

    it("should perform upkeep with valid data", async function () {
      const { executorContract, positionId, createParams, keeper } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      const [upkeepNeeded, performData] = await executorContract.checkUpkeep("0x");

      await expect(executorContract.connect(keeper).performUpkeep(performData)).to.not.be.reverted;
    });
  });

  describe("Public Execution", function () {
    it("should allow public execution after grace period", async function () {
      const { executorContract, positionId, createParams, user2 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      // Advance time by grace period
      await advanceTime(PUBLIC_EXECUTION_GRACE);

      await expect(executorContract.connect(user2).executePublic(positionId)).to.not.be.reverted;
    });

    it("should pay tip to public executor", async function () {
      const { executorContract, positionId, createParams, user2 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt + PUBLIC_EXECUTION_GRACE);

      const balanceBefore = await ethers.provider.getBalance(user2.address);

      await executorContract.connect(user2).executePublic(positionId);

      const balanceAfter = await ethers.provider.getBalance(user2.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should revert if grace period not passed", async function () {
      const { executorContract, positionId, createParams, user2 } =
        await loadFixture(deployWithPositionFixture);

      await advanceTimeTo(createParams.startAt);

      await expect(executorContract.connect(user2).executePublic(positionId)).to.be.revertedWith(
        "Grace period not passed"
      );
    });
  });

  describe("Fee Calculation", function () {
    it("should calculate protocol fee correctly", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("1000", 6); // $1,000

      const [protocolFee, executionFee] = await executorContract.calculateFees(
        positionId,
        notional
      );

      const expectedProtocolFee = calculateProtocolFee(notional, 20); // 20 bps

      expect(protocolFee).to.equal(expectedProtocolFee);
      expect(executionFee).to.be.gt(0);
    });
  });

  describe("Tiered Fee Structure", function () {
    it("should apply lowest tier (10 bps) for small positions < $1000", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("500", 6); // $500

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 10); // 10 bps for < $1000
      expect(protocolFee).to.equal(expectedFee);
    });

    it("should apply default tier (20 bps) for medium positions $1000-$10000", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("5000", 6); // $5,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 20); // 20 bps for $1k-$10k
      expect(protocolFee).to.equal(expectedFee);
    });

    it("should apply highest tier (30 bps) for large positions > $10000", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("25000", 6); // $25,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 30); // 30 bps for > $10k
      expect(protocolFee).to.equal(expectedFee);
    });

    it("should correctly apply fee at $1000 boundary (lower bound of default tier)", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("1000", 6); // Exactly $1,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 20); // Should be 20 bps at boundary
      expect(protocolFee).to.equal(expectedFee);
    });

    it("should correctly apply fee at $10000 boundary (lower bound of high tier)", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("10000", 6); // Exactly $10,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 30); // Should be 30 bps at boundary
      expect(protocolFee).to.equal(expectedFee);
    });

    it("should calculate tiered fees accurately for minimal amounts", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("100", 6); // $100 (minimum position size)

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 10); // 10 bps
      expect(protocolFee).to.equal(expectedFee);

      // Verify fee is non-zero and reasonable
      expect(protocolFee).to.be.gt(0);
      expect(protocolFee).to.be.lt(notional); // Fee should be < notional
    });

    it("should calculate tiered fees accurately for very large amounts", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("100000", 6); // $100,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, notional);

      const expectedFee = calculateProtocolFee(notional, 30); // 30 bps for large positions
      expect(protocolFee).to.equal(expectedFee);

      // Verify fee is reasonable proportion of notional
      const feeBps = (protocolFee * 10000n) / notional;
      expect(feeBps).to.equal(30n); // Should be exactly 30 bps
    });

    it("should apply same tier consistently for positions in same range", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional1 = ethers.parseUnits("2000", 6);
      const notional2 = ethers.parseUnits("3000", 6);

      const [fee1, _] = await executorContract.calculateFees(positionId, notional1);
      const [fee2, __] = await executorContract.calculateFees(positionId, notional2);

      // Both should use 20 bps (default tier)
      const expectedFee1 = calculateProtocolFee(notional1, 20);
      const expectedFee2 = calculateProtocolFee(notional2, 20);

      expect(fee1).to.equal(expectedFee1);
      expect(fee2).to.equal(expectedFee2);

      // Verify fees scale linearly within same tier
      const ratio = Number(notional2) / Number(notional1);
      const feeRatio = Number(fee2) / Number(fee1);
      expect(Math.abs(feeRatio - ratio)).to.be.lt(0.01); // Within 1% due to rounding
    });

    it("should handle tier transitions correctly (just below and above boundary)", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const justBelow1k = ethers.parseUnits("999", 6); // $999
      const justAbove1k = ethers.parseUnits("1001", 6); // $1,001

      const [feeBefore, _] = await executorContract.calculateFees(positionId, justBelow1k);
      const [feeAfter, __] = await executorContract.calculateFees(positionId, justAbove1k);

      // Should apply different tiers
      const expectedBefore = calculateProtocolFee(justBelow1k, 10); // 10 bps
      const expectedAfter = calculateProtocolFee(justAbove1k, 20); // 20 bps

      expect(feeBefore).to.equal(expectedBefore);
      expect(feeAfter).to.equal(expectedAfter);

      // Fee should increase when crossing boundary even though notional only increased slightly
      expect(feeAfter).to.be.gt(feeBefore);
    });

    it("should include tiered protocol fee in execution fee calculation", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const notional = ethers.parseUnits("5000", 6);

      const [protocolFee, executionFee] = await executorContract.calculateFees(
        positionId,
        notional
      );

      // Execution fee should include:
      // 1. Fixed execution fee
      // 2. Gas premium based on notional
      // Total execution fee should be positive and reasonable
      expect(executionFee).to.be.gt(0);

      // Total fees should be reasonable proportion of notional
      const totalFees = protocolFee + executionFee;
      expect(totalFees).to.be.lt(notional); // Total fees < notional
    });

    it("should apply tier based on current notional, not position configuration", async function () {
      const { dcaManager, executorContract, tokens, user1 } =
        await loadFixture(deployFullSystemFixture);

      // Create position with small amount per period
      const currentTime = await getCurrentTime();
      const createParams = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 0,
        venue: 0,
        slippageBps: 50,
        twapWindow: 3600,
        maxPriceDeviationBps: 100,
        startAt: currentTime + 3600,
        endAt: 0,
        amountPerPeriod: ethers.parseUnits("500", 6), // $500 per period
        priceFloorUsd: 0,
        priceCapUsd: 0,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
        mevProtection: true,
      };

      await tokens.usdc.connect(user1).approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(createParams);
      const receipt = await tx.wait();
      const event = receipt.logs.find(
        (log: any) => log.fragment && log.fragment.name === "PositionCreated"
      );
      const positionId = event.args.positionId;

      // Calculate fee with large notional (simulating accumulated execution)
      const largeNotional = ethers.parseUnits("15000", 6); // $15,000

      const [protocolFee, _] = await executorContract.calculateFees(positionId, largeNotional);

      // Should use high tier (30 bps) based on notional, not position's amountPerPeriod
      const expectedFee = calculateProtocolFee(largeNotional, 30);
      expect(protocolFee).to.equal(expectedFee);
    });
  });

  describe("Slippage Estimation", function () {
    it("should estimate slippage for route", async function () {
      const { executorContract, positionId } = await loadFixture(deployWithPositionFixture);

      const [slippageBps, priceImpact] = await executorContract.estimateSlippage(positionId, 1); // UNIV3

      expect(slippageBps).to.be.lte(100); // Should be reasonable
      expect(priceImpact).to.be.lte(200); // Should be reasonable
    });
  });
});
