"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Combobox,
  Input,
  Modal,
  Skeleton,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  createRecipe,
  deleteRecipe,
  isOk,
  listAtomicIngredients,
  listPreparations,
  listRecipesForMenuItem,
  updateRecipe,
  type Ingredient,
  type RecipeWithIngredients,
} from "@/features/inventory";
import type { MenuItem } from "@/features/menu";
import { formatRupiah } from "@/lib/format";

type Variant = "hot" | "iced" | null;

interface IngredientLineDraft {
  key: string;
  ingredientId: string | null;
  qty: string;
}

interface RecipeFormState {
  variant: Variant;
  recipeId: string | null;
  notes: string;
  wasteFactorPct: string;
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
    wasteFactorPct: "30",
    lines: [{ key: makeKey(), ingredientId: null, qty: "" }],
  };
}

function fromExisting(r: RecipeWithIngredients): RecipeFormState {
  return {
    variant: r.variant,
    recipeId: r.id,
    notes: r.notes ?? "",
    wasteFactorPct: String(r.wasteFactorPct),
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
  const [atomics, setAtomics] = useState<Ingredient[]>([]);
  const [preps, setPreps] = useState<Ingredient[]>([]);
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
      const [atomicRes, prepRes, recipesRes] = await Promise.all([
        listAtomicIngredients({ activeOnly: true }),
        listPreparations({ activeOnly: true }),
        listRecipesForMenuItem(menuItem!.id),
      ]);
      if (cancelled) return;
      if (isOk(atomicRes)) setAtomics(atomicRes.data.items);
      if (isOk(prepRes)) setPreps(prepRes.data.items);
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

  const ingredientById = useMemo(
    () => new Map([...atomics, ...preps].map((i) => [i.id, i])),
    [atomics, preps],
  );

  const ingredientGroups: ComboboxGroup[] = useMemo(() => {
    const groups: ComboboxGroup[] = [];
    if (atomics.length > 0) {
      groups.push({
        label: "Bahan Baku",
        options: atomics.map((i) => ({
          value: i.id,
          label: i.name,
          hint: i.unit,
          keywords: [i.unit],
        })),
      });
    }
    if (preps.length > 0) {
      groups.push({
        label: "Preparations",
        options: preps.map((i) => ({
          value: i.id,
          label: i.name,
          hint: i.unit,
          keywords: [i.unit, "prep"],
        })),
      });
    }
    return groups;
  }, [atomics, preps]);

  if (!menuItem) return null;

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

    const wasteVal = parseInt(form.wasteFactorPct, 10);
    if (!Number.isFinite(wasteVal) || wasteVal < 0 || wasteVal > 200) {
      setError("Q Factor harus 0-200");
      return;
    }

    setSaving(true);
    const payload = {
      variant: form.variant,
      notes: form.notes.trim() || null,
      wasteFactorPct: wasteVal,
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

  function computeFormCogsBase(form: RecipeFormState): number {
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

  function computeFormCogs(form: RecipeFormState): {
    base: number;
    waste: number;
    total: number;
  } {
    const base = computeFormCogsBase(form);
    const w = parseInt(form.wasteFactorPct, 10);
    const waste = Number.isFinite(w) && w > 0 ? Math.round(base * (w / 100)) : 0;
    return { base, waste, total: base + waste };
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
      size="3xl"
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
      ) : atomics.length + preps.length === 0 ? (
        <p className="rounded-md bg-warning-100/40 p-3 text-sm text-warning-500">
          Belum ada bahan atau preparation terdaftar. Tambahkan dulu di tab
          Bahan / Preparations sebelum mengatur resep.
        </p>
      ) : (
        <div className="space-y-6">
          {forms.map((form, idx) => {
            const cogsParts = computeFormCogs(form);
            const cogs = cogsParts.total;
            const sellingPrice =
              form.variant === "hot"
                ? menuItem.priceHot ?? 0
                : form.variant === "iced"
                  ? menuItem.priceIced ?? 0
                  : menuItem.priceFixed ?? 0;
            const margin = sellingPrice - cogs;
            const marginPct =
              sellingPrice > 0 ? Math.round((margin / sellingPrice) * 100) : 0;
            const grabgosoPrice =
              sellingPrice > 0 ? Math.round(sellingPrice * 1.3) : 0;
            const marginColor =
              marginPct >= 50
                ? "text-success-500"
                : marginPct >= 30
                  ? "text-warning-500"
                  : "text-danger-500";

            return (
              <section
                key={form.variant ?? "fixed"}
                className="rounded-xl border border-neutral-200 bg-white"
              >
                <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-neutral-900">
                      {variantLabel(form.variant)}
                    </h3>
                    {form.recipeId ? (
                      <Badge variant="success">Tersimpan</Badge>
                    ) : (
                      <Badge variant="warning">Draft baru</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {form.recipeId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger-500 hover:bg-danger-100"
                        onClick={() => deleteForm(idx)}
                      >
                        <Trash2 className="size-4" aria-hidden /> Hapus
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={() => saveForm(idx)}
                      loading={saving}
                    >
                      {form.recipeId ? "Simpan" : "Buat"}
                    </Button>
                  </div>
                </header>

                <div className="space-y-4 px-4 py-4">
                  {/* Bahan rows */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Bahan
                      </h4>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addLine(idx)}
                      >
                        <Plus className="size-4" aria-hidden /> Tambah
                      </Button>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-neutral-200">
                      <div className="hidden grid-cols-[1fr_8rem_8rem_2.5rem] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 md:grid">
                        <span>Bahan</span>
                        <span>Qty</span>
                        <span className="text-right">Subtotal</span>
                        <span />
                      </div>
                      <ul className="divide-y divide-neutral-200">
                        {form.lines.map((line) => {
                          const ing = line.ingredientId
                            ? ingredientById.get(line.ingredientId)
                            : null;
                          const lineCost =
                            ing && Number.isFinite(parseInt(line.qty, 10))
                              ? parseInt(line.qty, 10) * ing.costPerUnit
                              : 0;
                          return (
                            <li
                              key={line.key}
                              className="grid grid-cols-1 gap-2 px-3 py-2.5 md:grid-cols-[1fr_8rem_8rem_2.5rem] md:items-center md:gap-3"
                            >
                              <Combobox
                                ariaLabel="Pilih bahan"
                                groups={ingredientGroups}
                                value={line.ingredientId}
                                onChange={(v) =>
                                  setLine(idx, line.key, { ingredientId: v })
                                }
                                placeholder="— pilih bahan —"
                                searchPlaceholder="Cari bahan…"
                                size="sm"
                                hideLabel
                              />
                              <div className="grid grid-cols-[1fr_8rem_2.5rem] items-center gap-2 md:contents">
                                <Input
                                  aria-label="Qty"
                                  value={line.qty}
                                  onChange={(e) =>
                                    setLine(idx, line.key, {
                                      qty: e.target.value,
                                    })
                                  }
                                  type="text"
                                  inputMode="numeric"
                                  placeholder={ing ? `(${ing.unit})` : "18"}
                                  className="h-9"
                                />
                                <div className="text-right">
                                  <p className="text-[10px] uppercase tracking-wide text-neutral-500 md:hidden">
                                    Subtotal
                                  </p>
                                  <p className="font-mono text-sm text-neutral-900">
                                    {lineCost > 0 ? formatRupiah(lineCost) : "—"}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeLine(idx, line.key)}
                                  aria-label="Hapus bahan"
                                  disabled={form.lines.length === 1}
                                  className="!size-9 !min-h-9 !p-0 text-danger-500 hover:bg-danger-100 disabled:opacity-30"
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>

                  {/* Q Factor + notes */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      label="Q Factor (%)"
                      value={form.wasteFactorPct}
                      onChange={(e) =>
                        updateForm(idx, (f) => ({
                          ...f,
                          wasteFactorPct: e.target.value,
                        }))
                      }
                      type="text"
                      inputMode="numeric"
                      placeholder="30"
                      hint="Buffer waste/spillage. Default 30% untuk menu."
                    />
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-neutral-900">
                        Catatan (opsional)
                      </label>
                      <textarea
                        rows={3}
                        value={form.notes}
                        onChange={(e) =>
                          updateForm(idx, (f) => ({ ...f, notes: e.target.value }))
                        }
                        placeholder="mis. urutan blending, suhu air"
                        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm hover:border-neutral-400 focus:border-mahakan-green-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* COGS summary */}
                  {cogsParts.base > 0 ? (
                    <div className="rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-100/40 p-3">
                      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div>
                          <dt className="text-xs text-neutral-600">TOTAL bahan</dt>
                          <dd className="font-mono font-semibold text-neutral-900">
                            {formatRupiah(cogsParts.base)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-600">
                            Q Factor {form.wasteFactorPct || "0"}%
                          </dt>
                          <dd className="font-mono font-semibold text-neutral-900">
                            {formatRupiah(cogsParts.waste)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-600">TOTAL COGS</dt>
                          <dd className="font-mono font-semibold text-neutral-900">
                            {formatRupiah(cogs)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-neutral-600">Harga jual</dt>
                          <dd className="font-mono font-semibold text-neutral-900">
                            {sellingPrice > 0 ? formatRupiah(sellingPrice) : "—"}
                          </dd>
                        </div>
                      </dl>
                      {sellingPrice > 0 ? (
                        <dl className="mt-3 grid grid-cols-1 gap-3 border-t border-mahakan-green-700/20 pt-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-xs text-neutral-600">Margin</dt>
                            <dd
                              className={`font-mono text-base font-bold ${marginColor}`}
                            >
                              {formatRupiah(margin)} ({marginPct}%)
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-neutral-600">Cost%</dt>
                            <dd className="font-mono text-base font-bold text-neutral-900">
                              {Math.round((cogs / sellingPrice) * 100)}%
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-neutral-600">
                              GRABGOSO 30%
                              <span className="ml-1 text-neutral-400">
                                (estimate)
                              </span>
                            </dt>
                            <dd className="font-mono text-base font-bold text-neutral-700">
                              {formatRupiah(grabgosoPrice)}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>
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
