"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Modal, Skeleton, toast } from "@/components/ui";
import {
  createRecipe,
  deleteRecipe,
  isOk,
  listIngredients,
  listRecipesForMenuItem,
  updateRecipe,
  type Ingredient,
  type RecipeWithIngredients,
} from "@/features/inventory";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";

type Variant = "hot" | "iced" | null;

interface IngredientLineDraft {
  /** Local-only key for React iteration. */
  key: string;
  ingredientId: string | null;
  qty: string;
}

interface RecipeFormState {
  variant: Variant;
  recipeId: string | null;
  notes: string;
  lines: IngredientLineDraft[];
}

interface RecipeEditorModalProps {
  open: boolean;
  menuItem: MenuItem | null;
  onClose: () => void;
  onSaved: () => void;
}

function makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyDraft(variant: Variant): RecipeFormState {
  return {
    variant,
    recipeId: null,
    notes: "",
    lines: [{ key: makeKey(), ingredientId: null, qty: "" }],
  };
}

function fromExisting(r: RecipeWithIngredients): RecipeFormState {
  return {
    variant: r.variant,
    recipeId: r.id,
    notes: r.notes ?? "",
    lines: r.ingredients.map((ri) => ({
      key: makeKey(),
      ingredientId: ri.ingredientId,
      qty: String(ri.qty),
    })),
  };
}

