"use client";

import { useEffect, useState } from "react";
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
import { displayUnit } from "@/lib/unit-conversion";
import {
  formatRupiahPrecise,
  parseIndonesianInt,
  parseIndonesianNumber,
} from "@/lib/format";

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
  buyUnitPerBaseStr: string;
  unitCostStr: string;
  isPrimary: boolean;
  notes: string | null;
}
interface ExtraRow {
  key: string;
  label: string;
  qtyStr: string;
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
 * Sesi AE-175b — Modal TERPADU "Kelola Bahan". Disederhanakan: konversi satuan
 * didefinisikan INLINE di baris harga supplier (tidak lagi terpisah). 3 bagian:
 * Identitas + Harga Supplier (supplier + "1 [satuan] = [konv] [dasar]" + harga +
 * effective live) + Satuan lain untuk opname (opsional). No nesting.
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
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [extras, setExtras] = useState<ExtraRow[]>([]);
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
          setPrices(
            d.supplierPrices.map((p) => ({
              key: newKey(),
              id: p.id,
              supplierId: p.supplierId,
              buyUnit: p.buyUnit,
              buyUnitPerBaseStr: p.buyUnitPerBase != null ? String(p.buyUnitPerBase) : "",
              unitCostStr: String(p.unitCost),
              isPrimary: p.isPrimary,
              notes: p.notes,
            })),
          );
          setExtras(
            d.extraUnits.map((u) => ({
              key: newKey(),
              label: u.label,
              qtyStr: String(u.qtyPerBase),
            })),
          );
        }
      } else {
        setName("");
        setUnit("gr");
        setSection("__none");
        setReorderStr("");
        setCostPerUnit(0);
        setPrices([]);
        setExtras([]);
      }
      if (!cancelled) setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [open, ingredientId]);

  const baseLc = unit.trim().toLowerCase();
  const isBaseUnit = (u: string) => u.trim().toLowerCase() === baseLc;

  const effectiveFor = (row: PriceRow): number | null => {
    const cost = parseIndonesianInt(row.unitCostStr);
    if (!(cost > 0)) return null;
    const conv = isBaseUnit(row.buyUnit)
      ? 1
      : parseIndonesianNumber(row.buyUnitPerBaseStr);
    if (!(conv > 0)) return null;
    return Math.round((cost / conv) * 1000) / 1000;
  };

  const addPrice = () =>
    setPrices((prev) => [
      ...prev,
      {
        key: newKey(),
        id: null,
        supplierId: "",
        buyUnit: unit.trim(),
        buyUnitPerBaseStr: "",
        unitCostStr: "",
        isPrimary: prev.length === 0,
        notes: null,
      },
    ]);
  const updatePrice = (key: string, patch: Partial<PriceRow>) =>
    setPrices((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removePrice = (key: string) =>
    setPrices((prev) => prev.filter((r) => r.key !== key));
  const setPrimary = (key: string) =>
    setPrices((prev) => prev.map((r) => ({ ...r, isPrimary: r.key === key })));

  const addExtra = () =>
    setExtras((prev) => [...prev, { key: newKey(), label: "", qtyStr: "" }]);
  const updateExtra = (key: string, patch: Partial<ExtraRow>) =>
    setExtras((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeExtra = (key: string) =>
    setExtras((prev) => prev.filter((r) => r.key !== key));

  async function onSave() {
    if (saving) return;
    setError(null);
    if (name.trim().length === 0) return setError("Nama bahan wajib diisi.");
    if (unit.trim().length === 0) return setError("Satuan dasar wajib diisi.");

    const supplierPrices: SaveIngredientManagerInput["supplierPrices"] = [];
    let primaryCount = 0;
    for (const r of prices) {
      if (!r.supplierId) return setError("Pilih supplier di tiap baris harga.");
      const cost = parseIndonesianInt(r.unitCostStr);
      if (!(cost > 0)) return setError("Harga harus angka > 0.");
      const base = isBaseUnit(r.buyUnit);
      const perBase = base ? null : parseIndonesianNumber(r.buyUnitPerBaseStr);
      if (!base && !(perBase! > 0)) {
        return setError(
          `Isi konversi: 1 ${r.buyUnit.trim()} = berapa ${unit.trim()}?`,
        );
      }
      if (r.isPrimary) primaryCount++;
      supplierPrices.push({
        id: r.id,
        supplierId: r.supplierId,
        buyUnit: r.buyUnit.trim() || unit.trim(),
        buyUnitPerBase: base ? null : perBase!,
        unitCost: cost,
        isPrimary: r.isPrimary,
        notes: r.notes,
      });
    }
    if (primaryCount > 1) return setError("Hanya boleh 1 supplier utama.");

    const extraUnits: SaveIngredientManagerInput["extraUnits"] = [];
    for (const e of extras) {
      if (e.label.trim().length === 0 && e.qtyStr.trim().length === 0) continue;
      const qty = parseIndonesianNumber(e.qtyStr);
      if (!(qty > 0)) return setError(`Isi jumlah untuk satuan "${e.label}".`);
      extraUnits.push({ label: e.label.trim(), qtyPerBase: qty });
    }

    setSaving(true);
    const res = await saveIngredientManager({
      id: ingredientId,
      name: name.trim(),
      unit: unit.trim(),
      section:
        section === "__none"
          ? null
          : (section as SaveIngredientManagerInput["section"]),
      reorderThreshold: reorderStr.trim() ? parseIndonesianInt(reorderStr) : null,
      supplierPrices,
      extraUnits,
    });
    setSaving(false);
    if (!isOk(res)) return setError(res.error.message);
    toast.success(`Bahan ${name.trim()} tersimpan.`);
    onSaved();
  }

  const supplierGroups: ComboboxGroup[] = [
    { label: "", options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ingredientId ? "Kelola Bahan" : "Tambah Bahan"}
      description={name ? `"${name}" — identitas, satuan & harga supplier` : undefined}
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

          {/* ── (B) Harga Supplier (konversi inline) ───────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Harga Supplier
            </h3>
            <p className="text-[11px] text-neutral-600">
              Cara beli + harga per satuan. Tulis satuan belinya (mis. renceng) +
              berapa {unit || "satuan dasar"} isinya. Tandai ⭐ supplier utama
              (harga-nya jadi cost master + COGS).
            </p>
            {prices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-3 text-center text-[11px] text-neutral-500">
                Belum ada harga supplier.
              </div>
            ) : (
              <div className="space-y-2">
                {prices.map((row) => {
                  const eff = effectiveFor(row);
                  const base = isBaseUnit(row.buyUnit);
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
                          <Star className={`size-4 ${row.isPrimary ? "fill-current" : ""}`} />
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
                        <div className="w-28">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Harga / satuan
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
                      {/* baris konversi: 1 [satuan beli] = [konv] [dasar] */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono font-semibold text-neutral-500">1</span>
                        <Input
                          value={row.buyUnit}
                          onChange={(e) =>
                            updatePrice(row.key, { buyUnit: e.target.value })
                          }
                          maxLength={20}
                          placeholder="renceng / Kg / botol"
                          className="w-40 text-sm"
                        />
                        {base ? (
                          <span className="text-[11px] text-neutral-500">
                            (= satuan dasar, 1:1)
                          </span>
                        ) : (
                          <>
                            <span className="font-semibold text-neutral-400">=</span>
                            <Input
                              value={row.buyUnitPerBaseStr}
                              onChange={(e) =>
                                updatePrice(row.key, {
                                  buyUnitPerBaseStr: e.target.value.replace(/[^\d.,]/g, ""),
                                })
                              }
                              inputMode="decimal"
                              placeholder="280"
                              className="w-24 text-right font-mono text-sm"
                            />
                            <span className="text-sm font-medium text-neutral-700">
                              {unit || "satuan dasar"}
                            </span>
                          </>
                        )}
                      </div>
                      {eff != null ? (
                        <p className="mt-1.5 text-[11px] font-medium text-mahakan-green-700">
                          → {formatRupiahPrecise(eff)} / {unit || "—"}
                          {row.isPrimary ? " (jadi cost master)" : ""}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-warning-500">
                          Lengkapi satuan, konversi & harga.
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
              onClick={addPrice}
              className="w-full justify-center"
            >
              <Plus className="size-4" /> Tambah Harga Supplier
            </Button>
          </section>

          {/* ── (C) Satuan lain untuk opname/resep ─────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Satuan Lain untuk Opname{" "}
              <span className="font-normal normal-case text-neutral-400">
                (opsional)
              </span>
            </h3>
            <p className="text-[11px] text-neutral-600">
              Satuan yang dipakai saat hitung stok tapi tak ada harga supplier
              (mis. 1 sachet = 28 {unit || "gr"}).
            </p>
            {extras.length > 0 && (
              <div className="space-y-2">
                {extras.map((row) => {
                  const qty = parseIndonesianNumber(row.qtyStr);
                  return (
                    <div
                      key={row.key}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2.5 text-sm"
                    >
                      <span className="font-mono font-semibold text-neutral-500">1</span>
                      <Input
                        value={row.label}
                        onChange={(e) => updateExtra(row.key, { label: e.target.value })}
                        maxLength={20}
                        placeholder="sachet"
                        className="w-40 text-sm"
                      />
                      <span className="font-semibold text-neutral-400">=</span>
                      <Input
                        value={row.qtyStr}
                        onChange={(e) =>
                          updateExtra(row.key, {
                            qtyStr: e.target.value.replace(/[^\d.,]/g, ""),
                          })
                        }
                        inputMode="decimal"
                        placeholder="28"
                        className="w-24 text-right font-mono text-sm"
                      />
                      <span className="text-sm font-medium text-neutral-700">
                        {unit || "satuan dasar"}
                      </span>
                      {qty > 0 ? (
                        <span className="text-[11px] text-mahakan-green-700">
                          ✓ 1 {row.label.trim()} = {qty.toLocaleString("id-ID")} {unit}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeExtra(row.key)}
                        aria-label="Hapus satuan"
                        className="ml-auto flex size-9 flex-none items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-colors hover:border-danger-500/40 hover:bg-danger-100/40 hover:text-danger-500"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addExtra}
              className="w-full justify-center"
            >
              <Plus className="size-4" /> Tambah Satuan Opname
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
