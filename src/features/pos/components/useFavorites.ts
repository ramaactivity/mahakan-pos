"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mahakan-pos-favorites-v1";
export const MAX_FAVORITES = 10;

function readFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeToStorage(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private mode failures
  }
}

/**
 * Per-device favorite menu items, persisted in localStorage. Each kasir's
 * tablet keeps its own preferences — no server roundtrip. Order is preserved
 * (newest pinned at the front).
 */
export function useFavorites() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setIds(readFromStorage());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [id, ...prev].slice(0, MAX_FAVORITES);
      writeToStorage(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (id: string) => ids.includes(id),
    [ids],
  );

  const remove = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      writeToStorage(next);
      return next;
    });
  }, []);

  return { favorites: ids, toggle, isFavorite, remove };
}
