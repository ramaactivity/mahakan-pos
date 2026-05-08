"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuantityStepperSize = "md" | "lg";

interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  /** `md` = 36px (default), `lg` = 44px (touch-comfortable, POS cart). */
  size?: QuantityStepperSize;
  "aria-label"?: string;
}

const sizeClasses = {
  md: { btn: "h-9 w-9", value: "h-9 min-w-[2.5rem] text-sm" },
  lg: { btn: "h-11 w-11", value: "h-11 min-w-[3rem] text-base" },
} as const;

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  disabled = false,
  className,
  size = "md",
  "aria-label": ariaLabel = "Jumlah",
}: QuantityStepperProps) {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;
  const { btn, value: valueClass } = sizeClasses[size];

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-md border border-neutral-200 bg-white",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Kurangi"
        onClick={() => canDec && onChange(value - 1)}
        disabled={!canDec}
        className={cn(
          "flex items-center justify-center rounded-l-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
          btn,
        )}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <div
        className={cn(
          "flex items-center justify-center border-x border-neutral-200 px-2 font-mono font-medium tabular-nums text-neutral-900",
          valueClass,
        )}
        aria-live="polite"
      >
        {value}
      </div>
      <button
        type="button"
        aria-label="Tambah"
        onClick={() => canInc && onChange(value + 1)}
        disabled={!canInc}
        className={cn(
          "flex items-center justify-center rounded-r-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
          btn,
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
