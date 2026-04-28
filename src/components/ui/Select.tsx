"use client";

/**
 * Single-select component built on Radix Select.
 *
 * Use this for low-cardinality (≤10 options) where a native dropdown is fine
 * but we want consistent styling. For high-cardinality (e.g. 140 ingredients),
 * use Combobox instead — searchable + keyboard-first.
 */

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Disabled options stay visible but unclickable. */
  disabled?: boolean;
  /** Optional secondary text shown after the label in muted color. */
  hint?: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps extends Omit<ComponentPropsWithoutRef<typeof RadixSelect.Root>, "onValueChange"> {
  /** Field label rendered above the trigger. */
  label?: string;
  /** Either flat options OR grouped sections (mutually exclusive). */
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  /** Hint text below the trigger. */
  hint?: string;
  /** Error text below the trigger (replaces hint). */
  error?: string;
  /** ARIA label for the trigger when no visible label is set. */
  ariaLabel?: string;
  required?: boolean;
  /** Visual size — md is default (h-10 to match Input). sm for dense rows. */
  size?: "sm" | "md";
  className?: string;
  /** Async/loading state — disables trigger and shows muted placeholder. */
  loading?: boolean;
  onValueChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    label,
    options,
    groups,
    placeholder = "— pilih —",
    hint,
    error,
    ariaLabel,
    required,
    size = "md",
    className,
    loading,
    disabled,
    name,
    value,
    defaultValue,
    onValueChange,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const triggerId = `select-${reactId}`;
  const describedBy = error
    ? `${triggerId}-error`
    : hint
    ? `${triggerId}-hint`
    : undefined;

  const trigger = (
    <RadixSelect.Trigger
      ref={ref}
      id={triggerId}
      aria-label={ariaLabel ?? label}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      disabled={disabled || loading}
      className={cn(
        "inline-flex w-full items-center justify-between gap-2 rounded-md border bg-white text-left text-neutral-900 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-60",
        "data-[placeholder]:text-neutral-500",
        size === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-sm",
        error ? "border-danger-500" : "border-neutral-300 hover:border-neutral-400",
        className,
      )}
    >
      <span className="truncate">
        <RadixSelect.Value placeholder={placeholder} />
      </span>
      <RadixSelect.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-neutral-500" aria-hidden />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );

  const renderOption = (opt: SelectOption) => (
    <RadixSelect.Item
      key={opt.value}
      value={opt.value}
      disabled={opt.disabled}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-neutral-900 outline-none select-none",
        "data-[highlighted]:bg-mahakan-green-100 data-[highlighted]:text-mahakan-green-900",
        "data-[state=checked]:font-medium",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      )}
    >
      <RadixSelect.ItemIndicator className="absolute left-2 inline-flex">
        <Check className="size-3.5" aria-hidden />
      </RadixSelect.ItemIndicator>
      <span className="flex-1 truncate pl-5">
        <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
      </span>
      {opt.hint ? (
        <span className="ml-auto shrink-0 text-xs text-neutral-500">{opt.hint}</span>
      ) : null}
    </RadixSelect.Item>
  );

  return (
    <div className="space-y-1.5">
      {label ? (
        <label
          htmlFor={triggerId}
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
      <RadixSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled || loading}
        {...rest}
      >
        {trigger}
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="z-[60] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
          >
            <RadixSelect.Viewport className="max-h-[18rem] p-1">
              {options?.map(renderOption)}
              {groups?.map((g, gi) => (
                <RadixSelect.Group key={`${g.label}-${gi}`}>
                  {g.label ? (
                    <RadixSelect.Label className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      {g.label}
                    </RadixSelect.Label>
                  ) : null}
                  {g.options.map(renderOption)}
                </RadixSelect.Group>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {error ? (
        <p id={`${triggerId}-error`} role="alert" className="text-sm text-danger-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${triggerId}-hint`} className="text-sm text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
