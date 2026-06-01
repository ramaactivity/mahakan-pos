"use client";

import { useState } from "react";
import { AlertCircle, Pencil } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { updateIngredient } from "@/features/inventory/actions";
import type { PackConversionEntry } from "@/features/inventory/schemas";
import {
  CANONICAL_UNIT_PRESETS,
  displayUnit,
  packUnitsFromIngredient,
  parsePackUnitsForm,
  type IngredientPackConversion,
  type PackUnitsForm,
} from "@/lib/unit-conversion";
import { PackUnitsEditor } from "../PackUnitsEditor";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Dipanggil setelah simpan sukses. Caller pakai untuk optimistic override
   *  + refresh (HppEstimate, dropdown, dll). */
  onSaved: (
    newUnit: string,
    newPackConversions: PackConversionEntry[] | null,
  ) => void;
  ingredientId: string;
  ingredientName: string;
  currentUnit: string;
  /** Sesi AE-174 — Satuan Belanja Utama saat ini (untuk editor terpadu). */
  currentUnitBelanja?: string | null;
  currentUnitBelanjaPerCogs?: number | string | null;
  /** Sesi AE-62y — current pack conversions (null/empty = no alternatives). */
  currentPackConversions?: IngredientPackConversion[] | null;
}

const COMMON_UNITS = CANONICAL_UNIT_PRESETS;

/**
 * Sesi AE-174 — Editor satuan terpadu RINGAN (dipanggil dari Opname & Market
 * List). Satuan Dasar + Satuan Belanja Utama + Satuan Pack Lain (via
 * PackUnitsEditor, sama persis dengan Edit Bahan). Menyimpan ke master bahan →
 * sinkron lintas modul.
 */
export function EditUnitModal({
  open,
  onClose,
  onSaved,
  ingredientId,
  ingredientName,
  currentUnit,
  currentUnitBelanja,
  currentUnitBelanjaPerCogs,
  currentPackConversions,
}: Props) {
  const [unit, setUnit] = useState(currentUnit);
  const [packForm, setPackForm] = useState<PackUnitsForm>(() =>
    packUnitsFromIngredient({
      unitBelanja: currentUnitBelanja ?? null,
      unitBelanjaPerCogs: currentUnitBelanjaPerCogs ?? null,
      packConversions: currentPackConversions ?? null,
    }),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    const trimmedUnit = unit.trim();
    if (trimmedUnit.length < 1 || trimmedUnit.length > 20) {
      setError("Satuan dasar harus 1-20 karakter");
      return;
    }
    const parsed = parsePackUnitsForm(packForm, trimmedUnit);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    setSubmitting(true);
    const unitChanged = trimmedUnit !== currentUnit;
    const res = await updateIngredient(ingredientId, {
      ...(unitChanged ? { unit: trimmedUnit } : {}),
      unitBelanja: parsed.unitBelanja,
      unitBelanjaPerCogs: parsed.unitBelanjaPerCogs,
      packConversions: parsed.packConversions,
    });
    setSubmitting(false);
    if (res.success) {
      toast.success(`${ingredientName}: satuan diperbarui`);
      onSaved(trimmedUnit, parsed.packConversions);
    } else {
      setError(res.error.message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Satuan Bahan"
      description={`Atur satuan dasar + satuan beli/pack untuk "${ingredientName}"`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            <Pencil className="size-4" /> Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-xs text-neutral-700">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning-500" />
            <div>
              <strong>Heads-up:</strong> Label satuan di opname berjalan ikut
              ter-update otomatis, tapi angka qty TIDAK ikut di-konversi.
              Recount manual kalau perubahan satuan mengubah arti angka
              (mis. gram → kg = bagi 1000).
            </div>
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Satuan Dasar
          </h3>
          <p className="text-[11px] text-neutral-600">
            Satuan terkecil yang dipakai barista di resep (gr / ml / Pcs).
          </p>
          <Input
            label="Satuan dasar"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            maxLength={20}
            placeholder="contoh: gr, ml, Pcs"
          />
          <div className="flex flex-wrap gap-1.5">
            {COMMON_UNITS.slice(0, 8).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                disabled={submitting}
                className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  displayUnit(unit).toLowerCase() === u.toLowerCase()
                    ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </section>

        <PackUnitsEditor
          baseUnit={unit}
          value={packForm}
          onChange={setPackForm}
          disabled={submitting}
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-danger-100/60 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
