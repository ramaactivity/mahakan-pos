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
import { useFinePointer } from "@/lib/use-fine-pointer";
import { formatDisplay, sanitizeTyped } from "@/lib/numeric-format";

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
 * Sesi AE-13: tambah keyboard support untuk desktop + polish popup.
 * Trigger button menerima onKeyDown — digits, Backspace, Delete, decimal
 * separator, Escape (close popup).
 *
 * Sesi AE-203 (this rev): di perangkat ber-mouse (`pointer: fine` — laptop,
 * MacBook, PC) keypad on-screen TIDAK dirender sama sekali; field jadi
 * `<input>` biasa yang diketik pakai numpad fisik (caret, select-all, paste
 * semua jalan). Di tablet/HP (`pointer: coarse`) perilaku lama utuh: tombol
 * display + popup keypad, karena keyboard Android nutup separuh layar.
 * Nilai yang disimpan tetap string angka mentah di kedua mode.
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
    /** Laptop/PC (mouse atau trackpad) → keypad on-screen dimatikan. */
    const finePointer = useFinePointer();
    /** Saat diketik, tampilkan angka mentah (tanpa titik ribuan) supaya
     *  caret tidak lompat; format ribuan balik lagi begitu blur. */
    const [focused, setFocused] = useState(false);

    // Close keypad when disabled toggled on, atau saat mouse ke-colok
    // di tengah sesi (mode berubah coarse → fine).
    useEffect(() => {
      /* eslint-disable react-hooks/set-state-in-effect */
      if ((disabled || finePointer) && open) setOpen(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }, [disabled, finePointer, open]);

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
        if (value === "" || value === "0") {
          onChange("0.");
          haptic();
          return;
        }
      }
      /* Sesi AE-140 — treat leading "0" sebagai placeholder. Default
       * value "Rp0" sebelumnya bikin user input "1" → "01" → display
       * "Rp01" atau worse "Rp0.100.000" untuk multi-digit input.
       * Fix: replace "0" dengan digit pertama (kecuali user input "0"
       * lagi yang berarti memang mau "0", atau decimal handled di atas). */
      if (value === "0" && d !== "0") {
        onChange(d);
        haptic();
        return;
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

    /** Desktop — ketikan keyboard fisik dibersihkan jadi angka mentah. */
    function handleTyped(e: React.ChangeEvent<HTMLInputElement>) {
      if (disabled) return;
      onChange(sanitizeTyped(e.target.value, allowDecimal, maxLength));
    }

    const display = formatDisplay(value, formatThousands);

    /** Kerangka field — dipakai bareng tombol (touch) & input (desktop). */
    const shellClass = cn(
      "flex h-12 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-right text-base font-mono tabular-nums text-neutral-900 shadow-sm transition-colors",
      error ? "border-danger-500" : "border-neutral-300",
      disabled
        ? "cursor-not-allowed bg-neutral-100 text-neutral-500"
        : "hover:border-neutral-400",
    );

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
        {finePointer ? (
          /* Laptop/PC — field ketik biasa, tanpa keypad on-screen. */
          <div
            className={cn(
              shellClass,
              error
                ? "focus-within:ring-2 focus-within:ring-danger-500/40"
                : "focus-within:border-mahakan-green-700 focus-within:ring-2 focus-within:ring-mahakan-green-700/40",
            )}
          >
            {prefix ? (
              <span className="text-sm font-medium text-neutral-500">
                {prefix}
              </span>
            ) : null}
            <input
              id={reactId}
              type="text"
              autoComplete="off"
              inputMode={allowDecimal ? "decimal" : "numeric"}
              aria-label={ariaLabel ?? label}
              disabled={disabled}
              required={required}
              placeholder={placeholder}
              /* Fokus → angka mentah (caret stabil). Blur → format ribuan. */
              value={focused ? value : display}
              onChange={handleTyped}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                /* Enter JANGAN submit form — perilaku lama (tombol
                 * type="button") tidak pernah submit, dan field ini sering
                 * dipakai di form keuangan yang tak boleh ke-post nyasar. */
                if (e.key === "Enter") e.preventDefault();
              }}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-right font-mono tabular-nums outline-none placeholder:text-neutral-400",
                disabled && "cursor-not-allowed",
              )}
            />
            {trailingSlot ? (
              <span className="text-xs text-neutral-500">{trailingSlot}</span>
            ) : null}
          </div>
        ) : (
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
              shellClass,
              "focus-visible:outline-none focus-visible:ring-2",
              error
                ? "focus-visible:ring-danger-500/40"
                : "focus-visible:border-mahakan-green-700 focus-visible:ring-mahakan-green-700/40",
              open &&
                "border-mahakan-green-700 ring-2 ring-mahakan-green-700/40",
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
        )}

        {open && !disabled && !finePointer ? (
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
