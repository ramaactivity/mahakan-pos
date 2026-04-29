"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, EyeOff, Search } from "lucide-react";
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toast,
} from "@/components/ui";
import { isOk, toggleSoldOut, type Category, type MenuItem } from "@/features/menu";
import { hasPermission, type Role } from "@/lib/auth";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MenuStatusCardProps {
  menuItems: MenuItem[];
  categories: Category[];
  role: Role;
  /** Called after a successful toggle so PosShell can update its lifted state. */
  onItemUpdated: (next: MenuItem) => void;
}

/**
 * In-POS sold-out / available toggle for menu items. Lives in Pengaturan tab so
 * Staff + Manager can mark sold-out tanpa perlu login admin. Same RBAC as the
 * admin ItemsList — Staff can mark sold-out, only Owner/Manager can revert.
 */
export function MenuStatusCard({
  menuItems,
  categories,
  role,
  onItemUpdated,
}: MenuStatusCardProps) {
  const canMarkAvailable = hasPermission(role, "pos.menu.mark_available");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Track in-flight toggles per item to prevent double-tap.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const filtered = menuItems
      .filter((it) => it.isActive)
      .filter((it) =>
        searchLower ? it.name.toLowerCase().includes(searchLower) : true,
      );
    const byCategoryId = new Map<string, MenuItem[]>();
    for (const it of filtered) {
      const arr = byCategoryId.get(it.categoryId) ?? [];
      arr.push(it);
      byCategoryId.set(it.categoryId, arr);
    }
    // Sort categories by their existing order; sort items by name within each.
    const ordered = categories
      .filter((c) => byCategoryId.has(c.id))
      .map((c) => ({
        category: c,
        items: (byCategoryId.get(c.id) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      }));
    return ordered;
  }, [menuItems, categories, search]);

  const totalActive = useMemo(() => menuItems.filter((it) => it.isActive).length, [menuItems]);
  const totalSoldOut = useMemo(
    () => menuItems.filter((it) => it.isActive && it.isSoldOut).length,
    [menuItems],
  );

  async function handleToggle(item: MenuItem) {
    if (pending[item.id]) return;
    if (item.isSoldOut && !canMarkAvailable) {
      toast.error("Hanya Owner/Manager yang bisa kembalikan ke tersedia");
      return;
    }
    setPending((p) => ({ ...p, [item.id]: true }));
    // Optimistic update — flip immediately, rollback on error.
    onItemUpdated({ ...item, isSoldOut: !item.isSoldOut });
    const res = await toggleSoldOut(item.id, !item.isSoldOut);
    setPending((p) => {
      const next = { ...p };
      delete next[item.id];
      return next;
    });
    if (!isOk(res)) {
      // Rollback
      onItemUpdated(item);
      toast.error(res.error.message);
      return;
    }
    onItemUpdated(res.data);
    toast.success(
      res.data.isSoldOut
        ? `${item.name} ditandai sold-out`
        : `${item.name} kembali tersedia`,
    );
  }

  function toggleCategoryCollapse(categoryId: string) {
    setCollapsed((c) => ({ ...c, [categoryId]: !c[categoryId] }));
  }

  function preventSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <EyeOff className="mr-2 inline size-5" aria-hidden /> Status Menu
        </CardTitle>
        <CardDescription>
          Tandai item sold-out atau tersedia. Perubahan langsung sync ke kolom
          kasir. {totalSoldOut > 0 ? `${totalSoldOut} dari ${totalActive} item sedang sold-out.` : `${totalActive} item aktif, semua tersedia.`}
        </CardDescription>
      </CardHeader>
      <div className="space-y-3 px-6 pb-6">
        <form onSubmit={preventSubmit}>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari item..."
            leadingIcon={<Search className="size-4" aria-hidden />}
          />
        </form>

        {!canMarkAvailable ? (
          <p className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
            Sebagai Staff, kamu bisa <em>mark sold-out</em> tapi gak bisa
            kembalikan ke tersedia. Minta Manager/Owner untuk reverse.
          </p>
        ) : null}

        {grouped.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            {search.trim() ? "Tidak ada item yang cocok." : "Tidak ada menu aktif."}
          </p>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ category, items }) => {
              const isCollapsed = collapsed[category.id] ?? false;
              const soldOutInCat = items.filter((i) => i.isSoldOut).length;
              return (
                <div
                  key={category.id}
                  className="overflow-hidden rounded-md border border-neutral-200"
                >
                  <button
                    type="button"
                    onClick={() => toggleCategoryCollapse(category.id)}
                    className="flex w-full items-center justify-between gap-2 bg-neutral-50 px-3 py-2 text-left text-sm font-medium text-neutral-800 hover:bg-neutral-100"
                  >
                    <span className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight
                          className="size-4 text-neutral-500"
                          aria-hidden
                        />
                      ) : (
                        <ChevronDown
                          className="size-4 text-neutral-500"
                          aria-hidden
                        />
                      )}
                      {category.name}
                      <Badge variant="neutral" className="text-[10px]">
                        {items.length}
                      </Badge>
                      {soldOutInCat > 0 ? (
                        <Badge variant="warning" className="text-[10px]">
                          {soldOutInCat} sold-out
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                  {!isCollapsed ? (
                    <ul className="divide-y divide-neutral-100">
                      {items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "truncate text-sm",
                                item.isSoldOut
                                  ? "font-medium text-neutral-500 line-through"
                                  : "font-medium text-neutral-900",
                              )}
                            >
                              {item.name}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {item.priceType === "fixed"
                                ? formatRupiah(item.priceFixed ?? 0)
                                : item.priceType === "open"
                                  ? "Harga manual"
                                  : item.priceHot && item.priceIced
                                    ? `${formatRupiah(item.priceHot)} / ${formatRupiah(item.priceIced)}`
                                    : "—"}
                            </p>
                          </div>
                          <SoldOutToggle
                            soldOut={item.isSoldOut}
                            disabled={
                              pending[item.id] ||
                              (item.isSoldOut && !canMarkAvailable)
                            }
                            pending={Boolean(pending[item.id])}
                            onToggle={() => handleToggle(item)}
                            label={item.name}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function SoldOutToggle({
  soldOut,
  disabled,
  pending,
  onToggle,
  label,
}: {
  soldOut: boolean;
  disabled: boolean;
  pending: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={soldOut}
      aria-label={`Sold-out ${label}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2",
        soldOut ? "bg-warning-500" : "bg-neutral-300",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          soldOut ? "translate-x-5" : "translate-x-0.5",
          pending ? "animate-pulse" : "",
        )}
      />
    </button>
  );
}
