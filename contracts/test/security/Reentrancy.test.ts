import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseSystemFixture, deployWithPositionFixture } from "../fixtures/deployments";
import { getCurrentTime, getPositionIdFromTx } from "../helpers/utils";
import { ensureArtifactOrSkip } from "../helpers/artifacts";

const SHOULD_RUN_BEHAVIOR = process.env.RUN_DCA_BEHAVIOR_TESTS === "true";

async function deployDepositReentrancyFixture() {
  const base = await deployBaseSystemFixture();

  const MaliciousToken = await ethers.getContractFactory("MaliciousERC777Token");
  const maliciousToken = await MaliciousToken.deploy();
  await maliciousToken.waitForDeployment();

  await base.priceOracle
    .connect(base.deployer)
    .addPriceFeed(await maliciousToken.getAddress(), await base.priceFeeds.usdcUsdFeed.getAddress());

  await base.dcaManager
    .connect(base.deployer)
    .setQuoteTokenAllowed(await maliciousToken.getAddress(), true);

  const transferAmount = ethers.parseUnits("5000", 18);
  await maliciousToken.transfer(base.user1.address, transferAmount);

  await maliciousToken
    .connect(base.user1)
    .approve(await base.dcaManager.getAddress(), ethers.MaxUint256);

  const now = await getCurrentTime();
  const createParams = {
    owner: base.user1.address,
    beneficiary: base.user1.address,
    quoteToken: await maliciousToken.getAddress(),
    isBuy: true,
    frequency: 0,
    venue: 0,
    slippageBps: 50,
    twapWindow: 3600,
    maxPriceDeviationBps: 100,
    startAt: now + 3600,
    endAt: 0,
    amountPerPeriod: ethers.parseUnits("200", 18),
    priceFloorUsd: 0,
    priceCapUsd: 0,
    maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
    maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
    mevProtection: true,
  };

  const tx = await base.dcaManager.connect(base.user1).createPosition(createParams);
  const positionId = await getPositionIdFromTx(tx);

  await maliciousToken.setAttackParams(
    base.user1.address,
    await base.dcaManager.getAddress(),
    positionId
  );

  return {
    ...base,
    maliciousToken,
    positionId,
  };
}

/**
 * Reentrancy Protection smoke-tests aimed at the highest-risk flows (withdraw & deposit).
 */
describe("Security: Reentrancy Protection", function () {
  before(async function () {
    if (!SHOULD_RUN_BEHAVIOR) {
      this.skip();
    }

    await ensureArtifactOrSkip(this, "DcaManager");
    await ensureArtifactOrSkip(this, "PositionNFT");
  });

  it("blocks reentrancy during withdraw", async function () {
    const { dcaManager, positionNFT, positionId, tokens, user1 } = await loadFixture(
      deployWithPositionFixture
    );

    const initialBalance = await dcaManager.getPositionBalance(
      positionId,
      await tokens.usdc.getAddress()
    );

    const MaliciousWithdrawer = await ethers.getContractFactory("MaliciousReentrantWithdrawer");
    const malicious = await MaliciousWithdrawer.deploy(await dcaManager.getAddress());
    await malicious.waitForDeployment();

    await positionNFT
      .connect(user1)
      .transferFrom(user1.address, await malicious.getAddress(), positionId);

    await malicious.setPosition(positionId, await tokens.usdc.getAddress());

    await expect(
      malicious.attemptReentrantWithdraw(positionId, ethers.parseUnits("100", 6))
    ).to.be.reverted;

    const finalBalance = await dcaManager.getPositionBalance(
      positionId,
      await tokens.usdc.getAddress()
    );
    expect(finalBalance).to.equal(initialBalance);
  });

  it("blocks reentrancy when depositing funds", async function () {
    const { dcaManager, maliciousToken, positionId, user1 } = await loadFixture(
      deployDepositReentrancyFixture
    );

    const depositAmount = ethers.parseUnits("300", 18);

    await expect(
      dcaManager
        .connect(user1)
        .deposit(positionId, await maliciousToken.getAddress(), depositAmount)
    ).to.not.be.reverted;

    expect(await maliciousToken.shouldAttack()).to.equal(false);

    const balance = await dcaManager.getPositionBalance(
      positionId,
      await maliciousToken.getAddress()
    );
    expect(balance).to.equal(depositAmount);
  });
});
