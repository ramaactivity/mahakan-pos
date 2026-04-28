"use client";

/**
 * Single-date picker — react-day-picker calendar inside a Radix Popover.
 *
 * Stores value as ISO date string ("YYYY-MM-DD") to match existing date-input
 * call sites, so migration is drop-in.
 */

import * as Popover from "@radix-ui/react-popover";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useId, useState } from "react";
import { DayPicker } from "react-day-picker";
import { id as localeId } from "date-fns/locale";
import { format, parseISO } from "date-fns";
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
  /** Display format — default "EEEE, d MMM yyyy" (Indonesian). */
  displayFormat?: string;
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
  // Local-date ISO (YYYY-MM-DD) without TZ shift — matches `<input type="date">`.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  className,
}: DatePickerProps) {
  const reactId = useId();
  const triggerId = `datepicker-${reactId}`;
  const [open, setOpen] = useState(false);

  const selectedDate = isoToDate(value);
  const minD = isoToDate(minDate ?? null);
  const maxD = isoToDate(maxDate ?? null);

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
            className="z-[60] rounded-md border border-neutral-200 bg-white p-3 shadow-lg"
          >
            <DayPicker
              animate
              mode="single"
              locale={localeId}
              selected={selectedDate}
              onSelect={(d) => {
                onChange(dateToIso(d));
                if (d) setOpen(false);
              }}
              startMonth={minD}
              endMonth={maxD}
              disabled={[
                ...(minD ? [{ before: minD }] : []),
                ...(maxD ? [{ after: maxD }] : []),
              ]}
              showOutsideDays
              classNames={{
                months: "flex gap-3",
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
                outside: "text-neutral-400 opacity-60",
                disabled: "text-neutral-400 opacity-40 [&_button]:cursor-not-allowed [&_button]:hover:bg-transparent",
              }}
            />
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
