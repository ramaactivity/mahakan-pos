"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, recordWaste, type Ingredient } from "@/features/inventory";
import { formatRupiah } from "@/lib/format";

interface StockWasteModalProps {
  open: boolean;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

const REASON_PRESETS = [
  "Kadaluarsa",
  "Rusak / tumpah",
  "Salah resep / coba-coba",
  "Karyawan",
  "Lainnya",
];

export function StockWasteModal({
  open,
  ingredient,
  onClose,
  onSaved,
}: StockWasteModalProps) {
  const [qty, setQty] = useState("");
  const [reasonPreset, setReasonPreset] = useState(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setQty("");
    setReasonPreset(REASON_PRESETS[0]);
    setCustomReason("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  if (!ingredient) return null;

  function parseQty(): number {
    const n = parseInt(qty, 10);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit() {
    if (submitting || !ingredient) return;
    const q = parseQty();
    if (q <= 0) {
      setError("Jumlah waste harus > 0");
      return;
    }
    if (q > ingredient.currentStock) {
      setError(
        `Jumlah melebihi stok saat ini (${ingredient.currentStock} ${ingredient.unit})`,
      );
      return;
    }
    const reason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (reason.length < 3) {
      setError("Alasan minimal 3 karakter");
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await recordWaste({
      ingredientId: ingredient.id,
      qty: q,
      reason,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      `Waste ${q} ${ingredient.unit} ${ingredient.name} tercatat`,
    );
    onSaved();
  }

  const q = parseQty();
  const costImpact = q > 0 ? q * ingredient.costPerUnit : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Catat Waste — ${ingredient.name}`}
      description={`Stok saat ini: ${ingredient.currentStock} ${ingredient.unit}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="destructive" onClick={onSubmit} loading={submitting}>
            Catat
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label={`Jumlah Waste (${ingredient.unit})`}
          placeholder="50"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          type="text"
          inputMode="numeric"
          autoFocus
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Alasan
          </label>
          <select
            value={reasonPreset}
            onChange={(e) => setReasonPreset(e.target.value)}
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
          >
            {REASON_PRESETS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {reasonPreset === "Lainnya" ? (
            <input
              type="text"
              placeholder="Tulis alasan…"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
            />
          ) : null}
        </div>

        {costImpact > 0 ? (
          <div className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
            Estimasi biaya yang hilang:{" "}
            <span className="font-mono font-bold">
              {formatRupiah(costImpact)}
            </span>
          </div>
        ) : null}

        <p className="text-xs text-neutral-500">
          Waste mengurangi stok bahan dan tercatat di Audit Log. Dipakai untuk
          tracking shrinkage / breakage; bukan untuk koreksi data salah input
          (untuk itu pakai Adjust).
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
