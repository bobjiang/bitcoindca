import { ethers, upgrades } from "hardhat";
import { getAddress, parseUnits } from "ethers";
import { getNetworkAddresses, PROTOCOL_CONSTANTS } from "../utils/constants";

type CliValue = string | boolean;
type CliArgs = Record<string, CliValue>;

const ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  PAUSER: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
  MINTER: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  BURNER: "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848",
  EXECUTOR: "0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63",
  KEEPER: "0xfc8737ab85eb45125971625a9ebdb75cc78e01d5c1fa80c4c6e5203f47bc4fab",
  ROUTER_ADMIN: "0x7b765e0e932d348852a6f810bfa1ab891e259123f02db8cdcde614c570223357",
  TREASURER: "0x3496274819c84aa50c5e4e2b65d6c09d2b69f20e2c3c5d0c3c5c5c5c5c5c5c5c",
};

interface LocalDeploymentArtifacts {
  tokens: {
    wbtc: any;
    usdc: any;
    dai: any;
    usdt: any;
    weth: any;
  };
  priceFeeds: {
    btcUsd: any;
    ethUsd: any;
    usdcUsd: any;
  };
  dex: {
    uniswapRouter: any;
    uniswapPool: any;
    cowSettlement: any;
    oneInchRouter: any;
  };
}

interface DeploymentConfig {
  wbtc: string;
  usdc: string;
  dai: string;
  usdt: string;
  weth: string;
  priceFeeds: {
    btcUsd: string;
    ethUsd: string;
    usdcUsd: string;
  };
  uniswap?: {
    router: string;
    pool: string;
    fee: number;
  };
  cow?: {
    settlement: string;
  };
  oneInch?: {
    router: string;
  };
  chainHasLiveFeeds: boolean;
}

