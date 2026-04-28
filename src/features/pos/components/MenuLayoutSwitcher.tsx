"use client";

import { Grid2x2, Grid3x3, LayoutGrid, List } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type MenuLayoutMode = "compact" | "normal" | "comfy" | "list";

const STORAGE_KEY = "mahakan-pos.menu-layout";

interface ModeMeta {
  label: string;
  hint: string;
  Icon: typeof LayoutGrid;
}

const MODES: Record<MenuLayoutMode, ModeMeta> = {
  compact: {
    label: "Compact",
    hint: "Tile kecil — banyak item terlihat sekaligus (rush hour)",
    Icon: Grid3x3,
  },
  normal: {
    label: "Normal",
    hint: "Default — keseimbangan jumlah & ukuran tile",
    Icon: Grid2x2,
  },
  comfy: {
    label: "Comfy",
    hint: "Tile besar — touch target nyaman untuk staff baru",
    Icon: LayoutGrid,
  },
  list: {
    label: "List",
    hint: "Horizontal — nama panjang & deskripsi terlihat penuh",
    Icon: List,
  },
};

const ORDER: MenuLayoutMode[] = ["compact", "normal", "comfy", "list"];

/**
 * Hook with localStorage persistence so each tablet device remembers its
 * preferred menu layout. Per-device (not per-user) — staff swap on the
 * same tablet keep the layout the manager set.
 */
export function useMenuLayout(): [MenuLayoutMode, (m: MenuLayoutMode) => void] {
  const [mode, setMode] = useState<MenuLayoutMode>("normal");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (
        stored === "compact" ||
        stored === "normal" ||
        stored === "comfy" ||
        stored === "list"
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMode(stored);
      }
    } catch {
      // localStorage might be blocked; default to "normal"
    }
  }, []);

  function update(next: MenuLayoutMode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  return [mode, update];
}

interface MenuLayoutSwitcherProps {
  mode: MenuLayoutMode;
  onChange: (mode: MenuLayoutMode) => void;
  className?: string;
}

/**
 * Segmented icon control — 4 layout modes. Linear/Notion-style: compact
 * icon-only buttons in a single rounded row.
 */
export function MenuLayoutSwitcher({
  mode,
  onChange,
  className,
}: MenuLayoutSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Layout tampilan menu"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-neutral-300 bg-white p-0.5",
        className,
      )}
    >
      {ORDER.map((m) => {
        const meta = MODES[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={meta.label}
            title={`${meta.label} — ${meta.hint}`}
            onClick={() => onChange(m)}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              active
                ? "bg-mahakan-green-100 text-mahakan-green-900"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
            )}
          >
            <meta.Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** CSS grid class for each mode — used by CashierMiddle. */
export const LAYOUT_GRID_CLASS: Record<MenuLayoutMode, string> = {
  compact:
    "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
  normal:
    "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  comfy:
    "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
  list: "flex flex-col gap-2",
};
