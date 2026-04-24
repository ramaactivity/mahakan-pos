"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  disabled = false,
  className,
  "aria-label": ariaLabel = "Jumlah",
}: QuantityStepperProps) {
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

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
        className="flex h-9 w-9 items-center justify-center rounded-l-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <div
        className="flex h-9 min-w-[2.5rem] items-center justify-center border-x border-neutral-200 px-2 font-mono text-sm font-medium tabular-nums text-neutral-900"
        aria-live="polite"
      >
        {value}
      </div>
      <button
        type="button"
        aria-label="Tambah"
        onClick={() => canInc && onChange(value + 1)}
        disabled={!canInc}
        className="flex h-9 w-9 items-center justify-center rounded-r-md text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
