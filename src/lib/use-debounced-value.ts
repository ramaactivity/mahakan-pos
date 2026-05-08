"use client";

import { useEffect, useState } from "react";

/**
 * Returns the input value after `delayMs` of stability.
 *
 * Useful for search inputs feeding TanStack Query — without this every
 * keystroke triggers a fetch, defeating the cache. With 300ms, typing
 * "tunjangan" = 1 fetch instead of 9.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
