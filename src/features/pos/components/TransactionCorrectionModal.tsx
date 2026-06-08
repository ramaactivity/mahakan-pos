"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Mail, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  requestTransactionCorrection,
  type SplitBreakdownRow,
} from "@/features/transactions/correction-actions";
import { isOk, type TransactionWithItems } from "@/features/transactions";
import type { SplitPaymentBreakdown } from "@/features/transactions/types";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";

interface TransactionCorrectionModalProps {
  open: boolean;
  trx: TransactionWithItems | null;
  /** Existing split breakdown (kalau trx.paymentMethod = 'split'). */
  currentSplitBreakdown: SplitPaymentBreakdown | null;
  onClose: () => void;
  /** Dipanggil setelah request berhasil — parent harus refresh detail modal. */
  onSubmitted: () => void;
}

type PaymentMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other"
  | "split";

const NON_SPLIT_METHODS: { value: Exclude<PaymentMethod, "split">; label: string }[] = [
  { value: "cash", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "card_bca", label: "Kartu BCA" },
  { value: "card_bni", label: "Kartu BNI" },
  { value: "card_mandiri", label: "Kartu Mandiri" },
  { value: "card_bri", label: "Kartu BRI" },
  { value: "card_other", label: "Kartu (lainnya)" },
];

const ALL_METHODS = [
  ...NON_SPLIT_METHODS,
  { value: "split" as PaymentMethod, label: "Split (campur)" },
];

const REASON_PRESETS = [
  "Salah tap metode bayar",
  "Salah input nominal",
  "Customer ganti metode bayar",
  "Lainnya",
];

/**
 * Sesi AE-62r — Modal kasir request koreksi transaksi.
 *
 * Form 2-section: left snapshot read-only, right form input. Submit kirim
 * email kode 6-digit ke owner; owner forward via WA → kasir input di
 * "Approve Koreksi" modal terpisah.
 *
 * Tablet-first (Galaxy A7 Lite 1340×800): size='2xl' kasih max-w-3xl
 * landscape, NumericInput popup numpad bypass keyboard Android.
 */
