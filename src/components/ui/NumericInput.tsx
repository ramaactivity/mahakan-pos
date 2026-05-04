"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Calculator, Delete, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumericInputProps {
  label?: string;
  hint?: string;
  error?: string;
  /** String value (kept as string so leading "0" / empty preserved). */
  value: string;
  onChange: (next: string) => void;
  /** Placeholder shown when value is empty. */
  placeholder?: string;
  /** Render with thousand-separator (id-ID) di display. Stored value tetap
   * string angka mentah tanpa separator. Default: true. */
  formatThousands?: boolean;
  /** Prefix glyph di display (mis. "Rp"). Display only — bukan bagian value. */
  prefix?: string;
  /** Maximum digit count (panjang string). Default 12. */
  maxLength?: number;
  /** Allow decimal entry dengan separator "." atau ","? Default false (integer). */
  allowDecimal?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Aria-label kalau tidak pakai `label`. */
  ariaLabel?: string;
  /** Render slot di kanan input (mis. Rupiah/unit suffix). */
  trailingSlot?: ReactNode;
  className?: string;
}

/**
 * NumericInput (Sesi P) — replace `<input inputMode="numeric">` di POS supaya
 * keyboard Android native tidak pop up + crop area POS. Render read-only
 * display button yang on-tap buka custom keypad inline. Pattern reused di
 * payment cash, open shift, close shift, petty cash, open price, dst.
 *
 * Behavior:
 *   - Tap display → expand inline keypad (no native keyboard)
 *   - Big touch targets (h-14) supaya tablet-friendly
 *   - Vibrate on tap (10ms) kalau supported
 *   - Auto-format thousand separator id-ID di display only (value mentah)
 */
export const NumericInput = forwardRef<HTMLDivElement, NumericInputProps>(
  function NumericInput(
    {
      label,
      hint,
      error,
      value,
      onChange,
      placeholder = "0",
      formatThousands = true,
      prefix,
      maxLength = 12,
      allowDecimal = false,
      disabled = false,
      required,
      ariaLabel,
      trailingSlot,
      className,
    },
    ref,
  ) {
    const reactId = useId();
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    // Close keypad when disabled toggled on
    useEffect(() => {
      /* eslint-disable react-hooks/set-state-in-effect */
      if (disabled && open) setOpen(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }, [disabled, open]);

    // Phase 3.3 (sesi AB) — click outside the wrapper closes keypad. Owner
    // pakai tablet, gampang accidentally tap di area lain saat keypad open
    // dan ekspektasi keypad tutup. Wrapper covers both input button + keypad
    // popup, jadi clicks di dalam keypad tetap hit (digit append, etc).
    useEffect(() => {
      if (!open) return;
      function onMouseDown(e: MouseEvent) {
        const target = e.target as Node;
        if (wrapperRef.current && !wrapperRef.current.contains(target)) {
          setOpen(false);
        }
      }
      document.addEventListener("mousedown", onMouseDown);
      return () => document.removeEventListener("mousedown", onMouseDown);
    }, [open]);

    function append(d: string) {
      if (disabled) return;
      if (value.length >= maxLength) return;
      if (d === "." || d === ",") {
        if (!allowDecimal) return;
        // Only one decimal separator allowed.
        if (value.includes(".")) return;
        // Normalize "," → "."
        d = ".";
        // If empty, prefix "0" so we get "0.5"
        if (value === "") {
          onChange("0.");
          haptic();
          return;
        }
      }
      onChange(value + d);
      haptic();
    }
    function backspace() {
      if (disabled) return;
      onChange(value.slice(0, -1));
      haptic();
    }
    function clear() {
      if (disabled) return;
      onChange("");
      haptic();
    }

    const display = formatDisplay(value, formatThousands);

    function setRefs(el: HTMLDivElement | null) {
      wrapperRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    }

    return (
      <div ref={setRefs} className={cn("space-y-1.5", className)}>
        {label ? (
          <label
            htmlFor={reactId}
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
        <button
          type="button"
          id={reactId}
          aria-label={ariaLabel ?? label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-12 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-right text-base font-mono tabular-nums text-neutral-900 shadow-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2",
            error
              ? "border-danger-500 focus-visible:ring-danger-500/40"
              : "border-neutral-300 focus-visible:ring-mahakan-green-700/40 focus-visible:border-mahakan-green-700",
            disabled
              ? "cursor-not-allowed bg-neutral-100 text-neutral-500"
              : "hover:border-neutral-400",
            open && "border-mahakan-green-700 ring-2 ring-mahakan-green-700/40",
          )}
        >
          <span className="flex items-center gap-2 text-neutral-400">
            <Calculator className="size-4" aria-hidden />
            {prefix ? (
              <span className="text-sm font-medium text-neutral-500">
                {prefix}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "flex-1 truncate",
              value === "" ? "text-neutral-400" : "text-neutral-900",
            )}
          >
            {value === "" ? placeholder : display}
          </span>
          {trailingSlot ? (
            <span className="text-xs text-neutral-500">{trailingSlot}</span>
          ) : null}
        </button>

        {open && !disabled ? (
          <div
            role="dialog"
            aria-label="Keypad numerik"
            className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 shadow-sm"
          >
            <div className="grid grid-cols-3 gap-1.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Key key={d} label={d} onPress={() => append(d)} />
              ))}
              <Key
                label={allowDecimal ? "." : "C"}
                onPress={allowDecimal ? () => append(".") : clear}
                variant="action"
              >
                {allowDecimal ? "." : "C"}
              </Key>
              <Key label="0" onPress={() => append("0")} />
              <Key
                label="Hapus"
                onPress={backspace}
                variant="action"
                ariaLabel="Hapus satu digit"
              >
                <Delete className="size-5" aria-hidden />
              </Key>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup keyboard numerik"
              className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-mahakan-green-700 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mahakan-green-900 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:ring-offset-2"
            >
              <X className="size-4" aria-hidden /> Tutup Keyboard
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="text-xs text-danger-500" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs text-neutral-500">{hint}</p>
        ) : null}
      </div>
    );
  },
);

function haptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(8);
  }
}

function formatDisplay(value: string, withThousands: boolean): string {
  if (value === "") return "";
  if (!withThousands) return value;
  const [intPart, decPart] = value.split(".");
  const intFormatted = intPart
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    : "0";
  return decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted;
}

interface KeyProps {
  label: string;
  onPress: () => void;
  variant?: "digit" | "action";
  ariaLabel?: string;
  children?: ReactNode;
}

function Key({
  label,
  onPress,
  variant = "digit",
  ariaLabel,
  children,
}: KeyProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={ariaLabel ?? label}
      className={cn(
        "flex h-11 items-center justify-center rounded-md border text-lg font-semibold tabular-nums shadow-sm transition-all active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40",
        variant === "digit"
          ? "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50"
          : "border-neutral-200 bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
      )}
    >
      {children ?? label}
    </button>
  );
}
