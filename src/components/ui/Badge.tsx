import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type BadgeVariant =
  | "paid"
  | "voided"
  | "refunded"
  | "sold-out"
  | "signature"
  | "open-price"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  paid: "bg-success-100 text-success-500",
  voided: "bg-neutral-200 text-neutral-700",
  refunded: "bg-warning-100 text-warning-500",
  "sold-out": "bg-neutral-200 text-neutral-500",
  signature: "bg-mahakan-green-100 text-mahakan-green-700",
  "open-price": "bg-info-100 text-info-500",
  neutral: "bg-neutral-100 text-neutral-700",
  success: "bg-success-100 text-success-500",
  warning: "bg-warning-100 text-warning-500",
  danger: "bg-danger-100 text-danger-500",
  info: "bg-info-100 text-info-500",
};

export function Badge({
  variant = "neutral",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
