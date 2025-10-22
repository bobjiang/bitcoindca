import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectEvents, expectFunctions } from "./helpers/artifacts";

describe("Treasury ABI", function () {
  let artifact: Artifact;

  before(async function () {
    artifact = await ensureArtifactOrSkip(this, "Treasury");
  });

  it("guards withdrawals and fee configuration", function () {
    expectFunctions(artifact.abi, [
      "initialize",
      "setFeeCollector",
      "setProtocolFeeBps",
      "setReferralFeeBps",
      "setReferralFeeOnTop",
      "calculateFees",
      "withdraw",
      "claimKeeperPayment",
    ]);
  });

  it("emits lifecycle events", function () {
    expectEvents(artifact.abi, [
      "FeeCollectorUpdated",
      "ProtocolFeeUpdated",
      "ReferralFeeUpdated",
      "ReferralFeeModeUpdated",
      "FeeDistributed",
      "KeeperPaymentClaimed",
    ]);
  });
});
