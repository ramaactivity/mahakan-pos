"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-97 — Tabs primitive (F1 improvement).
 *
 * Replaces ad-hoc `<button role="tab">` di 16 file dengan satu komponen
 * yang implement proper ARIA + keyboard nav:
 *   - role="tablist" + aria-label
 *   - role="tab" + aria-selected + aria-controls + id
 *   - role="tabpanel" + aria-labelledby + tabIndex
 *   - keyboard: ArrowLeft/Right, Home, End (per WAI-ARIA APG)
 *
 * Usage:
 *
 *   <Tabs value={tab} onChange={setTab} ariaLabel="Inventory tabs">
 *     <TabList>
 *       <Tab value="ingredients">Bahan</Tab>
 *       <Tab value="movements">Pergerakan</Tab>
 *     </TabList>
 *     <TabPanel value="ingredients">
 *       <IngredientsList />
 *     </TabPanel>
 *     <TabPanel value="movements">
 *       <MovementsList />
 *     </TabPanel>
 *   </Tabs>
 *
 * Visual style match yang lama (border-bottom underline ala Mahakan green)
 * supaya migration tidak ada UI regression.
 */

interface TabsContextValue {
  value: string;
  onChange: (next: string) => void;
  baseId: string;
  registerTab: (value: string) => void;
  registeredTabs: string[];
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be inside <Tabs>`);
  }
  return ctx;
}

export interface TabsProps {
  value: string;
  onChange: (next: string) => void;
  /** aria-label untuk tablist (mis. "Inventory tabs"). */
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  value,
  onChange,
  ariaLabel: _ariaLabel,
  children,
  className,
}: TabsProps) {
  const baseId = useId();
  const [registeredTabs, setRegisteredTabs] = useState<string[]>([]);

  const registerTab = useCallback((tabValue: string) => {
    setRegisteredTabs((prev) =>
      prev.includes(tabValue) ? prev : [...prev, tabValue],
    );
  }, []);

  return (
    <TabsContext.Provider
      value={{ value, onChange, baseId, registerTab, registeredTabs }}
    >
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  /** aria-label override. Kalau tidak set, ambil dari parent Tabs.ariaLabel. */
  ariaLabel?: string;
  children: ReactNode;
}

export function TabList({
  className,
  ariaLabel,
  children,
  ...rest
}: TabListProps) {
  const { value, onChange, registeredTabs } = useTabsContext("TabList");
  const ref = useRef<HTMLDivElement | null>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = registeredTabs;
    if (tabs.length === 0) return;
    const idx = tabs.indexOf(value);
    if (idx < 0) return;

    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft")
      next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;

    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next]);
    /* Focus tab yang baru. */
    requestAnimationFrame(() => {
      const tabEl = ref.current?.querySelector<HTMLButtonElement>(
        `[role="tab"][data-value="${tabs[next!]}"]`,
      );
      tabEl?.focus();
    });
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-wrap gap-1 border-b border-neutral-200",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, "onClick"> {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}

export function Tab({
  value,
  disabled,
  className,
  children,
  ...rest
}: TabProps) {
  const ctx = useTabsContext("Tab");
  const { value: active, onChange, baseId, registerTab } = ctx;
  useEffect(() => {
    registerTab(value);
  }, [value, registerTab]);

  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      data-value={value}
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => !disabled && onChange(value)}
      className={cn(
        "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        selected
          ? "border-mahakan-green-700 text-mahakan-green-900"
          : "border-transparent text-neutral-500 hover:text-neutral-900",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  children: ReactNode;
  /** Mount panel hanya saat active (default). False = always mount + hide. */
  unmountOnHide?: boolean;
}

export function TabPanel({
  value,
  className,
  children,
  unmountOnHide = true,
  ...rest
}: TabPanelProps) {
  const { value: active, baseId } = useTabsContext("TabPanel");
  const selected = active === value;

  if (unmountOnHide && !selected) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      hidden={!selected}
      className={className}
      {...rest}
    >
      {selected ? children : null}
    </div>
  );
}
