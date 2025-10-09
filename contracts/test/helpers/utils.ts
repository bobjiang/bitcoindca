import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BigNumberish } from "ethers";

/**
 * Test Utility Functions
 * Common helper functions used across test suites
 */

/**
 * Advance blockchain time by specified seconds
 */
export async function advanceTime(seconds: number): Promise<void> {
  await time.increase(seconds);
}

/**
 * Advance blockchain time to specific timestamp
 */
export async function advanceTimeTo(timestamp: number): Promise<void> {
  await time.increaseTo(timestamp);
}

/**
 * Get current block timestamp
 */
export async function getCurrentTime(): Promise<number> {
  return await time.latest();
}

/**
 * Mine specified number of blocks
 */
export async function mineBlocks(blocks: number): Promise<void> {
  for (let i = 0; i < blocks; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

/**
 * Calculate next execution time based on frequency
 */
export function calculateNextExecution(
  startAt: number,
  frequency: number,
  periodsExecuted: number
): number {
  let interval: number;
  switch (frequency) {
    case 0: // DAILY
      interval = 86400;
      break;
    case 1: // WEEKLY
      interval = 604800;
      break;
    case 2: // MONTHLY
      interval = 2592000; // 30 days
      break;
    default:
      throw new Error("Invalid frequency");
  }
  return startAt + interval * (periodsExecuted + 1);
}

/**
 * Calculate protocol fee
 */
export function calculateProtocolFee(
  notional: bigint,
  feeBps: number
): bigint {
  return (notional * BigInt(feeBps)) / 10000n;
}

/**
 * Calculate execution fee
 */
export function calculateExecutionFee(
  fixedFee: bigint,
  notional: bigint,
  gasPremiumBps: number
): bigint {
  const dynamicFee = (notional * BigInt(gasPremiumBps)) / 10000n;
  return fixedFee + dynamicFee;
}

/**
 * Calculate slippage amount
 */
export function calculateSlippage(
  amount: bigint,
  slippageBps: number
): bigint {
  return (amount * BigInt(slippageBps)) / 10000n;
}

/**
 * Calculate price impact in basis points
 */
export function calculatePriceImpact(
  expectedPrice: bigint,
  actualPrice: bigint
): bigint {
  if (expectedPrice === 0n) return 0n;
  const diff = expectedPrice > actualPrice
    ? expectedPrice - actualPrice
    : actualPrice - expectedPrice;
  return (diff * 10000n) / expectedPrice;
}

/**
 * Calculate TWAP (simplified for testing)
 */
export function calculateSimpleTWAP(prices: bigint[]): bigint {
  if (prices.length === 0) return 0n;
  const sum = prices.reduce((acc, price) => acc + price, 0n);
  return sum / BigInt(prices.length);
}

/**
 * Check if price deviation is within limit
 */
export function isPriceDeviationValid(
  price1: bigint,
  price2: bigint,
  maxDeviationBps: number
): boolean {
  if (price1 === 0n || price2 === 0n) return false;

  const diff = price1 > price2 ? price1 - price2 : price2 - price1;
  const deviation = (diff * 10000n) / price1;

  return deviation <= BigInt(maxDeviationBps);
}

/**
 * Check if stable token is depegged
 */
export function isStableDepegged(
  price: bigint,
  peg: bigint,
  thresholdBps: number
): boolean {
  const diff = price > peg ? price - peg : peg - price;
  const deviation = (diff * 10000n) / peg;
  return deviation > BigInt(thresholdBps);
}

/**
 * Generate random address for testing
 */
export function randomAddress(): string {
  return ethers.Wallet.createRandom().address;
}

/**
 * Convert basis points to percentage string
 */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Create position parameters helper
 */
export interface CreatePositionParams {
  owner: string;
  beneficiary: string;
  quoteToken: string;
  isBuy: boolean;
  frequency: number;
  venue: number;
  slippageBps: number;
  twapWindow: number;
  maxPriceDeviationBps: number;
  startAt: number;
  endAt: number;
  amountPerPeriod: bigint;
  priceFloorUsd: bigint;
  priceCapUsd: bigint;
  maxBaseFeeWei: bigint;
  maxPriorityFeeWei: bigint;
  mevProtection: boolean;
}

export function createDefaultPositionParams(
  owner: string,
  overrides?: Partial<CreatePositionParams>
): CreatePositionParams {
  const now = Math.floor(Date.now() / 1000);
  return {
    owner,
    beneficiary: owner,
    quoteToken: ethers.ZeroAddress, // Will be set to actual token in tests
    isBuy: true,
    frequency: 0, // DAILY
    venue: 0, // AUTO
    slippageBps: 50, // 0.5%
    twapWindow: 3600, // 1 hour
    maxPriceDeviationBps: 100, // 1%
    startAt: now + 3600, // 1 hour from now
    endAt: 0, // No end
    amountPerPeriod: ethers.parseUnits("100", 6), // $100 in USDC
    priceFloorUsd: 0n,
    priceCapUsd: 0n,
    maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
    maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
    mevProtection: true,
    ...overrides,
  };
}

/**
 * Create modify position parameters helper
 */
export interface ModifyPositionParams {
  slippageBps: number;
  venue: number;
  maxBaseFeeWei: bigint;
  maxPriorityFeeWei: bigint;
  priceFloorUsd: bigint;
  priceCapUsd: bigint;
  beneficiary: string;
  mevProtection: boolean;
}

export function createDefaultModifyParams(
  overrides?: Partial<ModifyPositionParams>
): ModifyPositionParams {
  return {
    slippageBps: 50,
    venue: 0,
    maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
    maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
    priceFloorUsd: 0n,
    priceCapUsd: 0n,
    beneficiary: ethers.ZeroAddress,
    mevProtection: true,
    ...overrides,
  };
}

/**
 * Create fee config helper
 */
export interface FeeConfig {
  protocolFeeBps: number;
  executionFeeFixedWei: bigint;
  gasPremiumBps: number;
  feeCollector: string;
  referralFeeBpsDefault: number;
}

export function createDefaultFeeConfig(
  feeCollector: string,
  overrides?: Partial<FeeConfig>
): FeeConfig {
  return {
    protocolFeeBps: 20, // 0.2%
    executionFeeFixedWei: ethers.parseEther("0.001"), // 0.001 ETH
    gasPremiumBps: 10, // 0.1%
    feeCollector,
    referralFeeBpsDefault: 50, // 50% of protocol fee
    ...overrides,
  };
}

/**
 * Get event arguments from transaction receipt
 */
export async function getEventArgs(
  tx: any,
  eventName: string
): Promise<any> {
  const receipt = await tx.wait();
  const event = receipt.logs.find(
    (log: any) => log.fragment && log.fragment.name === eventName
  );
  return event ? event.args : null;
}

/**
 * Expect transaction to emit event with args
 */
export async function expectEvent(
  tx: any,
  eventName: string,
  expectedArgs?: any
): Promise<void> {
  const args = await getEventArgs(tx, eventName);
  if (!args) {
    throw new Error(`Event ${eventName} not found`);
  }
  if (expectedArgs) {
    Object.keys(expectedArgs).forEach((key) => {
      if (args[key] !== expectedArgs[key]) {
        throw new Error(
          `Event ${eventName} arg ${key} mismatch: expected ${expectedArgs[key]}, got ${args[key]}`
        );
      }
    });
  }
}

/**
 * Encode route path for execution
 */
export function encodeRoutePath(
  tokens: string[],
  fees: number[]
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["address[]", "uint24[]"],
    [tokens, fees]
  );
}

/**
 * Decode route path
 */
export function decodeRoutePath(
  encodedPath: string
): { tokens: string[]; fees: number[] } {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const [tokens, fees] = abiCoder.decode(
    ["address[]", "uint24[]"],
    encodedPath
  );
  return { tokens, fees };
}

/**
 * Calculate expected output amount with slippage
 */
export function calculateMinOutput(
  inputAmount: bigint,
  price: bigint,
  slippageBps: number,
  inputDecimals: number,
  outputDecimals: number
): bigint {
  // Calculate expected output
  const expectedOutput = (inputAmount * price) / BigInt(10 ** inputDecimals);

  // Apply slippage
  const slippage = (expectedOutput * BigInt(slippageBps)) / 10000n;
  const minOutput = expectedOutput - slippage;

  return minOutput;
}

/**
 * Snapshot and revert helpers
 */
export async function takeSnapshot(): Promise<string> {
  return await ethers.provider.send("evm_snapshot", []);
}

export async function revertToSnapshot(snapshotId: string): Promise<void> {
  await ethers.provider.send("evm_revert", [snapshotId]);
}

/**
 * Impersonate account helper
 */
export async function impersonateAccount(address: string): Promise<SignerWithAddress> {
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  return await ethers.getSigner(address);
}

/**
 * Set balance for account
 */
export async function setBalance(address: string, balance: BigNumberish): Promise<void> {
  await ethers.provider.send("hardhat_setBalance", [
    address,
    ethers.toQuantity(balance),
  ]);
}

/**
 * Get position ID from PositionCreated event
 */
export async function getPositionIdFromTx(tx: any): Promise<bigint> {
  const receipt = await tx.wait();
  const event = receipt.logs.find(
    (log: any) => log.fragment && log.fragment.name === "PositionCreated"
  );
  if (!event) {
    throw new Error("PositionCreated event not found");
  }
  return event.args.positionId;
}
