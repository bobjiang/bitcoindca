import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  setupMockTokens,
  setupMockPriceFeeds,
  setupMockDEXs,
  setupTestBalances,
} from "../helpers/mocks";
import {
  createDefaultFeeConfig,
  ROLES,
  BTC_PRICE_USD,
  ETH_PRICE_USD,
  USDC_PRICE_USD,
} from "../helpers/constants";

/**
 * Test Fixtures
 * Complete deployment and setup for testing
 */

/**
 * Base system deployment fixture
 */
export async function deployBaseSystemFixture() {
  const [deployer, treasury, user1, user2, user3, keeper, executor] =
    await ethers.getSigners();

  // Deploy mock tokens
  const tokens = await setupMockTokens(deployer);

  // Deploy mock price feeds
  const priceFeeds = await setupMockPriceFeeds(deployer);

  // Deploy PriceOracle
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy();
  await priceOracle.waitForDeployment();

  // Initialize price feeds in oracle
  await priceOracle.addPriceFeed(
    await tokens.wbtc.getAddress(),
    await priceFeeds.btcUsdFeed.getAddress()
  );
  await priceOracle.addPriceFeed(
    await tokens.usdc.getAddress(),
    await priceFeeds.usdcUsdFeed.getAddress()
  );
  await priceOracle.addPriceFeed(
    await tokens.weth.getAddress(),
    await priceFeeds.ethUsdFeed.getAddress()
  );

  // Configure symbol aliases for convenience getters
  await priceOracle.configureAliasString("BTC", await tokens.wbtc.getAddress());
  await priceOracle.configureAliasString("WBTC", await tokens.wbtc.getAddress());
  await priceOracle.configureAliasString("ETH", await tokens.weth.getAddress());
  await priceOracle.configureAliasString("USDC", await tokens.usdc.getAddress());

  // Seed reference prices used for confidence scoring
  await priceOracle.setReferencePrice(await tokens.wbtc.getAddress(), BTC_PRICE_USD);
  await priceOracle.setReferencePrice(await tokens.weth.getAddress(), ETH_PRICE_USD);
  await priceOracle.setReferencePrice(await tokens.usdc.getAddress(), USDC_PRICE_USD);

  // Deploy PositionStorage
  const PositionStorage = await ethers.getContractFactory("PositionStorage");
  const positionStorage = await upgrades.deployProxy(
    PositionStorage,
    [],
    { kind: "uups" }
  );
  await positionStorage.waitForDeployment();

  // Deploy PositionNFT
  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await upgrades.deployProxy(
    PositionNFT,
    [
      "Bitcoin DCA Position",
      "BDCA",
      await positionStorage.getAddress(),
    ],
    { kind: "uups" }
  );
  await positionNFT.waitForDeployment();

  // Deploy MockTreasury (placeholder until real Treasury is implemented)
  const MockTreasury = await ethers.getContractFactory("MockTreasury");
  const treasuryContract = await MockTreasury.deploy(
    [treasury.address],
    1, // 1 of 1 multisig for testing
    86400 // 1 day timelock
  );
  await treasuryContract.waitForDeployment();

  // Deploy DcaManager
  const DcaManager = await ethers.getContractFactory("DcaManager");
  const dcaManager = await upgrades.deployProxy(
    DcaManager,
    [
      await positionNFT.getAddress(),
      await positionStorage.getAddress(),
      await priceOracle.getAddress(),
      await treasuryContract.getAddress(),
      await tokens.wbtc.getAddress(),
    ],
    { kind: "uups" }
  );
  await dcaManager.waitForDeployment();

  await positionNFT
    .connect(deployer)
    .setManager(await dcaManager.getAddress());

  await dcaManager.connect(deployer).setQuoteTokenAllowed(await tokens.usdc.getAddress(), true);
  await dcaManager.connect(deployer).setQuoteTokenAllowed(await tokens.dai.getAddress(), true);
  await dcaManager.connect(deployer).setQuoteTokenAllowed(await tokens.usdt.getAddress(), true);

  // Deploy RouterManager
  const RouterManager = await ethers.getContractFactory("RouterManager");
  const routerManager = await RouterManager.deploy(
    await dcaManager.getAddress()
  );
  await routerManager.waitForDeployment();

  // Deploy Executor
  const Executor = await ethers.getContractFactory("Executor");
  const executorContract = await Executor.deploy(
    await dcaManager.getAddress(),
    await routerManager.getAddress(),
    await priceOracle.getAddress()
  );
  await executorContract.waitForDeployment();

  // Grant roles
  await positionNFT.grantRole(
    ROLES.MINTER,
    await dcaManager.getAddress()
  );
  await positionNFT.grantRole(
    ROLES.BURNER,
    await dcaManager.getAddress()
  );

  await positionStorage.grantRole(
    ROLES.DEFAULT_ADMIN,
    await dcaManager.getAddress()
  );

  await dcaManager.grantRole(ROLES.EXECUTOR, await executorContract.getAddress());
  await dcaManager.grantRole(ROLES.KEEPER, keeper.address);
  await dcaManager.grantRole(ROLES.PAUSER, deployer.address);

  await executorContract.grantRole(ROLES.EXECUTOR, executor.address);
  await executorContract.grantRole(ROLES.KEEPER, keeper.address);

  // Setup protocol configuration to mirror production defaults
  const feeConfig = createDefaultFeeConfig(await treasuryContract.getAddress());
  await dcaManager.setProtocolConfig(feeConfig);

  // Setup test balances
  await setupTestBalances(tokens, [user1, user2, user3]);

  return {
    deployer,
    treasury,
    user1,
    user2,
    user3,
    keeper,
    executor,
    tokens,
    priceFeeds,
    priceOracle,
    positionStorage,
    positionNFT,
    treasuryContract,
    dcaManager,
    routerManager,
    executorContract,
  };
}

