"use client";

import { useRef } from "react";
import { Plus, ShoppingCart, Trash2, Boxes } from "lucide-react";
import { Button, Input } from "@/components/ui";
import {
  CANONICAL_UNIT_PRESETS,
  displayUnit,
  type PackUnitRow,
  type PackUnitsForm,
} from "@/lib/unit-conversion";
import { cn } from "@/lib/utils";

interface Props {
  /** Satuan dasar (ingredient.unit) — controlled oleh parent. */
  baseUnit: string;
  value: PackUnitsForm;
  onChange: (next: PackUnitsForm) => void;
  disabled?: boolean;
  maxPackRows?: number;
}

/**
 * Sesi AE-174 — Editor satuan terpadu (dua bagian):
 *  1. Satuan Belanja Utama (default form beli) → unitBelanja
 *  2. Satuan Pack Lain (opsional, daftar)      → packConversions
 *
 * Dipakai di Edit Bahan, Opname (EditUnitModal), & Market List. Semua
 * menyimpan ke master bahan → sinkron lintas modul. Tablet-first.
 */
export function PackUnitsEditor({
  baseUnit,
  value,
  onChange,
  disabled,
  maxPackRows = 10,
}: Props) {
  const idCounter = useRef(0);
  const baseLabel = displayUnit(baseUnit) || "satuan dasar";

  const setMain = (patch: Partial<Pick<PackUnitsForm, "mainLabel" | "mainQtyStr">>) =>
    onChange({ ...value, ...patch });

  const setRows = (packRows: PackUnitRow[]) => onChange({ ...value, packRows });

  const addRow = () => {
    if (value.packRows.length >= maxPackRows) return;
    setRows([
      ...value.packRows,
      { id: `new-${idCounter.current++}`, unitLabel: "", qtyPerBaseStr: "" },
    ]);
  };
  const updateRow = (id: string, patch: Partial<PackUnitRow>) =>
    setRows(value.packRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) =>
    setRows(value.packRows.filter((r) => r.id !== id));

  return (
    <div className="space-y-4">
      {/* ── Satuan Belanja Utama ──────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <ShoppingCart className="size-3.5 text-mahakan-green-700" aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Satuan Belanja Utama
          </h3>
        </div>
        <p className="text-[11px] text-neutral-600">
          Satuan default saat catat pembelian (mis. 1 renceng = 280 {baseLabel}).
          Boleh dikosongkan kalau dibeli per {baseLabel} langsung.
        </p>
        <UnitRow
          baseLabel={baseLabel}
          disabled={disabled}
          label={value.mainLabel}
          qty={value.mainQtyStr}
          onLabel={(v) => setMain({ mainLabel: v })}
          onQty={(v) => setMain({ mainQtyStr: v })}
          labelPlaceholder="renceng / Kg / botol"
        />
        <div className="flex flex-wrap gap-1.5">
          {CANONICAL_UNIT_PRESETS.slice(0, 10).map((u) => (
            <button
              key={u}
              type="button"
              disabled={disabled}
              onClick={() => setMain({ mainLabel: u })}
              className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              {u}
            </button>
          ))}
        </div>
      </section>

      {/* ── Satuan Pack Lain ──────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Boxes className="size-3.5 text-blue-700" aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mahakan-green-900">
            Satuan Pack Lain{" "}
            <span className="font-normal normal-case text-neutral-400">
              (opsional)
            </span>
          </h3>
        </div>
        <p className="text-[11px] text-neutral-600">
          Satuan alternatif yang juga bisa dipakai saat opname / beli (mis.
          1 sachet = 28 {baseLabel}).
        </p>

        {value.packRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-3 text-center text-[11px] text-neutral-500">
            Belum ada. Tambah kalau bahan ini juga dibeli/dihitung per sachet /
            dus / Kg / dll.
          </div>
        ) : (
          <div className="space-y-2">
            {value.packRows.map((row) => (
              <UnitRow
                key={row.id}
                baseLabel={baseLabel}
                disabled={disabled}
                label={row.unitLabel}
                qty={row.qtyPerBaseStr}
                onLabel={(v) => updateRow(row.id, { unitLabel: v })}
                onQty={(v) => updateRow(row.id, { qtyPerBaseStr: v })}
                onRemove={() => removeRow(row.id)}
                labelPlaceholder="sachet / dus / karton"
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={disabled || value.packRows.length >= maxPackRows}
          className={cn("w-full justify-center")}
        >
          <Plus className="size-4" /> Tambah Satuan Pack
        </Button>
      </section>
    </div>
  );
}

function onlyDigits(s: string): string {
  return s.replace(/[^\d.,]/g, "");
}

/** Baris input "1 [nama] = [qty] [baseUnit]" — top-level supaya tidak remount
 *  tiap keystroke (yang bikin input kehilangan fokus). */
function UnitRow({
  baseLabel,
  disabled,
  label,
  qty,
  onLabel,
  onQty,
  onRemove,
  labelPlaceholder,
}: {
  baseLabel: string;
  disabled?: boolean;
  label: string;
  qty: string;
  onLabel: (v: string) => void;
  onQty: (v: string) => void;
  onRemove?: () => void;
  labelPlaceholder: string;
}) {
  const qNum = parseFloat(qty.trim().replace(",", "."));
  const valid = label.trim().length > 0 && Number.isFinite(qNum) && qNum > 0;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2.5 font-mono text-sm font-semibold text-neutral-500">
          1
        </span>
        <div className="min-w-[130px] flex-1">
          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Nama satuan
          </label>
          <Input
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            maxLength={20}
            placeholder={labelPlaceholder}
            disabled={disabled}
            className="text-sm"
          />
        </div>
        <span className="pb-2.5 text-sm font-semibold text-neutral-400">=</span>
        <div className="w-24">
          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Jumlah
          </label>
          <Input
            value={qty}
            onChange={(e) => onQty(onlyDigits(e.target.value))}
            inputMode="decimal"
            placeholder="280"
            disabled={disabled}
            className="text-right font-mono text-sm"
          />
        </div>
        <span className="pb-2.5 text-sm font-medium text-neutral-700">
          {baseLabel}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Hapus satuan"
            className="mb-0.5 flex size-11 flex-none items-center justify-center rounded-md border border-neutral-200 text-neutral-500 transition-colors hover:border-danger-500/40 hover:bg-danger-100/40 hover:text-danger-500 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      {valid ? (
        <p className="mt-1.5 text-[11px] font-medium text-mahakan-green-700">
          ✓ 1 {label.trim()} = {qNum.toLocaleString("id-ID")} {baseLabel}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-neutral-400">
          Isi nama satuan + berapa {baseLabel} dalam 1 satuan itu.
        </p>
      )}
    </div>
  );
}
