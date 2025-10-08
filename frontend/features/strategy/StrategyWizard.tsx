"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Frequency,
  FREQUENCY_OPTIONS,
  MEV_MODES,
  PROTOCOL_CONSTANTS,
  SUPPORTED_BASE_ASSETS,
  SUPPORTED_QUOTE_ASSETS,
  VENUE_OPTIONS,
  Venue,
} from "@/lib/protocol";
import { cn, formatUsd } from "@/lib/utils";

const strategySchema = z.object({
  direction: z.enum(["BUY", "SELL"]),
  baseAsset: z.enum(["WBTC", "ETH"]),
  quoteAsset: z.enum(["USDC", "USDT", "DAI"]),
  amountPerPeriod: z.string().min(1, "Amount is required"),
  displayCurrency: z.enum(["TOKEN", "USD"]),
  frequency: z.nativeEnum(Frequency),
  startDate: z.string().min(1, "Start date required"),
  startTime: z.string().min(1, "Start time required"),
  endDate: z.string().optional(),
  slippageBps: z
    .number()
    .min(1)
    .max(PROTOCOL_CONSTANTS.maxSlippageBps),
  priceCapUsd: z.string().optional(),
  priceFloorUsd: z.string().optional(),
  twapWindowSeconds: z
    .number()
    .min(PROTOCOL_CONSTANTS.minTwapWindowSeconds)
    .max(PROTOCOL_CONSTANTS.maxTwapWindowSeconds),
  maxPriceDeviationBps: z
    .number()
    .min(0)
    .max(PROTOCOL_CONSTANTS.maxPriceDeviationBpsLimit),
  venue: z.nativeEnum(Venue),
  mevMode: z.enum(["PRIVATE", "PUBLIC"]),
  maxBaseFeeWei: z.string().optional(),
  maxPriorityFeeWei: z.string().optional(),
  referralCode: z.string().optional(),
});

export type StrategyFormValues = z.infer<typeof strategySchema>;

const stepFields: Array<Array<keyof StrategyFormValues>> = [
  ["direction", "baseAsset", "quoteAsset", "amountPerPeriod", "displayCurrency"],
  ["frequency", "startDate", "startTime", "endDate"],
  [
    "slippageBps",
    "priceCapUsd",
    "priceFloorUsd",
    "twapWindowSeconds",
    "maxPriceDeviationBps",
    "venue",
    "mevMode",
    "maxBaseFeeWei",
    "maxPriorityFeeWei",
  ],
  [],
];

const steps = [
  {
    title: "Direction & Amount",
    description: "Choose what you want to automate and size each DCA cycle",
  },
  {
    title: "Cadence & Schedule",
    description: "Define when executions should happen and optional end date",
  },
  {
    title: "Guards & Routing",
    description: "Configure slippage, price protections, gas caps, and venues",
  },
  {
    title: "Review",
    description: "Confirm the settings before signing the position transaction",
  },
];

