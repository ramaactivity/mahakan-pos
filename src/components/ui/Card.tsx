import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type CardVariant = "default" | "interactive" | "flat" | "emphasis";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  default: "bg-white border border-neutral-200 shadow-sm",
  interactive:
    "bg-white border border-neutral-200 shadow-sm hover:shadow-md hover:border-neutral-300 transition-shadow cursor-pointer",
  flat: "bg-white border border-neutral-200",
  emphasis: "bg-mahakan-green-50 border border-mahakan-green-100",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("rounded-xl p-6", variantStyles[variant], className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 space-y-1", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-lg font-semibold text-neutral-900 leading-tight",
        className,
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-neutral-500", className)} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center justify-end gap-2 border-t border-neutral-200 pt-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
