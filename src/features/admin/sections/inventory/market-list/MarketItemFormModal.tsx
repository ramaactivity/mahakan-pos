"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Modal,
  toast,
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
   *  yang compatible dengan master unit (mass / volume / count).
   *  Untuk discrete (Btl/Pcs), tetap allow common pack units. */
  const packUnitOptions = useMemo(() => {
    if (!selectedIngredient) return COMMON_PACK_UNITS;
    const compat = compatibleUnitsFor(selectedIngredient.unit).map((o) => o.value);
    const meta = resolveUnit(selectedIngredient.unit);
    if (!meta || meta.dimension === "discrete") {
      return Array.from(new Set([selectedIngredient.unit, ...COMMON_PACK_UNITS]));
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
    const cost = Number(unitCost);
    const size = Number(packSize);
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
    const cost = parseInt(unitCost.replace(/\D/g, ""), 10);
    if (!Number.isFinite(cost) || cost <= 0) {
      setError("Harga harus angka > 0");
      return;
    }
    const size = Number(packSize.replace(",", "."));
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
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Supplier
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  disabled={target !== null}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-600"
                >
                  <option value="">Pilih supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Bahan
                </label>
                <select
                  value={ingredientId}
                  onChange={(e) => setIngredientId(e.target.value)}
                  disabled={target !== null}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-600"
                >
                  <option value="">Pilih bahan…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Harga Total (Rp)
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={unitCost}
                  onChange={(e) =>
                    setUnitCost(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="36000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Pack Size
                </label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={packSize}
                  onChange={(e) => setPackSize(e.target.value)}
                  placeholder="1000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Pack Unit
                </label>
                <select
                  value={packUnit}
                  onChange={(e) => setPackUnit(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
                >
                  <option value="">Pilih…</option>
                  {packUnitOptions.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedIngredient && effectiveCost !== null ? (
              <div className="rounded-lg bg-info-100/40 p-3 text-xs text-info-500">
                Effective cost ={" "}
                <span className="font-mono font-bold">
                  Rp {new Intl.NumberFormat("id-ID").format(effectiveCost)}
                </span>{" "}
                / {selectedIngredient.unit}
              </div>
            ) : selectedIngredient && unitCost && packSize && packUnit ? (
              <div className="rounded-lg bg-warning-100 p-3 text-xs text-warning-500">
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

            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">
                Catatan (opsional)
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Mis. promo Lebaran, harga event, dll"
              />
            </div>

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
