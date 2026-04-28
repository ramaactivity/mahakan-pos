"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import { adjustStock, isOk, type Ingredient } from "@/features/inventory";

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

  if (!ingredient) return null;

  function parseDelta(): number {
    const trimmed = delta.trim();
    if (!trimmed) return 0;
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : NaN;
  }

  async function onSubmit() {
    if (submitting || !ingredient) return;
    const d = parseDelta();
    if (!Number.isFinite(d) || d === 0) {
      setError("Delta wajib diisi (boleh negatif, tapi tidak boleh 0)");
      return;
    }
    const reason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (reason.length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }

    const newStock = ingredient.currentStock + d;
    if (newStock < 0) {
      setError(
        `Adjust akan bikin stok negatif (${newStock}). Cek jumlah delta-nya.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await adjustStock({
      ingredientId: ingredient.id,
      delta: d,
      reason,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      `Adjust ${d > 0 ? "+" : ""}${d} ${ingredient.unit} (stok jadi ${res.data.ingredient.currentStock})`,
    );
    onSaved();
  }

  const d = parseDelta();
  const previewStock = Number.isFinite(d) ? ingredient.currentStock + d : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust Stok — ${ingredient.name}`}
      description={`Stok saat ini: ${ingredient.currentStock} ${ingredient.unit}`}
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
          label={`Delta (${ingredient.unit}, boleh negatif)`}
          placeholder="mis. -50 (kurang) atau +120 (tambah)"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          type="text"
          inputMode="numeric"
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

        {previewStock !== null && Number.isFinite(d) && d !== 0 ? (
          <div
            className={
              previewStock < 0
                ? "rounded-md bg-danger-100 p-2 text-xs text-danger-500"
                : "rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900"
            }
          >
            Preview stok setelah adjust:{" "}
            <span className="font-mono font-bold">
              {previewStock} {ingredient.unit}
            </span>
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
