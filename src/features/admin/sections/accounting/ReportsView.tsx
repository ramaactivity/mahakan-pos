"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Combobox,
  DatePicker,
  DateRangePicker,
  Select,
  Skeleton,
  toast,
  type ComboboxOption,
} from "@/components/ui";
import { getOwnOutlet, isOk, type Outlet } from "@/features/outlets";
import {
  exportBalanceSheetPdf,
  exportCashFlowStatementPdf,
  exportIncomeStatementPdf,
  exportTrialBalancePdf,
} from "@/lib/pdf-export";
import {
  buildBalanceSheetCsv,
  buildCashFlowStatementCsv,
  buildGeneralLedgerCsv,
  buildIncomeStatementCsv,
  buildTrialBalanceCsv,
  downloadCsv,
} from "./accounting-csv";
import {
  fetchAccounts,
  fetchBalanceSheet,
  fetchCashFlowStatement,
  fetchGeneralLedger,
  fetchIncomeStatement,
  fetchLedgerAccountSummary,
  fetchTrialBalance,
  fetchValidationReport,
} from "@/features/accounting/actions";
import type {
  AccountListRow,
} from "@/features/accounting/types";
import type {
  BalanceSheetReport,
  CashFlowStatement,
  GeneralLedgerReport,
  IncomeStatementReport,
  LedgerAccountSummaryReport,
  TrialBalanceReport,
  ValidationReport,
} from "@/features/accounting/reports";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  jakartaDateOf,
  monthEndJakarta,
  monthStartJakarta,
  todayJakarta,
} from "@/lib/tz";

type ReportTab = "validate" | "tb" | "is" | "bs" | "cf" | "gl";

const TABS: Array<{ key: ReportTab; label: string; Icon: typeof FileText }> = [
  { key: "validate", label: "Validasi Drift", Icon: ShieldCheck },
  { key: "tb", label: "Trial Balance", Icon: FileText },
  { key: "is", label: "Laba Rugi", Icon: TrendingUp },
  { key: "bs", label: "Neraca", Icon: BarChart3 },
  { key: "cf", label: "Arus Kas", Icon: ArrowUpDown },
  { key: "gl", label: "Buku Besar", Icon: BookOpen },
];

