"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Banknote,
  ChevronRight,
  ListChecks,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Input,
  Select,
  Skeleton,
  toast,
  type SelectOption,
} from "@/components/ui";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteInvestor,
  getTotalModalInvestors,
  isOk,
  listInvestors,
  type Investor,
  type InvestorStatus,
  type InvestorWithStats,
} from "@/features/investors";
import {
  deletePengelola,
  getTotalModalPengelola,
  listPengelola,
  type Pengelola,
  type PengelolaWithStats,
} from "@/features/pengelola";
import {
  computeDistributionForPeriod,
  getDistribution,
  listDistributions,
  type ProfitDistribution,
} from "@/features/profit-distributions";
import { CapitalChangesReportView } from "./investors/CapitalChangesReportView";
import { InvestorFormModal } from "./investors/InvestorFormModal";
import { CreditorImportWizard } from "./investors/CreditorImportWizard";
import { InvestorImportWizard } from "./investors/InvestorImportWizard";
import { PengelolaImportWizard } from "./investors/PengelolaImportWizard";
import { PengelolaFormModal } from "./investors/PengelolaFormModal";
import { DistributionPreviewModal } from "./investors/DistributionPreviewModal";
/* Sesi AE-80 — Tab baru untuk modal-dividen v2. */
import { BalancesTab } from "./investors/BalancesTab";
import { CreditorsTab } from "./investors/CreditorsTab";
import { ShareTransactionsTab } from "./investors/ShareTransactionsTab";

type Tab =
  | "investors"
  | "pengelola"
  | "share_transactions"
  | "balances"
  | "creditors"
  | "distribution"
  | "report";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "investors", label: "Investor" },
  { key: "pengelola", label: "Pengelola" },
  /* Sesi AE-80 — 3 tab baru. */
  { key: "share_transactions", label: "Mutasi Saham" },
  { key: "balances", label: "Saldo & Pencairan" },
  { key: "creditors", label: "Hutang Kreditur" },
  { key: "distribution", label: "Distribusi" },
  { key: "report", label: "Laporan" },
];

const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

interface InvestorsSectionProps {
  viewerRole: Role;
}

export function InvestorsSection({ viewerRole }: InvestorsSectionProps) {
  const [tab, setTab] = useState<Tab>("investors");
  const canManage = hasPermission(viewerRole, "investor.manage");
  const canManagePengelola = hasPermission(viewerRole, "pengelola.manage");
  const canApproveDistribution = hasPermission(
    viewerRole,
    "distribution.approve",
  );
  const canCompute = hasPermission(viewerRole, "distribution.compute");

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-mahakan-green-900">
          Modal & Dividen
        </h1>
        <p className="text-sm text-neutral-700">
          Investor + Pengelola Mahakan Coffee. Profit-share bulanan dari Net
          Profit ledger.
        </p>
      </header>

      <div className="flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "investors" ? (
        <InvestorsTab canManage={canManage} />
      ) : tab === "pengelola" ? (
        <PengelolaTab canManage={canManagePengelola} />
      ) : tab === "share_transactions" ? (
        <ShareTransactionsTab canManage={canApproveDistribution} />
      ) : tab === "balances" ? (
        <BalancesTab canManage={canApproveDistribution} />
      ) : tab === "creditors" ? (
        <CreditorsTab canManage={canApproveDistribution} />
      ) : tab === "distribution" ? (
        <DistributionTab
          canCompute={canCompute}
          canApprove={canApproveDistribution}
        />
      ) : (
        <ReportTab />
      )}
    </div>
  );
}

/* ─────────────────────────── INVESTOR TAB ─────────────────────────── */

function InvestorsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvestorStatus | "all">(
    "active",
  );
  const [editing, setEditing] = useState<Investor | null>(null);
  /* Sesi AE-68 — Highlight row di list setelah save sukses (3 detik fade). */
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /* Sesi AE-63 audit P1.3 — staleTime 2min default supaya refetch ga boros
   * saat search debounce ulang. Sesi AE-68 — refetchOnMount: 'always' supaya
   * tab switch / window focus pasti cek fresh data (mencegah scenario owner
   * import 73 investor di wizard, lalu tab switch, lihat 0 ditampilkan). */
  const investorsQuery = useQuery({
    queryKey: ["investors", { search, statusFilter }],
    queryFn: async () => {
      const res = await listInvestors({
        search: search || undefined,
        status: statusFilter,
        pageSize: 200,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
    refetchOnMount: "always",
  });

  const totalQuery = useQuery({
    queryKey: ["investors-total"],
    queryFn: async () => {
      const res = await getTotalModalInvestors();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const investors = investorsQuery.data?.items ?? [];

  /* Sesi AE-63 audit P1.2 — useCallback supaya InvestorRow.memo stable.
   * Tanpa useCallback, parent re-render bikin handler ref baru per render
   * → React.memo bypass → 110 row re-render. */
  const handleDelete = useCallback(
    async (inv: InvestorWithStats) => {
      if (!window.confirm(`Hapus investor "${inv.fullName}"?`)) return;
      const res = await deleteInvestor(inv.id);
      if (!isOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Investor ${inv.fullName} dihapus`);
      qc.invalidateQueries({ queryKey: ["investors"] });
      qc.invalidateQueries({ queryKey: ["investors-total"] });
    },
    [qc],
  );

  /* Sesi AE-68 — Pakai removeQueries + refetchQueries untuk hard-invalidate
   * supaya cache stale (mis. owner barusan import 73 investor tapi UI masih
   * show 0 dari cache) langsung di-replace. invalidateQueries solo cuma mark
   * stale, kalau ada race antara observer mount + cache pop bisa miss. */
  const refresh = useCallback(() => {
    qc.removeQueries({ queryKey: ["investors"] });
    qc.removeQueries({ queryKey: ["investors-total"] });
    qc.refetchQueries({ queryKey: ["investors"] });
    qc.refetchQueries({ queryKey: ["investors-total"] });
  }, [qc]);

  const statusOptions: SelectOption[] = [
    { value: "all", label: "Semua status" },
    { value: "active", label: "Aktif" },
    { value: "inactive", label: "Tidak aktif" },
    { value: "exited", label: "Keluar" },
  ];

  /* Sesi AE-63 audit P1.2 — memoize derived data supaya tidak recompute
   * tiap parent setState (search, filter change). 110 investor × reduce
   * tanpa memo = unnecessary work each render. */
  const totalModalActive = totalQuery.data?.total ?? 0;
  const avgModal = useMemo(
    () =>
      totalQuery.data && totalQuery.data.count > 0
        ? Math.round(totalQuery.data.total / totalQuery.data.count)
        : 0,
    [totalQuery.data],
  );
  const totalDividendYtd = useMemo(
    () => investors.reduce((s, i) => s + (i.dividendYtd ?? 0), 0),
    [investors],
  );
  /* Pre-compute sharePct + masked NIK per row sekali, supaya InvestorRow
   * (memoized) dapet stable primitive props vs recompute per render. */
  const investorsView = useMemo(
    () =>
      investors.map((inv) => ({
        ...inv,
        sharePct:
          totalModalActive > 0 && inv.status === "active"
            ? (inv.modalDisetor / totalModalActive) * 100
            : 0,
        nikMasked: inv.nik
          ? `${inv.nik.slice(0, 4)}…${inv.nik.slice(-3)}`
          : null,
      })),
    [investors, totalModalActive],
  );

  return (
    <div className="space-y-4">
      {/* Summary stats grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Investor Aktif"
          value={`${totalQuery.data?.count ?? 0} orang`}
          sub={formatRupiah(totalModalActive)}
          tone="primary"
        />
        <StatTile
          icon={Banknote}
          label="Rata-rata Modal"
          value={formatRupiah(avgModal)}
          sub="Per investor"
        />
        <StatTile
          icon={TrendingUp}
          label="Dividen YTD"
          value={formatRupiah(totalDividendYtd)}
          sub="Total dibayar"
        />
        <StatTile
          icon={ListChecks}
          label="Tampilan Saat Ini"
          value={`${investors.length} ditampilkan`}
          sub={
            statusFilter === "all"
              ? "Semua status"
              : statusFilter === "active"
                ? "Status aktif"
                : statusFilter === "exited"
                  ? "Status keluar"
                  : "Status tidak aktif"
          }
        />
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            placeholder="🔍 Cari nama / NIK / email / telp..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <div className="min-w-[160px]">
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v ?? "active") as InvestorStatus | "all")
              }
              options={statusOptions}
            />
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 size-4" /> Import CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Tambah
            </Button>
          </div>
        ) : null}
      </div>

      {/* List */}
      {investorsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : investorsQuery.isError ? (
        /* Sesi AE-68 hotfix — display error supaya tidak silent saat
         * server action throw. Plus tombol Retry untuk manual refetch. */
        <div className="rounded-lg border border-danger-300 bg-danger-50 p-6 text-center">
          <p className="text-sm font-semibold text-danger-700">
            Gagal load data investor
          </p>
          <p className="mt-1 text-xs text-danger-600">
            {investorsQuery.error instanceof Error
              ? investorsQuery.error.message
              : "Unknown error"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              qc.removeQueries({ queryKey: ["investors"] });
              void investorsQuery.refetch();
            }}
          >
            Coba Lagi
          </Button>
        </div>
      ) : investors.length === 0 ? (
        <EmptyCard
          icon={Users}
          title={search ? "Tidak ada hasil pencarian" : "Belum ada investor"}
          description={
            search
              ? "Coba kata kunci lain atau ubah filter status."
              : "Tambah investor satu-satu via tombol di atas, atau download template CSV → isi data → import."
          }
        />
      ) : (
        <VirtualInvestorList
          investors={investorsView}
          canManage={canManage}
          onEdit={setEditing}
          onDelete={handleDelete}
          highlightedId={highlightedId}
        />
      )}

      {/* Sesi AE-68 — key={editing?.id ?? "new"} force-remount modal saat
       * row yang di-edit berubah (atau switch create↔edit). Tanpa key,
       * React reuse modal instance dengan stale form state — pre-fill
       * dari useEffect deps [open, initial] kadang race dengan parent
       * re-render setelah refresh(), bikin field show old value. */}
      <InvestorFormModal
        key={editing?.id ?? "new"}
        open={createOpen || editing !== null}
        initial={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={(updatedId) => {
          refresh();
          setHighlightedId(updatedId ?? editing?.id ?? null);
          setTimeout(() => setHighlightedId(null), 3000);
        }}
      />
      <InvestorImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
      />
    </div>
  );
}

/* ─────────────────────────── PENGELOLA TAB ─────────────────────────── */

function PengelolaTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Pengelola | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const pengelolaQuery = useQuery({
    queryKey: ["pengelola"],
    queryFn: async () => {
      const res = await listPengelola();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // AE-63 audit P1.3
    refetchOnMount: "always", // AE-68 — mencegah stale cache after import
  });

  const totalQuery = useQuery({
    queryKey: ["pengelola-total"],
    queryFn: async () => {
      const res = await getTotalModalPengelola();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
    refetchOnMount: "always",
  });

  const pengelolaList = pengelolaQuery.data ?? [];

  /* Sesi AE-63 phase2 P2.3 — useCallback + useMemo mirror investor pattern. */
  const handleDelete = useCallback(
    async (p: PengelolaWithStats) => {
      if (!window.confirm(`Hapus pengelola "${p.fullName}"?`)) return;
      const res = await deletePengelola(p.id);
      if (!isOk(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Pengelola ${p.fullName} dihapus`);
      qc.invalidateQueries({ queryKey: ["pengelola"] });
      qc.invalidateQueries({ queryKey: ["pengelola-total"] });
    },
    [qc],
  );

  const refresh = useCallback(() => {
    /* Sesi AE-68 — Hard refresh (remove + refetch) supaya cache stale
     * langsung di-replace, mirror investor pattern. */
    qc.removeQueries({ queryKey: ["pengelola"] });
    qc.removeQueries({ queryKey: ["pengelola-total"] });
    qc.refetchQueries({ queryKey: ["pengelola"] });
    qc.refetchQueries({ queryKey: ["pengelola-total"] });
  }, [qc]);

  const totalDividendYtd = useMemo(
    () => pengelolaList.reduce((s, p) => s + (p.dividendYtd ?? 0), 0),
    [pengelolaList],
  );

  return (
    <div className="space-y-4">
      {/* Summary cards (3-up) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          icon={Banknote}
          label="Modal Pengelola"
          value={
            totalQuery.data ? formatRupiah(totalQuery.data.total) : "—"
          }
          sub={`${totalQuery.data?.count ?? 0} pengelola aktif`}
          tone="amber"
        />
        <StatTile
          icon={TrendingUp}
          label="Dividen YTD (65% Pool)"
          value={formatRupiah(totalDividendYtd)}
          sub="Total dibagi ke pengelola"
        />
        <div className="flex items-end justify-end gap-2">
          {canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                title="Import dari CSV"
              >
                <Upload className="mr-1.5 size-4" /> Import CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 size-4" /> Tambah Pengelola
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {pengelolaQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : pengelolaList.length === 0 ? (
        <EmptyCard
          icon={Banknote}
          title="Belum ada pengelola"
          description="Tambah 5 manager Mahakan: Anisa Amalia, Intan Nabila, Muhamad Bayu Kurnia, Muhaman Sekal Maulidan, Muhamad Ramadan Saputra."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Nama</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Modal
                </th>
                <th className="px-3 py-2.5 font-semibold">% Pool Share</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Dividen YTD
                </th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pengelolaList.map((p) => (
                <PengelolaRow
                  key={p.id}
                  p={p}
                  canManage={canManage}
                  onEdit={setEditing}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PengelolaFormModal
        open={createOpen || editing !== null}
        initial={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={refresh}
      />
      <PengelolaImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
      />
    </div>
  );
}

/* ─────────────────────────── DISTRIBUTION TAB ─────────────────────────── */

function DistributionTab({
  canCompute,
  canApprove,
}: {
  canCompute: boolean;
  canApprove: boolean;
}) {
  const qc = useQueryClient();
  const today = new Date();
  const defaultYear = today.getUTCFullYear();
  const defaultMonth = today.getUTCMonth() + 1; // 1-12, current month
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [computing, setComputing] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const distributionsQuery = useQuery({
    queryKey: ["distributions"],
    queryFn: async () => {
      const res = await listDistributions();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // AE-63 audit P1.3
  });

  const previewQuery = useQuery({
    queryKey: ["distribution-detail", previewId],
    enabled: previewId !== null,
    queryFn: async () => {
      if (!previewId) return null;
      const res = await getDistribution(previewId);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const distributions = distributionsQuery.data ?? [];

  async function handleCompute() {
    if (computing) return;
    setComputing(true);
    const res = await computeDistributionForPeriod({
      periodYear: year,
      periodMonth: month,
    });
    setComputing(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Distribusi ${MONTH_LABELS_ID[month - 1]} ${year} di-compute (status draft)`,
    );
    qc.invalidateQueries({ queryKey: ["distributions"] });
    setPreviewId(res.data.id);
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["distributions"] });
    qc.invalidateQueries({ queryKey: ["distribution-detail"] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="size-5 text-mahakan-green-700" />
            Hitung Distribusi Bulanan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[140px]">
              <Select
                label="Tahun"
                value={String(year)}
                onValueChange={(v) => setYear(Number(v ?? year))}
                options={[year - 2, year - 1, year, year + 1].map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
              />
            </div>
            <div className="min-w-[180px]">
              <Select
                label="Bulan"
                value={String(month)}
                onValueChange={(v) => setMonth(Number(v ?? month))}
                options={MONTH_LABELS_ID.map((m, i) => ({
                  value: String(i + 1),
                  label: m,
                }))}
              />
            </div>
            <Button
              onClick={handleCompute}
              loading={computing}
              disabled={!canCompute}
            >
              <PlayCircle className="mr-1.5 size-4" />
              Hitung Bulan Ini (draft)
            </Button>
          </div>
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            💡 Server fetch Net Profit dari Income Statement + compute per
            holder. Owner verify per-baris lalu Approve & Post → jurnal
            otomatis ter-create + email statement dikirim ke 115 holder.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Distribusi Tercatat</CardTitle>
            <p className="mt-1 text-xs text-neutral-600">
              {distributions.length} distribusi · klik baris untuk detail
            </p>
          </div>
          <Badge variant="neutral">
            {distributions.filter((d) => d.status === "posted").length}{" "}
            posted
          </Badge>
        </CardHeader>
        <CardContent>
          {distributionsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : distributions.length === 0 ? (
            <EmptyCard
              icon={PlayCircle}
              title="Belum ada distribusi"
              description="Pilih tahun + bulan di atas, klik 'Hitung Bulan Ini' — server hitung otomatis dari Net Profit Income Statement."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-neutral-600">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Periode</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Net Profit
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Bagi Hasil
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Pool Investor
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Pool Pengelola
                    </th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {distributions.map((d) => (
                    <DistributionRow
                      key={d.id}
                      dist={d}
                      onView={() => setPreviewId(d.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DistributionPreviewModal
        open={previewId !== null}
        distribution={previewQuery.data ?? null}
        onClose={() => setPreviewId(null)}
        onChanged={refresh}
        canApprove={canApprove}
      />
    </div>
  );
}

function DistributionRow({
  dist,
  onView,
}: {
  dist: ProfitDistribution;
  onView: () => void;
}) {
  const statusLabel: Record<typeof dist.status, string> = {
    draft: "Draft",
    approved: "Approved",
    posted: "Posted ✓",
    cancelled: "Cancelled",
    reversed: "Reversed ↺",
  };
  return (
    <tr
      onClick={onView}
      className="cursor-pointer transition-colors hover:bg-neutral-50"
    >
      <td className="px-3 py-2.5 font-medium text-neutral-900">
        {MONTH_LABELS_ID[dist.periodMonth - 1]} {dist.periodYear}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium">
        {formatRupiah(dist.netProfitSnapshot)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-mahakan-green-900 font-semibold">
        {formatRupiah(dist.bagiHasilAmount)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-blue-700">
        {formatRupiah(dist.investorPoolAmount)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
        {formatRupiah(dist.pengelolaPoolAmount)}
      </td>
      <td className="px-3 py-2.5">
        <Badge
          variant={
            dist.status === "posted"
              ? "success"
              : dist.status === "cancelled"
                ? "danger"
                : dist.status === "draft"
                  ? "warning"
                  : "info"
          }
        >
          {statusLabel[dist.status] ?? dist.status}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          Detail <ChevronRight className="ml-1 size-3.5" />
        </Button>
      </td>
    </tr>
  );
}

/* ─────────────────────────── REPORT TAB ─────────────────────────── */

function ReportTab() {
  return <CapitalChangesReportView />;
}

/* ─────────────────────────── SHARED ─────────────────────────── */

/* Sesi AE-63 audit P1.2 — memoized row component. Props stable per item
 * (Investor data + canCallback refs), supaya search/filter parent re-render
 * tidak trigger re-render 110 row.
 *
 * Sesi AE-63 phase3 P3.1 — converted dari `<tr>` ke `<div role="row">` grid
 * layout supaya bisa di-virtualize dengan @tanstack/react-virtual. Layout
 * visual identik (CSS grid match prior table column widths). DOM count drop
 * dari ~110 ke ~20 visible rows di Galaxy A7 Lite (60-70% reduction).
 *
 * View type extends InvestorWithStats dengan precomputed sharePct + nikMasked
 * (lihat investorsView useMemo di InvestorsTab).
 *
 * Sesi AE-80 — schema sharePct sekarang decimal(7,4) → Drizzle map ke string.
 * View override jadi number (live-computed). Pakai Omit supaya intersection
 * tidak konflik string vs number. */
type InvestorRowView = Omit<InvestorWithStats, "sharePct"> & {
  sharePct: number;
  nikMasked: string | null;
};

/* Sesi AE-80 — Bridge balik dari InvestorRowView ke InvestorWithStats
 * untuk handler edit/delete yang expect schema sharePct (string). */
function toInvestorWithStats(view: InvestorRowView): InvestorWithStats {
  return {
    ...view,
    sharePct: view.sharePct.toFixed(4),
  };
}

/* Grid column template: align header + body rows. Tailwind arbitrary value
 * supaya className stable (memo-friendly), tidak via style object. */
const INVESTOR_COLS =
  "grid-cols-[minmax(200px,1.6fr)_minmax(120px,1fr)_140px_180px_140px_110px_100px]";

const InvestorRow = memo(function InvestorRow({
  inv,
  canManage,
  onEdit,
  onDelete,
  highlighted,
}: {
  inv: InvestorRowView;
  canManage: boolean;
  onEdit: (inv: InvestorWithStats) => void;
  onDelete: (inv: InvestorWithStats) => void;
  /** Sesi AE-68 — kalau true, row di-highlight 3 detik setelah save. */
  highlighted?: boolean;
}) {
  return (
    <div
      role="row"
      className={cn(
        "grid items-center border-b border-neutral-100 text-sm transition-colors",
        INVESTOR_COLS,
        highlighted
          ? "bg-mahakan-green-50 ring-2 ring-mahakan-green-500/40"
          : "hover:bg-neutral-50",
      )}
    >
      <div role="cell" className="px-3 py-2">
        <p className="font-medium text-neutral-900">{inv.fullName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
          {inv.nikMasked ? <span>NIK: {inv.nikMasked}</span> : null}
          {inv.email ? <span>· {inv.email}</span> : null}
          {inv.igHandle ? <span>· {inv.igHandle}</span> : null}
        </div>
      </div>
      <div role="cell" className="px-3 py-2 text-neutral-700">
        {inv.occupation ?? "—"}
      </div>
      <div
        role="cell"
        className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-900"
      >
        {formatRupiah(inv.modalDisetor)}
      </div>
      <div role="cell" className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="absolute inset-y-0 left-0 bg-mahakan-green-700 transition-all"
              style={{ width: `${Math.min(100, inv.sharePct)}%` }}
            />
          </div>
          <span className="min-w-[40px] text-right text-[11px] font-medium tabular-nums text-neutral-700">
            {inv.sharePct.toFixed(2)}%
          </span>
        </div>
      </div>
      <div role="cell" className="px-3 py-2 text-right tabular-nums">
        {inv.dividendYtd > 0 ? (
          <span className="text-emerald-700">
            {formatRupiah(inv.dividendYtd)}
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </div>
      <div role="cell" className="px-3 py-2">
        <StatusBadge status={inv.status} />
      </div>
      <div role="cell" className="px-3 py-2 text-right">
        {canManage ? (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(toInvestorWithStats(inv))}
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(toInvestorWithStats(inv))}
              className="text-red-600 hover:bg-red-50"
              title="Hapus"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/* Sesi AE-63 phase3 P3.1 — Virtualized list container. useVirtualizer kasih
 * absolute positioning per row, scrollable parent. estimateSize 64px (2 line
 * info: nama + NIK/email row). overscan 8 row supaya scroll smooth saat user
 * fling cepat di tablet.
 *
 * Layout:
 *  - outer: rounded card border, fixed max-height supaya scroll predictable
 *  - header (sticky-like via flex order; sebenarnya di luar scroll, di atasnya)
 *  - body: ref=parentRef, overflow-auto (both axis untuk small screens),
 *    inner div height=totalSize untuk maintain scrollbar
 *  - virtual row: absolute, translateY (transform GPU-cheap) */
function VirtualInvestorList({
  investors,
  canManage,
  onEdit,
  onDelete,
  highlightedId,
}: {
  investors: InvestorRowView[];
  canManage: boolean;
  onEdit: (inv: InvestorWithStats) => void;
  onDelete: (inv: InvestorWithStats) => void;
  highlightedId?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: investors.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
      {/* Header (di luar scroll body supaya selalu visible) */}
      <div
        role="row"
        className={cn(
          "grid border-b border-neutral-200 bg-neutral-50 text-left text-sm font-semibold text-neutral-600",
          INVESTOR_COLS,
        )}
      >
        <div role="columnheader" className="px-3 py-2.5">
          Nama
        </div>
        <div role="columnheader" className="px-3 py-2.5">
          Pekerjaan
        </div>
        <div role="columnheader" className="px-3 py-2.5 text-right">
          Modal
        </div>
        <div role="columnheader" className="px-3 py-2.5">
          % Share
        </div>
        <div role="columnheader" className="px-3 py-2.5 text-right">
          Dividen YTD
        </div>
        <div role="columnheader" className="px-3 py-2.5">
          Status
        </div>
        <div role="columnheader" className="px-3 py-2.5 text-right">
          Aksi
        </div>
      </div>
      {/* Body — virtualized */}
      <div
        ref={parentRef}
        role="rowgroup"
        className="max-h-[600px] overflow-auto"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const inv = investors[vRow.index];
            if (!inv) return null;
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <InvestorRow
                  inv={inv}
                  canManage={canManage}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  highlighted={highlightedId === inv.id}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Sesi AE-63 phase2 P2.3 — Pengelola row (mirror InvestorRow memoization).
 * 5 row biasanya, tapi pattern konsisten + future-proof kalau owner tambah. */
const PengelolaRow = memo(function PengelolaRow({
  p,
  canManage,
  onEdit,
  onDelete,
}: {
  p: PengelolaWithStats;
  canManage: boolean;
  onEdit: (p: PengelolaWithStats) => void;
  onDelete: (p: PengelolaWithStats) => void;
}) {
  return (
    <tr className="transition-colors hover:bg-neutral-50">
      <td className="px-3 py-2">
        <p className="font-medium text-neutral-900">{p.fullName}</p>
        {p.email ? (
          <p className="text-xs text-neutral-500">{p.email}</p>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-900">
        {formatRupiah(p.modalDisetor)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative h-2 w-28 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
              style={{ width: `${Math.min(100, p.sharePct)}%` }}
            />
          </div>
          <span className="min-w-[50px] text-right text-xs font-semibold tabular-nums text-amber-900">
            {p.sharePct.toFixed(2)}%
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.dividendYtd > 0 ? (
          <span className="font-medium text-emerald-700">
            {formatRupiah(p.dividendYtd)}
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={p.status} />
      </td>
      <td className="px-3 py-2 text-right">
        {canManage ? (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(p)}
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(p)}
              className="text-red-600 hover:bg-red-50"
              title="Hapus"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </td>
    </tr>
  );
});

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge variant="success">Aktif</Badge>;
  if (status === "exited") return <Badge variant="danger">Keluar</Badge>;
  return <Badge variant="neutral">Tidak aktif</Badge>;
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "primary" | "amber";
}) {
  const cls =
    tone === "primary"
      ? "border-mahakan-green-700/30 bg-gradient-to-br from-mahakan-green-50 to-white"
      : tone === "amber"
        ? "border-amber-300/40 bg-gradient-to-br from-amber-50 to-white"
        : "border-neutral-200 bg-white";
  const iconCls =
    tone === "primary"
      ? "bg-mahakan-green-100 text-mahakan-green-700"
      : tone === "amber"
        ? "bg-amber-100 text-amber-700"
        : "bg-neutral-100 text-neutral-700";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-start gap-2">
        <div className={`shrink-0 rounded-md p-2 ${iconCls}`}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
            {label}
          </p>
          <p className="truncate text-base font-bold tabular-nums text-neutral-900 lg:text-lg">
            {value}
          </p>
          <p className="text-[11px] text-neutral-500">{sub}</p>
        </div>
      </div>
    </div>
  );
}

