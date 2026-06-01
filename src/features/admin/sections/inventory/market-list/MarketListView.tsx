"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { deleteAllMarketItems } from "@/features/market-list";
import {
  Badge,
  Button,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  deleteMarketItem,
  isOk,
  listMarketItems,
  type MarketListItem,
} from "@/features/market-list";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah, formatRupiahPrecise } from "@/lib/format";
import { MarketItemFormModal } from "./MarketItemFormModal";
import { MarketCsvImportModal } from "./MarketCsvImportModal";

export function MarketListView() {
  const { session } = useSession();
  const role = session?.user.role;
  const canCreate = role ? hasPermission(role, "market_list.create") : false;
  const canUpdate = role ? hasPermission(role, "market_list.update") : false;
  const canDelete = role ? hasPermission(role, "market_list.delete") : false;

  const [search, setSearch] = useState("");
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MarketListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketListItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [submittingDelete, setSubmittingDelete] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [submittingDeleteAll, setSubmittingDeleteAll] = useState(false);

  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: [
      "admin",
      "market-list",
      { search: debouncedSearch, primaryOnly },
    ],
    queryFn: async () => {
      const res = await listMarketItems({
        search: debouncedSearch || undefined,
        primaryOnly,
      });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const loading = itemsQuery.isLoading;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "market-list"] });
  }

  // Group by ingredient untuk display: 1 ingredient bisa multi-supplier.
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        ingredientName: string;
        ingredientUnit: string;
        ingredientPurchaseUnit: string | null;
        ingredientPurchasePerRecipe: number | null;
        rows: MarketListItem[];
      }
    >();
    for (const it of items) {
      const key = it.ingredientId;
      if (!map.has(key)) {
        map.set(key, {
          ingredientName: it.ingredientName,
          ingredientUnit: it.ingredientUnit,
          ingredientPurchaseUnit: it.ingredientPurchaseUnit,
          ingredientPurchasePerRecipe: it.ingredientPurchasePerRecipe,
          rows: [],
        });
      }
      map.get(key)!.rows.push(it);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.ingredientName.localeCompare(b.ingredientName, "id"),
    );
  }, [items]);

  const totalItems = items.length;
  const primaryCount = items.filter((i) => i.isPrimary).length;
  const ingredientsCovered = grouped.length;

  async function onConfirmDelete() {
    if (!deleteTarget || submittingDelete) return;
    setSubmittingDelete(true);
    const res = await deleteMarketItem({ id: deleteTarget.id });
    setSubmittingDelete(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Market item dihapus");
    setDeleteTarget(null);
    refresh();
  }

  async function onConfirmDeleteAll() {
    if (submittingDeleteAll) return;
    if (deleteAllConfirm.trim().toUpperCase() !== "HAPUS") return;
    setSubmittingDeleteAll(true);
    const res = await deleteAllMarketItems();
    setSubmittingDeleteAll(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${res.data.deletedCount} entry dihapus`);
    setDeleteAllOpen(false);
    setDeleteAllConfirm("");
    refresh();
  }

  return (
    <div className="space-y-3">
      {/* Sesi AE-27 — banner relasi yang lebih jelas. Owner bingung
       * relasi Market List vs Bahan vs Supplier. Sekarang di-jelasin:
       *   Bahan = master fisik (stock + unit + cost gabungan)
       *   Supplier = master vendor (nama + kontak)
       *   Market List = M2M (Supplier × Bahan) + harga + pack info */}
      <div className="rounded-lg border border-info-300 bg-info-100/40 p-3 text-xs text-info-500">
        <div className="mb-1 font-semibold">
          📦 Market List = katalog harga belanja per supplier per bahan
        </div>
        <ul className="space-y-1 ml-4 list-disc">
          <li>
            <strong>Bahan</strong> (tab Bahan) = master fisik: stok + unit +{" "}
            <em>1 master cost</em>
          </li>
          <li>
            <strong>Supplier</strong> (tab Supplier) = master vendor: nama +
            kontak + payment terms
          </li>
          <li>
            <strong>Market List</strong> (tab ini) = catatan harga per
            kombinasi (Supplier × Bahan) + pack size. <em>Banding harga</em>{" "}
            multi-supplier per bahan
          </li>
          <li>
            Tandai 1 supplier{" "}
            <Star className="inline size-3 fill-warning-500 text-warning-500" />{" "}
            <strong>Primary</strong> per bahan → harga otomatis sync ke
            master cost Bahan + COGS + Recipe + HPP saat diubah
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-60">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari bahan / supplier…"
            className="pl-9"
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={primaryOnly}
            onChange={(e) => setPrimaryOnly(e.target.checked)}
            className="size-4 accent-mahakan-green-700"
          />
          Primary saja
        </label>
        {canCreate ? (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Tambah
            </Button>
          </>
        ) : null}
        {canDelete && totalItems > 0 ? (
          <Button
            variant="outline"
            onClick={() => setDeleteAllOpen(true)}
            className="border-danger-300 text-danger-500 hover:bg-danger-50"
            title="Hapus semua entry market list (untuk re-import bersih)"
          >
            <Trash2 className="size-4" /> Hapus Semua
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatCard
          label="Total Entry"
          value={String(totalItems)}
          hint="Catatan harga dari semua supplier"
        />
        <StatCard
          label="Primary Supplier Set"
          value={`${primaryCount} / ${ingredientsCovered}`}
          hint="Bahan dengan supplier utama (drive COGS)"
          warn={primaryCount < ingredientsCovered}
        />
        <StatCard
          label="Bahan Tercatat"
          value={String(ingredientsCovered)}
          hint="Bahan unik dengan ≥ 1 entry"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="text-sm text-neutral-700">
            Belum ada entry market list.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Tambah manual via tombol{" "}
            <span className="font-semibold">+ Tambah</span> atau import CSV
            kalau punya data spreadsheet.
          </p>
        </div>
      ) : (
        /* Sesi AE-39 — Galaxy A7 Lite tablet (1340×800 landscape) — table
         * 7-kolom kepotong di Android. Switch ke card-grouped layout per
         * bahan: nama bahan jadi header card (gak truncate), 1 row per
         * supplier dengan info pack/harga/effective rapi sejajar.
         * Lebih wide, lebih informatif, edit/hapus tetap reachable. */
        <div className="space-y-2.5">
          {grouped.map((group) => (
            <div
              key={group.rows[0]!.ingredientId}
              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 sm:px-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-neutral-900 sm:text-base">
                    {group.ingredientName}
                  </h3>
                  <p className="text-[11px] text-neutral-500">
                    {/* Sesi AE-136 — show Recipe + Purchase Unit kalau set,
                     * fallback Recipe-only kalau belum migrate. */}
                    Recipe:{" "}
                    <span className="font-mono">{group.ingredientUnit}</span>
                    {group.ingredientPurchaseUnit &&
                    group.ingredientPurchasePerRecipe ? (
                      <>
                        {" · Purchase: "}
                        <span className="font-mono">
                          {group.ingredientPurchaseUnit}
                        </span>{" "}
                        <span className="text-neutral-400">
                          (1 = {group.ingredientPurchasePerRecipe}{" "}
                          {group.ingredientUnit})
                        </span>
                      </>
                    ) : null}
                    {" · "}
                    {group.rows.length} supplier
                  </p>
                </div>
                <Badge
                  variant={
                    group.rows.some((r) => r.isPrimary)
                      ? "success"
                      : "warning"
                  }
                  className="shrink-0"
                >
                  {group.rows.some((r) => r.isPrimary)
                    ? "✓ Primary set"
                    : "⚠ Belum ada primary"}
                </Badge>
              </header>
              <ul className="divide-y divide-neutral-100">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    className={
                      "px-3 py-2.5 sm:px-4 " +
                      (row.isPrimary
                        ? "border-l-4 border-l-success-500/60 bg-success-100/20"
                        : "border-l-4 border-l-transparent")
                    }
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-center">
                      {/* Supplier */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.isPrimary ? (
                            <Badge
                              variant="success"
                              className="shrink-0 px-1.5 py-0"
                            >
                              <Star className="size-3 fill-current" /> Primary
                            </Badge>
                          ) : (
                            <Badge
                              variant="neutral"
                              className="shrink-0 px-1.5 py-0"
                            >
                              Alt
                            </Badge>
                          )}
                          <span className="text-sm font-semibold text-neutral-900">
                            {row.supplierName}
                          </span>
                        </div>
                        {row.supplierContact ? (
                          <div className="mt-0.5 truncate text-[11px] text-neutral-500">
                            {row.supplierContact}
                          </div>
                        ) : null}
                      </div>

                      {/* Harga, pack, effective */}
                      <div className="grid grid-cols-3 gap-2 text-xs sm:gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                            Harga Beli
                          </div>
                          <div className="font-mono text-sm font-semibold tabular-nums text-neutral-900">
                            {formatRupiah(row.unitCost)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                            Isi
                          </div>
                          <div className="font-mono text-sm tabular-nums text-neutral-900">
                            {row.packSize}{" "}
                            <span className="text-neutral-500">
                              {row.packUnit}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                            Effective
                          </div>
                          <div
                            className={
                              "font-mono text-sm font-semibold tabular-nums " +
                              (row.isPrimary
                                ? "text-success-500"
                                : "text-neutral-700")
                            }
                          >
                            {formatRupiahPrecise(row.effectiveCostPerUnit)}
                            <span className="text-[10px] font-normal text-neutral-500">
                              /{row.ingredientUnit}
                            </span>
                          </div>
                          {/* Sesi AE-137 — kalau bahan punya purchase unit
                           * dengan ratio !=1, tampilkan juga Rp/purchase
                           * supaya owner cepat banding dengan harga supplier
                           * lain yang quote per purchase unit. */}
                          {row.ingredientPurchaseUnit &&
                          row.ingredientPurchasePerRecipe &&
                          row.ingredientPurchasePerRecipe !== 1 ? (
                            <div className="text-[10px] font-normal text-neutral-500">
                              ={" "}
                              {formatRupiahPrecise(
                                row.effectiveCostPerUnit *
                                  row.ingredientPurchasePerRecipe,
                              )}
                              /{row.ingredientPurchaseUnit}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Aksi */}
                      <div className="flex justify-end gap-1 sm:justify-end">
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditTarget(row)}
                            title="Edit (bisa ganti supplier / bahan / harga)"
                          >
                            <Pencil className="size-3.5" />
                            <span className="hidden sm:inline">Edit</span>
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(row)}
                            className="text-danger-500 hover:bg-danger-100"
                            title="Hapus entry ini"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {row.notes ? (
                      <div className="mt-1 text-[11px] italic text-neutral-500">
                        📝 {row.notes}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <MarketItemFormModal
        open={createOpen || editTarget !== null}
        target={editTarget}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditTarget(null);
          refresh();
        }}
      />

      <MarketCsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          refresh();
        }}
      />

      {/* Sesi AE-31 — bulk delete modal dengan confirm-by-type "HAPUS"
       * supaya owner gak accidentally wipe seluruh catalog. */}
      <Modal
        open={deleteAllOpen}
        onClose={() => {
          if (submittingDeleteAll) return;
          setDeleteAllOpen(false);
          setDeleteAllConfirm("");
        }}
        title="Hapus Semua Market List"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteAllOpen(false);
                setDeleteAllConfirm("");
              }}
              disabled={submittingDeleteAll}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDeleteAll}
              loading={submittingDeleteAll}
              disabled={
                deleteAllConfirm.trim().toUpperCase() !== "HAPUS" ||
                submittingDeleteAll
              }
            >
              Hapus Semua ({totalItems})
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2 rounded-md border border-danger-300 bg-danger-100/40 p-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger-500" />
            <div className="text-danger-500">
              <p className="font-semibold">
                Akan menghapus {totalItems} entry market list (semua supplier
                × bahan).
              </p>
              <p className="mt-1 text-xs">
                Cocok untuk reset sebelum re-import CSV bersih. Master cost
                di tab Bahan TIDAK ikut terhapus — owner perlu re-import /
                re-set primary supplier untuk restore harga sync.
              </p>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-neutral-700">
              Ketik <strong>HAPUS</strong> untuk konfirmasi
            </span>
            <Input
              value={deleteAllConfirm}
              onChange={(e) => setDeleteAllConfirm(e.target.value)}
              placeholder="HAPUS"
              autoFocus
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Market Item"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={submittingDelete}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              loading={submittingDelete}
            >
              Hapus
            </Button>
          </>
        }
      >
        {deleteTarget ? (
          <div className="space-y-2 text-sm text-neutral-700">
            <p>
              Hapus entry harga <strong>{deleteTarget.ingredientName}</strong>{" "}
              dari supplier <strong>{deleteTarget.supplierName}</strong>?
            </p>
            {deleteTarget.isPrimary ? (
              <div className="flex items-start gap-2 rounded-md bg-warning-100 p-2 text-xs text-warning-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Ini supplier <strong>Primary</strong> — bahan akan kehilangan
                harga master setelah hapus. Set supplier lain jadi primary
                dulu kalau perlu.
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border bg-white p-3 " +
        (warn ? "border-warning-300 bg-warning-100/30" : "border-neutral-200")
      }
    >
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-neutral-900">{value}</div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-neutral-500">{hint}</div>
      ) : null}
    </div>
  );
}
