"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, PackageCheck, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  DateRangePicker,
  Input,
  Modal,
  toast,
  type DateRangeValue,
} from "@/components/ui";
import {
  deleteGoodsReceipt,
  fetchGoodsReceiptItems,
  isOk,
  listGoodsReceipts,
} from "@/features/purchases";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { currentJakartaMonth, toJakartaDateOnly } from "@/lib/date";
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
export function GoodsReceiptsList({
  refreshKey,
  onDeleted,
}: {
  refreshKey?: number;
  /** Dipanggil setelah GR dihapus — parent perlu refresh tab PO juga karena
   * status PO ikut mundur (received → partial → ordered). */
  onDeleted?: () => void;
}) {
  const { session } = useSession();
  /* Sesi AE-188 — hapus GR percobaan. OWNER SAJA (lihat rbac.ts). */
  const canDelete = session?.user.role
    ? hasPermission(session.user.role, "purchase.goods_receipt_delete")
    : false;
  const [deleteTarget, setDeleteTarget] = useState<GrRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [rows, setRows] = useState<GrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<GrItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  /* Sesi AE-177 — filter tanggal (tab GR kini log lengkap semua barang masuk).
   * Default bulan berjalan, konsisten dgn tab PO. */
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: `${currentJakartaMonth()}-01`,
    to: toJakartaDateOnly(new Date()),
  });

  const refresh = useCallback(async () => {
    const res = await listGoodsReceipts({
      dateFrom: dateRange.from || undefined,
      dateTo: dateRange.to || undefined,
    });
    if (isOk(res)) setRows(res.data);
    setLoading(false);
  }, [dateRange.from, dateRange.to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, refreshKey]);

  async function onConfirmDelete() {
    if (!deleteTarget || deleting) return;
    if (deleteReason.trim().length < 3) {
      toast.error("Alasan hapus minimal 3 karakter");
      return;
    }
    setDeleting(true);
    const res = await deleteGoodsReceipt({
      id: deleteTarget.id,
      reason: deleteReason.trim(),
    });
    setDeleting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const statusLabel =
      res.data.receiptStatus === "ordered"
        ? "PO kembali ke belum diterima"
        : res.data.receiptStatus === "partial"
          ? "PO jadi diterima sebagian"
          : "PO tetap diterima penuh";
    toast.success(
      `GR dihapus — ${statusLabel}${res.data.stockReversed ? ", stok dikembalikan" : ""}`,
    );
    setDeleteTarget(null);
    setDeleteReason("");
    if (openId === deleteTarget.id) setOpenId(null);
    void refresh();
    onDeleted?.();
  }

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

  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <DateRangePicker
          label="Periode"
          value={dateRange}
          onChange={(v) => setDateRange(v ?? { from: null, to: null })}
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-neutral-500">Memuat GR…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white py-12 text-center">
          <PackageCheck className="size-10 text-neutral-300" aria-hidden />
          <p className="text-sm font-medium text-neutral-700">
            Belum ada penerimaan barang (GR) di periode ini
          </p>
          <p className="text-xs text-neutral-500">
            Semua barang masuk muncul di sini — dari PO (tombol “Terima”) maupun
            “Catat Pembelian → Langsung Terima”.
          </p>
        </div>
      ) : (
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
          {/* Tombol hapus sengaja DI LUAR <button> pembuka — tombol di dalam
              tombol tidak sah di HTML dan bikin klik saling rebutan. */}
          {canDelete ? (
            <div className="flex justify-end border-t border-neutral-100 px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeleteTarget(gr);
                  setDeleteReason("");
                }}
                className="text-danger-500 hover:bg-danger-100"
                title="Hapus GR ini"
              >
                <Trash2 className="size-4" aria-hidden /> Hapus GR
              </Button>
            </div>
          ) : null}

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
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteReason("");
        }}
        title="Hapus GR ini?"
        description={
          deleteTarget
            ? `${deleteTarget.receivedDate} · ${deleteTarget.supplierName ?? "Pembelian langsung"} · ${formatRupiah(deleteTarget.totalAmount)}`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteReason("");
              }}
              disabled={deleting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              loading={deleting}
            >
              Ya, hapus
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning-500/50 bg-warning-100/40 px-3 py-2.5 text-xs leading-relaxed text-neutral-800">
            <p className="font-semibold text-warning-500">
              Penerimaan ini akan hilang beserta seluruh efeknya
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Stok bahan dikembalikan (kalau dulu memang ditambah)</li>
              <li>Pengeluaran kas dari GR ini dihapus</li>
              <li>Status PO mundur — bisa jadi sebagian / belum diterima</li>
              <li>Permintaan Belanja (PR) yang tertaut ikut dibuka lagi</li>
              <li>Jurnal penerimaannya dibalik</li>
            </ul>
            <p className="mt-1.5">
              Tidak bisa di-undo. Kalau barangnya sudah terpakai untuk
              penjualan, penghapusan akan ditolak supaya stok tidak negatif.
            </p>
          </div>
          <Input
            label="Alasan hapus"
            placeholder="mis. GR percobaan, salah input"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