function parseCliArgs(): CliArgs {
  const rawArgs = process.argv.slice(2);
  const parsed: CliArgs = {};

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [flag, rawValue] = arg.split("=", 2);
    const key = flag.slice(2);

    if (rawValue !== undefined) {
      parsed[key] = rawValue;
      continue;
    }

    const next = rawArgs[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function resolveAddress(input: CliValue | undefined, fallback: string): string {
  if (typeof input === "string" && input.length > 0) {
    return getAddress(input);
  }
  return getAddress(fallback);
}

function defaultTreasuryFeeConfig(feeCollector: string) {
  return {
    protocolFeeBps: 30,
    executionFeeFixedWei: parseUnits("0.001", 18),
    gasPremiumBps: 10,
    feeCollector,
    referralFeeBpsDefault: 50,
    referralFeeOnTop: false,
  };
}

function defaultManagerFeeConfig(feeCollector: string) {
  return {
    protocolFeeBps: 30,
    executionFeeFixedWei: parseUnits("0.001", 18),
    gasPremiumBps: 10,
    feeCollector,
    referralFeeBpsDefault: 50,
  };
}

async function deployMockTokens(): Promise<LocalDeploymentArtifacts["tokens"]> {
  const deployToken = async (name: string, symbol: string, decimals: number) => {
    const factory = await ethers.getContractFactory("MockERC20");
    const token = await factory.deploy(name, symbol, decimals);
    await token.waitForDeployment();
    return token;
  };

  const [wbtc, usdc, dai, usdt, weth] = await Promise.all([
    deployToken("Wrapped Bitcoin", "WBTC", 8),
    deployToken("USD Coin", "USDC", 6),
    deployToken("Dai Stablecoin", "DAI", 18),
    deployToken("Tether USD", "USDT", 6),
    deployToken("Wrapped Ether", "WETH", 18),
  ]);

  return { wbtc, usdc, dai, usdt, weth };
}

async function deployMockFeeds(prices?: {
  btcUsd?: bigint;
  ethUsd?: bigint;
  usdcUsd?: bigint;
}) {
  const defaults = {
    btcUsd: parseUnits("40000", 8),
    ethUsd: parseUnits("2500", 8),
    usdcUsd: parseUnits("1", 8),
    ...prices,
  };

  const deployFeed = async (value: bigint) => {
    const factory = await ethers.getContractFactory("MockChainlinkAggregator");
    const feed = await factory.deploy(8, value);
    await feed.waitForDeployment();
    return feed;
  };

  const [btcUsd, ethUsd, usdcUsd] = await Promise.all([
    deployFeed(defaults.btcUsd),
    deployFeed(defaults.ethUsd),
    deployFeed(defaults.usdcUsd),
  ]);

  return { btcUsd, ethUsd, usdcUsd };
}

async function deployMockDex(tokens: { wbtc: any; usdc: any }) {
  const routerFactory = await ethers.getContractFactory("MockUniswapV3Router");
  const poolFactory = await ethers.getContractFactory("MockUniswapV3Pool");
  const cowSettlementFactory = await ethers.getContractFactory("MockCowSettlement");
  const oneInchRouterFactory = await ethers.getContractFactory("Mock1inchRouter");

  const [uniswapRouter, cowSettlement, oneInchRouter] = await Promise.all([
    routerFactory.deploy(),
    cowSettlementFactory.deploy(),
    oneInchRouterFactory.deploy(),
  ]);
  await Promise.all([
    uniswapRouter.waitForDeployment(),
    cowSettlement.waitForDeployment(),
    oneInchRouter.waitForDeployment(),
  ]);

  const usdcAddress = await tokens.usdc.getAddress();
  const wbtcAddress = await tokens.wbtc.getAddress();

  const uniswapPool = await poolFactory.deploy(usdcAddress, wbtcAddress, 3000);
  await uniswapPool.waitForDeployment();
  await uniswapRouter.registerPool(await uniswapPool.getAddress());

  return {
    uniswapRouter,
    uniswapPool,
    cowSettlement,
    oneInchRouter,
  };
}

async function setupLocalArtifacts(recipients: string[]): Promise<{
  artifacts: LocalDeploymentArtifacts;
  config: DeploymentConfig;
}> {
  const tokens = await deployMockTokens();
  const priceFeeds = await deployMockFeeds();
  const dex = await deployMockDex(tokens);

  const mintPromises = recipients.map(async (recipient) => {
    await tokens.wbtc.mint(recipient, parseUnits("10", 8));
    await tokens.usdc.mint(recipient, parseUnits("100000", 6));
    await tokens.dai.mint(recipient, parseUnits("100000", 18));
    await tokens.usdt.mint(recipient, parseUnits("100000", 6));
    await tokens.weth.mint(recipient, parseUnits("100", 18));
  });
  await Promise.all(mintPromises);

  const config: DeploymentConfig = {
    wbtc: await tokens.wbtc.getAddress(),
    usdc: await tokens.usdc.getAddress(),
    dai: await tokens.dai.getAddress(),
    usdt: await tokens.usdt.getAddress(),
    weth: await tokens.weth.getAddress(),
    priceFeeds: {
      btcUsd: await priceFeeds.btcUsd.getAddress(),
      ethUsd: await priceFeeds.ethUsd.getAddress(),
      usdcUsd: await priceFeeds.usdcUsd.getAddress(),
    },
    uniswap: {
      router: await dex.uniswapRouter.getAddress(),
      pool: await dex.uniswapPool.getAddress(),
      fee: 3000,
    },
    cow: {
      settlement: await dex.cowSettlement.getAddress(),
    },
    oneInch: {
      router: await dex.oneInchRouter.getAddress(),
    },
    chainHasLiveFeeds: false,
  };

  return {
    artifacts: {
      tokens,
      priceFeeds,
      dex,
    },
    config,
  };
}

async function registerOracleData(
  priceOracle: any,
  config: DeploymentConfig,
  artifacts?: LocalDeploymentArtifacts
) {
  await priceOracle.addPriceFeed(config.wbtc, config.priceFeeds.btcUsd);
  await priceOracle.addPriceFeed(config.usdc, config.priceFeeds.usdcUsd);
  await priceOracle.addPriceFeed(config.weth, config.priceFeeds.ethUsd);

  await priceOracle.configureAliasString("BTC", config.wbtc);
  await priceOracle.configureAliasString("WBTC", config.wbtc);
  await priceOracle.configureAliasString("ETH", config.weth);
  await priceOracle.configureAliasString("USDC", config.usdc);

  await priceOracle.setReferencePrice(config.wbtc, parseUnits("40000", 8));
  await priceOracle.setReferencePrice(config.weth, parseUnits("2500", 8));
  await priceOracle.setReferencePrice(config.usdc, parseUnits("1", 8));

  if (config.uniswap && artifacts) {
    await priceOracle.registerUniswapPool(
      config.usdc,
      config.wbtc,
      config.uniswap.fee,
      config.uniswap.pool
    );
  }
}

async function main() {
  const cli = parseCliArgs();

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No available signers. Configure PRIVATE_KEY or Hardhat accounts.");
  }

  const deployer = signers[0];
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("=== Deployment Context ===");
  console.log("Deployer:", deployer.address);
  console.log("Network:", network.name, `(chainId: ${chainId})`);

  let deploymentConfig: DeploymentConfig;
  let localArtifacts: LocalDeploymentArtifacts | undefined;

  const keeperFallback = signers[2] ?? deployer;
  const executorEOAFallback = signers[3] ?? deployer;
  const treasurySignerFallback = signers[1] ?? deployer;

  const keeperAddress = resolveAddress(cli.keeper, keeperFallback.address);
  const executorEOA = resolveAddress(cli.executor, executorEOAFallback.address);
  const treasuryOperator = resolveAddress(cli.treasury, treasurySignerFallback.address);

  const recipientSet = Array.from(new Set([deployer.address, keeperAddress, executorEOA, treasuryOperator]));

  if (chainId === 31337) {
    const local = await setupLocalArtifacts(recipientSet);
    deploymentConfig = local.config;
    localArtifacts = local.artifacts;
    console.log("Local mocks deployed (tokens, price feeds, DEX adapters).");
  } else {
    const addresses = getNetworkAddresses(chainId);
    deploymentConfig = {
      wbtc: addresses.WBTC,
      usdc: addresses.USDC,
      dai: addresses.DAI ?? addresses.USDC,
      usdt: addresses.USDT ?? addresses.USDC,
      weth: addresses.WETH,
      priceFeeds: {
        btcUsd: addresses.CHAINLINK_BTC_USD,
        ethUsd: addresses.CHAINLINK_ETH_USD,
        usdcUsd: addresses.CHAINLINK_USDC_USD ?? addresses.CHAINLINK_ETH_USD,
      },
      chainHasLiveFeeds: true,
    };
    console.log("Using static network addresses from constants.");
  }

  console.log("\n=== Deploying Core Contracts ===");

  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy();
  await priceOracle.waitForDeployment();
  console.log("PriceOracle:", await priceOracle.getAddress());

  await registerOracleData(priceOracle, deploymentConfig, localArtifacts);

  const PositionStorage = await ethers.getContractFactory("PositionStorage");
  const positionStorage = await upgrades.deployProxy(PositionStorage, [], {
    kind: "uups",
  });
  await positionStorage.waitForDeployment();
  console.log("PositionStorage:", await positionStorage.getAddress());

  const PositionNFT = await ethers.getContractFactory("PositionNFT");
  const positionNFT = await upgrades.deployProxy(
    PositionNFT,
    ["DCA Crypto Position", "BDCA", await positionStorage.getAddress()],
    {
      kind: "uups",
    }
  );
  await positionNFT.waitForDeployment();
  console.log("PositionNFT:", await positionNFT.getAddress());

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    PROTOCOL_CONSTANTS.EMERGENCY_WITHDRAW_DELAY,
    [treasuryOperator],
    [treasuryOperator],
    deployer.address
  );
  await treasury.waitForDeployment();
  console.log("Treasury:", await treasury.getAddress());

  await treasury.grantRole(await treasury.PAUSER_ROLE(), deployer.address);
  await treasury.initialize(defaultTreasuryFeeConfig(treasuryOperator));
  await treasury.grantRole(await treasury.TREASURER_ROLE(), treasuryOperator);

  const DcaManager = await ethers.getContractFactory("DcaManager");
  const dcaManager = await upgrades.deployProxy(
    DcaManager,
    [
      await positionNFT.getAddress(),
      await positionStorage.getAddress(),
      await priceOracle.getAddress(),
      await treasury.getAddress(),
      deploymentConfig.wbtc,
    ],
    {
      kind: "uups",
    }
  );
  await dcaManager.waitForDeployment();
  const dcaManagerAddress = await dcaManager.getAddress();
  console.log("DcaManager:", dcaManagerAddress);

  await positionStorage.setDcaManager(dcaManagerAddress);
  await positionNFT.setManager(dcaManagerAddress);

  await positionNFT.grantRole(ROLES.MINTER, dcaManagerAddress);
  await positionNFT.grantRole(ROLES.BURNER, dcaManagerAddress);
  await positionStorage.grantRole(ROLES.DEFAULT_ADMIN, dcaManagerAddress);

  await dcaManager.setQuoteTokenAllowed(deploymentConfig.usdc, true);
  if (deploymentConfig.dai) {
    await dcaManager.setQuoteTokenAllowed(deploymentConfig.dai, true);
  }
  if (deploymentConfig.usdt) {
    await dcaManager.setQuoteTokenAllowed(deploymentConfig.usdt, true);
  }
  await dcaManager.setBaseTokenAllowed(deploymentConfig.weth, true);

  await dcaManager.setProtocolConfig(defaultManagerFeeConfig(await treasury.getAddress()));

  const RouterManager = await ethers.getContractFactory("RouterManager");
  const routerManager = await RouterManager.deploy(dcaManagerAddress);
  await routerManager.waitForDeployment();
  console.log("RouterManager:", await routerManager.getAddress());

  const Executor = await ethers.getContractFactory("Executor");
  const executor = await Executor.deploy(
    dcaManagerAddress,
    await routerManager.getAddress(),
    await priceOracle.getAddress()
  );
  await executor.waitForDeployment();
  console.log("Executor:", await executor.getAddress());

  // Fund executor with small ETH balance for public tips
  await deployer.sendTransaction({
    to: await executor.getAddress(),
    value: parseUnits("1", 18),
  });

  await dcaManager.grantRole(ROLES.EXECUTOR, await executor.getAddress());
  await dcaManager.grantRole(ROLES.KEEPER, keeperAddress);
  await dcaManager.grantRole(ROLES.PAUSER, deployer.address);

  await executor.grantRole(ROLES.EXECUTOR, executorEOA);
  await executor.grantRole(ROLES.KEEPER, keeperAddress);

  if (deploymentConfig.uniswap || deploymentConfig.cow || deploymentConfig.oneInch) {
    console.log("\n=== Deploying Router Adapters ===");
  }

  if (deploymentConfig.uniswap && localArtifacts) {
    const UniV3Adapter = await ethers.getContractFactory("UniV3Adapter");
    const uniAdapter = await UniV3Adapter.deploy(deploymentConfig.uniswap.router);
    await uniAdapter.waitForDeployment();
    console.log("UniV3Adapter:", await uniAdapter.getAddress());

    await uniAdapter.registerPool(
      deploymentConfig.usdc,
      deploymentConfig.wbtc,
      deploymentConfig.uniswap.fee,
      deploymentConfig.uniswap.pool
    );

    await routerManager.addRouterAdapter(await uniAdapter.getAddress(), 1);
  }

  if (deploymentConfig.cow && localArtifacts) {
    const CoWAdapter = await ethers.getContractFactory("CoWAdapter");
    const cowAdapter = await CoWAdapter.deploy(deploymentConfig.cow.settlement);
    await cowAdapter.waitForDeployment();
    console.log("CoWAdapter:", await cowAdapter.getAddress());

    await cowAdapter.setSupportedPair(deploymentConfig.usdc, deploymentConfig.wbtc, true);

    await routerManager.addRouterAdapter(await cowAdapter.getAddress(), 2);
  }

  if (deploymentConfig.oneInch && localArtifacts) {
    const OneInchAdapter = await ethers.getContractFactory("OneInchAdapter");
    const oneInchAdapter = await OneInchAdapter.deploy(deploymentConfig.oneInch.router);
    await oneInchAdapter.waitForDeployment();
    console.log("OneInchAdapter:", await oneInchAdapter.getAddress());

    await oneInchAdapter.setSupportedPair(deploymentConfig.usdc, deploymentConfig.wbtc, true);

    await routerManager.addRouterAdapter(await oneInchAdapter.getAddress(), 3);
  }

  console.log("\n=== Deployment Summary ===");
  console.log("PriceOracle        :", await priceOracle.getAddress());
  console.log("PositionStorage    :", await positionStorage.getAddress());
  console.log("PositionNFT        :", await positionNFT.getAddress());
  console.log("Treasury           :", await treasury.getAddress());
  console.log("DcaManager         :", dcaManagerAddress);
  console.log("RouterManager      :", await routerManager.getAddress());
  console.log("Executor           :", await executor.getAddress());
  console.log("Keeper EOA         :", keeperAddress);
  console.log("Executor EOA       :", executorEOA);
  console.log("Treasury Operator  :", treasuryOperator);
  console.log("Base Asset (WBTC)  :", deploymentConfig.wbtc);
  console.log("Quote (USDC)       :", deploymentConfig.usdc);
  console.log("Additional quotes  :", [deploymentConfig.dai, deploymentConfig.usdt].filter(Boolean).join(", ") || "none");

  console.log("\nDeployment complete.");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
