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
import { compatibleUnitsFor, resolveUnit } from "@/lib/unit-conversion";
import {
  formatRupiah,
  parseIndonesianInt,
  parseIndonesianNumber,
} from "@/lib/format";

const COMMON_PACK_UNITS = [
  "Kg",
  "gr",
  "L",
  "ml",
  "Pcs",
  "Btl",
  "Pack",
  "Bks",
  "Krat",
  "Lusin",
  "Karton",
  "Box",
];

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
  const packUnitOptions = useMemo(() => {
    if (!selectedIngredient)
      return COMMON_PACK_UNITS.map((u) => ({ value: u, label: u }));
    const compat = compatibleUnitsFor(selectedIngredient.unit).map((o) => ({
      value: o.value,
      label: o.label,
    }));
    const meta = resolveUnit(selectedIngredient.unit);
    if (!meta || meta.dimension === "discrete") {
      const set = new Set([selectedIngredient.unit, ...COMMON_PACK_UNITS]);
      return Array.from(set).map((u) => ({ value: u, label: u }));
    }
    return compat;
  }, [selectedIngredient]);

  // Auto-set pack unit ke master unit kalau belum dipilih.
  useEffect(() => {
    if (!open) return;
    if (!packUnit && selectedIngredient) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPackUnit(selectedIngredient.unit);
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
    if (packUnit === selectedIngredient.unit) {
      return Math.round(cost / size);
    }
    const packMeta = resolveUnit(packUnit);
    const ingMeta = resolveUnit(selectedIngredient.unit);
    if (!packMeta || !ingMeta) return null;
    if (packMeta.dimension !== ingMeta.dimension) return null;
    if (packMeta.dimension === "discrete") return null;
    const qtyInIngUnit = (size * packMeta.toBase) / ingMeta.toBase;
    if (qtyInIngUnit === 0) return null;
    return Math.round(cost / qtyInIngUnit);
  }, [selectedIngredient, unitCost, packSize, packUnit]);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    if (!supplierId) {
      setError("Pilih supplier dulu");
      return;
    }
    if (!ingredientId) {
      setError("Pilih bahan dulu");
      return;
    }
    const cost = parseIndonesianInt(unitCost);
    if (!Number.isFinite(cost) || cost <= 0) {
      setError("Harga harus angka > 0");
      return;
    }
    const size = parseIndonesianNumber(packSize);
    if (!Number.isFinite(size) || size <= 0) {
      setError("Pack size harus angka > 0");
      return;
    }
    if (!packUnit) {
      setError("Pilih unit pack");
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
      setError(res.error.message);
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
      size="md"
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
                value={packUnit}
                onValueChange={setPackUnit}
                options={packUnitOptions}
                placeholder="Pilih…"
              />
            </div>

            {selectedIngredient && effectiveCost !== null ? (
              <div className="rounded-lg border border-info-300 bg-info-100/40 p-3 text-xs">
                <div className="font-semibold text-info-500">
                  Effective cost = {formatRupiah(effectiveCost)} /{" "}
                  {selectedIngredient.unit}
                </div>
                <div className="mt-1 text-info-500/80">
                  Master cost {selectedIngredient.name} sekarang ={" "}
                  <span className="font-mono">
                    {formatRupiah(selectedIngredient.costPerUnit)}
                  </span>
                  /{selectedIngredient.unit}
                  {isPrimary
                    ? ` → akan di-update ke ${formatRupiah(effectiveCost)} kalau disimpan`
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
