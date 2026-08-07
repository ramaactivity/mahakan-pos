"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronRight,
  History,
  Info,
  Loader2,
  Search,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  DatePicker,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
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
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updateFeatures,
} from "@/features/outlets";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

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
    todayJakarta(),
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [drilldownAccount, setDrilldownAccount] = useState<{
    accountId: string;
    code: string;
    name: string;
  } | null>(null);

  /* Fix AE-62b — sebelumnya pakai fetchTrialBalance saja, tapi
   * buildTrialBalance filter out akun yang debit=0 dan credit=0 → Mahakan
   * baru trial <1 minggu, banyak akun belum punya jurnal post → table
   * kosong tertulis "Tidak ada akun di filter ini" walau Bagan Akun
   * banyak isinya. Sekarang fetch SEMUA akun aktif + merge dengan TB,
   * akun tanpa movement tampil dengan saldo Rp 0. */
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ["accounting", "accounts-active-balance"],
    queryFn: async () => {
      const res = await fetchAccounts({ isActive: true });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const balanceQuery = useQuery({
    queryKey: ["accounting", "balance-account", asOf],
    queryFn: async () => {
      const res = await fetchTrialBalance({ fromDate: null, toDate: asOf });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  /* Sesi AE-62c — read auto-journal flag dari outlet settings supaya
   * banner kasih tau owner kenapa Saldo masih Rp 0 + tombol toggle quick. */
  const outletQuery = useQuery({
    queryKey: ["admin", "outlet", "own"],
    queryFn: async () => {
      const res = await getOwnOutlet();
      if (!outletIsOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const autoJournalEnabled =
    outletQuery.data?.settings?.features?.accounting_auto_journal === true;
  const [activating, setActivating] = useState(false);

  async function handleEnableAutoJournal() {
    setActivating(true);
    try {
      const res = await updateFeatures({ accounting_auto_journal: true });
      if (!outletIsOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        "Auto-Journal aktif. Transaksi POS / payroll / setoran berikutnya akan auto-post ke jurnal.",
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "outlet"] });
    } finally {
      setActivating(false);
    }
  }

  const accounts = accountsQuery.data;
  const tb = balanceQuery.data;

  /** Merged row: setiap akun aktif + saldo dari TB (default 0 kalau no movement). */
  type MergedRow = {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    debit: number;
    credit: number;
    hasMovement: boolean;
  };

  const mergedRows = useMemo<MergedRow[]>(() => {
    if (!accounts) return [];
    const tbMap = new Map<string, { debit: number; credit: number }>();
    if (tb) {
      for (const r of tb.rows as TrialBalanceRow[]) {
        tbMap.set(r.code, { debit: r.debit, credit: r.credit });
      }
    }
    return accounts
      .map((a) => {
        const tbRow = tbMap.get(a.code);
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type as AccountType,
          debit: tbRow?.debit ?? 0,
          credit: tbRow?.credit ?? 0,
          hasMovement: !!tbRow,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, tb]);

  const totals = useMemo(() => {
    const t: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
      cogs: 0,
    };
    for (const r of mergedRows) {
      t[r.type] += signedNormal(r.type, r.debit, r.credit);
    }
    return t;
  }, [mergedRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mergedRows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (q && !r.code.includes(q) && !r.name.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [mergedRows, typeFilter, search]);

  const movementCount = mergedRows.filter((r) => r.hasMovement).length;
  const totalAccounts = mergedRows.length;
  const isLoading = accountsQuery.isLoading || balanceQuery.isLoading;

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
              setAsOf(v ?? todayJakarta())
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

      {/* Sesi AE-62c — banner state-aware berdasar auto-journal flag.
        * Owner perlu tau: kenapa saldo Rp 0? Karena flag OFF (paling sering),
        * atau karena belum ada transaksi (kalau flag sudah ON). */}
      {!isLoading && !outletQuery.isLoading && totalAccounts > 0 ? (
        movementCount === 0 && !autoJournalEnabled ? (
          // FLAG OFF — actionable: kasih CTA Aktifkan
          <div className="rounded-lg border-2 border-warning-500/50 bg-warning-50/40 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-100">
                <Zap className="size-5 text-warning-700" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-warning-900">
                  Auto-Journal NONAKTIF — saldo akun tidak akan auto-update
                </h3>
                <p className="mt-1 text-sm text-neutral-700">
                  <strong>{totalAccounts} akun</strong> sudah ada di Bagan Akun,
                  tapi semua saldo masih Rp 0 karena <em>auto-journal flag</em> belum
                  diaktifkan. Saat ini transaksi POS / payroll / setoran / pembelian
                  TIDAK auto-post ke jurnal akuntansi.
                </p>
                <p className="mt-2 text-xs text-neutral-600">
                  <strong>Solusi:</strong> Klik tombol di kanan untuk aktifkan
                  sekarang. Transaksi berikutnya akan otomatis fire jurnal →
                  saldo akun terupdate realtime. Aman dicoba — error di-track
                  via audit log <code className="rounded bg-neutral-100 px-1">journal.posting_failed</code>.
                </p>
              </div>
              <Button
                onClick={handleEnableAutoJournal}
                disabled={activating}
                className="shrink-0"
              >
                {activating ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Zap className="size-4" aria-hidden />
                )}{" "}
                Aktifkan Auto-Journal
              </Button>
            </div>
          </div>
        ) : movementCount === 0 && autoJournalEnabled ? (
          // FLAG ON tapi belum ada movement — informational
          <div className="flex items-start gap-2 rounded-md border border-mahakan-green-300/40 bg-mahakan-green-50/40 p-3 text-sm text-neutral-700">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-mahakan-green-700"
              aria-hidden
            />
            <div>
              <strong className="text-mahakan-green-900">
                Auto-Journal AKTIF.
              </strong>{" "}
              Belum ada transaksi yang fire jurnal. Coba buat 1 transaksi POS
              (atau pembelian / setoran tunai) → saldo akun akan terupdate
              otomatis.
            </div>
          </div>
        ) : movementCount > 0 && movementCount < totalAccounts ? (
          <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50/60 p-2.5 text-xs text-neutral-600">
            <Info
              className="mt-0.5 size-3.5 shrink-0 text-neutral-500"
              aria-hidden
            />
            <div>
              <strong className="text-neutral-800">{movementCount}</strong> dari{" "}
              <strong className="text-neutral-800">{totalAccounts}</strong> akun
              sudah punya pergerakan. Akun lain tampil Rp 0 (belum ada transaksi
              menyentuh akun tersebut).
              {autoJournalEnabled ? null : (
                <span className="ml-1 text-warning-700">
                  · Auto-Journal masih NONAKTIF — transaksi baru tidak akan
                  fire jurnal.
                </span>
              )}
            </div>
          </div>
        ) : null
      ) : null}

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

          {isLoading ? (
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
                  ? "Coba ubah filter atau hapus search."
                  : "Belum ada akun aktif. Tambah akun di tab Akuntansi → Bagan Akun."
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
                        key={r.id}
                        onClick={() =>
                          setDrilldownAccount({
                            accountId: r.id,
                            code: r.code,
                            name: r.name,
                          })
                        }
                        className={cn(
                          "cursor-pointer border-t border-neutral-100 hover:bg-mahakan-green-50/30",
                          !r.hasMovement && "opacity-60",
                        )}
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
        accountId={drilldownAccount?.accountId ?? null}
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
  accountId,
  accountCode,
  accountName,
  asOf,
  onClose,
}: {
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  asOf: string;
  onClose: () => void;
}) {
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

  if (!accountCode || !accountId) return null;

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

        {ledgerQuery.isLoading ? (
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
