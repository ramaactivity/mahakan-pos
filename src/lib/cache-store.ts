/**
 * Tiny localStorage cache layer for static reference data (suppliers, COA,
 * categories, ingredients master). Layered on top of TanStack Query — survives
 * full page reload (TanStack only survives navigation), useful when staff
 * close + reopen tablet PWA.
 *
 * Sensitive / real-time data (transactions, shift state, employee PINs) MUST
 * NOT use this cache. Use TanStack Query directly with short staleTime
 * instead.
 *
 * Cleared on logout via SessionProvider.logout(). All entries auto-expire by
 * TTL, defaulting to 24h.
 */
const CACHE_PREFIX = "mahakan:cache:";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function setCache<T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { value, expiresAt: Date.now() + ttlMs };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded / disabled — non-fatal, fall back to TanStack Query
  }
}

export function getCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.expiresAt < Date.now()) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export function clearCache(key?: string): void {
  if (typeof window === "undefined") return;
  if (key) {
    localStorage.removeItem(CACHE_PREFIX + key);
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

/**
 * Cache keys used across the app. Centralized so refactors don't drift —
 * if you add a new cached query, add the key here.
 */
export const CACHE_KEYS = {
  CHART_OF_ACCOUNTS: "coa",
  SUPPLIERS: "suppliers",
  CATEGORIES: "categories",
  INGREDIENTS: "ingredients",
  EXPENSE_CATEGORIES: "expense_categories",
  MENU_ITEMS: "menu_items",
  EMPLOYEES_BASIC: "employees_basic",
} as const;
