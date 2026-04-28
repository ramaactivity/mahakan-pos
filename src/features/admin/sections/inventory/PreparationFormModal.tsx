"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Modal,
  Select,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  computePrepCostFromLines,
  createIngredient,
  createRecipe,
  deleteRecipe,
  getPreparationRecipe,
  isOk,
  listAtomicIngredients,
  listPreparations,
  updateIngredient,
  updateRecipe,
  type Ingredient,
  type RecipeIngredientLine,
} from "@/features/inventory";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface PreparationFormModalProps {
  open: boolean;
  edit?: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

const COMMON_UNITS = ["g", "kg", "ml", "L", "pcs"];

interface LineDraft {
  key: string;
  ingredientId: string | null;
  qty: string;
}

function makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PreparationFormModal({
  open,
  edit,
  onClose,
  onSaved,
}: PreparationFormModalProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ml");
  const [preparationYield, setPreparationYield] = useState("");
  const [wasteFactorPct, setWasteFactorPct] = useState("10");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [lines, setLines] = useState<LineDraft[]>([
    { key: makeKey(), ingredientId: null, qty: "" },
  ]);
  const [recipeId, setRecipeId] = useState<string | null>(null);

  const [atomicOptions, setAtomicOptions] = useState<Ingredient[]>([]);
  const [prepOptions, setPrepOptions] = useState<Ingredient[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load atomic + prep options once when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadOpts() {
      const [atomicRes, prepRes] = await Promise.all([
        listAtomicIngredients({ activeOnly: true }),
        listPreparations({ activeOnly: true }),
      ]);
      if (cancelled) return;
      if (isOk(atomicRes)) setAtomicOptions(atomicRes.data.items);
      if (isOk(prepRes)) setPrepOptions(prepRes.data.items);
    }
    void loadOpts();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Initialize form state from `edit` (or reset for create).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function init() {
      setError(null);
      setSubmitting(false);
      if (edit) {
        setName(edit.name);
        setUnit(edit.unit);
        setPreparationYield(
          edit.preparationYield !== null ? String(edit.preparationYield) : "",
        );
        setNotes(edit.notes ?? "");
        setIsActive(edit.isActive);

        // Load existing recipe (if any).
        setLoadingExisting(true);
        const res = await getPreparationRecipe(edit.id);
        if (cancelled) return;
        setLoadingExisting(false);
        if (isOk(res) && res.data) {
          setRecipeId(res.data.id);
          setWasteFactorPct(String(res.data.wasteFactorPct));
          setLines(
            res.data.ingredients.length > 0
              ? res.data.ingredients.map((ri: RecipeIngredientLine) => ({
                  key: makeKey(),
                  ingredientId: ri.ingredientId,
                  qty: String(ri.qty),
                }))
              : [{ key: makeKey(), ingredientId: null, qty: "" }],
          );
        } else {
          setRecipeId(null);
          setWasteFactorPct("10");
          setLines([{ key: makeKey(), ingredientId: null, qty: "" }]);
        }
      } else {
        setName("");
        setUnit("ml");
        setPreparationYield("");
        setWasteFactorPct("10");
        setNotes("");
        setIsActive(true);
        setRecipeId(null);
        setLines([{ key: makeKey(), ingredientId: null, qty: "" }]);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [open, edit]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: makeKey(), ingredientId: null, qty: "" },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  // ---- Live cost preview ----
  function ingredientById(id: string): Ingredient | undefined {
    return (
      atomicOptions.find((i) => i.id === id) ??
      prepOptions.find((i) => i.id === id)
    );
  }

  const filledLines = lines
    .map((l) => {
      if (!l.ingredientId) return null;
      const q = parseInt(l.qty, 10);
      if (!Number.isFinite(q) || q <= 0) return null;
      const ing = ingredientById(l.ingredientId);
      if (!ing) return null;
      return { qty: q, costPerUnit: ing.costPerUnit, ing };
    })
    .filter((x): x is { qty: number; costPerUnit: number; ing: Ingredient } => x !== null);

  const yieldNum = parseInt(preparationYield, 10);
  const wasteNum = parseInt(wasteFactorPct, 10);
  const previewCostPerUnit =
    filledLines.length > 0 &&
    Number.isFinite(yieldNum) &&
    yieldNum > 0 &&
    Number.isFinite(wasteNum) &&
    wasteNum >= 0
      ? computePrepCostFromLines(
          filledLines.map((l) => ({ qty: l.qty, costPerUnit: l.costPerUnit })),
          wasteNum,
          yieldNum,
        )
      : null;

  const baseCost = filledLines.reduce(
    (acc, l) => acc + l.qty * l.costPerUnit,
    0,
  );
  const wasteAmount = Number.isFinite(wasteNum)
    ? Math.round(baseCost * (wasteNum / 100))
    : 0;
  const totalCost = baseCost + wasteAmount;

  async function onSubmit() {
    if (submitting) return;
    setError(null);

    if (name.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    if (unit.trim().length === 0) {
      setError("Unit wajib diisi");
      return;
    }
    const yieldVal = parseInt(preparationYield, 10);
    if (!Number.isFinite(yieldVal) || yieldVal <= 0) {
      setError("Yield harus angka > 0");
      return;
    }
    const wasteVal = parseInt(wasteFactorPct, 10);
    if (!Number.isFinite(wasteVal) || wasteVal < 0 || wasteVal > 200) {
      setError("Q Factor harus 0-200");
      return;
    }

    const validLines = lines.filter(
      (l) => l.ingredientId !== null && l.qty.trim().length > 0,
    );
    if (validLines.length === 0) {
      setError("Tambah minimal 1 bahan resep");
      return;
    }
    const ingIds = new Set<string>();
    for (const l of validLines) {
      if (ingIds.has(l.ingredientId!)) {
        const dup = ingredientById(l.ingredientId!);
        setError(`Bahan duplikat: ${dup?.name ?? "?"}`);
        return;
      }
      ingIds.add(l.ingredientId!);
      const q = parseInt(l.qty, 10);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Jumlah bahan harus angka > 0");
        return;
      }
      // Self-reference is impossible at create (no id yet). At edit, schema +
      // server-side cycle detect catch it.
    }

    setSubmitting(true);

    try {
      let prepId: string;

      if (edit) {
        // Update preparation metadata.
        const trimmedNotes = notes.trim();
        const updIng = await updateIngredient(edit.id, {
          name: name.trim(),
          unit: unit.trim(),
          preparationYield: yieldVal,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          isActive,
        });
        if (!isOk(updIng)) {
          setError(updIng.error.message);
          setSubmitting(false);
          return;
        }
        prepId = edit.id;
      } else {
        const created = await createIngredient({
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: 0, // populated by cascade after recipe insert
          initialStock: 0,
          notes: notes.trim().length > 0 ? notes.trim() : null,
          isPreparation: true,
          preparationYield: yieldVal,
        });
        if (!isOk(created)) {
          setError(created.error.message);
          setSubmitting(false);
          return;
        }
        prepId = created.data.id;
      }

      // Save recipe (create or update).
      const recipePayload = {
        wasteFactorPct: wasteVal,
        ingredients: validLines.map((l) => ({
          ingredientId: l.ingredientId!,
          qty: parseInt(l.qty, 10),
        })),
      };

      if (recipeId) {
        const upd = await updateRecipe(recipeId, recipePayload);
        if (!isOk(upd)) {
          setError(upd.error.message);
          setSubmitting(false);
          return;
        }
      } else {
        const cre = await createRecipe({
          ingredientId: prepId,
          ...recipePayload,
        });
        if (!isOk(cre)) {
          setError(cre.error.message);
          setSubmitting(false);
          return;
        }
      }

      toast.success(
        edit
          ? `Preparation ${name.trim()} diperbarui`
          : `Preparation ${name.trim()} dibuat`,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal simpan");
      setSubmitting(false);
    }
  }

  async function handleDeleteRecipe() {
    if (!recipeId) return;
    if (
      !confirm(
        "Hapus resep preparation ini? Cost akan jadi 0 sampai dibuat resep baru.",
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await deleteRecipe(recipeId);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Resep preparation dihapus");
    setRecipeId(null);
    setLines([{ key: makeKey(), ingredientId: null, qty: "" }]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Preparation" : "Tambah Preparation"}
      description="Sub-resep dengan yield + Q Factor. Cost auto-computed dari resep + cascade ke menu yang merefer."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {edit ? "Simpan" : "Buat Preparation"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Nama Preparation"
            placeholder="mis. Prep-Espresso-HB, Prep-Sambal-Matah"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Unit Yield
            </label>
            <div className="flex gap-1">
              <div className="w-24">
                <Select
                  ariaLabel="Unit preset"
                  options={[
                    ...COMMON_UNITS.map((u) => ({ value: u, label: u })),
                    { value: "__custom", label: "…lainnya" },
                  ]}
                  value={COMMON_UNITS.includes(unit) ? unit : "__custom"}
                  onValueChange={(v) => {
                    if (v === "__custom") {
                      if (COMMON_UNITS.includes(unit)) setUnit("");
                    } else {
                      setUnit(v);
                    }
                  }}
                  size="sm"
                />
              </div>
              {!COMMON_UNITS.includes(unit) ? (
                <input
                  type="text"
                  placeholder="custom"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Input
              label={`Yield per Batch (${unit || "unit"})`}
              placeholder="mis. 45 (untuk Prep-Espresso-HB)"
              value={preparationYield}
              onChange={(e) => setPreparationYield(e.target.value)}
              type="text"
              inputMode="numeric"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Jumlah unit yang dihasilkan dari 1× resep
            </p>
          </div>
          <div>
            <Input
              label="Q Factor (%)"
              placeholder="10"
              value={wasteFactorPct}
              onChange={(e) => setWasteFactorPct(e.target.value)}
              type="text"
              inputMode="numeric"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Buffer waste/spillage. Default 10% untuk preparation.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="mis. urutan extract, suhu air, blending"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </div>

        {edit ? (
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
            />
            Preparation aktif
          </label>
        ) : null}

        {/* ---- Recipe builder ---- */}
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900">
              Resep Preparation
            </h3>
            {recipeId && edit ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDeleteRecipe}
                className="text-danger-500 hover:bg-danger-100"
              >
                <Trash2 className="size-4" aria-hidden /> Hapus resep
              </Button>
            ) : null}
          </div>

          {loadingExisting ? (
            <p className="py-3 text-center text-xs text-neutral-500">
              Memuat resep…
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((line) => {
                const ing = line.ingredientId
                  ? ingredientById(line.ingredientId)
                  : null;
                const ingredientGroups: ComboboxGroup[] = [];
                if (atomicOptions.length > 0) {
                  ingredientGroups.push({
                    label: "Bahan Baku",
                    options: atomicOptions.map((i) => ({
                      value: i.id,
                      label: i.name,
                      hint: i.unit,
                      keywords: [i.unit],
                    })),
                  });
                }
                const filteredPreps = prepOptions.filter(
                  (p) => p.id !== edit?.id,
                );
                if (filteredPreps.length > 0) {
                  ingredientGroups.push({
                    label: "Preparation lain",
                    options: filteredPreps.map((i) => ({
                      value: i.id,
                      label: i.name,
                      hint: i.unit,
                      keywords: [i.unit, "prep"],
                    })),
                  });
                }
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 gap-2 rounded-md bg-neutral-50 p-2 md:grid-cols-[1fr_8rem_2.5rem] md:items-end"
                  >
                    <Combobox
                      ariaLabel="Pilih bahan"
                      groups={ingredientGroups}
                      value={line.ingredientId}
                      onChange={(v) =>
                        setLine(line.key, { ingredientId: v })
                      }
                      placeholder="— pilih bahan —"
                      searchPlaceholder="Cari bahan…"
                      size="sm"
                      hideLabel
                    />
                    <Input
                      aria-label={`Qty${ing ? ` (${ing.unit})` : ""}`}
                      placeholder={ing ? ing.unit : "16"}
                      value={line.qty}
                      onChange={(e) =>
                        setLine(line.key, { qty: e.target.value })
                      }
                      type="text"
                      inputMode="numeric"
                      className="h-9"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLine(line.key)}
                      aria-label="Hapus bahan"
                      className="!size-9 !min-h-9 !p-0 text-danger-500 hover:bg-danger-100"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                );
              })}
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="size-4" aria-hidden /> Tambah bahan
              </Button>
            </div>
          )}
        </div>

        {/* ---- Live cost preview ---- */}
        {filledLines.length > 0 && previewCostPerUnit !== null ? (
          <div className="grid grid-cols-2 gap-3 rounded-md bg-mahakan-green-100/40 p-3 text-xs md:grid-cols-4">
            <div>
              <p className="text-neutral-600">TOTAL bahan</p>
              <p className="font-mono font-semibold">
                {formatRupiah(baseCost)}
              </p>
            </div>
            <div>
              <p className="text-neutral-600">Q Factor {wasteNum}%</p>
              <p className="font-mono font-semibold">
                {formatRupiah(wasteAmount)}
              </p>
            </div>
            <div>
              <p className="text-neutral-600">TOTAL COST</p>
              <p className="font-mono font-semibold">
                {formatRupiah(totalCost)}
              </p>
            </div>
            <div>
              <p className="text-neutral-600">Cost / {unit}</p>
              <p className="font-mono font-semibold text-mahakan-green-900">
                {formatRupiah(previewCostPerUnit)}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

// formatRupiah/parseRupiah used; suppress the unused-import linter for parseRupiah
// since we may use it later when waste rupiah-input is requested.
void parseRupiah;
