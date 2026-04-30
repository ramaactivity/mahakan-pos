"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import {
  getDailySalesReport,
  isOk,
  type DailySalesReport,
} from "@/features/reports";
import { getTodayAttendanceStatus } from "@/features/attendance/actions";
import type { EmployeeAttendanceTodayStatus } from "@/features/attendance/types";
import { listPayrollPeriods } from "@/features/payroll/actions";
import type { PayrollPeriodWithStats } from "@/features/payroll/types";
import { listExpiringDocuments } from "@/features/employees/actions";
import type { ExpiringDocument } from "@/features/employees/queries";
import { formatRupiah } from "@/lib/format";
import type { AdminSection } from "@/features/admin/components/AdminLeftNav";

interface DashboardHomeProps {
  user: { name: string };
  onNavigate?: (section: AdminSection) => void;
}

export function DashboardHome({ user, onNavigate }: DashboardHomeProps) {
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [attendance, setAttendance] = useState<
    EmployeeAttendanceTodayStatus[] | null
  >(null);
  const [activePeriod, setActivePeriod] =
    useState<PayrollPeriodWithStats | null>(null);
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // allSettled so any single action failure doesn't deadlock the loader.
      const [reportSettled, attendanceSettled, payrollSettled, docsSettled] =
        await Promise.allSettled([
          getDailySalesReport(),
          getTodayAttendanceStatus(),
          listPayrollPeriods(),
          listExpiringDocuments(30),
        ]);
      if (cancelled) return;
      if (
        reportSettled.status === "fulfilled" &&
        isOk(reportSettled.value)
      ) {
        setReport(reportSettled.value.data);
      }
      if (
        attendanceSettled.status === "fulfilled" &&
        attendanceSettled.value.success
      ) {
        setAttendance(attendanceSettled.value.data);
      }
      if (
        payrollSettled.status === "fulfilled" &&
        payrollSettled.value.success
      ) {
        const active =
          payrollSettled.value.data.find((p) => p.status !== "paid") ?? null;
        setActivePeriod(active);
      }
      if (
        docsSettled.status === "fulfilled" &&
        docsSettled.value.success
      ) {
        setExpiringDocs(docsSettled.value.data);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Memuat dashboard">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-[320px] w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-danger-500">Gagal load laporan</p>;
  }

  const { metrics, byPaymentMethod, hourlyDistribution, topItems } = report;

  const totalEmployees = attendance?.length ?? 0;
  const onFloor =
    attendance?.filter((a) => a.openRecordId !== null).length ?? 0;
  const done =
    attendance?.filter(
      (a) => a.openRecordId === null && a.hasClosedRecordToday,
    ).length ?? 0;
  const belum = Math.max(0, totalEmployees - onFloor - done);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Halo, {user.name}
        </h1>
        <p className="text-sm text-neutral-700">
          Ringkasan operasional hari ini · {report.date}
        </p>
      </header>

      {/* Expiring docs alert — only shown when there are docs expiring/expired */}
      {expiringDocs.length > 0 && onNavigate ? (
        <ExpiringDocsAlert
          docs={expiringDocs}
          onTap={() => onNavigate("employees")}
        />
      ) : null}

      {/* HR widgets — Tim Hari Ini */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Tim Hari Ini
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <HrAttendanceCard
            total={totalEmployees}
            onFloor={onFloor}
            done={done}
            belum={belum}
            onTap={
              onNavigate ? () => onNavigate("attendance") : undefined
            }
          />
          <HrPayrollCard
            period={activePeriod}
            onTap={onNavigate ? () => onNavigate("payroll") : undefined}
          />
        </div>
      </section>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Omzet Hari Ini"
          value={formatRupiah(metrics.revenue)}
          subtitle={`${metrics.transactionCount} transaksi`}
        />
        <StatCard
          title="Rata-rata Transaksi"
          value={formatRupiah(metrics.averageTicket)}
          subtitle="Per order"
        />
        <StatCard
          title="Void / Refund"
          value={`${metrics.voidedCount} / ${metrics.refundedCount}`}
          subtitle={`${formatRupiah(
            metrics.voidedAmount + metrics.refundedAmount,
          )} total`}
          tone={
            metrics.voidedCount + metrics.refundedCount > 0
              ? "warn"
              : "neutral"
          }
        />
      </div>

      {/* Hourly chart */}
      <Card>
        <CardHeader>
          <CardTitle>Distribusi Per Jam</CardTitle>
          <CardDescription>Penjualan per jam (WIB)</CardDescription>
        </CardHeader>
        <CardContent>
          {hourlyDistribution.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Belum ada transaksi hari ini.
            </p>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DB" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 12, fill: "#514E45" }}
                    tickFormatter={(h) => `${h}:00`}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#514E45" }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "#F2F1EC" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #E5E3DB",
                      fontSize: 12,
                    }}
                    formatter={(value) =>
                      typeof value === "number" ? formatRupiah(value) : String(value)
                    }
                    labelFormatter={(label) => `${String(label)}:00 WIB`}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#3D7557"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment methods + top items */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Breakdown Pembayaran</CardTitle>
            <CardDescription>Per metode (lunas saja)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byPaymentMethod.map((row) => (
                <div
                  key={row.method}
                  className="flex items-center justify-between rounded-md border border-neutral-200 bg-white p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-900">
                      {row.method === "cash"
                        ? "Tunai"
                        : row.method === "qris"
                          ? "QRIS"
                          : "Kartu BCA"}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {row.count} transaksi
                    </p>
                  </div>
                  <p className="font-mono text-sm font-semibold text-neutral-900">
                    {formatRupiah(row.amount)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 10 Item</CardTitle>
            <CardDescription>By quantity terjual</CardDescription>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-neutral-500">
                Belum ada penjualan.
              </p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => (
                  <div
                    key={item.menuItemId}
                    className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mahakan-green-100 text-xs font-bold text-mahakan-green-900">
                        {idx + 1}
                      </span>
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {item.name}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-sm font-semibold text-neutral-900">
                        {item.quantity}×
                      </p>
                      <p className="text-xs text-neutral-500">
                        {formatRupiah(item.revenue)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone = "neutral",
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <Card variant={tone === "warn" ? "default" : "default"}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={`font-mono text-2xl font-bold ${
            tone === "warn" ? "text-warning-500" : "text-neutral-900"
          }`}
        >
          {value}
        </p>
        {subtitle ? (
          <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExpiringDocsAlert({
  docs,
  onTap,
}: {
  docs: ExpiringDocument[];
  onTap: () => void;
}) {
  const today = new Date();
  const expiredCount = docs.filter((d) => {
    if (!d.expiresAt) return false;
    return differenceInCalendarDays(parseISO(d.expiresAt), today) < 0;
  }).length;
  const expiringCount = docs.length - expiredCount;
  const preview = docs.slice(0, 3);

  const tone =
    expiredCount > 0
      ? {
          bg: "bg-danger-100/50",
          border: "border-danger-500/40",
          icon: "text-danger-500",
          text: "text-danger-700",
        }
      : {
          bg: "bg-warning-100/60",
          border: "border-warning-500/40",
          icon: "text-warning-500",
          text: "text-warning-700",
        };

  return (
    <button
      type="button"
      onClick={onTap}
      className={`w-full rounded-xl border ${tone.bg} ${tone.border} p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`mt-0.5 size-5 shrink-0 ${tone.icon}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${tone.text}`}>
            {expiredCount > 0
              ? `${expiredCount} dokumen sudah expire${
                  expiringCount > 0
                    ? ` · ${expiringCount} akan expire ≤30 hari`
                    : ""
                }`
              : `${expiringCount} dokumen akan expire ≤30 hari`}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-neutral-700">
            {preview.map((d) => {
              const daysLeft = d.expiresAt
                ? differenceInCalendarDays(parseISO(d.expiresAt), today)
                : null;
              const stamp =
                daysLeft === null
                  ? ""
                  : daysLeft < 0
                    ? `(${Math.abs(daysLeft)}h lewat)`
                    : daysLeft === 0
                      ? "(hari ini!)"
                      : `(${daysLeft}h lagi)`;
              return (
                <li key={d.id} className="truncate">
                  • {d.employeeFullName} — {d.title} {stamp}
                </li>
              );
            })}
            {docs.length > 3 ? (
              <li className="text-neutral-500">
                + {docs.length - 3} lainnya...
              </li>
            ) : null}
          </ul>
        </div>
        <ChevronRight className="size-4 text-neutral-400" aria-hidden />
      </div>
    </button>
  );
}

function HrAttendanceCard({
  total,
  onFloor,
  done,
  belum,
  onTap,
}: {
  total: number;
  onFloor: number;
  done: number;
  belum: number;
  onTap?: () => void;
}) {
  const interactive = Boolean(onTap);
  const handleClick = () => onTap?.();
  return (
    <Card
      variant={interactive ? "interactive" : "default"}
      onClick={interactive ? handleClick : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      aria-label={interactive ? "Buka tab Absensi" : undefined}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>Absensi Hari Ini</CardDescription>
          {interactive ? (
            <ChevronRight className="size-4 text-neutral-400" aria-hidden />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-neutral-500">
            Belum ada karyawan terdaftar.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <HrMetric label="On Floor" value={onFloor} tone="active" />
            <HrMetric label="Selesai" value={done} tone="done" />
            <HrMetric label="Belum" value={belum} tone="muted" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HrMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "active" | "done" | "muted";
}) {
  const valueClass =
    tone === "active"
      ? "text-mahakan-green-700"
      : tone === "done"
        ? "text-success-500"
        : "text-neutral-500";
  return (
    <div>
      <p className={`font-mono text-2xl font-bold ${valueClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{label}</p>
    </div>
  );
}

function HrPayrollCard({
  period,
  onTap,
}: {
  period: PayrollPeriodWithStats | null;
  onTap?: () => void;
}) {
  const interactive = Boolean(onTap);
  const handleClick = () => onTap?.();
  const statusBadge =
    period?.status === "draft"
      ? { variant: "warning" as const, label: "Draft" }
      : period?.status === "finalized"
        ? { variant: "info" as const, label: "Finalized" }
        : null;
  return (
    <Card
      variant={interactive ? "interactive" : "default"}
      onClick={interactive ? handleClick : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      aria-label={interactive ? "Buka tab Payroll" : undefined}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>Periode Payroll Aktif</CardDescription>
          {interactive ? (
            <ChevronRight className="size-4 text-neutral-400" aria-hidden />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!period ? (
          <p className="text-sm text-neutral-500">
            Belum ada periode aktif.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-neutral-900">
                {period.label}
              </p>
              {statusBadge ? (
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              ) : null}
            </div>
            <p className="text-xs text-neutral-500">
              {period.periodStart} → {period.periodEnd}
            </p>
            <p className="font-mono text-lg font-bold text-neutral-900">
              {formatRupiah(period.netPayTotal)}
            </p>
            <p className="text-xs text-neutral-500">
              {period.lineCount} karyawan
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
