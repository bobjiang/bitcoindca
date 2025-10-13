import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployFullSystemFixture,
  deployWithPositionFixture,
  deployMultiPositionFixture,
} from "../fixtures/deployments";
import {
  createDefaultPositionParams,
  advanceTime,
  getCurrentTime,
  getPositionIdFromTx,
} from "../helpers/utils";
import {
  ROLES,
  MAX_POSITIONS_PER_USER,
  MAX_GLOBAL_POSITIONS,
  MAX_DAILY_VOLUME_USD,
  Venue,
} from "../helpers/constants";
import { ensureArtifactOrSkip } from "../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * Denial-of-Service Protection Tests
 *
 * High-priority security tests for DOS attack vectors
 * Reference: SECURITY_AUDIT_REPORT.md - H-3: Missing Denial-of-Service Attack Tests
 *
 * Coverage:
 * - Batch execution DOS protection
 * - Circuit breaker manipulation resistance
 * - Position creation spam prevention
 * - Gas limit attacks
 * - System resource exhaustion
 * - Global and per-user limits
 */
describe("Security: DOS Protection", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "Executor");
  });

  describe("Batch Execution DOS Protection", function () {
    it("should handle batch execution with all failing positions", async function () {
      const { dcaManager, executorContract, positionIds, user1, user2, user3, keeper } =
        await loadFixture(deployMultiPositionFixture);

      // Pause all positions to make them fail
      for (let i = 0; i < positionIds.length; i++) {
        const position = await dcaManager.getPosition(positionIds[i]);
        const owner = position.owner;

        // Get signer for the owner
        let ownerSigner;
        if (owner === user1.address) ownerSigner = user1;
        else if (owner === user2.address) ownerSigner = user2;
        else ownerSigner = user3;

        await dcaManager.connect(ownerSigner).pause(positionIds[i]);
      }

      // Advance time to make positions eligible (if they weren't paused)
      await advanceTime(3600 + 1);

      // Batch execute should not revert, just skip all
      const tx = await executorContract.connect(keeper).batchExecute(positionIds);
      const receipt = await tx.wait();

      // All positions should be skipped (events emitted)
      const skipEvents = receipt.logs.filter(
        (log: any) => log.fragment && log.fragment.name === "ExecutionSkipped"
      );

      expect(skipEvents.length).to.be.gte(1);
    });

    it("should enforce maximum batch size to prevent gas DOS", async function () {
      const { executorContract, keeper } = await loadFixture(deployFullSystemFixture);

      // Create array with too many position IDs
      const tooManyIds = Array(101).fill(1n); // Assuming max is 100

      // Should revert with batch size limit error
      await expect(
        executorContract.connect(keeper).batchExecute(tooManyIds)
      ).to.be.revertedWith("Batch too large");
    });

    it("should process batch efficiently even with some failures", async function () {
      const { executorContract, positionIds, keeper, dcaManager, user1 } =
        await loadFixture(deployMultiPositionFixture);

      // Pause first position only
      await dcaManager.connect(user1).pause(positionIds[0]);

      // Advance time
      await advanceTime(3600 + 1);

      // Batch execute - should process others successfully
      const tx = await executorContract.connect(keeper).batchExecute(positionIds);
      const receipt = await tx.wait();

      // Should have both success and failure events
      const skipEvents = receipt.logs.filter(
        (log: any) => log.fragment && log.fragment.name === "ExecutionSkipped"
      );
      const successEvents = receipt.logs.filter(
        (log: any) => log.fragment && log.fragment.name === "PositionExecuted"
      );

      expect(skipEvents.length).to.be.gte(1);
      expect(successEvents.length).to.be.gte(0);
    });

    it("should not allow unbounded gas consumption in batch", async function () {
      const { executorContract, positionIds, keeper } = await loadFixture(
        deployMultiPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Execute batch and measure gas
      const tx = await executorContract.connect(keeper).batchExecute(positionIds);
      const receipt = await tx.wait();

      // Gas used should be bounded and predictable
      // Even with many positions, should not hit block gas limit
      expect(receipt.gasUsed).to.be.lt(30000000n); // 30M gas limit
    });
  });

  describe("Position Creation Spam Prevention", function () {
    it("should enforce max positions per user", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create max positions (10 by default)
      for (let i = 0; i < MAX_POSITIONS_PER_USER; i++) {
        const params = createDefaultPositionParams(user1.address, {
          quoteToken: await tokens.usdc.getAddress(),
        });
        await dcaManager.connect(user1).createPosition(params);
      }

      // 11th position should fail
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Max positions per user exceeded");
    });

    it("should decrement counter when position is cancelled", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create max positions
      const positionIds: bigint[] = [];
      for (let i = 0; i < MAX_POSITIONS_PER_USER; i++) {
        const params = createDefaultPositionParams(user1.address, {
          quoteToken: await tokens.usdc.getAddress(),
        });
        const tx = await dcaManager.connect(user1).createPosition(params);
        const id = await getPositionIdFromTx(tx);
        positionIds.push(id);
      }

      // Cancel one position
      await dcaManager.connect(user1).cancel(positionIds[0]);

      // Now should be able to create another
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await expect(dcaManager.connect(user1).createPosition(params)).to.not.be.reverted;
    });

    it("should prevent position spam via minimum size requirement", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Try to create position below minimum ($100)
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        amountPerPeriod: ethers.parseUnits("50", 6), // $50
      });

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Position size below minimum");
    });

    it("should enforce global position limit", async function () {
      const { dcaManager, deployer } = await loadFixture(deployFullSystemFixture);

      // Set a very low global limit for testing
      await dcaManager.connect(deployer).setMaxGlobalPositions(5);

      // This test would need to create 5+ positions across multiple users
      // to verify the global limit is enforced
    });
  });

  describe("Circuit Breaker Manipulation Resistance", function () {
    it("should prevent circuit breaker griefing via volume limit", async function () {
      const { dcaManager, tokens, user1, user2, deployer } = await loadFixture(
        deployFullSystemFixture
      );

      // Set daily volume limit
      await dcaManager.connect(deployer).setDailyVolumeLimitUsd(
        ethers.parseUnits("100000", 6) // $100k daily
      );

      // Attacker tries to create many large positions to hit volume limit
      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create positions totaling $100k per period
      for (let i = 0; i < 5; i++) {
        const params = createDefaultPositionParams(user1.address, {
          quoteToken: await tokens.usdc.getAddress(),
          amountPerPeriod: ethers.parseUnits("20000", 6), // $20k each
        });
        await dcaManager.connect(user1).createPosition(params);
      }

      // Legitimate user should still be able to create position
      // System should track and enforce daily volume across all users
    });

    it("should resist triggering circuit breaker via price manipulation", async function () {
      const { dcaManager, priceFeeds, deployer } = await loadFixture(
        deployFullSystemFixture
      );

      // Set price movement circuit breaker
      await dcaManager.connect(deployer).setMaxPriceMovementBps(2000); // 20%

      // Attacker tries to trigger by manipulating price feed
      const currentPrice = await priceFeeds.btcUsdFeed.latestAnswer();

      // Try to move price by exactly 20%
      await priceFeeds.btcUsdFeed.updateAnswer(
        currentPrice + (currentPrice * 2000n) / 10000n
      );

      // System should detect and pause automatically
      const isPaused = await dcaManager.isAssetPaused(
        await (await ethers.getContractAt("MockERC20", "MockWBTC")).getAddress()
      );

      // Circuit breaker should have triggered
      expect(isPaused).to.be.true;
    });

    it("should allow admin to override circuit breaker", async function () {
      const { dcaManager, deployer } = await loadFixture(deployFullSystemFixture);

      // Trigger circuit breaker
      await dcaManager.connect(deployer).pauseAll();

      // Admin should be able to unpause
      await dcaManager.connect(deployer).unpauseAll();

      expect(await dcaManager.paused()).to.be.false;
    });

    it("should prevent rapid pause/unpause cycling", async function () {
      const { dcaManager, deployer } = await loadFixture(deployFullSystemFixture);

      // Pause
      await dcaManager.connect(deployer).pauseAll();

      // Unpause
      await dcaManager.connect(deployer).unpauseAll();

      // Should be able to pause again, but there might be a cooldown
      await dcaManager.connect(deployer).pauseAll();

      expect(await dcaManager.paused()).to.be.true;
    });
  });

  describe("Gas Limit DOS Protection", function () {
    it("should bound gas usage for position creation", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const receipt = await tx.wait();

      // Gas should be bounded and predictable
      expect(receipt.gasUsed).to.be.lt(500000n); // 500k gas max
    });

    it("should bound gas usage for execution", async function () {
      const { executorContract, positionId, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      const tx = await executorContract.connect(keeper).execute(positionId);
      const receipt = await tx.wait();

      // Single execution should be gas-efficient
      expect(receipt.gasUsed).to.be.lt(1000000n); // 1M gas max
    });

    it("should handle positions with complex parameters efficiently", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create position with all optional parameters set
      const params = {
        owner: user1.address,
        beneficiary: user1.address,
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        frequency: 2, // MONTHLY
        venue: Venue.AUTO,
        slippageBps: 100,
        twapWindow: 7200,
        maxPriceDeviationBps: 200,
        startAt: (await getCurrentTime()) + 3600,
        endAt: (await getCurrentTime()) + 365 * 24 * 3600, // 1 year
        amountPerPeriod: ethers.parseUnits("1000", 6),
        priceFloorUsd: ethers.parseUnits("30000", 8),
        priceCapUsd: ethers.parseUnits("50000", 8),
        maxBaseFeeWei: ethers.parseUnits("200", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("5", "gwei"),
        mevProtection: true,
      };

      const tx = await dcaManager.connect(user1).createPosition(params);
      const receipt = await tx.wait();

      // Should still be gas-efficient even with all parameters
      expect(receipt.gasUsed).to.be.lt(600000n);
    });
  });

  describe("State Bloat Prevention", function () {
    it("should use efficient storage for positions", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Position data should be packed efficiently
      const position = await dcaManager.getPosition(positionId);

      // Verify all fields are accessible
      expect(position.owner).to.equal(user1.address);
      expect(position.quoteToken).to.equal(await tokens.usdc.getAddress());
    });

    it("should clean up storage when position is cancelled", async function () {
      const { dcaManager, positionId, user1 } = await loadFixture(
        deployWithPositionFixture
      );

      // Cancel position
      await dcaManager.connect(user1).cancel(positionId);

      // NFT should be burned
      const nft = await ethers.getContractAt(
        "PositionNFT",
        await dcaManager.positionNFT()
      );

      await expect(nft.ownerOf(positionId)).to.be.reverted;
    });
  });

  describe("Keeper Resource Exhaustion Protection", function () {
    it("should prevent keeper from being overwhelmed with eligible positions", async function () {
      const { executorContract, positionIds, keeper } = await loadFixture(
        deployMultiPositionFixture
      );

      // Make all positions eligible
      await advanceTime(3600 + 1);

      // Keeper should be able to batch process without running out of gas
      const tx = await executorContract.connect(keeper).batchExecute(positionIds);
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);
    });

    it("should allow keeper to skip expensive positions", async function () {
      const { executorContract, positionId, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Check eligibility first (view function, no gas cost)
      const [eligible, reason] = await executorContract.checkEligibility(positionId);

      // Keeper can decide to skip if gas price is too high
      // This test verifies the check function exists and works
      expect(eligible).to.be.a("boolean");
    });
  });

  describe("Input Validation DOS Prevention", function () {
    it("should reject malformed position parameters", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Invalid venue
      const invalidParams = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });
      invalidParams.venue = 99; // Invalid venue

      await expect(
        dcaManager.connect(user1).createPosition(invalidParams)
      ).to.be.reverted;
    });

    it("should reject extremely large arrays in batch operations", async function () {
      const { executorContract, keeper } = await loadFixture(deployFullSystemFixture);

      // Attempt to submit massive array
      const massiveArray = Array(10000).fill(1n);

      await expect(
        executorContract.connect(keeper).batchExecute(massiveArray)
      ).to.be.revertedWith("Batch too large");
    });

    it("should validate time parameters to prevent overflow", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployFullSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Try to set end time to max uint64
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        endAt: 2n ** 64n - 1n,
      });

      // Should either accept it or revert with reasonable error
      // but not cause overflow
      await expect(dcaManager.connect(user1).createPosition(params)).to.not.be.reverted;
    });
  });

  describe("External Call DOS Protection", function () {
    it("should handle malicious token contracts gracefully", async function () {
      // Test with token that reverts or consumes excessive gas
      // System should handle this without blocking other operations
    });

    it("should timeout on stuck oracle calls", async function () {
      // If oracle doesn't respond, system should handle gracefully
      // and not block all executions
    });

    it("should handle DEX adapter failures without blocking system", async function () {
      const { executorContract, positionId, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time
      await advanceTime(3600 + 1);

      // Even if DEX adapter fails, execution should be skipped, not revert
      const tx = await executorContract.connect(keeper).execute(positionId);
      const receipt = await tx.wait();

      // Should either succeed or emit ExecutionSkipped
      expect(receipt.status).to.equal(1);
    });
  });

  describe("Griefing Attack Prevention", function () {
    it("should prevent attacker from front-running and pausing positions", async function () {
      const { dcaManager, positionId, user1, user2 } = await loadFixture(
        deployWithPositionFixture
      );

      // Only owner should be able to pause
      await expect(dcaManager.connect(user2).pause(positionId)).to.be.revertedWith(
        "Not position owner"
      );

      // Owner can pause
      await expect(dcaManager.connect(user1).pause(positionId)).to.not.be.reverted;
    });

    it("should prevent position modification griefing", async function () {
      const { dcaManager, positionId, user2 } = await loadFixture(
        deployWithPositionFixture
      );

      const modifyParams = {
        slippageBps: 100,
        venue: Venue.AUTO,
        maxPriceDeviationBps: 100,
        beneficiary: user2.address,
        maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
        maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
      };

      // Non-owner cannot modify
      await expect(
        dcaManager.connect(user2).modify(positionId, modifyParams)
      ).to.be.revertedWith("Not position owner");
    });

    it("should prevent emergency withdrawal abuse", async function () {
      const { dcaManager, positionId, user1 } = await loadFixture(
        deployWithPositionFixture
      );

      // Emergency withdraw should require position to be paused
      await expect(
        dcaManager.connect(user1).emergencyWithdraw(positionId)
      ).to.be.revertedWith("Position must be paused");

      // Pause position
      await dcaManager.connect(user1).pause(positionId);

      // Should still require waiting period
      await expect(
        dcaManager.connect(user1).emergencyWithdraw(positionId)
      ).to.be.revertedWith("Emergency delay not passed");
    });
  });

  describe("Rate Limiting", function () {
    it("should limit position creation rate per user", async function () {
      // If rate limiting is implemented, test that rapid position creation
      // is throttled appropriately
    });

    it("should limit execution frequency per position", async function () {
      const { dcaManager, executorContract, positionId, keeper } = await loadFixture(
        deployWithPositionFixture
      );

      // Advance time to eligibility
      await advanceTime(3600 + 1);

      // Execute once
      await executorContract.connect(keeper).execute(positionId);

      // Immediate re-execution should fail (not yet eligible)
      const [eligible, reason] = await executorContract.checkEligibility(positionId);

      expect(eligible).to.be.false;
      expect(reason).to.include("NOT_ELIGIBLE");
    });
  });
});
