"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Scale,
  TrendingUp,
} from "lucide-react";
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
  getSalesRangeReport,
  getTargetProgress,
  isOk,
} from "@/features/reports";
import { TargetProgressCard } from "@/features/reports/components/TargetProgressCard";
import { getTodayAttendanceStatus } from "@/features/attendance/actions";
import { listPayrollPeriods } from "@/features/payroll/actions";
import type { PayrollPeriodWithStats } from "@/features/payroll/types";
import { listExpiringDocuments } from "@/features/employees/actions";
import type { ExpiringDocument } from "@/features/employees/queries";
import {
  fetchBalanceSheet,
  fetchIncomeStatement,
} from "@/features/accounting/actions";
import type {
  BalanceSheetReport,
  IncomeStatementReport,
} from "@/features/accounting/reports";
import { formatRupiah } from "@/lib/format";
import { paymentMethodLabel } from "@/lib/payment-method";
import type { AdminSection } from "@/features/admin/components/AdminLeftNav";
import { setHrOperationsInitialTab } from "./HrOperationsSection";
import { setReportsInitialTab } from "./ReportsSection";
import { OpnameMonthlyBanner } from "./inventory/opname/OpnameMonthlyBanner";
import { useCashDepositDashboard } from "@/features/finance/useCashDepositDashboard";
import { hasPermission } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import {
  currentMonthWib,
  isFutureMonth,
  monthRange,
  shiftMonth,
} from "./dashboard-month";

interface DashboardHomeProps {
  /* Sesi AE-123 — accept full user (role dipakai untuk RBAC banner). */
  user: { name: string; role: string };
  onNavigate?: (section: AdminSection) => void;
}

