import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, formatBps, formatDate } from "./utils";

describe("utils", () => {
  it("formats bigint token amounts with precision trimming", () => {
    expect(formatAmount(1_500_000_000_000_000_000n, 18, 2)).toBe("1.5");
    expect(formatAmount(1_234_567_890n, 8, 4)).toBe("12.3456");
    expect(formatAmount(10_000_000n, 6, 4)).toBe("10");
  });

  it("parses user input respecting decimals", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(() => parseAmount("abc", 6)).toThrowError("Invalid amount format");
  });

  it("formats basis points", () => {
    expect(formatBps(25)).toBe("0.25%");
  });

  it("formats unix timestamps in seconds", () => {
    expect(formatDate(1_700_000_000)).toMatch(/2023|2024/);
  });
});
