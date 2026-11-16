"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Skeleton } from "./Misc";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** API ordering field; makes the header clickable. */
  sortKey?: string;
  hideBelow?: "sm" | "md" | "lg";
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  ordering?: string;
  onOrderingChange?: (ordering: string) => void;
  empty?: ReactNode;
  skeletonRows?: number;
  rowLabel?: (row: T) => string;
};

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T>({ columns, rows, rowKey, loading, onRowClick, ordering, onOrderingChange, empty, skeletonRows = 6, rowLabel }: Props<T>) {
  const toggleSort = (sortKey: string) => onOrderingChange?.(ordering === sortKey ? `-${sortKey}` : sortKey);
  const showEmpty = !loading && rows && rows.length === 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-subtle">
            {columns.map((column) => {
              const active = column.sortKey && ordering?.replace("-", "") === column.sortKey;
              return (
                <th key={column.key} scope="col" aria-sort={active ? (ordering?.startsWith("-") ? "descending" : "ascending") : undefined} className={cn("px-4 py-3 font-medium", column.hideBelow && HIDE[column.hideBelow], column.className)}>
                  {column.sortKey && onOrderingChange ? (
                    <button onClick={() => toggleSort(column.sortKey!)} className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground">
                      {column.header}
                      {active ? ordering?.startsWith("-") ? <ArrowDown className="size-3 text-primary" /> : <ArrowUp className="size-3 text-primary" /> : <ChevronsUpDown className="size-3 opacity-50" />}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, index) => (
              <tr key={index} className="border-b border-border/60">
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3.5", column.hideBelow && HIDE[column.hideBelow])}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows?.map((row, index) => (
              <motion.tr
                key={rowKey(row)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 24, delay: Math.min(index, 12) * 0.03 }}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), onRowClick(row)) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? rowLabel?.(row) : undefined}
                className={cn("border-b border-border/60 transition-colors last:border-0", onRowClick && "cursor-pointer hover:bg-primary-soft/60 focus-visible:bg-primary-soft/60")}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3.5 align-middle", column.hideBelow && HIDE[column.hideBelow], column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </motion.tr>
            ))}
        </tbody>
      </table>
      {showEmpty && empty}
    </div>
  );
}
