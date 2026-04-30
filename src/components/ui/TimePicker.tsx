"use client";

/**
 * Single-time picker — popover with hour + minute step columns.
 *
 * Stores value as "HH:MM" string (24-hour). Drop-in replacement for
 * `<input type="time">` callsites; matches the time format that
 * Postgres `time` columns emit.
 *
 * Sesi F (2026-04-30) — built per Owner standard "no native pickers".
 */

import * as Popover from "@radix-ui/react-popover";
import { Clock as ClockIcon, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TimePickerProps {
  label?: string;
  /** "HH:MM" string or null. Seconds (HH:MM:SS) accepted for parsing
   * but truncated on emit. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Step between selectable minute values. Default 5. Set 1 for full
   * granularity. */
  minuteStep?: number;
  placeholder?: string;
  hint?: string;
  error?: string;
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  size?: "sm" | "md";
  className?: string;
}

function parseHHMM(raw: string | null): { h: number; m: number } | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function formatHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimePicker({
  label,
  value,
  onChange,
  minuteStep = 5,
  placeholder = "Pilih jam",
  hint,
  error,
  ariaLabel,
  required,
  disabled,
  clearable = true,
  size = "md",
  className,
}: TimePickerProps) {
  const reactId = useId();
  const triggerId = `timepicker-${reactId}`;
  const [open, setOpen] = useState(false);

  const parsed = parseHHMM(value);
  const display = parsed ? formatHHMM(parsed.h, parsed.m) : null;

  const describedBy = error
    ? `${triggerId}-error`
    : hint
      ? `${triggerId}-hint`
      : undefined;

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(
    () =>
      Array.from(
        { length: Math.ceil(60 / minuteStep) },
        (_, i) => i * minuteStep,
      ),
    [minuteStep],
  );

  // Track refs to scroll-into-view current value when popover opens.
  const hourColRef = useRef<HTMLDivElement>(null);
  const minuteColRef = useRef<HTMLDivElement>(null);

  function setHour(h: number) {
    const baseM = parsed?.m ?? 0;
    onChange(formatHHMM(h, baseM));
  }

  function setMinute(m: number) {
    const baseH = parsed?.h ?? 0;
    onChange(formatHHMM(baseH, m));
    // After picking minute, dismiss — feels like a complete selection.
    setOpen(false);
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
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            // After mount, scroll the active hour/minute into view.
            requestAnimationFrame(() => {
              const hCol = hourColRef.current;
              const mCol = minuteColRef.current;
              if (hCol) {
                const sel = hCol.querySelector<HTMLElement>(
                  '[data-active="true"]',
                );
                sel?.scrollIntoView({ block: "center" });
              }
              if (mCol) {
                const sel = mCol.querySelector<HTMLElement>(
                  '[data-active="true"]',
                );
                sel?.scrollIntoView({ block: "center" });
              }
            });
          }
        }}
      >
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
              !display && "text-neutral-500",
            )}
          >
            <ClockIcon
              className="size-4 shrink-0 text-neutral-500"
              aria-hidden
            />
            <span className="flex-1 truncate font-mono text-neutral-900">
              {display ?? placeholder}
            </span>
            {display && clearable && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus jam"
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
            className="z-[60] rounded-md border border-neutral-200 bg-white shadow-lg"
          >
            <div className="flex">
              <div
                ref={hourColRef}
                className="max-h-56 w-16 overflow-y-auto border-r border-neutral-200"
                role="listbox"
                aria-label="Jam"
              >
                {hours.map((h) => {
                  const active = parsed?.h === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active || undefined}
                      onClick={() => setHour(h)}
                      className={cn(
                        "block w-full px-3 py-1.5 text-center font-mono text-sm transition-colors",
                        active
                          ? "bg-mahakan-green-700 text-white"
                          : "text-neutral-900 hover:bg-neutral-100",
                      )}
                    >
                      {String(h).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
              <div
                ref={minuteColRef}
                className="max-h-56 w-16 overflow-y-auto"
                role="listbox"
                aria-label="Menit"
              >
                {minutes.map((m) => {
                  const active = parsed?.m === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active || undefined}
                      onClick={() => setMinute(m)}
                      className={cn(
                        "block w-full px-3 py-1.5 text-center font-mono text-sm transition-colors",
                        active
                          ? "bg-mahakan-green-700 text-white"
                          : "text-neutral-900 hover:bg-neutral-100",
                      )}
                    >
                      {String(m).padStart(2, "0")}
                    </button>
                  );
                })}
              </div>
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
        <p
          id={`${triggerId}-hint`}
          className="text-sm text-neutral-500"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
