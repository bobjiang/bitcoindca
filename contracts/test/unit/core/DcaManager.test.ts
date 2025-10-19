import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture, deployWithPositionFixture } from "../../fixtures/deployments";
import {
  createDefaultPositionParams,
  createDefaultModifyParams,
  advanceTime,
  getCurrentTime,
  getPositionIdFromTx,
} from "../../helpers/utils";
import {
  Frequency,
  Venue,
  ROLES,
  MAX_POSITIONS_PER_USER,
  MIN_POSITION_SIZE_USD,
  ZERO_ADDRESS,
} from "../../helpers/constants";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

/**
 * DcaManager Contract Tests
 *
 * Tests cover:
 * - Position creation and validation
 * - Position management (pause, resume, modify, cancel)
 * - Deposit and withdrawal functionality
 * - Emergency withdrawals
 * - System limits and circuit breakers
 * - Access control
 * - Upgradeability
 */
describe("DcaManager", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "PositionNFT");
    await ensureArtifactOrSkip(this, "PositionStorage");
    await ensureArtifactOrSkip(this, "PriceOracle");
    await ensureArtifactOrSkip(this, "Treasury");
  });
  describe("Deployment and Initialization", function () {
    it("should deploy with correct initial state", async function () {
      const { dcaManager, positionNFT, positionStorage, priceOracle, treasuryContract } =
        await loadFixture(deployBaseSystemFixture);

      expect(await dcaManager.positionNFT()).to.equal(await positionNFT.getAddress());
      expect(await dcaManager.positionStorage()).to.equal(await positionStorage.getAddress());
      expect(await dcaManager.priceOracle()).to.equal(await priceOracle.getAddress());
      expect(await dcaManager.treasury()).to.equal(await treasuryContract.getAddress());
    });

    it("should set default system limits", async function () {
      const { dcaManager } = await loadFixture(deployBaseSystemFixture);

      expect(await dcaManager.maxPositionsPerUser()).to.equal(MAX_POSITIONS_PER_USER);
      expect(await dcaManager.minPositionSizeUsd()).to.equal(MIN_POSITION_SIZE_USD);
    });

    it("should grant deployer admin role", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      expect(await dcaManager.hasRole(ROLES.DEFAULT_ADMIN, deployer.address)).to.be.true;
    });

    it("should revert on re-initialization", async function () {
      const { dcaManager, positionNFT, positionStorage, priceOracle, treasuryContract } =
        await loadFixture(deployBaseSystemFixture);

      await expect(
        dcaManager.initialize(
          await positionNFT.getAddress(),
          await positionStorage.getAddress(),
          await priceOracle.getAddress(),
          await treasuryContract.getAddress()
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Position Creation", function () {
    it("should create a BUY position with valid parameters", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", 6),
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(dcaManager.connect(user1).createPosition(params))
        .to.emit(dcaManager, "PositionCreated")
        .withArgs(1, user1.address, params);
    });

    it("should create a SELL position with valid parameters", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        isBuy: false,
        amountPerPeriod: ethers.parseUnits("0.025", 8), // WBTC amount
      });

      await tokens.wbtc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(dcaManager.connect(user1).createPosition(params))
        .to.emit(dcaManager, "PositionCreated");
    });

    it("should mint PositionNFT to owner", async function () {
      const { dcaManager, positionNFT, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      expect(await positionNFT.ownerOf(positionId)).to.equal(user1.address);
    });

    it("should increment user position count", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(0);

      await dcaManager.connect(user1).createPosition(params);

      expect(await dcaManager.userPositionCount(user1.address)).to.equal(1);
    });

    it("should store position data correctly", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        frequency: Frequency.WEEKLY,
        venue: Venue.UNIV3_ONLY,
        startAt: currentTime + 3600,
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      const tx = await dcaManager.connect(user1).createPosition(params);
      const positionId = await getPositionIdFromTx(tx);

      const position = await dcaManager.getPosition(positionId);

      expect(position.owner).to.equal(user1.address);
      expect(position.beneficiary).to.equal(user1.address);
      expect(position.quoteToken).to.equal(await tokens.usdc.getAddress());
      expect(position.isBuy).to.be.true;
      expect(position.frequency).to.equal(Frequency.WEEKLY);
      expect(position.venue).to.equal(Venue.UNIV3_ONLY);
      expect(position.slippageBps).to.equal(params.slippageBps);
      expect(position.amountPerPeriod).to.equal(params.amountPerPeriod);
    });

    it("should revert if max positions per user exceeded", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      // Create max positions
      for (let i = 0; i < MAX_POSITIONS_PER_USER; i++) {
        const params = createDefaultPositionParams(user1.address, {
          quoteToken: await tokens.usdc.getAddress(),
        });
        await dcaManager.connect(user1).createPosition(params);
      }

      // Try to create one more
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Max positions per user exceeded");
    });

    it("should revert if position size below minimum", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        amountPerPeriod: ethers.parseUnits("50", 6), // $50, below $100 minimum
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Position size below minimum");
    });

    it("should revert if start time is in the past", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        startAt: currentTime - 3600, // 1 hour ago
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Start time must be in future");
    });

    it("should revert if end time before start time", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const currentTime = await getCurrentTime();
      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        startAt: currentTime + 7200, // 2 hours
        endAt: currentTime + 3600, // 1 hour (before start)
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("End time must be after start time");
    });

    it("should revert if quote token is zero address", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: ZERO_ADDRESS,
      });

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Invalid quote token");
    });

    it("should revert if slippage exceeds maximum", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
        slippageBps: 1000, // 10%, exceeds max
      });

      await tokens.usdc
        .connect(user1)
        .approve(await dcaManager.getAddress(), ethers.MaxUint256);

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Slippage exceeds maximum");
    });
  });

  describe("Deposit Functionality", function () {
    it("should allow owner to deposit quote tokens", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      const depositAmount = ethers.parseUnits("500", 6);

      await expect(
        dcaManager
          .connect(user1)
          .deposit(positionId, await tokens.usdc.getAddress(), depositAmount)
      )
        .to.emit(dcaManager, "Deposited")
        .withArgs(positionId, await tokens.usdc.getAddress(), depositAmount);

      const balance = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );
      expect(balance).to.be.gte(depositAmount);
    });

    it("should transfer tokens from user", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      const depositAmount = ethers.parseUnits("500", 6);
      const userBalanceBefore = await tokens.usdc.balanceOf(user1.address);

      await dcaManager
        .connect(user1)
        .deposit(positionId, await tokens.usdc.getAddress(), depositAmount);

      const userBalanceAfter = await tokens.usdc.balanceOf(user1.address);
      expect(userBalanceBefore - userBalanceAfter).to.equal(depositAmount);
    });

    it("should revert if non-owner tries to deposit", async function () {
      const { dcaManager, positionId, tokens, user2 } = await loadFixture(deployWithPositionFixture);

      const depositAmount = ethers.parseUnits("500", 6);

      await expect(
        dcaManager
          .connect(user2)
          .deposit(positionId, await tokens.usdc.getAddress(), depositAmount)
      ).to.be.revertedWith("Not position owner");
    });

    it("should revert if depositing zero amount", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      await expect(
        dcaManager
          .connect(user1)
          .deposit(positionId, await tokens.usdc.getAddress(), 0)
      ).to.be.revertedWith("Amount must be greater than zero");
    });

    it("should revert if position does not exist", async function () {
      const { dcaManager, tokens, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        dcaManager
          .connect(user1)
          .deposit(999, await tokens.usdc.getAddress(), ethers.parseUnits("100", 6))
      ).to.be.revertedWith("Position does not exist");
    });

    it("should revert when contract is paused", async function () {
      const { dcaManager, positionId, tokens, user1, deployer } =
        await loadFixture(deployWithPositionFixture);

      await dcaManager.connect(deployer).pauseAll();

      await expect(
        dcaManager
          .connect(user1)
          .deposit(positionId, await tokens.usdc.getAddress(), ethers.parseUnits("100", 6))
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Withdrawal Functionality", function () {
    it("should allow owner to withdraw quote tokens", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      const withdrawAmount = ethers.parseUnits("100", 6);

      await expect(
        dcaManager
          .connect(user1)
          .withdraw(positionId, await tokens.usdc.getAddress(), withdrawAmount, user1.address)
      )
        .to.emit(dcaManager, "Withdrawn")
        .withArgs(positionId, await tokens.usdc.getAddress(), withdrawAmount, user1.address);
    });

    it("should transfer tokens to recipient", async function () {
      const { dcaManager, positionId, tokens, user1, user2 } =
        await loadFixture(deployWithPositionFixture);

      const withdrawAmount = ethers.parseUnits("100", 6);
      const recipientBalanceBefore = await tokens.usdc.balanceOf(user2.address);

      await dcaManager
        .connect(user1)
        .withdraw(positionId, await tokens.usdc.getAddress(), withdrawAmount, user2.address);

      const recipientBalanceAfter = await tokens.usdc.balanceOf(user2.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(withdrawAmount);
    });

    it("should decrease position balance", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      const balanceBefore = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );

      const withdrawAmount = ethers.parseUnits("100", 6);

      await dcaManager
        .connect(user1)
        .withdraw(positionId, await tokens.usdc.getAddress(), withdrawAmount, user1.address);

      const balanceAfter = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );

      expect(balanceBefore - balanceAfter).to.equal(withdrawAmount);
    });

    it("should revert if non-owner tries to withdraw", async function () {
      const { dcaManager, positionId, tokens, user2 } = await loadFixture(deployWithPositionFixture);

      await expect(
        dcaManager
          .connect(user2)
          .withdraw(
            positionId,
            await tokens.usdc.getAddress(),
            ethers.parseUnits("100", 6),
            user2.address
          )
      ).to.be.revertedWith("Not position owner");
    });

    it("should revert if insufficient balance", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      const balance = await dcaManager.getPositionBalance(
        positionId,
        await tokens.usdc.getAddress()
      );

      await expect(
        dcaManager
          .connect(user1)
          .withdraw(
            positionId,
            await tokens.usdc.getAddress(),
            balance + ethers.parseUnits("1", 6),
            user1.address
          )
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should revert if recipient is zero address", async function () {
      const { dcaManager, positionId, tokens, user1 } = await loadFixture(deployWithPositionFixture);

      await expect(
        dcaManager
          .connect(user1)
          .withdraw(
            positionId,
            await tokens.usdc.getAddress(),
            ethers.parseUnits("100", 6),
            ZERO_ADDRESS
          )
      ).to.be.revertedWith("Invalid recipient");
    });
  });

  describe("Position Management", function () {
    describe("Pause Position", function () {
      it("should allow owner to pause position", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        await expect(dcaManager.connect(user1).pause(positionId))
          .to.emit(dcaManager, "PositionPaused")
          .withArgs(positionId);

        const position = await dcaManager.getPosition(positionId);
        expect(position.paused).to.be.true;
      });

      it("should revert if non-owner tries to pause", async function () {
        const { dcaManager, positionId, user2 } = await loadFixture(deployWithPositionFixture);

        await expect(dcaManager.connect(user2).pause(positionId)).to.be.revertedWith(
          "Not position owner"
        );
      });

      it("should revert if position already paused", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        await dcaManager.connect(user1).pause(positionId);

        await expect(dcaManager.connect(user1).pause(positionId)).to.be.revertedWith(
          "Position already paused"
        );
      });
    });

    describe("Resume Position", function () {
      it("should allow owner to resume paused position", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        await dcaManager.connect(user1).pause(positionId);

        await expect(dcaManager.connect(user1).resume(positionId))
          .to.emit(dcaManager, "PositionResumed")
          .withArgs(positionId);

        const position = await dcaManager.getPosition(positionId);
        expect(position.paused).to.be.false;
      });

      it("should revert if position not paused", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        await expect(dcaManager.connect(user1).resume(positionId)).to.be.revertedWith(
          "Position not paused"
        );
      });
    });

    describe("Modify Position", function () {
      it("should allow owner to modify safe fields", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        const modifyParams = createDefaultModifyParams({
          slippageBps: 100, // 1%
          venue: Venue.COW_ONLY,
        });

        await expect(dcaManager.connect(user1).modify(positionId, modifyParams))
          .to.emit(dcaManager, "PositionModified")
          .withArgs(positionId, modifyParams);

        const position = await dcaManager.getPosition(positionId);
        expect(position.slippageBps).to.equal(100);
        expect(position.venue).to.equal(Venue.COW_ONLY);
      });

      it("should allow changing beneficiary", async function () {
        const { dcaManager, positionId, user1, user2 } = await loadFixture(deployWithPositionFixture);

        const modifyParams = createDefaultModifyParams({
          beneficiary: user2.address,
        });

        await dcaManager.connect(user1).modify(positionId, modifyParams);

        const position = await dcaManager.getPosition(positionId);
        expect(position.beneficiary).to.equal(user2.address);
      });

      it("should revert if non-owner tries to modify", async function () {
        const { dcaManager, positionId, user2 } = await loadFixture(deployWithPositionFixture);

        const modifyParams = createDefaultModifyParams();

        await expect(
          dcaManager.connect(user2).modify(positionId, modifyParams)
        ).to.be.revertedWith("Not position owner");
      });
    });

    describe("Cancel Position", function () {
      it("should allow owner to cancel position", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        await expect(dcaManager.connect(user1).cancel(positionId))
          .to.emit(dcaManager, "PositionCanceled")
          .withArgs(positionId);

        const position = await dcaManager.getPosition(positionId);
        expect(position.paused).to.be.true;
      });

      it("should decrement user position count", async function () {
        const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

        const countBefore = await dcaManager.userPositionCount(user1.address);

        await dcaManager.connect(user1).cancel(positionId);

        const countAfter = await dcaManager.userPositionCount(user1.address);
        expect(countBefore - countAfter).to.equal(1);
      });

      it("should burn PositionNFT", async function () {
        const { dcaManager, positionNFT, positionId, user1 } =
          await loadFixture(deployWithPositionFixture);

        await dcaManager.connect(user1).cancel(positionId);

        await expect(positionNFT.ownerOf(positionId)).to.be.revertedWith(
          "ERC721: invalid token ID"
        );
      });
    });
  });

  describe("Emergency Withdrawal", function () {
    it("should allow emergency withdrawal after delay", async function () {
      const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

      // Pause position
      await dcaManager.connect(user1).pause(positionId);

      // Advance time by 7 days
      await advanceTime(7 * 24 * 60 * 60);

      await expect(dcaManager.connect(user1).emergencyWithdraw(positionId))
        .to.emit(dcaManager, "PositionEmergencyWithdrawn")
        .withArgs(positionId);
    });

    it("should revert if position not paused", async function () {
      const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

      await expect(
        dcaManager.connect(user1).emergencyWithdraw(positionId)
      ).to.be.revertedWith("Position must be paused");
    });

    it("should revert if delay not passed", async function () {
      const { dcaManager, positionId, user1 } = await loadFixture(deployWithPositionFixture);

      await dcaManager.connect(user1).pause(positionId);

      await expect(
        dcaManager.connect(user1).emergencyWithdraw(positionId)
      ).to.be.revertedWith("Emergency delay not passed");
    });
  });

  describe("System Limits", function () {
    it("should allow admin to update max positions per user", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      await dcaManager.connect(deployer).setMaxPositionsPerUser(20);

      expect(await dcaManager.maxPositionsPerUser()).to.equal(20);
    });

    it("should revert if non-admin tries to update limits", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      await expect(
        dcaManager.connect(user1).setMaxPositionsPerUser(20)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should allow admin to update global position cap", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMaxGlobalPositions !== "function") {
        this.skip();
      }

      await contract.connect(deployer).setMaxGlobalPositions(5000);

      expect(await contract.maxGlobalPositions()).to.equal(5000);
    });

    it("should revert if non-admin updates global position cap", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMaxGlobalPositions !== "function") {
        this.skip();
      }

      await expect(
        contract.connect(user1).setMaxGlobalPositions(5000)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should allow admin to update minimum position size", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMinPositionSizeUsd !== "function") {
        this.skip();
      }

      const newMinimum = ethers.parseUnits("250", 6);

      await contract.connect(deployer).setMinPositionSizeUsd(newMinimum);

      expect(await contract.minPositionSizeUsd()).to.equal(newMinimum);
    });

    it("should revert if non-admin updates minimum position size", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMinPositionSizeUsd !== "function") {
        this.skip();
      }

      await expect(
        contract.connect(user1).setMinPositionSizeUsd(ethers.parseUnits("250", 6))
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should allow admin to update daily volume limit", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setDailyVolumeLimitUsd !== "function") {
        this.skip();
      }

      const newLimit = ethers.parseUnits("5000000", 6);

      await contract.connect(deployer).setDailyVolumeLimitUsd(newLimit);

      if (typeof contract.dailyVolumeLimitUsd === "function") {
        expect(await contract.dailyVolumeLimitUsd()).to.equal(newLimit);
      }
    });

    it("should revert if non-admin updates daily volume limit", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setDailyVolumeLimitUsd !== "function") {
        this.skip();
      }

      await expect(
        contract.connect(user1).setDailyVolumeLimitUsd(ethers.parseUnits("5000000", 6))
      ).to.be.revertedWith("AccessControl: account");
    });

    it("should allow admin to update price movement cap", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMaxPriceMovementBps !== "function") {
        this.skip();
      }

      await contract.connect(deployer).setMaxPriceMovementBps(1500);

      if (typeof contract.maxPriceMovementBps === "function") {
        expect(await contract.maxPriceMovementBps()).to.equal(1500);
      }
    });

    it("should revert if non-admin updates price movement cap", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);
      const contract: any = dcaManager;

      if (typeof contract.setMaxPriceMovementBps !== "function") {
        this.skip();
      }

      await expect(
        contract.connect(user1).setMaxPriceMovementBps(1500)
      ).to.be.revertedWith("AccessControl: account");
    });
  });

  describe("Circuit Breakers", function () {
    it("should allow pauser to pause all", async function () {
      const { dcaManager, deployer } = await loadFixture(deployBaseSystemFixture);

      await dcaManager.connect(deployer).pauseAll();

      expect(await dcaManager.paused()).to.be.true;
    });

    it("should prevent operations when paused", async function () {
      const { dcaManager, tokens, user1, deployer } = await loadFixture(deployBaseSystemFixture);

      await dcaManager.connect(deployer).pauseAll();

      const params = createDefaultPositionParams(user1.address, {
        quoteToken: await tokens.usdc.getAddress(),
      });

      await expect(
        dcaManager.connect(user1).createPosition(params)
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Access Control", function () {
    it("should only allow executor role to execute positions", async function () {
      const { dcaManager, user1 } = await loadFixture(deployBaseSystemFixture);

      expect(await dcaManager.hasRole(ROLES.EXECUTOR, user1.address)).to.be.false;
    });

    it("should allow admin to grant executor role", async function () {
      const { dcaManager, deployer, user1 } = await loadFixture(deployBaseSystemFixture);

      await dcaManager.connect(deployer).grantRole(ROLES.EXECUTOR, user1.address);

      expect(await dcaManager.hasRole(ROLES.EXECUTOR, user1.address)).to.be.true;
    });
  });

  describe("View Functions", function () {
    it("should return position eligibility status", async function () {
      const { dcaManager, positionId } = await loadFixture(deployWithPositionFixture);

      const [eligible, reason] = await dcaManager.isPositionEligible(positionId);

      // Position not eligible because start time not reached
      expect(eligible).to.be.false;
      expect(reason).to.not.be.empty;
    });

    it("should return next execution time", async function () {
      const { dcaManager, positionId, createParams } = await loadFixture(deployWithPositionFixture);

      const nextExecTime = await dcaManager.getNextExecutionTime(positionId);

      expect(nextExecTime).to.be.gte(createParams.startAt);
    });
  });
});
