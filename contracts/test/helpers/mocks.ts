import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseUnits } from "ethers";

/**
 * Mock Contracts and Helpers
 * Functions to deploy mock contracts for testing
 */

/**
 * Deploy mock ERC20 token
 */
export async function deployMockERC20(
  name: string,
  symbol: string,
  decimals: number,
  deployer: SignerWithAddress
): Promise<any> {
  const MockERC20 = await ethers.getContractFactory("MockERC20", deployer);
  const token = await MockERC20.deploy(name, symbol, decimals);
  await token.waitForDeployment();
  return token;
}

/**
 * Deploy mock WBTC token
 */
export async function deployMockWBTC(deployer: SignerWithAddress): Promise<any> {
  return await deployMockERC20("Wrapped Bitcoin", "WBTC", 8, deployer);
}

/**
 * Deploy mock USDC token
 */
export async function deployMockUSDC(deployer: SignerWithAddress): Promise<any> {
  return await deployMockERC20("USD Coin", "USDC", 6, deployer);
}

/**
 * Deploy mock DAI token
 */
export async function deployMockDAI(deployer: SignerWithAddress): Promise<any> {
  return await deployMockERC20("Dai Stablecoin", "DAI", 18, deployer);
}

/**
 * Deploy mock USDT token
 */
export async function deployMockUSDT(deployer: SignerWithAddress): Promise<any> {
  return await deployMockERC20("Tether USD", "USDT", 6, deployer);
}

/**
 * Deploy mock WETH token
 */
export async function deployMockWETH(deployer: SignerWithAddress): Promise<any> {
  return await deployMockERC20("Wrapped Ether", "WETH", 18, deployer);
}

/**
 * Deploy mock Chainlink price feed
 */
export async function deployMockChainlinkFeed(
  decimals: number,
  initialPrice: bigint,
  deployer: SignerWithAddress
): Promise<any> {
  const MockChainlinkFeed = await ethers.getContractFactory("MockChainlinkAggregator", deployer);
  const feed = await MockChainlinkFeed.deploy(decimals, initialPrice);
  await feed.waitForDeployment();
  return feed;
}

/**
 * Deploy mock Uniswap V3 pool
 */
export async function deployMockUniswapV3Pool(
  token0: string,
  token1: string,
  fee: number,
  deployer: SignerWithAddress
): Promise<any> {
  const MockUniswapV3Pool = await ethers.getContractFactory("MockUniswapV3Pool", deployer);
  const pool = await MockUniswapV3Pool.deploy(token0, token1, fee);
  await pool.waitForDeployment();
  return pool;
}

/**
 * Deploy mock Uniswap V3 Router
 */
export async function deployMockUniswapV3Router(deployer: SignerWithAddress): Promise<any> {
  const MockUniswapV3Router = await ethers.getContractFactory("MockUniswapV3Router", deployer);
  const router = await MockUniswapV3Router.deploy();
  await router.waitForDeployment();
  return router;
}

/**
 * Deploy mock CoW Protocol Settlement
 */
export async function deployMockCowSettlement(deployer: SignerWithAddress): Promise<any> {
  const MockCowSettlement = await ethers.getContractFactory("MockCowSettlement", deployer);
  const settlement = await MockCowSettlement.deploy();
  await settlement.waitForDeployment();
  return settlement;
}

/**
 * Deploy mock 1inch Router
 */
export async function deployMock1inchRouter(deployer: SignerWithAddress): Promise<any> {
  const Mock1inchRouter = await ethers.getContractFactory("Mock1inchRouter", deployer);
  const router = await Mock1inchRouter.deploy();
  await router.waitForDeployment();
  return router;
}

/**
 * Mint tokens to address
 */
export async function mintTokens(
  token: any,
  to: string,
  amount: bigint
): Promise<void> {
  await token.mint(to, amount);
}

/**
 * Setup token approvals
 */
export async function approveTokens(
  token: any,
  owner: SignerWithAddress,
  spender: string,
  amount: bigint
): Promise<void> {
  await token.connect(owner).approve(spender, amount);
}

/**
 * Mock price feed data
 */
export interface MockPriceData {
  btcUsd: bigint;
  ethUsd: bigint;
  usdcUsd: bigint;
  wbtcBtc: bigint;
}

export function createMockPriceData(overrides?: Partial<MockPriceData>): MockPriceData {
  return {
    btcUsd: parseUnits("40000", 8), // $40,000
    ethUsd: parseUnits("2500", 8), // $2,500
    usdcUsd: parseUnits("1", 8), // $1.00
    wbtcBtc: parseUnits("1", 8), // 1:1 ratio
    ...overrides,
  };
}

