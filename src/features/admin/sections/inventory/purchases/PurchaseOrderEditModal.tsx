"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  getPurchaseEditContext,
  isOk,
  updatePurchaseOrder,
  type PaymentMethod,
  type PurchaseDetail,
} from "@/features/purchases";
import {
  listAtomicIngredients,
  isOk as inventoryIsOk,
  type Ingredient,
} from "@/features/inventory";
import {
  listSuppliers,
  isOk as suppliersIsOk,
  type Supplier,
} from "@/features/suppliers";
import { formatRupiah } from "@/lib/format";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  displayUnit,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
import {
  applyQtyChange,
  applyTotalChange,
  applyUnitChange,
  applyUnitCostChange,
  formatPurchaseQty,
  parsePurchaseQty,
  parseRupiahSafe,
  todayJakartaIso,
} from "./purchase-line-helpers";
import { cn } from "@/lib/utils";

/**
 * Sesi AE-188 — Edit PO (permintaan owner).
 *
 * Alur yang dilayani: PIC Operasional sering harus memproses penerimaan
 * barang sebelum nota/harga final datang, jadi PO dibuat dengan harga Rp 0
 * dulu. Modal ini yang dipakai mengisi harga aslinya begitu nota datang —
 * dan server ikut merapikan nilai GR, pengeluaran kas, serta jurnalnya.
 *
 * Dua wajah, dipilih server lewat `priceOnly`:
 *  - PO belum diterima → semua boleh diubah (baris, qty, satuan, supplier).
 *  - PO sudah ada penerimaan → hanya harga (plus invoice/catatan/tanggal),
 *    karena qty & satuan sudah terlanjur jadi movement stok + baris GR.
 */

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "Transfer BCA" },
  { value: "transfer_bri", label: "Transfer BRI" },
  { value: "transfer_other", label: "Transfer lain" },
  { value: "top", label: "TOP (kredit)" },
];

interface EditRow {
  /** purchase_items.id — null untuk baris yang baru ditambah di layar ini. */
  itemId: string | null;
  key: string;
  ingredientId: string;
  /** Nama snapshot dari server, dipakai saat bahan tak lagi ada di master. */
  nameSnapshot: string;
  qty: string;
  unit: string;
  /** Nilai `unit_override` apa adanya dari server. Dipakai saat mode
   * harga-saja supaya satuan dikirim balik persis seperti tersimpan —
   * lihat catatan di `onSubmit`. */
  originalUnitOverride: string | null;
  unitCost: string;
  total: string;
  inputMode: "unit" | "total";
  purchaseRequestItemId: string | null;
}

function newRow(): EditRow {
  return {
    itemId: null,
    key: Math.random().toString(36).slice(2),
    ingredientId: "",
    nameSnapshot: "",
    qty: "",
    unit: "",
    originalUnitOverride: null,
    unitCost: "",
    total: "",
    inputMode: "unit",
    purchaseRequestItemId: null,
  };
}

function rowsFromDetail(detail: PurchaseDetail): EditRow[] {
  return detail.items.map((it) => {
    const qtyValue = Number(it.qtyDecimal ?? it.qty);
    const qty = Number.isFinite(qtyValue) ? qtyValue : it.qty;
    return {
      itemId: it.id,
      key: it.id,
      ingredientId: it.ingredientId,
      nameSnapshot: it.ingredientNameSnapshot,
      qty: formatPurchaseQty(qty),
      unit: it.unitOverride ?? it.unitSnapshot,
      originalUnitOverride: it.unitOverride ?? null,
      unitCost: String(it.unitCost),
      total: String(Math.round(qty * it.unitCost)),
      inputMode: "unit" as const,
      purchaseRequestItemId: it.purchaseRequestItemId ?? null,
    };
  });
}

