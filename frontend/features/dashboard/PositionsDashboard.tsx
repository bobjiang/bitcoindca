"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { usePositions } from "./hooks/usePositions";
import { useExecutePosition } from "./hooks/useExecutePosition";
import { ExecutionLogRow } from "./data/mock";
import { formatDate, formatUsd, shortenAddress } from "@/lib/utils";
import { VENUE_OPTIONS } from "@/lib/protocol";

const columnHelper = createColumnHelper<ExecutionLogRow>();
const EXECUTION_STORAGE_KEY = "dca:execution:private-mode";
const ENV_DEFAULT_PRIVATE = process.env.NEXT_PUBLIC_EXEC_PRIVATE === "true";

function truncateHash(hash: string): string {
  if (hash.length <= 10) {
    return hash;
  }
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

interface ExecutionModeState {
  isPrivate: boolean;
  setIsPrivate?: (next: boolean) => void;
  isLocked: boolean;
  ready: boolean;
}

function useExecutionModeState(): ExecutionModeState {
  const interactive = typeof window !== "undefined" && process.env.NODE_ENV !== "production";
  const [value, setValue] = useState<boolean>(ENV_DEFAULT_PRIVATE);
  const [ready, setReady] = useState<boolean>(!interactive);

  useEffect(() => {
    if (!interactive) {
      return;
    }

    const stored = window.localStorage.getItem(EXECUTION_STORAGE_KEY);
    if (stored !== null) {
      setValue(stored === "true");
    }
    setReady(true);
  }, [interactive]);

  const update = useCallback(
    (next: boolean) => {
      if (!interactive) {
        return;
      }
      setValue(next);
      window.localStorage.setItem(EXECUTION_STORAGE_KEY, String(next));
    },
    [interactive]
  );

  return {
    isPrivate: interactive ? value : ENV_DEFAULT_PRIVATE,
    setIsPrivate: interactive ? update : undefined,
    isLocked: !interactive,
    ready,
  };
}

function ExecutionModeCard({
  isPrivate,
  setIsPrivate,
  isLocked,
  ready,
}: ExecutionModeState) {
  const toggleDisabled = !setIsPrivate;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground tracking-wide">MEV protection</p>
          <h3 className="text-sm font-semibold">Flashbots Protect</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLocked
              ? "Production builds honour the environment default for executor routing."
              : "Toggle private execution for local demos. Preference persists in local storage."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Public</span>
          {ready ? (
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              disabled={toggleDisabled}
              onClick={() => setIsPrivate?.(!isPrivate)}
              className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                isPrivate ? "bg-emerald-500" : "bg-muted"
              } ${toggleDisabled ? "opacity-60" : "hover:bg-primary/80"}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition ${
                  isPrivate ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          ) : (
            <span className="block h-6 w-12 animate-pulse rounded-full bg-muted" />
          )}
          <span className="text-xs font-medium text-muted-foreground">Private</span>
        </div>
      </div>
    </div>
  );
}

function ExecuteActionButton({
  positionId,
  isPrivate,
}: {
  positionId: number;
  isPrivate: boolean;
}) {
  const { mutateAsync, isPending } = useExecutePosition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setFeedback(null);
    try {
      const result = await mutateAsync({ positionId, usePrivate: isPrivate });
      setFeedback(`${result.mode === "private" ? "Private" : "Public"} tx ${truncateHash(result.hash)}`);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }, [mutateAsync, positionId, isPrivate]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Submitting…" : "Execute"}
      </button>
      {feedback ? <span className="text-[11px] text-muted-foreground">{feedback}</span> : null}
    </div>
  );
}

export function PositionsDashboard() {
  const { data, isPending } = usePositions();
  const executionMode = useExecutionModeState();

  const columns = useMemo<ColumnDef<ExecutionLogRow, unknown>[]>(
    () => [
      columnHelper.accessor("timestamp", {
        header: "Timestamp",
        cell: (info) => formatDate(info.getValue()),
      }),
      columnHelper.accessor("positionId", {
        header: "Position",
        cell: (info) => `#${info.getValue()}`,
      }),
      columnHelper.accessor("venue", {
        header: "Venue",
        cell: (info) => VENUE_OPTIONS.find((option) => option.value === info.getValue())?.label ?? "-",
      }),
      columnHelper.accessor("notionalUsd", {
        header: "Notional",
        cell: (info) => formatUsd(info.getValue()),
      }),
      columnHelper.accessor("fillsBase", {
        header: "Filled",
        cell: (info) => `${info.getValue().toFixed(4)} ${info.row.original.baseAsset}`,
      }),
      columnHelper.accessor("priceUsd", {
        header: "Price",
        cell: (info) => formatUsd(info.getValue()),
      }),
      columnHelper.accessor("priceImpactBps", {
        header: "Impact",
        cell: (info) => `${info.getValue()} bps`,
      }),
      columnHelper.accessor("keeper", {
        header: "Keeper",
        cell: (info) => shortenAddress(info.getValue(), 4),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <span
            className={
              info.getValue() === "Filled"
                ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700"
                : "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
            }
          >
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "Action",
        cell: (info) => (
          <ExecuteActionButton
            positionId={info.row.original.positionId}
            isPrivate={executionMode.isPrivate}
          />
        ),
      }),
    ],
    [executionMode.isPrivate]
  );

  const table = useReactTable({
    data: data?.executions ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const summary = useMemo(() => {
    if (!data) {
      return {
        active: 0,
        nextRunAt: null as number | null,
        volumeUsd: 0,
        feesUsd: 0,
      };
    }

    const active = data.positions.filter((position) => position.status === "Active").length;
    const nextRunAt = data.positions
      .filter((position) => position.status !== "Paused")
      .map((position) => position.nextRunAt)
      .sort((a, b) => a - b)[0];
    const volumeUsd = data.positions.reduce(
      (total, position) => total + position.amountPerPeriodUsd * position.periodsExecuted,
      0
    );
    const feesUsd = data.positions.reduce((total, position) => total + position.totalFeesPaidUsd, 0);

    return {
      active,
      nextRunAt: nextRunAt ?? null,
      volumeUsd,
      feesUsd,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Active positions</p>
          <p className="mt-2 text-2xl font-semibold">
            {isPending ? <span className="block h-6 w-12 animate-pulse rounded bg-muted" /> : summary.active}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Next scheduled run</p>
          <p className="mt-2 text-sm font-medium">
            {isPending ? (
              <span className="block h-4 w-32 animate-pulse rounded bg-muted" />
            ) : summary.nextRunAt ? (
              formatDate(summary.nextRunAt)
            ) : (
              "No upcoming runs"
            )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Executed volume (lifetime)</p>
          <p className="mt-2 text-sm font-semibold">
            {isPending ? (
              <span className="block h-4 w-24 animate-pulse rounded bg-muted" />
            ) : (
              formatUsd(summary.volumeUsd)
            )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Protocol fees paid</p>
          <p className="mt-2 text-sm font-semibold">
            {isPending ? (
              <span className="block h-4 w-20 animate-pulse rounded bg-muted" />
            ) : (
              formatUsd(summary.feesUsd)
            )}
          </p>
        </div>
        <div className="md:col-span-4">
          <ExecutionModeCard {...executionMode} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Execution log</h3>
            <p className="text-xs text-muted-foreground">
              Recent keeper activity aggregated across venues. Replace with subgraph query.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-left text-sm">
            <thead className="bg-muted/50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-3 py-2 font-medium text-muted-foreground">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
