"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  fetchGoodsReceiptItems,
  isOk,
  listGoodsReceipts,
} from "@/features/purchases";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type GrRecord = {
  id: string;
  receivedDate: string;
  supplierName: string | null;
  poInvoiceNo: string | null;
  poId: string;
  receiptStatus: string;
  totalAmount: number;
  itemCount: number;
};
type GrItem = {
  ingredientName: string;
  unit: string;
  receivedQty: number;
  unitCost: number;
  totalCost: number;
};

/**
 * Sesi AE-173 — daftar record Goods Receipt (GR) di tab GR (gaya Little
 * Sindbad). Tiap baris = 1 penerimaan barang; expand untuk lihat item.
 */
export function GoodsReceiptsList({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<GrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<GrItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const refresh = useCallback(async () => {
    const res = await listGoodsReceipts();
    if (isOk(res)) setRows(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, refreshKey]);

  async function toggle(gr: GrRecord) {
    if (openId === gr.id) {
      setOpenId(null);
      return;
    }
    setOpenId(gr.id);
    setLoadingItems(true);
    const res = await fetchGoodsReceiptItems(gr.id);
    setLoadingItems(false);
    setItems(isOk(res) ? res.data : []);
  }

  if (loading)
    return (
      <p className="py-8 text-center text-sm text-neutral-500">Memuat GR…</p>
    );
  if (rows.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white py-12 text-center">
        <PackageCheck className="size-10 text-neutral-300" aria-hidden />
        <p className="text-sm font-medium text-neutral-700">
          Belum ada penerimaan barang (GR)
        </p>
        <p className="text-xs text-neutral-500">
          Tekan “Buat GR” di atas untuk terima barang dari PO.
        </p>
      </div>
    );

  return (
    <ul className="space-y-2">
      {rows.map((gr) => (
        <li
          key={gr.id}
          className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
        >
          <button
            type="button"
            onClick={() => toggle(gr)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-neutral-50"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-neutral-900">
                  {gr.supplierName ?? "Pembelian langsung"}
                </span>
                <Badge variant={gr.receiptStatus === "partial" ? "warning" : "success"}>
                  {gr.receiptStatus === "partial" ? "Sebagian" : "Diterima"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-neutral-500">
                {gr.receivedDate} · {gr.itemCount} bahan
                {gr.poInvoiceNo ? ` · ${gr.poInvoiceNo}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-neutral-900">
                {formatRupiah(gr.totalAmount)}
              </span>
              <ChevronDown
                className={cn(
                  "size-4 text-neutral-400 transition-transform",
                  openId === gr.id && "rotate-180",
                )}
                aria-hidden
              />
            </div>
          </button>

          {openId === gr.id ? (
            <div className="border-t border-neutral-100 px-4 py-3">
              {loadingItems ? (
                <p className="text-center text-sm text-neutral-500">Memuat…</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-neutral-100">
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-1.5 text-neutral-800">
                          {it.ingredientName}
                        </td>
                        <td className="py-1.5 text-right font-mono text-neutral-600">
                          {it.receivedQty} {it.unit}
                        </td>
                        <td className="py-1.5 text-right font-mono text-neutral-900">
                          {formatRupiah(it.totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
