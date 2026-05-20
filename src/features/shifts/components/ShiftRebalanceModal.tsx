"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Mail,
  Wallet,
} from "lucide-react";
import {
  Button,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import { requestShiftRebalance } from "@/features/shifts/rebalance-actions";
import { isOk, type Shift } from "@/features/shifts/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ShiftRebalanceModalProps {
  open: boolean;
  shift: Shift | null;
  /** Default source — kasir/POS context = 'close_shift', backoffice = 'manager_backoffice'. */
  source?: "close_shift" | "manager_backoffice";
  /** Computed expectedCash dari summary (untuk display Selisih live). */
  expectedCash?: number | null;
  /** POS Actual amounts untuk display reference. */
  posActualQris?: number;
  posActualCardBca?: number;
  /** Sesi AE-64 — komponen formula expectedCash. Dipakai untuk breakdown
   * read-only + auto-suggest Kas Aktual: openingCash + paidCash - refund
   * - pettyExpense + pettyIncome. */
  paidCash?: number;
  refundedCash?: number;
  pettyExpenseCash?: number;
  pettyIncomeCash?: number;
  onClose: () => void;
  onSubmitted: () => void;
}

/**
 * Sesi AE-62o — Modal kasir/manager request rebalancing shift.
 *
 * Display:
 *  - Per-channel correction fields: Cash + QRIS + EDC
 *  - Each row: Original (readonly) → Corrected (input) → Selisih
 *  - Reason (wajib min 3 char)
 *  - Submit → email code ke owner + toast confirm
 */
