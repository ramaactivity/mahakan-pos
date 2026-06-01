"use client";

import { useState } from "react";
import { AlertCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { updateIngredient } from "@/features/inventory/actions";
import type { PackConversionEntry } from "@/features/inventory/schemas";
import { CANONICAL_UNIT_PRESETS, displayUnit } from "@/lib/unit-conversion";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after successful save. Receives the saved unit string so the
   * caller can apply an optimistic override without waiting for the parent
   * refresh round-trip. Sesi AA hotfix: parent refresh sometimes lags, leaving
   * the row showing the old unit even though the DB is updated. */
  onSaved: (
    newUnit: string,
    newPackConversions: PackConversionEntry[] | null,
  ) => void;
  ingredientId: string;
  ingredientName: string;
  /** Current unit (could be from snapshot or live; we update live ingredient.unit). */
  currentUnit: string;
  /** Sesi AE-62y — current pack conversions (null/empty = no alternatives). */
  currentPackConversions?: PackConversionEntry[] | null;
}

/* Sesi AE-173 — quick-pick satuan kanonik (1 sumber, lihat unit-conversion.ts). */
const COMMON_UNITS = CANONICAL_UNIT_PRESETS;

interface PackDraft {
  unitLabel: string;
  qtyPerBaseStr: string;
}

