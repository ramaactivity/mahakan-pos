"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Modal,
  NumericInput,
  Spinner,
  toast,
} from "@/components/ui";
import { isOk, closeShift, type Shift } from "@/features/shifts";
import { listTransactions } from "@/features/transactions";
import { getDailyCashSummary } from "@/features/cash";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const VARIANCE_THRESHOLD = 10_000;

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
  /** Galih ask #11: petty-cash recap during the shift (today's day for
   * approximation, since expenses/incomes don't carry shift_id). */
  petty: {
    expensesTotal: number;
    expensesCount: number;
    incomesTotal: number;
    incomesCount: number;
  };
}

interface CloseShiftModalProps {
  open: boolean;
  shift: Shift;
  userId: string;
  onClose: () => void;
  onClosed: () => void;
}

export function CloseShiftModal({
  open,
  shift,
  onClose,
  onClosed,
}: CloseShiftModalProps) {
  const [summary, setSummary] = useState<SummaryPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [actualCash, setActualCash] = useState("0");
  const [notes, setNotes] = useState("");
  const [edc, setEdc] = useState("");
  const [gofood, setGofood] = useState("");
  const [grabfood, setGrabfood] = useState("");
  const [shopeefood, setShopeefood] = useState("");
  const [handoverMessage, setHandoverMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setActualCash("0");
    setNotes("");
    setEdc("");
    setGofood("");
    setGrabfood("");
    setShopeefood("");
    setHandoverMessage("");
    setError(null);
    setSubmitting(false);

    async function load() {
      const [trxRes, cashRes] = await Promise.all([
        listTransactions({ shiftId: shift.id, limit: 1000 }),
        getDailyCashSummary(),
      ]);
      if (cancelled) return;
      if (!isOk(trxRes)) {
        setLoading(false);
        return;
      }
      const items = trxRes.data.items;
      const paid = items.filter((t) => t.status === "paid");
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const paidCash = paid
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);
      const refundedCash = refunded
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);

      const cashSummary = isOk(cashRes) ? cashRes.data : null;

      setSummary({
        paid: {
          count: paid.length,
          cash: paidCash,
          qris: paid
            .filter((t) => t.paymentMethod === "qris")
            .reduce((s, t) => s + t.total, 0),
          cardBca: paid
            .filter((t) => t.paymentMethod === "card_bca")
            .reduce((s, t) => s + t.total, 0),
        },
        voided: {
          count: voided.length,
          totalAmount: voided.reduce((s, t) => s + t.total, 0),
        },
        refunded: {
          count: refunded.length,
          totalAmount: refunded.reduce((s, t) => s + t.total, 0),
        },
        expectedCash: shift.openingCash + paidCash - refundedCash,
        petty: {
          expensesTotal: cashSummary?.expenses.total ?? 0,
          expensesCount:
            cashSummary?.expenses.byCategory.reduce(
              (s, c) => s + c.count,
              0,
            ) ?? 0,
          incomesTotal: cashSummary?.income.manual.total ?? 0,
          incomesCount: cashSummary?.income.manual.count ?? 0,
        },
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, shift]);

  let parsedCash = 0;
  try {
    parsedCash = parseRupiah(actualCash);
  } catch {
    parsedCash = 0;
  }

  const variance = summary ? parsedCash - summary.expectedCash : 0;
  const varianceFlag =
    Math.abs(variance) > VARIANCE_THRESHOLD ? "warn" : "ok";

  async function onSubmit() {
    if (submitting || !summary) return;
    if (parsedCash < 0) {
      setError("Kas aktual tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const tryParse = (s: string): number | null => {
      const trimmed = s.trim();
      if (trimmed.length === 0) return null;
      try {
        const n = parseRupiah(trimmed);
        return n >= 0 ? n : null;
      } catch {
        return null;
      }
    };

    const res = await closeShift({
      shiftId: shift.id,
      actualCash: parsedCash,
      notes: notes.trim() || null,
      handoverMessage: handoverMessage.trim() || null,
      edcSettlement: tryParse(edc),
      gofoodSettlement: tryParse(gofood),
      grabfoodSettlement: tryParse(grabfood),
      shopeefoodSettlement: tryParse(shopeefood),
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    if (variance < 0) {
      toast.warning(`Selisih minus ${formatRupiah(Math.abs(variance))}`);
    } else if (variance > 0) {
      toast.info(`Selisih plus ${formatRupiah(variance)}`);
    } else {
      toast.success("Shift ditutup, kas pas!");
    }
    onClosed();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tutup Shift"
      description="Hitung kas fisik di laci, lalu input untuk verifikasi."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={loading}
            size="lg"
          >
            Tutup Shift
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : !summary ? (
        <p className="text-sm text-danger-500">Gagal load summary</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            <Row label="Kas Awal" value={formatRupiah(shift.openingCash)} />
            <Row
              label={`Penjualan Tunai (${summary.paid.count} trx)`}
              value={`+ ${formatRupiah(summary.paid.cash)}`}
            />
            <Row label="QRIS" value={formatRupiah(summary.paid.qris)} muted />
            <Row
              label="Kartu BCA"
              value={formatRupiah(summary.paid.cardBca)}
              muted
            />
            {summary.voided.count > 0 ? (
              <Row
                label={`Void (${summary.voided.count} trx)`}
                value={formatRupiah(summary.voided.totalAmount)}
                muted
              />
            ) : null}
            {summary.refunded.count > 0 ? (
              <Row
                label={`Refund Tunai (${summary.refunded.count} trx)`}
                value={`- ${formatRupiah(summary.refunded.totalAmount)}`}
              />
            ) : null}
            <div className="my-2 border-t border-dashed border-neutral-200" />
            <Row
              label="Kas Harusnya"
              value={formatRupiah(summary.expectedCash)}
              bold
            />
          </div>

          <NumericInput
            label="Kas Aktual (hitung manual)"
            value={actualCash}
            onChange={setActualCash}
            prefix="Rp"
            hint={`Preview: ${formatRupiah(parsedCash)}`}
            required
            disabled={submitting}
          />

          {parsedCash > 0 ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg p-3 text-sm font-medium",
                variance === 0
                  ? "bg-success-100 text-success-500"
                  : varianceFlag === "warn"
                    ? "bg-danger-100 text-danger-500"
                    : "bg-warning-100 text-warning-500",
              )}
            >
              {variance === 0 ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <AlertTriangle className="size-5" />
              )}
              <span>
                Selisih:{" "}
                <span className="font-mono font-bold">
                  {variance >= 0 ? "+" : ""}
                  {formatRupiah(variance)}
                </span>
                {varianceFlag === "warn" ? (
                  <Badge variant="danger" className="ml-2">
                    Di luar batas Rp{" "}
                    {VARIANCE_THRESHOLD.toLocaleString("id-ID")}
                  </Badge>
                ) : null}
              </span>
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm font-semibold text-neutral-900">
              Settlement Channel (opsional)
            </p>
            <p className="text-xs text-neutral-500">
              Total expected dari masing-masing channel hari ini. Diisi
              kalau outlet pakai EDC / aggregator online — kosongkan kalau
              gak relevan.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumericInput
                label="EDC (BCA card)"
                value={edc}
                onChange={setEdc}
                prefix="Rp"
                hint={summary.paid.cardBca > 0
                  ? `POS catat: ${formatRupiah(summary.paid.cardBca)}`
                  : undefined}
                disabled={submitting}
              />
              <NumericInput
                label="GoFood"
                value={gofood}
                onChange={setGofood}
                prefix="Rp"
                disabled={submitting}
              />
              <NumericInput
                label="GrabFood"
                value={grabfood}
                onChange={setGrabfood}
                prefix="Rp"
                disabled={submitting}
              />
              <NumericInput
                label="ShopeeFood"
                value={shopeefood}
                onChange={setShopeefood}
                prefix="Rp"
                disabled={submitting}
              />
            </div>
          </div>

          {summary.petty.expensesCount > 0 || summary.petty.incomesCount > 0 ? (
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-sm font-semibold text-neutral-900">
                Petty Cash Hari Ini
              </p>
              {summary.petty.incomesCount > 0 ? (
                <Row
                  label={`Pemasukan (${summary.petty.incomesCount}x)`}
                  value={`+ ${formatRupiah(summary.petty.incomesTotal)}`}
                />
              ) : null}
              {summary.petty.expensesCount > 0 ? (
                <Row
                  label={`Pengeluaran (${summary.petty.expensesCount}x)`}
                  value={`- ${formatRupiah(summary.petty.expensesTotal)}`}
                />
              ) : null}
              <p className="text-xs text-neutral-500">
                Catatan otomatis dari Petty Cash di tab Pengaturan.
              </p>
            </div>
          ) : null}

          <Input
            label="Catatan (opsional)"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Misal: kembalian kurang pas"
            disabled={submitting}
          />

          <div>
            <label className="block text-sm font-medium text-neutral-900">
              Pesan untuk Shift Berikutnya (opsional)
            </label>
            <textarea
              value={handoverMessage}
              onChange={(e) => setHandoverMessage(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              placeholder="Misal: kopi house blend habis, supplier pesan besok pagi"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Tampil saat kasir buka shift selanjutnya di outlet ini.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        muted ? "text-neutral-500" : "text-neutral-900",
        bold ? "text-base font-semibold" : "",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