export function ReportsView() {
  const [tab, setTab] = useState<ReportTab>("validate");
  /** Pre-selected account code untuk GL drilldown dari Validasi tab. */
  const [drilldownCode, setDrilldownCode] = useState<string | null>(null);

  function handleDrilldown(code: string) {
    setDrilldownCode(code);
    setTab("gl");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.Icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                if (t.key !== "gl") setDrilldownCode(null);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key
                  ? "bg-mahakan-green-700 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
              )}
            >
              <Icon className="size-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4">
        {tab === "validate" ? (
          <ValidationTab onDrilldown={handleDrilldown} />
        ) : tab === "tb" ? (
          <TrialBalanceTab />
        ) : tab === "is" ? (
          <IncomeStatementTab />
        ) : tab === "bs" ? (
          <BalanceSheetTab />
        ) : tab === "cf" ? (
          <CashFlowTab />
        ) : (
          <GeneralLedgerTab initialAccountCode={drilldownCode} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Validation (Drift Detector) — Sesi W (Field Validation)
// ============================================================

function ValidationTab({
  onDrilldown,
}: {
  onDrilldown: (accountCode: string) => void;
}) {
  const [asOfDate, setAsOfDate] = useState<string>(
    todayJakarta(),
  );
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchValidationReport(asOfDate);
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [asOfDate]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3 text-xs text-neutral-700">
        <strong>Validasi Drift</strong> — bandingkan saldo per Buku Besar vs
        sumber data Finance/Inventory/Purchase. Status &ldquo;OK&rdquo; = match
        sempurna. &ldquo;Warning&rdquo; = drift kecil (≤ 1%, biasanya rounding).
        &ldquo;Critical&rdquo; = drift signifikan, perlu investigasi (cek
        auto-journal hooks, manual entry yang lupa, atau opname/setoran belum
        ter-reflek).
      </div>

      <DatePicker
        label="Per tanggal"
        value={asOfDate}
        onChange={(v) => v && setAsOfDate(v)}
      />

      {loading || !report ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                    Item
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                    Buku Besar
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                    Sumber Data
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                    Selisih
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {report.rows.map((row) => (
                  <tr
                    key={row.label}
                    className="cursor-pointer transition-colors hover:bg-mahakan-green-50/40"
                    onClick={() => onDrilldown(row.accountCodes[0])}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDrilldown(row.accountCodes[0]);
                      }
                    }}
                    aria-label={`Drilldown ke Buku Besar untuk ${row.label}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-medium text-neutral-900">
                        {row.label}
                        <span className="text-xs text-mahakan-green-700">
                          → buka GL
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500">
                        Akun:{" "}
                        <span className="font-mono">
                          {row.accountCodes.join(" + ")}
                        </span>
                      </div>
                      {row.note ? (
                        <div className="mt-1 text-xs text-neutral-600">
                          {row.note}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(row.ledgerAmount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatRupiah(row.sourceAmount)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        row.diff === 0
                          ? "text-neutral-500"
                          : row.diff > 0
                            ? "text-warning-500"
                            : "text-danger-500",
                      )}
                    >
                      {row.diff === 0
                        ? "—"
                        : `${row.diff > 0 ? "+" : ""}${formatRupiah(row.diff)}`}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "ok" ? (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3" /> OK
                        </Badge>
                      ) : row.status === "warning" ? (
                        <Badge variant="warning">
                          <AlertTriangle className="size-3" /> Warning
                        </Badge>
                      ) : (
                        <Badge variant="danger">
                          <XCircle className="size-3" /> Critical
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.allClean ? (
            <div className="rounded-md border border-success-500/50 bg-success-100/40 p-3 text-sm text-success-500">
              ✓ Semua drift bersih. Buku Besar match sumber data.
            </div>
          ) : (
            <div className="rounded-md border border-warning-500/50 bg-warning-100/40 p-3 text-sm text-neutral-700">
              ⚠ Ada drift terdeteksi. Lihat docs/11-VALIDATION-RUNBOOK.md untuk
              langkah investigasi + remediasi.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Trial Balance
// ============================================================

function TrialBalanceTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchTrialBalance({
      fromDate: range.from,
      toDate: range.to,
    });
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [range.from, range.to]);

  async function onExportPdf() {
    if (!report) return;
    const outletRes = await getOwnOutlet();
    if (!isOk(outletRes)) {
      toast.error("Gagal load outlet info");
      return;
    }
    exportTrialBalancePdf(report, outletRes.data, range);
    toast.success("PDF Trial Balance terdownload");
  }

  function onExportCsv() {
    if (!report) return;
    const csv = buildTrialBalanceCsv(report);
    downloadCsv(`mahakan-trial-balance-${range.from}_${range.to}.csv`, csv);
    toast.success("CSV Trial Balance terdownload");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <DateRangePicker
          label="Periode"
          value={range}
          onChange={(r) => {
            if (r.from && r.to) setRange({ from: r.from, to: r.to });
          }}
        />
        {report && report.rows.length > 0 ? (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onExportPdf}>
              <Download className="size-4" /> PDF
            </Button>
          </div>
        ) : null}
      </div>
      {loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Kode
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-neutral-500">
                  Akun
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                  Debit
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-neutral-500">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {report.rows.map((r) => (
                <tr key={r.code}>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {r.debit > 0 ? formatRupiah(r.debit) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {r.credit > 0 ? formatRupiah(r.credit) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-100">
              <tr>
                <td className="px-3 py-2 font-semibold" colSpan={2}>
                  TOTAL
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatRupiah(report.totalDebit)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatRupiah(report.totalCredit)}
                </td>
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-2 text-center text-xs">
                  {report.balanced ? (
                    <span className="text-success-500">
                      ✓ Balanced
                    </span>
                  ) : (
                    <span className="text-danger-500">
                      ✕ TIDAK BALANCE — selisih{" "}
                      {formatRupiah(
                        Math.abs(report.totalDebit - report.totalCredit),
                      )}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Income Statement
// ============================================================

type CompareMode = "none" | "prev_month" | "prev_year";

function IncomeStatementTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [prevReport, setPrevReport] =
    useState<IncomeStatementReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const prevRange =
      compareMode === "none" ? null : prevRangeFor(range, compareMode);
    const [curRes, prevRes] = await Promise.all([
      fetchIncomeStatement({
        fromDate: range.from,
        toDate: range.to,
        periodLabel: `${range.from} → ${range.to}`,
      }),
      prevRange
        ? fetchIncomeStatement({
            fromDate: prevRange.from,
            toDate: prevRange.to,
            periodLabel: `${prevRange.from} → ${prevRange.to}`,
          })
        : Promise.resolve(null),
    ]);
    setLoading(false);
    if (curRes.ok) setReport(curRes.data);
    else toast.error(curRes.error.message);
    if (prevRes && prevRes.ok) setPrevReport(prevRes.data);
    else setPrevReport(null);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [range.from, range.to, compareMode]);

  async function onExportPdf() {
    if (!report) return;
    const outletRes = await getOwnOutlet();
    if (!isOk(outletRes)) {
      toast.error("Gagal load outlet info");
      return;
    }
    exportIncomeStatementPdf(report, outletRes.data);
    toast.success("PDF Laba Rugi terdownload");
  }

  function onExportCsv() {
    if (!report) return;
    const csv = buildIncomeStatementCsv(report);
    downloadCsv(`mahakan-laba-rugi-${range.from}_${range.to}.csv`, csv);
    toast.success("CSV Laba Rugi terdownload");
  }

  const compareLabel =
    compareMode === "prev_month"
      ? "Bulan sebelumnya"
      : compareMode === "prev_year"
        ? "Tahun sebelumnya"
        : null;

  /* Sesi AE-63 phase4 — build lookup map untuk previous-period amount per
   * account code. Dipakai oleh ItemRow supaya nominal bulan/tahun lalu
   * tampil per akun (staff finance request). Memo agar tidak rebuild
   * tiap render. */
  const prevByCode = useMemo(() => {
    if (!prevReport) return null;
    const m = new Map<string, number>();
    for (const it of prevReport.revenue.items) m.set(it.code, it.amount);
    for (const it of prevReport.revenueContra.items)
      m.set(it.code, -it.amount);
    for (const it of prevReport.cogs.items) m.set(it.code, -it.amount);
    for (const it of prevReport.expenses.items) m.set(it.code, -it.amount);
    return m;
  }, [prevReport]);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <DateRangePicker
            label="Periode"
            value={range}
            onChange={(r) => {
              if (r.from && r.to) setRange({ from: r.from, to: r.to });
            }}
          />
          <Select
            label="Bandingkan dengan"
            value={compareMode}
            onValueChange={(v) => setCompareMode(v as CompareMode)}
            size="sm"
            options={[
              { value: "none", label: "Tidak" },
              { value: "prev_month", label: "Bulan sebelumnya" },
              { value: "prev_year", label: "Tahun sebelumnya" },
            ]}
          />
        </div>
        {report ? (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onExportPdf}>
              <Download className="size-4" /> PDF
            </Button>
          </div>
        ) : null}
      </div>
      {loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <Section
            title={report.revenue.label}
            subtotal={report.revenue.subtotal}
            sign="+"
            prevSubtotal={prevReport?.revenue.subtotal}
            prevLabel={compareLabel}
          >
            {report.revenue.items.map((i) => (
              <ItemRow
                key={i.code}
                code={i.code}
                name={i.name}
                amount={i.amount}
                prevAmount={prevByCode?.get(i.code)}
              />
            ))}
          </Section>
          {report.revenueContra.items.length > 0 ? (
            <Section
              title={report.revenueContra.label}
              subtotal={-report.revenueContra.subtotal}
              sign="-"
              prevSubtotal={
                prevReport ? -prevReport.revenueContra.subtotal : undefined
              }
              prevLabel={compareLabel}
            >
              {report.revenueContra.items.map((i) => (
                <ItemRow
                  key={i.code}
                  code={i.code}
                  name={i.name}
                  amount={-i.amount}
                  prevAmount={prevByCode?.get(i.code)}
                />
              ))}
            </Section>
          ) : null}
          <TotalRow
            label="PENDAPATAN BERSIH"
            value={report.netRevenue}
            prevValue={prevReport?.netRevenue}
            prevLabel={compareLabel}
          />

          <Section
            title={report.cogs.label}
            subtotal={-report.cogs.subtotal}
            sign="-"
            prevSubtotal={prevReport ? -prevReport.cogs.subtotal : undefined}
            prevLabel={compareLabel}
          >
            {report.cogs.items.map((i) => (
              <ItemRow
                key={i.code}
                code={i.code}
                name={i.name}
                amount={-i.amount}
                prevAmount={prevByCode?.get(i.code)}
              />
            ))}
          </Section>
          <TotalRow
            label="LABA KOTOR"
            value={report.grossProfit}
            prevValue={prevReport?.grossProfit}
            prevLabel={compareLabel}
          />

          <Section
            title={report.expenses.label}
            subtotal={-report.expenses.subtotal}
            sign="-"
            prevSubtotal={
              prevReport ? -prevReport.expenses.subtotal : undefined
            }
            prevLabel={compareLabel}
          >
            {report.expenses.items.map((i) => (
              <ItemRow
                key={i.code}
                code={i.code}
                name={i.name}
                amount={-i.amount}
                prevAmount={prevByCode?.get(i.code)}
              />
            ))}
          </Section>
          <TotalRow
            label="LABA / RUGI BERSIH"
            value={report.netIncome}
            prevValue={prevReport?.netIncome}
            prevLabel={compareLabel}
            emphasis
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Balance Sheet
// ============================================================

function BalanceSheetTab() {
  const [asOfDate, setAsOfDate] = useState<string>(
    todayJakarta(),
  );
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchBalanceSheet(asOfDate);
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [asOfDate]);

  async function onExportPdf() {
    if (!report) return;
    const outletRes = await getOwnOutlet();
    if (!isOk(outletRes)) {
      toast.error("Gagal load outlet info");
      return;
    }
    exportBalanceSheetPdf(report, outletRes.data);
    toast.success("PDF Neraca terdownload");
  }

  function onExportCsv() {
    if (!report) return;
    const csv = buildBalanceSheetCsv(report);
    downloadCsv(`mahakan-neraca-${asOfDate}.csv`, csv);
    toast.success("CSV Neraca terdownload");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <DatePicker
          label="Per tanggal"
          value={asOfDate}
          onChange={(v) => v && setAsOfDate(v)}
        />
        {report ? (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onExportPdf}>
              <Download className="size-4" /> PDF
            </Button>
          </div>
        ) : null}
      </div>
      {loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase text-mahakan-green-900">
              Aset
            </h3>
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-neutral-100">
                {report.assets.map((a) => (
                  <tr key={a.code}>
                    <td className="py-1 font-mono text-xs text-neutral-500">
                      {a.code}
                    </td>
                    <td className="py-1">
                      {a.isContra ? `(-) ${a.name}` : a.name}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatRupiah(a.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-neutral-300">
                <tr>
                  <td colSpan={2} className="py-2 font-semibold">
                    TOTAL ASET
                  </td>
                  <td className="py-2 text-right font-mono font-bold">
                    {formatRupiah(report.totalAssets)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase text-mahakan-green-900">
              Kewajiban + Ekuitas
            </h3>
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-neutral-100">
                {report.liabilities.length > 0 && (
                  <tr>
                    <td colSpan={3} className="pt-2 text-xs uppercase text-neutral-500">
                      Kewajiban
                    </td>
                  </tr>
                )}
                {report.liabilities.map((l) => (
                  <tr key={l.code}>
                    <td className="py-1 font-mono text-xs text-neutral-500">
                      {l.code}
                    </td>
                    <td className="py-1">{l.name}</td>
                    <td className="py-1 text-right font-mono">
                      {formatRupiah(l.amount)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="pt-2 text-xs uppercase text-neutral-500">
                    Ekuitas
                  </td>
                </tr>
                {report.equity.map((e) => (
                  <tr key={e.code}>
                    <td className="py-1 font-mono text-xs text-neutral-500">
                      {e.code}
                    </td>
                    <td className="py-1">
                      {e.isContra ? `(-) ${e.name}` : e.name}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {formatRupiah(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-neutral-300">
                <tr>
                  <td colSpan={2} className="py-2 font-semibold">
                    TOTAL KEWAJIBAN + EKUITAS
                  </td>
                  <td className="py-2 text-right font-mono font-bold">
                    {formatRupiah(report.totalLiabilities + report.totalEquity)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="md:col-span-2 text-center text-xs">
            {report.balanced ? (
              <span className="text-success-500">✓ Balanced</span>
            ) : (
              <span className="text-danger-500">
                ✕ Tidak balance — selisih{" "}
                {formatRupiah(
                  Math.abs(
                    report.totalAssets -
                      (report.totalLiabilities + report.totalEquity),
                  ),
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Cash Flow Statement (Sesi Y polish)
// ============================================================

function CashFlowTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [report, setReport] = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchCashFlowStatement({
      fromDate: range.from,
      toDate: range.to,
      periodLabel: `${range.from} → ${range.to}`,
    });
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [range.from, range.to]);

  async function onExportPdf() {
    if (!report) return;
    const outletRes = await getOwnOutlet();
    if (!isOk(outletRes)) {
      toast.error("Gagal load outlet info");
      return;
    }
    exportCashFlowStatementPdf(report, outletRes.data);
    toast.success("PDF Arus Kas terdownload");
  }

  function onExportCsv() {
    if (!report) return;
    const csv = buildCashFlowStatementCsv(report);
    downloadCsv(`mahakan-arus-kas-${range.from}_${range.to}.csv`, csv);
    toast.success("CSV Arus Kas terdownload");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <DateRangePicker
          label="Periode"
          value={range}
          onChange={(r) => {
            if (r.from && r.to) setRange({ from: r.from, to: r.to });
          }}
        />
        {report ? (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onExportPdf}>
              <Download className="size-4" /> PDF
            </Button>
          </div>
        ) : null}
      </div>

      {loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-mahakan-green-100 bg-mahakan-green-50/40 p-3 text-sm">
            <div className="flex justify-between font-medium">
              <span>Saldo Kas Awal</span>
              <span className="font-mono">
                {formatRupiah(report.openingCash)}
              </span>
            </div>
          </div>

          <CashFlowSectionView section={report.operating} />
          <CashFlowSectionView section={report.investing} />
          <CashFlowSectionView section={report.financing} />

          <div className="rounded-md border border-mahakan-green-300 bg-mahakan-green-50 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span>Perubahan Bersih Kas</span>
              <span
                className={cn(
                  "font-mono font-semibold",
                  report.netChangeInCash < 0 && "text-danger-500",
                )}
              >
                {report.netChangeInCash < 0 ? "(" : ""}
                {formatRupiah(Math.abs(report.netChangeInCash))}
                {report.netChangeInCash < 0 ? ")" : ""}
              </span>
            </div>
            <div className="flex justify-between font-semibold text-mahakan-green-900">
              <span>Saldo Kas Akhir (Computed)</span>
              <span className="font-mono">
                {formatRupiah(report.closingCashComputed)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-neutral-500">
              <span>Saldo Kas Akhir (Aktual dari Buku Besar)</span>
              <span className="font-mono">
                {formatRupiah(report.closingCashActual)}
              </span>
            </div>
          </div>

          <div className="text-center text-xs">
            {report.matchesActualClosing ? (
              <span className="text-success-500">
                ✓ Computed match aktual — data integrity OK
              </span>
            ) : (
              <span className="text-danger-500">
                ✕ Tidak match — selisih{" "}
                {formatRupiah(
                  Math.abs(
                    report.closingCashComputed - report.closingCashActual,
                  ),
                )}
              </span>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-500">
        PSAK standar 3-section: Operasi (POS sales, expense, payroll, dll) /
        Investasi (capitalize fixed asset) / Pendanaan (modal owner, prive).
        Setoran tunai (kas → bank) tidak dihitung karena intra-cash transfer.
      </p>
    </div>
  );
}

function CashFlowSectionView({
  section,
}: {
  section: { label: string; items: Array<{ label: string; amount: number; entryCount: number }>; netCash: number };
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
        {section.label}
      </h3>
      {section.items.length === 0 ? (
        <p className="pl-4 text-xs text-neutral-400">
          (tidak ada aktivitas di periode ini)
        </p>
      ) : (
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-neutral-100">
            {section.items.map((item) => (
              <tr key={item.label}>
                <td className="py-1 pl-4">
                  {item.label}{" "}
                  <span className="text-xs text-neutral-400">
                    ({item.entryCount}×)
                  </span>
                </td>
                <td
                  className={cn(
                    "py-1 pr-2 text-right font-mono",
                    item.amount < 0 && "text-danger-500",
                  )}
                >
                  {item.amount < 0 ? "(" : ""}
                  {formatRupiah(Math.abs(item.amount))}
                  {item.amount < 0 ? ")" : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-neutral-200">
            <tr>
              <td className="py-1.5 pl-4 font-medium">Net</td>
              <td
                className={cn(
                  "py-1.5 pr-2 text-right font-mono font-medium",
                  section.netCash < 0 && "text-danger-500",
                )}
              >
                {section.netCash < 0 ? "(" : ""}
                {formatRupiah(Math.abs(section.netCash))}
                {section.netCash < 0 ? ")" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

// ============================================================
// General Ledger
// ============================================================

function GeneralLedgerTab({
  initialAccountCode,
}: {
  initialAccountCode?: string | null;
}) {
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [report, setReport] = useState<GeneralLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  /* Sesi AE-183 — ringkasan semua akun untuk tampilan sebelum pilih akun. */
  const [summary, setSummary] = useState<LedgerAccountSummaryReport | null>(
    null,
  );
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    fetchAccounts({ isActive: true }).then((res) => {
      if (res.ok) {
         
        setAccounts(res.data);
        // Auto-resolve initialAccountCode → accountId on first mount.
        if (initialAccountCode) {
          const match = res.data.find((a) => a.code === initialAccountCode);
          if (match) {
             
            setAccountId(match.id);
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!accountId) return;
    setLoading(true);
    const res = await fetchGeneralLedger({
      accountId,
      fromDate: range.from,
      toDate: range.to,
    });
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    if (!accountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [accountId, range.from, range.to]);

  /* Ringkasan hanya dimuat saat belum ada akun terpilih — tidak perlu
   * dihitung ulang saat owner sedang membaca detail satu akun. */
  useEffect(() => {
    if (accountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummaryLoading(true);
    void (async () => {
      const res = await fetchLedgerAccountSummary({
        fromDate: range.from,
        toDate: range.to,
      });
      if (cancelled) return;
      setSummaryLoading(false);
      if (res.ok) setSummary(res.data);
      else toast.error(res.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, range.from, range.to]);

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.id,
        label: `${a.code} ${a.name}`,
        hint: a.type,
      })),
    [accounts],
  );

  function onExportCsv() {
    if (!report) return;
    const csv = buildGeneralLedgerCsv(report);
    downloadCsv(
      `mahakan-buku-besar-${report.accountCode}-${range.from}_${range.to}.csv`,
      csv,
    );
    toast.success("CSV Buku Besar terdownload");
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Combobox
          label="Akun"
          options={accountOptions}
          value={accountId}
          onChange={setAccountId}
          placeholder="— pilih akun —"
        />
        <DateRangePicker
          label="Periode"
          value={range}
          onChange={(r) => {
            if (r.from && r.to) setRange({ from: r.from, to: r.to });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* Sesi AE-183 — jalan pulang ke ringkasan setelah masuk detail akun. */}
        {accountId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAccountId(null);
              setReport(null);
            }}
          >
            <ArrowLeft className="size-4" /> Semua akun
          </Button>
        ) : (
          <span />
        )}
        {report && report.entries.length > 0 ? (
          <Button variant="outline" size="sm" onClick={onExportCsv}>
            <Download className="size-4" /> Export CSV
          </Button>
        ) : null}
      </div>
      {!accountId ? (
        summaryLoading || !summary ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <LedgerAccountSummaryTable
            summary={summary}
            range={range}
            onPick={setAccountId}
          />
        )
      ) : loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <div className="bg-neutral-50 px-3 py-2 text-sm">
            <span className="font-mono">{report.accountCode}</span>{" "}
            <span className="font-medium">{report.accountName}</span>
            <span className="ml-3 text-xs text-neutral-500">
              ({report.accountType}, {report.normalBalance})
            </span>
            <span className="ml-3 font-mono text-xs">
              Saldo awal: {formatRupiah(report.openingBalance)}
            </span>
          </div>
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-2 py-1.5 text-left">Tgl</th>
                <th className="px-2 py-1.5 text-left">Entry</th>
                <th className="px-2 py-1.5 text-left">Deskripsi</th>
                <th className="px-2 py-1.5 text-right">Debit</th>
                <th className="px-2 py-1.5 text-right">Credit</th>
                <th className="px-2 py-1.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {report.entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-4 text-center text-neutral-500"
                  >
                    Tidak ada entri di periode ini
                  </td>
                </tr>
              ) : (
                report.entries.map((e, idx) => (
                  <tr key={`${e.entryNumber}-${idx}`}>
                    <td className="px-2 py-1">{e.entryDate}</td>
                    <td className="px-2 py-1 font-mono text-xs">
                      {e.entryNumber}
                    </td>
                    <td className="px-2 py-1">
                      {e.lineDescription ?? e.entryDescription}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {e.debit > 0 ? formatRupiah(e.debit) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {e.credit > 0 ? formatRupiah(e.credit) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatRupiah(e.balanceAfter)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-neutral-100">
              <tr>
                <td colSpan={5} className="px-2 py-1.5 text-right font-semibold">
                  Saldo akhir
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">
                  {formatRupiah(report.closingBalance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Sesi AE-183 — tabel "total per akun" yang tampil di Buku Besar SEBELUM owner
 * memilih akun. Permintaan owner: area kosong di bawah filter diisi rekap
 * seperti Neraca, dan tiap baris bisa diklik untuk langsung membuka detail.
 *
 * Kolom sengaja dibuat menyambung dengan tampilan detail: Saldo awal →
 * Debit/Kredit periode → Saldo akhir. Jadi angka di baris ringkasan sama
 * persis dengan header + footer di halaman detail akun tersebut.
 */
function LedgerAccountSummaryTable({
  summary,
  range,
  onPick,
}: {
  summary: LedgerAccountSummaryReport;
  range: { from: string; to: string };
  onPick: (accountId: string) => void;
}) {
  if (summary.groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
        Belum ada akun bersaldo atau bermutasi di periode {range.from} s/d{" "}
        {range.to}.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-600">
          Total per akun — periode{" "}
          <span className="font-medium">
            {range.from} s/d {range.to}
          </span>
          . Klik baris untuk lihat rincian buku besarnya.
        </p>
        <Badge variant={summary.balanced ? "success" : "danger"}>
          {summary.balanced
            ? "Debit = Kredit"
            : `Timpang ${formatRupiah(Math.abs(summary.totalDebit - summary.totalCredit))}`}
        </Badge>
      </div>

      {/* Tablet Galaxy A7 Lite: tabel lebar harus bisa digeser sendiri,
          bukan bikin seluruh halaman ikut geser. */}
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-2 py-1.5 text-left">Akun</th>
              <th className="px-2 py-1.5 text-right">Saldo awal</th>
              <th className="px-2 py-1.5 text-right">Debit</th>
              <th className="px-2 py-1.5 text-right">Kredit</th>
              <th className="px-2 py-1.5 text-right">Saldo akhir</th>
              <th className="px-2 py-1.5" aria-label="Buka rincian" />
            </tr>
          </thead>
          {summary.groups.map((g) => (
            <tbody key={g.type} className="divide-y divide-neutral-100">
              <tr className="bg-neutral-50/70">
                <td
                  colSpan={6}
                  className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600"
                >
                  {g.label}
                </td>
              </tr>
              {g.rows.map((r) => (
                <tr
                  key={r.accountId}
                  onClick={() => onPick(r.accountId)}
                  className="cursor-pointer transition-colors hover:bg-mahakan-green-50/60"
                >
                  <td className="px-2 py-1.5">
                    <span className="font-mono text-neutral-500">{r.code}</span>{" "}
                    <span className="font-medium">{r.name}</span>
                    {r.isContra ? (
                      <span className="ml-1 text-[10px] text-neutral-400">
                        (kontra)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-neutral-500">
                    {formatRupiah(r.openingBalance)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.debitTotal > 0 ? formatRupiah(r.debitTotal) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.creditTotal > 0 ? formatRupiah(r.creditTotal) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right font-mono font-semibold",
                      r.closingBalance < 0 && "text-red-600",
                    )}
                  >
                    {formatRupiah(r.closingBalance)}
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    {/* Tombol nyata supaya bisa dijangkau keyboard + pembaca
                        layar; baris tetap bisa diklik untuk sentuh cepat. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(r.accountId);
                      }}
                      aria-label={`Lihat buku besar ${r.code} ${r.name}`}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-neutral-50 font-medium">
                <td className="px-2 py-1.5 text-right">Subtotal {g.label}</td>
                <td />
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatRupiah(g.totalDebit)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatRupiah(g.totalCredit)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatRupiah(g.totalClosing)}
                </td>
                <td />
              </tr>
            </tbody>
          ))}
          <tfoot className="bg-neutral-100">
            <tr>
              <td className="px-2 py-2 text-right font-semibold" colSpan={2}>
                Total mutasi periode
              </td>
              <td className="px-2 py-2 text-right font-mono font-bold">
                {formatRupiah(summary.totalDebit)}
              </td>
              <td className="px-2 py-2 text-right font-mono font-bold">
                {formatRupiah(summary.totalCredit)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {summary.hiddenEmptyAccounts > 0 ? (
        <p className="text-xs text-neutral-500">
          {summary.hiddenEmptyAccounts} akun lain disembunyikan karena tidak
          punya saldo maupun mutasi di periode ini.
        </p>
      ) : null}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

/* Sesi AE-191 — batas bulan lewat kalender WIB. `new Date(y, m, 1)` itu tengah
 * malam waktu lokal; di WIB sama dengan 17:00 UTC tanggal 31 bulan sebelumnya,
 * jadi `toISOString()` bikin rentang laporan mundur satu hari. */
function monthRangeFor(d: Date): { from: string; to: string } {
  const iso = jakartaDateOf(d);
  return { from: monthStartJakarta(iso), to: monthEndJakarta(iso) };
}

/**
 * Compute the comparison-period range relative to a base range.
 * - "prev_month": shift both endpoints back by 1 calendar month
 * - "prev_year":  shift both endpoints back by 1 calendar year
 * Both forms preserve the day-of-month modulo end-of-month clamping (e.g.,
 * Mar 31 prev_month → Feb 28/29). Done with Date constructors which already
 * clamp gracefully.
 */
function prevRangeFor(
  current: { from: string; to: string },
  mode: "prev_month" | "prev_year",
): { from: string; to: string } {
  const shift = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt =
      mode === "prev_month"
        ? new Date(y, m - 2, d)
        : new Date(y - 1, m - 1, d);
    return dt.toISOString().slice(0, 10);
  };
  return { from: shift(current.from), to: shift(current.to) };
}

function Section({
  title,
  subtotal,
  sign,
  children,
  prevSubtotal,
  prevLabel,
}: {
  title: string;
  subtotal: number;
  sign: "+" | "-";
  children: React.ReactNode;
  /* Sesi AE-63 phase4 — staff finance request: tampilkan nominal periode
   * sebelumnya per akun + subtotal supaya track naik-turunnya kelihatan
   * jelas tanpa hover tooltip. */
  prevSubtotal?: number;
  prevLabel?: string | null;
}) {
  const hasCompare = prevSubtotal !== undefined && prevLabel;
  const prevDelta = hasCompare ? subtotal - prevSubtotal : 0;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
        {title}
      </h3>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
        <tfoot className="border-t border-neutral-200">
          <tr>
            <td colSpan={2} className="py-1.5 pl-4 font-medium text-neutral-700">
              Subtotal {title}
            </td>
            <td className="py-1.5 pr-2 text-right font-mono font-medium">
              <div className="flex flex-col items-end gap-0.5">
                <span>
                  {sign === "-" ? "(" : ""}
                  {formatRupiah(Math.abs(subtotal))}
                  {sign === "-" ? ")" : ""}
                </span>
                {hasCompare ? (
                  <span
                    className={cn(
                      "text-[10px] font-normal",
                      prevDelta > 0
                        ? "text-success-500"
                        : prevDelta < 0
                          ? "text-danger-500"
                          : "text-neutral-500",
                    )}
                  >
                    {prevLabel}: {formatRupiah(Math.abs(prevSubtotal))}
                  </span>
                ) : null}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ItemRow({
  code,
  name,
  amount,
  prevAmount,
}: {
  code: string;
  name: string;
  amount: number;
  /* Sesi AE-63 phase4 — optional prev-period amount untuk inline display.
   * Kalau provided + non-zero, render di baris kedua dgn label "prev:". */
  prevAmount?: number;
}) {
  const hasPrev = prevAmount !== undefined;
  const delta = hasPrev ? amount - prevAmount : 0;
  return (
    <tr>
      <td className="py-1 pl-4 pr-2 align-top font-mono text-xs text-neutral-500">
        {code}
      </td>
      <td className="py-1 align-top">{name}</td>
      <td className="py-1 pr-2 text-right font-mono">
        <div className="flex flex-col items-end gap-0.5">
          <span>
            {amount < 0 ? "(" : ""}
            {formatRupiah(Math.abs(amount))}
            {amount < 0 ? ")" : ""}
          </span>
          {hasPrev && prevAmount !== 0 ? (
            <span
              className={cn(
                "text-[10px]",
                delta > 0
                  ? "text-success-500"
                  : delta < 0
                    ? "text-danger-500"
                    : "text-neutral-400",
              )}
            >
              prev: {formatRupiah(Math.abs(prevAmount))}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  emphasis,
  prevValue,
  prevLabel,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  /** Previous-period value untuk comparison. Render delta beside main value. */
  prevValue?: number;
  /** Label of comparison period (e.g. "Bulan sebelumnya"). */
  prevLabel?: string | null;
}) {
  const hasCompare = prevValue !== undefined && prevLabel;
  const delta = hasCompare ? value - prevValue : 0;
  // Pct change: protect against div-by-zero. Use |prev| as denominator for
  // sign-correct percentages even kalau prev negatif (unusual untuk
  // pendapatan tapi possible untuk netIncome).
  const pct =
    hasCompare && prevValue !== 0
      ? (delta / Math.abs(prevValue)) * 100
      : null;
  const deltaPositive = delta > 0;
  const deltaNegative = delta < 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 border-t border-neutral-200 px-2 py-2",
        emphasis &&
          "border-y-2 border-mahakan-green-700 bg-mahakan-green-50/50 font-bold",
      )}
    >
      <span>{label}</span>
      <div className="flex items-baseline gap-3">
        {hasCompare ? (
          <div className="flex flex-col items-end gap-0.5 font-mono text-xs">
            {/* Sesi AE-63 phase4 — staff finance request: tampilkan
              * nominal periode pembanding inline (sebelumnya cuma tooltip).
              * Owner mau langsung tracking naik-turunnya tanpa hover. */}
            <span className="text-neutral-500">
              {prevLabel}:{" "}
              <span className="font-semibold tabular-nums text-neutral-700">
                {prevValue < 0 ? "(" : ""}
                {formatRupiah(Math.abs(prevValue))}
                {prevValue < 0 ? ")" : ""}
              </span>
            </span>
            <span
              className={cn(
                deltaPositive
                  ? "text-success-500"
                  : deltaNegative
                    ? "text-danger-500"
                    : "text-neutral-500",
              )}
            >
              {deltaPositive ? "↑ +" : deltaNegative ? "↓ " : ""}
              {pct !== null ? `${pct.toFixed(1)}%` : "—"}
            </span>
          </div>
        ) : null}
        <span className={cn("font-mono", value < 0 && "text-danger-500")}>
          {value < 0 ? "(" : ""}
          {formatRupiah(Math.abs(value))}
          {value < 0 ? ")" : ""}
        </span>
      </div>
    </div>
  );
}
