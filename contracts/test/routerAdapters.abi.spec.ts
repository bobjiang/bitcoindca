import type { Artifact } from "hardhat/types";
import { ensureArtifactOrSkip, expectFunctions } from "./helpers/artifacts";

const COMMON_FUNCTIONS = ["swapExactTokens", "quote", "supportsAssetPair", "adapterType"];

const ADAPTER_SPECIFICS: Record<string, string[]> = {
  UniV3Adapter: ["executeSwap", "executeSwapWithFlashbots", "batchSwap", "registerPool"],
  CowAdapter: ["createOrder", "settleOrder", "simulatePartialFill"],
  OneInchAdapter: ["swap", "swapMultiHop", "swapFallback", "swapWithRetry"],
};

describe("Router adapters ABI", function () {
  const adapters = ["UniV3Adapter", "CowAdapter", "OneInchAdapter"] as const;

  for (const adapter of adapters) {
    describe(adapter, function () {
      let artifact: Artifact;

      before(async function () {
        artifact = await ensureArtifactOrSkip(this, adapter);
      });

      it("exposes common routing primitives", function () {
        expectFunctions(artifact.abi, COMMON_FUNCTIONS);
      });

      it("exposes venue-specific helpers", function () {
        const specifics = ADAPTER_SPECIFICS[adapter] ?? [];
        expectFunctions(artifact.abi, specifics);
      });
    });
  }
});
