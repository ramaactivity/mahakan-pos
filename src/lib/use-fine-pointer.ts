"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: fine)";

let cached: MediaQueryList | null | undefined;

function mediaQuery(): MediaQueryList | null {
  if (cached !== undefined) return cached;
  cached =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(QUERY)
      : null;
  return cached;
}

function subscribe(onStoreChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => {};
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** SSR + hydration pass pertama selalu "bukan desktop" supaya markup server
 *  dan client identik; React re-render begitu snapshot asli terbaca. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * True kalau perangkat utamanya mouse/trackpad (laptop, MacBook, PC) —
 * mirror dari custom variant `pointer:` di globals.css (`pointer: fine`).
 *
 * Dipakai untuk mematikan keypad on-screen: di laptop user sudah punya
 * numpad fisik, popup keypad cuma nambah satu klik. Di tablet/HP
 * (`pointer: coarse`) keypad tetap wajib — keyboard Android nutup layar.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
