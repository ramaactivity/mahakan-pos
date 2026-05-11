"use client";

import { Coins } from "lucide-react";
import { PettyCashCard } from "./PettyCashCard";

/**
 * Standalone panel wrapper around `PettyCashCard` so kasir bisa akses
 * petty cash dari level 1 PosLeftNav (sebelumnya nested di Pengaturan).
 * Phase 2.3 (sesi AB) — owner mau one-tap akses untuk record pengeluaran
 * harian (es batu, gula, gas) tanpa keluar dari main POS flow.
 */
export function PettyCashPanel() {
  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 sm:p-6">
      {/* Sesi AE-40 — bump max-w supaya 2-col layout (form | numpad)
       * fit di Galaxy A7 Lite landscape (1340px) tanpa cramped. */}
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <Coins className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              Petty Cash
            </h1>
            <p className="text-sm text-neutral-600">
              Catat pengeluaran/pemasukan kecil shift hari ini. Nominal
              langsung mengurangi/menambah kas drawer.
            </p>
          </div>
        </div>

        <PettyCashCard />
      </div>
    </div>
  );
}
