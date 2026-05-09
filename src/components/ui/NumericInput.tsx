"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Calculator, Delete } from "lucide-react";
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
 * NumericInput — numeric field dengan dual-mode input.
 *
 * Sesi P (origin): button display + popup numpad untuk POS tablet, bypass
 * native keyboard yang nutup layar di Android.
 *
 * Sesi AE-13 (this rev): tambah keyboard support untuk desktop + polish
 * popup. Trigger button menerima onKeyDown — digits, Backspace, Delete,
 * decimal separator, Escape (close popup). Desktop user yang tab/click ke
 * field bisa langsung ngetik tanpa harus klik tombol numpad. Tablet user
 * tetap bisa tap → popup numpad untuk big-button input.
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
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    // Close keypad when disabled toggled on.
    useEffect(() => {
      /* eslint-disable react-hooks/set-state-in-effect */
      if (disabled && open) setOpen(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }, [disabled, open]);

    // Click outside closes popup. Wrapper covers both input button + popup
    // jadi clicks di dalam keypad tetap hit (digit append, etc).
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
        if (value.includes(".")) return;
        d = ".";
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

    function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
      if (disabled) return;
      // Digits 0-9 — append directly. Works whether popup open or not, jadi
      // desktop user bisa tab ke field + langsung ngetik.
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        append(e.key);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        clear();
        return;
      }
      if (allowDecimal && (e.key === "." || e.key === ",")) {
        e.preventDefault();
        append(".");
        return;
      }
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        // Toggle popup (Space + Enter = native button activation).
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Tab") {
        // Let Tab navigate naturally; close popup so it doesn't trap focus.
        if (open) setOpen(false);
        return;
      }
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
          ref={triggerRef}
          type="button"
          id={reactId}
          aria-label={ariaLabel ?? label}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={handleKeyDown}
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
            className="space-y-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-md"
          >
            <div className="grid grid-cols-3 gap-1.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Key key={d} label={d} onPress={() => append(d)} />
              ))}
              {allowDecimal ? (
                <Key
                  label="."
                  onPress={() => append(".")}
                  variant="action"
                />
              ) : (
                <Key label="C" onPress={clear} variant="action" />
              )}
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
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <p className="hidden text-[10px] text-neutral-500 pointer:inline">
                Desktop: ketik langsung pakai keyboard
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup keypad"
                className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40"
              >
                Selesai
              </button>
            </div>
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
  // Sesi AE-2 — onPointerDown bukan onClick. Mobile/tablet tap onClick fires
  // setelah pointerup + ~200ms double-tap detection delay. onPointerDown
  // fires saat finger pertama nyentuh layar = no perceived latency.
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
      aria-label={ariaLabel ?? label}
      style={{ touchAction: "manipulation" }}
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
