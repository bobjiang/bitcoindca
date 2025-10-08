import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatUnits, parseUnits } from "viem";
import { format as formatDateFns, fromUnixTime } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format token amounts with proper decimals
 */
export function formatAmount(
  amount: bigint,
  decimals: number,
  displayDecimals: number = 4
): string {
  const normalized = formatUnits(amount, decimals);

  if (displayDecimals < 0) {
    return normalized;
  }

  const [whole, fraction = ""] = normalized.split(".");

  if (displayDecimals === 0 || fraction.length === 0) {
    return whole;
  }

  const trimmed = fraction.slice(0, displayDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Parse user input to token amount with proper decimals
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const sanitized = amount.trim().replace(/,/g, "");

  if (sanitized.length === 0) {
    return 0n;
  }

  if (!/^\d*(\.\d*)?$/.test(sanitized)) {
    throw new Error("Invalid amount format");
  }

  try {
    return parseUnits(sanitized, decimals);
  } catch (error) {
    throw new Error("Amount has more precision than supported");
  }
}

/**
 * Format basis points to percentage
 */
export function formatBps(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

/**
 * Shorten address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format USD value
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format timestamp to readable date
 */
export function formatDate(timestamp: number): string {
  return formatDateFns(fromUnixTime(timestamp), "MMM d, yyyy HH:mm");
}
