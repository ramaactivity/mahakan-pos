"use client";

import { useEffect, useState } from "react";
import { Button, Modal, toast } from "@/components/ui";
import {
  addOpnameItemAdHoc,
  isOk,
  type IngredientSection,
  type OpnameLineWithIngredient,
} from "@/features/stock-opname";

interface Props {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onAdded: (line: OpnameLineWithIngredient) => void;
}

const SECTION_OPTIONS: Array<{ value: IngredientSection | ""; label: string }> = [
  { value: "", label: "— Lainnya —" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "supporting", label: "Support" },
  { value: "cleaning", label: "Cleaning" },
];

const COMMON_UNITS = [
  "gr",
  "Kg",
  "ml",
  "L",
  "Pcs",
  "Btl",
  "Pack",
  "Bks",
  "Krat",
  "Lusin",
  "set",
  "Karton",
];

/**
 * Sesi AE-22 — modal shared untuk mobile + backoffice opname. Staff
 * input nama bahan baru + unit + section + qty actual yang dihitung.
 * Server side auto-create ingredient master (notes stamped) + opname
 * line dalam 1 transaction.
 */
export function AddOpnameItemModal({
  open,
  sessionId,
  onClose,
  onAdded,
}: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("gr");
  const [section, setSection] = useState<IngredientSection | "">("");
  const [actualQty, setActualQty] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName("");
    setUnit("gr");
    setSection("");
    setActualQty("");
    setNote("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Nama bahan minimal 2 karakter");
      return;
    }
    const qty = parseFloat(actualQty.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Qty actual harus angka >= 0");
      return;
    }
    setSubmitting(true);
    const res = await addOpnameItemAdHoc({
      sessionId,
      name: trimmedName,
      unit: unit.trim(),
      section: section || null,
      actualQty: qty,
      note: note.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`"${trimmedName}" ditambah ke opname`);
    onAdded(res.data);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Bahan Baru ke Opname"
      description="Bahan yang lupa di-master atau bahan baru. Akan otomatis ditambah ke daftar Bahan, owner review pas finalize."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Tambah
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            Nama Bahan
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mis. Madu Murni"
            autoFocus
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700">
              Unit
            </label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
            >
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700">
              Section
            </label>
            <select
              value={section}
              onChange={(e) =>
                setSection(e.target.value as IngredientSection | "")
              }
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
            >
              {SECTION_OPTIONS.map((s) => (
                <option key={s.value || "none"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            Jumlah Aktual (yang dihitung)
          </label>
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={actualQty}
              onChange={(e) => setActualQty(e.target.value)}
              placeholder="0"
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-mono tabular-nums focus:border-mahakan-green-700 focus:outline-none"
            />
            <span className="flex shrink-0 items-center px-3 text-sm font-medium text-neutral-700">
              {unit}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            Decimal boleh (mis. 0.5 Kg). Saat owner finalize, akan jadi adjust+
            di stock master.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-700">
            Catatan (opsional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Mis. baru beli kemarin, dll"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}

        <div className="rounded-md border border-info-300 bg-info-100/40 p-2 text-[11px] text-info-500">
          ℹ️ Master bahan akan dibuat otomatis dengan stok awal 0 + harga 0.
          Owner edit harga + section setelah opname selesai via tab Bahan.
        </div>
      </div>
    </Modal>
  );
}
