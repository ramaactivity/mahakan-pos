"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReceiptText,
  Trophy,
  Users2,
  Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui";
import { getDailySalesReport, getTargetProgress, isOk } from "@/features/reports";
import { getTodayAttendanceStatus } from "@/features/attendance/actions";
import { TargetProgressCard } from "@/features/reports/components/TargetProgressCard";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62ah/ai — POS Dashboard sederhana untuk kasir, tablet-landscape
 * optimized (Galaxy A7 Lite 1340×800).
 *
 * Layout:
 *  - Greeting header (1 baris)
 *  - Row 1: TargetProgressCard "full" (3-col side-by-side) — full width
 *  - Row 2: 4 StatTiles (2x2 grid mobile, 4 col landscape)
 *  - Row 3: Top 5 menu (kiri) + summary card (kanan) di landscape
 *
 * Minim scroll: fit ke 1 viewport landscape (≈760px usable height).
 */
export function PosDashboardView({
  cashierName,
}: {
  cashierName: string;
}) {
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Jakarta",
      }).format(new Date()),
    [],
  );

  const reportQuery = useQuery({
    queryKey: ["pos", "dashboard", "daily-sales"],
    queryFn: async () => {
      const res = await getDailySalesReport();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const targetQuery = useQuery({
    queryKey: ["pos", "dashboard", "target-progress"],
    queryFn: async () => {
      const res = await getTargetProgress();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["pos", "dashboard", "attendance-today"],
    queryFn: async () => {
      const res = await getTodayAttendanceStatus();
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const loading =
    reportQuery.isLoading ||
    targetQuery.isLoading ||
    attendanceQuery.isLoading;

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-[1200px] space-y-3 p-3 sm:p-4">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const report = reportQuery.data;
  const target = targetQuery.data;
  const attendance = attendanceQuery.data ?? [];
  const onFloor = attendance.filter((a) => a.openRecordId !== null).length;
  const total = attendance.length;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto max-w-[1200px] space-y-3 p-3 sm:p-4 lg:space-y-4 lg:p-5">
        {/* Greeting — kompak, 1 baris di landscape */}
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-mahakan-green-900 sm:text-xl lg:text-2xl">
              Halo, {cashierName} 👋
            </h1>
            <p className="text-[11px] text-neutral-600 sm:text-xs">
              {todayLabel}
            </p>
          </div>
          <p className="hidden text-[10px] text-neutral-500 lg:block">
            Live · refresh tiap 1 menit
          </p>
        </header>

        {/* Hero: Target Pendapatan — sekarang 3-col di lg landscape */}
        {target ? (
          <TargetProgressCard data={target} showRupiah />
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
            Target pendapatan belum di-set. Hubungi owner untuk konfigurasi.
          </div>
        )}

        {/* Stats row — 4 col di landscape, 2 col tablet portrait, 1 col mobile */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatTile
            icon={Wallet}
            label="Omzet Hari Ini"
            value={report ? formatRupiah(report.metrics.revenue) : "—"}
            sub={`${report?.metrics.transactionCount ?? 0} transaksi`}
            tone="primary"
          />
          <StatTile
            icon={ReceiptText}
            label="Rata-rata Order"
            value={report ? formatRupiah(report.metrics.averageTicket) : "—"}
            sub="Per transaksi"
          />
          <StatTile
            icon={Trophy}
            label="Top Menu"
            value={report?.topItems[0]?.name ?? "—"}
            sub={
              report?.topItems[0]
                ? `${report.topItems[0].quantity} terjual`
                : "Belum ada"
            }
          />
          <StatTile
            icon={Users2}
            label="Tim On-Floor"
            value={`${onFloor} / ${total}`}
            sub="Karyawan masuk"
          />
        </div>

        {/* Bottom row: Top 5 menu + Pesanan ringkas SIDE-BY-SIDE di landscape */}
        <div className="grid gap-3 lg:grid-cols-3">
          {/* Top 5 — span 2 col di landscape */}
          {report && report.topItems.length > 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-4 lg:col-span-2">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                <Trophy className="size-4 text-amber-500" /> Top 5 Menu Hari Ini
              </h3>
              <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {report.topItems.slice(0, 5).map((item, idx) => (
                  <li
                    key={item.menuItemId}
                    className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-1 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          idx === 0
                            ? "bg-amber-100 text-amber-700"
                            : idx === 1
                              ? "bg-neutral-200 text-neutral-700"
                              : idx === 2
                                ? "bg-orange-100 text-orange-700"
                                : "bg-neutral-100 text-neutral-600",
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="truncate text-xs font-medium text-neutral-900 sm:text-sm">
                        {item.name}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-bold tabular-nums text-neutral-900 sm:text-sm">
                        {item.quantity}×
                      </p>
                      <p className="text-[9px] text-neutral-500 sm:text-[10px]">
                        {formatRupiah(item.revenue)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-center text-xs text-neutral-500 lg:col-span-2">
              Belum ada transaksi hari ini — mari mulai jualan 🚀
            </div>
          )}

          {/* Breakdown by payment method — sisi kanan landscape */}
          {report && report.byPaymentMethod.length > 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                <Wallet className="size-4 text-mahakan-green-700" /> Pembayaran
              </h3>
              <ul className="space-y-1.5">
                {report.byPaymentMethod.slice(0, 5).map((p) => (
                  <li
                    key={p.method}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="font-medium text-neutral-700">
                      {p.method.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <span className="font-bold tabular-nums text-neutral-900">
                      {formatRupiah(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone?: "primary" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 lg:p-3",
        tone === "primary"
          ? "border-mahakan-green-700/30 bg-gradient-to-br from-mahakan-green-50 to-white"
          : "border-neutral-200 bg-white",
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600 sm:gap-1.5 sm:text-[11px]">
        <Icon className="size-3 text-mahakan-green-700 sm:size-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums text-neutral-900 sm:text-lg lg:text-xl">
        {value}
      </p>
      <p className="text-[10px] text-neutral-600 sm:text-[11px]">{sub}</p>
    </div>
  );
}