interface PurchaseOrderEditModalProps {
  open: boolean;
  purchaseId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PurchaseOrderEditModal({
  open,
  purchaseId,
  onClose,
  onSaved,
}: PurchaseOrderEditModalProps) {
  const [loading, setLoading] = useState(true);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [priceOnly, setPriceOnly] = useState(false);
  const [goodsReceiptCount, setGoodsReceiptCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [ingredientList, setIngredientList] = useState<Ingredient[]>([]);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [purchaseDate, setPurchaseDate] = useState(todayJakartaIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentTerm, setPaymentTerm] = useState("0");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [originalTotal, setOriginalTotal] = useState(0);

  useEffect(() => {
    if (!open || !purchaseId) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setBlockedReason(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [ctxRes, ingRes, supRes] = await Promise.all([
        getPurchaseEditContext(purchaseId),
        listAtomicIngredients({ activeOnly: true }),
        listSuppliers({ activeOnly: false }),
      ]);
      if (cancelled) return;
      if (inventoryIsOk(ingRes)) setIngredientList(ingRes.data.items);
      if (suppliersIsOk(supRes)) setSupplierList(supRes.data);
      if (!isOk(ctxRes)) {
        setBlockedReason(ctxRes.error.message);
        setLoading(false);
        return;
      }
      const { detail, priceOnly: po, blockedReason: reason } = ctxRes.data;
      setPriceOnly(po);
      setGoodsReceiptCount(ctxRes.data.goodsReceiptCount);
      setBlockedReason(reason);
      setSupplierId(detail.supplierId);
      setPurchaseDate(detail.purchaseDate);
      setPaymentMethod(detail.paymentMethod);
      setPaymentTerm(String(detail.paymentTermDays ?? 0));
      setInvoiceNo(detail.invoiceNo ?? "");
      setNotes(detail.notes ?? "");
      setReceiptUrls(
        detail.receiptImageUrls && detail.receiptImageUrls.length > 0
          ? detail.receiptImageUrls
          : detail.receiptImageUrl
            ? [detail.receiptImageUrl]
            : [],
      );
      setRows(rowsFromDetail(detail));
      setOriginalTotal(Number(detail.totalAmount));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, purchaseId]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const ing of ingredientList) m.set(ing.id, ing);
    return m;
  }, [ingredientList]);

  const total = useMemo(() => {
    let t = 0;
    for (const r of rows) {
      const qty = parsePurchaseQty(r.qty);
      const cost = parseRupiahSafe(r.unitCost);
      if (Number.isFinite(qty) && qty > 0 && cost >= 0) {
        t += Math.round(qty * cost);
      }
    }
    return t;
  }, [rows]);

  const patchRow = useCallback(
    (key: string, fn: (r: EditRow) => EditRow) => {
      setRows((prev) => prev.map((r) => (r.key === key ? fn(r) : r)));
    },
    [],
  );

  /* TOP wajib tempo > 0; non-TOP dipaksa 0 (mirror aturan server). */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (paymentMethod === "top") {
      const n = parseInt(paymentTerm, 10);
      if (!Number.isFinite(n) || n <= 0) setPaymentTerm("7");
    } else if (paymentTerm !== "0") {
      setPaymentTerm("0");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [paymentMethod, paymentTerm]);

  async function onSubmit() {
    if (submitting || !purchaseId) return;
    const bail = (msg: string) => {
      toast.error(msg);
    };

    const items: Array<{
      id: string | null;
      ingredientId: string;
      qty: number;
      unitCost: number;
      unit: string | null;
      purchaseRequestItemId: string | null;
    }> = [];
    for (const r of rows) {
      const untouched =
        !r.ingredientId && r.qty.trim() === "" && r.unitCost.trim() === "";
      if (untouched) continue;
      if (!r.ingredientId) {
        bail("Setiap baris wajib pilih bahan");
        return;
      }
      const qty = parsePurchaseQty(r.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        bail("Qty tidak valid pada salah satu baris");
        return;
      }
      const cost = parseRupiahSafe(r.unitCost);
      if (cost < 0) {
        bail("Harga tidak boleh negatif");
        return;
      }
      const ing = ingredientById.get(r.ingredientId);
      const masterUnit = ing?.unit ?? "";
      const chosen = r.unit?.trim() || masterUnit;
      /* Mode harga-saja: satuan dikunci server, jadi kirim balik PERSIS
       * seperti tersimpan. Menghitung ulang di sini berbahaya — kalau
       * bahannya sudah dinonaktifkan ia tidak ada di daftar master
       * (`activeOnly`), `masterUnit` jadi "" dan override null berubah jadi
       * non-null → server menolak UNIT_LOCKED, memblokir justru alur
       * isi-harga-belakangan yang jadi alasan fitur ini ada. */
      items.push({
        id: r.itemId,
        ingredientId: r.ingredientId,
        qty,
        unitCost: cost,
        /* Simpan override hanya kalau beda dari master — sama dengan
         * Catat Pembelian, supaya tampilan jatuh ke unitSnapshot historis. */
        unit: priceOnly
          ? r.originalUnitOverride
          : chosen && chosen !== masterUnit
            ? chosen
            : null,
        purchaseRequestItemId: r.purchaseRequestItemId,
      });
    }
    if (items.length === 0) {
      bail("Minimal 1 baris bahan");
      return;
    }
    const ids = items.map((i) => i.ingredientId);
    if (new Set(ids).size !== ids.length) {
      bail("Bahan duplikat dalam 1 PO — gabungkan jadi 1 baris");
      return;
    }
    const term = parseInt(paymentTerm, 10);
    if (paymentMethod === "top" && (!Number.isFinite(term) || term <= 0)) {
      bail("TOP wajib > 0 hari");
      return;
    }

    setSubmitting(true);
    const res = await updatePurchaseOrder({
      id: purchaseId,
      supplierId,
      purchaseDate,
      paymentMethod,
      paymentTermDays: paymentMethod === "top" ? term : 0,
      invoiceNo: invoiceNo.trim() || null,
      notes: notes.trim() || null,
      receiptImageUrls: receiptUrls.length > 0 ? receiptUrls : null,
      items,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      bail(res.error.message);
      return;
    }
    const d = res.data;
    const extras: string[] = [];
    if (d.receiptsResynced > 0)
      extras.push(`${d.receiptsResynced} penerimaan disesuaikan`);
    if (d.expensesTouched > 0)
      extras.push(`${d.expensesTouched} pengeluaran kas diperbarui`);
    toast.success(
      `PO tersimpan — total ${formatRupiah(d.totalAmount)}${
        extras.length > 0 ? ` (${extras.join(", ")})` : ""
      }`,
    );
    onSaved();
  }

  const locked = blockedReason !== null;
  const totalChanged = total !== originalTotal;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit PO"
      description="Ubah PO yang sudah tersimpan — termasuk mengisi harga yang tadinya Rp 0."
      size="full"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {locked ? "Tutup" : "Batal"}
          </Button>
          {!locked ? (
            <Button onClick={onSubmit} loading={submitting} disabled={loading}>
              Simpan Perubahan
            </Button>
          ) : null}
        </>
      }
    >
      {loading ? (
        <div className="space-y-2" role="status" aria-label="Memuat">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : locked ? (
        <p className="rounded-md border border-warning-500/50 bg-warning-100/40 px-3 py-2.5 text-sm text-neutral-800">
          {blockedReason}
        </p>
      ) : (
        <div className="space-y-4">
          {priceOnly ? (
            <div className="rounded-md border border-info-300 bg-info-50 px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-info-700">
                <Lock className="size-4" aria-hidden /> Barang sudah diterima —
                yang bisa diubah tinggal harga
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-800">
                PO ini punya {goodsReceiptCount} catatan penerimaan (GR).
                Qty, satuan, daftar bahan, supplier, dan metode pembayaran
                dikunci karena sudah terlanjur jadi catatan stok. Begitu harga
                disimpan, nilai penerimaan, pengeluaran kas, dan jurnalnya
                ikut disesuaikan otomatis.
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
              PO ini belum ada penerimaan barang, jadi semuanya masih bebas
              diubah. Harga boleh dibiarkan <strong>Rp 0</strong> dulu supaya
              PIC Operasional bisa memproses Terima Barang — nanti tinggal
              buka layar ini lagi saat notanya datang.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <DatePicker
              label="Tanggal PO"
              value={purchaseDate}
              onChange={(v) => setPurchaseDate(v ?? todayJakartaIso())}
              clearable={false}
            />
            <Combobox
              label="Supplier"
              placeholder="Pilih supplier"
              searchPlaceholder="Cari supplier…"
              clearable
              disabled={priceOnly}
              groups={[
                {
                  label: "",
                  options: supplierList.map((s) => ({
                    value: s.id,
                    label: s.name,
                    hint:
                      s.defaultPaymentTermDays > 0
                        ? `TOP ${s.defaultPaymentTermDays}h`
                        : "Cash",
                  })),
                } satisfies ComboboxGroup,
              ]}
              value={supplierId}
              onChange={(v) => setSupplierId(v)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Select
              label="Metode Pembayaran"
              options={PAYMENT_OPTIONS.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
              disabled={priceOnly}
            />
            <Input
              label="TOP (hari)"
              type="text"
              inputMode="numeric"
              value={paymentTerm}
              onChange={(e) => setPaymentTerm(e.target.value)}
              disabled={paymentMethod !== "top"}
              hint={
                paymentMethod === "top"
                  ? "Jatuh tempo = tanggal PO + sekian hari"
                  : "Hanya aktif untuk TOP"
              }
            />
            <Input
              label="No. Invoice"
              placeholder="mis. INV-2026-0042"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              hint="Biasanya baru ada saat nota datang"
            />
          </div>

          <Input
            label="Catatan"
            placeholder="mis. harga menyusul nota dari supplier"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Daftar Bahan
              </h3>
              {!priceOnly ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRows((prev) => [...prev, newRow()])}
                >
                  <Plus className="size-4" aria-hidden /> Tambah Bahan
                </Button>
              ) : null}
            </div>
            <div className="space-y-3 rounded-md border border-neutral-200 p-2">
              <div className="hidden gap-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 md:grid md:grid-cols-[minmax(260px,2.2fr)_90px_120px_180px_180px_44px]">
                <span>Bahan</span>
                <span>QTY</span>
                <span>Satuan</span>
                <span>Harga / Satuan</span>
                <span>Total</span>
                <span />
              </div>
              {rows.map((row, idx) => {
                const ing = row.ingredientId
                  ? ingredientById.get(row.ingredientId)
                  : null;
                const qtyN = parsePurchaseQty(row.qty);
                const costN = parseRupiahSafe(row.unitCost);
                const hasQty = Number.isFinite(qtyN) && qtyN > 0;
                const lineTotal = hasQty && costN >= 0 ? Math.round(qtyN * costN) : 0;
                const ingredientPacks = (ing?.packConversions ??
                  null) as IngredientPackConversion[] | null;
                const { options: unitOptions, value: unit } =
                  buildUnitSelectOptions({
                    presets: CANONICAL_UNIT_PRESETS,
                    packLabels: [
                      ing?.unit ?? "",
                      ing?.unitBelanja ?? "",
                      ing?.unitTracking ?? "",
                      ...(ingredientPacks?.map((p) => p.unitLabel) ?? []),
                    ],
                    current: row.unit || ing?.unit || "",
                  });
                return (
                  <div key={row.key} className="rounded-md bg-neutral-50 p-2">
                    <div className="grid gap-2 md:grid-cols-[minmax(260px,2.2fr)_90px_120px_180px_180px_44px]">
                      {priceOnly ? (
                        <div className="flex min-h-10 items-center rounded-md border border-neutral-200 bg-neutral-100 px-3 text-sm text-neutral-700">
                          {row.nameSnapshot ||
                            ing?.name ||
                            "(bahan tidak dikenal)"}
                        </div>
                      ) : (
                        <Combobox
                          ariaLabel={`Bahan ${idx + 1}`}
                          placeholder="Pilih bahan…"
                          searchPlaceholder="Cari bahan…"
                          clearable={false}
                          groups={[
                            {
                              label: "",
                              options: ingredientList.map((i) => ({
                                value: i.id,
                                label: i.name,
                                hint: displayUnit(i.unit),
                                keywords: [i.section ?? "", i.unit],
                              })),
                            } satisfies ComboboxGroup,
                          ]}
                          value={row.ingredientId || null}
                          onChange={(v) =>
                            patchRow(row.key, (r) => ({
                              ...r,
                              ingredientId: v ?? "",
                              unit:
                                r.unit ||
                                displayUnit(
                                  (v ? ingredientById.get(v)?.unit : "") ?? "",
                                ),
                            }))
                          }
                        />
                      )}
                      <Input
                        aria-label={`QTY baris ${idx + 1}`}
                        placeholder="QTY"
                        type="text"
                        inputMode="decimal"
                        value={row.qty}
                        disabled={priceOnly}
                        onChange={(e) =>
                          patchRow(row.key, (r) => ({
                            ...r,
                            ...applyQtyChange(r, e.target.value),
                          }))
                        }
                      />
                      <Select
                        ariaLabel={`Satuan baris ${idx + 1}`}
                        options={unitOptions}
                        value={unit}
                        disabled={priceOnly || !ing}
                        onValueChange={(v) =>
                          patchRow(row.key, (r) => ({
                            ...r,
                            ...applyUnitChange(r, r.unit, v),
                            unit: v,
                          }))
                        }
                      />
                      <div className="relative">
                        <Input
                          aria-label={`Harga per ${unit || "unit"} baris ${idx + 1}`}
                          placeholder={row.inputMode === "total" ? "auto" : "0"}
                          type="text"
                          inputMode="numeric"
                          value={row.unitCost}
                          onChange={(e) =>
                            patchRow(row.key, (r) => ({
                              ...r,
                              ...applyUnitCostChange(r, e.target.value),
                            }))
                          }
                          className={cn(
                            "pr-16",
                            row.inputMode === "total" &&
                              "bg-neutral-100 text-neutral-600",
                          )}
                        />
                        <span
                          className={cn(
                            "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            row.inputMode === "total"
                              ? "bg-neutral-200 text-neutral-500"
                              : "bg-mahakan-green-100 text-mahakan-green-900",
                          )}
                          aria-hidden
                        >
                          {row.inputMode === "total"
                            ? "auto"
                            : `per ${unit || "—"}`}
                        </span>
                      </div>
                      <div className="relative">
                        <Input
                          aria-label={`Total baris ${idx + 1}`}
                          placeholder={row.inputMode === "unit" ? "auto" : "0"}
                          type="text"
                          inputMode="numeric"
                          value={row.total}
                          onChange={(e) =>
                            patchRow(row.key, (r) => ({
                              ...r,
                              ...applyTotalChange(r, e.target.value),
                            }))
                          }
                          className={cn(
                            "pr-16",
                            row.inputMode === "unit" &&
                              "bg-neutral-100 text-neutral-600",
                          )}
                        />
                        <span
                          className={cn(
                            "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            row.inputMode === "unit"
                              ? "bg-neutral-200 text-neutral-500"
                              : "bg-mahakan-green-100 text-mahakan-green-900",
                          )}
                          aria-hidden
                        >
                          {row.inputMode === "unit" ? "auto" : "total"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRows((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((r) => r.key !== row.key),
                          )
                        }
                        aria-label="Hapus baris"
                        title={
                          priceOnly
                            ? "Tidak bisa dihapus — barang sudah diterima"
                            : "Hapus baris"
                        }
                        className="text-danger-500 hover:bg-danger-100"
                        disabled={priceOnly || rows.length <= 1}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {hasQty ? (
                      <p className="mt-1.5 pr-12 text-right font-mono text-xs text-neutral-700">
                        {formatPurchaseQty(qtyN)} {unit || "unit"} ×{" "}
                        {formatRupiah(costN)} ={" "}
                        <strong className="text-mahakan-green-900">
                          {formatRupiah(lineTotal)}
                        </strong>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-md bg-mahakan-green-100/40 px-3 py-2 text-sm">
            {totalChanged ? (
              <span className="font-mono text-xs text-neutral-600">
                sebelumnya {formatRupiah(originalTotal)} →
              </span>
            ) : null}
            <span className="font-semibold text-mahakan-green-900">
              Total PO: {formatRupiah(total)}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
