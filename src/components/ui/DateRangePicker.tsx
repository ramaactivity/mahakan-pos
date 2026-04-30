"use client";

/**
 * Date range picker with preset shortcuts (Today / Last 7d / Last 30d / MTD /
 * Custom). Stores value as { from, to } ISO date strings ("YYYY-MM-DD").
 *
 * Used in Reports + Cash + Audit views where a from/to filter is the dominant
 * UX. Stripe Dashboard pattern: presets sidebar + manual calendar pickers.
 */

import * as Popover from "@radix-ui/react-popover";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { id as localeId } from "date-fns/locale";
import {
  addMonths,
  addYears,
  endOfMonth,
  format,
  parseISO,
  setMonth,
  setYear,
  startOfMonth,
  subDays,
  subMonths,
  subYears,
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
  const [displayMonth, setDisplayMonth] = useState<Date>(() =>
    startOfMonth(value.from ? parseISO(value.from) : new Date()),
  );

  const startMonth = useMemo(
    () => startOfMonth(subYears(new Date(), 10)),
    [],
  );
  const endMonth = useMemo(
    () => startOfMonth(addYears(new Date(), 5)),
    [],
  );
  const yearList = useMemo(() => {
    const arr: number[] = [];
    for (let y = endMonth.getFullYear(); y >= startMonth.getFullYear(); y--) {
      arr.push(y);
    }
    return arr;
  }, [startMonth, endMonth]);

  function navMonth(delta: number) {
    setDisplayMonth((m) =>
      delta > 0 ? addMonths(m, delta) : subMonths(m, -delta),
    );
  }

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
              {/* Custom month + year nav (NO native dropdowns) */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => navMonth(-1)}
                  aria-label="Bulan sebelumnya"
                  className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <div className="flex flex-1 items-center justify-center gap-1.5">
                  <RangeMonthDropdown
                    value={displayMonth.getMonth()}
                    onChange={(m) => setDisplayMonth((d) => setMonth(d, m))}
                  />
                  <RangeYearDropdown
                    value={displayMonth.getFullYear()}
                    years={yearList}
                    onChange={(y) => setDisplayMonth((d) => setYear(d, y))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => navMonth(1)}
                  aria-label="Bulan berikutnya"
                  className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
              <DayPicker
                mode="range"
                locale={localeId}
                selected={range}
                month={displayMonth}
                onMonthChange={setDisplayMonth}
                onSelect={(r) => {
                  onChange({
                    from: dateToIso(r?.from),
                    to: dateToIso(r?.to),
                  });
                }}
                startMonth={startMonth}
                endMonth={endMonth}
                numberOfMonths={2}
                showOutsideDays
                classNames={{
                  months: "flex gap-4",
                  month: "space-y-2",
                  month_caption: "hidden",
                  caption_label: "hidden",
                  nav: "hidden",
                  month_grid: "border-collapse w-full",
                  weekdays: "flex",
                  weekday: "w-8 text-center text-[11px] font-medium text-neutral-500",
                  week: "flex w-full",
                  day: "size-8 p-0 text-center text-sm",
                  day_button:
                    "size-8 rounded-md text-neutral-900 hover:bg-mahakan-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  today: "font-semibold text-mahakan-green-700",
                  selected:
                    "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:hover:bg-mahakan-green-800",
                  range_start:
                    "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:rounded-r-none",
                  range_end:
                    "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:rounded-l-none",
                  range_middle:
                    "[&_button]:bg-mahakan-green-100 [&_button]:text-mahakan-green-900 [&_button]:rounded-none",
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

const MONTH_LABELS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function RangeMonthDropdown({
  value,
  onChange,
}: {
  value: number;
  onChange: (m: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-900 hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
          aria-label={`Bulan ${MONTH_LABELS[value]}`}
        >
          {MONTH_LABELS[value]}
          <ChevronDown className="size-3.5 text-neutral-500" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={4}
          collisionPadding={12}
          className="z-[70] max-h-64 w-32 overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
        >
          <ul role="listbox" aria-label="Pilih bulan">
            {MONTH_LABELS.map((label, idx) => (
              <li key={label} role="option" aria-selected={idx === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(idx);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-mahakan-green-100 focus:outline-none focus-visible:bg-mahakan-green-100",
                    idx === value
                      ? "bg-mahakan-green-50 font-semibold text-mahakan-green-900"
                      : "text-neutral-900",
                  )}
                >
                  <span>{label}</span>
                  {idx === value ? (
                    <Check
                      className="size-3.5 text-mahakan-green-700"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RangeYearDropdown({
  value,
  years,
  onChange,
}: {
  value: number;
  years: number[];
  onChange: (y: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-900 hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
          aria-label={`Tahun ${value}`}
        >
          {value}
          <ChevronDown className="size-3.5 text-neutral-500" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={4}
          collisionPadding={12}
          className="z-[70] max-h-64 w-24 overflow-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
        >
          <ul role="listbox" aria-label="Pilih tahun">
            {years.map((y) => (
              <li key={y} role="option" aria-selected={y === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(y);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm font-mono tabular-nums hover:bg-mahakan-green-100 focus:outline-none focus-visible:bg-mahakan-green-100",
                    y === value
                      ? "bg-mahakan-green-50 font-semibold text-mahakan-green-900"
                      : "text-neutral-900",
                  )}
                >
                  <span>{y}</span>
                  {y === value ? (
                    <Check
                      className="size-3.5 text-mahakan-green-700"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
