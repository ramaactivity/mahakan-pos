"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, Button, Input, Modal, Spinner, toast } from "@/components/ui";
import { isOk, closeShift, type Shift } from "@/features/shifts";
import { listTransactions } from "@/features/transactions";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const VARIANCE_THRESHOLD = 10_000;

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setActualCash("0");
    setNotes("");
    setError(null);
    setSubmitting(false);

    async function load() {
      const res = await listTransactions({
        shiftId: shift.id,
        limit: 1000,
      });
      if (cancelled || !isOk(res)) {
        if (!cancelled) setLoading(false);
        return;
      }
      const items = res.data.items;
      const paid = items.filter((t) => t.status === "paid");
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const paidCash = paid
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);
      const refundedCash = refunded
        .filter((t) => t.paymentMethod === "cash")
        .reduce((s, t) => s + t.total, 0);

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

    const res = await closeShift({
      shiftId: shift.id,
      actualCash: parsedCash,
      notes: notes.trim() || null,
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

          <Input
            label="Kas Aktual (hitung manual)"
            type="text"
            inputMode="numeric"
            value={actualCash}
            onChange={(e) =>
              setActualCash(e.target.value.replace(/[^\d]/g, ""))
            }
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

          <Input
            label="Catatan (opsional)"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Misal: kembalian kurang pas"
            disabled={submitting}
          />

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
