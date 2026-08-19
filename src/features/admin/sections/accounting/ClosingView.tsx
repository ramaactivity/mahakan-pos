"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  LockOpen,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge, Button, Input, Modal, Select, Skeleton, toast } from "@/components/ui";
import {
  closeAccountingPeriod,
  fetchPeriodClosePreview,
  fetchPeriods,
  lockAccountingPeriod,
  reopenAccountingPeriod,
  type PeriodClosePreview,
} from "@/features/accounting/actions";
import { periodLabelId } from "@/features/accounting/closing-pure";
import type { PeriodSummary } from "@/features/accounting/types";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-211 — Tutup Buku Bulanan (Closing Journal akun nominal).
 *
 * Akun NOMINAL = pendapatan (4xxx), HPP (5xxx), beban (6xxx). Saldonya hanya
 * berlaku sebulan, jadi di akhir bulan disapu ke 3302 Laba Rugi Berjalan lalu
 * dipindah ke 3301 Saldo Laba. Akun RIIL (kas, hutang, modal) TIDAK ditutup.
 *
 * Kenapa layar sendiri, padahal tombolnya sudah ada di tab Periode: di sana
 * tutup buku adalah lompatan buta — owner menekan tombol, jurnal terbentuk,
 * dan baru sesudahnya bisa dilihat apa isinya. Di sini semuanya kelihatan
 * DULU: akun mana yang dinolkan, berapa laba/ruginya, jurnal penutupnya
 * seperti apa, dan apa yang masih menghalangi.
 */
