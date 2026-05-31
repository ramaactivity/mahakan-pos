"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  ShoppingBag,
  Truck,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  compareBy,
  DateRangePicker,
  EmptyCard,
  Input,
  Modal,
  Select,
  Skeleton,
  SortableHeader,
  toast,
  useColumnSort,
  type ComboboxGroup,
  type DateRangeValue,
} from "@/components/ui";
import {
  cancelPurchase,
  confirmGoodsReceipt,
  getPurchase,
  isOk,
  listPurchases,
  type PaymentMethod,
  type PurchaseDetail,
  type PurchaseListItem,
  type PurchaseStatus,
} from "@/features/purchases";
import {
  listSuppliers,
  isOk as suppliersIsOk,
  type Supplier,
} from "@/features/suppliers";
import { useSession } from "@/features/auth/SessionProvider";
import { hasPermission } from "@/lib/auth/rbac";
import { formatRupiah } from "@/lib/format";
import { PurchaseFormModal } from "./PurchaseFormModal";
import { CreatePurchaseFromPrModal } from "./CreatePurchaseFromPrModal";

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending_payment: "Belum Lunas",
  paid: "Lunas",
  cancelled: "Dibatalkan",
};

const STATUS_TONE: Record<
  PurchaseStatus,
  "warning" | "success" | "neutral"
> = {
  pending_payment: "warning",
  paid: "success",
  cancelled: "neutral",
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  transfer_bca: "BCA",
  transfer_bri: "BRI",
  transfer_other: "Transfer",
  top: "TOP",
};

const PAYMENT_FILTER: Array<{ value: PaymentMethod | "all"; label: string }> = [
  { value: "all", label: "Semua metode" },
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "BCA" },
  { value: "transfer_bri", label: "BRI" },
  { value: "transfer_other", label: "Transfer lain" },
  { value: "top", label: "TOP (kredit)" },
];

const STATUS_FILTER: Array<{ value: PurchaseStatus | "all"; label: string }> = [
  { value: "all", label: "Semua status" },
  { value: "pending_payment", label: "Belum Lunas" },
  { value: "paid", label: "Lunas" },
  { value: "cancelled", label: "Dibatalkan" },
];

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthStartIso(): string {
  const today = todayJakartaIso();
  return today.slice(0, 7) + "-01";
}

/**
 * Sesi AE-173 — `variant`:
 *  - "purchases" (default) = tab PO: semua pembelian/pesanan + aksi (Catat,
 *    Buat PO, Tarik dari PR) + tombol Terima pada PO yang belum diterima.
 *  - "receipts" = tab GR: hanya yang sudah diterima (receiptStatus='received'),
 *    read-only log, tanpa tombol buat.
 */
