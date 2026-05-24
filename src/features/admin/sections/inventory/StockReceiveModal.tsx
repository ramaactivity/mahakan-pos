"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, receiveStock, type Ingredient } from "@/features/inventory";
import {
  formatRupiah,
  parseIndonesianNumber,
  parseRupiah,
} from "@/lib/format";
import {
  belanjaToCogs,
  cogsToBelanja,
  effectiveBelanjaUnit,
  type IngredientUnitTiers,
} from "@/lib/unit-conversion";

interface StockReceiveModalProps {
  open: boolean;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

function fmtIdn(n: number, maxDec = 4): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDec }).format(
    n,
  );
}

export function StockReceiveModal({
  open,
  ingredient,
  onClose,
  onSaved,
}: StockReceiveModalProps) {
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiers = useMemo<IngredientUnitTiers | null>(() => {
    if (!ingredient) return null;
    return {
      cogsUnit: ingredient.unit,
      belanjaUnit: ingredient.unitBelanja,
      belanjaPerCogs: ingredient.unitBelanjaPerCogs,
    };
  }, [ingredient]);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setQty("");
    /* Seed harga per DISPLAY unit. cost master simpan per recipe unit;
     * convert via × belanjaPerCogs (mis. 50/g × 1000 = 50.000/kg). */
    if (ingredient && tiers) {
      const costPerCogs = ingredient.costPerUnit;
      const display = effectiveBelanjaUnit(tiers);
      const usingBelanja = display !== tiers.cogsUnit;
      if (usingBelanja) {
        const per = Number(tiers.belanjaPerCogs) || 1;
        setUnitCost(String(Math.round(costPerCogs * per)));
      } else {
        setUnitCost(String(costPerCogs));
      }
    } else {
      setUnitCost("");
    }
    setUpdateCost(true);
    setNote("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, ingredient, tiers]);

  if (!ingredient || !tiers) return null;

  const displayUnit = effectiveBelanjaUnit(tiers);
  const usingBelanjaTier = displayUnit !== tiers.cogsUnit;
  const belanjaPerCogs = usingBelanjaTier
    ? Number(tiers.belanjaPerCogs) || 1
    : 1;
  const currentStockCogs =
    ingredient.currentStockDecimal !== null
      ? parseFloat(ingredient.currentStockDecimal)
      : ingredient.currentStock;
  const currentStockDisplay = cogsToBelanja(currentStockCogs, tiers);

  function parseQtyDisplay(): number {
    const trimmed = qty.trim();
    if (!trimmed) return NaN;
    return parseIndonesianNumber(trimmed);
  }

  function qtyCogsFromDisplay(qtyDisplay: number): number {
    if (!Number.isFinite(qtyDisplay)) return NaN;
    return Math.round(belanjaToCogs(qtyDisplay, tiers!));
  }

  function parseCostPerDisplay(): number {
    try {
      return parseRupiah(unitCost);
    } catch {
      return 0;
    }
  }

  function costPerCogsFromDisplay(costPerDisplay: number): number {
    if (!Number.isFinite(costPerDisplay) || costPerDisplay < 0) return 0;
    return Math.round(costPerDisplay / belanjaPerCogs);
  }

  async function onSubmit() {
    if (submitting || !ingredient || !tiers) return;
    const qDisplay = parseQtyDisplay();
    if (!Number.isFinite(qDisplay) || qDisplay <= 0) {
      setError(`Jumlah harus > 0 (dalam ${displayUnit}, pakai koma: 1,5)`);
      return;
    }
    const qCogs = qtyCogsFromDisplay(qDisplay);
    if (!Number.isFinite(qCogs) || qCogs <= 0) {
      setError(
        `Jumlah terlalu kecil setelah konversi ke ${tiers.cogsUnit}. Naikkan.`,
      );
      return;
    }
    const costDisplay = parseCostPerDisplay();
    if (costDisplay < 0) {
      setError("Harga tidak boleh negatif");
      return;
    }
    const costCogs = costPerCogsFromDisplay(costDisplay);

    setSubmitting(true);
    setError(null);

    const trimmed = note.trim();
    const res = await receiveStock({
      ingredientId: ingredient.id,
      qty: qCogs,
      unitCost: costCogs,
      updateCost,
      note: trimmed.length > 0 ? trimmed : null,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    const newStockDisplayAfter = cogsToBelanja(
      res.data.ingredient.currentStockDecimal !== null
        ? parseFloat(res.data.ingredient.currentStockDecimal)
        : res.data.ingredient.currentStock,
      tiers,
    );
    toast.success(
      `+${fmtIdn(qDisplay)} ${displayUnit} ${ingredient.name} masuk (stok jadi ${fmtIdn(newStockDisplayAfter)} ${displayUnit})`,
    );
    onSaved();
  }

  const qDisplay = parseQtyDisplay();
  const costDisplay = parseCostPerDisplay();
  const qCogsPreview = Number.isFinite(qDisplay)
    ? qtyCogsFromDisplay(qDisplay)
    : NaN;
  const costCogsPreview = costPerCogsFromDisplay(costDisplay);
  const totalCost =
    Number.isFinite(qDisplay) && qDisplay > 0 && costDisplay > 0
      ? Math.round(qDisplay * costDisplay)
      : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Terima Stok — ${ingredient.name}`}
      description={`Stok saat ini: ${fmtIdn(currentStockDisplay)} ${displayUnit}${
        usingBelanjaTier
          ? ` (= ${fmtIdn(currentStockCogs)} ${tiers.cogsUnit})`
          : ""
      }`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Terima
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Jumlah (${displayUnit}, pakai koma)`}
            placeholder="mis. 1,5"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="text"
            inputMode="decimal"
            autoFocus
          />
          <Input
            label={`Harga per ${displayUnit} (Rp)`}
            placeholder="50000"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            type="text"
            inputMode="numeric"
          />
        </div>

        {usingBelanjaTier &&
        Number.isFinite(qCogsPreview) &&
        qCogsPreview > 0 ? (
          <div className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-600">
            Tersimpan sebagai:{" "}
            <span className="font-mono">
              {fmtIdn(qCogsPreview)} {tiers.cogsUnit}
            </span>
            {costCogsPreview > 0 ? (
              <>
                {" "}
                @{" "}
                <span className="font-mono">
                  {formatRupiah(costCogsPreview)}/{tiers.cogsUnit}
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        <label className="flex items-start gap-2 rounded-md bg-neutral-100 p-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={updateCost}
            onChange={(e) => setUpdateCost(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
          />
          <span>
            <strong className="font-medium text-neutral-900">
              Update cost-per-unit master ke harga ini.
            </strong>{" "}
            Uncheck kalau ini cuma promo / one-off dan harga master jangan
            berubah. Cost master dipakai untuk hitung COGS transaksi mendatang.
          </span>
        </label>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis. invoice supplier #123, atau brand"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </div>

        {totalCost > 0 ? (
          <div className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Total nilai pembelian:{" "}
            <span className="font-mono">{formatRupiah(totalCost)}</span>
            <p className="mt-0.5 text-neutral-600">
              Catatan: aksi ini hanya catat pergerakan stok. Belum auto-buat
              expense di Kas — kalau perlu sinkron dengan kas, buat manual di
              tab Kas → Pengeluaran.
            </p>
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
