"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DateRangePicker,
  EmptyCard,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  exportAttendanceCsv,
  exportPayrollCsv,
  getAttendanceSummary,
  isOk as hrIsOk,
  type AttendanceSummary,
} from "@/features/hr-reports";
import {
  isOk as payrollIsOk,
  listPayrollPeriods,
  type PayrollPeriodWithStats,
  type PayrollStatus,
} from "@/features/payroll";
import { todayWibIso } from "@/features/cash/helpers";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<PayrollStatus, { variant: "warning" | "info" | "success"; label: string }> =
  {
    draft: { variant: "warning", label: "Draft" },
    finalized: { variant: "info", label: "Finalized" },
    paid: { variant: "success", label: "Paid" },
  };

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function startOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function downloadCsv(filename: string, csv: string) {
  // BOM so Excel decodes UTF-8 correctly. Common gotcha for ID locale.
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Tab = "attendance" | "payroll";

export function HrReportsSection() {
  const [tab, setTab] = useState<Tab>("attendance");
  const [from, setFrom] = useState<string>(() => startOfMonthIso());
  const [to, setTo] = useState<string>(() => todayWibIso());
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exportingAttendance, setExportingAttendance] = useState(false);
  const [exportingPayroll, setExportingPayroll] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [periods, setPeriods] = useState<PayrollPeriodWithStats[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);

  useEffect(() => {
    if (tab !== "attendance") return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSummaryLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await getAttendanceSummary({ from, to });
      if (cancelled) return;
      if (hrIsOk(res)) setSummary(res.data);
      setSummaryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, from, to, refreshKey]);

  useEffect(() => {
    if (tab !== "payroll") return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPeriodsLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const res = await listPayrollPeriods();
      if (cancelled) return;
      if (payrollIsOk(res)) setPeriods(res.data);
      setPeriodsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, refreshKey]);

  async function handleExportAttendance() {
    if (exportingAttendance) return;
    setExportingAttendance(true);
    const res = await exportAttendanceCsv({ from, to });
    setExportingAttendance(false);
    if (!hrIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    downloadCsv(res.data.filename, res.data.csv);
    toast.success("CSV diunduh");
  }

  async function handleExportPayroll(periodId: string, label: string) {
    if (exportingPayroll) return;
    setExportingPayroll(periodId);
    const res = await exportPayrollCsv(periodId);
    setExportingPayroll(null);
    if (!hrIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    downloadCsv(res.data.filename, res.data.csv);
    toast.success(`CSV ${label} diunduh`);
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <BarChart3 className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Laporan HR
            </h1>
            <p className="text-sm text-neutral-600">
              Ringkasan absensi + payroll history. Export CSV untuk
              akuntan / aplikasi gaji.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "attendance" ? undefined : "outline"}
            onClick={() => setTab("attendance")}
          >
            Absensi
          </Button>
          <Button
            variant={tab === "payroll" ? undefined : "outline"}
            onClick={() => setTab("payroll")}
          >
            Payroll History
          </Button>
        </div>
      </header>

      {tab === "attendance" ? (
        <Card>
          <CardContent className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-72">
                <DateRangePicker
                  label="Rentang Tanggal"
                  size="sm"
                  value={{ from, to }}
                  onChange={(v) => {
                    setFrom(v.from ?? from);
                    setTo(v.to ?? to);
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={summaryLoading}
              >
                <RefreshCw className="size-3.5" aria-hidden /> Refresh
              </Button>
              <div className="ml-auto">
                <Button
                  onClick={handleExportAttendance}
                  loading={exportingAttendance}
                >
                  <Download className="size-4" aria-hidden /> Export CSV
                </Button>
              </div>
            </div>

            {summaryLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !summary ? (
              <p className="text-sm text-danger-500">Gagal load summary</p>
            ) : summary.rows.length === 0 ? (
              <EmptyCard
                icon={Users}
                title="Belum ada karyawan"
                description="Tambahkan karyawan dengan status aktif di tab Karyawan dulu."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2 text-right">Hari Kerja</th>
                      <th className="px-4 py-2 text-right">Total Kerja</th>
                      <th className="px-4 py-2 text-right">Telat</th>
                      <th className="px-4 py-2 text-right">Overtime</th>
                      <th className="px-4 py-2 text-right">Hari Bolong</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row) => (
                      <tr
                        key={row.employeeId}
                        className="border-b border-neutral-100 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-900">
                            {row.employeeFullName}
                          </div>
                          {row.employeePosition ? (
                            <div className="text-xs text-neutral-500">
                              {row.employeePosition}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.workDays}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatDuration(row.totalWorkMinutes)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right font-mono",
                            row.lateOccurrences > 0 && "text-warning-500",
                          )}
                        >
                          {row.lateOccurrences}x ·{" "}
                          {formatDuration(row.totalLateMinutes)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatDuration(row.totalOvertimeMinutes)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right font-mono",
                            row.missedScheduledDays > 0 && "text-danger-500",
                          )}
                        >
                          {row.missedScheduledDays > 0
                            ? row.missedScheduledDays
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 px-6 py-4">
            {periodsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : periods.length === 0 ? (
              <EmptyCard
                icon={CalendarDays}
                title="Belum ada periode payroll"
                description="Buat periode di tab Payroll, lalu kembali ke laporan HR."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-2">Periode</th>
                      <th className="px-4 py-2">Range</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Karyawan</th>
                      <th className="px-4 py-2 text-right">Total Net</th>
                      <th className="px-4 py-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => {
                      const status = STATUS_BADGE[p.status as PayrollStatus];
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-neutral-100 last:border-0"
                        >
                          <td className="px-4 py-3 font-medium text-neutral-900">
                            {p.label}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                            {p.periodStart} → {p.periodEnd}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={status.variant}>
                              {status.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {p.lineCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {formatRupiah(p.netPayTotal)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleExportPayroll(p.id, p.label)
                              }
                              loading={exportingPayroll === p.id}
                              disabled={p.lineCount === 0}
                            >
                              <FileSpreadsheet
                                className="size-3.5"
                                aria-hidden
                              />
                              Export CSV
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
