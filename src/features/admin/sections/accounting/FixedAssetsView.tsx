"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  Plus,
  TrendingDown,
  Trash2,
  Info,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  ResponsiveTable,
  Skeleton,
  toast,
  type ResponsiveColumn,
} from "@/components/ui";
import {
  deactivateFixedAsset,
  listFixedAssets,
  type FixedAssetRow,
} from "@/features/accounting/fixed-assets-actions";
import { hasPermission, type Role } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/money";
import { AssetFormModal } from "./AssetFormModal";
import { DepreciationModal } from "./DepreciationModal";
import { ImportAssetsModal } from "./ImportAssetsModal";

interface Props {
  viewerRole: Role;
}

export function FixedAssetsView({ viewerRole }: Props) {
  const [rows, setRows] = useState<FixedAssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);

  const canManage = hasPermission(viewerRole, "accounting.coa.manage");

  async function load() {
    setLoading(true);
    const res = await listFixedAssets();
    setLoading(false);
    if (res.ok) setRows(res.data);
    else toast.error(res.error.message);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function onDeactivate(asset: FixedAssetRow) {
    if (!confirm(`Hapus aset "${asset.name}"? (soft delete, journal tetap intact)`)) return;
    const res = await deactivateFixedAsset(asset.id);
    if (res.ok) {
      toast.success(`Aset ${asset.name} di-hapus`);
      void load();
    } else {
      toast.error(res.error.message);
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      cost: acc.cost + r.cost,
      accDep: acc.accDep + r.accumulatedDepreciation,
      nbv: acc.nbv + r.netBookValue,
    }),
    { cost: 0, accDep: 0, nbv: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-700">
          Daftar aset tetap (furniture, peralatan dapur, bar, IT). Depresiasi
          straight-line per bulan, Owner button-trigger.
        </p>
        {canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDepOpen(true)}
              disabled={rows.length === 0}
            >
              <TrendingDown className="size-4" /> Hitung Depresiasi
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="size-4" /> Import CSV
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Tambah Aset
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryTile
          label="Total Cost"
          value={totals.cost}
          icon={<Boxes className="size-4" />}
        />
        <SummaryTile
          label="Akumulasi Penyusutan"
          value={totals.accDep}
          icon={<TrendingDown className="size-4" />}
          isNegative
        />
        <SummaryTile
          label="Net Book Value"
          value={totals.nbv}
          icon={<Boxes className="size-4" />}
          emphasis
        />
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-10 text-center">
          <Boxes className="mx-auto size-10 text-neutral-300" aria-hidden />
          <h3 className="mt-3 text-sm font-medium text-neutral-700">
            Belum ada aset tetap
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Tambah aset pertama (furniture, mesin espresso, dll) untuk mulai
            track depresiasi.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-neutral-500">
            <Info className="size-3" /> Saat aset pertama dibuat, akun
            placeholder 1201-1204 + 1290 + 6501-6504 otomatis di-aktifkan di
            Bagan Akun.
          </p>
        </div>
      ) : (
        <ResponsiveTable<FixedAssetRow>
          rows={rows}
          rowKey={(r) => r.id}
          columns={fixedAssetColumns()}
          rowActions={
            canManage
              ? (r) => (
                  <button
                    type="button"
                    onClick={() => onDeactivate(r)}
                    className="rounded p-1 text-neutral-400 hover:bg-danger-100 hover:text-danger-500"
                    aria-label={`Hapus ${r.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )
              : undefined
          }
        />
      )}

      {createOpen ? (
        <AssetFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      ) : null}

      {depOpen ? (
        <DepreciationModal
          open={depOpen}
          onClose={() => setDepOpen(false)}
          onPosted={() => {
            setDepOpen(false);
            void load();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportAssetsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            void load();
          }}
        />
      ) : null}

      <p className="text-xs text-neutral-500">
        Depresiasi straight-line: monthly = (cost − salvage) / useful_life_months.
        Last month catches rounding leftover. Idempotent: sudah depreciated
        bulan tertentu = skip kalau di-run ulang.
      </p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  isNegative,
  emphasis,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  isNegative?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-md border ${
        emphasis
          ? "border-mahakan-green-300 bg-mahakan-green-50"
          : "border-neutral-200 bg-white"
      } p-3`}
    >
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        {icon} {label}
      </div>
      <div
        className={`mt-1 font-mono text-lg font-semibold ${
          emphasis ? "text-mahakan-green-900" : "text-neutral-900"
        } ${isNegative ? "text-danger-500" : ""}`}
      >
        {isNegative ? "(" : ""}
        {formatRupiah(value)}
        {isNegative ? ")" : ""}
      </div>
    </div>
  );
}

function fixedAssetColumns(): ResponsiveColumn<FixedAssetRow>[] {
  return [
    {
      key: "name",
      label: "Nama",
      primary: true,
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="font-mono text-xs text-neutral-500">
            {r.assetAccountCode} → dep {r.depreciationAccountCode}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      label: "Kategori",
      render: (r) => (
        <span className="text-xs text-neutral-700">{r.category ?? "—"}</span>
      ),
    },
    {
      key: "cost",
      label: "Cost",
      align: "right",
      mono: true,
      render: (r) => formatRupiah(r.cost),
    },
    {
      key: "usefulLife",
      label: "Useful Life",
      align: "center",
      render: (r) => (
        <span className="text-xs">{r.usefulLifeMonths} bln</span>
      ),
    },
    {
      key: "acquired",
      label: "Acquired",
      desktopOnly: true,
      render: (r) => <span className="text-xs">{r.acquiredDate}</span>,
    },
    {
      key: "accumDep",
      label: "Akum Dep",
      align: "right",
      desktopOnly: true,
      render: (r) => (
        <span className="font-mono text-xs text-neutral-600">
          {formatRupiah(r.accumulatedDepreciation)}
          <div className="text-xs text-neutral-400">
            {r.lastDepreciatedMonth ?? "belum mulai"}
          </div>
        </span>
      ),
    },
    {
      key: "nbv",
      label: "NBV",
      align: "right",
      mono: true,
      render: (r) => (
        <span className="font-medium">{formatRupiah(r.netBookValue)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        const fullyDepreciated =
          r.lastDepreciatedMonth !== null &&
          r.accumulatedDepreciation >= r.cost - r.salvageValue;
        if (fullyDepreciated) return <Badge variant="neutral">Lunas</Badge>;
        if (r.lastDepreciatedMonth)
          return <Badge variant="success">Aktif</Badge>;
        return <Badge variant="warning">Baru</Badge>;
      },
    },
  ];
}
