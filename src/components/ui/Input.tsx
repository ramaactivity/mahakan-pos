"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    leadingIcon,
    trailingSlot,
    className,
    id,
    required,
    disabled,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label
          htmlFor={inputId}
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
      <div
        className={cn(
          "flex h-10 items-center rounded-md border bg-white",
          error ? "border-danger-500" : "border-neutral-300",
          disabled && "cursor-not-allowed bg-neutral-100 opacity-60",
        )}
      >
        {leadingIcon ? (
          <div className="pl-3 text-neutral-500">{leadingIcon}</div>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full bg-transparent px-3 text-base text-neutral-900 placeholder:text-neutral-500",
            "focus:outline-none disabled:cursor-not-allowed",
            className,
          )}
          {...rest}
        />
        {trailingSlot ? (
          <div className="pr-3 text-neutral-500">{trailingSlot}</div>
        ) : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-danger-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
