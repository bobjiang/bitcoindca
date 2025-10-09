import { expect } from "chai";
import { deployments, ethers, upgrades } from "hardhat";
import type { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ensureArtifactOrSkip } from "./helpers/artifacts";
import {
  Frequency,
  Venue,
  PROTOCOL_CONSTANTS,
  TOKEN_DECIMALS,
  getNetworkAddresses,
} from "../utils/constants";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

function extractPositionId(receipt: { logs: any[] }, contract: Contract): bigint {
  for (const rawLog of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(rawLog);
      if (parsed?.name === "PositionCreated") {
        const id = parsed.args?.positionId ?? parsed.args?.id ?? 0;
        return typeof id === "bigint" ? id : BigInt(id);
      }
    } catch (error) {
      continue;
    }
  }
  return 0n;
}

interface SystemContracts {
  dcaManager: Contract;
  positionNFT: Contract;
  executor: Contract;
  priceOracle: Contract;
  treasury: Contract;
  owner: Signer;
  user: Signer;
  keeper: Signer;
  treasurySigner: Signer;
}

async function loadSystemFixture(this: Mocha.Context): Promise<SystemContracts> {
  await ensureArtifactOrSkip(this, "DcaManager");
  await ensureArtifactOrSkip(this, "PositionNFT");
  await ensureArtifactOrSkip(this, "Executor");
  await ensureArtifactOrSkip(this, "PriceOracle");
  await ensureArtifactOrSkip(this, "Treasury");

  if (!SHOULD_RUN_BEHAVIOR) {
    this.skip();
  }

  try {
    await deployments.fixture(["FullSystem"]);
  } catch (error) {
    this.skip();
  }

  const [owner, user, keeper, treasurySigner] = await ethers.getSigners();
  const dcaManager = await ethers.getContractAt("DcaManager", (await deployments.get("DcaManager")).address);
  const positionNFT = await ethers.getContractAt("PositionNFT", (await deployments.get("PositionNFT")).address);
  const executor = await ethers.getContractAt("Executor", (await deployments.get("Executor")).address);
  const priceOracle = await ethers.getContractAt("PriceOracle", (await deployments.get("PriceOracle")).address);
  const treasury = await ethers.getContractAt("Treasury", (await deployments.get("Treasury")).address);

  return {
    dcaManager,
    positionNFT,
    executor,
    priceOracle,
    treasury,
    owner,
    user,
    keeper,
    treasurySigner,
  };
}

