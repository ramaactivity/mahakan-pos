"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  createIngredient,
  isOk,
  updateIngredient,
  type Ingredient,
  type IngredientSection,
} from "@/features/inventory";
import {
  formatRupiah,
  parseIndonesianNumber,
  parseRupiah,
} from "@/lib/format";
import {
  displayUnit,
  packUnitsFromIngredient,
  parsePackUnitsForm,
  type IngredientPackConversion,
  type PackUnitsForm,
} from "@/lib/unit-conversion";
import { PackUnitsEditor } from "./PackUnitsEditor";

interface IngredientFormModalProps {
  open: boolean;
  edit?: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

/* Sesi AE-148 — Categorized unit groups (owner feedback: lebih rapih,
 * tidak terbang ke "...lainnya"). Picker pakai Radix Select groups. */
/* Sesi AE-173 — value satuan KANONIK (selaras displayUnit / UNIT_TABLE) supaya
 * konsisten lintas modul (belanja, opname, market list, COGS). */
const RECIPE_UNIT_GROUPS = [
  {
    label: "Berat & Volume",
    options: [
      { value: "gr", label: "gr", hint: "gram" },
      { value: "ml", label: "ml", hint: "mililiter" },
    ],
  },
  {
    label: "Hitungan",
    options: [{ value: "Pcs", label: "Pcs", hint: "pieces" }],
  },
  {
    label: "Per Wadah / Kemasan",
    options: [
      { value: "Kg", label: "Kg", hint: "kilogram (jarang untuk recipe)" },
      { value: "L", label: "L", hint: "liter (jarang untuk recipe)" },
      { value: "Pack", label: "Pack" },
      { value: "Btl", label: "Btl", hint: "botol" },
      { value: "set", label: "set" },
    ],
  },
] as const;

/* Flat lookup (as string[]) untuk "is this a preset?" check. */
const COMMON_RECIPE_UNITS: string[] = RECIPE_UNIT_GROUPS.flatMap((g) =>
  g.options.map((o) => o.value),
);
/* Sesi AE-174 — satuan belanja/pack kini dikelola via PackUnitsEditor
 * (PURCHASE_UNIT_GROUPS/COMMON_PURCHASE_UNITS dihapus). */

/* Sesi AE-173 — cocokkan unit tersimpan (mis. "kg"/"g" legacy) ke value preset
 * KANONIK secara case/alias-tolerant. Return value preset ("Kg"/"gr") kalau
 * cocok, else null → tampilkan input custom. Bikin dropdown tak pernah blank
 * + konsisten walau data lama masih huruf kecil. */
function matchPresetUnit(presets: string[], unit: string): string | null {
  if (!unit) return null;
  const c = displayUnit(unit).toLowerCase();
  return presets.find((p) => displayUnit(p).toLowerCase() === c) ?? null;
}

const SECTION_OPTIONS: Array<{
  value: IngredientSection | "__none";
  label: string;
}> = [
  { value: "__none", label: "Belum diset" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting Supplies" },
  { value: "cleaning", label: "Cleaning Supplies" },
];

export function IngredientFormModal({
  open,
  edit,
  onClose,
  onSaved,
}: IngredientFormModalProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("g");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [reorderThreshold, setReorderThreshold] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [section, setSection] = useState<IngredientSection | "__none">(
    "__none",
  );
  /* Sesi AE-130 — multi-unit tier inputs (Anisa feedback). Empty string =
   * tier disabled, fallback ke unit utama. Per_cogs = berapa unit utama
   * per 1 satuan ini. */
  const [unitTracking, setUnitTracking] = useState("");
  const [unitTrackingPerCogs, setUnitTrackingPerCogs] = useState("");
  /* Sesi AE-174 — Satuan Belanja Utama + Pack Lain via editor terpadu. */
  const [packForm, setPackForm] = useState<PackUnitsForm>({
    mainLabel: "",
    mainQtyStr: "",
    packRows: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (edit) {
      setName(edit.name);
      setUnit(edit.unit);
      setCostPerUnit(String(edit.costPerUnit));
      setInitialStock("0"); // not used in edit
      setReorderThreshold(
        edit.reorderThreshold !== null ? String(edit.reorderThreshold) : "",
      );
      setNotes(edit.notes ?? "");
      setIsActive(edit.isActive);
      setSection(edit.section ?? "__none");
      setUnitTracking(edit.unitTracking ?? "");
      setUnitTrackingPerCogs(
        edit.unitTrackingPerCogs ? String(parseFloat(edit.unitTrackingPerCogs)) : "",
      );
      setPackForm(
        packUnitsFromIngredient({
          unitBelanja: edit.unitBelanja,
          unitBelanjaPerCogs: edit.unitBelanjaPerCogs,
          packConversions:
            edit.packConversions as IngredientPackConversion[] | null,
        }),
      );
    } else {
      setName("");
      setUnit("g");
      setCostPerUnit("");
      setInitialStock("0");
      setReorderThreshold("");
      setNotes("");
      setIsActive(true);
      setSection("__none");
      setUnitTracking("");
      setUnitTrackingPerCogs("");
      setPackForm({ mainLabel: "", mainQtyStr: "", packRows: [] });
    }
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, edit]);

  function parseIntOrZero(s: string): number {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit() {
    if (submitting) return;
    if (name.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    if (unit.trim().length === 0) {
      setError("Unit wajib diisi (mis. g, ml, pcs)");
      return;
    }
    let cost = 0;
    try {
      cost = parseRupiah(costPerUnit);
    } catch {
      cost = 0;
    }
    if (cost < 0) {
      setError("Cost per unit tidak boleh negatif");
      return;
    }
    const stock = parseIntOrZero(initialStock);
    if (stock < 0) {
      setError("Stok awal tidak boleh negatif");
      return;
    }
    const threshold =
      reorderThreshold.trim().length === 0
        ? null
        : parseIntOrZero(reorderThreshold);
    if (threshold !== null && threshold < 0) {
      setError("Stok minimum tidak boleh negatif");
      return;
    }

    /* Sesi AE-130 — parse 3-unit tier inputs (Anisa feedback).
     * Validasi: kalau label di-set, per_cogs WAJIB positif. Kalau label
     * kosong, per_cogs di-ignore (tier disabled). */
    const trackingLabel = unitTracking.trim();
    const trackingPer = parseDecimalOrNull(unitTrackingPerCogs);
    if (trackingLabel.length > 0 && (trackingPer === null || trackingPer <= 0)) {
      setError(
        `Konversi satuan terbesar harus diisi (mis. 1 ${trackingLabel} = ? ${unit || "satuan utama"})`,
      );
      return;
    }
    /* Sesi AE-174 — parse Satuan Belanja Utama + Pack Lain. */
    const packResult = parsePackUnitsForm(packForm, unit.trim());
    if (packResult.error) {
      setError(packResult.error);
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmedNotes = notes.trim();
    const sectionValue =
      section === "__none" ? null : (section as IngredientSection);
    /* Sesi AE-130 — payload tier: kalau label kosong → null untuk wipe.
     * Per_cogs juga null kalau label null (tier disabled). */
    const trackingPayload = {
      unitTracking: trackingLabel.length > 0 ? trackingLabel : null,
      unitTrackingPerCogs: trackingLabel.length > 0 ? trackingPer : null,
    };
    const belanjaPayload = {
      unitBelanja: packResult.unitBelanja,
      unitBelanjaPerCogs: packResult.unitBelanjaPerCogs,
      packConversions: packResult.packConversions,
    };
    const res = edit
      ? await updateIngredient(edit.id, {
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          isActive,
          section: sectionValue,
          ...trackingPayload,
          ...belanjaPayload,
        })
      : await createIngredient({
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          initialStock: stock,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          section: sectionValue,
          ...trackingPayload,
          ...belanjaPayload,
        });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      edit
        ? `Bahan ${name.trim()} diperbarui`
        : `Bahan ${name.trim()} ditambahkan${stock > 0 ? ` (stok awal ${stock} ${unit})` : ""}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Bahan" : "Tambah Bahan"}
      /* Sesi AE-137 — widen lg supaya 2-kolom layout (Recipe + Purchase
       * side-by-side) muat tanpa scrolling horizontal di tablet. */
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {edit ? "Simpan" : "Tambah"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Nama Bahan"
            placeholder="mis. Susu Full Cream"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <Select
            label="Section"
            options={SECTION_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={section}
            onValueChange={(v) =>
              setSection(v as IngredientSection | "__none")
            }
          />
        </div>

        {/* Sesi AE-136 — Konsep 2-unit: Recipe Unit (storage + resep,
         * satuan terkecil) + Purchase Unit (display + belanja + opname).
         * Tracking Unit di-deprecate dari UI, masih kept di schema untuk
         * legacy backward-compat. */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Recipe Unit <span className="text-danger-500">*</span>
          </label>
          <div className="flex gap-1">
            <div className="w-32">
              <Select
                ariaLabel="Recipe unit preset"
                groups={[
                  ...RECIPE_UNIT_GROUPS.map((g) => ({
                    label: g.label,
                    options: g.options.map((o) => ({
                      value: o.value,
                      label: o.label,
                      hint: "hint" in o ? o.hint : undefined,
                    })),
                  })),
                  {
                    label: "Lainnya",
                    options: [
                      { value: "__custom", label: "Custom…" },
                    ],
                  },
                ]}
                value={matchPresetUnit(COMMON_RECIPE_UNITS, unit) ?? "__custom"}
                onValueChange={(v) => {
                  if (v === "__custom") {
                    if (matchPresetUnit(COMMON_RECIPE_UNITS, unit)) setUnit("");
                  } else {
                    setUnit(v);
                  }
                }}
                size="sm"
              />
            </div>
            {!matchPresetUnit(COMMON_RECIPE_UNITS, unit) ? (
              <input
                type="text"
                placeholder="custom"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
              />
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            Satuan terkecil untuk perhitungan resep + storage internal
            (mis. <strong>g</strong> untuk bahan dapur, <strong>ml</strong>{" "}
            untuk cairan, <strong>pcs</strong> untuk barang biji).
          </p>
        </div>

        {/* Sesi AE-174 — Editor satuan terpadu (Satuan Belanja Utama + Pack
         * Lain). Menggerakkan Market List, Opname, Pembelian secara konsisten. */}
        <div className="rounded-md border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-3">
          <PackUnitsEditor
            baseUnit={unit}
            value={packForm}
            onChange={setPackForm}
            disabled={submitting}
          />
        </div>

        <Input
          label={`Cost per ${unit || "Recipe Unit"} (Rp)`}
          placeholder="200"
          value={costPerUnit}
          onChange={(e) => setCostPerUnit(e.target.value)}
          type="text"
          inputMode="numeric"
          hint="Harga modal per recipe unit. Otomatis ter-update saat catat pembelian."
        />


        {!edit ? (
          <Input
            label={`Stok Awal (${unit || "unit"})`}
            placeholder="0"
            value={initialStock}
            onChange={(e) => setInitialStock(e.target.value)}
            type="text"
            inputMode="numeric"
          />
        ) : null}

        <Input
          label={`Stok Minimum (${unit || "unit"}, opsional)`}
          placeholder="kosongkan kalau tidak mau alert"
          value={reorderThreshold}
          onChange={(e) => setReorderThreshold(e.target.value)}
          type="text"
          inputMode="numeric"
          /* Sesi AE-130 — rename "Threshold Stok Rendah" → "Stok Minimum"
           * (Anisa feedback: istilah Threshold bikin staff bingung).
           * "Stok Minimum" = batas terendah sebelum perlu re-order, bahasa
           * yang familiar di operasi gudang Indonesia. */
        />

        {/* Sesi AE-136 — Tracking Unit di-deprecate dari UI (legacy data
         * tetap di schema). Owner masih bisa edit legacy ingredient yang
         * masih punya unitTracking via collapsible advanced. */}
        {unitTracking.trim().length > 0 ? (
          <details className="rounded-md border border-neutral-200 bg-neutral-50/40">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-neutral-700">
              Legacy: Tracking Unit (deprecated)
            </summary>
            <div className="space-y-2 border-t border-neutral-200 px-3 py-3">
              <p className="text-[11px] text-neutral-600">
                Bahan ini punya Tracking Unit lama dari sebelum konvensi
                2-unit. Disarankan: pindah info-nya ke Purchase Unit di
                atas, lalu kosongkan field ini.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Label satuan tracking"
                  placeholder="mis. Kotak / Karung"
                  value={unitTracking}
                  onChange={(e) => setUnitTracking(e.target.value)}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  = berisi
                </span>
                <Input
                  aria-label="Jumlah recipe unit per 1 satuan tracking"
                  placeholder="1000"
                  value={unitTrackingPerCogs}
                  onChange={(e) => setUnitTrackingPerCogs(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  className="w-24"
                  disabled={unitTracking.trim().length === 0}
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  {unit || "recipe unit"}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setUnitTracking("");
                  setUnitTrackingPerCogs("");
                }}
                className="text-xs"
              >
                Kosongkan
              </Button>
            </div>
          </details>
        ) : null}

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="mis. supplier favorit, brand spesifik"
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
            Bahan aktif (uncheck untuk sembunyikan tanpa hapus)
          </label>
        ) : null}

        {!edit && parseRupiahSafe(costPerUnit) > 0 && parseIntOrZeroSafe(initialStock) > 0 ? (
          <div className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Nilai stok awal:{" "}
            <span className="font-mono">
              {formatRupiah(
                parseRupiahSafe(costPerUnit) * parseIntOrZeroSafe(initialStock),
              )}
            </span>
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

function parseRupiahSafe(s: string): number {
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}

function parseIntOrZeroSafe(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Sesi AE-136 — parse decimal pakai strict Indonesian parser
 *  (koma desimal, titik ribuan, tolak format Inggris).
 *  Returns null untuk empty/invalid. */
function parseDecimalOrNull(s: string): number | null {
  if (s.trim().length === 0) return null;
  const n = parseIndonesianNumber(s);
  if (!Number.isFinite(n)) return null;
  return n;
}
