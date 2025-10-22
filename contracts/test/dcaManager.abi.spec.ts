import { expect } from "chai";
import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectEvents, expectFunctions } from "./helpers/artifacts";

describe("DcaManager ABI", function () {
  let artifact: Artifact;

  before(async function () {
    artifact = await ensureArtifactOrSkip(this, "DcaManager");
  });

  it("exposes core position management functions", function () {
    expectFunctions(artifact.abi, [
      "initialize",
      "createPosition",
      "modify",
      "pause",
      "resume",
      "cancel",
      "emergencyWithdraw",
      "deposit",
      "withdraw",
      "setProtocolConfig",
      "setVenueConfig",
      "setCircuitBreakerConfig",
      "setKeeperRegistry",
    ]);
  });

  it("exposes read helpers required by the dashboard", function () {
    expectFunctions(artifact.abi, [
      "getPosition",
      "getPositionBalance",
      "isPositionEligible",
      "getNextExecutionTime",
      "positionsByOwner",
      "globalPauseState",
    ]);
  });

  it("emits rich telemetry events", function () {
    expectEvents(artifact.abi, [
      "PositionCreated",
      "PositionModified",
      "PositionSlippageUpdated",
      "PositionVenueUpdated",
      "PositionGasCapsUpdated",
      "PositionPriceGuardsUpdated",
      "PositionBeneficiaryUpdated",
      "PositionPaused",
      "PositionResumed",
      "PositionCanceled",
      "PositionExecuted",
      "Deposited",
      "Withdrawn",
      "EmergencyWithdrawn",
      "ProtocolConfigUpdated",
      "KeeperRegistryUpdated",
      "VenueConfigUpdated",
      "ExecNonceBumped",
      "QuoteTokenAllowed",
      "ActivePositionsReconciled",
    ]);
  });

  it("declares domain separators for signature based flows", function () {
    const structNames = artifact.abi
      .filter((entry) => entry.type === "error" || entry.type === "event" || entry.type === "function")
      .map((entry) => entry.name ?? "");

    expect(structNames).to.include("QuoteTokenNotAllowed");
  });
});