describe("Bitcoin DCA – System behaviour", function () {
  let system: SystemContracts;

  beforeEach(async function () {
    system = await loadSystemFixture.call(this);
  });

  describe("Deployment & upgradeability", function () {
    it("deploys upgradeable proxies for core contracts", async function () {
      const { dcaManager, positionNFT, executor } = system;

      const managerImpl = await upgrades.erc1967.getImplementationAddress(await dcaManager.getAddress());
      const nftImpl = await upgrades.erc1967.getImplementationAddress(await positionNFT.getAddress());
      const executorImpl = await upgrades.erc1967.getImplementationAddress(await executor.getAddress());

      expect(managerImpl).to.properAddress;
      expect(nftImpl).to.properAddress;
      expect(executorImpl).to.properAddress;
    });

    it("prevents re-initialisation", async function () {
      const { dcaManager, owner } = system;
      await expect(
        dcaManager.connect(owner).initialize(owner.address, owner.address, owner.address, owner.address)
      ).to.be.reverted;
    });
  });

  describe("Position lifecycle – BUY flow", function () {
    it("creates, funds, executes, and settles a BUY strategy", async function () {
      const { dcaManager, executor, user, keeper } = system;
      const addresses = getNetworkAddresses(1);

      const now = await time.latest();
      const createTx = await dcaManager.connect(user).createPosition({
        beneficiary: await user.getAddress(),
        quote: addresses.USDC,
        base: addresses.WBTC,
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("500", TOKEN_DECIMALS.USDC),
        frequency: Frequency.WEEKLY,
        venue: Venue.AUTO,
        slippageBps: PROTOCOL_CONSTANTS.DEFAULT_SLIPPAGE_BPS,
        maxPriceDeviationBps: PROTOCOL_CONSTANTS.DEFAULT_MAX_PRICE_DEVIATION_BPS,
        twapWindow: PROTOCOL_CONSTANTS.DEFAULT_TWAP_WINDOW,
        priceCapUsd: ethers.parseUnits("80000", 8),
        priceFloorUsd: 0,
        startAt: now + 3600,
        endAt: 0,
        maxBaseFeeWei: 0,
        maxPriorityFeeWei: 0,
        metadataURI: "ipfs://strategy-metadata",
      });

      const receipt = await createTx.wait();
      const positionId = extractPositionId(receipt, dcaManager);

      expect(positionId).to.not.equal(0n);

      await dcaManager
        .connect(user)
        .depositQuote(positionId, ethers.parseUnits("1500", TOKEN_DECIMALS.USDC));

      await time.increaseTo(now + 3600 + 1);

      await expect(executor.connect(keeper).execute(positionId))
        .to.emit(executor, "ExecutionCompleted")
        .withArgs(positionId, await keeper.getAddress());

      const positionState = await dcaManager.getPosition(positionId);
      expect(positionState.periodsExec).to.equal(1);
    });
  });

  describe("Guards & circuit breakers", function () {
    it("skips execution when price deviates beyond guard", async function () {
      const { dcaManager, executor, user, keeper } = system;
      const addresses = getNetworkAddresses(1);
      const now = await time.latest();

      const { logs } = await (await dcaManager.connect(user).createPosition({
        beneficiary: await user.getAddress(),
        quote: addresses.USDC,
        base: addresses.WBTC,
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("250", TOKEN_DECIMALS.USDC),
        frequency: Frequency.DAILY,
        venue: Venue.UNIV3_ONLY,
        slippageBps: 10,
        maxPriceDeviationBps: 20,
        twapWindow: 3600,
        priceCapUsd: ethers.parseUnits("60000", 8),
        priceFloorUsd: 0,
        startAt: now + 60,
        endAt: 0,
        maxBaseFeeWei: 0,
        maxPriorityFeeWei: 0,
        metadataURI: "ipfs://guard-test",
      })).wait();

      const positionId = extractPositionId({ logs }, dcaManager);

      await dcaManager
        .connect(user)
        .depositQuote(positionId, ethers.parseUnits("500", TOKEN_DECIMALS.USDC));

      await time.increaseTo(now + 60 + 1);

      await expect(executor.connect(keeper).execute(positionId))
        .to.emit(executor, "ExecutionSkipped")
        .withArgs(positionId, "PRICE_DEVIATION");
    });
  });

  describe("Emergency controls", function () {
    it("enforces pause / emergency withdraw workflow", async function () {
      const { dcaManager, user, owner } = system;
      const addresses = getNetworkAddresses(1);
      const now = await time.latest();

      const { logs } = await (await dcaManager.connect(user).createPosition({
        beneficiary: await user.getAddress(),
        quote: addresses.USDC,
        base: addresses.WBTC,
        isBuy: true,
        amountPerPeriod: ethers.parseUnits("100", TOKEN_DECIMALS.USDC),
        frequency: Frequency.WEEKLY,
        venue: Venue.AUTO,
        slippageBps: PROTOCOL_CONSTANTS.DEFAULT_SLIPPAGE_BPS,
        maxPriceDeviationBps: PROTOCOL_CONSTANTS.DEFAULT_MAX_PRICE_DEVIATION_BPS,
        twapWindow: PROTOCOL_CONSTANTS.DEFAULT_TWAP_WINDOW,
        priceCapUsd: 0,
        priceFloorUsd: 0,
        startAt: now + 3600,
        endAt: 0,
        maxBaseFeeWei: 0,
        maxPriorityFeeWei: 0,
        metadataURI: "ipfs://emergency",
      })).wait();

      const positionId = extractPositionId({ logs }, dcaManager);

      await dcaManager.connect(user).depositQuote(positionId, ethers.parseUnits("200", TOKEN_DECIMALS.USDC));

      await expect(dcaManager.connect(owner).pausePosition(positionId))
        .to.emit(dcaManager, "Paused")
        .withArgs(positionId);

      await time.increase(PROTOCOL_CONSTANTS.EMERGENCY_WITHDRAW_DELAY);

      await expect(dcaManager.connect(user).emergencyWithdraw(positionId))
        .to.emit(dcaManager, "EmergencyWithdrawn")
        .withArgs(positionId, await user.getAddress());
    });
  });
});