export function PurchasesView({
  variant = "purchases",
}: {
  variant?: "purchases" | "receipts";
} = {}) {
  const isReceipts = variant === "receipts";
  const { session } = useSession();
  const role = session?.user.role;
  const canCreate = role
    ? hasPermission(role, "purchase.create")
    : false;
  const canCancel = role
    ? hasPermission(role, "purchase.cancel")
    : false;
  const canReceive = role
    ? hasPermission(role, "purchase.goods_receive")
    : false;

  const [items, setItems] = useState<PurchaseListItem[]>([]);
  const sort = useColumnSort("purchases.view", "purchaseDate", "desc");
  const sortedItems = useMemo(() => {
    const getValue = (p: PurchaseListItem) => {
      switch (sort.key) {
        case "purchaseDate":
          return p.purchaseDate;
        case "supplierName":
          return p.supplierName ?? "";
        case "paymentMethod":
          return p.paymentMethod ?? "";
        case "itemCount":
          return p.itemCount ?? 0;
        case "totalAmount":
          return p.totalAmount ?? 0;
        case "status":
          return p.status ?? "";
        default:
          return p.purchaseDate;
      }
    };
    const base = isReceipts
      ? items.filter((p) => p.receiptStatus === "received")
      : items;
    return [...base].sort(compareBy(sort.dir, getValue));
  }, [items, sort.key, sort.dir, isReceipts]);
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: monthStartIso(),
    to: todayJakartaIso(),
  });
  const [statusFilter, setStatusFilter] = useState<
    PurchaseStatus | "all"
  >("all");
  const [paymentFilter, setPaymentFilter] = useState<
    PaymentMethod | "all"
  >("all");
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  /* Sesi AE-57 — tombol "Tarik dari PR" → wizard 2-step (pilih PR + assign
   * supplier + split per vendor). */
  const [pullFromPrOpen, setPullFromPrOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<PurchaseDetail | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PurchaseListItem | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [purchaseRes, supRes] = await Promise.all([
        listPurchases({
          status: statusFilter === "all" ? undefined : statusFilter,
          paymentMethod:
            paymentFilter === "all" ? undefined : paymentFilter,
          supplierId: supplierFilter ?? undefined,
          dateFrom: dateRange.from || undefined,
          dateTo: dateRange.to || undefined,
        }),
        listSuppliers({ activeOnly: false }),
      ]);
      if (cancelled) return;
      if (isOk(purchaseRes)) setItems(purchaseRes.data);
      if (suppliersIsOk(supRes)) setSuppliersList(supRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    refreshKey,
    statusFilter,
    paymentFilter,
    supplierFilter,
    dateRange.from,
    dateRange.to,
  ]);

  const total = useMemo(
    () =>
      sortedItems.reduce(
        (acc, p) => (p.status === "cancelled" ? acc : acc + p.totalAmount),
        0,
      ),
    [sortedItems],
  );

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    const res = await getPurchase(id);
    setDetailLoading(false);
    if (!isOk(res) || !res.data) {
      toast.error("Gagal load detail");
      return;
    }
    setDetailTarget(res.data);
  }

  async function onCancelConfirm() {
    if (!cancelTarget || cancelSubmitting) return;
    if (cancelReason.trim().length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setCancelSubmitting(true);
    const res = await cancelPurchase({
      id: cancelTarget.id,
      reason: cancelReason.trim(),
    });
    setCancelSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Pembelian dibatalkan + stok di-rollback");
    setCancelTarget(null);
    setCancelReason("");
    refresh();
  }

  // Sesi AE-173 — Goods Receive: PO 'ordered' → terima barang (expense + GR).
  const [grSubmitting, setGrSubmitting] = useState<string | null>(null);
  async function handleGoodsReceive(p: PurchaseListItem) {
    if (grSubmitting) return;
    setGrSubmitting(p.id);
    const res = await confirmGoodsReceipt({ id: p.id });
    setGrSubmitting(null);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Barang diterima — pengeluaran tercatat");
    refresh();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <ShoppingBag className="size-5" aria-hidden />{" "}
            {isReceipts ? "Barang Diterima (GR)" : "Pembelian / PO"} (
            {sortedItems.length})
          </h2>
          <p className="text-xs text-neutral-500">
            {isReceipts
              ? "Riwayat barang yang sudah diterima (GR). Pengeluaran tercatat saat barang diterima."
              : "Catat pembelian / buat PO. Pengeluaran & stok (mode perpetual) tercatat saat barang diterima."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && !isReceipts ? (
            <>
              <Button
                variant="outline"
                onClick={() => setPullFromPrOpen(true)}
                title="Tarik items dari Permintaan Belanja, bisa split per supplier"
              >
                <FileText className="size-4" aria-hidden /> Tarik dari PR
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden /> Catat Pembelian
              </Button>
            </>
          ) : null}
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="grid gap-3 md:grid-cols-4">
            <DateRangePicker
              label="Periode"
              value={dateRange}
              onChange={(v) =>
                setDateRange(v ?? { from: null, to: null })
              }
            />
            <Select
              label="Status"
              options={STATUS_FILTER.map((s) => ({
                value: s.value,
                label: s.label,
              }))}
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as PurchaseStatus | "all")
              }
            />
            <Select
              label="Metode pembayaran"
              options={PAYMENT_FILTER.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
              value={paymentFilter}
              onValueChange={(v) =>
                setPaymentFilter(v as PaymentMethod | "all")
              }
            />
            <Combobox
              label="Supplier"
              placeholder="Semua supplier"
              searchPlaceholder="Cari supplier…"
              clearable
              groups={[
                {
                  label: "",
                  options: suppliersList.map((s) => ({
                    value: s.id,
                    label: s.name,
                    hint: s.category ?? undefined,
                  })),
                } satisfies ComboboxGroup,
              ]}
              value={supplierFilter}
              onChange={(v) => setSupplierFilter(v)}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label="Memuat">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyCard
              icon={Truck}
              title="Belum ada pembelian dalam range ini"
              description="Sesuaikan filter tanggal/supplier/status di atas — atau catat pembelian baru."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <SortableHeader
                      columnKey="purchaseDate"
                      label="Tgl"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="supplierName"
                      label="Supplier"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="paymentMethod"
                      label="Metode"
                      sort={sort}
                    />
                    <SortableHeader
                      columnKey="itemCount"
                      label="Item"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="totalAmount"
                      label="Total"
                      sort={sort}
                      align="right"
                    />
                    <SortableHeader
                      columnKey="status"
                      label="Status"
                      sort={sort}
                    />
                    <th className="px-4 py-2 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sortedItems.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.purchaseDate}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {p.supplierName ? (
                            <span className="text-neutral-900">
                              {p.supplierName}
                            </span>
                          ) : (
                            <Badge variant="warning">Direct</Badge>
                          )}
                        </div>
                        {p.invoiceNo ? (
                          <p className="mt-0.5 text-[11px] text-neutral-500">
                            {p.invoiceNo}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-700">
                        {PAYMENT_LABELS[p.paymentMethod]}
                        {p.paymentMethod === "top" && p.dueDate ? (
                          <p className="text-[11px] text-neutral-500">
                            Due {p.dueDate}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {p.itemCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatRupiah(p.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {p.receiptStatus === "ordered" ? (
                            <Badge variant="info">PO · belum diterima</Badge>
                          ) : (
                            <Badge variant={STATUS_TONE[p.status]}>
                              {STATUS_LABELS[p.status]}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canReceive &&
                          p.receiptStatus === "ordered" &&
                          p.status !== "cancelled" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleGoodsReceive(p)}
                              loading={grSubmitting === p.id}
                              title="Terima Barang (GR)"
                            >
                              <Truck className="size-4" aria-hidden /> Terima
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openDetail(p.id)}
                            title="Lihat detail"
                            aria-label="Lihat detail"
                          >
                            <Eye className="size-4" aria-hidden />
                          </Button>
                          {canCancel && p.status !== "cancelled" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setCancelTarget(p)}
                              title="Cancel"
                              aria-label="Cancel"
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <X className="size-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-neutral-200 bg-neutral-50">
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-2 text-right text-xs font-semibold text-neutral-700"
                    >
                      Total (kecuali yg dibatalkan)
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-neutral-900">
                      {formatRupiah(total)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PurchaseFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <CreatePurchaseFromPrModal
        open={pullFromPrOpen}
        onClose={() => setPullFromPrOpen(false)}
        onSaved={() => {
          setPullFromPrOpen(false);
          refresh();
        }}
      />

      <PurchaseDetailModal
        detail={detailTarget}
        loading={detailLoading}
        onClose={() => setDetailTarget(null)}
      />

      <Modal
        open={cancelTarget !== null}
        onClose={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
        title="Cancel pembelian?"
        description={
          cancelTarget
            ? `Stok bahan akan di-rollback (counter-movement adjust). Linked kas expense akan di-soft-delete jika ada.`
            : ""
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCancelTarget(null);
                setCancelReason("");
              }}
              disabled={cancelSubmitting}
            >
              Tutup
            </Button>
            <Button
              variant="destructive"
              onClick={onCancelConfirm}
              loading={cancelSubmitting}
            >
              Ya, batalkan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="Alasan batal"
            placeholder="mis. salah input, retur ke supplier"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}

interface PurchaseDetailModalProps {
  detail: PurchaseDetail | null;
  loading: boolean;
  onClose: () => void;
}

function PurchaseDetailModal({
  detail,
  loading,
  onClose,
}: PurchaseDetailModalProps) {
  if (!detail) return null;
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Detail Pembelian — ${detail.purchaseDate}`}
      description={`${detail.supplierName ?? "Walk-in / Pasar"}${
        detail.invoiceNo ? ` · ${detail.invoiceNo}` : ""
      }`}
      size="2xl"
      footer={
        <Button onClick={onClose}>
          <ClipboardList className="size-4" aria-hidden /> Tutup
        </Button>
      }
    >
      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Info
              label="Status"
              value={STATUS_LABELS[detail.status]}
            />
            <Info
              label="Metode"
              value={PAYMENT_LABELS[detail.paymentMethod]}
            />
            <Info
              label="Due"
              value={detail.dueDate ?? "—"}
            />
            <Info
              label="Total"
              value={formatRupiah(detail.totalAmount)}
            />
          </div>
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Bahan</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Harga
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {detail.items.map((item) => {
                  const display = formatPurchaseItemQty(item);
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        {item.ingredientNameSnapshot}
                        {display.unitOverridden ? (
                          <span className="ml-1 text-[10px] uppercase tracking-wider text-warning-700">
                            override
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {display.qty}
                        <span className="ml-1 text-xs text-neutral-500">
                          {display.unit}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatRupiah(item.unitCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatRupiah(item.totalCost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detail.notes ? (
            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              <strong>Catatan:</strong> {detail.notes}
            </p>
          ) : null}
          {(() => {
            // Sesi AE-129 — prefer `receiptImageUrls` (multi-nota array)
            // kalau ada, fallback ke legacy single `receiptImageUrl` untuk
            // purchases lama yang belum migrated.
            const urls: string[] =
              detail.receiptImageUrls && detail.receiptImageUrls.length > 0
                ? detail.receiptImageUrls
                : detail.receiptImageUrl
                  ? [detail.receiptImageUrl]
                  : [];
            if (urls.length === 0) return null;
            if (urls.length === 1) {
              return (
                <a
                  href={urls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs text-mahakan-green-900 hover:bg-mahakan-green-100/40"
                >
                  <span className="font-medium">
                    📄 Lihat bukti pembelian di Google Drive
                  </span>
                </a>
              );
            }
            return (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                  📄 {urls.length} Bukti Pembelian
                </p>
                <ul className="space-y-1">
                  {urls.map((u, i) => (
                    <li key={`${u}-${i}`}>
                      <a
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate rounded px-1.5 py-0.5 text-xs text-mahakan-green-900 hover:bg-mahakan-green-100/40"
                      >
                        Nota #{i + 1} — buka di Drive
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {detail.cancelReason ? (
            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-700">
              <strong>Alasan batal:</strong> {detail.cancelReason}
            </p>
          ) : null}
          <p className="text-[11px] text-neutral-500">
            Dibuat oleh {detail.createdByName ?? "—"} ·
            {detail.paidByName ? ` Lunas oleh ${detail.paidByName}` : ""}
            {detail.cancelledByName
              ? ` · Cancel oleh ${detail.cancelledByName}`
              : ""}
          </p>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="font-medium text-neutral-900">{value}</p>
    </div>
  );
}

/**
 * Sesi AE-11 — format purchase item qty dengan precision yg benar.
 *
 * Pre-AE rows: pakai `qty` (bigint integer). AE+ rows: prefer `qtyDecimal`
 * (numeric string seperti "0.5000") karena qty bigint adalah Math.max(1,
 * Math.round(qty)) lossy snapshot. Unit pakai `unitOverride` kalau ada,
 * else fallback ke `unitSnapshot` (master saat purchase di-create).
 */
function formatPurchaseItemQty(item: {
  qty: number;
  qtyDecimal: string | null;
  unitSnapshot: string;
  unitOverride: string | null;
}): { qty: string; unit: string; unitOverridden: boolean } {
  const decimal =
    item.qtyDecimal !== null ? parseFloat(item.qtyDecimal) : null;
  const value =
    decimal !== null && Number.isFinite(decimal) ? decimal : item.qty;
  const formatted = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
  const unitOverridden = Boolean(
    item.unitOverride && item.unitOverride.trim().length > 0,
  );
  const unit = unitOverridden
    ? (item.unitOverride as string)
    : item.unitSnapshot;
  return { qty: formatted, unit, unitOverridden };
}
