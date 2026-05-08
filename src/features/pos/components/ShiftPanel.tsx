"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Clock,
  Lock,
  Receipt,
  RotateCcw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@/components/ui";
import type { Shift } from "@/features/shifts";
import { listTransactions, isOk } from "@/features/transactions";
import { CashOnHandTile } from "@/features/admin/sections/finance/CashOnHandTile";
import { formatRupiah } from "@/lib/format";
import { formatIndonesianTime } from "@/lib/date";

interface ShiftPanelProps {
  shift: Shift | null;
  loading: boolean;
  onRequestOpenShift: () => void;
  onRequestCloseShift: () => void;
}

interface ShiftStats {
  paidCount: number;
  voidCount: number;
  refundCount: number;
  totalRevenue: number;
  cashRevenue: number;
  qrisRevenue: number;
  cardRevenue: number;
  recentPaid: Array<{
    id: string;
    transactionNumber: string;
    paymentMethod: string;
    total: number;
    createdAt: string;
  }>;
}

/** Format duration like "2 jam 14 menit" or "23 menit" or "kurang 1 menit". */
function formatDuration(start: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - start.getTime());
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "Baru saja";
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min} menit`;
  if (min === 0) return `${hours} jam`;
  return `${hours} jam ${min} menit`;
}

/**
 * Shift tab — sesi AD-8 polish.
 *
 * Added live shift stats: duration ticker, transaction count + revenue
 * breakdown by payment method, recent 3 paid transactions. Kasir punya
 * snapshot lengkap shift mereka sebelum tutup.
 *
 * Layout:
 *   - Cash on Hand widget (Owner/Manager only via permission gate)
 *   - Active shift hero card: duration + opening cash + quick stats
 *   - Sales breakdown card: tunai/qris/card/voids
 *   - Recent transactions card: last 3 paid trx
 *   - Tutup Shift button (sticky bottom)
 */
export function ShiftPanel({
  shift,
  loading,
  onRequestOpenShift,
  onRequestCloseShift,
}: ShiftPanelProps) {
  const [stats, setStats] = useState<ShiftStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  // Live duration ticker — update every 30s
  useEffect(() => {
    if (!shift) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [shift]);

  // Load stats per shift change
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!shift) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listTransactions({
        shiftId: shift.id,
        limit: 1000,
      });
      if (cancelled) return;
      if (!isOk(res)) {
        setStatsLoading(false);
        return;
      }
      const items = res.data.items;
      const paid = items.filter((t) => t.status === "paid");
      const voided = items.filter((t) => t.status === "voided");
      const refunded = items.filter((t) => t.status === "refunded");

      const sum = (
        list: typeof paid,
        method: string,
      ) =>
        list
          .filter((t) => t.paymentMethod === method)
          .reduce((s, t) => s + t.total, 0);

      const cashRevenue = sum(paid, "cash");
      const qrisRevenue = sum(paid, "qris");
      const cardRevenue = paid
        .filter((t) =>
          ["card_bca", "card_bni", "card_mandiri", "card_bri", "card_other"]
            .includes(t.paymentMethod),
        )
        .reduce((s, t) => s + t.total, 0);

      setStats({
        paidCount: paid.length,
        voidCount: voided.length,
        refundCount: refunded.length,
        totalRevenue: paid.reduce((s, t) => s + t.total, 0),
        cashRevenue,
        qrisRevenue,
        cardRevenue,
        recentPaid: paid
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime(),
          )
          .slice(0, 3)
          .map((t) => ({
            id: t.id,
            transactionNumber: t.transactionNumber,
            paymentMethod: t.paymentMethod,
            total: t.total,
            createdAt: t.createdAt as unknown as string,
          })),
      });
      setStatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [shift]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6">
        <header>
          <h2 className="text-lg font-semibold text-neutral-900">Shift</h2>
          <p className="text-sm text-neutral-700">
            Manage opening &amp; closing kas. Tidak bisa transaksi tanpa shift
            aktif.
          </p>
        </header>

        <CashOnHandTile />

        <Card>
          <CardHeader>
            <CardTitle>Shift Belum Dibuka</CardTitle>
            <CardDescription>
              Buka shift dulu — input kas awal yang ada di laci sebelum mulai
              transaksi.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" onClick={onRequestOpenShift}>
              Buka Shift
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const duration = formatDuration(new Date(shift.openedAt), now);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Shift Aktif</h2>
          <p className="text-sm text-neutral-700">
            Snapshot shift kamu — pantau penjualan + kas sebelum tutup.
          </p>
        </div>
        <Button
          size="lg"
          variant="destructive"
          onClick={onRequestCloseShift}
        >
          <Lock className="size-4" aria-hidden /> Tutup Shift
        </Button>
      </header>

      <CashOnHandTile />

      {/* Hero: duration + opening cash + paid count + total revenue */}
      <Card variant="emphasis">
        <CardContent className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet
                className="size-5 text-mahakan-green-700"
                aria-hidden
              />
              <span className="text-sm font-semibold text-mahakan-green-900">
                Mulai {formatIndonesianTime(shift.openedAt)} WIB
              </span>
            </div>
            <Badge variant="success">
              <Clock className="size-3.5" aria-hidden /> {duration}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={<Wallet className="size-4" aria-hidden />}
              label="Kas Awal"
              value={formatRupiah(shift.openingCash)}
              tone="muted"
            />
            <Stat
              icon={<Receipt className="size-4" aria-hidden />}
              label="Transaksi"
              value={
                statsLoading
                  ? "…"
                  : stats
                    ? `${stats.paidCount}`
                    : "—"
              }
              tone="default"
            />
            <Stat
              icon={<TrendingUp className="size-4" aria-hidden />}
              label="Total Revenue"
              value={
                statsLoading
                  ? "…"
                  : stats
                    ? formatRupiah(stats.totalRevenue)
                    : "—"
              }
              tone="emphasis"
            />
            <Stat
              icon={<Activity className="size-4" aria-hidden />}
              label="Status"
              value={(
                <Badge variant="success">Aktif</Badge>
              )}
              tone="default"
            />
          </dl>
        </CardContent>
      </Card>

      {/* Sales breakdown */}
      {stats ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Breakdown Penjualan</CardTitle>
            <CardDescription>
              Per metode pembayaran selama shift ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-5 pb-4">
            <SalesRow
              label="Tunai"
              value={stats.cashRevenue}
              count={
                stats.paidCount > 0
                  ? Math.round(
                      (stats.cashRevenue / Math.max(stats.totalRevenue, 1)) *
                        stats.paidCount,
                    )
                  : 0
              }
              showCount={false}
            />
            <SalesRow label="QRIS" value={stats.qrisRevenue} showCount={false} />
            <SalesRow
              label="Kartu (EDC)"
              value={stats.cardRevenue}
              showCount={false}
            />
            {stats.voidCount > 0 ? (
              <SalesRow
                label={`Void (${stats.voidCount}×)`}
                value={0}
                tone="warning"
                showCount={false}
              />
            ) : null}
            {stats.refundCount > 0 ? (
              <SalesRow
                label={`Refund (${stats.refundCount}×)`}
                value={0}
                tone="warning"
                showCount={false}
              />
            ) : null}
            <div className="border-t border-dashed border-neutral-200 pt-2">
              <SalesRow
                label="Total Revenue"
                value={stats.totalRevenue}
                bold
                showCount={false}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Recent transactions */}
      {stats && stats.recentPaid.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transaksi Terakhir</CardTitle>
            <CardDescription>
              {stats.recentPaid.length} transaksi terbaru selama shift ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <ul className="divide-y divide-neutral-100">
              {stats.recentPaid.map((trx) => (
                <li
                  key={trx.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-neutral-700">
                      {trx.transactionNumber}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-neutral-600">
                      {prettyMethod(trx.paymentMethod)}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {formatRupiah(trx.total)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : statsLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center px-5 py-8">
            <Spinner className="size-5 text-mahakan-green-700" />
          </CardContent>
        </Card>
      ) : null}

      {/* Empty state when no transactions yet */}
      {stats && stats.paidCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-5 py-8 text-center">
            <RotateCcw
              className="size-8 text-neutral-400"
              aria-hidden
            />
            <p className="text-sm font-semibold text-neutral-900">
              Belum ada transaksi
            </p>
            <p className="max-w-md text-xs text-neutral-700">
              Buat order pertama dari tab <strong>Kasir</strong> untuk mulai
              mencatat penjualan di shift ini.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: "muted" | "default" | "emphasis";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
        {icon}
        {label}
      </div>
      <div
        className={
          tone === "muted"
            ? "text-sm font-mono text-neutral-700"
            : tone === "emphasis"
              ? "text-base font-mono font-bold text-mahakan-green-900"
              : "text-sm font-mono font-semibold text-neutral-900"
        }
      >
        {value}
      </div>
    </div>
  );
}

function SalesRow({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: number;
  count?: number;
  bold?: boolean;
  tone?: "default" | "warning";
  showCount?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between text-sm " +
        (bold ? "font-semibold text-neutral-900" : "text-neutral-700") +
        (tone === "warning" ? " text-warning-500" : "")
      }
    >
      <span>{label}</span>
      <span className="font-mono">
        {value > 0 ? formatRupiah(value) : "—"}
      </span>
    </div>
  );
}

function prettyMethod(m: string): string {
  switch (m) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "Kartu BCA";
    case "card_bni":
      return "Kartu BNI";
    case "card_mandiri":
      return "Kartu Mandiri";
    case "card_bri":
      return "Kartu BRI";
    case "card_other":
      return "Kartu Lainnya";
    case "split":
      return "Split";
    default:
      return m;
  }
}
