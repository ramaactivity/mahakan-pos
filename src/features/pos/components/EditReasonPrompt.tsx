"use client";

/**
 * Sesi AE-237 — alasan edit open bill WAJIB (arahan owner; kecurigaan fraud
 * open bill AE-234). Tidak ada tombol lewati: Batal = edit tidak disimpan.
 * Server ikut menolak edit tanpa alasan (editOpenBillSchema.editReason).
 *
 * Pilihan cepat supaya kasir di depan tamu tidak perlu mengetik panjang.
 * "Pindah" dan "Split" wajib diberi keterangan ke bill siapa — itu yang
 * dicocokkan owner di Laporan → Per-Bill → Detail.
 *
 * Overlay sendiri di z-[70] (sama dengan CrewPicker) karena modal POS tidak
 * di-portal.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK: Array<{ label: string; needsDetail?: string }> = [
  { label: "Tambah pesanan" },
  { label: "Pindah ke bill lain", needsDetail: "Ke bill siapa / nomor bill?" },
  { label: "Split / bayar terpisah", needsDetail: "Bagian siapa, dibayar di bill mana?" },
  { label: "Salah input" },
  { label: "Customer batal pesan" },
  { label: "Ganti menu" },
];

const MIN = 3;

export function useEditReasonPrompt(): [(label: string) => Promise<string | null>, ReactNode] {
  const [label, setLabel] = useState<string | null>(null);
  const [chip, setChip] = useState<(typeof QUICK)[number] | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((r: string | null) => void) | null>(null);

  const ask = useCallback((l: string) => {
    setChip(null);
    setText("");
    setLabel(l);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (r: string | null) => {
    resolver.current?.(r);
    resolver.current = null;
    setLabel(null);
  };

  const detail = text.trim();
  const reason = chip ? (detail ? `${chip.label}: ${detail}` : chip.label) : detail;
  const valid = chip?.needsDetail ? detail.length >= MIN : reason.length >= MIN;

  const element = label ? (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-reason-title"
    >
      <form
        className="w-full max-w-lg rounded-2xl bg-neutral-50 p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) finish(reason.slice(0, 200));
        }}
      >
        <div className="mb-1 flex items-center gap-2 text-mahakan-green-700">
          <PencilLine className="size-5" />
          <h2 id="edit-reason-title" className="text-lg font-semibold text-neutral-900">
            Kenapa bill ini diedit?
          </h2>
        </div>
        <p className="mb-4 text-sm text-neutral-600">{label}. Alasan wajib diisi dan tercatat di laporan.</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setChip(chip?.label === q.label ? null : q)}
              className={cn(
                "min-h-11 rounded-lg border px-3 text-sm font-medium",
                chip?.label === q.label
                  ? "border-mahakan-green-700 bg-mahakan-green-100 text-mahakan-green-700"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-neutral-700" htmlFor="edit-reason-text">
          {chip?.needsDetail ?? (chip ? "Keterangan (opsional)" : "Atau tulis alasan")}
        </label>
        <input
          id="edit-reason-text"
          autoFocus
          value={text}
          maxLength={150}
          onChange={(e) => setText(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"
          placeholder={chip?.needsDetail ? "mis. bill Wida / TRX-…-0007" : "Tulis alasan"}
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => finish(null)}
            className="min-h-11 rounded-lg px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="min-h-11 rounded-lg bg-mahakan-green-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            Lanjut
          </button>
        </div>
      </form>
    </div>
  ) : null;

  return [ask, element];
}
