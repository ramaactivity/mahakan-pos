"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Sesi AE-223b — beri tahu perangkat bahwa ada versi baru.
 *
 * Kejadian 30 Agu 2026: fitur struk closing sudah live di server pukul 19.52,
 * tapi tablet POS dibuka pukul 09.46 dan tidak pernah di-reload, jadi saat
 * tutup shift pukul 23.37 tablet masih menjalankan bundel lama — fiturnya
 * seolah "tidak ada". `skipWaiting` di sw.ts hanya mengganti service worker;
 * HALAMAN YANG SUDAH TERBUKA tetap memakai JavaScript yang sudah terlanjur
 * dimuat sampai ada reload. Tidak ada satu pun mekanisme yang memberitahu.
 *
 * Kenapa TIDAK auto-reload: POS memegang draft transaksi dan modal yang
 * sedang diisi kasir di depan tamu. Memuat ulang sendiri di tengah antrean
 * jauh lebih berbahaya daripada menunda satu rilis. Jadi: banner yang tidak
 * menghalangi, kasir yang menentukan kapan.
 */
export function AppUpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    /* Kalau belum ada controller berarti ini pemasangan PERTAMA di perangkat
     * ini — bukan pembaruan. Tanpa penjagaan ini banner muncul di kunjungan
     * pertama dan menyuruh reload tanpa alasan. */
    const hadController = Boolean(navigator.serviceWorker.controller);

    function markReady() {
      if (!cancelled && hadController) setUpdateReady(true);
    }

    function watchWorker(worker: ServiceWorker | null) {
      if (!worker) return;
      if (worker.state === "installed" || worker.state === "activated") {
        markReady();
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" || worker.state === "activated") {
          markReady();
        }
      });
    }

    /* Browser memeriksa sw.js dengan malas — di Android bisa sekali sehari.
     * Shift Mahakan berjalan 14 jam tanpa reload, jadi pemeriksaan dipaksa
     * berkala dan setiap kali tablet kembali aktif. */
    let check = () => {};
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    navigator.serviceWorker.addEventListener("controllerchange", markReady);
    document.addEventListener("visibilitychange", onVisible);

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg || cancelled) return;
        watchWorker(reg.waiting);
        watchWorker(reg.installing);
        reg.addEventListener("updatefound", () => watchWorker(reg.installing));
        check = () => void reg.update().catch(() => {});
        interval = setInterval(check, 15 * 60 * 1000);
        check();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        markReady,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 print:hidden">
      <div className="flex items-center gap-3 rounded-lg border border-mahakan-green-700/30 bg-white px-4 py-2.5 shadow-lg">
        <span className="text-sm font-medium text-neutral-800">
          Versi baru tersedia
        </span>
        <Button
          size="sm"
          loading={reloading}
          onClick={() => {
            setReloading(true);
            window.location.reload();
          }}
        >
          <RefreshCw className="size-4" /> Muat Ulang
        </Button>
        <button
          type="button"
          onClick={() => setUpdateReady(false)}
          className="text-xs font-medium text-neutral-500 hover:text-neutral-800"
        >
          Nanti
        </button>
      </div>
    </div>
  );
}
