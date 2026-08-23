"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  History,
  Info,
  Scale,
  Undo2,
} from "lucide-react";
import {
  Badge,
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  cancelAssetValuation,
  getAssetValuationContext,
  postAssetValuation,
  previewAssetValuation,
  type AssetValuationContext,
  type ValuationPreview,
} from "@/features/accounting/fixed-asset-valuation-actions";
import {
  VALUATION_KINDS,
  type ValuationKind,
} from "@/features/accounting/fixed-asset-valuation-pure";
import { formatRupiah } from "@/lib/money";

/**
 * Sesi AE-214 — layar penilaian ulang aset tetap.
 *
 * Owner tidak diminta memikirkan debit/kredit sama sekali: dia mengetik
 * NILAI ASET SEKARANG BERAPA, dan layar ini menunjukkan jurnal yang akan
 * terbentuk sebelum apa pun tersimpan — termasuk berapa yang mendarat di
 * ekuitas dan berapa yang jadi rugi, karena dua-duanya punya akibat yang
 * sangat berbeda pada laporan laba rugi.
 */

interface Props {
  open: boolean;
  assetId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const KIND_OPTIONS = VALUATION_KINDS.map((k) => ({
  value: k.value,
  label: k.label,
}));

function amountLabel(kind: ValuationKind): string {
  if (kind === "impairment") return "Nilai yang masih bisa dipulihkan";
  if (kind === "impairment_reversal") return "Nilai tercatat setelah pemulihan";
  return "Nilai wajar aset sekarang";
}

function amountHint(kind: ValuationKind): string {
  if (kind === "impairment") {
    return "Perkiraan realistis: kalau dijual sekarang laku berapa, atau masih menghasilkan berapa sampai akhir umurnya — pilih yang lebih tinggi.";
  }
  if (kind === "impairment_reversal") {
    return "Tidak boleh melebihi penurunan nilai yang pernah diakui untuk aset ini.";
  }
  return "Harga wajar terkini (penilaian KJPP, harga pasar barang sejenis, atau harga penawaran nyata).";
}

export function AssetValuationModal({ open, assetId, onClose, onSaved }: Props) {
  const [ctx, setCtx] = useState<AssetValuationContext | null>(null);
  const [loading, setLoading] = useState(false);

  const [kind, setKind] = useState<ValuationKind>("revaluation");
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [remainingLife, setRemainingLife] = useState("");
  const [reason, setReason] = useState("");
  const [basis, setBasis] = useState("");

  const [preview, setPreview] = useState<ValuationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadContext(id: string) {
    setLoading(true);
    const res = await getAssetValuationContext(id);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      setCtx(null);
      return;
    }
    setCtx(res.data);
    setAmount(String(res.data.carrying));
    setEffectiveDate(res.data.defaultEffectiveDate);
    setRemainingLife(String(res.data.suggestedRemainingLife));
  }

  useEffect(() => {
    if (!open || !assetId) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setCtx(null);
    setPreview(null);
    setKind("revaluation");
    setAmount("");
    setReason("");
    setBasis("");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void loadContext(assetId);
  }, [open, assetId]);

