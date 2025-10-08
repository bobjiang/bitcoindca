/**
 * Token addresses and protocol constants for Ethereum Mainnet
 * Used for testing with forked mainnet and production deployments
 */

export const MAINNET_ADDRESSES = {
  // Stablecoins
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",

  // Wrapped tokens
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",

  // Uniswap V3
  UNISWAP_V3_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  UNISWAP_V3_FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  UNISWAP_V3_QUOTER: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",

  // Chainlink Oracles
  CHAINLINK_BTC_USD: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  CHAINLINK_ETH_USD: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  CHAINLINK_USDC_USD: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",

  // Chainlink Automation
  CHAINLINK_REGISTRAR: "0x6B0B234fB2f380309D47A7E9391E29E9a179395a",
  CHAINLINK_REGISTRY: "0x02777053d6764996e594c3E88AF1D58D5363a2e6",

  // CoW Protocol
  COW_SETTLEMENT: "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  COW_VAULT_RELAYER: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",

  // 1inch
  ONEINCH_ROUTER: "0x1111111254EEB25477B68fb85Ed929f73A960582",

  // Permit2
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

export const SEPOLIA_ADDRESSES = {
  // Test tokens (Sepolia faucet tokens)
  USDC: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8", // Mock USDC
  WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",

  // Chainlink Oracles (Sepolia)
  CHAINLINK_BTC_USD: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  CHAINLINK_ETH_USD: "0x694AA1769357215DE4FAC081bf1f309aDC325306",

  // Uniswap V3 (Sepolia)
  UNISWAP_V3_ROUTER: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
  UNISWAP_V3_FACTORY: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",

  // Permit2 (same on all networks)
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};

/**
 * Protocol configuration constants
 */
export const PROTOCOL_CONSTANTS = {
  // Fee configuration (in basis points)
  DEFAULT_PROTOCOL_FEE_BPS: 20, // 0.20%
  MIN_PROTOCOL_FEE_BPS: 10, // 0.10%
  MAX_PROTOCOL_FEE_BPS: 30, // 0.30%
  DEFAULT_SLIPPAGE_BPS: 50, // 0.50%
  MAX_SLIPPAGE_BPS: 1000, // 10%

  // TWAP configuration
  DEFAULT_TWAP_WINDOW: 3600, // 1 hour
  MIN_TWAP_WINDOW: 600, // 10 minutes
  MAX_TWAP_WINDOW: 86400, // 24 hours

  // Price deviation limits
  DEFAULT_MAX_PRICE_DEVIATION_BPS: 100, // 1%
  MAX_PRICE_DEVIATION_BPS_LIMIT: 500, // 5%

  // Position limits
  MAX_POSITIONS_PER_USER: 10,
  MAX_GLOBAL_POSITIONS: 10000,
  MIN_POSITION_SIZE_USD: 100e6, // 100 USDC (6 decimals)

  // Oracle staleness
  MAX_ORACLE_STALENESS: 1800, // 30 minutes

  // Emergency withdrawal delay
  EMERGENCY_WITHDRAW_DELAY: 604800, // 7 days

  // Execution timing
  EXECUTION_GRACE_PERIOD: 21600, // 6 hours
  PUBLIC_EXECUTION_DELAY: 21600, // 6 hours after window start
};

/**
 * Token decimals
 */
export const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WBTC: 8,
  WETH: 18,
};

/**
 * Venue enum mapping
 */
export enum Venue {
  AUTO = 0,
  UNIV3_ONLY = 1,
  COW_ONLY = 2,
  AGGREGATOR = 3,
}

/**
 * Frequency enum mapping
 */
export enum Frequency {
  DAILY = 0,
  WEEKLY = 1,
  MONTHLY = 2,
}

/**
 * Helper function to get addresses for current network
 */
export function getNetworkAddresses(chainId: number) {
  switch (chainId) {
    case 1: // Mainnet
      return MAINNET_ADDRESSES;
    case 11155111: // Sepolia
      return SEPOLIA_ADDRESSES;
    case 31337: // Hardhat
      return MAINNET_ADDRESSES; // Use mainnet addresses when forking
    default:
      throw new Error(`Unsupported network: ${chainId}`);
  }
}
