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
  label: string;
  qtyStr: string;
  refUnit: string; // label satuan tujuan (default = satuan dasar)
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

let keyCounter = 0;
const newKey = () => `row-${keyCounter++}`;

/**
 * Sesi AE-175d — Modal "Kelola Bahan" = MASTER DATA satuan & harga bahan.
 * Urutan: Identitas → Harga Supplier → Tangga Satuan & Konversi.
 * "Beli per" otomatis menambah satuan ke tangga. Tangga turun bertingkat
 * sampai satuan dasar. Semua satuan dari dropdown (anti typo).
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
  const [reorderUnit, setReorderUnit] = useState("gr");
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
          const baseU = d.unit;
          setName(d.name);
          setUnit(baseU);
          setSection(d.section ?? "__none");
          setCostPerUnit(d.costPerUnit);
          setLadder(
            d.units.map((u) => ({
              key: newKey(),
              label: u.label,
              qtyStr: String(u.qtyPerRef),
              refUnit: u.refUnitLabel ?? baseU,
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
          /* Stok min ditampilkan dalam satuan beli utama (atau dasar). */
          const primary = d.supplierPrices.find((p) => p.isPrimary);
          const ru = primary?.buyUnit ?? baseU;
          const conv =
            ru.toLowerCase() === baseU.toLowerCase()
              ? 1
              : (d.units.find((u) => u.label.toLowerCase() === ru.toLowerCase())
                  ?.qtyPerBase ?? 1);
          setReorderUnit(ru);
          setReorderStr(
            d.reorderThreshold != null
              ? String(Math.round((d.reorderThreshold / conv) * 100) / 100)
              : "",
          );
        }
      } else {
        setName("");
        setUnit("gr");
        setSection("__none");
        setReorderStr("");
        setReorderUnit("gr");
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

  const resolved = useMemo(() => {
    try {
      return resolveLadderToBase(
        ladder
          .filter((r) => r.label.trim())
          .map((r) => ({
            label: r.label.trim(),
            qtyPerRef: parseIndonesianNumber(r.qtyStr),
            refUnitLabel:
              r.refUnit.trim().toLowerCase() === unit.trim().toLowerCase()
                ? null
                : r.refUnit,
          })),
        unit.trim(),
      );
    } catch {
      return null;
    }
  }, [ladder, unit]);

  const convOf = (label: string): number | null => {
    const lc = label.trim().toLowerCase();
    if (lc === baseLc) return 1;
    return resolved?.get(lc) ?? null;
  };

  const ladderLabels = ladder.map((r) => r.label.trim()).filter(Boolean);

  /* "Beli per" boleh pilih satuan dari tangga ATAU preset baru (yg lalu
   *  otomatis ditambah ke tangga). Satuan dasar selalu opsi. */
  const buyUnitOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: Array<{ value: string; label: string }> = [];
    const push = (val: string, lab: string) => {
      const lc = val.trim().toLowerCase();
      if (!val.trim() || seen.has(lc)) return;
      seen.add(lc);
      opts.push({ value: val, label: lab });
    };
    push(unit.trim(), displayUnit(unit));
    for (const l of ladderLabels) push(l, l);
    for (const p of CANONICAL_UNIT_PRESETS) push(p, p);
    return opts;
  }, [unit, ladderLabels]);

  const reorderUnitOptions = useMemo(() => {
    const opts = [{ value: unit.trim(), label: displayUnit(unit) }];
    for (const l of ladderLabels) opts.push({ value: l, label: l });
    return opts;
  }, [unit, ladderLabels]);

  /* Pastikan satuan ada di tangga (auto-add tier-1 saat dipilih di Beli per). */
  const ensureLadderUnit = (label: string) => {
    const lc = label.trim().toLowerCase();
    if (!lc || lc === baseLc) return;
    setLadder((prev) => {
      if (prev.some((r) => r.label.trim().toLowerCase() === lc)) return prev;
      return [
        { key: newKey(), label: label.trim(), qtyStr: "", refUnit: unit.trim() },
        ...prev,
      ];
    });
  };

  const effectiveFor = (row: PriceRow): number | null => {
    const cost = parseIndonesianInt(row.unitCostStr);
    if (!(cost > 0)) return null;
    const conv = convOf(row.buyUnit);
    if (!conv || conv <= 0) return null;
    return Math.round((cost / conv) * 1000) / 1000;
  };

  // ── ladder ops ──
  const addLadder = () =>
    setLadder((p) => [...p, { key: newKey(), label: "", qtyStr: "", refUnit: unit.trim() }]);
  const updLadder = (key: string, patch: Partial<LadderRow>) =>
    setLadder((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rmLadder = (key: string) => setLadder((p) => p.filter((r) => r.key !== key));

  // ── price ops ──
  const addPrice = () =>
    setPrices((p) => [
      ...p,
      {
        key: newKey(),
        id: null,
        supplierId: "",
        buyUnit: "",
        unitCostStr: "",
        isPrimary: p.length === 0,
      },
    ]);
  const updPrice = (key: string, patch: Partial<PriceRow>) =>
    setPrices((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rmPrice = (key: string) => setPrices((p) => p.filter((r) => r.key !== key));
  const setPrimary = (key: string) =>
    setPrices((p) => p.map((r) => ({ ...r, isPrimary: r.key === key })));

  const onReorderUnitChange = (next: string) => {
    const oldC = convOf(reorderUnit) ?? 1;
    const newC = convOf(next) ?? 1;
    const cur = parseIndonesianNumber(reorderStr);
    if (cur > 0 && oldC > 0 && newC > 0) {
      setReorderStr(String(Math.round(((cur * oldC) / newC) * 100) / 100));
    }
    setReorderUnit(next);
  };

  async function onSave() {
    if (saving) return;
    setError(null);
    if (name.trim().length === 0) return setError("Nama bahan wajib diisi.");
    if (unit.trim().length === 0) return setError("Satuan dasar wajib diisi.");

    const units: SaveIngredientManagerInput["units"] = [];
    for (const r of ladder) {
      if (r.label.trim().length === 0) continue;
      const qty = parseIndonesianNumber(r.qtyStr);
      const refLabel = r.refUnit.trim() || unit.trim();
      if (!(qty > 0)) return setError(`Isi konversi: 1 ${r.label} = berapa ${refLabel}?`);
      units.push({
        label: r.label.trim(),
        qtyPerRef: qty,
        refUnitLabel:
          r.refUnit.trim().toLowerCase() === unit.trim().toLowerCase()
            ? null
            : r.refUnit,
      });
    }
    try {
      resolveLadderToBase(units, unit.trim());
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Rantai konversi invalid.");
    }

    const supplierPrices: SaveIngredientManagerInput["supplierPrices"] = [];
    let primaryCount = 0;
    for (const r of prices) {
      if (!r.supplierId) return setError("Pilih supplier di tiap baris harga.");
      if (!r.buyUnit.trim()) return setError("Pilih satuan beli di tiap baris harga.");
      const cost = parseIndonesianInt(r.unitCostStr);
      if (!(cost > 0)) return setError("Harga harus angka > 0.");
      if (r.isPrimary) primaryCount++;
      supplierPrices.push({
        id: r.id,
        supplierId: r.supplierId,
        buyUnit: r.buyUnit.trim(),
        unitCost: cost,
        isPrimary: r.isPrimary,
        notes: null,
      });
    }
    if (primaryCount > 1) return setError("Hanya boleh 1 supplier utama.");

    /* Stok min: konversi dari satuan tampilan → satuan dasar. */
    let reorderBase: number | null = null;
    if (reorderStr.trim()) {
      const val = parseIndonesianNumber(reorderStr);
      const conv = convOf(reorderUnit) ?? 1;
      reorderBase = Math.round(val * conv);
    }

    setSaving(true);
    const res = await saveIngredientManager({
      id: ingredientId,
      name: name.trim(),
      unit: unit.trim(),
      section:
        section === "__none" ? null : (section as SaveIngredientManagerInput["section"]),
      reorderThreshold: reorderBase,
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
                label="Satuan Dasar (yang dipakai di resep)"
                value={displayUnit(unit)}
                onValueChange={setUnit}
                options={BASE_UNIT_OPTIONS}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Stok Minimum (opsional)
                </label>
                <div className="flex items-stretch gap-2">
                  <Input
                    value={reorderStr}
                    onChange={(e) => setReorderStr(e.target.value)}
                    inputMode="decimal"
                    placeholder="kosongkan kalau tak mau alert"
                    className="flex-1"
                  />
                  <div className="w-32">
                    <Select
                      value={displayUnit(reorderUnit)}
                      onValueChange={onReorderUnitChange}
                      options={reorderUnitOptions}
                    />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-neutral-500">
              Cost saat ini:{" "}
              <span className="font-mono font-medium text-neutral-700">
                {formatRupiahPrecise(costPerUnit)}/{unit || "—"}
              </span>{" "}
              (otomatis dari harga supplier utama).
            </p>
          </section>

          {/* ── (B) Harga Supplier ─────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Harga Supplier
            </h3>
            <p className="text-[11px] text-neutral-600">
              Beli dari supplier mana, dalam satuan apa, harga per satuan itu.
              Satuan beli otomatis masuk ke tangga konversi di bawah. Tandai ⭐
              supplier utama (jadi cost master + COGS).
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
                        <div className="min-w-[150px] flex-1">
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
                            value={row.buyUnit ? displayUnit(row.buyUnit) : ""}
                            onValueChange={(val) => {
                              updPrice(row.key, { buyUnit: val });
                              ensureLadderUnit(val);
                            }}
                            options={buyUnitOptions}
                            placeholder="pilih…"
                          />
                        </div>
                        <div className="w-28">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Harga / satuan
                          </label>
                          <Input
                            value={row.unitCostStr}
                            onChange={(e) =>
                              updPrice(row.key, { unitCostStr: e.target.value.replace(/\D/g, "") })
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
                          Lengkapi satuan beli & harga, lalu isi konversinya di tangga.
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

          {/* ── (C) Tangga Satuan & Konversi ───────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
              Satuan & Konversi
            </h3>
            <p className="text-[11px] text-neutral-600">
              Turunkan tiap satuan beli sampai ke satuan dasar ({unit || "gr"}).
              Mis. 1 renceng = 10 sachet, lalu 1 sachet = 28 {unit || "gr"} →
              sistem hitung 1 renceng = 280 {unit || "gr"}.
            </p>
            {ladder.length > 0 && (
              <div className="space-y-2">
                {ladder.map((row) => {
                  const lc = row.label.trim().toLowerCase();
                  const qpb = lc ? resolved?.get(lc) : null;
                  const refOptions = [
                    { value: unit.trim(), label: displayUnit(unit) },
                    ...ladderLabels
                      .filter((l) => l.toLowerCase() !== lc)
                      .map((l) => ({ value: l, label: l })),
                  ];
                  return (
                    <div key={row.key} className="rounded-lg border border-neutral-200 bg-white p-2.5">
                      <div className="flex flex-wrap items-end gap-2">
                        <span className="pb-2.5 font-mono text-sm font-semibold text-neutral-500">1</span>
                        <div className="w-32">
                          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                            Satuan
                          </label>
                          <Select
                            value={row.label ? displayUnit(row.label) : ""}
                            onValueChange={(val) => updLadder(row.key, { label: val })}
                            options={buyUnitOptions.filter((o) => o.value.toLowerCase() !== baseLc)}
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
                              updLadder(row.key, { qtyStr: e.target.value.replace(/[^\d.,]/g, "") })
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
                            value={displayUnit(row.refUnit || unit)}
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
                          Pilih jumlah & satuan tujuan — tingkat terakhir mengarah ke {unit}.
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
