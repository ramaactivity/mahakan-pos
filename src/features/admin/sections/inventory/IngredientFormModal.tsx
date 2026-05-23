"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  createIngredient,
  isOk,
  updateIngredient,
  type Ingredient,
  type IngredientSection,
} from "@/features/inventory";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface IngredientFormModalProps {
  open: boolean;
  edit?: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

const COMMON_UNITS = ["g", "kg", "ml", "L", "pcs", "pack", "btl"];

const SECTION_OPTIONS: Array<{
  value: IngredientSection | "__none";
  label: string;
}> = [
  { value: "__none", label: "Belum diset" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Supporting Supplies" },
  { value: "cleaning", label: "Cleaning Supplies" },
];

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
  const [section, setSection] = useState<IngredientSection | "__none">(
    "__none",
  );
  /* Sesi AE-130 — multi-unit tier inputs (Anisa feedback). Empty string =
   * tier disabled, fallback ke unit utama. Per_cogs = berapa unit utama
   * per 1 satuan ini. */
  const [unitTracking, setUnitTracking] = useState("");
  const [unitTrackingPerCogs, setUnitTrackingPerCogs] = useState("");
  const [unitBelanja, setUnitBelanja] = useState("");
  const [unitBelanjaPerCogs, setUnitBelanjaPerCogs] = useState("");
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
      setSection(edit.section ?? "__none");
      setUnitTracking(edit.unitTracking ?? "");
      setUnitTrackingPerCogs(
        edit.unitTrackingPerCogs ? String(parseFloat(edit.unitTrackingPerCogs)) : "",
      );
      setUnitBelanja(edit.unitBelanja ?? "");
      setUnitBelanjaPerCogs(
        edit.unitBelanjaPerCogs ? String(parseFloat(edit.unitBelanjaPerCogs)) : "",
      );
    } else {
      setName("");
      setUnit("g");
      setCostPerUnit("");
      setInitialStock("0");
      setReorderThreshold("");
      setNotes("");
      setIsActive(true);
      setSection("__none");
      setUnitTracking("");
      setUnitTrackingPerCogs("");
      setUnitBelanja("");
      setUnitBelanjaPerCogs("");
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
      setError("Stok minimum tidak boleh negatif");
      return;
    }

    /* Sesi AE-130 — parse 3-unit tier inputs (Anisa feedback).
     * Validasi: kalau label di-set, per_cogs WAJIB positif. Kalau label
     * kosong, per_cogs di-ignore (tier disabled). */
    const trackingLabel = unitTracking.trim();
    const trackingPer = parseDecimalOrNull(unitTrackingPerCogs);
    if (trackingLabel.length > 0 && (trackingPer === null || trackingPer <= 0)) {
      setError(
        `Konversi satuan terbesar harus diisi (mis. 1 ${trackingLabel} = ? ${unit || "satuan utama"})`,
      );
      return;
    }
    const belanjaLabel = unitBelanja.trim();
    const belanjaPer = parseDecimalOrNull(unitBelanjaPerCogs);
    if (belanjaLabel.length > 0 && (belanjaPer === null || belanjaPer <= 0)) {
      setError(
        `Konversi satuan belanja harus diisi (mis. 1 ${belanjaLabel} = ? ${unit || "satuan utama"})`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmedNotes = notes.trim();
    const sectionValue =
      section === "__none" ? null : (section as IngredientSection);
    /* Sesi AE-130 — payload tier: kalau label kosong → null untuk wipe.
     * Per_cogs juga null kalau label null (tier disabled). */
    const trackingPayload = {
      unitTracking: trackingLabel.length > 0 ? trackingLabel : null,
      unitTrackingPerCogs: trackingLabel.length > 0 ? trackingPer : null,
    };
    const belanjaPayload = {
      unitBelanja: belanjaLabel.length > 0 ? belanjaLabel : null,
      unitBelanjaPerCogs: belanjaLabel.length > 0 ? belanjaPer : null,
    };
    const res = edit
      ? await updateIngredient(edit.id, {
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          isActive,
          section: sectionValue,
          ...trackingPayload,
          ...belanjaPayload,
        })
      : await createIngredient({
          name: name.trim(),
          unit: unit.trim(),
          costPerUnit: cost,
          initialStock: stock,
          reorderThreshold: threshold,
          notes: trimmedNotes.length > 0 ? trimmedNotes : null,
          section: sectionValue,
          ...trackingPayload,
          ...belanjaPayload,
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

        <Select
          label="Section"
          options={SECTION_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
          value={section}
          onValueChange={(v) =>
            setSection(v as IngredientSection | "__none")
          }
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
          label={`Stok Minimum (${unit || "unit"}, opsional)`}
          placeholder="kosongkan kalau tidak mau alert"
          value={reorderThreshold}
          onChange={(e) => setReorderThreshold(e.target.value)}
          type="text"
          inputMode="numeric"
          /* Sesi AE-130 — rename "Threshold Stok Rendah" → "Stok Minimum"
           * (Anisa feedback: istilah Threshold bikin staff bingung).
           * "Stok Minimum" = batas terendah sebelum perlu re-order, bahasa
           * yang familiar di operasi gudang Indonesia. */
        />

        {/* Sesi AE-130 — Satuan Lainnya (Anisa feedback). Optional tier
            untuk tracking display + belanja default. Kalau staff tidak
            mau pakai, biarkan kosong; semua flow tetap pakai unit utama. */}
        <details className="rounded-md border border-neutral-200 bg-neutral-50/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-neutral-900">
            Satuan Lainnya (opsional)
          </summary>
          <div className="space-y-3 border-t border-neutral-200 px-3 py-3">
            <p className="text-xs text-neutral-600 leading-relaxed">
              Tambahkan satuan beda untuk display di Inventory (mis.
              &ldquo;Kotak&rdquo;) atau saat Catat Pembelian (mis.
              &ldquo;L&rdquo;), sambil tetap pakai{" "}
              <strong>{unit || "satuan utama"}</strong> sebagai dasar
              perhitungan resep + cost. Kosongkan kalau tidak perlu.
            </p>

            {/* Tracking tier — satuan terbesar untuk tampilan Inventory list */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-800">
                Satuan Tampilan / Tracking
              </label>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Label satuan tracking"
                  placeholder="mis. Kotak / Karung / Btl"
                  value={unitTracking}
                  onChange={(e) => setUnitTracking(e.target.value)}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  = berisi
                </span>
                <Input
                  aria-label="Jumlah unit utama per 1 satuan tracking"
                  placeholder="1000"
                  value={unitTrackingPerCogs}
                  onChange={(e) => setUnitTrackingPerCogs(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  className="w-24"
                  disabled={unitTracking.trim().length === 0}
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  {unit || "satuan utama"}
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Mis. susu: 1 Kotak = 1000 ml. Inventory akan tampilkan
                &ldquo;2 Kotak&rdquo; alih-alih &ldquo;2000 ml&rdquo;
                supaya lebih mudah dibaca.
              </p>
            </div>

            {/* Belanja tier — default unit saat Catat Pembelian */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-800">
                Satuan Belanja / PR
              </label>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Label satuan belanja"
                  placeholder="mis. L / Kg / Pack"
                  value={unitBelanja}
                  onChange={(e) => setUnitBelanja(e.target.value)}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  = berisi
                </span>
                <Input
                  aria-label="Jumlah unit utama per 1 satuan belanja"
                  placeholder="1000"
                  value={unitBelanjaPerCogs}
                  onChange={(e) => setUnitBelanjaPerCogs(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  className="w-24"
                  disabled={unitBelanja.trim().length === 0}
                />
                <span className="shrink-0 text-xs text-neutral-500">
                  {unit || "satuan utama"}
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Mis. susu beli per L (1 L = 1000 ml). Form Catat Pembelian
                otomatis pakai &ldquo;L&rdquo; sebagai default.
              </p>
            </div>
          </div>
        </details>

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

/** Sesi AE-130 — parse decimal (accept koma OR titik separator).
 *  Returns null untuk empty/invalid/non-positive. */
function parseDecimalOrNull(s: string): number | null {
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}
