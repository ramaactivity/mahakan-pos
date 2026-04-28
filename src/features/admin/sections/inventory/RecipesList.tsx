"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChefHat, Coffee, AlertCircle } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  isOk,
  listAllCategories,
  listMenuItems,
  type Category,
  type MenuItem,
} from "@/features/menu";
import {
  listAllRecipes,
  isOk as invIsOk,
  type Recipe,
} from "@/features/inventory";
import { RecipeEditorModal } from "./RecipeEditorModal";

interface RecipeStatus {
  hot?: { id: string; wasteFactorPct: number };
  iced?: { id: string; wasteFactorPct: number };
  fixed?: { id: string; wasteFactorPct: number };
}

export function RecipesList() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "configured" | "missing">(
    "all",
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [editTarget, setEditTarget] = useState<MenuItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [itemsRes, catsRes, recipesRes] = await Promise.all([
        listMenuItems({ activeOnly: false }),
        listAllCategories(),
        listAllRecipes(),
      ]);
      if (cancelled) return;
      if (isOk(itemsRes)) setItems(itemsRes.data.items);
      if (isOk(catsRes)) setCategories(catsRes.data.items);
      if (invIsOk(recipesRes)) setRecipes(recipesRes.data);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const recipeByMenuItem = useMemo(() => {
    const m = new Map<string, RecipeStatus>();
    for (const r of recipes) {
      // Preparation recipes (menuItemId IS NULL) are managed in the
      // Preparations tab — skip them in the menu Resep view.
      if (r.menuItemId === null) continue;
      const existing = m.get(r.menuItemId) ?? {};
      const slot = { id: r.id, wasteFactorPct: r.wasteFactorPct };
      if (r.variant === "hot") existing.hot = slot;
      else if (r.variant === "iced") existing.iced = slot;
      else existing.fixed = slot;
      m.set(r.menuItemId, existing);
    }
    return m;
  }, [recipes]);

  const categoryById = useMemo(() => {
    const m: Record<string, Category> = {};
    for (const c of categories) m[c.id] = c;
    return m;
  }, [categories]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (categoryFilter !== "all" && it.categoryId !== categoryFilter)
        return false;
      if (search.trim().length > 0) {
        if (!it.name.toLowerCase().includes(search.toLowerCase().trim()))
          return false;
      }
      if (statusFilter === "all") return true;
      if (it.priceType === "open") return statusFilter === "missing";
      const status = recipeByMenuItem.get(it.id);
      const isComplete =
        it.priceType === "fixed"
          ? Boolean(status?.fixed)
          : Boolean(
              (it.priceHot === null || status?.hot) &&
                (it.priceIced === null || status?.iced),
            );
      return statusFilter === "configured" ? isComplete : !isComplete;
    });
  }, [items, search, categoryFilter, statusFilter, recipeByMenuItem]);

  const itemsByCategory = useMemo(() => {
    const grouped = new Map<string, MenuItem[]>();
    for (const it of filteredItems) {
      const list = grouped.get(it.categoryId) ?? [];
      list.push(it);
      grouped.set(it.categoryId, list);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => {
      const ca = categoryById[a]?.displayOrder ?? 999;
      const cb = categoryById[b]?.displayOrder ?? 999;
      return ca - cb;
    });
  }, [filteredItems, categoryById]);

  const totalConfigured = useMemo(() => {
    return items.filter((it) => {
      if (it.priceType === "open") return false;
      const status = recipeByMenuItem.get(it.id);
      if (it.priceType === "fixed") return Boolean(status?.fixed);
      return Boolean(
        (it.priceHot === null || status?.hot) &&
          (it.priceIced === null || status?.iced),
      );
    }).length;
  }, [items, recipeByMenuItem]);

  const totalNonOpen = items.filter((it) => it.priceType !== "open").length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Resep Menu ({totalConfigured} / {totalNonOpen} terisi)
          </h2>
          <p className="text-xs text-neutral-500">
            Setiap menu (kecuali open-price seperti Manual Brew) wajib punya
            resep supaya COGS dan auto-deduct stok bisa jalan saat transaksi.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              label="Cari menu"
              placeholder="mis. americano, croffle"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              label="Kategori"
              options={[
                { value: "all", label: "Semua kategori" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={categoryFilter}
              onValueChange={setCategoryFilter}
            />
            <Select
              label="Status Resep"
              options={[
                { value: "all", label: "Semua status" },
                { value: "configured", label: "Sudah terisi lengkap" },
                { value: "missing", label: "Belum lengkap" },
              ]}
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as "all" | "configured" | "missing")
              }
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" role="status" aria-label="Memuat menu">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : itemsByCategory.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Tidak ada menu yang cocok dengan filter ini.
            </p>
          ) : (
            <div className="space-y-6">
              {itemsByCategory.map(([catId, catItems]) => (
                <div key={catId} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-mahakan-green-700">
                    {categoryById[catId]?.name ?? "?"}
                    <span className="ml-1 text-neutral-400">
                      ({catItems.length})
                    </span>
                  </h3>
                  <div className="grid gap-2">
                    {catItems.map((it) => (
                      <RecipeRow
                        key={it.id}
                        item={it}
                        status={recipeByMenuItem.get(it.id)}
                        onEdit={() => setEditTarget(it)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RecipeEditorModal
        open={editTarget !== null}
        menuItem={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

interface RecipeRowProps {
  item: MenuItem;
  status: RecipeStatus | undefined;
  onEdit: () => void;
}

function RecipeRow({ item, status, onEdit }: RecipeRowProps) {
  const isOpen = item.priceType === "open";
  const isVariant = item.priceType === "variant";

  return (
    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 hover:bg-neutral-50">
      <div className="flex flex-1 items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-mahakan-green-100 text-mahakan-green-700">
          {isVariant ? (
            <Coffee className="size-4" aria-hidden />
          ) : (
            <ChefHat className="size-4" aria-hidden />
          )}
        </div>
        <div className="flex-1">
          <p className="font-medium text-neutral-900">{item.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            {isOpen ? (
              <Badge variant="neutral">Open-price (no resep)</Badge>
            ) : isVariant ? (
              <>
                {item.priceHot !== null ? (
                  status?.hot ? (
                    <Badge variant="success">
                      <CheckCircle2 className="size-3" aria-hidden /> Hot · Q
                      {status.hot.wasteFactorPct}%
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <AlertCircle className="size-3" aria-hidden /> Hot belum
                    </Badge>
                  )
                ) : null}
                {item.priceIced !== null ? (
                  status?.iced ? (
                    <Badge variant="success">
                      <CheckCircle2 className="size-3" aria-hidden /> Iced · Q
                      {status.iced.wasteFactorPct}%
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <AlertCircle className="size-3" aria-hidden /> Iced belum
                    </Badge>
                  )
                ) : null}
              </>
            ) : status?.fixed ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" aria-hidden /> Resep ada · Q
                {status.fixed.wasteFactorPct}%
              </Badge>
            ) : (
              <Badge variant="warning">
                <AlertCircle className="size-3" aria-hidden /> Belum ada resep
              </Badge>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onEdit}
        disabled={isOpen}
        title={isOpen ? "Item open-price tidak punya resep tetap" : "Atur resep"}
      >
        {isOpen ? "—" : "Atur Resep"}
      </Button>
    </div>
  );
}
