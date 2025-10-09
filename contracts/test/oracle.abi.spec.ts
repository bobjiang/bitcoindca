import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectFunctions } from "./helpers/artifacts";

describe("PriceOracle ABI", function () {
  let artifact: Artifact;

  before(async function () {
    artifact = await ensureArtifactOrSkip(this, "PriceOracle");
  });

  it("exposes pricing and TWAP helpers", function () {
    expectFunctions(artifact.abi, [
      "initialize",
      "setFeed",
      "setTwapWindow",
      "latestPrice",
      "latestPriceUnsafe",
      "twap",
      "isOracleFresh",
      "getDeviationBps",
    ]);
  });
});
