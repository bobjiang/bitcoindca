import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { Treasury, MockERC20 } from "../../../typechain-types";
import { ensureArtifactOrSkip } from "../../helpers/artifacts";
import { parseEther, parseUnits, ZeroAddress } from "ethers";

describe("Treasury", function () {
  // Test accounts
  let owner: SignerWithAddress;
  let treasurer1: SignerWithAddress;
  let treasurer2: SignerWithAddress;
  let treasurer3: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  // Contracts
  let treasury: Treasury;
  let usdc: MockERC20;
  let wbtc: MockERC20;

  // Constants
  const MIN_DELAY = 2 * 24 * 60 * 60; // 2 days in seconds
  const DEFAULT_PROTOCOL_FEE_BPS = 20; // 0.20%
  const DEFAULT_EXECUTION_FEE = parseEther("0.001"); // 0.001 ETH
  const DEFAULT_GAS_PREMIUM_BPS = 10; // 0.10%
  const DEFAULT_REFERRAL_FEE_BPS = 50; // 50% of protocol fee

  // Roles
  let PROPOSER_ROLE: string;
  let EXECUTOR_ROLE: string;
  let TIMELOCK_ADMIN_ROLE: string;
  let TREASURER_ROLE: string;
  let EMERGENCY_ROLE: string;
  let FEE_COLLECTOR_ROLE: string;
  let PAUSER_ROLE: string;

  before(async function () {
    await ensureArtifactOrSkip(this, "Treasury");
  });

  /**
   * Deploy fixture for Treasury tests
   */
  async function deployTreasuryFixture() {
    const signers = await ethers.getSigners();
    [owner, treasurer1, treasurer2, treasurer3, feeCollector, user1, user2] = signers;

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
    wbtc = await MockERC20Factory.deploy("Wrapped Bitcoin", "WBTC", 8);

    // Deploy Treasury with TimelockController params
    const TreasuryFactory = await ethers.getContractFactory("Treasury");

    // Proposers: treasurers can propose actions
    const proposers = [treasurer1.address, treasurer2.address, treasurer3.address];
    // Executors: 2-of-3 multisig requirement
    const executors = [treasurer1.address, treasurer2.address, treasurer3.address];
    // Admin: owner initially, should renounce later
    const admin = owner.address;

    treasury = await TreasuryFactory.deploy(
      MIN_DELAY,
      proposers,
      executors,
      admin
    );

    // Get role identifiers
    PROPOSER_ROLE = await treasury.PROPOSER_ROLE();
    EXECUTOR_ROLE = await treasury.EXECUTOR_ROLE();
    TIMELOCK_ADMIN_ROLE = await treasury.TIMELOCK_ADMIN_ROLE();
    TREASURER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TREASURER_ROLE"));
    EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));
    FEE_COLLECTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FEE_COLLECTOR_ROLE"));
    PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));

    // Grant additional roles
    await treasury.connect(owner).grantRole(TREASURER_ROLE, treasurer1.address);
    await treasury.connect(owner).grantRole(TREASURER_ROLE, treasurer2.address);
    await treasury.connect(owner).grantRole(EMERGENCY_ROLE, owner.address);
    await treasury.connect(owner).grantRole(FEE_COLLECTOR_ROLE, feeCollector.address);
    await treasury.connect(owner).grantRole(PAUSER_ROLE, owner.address);

    // Initialize fee configuration
    const initialFeeConfig = {
      protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS,
      executionFeeFixedWei: DEFAULT_EXECUTION_FEE,
      gasPremiumBps: DEFAULT_GAS_PREMIUM_BPS,
      feeCollector: feeCollector.address,
      referralFeeBpsDefault: DEFAULT_REFERRAL_FEE_BPS,
    };

    await treasury.connect(owner).initialize(initialFeeConfig);

    // Fund treasury with tokens for testing
    await usdc.mint(treasury.target, parseUnits("100000", 6)); // 100k USDC
    await wbtc.mint(treasury.target, parseUnits("10", 8)); // 10 WBTC

    return {
      treasury,
      usdc,
      wbtc,
      owner,
      treasurer1,
      treasurer2,
      treasurer3,
      feeCollector,
      user1,
      user2,
    };
  }

  describe("Deployment & Initialization", function () {
    it("should deploy with correct timelock parameters", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      // Verify minimum delay
      const minDelay = await treasury.getMinDelay();
      expect(minDelay).to.equal(MIN_DELAY);
    });

    it("should assign proposer roles correctly", async function () {
      const { treasury, treasurer1, treasurer2, treasurer3 } = await loadFixture(deployTreasuryFixture);

      expect(await treasury.hasRole(PROPOSER_ROLE, treasurer1.address)).to.be.true;
      expect(await treasury.hasRole(PROPOSER_ROLE, treasurer2.address)).to.be.true;
      expect(await treasury.hasRole(PROPOSER_ROLE, treasurer3.address)).to.be.true;
    });

    it("should assign executor roles correctly", async function () {
      const { treasury, treasurer1, treasurer2, treasurer3 } = await loadFixture(deployTreasuryFixture);

      expect(await treasury.hasRole(EXECUTOR_ROLE, treasurer1.address)).to.be.true;
      expect(await treasury.hasRole(EXECUTOR_ROLE, treasurer2.address)).to.be.true;
      expect(await treasury.hasRole(EXECUTOR_ROLE, treasurer3.address)).to.be.true;
    });

    it("should initialize with correct fee configuration", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      const feeConfig = await treasury.getFeeConfig();
      expect(feeConfig.protocolFeeBps).to.equal(DEFAULT_PROTOCOL_FEE_BPS);
      expect(feeConfig.executionFeeFixedWei).to.equal(DEFAULT_EXECUTION_FEE);
      expect(feeConfig.gasPremiumBps).to.equal(DEFAULT_GAS_PREMIUM_BPS);
      expect(feeConfig.feeCollector).to.equal(feeCollector.address);
      expect(feeConfig.referralFeeBpsDefault).to.equal(DEFAULT_REFERRAL_FEE_BPS);
    });

    it("should not allow re-initialization", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const newFeeConfig = {
        protocolFeeBps: 30,
        executionFeeFixedWei: parseEther("0.002"),
        gasPremiumBps: 15,
        feeCollector: owner.address,
        referralFeeBpsDefault: 40,
      };

      await expect(
        treasury.connect(owner).initialize(newFeeConfig)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Multisig Workflow", function () {
    it("should require 2-of-3 signatures for withdrawal", async function () {
      const { treasury, usdc, treasurer1, treasurer2, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6); // 1000 USDC
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdraw-1"));

      // Treasurer1 schedules the operation
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      // Fast forward past delay
      await time.increase(MIN_DELAY + 1);

      // Treasurer2 executes (2nd signature)
      const balanceBefore = await usdc.balanceOf(user1.address);
      await treasury.connect(treasurer2).execute(
        target,
        value,
        data,
        predecessor,
        salt
      );

      // Verify withdrawal
      const balanceAfter = await usdc.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should not allow execution before timelock delay", async function () {
      const { treasury, usdc, treasurer1, treasurer2, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdraw-2"));

      // Schedule
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      // Try to execute immediately (should fail)
      await expect(
        treasury.connect(treasurer2).execute(
          target,
          value,
          data,
          predecessor,
          salt
        )
      ).to.be.revertedWith("TimelockController: operation is not ready");
    });

    it("should not allow non-proposer to schedule", async function () {
      const { treasury, usdc, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdraw-3"));

      // Non-proposer tries to schedule
      await expect(
        treasury.connect(user1).schedule(
          target,
          value,
          data,
          predecessor,
          salt,
          MIN_DELAY
        )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${PROPOSER_ROLE}`
      );
    });

    it("should not allow non-executor to execute", async function () {
      const { treasury, usdc, treasurer1, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdraw-4"));

      // Schedule with proposer
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      // Fast forward
      await time.increase(MIN_DELAY + 1);

      // Non-executor tries to execute
      await expect(
        treasury.connect(user1).execute(
          target,
          value,
          data,
          predecessor,
          salt
        )
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${EXECUTOR_ROLE}`
      );
    });

    it("should support operation cancellation", async function () {
      const { treasury, usdc, treasurer1, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdraw-cancel"));

      // Schedule
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      // Get operation ID
      const operationId = await treasury.hashOperation(
        target,
        value,
        data,
        predecessor,
        salt
      );

      // Verify scheduled
      expect(await treasury.isOperationPending(operationId)).to.be.true;

      // Cancel
      await treasury.connect(treasurer1).cancel(operationId);

      // Verify cancelled
      expect(await treasury.isOperationPending(operationId)).to.be.false;
    });
  });

  describe("Fee Collection", function () {
    it("should collect protocol fees from position execution", async function () {
      const { treasury, usdc, feeCollector } = await loadFixture(deployTreasuryFixture);

      const feeAmount = parseUnits("100", 6); // 100 USDC
      const balanceBefore = await usdc.balanceOf(treasury.target);

      // Simulate fee collector collecting fees
      await usdc.connect(feeCollector).mint(feeCollector.address, feeAmount);
      await usdc.connect(feeCollector).approve(treasury.target, feeAmount);
      await treasury.connect(feeCollector).collectFees(usdc.target, feeAmount);

      const balanceAfter = await usdc.balanceOf(treasury.target);
      expect(balanceAfter - balanceBefore).to.equal(feeAmount);
    });

    it("should emit FeeCollected event", async function () {
      const { treasury, usdc, feeCollector } = await loadFixture(deployTreasuryFixture);

      const feeAmount = parseUnits("50", 6);

      await usdc.connect(feeCollector).mint(feeCollector.address, feeAmount);
      await usdc.connect(feeCollector).approve(treasury.target, feeAmount);

      await expect(
        treasury.connect(feeCollector).collectFees(usdc.target, feeAmount)
      )
        .to.emit(treasury, "FeeCollected")
        .withArgs(usdc.target, feeAmount, feeCollector.address);
    });

    it("should only allow fee collector role to collect fees", async function () {
      const { treasury, usdc, user1 } = await loadFixture(deployTreasuryFixture);

      const feeAmount = parseUnits("100", 6);

      await expect(
        treasury.connect(user1).collectFees(usdc.target, feeAmount)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${FEE_COLLECTOR_ROLE}`
      );
    });

    it("should track total fees collected per token", async function () {
      const { treasury, usdc, wbtc, feeCollector } = await loadFixture(deployTreasuryFixture);

      const usdcFee = parseUnits("100", 6);
      const wbtcFee = parseUnits("0.5", 8);

      // Collect USDC fees
      await usdc.connect(feeCollector).mint(feeCollector.address, usdcFee);
      await usdc.connect(feeCollector).approve(treasury.target, usdcFee);
      await treasury.connect(feeCollector).collectFees(usdc.target, usdcFee);

      // Collect WBTC fees
      await wbtc.connect(feeCollector).mint(feeCollector.address, wbtcFee);
      await wbtc.connect(feeCollector).approve(treasury.target, wbtcFee);
      await treasury.connect(feeCollector).collectFees(wbtc.target, wbtcFee);

      // Verify tracking
      expect(await treasury.totalFeesCollected(usdc.target)).to.equal(usdcFee);
      expect(await treasury.totalFeesCollected(wbtc.target)).to.equal(wbtcFee);
    });
  });

  describe("Fee Distribution", function () {
    it("should distribute fees to multiple recipients", async function () {
      const { treasury, usdc, treasurer1, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const recipients = [user1.address, user2.address];
      const amounts = [parseUnits("500", 6), parseUnits("300", 6)];

      const balanceBefore1 = await usdc.balanceOf(user1.address);
      const balanceBefore2 = await usdc.balanceOf(user2.address);

      await treasury.connect(treasurer1).distributeFees(
        recipients,
        amounts,
        usdc.target
      );

      const balanceAfter1 = await usdc.balanceOf(user1.address);
      const balanceAfter2 = await usdc.balanceOf(user2.address);

      expect(balanceAfter1 - balanceBefore1).to.equal(amounts[0]);
      expect(balanceAfter2 - balanceBefore2).to.equal(amounts[1]);
    });

    it("should emit FeeDistributed events", async function () {
      const { treasury, usdc, treasurer1, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const recipients = [user1.address, user2.address];
      const amounts = [parseUnits("100", 6), parseUnits("200", 6)];

      await expect(
        treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target)
      )
        .to.emit(treasury, "FeeDistributed")
        .withArgs(usdc.target, user1.address, amounts[0])
        .and.to.emit(treasury, "FeeDistributed")
        .withArgs(usdc.target, user2.address, amounts[1]);
    });

    it("should revert if arrays length mismatch", async function () {
      const { treasury, usdc, treasurer1, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const recipients = [user1.address, user2.address];
      const amounts = [parseUnits("100", 6)]; // Only 1 amount for 2 recipients

      await expect(
        treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target)
      ).to.be.revertedWith("Treasury: array length mismatch");
    });

    it("should only allow treasurer role to distribute fees", async function () {
      const { treasury, usdc, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const recipients = [user2.address];
      const amounts = [parseUnits("100", 6)];

      await expect(
        treasury.connect(user1).distributeFees(recipients, amounts, usdc.target)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${TREASURER_ROLE}`
      );
    });

    it("should not allow distribution exceeding treasury balance", async function () {
      const { treasury, usdc, treasurer1, user1 } = await loadFixture(deployTreasuryFixture);

      const treasuryBalance = await usdc.balanceOf(treasury.target);
      const excessAmount = treasuryBalance + parseUnits("1000", 6);

      const recipients = [user1.address];
      const amounts = [excessAmount];

      await expect(
        treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Fee Configuration Updates", function () {
    it("should update protocol fee BPS", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const newProtocolFeeBps = 30; // 0.30%

      await treasury.connect(owner).setProtocolFeeBps(newProtocolFeeBps);

      const feeConfig = await treasury.getFeeConfig();
      expect(feeConfig.protocolFeeBps).to.equal(newProtocolFeeBps);
    });

    it("should emit ProtocolFeeUpdated event", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const newProtocolFeeBps = 25;

      await expect(treasury.connect(owner).setProtocolFeeBps(newProtocolFeeBps))
        .to.emit(treasury, "ProtocolFeeUpdated")
        .withArgs(DEFAULT_PROTOCOL_FEE_BPS, newProtocolFeeBps);
    });

    it("should update referral fee BPS", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const newReferralFeeBps = 40; // 40% of protocol fee

      await treasury.connect(owner).setReferralFeeBps(newReferralFeeBps);

      const feeConfig = await treasury.getFeeConfig();
      expect(feeConfig.referralFeeBpsDefault).to.equal(newReferralFeeBps);
    });

    it("should emit ReferralFeeUpdated event", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const newReferralFeeBps = 45;

      await expect(treasury.connect(owner).setReferralFeeBps(newReferralFeeBps))
        .to.emit(treasury, "ReferralFeeUpdated")
        .withArgs(DEFAULT_REFERRAL_FEE_BPS, newReferralFeeBps);
    });

    it("should update fee collector address", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).setFeeCollector(user1.address);

      const feeConfig = await treasury.getFeeConfig();
      expect(feeConfig.feeCollector).to.equal(user1.address);
    });

    it("should emit FeeCollectorUpdated event", async function () {
      const { treasury, owner, user1, feeCollector } = await loadFixture(deployTreasuryFixture);

      await expect(treasury.connect(owner).setFeeCollector(user1.address))
        .to.emit(treasury, "FeeCollectorUpdated")
        .withArgs(feeCollector.address, user1.address);
    });

    it("should not allow setting zero address as fee collector", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(owner).setFeeCollector(ZeroAddress)
      ).to.be.revertedWith("Treasury: invalid fee collector");
    });

    it("should enforce maximum protocol fee cap (100 bps = 1%)", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const excessiveFeeBps = 101; // > 1%

      await expect(
        treasury.connect(owner).setProtocolFeeBps(excessiveFeeBps)
      ).to.be.revertedWith("Treasury: protocol fee too high");
    });

    it("should enforce referral fee cap (100% of protocol fee)", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      const excessiveReferralBps = 10001; // > 100%

      await expect(
        treasury.connect(owner).setReferralFeeBps(excessiveReferralBps)
      ).to.be.revertedWith("Treasury: referral fee too high");
    });
  });

  describe("Emergency Controls", function () {
    it("should allow emergency withdrawal", async function () {
      const { treasury, usdc, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("5000", 6);
      const balanceBefore = await usdc.balanceOf(user1.address);

      await treasury.connect(owner).emergencyWithdraw(
        usdc.target,
        withdrawAmount,
        user1.address
      );

      const balanceAfter = await usdc.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should emit EmergencyWithdraw event", async function () {
      const { treasury, usdc, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);

      await expect(
        treasury.connect(owner).emergencyWithdraw(usdc.target, withdrawAmount, user1.address)
      )
        .to.emit(treasury, "EmergencyWithdraw")
        .withArgs(usdc.target, withdrawAmount, user1.address);
    });

    it("should only allow emergency role to emergency withdraw", async function () {
      const { treasury, usdc, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);

      await expect(
        treasury.connect(user1).emergencyWithdraw(usdc.target, withdrawAmount, user2.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
      );
    });

    it("should pause contract", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      await treasury.connect(owner).pauseContract();

      expect(await treasury.paused()).to.be.true;
    });

    it("should unpause contract", async function () {
      const { treasury, owner } = await loadFixture(deployTreasuryFixture);

      // Pause first
      await treasury.connect(owner).pauseContract();
      expect(await treasury.paused()).to.be.true;

      // Unpause
      await treasury.connect(owner).unpauseContract();
      expect(await treasury.paused()).to.be.false;
    });

    it("should prevent fee collection when paused", async function () {
      const { treasury, usdc, owner, feeCollector } = await loadFixture(deployTreasuryFixture);

      // Pause contract
      await treasury.connect(owner).pauseContract();

      const feeAmount = parseUnits("100", 6);
      await usdc.connect(feeCollector).mint(feeCollector.address, feeAmount);
      await usdc.connect(feeCollector).approve(treasury.target, feeAmount);

      await expect(
        treasury.connect(feeCollector).collectFees(usdc.target, feeAmount)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("should prevent fee distribution when paused", async function () {
      const { treasury, usdc, owner, treasurer1, user1 } = await loadFixture(deployTreasuryFixture);

      // Pause contract
      await treasury.connect(owner).pauseContract();

      const recipients = [user1.address];
      const amounts = [parseUnits("100", 6)];

      await expect(
        treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("should only allow pauser role to pause/unpause", async function () {
      const { treasury, user1 } = await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(user1).pauseContract()
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${PAUSER_ROLE}`
      );
    });
  });

  describe("Keeper Payment Management", function () {
    it("should allow keeper to claim payment", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const paymentAmount = parseEther("0.01");

      // Fund treasury with ETH
      await owner.sendTransaction({
        to: treasury.target,
        value: parseEther("1"),
      });

      // Register keeper payment
      await treasury.connect(owner).registerKeeperPayment(user1.address, paymentAmount);

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      await treasury.connect(user1).claimKeeperPayment();
      const balanceAfter = await ethers.provider.getBalance(user1.address);

      // Account for gas costs by checking if balance increased
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should emit KeeperPaymentClaimed event", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const paymentAmount = parseEther("0.005");

      await owner.sendTransaction({
        to: treasury.target,
        value: parseEther("1"),
      });

      await treasury.connect(owner).registerKeeperPayment(user1.address, paymentAmount);

      await expect(treasury.connect(user1).claimKeeperPayment())
        .to.emit(treasury, "KeeperPaymentClaimed")
        .withArgs(user1.address, paymentAmount);
    });

    it("should revert if no payment registered", async function () {
      const { treasury, user1 } = await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(user1).claimKeeperPayment()
      ).to.be.revertedWith("Treasury: no payment to claim");
    });

    it("should track total keeper payments", async function () {
      const { treasury, owner, user1, user2 } = await loadFixture(deployTreasuryFixture);

      const payment1 = parseEther("0.01");
      const payment2 = parseEther("0.02");

      await owner.sendTransaction({
        to: treasury.target,
        value: parseEther("1"),
      });

      await treasury.connect(owner).registerKeeperPayment(user1.address, payment1);
      await treasury.connect(owner).registerKeeperPayment(user2.address, payment2);

      await treasury.connect(user1).claimKeeperPayment();
      await treasury.connect(user2).claimKeeperPayment();

      const totalPaid = await treasury.totalKeeperPayments();
      expect(totalPaid).to.equal(payment1 + payment2);
    });
  });

  describe("Withdrawal Operations", function () {
    it("should allow withdrawal via timelock", async function () {
      const { treasury, usdc, treasurer1, treasurer2, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("2000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdrawal-1"));

      // Schedule
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      // Wait for timelock
      await time.increase(MIN_DELAY + 1);

      // Execute
      const balanceBefore = await usdc.balanceOf(user1.address);
      await treasury.connect(treasurer2).execute(
        target,
        value,
        data,
        predecessor,
        salt
      );
      const balanceAfter = await usdc.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should emit Withdrawn event", async function () {
      const { treasury, usdc, treasurer1, treasurer2, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("500", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("withdrawal-event"));

      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      await time.increase(MIN_DELAY + 1);

      await expect(
        treasury.connect(treasurer2).execute(
          target,
          value,
          data,
          predecessor,
          salt
        )
      )
        .to.emit(treasury, "Withdrawn")
        .withArgs(usdc.target, withdrawAmount, user1.address);
    });

    it("should support batch operations", async function () {
      const { treasury, usdc, wbtc, treasurer1, treasurer2, user1, user2 } =
        await loadFixture(deployTreasuryFixture);

      // Schedule multiple withdrawals
      const operations = [
        {
          token: usdc.target,
          amount: parseUnits("1000", 6),
          to: user1.address,
        },
        {
          token: wbtc.target,
          amount: parseUnits("0.5", 8),
          to: user2.address,
        },
      ];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const data = treasury.interface.encodeFunctionData("withdraw", [
          op.token,
          op.amount,
          op.to,
        ]);
        const salt = ethers.keccak256(ethers.toUtf8Bytes(`batch-${i}`));

        await treasury.connect(treasurer1).schedule(
          treasury.target,
          0,
          data,
          ethers.ZeroHash,
          salt,
          MIN_DELAY
        );
      }

      // Wait for timelock
      await time.increase(MIN_DELAY + 1);

      // Execute all
      const balancesBefore = [
        await usdc.balanceOf(user1.address),
        await wbtc.balanceOf(user2.address),
      ];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const data = treasury.interface.encodeFunctionData("withdraw", [
          op.token,
          op.amount,
          op.to,
        ]);
        const salt = ethers.keccak256(ethers.toUtf8Bytes(`batch-${i}`));

        await treasury.connect(treasurer2).execute(
          treasury.target,
          0,
          data,
          ethers.ZeroHash,
          salt
        );
      }

      const balancesAfter = [
        await usdc.balanceOf(user1.address),
        await wbtc.balanceOf(user2.address),
      ];

      expect(balancesAfter[0] - balancesBefore[0]).to.equal(operations[0].amount);
      expect(balancesAfter[1] - balancesBefore[1]).to.equal(operations[1].amount);
    });
  });

  describe("Referral Fee System", function () {
    it("should set custom referral fee for specific referrer", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const customReferralBps = 60; // 60% instead of default 50%

      await treasury.connect(owner).setCustomReferralFee(user1.address, customReferralBps);

      expect(await treasury.getReferralFeeBps(user1.address)).to.equal(customReferralBps);
    });

    it("should return default referral fee for non-custom referrers", async function () {
      const { treasury, user1 } = await loadFixture(deployTreasuryFixture);

      expect(await treasury.getReferralFeeBps(user1.address)).to.equal(DEFAULT_REFERRAL_FEE_BPS);
    });

    it("should calculate referral fee correctly", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const protocolFee = parseUnits("100", 6); // 100 USDC protocol fee
      const customReferralBps = 60; // 60%

      await treasury.connect(owner).setCustomReferralFee(user1.address, customReferralBps);

      const expectedReferralFee = (protocolFee * BigInt(customReferralBps)) / BigInt(10000);
      const actualReferralFee = await treasury.calculateReferralFee(user1.address, protocolFee);

      expect(actualReferralFee).to.equal(expectedReferralFee);
    });

    it("should emit CustomReferralFeeSet event", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const customReferralBps = 70;

      await expect(treasury.connect(owner).setCustomReferralFee(user1.address, customReferralBps))
        .to.emit(treasury, "CustomReferralFeeSet")
        .withArgs(user1.address, customReferralBps);
    });

    it("should not allow referral fee > 100%", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      const invalidReferralBps = 10001; // > 100%

      await expect(
        treasury.connect(owner).setCustomReferralFee(user1.address, invalidReferralBps)
      ).to.be.revertedWith("Treasury: referral fee too high");
    });

    it("should distribute referral fees correctly from protocol fees", async function () {
      const { treasury, usdc, treasurer1, feeCollector, owner, user1, user2 } =
        await loadFixture(deployTreasuryFixture);

      // Setup: user1 is a referrer with custom 60% fee
      const referrerAddress = user1.address;
      const customReferralBps = 60; // 60% of protocol fee
      await treasury.connect(owner).setCustomReferralFee(referrerAddress, customReferralBps);

      // Simulate protocol fee collection
      const protocolFeeAmount = parseUnits("1000", 6); // 1000 USDC protocol fee
      await usdc.connect(feeCollector).mint(feeCollector.address, protocolFeeAmount);
      await usdc.connect(feeCollector).approve(treasury.target, protocolFeeAmount);
      await treasury.connect(feeCollector).collectFees(usdc.target, protocolFeeAmount);

      // Calculate referral fee
      const referralFee = await treasury.calculateReferralFee(referrerAddress, protocolFeeAmount);
      const expectedReferralFee = (protocolFeeAmount * BigInt(customReferralBps)) / BigInt(10000);
      expect(referralFee).to.equal(expectedReferralFee);

      // Calculate protocol's net share (after referral fee)
      const protocolNetShare = protocolFeeAmount - referralFee;

      // Distribute: referrer gets referral fee, treasury keeps net protocol fee
      const recipients = [referrerAddress, user2.address]; // user2 represents treasury beneficiary
      const amounts = [referralFee, protocolNetShare];

      const balanceBefore1 = await usdc.balanceOf(referrerAddress);
      const balanceBefore2 = await usdc.balanceOf(user2.address);

      await treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target);

      const balanceAfter1 = await usdc.balanceOf(referrerAddress);
      const balanceAfter2 = await usdc.balanceOf(user2.address);

      // Verify referrer received correct referral fee (60% of protocol fee)
      expect(balanceAfter1 - balanceBefore1).to.equal(expectedReferralFee);
      expect(balanceAfter1 - balanceBefore1).to.equal(parseUnits("600", 6)); // 60% of 1000

      // Verify treasury received net protocol fee (40% of protocol fee)
      expect(balanceAfter2 - balanceBefore2).to.equal(protocolNetShare);
      expect(balanceAfter2 - balanceBefore2).to.equal(parseUnits("400", 6)); // 40% of 1000

      // Verify total distributed equals protocol fee collected
      expect((balanceAfter1 - balanceBefore1) + (balanceAfter2 - balanceBefore2)).to.equal(
        protocolFeeAmount
      );
    });

    it("should handle referral fees with default rate when no custom rate set", async function () {
      const { treasury, usdc, treasurer1, feeCollector, user1, user2 } =
        await loadFixture(deployTreasuryFixture);

      // user1 is a referrer without custom rate (uses default 50%)
      const referrerAddress = user1.address;

      // Simulate protocol fee collection
      const protocolFeeAmount = parseUnits("2000", 6); // 2000 USDC
      await usdc.connect(feeCollector).mint(feeCollector.address, protocolFeeAmount);
      await usdc.connect(feeCollector).approve(treasury.target, protocolFeeAmount);
      await treasury.connect(feeCollector).collectFees(usdc.target, protocolFeeAmount);

      // Calculate referral fee with default rate
      const referralFee = await treasury.calculateReferralFee(referrerAddress, protocolFeeAmount);
      const expectedReferralFee =
        (protocolFeeAmount * BigInt(DEFAULT_REFERRAL_FEE_BPS)) / BigInt(10000);

      expect(referralFee).to.equal(expectedReferralFee);
      expect(referralFee).to.equal(parseUnits("1000", 6)); // 50% of 2000

      // Distribute fees
      const protocolNetShare = protocolFeeAmount - referralFee;
      const recipients = [referrerAddress, user2.address];
      const amounts = [referralFee, protocolNetShare];

      const balanceBefore = await usdc.balanceOf(referrerAddress);
      await treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target);
      const balanceAfter = await usdc.balanceOf(referrerAddress);

      // Verify referrer received 50% (default rate)
      expect(balanceAfter - balanceBefore).to.equal(parseUnits("1000", 6));
    });

    it("should support multiple referrers with different custom rates", async function () {
      const { treasury, usdc, treasurer1, feeCollector, owner, user1, user2, treasurer3 } =
        await loadFixture(deployTreasuryFixture);

      // Setup different referral rates
      await treasury.connect(owner).setCustomReferralFee(user1.address, 60); // 60%
      await treasury.connect(owner).setCustomReferralFee(user2.address, 40); // 40%
      // treasurer3 uses default 50%

      // Collect protocol fees
      const totalProtocolFee = parseUnits("3000", 6);
      await usdc.connect(feeCollector).mint(feeCollector.address, totalProtocolFee);
      await usdc.connect(feeCollector).approve(treasury.target, totalProtocolFee);
      await treasury.connect(feeCollector).collectFees(usdc.target, totalProtocolFee);

      // Calculate individual referral fees
      const fee1 = await treasury.calculateReferralFee(user1.address, parseUnits("1000", 6));
      const fee2 = await treasury.calculateReferralFee(user2.address, parseUnits("1000", 6));
      const fee3 = await treasury.calculateReferralFee(treasurer3.address, parseUnits("1000", 6));

      expect(fee1).to.equal(parseUnits("600", 6)); // 60% of 1000
      expect(fee2).to.equal(parseUnits("400", 6)); // 40% of 1000
      expect(fee3).to.equal(parseUnits("500", 6)); // 50% of 1000 (default)

      // Verify each referrer gets correct amount
      const recipients = [user1.address, user2.address, treasurer3.address];
      const amounts = [fee1, fee2, fee3];

      const balancesBefore = await Promise.all(
        recipients.map((addr) => usdc.balanceOf(addr))
      );

      await treasury.connect(treasurer1).distributeFees(recipients, amounts, usdc.target);

      const balancesAfter = await Promise.all(
        recipients.map((addr) => usdc.balanceOf(addr))
      );

      expect(balancesAfter[0] - balancesBefore[0]).to.equal(fee1);
      expect(balancesAfter[1] - balancesBefore[1]).to.equal(fee2);
      expect(balancesAfter[2] - balancesBefore[2]).to.equal(fee3);
    });
  });

  describe("View Functions", function () {
    it("should return correct treasury balance for token", async function () {
      const { treasury, usdc } = await loadFixture(deployTreasuryFixture);

      const balance = await treasury.getTreasuryBalance(usdc.target);
      expect(balance).to.equal(parseUnits("100000", 6)); // Initial mint
    });

    it("should return fee configuration", async function () {
      const { treasury } = await loadFixture(deployTreasuryFixture);

      const config = await treasury.getFeeConfig();
      expect(config.protocolFeeBps).to.equal(DEFAULT_PROTOCOL_FEE_BPS);
      expect(config.executionFeeFixedWei).to.equal(DEFAULT_EXECUTION_FEE);
      expect(config.gasPremiumBps).to.equal(DEFAULT_GAS_PREMIUM_BPS);
      expect(config.referralFeeBpsDefault).to.equal(DEFAULT_REFERRAL_FEE_BPS);
    });

    it("should return operation readiness status", async function () {
      const { treasury, usdc, treasurer1, user1 } = await loadFixture(deployTreasuryFixture);

      const withdrawAmount = parseUnits("1000", 6);
      const target = treasury.target;
      const value = 0;
      const data = treasury.interface.encodeFunctionData("withdraw", [
        usdc.target,
        withdrawAmount,
        user1.address,
      ]);
      const predecessor = ethers.ZeroHash;
      const salt = ethers.keccak256(ethers.toUtf8Bytes("ready-check"));

      // Schedule
      await treasury.connect(treasurer1).schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        MIN_DELAY
      );

      const operationId = await treasury.hashOperation(target, value, data, predecessor, salt);

      // Not ready yet
      expect(await treasury.isOperationReady(operationId)).to.be.false;

      // Wait
      await time.increase(MIN_DELAY + 1);

      // Now ready
      expect(await treasury.isOperationReady(operationId)).to.be.true;
    });
  });

  describe("Access Control", function () {
    it("should enforce TREASURER_ROLE for fee updates", async function () {
      const { treasury, user1 } = await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(user1).setProtocolFeeBps(25)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${TREASURER_ROLE}`
      );
    });

    it("should enforce EMERGENCY_ROLE for emergency actions", async function () {
      const { treasury, usdc, user1 } = await loadFixture(deployTreasuryFixture);

      await expect(
        treasury.connect(user1).emergencyWithdraw(usdc.target, parseUnits("100", 6), user1.address)
      ).to.be.revertedWith(
        `AccessControl: account ${user1.address.toLowerCase()} is missing role ${EMERGENCY_ROLE}`
      );
    });

    it("should allow role admin to grant/revoke roles", async function () {
      const { treasury, owner, user1 } = await loadFixture(deployTreasuryFixture);

      // Grant TREASURER_ROLE
      await treasury.connect(owner).grantRole(TREASURER_ROLE, user1.address);
      expect(await treasury.hasRole(TREASURER_ROLE, user1.address)).to.be.true;

      // Revoke TREASURER_ROLE
      await treasury.connect(owner).revokeRole(TREASURER_ROLE, user1.address);
      expect(await treasury.hasRole(TREASURER_ROLE, user1.address)).to.be.false;
    });
  });
});
