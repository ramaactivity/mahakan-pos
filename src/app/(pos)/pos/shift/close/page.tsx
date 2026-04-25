"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  toast,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { isOk, shiftService, transactionService } from "@/mocks/services";
import type { Shift } from "@/mocks/types";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SummaryPreview {
  paid: { count: number; cash: number; qris: number; cardBca: number };
  voided: { count: number; totalAmount: number };
  refunded: { count: number; totalAmount: number };
  expectedCash: number;
}

const VARIANCE_THRESHOLD = 10_000;

export default function CloseShiftPage() {
  const router = useRouter();
  const { session } = useSession();

  const [shift, setShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<SummaryPreview | null>(null);
  const [loading, setLoading] = useState(true);

  const [actualCash, setActualCash] = useState("0");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function load() {
      const userId = session!.user.id;
      const activeRes = await shiftService.getActiveShift(userId);
      if (cancelled) return;
      if (!isOk(activeRes) || !activeRes.data) {
        setLoading(false);
        return;
      }
      setShift(activeRes.data);

      // Aggregate transactions for preview (mocks: read directly, real: server endpoint)
      const trxRes = await transactionService.listTransactions({
        shiftId: activeRes.data.id,
        limit: 1000,
      });
      if (cancelled) return;
      if (isOk(trxRes)) {
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
          expectedCash: activeRes.data.openingCash + paidCash - refundedCash,
        });
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-8 text-mahakan-green-700" />
      </div>
    );
  }

  if (!shift || !summary) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Tidak Ada Shift Aktif</CardTitle>
            <CardDescription>
              Lo gak punya shift yang sedang berjalan. Buka shift dulu di
              dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.replace("/pos")}>Kembali</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  let parsedCash = 0;
  try {
    parsedCash = parseRupiah(actualCash);
  } catch {
    parsedCash = 0;
  }

  const variance = parsedCash - summary.expectedCash;
  const varianceFlag =
    Math.abs(variance) > VARIANCE_THRESHOLD ? "warn" : "ok";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (parsedCash < 0) {
      setError("Kas aktual tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await shiftService.closeShift({
      shiftId: shift!.id,
      userId: session!.user.id,
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

    router.replace("/pos");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/pos"
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Tutup Shift</CardTitle>
          <CardDescription>
            Hitung kas fisik di laci, lalu input untuk verifikasi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            <Row label="Kas Awal" value={formatRupiah(shift.openingCash)} />
            <Row
              label={`Penjualan Tunai (${summary.paid.count} trx)`}
              value={`+ ${formatRupiah(summary.paid.cash)}`}
            />
            <Row
              label={`QRIS`}
              value={formatRupiah(summary.paid.qris)}
              muted
            />
            <Row
              label={`Kartu BCA`}
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

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
              hint="Tulis kalau ada selisih, biar enak audit nanti"
              disabled={submitting}
            />

            {error ? (
              <p role="alert" className="text-sm font-medium text-danger-500">
                {error}
              </p>
            ) : null}

            <Button type="submit" loading={submitting} fullWidth size="lg">
              Tutup Shift
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
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
