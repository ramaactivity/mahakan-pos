"use client";

import { useState } from "react";
import { AlertCircle, Pencil } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { updateIngredient } from "@/features/inventory/actions";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  ingredientId: string;
  ingredientName: string;
  /** Current unit (could be from snapshot or live; we update live ingredient.unit). */
  currentUnit: string;
}

const COMMON_UNITS = [
  "gram",
  "kg",
  "ml",
  "liter",
  "pcs",
  "bks",
  "btl",
  "kaleng",
  "sachet",
  "buah",
  "ikat",
  "lembar",
  "porsi",
  "set",
];

export function EditUnitModal({
  open,
  onClose,
  onSaved,
  ingredientId,
  ingredientName,
  currentUnit,
}: Props) {
  const [unit, setUnit] = useState(currentUnit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    const trimmed = unit.trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      setError("Unit harus 1-20 karakter");
      return;
    }
    if (trimmed === currentUnit) {
      onClose();
      return;
    }
    setSubmitting(true);
    const res = await updateIngredient(ingredientId, { unit: trimmed });
    setSubmitting(false);
    if (res.success) {
      toast.success(`Unit ${ingredientName} diubah ke "${trimmed}"`);
      onSaved();
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Satuan Bahan"
      description={`Ubah satuan untuk "${ingredientName}"`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting || unit.trim() === currentUnit}
          >
            <Pencil className="size-4" /> Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-xs text-neutral-700">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning-500" />
            <div>
              <strong>Heads-up:</strong> Snapshot expected qty di sesi opname
              berjalan tidak auto-convert. Hanya text label yang berubah.
              Recount manual kalau perubahan satuan mengubah arti angka (mis.
              gram → kg = bagi 1000).
            </div>
          </div>
        </div>

        <Input
          label="Satuan baru"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          maxLength={20}
          placeholder="contoh: gram, pcs, ml"
          hint="1-20 karakter"
          error={error ?? undefined}
        />

        <div>
          <p className="mb-1 text-xs font-medium text-neutral-700">
            Pilihan umum:
          </p>
          <div className="flex flex-wrap gap-1">
            {COMMON_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                disabled={submitting}
                className={`rounded-md border border-neutral-200 px-2 py-1 text-xs transition-colors ${
                  unit === u
                    ? "bg-mahakan-green-700 text-white border-mahakan-green-700"
                    : "bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
