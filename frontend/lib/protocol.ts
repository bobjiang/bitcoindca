export enum Venue {
  AUTO = 0,
  UNIV3_ONLY = 1,
  COW_ONLY = 2,
  AGGREGATOR = 3,
}

export enum Frequency {
  DAILY = 0,
  WEEKLY = 1,
  MONTHLY = 2,
}

export const FREQUENCY_OPTIONS: Array<{ label: string; value: Frequency; description: string }> = [
  {
    label: "Daily",
    value: Frequency.DAILY,
    description: "Executes every 24 hours with calendar-aware scheduling",
  },
  {
    label: "Weekly",
    value: Frequency.WEEKLY,
    description: "Executes once per week using the start date weekday",
  },
  {
    label: "Monthly",
    value: Frequency.MONTHLY,
    description: "Executes once per month and clamps to month end when needed",
  },
];

export const VENUE_OPTIONS: Array<{ label: string; value: Venue; helper: string }> = [
  {
    label: "Auto (recommended)",
    value: Venue.AUTO,
    helper: "Router decides between Uniswap v3, CoW Protocol, and 1inch",
  },
  {
    label: "Uniswap v3 only",
    value: Venue.UNIV3_ONLY,
    helper: "Direct swaps via Uniswap v3 with Flashbots where possible",
  },
  {
    label: "CoW Protocol only",
    value: Venue.COW_ONLY,
    helper: "Batch auction fills with MEV protection and partial fills",
  },
  {
    label: "Aggregator",
    value: Venue.AGGREGATOR,
    helper: "Fallback routing through 1inch aggregator",
  },
];

export const PROTOCOL_CONSTANTS = {
  defaultProtocolFeeBps: 20,
  minProtocolFeeBps: 10,
  maxProtocolFeeBps: 30,
  defaultSlippageBps: 50,
  maxSlippageBps: 1_000,
  defaultTwapWindowSeconds: 3_600,
  minTwapWindowSeconds: 600,
  maxTwapWindowSeconds: 86_400,
  defaultMaxPriceDeviationBps: 100,
  maxPriceDeviationBpsLimit: 500,
  maxPositionsPerUser: 10,
  maxGlobalPositions: 10_000,
  minPositionSizeUsd: 100,
  maxOracleStalenessSeconds: 1_800,
  executionGracePeriodSeconds: 21_600,
};

export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WBTC: 8,
  WETH: 18,
};

export const SUPPORTED_BASE_ASSETS = [
  { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { symbol: "ETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
];

export const SUPPORTED_QUOTE_ASSETS = [
  { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  { symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
];

export const MEV_MODES = [
  { label: "Private (Flashbots)", value: "PRIVATE", description: "Sends via Flashbots for maximal MEV protection" },
  { label: "Public", value: "PUBLIC", description: "Public mempool with strict slippage and price guards" },
];

export const EXECUTION_REASONS = {
  SKIPPED: {
    priceGuard: "Price guard prevented execution",
    gasCap: "Gas cap exceeded",
    liquidity: "Insufficient liquidity or high price impact",
    staleOracle: "Oracle stale beyond configured freshness",
  },
} as const;

export type MevMode = (typeof MEV_MODES)[number]["value"];
