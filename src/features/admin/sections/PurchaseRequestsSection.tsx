"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Package,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyCard,
  Input,
  Modal,
  NumericInput,
  Spinner,
  toast,
} from "@/components/ui";
import {
  bulkReceiveItems,
  cancelPurchaseRequest,
  getPurchaseRequestStats,
  listPurchaseRequests,
  receiveItem,
  rejectItem,
} from "@/features/purchase-requests/actions";
import {
  isOk,
  type PurchaseRequestItem,
  type PurchaseRequestStatus,
  type PurchaseRequestWithItems,
} from "@/features/purchase-requests/types";
import { cn } from "@/lib/utils";
import { PurchaseRequestDetailModal } from "./PurchaseRequestDetailModal";
import { CreatePurchaseFromPrModal } from "./inventory/purchases/CreatePurchaseFromPrModal";

type FilterTab = "open" | "partial" | "completed" | "cancelled" | "all";

const FILTERS: Array<{ key: FilterTab; label: string }> = [
  { key: "open", label: "Open" },
  { key: "partial", label: "Sebagian" },
  { key: "completed", label: "Selesai" },
  { key: "cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
];

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  open: "Open",
  partial: "Sebagian Diterima",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_VARIANT: Record<
  PurchaseRequestStatus,
  "info" | "warning" | "success" | "neutral"
> = {
  open: "info",
  partial: "warning",
  completed: "success",
  cancelled: "neutral",
};

export function PurchaseRequestsSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("open");

  const [receiveTarget, setReceiveTarget] = useState<{
    item: PurchaseRequestItem;
    requestStatus: PurchaseRequestStatus;
  } | null>(null);
  const [receiveQty, setReceiveQty] = useState("0");
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PurchaseRequestWithItems | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  // Sesi AE-18 — bulk receive state.
  // Sesi AE-62s — `bulkChecked` per-item include/exclude. Default ON untuk
  // item dengan sisa > 0 dan belum rejected, OFF untuk yang sudah penuh /
  // rejected. User uncheck row yang mau di-skip (mis. masih PO supplier lain).
  const [bulkTarget, setBulkTarget] =
    useState<PurchaseRequestWithItems | null>(null);
  const [bulkQtys, setBulkQtys] = useState<Record<string, string>>({});
  const [bulkChecked, setBulkChecked] = useState<Record<string, boolean>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // Sesi AE-19 — per-item reject state.
  const [rejectTarget, setRejectTarget] = useState<{
    item: PurchaseRequestItem;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Sesi AE-57 — detail modal state (klik card → modal items)
  const [detailRequest, setDetailRequest] =
    useState<PurchaseRequestWithItems | null>(null);
  // Sesi AE-57 — "Tarik ke Pembelian" wizard, pre-fill dengan PR yang dipilih
  const [pullPrId, setPullPrId] = useState<string | null>(null);

  const {
    data: requests = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ["admin", "purchase-requests", { filter }],
    queryFn: async () => {
      const res = await listPurchaseRequests({ status: filter, limit: 50 });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });
  const error =
    queryError instanceof Error ? queryError.message : null;

  // Sesi AE-15 — PR stats dashboard.
  const statsQuery = useQuery({
    queryKey: ["admin", "purchase-requests", "stats"],
    queryFn: async () => {
      const res = await getPurchaseRequestStats();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 60 * 1000,
  });
  const stats = statsQuery.data ?? null;

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["admin", "purchase-requests"],
    });

  function openReceive(
    item: PurchaseRequestItem,
    requestStatus: PurchaseRequestStatus,
  ) {
    setReceiveTarget({ item, requestStatus });
    const remaining = Number(item.requestedQty) - Number(item.receivedQty);
    setReceiveQty(String(remaining > 0 ? remaining : 0));
  }

  async function submitReceive() {
    if (!receiveTarget) return;
    const qty = parseInt(receiveQty, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      toast.error("Qty tidak valid");
      return;
    }
    /* Sesi AE-62s — no cap di FE. Over-receive di-allow (acara/ramai),
     * backend return overReceivedQty di response untuk surface toast. */
    setReceiveSubmitting(true);
    const res = await receiveItem({
      itemId: receiveTarget.item.id,
      receivedQty: qty,
    });
    setReceiveSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const over = res.data.overReceivedQty;
    toast.success(
      over > 0
        ? `Tersimpan · +${over.toLocaleString("id-ID")} ${receiveTarget.item.unitSnapshot} ekstra dari diminta`
        : res.data.newStatus === "completed"
          ? "Selesai diterima"
          : "Qty diterima diperbarui",
    );
    setReceiveTarget(null);
    void refresh();
  }

  function openBulk(req: PurchaseRequestWithItems) {
    setBulkTarget(req);
    // Pre-fill qty dengan sisa (atau requested kalau belum diterima).
    // Pre-check rows yang masih ada sisa > 0 dan belum di-reject.
    const initialQty: Record<string, string> = {};
    const initialChecked: Record<string, boolean> = {};
    for (const it of req.items) {
      const sisa = Number(it.requestedQty) - Number(it.receivedQty);
      const target = sisa > 0 ? Number(it.requestedQty) : Number(it.receivedQty);
      initialQty[it.id] = String(target);
      initialChecked[it.id] = sisa > 0 && it.rejectedAt == null;
    }
    setBulkQtys(initialQty);
    setBulkChecked(initialChecked);
  }

  function bulkSetCheckedForAll(checked: boolean) {
    if (!bulkTarget) return;
    const next: Record<string, boolean> = {};
    for (const it of bulkTarget.items) {
      // Hard-skip rejected items: tetap unchecked (action-nya beda — lihat Reject button).
      next[it.id] = checked && it.rejectedAt == null;
    }
    setBulkChecked(next);
  }

  function bulkCheckOutstandingOnly() {
    if (!bulkTarget) return;
    const next: Record<string, boolean> = {};
    for (const it of bulkTarget.items) {
      const sisa = Number(it.requestedQty) - Number(it.receivedQty);
      next[it.id] = sisa > 0 && it.rejectedAt == null;
    }
    setBulkChecked(next);
  }

  function bulkFillRequestedForChecked() {
    if (!bulkTarget) return;
    setBulkQtys((prev) => {
      const next = { ...prev };
      for (const it of bulkTarget.items) {
        if (bulkChecked[it.id]) {
          next[it.id] = String(Number(it.requestedQty));
        }
      }
      return next;
    });
  }

  function bulkResetReceived() {
    if (!bulkTarget) return;
    const next: Record<string, string> = {};
    for (const it of bulkTarget.items) {
      next[it.id] = String(Number(it.receivedQty));
    }
    setBulkQtys(next);
  }

  async function submitBulk() {
    if (!bulkTarget) return;
    const items: Array<{ itemId: string; receivedQty: number }> = [];
    // Sesi AE-62s — kirim HANYA item yang di-checkbox-include. Yang unchecked
    // di-skip (state tidak berubah — mis. masih PO supplier lain).
    for (const it of bulkTarget.items) {
      if (!bulkChecked[it.id]) continue;
      const raw = bulkQtys[it.id] ?? "0";
      const n = parseFloat(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`Qty tidak valid untuk ${it.ingredientNameSnapshot}`);
        return;
      }
      // Over-receive di-allow di backend per AE-62s. UI tampilkan badge saja.
      items.push({ itemId: it.id, receivedQty: n });
    }
    if (items.length === 0) {
      toast.error("Centang minimal 1 item untuk diterima");
      return;
    }
    setBulkSubmitting(true);
    const res = await bulkReceiveItems({
      requestId: bulkTarget.id,
      items,
    });
    setBulkSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    const statusLabel =
      res.data.newStatus === "completed"
        ? "Selesai"
        : res.data.newStatus === "partial"
          ? "Sebagian"
          : "Open";
    toast.success(
      res.data.overReceivedTotal > 0
        ? `${res.data.itemsUpdated} item · +${res.data.overReceivedTotal} ekstra di ${res.data.overReceivedItems.length} item · ${statusLabel}`
        : `${res.data.itemsUpdated} item ter-update · ${statusLabel}`,
    );
    setBulkTarget(null);
    setBulkQtys({});
    setBulkChecked({});
    void refresh();
  }

  function openReject(item: PurchaseRequestItem) {
    setRejectTarget({ item });
    setRejectReason("");
  }

  async function submitReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      toast.error("Alasan minimal 3 karakter");
      return;
    }
    setRejectSubmitting(true);
    const res = await rejectItem({
      itemId: rejectTarget.item.id,
      reason,
    });
    setRejectSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Item di-reject · status PR: ${
        res.data.newStatus === "completed"
          ? "Selesai"
          : res.data.newStatus === "partial"
            ? "Sebagian"
            : res.data.newStatus === "cancelled"
              ? "Dibatalkan (semua di-reject)"
              : "Open"
      }`,
    );
    setRejectTarget(null);
    setRejectReason("");
    void refresh();
  }

  async function submitCancel() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length === 0) {
      toast.error("Alasan wajib diisi");
      return;
    }
    setCancelSubmitting(true);
    const res = await cancelPurchaseRequest({
      id: cancelTarget.id,
      reason,
    });
    setCancelSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Permintaan belanja dibatalkan");
    setCancelTarget(null);
    setCancelReason("");
    void refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-mahakan-green-900">
            <ClipboardList className="size-6" aria-hidden /> Permintaan
            Belanja
          </h1>
          <p className="text-sm text-neutral-700">
            Permintaan belanja dari kasir/staff. Alur:
            <strong> Open</strong> → terima sebagian (
            <strong>Sebagian</strong>) → semua diterima (
            <strong>Selesai</strong>). Klik{" "}
            <strong>Terima Beberapa Item</strong> untuk centang banyak item
            sekaligus — boleh terima lebih dari diminta kalau perlu beli
            ekstra (acara/ramai).
          </p>
        </div>
      </header>

      {/* Sesi AE-15 — PR Stats dashboard cards */}
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PrStatCard
            Icon={Package}
            label="Open + Partial"
            value={String(stats.openCount + stats.partialCount)}
            sub={
              stats.pendingItemsTotal > 0
                ? `${stats.pendingItemsTotal} item belum diterima`
                : "Tidak ada pending"
            }
            accent={
              stats.openCount + stats.partialCount > 0 ? "warning" : "default"
            }
          />
          <PrStatCard
            Icon={AlertTriangle}
            label="Aging > 3 Hari"
            value={String(stats.agingOpenCount)}
            sub={
              stats.agingOpenCount > 0
                ? "PR open yang perlu segera ditindaklanjuti"
                : "Semua PR baru"
            }
            accent={stats.agingOpenCount > 0 ? "danger" : "default"}
          />
          <PrStatCard
            Icon={CheckCircle2}
            label="Selesai Bulan Ini"
            value={String(stats.completedThisMonth)}
            sub="Status completed (semua item diterima)"
            accent="success"
          />
          <PrStatCard
            Icon={TrendingUp}
            label="Total Lifetime"
            value={String(
              stats.openCount +
                stats.partialCount +
                stats.completedCount +
                stats.cancelledCount,
            )}
            sub={`${stats.completedCount} selesai · ${stats.cancelledCount} dibatalkan`}
            accent="default"
          />
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Filter status"
        className="flex flex-wrap gap-1 border-b border-neutral-200"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              filter === f.key
                ? "border-mahakan-green-700 text-mahakan-green-900"
                : "border-transparent text-neutral-500 hover:text-neutral-900",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-8 text-mahakan-green-700" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      ) : requests.length === 0 ? (
        <EmptyCard
          icon={ClipboardList}
          title="Belum ada permintaan"
          description="Kasir belum membuat permintaan belanja untuk filter ini."
        />
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              onShowDetail={(r) => setDetailRequest(r)}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        title="Terima Barang"
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setReceiveTarget(null)}
              disabled={receiveSubmitting}
            >
              Batal
            </Button>
            <Button onClick={submitReceive} disabled={receiveSubmitting}>
              {receiveSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        {receiveTarget ? (
          (() => {
            const requested = Number(receiveTarget.item.requestedQty);
            const prevReceived = Number(receiveTarget.item.receivedQty);
            const unit = receiveTarget.item.unitSnapshot;
            const parsedQty = parseInt(receiveQty || "0", 10);
            const validQty = Number.isFinite(parsedQty) ? parsedQty : 0;
            const overQty = Math.max(0, validQty - requested);
            const sisa = Math.max(0, requested - prevReceived);
            return (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-neutral-600">Bahan</p>
                  <p className="text-base font-medium text-neutral-900">
                    {receiveTarget.item.ingredientNameSnapshot}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-neutral-600">Diminta</p>
                    <p className="font-medium text-neutral-900 font-mono">
                      {requested.toLocaleString("id-ID")} {unit}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-600">Sudah diterima</p>
                    <p className="font-medium text-neutral-900 font-mono">
                      {prevReceived.toLocaleString("id-ID")} {unit}
                    </p>
                  </div>
                  <div>
                    <p className="text-neutral-600">Sisa</p>
                    <p
                      className={cn(
                        "font-medium font-mono",
                        sisa > 0 ? "text-warning-700" : "text-mahakan-green-700",
                      )}
                    >
                      {sisa.toLocaleString("id-ID")} {unit}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Total qty diterima ({unit})
                  </label>
                  <NumericInput
                    value={receiveQty}
                    onChange={setReceiveQty}
                    allowDecimal={false}
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-neutral-600">
                      Isi total kumulatif (bukan tambahan). Lebih dari diminta
                      boleh — misal acara atau lagi rame.
                    </p>
                    {overQty > 0 ? (
                      <Badge variant="success">
                        +{overQty.toLocaleString("id-ID")} {unit} ekstra
                      </Badge>
                    ) : validQty > 0 && validQty === requested ? (
                      <Badge variant="success">Penuh</Badge>
                    ) : validQty > 0 && validQty < requested ? (
                      <Badge variant="warning">
                        Kurang {(requested - validQty).toLocaleString("id-ID")}{" "}
                        {unit}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>

      {/* Sesi AE-18 (revamped AE-62s) — Bulk Receive Modal dengan checkbox-include.
       * Tim purchasing minta: "ngga harus satu-satu di terima nya cuma dikecualikan
       * satu aja". Default centang = item dengan sisa > 0; user uncheck row yang
       * masih PO supplier lain (mis. minyak ayam). Yang unchecked di-skip dari
       * bulk submit. Plus allow over-receive (badge "+N ekstra" di kolom Total). */}
      <Modal
        open={!!bulkTarget}
        onClose={() => setBulkTarget(null)}
        title="Terima Beberapa Item Sekaligus"
        description={
          bulkTarget
            ? `${bulkTarget.items.length} item dari ${formatRequestLabel(bulkTarget)} — centang yang mau diterima, uncheck untuk skip.`
            : undefined
        }
        size="2xl"
        footer={
          bulkTarget
            ? (() => {
                const checkedCount = bulkTarget.items.filter(
                  (it) => bulkChecked[it.id],
                ).length;
                let overTotal = 0;
                let overCount = 0;
                for (const it of bulkTarget.items) {
                  if (!bulkChecked[it.id]) continue;
                  const n = parseFloat(
                    (bulkQtys[it.id] ?? "0").replace(",", "."),
                  );
                  if (Number.isFinite(n)) {
                    const over = n - Number(it.requestedQty);
                    if (over > 0) {
                      overTotal += over;
                      overCount += 1;
                    }
                  }
                }
                return (
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-neutral-600">
                      <span className="font-medium text-neutral-900">
                        {checkedCount} dari {bulkTarget.items.length} item
                      </span>{" "}
                      dipilih
                      {overTotal > 0 ? (
                        <>
                          {" · "}
                          <span className="font-medium text-mahakan-green-700">
                            +{overTotal.toLocaleString("id-ID")} ekstra di{" "}
                            {overCount} item
                          </span>
                        </>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setBulkTarget(null)}
                        disabled={bulkSubmitting}
                      >
                        Batal
                      </Button>
                      <Button
                        onClick={submitBulk}
                        disabled={bulkSubmitting || checkedCount === 0}
                      >
                        {bulkSubmitting
                          ? "Menyimpan…"
                          : `Terima ${checkedCount} Item`}
                      </Button>
                    </div>
                  </div>
                );
              })()
            : null
        }
      >
        {bulkTarget ? (
          <div className="space-y-3">
            <div className="rounded-md border border-info-100 bg-info-50/40 px-3 py-2 text-[11px] text-info-700">
              Centang item yang mau diterima. Uncheck untuk skip (mis. masih
              tunggu supplier lain). Boleh terima <strong>lebih dari diminta</strong>{" "}
              kalau perlu — badge hijau muncul kalau over. Yang unchecked
              state-nya tidak berubah.
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => bulkSetCheckedForAll(true)}
                disabled={bulkSubmitting}
              >
                <CheckCheck className="size-4" /> Centang Semua
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={bulkCheckOutstandingOnly}
                disabled={bulkSubmitting}
              >
                Outstanding saja
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => bulkSetCheckedForAll(false)}
                disabled={bulkSubmitting}
              >
                Uncheck semua
              </Button>
              <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />
              <Button
                size="sm"
                variant="ghost"
                onClick={bulkFillRequestedForChecked}
                disabled={bulkSubmitting}
              >
                Penuhi sisa (yang dicentang)
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={bulkResetReceived}
                disabled={bulkSubmitting}
              >
                Reset ke nilai awal
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-600">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left font-medium">
                      <span className="sr-only">Pilih</span>
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Bahan</th>
                    <th className="px-3 py-2 text-right font-medium">Diminta</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Sudah Diterima
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Total Diterima
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {bulkTarget.items.map((it) => {
                    const requested = Number(it.requestedQty);
                    const previousReceived = Number(it.receivedQty);
                    const sisa = Math.max(0, requested - previousReceived);
                    const checked = !!bulkChecked[it.id];
                    const isRejected = it.rejectedAt != null;
                    const currentVal = bulkQtys[it.id] ?? "0";
                    const parsedCurrent = parseFloat(
                      currentVal.replace(",", "."),
                    );
                    const overQty = Number.isFinite(parsedCurrent)
                      ? Math.max(0, parsedCurrent - requested)
                      : 0;
                    const isFulfilled =
                      Number.isFinite(parsedCurrent) &&
                      parsedCurrent >= requested;
                    return (
                      <tr
                        key={it.id}
                        className={cn(
                          "transition-colors",
                          isRejected
                            ? "bg-neutral-50/50 opacity-60"
                            : !checked
                              ? "bg-neutral-50/40"
                              : "",
                        )}
                      >
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isRejected || bulkSubmitting}
                            onChange={(e) =>
                              setBulkChecked((prev) => ({
                                ...prev,
                                [it.id]: e.target.checked,
                              }))
                            }
                            aria-label={`Pilih ${it.ingredientNameSnapshot}`}
                            className="size-4 cursor-pointer accent-mahakan-green-700 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p
                            className={cn(
                              "font-medium",
                              checked
                                ? "text-neutral-900"
                                : "text-neutral-500",
                            )}
                          >
                            {it.ingredientNameSnapshot}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-neutral-500">
                            <span>{it.unitSnapshot}</span>
                            {isRejected ? (
                              <Badge variant="danger">Ditolak</Badge>
                            ) : sisa > 0 ? (
                              <span>· sisa {sisa.toLocaleString("id-ID")}</span>
                            ) : (
                              <Badge variant="success">Penuh</Badge>
                            )}
                            {it.notes ? <span>· {it.notes}</span> : null}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {requested.toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-neutral-600">
                          {previousReceived.toLocaleString("id-ID")}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {overQty > 0 ? (
                              <Badge variant="success">
                                +{overQty.toLocaleString("id-ID")}
                              </Badge>
                            ) : null}
                            <input
                              type="text"
                              inputMode="decimal"
                              value={currentVal}
                              disabled={!checked || isRejected || bulkSubmitting}
                              onChange={(e) =>
                                setBulkQtys((prev) => ({
                                  ...prev,
                                  [it.id]: e.target.value,
                                }))
                              }
                              className={cn(
                                "h-9 w-24 rounded-md border bg-white px-2 text-right font-mono text-sm tabular-nums",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:border-mahakan-green-700",
                                "disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400",
                                !checked
                                  ? "border-neutral-200"
                                  : overQty > 0
                                    ? "border-mahakan-green-700 text-mahakan-green-900 bg-mahakan-green-50/40"
                                    : isFulfilled
                                      ? "border-mahakan-green-700 text-mahakan-green-900"
                                      : parsedCurrent > 0
                                        ? "border-warning-500 text-warning-700"
                                        : "border-neutral-300 text-neutral-900",
                              )}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Sesi AE-19 — Reject single item modal */}
      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Tolak Item"
        description={
          rejectTarget
            ? `${rejectTarget.item.ingredientNameSnapshot} — ${Number(rejectTarget.item.requestedQty)} ${rejectTarget.item.unitSnapshot}`
            : undefined
        }
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={rejectSubmitting}
            >
              Batal
            </Button>
            <Button
              onClick={submitReject}
              disabled={rejectSubmitting || rejectReason.trim().length < 3}
              className="!bg-danger-500 hover:!bg-danger-600"
            >
              {rejectSubmitting ? "Memproses…" : "Tolak Item"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-600">
            Item yang di-reject akan dikecualikan dari hitungan pemenuhan PR
            (item lain tetap bisa di-terima). Status PR auto-recompute. Kalau
            SEMUA item di-reject, PR otomatis di-cancel.
          </p>
          <div className="flex flex-wrap gap-1">
            {[
              "Supplier kosong",
              "Harga terlalu mahal",
              "Sudah ada di gudang",
              "Salah input dari kasir",
            ].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setRejectReason((prev) =>
                    prev.trim().length === 0
                      ? t
                      : `${prev.trim()} — ${t}`,
                  )
                }
                disabled={rejectSubmitting}
                className="rounded-full border border-danger-300 bg-danger-50 px-2.5 py-1 text-[11px] font-medium text-danger-700 transition-colors hover:bg-danger-100 disabled:opacity-50"
              >
                + {t}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-900">
              Alasan Tolak <span className="text-danger-500">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value.slice(0, 300))}
              rows={3}
              placeholder="Mis: supplier ga punya stok hari ini"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-500"
              disabled={rejectSubmitting}
            />
            <p
              className={cn(
                "mt-1 text-[11px]",
                rejectReason.trim().length < 3
                  ? "text-danger-700"
                  : "text-neutral-500",
              )}
            >
              {rejectReason.trim().length < 3
                ? "Minimal 3 karakter"
                : "Alasan terisi"}
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="Batalkan Permintaan Belanja"
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelSubmitting}
            >
              Tidak
            </Button>
            <Button
              variant="destructive"
              onClick={submitCancel}
              disabled={cancelSubmitting}
            >
              {cancelSubmitting ? "Membatalkan..." : "Ya, Batalkan"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            Permintaan akan ditandai dibatalkan. Item yang sudah diterima
            sebagian tetap tersimpan sebagai catatan.
          </p>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Alasan
            </label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Mis. duplikat, sudah dibeli langsung"
            />
          </div>
        </div>
      </Modal>

      {/* Sesi AE-57 — PR detail modal (replaces inline card items) */}
      <PurchaseRequestDetailModal
        request={detailRequest}
        onClose={() => setDetailRequest(null)}
        onReceive={(item, reqStatus) => {
          setDetailRequest(null);
          openReceive(item, reqStatus);
        }}
        onBulkReceive={(r) => {
          setDetailRequest(null);
          openBulk(r);
        }}
        onRejectItem={(item) => {
          setDetailRequest(null);
          openReject(item);
        }}
        onCancel={(r) => {
          setDetailRequest(null);
          setCancelTarget(r);
          setCancelReason("");
        }}
        onPullToPurchase={(r) => {
          setDetailRequest(null);
          setPullPrId(r.id);
        }}
      />

      {/* Sesi AE-57 — Tarik dari PR wizard (pre-fill PR yang dipilih) */}
      <CreatePurchaseFromPrModal
        open={pullPrId !== null}
        prefilledPrId={pullPrId}
        onClose={() => setPullPrId(null)}
        onSaved={() => {
          setPullPrId(null);
          void refresh();
        }}
      />
    </div>
  );
}

interface RequestCardProps {
  request: PurchaseRequestWithItems;
  onShowDetail: (r: PurchaseRequestWithItems) => void;
}

/* Sesi AE-57 — RequestCard sekarang summary-only.
 * Items table di-pindah ke PurchaseRequestDetailModal yang dibuka via
 * "Lihat Detail" / klik card. Owner request: list compact biar gampang
 * scan saat ada banyak PR. */
function RequestCard({ request, onShowDetail }: RequestCardProps) {
  const totalRequested = request.items.reduce(
    (sum, i) => sum + Number(i.requestedQty),
    0,
  );
  const totalReceived = request.items.reduce(
    (sum, i) => sum + Number(i.receivedQty),
    0,
  );
  const fulfillPercent =
    totalRequested > 0
      ? Math.round((totalReceived / totalRequested) * 100)
      : 0;
  const outstandingItemCount = request.items.filter(
    (i) => !i.rejectedAt && Number(i.receivedQty) < Number(i.requestedQty),
  ).length;
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-mahakan-green-700 hover:shadow-sm"
      onClick={() => onShowDetail(request)}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-5 py-3">
        <div className="space-y-1">
          <CardTitle className="text-sm">
            {formatRequestLabel(request)}
          </CardTitle>
          <p className="text-xs text-neutral-600">
            {request.createdByName ?? "—"} ·{" "}
            {request.createdAt.toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={STATUS_VARIANT[request.status]}>
            {STATUS_LABEL[request.status]}
          </Badge>
          {request.whatsappSentAt ? (
            <p className="flex items-center gap-1 text-[10px] text-neutral-400">
              <MessageCircle className="size-3" /> WA dikirim
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-3 pt-0">
        {/* Summary row: item count + qty + progress bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-700">
          <div className="flex items-center gap-3">
            <span>
              <Package className="mr-1 inline size-3.5 text-neutral-500" />
              {request.items.length} bahan
              {outstandingItemCount > 0 ? (
                <span className="ml-1 text-warning-500">
                  ({outstandingItemCount} outstanding)
                </span>
              ) : null}
            </span>
            <span className="font-mono">
              {totalReceived.toLocaleString("id-ID")} /{" "}
              {totalRequested.toLocaleString("id-ID")}
            </span>
          </div>
          {totalRequested > 0 ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold">
                {fulfillPercent}%
              </span>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={cn(
                    "h-full transition-all",
                    fulfillPercent === 100
                      ? "bg-mahakan-green-700"
                      : fulfillPercent > 0
                        ? "bg-info-400"
                        : "bg-warning-400",
                  )}
                  style={{ width: `${Math.min(100, fulfillPercent)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
        {request.notes ? (
          <p className="mt-2 line-clamp-1 text-[11px] italic text-neutral-500">
            Catatan: {request.notes}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatRequestLabel(request: PurchaseRequestWithItems): string {
  if (request.shiftStartedAt) {
    return `Shift ${request.shiftStartedAt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  }
  return `Permintaan ${request.createdAt.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

// ============================================================
// Sesi AE-15 — PR stats card
// ============================================================

function PrStatCard({
  Icon,
  label,
  value,
  sub,
  accent,
}: {
  Icon: typeof ClipboardList;
  label: string;
  value: string;
  sub: string;
  accent: "default" | "warning" | "danger" | "success";
}) {
  const accentClasses = {
    default: "border-neutral-200 bg-white",
    warning: "border-warning-300 bg-warning-100",
    danger: "border-danger-300 bg-danger-100",
    success: "border-mahakan-green-200 bg-mahakan-green-50",
  }[accent];
  const iconColor = {
    default: "text-neutral-500",
    warning: "text-warning-500",
    danger: "text-danger-500",
    success: "text-mahakan-green-700",
  }[accent];
  return (
    <div className={cn("rounded-xl border p-4", accentClasses)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-600">
        <Icon className={cn("size-4", iconColor)} aria-hidden />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-neutral-900">
        {value}
      </div>
      <p className="mt-0.5 text-[11px] text-neutral-600">{sub}</p>
    </div>
  );
}
