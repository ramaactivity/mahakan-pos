import { useEffect, useRef } from "react";

/**
 * Sesi AE-176 — refresh "near-real-time" untuk layar yang TIDAK pakai TanStack
 * Query (pola useState + useEffect + refreshKey, mis. Opname, Menu). Memanggil
 * `onRefresh` saat:
 *   - tab kembali difokus / kembali terlihat (instan saat owner balik ke tab),
 *   - opsional: tiap `intervalMs` selama tab terlihat (polling latar).
 *
 * `onRefresh` disimpan di ref → caller tak perlu useCallback. Untuk layar
 * dengan input aktif (Opname count), JANGAN set intervalMs (refetch berkala
 * bisa menimpa ketikan) — cukup refresh saat fokus, dan pastikan onRefresh
 * itu "silent" (tidak unmount input).
 */
export function useLiveRefresh(onRefresh: () => void, intervalMs?: number) {
  const ref = useRef(onRefresh);
  useEffect(() => {
    ref.current = onRefresh;
  });
  useEffect(() => {
    const fire = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    window.addEventListener("focus", fire);
    document.addEventListener("visibilitychange", fire);
    let timer: ReturnType<typeof setInterval> | null = null;
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(fire, intervalMs);
    }
    return () => {
      window.removeEventListener("focus", fire);
      document.removeEventListener("visibilitychange", fire);
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);
}
