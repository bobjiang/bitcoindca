import type { Artifact } from "hardhat/types";
import { artifacts } from "hardhat";

/**
 * Ensures the requested artifact exists before running a suite.
 * Skips the current test context early if the contract has not been implemented yet.
 */
export async function ensureArtifactOrSkip(ctx: Mocha.Context, contractName: string): Promise<Artifact> {
  try {
    const artifact = await artifacts.readArtifact(contractName);
    return artifact;
  } catch (error) {
    ctx.skip();
    throw error;
  }
}

/**
 * Helper to assert that an ABI contains a set of function names.
 */
export function expectFunctions(abi: Artifact["abi"], names: string[]) {
  const functions = abi.filter((entry) => entry.type === "function").map((entry) => entry.name ?? "");
  for (const name of names) {
    if (!functions.includes(name)) {
      throw new Error(`Missing function ${name} in ABI`);
    }
  }
}

/**
 * Helper to assert that an ABI contains a set of event names.
 */
export function expectEvents(abi: Artifact["abi"], names: string[]) {
  const events = abi.filter((entry) => entry.type === "event").map((entry) => entry.name ?? "");
  for (const name of names) {
    if (!events.includes(name)) {
      throw new Error(`Missing event ${name} in ABI`);
    }
  }
}
