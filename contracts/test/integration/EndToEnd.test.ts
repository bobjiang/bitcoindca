import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFullSystemFixture } from "../fixtures/deployments";
import {
  createDefaultPositionParams,
  advanceTime,
  advanceTimeTo,
  getCurrentTime,
  getPositionIdFromTx,
} from "../helpers/utils";
import { Frequency, Venue } from "../helpers/constants";
import { ensureArtifactOrSkip } from "../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * End-to-End Integration Tests
 *
 * These tests verify complete user workflows from position creation
 * through execution and withdrawal. They test the integration between
 * all major contracts:
 * - DcaManager
 * - PositionNFT
 * - Executor
 * - RouterManager & Adapters
 * - PriceOracle
 * - Treasury
 */
describe("End-to-End Integration Tests", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "Executor");
    await ensureArtifactOrSkip(this, "PositionNFT");
    await ensureArtifactOrSkip(this, "RouterManager");
    await ensureArtifactOrSkip(this, "PriceOracle");
    await ensureArtifactOrSkip(this, "Treasury");
  });
  describe("Complete BUY Position Lifecycle", function () {
    it("should execute full lifecycle: create -> deposit -> execute -> withdraw", async function () {
      const {
        dcaManager,
        executorContract,
        positionNFT,
        tokens,
        user1,
        executor,
      } = await loadFixture(deployFullSystemFixture);

      // ========== STEP 1: Create Position ==========
      const currentTime = await getCurrentTime();
      const startAt = currentTime + 3600;

      const createParams = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: Frequency.DAILY,
        venue: Venue.AUTO,
        amountPerPeriod: ethers.parseUnits("100", 6), // $100 per day
        startAt,
        endAt: currentTime + (7 * 24 * 3600), // 7 days
      });

      // Approve tokens
      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create position
      const createTx = await dcaManager.connect(user1).createPosition(createParams);
      const positionId = await getPositionIdFromTx(createTx);

      // Verify NFT was minted
      expect(await positionNFT.ownerOf(positionId)).to.equal(user1.address);

      // ========== STEP 2: Deposit Funds ==========
      const depositAmount = ethers.parseUnits("1000", 6); // $1,000

      await expect(
        dcaManager
          .connect(user1)
          .deposit(positionId, await tokens.usdc.getAddress(), depositAmount)
      )
        .to.emit(dcaManager, "Deposited")
        .withArgs(positionId, await tokens.usdc.getAddress(), depositAmount);

      const balanceAfterDeposit = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );

      expect(balanceAfterDeposit).to.equal(depositAmount);

      // ========== STEP 3: First Execution ==========
      // Advance to start time
      await advanceTimeTo(startAt);

      // Verify position is eligible
      const [eligible, reason] = await executorContract.isEligible(positionId);
      expect(eligible).to.be.true;

      // Execute position
      await expect(executorContract.connect(executor).execute(positionId))
        .to.emit(executorContract, "PositionExecuted")
        .withArgs(positionId);

      // Verify position state was updated
      const positionAfterExec1 = await dcaManager.getPosition(positionId);
      expect(positionAfterExec1.periodsExecuted).to.equal(1);

      // Verify WBTC was received
      const wbtcBalance1 = await dcaManager.getPositionBalance(
        positionId,
        await tokens.wbtc.getAddress()
      );
      expect(wbtcBalance1).to.be.gt(0);

      // ========== STEP 4: Second Execution (Next Day) ==========
      // Advance 1 day
      await advanceTime(24 * 3600);

      // Execute again
      await executorContract.connect(executor).execute(positionId);

      const positionAfterExec2 = await dcaManager.getPosition(positionId);
      expect(positionAfterExec2.periodsExecuted).to.equal(2);

      const wbtcBalance2 = await dcaManager.getPositionBalance(
        positionId,
        await tokens.wbtc.getAddress()
      );
      expect(wbtcBalance2).to.be.gt(wbtcBalance1);

      // ========== STEP 5: Partial Withdrawal ==========
      const withdrawAmount = wbtcBalance2 / 2n;

      await expect(
        dcaManager
          .connect(user1)
          .withdraw(
            positionId,
            await tokens.wbtc.getAddress(),
            withdrawAmount,
            user1.address
          )
      )
        .to.emit(dcaManager, "Withdrawn")
        .withArgs(positionId, await tokens.wbtc.getAddress(), withdrawAmount, user1.address);

      const wbtcBalanceAfterWithdraw = await dcaManager.getPositionBalance(
        positionId,
        await tokens.wbtc.getAddress()
      );
      expect(wbtcBalanceAfterWithdraw).to.equal(wbtcBalance2 - withdrawAmount);

      // ========== STEP 6: Modify Position ==========
      const modifyParams = {
        slippageBps: 100, // Increase slippage to 1%
        venue: Venue.UNIV3_ONLY, // Change to Uniswap only
        maxBaseFeeWei: ethers.parseUnits("150", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("3", "gwei"),
        priceFloorUsd: 0,
        priceCapUsd: 0,
        beneficiary: user1.address,
        mevProtection: true,
      };

      await expect(dcaManager.connect(user1).modify(positionId, modifyParams))
        .to.emit(dcaManager, "PositionModified")
        .withArgs(positionId, modifyParams);

      const modifiedPosition = await dcaManager.getPosition(positionId);
      expect(modifiedPosition.slippageBps).to.equal(100);
      expect(modifiedPosition.venue).to.equal(Venue.UNIV3_ONLY);

      // ========== STEP 7: Cancel and Final Withdrawal ==========
      await expect(dcaManager.connect(user1).cancel(positionId))
        .to.emit(dcaManager, "PositionCanceled")
        .withArgs(positionId);

      // Verify position is paused
      const canceledPosition = await dcaManager.getPosition(positionId);
      expect(canceledPosition.paused).to.be.true;

      // Withdraw remaining funds
      const remainingUSDC = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );
      const remainingWBTC = await dcaManager.getPositionBalance(
        positionId,
        await tokens.wbtc.getAddress()
      );

      if (remainingUSDC > 0) {
        await dcaManager
          .connect(user1)
          .withdraw(positionId, await tokens.usdc.getAddress(), remainingUSDC, user1.address);
      }

      if (remainingWBTC > 0) {
        await dcaManager
          .connect(user1)
          .withdraw(positionId, await tokens.wbtc.getAddress(), remainingWBTC, user1.address);
      }

      // Verify NFT was burned
      await expect(positionNFT.ownerOf(positionId)).to.be.revertedWith(
        "ERC721: invalid token ID"
      );
    });
  });

  describe("Complete SELL Position Lifecycle", function () {
    it("should execute full SELL workflow", async function () {
      const {
        dcaManager,
        executorContract,
        tokens,
        user1,
        executor,
      } = await loadFixture(deployFullSystemFixture);

      // Create SELL position
      const currentTime = await getCurrentTime();
      const createParams = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: false, // SELL
        frequency: Frequency.WEEKLY,
        amountPerPeriod: ethers.parseUnits("0.01", 8), // 0.01 WBTC per week
        startAt: currentTime + 3600,
      });

      await tokens.wbtc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const createTx = await dcaManager.connect(user1).createPosition(createParams);
      const positionId = await getPositionIdFromTx(createTx);

      // Deposit WBTC
      const depositAmount = ethers.parseUnits("0.1", 8); // 0.1 WBTC
      await dcaManager
        .connect(user1)
        .deposit(positionId, await tokens.wbtc.getAddress(), depositAmount);

      // Execute position
      await advanceTimeTo(createParams.startAt);
      await executorContract.connect(executor).execute(positionId);

      // Verify USDC was received
      const usdcBalance = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );
      expect(usdcBalance).to.be.gt(0);

      // Verify WBTC was deducted
      const wbtcBalance = await dcaManager.getPositionBalance(
        positionId,
        await tokens.wbtc.getAddress()
      );
      expect(wbtcBalance).to.equal(depositAmount - createParams.amountPerPeriod);
    });
  });

  describe("Multiple Concurrent Positions", function () {
    it("should handle multiple positions for same user", async function () {
      const {
        dcaManager,
        executorContract,
        tokens,
        user1,
        executor,
      } = await loadFixture(deployFullSystemFixture);

      const currentTime = await getCurrentTime();
      const positionIds: bigint[] = [];

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create 3 positions with different frequencies
      const frequencies = [Frequency.DAILY, Frequency.WEEKLY, Frequency.MONTHLY];

      for (const freq of frequencies) {
        const params = createDefaultPositionParams(user1.address, {
          quoteToken: await tokens.usdc.getAddress(),
          frequency: freq,
          startAt: currentTime + 3600,
        });

        const tx = await dcaManager.connect(user1).createPosition(params);
        const positionId = await getPositionIdFromTx(tx);
        positionIds.push(positionId);

        // Deposit funds
        await dcaManager
          .connect(user1)
          .deposit(positionId, await tokens.usdc.getAddress(), ethers.parseUnits("1000", 6));
      }

      // Execute all positions
      await advanceTimeTo(currentTime + 3600);

      for (const positionId of positionIds) {
        await executorContract.connect(executor).execute(positionId);

        const position = await dcaManager.getPosition(positionId);
        expect(position.periodsExecuted).to.equal(1);
      }
    });
  });

  describe("Circuit Breaker Integration", function () {
    it("should pause position when circuit breaker triggers", async function () {
      const {
        dcaManager,
        executorContract,
        tokens,
        priceFeeds,
        user1,
        executor,
      } = await loadFixture(deployFullSystemFixture);

      // Create position
      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        startAt: currentTime + 3600,
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      await dcaManager
        .connect(user1)
        .deposit(positionId, await tokens.usdc.getAddress(), ethers.parseUnits("1000", 6));

      // Trigger circuit breaker with large price movement
      await priceFeeds.btcUsdFeed.updateAnswer(ethers.parseUnits("30000", 8)); // -25% price drop

      await advanceTimeTo(currentTime + 3600);

      // Execution should be skipped
      await expect(executorContract.connect(executor).execute(positionId))
        .to.emit(executorContract, "ExecutionSkipped")
        .withArgs(positionId);
    });
  });

  describe("Fee Collection and Distribution", function () {
    it("should collect and distribute fees correctly", async function () {
      const {
        dcaManager,
        executorContract,
        treasuryContract,
        tokens,
        user1,
        executor,
      } = await loadFixture(deployFullSystemFixture);

      // Create and execute position
      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        amountPerPeriod: ethers.parseUnits("1000", 6), // Large amount for visible fees
        startAt: currentTime + 3600,
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      await dcaManager
        .connect(user1)
        .deposit(positionId, await tokens.usdc.getAddress(), ethers.parseUnits("5000", 6));

      // Get treasury balance before
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        await treasuryContract.getAddress()
      );

      await advanceTimeTo(currentTime + 3600);
      await executorContract.connect(executor).execute(positionId);

      // Get treasury balance after
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        await treasuryContract.getAddress()
      );

      // Verify fees were collected
      expect(treasuryBalanceAfter).to.be.gt(treasuryBalanceBefore);
    });
  });

  describe("Emergency Scenarios", function () {
    it("should handle emergency withdrawal after pause", async function () {
      const {
        dcaManager,
        tokens,
        user1,
      } = await loadFixture(deployFullSystemFixture);

      // Create position
      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        startAt: currentTime + 3600,
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      const depositAmount = ethers.parseUnits("1000", 6);
      await dcaManager
        .connect(user1)
        .deposit(positionId, await tokens.usdc.getAddress(), depositAmount);

      // Pause position
      await dcaManager.connect(user1).pause(positionId);

      // Advance time by 7 days (emergency withdrawal delay)
      await advanceTime(7 * 24 * 3600);

      // Emergency withdrawal should succeed
      await expect(dcaManager.connect(user1).emergencyWithdraw(positionId))
        .to.emit(dcaManager, "PositionEmergencyWithdrawn")
        .withArgs(positionId);

      // Verify funds were returned
      const finalBalance = await tokens.usdc.balanceOf(user1.address);
      expect(finalBalance).to.be.gte(depositAmount);
    });
  });

  describe("NFT Transfer and Ownership", function () {
    it("should transfer position ownership with NFT", async function () {
      const {
        dcaManager,
        positionNFT,
        tokens,
        user1,
        user2,
      } = await loadFixture(deployFullSystemFixture);

      // Create position
      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        startAt: currentTime + 3600,
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Transfer NFT
      await positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId);

      // Verify new owner
      expect(await positionNFT.ownerOf(positionId)).to.equal(user2.address);

      // Verify new owner can manage position
      await expect(dcaManager.connect(user2).pause(positionId)).to.not.be.reverted;
    });
  });
});
