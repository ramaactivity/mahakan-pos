"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  ChevronRight,
  Pencil,
  PlayCircle,
  Plus,
  Upload,
  Users,
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
import { InvestorImportWizard } from "./investors/InvestorImportWizard";
import { PengelolaFormModal } from "./investors/PengelolaFormModal";
import { DistributionPreviewModal } from "./investors/DistributionPreviewModal";

type Tab = "investors" | "pengelola" | "distribution" | "report";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "investors", label: "Investor" },
  { key: "pengelola", label: "Pengelola" },
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
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
  });

  const totalQuery = useQuery({
    queryKey: ["investors-total"],
    queryFn: async () => {
      const res = await getTotalModalInvestors();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const investors = investorsQuery.data?.items ?? [];

  async function handleDelete(inv: InvestorWithStats) {
    if (!window.confirm(`Hapus investor "${inv.fullName}"?`)) return;
    const res = await deleteInvestor(inv.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Investor ${inv.fullName} dihapus`);
    qc.invalidateQueries({ queryKey: ["investors"] });
    qc.invalidateQueries({ queryKey: ["investors-total"] });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["investors"] });
    qc.invalidateQueries({ queryKey: ["investors-total"] });
  }

  const statusOptions: SelectOption[] = [
    { value: "all", label: "Semua status" },
    { value: "active", label: "Aktif" },
    { value: "inactive", label: "Tidak aktif" },
    { value: "exited", label: "Keluar" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-mahakan-green-100 p-3">
              <Users className="size-5 text-mahakan-green-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Total Investor Aktif
              </p>
              <p className="text-xl font-bold text-mahakan-green-900">
                {totalQuery.data?.count ?? "—"} orang ·{" "}
                {totalQuery.data
                  ? formatRupiah(totalQuery.data.total)
                  : "—"}
              </p>
            </div>
          </div>
          {canManage ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="mr-1.5 size-4" /> Import CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 size-4" /> Tambah
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Cari nama / NIK / email / telp..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter((v ?? "active") as InvestorStatus | "all")
          }
          options={statusOptions}
        />
      </div>

      {/* List */}
      {investorsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : investors.length === 0 ? (
        <EmptyCard
          title="Belum ada investor"
          description="Tambah satu-satu atau import CSV dari Sheets."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-3 py-2 font-medium">Nama</th>
                <th className="px-3 py-2 font-medium">Pekerjaan</th>
                <th className="px-3 py-2 text-right font-medium">Modal</th>
                <th className="px-3 py-2 text-right font-medium">
                  Dividen YTD
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {investors.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-neutral-900">
                      {inv.fullName}
                    </p>
                    {inv.email ? (
                      <p className="text-xs text-neutral-500">{inv.email}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-700">
                    {inv.occupation ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatRupiah(inv.modalDisetor)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                    {formatRupiah(inv.dividendYtd)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(inv)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(inv)}
                          className="text-red-600"
                        >
                          Hapus
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InvestorFormModal
        open={createOpen || editing !== null}
        initial={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={refresh}
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

  const pengelolaQuery = useQuery({
    queryKey: ["pengelola"],
    queryFn: async () => {
      const res = await listPengelola();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const totalQuery = useQuery({
    queryKey: ["pengelola-total"],
    queryFn: async () => {
      const res = await getTotalModalPengelola();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const pengelolaList = pengelolaQuery.data ?? [];

  async function handleDelete(p: PengelolaWithStats) {
    if (!window.confirm(`Hapus pengelola "${p.fullName}"?`)) return;
    const res = await deletePengelola(p.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Pengelola ${p.fullName} dihapus`);
    qc.invalidateQueries({ queryKey: ["pengelola"] });
    qc.invalidateQueries({ queryKey: ["pengelola-total"] });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["pengelola"] });
    qc.invalidateQueries({ queryKey: ["pengelola-total"] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-3">
              <Banknote className="size-5 text-amber-700" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Total Modal Pengelola Aktif
              </p>
              <p className="text-xl font-bold text-amber-900">
                {totalQuery.data?.count ?? "—"} orang ·{" "}
                {totalQuery.data
                  ? formatRupiah(totalQuery.data.total)
                  : "—"}
              </p>
            </div>
          </div>
          {canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" /> Tambah Pengelola
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {pengelolaQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : pengelolaList.length === 0 ? (
        <EmptyCard
          title="Belum ada pengelola"
          description="Tambah 5 manager Mahakan: Anisa, Intan, Bayu, Sekal, Ramadan."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-3 py-2 font-medium">Nama</th>
                <th className="px-3 py-2 text-right font-medium">Modal</th>
                <th className="px-3 py-2 text-right font-medium">
                  Share Pool
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Dividen YTD
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pengelolaList.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-neutral-900">
                      {p.fullName}
                    </p>
                    {p.email ? (
                      <p className="text-xs text-neutral-500">{p.email}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatRupiah(p.modalDisetor)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                    {p.sharePct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                    {formatRupiah(p.dividendYtd)}
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
                          onClick={() => setEditing(p)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(p)}
                          className="text-red-600"
                        >
                          Hapus
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
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
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-neutral-600">Tahun</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
            >
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-600">Bulan</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
            >
              {MONTH_LABELS_ID.map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={handleCompute}
            loading={computing}
            disabled={!canCompute}
          >
            Hitung Bulan Ini (draft)
          </Button>
          <p className="text-xs text-neutral-500">
            Server fetch Net Profit dari Income Statement + compute per
            holder. Owner verify lalu approve.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribusi Tercatat</CardTitle>
        </CardHeader>
        <CardContent>
          {distributionsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : distributions.length === 0 ? (
            <EmptyCard
              title="Belum ada distribusi"
              description="Klik 'Hitung Bulan Ini' untuk mulai."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Periode</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Net Profit
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Bagi Hasil
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Investor
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Pengelola
                    </th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Aksi</th>
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
  return (
    <tr>
      <td className="px-3 py-2 font-medium">
        {MONTH_LABELS_ID[dist.periodMonth - 1]} {dist.periodYear}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatRupiah(dist.netProfitSnapshot)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatRupiah(dist.bagiHasilAmount)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatRupiah(dist.investorPoolAmount)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatRupiah(dist.pengelolaPoolAmount)}
      </td>
      <td className="px-3 py-2">
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
          {dist.status}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right">
        <Button variant="ghost" size="sm" onClick={onView}>
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

function StatusBadge({ status }: { status: string }) {
  if (status === "active")
    return <Badge variant="success">Aktif</Badge>;
  if (status === "exited") return <Badge variant="danger">Keluar</Badge>;
  return <Badge variant="neutral">Tidak aktif</Badge>;
}

