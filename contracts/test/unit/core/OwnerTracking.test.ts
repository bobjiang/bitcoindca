import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture } from "../../fixtures/deployments";
import {
  createDefaultPositionParams,
  getPositionIdFromTx,
} from "../../helpers/utils";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * Owner Position Tracking Tests
 *
 * Tests for H-3: _removeOwnerPosition validation
 * Tests position tracking integrity during lifecycle operations
 */
describe("Owner Position Tracking", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "PositionNFT");
  });

  describe("H-3: Position Removal Validation", function () {
    it("should correctly remove position from owner list on cancel", async function () {
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

      // Verify all 3 tracked
      let positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(3);

      // Cancel middle position
      await dcaManager.connect(user1).cancel(positionId2);

      // Verify position removed and array still valid (FIX H-3)
      positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(2);
      expect(positions).to.include(positionId1);
      expect(positions).to.include(positionId3);
      expect(positions).to.not.include(positionId2);
    });

    it("should maintain correct indices after removal", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create 5 positions
      const positionIds: bigint[] = [];
      for (let i = 0; i < 5; i++) {
        const tx = await dcaManager.connect(user1).createPosition(params);
        const id = await getPositionIdFromTx(tx);
        positionIds.push(id);
      }

      // Remove first position
      await dcaManager.connect(user1).cancel(positionIds[0]);

      // Remove middle position
      await dcaManager.connect(user1).cancel(positionIds[2]);

      // Verify remaining positions are correct
      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(3);
      expect(positions).to.include(positionIds[1]);
      expect(positions).to.include(positionIds[3]);
      expect(positions).to.include(positionIds[4]);
    });

    it("should handle removing last position", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);

      // Cancel only position
      await dcaManager.connect(user1).cancel(positionId);

      // Should have no positions
      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(0);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);
    });

    it("should update position count correctly on removal", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create 3 positions
      const tx1 = await dcaManager.connect(user1).createPosition(params);
      const id1 = await getPositionIdFromTx(tx1);
      const tx2 = await dcaManager.connect(user1).createPosition(params);
      const id2 = await getPositionIdFromTx(tx2);
      const tx3 = await dcaManager.connect(user1).createPosition(params);
      const id3 = await getPositionIdFromTx(tx3);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(3);

      // Cancel one
      await dcaManager.connect(user1).cancel(id1);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(2);

      // Cancel another
      await dcaManager.connect(user1).cancel(id3);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);

      // Cancel last
      await dcaManager.connect(user1).cancel(id2);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);
    });

    it("should correctly handle position removal via NFT transfer", async function () {
      const { dcaManager, positionNFT, tokens, user1, user2 } =
        await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // User1 creates 2 positions
      const tx1 = await dcaManager.connect(user1).createPosition(params);
      const positionId1 = await getPositionIdFromTx(tx1);

      const tx2 = await dcaManager.connect(user1).createPosition(params);
      const positionId2 = await getPositionIdFromTx(tx2);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(2);
      expect(await dcaManager.userPositionCount(user2.address)).to.equal(0);

      // Pause and transfer one position
      await dcaManager.connect(user1).pause(positionId1);
      await positionNFT.connect(user1).transferFrom(user1.address, user2.address, positionId1);

      // Verify removal from user1 and addition to user2
      const user1Positions = await dcaManager.positionsByOwner(user1.address);
      const user2Positions = await dcaManager.positionsByOwner(user2.address);

      expect(user1Positions.length).to.equal(1);
      expect(user1Positions).to.include(positionId2);
      expect(user1Positions).to.not.include(positionId1);

      expect(user2Positions.length).to.equal(1);
      expect(user2Positions).to.include(positionId1);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);
      expect(await dcaManager.userPositionCount(user2.address)).to.equal(1);
    });

    it("should maintain position list integrity after multiple operations", async function () {
      const { dcaManager, positionNFT, tokens, user1, user2 } =
        await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create 4 positions
      const ids: bigint[] = [];
      for (let i = 0; i < 4; i++) {
        const tx = await dcaManager.connect(user1).createPosition(params);
        ids.push(await getPositionIdFromTx(tx));
      }

      // Cancel one
      await dcaManager.connect(user1).cancel(ids[1]);

      // Transfer one
      await dcaManager.connect(user1).pause(ids[2]);
      await positionNFT.connect(user1).transferFrom(user1.address, user2.address, ids[2]);

      // Cancel another
      await dcaManager.connect(user1).cancel(ids[0]);

      // User1 should have 1 position left (ids[3])
      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(1);
      expect(positions[0]).to.equal(ids[3]);

      // User2 should have 1 position (ids[2])
      const user2Positions = await dcaManager.positionsByOwner(user2.address);
      expect(user2Positions.length).to.equal(1);
      expect(user2Positions[0]).to.equal(ids[2]);
    });

    it("should handle emergency withdraw similar to cancel", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create 2 positions
      const tx1 = await dcaManager.connect(user1).createPosition(params);
      const id1 = await getPositionIdFromTx(tx1);

      const tx2 = await dcaManager.connect(user1).createPosition(params);
      const id2 = await getPositionIdFromTx(tx2);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(2);

      // Pause first position
      await dcaManager.connect(user1).pause(id1);

      // Call emergency withdraw once (sets timer)
      await expect(
        dcaManager.connect(user1).emergencyWithdraw(id1)
      ).to.be.revertedWithCustomError(dcaManager, "EmergencyDelayPending");

      // Get unlock time and advance
      const position = await dcaManager.getPosition(id1);
      const unlockAt = position.emergencyUnlockAt;

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(unlockAt)]);
      await ethers.provider.send("evm_mine", []);

      // Emergency withdraw should succeed and remove from list
      await dcaManager.connect(user1).emergencyWithdraw(id1);

      const positions = await dcaManager.positionsByOwner(user1.address);
      expect(positions.length).to.equal(1);
      expect(positions[0]).to.equal(id2);
      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);
    });
  });

  describe("Position List Consistency", function () {
    it("should never have duplicate position IDs in owner list", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // Create multiple positions
      for (let i = 0; i < 5; i++) {
        await dcaManager.connect(user1).createPosition(params);
      }

      const positions = await dcaManager.positionsByOwner(user1.address);
      const uniquePositions = [...new Set(positions.map(p => p.toString()))];

      expect(positions.length).to.equal(uniquePositions.length);
    });

    it("should correctly report positions for multiple users", async function () {
      const { dcaManager, tokens, user1, user2 } = await loadFixture(deployBaseSystemFixture);

      const params1 = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      const params2 = createDefaultPositionParams(user2.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      // User1 creates 3 positions
      const user1Ids: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        const tx = await dcaManager.connect(user1).createPosition(params1);
        user1Ids.push(await getPositionIdFromTx(tx));
      }

      // User2 creates 2 positions
      const user2Ids: bigint[] = [];
      for (let i = 0; i < 2; i++) {
        const tx = await dcaManager.connect(user2).createPosition(params2);
        user2Ids.push(await getPositionIdFromTx(tx));
      }

      // Verify isolation
      const user1Positions = await dcaManager.positionsByOwner(user1.address);
      const user2Positions = await dcaManager.positionsByOwner(user2.address);

      expect(user1Positions.length).to.equal(3);
      expect(user2Positions.length).to.equal(2);

      // Check no cross-contamination
      for (const id of user1Ids) {
        expect(user1Positions).to.include(id);
        expect(user2Positions).to.not.include(id);
      }

      for (const id of user2Ids) {
        expect(user2Positions).to.include(id);
        expect(user1Positions).to.not.include(id);
      }
    });
  });
});
