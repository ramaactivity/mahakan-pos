"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReceiptText, Trophy, Users2, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { getDailySalesReport, getTargetProgress, isOk } from "@/features/reports";
import { getTodayAttendanceStatus } from "@/features/attendance/actions";
import { TargetProgressCard } from "@/features/reports/components/TargetProgressCard";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62ah — POS-side dashboard sederhana untuk kasir.
 *
 * Tujuan: kasir bisa lihat progress harian + target supaya termotivasi.
 * Berbeda dengan BO Dashboard yang detail (HPP, accounting, dst) — view
 * ini ringkas: target progress, omzet hari ini, transaksi count, tim
 * on-floor. Tidak ada navigasi ke admin pages (kasir tidak punya akses).
 *
 * Tablet-first layout (Galaxy A7 Lite 1340×800): 2-col grid landscape,
 * stack di portrait/mobile.
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
      <div className="space-y-4 p-4 sm:p-6">
        <Skeleton className="h-7 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
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
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <header>
          <h1 className="text-xl font-bold text-mahakan-green-900 sm:text-2xl">
            Halo, {cashierName} 👋
          </h1>
          <p className="text-xs text-neutral-600 sm:text-sm">{todayLabel}</p>
        </header>

        {/* Hero: Target Pendapatan */}
        {target ? (
          <TargetProgressCard data={target} showRupiah />
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
            Target pendapatan belum di-set. Hubungi owner untuk konfigurasi.
          </div>
        )}

        {/* Stats row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        {/* Top 5 menu hari ini */}
        {report && report.topItems.length > 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 flex items-center gap-1.5 font-semibold text-neutral-900">
              <Trophy className="size-4 text-amber-500" /> Top 5 Menu Hari Ini
            </h3>
            <ul className="space-y-2">
              {report.topItems.slice(0, 5).map((item, idx) => (
                <li
                  key={item.menuItemId}
                  className="flex items-center justify-between border-b border-neutral-100 pb-2 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs font-bold",
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
                    <span className="text-sm font-medium text-neutral-900">
                      {item.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-neutral-900">
                      {item.quantity}×
                    </p>
                    <p className="text-[10px] text-neutral-500">
                      {formatRupiah(item.revenue)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="pt-2 text-center text-[11px] text-neutral-500">
          Data live · refresh otomatis tiap 1 menit
        </p>
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
        "rounded-lg border p-3",
        tone === "primary"
          ? "border-mahakan-green-700/30 bg-gradient-to-br from-mahakan-green-50 to-white"
          : "border-neutral-200 bg-white",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
        <Icon className="size-3.5 text-mahakan-green-700" /> {label}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-neutral-900 sm:text-xl">
        {value}
      </p>
      <p className="text-[11px] text-neutral-600">{sub}</p>
    </div>
  );
}
