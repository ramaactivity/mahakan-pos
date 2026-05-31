"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, PackageCheck, Truck } from "lucide-react";
import { Button, Spinner, toast } from "@/components/ui";
import {
  fetchReceivablePurchase,
  isOk,
  listPendingGoodsReceipts,
  receiveGoods,
} from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

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
 * Sesi AE-173 — Goods Receive (Terima Barang) untuk staff di app karyawan.
 * Pilih PO → isi qty diterima per bahan (default = sisa) → Simpan. Bisa sebagian.
 */
export default function StaffGoodsReceivePage() {
  const [pos, setPos] = useState<PendingPo[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<ReceiveItem[]>([]);
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const res = await listPendingGoodsReceipts();
    if (isOk(res)) setPos(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function openPo(po: PendingPo) {
    if (openId === po.id) {
      setOpenId(null);
      return;
    }
    setOpenId(po.id);
    setLoadingDetail(true);
    const res = await fetchReceivablePurchase(po.id);
    setLoadingDetail(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setItems([]);
      return;
    }
    setItems(res.data.items);
    const init: Record<string, string> = {};
    for (const it of res.data.items)
      init[it.purchaseItemId] = it.remainingQty > 0 ? String(it.remainingQty) : "";
    setRecv(init);
  }

  async function submitGr(poId: string) {
    if (submitting) return;
    const payload = items
      .map((it) => ({
        purchaseItemId: it.purchaseItemId,
        qty: parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) || 0,
      }))
      .filter((i) => i.qty > 0);
    if (payload.length === 0) {
      toast.error("Isi minimal 1 qty diterima");
      return;
    }
    setSubmitting(true);
    const res = await receiveGoods({ purchaseId: poId, items: payload });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      res.data.receiptStatus === "received"
        ? "Barang diterima penuh"
        : "Sebagian diterima — sisanya bisa di-GR lagi",
    );
    setOpenId(null);
    void refresh();
  }

  const grTotal = (poId: string) =>
    openId === poId
      ? items.reduce((s, it) => {
          const q =
            parseFloat((recv[it.purchaseItemId] ?? "").replace(",", ".")) || 0;
          return s + Math.round(q * it.unitCost);
        }, 0)
      : 0;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link
          href="/m"
          className="flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600"
          aria-label="Kembali"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-mahakan-green-900">
            <Truck className="size-5" aria-hidden /> Terima Barang
          </h1>
          <p className="text-xs text-neutral-600">
            Terima barang dari PO. Isi qty diterima (boleh sebagian).
          </p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : pos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white py-12 text-center">
          <PackageCheck className="size-10 text-neutral-300" aria-hidden />
          <p className="text-sm font-medium text-neutral-700">
            Tidak ada PO yang menunggu diterima
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pos.map((po) => (
            <li
              key={po.id}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <button
                type="button"
                onClick={() => openPo(po)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900">
                    {po.supplierName ?? "Pembelian langsung"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {po.purchaseDate} · {po.itemCount} bahan ·{" "}
                    {formatRupiah(po.totalAmount)}
                  </p>
                </div>
                <span className="rounded-full bg-info-100 px-2 py-0.5 text-[11px] font-medium text-info-500">
                  PO
                </span>
              </button>

              {openId === po.id ? (
                <div className="border-t border-neutral-100 p-4">
                  {loadingDetail ? (
                    <p className="py-4 text-center text-sm text-neutral-500">
                      Memuat item…
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {items.map((it) => (
                          <div
                            key={it.purchaseItemId}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-900">
                                {it.ingredientName}
                              </p>
                              <p className="text-[11px] text-neutral-500">
                                Sisa {it.remainingQty} {it.unit} · dipesan{" "}
                                {it.orderedQty}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
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
                                className="h-10 w-20 rounded-md border border-neutral-300 bg-white px-2 text-right font-mono text-sm focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40"
                              />
                              <span className="w-10 text-xs text-neutral-500">
                                {it.unit}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-mahakan-green-900">
                          Total: {formatRupiah(grTotal(po.id))}
                        </span>
                        <Button
                          onClick={() => submitGr(po.id)}
                          loading={submitting}
                          className={cn("touch:h-11")}
                        >
                          <Truck className="size-4" aria-hidden /> Simpan GR
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
