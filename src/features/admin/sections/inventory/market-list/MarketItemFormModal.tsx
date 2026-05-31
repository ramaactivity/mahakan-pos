"use client";

import { useEffect, useMemo, useState } from "react";
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
  createMarketItem,
  isOk,
  type MarketListItem,
  updateMarketItem,
} from "@/features/market-list";
import {
  listAtomicIngredients,
  isOk as invIsOk,
  type Ingredient,
} from "@/features/inventory";
import {
  listSuppliers,
  isOk as supIsOk,
  type Supplier,
} from "@/features/suppliers";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  compatibleUnitsFor,
  displayUnit,
  resolveUnit,
} from "@/lib/unit-conversion";
import {
  formatRupiahPrecise,
  parseIndonesianInt,
  parseIndonesianNumber,
} from "@/lib/format";

/* Sesi AE-173 — pack unit preset diganti CANONICAL_UNIT_PRESETS (1 sumber
 * lintas modul, lihat unit-conversion.ts). */

interface Props {
  open: boolean;
  /** null = create mode; else edit existing. */
  target: MarketListItem | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Sesi AE-27 — pakai Combobox (search-able) + Select (styled) konsisten
 * dengan modul lain (Catat Pembelian, dll). Sebelumnya pakai native
 * <select> bawaan browser yang berbeda style + mobile UX kurang oke.
 */
export function MarketItemFormModal({
  open,
  target,
  onClose,
  onSaved,
}: Props) {
  const [supplierId, setSupplierId] = useState<string>("");
  const [ingredientId, setIngredientId] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [packSize, setPackSize] = useState<string>("");
  const [packUnit, setPackUnit] = useState<string>("");
  const [isPrimary, setIsPrimary] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingMaster(true);
    void (async () => {
      const [supRes, ingRes] = await Promise.all([
        listSuppliers({ activeOnly: true }),
        listAtomicIngredients({ activeOnly: true }),
      ]);
      if (cancelled) return;
      if (supIsOk(supRes)) setSuppliers(supRes.data);
      if (invIsOk(ingRes)) setIngredients(ingRes.data.items);
      setLoadingMaster(false);
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (target) {
      setSupplierId(target.supplierId);
      setIngredientId(target.ingredientId);
      setUnitCost(String(target.unitCost));
      setPackSize(String(target.packSize));
      setPackUnit(target.packUnit);
      setIsPrimary(target.isPrimary);
      setNotes(target.notes ?? "");
    } else {
      setSupplierId("");
      setIngredientId("");
      setUnitCost("");
      setPackSize("");
      setPackUnit("");
      setIsPrimary(false);
      setNotes("");
    }
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, target]);

  const selectedIngredient = useMemo(
    () => ingredients.find((i) => i.id === ingredientId) ?? null,
    [ingredients, ingredientId],
  );

  /** Pack unit options — kalau ingredient dipilih, batasi ke unit
   *  yang compatible dengan master unit (mass / volume / count). */
  /* Sesi AE-173 — dropdown pack unit KANONIK + anti-blank (1 sumber lintas
   * modul). Untuk bahan continuous, batasi ke satuan se-dimensi (compat);
   * untuk discrete, tawarkan semua preset. Nilai terpilih dijamin selalu ada. */
  const packUnitOptions = useMemo(() => {
    if (!selectedIngredient)
      return buildUnitSelectOptions({
        presets: CANONICAL_UNIT_PRESETS,
        current: packUnit,
      }).options;
    const meta = resolveUnit(selectedIngredient.unit);
    const presets =
      !meta || meta.dimension === "discrete"
        ? CANONICAL_UNIT_PRESETS
        : compatibleUnitsFor(selectedIngredient.unit).map((o) => o.value);
    return buildUnitSelectOptions({
      presets,
      packLabels: [selectedIngredient.unit],
      current: packUnit,
    }).options;
  }, [selectedIngredient, packUnit]);

  // Auto-set pack unit ke master unit (kanonik) kalau belum dipilih.
  useEffect(() => {
    if (!open) return;
    if (!packUnit && selectedIngredient) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPackUnit(displayUnit(selectedIngredient.unit));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, selectedIngredient, packUnit]);

  // Effective cost preview (Rp per ingredient.unit).
  const effectiveCost = useMemo(() => {
    if (!selectedIngredient) return null;
    // Sesi AE-30 — pakai parser Indonesian-aware. Sebelumnya
    // Number("1.000") = 1 (decimal), now → 1000 (thousand sep).
    const cost = parseIndonesianInt(unitCost);
    const size = parseIndonesianNumber(packSize);
    if (!Number.isFinite(cost) || cost <= 0) return null;
    if (!Number.isFinite(size) || size <= 0) return null;
    // Sesi AE-164 — JANGAN Math.round ke integer: untuk bahan per-gram, rate
    // bisa < Rp 1 (mis. Rp 0,36/g) → ke-round jadi 0 dan terlihat error.
    // Simpan 3 desimal; display pakai formatRupiahPrecise.
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    if (packUnit === selectedIngredient.unit) {
      return round3(cost / size);
    }
    const packMeta = resolveUnit(packUnit);
    const ingMeta = resolveUnit(selectedIngredient.unit);
    if (!packMeta || !ingMeta) return null;
    if (packMeta.dimension !== ingMeta.dimension) return null;
    if (packMeta.dimension === "discrete") return null;
    const qtyInIngUnit = (size * packMeta.toBase) / ingMeta.toBase;
    if (qtyInIngUnit === 0) return null;
    return round3(cost / qtyInIngUnit);
  }, [selectedIngredient, unitCost, packSize, packUnit]);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    /* Sesi AE-164 — owner feedback: klik Tambah tanpa isi → nggak ada pesan.
     * Inline error tenggelam di bawah form. Pakai toast (selalu terlihat) +
     * tetap set inline untuk a11y. */
    const fail = (msg: string) => {
      setError(msg);
      toast.error(msg);
    };
    if (!supplierId) {
      fail("Pilih supplier dulu");
      return;
    }
    if (!ingredientId) {
      fail("Pilih bahan dulu");
      return;
    }
    const cost = parseIndonesianInt(unitCost);
    if (!Number.isFinite(cost) || cost <= 0) {
      fail("Harga harus angka > 0");
      return;
    }
    const size = parseIndonesianNumber(packSize);
    if (!Number.isFinite(size) || size <= 0) {
      fail("Pack size harus angka > 0");
      return;
    }
    if (!packUnit) {
      fail("Pilih unit pack");
      return;
    }
    setSubmitting(true);
    const res = target
      ? await updateMarketItem({
          id: target.id,
          patch: {
            // Sesi AE-39 — kirim supplier+ingredient supaya backend
            // bisa swap kalau staff ganti.
            supplierId,
            ingredientId,
            unitCost: cost,
            packSize: size,
            packUnit,
            isPrimary,
            notes: notes.trim() || null,
          },
        })
      : await createMarketItem({
          supplierId,
          ingredientId,
          unitCost: cost,
          packSize: size,
          packUnit,
          isPrimary,
          notes: notes.trim() || null,
        });
    setSubmitting(false);
    if (!isOk(res)) {
      fail(res.error.message);
      return;
    }
    toast.success(target ? "Market item diupdate" : "Market item ditambah");
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target ? "Edit Market Item" : "Tambah Market Item"}
      description="Catat harga belanja per bahan dari supplier. Kalau supplier ini Primary, harga akan otomatis update master cost + COGS."
      /* Sesi AE-137 — widen lg supaya form pricing (Harga + Pack Size +
       * Pack Unit) muat 3-kolom dengan dropdown lebih lebar. */
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {target ? "Simpan Perubahan" : "Tambah"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loadingMaster ? (
          <p className="text-sm text-neutral-600">Loading master data…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Combobox
                label="Supplier"
                placeholder="Pilih supplier…"
                searchPlaceholder="Cari supplier…"
                clearable
                value={supplierId || null}
                onChange={(v) => setSupplierId(v ?? "")}
                groups={[
                  {
                    label: "",
                    options: suppliers.map((s) => ({
                      value: s.id,
                      label: s.name,
                      hint: s.contact ?? undefined,
                      keywords: [s.category ?? ""],
                    })),
                  } satisfies ComboboxGroup,
                ]}
              />
              <Combobox
                label="Bahan"
                placeholder="Pilih bahan…"
                searchPlaceholder="Cari bahan…"
                clearable
                value={ingredientId || null}
                onChange={(v) => setIngredientId(v ?? "")}
                groups={[
                  {
                    label: "",
                    options: ingredients.map((i) => ({
                      value: i.id,
                      label: i.name,
                      hint: i.unit,
                      keywords: [i.section ?? ""],
                    })),
                  } satisfies ComboboxGroup,
                ]}
              />
            </div>
            {target && (supplierId !== target.supplierId ||
              ingredientId !== target.ingredientId) ? (
              <div className="rounded-lg border border-warning-300 bg-warning-100/40 px-3 py-2 text-xs text-warning-500">
                ⚠️ Mengganti{" "}
                {supplierId !== target.supplierId &&
                ingredientId !== target.ingredientId
                  ? "supplier + bahan"
                  : supplierId !== target.supplierId
                    ? "supplier"
                    : "bahan"}{" "}
                pada entry yang sudah ada. Pastikan kombinasi baru belum
                punya entry sendiri — kalau dup, akan ditolak.
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label="Harga Total (Rp)"
                type="text"
                inputMode="numeric"
                value={unitCost}
                onChange={(e) =>
                  setUnitCost(e.target.value.replace(/\D/g, ""))
                }
                placeholder="36000"
              />
              <Input
                label="Pack Size"
                type="text"
                inputMode="decimal"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="1000"
              />
              <Select
                label="Pack Unit"
                value={displayUnit(packUnit)}
                onValueChange={setPackUnit}
                options={packUnitOptions}
                placeholder="Pilih…"
              />
            </div>

            {selectedIngredient && effectiveCost !== null ? (
              <div className="rounded-lg border border-info-300 bg-info-100/40 p-3 text-xs">
                <div className="font-semibold text-info-500">
                  Effective cost = {formatRupiahPrecise(effectiveCost)} /{" "}
                  {selectedIngredient.unit}
                </div>
                <div className="mt-1 text-info-500/80">
                  Master cost {selectedIngredient.name} sekarang ={" "}
                  <span className="font-mono">
                    {formatRupiahPrecise(selectedIngredient.costPerUnit)}
                  </span>
                  /{selectedIngredient.unit}
                  {isPrimary
                    ? ` → akan di-update ke ${formatRupiahPrecise(effectiveCost)} kalau disimpan`
                    : " (tidak diubah, cuma catat sebagai harga supplier alt)"}
                </div>
              </div>
            ) : selectedIngredient && unitCost && packSize && packUnit ? (
              <div className="rounded-lg border border-warning-300 bg-warning-100/40 p-3 text-xs text-warning-500">
                ⚠️ Tidak bisa convert {packUnit} ke {selectedIngredient.unit}{" "}
                — pilih unit pack yang sesuai dimensi.
              </div>
            ) : null}

            <label className="flex items-start gap-2 rounded-lg border border-mahakan-green-700/30 bg-mahakan-green-50 p-3">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="mt-0.5 size-4 accent-mahakan-green-700"
              />
              <span className="text-xs text-neutral-700">
                <span className="font-semibold text-mahakan-green-900">
                  Set sebagai supplier utama (Primary)
                </span>
                <br />
                Kalau dicentang, harga ini akan otomatis update master cost
                bahan ini di Bahan / COGS / Recipe / HPP. Hanya 1 supplier
                primary per bahan.
              </span>
            </label>

            <Input
              label="Catatan (opsional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mis. promo Lebaran, harga event, dll"
            />

            {error ? (
              <p
                role="alert"
                className="text-sm font-medium text-danger-500"
              >
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
