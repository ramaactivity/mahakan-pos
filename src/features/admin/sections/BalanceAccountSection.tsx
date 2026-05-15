"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  History,
  Search,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  DatePicker,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
} from "@/components/ui";
import {
  fetchAccounts,
  fetchGeneralLedger,
  fetchTrialBalance,
} from "@/features/accounting/actions";
import type {
  GeneralLedgerEntry,
  TrialBalanceRow,
} from "@/features/accounting/reports";
import type { AccountType } from "@/features/accounting/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-62a — Saldo Akun (Balance Account) section.
 *
 * Owner request: halaman khusus untuk lihat saldo per akun + drill-down
 * riwayat transaksi (general ledger entries). Reuse fundamental yang
 * sudah ada di module accounting:
 *   - fetchTrialBalance (returns AccountBalanceRow[] dengan saldo per akun)
 *   - fetchGeneralLedger (per-account history dengan running balance)
 *
 * Tidak ada schema baru. Cuma UI baru yang lebih accessible — sebelumnya
 * fitur ini terkubur di Akuntansi → Laporan → Buku Besar.
 */

type TypeFilter = AccountType | "all";

const TYPE_META: Record<
  AccountType,
  {
    label: string;
    tone: "neutral" | "danger" | "success" | "warning" | "info";
    normal: "debit" | "credit";
  }
> = {
  asset: { label: "Aset", tone: "info", normal: "debit" },
  liability: { label: "Liabilitas", tone: "warning", normal: "credit" },
  equity: { label: "Ekuitas", tone: "success", normal: "credit" },
  revenue: { label: "Pendapatan", tone: "success", normal: "credit" },
  cogs: { label: "HPP", tone: "danger", normal: "debit" },
  expense: { label: "Beban", tone: "danger", normal: "debit" },
};

/** Normal-side amount: positive kalau saldo di sisi normal akun ini.
 *  Negative = kontra (rare, mis. Akumulasi Penyusutan). */
function signedNormal(
  type: AccountType,
  debit: number,
  credit: number,
): number {
  return TYPE_META[type].normal === "debit"
    ? debit - credit
    : credit - debit;
}