async function deploySystemWithAdapters(options?: { registerAdapters?: boolean }) {
  const base = await deployBaseSystemFixture();

  // Deploy mock DEX infrastructure
  const dexs = await setupMockDEXs(base.deployer, {
    wbtc: base.tokens.wbtc,
    usdc: base.tokens.usdc,
    weth: base.tokens.weth,
  });

  await base.priceOracle.registerUniswapPool(
    await base.tokens.usdc.getAddress(),
    await base.tokens.wbtc.getAddress(),
    3000,
    await dexs.uniswapPool.getAddress()
  );

  // Deploy Router Adapters
  const UniV3Adapter = await ethers.getContractFactory("UniV3Adapter");
  const uniV3Adapter = await UniV3Adapter.deploy(
    await dexs.uniswapRouter.getAddress()
  );
  await uniV3Adapter.waitForDeployment();

  const CoWAdapter = await ethers.getContractFactory("CoWAdapter");
  const cowAdapter = await CoWAdapter.deploy(
    await dexs.cowSettlement.getAddress()
  );
  await cowAdapter.waitForDeployment();

  const OneInchAdapter = await ethers.getContractFactory("OneInchAdapter");
  const oneInchAdapter = await OneInchAdapter.deploy(
    await dexs.oneInchRouter.getAddress()
  );
  await oneInchAdapter.waitForDeployment();

  if (options?.registerAdapters !== false) {
    await base.routerManager.addRouterAdapter(
      await uniV3Adapter.getAddress(),
      1 // UNIV3_ONLY
    );
    await base.routerManager.addRouterAdapter(
      await cowAdapter.getAddress(),
      2 // COW_ONLY
    );
    await base.routerManager.addRouterAdapter(
      await oneInchAdapter.getAddress(),
      3 // AGGREGATOR
    );
  }

  return {
    ...base,
    dexs,
    uniV3Adapter,
    cowAdapter,
    oneInchAdapter,
  };
}

/**
 * Full system with DEX adapters fixture (adapters pre-registered)
 */
export async function deployFullSystemFixture() {
  return deploySystemWithAdapters({ registerAdapters: true });
}

/**
 * RouterManager-centric fixture (adapters deployed but NOT registered)
 */
export async function deployRouterManagerFixture() {
  return deploySystemWithAdapters({ registerAdapters: false });
}

/**
 * Minimal fixture for unit testing individual contracts
 */
export async function deployMinimalFixture() {
  const [deployer, user1, user2] = await ethers.getSigners();

  const tokens = await setupMockTokens(deployer);
  const priceFeeds = await setupMockPriceFeeds(deployer);

  await setupTestBalances(tokens, [user1, user2]);

  return {
    deployer,
    user1,
    user2,
    tokens,
    priceFeeds,
  };
}

/**
 * Position testing fixture - includes a created position
 */
