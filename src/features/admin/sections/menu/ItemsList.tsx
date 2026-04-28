"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Heart,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
} from "@/components/ui";
import { MenuItemFormModal } from "./MenuItemFormModal";
import { BulkActionsBar } from "./BulkActionsBar";
import {
  bulkUpdateMenuItems,
  exportMenuCsv,
  isOk,
  listMenuItems,
  listCategories,
  toggleSoldOut as toggleSoldOutAction,
  deleteMenuItem,
  type Category,
  type MenuItem,
} from "@/features/menu";
import { useSession } from "@/features/auth/SessionProvider";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = { kind: "create" } | { kind: "edit"; item: MenuItem };

export function ItemsList() {
  const { session } = useSession();
  const isOwner = session?.user.role === "owner";

  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");
  const [mode, setMode] = useState<Mode | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [itemsRes, catsRes] = await Promise.all([
        listMenuItems({ activeOnly: false }),
        listCategories(),
      ]);
      if (cancelled) return;
      if (isOk(itemsRes)) setItems(itemsRes.data.items);
      if (isOk(catsRes)) setCategories(catsRes.data.items);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const categoryById = useMemo(() => {
    const m: Record<string, Category> = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter((i) => {
      if (categoryFilter !== "all" && i.categoryId !== categoryFilter)
        return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, categoryFilter]);

  async function handleSoldOut(item: MenuItem) {
    const res = await toggleSoldOutAction(item.id, !item.isSoldOut);
    if (isOk(res)) {
      setRefreshKey((k) => k + 1);
      toast.success(
        item.isSoldOut ? "Item ditandai available" : "Item ditandai sold-out",
      );
    }
  }

  async function handleDelete(id: string) {
    const res = await deleteMenuItem(id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Item dihapus");
    setPendingDeleteId(null);
    setRefreshKey((k) => k + 1);
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set();
      return new Set(filtered.map((i) => i.id));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleBulkSoldOut() {
    const ids = Array.from(selectedIds);
    const res = await bulkUpdateMenuItems(ids, { kind: "mark_sold_out" });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${res.data.affected} item ditandai sold-out`);
    clearSelection();
    setRefreshKey((k) => k + 1);
  }

  async function handleBulkAvailable() {
    const ids = Array.from(selectedIds);
    const res = await bulkUpdateMenuItems(ids, { kind: "mark_available" });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`${res.data.affected} item ditandai tersedia`);
    clearSelection();
    setRefreshKey((k) => k + 1);
  }

  async function handleBulkAdjust(pct: number) {
    const ids = Array.from(selectedIds);
    const res = await bulkUpdateMenuItems(ids, { kind: "adjust_price_pct", pct });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Harga ${res.data.affected} item disesuaikan ${pct > 0 ? "+" : ""}${pct}%`,
    );
    clearSelection();
    setRefreshKey((k) => k + 1);
  }

  async function handleExportCsv() {
    const res = await exportMenuCsv();
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mahakan-menu-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Menu di-export ke CSV");
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Menu Items ({items.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Kelola item menu, harga, dan status sold-out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwner && (
            <Button variant="outline" onClick={handleExportCsv}>
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          )}
          <Button onClick={() => setMode({ kind: "create" })}>
            <Plus className="size-4" aria-hidden /> Tambah Item
          </Button>
        </div>
      </header>

      <BulkActionsBar
        selectedCount={selectedIds.size}
        onClear={clearSelection}
        onMarkSoldOut={handleBulkSoldOut}
        onMarkAvailable={handleBulkAvailable}
        onAdjustPrice={handleBulkAdjust}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama item…"
                leadingIcon={<Search className="size-4" aria-hidden />}
                trailingSlot={
                  search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                    >
                      <X className="size-4" />
                    </button>
                  ) : undefined
                }
              />
            </div>
            <div className="w-full sm:w-56">
              <Select
                ariaLabel="Filter kategori"
                options={[
                  { value: "all", label: "Semua kategori" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
                value={categoryFilter}
                onValueChange={(v) => setCategoryFilter(v as string | "all")}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat menu">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada item yang cocok.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua"
                        checked={
                          filtered.length > 0 &&
                          selectedIds.size === filtered.length
                        }
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              selectedIds.size > 0 &&
                              selectedIds.size < filtered.length;
                        }}
                        onChange={toggleAll}
                        className="size-4 rounded border-neutral-300"
                      />
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Nama</th>
                    <th className="px-4 py-2 text-left font-medium">Kategori</th>
                    <th className="px-4 py-2 text-left font-medium">Tipe</th>
                    <th className="px-4 py-2 text-right font-medium">Harga</th>
                    <th className="px-4 py-2 text-center font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((item) => {
                    const cat = categoryById[item.categoryId];
                    const priceLabel =
                      item.priceType === "fixed"
                        ? formatRupiah(item.priceFixed ?? 0)
                        : item.priceType === "open"
                          ? "Manual"
                          : item.priceHot && item.priceIced
                            ? `${formatRupiah(item.priceHot)} / ${formatRupiah(item.priceIced)}`
                            : item.priceHot
                              ? formatRupiah(item.priceHot)
                              : item.priceIced
                                ? formatRupiah(item.priceIced)
                                : "—";
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "hover:bg-neutral-50",
                          item.isSoldOut && "opacity-60",
                          selectedIds.has(item.id) && "bg-mahakan-green-50",
                        )}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${item.name}`}
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleRow(item.id)}
                            className="size-4 rounded border-neutral-300"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {item.isSignature ? (
                              <Heart
                                className="size-3.5 fill-mahakan-green-700 text-mahakan-green-700"
                                aria-label="Signature"
                              />
                            ) : null}
                            <span className="font-medium text-neutral-900">
                              {item.name}
                            </span>
                          </div>
                          {item.description ? (
                            <p className="text-xs text-neutral-500 line-clamp-1">
                              {item.description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {cat?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              item.priceType === "open"
                                ? "open-price"
                                : item.priceType === "variant"
                                  ? "info"
                                  : "neutral"
                            }
                          >
                            {item.priceType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {priceLabel}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.isSoldOut ? (
                            <Badge variant="sold-out">Habis</Badge>
                          ) : (
                            <Badge variant="success">Tersedia</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSoldOut(item)}
                            >
                              {item.isSoldOut ? "Aktifkan" : "Sold Out"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setMode({ kind: "edit", item })
                              }
                              aria-label={`Edit ${item.name}`}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingDeleteId(item.id)}
                              aria-label={`Hapus ${item.name}`}
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
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

      <MenuItemFormModal
        open={mode !== null}
        mode={mode}
        categories={categories}
        onClose={() => setMode(null)}
        onSaved={() => {
          setMode(null);
          setRefreshKey((k) => k + 1);
        }}
      />

      {pendingDeleteId ? (
        <DeleteConfirmModal
          itemName={
            items.find((i) => i.id === pendingDeleteId)?.name ?? "item ini"
          }
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => handleDelete(pendingDeleteId)}
        />
      ) : null}
    </div>
  );
}

function DeleteConfirmModal({
  itemName,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Hapus item?"
      description={`Item "${itemName}" akan dinonaktifkan (soft delete). Transaksi historis tetap utuh.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Batal
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Hapus
          </Button>
        </>
      }
    >
      <p className="text-sm text-neutral-700">
        Item bisa di-restore via DB jika perlu (Phase 2 akan punya UI restore).
      </p>
    </Modal>
  );
}