export function TransactionCorrectionModal({
  open,
  trx,
  currentSplitBreakdown,
  onClose,
  onSubmitted,
}: TransactionCorrectionModalProps) {
  const [correctedPaymentMethod, setCorrectedPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [correctedTotal, setCorrectedTotal] = useState("");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [splitRows, setSplitRows] = useState<SplitBreakdownRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    codeFirstTwo: string;
    ownerEmailMasked: string;
    emailMode: "sent" | "logged" | "failed";
  } | null>(null);

  // Reset state setiap kali dibuka — pre-fill dengan current trx values.
  // Dijaga init-key ref: hanya jalan sekali per trx + sekali lagi saat
  // currentSplitBreakdown async selesai loading (null→ada). Identitas `trx`/
  // breakdown yang berubah belakangan TIDAK menimpa input user yg belum submit.
  const prefillKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !trx) {
      prefillKeyRef.current = null;
      return;
    }
    const prefillKey = `${trx.id}:${currentSplitBreakdown ? "loaded" : "pending"}`;
    if (prefillKeyRef.current === prefillKey) return;
    prefillKeyRef.current = prefillKey;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCorrectedPaymentMethod(trx.paymentMethod as PaymentMethod);
    setCorrectedTotal(String(trx.total));
    setReason("");
    setCustomReason("");
    if (trx.paymentMethod === "split" && currentSplitBreakdown) {
      setSplitRows(
        currentSplitBreakdown.splits.map((s) => ({
          paymentMethod: s.paymentMethod as SplitBreakdownRow["paymentMethod"],
          amount: s.amount,
          cashReceived: s.cashReceived ?? null,
          cashChange: s.cashChange ?? null,
        })),
      );
    } else {
      setSplitRows([]);
    }
    setError(null);
    setSuccess(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, trx, currentSplitBreakdown]);

  const totalNum = useMemo(() => {
    const n = parseInt((correctedTotal || "0").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }, [correctedTotal]);

  const splitSum = useMemo(
    () => splitRows.reduce((s, r) => s + r.amount, 0),
    [splitRows],
  );

  const finalReason = reason === "Lainnya" ? customReason.trim() : reason;

  const paymentMethodChanged = trx
    ? correctedPaymentMethod !== trx.paymentMethod
    : false;
  const totalChanged = trx ? totalNum !== trx.total : false;
  const splitChanged = useMemo(() => {
    if (!trx) return false;
    if (correctedPaymentMethod !== "split" && trx.paymentMethod !== "split")
      return false;
    if (correctedPaymentMethod === "split" && !currentSplitBreakdown)
      return true;
    if (
      correctedPaymentMethod !== "split" &&
      currentSplitBreakdown &&
      currentSplitBreakdown.splits.length > 0
    )
      return true;
    if (!currentSplitBreakdown) return splitRows.length > 0;
    if (splitRows.length !== currentSplitBreakdown.splits.length) return true;
    return splitRows.some((row, idx) => {
      const cur = currentSplitBreakdown.splits[idx];
      return cur.paymentMethod !== row.paymentMethod || cur.amount !== row.amount;
    });
  }, [trx, correctedPaymentMethod, splitRows, currentSplitBreakdown]);
  const hasAnyChange = paymentMethodChanged || totalChanged || splitChanged;

  const splitValid =
    correctedPaymentMethod !== "split"
      ? true
      : splitRows.length > 0 && splitSum === totalNum;

  const submitDisabled =
    submitting ||
    !trx ||
    !hasAnyChange ||
    finalReason.length < 3 ||
    totalNum <= 0 ||
    !splitValid ||
    success !== null;

  function addSplitRow() {
    setSplitRows((rows) => [
      ...rows,
      { paymentMethod: "cash", amount: 0, cashReceived: null, cashChange: null },
    ]);
  }

  function removeSplitRow(idx: number) {
    setSplitRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateSplitRow(idx: number, patch: Partial<SplitBreakdownRow>) {
    setSplitRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  async function onSubmit() {
    if (!trx) return;
    setError(null);
    if (!hasAnyChange) {
      setError("Tidak ada field yang berubah. Edit dulu sebelum submit.");
      return;
    }
    if (finalReason.length < 3) {
      setError("Alasan minimal 3 karakter.");
      return;
    }
    if (correctedPaymentMethod === "split") {
      if (splitRows.length === 0) {
        setError("Metode split butuh minimal 1 baris breakdown.");
        return;
      }
      if (splitSum !== totalNum) {
        setError(
          `Jumlah split (${formatRupiah(splitSum)}) tidak sama dengan total (${formatRupiah(totalNum)}).`,
        );
        return;
      }
    }
    setSubmitting(true);
    const res = await requestTransactionCorrection({
      transactionId: trx.id,
      correctedPaymentMethod,
      correctedTotal: totalNum,
      correctedSplitBreakdown:
        correctedPaymentMethod === "split"
          ? splitRows.map((r) => ({
              paymentMethod: r.paymentMethod,
              amount: r.amount,
              cashReceived:
                r.paymentMethod === "cash" ? (r.cashReceived ?? r.amount) : null,
              cashChange:
                r.paymentMethod === "cash" ? (r.cashChange ?? 0) : null,
            }))
          : undefined,
      reason: finalReason,
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
        ? `Kode ${res.data.codeFirstTwo}… terkirim ke ${res.data.ownerEmailMasked}`
        : res.data.emailMode === "logged"
          ? `Dev mode — kode di-log ke server console (mulai ${res.data.codeFirstTwo}…)`
          : `Email gagal kirim — cek Admin → Approval Codes`,
    );
    onSubmitted();
  }

  if (!trx) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Koreksi Transaksi"
      description={`TRX ${trx.transactionNumber} — perbaiki metode bayar / total. Owner approve via kode email.`}
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {success ? "Tutup" : "Batal"}
          </Button>
          {success ? null : (
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={submitDisabled}
            >
              Ajukan Koreksi
            </Button>
          )}
        </>
      }
    >
      {success ? (
        <div className="space-y-4">
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-mahakan-green-900">
              <Mail className="size-4" aria-hidden /> Kode dikirim (
              {success.emailMode})
            </p>
            <p className="mt-2 text-neutral-700">
              Email tujuan:{" "}
              <span className="font-mono">{success.ownerEmailMasked}</span>
            </p>
            <p className="mt-1 text-neutral-700">
              Kode dimulai:{" "}
              <span className="font-mono text-base font-bold tracking-widest text-mahakan-green-900">
                {success.codeFirstTwo}…
              </span>
            </p>
            <p className="mt-3 text-xs text-neutral-600">
              Minta owner forward kode lengkap (6 digit) via WhatsApp. Setelah
              terima, tap tombol{" "}
              <strong className="text-mahakan-green-900">
                &ldquo;Approve Koreksi&rdquo;
              </strong>{" "}
              di modal detail transaksi → input kode → koreksi otomatis
              ter-apply + journal di-adjust.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Snapshot (read-only) */}
          <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Saat Ini
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-600">Metode bayar</dt>
                <dd className="font-medium text-neutral-900">
                  {paymentMethodLabel(trx.paymentMethod)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-600">Total</dt>
                <dd className="font-mono font-bold text-neutral-900">
                  {formatRupiah(trx.total)}
                </dd>
              </div>
              {trx.subtotal !== trx.total ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-neutral-600">Subtotal</dt>
                  <dd className="font-mono text-neutral-900">
                    {formatRupiah(trx.subtotal)}
                  </dd>
                </div>
              ) : null}
              {(trx.discountAmount ?? 0) > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-neutral-600">Diskon</dt>
                  <dd className="font-mono text-danger-500">
                    - {formatRupiah(trx.discountAmount ?? 0)}
                  </dd>
                </div>
              ) : null}
              {trx.paymentMethod === "split" && currentSplitBreakdown ? (
                <div className="border-t border-neutral-200 pt-2">
                  <dt className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                    Breakdown
                  </dt>
                  <ul className="space-y-1 text-xs">
                    {currentSplitBreakdown.splits.map((s, i) => (
                      <li key={s.id} className="flex justify-between gap-2">
                        <span className="text-neutral-700">
                          #{i + 1} {paymentMethodLabel(s.paymentMethod)}
                        </span>
                        <span className="font-mono">{formatRupiah(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {trx.member ? (
                <div className="border-t border-neutral-200 pt-2 text-xs text-neutral-600">
                  <p>
                    Customer: <strong>{trx.member.name}</strong>
                  </p>
                  <p>
                    Poin earned saat ini:{" "}
                    <span className="font-mono">
                      {trx.loyaltyPointsEarned ?? 0}
                    </span>
                    {(trx.loyaltyPointsRedeemed ?? 0) > 0 ? (
                      <>
                        {" "}
                        · redeemed{" "}
                        <span className="font-mono">
                          {trx.loyaltyPointsRedeemed}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Form (corrected values) */}
          <section className="space-y-4">
            <Select
              label="Metode Bayar Baru"
              value={correctedPaymentMethod}
              onValueChange={(v) =>
                setCorrectedPaymentMethod(v as PaymentMethod)
              }
              options={ALL_METHODS.map((m) => ({
                value: m.value,
                label: m.label,
              }))}
            />

            <NumericInput
              label="Total Baru"
              value={correctedTotal}
              onChange={setCorrectedTotal}
              prefix="Rp"
              placeholder="0"
              maxLength={11}
              hint={
                totalChanged
                  ? `Selisih ${totalNum >= trx.total ? "+" : ""}${formatRupiah(totalNum - trx.total)}`
                  : "Boleh sama atau ubah kalau salah input."
              }
            />

            {correctedPaymentMethod === "split" ? (
              <div className="rounded-md border border-neutral-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Breakdown Split
                  </p>
                  <span
                    className={`text-xs font-mono ${
                      splitSum === totalNum
                        ? "text-mahakan-green-700"
                        : "text-danger-500"
                    }`}
                  >
                    {formatRupiah(splitSum)} / {formatRupiah(totalNum)}{" "}
                    {splitSum === totalNum ? "✓" : "✗"}
                  </span>
                </div>
                <div className="space-y-2">
                  {splitRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_auto_auto] gap-2"
                    >
                      <Select
                        value={row.paymentMethod}
                        onValueChange={(v) =>
                          updateSplitRow(idx, {
                            paymentMethod:
                              v as SplitBreakdownRow["paymentMethod"],
                          })
                        }
                        options={NON_SPLIT_METHODS.map((m) => ({
                          value: m.value,
                          label: m.label,
                        }))}
                        size="sm"
                        ariaLabel={`Metode baris ${idx + 1}`}
                      />
                      <Input
                        type="number"
                        value={row.amount > 0 ? String(row.amount) : ""}
                        onChange={(e) =>
                          updateSplitRow(idx, {
                            amount: Math.max(
                              0,
                              parseInt(e.target.value || "0", 10),
                            ),
                          })
                        }
                        inputMode="numeric"
                        className="w-32 text-right font-mono"
                        placeholder="0"
                        aria-label={`Nominal baris ${idx + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeSplitRow(idx)}
                        aria-label="Hapus baris"
                        className="rounded-md border border-neutral-300 px-2 text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addSplitRow}
                    className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-neutral-300 py-2 text-xs text-neutral-600 hover:bg-neutral-100"
                  >
                    <Plus className="size-3.5" /> Tambah baris
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Alasan Koreksi
              </label>
              <div className="grid grid-cols-2 gap-2">
                {REASON_PRESETS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`rounded-md border py-2 text-sm transition-all ${
                      reason === r
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-300 bg-white hover:bg-neutral-100"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {reason === "Lainnya" ? (
                <Input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Tulis alasan koreksi"
                  maxLength={500}
                />
              ) : null}
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden /> Setelah submit
              </p>
              <ul className="mt-1 ml-5 list-disc space-y-0.5">
                <li>Email kode 6-digit kirim ke owner</li>
                <li>Owner forward kode via WA → input di modal Approve</li>
                <li>
                  Setelah approve: trx + journal + loyalty (kalau total berubah)
                  auto-adjust
                </li>
                <li>Audit log tercatat dengan reason + approver</li>
              </ul>
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-md bg-danger-100/60 px-3 py-2 text-sm font-medium text-danger-500"
              >
                {error}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </Modal>
  );
}
