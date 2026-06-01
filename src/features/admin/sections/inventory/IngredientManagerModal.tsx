"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Modal,
  Select,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import { listSuppliers, isOk as supIsOk, type Supplier } from "@/features/suppliers";
import {
  getIngredientManager,
  saveIngredientManager,
  type SaveIngredientManagerInput,
} from "@/features/inventory/ingredient-manager-actions";
import { isOk } from "@/features/inventory";
import {
  displayUnit,
  packUnitsFromIngredient,
  parsePackUnitsForm,
  resolveQtyToMaster,
  type IngredientPackConversion,
  type PackUnitsForm,
} from "@/lib/unit-conversion";
import {
  formatRupiahPrecise,
  parseIndonesianInt,
  parseIndonesianNumber,
} from "@/lib/format";
import { PackUnitsEditor } from "./PackUnitsEditor";

interface Props {
  open: boolean;
  ingredientId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface PriceRow {
  key: string;
  id: string | null;
  supplierId: string;
  buyUnit: string;
  buyQtyStr: string;
  unitCostStr: string;
  isPrimary: boolean;
  notes: string | null;
}

const SECTION_OPTIONS = [
  { value: "__none", label: "Belum diset" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting" },
  { value: "cleaning", label: "Cleaning" },
];
const BASE_UNIT_PRESETS = ["gr", "ml", "Pcs", "Kg", "L"];

let keyCounter = 0;
const newKey = () => `row-${keyCounter++}`;

/**
 * Sesi AE-175 — Modal TERPADU "Kelola Bahan". 3 bagian terlihat sekaligus,
 * tanpa nesting. Dipakai dari Inventory / Market List / Opname. Section C
 * (harga supplier) dropdown satuannya TERKUNCI ke satuan yang didefinisikan di
 * Section B; effective cost live. Simpan transaksional (saveIngredientManager).
 */
export function IngredientManagerModal({
  open,
  ingredientId,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("gr");
  const [section, setSection] = useState("__none");
  const [reorderStr, setReorderStr] = useState("");
  const [costPerUnit, setCostPerUnit] = useState(0);
  const [packForm, setPackForm] = useState<PackUnitsForm>({
    mainLabel: "",
    mainQtyStr: "",
    packRows: [],
  });
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    void (async () => {
      const supRes = await listSuppliers({ activeOnly: true });
      if (!cancelled && supIsOk(supRes)) setSuppliers(supRes.data);
      if (ingredientId) {
        const res = await getIngredientManager(ingredientId);
        if (cancelled) return;
        if (isOk(res) && res.data) {
          const d = res.data;
          setName(d.name);
          setUnit(d.unit);
          setSection(d.section ?? "__none");
          setReorderStr(d.reorderThreshold != null ? String(d.reorderThreshold) : "");
          setCostPerUnit(d.costPerUnit);
          setPackForm(
            packUnitsFromIngredient({
              unitBelanja: d.unitBelanja,
              unitBelanjaPerCogs: d.unitBelanjaPerCogs,
              packConversions: d.packConversions as IngredientPackConversion[],
            }),
          );
          setPrices(
            d.supplierPrices.map((p) => ({
              key: newKey(),
              id: p.id,
              supplierId: p.supplierId,
              buyUnit: p.buyUnit,
              buyQtyStr: String(p.buyQty),
              unitCostStr: String(p.unitCost),
              isPrimary: p.isPrimary,
              notes: p.notes,
            })),
          );
        }
      } else {
        setName("");
        setUnit("gr");
        setSection("__none");
        setReorderStr("");
        setCostPerUnit(0);
        setPackForm({ mainLabel: "", mainQtyStr: "", packRows: [] });
        setPrices([]);
      }
      if (!cancelled) setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [open, ingredientId]);

  /* Satuan terdefinisi (live dari Section B) untuk dropdown Section C. */
  const parsedUnits = useMemo(
    () => parsePackUnitsForm(packForm, unit.trim()),
    [packForm, unit],
  );
  const buyUnitOptions = useMemo(() => {
    const labels = [unit.trim()];
    if (parsedUnits.unitBelanja) labels.push(parsedUnits.unitBelanja);
    for (const p of parsedUnits.packConversions ?? []) labels.push(p.unitLabel);
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    for (const l of labels) {
      const lc = l.trim().toLowerCase();
      if (lc.length === 0 || seen.has(lc)) continue;
      seen.add(lc);
      opts.push({ value: l, label: displayUnit(l) });
    }
    return opts;
  }, [unit, parsedUnits]);

  const effectiveFor = (row: PriceRow): number | null => {
    const qty = parseIndonesianNumber(row.buyQtyStr);
    const cost = parseIndonesianInt(row.unitCostStr);
    if (!(qty > 0) || !(cost > 0)) return null;
    const r = resolveQtyToMaster({
      qty,
      fromUnit: row.buyUnit,
      masterUnit: unit.trim(),
      ingredientPacks: parsedUnits.packConversions,
      unitBelanja: parsedUnits.unitBelanja,
      unitBelanjaPerCogs: parsedUnits.unitBelanjaPerCogs,
    });
    if (!r.ok || !r.qtyMaster) return null;
    return Math.round((cost / r.qtyMaster) * 1000) / 1000;
  };

  const addPriceRow = () =>
    setPrices((prev) => [
      ...prev,
      {
        key: newKey(),
        id: null,
        supplierId: "",
        buyUnit: parsedUnits.unitBelanja ?? unit.trim(),
        buyQtyStr: "1",
        unitCostStr: "",
        isPrimary: prev.length === 0,
        notes: null,
      },
    ]);
  const updatePrice = (key: string, patch: Partial<PriceRow>) =>
    setPrices((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  const removePrice = (key: string) =>
    setPrices((prev) => prev.filter((r) => r.key !== key));
  const setPrimary = (key: string) =>
    setPrices((prev) => prev.map((r) => ({ ...r, isPrimary: r.key === key })));

  async function onSave() {
    if (saving) return;
    setError(null);
    if (name.trim().length === 0) return setError("Nama bahan wajib diisi.");
    if (unit.trim().length === 0) return setError("Satuan dasar wajib diisi.");
    if (parsedUnits.error) return setError(parsedUnits.error);

    /* Validasi harga supplier. */
    const supplierPrices: SaveIngredientManagerInput["supplierPrices"] = [];
    for (const r of prices) {
      if (!r.supplierId) return setError("Pilih supplier di tiap baris harga.");
      const qty = parseIndonesianNumber(r.buyQtyStr);
      const cost = parseIndonesianInt(r.unitCostStr);
      if (!(qty > 0)) return setError("Jumlah beli harus > 0.");
      if (!(cost > 0)) return setError("Harga beli harus > 0.");
      supplierPrices.push({
        id: r.id,
        supplierId: r.supplierId,
        buyUnit: r.buyUnit,
        buyQty: qty,
        unitCost: cost,
        isPrimary: r.isPrimary,
        notes: r.notes,
      });
    }

    setSaving(true);
    const res = await saveIngredientManager({
      id: ingredientId,
      name: name.trim(),
      unit: unit.trim(),
      section: section === "__none" ? null : (section as SaveIngredientManagerInput["section"]),
      reorderThreshold: reorderStr.trim() ? parseIndonesianInt(reorderStr) : null,
      unitBelanja: parsedUnits.unitBelanja,
      unitBelanjaPerCogs: parsedUnits.unitBelanjaPerCogs,
      packConversions: parsedUnits.packConversions,
      supplierPrices,
    });
    setSaving(false);
    if (!isOk(res)) return setError(res.error.message);
    toast.success(`Bahan ${name.trim()} tersimpan.`);
    onSaved();
  }

  const supplierGroups: ComboboxGroup[] = [
    {
      label: "",
      options: suppliers.map((s) => ({ value: s.id, label: s.name })),
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ingredientId ? "Kelola Bahan" : "Tambah Bahan"}
      description={
        name ? `Atur identitas, satuan & harga supplier "${name}"` : undefined
      }
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={onSave} loading={saving} disabled={loading}>
            Simpan Semua
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-neutral-500">Memuat…</p>
      ) : (
        <div className="space-y-5">
          {/* ── (A) Identitas ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Identitas
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Nama bahan"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. Chocolatos"
              />
              <Select
                label="Section"
                value={section}
                onValueChange={setSection}
                options={SECTION_OPTIONS}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Input
                  label="Satuan Dasar (dipakai barista di resep)"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="gr / ml / Pcs"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {BASE_UNIT_PRESETS.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnit(u)}
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                        displayUnit(unit).toLowerCase() === u.toLowerCase()
                          ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                label={`Stok Minimum (${unit || "satuan"}, opsional)`}
                value={reorderStr}
                onChange={(e) => setReorderStr(e.target.value)}
                inputMode="numeric"
                placeholder="kosongkan kalau tak mau alert"
              />
            </div>
            <p className="text-[11px] text-neutral-500">
              Cost saat ini:{" "}
              <span className="font-mono font-medium text-neutral-700">
                {formatRupiahPrecise(costPerUnit)}/{unit || "—"}
              </span>{" "}
              (otomatis dari harga supplier utama).
            </p>
          </section>

          {/* ── (B) Satuan Beli & Pack ─────────────────────────────────── */}
          <section className="rounded-lg border border-mahakan-green-700/20 bg-mahakan-green-50/40 p-3">
            <PackUnitsEditor
              baseUnit={unit}
              value={packForm}
              onChange={setPackForm}
              disabled={saving}
            />
          </section>

          {/* ── (C) Harga Supplier ─────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Harga Supplier
            </h3>
            <p className="text-[11px] text-neutral-600">
              Satuan beli terkunci ke satuan yang Anda definisikan di atas.
              Tandai ⭐ supplier utama (harga-nya jadi cost master + COGS).
            </p>
            {prices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-3 text-center text-[11px] text-neutral-500">
                Belum ada harga supplier.
              </div>
            ) : (
              <div className="space-y-2">
                {prices.map((row) => {
                  const eff = effectiveFor(row);
                  return (
                    <div
                      key={row.key}
                      className={`rounded-lg border bg-white p-2.5 ${
                        row.isPrimary
                          ? "border-mahakan-green-700/50 bg-mahakan-green-50/40"
                          : "border-neutral-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPrimary(row.key)}
                          aria-label="Jadikan supplier utama"
                          className={`mb-0.5 flex size-11 flex-none items-center justify-center rounded-md border transition-colors ${
                            row.isPrimary
                              ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                              : "border-neutral-200 text-neutral-400 hover:bg-neutral-50"
                          }`}
                          title={row.isPrimary ? "Supplier utama" : "Jadikan utama"}
                        >
                          <Star
                            className={`size-4 ${row.isPrimary ? "fill-current" : ""}`}
                          />
                        </button>
                        <div className="min-w-[150px] flex-1">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Supplier
                          </label>
                          <Combobox
                            value={row.supplierId || null}
                            onChange={(val) =>
                              updatePrice(row.key, { supplierId: val ?? "" })
                            }
                            placeholder="Pilih supplier…"
                            searchPlaceholder="Cari supplier…"
                            groups={supplierGroups}
                          />
                        </div>
                        <div className="w-20">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Jumlah
                          </label>
                          <Input
                            value={row.buyQtyStr}
                            onChange={(e) =>
                              updatePrice(row.key, {
                                buyQtyStr: e.target.value.replace(/[^\d.,]/g, ""),
                              })
                            }
                            inputMode="decimal"
                            className="text-right font-mono text-sm"
                          />
                        </div>
                        <div className="w-[110px]">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Satuan Beli
                          </label>
                          <Select
                            value={displayUnit(row.buyUnit)}
                            onValueChange={(val) =>
                              updatePrice(row.key, { buyUnit: val })
                            }
                            options={buyUnitOptions}
                          />
                        </div>
                        <div className="w-28">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Harga Total
                          </label>
                          <Input
                            value={row.unitCostStr}
                            onChange={(e) =>
                              updatePrice(row.key, {
                                unitCostStr: e.target.value.replace(/\D/g, ""),
                              })
                            }
                            inputMode="numeric"
                            placeholder="21000"
                            className="text-right font-mono text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removePrice(row.key)}
                          aria-label="Hapus harga"
                          className="mb-0.5 flex size-11 flex-none items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-colors hover:border-danger-500/40 hover:bg-danger-100/40 hover:text-danger-500"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      {eff != null ? (
                        <p className="mt-1.5 text-[11px] font-medium text-mahakan-green-700">
                          → {formatRupiahPrecise(eff)} / {unit || "—"}
                          {row.isPrimary ? " (jadi cost master)" : ""}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-warning-500">
                          Satuan beli belum bisa dikonversi ke {unit || "satuan dasar"}.
                          Tambahkan satuannya di bagian atas.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPriceRow}
              className="w-full justify-center"
            >
              <Plus className="size-4" /> Tambah Harga Supplier
            </Button>
          </section>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-danger-100/60 px-3 py-2 text-sm font-medium text-danger-500"
            >
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