/**
 * Setup mock price feeds
 */
export async function setupMockPriceFeeds(
  deployer: SignerWithAddress,
  priceData?: MockPriceData
): Promise<{
  btcUsdFeed: any;
  ethUsdFeed: any;
  usdcUsdFeed: any;
  wbtcBtcFeed: any;
}> {
  const prices = priceData || createMockPriceData();

  const btcUsdFeed = await deployMockChainlinkFeed(8, prices.btcUsd, deployer);
  const ethUsdFeed = await deployMockChainlinkFeed(8, prices.ethUsd, deployer);
  const usdcUsdFeed = await deployMockChainlinkFeed(8, prices.usdcUsd, deployer);
  const wbtcBtcFeed = await deployMockChainlinkFeed(8, prices.wbtcBtc, deployer);

  return {
    btcUsdFeed,
    ethUsdFeed,
    usdcUsdFeed,
    wbtcBtcFeed,
  };
}

/**
 * Setup mock tokens
 */
export async function setupMockTokens(deployer: SignerWithAddress): Promise<{
  wbtc: any;
  usdc: any;
  dai: any;
  usdt: any;
  weth: any;
}> {
  const wbtc = await deployMockWBTC(deployer);
  const usdc = await deployMockUSDC(deployer);
  const dai = await deployMockDAI(deployer);
  const usdt = await deployMockUSDT(deployer);
  const weth = await deployMockWETH(deployer);

  return {
    wbtc,
    usdc,
    dai,
    usdt,
    weth,
  };
}

/**
 * Setup test balances for users
 */
export async function setupTestBalances(
  tokens: {
    wbtc: any;
    usdc: any;
    dai: any;
    usdt: any;
    weth: any;
  },
  users: SignerWithAddress[]
): Promise<void> {
  const wbtcAmount = parseUnits("10", 8); // 10 WBTC
  const usdcAmount = parseUnits("100000", 6); // $100,000 USDC
  const daiAmount = parseUnits("100000", 18); // $100,000 DAI
  const usdtAmount = parseUnits("100000", 6); // $100,000 USDT
  const wethAmount = parseUnits("100", 18); // 100 WETH

  for (const user of users) {
    await mintTokens(tokens.wbtc, user.address, wbtcAmount);
    await mintTokens(tokens.usdc, user.address, usdcAmount);
    await mintTokens(tokens.dai, user.address, daiAmount);
    await mintTokens(tokens.usdt, user.address, usdtAmount);
    await mintTokens(tokens.weth, user.address, wethAmount);
  }
}

/**
 * Create mock execution result
 */
export interface MockExecutionResult {
  positionId: bigint;
  success: boolean;
  reason: string;
  amountIn: bigint;
  amountOut: bigint;
  tokenIn: string;
  tokenOut: string;
  venue: number;
  priceUsd: bigint;
  protocolFee: bigint;
  executionFee: bigint;
  gasUsed: bigint;
}

export function createMockExecutionResult(
  overrides?: Partial<MockExecutionResult>
): MockExecutionResult {
  return {
    positionId: 1n,
    success: true,
    reason: "",
    amountIn: parseUnits("100", 6),
    amountOut: parseUnits("0.0025", 8),
    tokenIn: ethers.ZeroAddress,
    tokenOut: ethers.ZeroAddress,
    venue: 0,
    priceUsd: parseUnits("40000", 8),
    protocolFee: parseUnits("0.2", 6),
    executionFee: parseUnits("0.001", 18),
    gasUsed: 200000n,
    ...overrides,
  };
}

/**
 * Setup mock DEX infrastructure
 */
export async function setupMockDEXs(
  deployer: SignerWithAddress,
  tokens: {
    wbtc: any;
    usdc: any;
    weth: any;
  }
): Promise<{
  uniswapRouter: any;
  cowSettlement: any;
  oneInchRouter: any;
  uniswapPool: any;
}> {
  const uniswapRouter = await deployMockUniswapV3Router(deployer);
  const cowSettlement = await deployMockCowSettlement(deployer);
  const oneInchRouter = await deployMock1inchRouter(deployer);

  const wbtcAddress = await tokens.wbtc.getAddress();
  const usdcAddress = await tokens.usdc.getAddress();

  const uniswapPool = await deployMockUniswapV3Pool(
    usdcAddress,
    wbtcAddress,
    3000, // 0.3% fee tier
    deployer
  );

  await uniswapRouter.registerPool(await uniswapPool.getAddress());

  return {
    uniswapRouter,
    cowSettlement,
    oneInchRouter,
    uniswapPool,
  };
}
