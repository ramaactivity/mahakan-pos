"use client";

/**
 * Searchable single-select powered by cmdk inside a Radix Popover.
 *
 * Use for high-cardinality lists (50+ options). For ≤10, use Select. The
 * popover anchors to the trigger and matches its width, so it sits naturally
 * inside form rows. Supports grouped sections (e.g. "Bahan Baku" / "Preparations").
 */

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary text — rendered muted, included in search index. */
  hint?: string;
  /** Optional keywords boost search match (e.g. synonyms, aliases). */
  keywords?: string[];
  disabled?: boolean;
}

export interface ComboboxGroup {
  label: string;
  options: ComboboxOption[];
}

interface ComboboxProps {
  label?: string;
  /** Either flat options OR groups (mutually exclusive). */
  options?: ComboboxOption[];
  groups?: ComboboxGroup[];
  /** Currently selected value (controlled). */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Search input placeholder text. */
  searchPlaceholder?: string;
  /** Empty-state text when search has no matches. */
  emptyText?: string;
  hint?: string;
  error?: string;
  ariaLabel?: string;
  required?: boolean;
  disabled?: boolean;
  /** Loading the option list — trigger is disabled with placeholder. */
  loading?: boolean;
  /** sm = h-9 (dense form rows), md = h-10 (matches Input). */
  size?: "sm" | "md";
  /** Optional renderer for the selected pill — useful to show unit/cost. */
  renderSelected?: (option: ComboboxOption) => ReactNode;
  /** If true, the trigger reserves no space for label (use inside dense rows). */
  hideLabel?: boolean;
  /** Show X button on trigger to clear the value. Default false. */
  clearable?: boolean;
  className?: string;
}

export function Combobox({
  label,
  options,
  groups,
  value,
  onChange,
  placeholder = "— pilih —",
  searchPlaceholder = "Cari…",
  emptyText = "Tidak ada hasil",
  hint,
  error,
  ariaLabel,
  required,
  disabled,
  loading,
  size = "md",
  renderSelected,
  hideLabel,
  clearable = false,
  className,
}: ComboboxProps) {
  const reactId = useId();
  const triggerId = `combobox-${reactId}`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Build a flat lookup map so the trigger can render the selected label
  // without scanning groups every render.
  const allOptions = useMemo(() => {
    if (groups) return groups.flatMap((g) => g.options);
    return options ?? [];
  }, [options, groups]);

  const selected = value ? allOptions.find((o) => o.value === value) ?? null : null;

  const describedBy = error
    ? `${triggerId}-error`
    : hint
    ? `${triggerId}-hint`
    : undefined;

  function pick(v: string) {
    onChange(v === value ? null : v);
    setOpen(false);
    setSearch("");
  }

  const renderItem = (opt: ComboboxOption) => (
    <Command.Item
      key={opt.value}
      value={`${opt.label} ${opt.hint ?? ""} ${(opt.keywords ?? []).join(" ")}`}
      keywords={opt.keywords}
      disabled={opt.disabled}
      onSelect={() => !opt.disabled && pick(opt.value)}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-neutral-900 outline-none",
        "data-[selected=true]:bg-mahakan-green-100 data-[selected=true]:text-mahakan-green-900",
        "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
      )}
    >
      <span className="inline-flex w-4 shrink-0 justify-center text-mahakan-green-700">
        {opt.value === value ? <Check className="size-3.5" aria-hidden /> : null}
      </span>
      <span className="flex-1 truncate">{opt.label}</span>
      {opt.hint ? (
        <span className="ml-auto shrink-0 text-xs text-neutral-500">{opt.hint}</span>
      ) : null}
    </Command.Item>
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && !hideLabel ? (
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
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={triggerId}
            type="button"
            aria-label={ariaLabel ?? label}
            aria-describedby={describedBy}
            aria-expanded={open}
            data-invalid={error ? true : undefined}
            disabled={disabled || loading}
            className={cn(
              "inline-flex w-full items-center justify-between gap-2 rounded-md border bg-white text-left transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-60",
              size === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-sm",
              error ? "border-danger-500" : "border-neutral-300 hover:border-neutral-400",
              !selected && "text-neutral-500",
            )}
          >
            <span className="flex-1 truncate">
              {selected
                ? renderSelected
                  ? renderSelected(selected)
                  : selected.label
                : loading
                ? "Memuat…"
                : placeholder}
            </span>
            {clearable && selected && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Bersihkan pilihan"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
                className="rounded-sm p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X className="size-3.5" aria-hidden />
              </span>
            ) : null}
            <ChevronDown className="size-4 shrink-0 text-neutral-500" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-[60] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
          >
            <Command className="flex flex-col" shouldFilter={true}>
              <div className="flex items-center gap-2 border-b border-neutral-200 px-2.5">
                <Search className="size-4 shrink-0 text-neutral-500" aria-hidden />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder={searchPlaceholder}
                  className="h-10 w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none"
                />
              </div>
              <Command.List className="max-h-[18rem] overflow-y-auto p-1">
                <Command.Empty className="py-6 text-center text-sm text-neutral-500">
                  {emptyText}
                </Command.Empty>
                {options?.map(renderItem)}
                {groups?.map((g, gi) => (
                  <Command.Group
                    key={`${g.label}-${gi}`}
                    heading={g.label || undefined}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-neutral-500"
                  >
                    {g.options.map(renderItem)}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
}
