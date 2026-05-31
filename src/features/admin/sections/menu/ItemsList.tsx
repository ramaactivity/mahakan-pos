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
  compareBy,
  Input,
  Modal,
  Select,
  Skeleton,
  SortableHeader,
  toast,
  useColumnSort,
} from "@/components/ui";
import { MenuItemFormModal } from "./MenuItemFormModal";
import { BulkActionsBar } from "./BulkActionsBar";
import {
  COGS_PREFILL_KEY,
  type CogsPrefillPayload,
} from "../inventory/CogsCalculatorWidget";
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
import { computeGrossMarginPct } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Sesi AE-173 — harga representatif untuk margin (fixed→fixed, variant→max). */
function representativePrice(i: MenuItem): number {
  return i.priceType === "fixed"
    ? (i.priceFixed ?? 0)
    : i.priceType === "variant"
      ? Math.max(i.priceHot ?? 0, i.priceIced ?? 0)
      : 0;
}

type Mode =
  | { kind: "create"; prefillPrice?: number; prefillSource?: string }
  | { kind: "edit"; item: MenuItem };

export function ItemsList() {
  const { session } = useSession();
  const isOwner = session?.user.role === "owner";

  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "available" | "sold_out" | "signature">("all");
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

  // Phase 7.3 — pick up COGS Calculator prefill handoff. When owner clicks
  // "Save as Menu Item" in calculator, payload is written to sessionStorage
  // + we navigate ke Menu section. ItemsList here detects on mount, opens
  // create modal pre-filled, then clears the key to avoid stale re-trigger.
  useEffect(() => {
    if (typeof window === "undefined") return;
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = sessionStorage.getItem(COGS_PREFILL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CogsPrefillPayload;
      const ageMs = Date.now() - parsed.capturedAt;
      // Stale > 30 minutes — ignore + cleanup.
      if (ageMs > 30 * 60_000) {
        sessionStorage.removeItem(COGS_PREFILL_KEY);
        return;
      }
      setMode({
        kind: "create",
        prefillPrice: parsed.suggestedPrice,
        prefillSource: parsed.source,
      });
      sessionStorage.removeItem(COGS_PREFILL_KEY);
    } catch {
      // Corrupt payload — clean up.
      try {
        sessionStorage.removeItem(COGS_PREFILL_KEY);
      } catch {
        /* noop */
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const categoryById = useMemo(() => {
    const m: Record<string, Category> = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  const sort = useColumnSort("menu.items", "name", "asc");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matched = items.filter((i) => {
      if (categoryFilter !== "all" && i.categoryId !== categoryFilter)
        return false;
      if (statusFilter === "available" && i.isSoldOut) return false;
      if (statusFilter === "sold_out" && !i.isSoldOut) return false;
      if (statusFilter === "signature" && !i.isSignature) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const getValue = (i: MenuItem) => {
      switch (sort.key) {
        case "name":
          return i.name;
        case "category":
          return categoryById[i.categoryId]?.name ?? "";
        case "type":
          return i.priceFixed !== null ? "Tunggal" : "Hot/Iced";
        case "price":
          return i.priceFixed ?? i.priceHot ?? i.priceIced ?? 0;
        case "cost":
          return i.cost ?? -1;
        case "margin":
          return computeGrossMarginPct(representativePrice(i), i.cost) ?? -1;
        case "status":
          return i.isSoldOut ? "Habis" : "Tersedia";
        default:
          return i.name;
      }
    };
    return [...matched].sort(compareBy(sort.dir, getValue));
  }, [items, search, categoryFilter, statusFilter, sort.key, sort.dir, categoryById]);

  const counts = useMemo(() => {
    let available = 0;
    let soldOut = 0;
    let signature = 0;
    for (const i of items) {
      if (i.isSoldOut) soldOut++;
      else available++;
      if (i.isSignature) signature++;
    }
    return { available, soldOut, signature };
  }, [items]);

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
            Daftar Menu ({items.length})
            {!loading && items.length > 0 ? (
              <span className="ml-2 text-sm font-normal text-neutral-500">
                · {counts.available} tersedia
                {counts.soldOut > 0 ? `, ${counts.soldOut} habis` : ""}
                {counts.signature > 0 ? `, ${counts.signature} signature` : ""}
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-neutral-500">
            Kelola menu, harga, dan status sold-out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwner && (
            <Button variant="outline" onClick={handleExportCsv}>
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          )}
          <Button onClick={() => setMode({ kind: "create" })}>
            <Plus className="size-4" aria-hidden /> Tambah Menu
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
        <CardHeader className="space-y-3">
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
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter status">
            {(
              [
                { v: "all", label: `Semua (${items.length})` },
                { v: "available", label: `Tersedia (${counts.available})` },
                { v: "sold_out", label: `Habis (${counts.soldOut})` },
                { v: "signature", label: `Signature (${counts.signature})` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setStatusFilter(opt.v)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  statusFilter === opt.v
                    ? "bg-mahakan-green-700 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                {opt.label}
              </button>
            ))}
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
            <div className="py-10 text-center">
              <p className="text-sm text-neutral-500">
                {items.length === 0
                  ? "Belum ada item menu."
                  : "Tidak ada item yang cocok dengan filter saat ini."}
              </p>
              {items.length > 0 &&
              (search || categoryFilter !== "all" || statusFilter !== "all") ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Reset filter
                </Button>
              ) : null}
            </div>
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
                    <SortableHeader columnKey="name" label="Nama" sort={sort} />
                    <SortableHeader
                      columnKey="category"
                      label="Kategori"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="type"
                      label="Tipe"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="price"
                      label="Harga"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="cost"
                      label="Cost"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="margin"
                      label="Margin %"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="status"
                      label="Status"
                      sort={sort}
                      align="center"
                    />
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
                        <td className="px-4 py-3 text-right font-mono text-neutral-700">
                          {item.cost !== null && item.cost !== undefined
                            ? formatRupiah(item.cost)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {(() => {
                            const m = computeGrossMarginPct(
                              representativePrice(item),
                              item.cost,
                            );
                            if (m === null)
                              return <span className="text-neutral-400">—</span>;
                            return (
                              <span
                                className={cn(
                                  "font-medium",
                                  m >= 0
                                    ? "text-mahakan-green-700"
                                    : "text-danger-500",
                                )}
                              >
                                {m.toFixed(1)}%
                              </span>
                            );
                          })()}
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
