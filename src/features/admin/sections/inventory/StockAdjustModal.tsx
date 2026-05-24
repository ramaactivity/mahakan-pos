"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import { adjustStock, isOk, type Ingredient } from "@/features/inventory";
import { parseIndonesianNumber } from "@/lib/format";
import {
  belanjaToCogs,
  cogsToBelanja,
  effectiveBelanjaUnit,
  type IngredientUnitTiers,
} from "@/lib/unit-conversion";

interface StockAdjustModalProps {
  open: boolean;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

const REASON_PRESETS = [
  "Stock opname — selisih hitung",
  "Koreksi salah input sebelumnya",
  "Bahan retur ke supplier",
  "Lainnya",
];

function fmtIdn(n: number, maxDec = 4): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxDec }).format(
    n,
  );
}

export function StockAdjustModal({
  open,
  ingredient,
  onClose,
  onSaved,
}: StockAdjustModalProps) {
  const [delta, setDelta] = useState("");
  const [reasonPreset, setReasonPreset] = useState(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDelta("");
    setReasonPreset(REASON_PRESETS[0]);
    setCustomReason("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const tiers = useMemo<IngredientUnitTiers | null>(() => {
    if (!ingredient) return null;
    return {
      cogsUnit: ingredient.unit,
      belanjaUnit: ingredient.unitBelanja,
      belanjaPerCogs: ingredient.unitBelanjaPerCogs,
    };
  }, [ingredient]);

  if (!ingredient || !tiers) return null;

  const displayUnit = effectiveBelanjaUnit(tiers);
  const usingBelanjaTier = displayUnit !== tiers.cogsUnit;
  const currentStockCogs =
    ingredient.currentStockDecimal !== null
      ? parseFloat(ingredient.currentStockDecimal)
      : ingredient.currentStock;
  const currentStockDisplay = cogsToBelanja(currentStockCogs, tiers);

  /* Sesi AE-141 — input dalam display unit (Purchase Unit, mis. kg) pakai
   * koma desimal. Convert ke COGS unit (mis. g) sebelum simpan. */
  function parseDeltaDisplay(): number {
    const trimmed = delta.trim();
    if (!trimmed) return 0;
    return parseIndonesianNumber(trimmed);
  }

  function deltaCogsFromDisplay(deltaDisplay: number): number {
    if (!Number.isFinite(deltaDisplay)) return NaN;
    const inCogs = belanjaToCogs(deltaDisplay, tiers!);
    return Math.round(inCogs);
  }

  async function onSubmit() {
    if (submitting || !ingredient || !tiers) return;
    const dDisplay = parseDeltaDisplay();
    if (!Number.isFinite(dDisplay) || dDisplay === 0) {
      setError(
        `Delta wajib diisi dalam ${displayUnit} (boleh negatif, pakai koma untuk desimal: 0,5)`,
      );
      return;
    }
    const dCogs = deltaCogsFromDisplay(dDisplay);
    if (!Number.isFinite(dCogs) || dCogs === 0) {
      setError(
        `Delta terlalu kecil setelah konversi ke ${tiers.cogsUnit}. Naikkan jumlahnya.`,
      );
      return;
    }
    const reason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (reason.length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }

    const newStockCogs = currentStockCogs + dCogs;
    if (newStockCogs < 0) {
      const newDisplay = cogsToBelanja(newStockCogs, tiers);
      setError(
        `Adjust akan bikin stok negatif (${fmtIdn(newDisplay)} ${displayUnit}). Cek jumlah delta-nya.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await adjustStock({
      ingredientId: ingredient.id,
      delta: dCogs,
      reason,
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
      `Adjust ${dDisplay > 0 ? "+" : ""}${fmtIdn(dDisplay)} ${displayUnit} (stok jadi ${fmtIdn(newStockDisplayAfter)} ${displayUnit})`,
    );
    onSaved();
  }

  const dDisplay = parseDeltaDisplay();
  const previewStockDisplay = Number.isFinite(dDisplay)
    ? currentStockDisplay + dDisplay
    : null;
  const dCogsPreview = Number.isFinite(dDisplay)
    ? deltaCogsFromDisplay(dDisplay)
    : NaN;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust Stok — ${ingredient.name}`}
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
            Terapkan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={`Delta (${displayUnit}, boleh negatif, pakai koma)`}
          placeholder="mis. -0,5 (kurang) atau 1,5 (tambah)"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          type="text"
          inputMode="decimal"
          autoFocus
        />

        <div className="space-y-2">
          <Select
            label="Alasan"
            options={REASON_PRESETS.map((r) => ({ value: r, label: r }))}
            value={reasonPreset}
            onValueChange={setReasonPreset}
          />
          {reasonPreset === "Lainnya" ? (
            <Input
              aria-label="Alasan custom"
              placeholder="Tulis alasan…"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
            />
          ) : null}
        </div>

        {previewStockDisplay !== null &&
        Number.isFinite(dDisplay) &&
        dDisplay !== 0 ? (
          <div
            className={
              previewStockDisplay < 0
                ? "rounded-md bg-danger-100 p-2 text-xs text-danger-500"
                : "rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900"
            }
          >
            Preview stok setelah adjust:{" "}
            <span className="font-mono font-bold">
              {fmtIdn(previewStockDisplay)} {displayUnit}
            </span>
            {usingBelanjaTier && Number.isFinite(dCogsPreview) ? (
              <span className="ml-1 text-neutral-600">
                (Δ {dCogsPreview > 0 ? "+" : ""}
                {fmtIdn(dCogsPreview)} {tiers.cogsUnit})
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-neutral-500">
          Adjust dipakai untuk koreksi data, bukan tukar barang ke supplier.
          Aksi ini tercatat di Audit Log untuk traceability.
        </p>

        {error ? (
          <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
