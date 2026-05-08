"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Column descriptor for ResponsiveTable.
 *
 * Same `render(row)` callback drives both the desktop `<table>` cell and the
 * tablet card row, so each column appears identical on both layouts. Use
 * `primary` to lift one column into the card title row, and `desktopOnly` to
 * hide low-priority columns on tablet (they remain visible on desktop).
 */
export type ResponsiveColumn<T> = {
  key: string;
  label: string;
  render: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** Hide on tablet card layout (visible only on pointer:fine desktop). */
  desktopOnly?: boolean;
  /** Pin to card title row. Use for the row's primary identifier. */
  primary?: boolean;
  /** Render value monospace (price, codes, IDs). */
  mono?: boolean;
  /** Width hint for desktop table column (Tailwind class, e.g. `"w-32"`). */
  width?: string;
  /** Extra cell className applied on desktop. */
  className?: string;
};

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Rendered when `rows.length === 0`. Pass `<EmptyCard ... />`. */
  emptyState?: ReactNode;
  /** Whole-row click target. Adds hover/active styling. */
  onRowClick?: (row: T) => void;
  /** Action node at end of row (desktop column / card top-right). */
  rowActions?: (row: T) => ReactNode;
  /** Footer summary content. Auto-wrapped: desktop = full-width `<tfoot>`
   *  row, tablet = plain card-style `<div>` below the cards. Pass plain
   *  content (e.g. `<div>Total: ...</div>`), NOT `<tr>` / `<td>`. */
  footer?: ReactNode;
  /** Caption shown above desktop table only. */
  caption?: string;
  className?: string;
};

/**
 * Pair-of-views responsive table:
 *
 *   pointer:fine (desktop)  → native `<table>` with sortable headers
 *   pointer:coarse (tablet) → vertical stack of cards, primary-column promoted
 *                             to card head, remaining columns rendered as
 *                             label/value pairs in a 2-col `<dl>`
 *
 * Both views render the SAME `column.render(row)` function, so per-column
 * formatting (badges, money, dates) stays consistent. Card view never
 * horizontal-scrolls on Galaxy A7 Lite (1340×800), even at 9 columns.
 *
 * Usage:
 *
 *   <ResponsiveTable
 *     columns={[
 *       { key: "name", label: "Karyawan", primary: true, render: r => r.name },
 *       { key: "role", label: "Role", render: r => <Badge>{r.role}</Badge> },
 *       { key: "salary", label: "Gaji", align: "right", mono: true,
 *         render: r => formatRupiah(r.salary) },
 *     ]}
 *     rows={employees}
 *     rowKey={(r) => r.id}
 *     emptyState={<EmptyCard title="Belum ada karyawan" />}
 *     rowActions={(r) => <Button onClick={() => edit(r)}>Edit</Button>}
 *   />
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  emptyState,
  onRowClick,
  rowActions,
  footer,
  caption,
  className,
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  const primaryCol = columns.find((c) => c.primary);

  return (
    <>
      {/* DESKTOP — pointer:fine */}
      <div className={cn("hidden pointer:block", className)}>
        {caption ? (
          <p className="px-1 pb-2 text-xs text-neutral-500">{caption}</p>
        ) : null}
        <div className="overflow-x-clip rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "px-3 py-2 text-left font-semibold",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.width,
                    )}
                  >
                    {c.label}
                  </th>
                ))}
                {rowActions ? <th className="w-20 px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-neutral-100 last:border-b-0",
                    onRowClick && "cursor-pointer hover:bg-neutral-50",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-3 align-top",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.mono && "font-mono",
                        c.className,
                      )}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="px-3 py-3 text-right align-top">
                      {rowActions(row)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {footer ? (
              <tfoot className="border-t-2 border-neutral-300 bg-neutral-50">
                <tr>
                  <td
                    className="px-3 py-2"
                    colSpan={columns.length + (rowActions ? 1 : 0)}
                  >
                    {footer}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {/* TABLET / TOUCH — pointer:coarse */}
      <div className={cn("flex flex-col gap-2 pointer:hidden", className)}>
        {rows.map((row, i) => {
          const visibleCols = columns.filter(
            (c) => !c.desktopOnly && c !== primaryCol,
          );
          return (
            <article
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "rounded-lg border border-neutral-200 bg-white p-3 shadow-sm",
                onRowClick && "cursor-pointer active:bg-neutral-50",
              )}
            >
              {primaryCol || rowActions ? (
                <div className="mb-2 flex items-start justify-between gap-2">
                  {primaryCol ? (
                    <div
                      className={cn(
                        "min-w-0 flex-1 text-base font-semibold text-neutral-900",
                        primaryCol.mono && "font-mono",
                      )}
                    >
                      {primaryCol.render(row, i)}
                    </div>
                  ) : null}
                  {rowActions ? (
                    <div
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {visibleCols.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  {visibleCols.map((c) => (
                    <div
                      key={c.key}
                      className={cn(
                        "flex flex-col",
                        c.align === "right" && "items-end text-right",
                        c.align === "center" && "items-center text-center",
                      )}
                    >
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                        {c.label}
                      </dt>
                      <dd
                        className={cn(
                          "text-neutral-900",
                          c.mono && "font-mono",
                        )}
                      >
                        {c.render(row, i)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </article>
          );
        })}
        {footer ? (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
            {footer}
          </div>
        ) : null}
      </div>
    </>
  );
}
