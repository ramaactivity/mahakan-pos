"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  createIngredient,
  isOk,
  updateIngredient,
  type Ingredient,
} from "@/features/inventory";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface IngredientFormModalProps {
  open: boolean;
  edit?: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

const COMMON_UNITS = ["g", "kg", "ml", "L", "pcs", "pack", "btl"];

export function IngredientFormModal({
  open,
  edit,
  onClose,
  onSaved,
}: IngredientFormModalProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("g");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [reorderThreshold, setReorderThreshold] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (edit) {
      setName(edit.name);
      setUnit(edit.unit);
      setCostPerUnit(String(edit.costPerUnit));
      setInitialStock("0"); // not used in edit
      setReorderThreshold(
        edit.reorderThreshold !== null ? String(edit.reorderThreshold) : "",
      );
      setNotes(edit.notes ?? "");
      setIsActive(edit.isActive);
    } else {
      setName("");
      setUnit("g");
      setCostPerUnit("");
      setInitialStock("0");
      setReorderThreshold("");
      setNotes("");
      setIsActive(true);
    }
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, edit]);

  function parseIntOrZero(s: string): number {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit() {
    if (submitting) return;
    if (name.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    if (unit.trim().length === 0) {
      setError("Unit wajib diisi (mis. g, ml, pcs)");
      return;
    }
    let cost = 0;
    try {
      cost = parseRupiah(costPerUnit);
    } catch {
      cost = 0;
    }
    if (cost < 0) {
      setError("Cost per unit tidak boleh negatif");
      return;
    }
    const stock = parseIntOrZero(initialStock);
    if (stock < 0) {
      setError("Stok awal tidak boleh negatif");
      return;
    }
    const threshold =
      reorderThreshold.trim().length === 0
        ? null
        : parseIntOrZero(reorderThreshold);
    if (threshold !== null && threshold < 0) {
      setError("Threshold tidak boleh negatif");
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmedNotes = notes.trim();
    const res = edit
      ? await updateIngredient(edit.id, {
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          isActive,
        })
      : await createIngredient({
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          initialStock: stock,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
        });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      edit
        ? `Bahan ${name.trim()} diperbarui`
        : `Bahan ${name.trim()} ditambahkan${stock > 0 ? ` (stok awal ${stock} ${unit})` : ""}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Bahan" : "Tambah Bahan"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {edit ? "Simpan" : "Tambah"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nama Bahan"
          placeholder="mis. Susu Full Cream"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Unit
            </label>
            <div className="flex gap-1">
              <div className="w-24">
                <Select
                  ariaLabel="Unit preset"
                  options={[
                    ...COMMON_UNITS.map((u) => ({ value: u, label: u })),
                    { value: "__custom", label: "…lainnya" },
                  ]}
                  value={COMMON_UNITS.includes(unit) ? unit : "__custom"}
                  onValueChange={(v) => {
                    if (v === "__custom") {
                      if (COMMON_UNITS.includes(unit)) setUnit("");
                    } else {
                      setUnit(v);
                    }
                  }}
                  size="sm"
                />
              </div>
              {!COMMON_UNITS.includes(unit) ? (
                <input
                  type="text"
                  placeholder="custom"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
                />
              ) : null}
            </div>
            <p className="text-xs text-neutral-500">
              Satuan terkecil yang dipakai (mis. gram untuk biji kopi)
            </p>
          </div>

          <Input
            label="Cost per Unit (Rp)"
            placeholder="200"
            value={costPerUnit}
            onChange={(e) => setCostPerUnit(e.target.value)}
            type="text"
            inputMode="numeric"
          />
        </div>

        {!edit ? (
          <Input
            label={`Stok Awal (${unit || "unit"})`}
            placeholder="0"
            value={initialStock}
            onChange={(e) => setInitialStock(e.target.value)}
            type="text"
            inputMode="numeric"
          />
        ) : null}

        <Input
          label={`Threshold Stok Rendah (${unit || "unit"}, opsional)`}
          placeholder="kosongkan kalau tidak mau alert"
          value={reorderThreshold}
          onChange={(e) => setReorderThreshold(e.target.value)}
          type="text"
          inputMode="numeric"
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="mis. supplier favorit, brand spesifik"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </div>

        {edit ? (
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
            />
            Bahan aktif (uncheck untuk sembunyikan tanpa hapus)
          </label>
        ) : null}

        {!edit && parseRupiahSafe(costPerUnit) > 0 && parseIntOrZeroSafe(initialStock) > 0 ? (
          <div className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Nilai stok awal:{" "}
            <span className="font-mono">
              {formatRupiah(
                parseRupiahSafe(costPerUnit) * parseIntOrZeroSafe(initialStock),
              )}
            </span>
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

function parseRupiahSafe(s: string): number {
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}

function parseIntOrZeroSafe(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}