export function DashboardHome({ user, onNavigate }: DashboardHomeProps) {
  /* Sesi AE-222 — dashboard tidak lagi terkunci di bulan berjalan.
   *
   * Begitu tanggal berganti bulan, seluruh angka bulan kemarin dulu lenyap
   * dari layar dan owner harus membuka modul Laporan/Akuntansi satu per satu.
   * Sekarang bulannya bisa digeser, dan SEMUA kartu yang memang bulanan ikut
   * bergeser bersamaan — bukan cuma satu kartu. */
  const currentMonth = useMemo(() => currentMonthWib(), []);
  const [month, setMonth] = useState(currentMonth);
  const isCurrentMonth = month === currentMonth;
  const mtdRange = useMemo(() => monthRange(month), [month]);

  // 6 independent queries — each cached separately by TanStack Query.
  // Failures don't deadlock the dashboard (mimics old Promise.allSettled
  // behavior); each section just shows null/empty state.
  const reportQuery = useQuery({
    queryKey: ["admin", "dashboard", "daily-sales"],
    queryFn: async () => {
      const res = await getDailySalesReport();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000, // 1min — kasir rotates throughout day
    enabled: isCurrentMonth,
  });

  /* Bulan lampau: angka penjualan diambil se-BULAN, bukan "hari ini" — kartu
   * "Omzet Hari Ini" di sebelah Neraca bulan Agustus hanya akan menyesatkan.
   * Bentuk `metrics`-nya sama persis dengan laporan harian, jadi kartu yang
   * sama bisa dipakai ulang tanpa cabang di tiap tempat. */
  const monthSalesQuery = useQuery({
    queryKey: ["admin", "dashboard", "sales-range", mtdRange.fromDate, mtdRange.toDate],
    queryFn: async () => {
      const res = await getSalesRangeReport(mtdRange.fromDate, mtdRange.toDate);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: !isCurrentMonth,
    staleTime: 5 * 60 * 1000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["admin", "dashboard", "attendance-today"],
    queryFn: async () => {
      const res = await getTodayAttendanceStatus();
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // 2min — BO tidak butuh real-time absensi (AE-63 audit P1.3)
    enabled: isCurrentMonth,
  });

  const payrollQuery = useQuery({
    queryKey: ["admin", "dashboard", "active-payroll"],
    queryFn: async () => {
      const res = await listPayrollPeriods();
      if (!res.success) throw new Error(res.error.message);
      return res.data.find((p) => p.status !== "paid") ?? null;
    },
  });

  const docsQuery = useQuery({
    queryKey: ["admin", "dashboard", "expiring-docs"],
    queryFn: async () => {
      const res = await listExpiringDocuments(30);
      if (!res.success) throw new Error(res.error.message);
      return res.data;
    },
  });

  const accountingQuery = useQuery({
    queryKey: ["admin", "dashboard", "income-statement-mtd", mtdRange],
    queryFn: async () => {
      const res = await fetchIncomeStatement({
        fromDate: mtdRange.fromDate,
        toDate: mtdRange.toDate,
        periodLabel: mtdRange.label,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const balanceSheetQuery = useQuery({
    queryKey: ["admin", "dashboard", "balance-sheet-mtd", mtdRange.toDate],
    queryFn: async () => {
      const res = await fetchBalanceSheet(mtdRange.toDate);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const targetQuery = useQuery({
    queryKey: ["admin", "dashboard", "target-progress"],
    queryFn: async () => {
      const res = await getTargetProgress();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const report = reportQuery.data ?? null;
  const monthSales = monthSalesQuery.data ?? null;
  const attendance = attendanceQuery.data ?? null;
  const activePeriod = payrollQuery.data ?? null;
  const expiringDocs = docsQuery.data ?? [];
  const accountingMtd = accountingQuery.data ?? null;
  const balanceSheet = balanceSheetQuery.data ?? null;
  const targetProgress = targetQuery.data ?? null;

  // Match old behavior: single global loading flag = ANY query still loading
  // first time. After cache hit on revisit, all return false instantly →
  // dashboard renders fully without skeleton flash.
  /* react-query v5: `isLoading` = isPending && isFetching, jadi query yang
   * di-disable (mis. laporan harian saat melihat bulan lampau) tidak ikut
   * menahan dashboard di skeleton. */
  const loading =
    reportQuery.isLoading ||
    monthSalesQuery.isLoading ||
    attendanceQuery.isLoading ||
    payrollQuery.isLoading ||
    docsQuery.isLoading ||
    accountingQuery.isLoading ||
    balanceSheetQuery.isLoading;

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

  /* Sumber angka penjualan: laporan HARI INI saat melihat bulan berjalan,
   * laporan SE-BULAN saat melihat bulan lampau. */
  const sales = isCurrentMonth ? report : monthSales;
  if (!sales) {
    return (
      <div className="space-y-4 p-6">
        <MonthSwitcher
          label={mtdRange.label}
          isCurrentMonth={isCurrentMonth}
          canGoNext={!isFutureMonth(shiftMonth(month, 1), currentMonth)}
          onPrev={() => setMonth((m) => shiftMonth(m, -1))}
          onNext={() => setMonth((m) => shiftMonth(m, 1))}
          onToday={() => setMonth(currentMonth)}
        />
        <p className="text-sm text-danger-500">
          Gagal memuat laporan penjualan untuk {mtdRange.label}.
        </p>
      </div>
    );
  }

  const { metrics, byPaymentMethod, topItems } = sales;
  const hourlyDistribution = isCurrentMonth
    ? (report?.hourlyDistribution ?? [])
    : [];
  const perDay = isCurrentMonth ? [] : (monthSales?.byDay ?? []);

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Halo, {user.name}
          </h1>
          <p className="text-sm text-neutral-700">
            {isCurrentMonth
              ? `Ringkasan operasional hari ini · ${report?.date ?? ""}`
              : `Ringkasan bulan ${mtdRange.label} · ${mtdRange.fromDate} → ${mtdRange.toDate}`}
          </p>
        </div>
        <MonthSwitcher
          label={mtdRange.label}
          isCurrentMonth={isCurrentMonth}
          canGoNext={!isFutureMonth(shiftMonth(month, 1), currentMonth)}
          onPrev={() => setMonth((m) => shiftMonth(m, -1))}
          onNext={() => setMonth((m) => shiftMonth(m, 1))}
          onToday={() => setMonth(currentMonth)}
        />
      </header>

      {/* Expiring docs alert — only shown when there are docs expiring/expired */}
      {expiringDocs.length > 0 && onNavigate ? (
        <ExpiringDocsAlert
          docs={expiringDocs}
          onTap={() => onNavigate("employees")}
        />
      ) : null}

      {/* Sesi AE-123 — pending setoran banner. Visible kalau owner punya
       * verify permission + ada pending. Klik → buka SetoranTunai section. */}
      <PendingDepositBanner onNavigate={onNavigate} viewerRole={user.role} />


      {/* Monthly stock opname cadence banner — visible to all roles. */}
      <OpnameMonthlyBanner
        onTap={onNavigate ? () => onNavigate("inventory") : undefined}
      />

      {/* HR widgets — Tim Hari Ini. Sesi AE-222: absensi & payroll adalah
        * keadaan SEKARANG, bukan potret bulan lampau. Menampilkannya di
        * sebelah Neraca bulan Agustus hanya akan menyesatkan. */}
      {isCurrentMonth ? (
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
              onNavigate ? () => onNavigate("hr_operations") : undefined
            }
          />
          <HrPayrollCard
            period={activePeriod}
            onTap={
              onNavigate
                ? () => {
                    setHrOperationsInitialTab("payroll");
                    onNavigate("hr_operations");
                  }
                : undefined
            }
          />
        </div>
      </section>
      ) : null}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={isCurrentMonth ? "Omzet Hari Ini" : `Omzet ${mtdRange.label}`}
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

      {/* Target Pendapatan — sesi AE-62ah/ai. Always-show: kalau belum
       *  ada target → kasih CTA "Set Target" supaya owner tahu fitur ada. */}
      {isCurrentMonth ? (
        targetProgress ? (
          targetProgress.daily.target != null ||
          targetProgress.weekly.target != null ||
          targetProgress.monthly.target != null ? (
            <TargetProgressCard data={targetProgress} showRupiah />
          ) : (
            <TargetEmptyCard
              onTap={
                onNavigate
                  ? () => {
                      setReportsInitialTab("targets");
                      onNavigate("reports");
                    }
                  : undefined
              }
            />
          )
        ) : null
      ) : targetProgress?.monthly.target != null ? (
        /* Sesi AE-222 — bulan lampau: target harian & mingguan tidak relevan,
         * tapi pencapaian bulanannya berguna. Targetnya diberi label jujur:
         * yang tersimpan cuma target yang BERLAKU SEKARANG, bukan target yang
         * dulu dipasang untuk bulan itu. */
        <PastMonthTargetCard
          label={mtdRange.label}
          revenue={metrics.revenue}
          target={targetProgress.monthly.target}
        />
      ) : null}

      {/* Accounting MTD summary — visible kalau ada data ledger */}
      {accountingMtd &&
      (accountingMtd.netRevenue > 0 ||
        accountingMtd.cogs.subtotal > 0 ||
        accountingMtd.expenses.subtotal > 0) ? (
        <AccountingMtdCard
          report={accountingMtd}
          onTap={onNavigate ? () => onNavigate("accounting") : undefined}
        />
      ) : null}

      {/* Balance Sheet snapshot — visible kalau ada data ledger */}
      {balanceSheet &&
      (balanceSheet.totalAssets !== 0 ||
        balanceSheet.totalLiabilities !== 0 ||
        balanceSheet.totalEquity !== 0) ? (
        <BalanceSheetMtdCard
          report={balanceSheet}
          onTap={onNavigate ? () => onNavigate("accounting") : undefined}
        />
      ) : null}

      {/* Hourly chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isCurrentMonth ? "Distribusi Per Jam" : "Penjualan Per Tanggal"}
          </CardTitle>
          <CardDescription>
            {isCurrentMonth
              ? "Penjualan per jam (WIB)"
              : `Penjualan harian sepanjang ${mtdRange.label} (WIB)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Sesi AE-222 — sebaran per JAM cuma bermakna untuk satu hari.
            * Untuk satu bulan penuh, yang berguna adalah per TANGGAL. */}
          {!isCurrentMonth ? (
            perDay.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">
                Tidak ada transaksi di {mtdRange.label}.
              </p>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DB" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#514E45" }}
                      tickFormatter={(d: string) => d.slice(8)}
                      interval="preserveStartEnd"
                      minTickGap={12}
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
                        typeof value === "number"
                          ? formatRupiah(value)
                          : String(value)
                      }
                      labelFormatter={(label) => `Tanggal ${String(label)}`}
                    />
                    <Bar dataKey="revenue" fill="#3D7557" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          ) : hourlyDistribution.length === 0 ? (
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
            <CardDescription>
              Per metode, lunas saja ·{" "}
              {isCurrentMonth ? "hari ini" : mtdRange.label}
            </CardDescription>
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
                      {paymentMethodLabel(row.method)}
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
            <CardDescription>
              Terlaris per kuantitas ·{" "}
              {isCurrentMonth ? "hari ini" : mtdRange.label}
            </CardDescription>
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

function AccountingMtdCard({
  report,
  onTap,
}: {
  report: IncomeStatementReport;
  onTap?: () => void;
}) {
  const isProfit = report.netIncome >= 0;
  return (
    <Card
      variant={onTap ? "interactive" : "default"}
      onClick={onTap}
      className={onTap ? "cursor-pointer" : ""}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="size-4 text-mahakan-green-700" /> Akuntansi
              — {report.periodLabel}
            </CardTitle>
            <CardDescription>
              Ringkasan ledger periode berjalan (auto-update kalau auto-journal
              flag ON)
            </CardDescription>
          </div>
          {onTap ? (
            <ChevronRight
              className="size-5 text-neutral-400"
              aria-hidden
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-4">
          <MtdMetric
            label="Pendapatan Bersih"
            value={formatRupiah(report.netRevenue)}
            tone="positive"
          />
          <MtdMetric
            label="HPP"
            value={`(${formatRupiah(report.cogs.subtotal)})`}
            tone="negative"
          />
          <MtdMetric
            label="Beban Operasional"
            value={`(${formatRupiah(report.expenses.subtotal)})`}
            tone="negative"
          />
          <MtdMetric
            label="Laba / Rugi Bersih"
            value={
              isProfit
                ? formatRupiah(report.netIncome)
                : `(${formatRupiah(Math.abs(report.netIncome))})`
            }
            tone={isProfit ? "emphasis-positive" : "emphasis-negative"}
          />
        </div>
        {!isProfit ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-warning-500">
            <AlertTriangle className="size-3" />
            Periode berjalan rugi bersih — review ledger di tab Akuntansi
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BalanceSheetMtdCard({
  report,
  onTap,
}: {
  report: BalanceSheetReport;
  onTap?: () => void;
}) {
  return (
    <Card
      variant={onTap ? "interactive" : "default"}
      onClick={onTap}
      className={onTap ? "cursor-pointer" : ""}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="size-4 text-mahakan-green-700" /> Neraca —{" "}
              {report.asOfDate}
            </CardTitle>
            <CardDescription>
              Saldo kumulatif semua akun per tanggal hari ini (Aset =
              Liabilitas + Ekuitas)
            </CardDescription>
          </div>
          {onTap ? (
            <ChevronRight
              className="size-5 text-neutral-400"
              aria-hidden
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <MtdMetric
            label="Total Aset"
            value={formatRupiah(report.totalAssets)}
            tone="emphasis-positive"
          />
          <MtdMetric
            label="Total Liabilitas"
            value={formatRupiah(report.totalLiabilities)}
            tone="negative"
          />
          <MtdMetric
            label="Total Ekuitas"
            value={formatRupiah(report.totalEquity)}
            tone="positive"
          />
        </div>
        {report.balanced ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-success-500">
            <CheckCircle2 className="size-3" />
            Balanced — Aset = Liabilitas + Ekuitas
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-danger-500">
            <AlertTriangle className="size-3" />
            Tidak balance — selisih{" "}
            {formatRupiah(
              report.totalAssets -
                (report.totalLiabilities + report.totalEquity),
            )}
            . Cek tab Akuntansi → Validate.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MtdMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative" | "emphasis-positive" | "emphasis-negative";
}) {
  const cls =
    tone === "emphasis-positive"
      ? "text-mahakan-green-700 font-bold"
      : tone === "emphasis-negative"
        ? "text-danger-500 font-bold"
        : tone === "negative"
          ? "text-danger-500"
          : "text-neutral-900";
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-neutral-500">
        {tone.startsWith("emphasis") ? (
          <TrendingUp className="size-3" />
        ) : null}
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-base ${cls}`}>{value}</div>
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

/**
 * Sesi AE-222 — pencapaian bulan lampau terhadap target.
 *
 * Sistem hanya menyimpan target yang BERLAKU SEKARANG, bukan target yang dulu
 * dipasang untuk bulan itu. Itu dinyatakan terang-terangan di kartunya —
 * angka yang terlihat resmi padahal dibandingkan ke patokan yang salah lebih
 * berbahaya daripada tidak menampilkan apa pun.
 */
function PastMonthTargetCard({
  label,
  revenue,
  target,
}: {
  label: string;
  revenue: number;
  target: number;
}) {
  const pct = target > 0 ? Math.round((revenue / target) * 100) : 0;
  const kurang = Math.max(0, target - revenue);
  return (
    <Card>
      <CardContent className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-neutral-900">
            <TrendingUp className="size-4 text-mahakan-green-700" aria-hidden />
            Pencapaian {label}
          </h3>
          <span className="font-mono text-sm font-semibold text-neutral-900">
            {pct}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 100 ? "bg-mahakan-green-700" : "bg-warning-500",
            )}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="font-mono text-neutral-900">
            <strong>{formatRupiah(revenue)}</strong> / {formatRupiah(target)}
          </span>
          <span className="text-neutral-600">
            {kurang > 0 ? `Kurang ${formatRupiah(kurang)}` : "Target tercapai"}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          Dibandingkan dengan target bulanan yang berlaku sekarang — sistem
          tidak menyimpan target lama per bulan.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Sesi AE-222 — penggeser bulan. Bulan di depan sengaja dimatikan: tidak ada
 * datanya, dan tombol yang bisa ditekan tapi selalu kosong lebih membingungkan
 * daripada tombol yang jelas mati.
 */
function MonthSwitcher({
  label,
  isCurrentMonth,
  canGoNext,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  isCurrentMonth: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {!isCurrentMonth ? (
        <button
          type="button"
          onClick={onToday}
          className="rounded-md px-2 py-1.5 text-xs font-semibold text-mahakan-green-700 underline-offset-4 hover:underline"
        >
          Bulan ini
        </button>
      ) : null}
      <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Bulan sebelumnya"
          className="rounded-md p-1.5 text-neutral-700 transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="flex min-w-[9.5rem] items-center justify-center gap-1.5 px-1 text-sm font-semibold text-neutral-900">
          <CalendarDays className="size-4 text-neutral-500" aria-hidden />
          {label}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          aria-label="Bulan berikutnya"
          className="rounded-md p-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* Sesi AE-62ai — empty state card untuk Target Pendapatan kalau belum di-set. */
function TargetEmptyCard({ onTap }: { onTap?: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      className="group w-full rounded-lg border border-dashed border-mahakan-green-700/40 bg-mahakan-green-50/40 p-4 text-left transition-colors hover:bg-mahakan-green-50 disabled:cursor-default disabled:hover:bg-mahakan-green-50/40"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-mahakan-green-100 p-2">
          <TrendingUp className="size-5 text-mahakan-green-700" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-mahakan-green-900">
            Set Target Pendapatan
          </h3>
          <p className="mt-1 text-sm text-neutral-700">
            Belum ada target harian/mingguan/bulanan. Set sekarang supaya
            kasir bisa lihat progress + termotivasi di POS Dashboard.
          </p>
          {onTap ? (
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-mahakan-green-700 group-hover:underline">
              Atur target sekarang <ChevronRight className="size-3.5" />
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* Sesi AE-123 — banner pending setoran tunai untuk DashboardHome. Hanya
 * tampil kalau viewer punya verify permission + ada pending. Klik buka
 * SetoranTunai section. Auto-refresh tiap 60 detik via shared hook. */
function PendingDepositBanner({
  onNavigate,
  viewerRole,
}: {
  onNavigate?: (section: AdminSection) => void;
  viewerRole: string;
}) {
  const canVerify = hasPermission(
    viewerRole as Parameters<typeof hasPermission>[0],
    "cash_deposit.verify",
  );
  const { data } = useCashDepositDashboard();
  if (!canVerify) return null;
  const pendingCount = data?.pendingCount ?? 0;
  const oldestDays = data?.oldestPendingDays ?? null;
  if (pendingCount === 0) return null;
  return (
    <button
      type="button"
      onClick={() => onNavigate?.("setoran_tunai")}
      className={cn(
        "group flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors",
        oldestDays !== null && oldestDays >= 3
          ? "border-danger-300 bg-danger-50 hover:bg-danger-100/50"
          : "border-warning-300 bg-warning-100/60 hover:bg-warning-200/40",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          oldestDays !== null && oldestDays >= 3
            ? "bg-danger-100 text-danger-700"
            : "bg-warning-200 text-warning-700",
        )}
      >
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-neutral-900">
          {pendingCount} setoran tunai menunggu verifikasi
        </p>
        <p className="text-xs text-neutral-700">
          {oldestDays !== null && oldestDays >= 1
            ? `Tertua: ${oldestDays} hari lalu${oldestDays >= 3 ? " — sudah lewat 3 hari, mohon segera review" : ""}`
            : "Pending dibuat hari ini"}
        </p>
      </div>
      <span className="text-xs font-medium text-neutral-700 group-hover:underline">
        Buka →
      </span>
    </button>
  );
}
