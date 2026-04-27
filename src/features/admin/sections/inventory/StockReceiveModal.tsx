"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, receiveStock, type Ingredient } from "@/features/inventory";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface StockReceiveModalProps {
  open: boolean;
  ingredient: Ingredient | null;
  onClose: () => void;
  onSaved: () => void;
}

export function StockReceiveModal({
  open,
  ingredient,
  onClose,
  onSaved,
}: StockReceiveModalProps) {
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setQty("");
    setUnitCost(ingredient ? String(ingredient.costPerUnit) : "");
    setUpdateCost(true);
    setNote("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, ingredient]);

  if (!ingredient) return null;

  function parseQty(): number {
    const n = parseInt(qty, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function parseUnit(): number {
    try {
      return parseRupiah(unitCost);
    } catch {
      return 0;
    }
  }

  async function onSubmit() {
    if (submitting || !ingredient) return;
    const q = parseQty();
    const cost = parseUnit();
    if (q <= 0) {
      setError("Jumlah harus > 0");
      return;
    }
    if (cost < 0) {
      setError("Harga tidak boleh negatif");
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmed = note.trim();
    const res = await receiveStock({
      ingredientId: ingredient.id,
      qty: q,
      unitCost: cost,
      updateCost,
      note: trimmed.length > 0 ? trimmed : null,
    });

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      `+${q} ${ingredient.unit} ${ingredient.name} masuk (stok jadi ${res.data.ingredient.currentStock})`,
    );
    onSaved();
  }

  const totalCost = parseQty() * parseUnit();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Terima Stok — ${ingredient.name}`}
      description={`Stok saat ini: ${ingredient.currentStock} ${ingredient.unit}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Terima
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Jumlah (${ingredient.unit})`}
            placeholder="1000"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            type="text"
            inputMode="numeric"
            autoFocus
          />
          <Input
            label="Harga per Unit (Rp)"
            placeholder="200"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            type="text"
            inputMode="numeric"
          />
        </div>

        <label className="flex items-start gap-2 rounded-md bg-neutral-100 p-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={updateCost}
            onChange={(e) => setUpdateCost(e.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
          />
          <span>
            <strong className="font-medium text-neutral-900">
              Update cost-per-unit master ke harga ini.
            </strong>{" "}
            Uncheck kalau ini cuma promo / one-off dan harga master jangan
            berubah. Cost master dipakai untuk hitung COGS transaksi mendatang.
          </span>
        </label>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="mis. invoice supplier #123, atau brand"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </div>

        {totalCost > 0 ? (
          <div className="rounded-md bg-mahakan-green-100/40 p-2 text-xs text-mahakan-green-900">
            Total nilai pembelian:{" "}
            <span className="font-mono">{formatRupiah(totalCost)}</span>
            <p className="mt-0.5 text-neutral-600">
              Catatan: aksi ini hanya catat pergerakan stok. Belum auto-buat
              expense di Kas — kalau perlu sinkron dengan kas, buat manual di
              tab Kas → Pengeluaran.
            </p>
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
