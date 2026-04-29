"use client";

import { useCallback } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * 3×4 numeric keypad for PIN entry. Big tap targets for tablet.
 *
 * Keys: 1-9 / C (clear) / 0 / ⌫ (backspace)
 * Haptic: vibrates 10ms on tap if supported.
 */
export function PinPad({
  value,
  onChange,
  maxLength = 6,
  disabled = false,
  className,
}: PinPadProps) {
  const handleDigit = useCallback(
    (digit: string) => {
      if (disabled) return;
      if (value.length >= maxLength) return;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(10);
      }
      onChange(value + digit);
    },
    [value, maxLength, onChange, disabled],
  );

  const handleClear = useCallback(() => {
    if (disabled) return;
    onChange("");
  }, [onChange, disabled]);

  const handleBackspace = useCallback(() => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }, [value, onChange, disabled]);

  return (
    <div
      className={cn("grid grid-cols-3 gap-2 sm:gap-3", className)}
      role="group"
      aria-label="Keypad PIN"
    >
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <PinKey key={d} label={d} onPress={() => handleDigit(d)} disabled={disabled} />
      ))}
      <PinKey
        label="Hapus"
        onPress={handleClear}
        disabled={disabled}
        variant="action"
      >
        C
      </PinKey>
      <PinKey label="0" onPress={() => handleDigit("0")} disabled={disabled} />
      <PinKey
        label="Hapus satu"
        onPress={handleBackspace}
        disabled={disabled}
        variant="action"
      >
        <Delete className="size-6" aria-hidden />
      </PinKey>
    </div>
  );
}

function PinKey({
  label,
  onPress,
  disabled,
  variant = "digit",
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "digit" | "action";
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        "flex h-12 sm:h-14 md:h-16 items-center justify-center rounded-xl text-xl sm:text-2xl font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        "active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "digit"
          ? "bg-white border border-neutral-200 text-neutral-900 hover:bg-neutral-100 font-mono"
          : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
      )}
    >
      {children ?? label}
    </button>
  );
}