export function ClosingView({ viewerRole }: { viewerRole: Role }) {
  const [periods, setPeriods] = useState<PeriodSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [preview, setPreview] = useState<PeriodClosePreview | null>(null);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const canClose = hasPermission(viewerRole, "accounting.period.close");
  const canReopen = hasPermission(viewerRole, "accounting.period.reopen");
  const canLock = hasPermission(viewerRole, "accounting.period.lock");

  async function loadPeriods(preferId?: string) {
    setLoadingPeriods(true);
    try {
      const res = await fetchPeriods();
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      /* Terbaru di atas — owner hampir selalu menutup bulan yang baru lewat. */
      const sorted = [...res.data].sort(
        (a, b) =>
          b.periodYear * 100 + b.periodMonth - (a.periodYear * 100 + a.periodMonth),
      );
      setPeriods(sorted);
      const keep = preferId && sorted.some((p) => p.id === preferId) ? preferId : null;
      /* Default: bulan TERTUA yang masih terbuka. Tutup buku itu berurutan,
       * jadi yang paling perlu dikerjakan adalah tunggakan paling lama. */
      const oldestOpen = [...sorted]
        .reverse()
        .find((p) => p.status === "open");
      setSelectedId(keep ?? oldestOpen?.id ?? sorted[0]?.id ?? "");
    } finally {
      setLoadingPeriods(false);
    }
  }

  async function loadPreview(periodId: string) {
    if (!periodId) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await fetchPeriodClosePreview(periodId);
      if (res.ok) setPreview(res.data);
      else {
        setPreview(null);
        toast.error(res.error.message);
      }
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPeriods();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview(selectedId);
  }, [selectedId]);

  const periodOptions = useMemo(
    () =>
      periods.map((p) => ({
        value: p.id,
        label: `${periodLabelId(p.periodYear, p.periodMonth)} — ${
          p.status === "open"
            ? "belum tutup buku"
            : p.status === "closed"
              ? "sudah tutup buku"
              : "terkunci"
        }`,
      })),
    [periods],
  );

  const blocked = (preview?.blockers.length ?? 0) > 0;

  async function onClose() {
    if (!preview || busy) return;
    setBusy(true);
    const res = await closeAccountingPeriod(preview.periodId);
    setBusy(false);
    setConfirmOpen(false);
    if (res.ok) {
      toast.success(
        res.data.entryNumber
          ? `${preview.periodLabel} ditutup — jurnal penutup ${res.data.entryNumber}`
          : `${preview.periodLabel} ditutup (tidak ada saldo nominal, jadi tanpa jurnal penutup)`,
      );
      void loadPeriods(preview.periodId);
      void loadPreview(preview.periodId);
    } else {
      toast.error(res.error.message);
    }
  }

  async function onReopen() {
    if (!preview || busy) return;
    const alasan = reopenReason.trim();
    if (alasan.length < 10) {
      toast.error("Alasan minimal 10 karakter");
      return;
    }
    setBusy(true);
    const res = await reopenAccountingPeriod(preview.periodId, alasan);
    setBusy(false);
    if (res.ok) {
      toast.success(`${preview.periodLabel} dibuka kembali`);
      setReopenOpen(false);
      setReopenReason("");
      void loadPeriods(preview.periodId);
      void loadPreview(preview.periodId);
    } else {
      toast.error(res.error.message);
    }
  }

  async function onLock() {
    if (!preview || busy) return;
    if (
      !confirm(
        `Kunci ${preview.periodLabel} permanen? Setelah dikunci tidak ada jurnal yang bisa masuk, diubah, atau dibatalkan di bulan itu — dan tidak ada tombol untuk membuka lagi.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await lockAccountingPeriod(preview.periodId);
    setBusy(false);
    if (res.ok) {
      toast.success(`${preview.periodLabel} terkunci permanen`);
      void loadPeriods(preview.periodId);
      void loadPreview(preview.periodId);
    } else {
      toast.error(res.error.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3">
        <p className="text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">Tutup buku</span>{" "}
          menutup akun <em>nominal</em> — Pendapatan, HPP, dan Beban — dengan
          menyapu saldonya ke <span className="font-mono">3302</span> Laba Rugi
          Berjalan, lalu memindahkannya ke{" "}
          <span className="font-mono">3301</span> Saldo Laba. Akun{" "}
          <em>riil</em> (kas, bank, stok, hutang, modal) tidak ditutup — saldonya
          lanjut ke bulan berikutnya.
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          Setelah ditutup, Laba Rugi bulan itu tidak berubah lagi kecuali
          periodenya dibuka kembali. Semua penyesuaian akhir bulan (penyusutan,
          akrual, koreksi nilai) harus diposting SEBELUM tombol ini ditekan.
        </p>
      </div>

      <div className="grid gap-2 sm:max-w-md">
        <Select
          label="Bulan yang mau ditutup"
          options={periodOptions}
          value={selectedId}
          onValueChange={setSelectedId}
          disabled={loadingPeriods || periodOptions.length === 0}
        />
      </div>

      {loadingPreview ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !preview ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
          Belum ada periode akuntansi. Buat dulu di tab Periode.
        </p>
      ) : (
        <>
          {/* Ringkasan laba rugi bulan itu */}
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/30 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-mahakan-green-900">
                {preview.periodLabel}
              </span>
              <Badge
                variant={
                  preview.status === "open"
                    ? "warning"
                    : preview.status === "closed"
                      ? "success"
                      : "neutral"
                }
              >
                {preview.status === "open"
                  ? "Belum tutup buku"
                  : preview.status === "closed"
                    ? "Sudah tutup buku"
                    : "Terkunci"}
              </Badge>
              <span className="text-xs text-neutral-500">
                {preview.firstDay} s/d {preview.lastDay}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <SummaryTile
                label="Pendapatan Bersih"
                value={preview.revenueTotal - preview.contraRevenueTotal}
              />
              <SummaryTile label="HPP" value={-preview.cogsTotal} />
              <SummaryTile label="Beban" value={-preview.expenseTotal} />
              <SummaryTile
                label={preview.netIncome < 0 ? "Rugi Bersih" : "Laba Bersih"}
                value={preview.netIncome}
                emphasis
              />
            </div>
            <p className="mt-2 text-xs text-neutral-600">
              {preview.netIncome >= 0
                ? `Laba Rp ${formatRupiah(preview.netIncome)} akan menambah 3301 Saldo Laba.`
                : `Rugi Rp ${formatRupiah(-preview.netIncome)} akan mengurangi 3301 Saldo Laba.`}
            </p>
          </div>

          {/* Daftar penghalang & peringatan */}
          <div className="space-y-1.5">
            {preview.blockers.map((b) => (
              <div
                key={b.code}
                className="flex items-start gap-2 rounded-md border border-danger-500/40 bg-danger-100/30 p-2 text-xs text-danger-500"
              >
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{b.message}</span>
              </div>
            ))}
            {preview.warnings.map((w) => (
              <div
                key={w.code}
                className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-100/30 p-2 text-xs text-warning-700"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{w.message}</span>
              </div>
            ))}
            {preview.status === "open" &&
            preview.blockers.length === 0 &&
            preview.warnings.length === 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-success-500/40 bg-success-100/30 p-2 text-xs text-success-700">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Siap ditutup — tidak ada draft yang tertinggal dan buku bulan
                  ini seimbang.
                </span>
              </div>
            ) : null}
            {preview.closingEntry ? (
              <div className="flex items-start gap-2 rounded-md border border-neutral-300 bg-white p-2 text-xs text-neutral-700">
                <ShieldCheck
                  className="mt-0.5 size-4 shrink-0 text-mahakan-green-700"
                  aria-hidden
                />
                <span>
                  Jurnal penutup:{" "}
                  <span className="font-mono font-medium">
                    {preview.closingEntry.entryNumber}
                  </span>{" "}
                  bertanggal {preview.closingEntry.entryDate}. Cari nomor itu di
                  tab Jurnal untuk melihat barisnya.
                </span>
              </div>
            ) : null}
          </div>

          {/* Akun nominal yang akan dinolkan */}
          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
              Akun nominal yang akan dinolkan ({preview.accounts.length})
            </div>
            {preview.accounts.length === 0 ? (
              <p className="p-3 text-xs text-neutral-500">
                Tidak ada saldo pendapatan / HPP / beban di bulan ini.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Akun</th>
                      <th className="px-3 py-1.5 text-left font-medium">
                        Kelompok
                      </th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        Saldo bulan ini
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {preview.accounts.map((a) => (
                      <tr key={a.accountId}>
                        <td className="px-3 py-1.5 text-neutral-800">
                          <span className="font-mono text-neutral-500">
                            {a.code}
                          </span>{" "}
                          {a.name}
                        </td>
                        <td className="px-3 py-1.5 text-neutral-600">
                          {a.isContraRevenue
                            ? "Potongan Penjualan"
                            : a.type === "revenue"
                              ? "Pendapatan"
                              : a.type === "cogs"
                                ? "HPP"
                                : "Beban"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right font-mono",
                            a.balance < 0 ? "text-danger-500" : "text-neutral-900",
                          )}
                        >
                          {formatRupiah(a.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pratinjau jurnal penutup */}
          {preview.lines.length > 0 ? (
            <div className="rounded-md border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
                Pratinjau jurnal penutup ({preview.lastDay})
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Akun</th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        Debit
                      </th>
                      <th className="px-3 py-1.5 text-right font-medium">
                        Kredit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {preview.lines.map((l, i) => (
                      <tr key={`${l.accountCode}-${i}`}>
                        <td className="px-3 py-1.5 text-neutral-800">
                          <span className="font-mono text-neutral-500">
                            {l.accountCode}
                          </span>{" "}
                          {l.accountName}
                          {l.description ? (
                            <span className="ml-2 text-neutral-500">
                              — {l.description}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {l.debit > 0 ? formatRupiah(l.debit) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {l.credit > 0 ? formatRupiah(l.credit) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Aksi */}
          <div className="flex flex-wrap items-center gap-2">
            {preview.status === "open" && canClose ? (
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={blocked || busy}
                loading={busy}
              >
                <Lock className="size-4" /> Tutup Buku {preview.periodLabel}
              </Button>
            ) : null}
            {preview.status === "closed" && canReopen ? (
              <Button
                variant="outline"
                onClick={() => {
                  setReopenReason("");
                  setReopenOpen(true);
                }}
                disabled={busy}
              >
                <LockOpen className="size-4" /> Buka Kembali
              </Button>
            ) : null}
            {preview.status === "closed" && canLock ? (
              <Button variant="ghost" onClick={onLock} disabled={busy}>
                <ShieldCheck className="size-4" /> Kunci Permanen
              </Button>
            ) : null}
            {blocked && preview.status === "open" ? (
              <span className="text-xs text-danger-500">
                Bereskan dulu poin merah di atas.
              </span>
            ) : null}
          </div>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Tutup buku ${preview?.periodLabel ?? ""}?`}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Batal
            </Button>
            <Button onClick={onClose} loading={busy}>
              Ya, Tutup Buku
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-neutral-700">
          <p>
            Sistem akan memposting jurnal penutup bertanggal{" "}
            <span className="font-mono">{preview?.lastDay}</span>: seluruh saldo
            pendapatan, HPP, dan beban {preview?.periodLabel} dinolkan, dan{" "}
            {preview && preview.netIncome >= 0 ? "laba" : "rugi"} sebesar{" "}
            <span className="font-medium">
              {formatRupiah(Math.abs(preview?.netIncome ?? 0))}
            </span>{" "}
            masuk ke 3301 Saldo Laba.
          </p>
          <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-600">
            Masih bisa dibatalkan lewat &ldquo;Buka Kembali&rdquo; — jurnal
            penutupnya akan dibalik dan bulan itu terbuka lagi. Yang TIDAK bisa
            dibatalkan hanya &ldquo;Kunci Permanen&rdquo;.
          </p>
        </div>
      </Modal>

      <Modal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title={`Buka kembali ${preview?.periodLabel ?? ""}`}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setReopenOpen(false)}
              disabled={busy}
            >
              Batal
            </Button>
            <Button onClick={onReopen} loading={busy}>
              Buka Kembali
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Alasan buka kembali"
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="mis. ada nota Juli yang baru masuk"
            hint="Minimal 10 karakter — tersimpan di Audit Log."
          />
          <p className="rounded-md bg-warning-100/50 p-2 text-xs text-warning-700">
            Jurnal penutupnya akan dibalik, jadi saldo pendapatan/beban bulan itu
            kembali seperti sebelum tutup buku. Setelah selesai membetulkan,
            tutup bukunya lagi supaya Saldo Laba benar.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-white p-2",
        emphasis
          ? "border-mahakan-green-500/50"
          : "border-neutral-200",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-sm font-semibold",
          value < 0 ? "text-danger-500" : "text-neutral-900",
        )}
      >
        {formatRupiah(value)}
      </div>
    </div>
  );
}
