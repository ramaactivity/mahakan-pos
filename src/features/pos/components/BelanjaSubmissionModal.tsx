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
  unit: string;
  section: string | null;
  currentStock: number;
  reorderThreshold: number;
  qty: string; // string for NumericInput
  selected: boolean;
  notes: string;
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
      unit: ing.unit,
      section: ing.section,
      currentStock: ing.currentStock,
      reorderThreshold: ing.reorderThreshold,
      qty: String(ing.suggestedQty),
      selected: true,
      notes: "",
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
    for (const it of selected) {
      const qty = parseInt(it.qty, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(`Qty ${it.name} tidak valid`);
        return;
      }
    }
    setSubmitting(true);
    const res = await createPurchaseRequest({
      shiftId,
      notes: notes.trim() || null,
      items: selected.map((it) => ({
        ingredientId: it.ingredientId,
        requestedQty: parseInt(it.qty, 10),
        notes: it.notes.trim() || null,
      })),
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
                      {it.currentStock.toLocaleString("id-ID")} {it.unit}
                    </td>
                    <td className="p-2 text-right align-top text-neutral-700">
                      {it.reorderThreshold.toLocaleString("id-ID")} {it.unit}
                    </td>
                    <td className="p-2 text-right align-top">
                      <div className="w-32 ml-auto">
                        <NumericInput
                          value={it.qty}
                          onChange={(v) => update(idx, { qty: v })}
                          allowDecimal={false}
                          disabled={!it.selected}
                          trailingSlot={
                            <span className="text-xs text-neutral-500">
                              {it.unit}
                            </span>
                          }
                        />
                      </div>
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
