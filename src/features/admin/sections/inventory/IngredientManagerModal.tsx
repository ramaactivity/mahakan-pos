"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus, Star, Trash2 } from "lucide-react";
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
  CANONICAL_UNIT_PRESETS,
  displayUnit,
  resolveLadderToBase,
} from "@/lib/unit-conversion";
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

interface LadderRow {
  key: string;
  label: string; // satuan, mis. "renceng"
  qtyStr: string; // 1 label = qty refUnit
  refUnit: string; // "__base" atau label satuan lain
}
interface PriceRow {
  key: string;
  id: string | null;
  supplierId: string;
  buyUnit: string;
  unitCostStr: string;
  isPrimary: boolean;
}

const SECTION_OPTIONS = [
  { value: "__none", label: "Belum diset" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting" },
  { value: "cleaning", label: "Cleaning" },
];
const BASE_UNIT_OPTIONS = ["gr", "ml", "Pcs", "Kg", "L", "Btl"].map((u) => ({
  value: u,
  label: u,
}));
const UNIT_NAME_OPTIONS = CANONICAL_UNIT_PRESETS.map((u) => ({ value: u, label: u }));

let keyCounter = 0;
const newKey = () => `row-${keyCounter++}`;

/**
 * Sesi AE-175c — Modal "Kelola Bahan" dengan TANGGA KONVERSI bertingkat.
 * Semua satuan dipilih dari dropdown (anti typo). Konversi turun bertingkat
 * sampai satuan dasar: 1 renceng = 10 sachet ; 1 sachet = 28 gr → 280 gr.
 * Harga supplier MEMILIH satuan beli dari tangga. No nesting.
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
  const [ladder, setLadder] = useState<LadderRow[]>([]);
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
          setLadder(
            d.units.map((u) => ({
              key: newKey(),
              label: u.label,
              qtyStr: String(u.qtyPerRef),
              refUnit: u.refUnitLabel ?? "__base",
            })),
          );
          setPrices(
            d.supplierPrices.map((p) => ({
              key: newKey(),
              id: p.id,
              supplierId: p.supplierId,
              buyUnit: p.buyUnit,
              unitCostStr: String(p.unitCost),
              isPrimary: p.isPrimary,
            })),
          );
        }
      } else {
        setName("");
        setUnit("gr");
        setSection("__none");
        setReorderStr("");
        setCostPerUnit(0);
        setLadder([]);
        setPrices([]);
      }
      if (!cancelled) setLoading(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [open, ingredientId]);

  const baseLc = unit.trim().toLowerCase();

  /* Resolve tangga → qtyPerBase per satuan (untuk effective + display). */
  const resolved = useMemo(() => {
    try {
      return resolveLadderToBase(
        ladder
          .filter((r) => r.label.trim())
          .map((r) => ({
            label: r.label.trim(),
            qtyPerRef: parseIndonesianNumber(r.qtyStr),
            refUnitLabel: r.refUnit === "__base" ? null : r.refUnit,
          })),
        unit.trim(),
      );
    } catch {
      return null;
    }
  }, [ladder, unit]);

  const ladderLabels = ladder.map((r) => r.label.trim()).filter(Boolean);
  const buyUnitOptions = [
    { value: unit.trim(), label: `${displayUnit(unit)} (satuan dasar)` },
    ...ladderLabels.map((l) => ({ value: l, label: l })),
  ];

  const effectiveFor = (row: PriceRow): number | null => {
    const cost = parseIndonesianInt(row.unitCostStr);
    if (!(cost > 0)) return null;
    const lc = row.buyUnit.trim().toLowerCase();
    const conv = lc === baseLc ? 1 : (resolved?.get(lc) ?? null);
    if (!conv || conv <= 0) return null;
    return Math.round((cost / conv) * 1000) / 1000;
  };

  // ── ladder ops ──
  const addLadder = () =>
    setLadder((p) => [
      ...p,
      { key: newKey(), label: "", qtyStr: "", refUnit: "__base" },
    ]);
  const updLadder = (key: string, patch: Partial<LadderRow>) =>
    setLadder((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rmLadder = (key: string) =>
    setLadder((p) => p.filter((r) => r.key !== key));

  // ── price ops ──
  const addPrice = () =>
    setPrices((p) => [
      ...p,
      {
        key: newKey(),
        id: null,
        supplierId: "",
        buyUnit: ladderLabels[0] ?? unit.trim(),
        unitCostStr: "",
        isPrimary: p.length === 0,
      },
    ]);
  const updPrice = (key: string, patch: Partial<PriceRow>) =>
    setPrices((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rmPrice = (key: string) => setPrices((p) => p.filter((r) => r.key !== key));
  const setPrimary = (key: string) =>
    setPrices((p) => p.map((r) => ({ ...r, isPrimary: r.key === key })));

  async function onSave() {
    if (saving) return;
    setError(null);
    if (name.trim().length === 0) return setError("Nama bahan wajib diisi.");
    if (unit.trim().length === 0) return setError("Satuan dasar wajib diisi.");

    const units: SaveIngredientManagerInput["units"] = [];
    for (const r of ladder) {
      if (r.label.trim().length === 0) continue;
      const qty = parseIndonesianNumber(r.qtyStr);
      const refLabel = r.refUnit === "__base" ? unit.trim() : r.refUnit;
      if (!(qty > 0))
        return setError(`Isi konversi: 1 ${r.label} = berapa ${refLabel}?`);
      units.push({
        label: r.label.trim(),
        qtyPerRef: qty,
        refUnitLabel: r.refUnit === "__base" ? null : r.refUnit,
      });
    }
    /* Validasi rantai bisa di-resolve (ref ada, tak melingkar). */
    try {
      resolveLadderToBase(units, unit.trim());
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Rantai konversi invalid.");
    }

    const supplierPrices: SaveIngredientManagerInput["supplierPrices"] = [];
    let primaryCount = 0;
    for (const r of prices) {
      if (!r.supplierId) return setError("Pilih supplier di tiap baris harga.");
      const cost = parseIndonesianInt(r.unitCostStr);
      if (!(cost > 0)) return setError("Harga harus angka > 0.");
      if (r.isPrimary) primaryCount++;
      supplierPrices.push({
        id: r.id,
        supplierId: r.supplierId,
        buyUnit: r.buyUnit.trim() || unit.trim(),
        unitCost: cost,
        isPrimary: r.isPrimary,
        notes: null,
      });
    }
    if (primaryCount > 1) return setError("Hanya boleh 1 supplier utama.");

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
      units,
      supplierPrices,
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
              <Select
                label="Satuan Dasar (yang dipakai barista di resep)"
                value={displayUnit(unit)}
                onValueChange={setUnit}
                options={BASE_UNIT_OPTIONS}
              />
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

          {/* ── (B) Tangga Satuan & Konversi ───────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Satuan & Konversi
            </h3>
            <p className="text-[11px] text-neutral-600">
              Konversi bertingkat sampai satuan dasar. Mis. 1 renceng = 10 sachet,
              lalu 1 sachet = 28 {unit || "gr"} → sistem hitung 1 renceng = 280{" "}
              {unit || "gr"}.
            </p>
            {ladder.length > 0 && (
              <div className="space-y-2">
                {ladder.map((row) => {
                  const lc = row.label.trim().toLowerCase();
                  const qpb = lc ? resolved?.get(lc) : null;
                  const refOptions = [
                    { value: "__base", label: `${displayUnit(unit)} (satuan dasar)` },
                    ...ladderLabels
                      .filter((l) => l.toLowerCase() !== lc)
                      .map((l) => ({ value: l, label: l })),
                  ];
                  return (
                    <div
                      key={row.key}
                      className="rounded-lg border border-neutral-200 bg-white p-2.5"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <span className="pb-2.5 font-mono text-sm font-semibold text-neutral-500">
                          1
                        </span>
                        <div className="w-32">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Satuan
                          </label>
                          <Select
                            value={row.label ? displayUnit(row.label) : ""}
                            onValueChange={(val) => updLadder(row.key, { label: val })}
                            options={UNIT_NAME_OPTIONS}
                            placeholder="pilih…"
                          />
                        </div>
                        <span className="pb-2.5 text-sm font-semibold text-neutral-400">=</span>
                        <div className="w-20">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Jumlah
                          </label>
                          <Input
                            value={row.qtyStr}
                            onChange={(e) =>
                              updLadder(row.key, {
                                qtyStr: e.target.value.replace(/[^\d.,]/g, ""),
                              })
                            }
                            inputMode="decimal"
                            placeholder="10"
                            className="text-right font-mono text-sm"
                          />
                        </div>
                        <div className="w-32">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Satuan tujuan
                          </label>
                          <Select
                            value={
                              row.refUnit === "__base"
                                ? `${displayUnit(unit)} (satuan dasar)`
                                : row.refUnit
                            }
                            onValueChange={(val) => updLadder(row.key, { refUnit: val })}
                            options={refOptions}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => rmLadder(row.key)}
                          aria-label="Hapus satuan"
                          className="mb-0.5 flex size-11 flex-none items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-colors hover:border-danger-500/40 hover:bg-danger-100/40 hover:text-danger-500"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      {qpb && qpb > 0 ? (
                        <p className="mt-1.5 text-[11px] font-medium text-mahakan-green-700">
                          ✓ 1 {row.label.trim()} = {qpb.toLocaleString("id-ID")} {unit}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-neutral-400">
                          Pilih satuan, jumlah & satuan tujuan.
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
              onClick={addLadder}
              className="w-full justify-center"
            >
              <Plus className="size-4" /> Tambah Satuan
            </Button>
          </section>

          {/* ── (C) Harga Supplier ─────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Harga Supplier
            </h3>
            <p className="text-[11px] text-neutral-600">
              Beli dari supplier mana, dalam satuan apa (pilih dari tangga di atas),
              harga per satuan itu. Tandai ⭐ supplier utama (jadi cost master + COGS).
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
                          <Star className={`size-4 ${row.isPrimary ? "fill-current" : ""}`} />
                        </button>
                        <div className="min-w-[140px] flex-1">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Supplier
                          </label>
                          <Combobox
                            value={row.supplierId || null}
                            onChange={(val) => updPrice(row.key, { supplierId: val ?? "" })}
                            placeholder="Pilih supplier…"
                            searchPlaceholder="Cari supplier…"
                            groups={supplierGroups}
                          />
                        </div>
                        <div className="w-32">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Beli per
                          </label>
                          <Select
                            value={displayUnit(row.buyUnit)}
                            onValueChange={(val) => updPrice(row.key, { buyUnit: val })}
                            options={buyUnitOptions}
                          />
                        </div>
                        <div className="w-28">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Harga / satuan
                          </label>
                          <Input
                            value={row.unitCostStr}
                            onChange={(e) =>
                              updPrice(row.key, {
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
                          onClick={() => rmPrice(row.key)}
                          aria-label="Hapus harga"
                          className="mb-0.5 flex size-11 flex-none items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-colors hover:border-danger-500/40 hover:bg-danger-100/40 hover:text-danger-500"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      {eff != null ? (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-mahakan-green-700">
                          <ArrowRight className="size-3" /> {formatRupiahPrecise(eff)} /{" "}
                          {unit || "—"}
                          {row.isPrimary ? " (jadi cost master)" : ""}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-warning-500">
                          Lengkapi satuan beli & harga (pastikan satuannya ada di tangga).
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
