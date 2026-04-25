"use client";

import { useEffect, useMemo, useState } from "react";
import { Heart, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Spinner,
  toast,
} from "@/components/ui";
import { MenuItemFormModal } from "./MenuItemFormModal";
import { isOk, menuService } from "@/mocks/services";
import type { Category, MenuItem } from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = { kind: "create" } | { kind: "edit"; item: MenuItem };

export function ItemsList() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");
  const [mode, setMode] = useState<Mode | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [itemsRes, catsRes] = await Promise.all([
        menuService.listMenuItems({ activeOnly: false }),
        menuService.listCategories(),
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
    const res = await menuService.toggleSoldOut(item.id, !item.isSoldOut);
    if (isOk(res)) {
      setRefreshKey((k) => k + 1);
      toast.success(
        item.isSoldOut ? "Item ditandai available" : "Item ditandai sold-out",
      );
    }
  }

  async function handleDelete(id: string) {
    const res = await menuService.deleteMenuItem(id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Item dihapus");
    setPendingDeleteId(null);
    setRefreshKey((k) => k + 1);
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
        <Button onClick={() => setMode({ kind: "create" })}>
          <Plus className="size-4" aria-hidden /> Tambah Item
        </Button>
      </header>

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
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700"
            >
              <option value="all">Semua kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="size-6 text-mahakan-green-700" />
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
                        )}
                      >
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
