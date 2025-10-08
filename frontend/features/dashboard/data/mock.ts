import { Frequency, Venue } from "@/lib/protocol";

export interface PositionSummary {
  id: number;
  label: string;
  status: "Active" | "Paused" | "Grace";
  direction: "BUY" | "SELL";
  baseAsset: string;
  quoteAsset: string;
  amountPerPeriodUsd: number;
  frequency: Frequency;
  nextRunAt: number;
  avgCostUsd: number;
  periodsExecuted: number;
  venue: Venue;
  totalFeesPaidUsd: number;
}

export interface ExecutionLogRow {
  positionId: number;
  timestamp: number;
  venue: Venue;
  keeper: string;
  txHash: string;
  notionalUsd: number;
  fillsBase: number;
  priceUsd: number;
  priceImpactBps: number;
  gasUsed: number;
  status: "Filled" | "Skipped";
  direction: "BUY" | "SELL";
  baseAsset: string;
  quoteAsset: string;
}

export interface DashboardSnapshot {
  positions: PositionSummary[];
  executions: ExecutionLogRow[];
  health: {
    globalVolumeUsdToday: number;
    globalVolumeCapUsd: number;
    oracleFresh: boolean;
    pausedPositions: number;
    circuitBreakerActive: boolean;
  };
}

export const demoSnapshot: DashboardSnapshot = {
  positions: [
    {
      id: 1,
      label: "Papa Sats",
      status: "Active",
      direction: "BUY",
      baseAsset: "WBTC",
      quoteAsset: "USDC",
      amountPerPeriodUsd: 500,
      frequency: Frequency.WEEKLY,
      nextRunAt: 1_700_995_200,
      avgCostUsd: 63_750,
      periodsExecuted: 18,
      venue: Venue.AUTO,
      totalFeesPaidUsd: 96,
    },
    {
      id: 2,
      label: "ETH profit take",
      status: "Grace",
      direction: "SELL",
      baseAsset: "ETH",
      quoteAsset: "USDC",
      amountPerPeriodUsd: 1_200,
      frequency: Frequency.MONTHLY,
      nextRunAt: 1_701_081_600,
      avgCostUsd: 3_220,
      periodsExecuted: 6,
      venue: Venue.COW_ONLY,
      totalFeesPaidUsd: 54,
    },
    {
      id: 3,
      label: "Stable accumulator",
      status: "Paused",
      direction: "BUY",
      baseAsset: "WBTC",
      quoteAsset: "USDT",
      amountPerPeriodUsd: 250,
      frequency: Frequency.DAILY,
      nextRunAt: 1_700_940_800,
      avgCostUsd: 61_450,
      periodsExecuted: 42,
      venue: Venue.UNIV3_ONLY,
      totalFeesPaidUsd: 210,
    },
  ],
  executions: [
    {
      positionId: 1,
      timestamp: 1_700_912_800,
      venue: Venue.COW_ONLY,
      keeper: "0xkeeperc0ffe...",
      txHash: "0x1f95…9a2b",
      notionalUsd: 485,
      fillsBase: 0.0079,
      priceUsd: 61_392,
      priceImpactBps: -6,
      gasUsed: 512_000,
      status: "Filled",
      direction: "BUY",
      baseAsset: "WBTC",
      quoteAsset: "USDC",
    },
    {
      positionId: 3,
      timestamp: 1_700_824_000,
      venue: Venue.UNIV3_ONLY,
      keeper: "0xkeeperf00d...",
      txHash: "0xab42…d1f3",
      notionalUsd: 250,
      fillsBase: 0.0041,
      priceUsd: 61_050,
      priceImpactBps: 11,
      gasUsed: 396_000,
      status: "Filled",
      direction: "BUY",
      baseAsset: "WBTC",
      quoteAsset: "USDT",
    },
    {
      positionId: 2,
      timestamp: 1_700_735_200,
      venue: Venue.COW_ONLY,
      keeper: "0xkeeperbeef...",
      txHash: "0xcd88…7b90",
      notionalUsd: 1_180,
      fillsBase: 0.36,
      priceUsd: 3_278,
      priceImpactBps: -18,
      gasUsed: 612_000,
      status: "Skipped",
      direction: "SELL",
      baseAsset: "ETH",
      quoteAsset: "USDC",
    },
  ],
  health: {
    globalVolumeUsdToday: 1_915_000,
    globalVolumeCapUsd: 10_000_000,
    oracleFresh: true,
    pausedPositions: 4,
    circuitBreakerActive: false,
  },
};
