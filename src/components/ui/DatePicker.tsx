"use client";

/**
 * Single-date picker — react-day-picker calendar inside a Radix Popover with
 * month + year dropdowns, manual text input (DD/MM/YYYY), and Today button.
 *
 * Stores value as ISO date string ("YYYY-MM-DD") to match existing date-input
 * call sites, so migration is drop-in.
 */

import * as Popover from "@radix-ui/react-popover";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import { id as localeId } from "date-fns/locale";
import {
  addYears,
  format,
  isValid,
  parse,
  parseISO,
  startOfMonth,
  subYears,
} from "date-fns";
import "react-day-picker/dist/style.css";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  label?: string;
  /** ISO date string "YYYY-MM-DD" or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Optional min/max bound as ISO date strings. */
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Allow clearing back to null — shows X button when set. */
  clearable?: boolean;
  size?: "sm" | "md";
  /** Display format — default "d MMM yyyy" (Indonesian). */
  displayFormat?: string;
  /** Wider year range for DOB-style fields. Default 100 years back to 10 years forward. */
  yearRange?: { fromYearsBack: number; toYearsForward: number };
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

/** Auto-format typed input: digits only → "DD/MM/YYYY". Allows partial. */
function formatTyped(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}/${mm}`;
  return `${dd}/${mm}/${yyyy}`;
}

/** Parse "DD/MM/YYYY" → ISO. Returns null if invalid or incomplete. */
function parseTyped(typed: string): string | null {
  if (typed.length !== 10) return null;
  const parsed = parse(typed, "dd/MM/yyyy", new Date());
  if (!isValid(parsed)) return null;
  return dateToIso(parsed);
}

export function DatePicker({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Pilih tanggal",
  hint,
  error,
  ariaLabel,
  required,
  disabled,
  clearable = true,
  size = "md",
  displayFormat = "d MMM yyyy",
  yearRange = { fromYearsBack: 100, toYearsForward: 10 },
  className,
}: DatePickerProps) {
  const reactId = useId();
  const triggerId = `datepicker-${reactId}`;
  const [open, setOpen] = useState(false);
  // Override typed-text only while user is actively editing the manual input.
  // null = derive display from `value`. string = user is typing (don't sync from prop).
  const [typedOverride, setTypedOverride] = useState<string | null>(null);
  const [typedError, setTypedError] = useState<string | null>(null);

  const selectedDate = isoToDate(value);
  const minD = isoToDate(minDate ?? null);
  const maxD = isoToDate(maxDate ?? null);

  // Year range for the dropdown caption — bounded by min/max if provided.
  const { startMonth, endMonth } = useMemo(() => {
    const today = new Date();
    const defaultStart = startOfMonth(subYears(today, yearRange.fromYearsBack));
    const defaultEnd = startOfMonth(addYears(today, yearRange.toYearsForward));
    return {
      startMonth:
        minD && minD > defaultStart ? startOfMonth(minD) : defaultStart,
      endMonth: maxD && maxD < defaultEnd ? startOfMonth(maxD) : defaultEnd,
    };
  }, [minD, maxD, yearRange.fromYearsBack, yearRange.toYearsForward]);

  const typed =
    typedOverride !== null
      ? typedOverride
      : selectedDate
        ? format(selectedDate, "dd/MM/yyyy")
        : "";

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Reset typed-override when closing — next open derives from current value.
    if (!next) {
      setTypedOverride(null);
      setTypedError(null);
    }
  }

  function handleTypedChange(raw: string) {
    const formatted = formatTyped(raw);
    setTypedOverride(formatted);
    setTypedError(null);
    if (formatted.length === 10) {
      const iso = parseTyped(formatted);
      if (!iso) {
        setTypedError("Tanggal tidak valid");
        return;
      }
      if (minDate && iso < minDate) {
        setTypedError("Sebelum tanggal minimum");
        return;
      }
      if (maxDate && iso > maxDate) {
        setTypedError("Setelah tanggal maksimum");
        return;
      }
      onChange(iso);
    } else if (formatted.length === 0) {
      onChange(null);
    }
  }

  function applyToday() {
    const today = new Date();
    const iso = dateToIso(today);
    if (!iso) return;
    if (minDate && iso < minDate) return;
    if (maxDate && iso > maxDate) return;
    onChange(iso);
    handleOpenChange(false);
  }

  const describedBy = error
    ? `${triggerId}-error`
    : hint
      ? `${triggerId}-hint`
      : undefined;

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
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
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
              error
                ? "border-danger-500"
                : "border-neutral-300 hover:border-neutral-400",
              !selectedDate && "text-neutral-500",
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-neutral-500" aria-hidden />
            <span className="flex-1 truncate text-neutral-900">
              {selectedDate
                ? format(selectedDate, displayFormat, { locale: localeId })
                : placeholder}
            </span>
            {selectedDate && clearable && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus tanggal"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(null);
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
            className="z-[60] w-[20rem] rounded-md border border-neutral-200 bg-white p-3 shadow-lg"
          >
            {/* Manual text input */}
            <div className="mb-2 space-y-1">
              <input
                type="text"
                inputMode="numeric"
                value={typed}
                onChange={(e) => handleTypedChange(e.target.value)}
                placeholder="DD/MM/YYYY"
                aria-label="Ketik tanggal manual"
                className={cn(
                  "w-full rounded-md border bg-white px-3 py-2 text-sm font-mono tabular-nums",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  typedError
                    ? "border-danger-500"
                    : "border-neutral-300 focus:border-mahakan-green-700",
                )}
              />
              {typedError ? (
                <p className="text-xs text-danger-500">{typedError}</p>
              ) : (
                <p className="text-xs text-neutral-500">
                  Ketik tanggal langsung atau pilih di kalender
                </p>
              )}
            </div>

            <DayPicker
              mode="single"
              locale={localeId}
              selected={selectedDate}
              defaultMonth={selectedDate ?? new Date()}
              onSelect={(d) => {
                onChange(dateToIso(d));
                if (d) setOpen(false);
              }}
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              disabled={[
                ...(minD ? [{ before: minD }] : []),
                ...(maxD ? [{ after: maxD }] : []),
              ]}
              showOutsideDays
              classNames={{
                months: "flex gap-3",
                month: "space-y-2",
                month_caption: "flex items-center justify-center gap-2 px-1 py-1",
                caption_label: "hidden",
                dropdowns: "flex items-center gap-2",
                dropdown:
                  "rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm font-medium text-neutral-900 hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                dropdown_root: "relative",
                nav: "flex items-center justify-between mb-1",
                button_previous:
                  "rounded-md p-1.5 hover:bg-neutral-100 text-neutral-600 inline-flex items-center justify-center",
                button_next:
                  "rounded-md p-1.5 hover:bg-neutral-100 text-neutral-600 inline-flex items-center justify-center",
                month_grid: "border-collapse w-full",
                weekdays: "flex",
                weekday: "w-9 text-center text-[11px] font-medium text-neutral-500",
                week: "flex w-full",
                day: "size-9 p-0 text-center text-sm",
                day_button:
                  "size-9 rounded-md text-neutral-900 hover:bg-mahakan-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                today: "font-semibold text-mahakan-green-700",
                selected:
                  "[&_button]:bg-mahakan-green-700 [&_button]:text-white [&_button]:hover:bg-mahakan-green-800",
                outside: "text-neutral-400 opacity-60",
                disabled:
                  "text-neutral-400 opacity-40 [&_button]:cursor-not-allowed [&_button]:hover:bg-transparent",
              }}
            />

            {/* Footer actions */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
              <button
                type="button"
                onClick={applyToday}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-mahakan-green-700 hover:bg-mahakan-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              >
                Hari Ini
              </button>
              {clearable && selectedDate ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    handleOpenChange(false);
                  }}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                >
                  Hapus
                </button>
              ) : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? (
        <p
          id={`${triggerId}-error`}
          role="alert"
          className="text-sm text-danger-500"
        >
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