export function RecipeEditorModal({
  open,
  menuItem,
  onClose,
  onSaved,
}: RecipeEditorModalProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [forms, setForms] = useState<RecipeFormState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variantsForMenu: Variant[] = useMemo(() => {
    if (!menuItem) return [];
    if (menuItem.priceType === "fixed") return [null];
    if (menuItem.priceType === "variant") {
      const out: Variant[] = [];
      if (menuItem.priceHot !== null) out.push("hot");
      if (menuItem.priceIced !== null) out.push("iced");
      return out;
    }
    return [];
  }, [menuItem]);

  useEffect(() => {
    if (!open || !menuItem) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const [ingRes, recipesRes] = await Promise.all([
        listIngredients({ activeOnly: true }),
        listRecipesForMenuItem(menuItem!.id),
      ]);
      if (cancelled) return;
      if (isOk(ingRes)) setIngredients(ingRes.data.items);
      const existing = isOk(recipesRes) ? recipesRes.data : [];
      const next: RecipeFormState[] = variantsForMenu.map((v) => {
        const match = existing.find((r) => r.variant === v);
        return match ? fromExisting(match) : emptyDraft(v);
      });
      setForms(next);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, menuItem, variantsForMenu]);

  if (!menuItem) return null;

  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  function updateForm(idx: number, fn: (f: RecipeFormState) => RecipeFormState) {
    setForms((prev) => prev.map((f, i) => (i === idx ? fn(f) : f)));
  }

  function addLine(idx: number) {
    updateForm(idx, (f) => ({
      ...f,
      lines: [
        ...f.lines,
        { key: makeKey(), ingredientId: null, qty: "" },
      ],
    }));
  }

  function removeLine(idx: number, key: string) {
    updateForm(idx, (f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  function setLine(
    idx: number,
    key: string,
    patch: Partial<IngredientLineDraft>,
  ) {
    updateForm(idx, (f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  async function saveForm(idx: number) {
    if (saving) return;
    const form = forms[idx];
    if (!form) return;
    setError(null);

    const filledLines = form.lines.filter(
      (l) => l.ingredientId !== null && l.qty.trim().length > 0,
    );
    if (filledLines.length === 0) {
      setError("Tambah minimal 1 bahan");
      return;
    }
    const ingredientIds = new Set<string>();
    for (const l of filledLines) {
      if (ingredientIds.has(l.ingredientId!)) {
        setError(`Bahan duplikat: ${ingredientById.get(l.ingredientId!)?.name}`);
        return;
      }
      ingredientIds.add(l.ingredientId!);
      const q = parseInt(l.qty, 10);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Jumlah harus angka > 0");
        return;
      }
    }

    setSaving(true);
    const payload = {
      variant: form.variant,
      notes: form.notes.trim() || null,
      ingredients: filledLines.map((l) => ({
        ingredientId: l.ingredientId!,
        qty: parseInt(l.qty, 10),
      })),
    };

    const res = form.recipeId
      ? await updateRecipe(form.recipeId, payload)
      : await createRecipe({
          menuItemId: menuItem!.id,
          ...payload,
        });

    if (!isOk(res)) {
      setError(res.error.message);
      setSaving(false);
      return;
    }

    toast.success(
      `Resep ${menuItem!.name}${form.variant ? ` (${form.variant})` : ""} tersimpan`,
    );
    setSaving(false);
    onSaved();
  }

  async function deleteForm(idx: number) {
    const form = forms[idx];
    if (!form?.recipeId) return;
    if (!confirm("Hapus resep ini? Histori COGS transaksi tetap aman.")) {
      return;
    }
    setSaving(true);
    const res = await deleteRecipe(form.recipeId);
    setSaving(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Resep dihapus");
    onSaved();
  }

  function variantLabel(v: Variant) {
    if (v === "hot") return "Hot";
    if (v === "iced") return "Iced";
    return "Resep";
  }

  function computeFormCogs(form: RecipeFormState): number {
    let total = 0;
    for (const l of form.lines) {
      if (!l.ingredientId) continue;
      const q = parseInt(l.qty, 10);
      if (!Number.isFinite(q) || q <= 0) continue;
      const ing = ingredientById.get(l.ingredientId);
      if (!ing) continue;
      total += ing.costPerUnit * q;
    }
    return total;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resep — ${menuItem.name}`}
      description={
        menuItem.priceType === "variant"
          ? "Atur resep per variant. Owner+Manager bisa edit; Owner-only bisa hapus."
          : "Atur bahan & jumlah untuk hitung COGS dan auto-deduct stok."
      }
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-3" role="status" aria-label="Memuat resep">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : ingredients.length === 0 ? (
        <p className="rounded-md bg-warning-100/40 p-3 text-sm text-warning-500">
          Belum ada bahan terdaftar. Tambahkan bahan dulu di tab Bahan sebelum
          mengatur resep.
        </p>
      ) : (
        <div className="space-y-5">
          {forms.map((form, idx) => {
            const cogs = computeFormCogs(form);
            const sellingPrice =
              form.variant === "hot"
                ? menuItem.priceHot ?? 0
                : form.variant === "iced"
                  ? menuItem.priceIced ?? 0
                  : menuItem.priceFixed ?? 0;
            const margin = sellingPrice - cogs;
            const marginPct =
              sellingPrice > 0 ? Math.round((margin / sellingPrice) * 100) : 0;

            return (
              <div
                key={form.variant ?? "fixed"}
                className="space-y-3 rounded-lg border border-neutral-200 p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neutral-900">
                    {variantLabel(form.variant)}
                    {form.recipeId ? (
                      <Badge variant="success" className="ml-2">
                        Tersimpan
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="ml-2">
                        Draft baru
                      </Badge>
                    )}
                  </h3>
                  {form.recipeId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger-500 hover:bg-danger-100"
                      onClick={() => deleteForm(idx)}
                    >
                      <Trash2 className="size-4" aria-hidden /> Hapus resep
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {form.lines.map((line) => {
                    const ing = line.ingredientId
                      ? ingredientById.get(line.ingredientId)
                      : null;
                    return (
                      <div
                        key={line.key}
                        className="flex items-end gap-2 rounded-md bg-neutral-50 p-2"
                      >
                        <div className="flex-1 space-y-1">
                          <label className="block text-xs font-medium text-neutral-700">
                            Bahan
                          </label>
                          <select
                            value={line.ingredientId ?? ""}
                            onChange={(e) =>
                              setLine(idx, line.key, {
                                ingredientId: e.target.value || null,
                              })
                            }
                            className="h-9 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                          >
                            <option value="">— pilih bahan —</option>
                            {ingredients.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="w-24">
                          <Input
                            label={`Qty${ing ? ` (${ing.unit})` : ""}`}
                            value={line.qty}
                            onChange={(e) =>
                              setLine(idx, line.key, { qty: e.target.value })
                            }
                            type="text"
                            inputMode="numeric"
                            placeholder="18"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLine(idx, line.key)}
                          aria-label="Hapus bahan"
                          className="text-danger-500 hover:bg-danger-100"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addLine(idx)}
                  >
                    <Plus className="size-4" aria-hidden /> Tambah bahan
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-700">
                    Catatan (opsional)
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) =>
                      updateForm(idx, (f) => ({ ...f, notes: e.target.value }))
                    }
                    placeholder="mis. urutan blending, suhu air"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                {sellingPrice > 0 && cogs > 0 ? (
                  <div className="grid grid-cols-3 gap-2 rounded-md bg-mahakan-green-100/40 p-2 text-xs">
                    <div>
                      <p className="text-neutral-600">COGS</p>
                      <p className="font-mono font-semibold text-neutral-900">
                        {formatRupiah(cogs)}
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-600">Harga jual</p>
                      <p className="font-mono font-semibold text-neutral-900">
                        {formatRupiah(sellingPrice)}
                      </p>
                    </div>
                    <div>
                      <p className="text-neutral-600">Margin</p>
                      <p
                        className={`font-mono font-semibold ${margin >= 0 ? "text-success-500" : "text-danger-500"}`}
                      >
                        {formatRupiah(margin)} ({marginPct}%)
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button onClick={() => saveForm(idx)} loading={saving}>
                    {form.recipeId ? "Simpan perubahan" : "Buat resep"}
                  </Button>
                </div>
              </div>
            );
          })}

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
