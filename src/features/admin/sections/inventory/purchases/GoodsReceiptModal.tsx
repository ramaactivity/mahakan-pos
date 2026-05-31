"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { Button, Modal, Select, toast } from "@/components/ui";
import {
  fetchReceivablePurchase,
  isOk,
  listPendingGoodsReceipts,
  receiveGoods,
} from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
import { toJakartaDateOnly } from "@/lib/date";

const todayIso = () => toJakartaDateOnly(new Date());

type PendingPo = {
  id: string;
  purchaseDate: string;
  supplierName: string | null;
  totalAmount: number;
  itemCount: number;
};
type ReceiveItem = {
  purchaseItemId: string;
  ingredientName: string;
  unit: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  unitCost: number;
};

/**
 * Sesi AE-173 — Buat Goods Receipt dari PO (gaya Little Sindbad). Pilih PO
 * ('ordered'/'partial') → tabel item Dipesan/Diterima editable (default = sisa)
 * → Simpan GR. Terima bertahap didukung (PO partial → received).
 */
export function GoodsReceiptModal({
  open,
  prefillPoId,
  onClose,
  onSaved,
}: {
  open: boolean;
  prefillPoId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pos, setPos] = useState<PendingPo[]>([]);
  const [poId, setPoId] = useState<string>("");
  const [items, setItems] = useState<ReceiveItem[]>([]);
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    const res = await fetchReceivablePurchase(id);
    setLoadingDetail(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setItems([]);
      return;
    }
    setItems(res.data.items);
    // Default Diterima = sisa.
    const init: Record<string, string> = {};
    for (const it of res.data.items)
      init[it.purchaseItemId] = it.remainingQty > 0 ? String(it.remainingQty) : "";
    setRecv(init);
  }, []);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setReceivedDate(todayIso());
    void (async () => {
      const res = await listPendingGoodsReceipts();
      if (isOk(res)) setPos(res.data);
      const initial = prefillPoId ?? "";
      setPoId(initial);
      if (initial) void loadDetail(initial);
      else {
        setItems([]);
        setRecv({});
      }
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, prefillPoId, loadDetail]);

  function onPickPo(id: string) {
    setPoId(id);
    if (id) void loadDetail(id);
    else {
      setItems([]);
      setRecv({});
    }
  }

  const grTotal = items.reduce((sum, it) => {
    const q = parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) || 0;
    return sum + Math.round(q * it.unitCost);
  }, 0);
  const anyQty = items.some(
    (it) => (parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) || 0) > 0,
  );

  async function onSubmit() {
    if (submitting || !poId) return;
    const payloadItems = items
      .map((it) => ({
        purchaseItemId: it.purchaseItemId,
        qty: parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) || 0,
      }))
      .filter((i) => i.qty > 0);
    if (payloadItems.length === 0) {
      toast.error("Isi minimal 1 qty diterima");
      return;
    }
    setSubmitting(true);
    const res = await receiveGoods({
      purchaseId: poId,
      receivedDate,
      items: payloadItems,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      res.data.receiptStatus === "received"
        ? "Barang diterima penuh — pengeluaran tercatat"
        : "Sebagian diterima — PO jadi 'partial', sisanya bisa di-GR lagi",
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat Goods Receipt (Terima Barang)"
      description="Pilih PO yang barangnya datang, lalu isi qty Diterima per bahan (default = sisa). Bisa terima sebagian."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting} disabled={!anyQty}>
            <Truck className="size-4" aria-hidden /> Simpan GR ·{" "}
            {formatRupiah(grTotal)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Purchase Order
            </label>
            <Select
              ariaLabel="Pilih PO"
              placeholder="— Pilih PO —"
              options={pos.map((p) => ({
                value: p.id,
                label: `${p.supplierName ?? "Pembelian langsung"} · ${p.purchaseDate} · ${p.itemCount} bahan`,
              }))}
              value={poId}
              onValueChange={onPickPo}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              Tanggal Terima
            </label>
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40"
            />
          </div>
        </div>

        {!poId ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 py-8 text-center text-sm text-neutral-500">
            Pilih PO dulu untuk lihat item.
          </p>
        ) : loadingDetail ? (
          <p className="py-8 text-center text-sm text-neutral-500">Memuat item…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            PO ini tidak punya item / sudah diterima penuh.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Dipesan</th>
                  <th className="px-3 py-2 text-right font-medium">Sisa</th>
                  <th className="px-3 py-2 text-right font-medium">Diterima</th>
                  <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((it) => {
                  const q =
                    parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) ||
                    0;
                  return (
                    <tr key={it.purchaseItemId}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-neutral-900">
                          {it.ingredientName}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {formatRupiah(it.unitCost)}/{it.unit}
                          {it.receivedQty > 0
                            ? ` · sudah ${it.receivedQty} ${it.unit}`
                            : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-700">
                        {it.orderedQty} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-neutral-500">
                        {it.remainingQty} {it.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={recv[it.purchaseItemId] ?? ""}
                          onChange={(e) =>
                            setRecv((r) => ({
                              ...r,
                              [it.purchaseItemId]: e.target.value.replace(
                                /[^\d.,]/g,
                                "",
                              ),
                            }))
                          }
                          placeholder="0"
                          className="h-9 w-20 rounded-md border border-neutral-300 bg-white px-2 text-right font-mono text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatRupiah(Math.round(q * it.unitCost))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-neutral-200 bg-neutral-50">
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-right text-xs font-semibold text-neutral-700"
                  >
                    Total Diterima
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-mahakan-green-900">
                    {formatRupiah(grTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
