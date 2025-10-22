import { parseUnits } from "ethers";

/**
 * Test Constants
 * Defines commonly used constants across all test suites
 */

// Time constants
export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 604800;
export const SECONDS_PER_MONTH = 2592000; // 30 days
export const SECONDS_PER_YEAR = 31536000;

// Position frequency enum
export enum Frequency {
  DAILY = 0,
  WEEKLY = 1,
  MONTHLY = 2,
}

// Venue enum
export enum Venue {
  AUTO = 0,
  UNIV3_ONLY = 1,
  COW_ONLY = 2,
  AGGREGATOR = 3,
}

// Token decimals
export const USDC_DECIMALS = 6;
export const WBTC_DECIMALS = 8;
export const DAI_DECIMALS = 18;
export const WETH_DECIMALS = 18;

// Default values for positions
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const DEFAULT_TWAP_WINDOW = 3600; // 1 hour
export const DEFAULT_MAX_PRICE_DEVIATION_BPS = 100; // 1%
export const DEFAULT_PROTOCOL_FEE_BPS = 30; // 0.3%

// System limits
export const MAX_POSITIONS_PER_USER = 10;
export const MAX_GLOBAL_POSITIONS = 10000;
export const MIN_POSITION_SIZE_USD = parseUnits("100", USDC_DECIMALS); // $100

// Gas limits
export const DEFAULT_MAX_BASE_FEE = parseUnits("100", "gwei");
export const DEFAULT_MAX_PRIORITY_FEE = parseUnits("2", "gwei");

// Oracle staleness
export const MAX_ORACLE_STALENESS = 1800; // 30 minutes

// Circuit breaker limits
export const MAX_DAILY_VOLUME_USD = parseUnits("10000000", USDC_DECIMALS); // $10M
export const MAX_PRICE_MOVEMENT_BPS = 2000; // 20%

// Depeg threshold
export const DEPEG_THRESHOLD_BPS = 100; // 1%

// Emergency withdrawal delay
export const EMERGENCY_WITHDRAWAL_DELAY = 7 * SECONDS_PER_DAY; // 7 days

// Public execution grace period
export const PUBLIC_EXECUTION_GRACE = 6 * 3600; // 6 hours

// Price constants (in USD with 8 decimals)
export const BTC_PRICE_USD = parseUnits("40000", 8); // $40,000
export const ETH_PRICE_USD = parseUnits("2500", 8); // $2,500
export const USDC_PRICE_USD = parseUnits("1", 8); // $1.00
export const WBTC_BTC_RATIO = parseUnits("1", 8); // 1:1

// Test amounts
export const TEST_AMOUNT_USDC = parseUnits("1000", USDC_DECIMALS); // $1,000
export const TEST_AMOUNT_WBTC = parseUnits("0.025", WBTC_DECIMALS); // 0.025 BTC

// Roles (keccak256 hashes)
export const ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  PAUSER: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
  MINTER: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  BURNER: "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848",
  METADATA: "0x8d4c60219e77b5304e8c9c5e6f59a1b0b9e52e0efc5df13b6b13b2d0d40c2b73",
  EXECUTOR: "0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63",
  KEEPER: "0xfc8737ab85eb45125971625a9ebdb75cc78e01d5c1fa80c4c6e5203f47bc4fab",
  ROUTER_ADMIN: "0x7b765e0e932d348852a6f810bfa1ab891e259123f02db8cdcde614c570223357",
  ORACLE_ADMIN: "0x1c6f93456f7ffe41e73aa3c9ee1c6f93456f7ffe41e73aa3c9ee1c6f93456f7f",
  TREASURER: "0x3496274819c84aa50c5e4e2b65d6c09d2b69f20e2c3c5d0c3c5c5c5c5c5c5c5c",
  EMERGENCY: "0x02016836a56b71f0d02689e69e326f4f4c1b9057164ef592671cf0d37c8040c0",
  FEE_COLLECTOR: "0x8227712ef8ad39d0f26f06731ef0df8665eb7ada7f41b1ee089c29e7b6e858c0",
};

// Template presets
export const TEMPLATES = {
  CONSERVATIVE: {
    slippageBps: 30, // 0.3%
    twapWindow: 7200, // 2 hours
    maxPriceDeviationBps: 50, // 0.5%
  },
  BALANCED: {
    slippageBps: 50, // 0.5%
    twapWindow: 3600, // 1 hour
    maxPriceDeviationBps: 100, // 1%
  },
  AGGRESSIVE: {
    slippageBps: 100, // 1%
    twapWindow: 1800, // 30 minutes
    maxPriceDeviationBps: 200, // 2%
  },
};

// Zero addresses
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
