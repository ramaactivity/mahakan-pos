"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Plus,
  Scale,
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
import { AssetValuationModal } from "./AssetValuationModal";
import { DepreciationModal } from "./DepreciationModal";
import { ImportAssetsModal } from "./ImportAssetsModal";

interface Props {
  viewerRole: Role;
}

export function FixedAssetsView({ viewerRole }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  /* Sesi AE-214 — aset yang sedang dinilai ulang (null = modal tertutup). */
  const [valuationAssetId, setValuationAssetId] = useState<string | null>(null);

  const canManage = hasPermission(viewerRole, "accounting.coa.manage");

  const {
    data: rows = [],
    isLoading: loading,
  } = useQuery({
    queryKey: ["admin", "accounting", "fixed-assets"],
    queryFn: async () => {
      const res = await listFixedAssets();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "accounting", "fixed-assets"],
    });

  async function onDeactivate(asset: FixedAssetRow) {
    if (!confirm(`Hapus aset "${asset.name}"? (soft delete, journal tetap intact)`)) return;
    const res = await deactivateFixedAsset(asset.id);
    if (res.ok) {
      toast.success(`Aset ${asset.name} di-hapus`);
      void refresh();
    } else {
      toast.error(res.error.message);
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      cost: acc.cost + r.grossAmount,
      accDep: acc.accDep + r.accumulatedDepreciation,
      nbv: acc.nbv + r.netBookValue,
      /* Sesi AE-214 — dua angka ini harus cocok dengan saldo 3501 & 1291 di
       * Buku Besar. Ditampilkan supaya selisihnya ketahuan dari layar ini,
       * bukan menunggu neracanya aneh. */
      impairment: acc.impairment + r.accumulatedImpairment,
      surplus: acc.surplus + r.revaluationSurplus,
    }),
    { cost: 0, accDep: 0, nbv: 0, impairment: 0, surplus: 0 },
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

      {/* Sesi AE-214 — hanya muncul kalau memang ada yang pernah dinilai
        * ulang; outlet yang tidak memakai fitur ini tidak dapat baris tambahan. */}
      {totals.impairment > 0 || totals.surplus > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {totals.surplus > 0 ? (
            <SummaryTile
              label="Surplus Revaluasi (ekuitas, akun 3501)"
              value={totals.surplus}
              icon={<Scale className="size-4" />}
            />
          ) : null}
          {totals.impairment > 0 ? (
            <SummaryTile
              label="Akumulasi Penurunan Nilai (akun 1291)"
              value={totals.impairment}
              icon={<TrendingDown className="size-4" />}
              isNegative
            />
          ) : null}
        </div>
      ) : null}

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
                  <div className="flex items-center gap-1">
                    {/* Sesi AE-214 — revaluasi & penurunan nilai per aset. */}
                    <button
                      type="button"
                      onClick={() => setValuationAssetId(r.id)}
                      className="rounded p-1 text-neutral-400 hover:bg-mahakan-green-100 hover:text-mahakan-green-800"
                      aria-label={`Nilai ulang ${r.name}`}
                      title="Revaluasi / penurunan nilai"
                    >
                      <Scale className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeactivate(r)}
                      className="rounded p-1 text-neutral-400 hover:bg-danger-100 hover:text-danger-500"
                      aria-label={`Hapus ${r.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
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
            void refresh();
          }}
        />
      ) : null}

      {depOpen ? (
        <DepreciationModal
          open={depOpen}
          onClose={() => setDepOpen(false)}
          onPosted={() => {
            setDepOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {valuationAssetId ? (
        <AssetValuationModal
          open={valuationAssetId !== null}
          assetId={valuationAssetId}
          onClose={() => setValuationAssetId(null)}
          onSaved={() => {
            setValuationAssetId(null);
            void refresh();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportAssetsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            void refresh();
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
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{r.name}</span>
            {/* Sesi AE-214 — tanda bahwa angka aset ini bukan lagi turunan
              * langsung dari harga belinya. */}
            {r.basisMonth ? (
              <Badge variant="neutral">
                {r.accumulatedImpairment > 0 ? "Turun nilai" : "Dinilai ulang"}
              </Badge>
            ) : null}
          </div>
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
      label: "Nilai Bruto",
      align: "right",
      mono: true,
      render: (r) => (
        <span>
          {formatRupiah(r.grossAmount)}
          {r.grossAmount !== r.cost ? (
            <span className="block text-[10px] text-neutral-400">
              perolehan {formatRupiah(r.cost)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "usefulLife",
      label: "Umur / Sisa",
      align: "center",
      render: (r) => (
        <span className="text-xs">
          {r.usefulLifeMonths} bln
          <span className="block text-[10px] text-neutral-400">
            sisa {r.remainingLifeMonths} bln
          </span>
        </span>
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
        <div className="font-mono text-xs text-neutral-600">
          {formatRupiah(r.accumulatedDepreciation)}
          <div className="text-xs text-neutral-400">
            {r.lastDepreciatedMonth ?? "belum mulai"}
          </div>
          {r.accumulatedImpairment > 0 ? (
            <div className="text-[10px] text-danger-500">
              turun nilai {formatRupiah(r.accumulatedImpairment)}
            </div>
          ) : null}
        </div>
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
        /* Sesi AE-214 — "habis disusutkan" dinilai dari NILAI BUKU vs nilai
         * sisa, bukan dari akumulasi vs harga perolehan. Untuk aset yang
         * pernah dinilai ulang, harga perolehan bukan lagi tolok ukurnya. */
        const fullyDepreciated =
          r.lastDepreciatedMonth !== null && r.netBookValue <= r.salvageValue;
        if (fullyDepreciated) return <Badge variant="neutral">Lunas</Badge>;
        if (r.lastDepreciatedMonth)
          return <Badge variant="success">Aktif</Badge>;
        return <Badge variant="warning">Baru</Badge>;
      },
    },
  ];
}
