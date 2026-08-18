"use client";

import { useMemo } from "react";
import { AlertTriangle, Copy, Wallet } from "lucide-react";
import { Button, toast } from "@/components/ui";
import {
  computeStockValue,
  type OpnameLineWithIngredient,
} from "@/features/stock-opname";
import { formatRupiah } from "@/lib/format";

/**
 * Sesi AE-210 — kartu NILAI STOK hasil opname.
 *
 * Owner Rama: "angka stock opname Juni tidak terlihat nominalnya, saya mau
 * masukin saldo awal." Modul opname selama ini hanya menampilkan Δ Cost —
 * nilai SELISIH hitung fisik vs sistem — sementara yang dibutuhkan untuk
 * mengisi Akuntansi → Ubah Saldo Awal adalah NILAI STOK-nya per akun
 * persediaan. Kartu ini menutup jarak itu: angka di sini bisa langsung
 * diketik ulang ke form saldo awal, baris per baris.
 *
 * Pemecahan per akun mengikuti pemetaan jurnal opname (kitchen→1140,
 * bar→1141, supporting/cleaning/tanpa section→1142).
 */
export function OpnameStockValueCard({
  periodLabel,
  lines,
  compact = false,
}: {
  periodLabel: string;
  lines: OpnameLineWithIngredient[];
  /** true = dipakai di dalam modal (tanpa judul besar). */
  compact?: boolean;
}) {
  const summary = useMemo(
    () =>
      computeStockValue(
        lines.map((l) => ({
          actualQty: l.actualQty,
          actualQtyDecimal: l.actualQtyDecimal,
          unitCostAtSnapshot: l.unitCostAtSnapshot,
          section: l.ingredient.section,
        })),
      ),
    [lines],
  );

  const copyText = [
    `Nilai stok opname ${periodLabel}`,
    ...summary.buckets.map(
      (b) => `${b.accountCode} ${b.label}: ${formatRupiah(b.value)}`,
    ),
    `TOTAL: ${formatRupiah(summary.total)}`,
  ].join("\n");

  return (
    <div className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-100/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            <Wallet className="size-3.5" aria-hidden /> Nilai stok
            {compact ? null : ` — ${periodLabel}`}
          </p>
          <p className="text-xl font-bold text-neutral-900">
            {formatRupiah(summary.total)}
          </p>
          <p className="text-[11px] text-neutral-600">
            {summary.countedLines} bahan dihitung × harga saat opname dimulai
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyText);
              toast.success("Rincian nilai stok disalin");
            } catch {
              toast.error("Gagal menyalin — catat manual dari tabel di atas");
            }
          }}
        >
          <Copy className="size-4" aria-hidden /> Salin
        </Button>
      </div>

      <table className="mt-2 w-full text-xs">
        <tbody className="divide-y divide-mahakan-green-700/15">
          {summary.buckets.map((b) => (
            <tr key={b.accountCode}>
              <td className="py-1.5 pr-2 text-neutral-700">
                <span className="font-mono text-[11px] text-neutral-500">
                  {b.accountCode}
                </span>{" "}
                {b.label}
              </td>
              <td className="py-1.5 text-right font-mono font-semibold text-neutral-900">
                {formatRupiah(b.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {summary.uncountedLines > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-100/60 p-2 text-[11px] text-neutral-800">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {summary.uncountedLines} bahan belum dihitung — nilainya belum
            masuk total di atas.
          </span>
        </p>
      ) : null}
      {summary.zeroCostLines > 0 ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warning-100/60 p-2 text-[11px] text-neutral-800">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {summary.zeroCostLines} bahan ada stoknya tapi harganya Rp 0 saat
            opname dimulai — nilainya tidak terhitung. Lengkapi harga di
            Kelola Bahan sebelum opname berikutnya.
          </span>
        </p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        Ketik angka per akun ini di <strong>Akuntansi → Rekonsiliasi → Ubah
        Saldo Awal</strong>. Angka di atas adalah nilai stok akhir periode ini
        — sekaligus stok awal periode berikutnya.
      </p>
    </div>
  );
}
