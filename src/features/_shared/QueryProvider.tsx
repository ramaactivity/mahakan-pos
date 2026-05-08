"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "@/lib/query-client";

/**
 * Wraps children with a per-session QueryClient. Initialized once per mount
 * via useState so that:
 *
 * - The QueryClient survives Next.js Fast Refresh in dev without losing cache
 * - Server-side rendering (if ever enabled) doesn't share clients across
 *   requests
 * - On full page reload, cache resets — staff don't carry stale data into
 *   a new shift
 *
 * Used by Admin + POS layouts. Reference data caches (suppliers, COA,
 * categories) are layered on top via localStorage in `cache-store.ts`.
 */
export function QueryProvider({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
