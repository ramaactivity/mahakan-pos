"use client";

import { useState } from "react";
import { MessageCircle, ShoppingCart } from "lucide-react";
import { Button, Input, Modal, NumericInput, toast } from "@/components/ui";
import {
  createPurchaseRequest,
  markWhatsappSent,
} from "@/features/purchase-requests/actions";
import {
  isOk,
  type LowStockIngredient,
} from "@/features/purchase-requests/types";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  convertQtyWithIngredientPacks,
  displayUnit,
  mergePackConversions,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
import { parseIndonesianNumber } from "@/lib/format";

interface BelanjaSubmissionModalProps {
  open: boolean;
  lowStock: LowStockIngredient[];
  shiftId: string;
  /** Telpon owner untuk wa.me link. NULL → WA button disabled (set di Settings). */
  ownerPhone: string | null;
  onClose: () => void;
}

interface DraftItem {
  ingredientId: string;
  name: string;
  /** Satuan yg dipilih staff (boleh ≠ master). */
  unit: string;
  /** Master unit basis konversi. */
  masterUnit: string;
  section: string | null;
  currentStock: number;
  reorderThreshold: number;
  qty: string; // string for NumericInput
  selected: boolean;
  notes: string;
  /* Sesi AE-177d — dropdown satuan + konversi qty ke master saat submit. */
  packConversions: IngredientPackConversion[];
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
}

const SECTION_LABEL: Record<string, string> = {
  kitchen: "Kitchen",
  bar: "Bar",
  supporting: "Supporting",
  cleaning: "Cleaning",
};

