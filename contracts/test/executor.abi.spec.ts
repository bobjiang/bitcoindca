import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectEvents, expectFunctions } from "./helpers/artifacts";

const REQUIRED_FUNCTIONS = [
  "execute",
  "batchExecute",
  "checkUpkeep",
  "performUpkeep",
  "executePublic",
  "calculateFees",
  "estimateSlippage",
  "selectRoute",
  "validateOracleStaleness",
  "validateGasCaps",
];

const REQUIRED_EVENTS = [
  "PositionExecuted",
  "ExecutionSkipped",
  "ExecutionDetails",
];

describe("Executor ABI", function () {
  let artifact: Artifact;

  before(async function () {
    artifact = await ensureArtifactOrSkip(this, "Executor");
  });

  it("exposes automation entrypoints", function () {
    expectFunctions(artifact.abi, REQUIRED_FUNCTIONS);
  });

  it("emits events for monitoring & analytics", function () {
    expectEvents(artifact.abi, REQUIRED_EVENTS);
  });
});
