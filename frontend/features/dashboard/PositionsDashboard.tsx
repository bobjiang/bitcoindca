"use client";

import { useMemo } from "react";
import {
  ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { usePositions } from "./hooks/usePositions";
import { ExecutionLogRow } from "./data/mock";
import { formatDate, formatUsd, shortenAddress } from "@/lib/utils";
import { VENUE_OPTIONS } from "@/lib/protocol";

const columnHelper = createColumnHelper<ExecutionLogRow>();

const columns: ColumnDef<ExecutionLogRow, any>[] = [
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
];

export function PositionsDashboard() {
  const { data, isPending } = usePositions();

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
              {isPending ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Fetching demo data…
                  </td>
                </tr>
              ) : table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No executions yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Operational health</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Oracle freshness</span>
              <span
                className={
                  data?.health.oracleFresh
                    ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700"
                    : "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
                }
              >
                {data?.health.oracleFresh ? "Fresh" : "Stale"}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Paused positions</span>
              <span className="font-medium">{data?.health.pausedPositions ?? 0}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-muted-foreground">Circuit breaker</span>
              <span
                className={
                  data?.health.circuitBreakerActive
                    ? "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
                    : "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700"
                }
              >
                {data?.health.circuitBreakerActive ? "Active" : "Clear"}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Daily throughput</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Executed today</dt>
              <dd className="font-medium">{formatUsd(data?.health.globalVolumeUsdToday ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Global cap</dt>
              <dd className="font-medium">{formatUsd(data?.health.globalVolumeCapUsd ?? 0)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
