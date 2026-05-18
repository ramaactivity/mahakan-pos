"use client";

import { useEffect, useState } from "react";
import { TrendingDown, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge, Button, Modal, Skeleton, toast } from "@/components/ui";
import {
  postMonthlyDepreciation,
  previewMonthlyDepreciation,
  type DepreciationPreflight,
} from "@/features/accounting/fixed-assets-actions";
import { formatRupiah } from "@/lib/money";

interface Props {
  open: boolean;
  onClose: () => void;
  onPosted: () => void;
}

function defaultTargetMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_OPTIONS = (() => {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  // Past 12 months + current
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("id-ID", { year: "numeric", month: "long" });
    out.push({ value: yyyymm, label });
  }
  return out.reverse();
})();

export function DepreciationModal({ open, onClose, onPosted }: Props) {
  const [targetMonth, setTargetMonth] = useState(defaultTargetMonth());
  const [preflight, setPreflight] = useState<DepreciationPreflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(month: string) {
    setLoading(true);
    setError(null);
    const res = await previewMonthlyDepreciation(month);
    setLoading(false);
    if (res.ok) setPreflight(res.data);
    else {
      toast.error(res.error.message);
      setPreflight(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTargetMonth(defaultTargetMonth());
    setPreflight(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void load(defaultTargetMonth());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(targetMonth);
  }, [targetMonth]);

  async function onSubmit() {
    if (submitting || !preflight) return;
    if (preflight.alreadyPostedThisMonth) {
      setError(`Depresiasi ${preflight.targetMonthLabel} sudah pernah di-post`);
      return;
    }
    const eligible = preflight.assets.filter((a) => !a.alreadyDepreciatedThisMonth && a.monthlyAmount > 0);
    if (eligible.length === 0) {
      setError("Tidak ada aset yang perlu di-depreciate bulan ini");
      return;
    }
    setSubmitting(true);
    const res = await postMonthlyDepreciation(targetMonth);
    setSubmitting(false);
    if (res.ok) {
      toast.success(
        `Depresiasi ${preflight.targetMonthLabel} posted: ${res.data.assetsDepreciated} aset, total ${formatRupiah(preflight.totalAmount)}`,
      );
      onPosted();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hitung Depresiasi Bulanan"
      description="Generate journal entry Dr Beban Penyusutan Cr Akumulasi Penyusutan untuk semua aset aktif. Idempotent — bulan yang sudah di-post di-skip."
      size="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm">
            {preflight ? (
              <>
                <span className="text-neutral-500">Total: </span>
                <span className="font-mono font-semibold">
                  {formatRupiah(preflight.totalAmount)}
                </span>
                <span className="ml-2 text-xs text-neutral-500">
                  ({preflight.assets.filter((a) => !a.alreadyDepreciatedThisMonth && a.monthlyAmount > 0).length} aset eligible)
                </span>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Tutup
            </Button>
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={
                submitting ||
                !preflight ||
                preflight.alreadyPostedThisMonth ||
                preflight.totalAmount === 0
              }
            >
              <TrendingDown className="size-4" /> Post Depresiasi
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">
            Bulan Target
          </label>
          <select
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-1 focus:ring-mahakan-green-700"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            Pilih bulan yang akan di-depreciate. Posted di akhir bulan
            (entry_date = last day of month). Owner biasanya run akhir
            bulan / awal bulan setelahnya.
          </p>
        </div>

        {loading || !preflight ? (
          <Skeleton className="h-32 w-full" />
        ) : preflight.alreadyPostedThisMonth ? (
          <div className="rounded-md border border-warning-500/50 bg-warning-100/40 p-3 text-sm text-warning-500">
            <AlertCircle className="mr-2 inline size-4" />
            Depresiasi {preflight.targetMonthLabel} sudah pernah di-post. Tidak
            dapat di-post ulang (idempotent). Reverse via Jurnal kalau salah.
          </div>
        ) : preflight.assets.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
            Tidak ada aset yang perlu di-depreciate untuk{" "}
            {preflight.targetMonthLabel}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-3 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                    Aset
                  </th>
                  <th className="px-3 py-1.5 text-center text-xs font-medium uppercase text-neutral-500">
                    Bulan ke-
                  </th>
                  <th className="px-3 py-1.5 text-right text-xs font-medium uppercase text-neutral-500">
                    Amount
                  </th>
                  <th className="px-3 py-1.5 text-left text-xs font-medium uppercase text-neutral-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {preflight.assets.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-1.5">{a.name}</td>
                    <td className="px-3 py-1.5 text-center text-xs">
                      {a.monthIndex}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {a.alreadyDepreciatedThisMonth
                        ? "—"
                        : formatRupiah(a.monthlyAmount)}
                    </td>
                    <td className="px-3 py-1.5">
                      {a.alreadyDepreciatedThisMonth ? (
                        <Badge variant="neutral">Sudah</Badge>
                      ) : (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3" /> Eligible
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error ? (
          <div className="rounded-md border border-danger-500/50 bg-danger-100/40 p-3 text-sm text-danger-500">
            <AlertCircle className="mr-2 inline size-4" />
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
