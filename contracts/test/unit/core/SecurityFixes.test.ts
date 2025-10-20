import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture } from "../../fixtures/deployments";
import {
  createDefaultPositionParams,
  createDefaultModifyParams,
  getCurrentTime,
  getPositionIdFromTx,
} from "../../helpers/utils";
import {
  Frequency,
  Venue,
  ROLES,
  MAX_POSITIONS_PER_USER,
  ZERO_ADDRESS,
} from "../../helpers/constants";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * Security Fixes Test Suite
 *
 * Tests for critical and high severity fixes:
 * - C-1: Owner tracking in createPosition()
 * - C-2: Position transfer limit bypass
 * - C-3: Price staleness validation
 * - C-4: Deviation calculation symmetry
 * - H-1: Emergency withdraw delay persistence
 * - H-2: Global position counter reconciliation
 * - H-5: PositionStorage access control
 */
describe("Security Fixes", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "PositionNFT");
    await ensureArtifactOrSkip(this, "PositionStorage");
    await ensureArtifactOrSkip(this, "PriceOracle");
  });

  describe("C-1: Owner Tracking on Position Creation", function () {
    it("should add position to owner's list immediately after creation", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      // Check initial state - user should have no positions
      const initialPositions = await dcaManager.positionsByOwner(user1.address);
      expect(initialPositions.length).to.equal(0);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);

      // Create position
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Verify position is immediately in owner's list (FIX C-1)
      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(1);
      expect(positions[0]).to.equal(positionId);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);
    });

    it("should track multiple positions for same owner", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create 3 positions
      const tx1 = await dcaManager.connect(user1).createPosition(params);
      const positionId1 = await getPositionIdFromTx(tx1);

      const tx2 = await dcaManager.connect(user1).createPosition(params);
      const positionId2 = await getPositionIdFromTx(tx2);

      const tx3 = await dcaManager.connect(user1).createPosition(params);
      const positionId3 = await getPositionIdFromTx(tx3);

      // Verify all positions tracked
      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(3);
      expect(positions).to.include(positionId1);
      expect(positions).to.include(positionId2);
      expect(positions).to.include(positionId3);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(3);
    });

    it("should update user position count correctly on creation", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      await dcaManager.connect(user1).createPosition(params);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);

      await dcaManager.connect(user1).createPosition(params);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(2);
    });
  });

  describe("C-2: Position Transfer Limit Bypass Prevention", function () {
    it("should prevent transfer when recipient is at maxPositionsPerUser", async function () {
      const { dcaManager, positionNFT, tokens, user1, user2, deployer } =
        await loadFixture(deployBaseSystemFixture);

      // Set low limit for testing
      await dcaManager.connect(deployer).setMaxPositionsPerUser(2);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // User1 creates 1 position
      const tx1 = await dcaManager.connect(user1).createPosition(params);
      const positionId1 = await getPositionIdFromTx(tx1);

      // User2 creates 2 positions (at limit)
      const params2 = createDefaultPositionParams(user2.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });
      await dcaManager.connect(user2).createPosition(params2);
      await dcaManager.connect(user2).createPosition(params2);

      expect(await dcaManager.userPositionCount(user2.address)).to.equal(2);

      // User1 pauses position (required for transfer)
      await dcaManager.connect(user1).pause(positionId1);

      // Try to transfer to user2 (should revert due to limit) - FIX C-2
      await expect(
        positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId1)
      ).to.be.revertedWithCustomError(dcaManager, "MaxPositionsPerUserExceeded");
    });

    it("should allow transfer when recipient is below limit", async function () {
      const { dcaManager, positionNFT, tokens, user1, user2, deployer } =
        await loadFixture(deployBaseSystemFixture);

      await dcaManager.connect(deployer).setMaxPositionsPerUser(5);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // User1 creates position
      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // User2 has 0 positions (below limit)
      expect(await dcaManager.userPositionCount(user2.address)).to.equal(0);

      // Pause and transfer
      await dcaManager.connect(user1).pause(positionId);
      await expect(
        positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId)
      ).to.not.be.reverted;

      // Verify ownership changed
      expect(await positionNFT.ownerOf(positionId)).to.equal(user2.address);
      expect(await dcaManager.userPositionCount(user2.address)).to.equal(1);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);
    });

    it("should prevent transfer of active (non-paused) positions", async function () {
      const { dcaManager, positionNFT, tokens, user1, user2 } =
        await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Try to transfer active position (should fail)
      await expect(
        positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId)
      ).to.be.revertedWithCustomError(dcaManager, "TransferNotAllowed");
    });
  });

  describe("C-3: Price Staleness Validation", function () {
    it("should reject stale price data from oracle", async function () {
      const { priceOracle, tokens, deployer } = await loadFixture(deployBaseSystemFixture);

      // Deploy a mock aggregator with stale data
      const MockAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
      const staleTimestamp = (await time.latest()) - 3600; // 1 hour ago
      const staleAggregator = await MockAggregator.deploy(
        8, // decimals
        50000_00000000, // $50,000 per BTC
        staleTimestamp // stale timestamp
      );

      // Add feed to oracle
      const testToken = await tokens.usdc.getAddress();
      await priceOracle.connect(deployer).addPriceFeed(testToken, await staleAggregator.getAddress());

      // Try to get price (should revert due to staleness) - FIX C-3
      await expect(
        priceOracle.getTokenPrice(testToken)
      ).to.be.revertedWith("Price data stale");
    });

    it("should accept fresh price data", async function () {
      const { priceOracle, tokens, deployer } = await loadFixture(deployBaseSystemFixture);

      // Deploy mock with fresh data
      const MockAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
      const freshTimestamp = await time.latest();
      const freshAggregator = await MockAggregator.deploy(
        8,
        50000_00000000,
        freshTimestamp
      );

      const testToken = await tokens.wbtc.getAddress();
      await priceOracle.connect(deployer).addPriceFeed(testToken, await freshAggregator.getAddress());

      // Should succeed
      const [price, updatedAt] = await priceOracle.getTokenPrice(testToken);
      expect(price).to.equal(50000_00000000);
      expect(updatedAt).to.equal(freshTimestamp);
    });

    it("should use configurable staleness threshold", async function () {
      const { priceOracle, deployer } = await loadFixture(deployBaseSystemFixture);

      // Default is 1800 seconds (30 min)
      expect(await priceOracle.maxStaleness()).to.equal(1800);

      // Update to 1 hour
      await priceOracle.connect(deployer).setMaxStaleness(3600);
      expect(await priceOracle.maxStaleness()).to.equal(3600);
    });
  });

  describe("C-4: Deviation Calculation Symmetry", function () {
    it("should calculate same deviation regardless of parameter order", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("100", 8);
      const price2 = ethers.parseUnits("110", 8);
      const maxDeviationBps = 1000; // 10%

      // Calculate deviation both ways
      const [valid1, deviation1] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      const [valid2, deviation2] = await priceOracle.validatePriceDeviation(
        price2,
        price1,
        maxDeviationBps
      );

      // Both should give same result (FIX C-4)
      expect(deviation1).to.equal(deviation2);
      expect(valid1).to.equal(valid2);
    });

    it("should use larger price as base for calculation", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("100", 8);
      const price2 = ethers.parseUnits("90", 8);
      const maxDeviationBps = 2000; // 20%

      // Deviation should be (10 / 100) * 10000 = 1000 bps (10%)
      const [valid, deviationBps] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      expect(deviationBps).to.equal(1000); // 10%
      expect(valid).to.be.true;
    });

    it("should correctly identify prices within threshold", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("100", 8);
      const price2 = ethers.parseUnits("101", 8); // 1% difference
      const maxDeviationBps = 200; // 2% allowed

      const [valid, deviation] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      expect(valid).to.be.true;
      expect(deviation).to.be.lte(maxDeviationBps);
    });

    it("should correctly identify prices outside threshold", async function () {
      const { priceOracle } = await loadFixture(deployBaseSystemFixture);

      const price1 = ethers.parseUnits("100", 8);
      const price2 = ethers.parseUnits("120", 8); // 20% difference
      const maxDeviationBps = 1000; // 10% allowed

      const [valid, deviation] = await priceOracle.validatePriceDeviation(
        price1,
        price2,
        maxDeviationBps
      );

      expect(valid).to.be.false;
      expect(deviation).to.be.gt(maxDeviationBps);
    });
  });

  describe("H-1: Emergency Withdraw Delay Persistence", function () {
    it("should not reset emergency unlock timer on resume", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      // Create and pause position
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      await dcaManager.connect(user1).pause(positionId);

      // Get emergency unlock time
      const position = await dcaManager.getPosition(positionId);
      const originalUnlockTime = position.emergencyUnlockAt;
      expect(originalUnlockTime).to.be.gt(0);

      // Resume position
      await dcaManager.connect(user1).resume(positionId);

      // Emergency unlock time should persist (FIX H-1)
      const positionAfterResume = await dcaManager.getPosition(positionId);
      expect(positionAfterResume.emergencyUnlockAt).to.equal(originalUnlockTime);
    });

    it("should allow emergency withdraw after delay even if resumed", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Deposit some funds
      await tokens.usdc.connect(user1).approve(
        await dcaManager.getAddress(),
        ethers.parseUnits("1000", 6)
      );
      await dcaManager.connect(user1).deposit(
        positionId,
        await tokens.usdc.getAddress(),
        ethers.parseUnits("1000", 6)
      );

      // Pause
      await dcaManager.connect(user1).pause(positionId);
      const position = await dcaManager.getPosition(positionId);
      const unlockTime = position.emergencyUnlockAt;

      // Resume (timer persists)
      await dcaManager.connect(user1).resume(positionId);

      // Re-pause for emergency withdraw
      await dcaManager.connect(user1).pause(positionId);

      // Advance time past original unlock
      await time.increaseTo(unlockTime);

      // Should be able to emergency withdraw
      await expect(
        dcaManager.connect(user1).emergencyWithdraw(positionId)
      ).to.not.be.reverted;
    });

    it("should prevent delay manipulation via pause-resume cycling", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // First pause
      await dcaManager.connect(user1).pause(positionId);
      const position1 = await dcaManager.getPosition(positionId);
      const unlock1 = position1.emergencyUnlockAt;

      // Resume and pause again
      await dcaManager.connect(user1).resume(positionId);
      await dcaManager.connect(user1).pause(positionId);
      const position2 = await dcaManager.getPosition(positionId);
      const unlock2 = position2.emergencyUnlockAt;

      // Second unlock should be based on new pause time, but can't go backwards
      // The new pause sets a new timer, but old timer persists
      expect(unlock2).to.be.gte(unlock1);
    });
  });

  describe("H-2: Global Position Counter Reconciliation", function () {
    it("should allow admin to reconcile active position count", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      const initialCount = await dcaManager.activeGlobalPositions();

      // Admin reconciles to new value
      const newCount = 42n;
      await expect(
        dcaManager.connect(deployer).reconcileActivePositions(newCount)
      )
        .to.emit(dcaManager, "ActivePositionsReconciled")
        .withArgs(initialCount, newCount);

      expect(await dcaManager.activeGlobalPositions()).to.equal(newCount);
    });

    it("should prevent non-admin from reconciling", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        dcaManager.connect(user1).reconcileActivePositions(100)
      ).to.be.reverted; // Should revert with access control error
    });

    it("should emit correct event on reconciliation", async function () {
      const { dcaManager, tokens, deployer, user1 } = await loadFixture(deployBaseSystemFixture);

      // Create a position to have non-zero count
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });
      await dcaManager.connect(user1).createPosition(params);

      const oldCount = await dcaManager.activeGlobalPositions();
      const newCount = 5n;

      await expect(
        dcaManager.connect(deployer).reconcileActivePositions(newCount)
      )
        .to.emit(dcaManager, "ActivePositionsReconciled")
        .withArgs(oldCount, newCount);
    });
  });

  describe("H-5: PositionStorage Access Control", function () {
    it("should allow setting DcaManager address once", async function () {
      const { positionStorage, dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      // Initially not set
      expect(await positionStorage.dcaManager()).to.equal(ZERO_ADDRESS);

      // Set it
      const dcaAddr = await dcaManager.getAddress();
      await expect(
        positionStorage.connect(deployer).setDcaManager(dcaAddr)
      )
        .to.emit(positionStorage, "DcaManagerSet")
        .withArgs(dcaAddr);

      expect(await positionStorage.dcaManager()).to.equal(dcaAddr);
    });

    it("should prevent setting DcaManager twice", async function () {
      const { positionStorage, dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      const dcaAddr = await dcaManager.getAddress();
      await positionStorage.connect(deployer).setDcaManager(dcaAddr);

      // Try to set again
      await expect(
        positionStorage.connect(deployer).setDcaManager(dcaAddr)
      ).to.be.revertedWith("DCA manager already set");
    });

    it("should prevent setting zero address as DcaManager", async function () {
      const { positionStorage, deployer } = await loadFixture(deployBaseSystemFixture);

      await expect(
        positionStorage.connect(deployer).setDcaManager(ZERO_ADDRESS)
      ).to.be.revertedWith("Invalid DCA manager");
    });

    it("should only allow DcaManager to call setPositionMetadata", async function () {
      const { positionStorage, dcaManager, deployer, user1 } =
        await loadFixture(deployBaseSystemFixture);

      // Set DcaManager
      const dcaAddr = await dcaManager.getAddress();
      await positionStorage.connect(deployer).setDcaManager(dcaAddr);

      const metadata = {
        owner: user1.address,
        beneficiary: user1.address,
        quote: ZERO_ADDRESS,
        isBuy: true,
        frequency: Frequency.DAILY,
        venue: Venue.AUTO,
        slippageBps: 50,
        amountPerPeriod: ethers.parseUnits("100", 6),
        startAt: await getCurrentTime() + 3600,
        endAt: 0,
      };

      // Admin should not be able to call it directly anymore (FIX H-5)
      await expect(
        positionStorage.connect(deployer).setPositionMetadata(1, metadata)
      ).to.be.revertedWith("Not DCA manager");

      // Random user definitely can't
      await expect(
        positionStorage.connect(user1).setPositionMetadata(1, metadata)
      ).to.be.revertedWith("Not DCA manager");
    });

    it("should only allow DcaManager to call removePositionMetadata", async function () {
      const { positionStorage, dcaManager, deployer, user1 } =
        await loadFixture(deployBaseSystemFixture);

      // Set DcaManager
      const dcaAddr = await dcaManager.getAddress();
      await positionStorage.connect(deployer).setDcaManager(dcaAddr);

      // Admin cannot remove
      await expect(
        positionStorage.connect(deployer).removePositionMetadata(1)
      ).to.be.revertedWith("Not DCA manager");

      // User cannot remove
      await expect(
        positionStorage.connect(user1).removePositionMetadata(1)
      ).to.be.revertedWith("Not DCA manager");
    });

    it("should allow DcaManager contract to call restricted functions", async function () {
      const { positionStorage, dcaManager, tokens, deployer, user1 } =
        await loadFixture(deployBaseSystemFixture);

      // Set DcaManager
      const dcaAddr = await dcaManager.getAddress();
      await positionStorage.connect(deployer).setDcaManager(dcaAddr);

      // Create position through DcaManager (which calls setPositionMetadata internally)
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      // Should have created metadata successfully
      const metadata = await positionStorage.getPositionMetadata(positionId);
      expect(metadata.owner).to.equal(user1.address);
    });
  });
});
