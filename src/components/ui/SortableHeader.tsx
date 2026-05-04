"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * Reusable column-sort hook with sessionStorage persistence per list view.
 *
 * Usage:
 * ```
 * const sort = useColumnSort("inventory.ingredients", "name", "asc");
 * const sorted = useMemo(() =>
 *   [...items].sort(compareBy(sort.key, sort.dir, getValue)),
 *   [items, sort.key, sort.dir]
 * );
 *
 * <SortableHeader columnKey="name" label="Nama" sort={sort} />
 * ```
 *
 * Storage key prefixed `mahakan-sort.<id>.v1` so future schema bumps don't
 * collide with stale state.
 */
export function useColumnSort(
  storageId: string,
  defaultKey: string,
  defaultDir: SortDir = "asc",
): {
  key: string;
  dir: SortDir;
  toggle: (key: string) => void;
} {
  const STORAGE_KEY = `mahakan-sort.${storageId}.v1`;

  const [state, setState] = useState<SortState>({
    key: defaultKey,
    dir: defaultDir,
  });

  // Hydrate from sessionStorage on mount (client only). Wrapped in useEffect
  // so SSR/initial render is deterministic.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SortState>;
      if (
        typeof parsed.key === "string" &&
        (parsed.dir === "asc" || parsed.dir === "desc")
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({ key: parsed.key, dir: parsed.dir });
      }
    } catch {
      // ignore — sessionStorage may be blocked
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(key: string) {
    setState((prev) => {
      const next: SortState =
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "asc" };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { key: state.key, dir: state.dir, toggle };
}

/**
 * Comparator factory. Pass a value extractor; returns a compare-fn for
 * `Array.prototype.sort`. Strings collated case-insensitive Indonesian-aware
 * via Intl.Collator. Numbers via subtraction. Null/undefined sorted last.
 */
const ID_COLLATOR = new Intl.Collator("id-ID", {
  numeric: true,
  sensitivity: "base",
});

export function compareBy<T>(
  dir: SortDir,
  getValue: (item: T) => string | number | null | undefined,
): (a: T, b: T) => number {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    // Null/undefined sorted last regardless of direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return sign * (av - bv);
    }
    return sign * ID_COLLATOR.compare(String(av), String(bv));
  };
}

interface SortableHeaderProps {
  /** Stable key matching the value extractor used on the data side. */
  columnKey: string;
  /** Display label rendered inside the button. */
  label: string;
  /** State + toggle callback from `useColumnSort`. */
  sort: { key: string; dir: SortDir; toggle: (key: string) => void };
  /** Optional align — defaults to "left". */
  align?: "left" | "right" | "center";
  className?: string;
}

/**
 * Clickable `<th>` cell that toggles sort direction on click. Inactive
 * columns render a faint up/down arrow pair, active column renders the
 * direction-specific arrow.
 */
export function SortableHeader({
  columnKey,
  label,
  sort,
  align = "left",
  className,
}: SortableHeaderProps) {
  const isActive = sort.key === columnKey;
  const Icon = isActive
    ? sort.dir === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  const ariaSort = isActive
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      className={cn(
        "px-4 py-2 font-medium",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
        className,
      )}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => sort.toggle(columnKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-mahakan-green-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1 rounded-sm",
          isActive ? "text-mahakan-green-700" : "text-neutral-500",
          align === "right" ? "ml-auto" : "",
        )}
        aria-label={`Sort by ${label} ${
          isActive
            ? sort.dir === "asc"
              ? "(currently ascending — click for descending)"
              : "(currently descending — click for ascending)"
            : "(unsorted — click to sort)"
        }`}
      >
        <span>{label}</span>
        <Icon
          className={cn(
            "size-3 shrink-0",
            isActive ? "opacity-100" : "opacity-50",
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}