export async function deployWithPositionFixture() {
  const base = await deployFullSystemFixture();

  // Create a test position
  const currentTime = Math.floor(Date.now() / 1000);
  const startAt = currentTime + 3600; // 1 hour from now

  const createParams = {
    owner: base.user1.address,
    beneficiary: base.user1.address,
    quoteToken: await base.tokens.usdc.getAddress(),
    isBuy: true,
    frequency: 0, // DAILY
    venue: 0, // AUTO
    slippageBps: 50, // 0.5%
    twapWindow: 3600, // 1 hour
    maxPriceDeviationBps: 100, // 1%
    startAt,
    endAt: 0, // No end
    amountPerPeriod: ethers.parseUnits("100", 6), // $100
    priceFloorUsd: 0,
    priceCapUsd: 0,
    maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
    maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
    mevProtection: true,
  };

  // Approve tokens
  await base.tokens.usdc
    .connect(base.user1)
    .approve(await base.dcaManager.getAddress(), ethers.MaxUint256);

  // Create position
  const tx = await base.dcaManager
    .connect(base.user1)
    .createPosition(createParams);

  const receipt = await tx.wait();
  const event = receipt.logs.find(
    (log: any) => log.fragment && log.fragment.name === "PositionCreated"
  );
  const positionId = event ? event.args.positionId : 1n;

  // Deposit initial funds
  await base.dcaManager
    .connect(base.user1)
    .deposit(positionId, await base.tokens.usdc.getAddress(), ethers.parseUnits("1000", 6));

  return {
    ...base,
    positionId,
    createParams,
  };
}

/**
 * Circuit breaker testing fixture
 */
export async function deployCircuitBreakerFixture() {
  const base = await deployFullSystemFixture();

  // Setup circuit breaker limits
  await base.dcaManager.setDailyVolumeLimitUsd(
    ethers.parseUnits("10000000", 6) // $10M
  );
  await base.dcaManager.setMaxPriceMovementBps(2000); // 20%

  return base;
}

/**
 * Multi-position fixture for batch testing
 */
export async function deployMultiPositionFixture() {
  const base = await deployFullSystemFixture();

  const currentTime = Math.floor(Date.now() / 1000);
  const positionIds: bigint[] = [];

  // Approve tokens for all users
  for (const user of [base.user1, base.user2, base.user3]) {
    await base.tokens.usdc
      .connect(user)
      .approve(await base.dcaManager.getAddress(), ethers.MaxUint256);
  }

  // Create multiple positions with different parameters
  const positions = [
    {
      user: base.user1,
      isBuy: true,
      frequency: 0, // DAILY
      amount: ethers.parseUnits("100", 6),
    },
    {
      user: base.user1,
      isBuy: true,
      frequency: 1, // WEEKLY
      amount: ethers.parseUnits("500", 6),
    },
    {
      user: base.user2,
      isBuy: true,
      frequency: 2, // MONTHLY
      amount: ethers.parseUnits("2000", 6),
    },
    {
      user: base.user3,
      isBuy: false, // SELL
      frequency: 0, // DAILY
      amount: ethers.parseUnits("0.001", 8), // WBTC
    },
  ];

  for (const pos of positions) {
    const createParams = {
      owner: pos.user.address,
      beneficiary: pos.user.address,
      quoteToken: await base.tokens.usdc.getAddress(),
      isBuy: pos.isBuy,
      frequency: pos.frequency,
      venue: 0, // AUTO
      slippageBps: 50,
      twapWindow: 3600,
      maxPriceDeviationBps: 100,
      startAt: currentTime + 3600,
      endAt: 0,
      amountPerPeriod: pos.amount,
      priceFloorUsd: 0,
      priceCapUsd: 0,
      maxBaseFeeWei: ethers.parseUnits("100", "gwei"),
      maxPriorityFeeWei: ethers.parseUnits("2", "gwei"),
      mevProtection: true,
    };

    const tx = await base.dcaManager
      .connect(pos.user)
      .createPosition(createParams);

    const receipt = await tx.wait();
    const event = receipt.logs.find(
      (log: any) => log.fragment && log.fragment.name === "PositionCreated"
    );

    if (event) {
      positionIds.push(event.args.positionId);

      // Deposit funds
      const depositAmount = pos.isBuy
        ? ethers.parseUnits("5000", 6) // USDC
        : ethers.parseUnits("0.1", 8); // WBTC

      const depositToken = pos.isBuy
        ? await base.tokens.usdc.getAddress()
        : await base.tokens.wbtc.getAddress();

      // Approve WBTC if needed
      if (!pos.isBuy) {
        await base.tokens.wbtc
          .connect(pos.user)
          .approve(await base.dcaManager.getAddress(), ethers.MaxUint256);
      }

      await base.dcaManager
        .connect(pos.user)
        .deposit(event.args.positionId, depositToken, depositAmount);
    }
  }

  return {
    ...base,
    positionIds,
  };
}