export function BelanjaSubmissionModal({
  open,
  lowStock,
  shiftId,
  ownerPhone,
  onClose,
}: BelanjaSubmissionModalProps) {
  const [items, setItems] = useState<DraftItem[]>(() =>
    lowStock.map((ing) => ({
      ingredientId: ing.id,
      name: ing.name,
      unit: displayUnit(ing.unit),
      masterUnit: displayUnit(ing.unit),
      section: ing.section,
      currentStock: ing.currentStock,
      reorderThreshold: ing.reorderThreshold,
      qty: String(ing.suggestedQty),
      selected: true,
      notes: "",
      packConversions: ing.packConversions ?? [],
      unitBelanja: ing.unitBelanja ?? null,
      unitBelanjaPerCogs: ing.unitBelanjaPerCogs ?? null,
    })),
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  }

  function buildWhatsappText(selected: DraftItem[]): string {
    const lines = ["Permintaan Belanja Mahakan:"];
    selected.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.name} — ${it.qty} ${it.unit}`);
      if (it.notes.trim()) lines.push(`   (${it.notes.trim()})`);
    });
    if (notes.trim()) {
      lines.push("");
      lines.push(`Catatan: ${notes.trim()}`);
    }
    return lines.join("\n");
  }

  async function handleSubmit(opts: { withWhatsapp: boolean }) {
    const selected = items.filter((it) => it.selected);
    if (selected.length === 0) {
      toast.error("Pilih minimal 1 item");
      return;
    }
    /* Sesi AE-177d — konversi qty staff ke master (kalau pilih satuan ≠ master)
     * sebelum submit, mirror Opname/Pembelian. Sumber konversi = packConversions
     * + tier belanja dari master, sama dgn yg dipakai Tarik PR di sisi admin. */
    type Submit = { ingredientId: string; requestedQty: number; notes: string | null };
    const toSubmit: Submit[] = [];
    for (const it of selected) {
      const qty = parseIndonesianNumber(it.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(
          `Qty ${it.name} invalid. Pakai koma untuk desimal (mis. 0,5).`,
        );
        return;
      }
      const master = displayUnit(it.masterUnit);
      const chosen = displayUnit(it.unit);
      let finalQty = qty;
      if (chosen && master && chosen !== master) {
        const merged = mergePackConversions(
          it.packConversions,
          it.unitBelanja && it.unitBelanjaPerCogs
            ? [
                {
                  unitLabel: it.unitBelanja,
                  qtyPerBase: parseFloat(it.unitBelanjaPerCogs),
                },
              ]
            : [],
        );
        const conv = convertQtyWithIngredientPacks(qty, chosen, master, merged);
        if (!conv.ok || conv.qtyMaster === null || conv.qtyMaster <= 0) {
          toast.error(
            `${it.name}: tidak bisa konversi ${chosen} ke ${master}. Pilih satuan lain atau minta owner set Konversi Pack di Kelola Bahan.`,
          );
          return;
        }
        finalQty = conv.qtyMaster;
      }
      toSubmit.push({
        ingredientId: it.ingredientId,
        requestedQty: finalQty,
        notes: it.notes.trim() || null,
      });
    }
    setSubmitting(true);
    const res = await createPurchaseRequest({
      shiftId,
      notes: notes.trim() || null,
      items: toSubmit,
    });
    if (!isOk(res)) {
      setSubmitting(false);
      toast.error(res.error.message);
      return;
    }

    if (opts.withWhatsapp && ownerPhone) {
      const text = buildWhatsappText(selected);
      const url = `https://wa.me/${normalizePhone(ownerPhone)}?text=${encodeURIComponent(text)}`;
      // Best-effort audit; ignore errors. Stamp before opening since open()
      // may switch tab.
      void markWhatsappSent(res.data.id);
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Permintaan disimpan + WA dibuka");
    } else {
      toast.success(`Permintaan disimpan (${res.data.itemCount} item)`);
    }
    setSubmitting(false);
    onClose();
  }

  const selectedCount = items.filter((it) => it.selected).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Permintaan Belanja"
      description="Bahan stok di bawah threshold. Centang yang perlu dibeli & sesuaikan qty."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Lewati
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit({ withWhatsapp: false })}
            disabled={submitting || selectedCount === 0}
          >
            Simpan Saja
          </Button>
          <Button
            onClick={() => handleSubmit({ withWhatsapp: true })}
            disabled={submitting || selectedCount === 0 || !ownerPhone}
            title={
              ownerPhone
                ? undefined
                : "Setup nomor owner di Pengaturan dulu"
            }
          >
            <MessageCircle className="size-4" /> Simpan & Kirim WA
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-neutral-600">
          <ShoppingCart className="size-10 text-neutral-300" />
          <p>Tidak ada bahan yang stoknya di bawah threshold.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="w-10 p-2"></th>
                  <th className="p-2">Bahan</th>
                  <th className="p-2 text-right">Stok</th>
                  <th className="p-2 text-right">Threshold</th>
                  <th className="p-2 text-right">Qty Beli</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr
                    key={it.ingredientId}
                    className="border-t border-neutral-200"
                  >
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={it.selected}
                        onChange={(e) =>
                          update(idx, { selected: e.target.checked })
                        }
                        className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <p className="font-medium text-neutral-900">{it.name}</p>
                      <p className="text-xs text-neutral-500">
                        {it.section ? SECTION_LABEL[it.section] : "—"}
                      </p>
                      <Input
                        value={it.notes}
                        onChange={(e) => update(idx, { notes: e.target.value })}
                        placeholder="Catatan (opsional)"
                        className="mt-1"
                        disabled={!it.selected}
                      />
                    </td>
                    <td className="p-2 text-right align-top text-neutral-900">
                      {it.currentStock.toLocaleString("id-ID")} {it.masterUnit}
                    </td>
                    <td className="p-2 text-right align-top text-neutral-700">
                      {it.reorderThreshold.toLocaleString("id-ID")}{" "}
                      {it.masterUnit}
                    </td>
                    <td className="p-2 text-right align-top">
                      <div className="ml-auto flex w-44 items-center gap-1">
                        <div className="flex-1">
                          <NumericInput
                            value={it.qty}
                            onChange={(v) => update(idx, { qty: v })}
                            allowDecimal
                            disabled={!it.selected}
                          />
                        </div>
                        {/* Sesi AE-177d — dropdown satuan KANONIK (sama Opname).
                         * Staff boleh pilih satuan beli (Pcs/renceng/Kg) —
                         * client konversi ke master sebelum submit. */}
                        <select
                          value={displayUnit(it.unit)}
                          onChange={(e) =>
                            update(idx, { unit: e.target.value })
                          }
                          disabled={!it.selected}
                          aria-label="Satuan"
                          className="w-20 shrink-0 rounded-md border border-neutral-300 bg-white px-1.5 py-1.5 text-xs text-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-400"
                        >
                          {buildUnitSelectOptions({
                            presets: CANONICAL_UNIT_PRESETS,
                            packLabels: [
                              it.masterUnit,
                              it.unitBelanja ?? "",
                              ...it.packConversions.map((p) => p.unitLabel),
                            ],
                            current: it.unit,
                          }).options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {it.selected &&
                      displayUnit(it.unit) !== it.masterUnit ? (
                        <p className="mt-1 text-[10px] text-neutral-500">
                          → disimpan dlm{" "}
                          <span className="font-mono">{it.masterUnit}</span>
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Catatan tambahan (opsional)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mis. tolong belikan minggu ini"
            />
          </div>

          {!ownerPhone ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Nomor WA owner belum di-set. Setup di Admin → Pengaturan →
              Outlet → Nomor Telepon untuk aktifkan tombol &ldquo;Simpan &amp;
              Kirim WA&rdquo;.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/**
 * Convert phone "0812..." atau "+62812..." ke "62812..." for wa.me path
 * (international format without leading +).
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  return digits;
}