  /* Pratinjau di-debounce: tiap ketikan angka tidak perlu menembak server. */
  useEffect(() => {
    if (!open || !assetId || !ctx) return;
    const numeric = Number(amount);
    const timer = window.setTimeout(async () => {
      if (!Number.isFinite(numeric) || amount.trim() === "" || !effectiveDate) {
        setPreview(null);
        return;
      }
      setPreviewing(true);
      const res = await previewAssetValuation({
        assetId,
        kind,
        newCarrying: numeric,
        effectiveDate,
        remainingLifeMonths: Number(remainingLife) || 1,
      });
      setPreviewing(false);
      if (res.ok) setPreview(res.data);
      else {
        setPreview(null);
        setError(res.error.message);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [open, assetId, ctx, kind, amount, effectiveDate, remainingLife]);

  async function onSubmit() {
    if (!assetId || submitting || !preview) return;
    if (preview.blockers.length > 0) {
      setError(preview.blockers[0]);
      return;
    }
    if (reason.trim().length < 10) {
      setError("Alasan penilaian minimal 10 karakter.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await postAssetValuation({
      assetId,
      kind,
      newCarrying: Number(amount),
      effectiveDate,
      remainingLifeMonths: Number(remainingLife) || 1,
      reason: reason.trim(),
      valuationBasis: basis.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(
        `Penilaian tersimpan — jurnal ${res.data.entryNumber} terposting.`,
      );
      onSaved();
    } else {
      setError(res.error.message);
    }
  }

  async function onCancelValuation(id: string) {
    const input = window.prompt(
      "Alasan pembatalan penilaian ini (minimal 10 karakter):",
    );
    if (input === null) return;
    if (input.trim().length < 10) {
      toast.error("Alasan pembatalan minimal 10 karakter.");
      return;
    }
    const res = await cancelAssetValuation(id, input.trim());
    if (res.ok) {
      toast.success(
        res.data.reverseEntryNumber
          ? `Penilaian dibatalkan — jurnal pembatalan ${res.data.reverseEntryNumber}.`
          : "Penilaian dibatalkan.",
      );
      if (assetId) void loadContext(assetId);
      onSaved();
    } else {
      toast.error(res.error.message);
    }
  }

  const blocked = !preview || preview.blockers.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Revaluasi / Penurunan Nilai Aset"
      description="Sesuaikan nilai tercatat aset ke nilai yang sebenarnya. Penyusutan bulan-bulan berikutnya otomatis memakai nilai baru dibagi sisa umur manfaat."
      size="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-neutral-500">
            {preview && preview.blockers.length === 0 ? (
              <>
                Penyusutan setelah ini:{" "}
                <strong>{formatRupiah(preview.monthlyDepreciationAfter)}</strong>{" "}
                / bulan × {preview.remainingLifeMonths} bulan, mulai{" "}
                {preview.basisMonthLabel}
              </>
            ) : (
              "Isi nilai barunya untuk melihat jurnalnya"
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Tutup
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={submitting || blocked || previewing}
            >
              <Scale className="size-4" /> Simpan Penilaian
            </Button>
          </div>
        </div>
      }
    >
      {loading || !ctx ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-4">
          {/* Keadaan sekarang — angka yang jadi titik tolak semuanya. */}
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-sm font-medium text-neutral-900">
              {ctx.assetName}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-neutral-500">Nilai bruto (buku)</dt>
                <dd className="font-mono">{formatRupiah(ctx.grossAmount)}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Akum. penyusutan</dt>
                <dd className="font-mono">
                  ({formatRupiah(ctx.accumulatedDepreciation)})
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Akum. penurunan nilai</dt>
                <dd className="font-mono">
                  ({formatRupiah(ctx.accumulatedImpairment)})
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Nilai tercatat</dt>
                <dd className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(ctx.carrying)}
                </dd>
              </div>
            </dl>
            {ctx.cost !== ctx.grossAmount ? (
              <p className="mt-2 text-[11px] text-neutral-500">
                Harga perolehan asli {formatRupiah(ctx.cost)} — berbeda dari
                nilai bruto karena aset ini pernah direvaluasi.
              </p>
            ) : null}
            {ctx.revaluationSurplus > 0 ? (
              <p className="mt-1 text-[11px] text-neutral-600">
                Surplus revaluasi tersimpan di ekuitas:{" "}
                <strong>{formatRupiah(ctx.revaluationSurplus)}</strong> —
                penurunan berikutnya menggerus ini dulu sebelum jadi rugi.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Jenis penilaian"
              options={KIND_OPTIONS}
              value={kind}
              onValueChange={(v) => setKind(v as ValuationKind)}
              hint={VALUATION_KINDS.find((k) => k.value === kind)?.help}
            />
            <DatePicker
              label="Berlaku per tanggal"
              value={effectiveDate}
              onChange={(v) => setEffectiveDate(v ?? "")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumericInput
              label={amountLabel(kind)}
              value={amount}
              onChange={setAmount}
              prefix="Rp"
              hint={amountHint(kind)}
            />
            <Input
              label="Sisa umur manfaat (bulan)"
              value={remainingLife}
              onChange={(e) =>
                setRemainingLife(e.target.value.replace(/[^0-9]/g, ""))
              }
              inputMode="numeric"
              hint={`Dipakai membagi nilai baru. Bawaan: ${ctx.suggestedRemainingLife} bulan.`}
            />
          </div>

          <Input
            label="Alasan penilaian (wajib)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. mesin espresso rusak berat, hanya bisa dipakai setengah kapasitas"
            required
          />
          <Input
            label="Dasar penilaian (opsional)"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="mis. penilaian KJPP 12 Agu 2026 / harga pasar bekas Tokopedia"
          />

          {previewing ? (
            <Skeleton className="h-28 w-full" />
          ) : preview ? (
            <>
              {preview.blockers.length > 0 ? (
                <div className="space-y-1 rounded-md border border-danger-500/50 bg-danger-100/40 p-3">
                  {preview.blockers.map((b, i) => (
                    <p
                      key={i}
                      className="flex items-start gap-2 text-sm text-danger-600"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      {b}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-neutral-200 bg-white p-3">
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                    Jurnal yang akan terbentuk
                  </p>
                  <table className="min-w-full text-xs">
                    <tbody className="divide-y divide-neutral-100">
                      {preview.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1 pr-2 font-mono">{l.accountCode}</td>
                          <td className="py-1 pr-2 text-neutral-600">
                            {l.description}
                          </td>
                          <td className="py-1 pr-2 text-right font-mono">
                            {l.debit ? formatRupiah(l.debit) : ""}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {l.credit ? formatRupiah(l.credit) : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                    <span>
                      Nilai tercatat: {formatRupiah(preview.carryingBefore)} →{" "}
                      <strong className="text-neutral-900">
                        {formatRupiah(preview.carryingAfter)}
                      </strong>
                    </span>
                    {preview.surplusCredit > 0 ? (
                      <span>
                        Ke ekuitas (Surplus Revaluasi):{" "}
                        {formatRupiah(preview.surplusCredit)}
                      </span>
                    ) : null}
                    {preview.surplusDebit > 0 ? (
                      <span>
                        Menggerus surplus: {formatRupiah(preview.surplusDebit)}
                      </span>
                    ) : null}
                    {preview.plLoss > 0 ? (
                      <span className="text-danger-600">
                        Masuk rugi: {formatRupiah(preview.plLoss)}
                      </span>
                    ) : null}
                    {preview.plGain > 0 ? (
                      <span className="text-success-500">
                        Masuk pendapatan: {formatRupiah(preview.plGain)}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}

              {preview.warnings.length > 0 ? (
                <div className="space-y-1 rounded-md border border-warning-500/50 bg-warning-100/40 p-3">
                  {preview.warnings.map((w, i) => (
                    <p
                      key={i}
                      className="flex items-start gap-2 text-xs text-neutral-700"
                    >
                      <Info className="mt-0.5 size-3.5 shrink-0 text-warning-500" />
                      {w}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {error ? (
            <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-600">
              {error}
            </div>
          ) : null}

          {ctx.history.length > 0 ? (
            <div className="rounded-md border border-neutral-200">
              <p className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                <History className="size-3.5" /> Riwayat penilaian
              </p>
              <ul className="divide-y divide-neutral-100">
                {ctx.history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 px-3 py-2">
                    <div className="flex-1">
                      <p className="text-xs text-neutral-900">
                        <span className="font-medium">
                          {VALUATION_KINDS.find((k) => k.value === h.kind)
                            ?.label ?? h.kind}
                        </span>{" "}
                        · {h.effectiveDate} ·{" "}
                        {formatRupiah(h.carryingBefore)} →{" "}
                        {formatRupiah(h.carryingAfter)}
                        {h.journalEntryNumber ? (
                          <span className="ml-1 font-mono text-[11px] text-neutral-500">
                            {h.journalEntryNumber}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-neutral-500">{h.reason}</p>
                      {h.reversedAt ? (
                        <Badge variant="neutral">Dibatalkan</Badge>
                      ) : null}
                    </div>
                    {h.cancellable ? (
                      <button
                        type="button"
                        onClick={() => onCancelValuation(h.id)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100"
                      >
                        <Undo2 className="size-3.5" /> Batalkan
                      </button>
                    ) : h.reversedAt ? null : (
                      <span
                        className="max-w-[12rem] text-right text-[10px] text-neutral-400"
                        title={h.cancelBlockedReason ?? ""}
                      >
                        {h.cancelBlockedReason}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
