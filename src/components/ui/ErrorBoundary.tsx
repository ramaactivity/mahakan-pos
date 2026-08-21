"use client";

import { Component, type ReactNode } from "react";

/**
 * Sesi AE-213 — penahan error per-bagian.
 *
 * Sebelum ini aplikasi TIDAK punya satu pun error boundary di dalam pohon
 * komponen: satu-satunya penahan adalah `error.tsx` milik Next.js yang
 * duduk di level route. Akibatnya satu menu yang bermasalah menjatuhkan
 * SELURUH back office — sidebar ikut hilang, owner tidak bisa pindah menu,
 * dan pesan errornya muncul jauh dari tempat kejadian sehingga tidak
 * kelihatan menu mana yang sebenarnya rusak.
 *
 * Boundary ini menahan error di tempat terdekat: bagian yang rusak diganti
 * fallback, bagian lain tetap hidup.
 *
 * `resetKey` — kalau nilainya berubah (mis. owner pindah menu), state error
 * dibuang supaya bagian yang baru dirender bersih. Tanpa ini boundary yang
 * sudah "tercemar" akan menampilkan fallback selamanya.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    /** Dipanggil dengan error + fungsi reset; kembalikan tampilan pengganti. */
    fallback: (error: Error, reset: () => void) => ReactNode;
    /** Ganti nilainya untuk membuang state error (mis. nama menu aktif). */
    resetKey?: string | number;
    /** Dipanggil sekali saat error tertangkap — untuk logging. */
    onError?: (error: Error, componentStack: string) => void;
  },
  { error: Error | null; lastResetKey: string | number | undefined }
> {
  constructor(props: {
    children: ReactNode;
    fallback: (error: Error, reset: () => void) => ReactNode;
    resetKey?: string | number;
    onError?: (error: Error, componentStack: string) => void;
  }) {
    super(props);
    this.state = { error: null, lastResetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  /* Reset saat resetKey berubah. Sengaja lewat getDerivedStateFromProps,
   * bukan componentDidUpdate: fallback tidak boleh sempat terender satu
   * frame untuk bagian yang baru. */
  static getDerivedStateFromProps(
    props: { resetKey?: string | number },
    state: { error: Error | null; lastResetKey: string | number | undefined },
  ) {
    if (props.resetKey !== state.lastResetKey) {
      return { error: null, lastResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.props.onError?.(error, info.componentStack ?? "");
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}
