import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectFunctions } from "./helpers/artifacts";

const ROUTER_FUNCTIONS = [
  "quote",
  "executeSwap",
  "supportsAssetPair",
];

describe("Router adapters ABI", function () {
  const adapters = ["UniV3Adapter", "CowAdapter", "OneInchAdapter"] as const;

  for (const adapter of adapters) {
    describe(adapter, function () {
      let artifact: Artifact;

      before(async function () {
        artifact = await ensureArtifactOrSkip(this, adapter);
      });

      it("exposes routing primitives", function () {
        expectFunctions(artifact.abi, ROUTER_FUNCTIONS);
      });

      it("supports slippage hinting", function () {
        expectFunctions(artifact.abi, ["estimatePriceImpact"]);
      });
    });
  }
});