export function StrategyWizard() {
  const [step, setStep] = useState(0);
  const {
    register,
    handleSubmit,
    formState: { errors },
    trigger,
    getValues,
    watch,
  } = useForm<StrategyFormValues>({
    resolver: zodResolver(strategySchema),
    mode: "onBlur",
    defaultValues: {
      direction: "BUY",
      baseAsset: "WBTC",
      quoteAsset: "USDC",
      amountPerPeriod: "100",
      displayCurrency: "USD",
      frequency: Frequency.WEEKLY,
      startDate: new Date().toISOString().slice(0, 10),
      startTime: "09:00",
      slippageBps: PROTOCOL_CONSTANTS.defaultSlippageBps,
      twapWindowSeconds: PROTOCOL_CONSTANTS.defaultTwapWindowSeconds,
      maxPriceDeviationBps: PROTOCOL_CONSTANTS.defaultMaxPriceDeviationBps,
      venue: Venue.AUTO,
      mevMode: "PRIVATE",
    },
  });

  const direction = watch("direction");
  const frequency = watch("frequency");

  const onSubmit = handleSubmit((values) => {
    // Placeholder submit handler; integrate with contract write mutation later
    console.table(values);
  });

  const goNext = async () => {
    const fields = stepFields[step];
    if (fields.length > 0) {
      const valid = await trigger(fields);
      if (!valid) {
        return;
      }
    }
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const goBack = () => setStep((prev) => Math.max(prev - 1, 0));
  const progress = ((step + 1) / steps.length) * 100;

  const renderError = (key: keyof StrategyFormValues) =>
    errors[key] ? (
      <p className="text-destructive text-xs mt-1">{errors[key]?.message as string}</p>
    ) : null;

  return (
    <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Strategy Wizard</h2>
          <p className="text-muted-foreground text-sm">{steps[step].description}</p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          Step {step + 1} of {steps.length}
        </span>
      </div>

      <div className="mt-4 h-2 w-full rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <form className="mt-6 space-y-6" onSubmit={onSubmit}>
        {step === 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-muted-foreground">Direction</legend>
              <div className="flex gap-3">
                {(
                  [
                    { label: "Buy BTC", value: "BUY" },
                    { label: "Sell BTC", value: "SELL" },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center justify-center rounded-lg border p-3 text-sm",
                      watch("direction") === option.value && "border-primary bg-primary/5"
                    )}
                  >
                    <input
                      type="radio"
                      value={option.value}
                      {...register("direction")}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {renderError("direction")}
            </fieldset>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Amount per period</label>
              <input
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                placeholder="100"
                {...register("amountPerPeriod")}
              />
              {renderError("amountPerPeriod")}
              <div className="flex gap-3 text-xs text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="USD"
                    {...register("displayCurrency")}
                    className="h-3 w-3"
                  />
                  USD equivalent
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="TOKEN"
                    {...register("displayCurrency")}
                    className="h-3 w-3"
                  />
                  Token amount
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Base asset</label>
              <select
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("baseAsset")}
              >
                {SUPPORTED_BASE_ASSETS.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Quote asset</label>
              <select
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("quoteAsset")}
              >
                {SUPPORTED_QUOTE_ASSETS.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Cadence</label>
              <select
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("frequency", { valueAsNumber: true })}
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {FREQUENCY_OPTIONS.find((item) => item.value === frequency)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Start date</label>
              <input
                type="date"
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("startDate")}
              />
              {renderError("startDate")}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Start time (UTC)</label>
              <input
                type="time"
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("startTime")}
              />
              {renderError("startTime")}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">End date (optional)</label>
              <input
                type="date"
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("endDate")}
              />
              {renderError("endDate")}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Slippage tolerance (bps)</label>
              <input
                type="number"
                min={1}
                max={PROTOCOL_CONSTANTS.maxSlippageBps}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("slippageBps", { valueAsNumber: true })}
              />
              {renderError("slippageBps")}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">TWAP window (seconds)</label>
              <input
                type="number"
                min={PROTOCOL_CONSTANTS.minTwapWindowSeconds}
                max={PROTOCOL_CONSTANTS.maxTwapWindowSeconds}
                step={300}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("twapWindowSeconds", { valueAsNumber: true })}
              />
              {renderError("twapWindowSeconds")}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Max price deviation (bps)</label>
              <input
                type="number"
                min={0}
                max={PROTOCOL_CONSTANTS.maxPriceDeviationBpsLimit}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("maxPriceDeviationBps", { valueAsNumber: true })}
              />
              {renderError("maxPriceDeviationBps")}
            </div>

            {direction === "BUY" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Price cap (USD)</label>
                <input
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                  placeholder="Optional"
                  {...register("priceCapUsd")}
                />
                {renderError("priceCapUsd")}
              </div>
            )}

            {direction === "SELL" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Price floor (USD)</label>
                <input
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                  placeholder="Optional"
                  {...register("priceFloorUsd")}
                />
                {renderError("priceFloorUsd")}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Routing venue</label>
              <select
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                {...register("venue", { valueAsNumber: true })}
              >
                {VENUE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {VENUE_OPTIONS.find((option) => option.value === watch("venue"))?.helper}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-muted-foreground">MEV protection</legend>
              <div className="grid gap-2">
                {MEV_MODES.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 text-sm",
                      watch("mevMode") === option.value && "border-primary bg-primary/5"
                    )}
                  >
                    <input
                      type="radio"
                      value={option.value}
                      {...register("mevMode")}
                      className="sr-only"
                    />
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Max base fee (wei)</label>
              <input
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                placeholder="Optional"
                {...register("maxBaseFeeWei")}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Max priority fee (wei)</label>
              <input
                className="w-full rounded-lg border border-border bg-background p-3 text-sm"
                placeholder="Optional"
                {...register("maxPriorityFeeWei")}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Review the configuration before creating the position. These settings map directly to contract inputs and guards.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold">Execution</h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Direction</dt>
                    <dd className="font-medium">{getValues().direction}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Cadence</dt>
                    <dd className="font-medium">
                      {FREQUENCY_OPTIONS.find((item) => item.value === getValues().frequency)?.label}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Per-period amount</dt>
                    <dd className="font-medium">
                      {getValues().displayCurrency === "USD"
                        ? formatUsd(Number(getValues().amountPerPeriod))
                        : `${getValues().amountPerPeriod} ${direction === "BUY" ? getValues().quoteAsset : getValues().baseAsset}`}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Venue</dt>
                    <dd className="font-medium">
                      {VENUE_OPTIONS.find((item) => item.value === getValues().venue)?.label}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold">Risk controls</h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Slippage</dt>
                    <dd className="font-medium">{getValues().slippageBps} bps</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">TWAP window</dt>
                    <dd className="font-medium">{Math.round(getValues().twapWindowSeconds / 60)} min</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Price deviation</dt>
                    <dd className="font-medium">{getValues().maxPriceDeviationBps} bps</dd>
                  </div>
                  {direction === "BUY" && getValues().priceCapUsd && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Price cap</dt>
                      <dd className="font-medium">${getValues().priceCapUsd}</dd>
                    </div>
                  )}
                  {direction === "SELL" && getValues().priceFloorUsd && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Price floor</dt>
                      <dd className="font-medium">${getValues().priceFloorUsd}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>

          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Review & Sign
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