export function EditUnitModal({
  open,
  onClose,
  onSaved,
  ingredientId,
  ingredientName,
  currentUnit,
  currentPackConversions,
}: Props) {
  const [unit, setUnit] = useState(currentUnit);
  const [packs, setPacks] = useState<PackDraft[]>(() =>
    (currentPackConversions ?? []).map((p) => ({
      unitLabel: p.unitLabel,
      qtyPerBaseStr: String(p.qtyPerBase),
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPack() {
    if (packs.length >= 10) {
      setError("Maksimal 10 konversi pack");
      return;
    }
    setPacks((prev) => [...prev, { unitLabel: "", qtyPerBaseStr: "" }]);
    setError(null);
  }

  function removePack(idx: number) {
    setPacks((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePack(idx: number, patch: Partial<PackDraft>) {
    setPacks((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    const trimmedUnit = unit.trim();
    if (trimmedUnit.length < 1 || trimmedUnit.length > 20) {
      setError("Unit harus 1-20 karakter");
      return;
    }

    // Sesi AE-62y — validate + parse pack drafts.
    const parsedPacks: PackConversionEntry[] = [];
    const seenLabels = new Set<string>();
    for (const p of packs) {
      const label = p.unitLabel.trim();
      if (label.length === 0) continue; // skip empty rows
      if (label.length > 20) {
        setError("Label pack maksimal 20 karakter");
        return;
      }
      /* Sesi AE-62af — guard: label tidak boleh pure-numeric. Staff yg salah
       * ngerti pernah isi "1" di field label (mengira itu jumlah pack).
       * Label harus nama satuan: packs / dus / karton / dst. */
      if (/^[\d.,\s]+$/.test(label)) {
        setError(
          `Label "${label}" cuma angka. Isi nama satuannya (mis. packs, dus, karton), bukan jumlahnya.`,
        );
        return;
      }
      if (label.toLowerCase() === trimmedUnit.toLowerCase()) {
        setError(
          `Label "${label}" sama dengan unit dasar — hapus atau ganti label.`,
        );
        return;
      }
      if (seenLabels.has(label.toLowerCase())) {
        setError(`Label "${label}" duplikat.`);
        return;
      }
      seenLabels.add(label.toLowerCase());
      const qty = parseFloat(p.qtyPerBaseStr.replace(",", "."));
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Qty untuk "${label}" harus angka > 0.`);
        return;
      }
      if (qty > 1_000_000) {
        setError(`Qty untuk "${label}" terlalu besar (max 1 juta).`);
        return;
      }
      parsedPacks.push({ unitLabel: label, qtyPerBase: qty });
    }

    const unitChanged = trimmedUnit !== currentUnit;
    const existingPacks = currentPackConversions ?? [];
    const packsChanged =
      existingPacks.length !== parsedPacks.length ||
      parsedPacks.some((p, i) => {
        const ex = existingPacks[i];
        return (
          !ex || ex.unitLabel !== p.unitLabel || ex.qtyPerBase !== p.qtyPerBase
        );
      });

    if (!unitChanged && !packsChanged) {
      onClose();
      return;
    }

    setSubmitting(true);
    /* Server-side null = wipe semua pack conversions. Empty array juga sama
     * effect tapi null lebih explicit di DB jsonb. */
    const payload: {
      unit?: string;
      packConversions?: PackConversionEntry[] | null;
    } = {};
    if (unitChanged) payload.unit = trimmedUnit;
    if (packsChanged) {
      payload.packConversions = parsedPacks.length > 0 ? parsedPacks : null;
    }
    const res = await updateIngredient(ingredientId, payload);
    setSubmitting(false);
    if (res.success) {
      const summary = [
        unitChanged ? `unit → "${trimmedUnit}"` : null,
        packsChanged
          ? `${parsedPacks.length} konversi pack`
          : null,
      ]
        .filter(Boolean)
        .join(" + ");
      toast.success(`${ingredientName}: ${summary}`);
      onSaved(trimmedUnit, parsedPacks.length > 0 ? parsedPacks : null);
    } else {
      setError(res.error.message);
    }
  }

  const hasPackChanges = (() => {
    const ex = currentPackConversions ?? [];
    if (ex.length !== packs.length) return true;
    return packs.some((p, i) => {
      const e = ex[i];
      const qty = parseFloat(p.qtyPerBaseStr.replace(",", ".") || "0");
      return !e || e.unitLabel !== p.unitLabel.trim() || e.qtyPerBase !== qty;
    });
  })();
  const submitDisabled =
    submitting || (unit.trim() === currentUnit && !hasPackChanges);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Satuan Bahan"
      description={`Ubah satuan + konversi pack untuk "${ingredientName}"`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            loading={submitting}
            disabled={submitDisabled}
          >
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

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Satuan Dasar
          </h3>
          <Input
            label="Satuan baru"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            maxLength={20}
            placeholder="contoh: gram, pcs, ml"
            hint="1-20 karakter"
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
                    displayUnit(unit).toLowerCase() === u.toLowerCase()
                      ? "bg-mahakan-green-700 text-white border-mahakan-green-700"
                      : "bg-white text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Sesi AE-62y — Konversi Pack section */}
        <section className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
                Konversi Pack
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-600">
                Daftar satuan alternatif yang bisa dipakai saat opname / catat
                pembelian. Mis. Lychee Kaleng: <strong>1 packs = 20 pcs</strong>.
                Staff input &ldquo;1 packs&rdquo;, sistem otomatis hitung 20 pcs di stok.
              </p>
            </div>
          </div>

          {packs.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-4 text-center text-xs text-neutral-500">
              Belum ada konversi pack. Tambahkan kalau bahan ini biasanya
              dibeli per packs / karton / dus.
            </div>
          ) : (
            <div className="space-y-2">
              {packs.map((p, idx) => {
                const parsedQty = parseFloat(
                  p.qtyPerBaseStr.replace(",", "."),
                );
                const showPreview =
                  p.unitLabel.trim().length > 0 &&
                  Number.isFinite(parsedQty) &&
                  parsedQty > 0;
                return (
                  <div
                    key={idx}
                    className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-3"
                  >
                    {/* Sesi AE-62af — explicit "1" prefix + labeled columns
                     * supaya staff paham slot mana untuk apa. Pre-fix staff
                     * pernah isi "1" di field label karena copy "1 packs =
                     * 20 pcs" bikin bingung urutan input. */}
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="pb-2 font-mono text-sm font-semibold text-neutral-700">
                        1
                      </span>
                      <div className="flex-1 min-w-[120px]">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                          Nama Pack
                        </label>
                        <Input
                          value={p.unitLabel}
                          onChange={(e) =>
                            updatePack(idx, { unitLabel: e.target.value })
                          }
                          maxLength={20}
                          placeholder="packs / dus / karton"
                          aria-label={`Nama pack baris ${idx + 1}`}
                          className="text-sm"
                        />
                      </div>
                      <span className="pb-2 text-sm font-semibold text-neutral-500">
                        =
                      </span>
                      <div className="w-24">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                          Berapa
                        </label>
                        <Input
                          value={p.qtyPerBaseStr}
                          onChange={(e) =>
                            updatePack(idx, {
                              qtyPerBaseStr: e.target.value.replace(
                                /[^\d.,]/g,
                                "",
                              ),
                            })
                          }
                          inputMode="decimal"
                          placeholder="20"
                          aria-label={`Qty per pack baris ${idx + 1}`}
                          className="text-sm font-mono text-right"
                        />
                      </div>
                      <span className="pb-2 text-sm font-medium text-neutral-700">
                        {unit.trim() || "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePack(idx)}
                        disabled={submitting}
                        aria-label="Hapus konversi"
                        className="mb-1 rounded-md border border-neutral-200 p-1.5 text-neutral-500 hover:bg-danger-100/40 hover:text-danger-500 disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    {showPreview ? (
                      <p className="text-[11px] text-mahakan-green-700">
                        ✓ Preview: <strong>1 {p.unitLabel.trim()}</strong> ={" "}
                        <strong>
                          {parsedQty.toLocaleString("id-ID")} {unit.trim() || "—"}
                        </strong>
                      </p>
                    ) : (
                      <p className="text-[11px] text-neutral-500">
                        Isi nama pack (mis. <em>packs</em>) + berapa{" "}
                        {unit.trim() || "satuan dasar"} dalam 1 pack.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addPack}
            disabled={submitting || packs.length >= 10}
            className="w-full justify-center"
          >
            <Plus className="size-3.5" /> Tambah Konversi Pack
          </Button>
        </section>

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
