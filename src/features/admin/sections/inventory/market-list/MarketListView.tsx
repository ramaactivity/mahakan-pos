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
import { formatRupiah } from "@/lib/format";
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
      { ingredientName: string; ingredientUnit: string; rows: MarketListItem[] }
    >();
    for (const it of items) {
      const key = it.ingredientId;
      if (!map.has(key)) {
        map.set(key, {
          ingredientName: it.ingredientName,
          ingredientUnit: it.ingredientUnit,
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

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-info-300 bg-info-100/40 p-3 text-xs text-info-500">
        <strong>Market List</strong> = katalog harga belanja per supplier
        untuk tiap bahan baku. Kalau supplier ditandai{" "}
        <Star className="inline size-3.5 fill-warning-500 text-warning-500" />{" "}
        <strong>Primary</strong>, harga otomatis update master cost di Bahan,
        COGS, Recipe, dan HPP saat diubah.
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
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2">Bahan</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2 text-right">Harga / Pack</th>
                <th className="px-3 py-2">Pack Size</th>
                <th className="px-3 py-2 text-right">Effective</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {grouped.flatMap((group) =>
                group.rows.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={
                      "border-b border-neutral-100 last:border-0 " +
                      (idx === 0
                        ? "border-t-2 border-t-neutral-200/60"
                        : "")
                    }
                  >
                    <td className="px-3 py-2">
                      {idx === 0 ? (
                        <div>
                          <div className="font-semibold text-neutral-900">
                            {group.ingredientName}
                          </div>
                          <div className="text-xs text-neutral-500">
                            unit: {group.ingredientUnit}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-400">↳</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">
                        {row.supplierName}
                      </div>
                      {row.supplierContact ? (
                        <div className="text-xs text-neutral-500">
                          {row.supplierContact}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatRupiah(row.unitCost)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.packSize} {row.packUnit}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                      {formatRupiah(row.effectiveCostPerUnit)}/
                      {row.ingredientUnit}
                    </td>
                    <td className="px-3 py-2">
                      {row.isPrimary ? (
                        <Badge variant="success">
                          <Star className="size-3 fill-current" /> Primary
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Alt</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditTarget(row)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(row)}
                            className="text-danger-500 hover:bg-danger-100"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
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
