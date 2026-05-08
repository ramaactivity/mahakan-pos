"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "outline";

export type ButtonSize = "sm" | "md" | "lg" | "xl";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-mahakan-green-700 text-white hover:bg-mahakan-green-800 active:bg-mahakan-green-900",
  secondary:
    "bg-mahakan-green-100 text-mahakan-green-900 hover:bg-mahakan-green-200 active:bg-mahakan-green-300",
  ghost: "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200",
  destructive:
    "bg-danger-500 text-white hover:bg-danger-600 active:bg-danger-600",
  outline:
    "border border-neutral-300 text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200",
};

// `sm` bumps to h-11 on touch devices so row-action icons in admin tables
// hit the WCAG 2.5.5 / Apple HIG / Material 44px tap-target floor on Galaxy
// A7 Lite. Desktop stays h-8 for dense table density.
const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 touch:h-11 text-sm px-3 touch:px-3.5 rounded-md gap-1.5",
  md: "h-10 touch:h-11 text-base px-4 rounded-md gap-2",
  lg: "h-12 text-base px-5 rounded-lg gap-2",
  xl: "min-h-[60px] text-lg px-6 py-4 rounded-lg gap-2.5 font-semibold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      className,
      children,
      type,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {loading ? <Spinner className="size-4" /> : null}
        {children}
      </button>
    );
  },
);
