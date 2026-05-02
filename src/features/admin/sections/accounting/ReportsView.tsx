"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  FileText,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Combobox,
  DatePicker,
  DateRangePicker,
  Skeleton,
  toast,
  type ComboboxOption,
} from "@/components/ui";
import {
  fetchAccounts,
  fetchBalanceSheet,
  fetchGeneralLedger,
  fetchIncomeStatement,
  fetchTrialBalance,
  fetchValidationReport,
} from "@/features/accounting/actions";
import type {
  AccountListRow,
} from "@/features/accounting/types";
import type {
  BalanceSheetReport,
  GeneralLedgerReport,
  IncomeStatementReport,
  TrialBalanceReport,
  ValidationReport,
} from "@/features/accounting/reports";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

type ReportTab = "validate" | "tb" | "is" | "bs" | "gl";

const TABS: Array<{ key: ReportTab; label: string; Icon: typeof FileText }> = [
  { key: "validate", label: "Validasi Drift", Icon: ShieldCheck },
  { key: "tb", label: "Trial Balance", Icon: FileText },
  { key: "is", label: "Laba Rugi", Icon: TrendingUp },
  { key: "bs", label: "Neraca", Icon: BarChart3 },
  { key: "gl", label: "Buku Besar", Icon: BookOpen },
];

export function ReportsView() {
  const [tab, setTab] = useState<ReportTab>("validate");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.Icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
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
          <ValidationTab />
        ) : tab === "tb" ? (
          <TrialBalanceTab />
        ) : tab === "is" ? (
          <IncomeStatementTab />
        ) : tab === "bs" ? (
          <BalanceSheetTab />
        ) : (
          <GeneralLedgerTab />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Validation (Drift Detector) — Sesi W (Field Validation)
// ============================================================

function ValidationTab() {
  const [asOfDate, setAsOfDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
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
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
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
                  <tr key={row.label}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">
                        {row.label}
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
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load();
  }, [range.from, range.to]);

  return (
    <div className="space-y-3">
      <DateRangePicker
        label="Periode"
        value={range}
        onChange={(r) => {
          if (r.from && r.to) setRange({ from: r.from, to: r.to });
        }}
      />
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

function IncomeStatementTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchIncomeStatement({
      fromDate: range.from,
      toDate: range.to,
      periodLabel: `${range.from} → ${range.to}`,
    });
    setLoading(false);
    if (res.ok) setReport(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load();
  }, [range.from, range.to]);

  return (
    <div className="space-y-3">
      <DateRangePicker
        label="Periode"
        value={range}
        onChange={(r) => {
          if (r.from && r.to) setRange({ from: r.from, to: r.to });
        }}
      />
      {loading || !report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <Section title={report.revenue.label} subtotal={report.revenue.subtotal} sign="+">
            {report.revenue.items.map((i) => (
              <ItemRow key={i.code} code={i.code} name={i.name} amount={i.amount} />
            ))}
          </Section>
          {report.revenueContra.items.length > 0 ? (
            <Section
              title={report.revenueContra.label}
              subtotal={-report.revenueContra.subtotal}
              sign="-"
            >
              {report.revenueContra.items.map((i) => (
                <ItemRow
                  key={i.code}
                  code={i.code}
                  name={i.name}
                  amount={-i.amount}
                />
              ))}
            </Section>
          ) : null}
          <TotalRow label="PENDAPATAN BERSIH" value={report.netRevenue} />

          <Section title={report.cogs.label} subtotal={-report.cogs.subtotal} sign="-">
            {report.cogs.items.map((i) => (
              <ItemRow
                key={i.code}
                code={i.code}
                name={i.name}
                amount={-i.amount}
              />
            ))}
          </Section>
          <TotalRow label="LABA KOTOR" value={report.grossProfit} />

          <Section title={report.expenses.label} subtotal={-report.expenses.subtotal} sign="-">
            {report.expenses.items.map((i) => (
              <ItemRow
                key={i.code}
                code={i.code}
                name={i.name}
                amount={-i.amount}
              />
            ))}
          </Section>
          <TotalRow
            label="LABA / RUGI BERSIH"
            value={report.netIncome}
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
    new Date().toISOString().slice(0, 10),
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
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load();
  }, [asOfDate]);

  return (
    <div className="space-y-3">
      <DatePicker
        label="Per tanggal"
        value={asOfDate}
        onChange={(v) => v && setAsOfDate(v)}
      />
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
// General Ledger
// ============================================================

function GeneralLedgerTab() {
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    monthRangeFor(new Date()),
  );
  const [report, setReport] = useState<GeneralLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAccounts({ isActive: true }).then((res) => {
      if (res.ok) setAccounts(res.data);
    });
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
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    void load();
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
      {!accountId ? (
        <div className="rounded-md border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
          Pilih akun untuk lihat buku besar.
        </div>
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

// ============================================================
// Helpers
// ============================================================

function monthRangeFor(d: Date): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1).toISOString().slice(0, 10);
  const last = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { from: first, to: last };
}

function Section({
  title,
  subtotal,
  sign,
  children,
}: {
  title: string;
  subtotal: number;
  sign: "+" | "-";
  children: React.ReactNode;
}) {
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
              {sign === "-" ? "(" : ""}
              {formatRupiah(Math.abs(subtotal))}
              {sign === "-" ? ")" : ""}
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
}: {
  code: string;
  name: string;
  amount: number;
}) {
  return (
    <tr>
      <td className="py-1 pl-4 pr-2 font-mono text-xs text-neutral-500">
        {code}
      </td>
      <td className="py-1">{name}</td>
      <td className="py-1 pr-2 text-right font-mono">
        {amount < 0 ? "(" : ""}
        {formatRupiah(Math.abs(amount))}
        {amount < 0 ? ")" : ""}
      </td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-neutral-200 px-2 py-2",
        emphasis &&
          "border-y-2 border-mahakan-green-700 bg-mahakan-green-50/50 font-bold",
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono", value < 0 && "text-danger-500")}>
        {value < 0 ? "(" : ""}
        {formatRupiah(Math.abs(value))}
        {value < 0 ? ")" : ""}
      </span>
    </div>
  );
}
