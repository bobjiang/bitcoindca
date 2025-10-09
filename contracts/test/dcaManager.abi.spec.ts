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
      "modifyPosition",
      "pausePosition",
      "resumePosition",
      "cancelPosition",
      "emergencyWithdraw",
      "depositQuote",
      "depositBase",
      "withdrawQuote",
      "withdrawBase",
      "setProtocolConfig",
      "setVenueConfig",
      "setCircuitBreakerConfig",
      "setKeeperRegistry",
    ]);
  });

  it("exposes read helpers required by the dashboard", function () {
    expectFunctions(artifact.abi, [
      "getPosition",
      "getPendingExecutions",
      "getQuoteBalance",
      "getBaseBalance",
      "positionsByOwner",
      "globalPauseState",
    ]);
  });

  it("emits rich telemetry events", function () {
    expectEvents(artifact.abi, [
      "PositionCreated",
      "PositionModified",
      "Deposited",
      "Withdrawn",
      "Executed",
      "ExecutionSkipped",
      "Paused",
      "Resumed",
      "Canceled",
      "EmergencyWithdrawn",
      "ProtocolConfigUpdated",
      "CircuitBreakerTriggered",
    ]);
  });

  it("declares domain separators for signature based flows", function () {
    const structNames = artifact.abi
      .filter((entry) => entry.type === "error" || entry.type === "event" || entry.type === "function")
      .map((entry) => entry.name ?? "");

    expect(structNames).to.include("Permit2SpenderNotSet");
  });
});