export function BalanceAccountSection() {
  const [asOf, setAsOf] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [drilldownAccount, setDrilldownAccount] = useState<{
    accountId: string;
    code: string;
    name: string;
  } | null>(null);

  const balanceQuery = useQuery({
    queryKey: ["accounting", "balance-account", asOf],
    queryFn: async () => {
      const res = await fetchTrialBalance({ fromDate: null, toDate: asOf });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  /* TrialBalance returns rows where empty accounts are filtered out. Untuk
   * dashboard saldo akun, kita butuh ALL accounts dengan saldo (even Rp 0
   * untuk akun yang ada dengan saldo 0). Tapi minimal coba dulu — owner
   * lebih sering tertarik akun yang punya pergerakan. */
  const tb = balanceQuery.data;

  const totals = useMemo(() => {
    const t: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
      cogs: 0,
    };
    if (!tb) return t;
    for (const r of tb.rows as TrialBalanceRow[]) {
      t[r.type] += signedNormal(r.type, r.debit, r.credit);
    }
    return t;
  }, [tb]);

  const filteredRows = useMemo<TrialBalanceRow[]>(() => {
    if (!tb) return [];
    const q = search.trim().toLowerCase();
    return (tb.rows as TrialBalanceRow[]).filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (q && !r.code.includes(q) && !r.name.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [tb, typeFilter, search]);

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <Wallet className="size-6" aria-hidden /> Saldo Akun
          </h1>
          <p className="text-sm text-neutral-700">
            Lihat saldo terbaru per akun + drill-down riwayat transaksi.
            Click row untuk lihat semua entri jurnal yang mempengaruhi akun
            tersebut.
          </p>
        </div>
        <div className="w-56">
          <DatePicker
            label="Saldo per tanggal"
            value={asOf}
            onChange={(v) =>
              setAsOf(v ?? new Date().toISOString().slice(0, 10))
            }
            clearable={false}
          />
        </div>
      </header>

      {/* Stat cards per type */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {(
          [
            "asset",
            "liability",
            "equity",
            "revenue",
            "cogs",
            "expense",
          ] as const
        ).map((t) => {
          const meta = TYPE_META[t];
          const value = totals[t] ?? 0;
          return (
            <CategoryCard
              key={t}
              label={meta.label}
              value={value}
              tone={meta.tone}
              onClick={() => setTypeFilter(t === typeFilter ? "all" : t)}
              active={typeFilter === t}
            />
          );
        })}
      </div>

      {/* Filter + table */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1">
              <FilterPill
                active={typeFilter === "all"}
                onClick={() => setTypeFilter("all")}
                label="Semua"
              />
              {(
                Object.keys(TYPE_META) as AccountType[]
              ).map((t) => (
                <FilterPill
                  key={t}
                  active={typeFilter === t}
                  onClick={() => setTypeFilter(t)}
                  label={TYPE_META[t].label}
                />
              ))}
            </div>
            <div className="relative ml-auto w-full max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode/nama akun"
                className="pl-9"
              />
            </div>
          </div>

          {balanceQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredRows.length === 0 ? (
            <EmptyCard
              title="Tidak ada akun di filter ini"
              description={
                typeFilter !== "all" || search
                  ? "Coba ubah filter atau search."
                  : "Belum ada jurnal yang ter-post untuk ditampilkan."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Kode</th>
                    <th className="px-3 py-2 text-left">Nama Akun</th>
                    <th className="px-3 py-2 text-left">Tipe</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Kredit</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const meta = TYPE_META[r.type];
                    const normal = signedNormal(r.type, r.debit, r.credit);
                    return (
                      <tr
                        key={r.code}
                        onClick={() =>
                          // Look up accountId from balance row — TrialBalanceRow
                          // doesn't have it, so we drill via code lookup.
                          setDrilldownAccount({
                            accountId: r.code, // placeholder, will resolve in modal
                            code: r.code,
                            name: r.name,
                          })
                        }
                        className="cursor-pointer border-t border-neutral-100 hover:bg-mahakan-green-50/30"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {r.code}
                        </td>
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                              meta.tone === "info" &&
                                "bg-blue-100 text-blue-700",
                              meta.tone === "warning" &&
                                "bg-warning-100 text-warning-700",
                              meta.tone === "success" &&
                                "bg-success-100 text-success-700",
                              meta.tone === "danger" &&
                                "bg-danger-100 text-danger-700",
                              meta.tone === "neutral" &&
                                "bg-neutral-100 text-neutral-700",
                            )}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-neutral-600">
                          {r.debit > 0 ? formatRupiah(r.debit) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-neutral-600">
                          {r.credit > 0 ? formatRupiah(r.credit) : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono font-semibold",
                            normal >= 0
                              ? "text-neutral-900"
                              : "text-danger-600",
                          )}
                        >
                          {formatRupiah(Math.abs(normal))}
                          {normal < 0 ? (
                            <span className="ml-1 text-[10px] text-danger-500">
                              (kontra)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-400">
                          <ChevronRight className="size-4" aria-hidden />
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

      <AccountLedgerModal
        accountCode={drilldownAccount?.code ?? null}
        accountName={drilldownAccount?.name ?? null}
        asOf={asOf}
        onClose={() => setDrilldownAccount(null)}
      />
    </div>
  );
}

function CategoryCard({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number;
  tone: "neutral" | "danger" | "success" | "warning" | "info";
  onClick: () => void;
  active: boolean;
}) {
  const toneClass = {
    info: "border-blue-300 bg-blue-50/40",
    success: "border-success-500/30 bg-success-50/40",
    warning: "border-warning-500/30 bg-warning-50/40",
    danger: "border-danger-500/30 bg-danger-50/40",
    neutral: "border-neutral-200 bg-white",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-4 text-left transition-all hover:shadow-sm",
        toneClass,
        active && "ring-2 ring-mahakan-green-700 ring-offset-1",
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-neutral-900">
        {formatRupiah(value)}
      </div>
    </button>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}

function AccountLedgerModal({
  accountCode,
  accountName,
  asOf,
  onClose,
}: {
  accountCode: string | null;
  accountName: string | null;
  asOf: string;
  onClose: () => void;
}) {
  // From trial balance row we only have `code`. Need `accountId` to fetch
  // ledger. Resolve via fetchAccounts list once and lookup by code.
  const accountsQuery = useQuery({
    queryKey: ["accounting", "accounts-active"],
    queryFn: async () => {
      const res = await fetchAccounts({ isActive: true });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const accountId = accountsQuery.data?.find(
    (a: { code: string; id: string }) => a.code === accountCode,
  )?.id;

  const fromDefault = (() => {
    const d = new Date(asOf);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [from, setFrom] = useState(fromDefault);
  const [to, setTo] = useState(asOf);

  const ledgerQuery = useQuery({
    queryKey: ["accounting", "ledger", accountId, from, to],
    queryFn: async () => {
      if (!accountId) return null;
      const res = await fetchGeneralLedger({ accountId, fromDate: from, toDate: to });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: !!accountId,
  });

  if (!accountCode) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Buku Besar — ${accountCode} ${accountName ?? ""}`}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Dari"
            value={from}
            onChange={(v) => v && setFrom(v)}
            clearable={false}
          />
          <DatePicker
            label="Sampai"
            value={to}
            onChange={(v) => v && setTo(v)}
            clearable={false}
          />
        </div>

        {ledgerQuery.isLoading || accountsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !ledgerQuery.data ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            Pilih akun valid untuk lihat buku besar.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryBox
                label="Saldo Awal"
                value={formatRupiah(Math.abs(ledgerQuery.data.openingBalance))}
                negative={ledgerQuery.data.openingBalance < 0}
              />
              <SummaryBox
                label="Saldo Akhir"
                value={formatRupiah(Math.abs(ledgerQuery.data.closingBalance))}
                negative={ledgerQuery.data.closingBalance < 0}
                bold
              />
              <SummaryBox
                label="Jumlah Transaksi"
                value={String(ledgerQuery.data.entries.length)}
              />
            </div>
            <div className="max-h-96 overflow-auto rounded-md border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-neutral-100 text-neutral-700">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Tanggal</th>
                    <th className="px-2 py-1.5 text-left">No Jurnal</th>
                    <th className="px-2 py-1.5 text-left">Deskripsi</th>
                    <th className="px-2 py-1.5 text-right">Debit</th>
                    <th className="px-2 py-1.5 text-right">Kredit</th>
                    <th className="px-2 py-1.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerQuery.data.entries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-neutral-500"
                      >
                        Tidak ada transaksi di range ini.
                      </td>
                    </tr>
                  ) : (
                    ledgerQuery.data.entries.map((e: GeneralLedgerEntry, i: number) => (
                      <tr
                        key={i}
                        className="border-t border-neutral-100 font-mono"
                      >
                        <td className="px-2 py-1">{e.entryDate}</td>
                        <td className="px-2 py-1">{e.entryNumber}</td>
                        <td className="px-2 py-1 text-neutral-700">
                          {e.lineDescription || e.entryDescription}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {e.debit > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-success-700">
                              <ArrowUpCircle className="size-3" aria-hidden />
                              {formatRupiah(e.debit)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {e.credit > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-warning-700">
                              <ArrowDownCircle
                                className="size-3"
                                aria-hidden
                              />
                              {formatRupiah(e.credit)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-semibold">
                          {formatRupiah(Math.abs(e.balanceAfter))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1">
                <History className="size-3" aria-hidden />
                Tipe akun:{" "}
                <span className="font-semibold">
                  {ledgerQuery.data.accountType}
                </span>
              </span>
              <span>
                Normal balance:{" "}
                <span className="font-semibold">
                  {ledgerQuery.data.normalBalance}
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function SummaryBox({
  label,
  value,
  negative,
  bold,
}: {
  label: string;
  value: string;
  negative?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono",
          bold ? "text-lg font-bold" : "text-sm font-semibold",
          negative ? "text-danger-600" : "text-neutral-900",
        )}
      >
        {value}
        {negative ? (
          <span className="ml-1 text-[10px] text-danger-500">(kontra)</span>
        ) : null}
      </div>
    </div>
  );
}