export function ShiftRebalanceModal({
  open,
  shift,
  source = "close_shift",
  expectedCash,
  posActualQris = 0,
  posActualCardBca = 0,
  paidCash = 0,
  refundedCash = 0,
  pettyExpenseCash = 0,
  pettyIncomeCash = 0,
  onClose,
  onSubmitted,
}: ShiftRebalanceModalProps) {
  const [correctedCash, setCorrectedCash] = useState("");
  const [correctedQris, setCorrectedQris] = useState("");
  const [correctedEdc, setCorrectedEdc] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    codeFirstTwo: string;
    ownerEmailMasked: string;
    emailMode: "sent" | "logged" | "failed";
  } | null>(null);

  if (!shift) return null;

  // Reset state on open transitions handled by caller via key prop or useEffect — simple reset:
  function resetForm() {
    setCorrectedCash("");
    setCorrectedQris("");
    setCorrectedEdc("");
    setReason("");
    setError(null);
    setSuccess(null);
  }

  function tryParse(s: string): number | null {
    const t = s.trim();
    if (t.length === 0) return null;
    const n = parseInt(t.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const cashNum = tryParse(correctedCash);
  const qrisNum = tryParse(correctedQris);
  const edcNum = tryParse(correctedEdc);

  // Default originals (kalau null = belum ada value yang lalu)
  const originalCash = shift.actualCash ?? 0;
  const originalQris = shift.qrisSettlement ?? 0;
  const originalEdc = shift.edcSettlement ?? 0;

  async function onSubmit() {
    if (!shift) return;
    setError(null);
    if (cashNum === null) {
      setError("Cash fisik wajib diisi");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }
    setSubmitting(true);
    const res = await requestShiftRebalance({
      shiftId: shift.id,
      source,
      correctedActualCash: cashNum,
      correctedQrisSettlement: qrisNum,
      correctedEdcSettlement: edcNum,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    setSuccess({
      codeFirstTwo: res.data.codeFirstTwo,
      ownerEmailMasked: res.data.ownerEmailMasked,
      emailMode: res.data.emailMode,
    });
    toast.success(
      res.data.emailMode === "sent"
        ? `Kode terkirim ke ${res.data.ownerEmailMasked}`
        : res.data.emailMode === "logged"
          ? "Kode di-log (dev mode)"
          : `Email gagal — minta Owner cek pengaturan`,
    );
    onSubmitted();
  }

  // Live selisih displays (corrected - original)
  const cashDiff = cashNum !== null ? cashNum - originalCash : null;
  const qrisDiff = qrisNum !== null ? qrisNum - originalQris : null;
  const edcDiff = edcNum !== null ? edcNum - originalEdc : null;

  /* Sesi AE-66 — Live variance projection.
   * Sebelum koreksi: variance lama (Aktual lama − Harusnya).
   * Sesudah koreksi: Aktual baru − Harusnya (kalau staff input baru).
   * Owner langsung lihat dampak koreksi terhadap selisih.
   */
  const varianceBefore =
    expectedCash != null ? originalCash - expectedCash : null;
  const projectedActualCash = cashNum !== null ? cashNum : originalCash;
  const varianceAfter =
    expectedCash != null ? projectedActualCash - expectedCash : null;
  const hasAnyCorrection =
    cashNum !== null || qrisNum !== null || edcNum !== null;

  return (
    <Modal
      open={open}
      onClose={
        submitting
          ? () => undefined
          : () => {
              resetForm();
              onClose();
            }
      }
      title="Ajukan Rebalancing Shift"
      description={
        success
          ? "Kode terkirim ke Owner. Tunggu approve."
          : "Koreksi shift fields dengan persetujuan Owner via kode 6-digit di email."
      }
      size="3xl"
      footer={
        success ? (
          <Button
            onClick={() => {
              resetForm();
              onClose();
            }}
            size="lg"
          >
            Tutup
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={
                cashNum === null || reason.trim().length < 3 || submitting
              }
              size="lg"
              className="!h-12"
            >
              <Mail className="size-4" /> Kirim ke Owner
            </Button>
          </>
        )
      }
    >
      {success ? (
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-mahakan-green-500 bg-mahakan-green-50 p-4 text-center">
            <p className="text-xs uppercase tracking-wider text-mahakan-green-900">
              Kode dimulai dengan
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-mahakan-green-900">
              {success.codeFirstTwo}**
            </p>
            <p className="mt-2 text-xs text-mahakan-green-900">
              Email lengkap dikirim ke {success.ownerEmailMasked}
            </p>
          </div>
          {success.emailMode === "failed" ? (
            <div className="rounded-md border border-danger-300 bg-danger-100 p-3 text-xs text-danger-700">
              <strong>Email gagal kirim.</strong> Minta Owner cek Pengaturan →
              Email Approval, atau forward kode lewat WhatsApp via Owner.
            </div>
          ) : null}
          <p className="text-xs text-neutral-600">
            Owner buka backoffice → Shifts → Rebalancing → input kode untuk
            approve. Setelah approve, shift fields + journal akan ter-update.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sesi AE-66 — Two-column grid: Komponen Kas Harusnya (kiri) +
           * Live Dampak Koreksi (kanan). Pada mobile/sempit, stack vertical. */}
          <div className="grid gap-3 md:grid-cols-2">
            {/* Komponen Kas Harusnya */}
            {expectedCash != null ? (
              <section className="rounded-lg border border-mahakan-green-200 bg-mahakan-green-50 p-3">
                <header className="mb-2 flex items-center gap-2">
                  <Calculator className="size-4 text-mahakan-green-900" aria-hidden />
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-mahakan-green-900">
                    Komponen Kas Harusnya
                  </h3>
                </header>
                <div className="space-y-1 font-mono text-xs text-neutral-800">
                  <BreakdownRow
                    label="Kas Awal"
                    value={shift.openingCash}
                    sign="+"
                  />
                  <BreakdownRow
                    label="Penjualan Tunai"
                    value={paidCash}
                    sign="+"
                  />
                  {refundedCash > 0 ? (
                    <BreakdownRow
                      label="Refund Tunai"
                      value={refundedCash}
                      sign="-"
                    />
                  ) : null}
                  {pettyExpenseCash > 0 ? (
                    <BreakdownRow
                      label="Pengeluaran Tunai"
                      value={pettyExpenseCash}
                      sign="-"
                    />
                  ) : null}
                  {pettyIncomeCash > 0 ? (
                    <BreakdownRow
                      label="Pemasukan Tunai"
                      value={pettyIncomeCash}
                      sign="+"
                    />
                  ) : null}
                  <div className="my-1 border-t border-mahakan-green-200" />
                  <BreakdownRow
                    label="Kas Harusnya"
                    value={expectedCash}
                    bold
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCorrectedCash(String(expectedCash))}
                  className="mt-3 w-full rounded-md border border-mahakan-green-300 bg-white px-3 py-2 text-xs font-medium text-mahakan-green-700 transition hover:bg-mahakan-green-100 active:scale-[0.99]"
                >
                  Pakai nilai ini sebagai Kas Aktual
                </button>
              </section>
            ) : null}

            {/* Live Dampak Koreksi (kanan) */}
            <section
              className={cn(
                "rounded-lg border p-3",
                varianceAfter === 0
                  ? "border-mahakan-green-300 bg-mahakan-green-50"
                  : varianceBefore != null &&
                      varianceAfter != null &&
                      Math.abs(varianceAfter) < Math.abs(varianceBefore)
                    ? "border-warning-300 bg-warning-50"
                    : "border-neutral-200 bg-neutral-50",
              )}
            >
              <header className="mb-2 flex items-center gap-2">
                {varianceAfter === 0 ? (
                  <CheckCircle2
                    className="size-4 text-mahakan-green-700"
                    aria-hidden
                  />
                ) : (
                  <Wallet
                    className="size-4 text-neutral-600"
                    aria-hidden
                  />
                )}
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                  Dampak Koreksi (Live)
                </h3>
              </header>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-neutral-600">
                  <span>Selisih sekarang</span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      varianceBefore != null && varianceBefore !== 0
                        ? Math.abs(varianceBefore) > 10_000
                          ? "text-danger-500"
                          : "text-warning-500"
                        : "text-mahakan-green-700",
                    )}
                  >
                    {varianceBefore != null
                      ? `${varianceBefore >= 0 ? "+" : ""}${formatRupiah(varianceBefore)}`
                      : "—"}
                  </span>
                </div>
                <div className="border-t border-current opacity-20" />
                <div className="flex items-center justify-between text-neutral-900">
                  <span className="font-medium">Selisih setelah koreksi</span>
                  <span
                    className={cn(
                      "font-mono text-base font-bold",
                      varianceAfter === 0
                        ? "text-mahakan-green-700"
                        : varianceAfter != null && Math.abs(varianceAfter) > 10_000
                          ? "text-danger-500"
                          : "text-warning-500",
                    )}
                  >
                    {varianceAfter != null
                      ? `${varianceAfter >= 0 ? "+" : ""}${formatRupiah(varianceAfter)}`
                      : "—"}
                  </span>
                </div>
                {varianceAfter === 0 ? (
                  <p className="rounded-md bg-mahakan-green-100 px-2 py-1.5 text-[11px] font-medium text-mahakan-green-900">
                    Kas akan pas setelah koreksi disetujui ✓
                  </p>
                ) : hasAnyCorrection &&
                  varianceBefore != null &&
                  varianceAfter != null &&
                  Math.abs(varianceAfter) < Math.abs(varianceBefore) ? (
                  <p className="rounded-md bg-warning-100 px-2 py-1.5 text-[11px] text-warning-700">
                    Selisih turun{" "}
                    {formatRupiah(
                      Math.abs(varianceBefore) - Math.abs(varianceAfter),
                    )}{" "}
                    setelah koreksi.
                  </p>
                ) : !hasAnyCorrection ? (
                  <p className="text-[11px] text-neutral-500">
                    Isi koreksi di bawah untuk lihat dampak ke selisih.
                  </p>
                ) : null}
              </div>
            </section>
          </div>

          {/* Koreksi per Channel section */}
          <section className="space-y-2">
            <header className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Koreksi per Channel
              </h3>
              <p className="text-[10px] text-neutral-500">
                Isi yang perlu di-koreksi — biarkan kosong kalau tidak berubah
              </p>
            </header>

            <ChannelRow
              label="Kas Fisik (laci)"
              original={originalCash}
              correctedRaw={correctedCash}
              correctedNum={cashNum}
              diff={cashDiff}
              onChange={setCorrectedCash}
              required
            />
            <ChannelRow
              label="QRIS (cek HP / app)"
              original={originalQris}
              posActual={posActualQris}
              correctedRaw={correctedQris}
              correctedNum={qrisNum}
              diff={qrisDiff}
              onChange={setCorrectedQris}
              hint="Kosongkan kalau tidak ada koreksi"
            />
            <ChannelRow
              label="EDC BCA (cek mesin)"
              original={originalEdc}
              posActual={posActualCardBca}
              correctedRaw={correctedEdc}
              correctedNum={edcNum}
              diff={edcDiff}
              onChange={setCorrectedEdc}
              hint="Kosongkan kalau tidak ada koreksi"
            />
          </section>

          {/* Reason input — textarea biar bisa multi-line */}
          <section className="space-y-1.5">
            <label
              htmlFor="rebalance-reason"
              className="flex items-baseline justify-between"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-700">
                Alasan Koreksi
                <span className="ml-1 text-danger-500" aria-hidden>
                  *
                </span>
              </span>
              <span
                className={cn(
                  "text-[10px]",
                  reason.trim().length < 3
                    ? "text-neutral-400"
                    : "text-mahakan-green-700",
                )}
              >
                {reason.trim().length} / min 3 karakter
              </span>
            </label>
            <textarea
              id="rebalance-reason"
              rows={2}
              placeholder="mis. transaksi 100k harusnya QRIS, kasir keliru ketik Cash"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
              required
            />
          </section>

          {/* Warning callout */}
          <div className="rounded-md border border-warning-300 bg-warning-100/70 p-3 text-xs text-warning-700">
            <p className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <span>
                <strong>Setelah Owner approve:</strong> shift fields
                ter-update + journal variance lama di-reverse + journal baru
                di-post. Tercatat lengkap di audit log dengan alasan +
                approver.
              </span>
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100 p-2.5 text-sm font-medium text-danger-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function BreakdownRow({
  label,
  value,
  sign,
  bold,
}: {
  label: string;
  value: number;
  sign?: "+" | "-";
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between text-xs ${
        bold ? "font-semibold text-neutral-900" : "text-neutral-700"
      }`}
    >
      <span>{label}</span>
      <span>
        {sign === "-" ? "−" : sign === "+" ? "+" : ""}
        {formatRupiah(value)}
      </span>
    </div>
  );
}

function ChannelRow({
  label,
  original,
  posActual,
  correctedRaw,
  correctedNum,
  diff,
  onChange,
  required,
  hint,
}: {
  label: string;
  original: number;
  posActual?: number;
  correctedRaw: string;
  correctedNum: number | null;
  diff: number | null;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const hasEdit = correctedNum !== null;
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition",
        hasEdit
          ? "border-mahakan-green-300 bg-mahakan-green-50/40 shadow-sm"
          : "border-neutral-200 bg-white",
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-900">
          {label}
          {required ? (
            <span className="ml-1 text-danger-500" aria-hidden>
              *
            </span>
          ) : null}
        </p>
        {posActual != null ? (
          <span
            className="text-[10px] text-neutral-500"
            title="POS Actual = total transaksi POS untuk channel ini"
          >
            POS Actual:{" "}
            <span className="font-mono text-neutral-700">
              {formatRupiah(posActual)}
            </span>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Lama
          </p>
          <p className="font-mono text-sm text-neutral-700">
            {formatRupiah(original)}
          </p>
        </div>
        <span className="text-neutral-400" aria-hidden>
          →
        </span>
        <NumericInput
          aria-label={`${label} corrected`}
          placeholder={hint ?? "Input baru"}
          value={correctedRaw}
          onChange={onChange}
          prefix="Rp"
          formatThousands
        />
      </div>
      {diff !== null && correctedNum !== null ? (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-xs">
          <span className="text-neutral-500">Selisih koreksi:</span>
          <span
            className={cn(
              "font-mono font-semibold",
              diff === 0
                ? "text-mahakan-green-700"
                : diff > 0
                  ? "text-mahakan-green-700"
                  : "text-danger-500",
            )}
          >
            {diff >= 0 ? "+" : ""}
            {formatRupiah(diff)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
