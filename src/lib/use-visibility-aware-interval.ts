"use client";

import { useEffect, useRef } from "react";

/**
 * Sesi AE-163 — jalankan `callback` tiap `intervalMs`, TAPI hanya saat tab
 * benar-benar terlihat (`document.visibilityState === "visible"`).
 *
 * Kenapa: panel POS / dashboard admin sering ditinggal terbuka di background
 * (tab lain, layar tablet mati). `setInterval` mentah tetap nembak server
 * tiap 30 dtk walau tidak ada yang lihat → boros Fluid Active CPU Vercel.
 *
 * Perilaku:
 *  - Tab visible  → interval jalan.
 *  - Tab hidden   → interval di-pause (tidak ada request).
 *  - Balik visible→ `callback` langsung dipanggil sekali (data fresh instan,
 *    no regresi UX) lalu interval lanjut.
 *
 * Callback disimpan di ref supaya identity-nya berubah TIDAK me-restart
 * interval (hindari reset timer tiap render).
 */
export function useVisibilityAwareInterval(
  callback: () => void,
  intervalMs: number,
  opts: { runOnVisible?: boolean } = {},
): void {
  const { runOnVisible = true } = opts;
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => cbRef.current(), intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (runOnVisible) cbRef.current(); // refresh langsung saat balik
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [intervalMs, runOnVisible]);
}
