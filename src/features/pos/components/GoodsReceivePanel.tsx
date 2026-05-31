"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageCheck, Truck } from "lucide-react";
import { Badge, Button, toast } from "@/components/ui";
import {
  fetchReceivablePurchase,
  isOk,
  listPendingGoodsReceipts,
  receiveGoods,
} from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
import { PosPanelSkeleton } from "./PanelSkeleton";

type PendingPo = {
  id: string;
  purchaseDate: string;
  supplierName: string | null;
  paymentMethod: string;
  totalAmount: number;
  itemCount: number;
};

/**
 * Sesi AE-173 — panel POS untuk staff menerima barang (Goods Receive) dari PO
 * yang sudah dibuat Owner/Manager. Saat "Terima", pengeluaran + (stok kalau
 * mode perpetual) tercatat. Daftar hanya menampilkan PO 'ordered'.
 */
export function GoodsReceivePanel() {
  const [items, setItems] = useState<PendingPo[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listPendingGoodsReceipts();
    if (isOk(res)) setItems(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // refresh() setState dilakukan setelah await (bukan saat render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function handleReceive(po: PendingPo) {
    if (receiving) return;
    setReceiving(po.id);
    // Sesi AE-173 — terima PENUH (semua sisa) lewat receiveGoods (model GR baru:
    // buat record GR + movement + expense). Partial per-item ada di Back Office.
    const detail = await fetchReceivablePurchase(po.id);
    if (!isOk(detail)) {
      setReceiving(null);
      toast.error(detail.error.message);
      return;
    }
    const recvItems = detail.data.items
      .filter((it) => it.remainingQty > 0)
      .map((it) => ({ purchaseItemId: it.purchaseItemId, qty: it.remainingQty }));
    if (recvItems.length === 0) {
      setReceiving(null);
      toast.error("Tidak ada sisa untuk diterima");
      void refresh();
      return;
    }
    const res = await receiveGoods({ purchaseId: po.id, items: recvItems });
    setReceiving(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Barang diterima — pengeluaran tercatat");
    setItems((prev) => prev.filter((x) => x.id !== po.id));
    void refresh();
  }

  if (loading) return <PosPanelSkeleton rows={4} />;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-neutral-200 bg-white p-4 sm:p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
          <Truck className="size-5 text-mahakan-green-700" aria-hidden /> Terima
          Barang (GR)
        </h1>
        <p className="mt-0.5 text-sm text-neutral-600">
          Pesanan (PO) yang barangnya sudah datang — tekan{" "}
          <strong>Terima</strong> supaya tercatat sebagai pengeluaran.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <PackageCheck className="size-10 text-neutral-300" aria-hidden />
            <p className="text-sm font-medium text-neutral-700">
              Tidak ada PO yang menunggu diterima
            </p>
            <p className="text-xs text-neutral-500">
              PO dibuat dari Back Office (Inventory → Pembelian → “Buat PO dulu”).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((po) => (
              <div
                key={po.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900">
                      {po.supplierName ?? "Pembelian langsung"}
                    </span>
                    <Badge variant="info">PO</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {po.purchaseDate} · {po.itemCount} bahan ·{" "}
                    <span className="font-mono">{formatRupiah(po.totalAmount)}</span>
                  </p>
                </div>
                <Button
                  onClick={() => handleReceive(po)}
                  loading={receiving === po.id}
                  className="touch:h-11 touch:px-5"
                >
                  <Truck className="size-4" aria-hidden /> Terima
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
