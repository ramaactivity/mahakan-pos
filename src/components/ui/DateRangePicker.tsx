"use client";

/**
 * Date range picker with preset shortcuts (Today / Last 7d / Last 30d / MTD /
 * Custom). Stores value as { from, to } ISO date strings ("YYYY-MM-DD").
 *
 * Used in Reports + Cash + Audit views where a from/to filter is the dominant
 * UX. Stripe Dashboard pattern: presets sidebar + manual calendar pickers.
 */

import * as Popover from "@radix-ui/react-popover";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useId, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { id as localeId } from "date-fns/locale";
import {
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  subDays,
} from "date-fns";
import "react-day-picker/dist/style.css";
import { cn } from "@/lib/utils";

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

interface DateRangePickerProps {
  label?: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  hint?: string;
  error?: string;
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Show presets sidebar — default true. */
  showPresets?: boolean;
  className?: string;
}

function isoToDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  try {
    return parseISO(iso);
  } catch {
    return undefined;
  }
}

function dateToIso(d: Date | undefined): string | null {
  if (!d) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface Preset {
  label: string;
  compute: () => DateRangeValue;
}

const PRESETS: Preset[] = [
  {
    label: "Hari ini",
    compute: () => {
      const today = dateToIso(new Date())!;
      return { from: today, to: today };
    },
  },
  {
    label: "7 hari terakhir",
    compute: () => ({
      from: dateToIso(subDays(new Date(), 6)),
      to: dateToIso(new Date()),
    }),
  },
  {
    label: "30 hari terakhir",
    compute: () => ({
      from: dateToIso(subDays(new Date(), 29)),
      to: dateToIso(new Date()),
    }),
  },
  {
    label: "Bulan berjalan",
    compute: () => ({
      from: dateToIso(startOfMonth(new Date())),
      to: dateToIso(new Date()),
    }),
  },
  {
    label: "Bulan ini (full)",
    compute: () => ({
      from: dateToIso(startOfMonth(new Date())),
      to: dateToIso(endOfMonth(new Date())),
    }),
  },
];

function formatDisplay(value: DateRangeValue): string {
  if (!value.from && !value.to) return "Pilih rentang tanggal";
  if (value.from && !value.to) {
    return format(parseISO(value.from), "d MMM yyyy", { locale: localeId });
  }
  if (value.from && value.to) {
    if (value.from === value.to) {
      return format(parseISO(value.from), "d MMM yyyy", { locale: localeId });
    }
    return `${format(parseISO(value.from), "d MMM", { locale: localeId })} – ${format(
      parseISO(value.to),
      "d MMM yyyy",
      { locale: localeId },
    )}`;
  }
  return "Pilih rentang tanggal";
}

export function DateRangePicker({
  label,
  value,
  onChange,
  hint,
  error,
  ariaLabel,
  required,
  disabled,
  size = "md",
  showPresets = true,
  className,
}: DateRangePickerProps) {
  const reactId = useId();
  const triggerId = `daterange-${reactId}`;
  const [open, setOpen] = useState(false);

  const range: DateRange | undefined =
    value.from || value.to
      ? {
          from: isoToDate(value.from),
          to: isoToDate(value.to),
        }
      : undefined;

  const describedBy = error
    ? `${triggerId}-error`
    : hint
    ? `${triggerId}-hint`
    : undefined;

  function applyPreset(p: Preset) {
    onChange(p.compute());
  }

  function clear() {
    onChange({ from: null, to: null });
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={triggerId}
          className="block text-sm font-medium text-neutral-900"
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-danger-500" aria-hidden>
              *
            </span>
          ) : null}
        </label>
      ) : null}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={triggerId}
            type="button"
            aria-label={ariaLabel ?? label}
            aria-describedby={describedBy}
            data-invalid={error ? true : undefined}
            disabled={disabled}
            className={cn(
              "inline-flex w-full items-center gap-2 rounded-md border bg-white text-left transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-60",
              size === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-sm",
              error ? "border-danger-500" : "border-neutral-300 hover:border-neutral-400",
              !value.from && !value.to && "text-neutral-500",
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-neutral-500" aria-hidden />
            <span className="flex-1 truncate text-neutral-900">
              {formatDisplay(value)}
            </span>
            {(value.from || value.to) && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus rentang"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    clear();
                  }
                }}
                className="rounded-sm p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="size-3.5" aria-hidden />
              </span>
            ) : null}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-[60] flex rounded-md border border-neutral-200 bg-white shadow-lg"
          >
            {showPresets ? (
              <div className="flex w-44 flex-col gap-0.5 border-r border-neutral-200 p-2">
                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Preset
                </p>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="rounded-sm px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-mahakan-green-100 hover:text-mahakan-green-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clear}
                  className="mt-1 rounded-sm px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                >
                  Bersihkan
                </button>
              </div>
            ) : null}
            <div className="p-3">
              <DayPicker
                animate
                mode="range"
                locale={localeId}
                selected={range}
                onSelect={(r) => {
                  onChange({
                    from: dateToIso(r?.from),
                    to: dateToIso(r?.to),
                  });
                }}
                numberOfMonths={2}
                showOutsideDays
                classNames={{
                  months: "flex gap-4",
                  month: "space-y-2",
                  caption: "flex items-center justify-between px-1 py-1",
                  caption_label: "text-sm font-semibold text-neutral-900",
                  nav: "flex items-center gap-1",
                  button_previous: "rounded-md p-1 hover:bg-neutral-100 text-neutral-600",
                  button_next: "rounded-md p-1 hover:bg-neutral-100 text-neutral-600",
                  month_grid: "border-collapse w-full",
                  weekdays: "flex",
                  weekday: "w-8 text-center text-[11px] font-medium text-neutral-500",
                  week: "flex w-full",
                  day: "size-8 p-0 text-center text-sm",
                  day_button:
                    "size-8 rounded-md text-neutral-900 hover:bg-mahakan-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  today: "font-semibold text-mahakan-green-700",
                  selected: "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:hover:bg-mahakan-green-800",
                  range_start: "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:rounded-r-none",
                  range_end: "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:rounded-l-none",
                  range_middle: "[&_button]:bg-mahakan-green-100 [&_button]:text-mahakan-green-900 [&_button]:rounded-none",
                  outside: "text-neutral-400 opacity-60",
                  disabled: "text-neutral-400 opacity-40",
                }}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? (
        <p id={`${triggerId}-error`} role="alert" className="text-sm text-danger-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${triggerId}-hint`} className="text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
