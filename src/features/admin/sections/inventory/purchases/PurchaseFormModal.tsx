"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
  type ComboboxGroup,
} from "@/components/ui";
import {
  createPurchase,
  isOk,
  type PaymentMethod,
} from "@/features/purchases";
import {
  listAtomicIngredients,
  type Ingredient,
} from "@/features/inventory";
import { isOk as inventoryIsOk } from "@/features/inventory";
import {
  listSuppliers,
  isOk as suppliersIsOk,
  type Supplier,
} from "@/features/suppliers";
import { lookupMarketPriceForPurchase } from "@/features/market-list";
import { formatRupiah, parseRupiah } from "@/lib/format";
import {
  convertPurchaseQty,
  convertQtyWithIngredientPacks,
  resolveUnit,
  type IngredientPackConversion,
  type PackInfo,
} from "@/lib/unit-conversion";
import { cn } from "@/lib/utils";

interface PurchaseFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "transfer_bca", label: "Transfer BCA" },
  { value: "transfer_bri", label: "Transfer BRI" },
  { value: "transfer_other", label: "Transfer lain" },
  { value: "top", label: "TOP (kredit)" },
];

interface ItemRow {
  id: string;
  ingredientId: string;
  qty: string;
  unit: string;
  unitCost: string;
}

function newRow(): ItemRow {
  return {
    id: Math.random().toString(36).slice(2),
    ingredientId: "",
    qty: "",
    unit: "",
    unitCost: "",
  };
}

// Sesi AE — list satuan umum yang staff Mahakan biasa pakai. Master unit
// dari ingredient akan otomatis pre-select; staff bisa override per-line
// (mis. master "Kg", staff input "gr" untuk belanja kecil).
const COMMON_UNITS = [
  "Kg",
  "gr",
  "L",
  "ml",
  "Btl",
  "Pcs",
  "Packs",
  "Bks",
  "Krat",
  "Lusin",
  "Sdm",
  "Sdt",
  "Karton",
] as const;

function buildUnitOptions(
  masterUnit: string | undefined,
  ingredientPacks?: IngredientPackConversion[] | null,
): Array<{ value: string; label: string }> {
  const set = new Set<string>(COMMON_UNITS);
  if (masterUnit) set.add(masterUnit);
  /* Sesi AE-62af — include ingredient-scoped pack conversions (mis. "packs"
   * untuk Lychee Kaleng yang master pcs). Tanpa ini, staff tidak bisa pilih
   * "packs" saat catat pembelian walau sudah set di Edit Satuan Bahan. */
  if (ingredientPacks && ingredientPacks.length > 0) {
    for (const p of ingredientPacks) {
      const label = p.unitLabel.trim();
      if (label.length > 0) set.add(label);
    }
  }
  return Array.from(set).map((u) => ({ value: u, label: u }));
}

function parseQtyDecimal(s: string): number {
  // Accept koma OR titik sebagai decimal separator (staff Indo biasa pakai
  // koma di Sheets). Strip whitespace + non-numeric kecuali separator.
  const cleaned = s.trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function formatQtyForDisplay(n: number): string {
  // Tampilan: integer tanpa decimal, decimal dipotong trailing zero.
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toFixed(4)));
}

function todayJakartaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function PurchaseFormModal({
  open,
  onClose,
  onSaved,
}: PurchaseFormModalProps) {
  const [ingredientList, setIngredientList] = useState<Ingredient[]>([]);
  const [supplierList, setSupplierList] = useState<Supplier[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [supplierId, setSupplierId] = useState<string | null>(null);
  // "Pembelian langsung" mode (sesi Z #4) — staff belanja mendadak di
  // warung/Alfamart/pasar yang BUKAN supplier listed. UI hides supplier
  // picker, surfaces a free-text "tempat belanja" input, and prepends
  // it to notes on save (no schema migration needed: supplier_id stays
  // nullable + tempat goes into notes).
  const [directMode, setDirectMode] = useState(false);
  const [directPlace, setDirectPlace] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayJakartaIso());
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("cash");
  const [paymentTerm, setPaymentTerm] = useState("0");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  // Receipt upload (sesi AA #2). PDF allowed in addition to image —
  // bank/aggregator receipts often arrive as PDF.
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updateCost, setUpdateCost] = useState(true);
  const [createKas, setCreateKas] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([newRow(), newRow()]);
  /* Sesi AE-43 — pack info dari Market List per ingredient. Dipakai
   * untuk live preview konversi (mis. "1 Pack = 1000 gr") + diteruskan
   * ke server lewat lookup di transaction. Key: ingredientId. */
  const [packByIngredient, setPackByIngredient] = useState<
    Map<string, PackInfo>
  >(() => new Map());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingMaster(true);
    setSupplierId(null);
    setDirectMode(false);
    setDirectPlace("");
    setPurchaseDate(todayJakartaIso());
    setPaymentMethod("cash");
    setPaymentTerm("0");
    setInvoiceNo("");
    setNotes("");
    setReceiptUrl(null);
    setReceiptFileName(null);
    setUploading(false);
    setUpdateCost(true);
    setCreateKas(true);
    setItems([newRow(), newRow()]);
    setPackByIngredient(new Map());
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      const [ingRes, supRes] = await Promise.all([
        listAtomicIngredients({ activeOnly: true }),
        listSuppliers({ activeOnly: true }),
      ]);
      if (cancelled) return;
      if (inventoryIsOk(ingRes)) setIngredientList(ingRes.data.items);
      if (suppliersIsOk(supRes)) setSupplierList(supRes.data);
      setLoadingMaster(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // When supplier changes, suggest default term + auto-switch payment method.
  useEffect(() => {
    if (!supplierId) return;
    const sup = supplierList.find((s) => s.id === supplierId);
    if (!sup) return;
    if (sup.defaultPaymentTermDays > 0) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPaymentMethod("top");
      setPaymentTerm(String(sup.defaultPaymentTermDays));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [supplierId, supplierList]);

  // Sync payment method ↔ term: TOP requires >0; non-TOP forces 0.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (paymentMethod === "top") {
      const n = parseInt(paymentTerm, 10);
      if (!Number.isFinite(n) || n <= 0) setPaymentTerm("7");
    } else {
      if (paymentTerm !== "0") setPaymentTerm("0");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [paymentMethod, paymentTerm]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const ing of ingredientList) m.set(ing.id, ing);
    return m;
  }, [ingredientList]);

  const total = useMemo(() => {
    let t = 0;
    for (const r of items) {
      const qty = parseQtyDecimal(r.qty);
      const cost = parseRupiahSafe(r.unitCost);
      if (Number.isFinite(qty) && qty > 0 && cost >= 0) {
        t += Math.round(qty * cost);
      }
    }
    return t;
  }, [items]);

  function updateRow(id: string, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    setItems((prev) => [...prev, newRow()]);
  }

  function removeRow(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  function onIngredientPick(rowId: string, ingredientId: string | null) {
    if (!ingredientId) {
      updateRow(rowId, { ingredientId: "", unit: "" });
      return;
    }
    const ing = ingredientById.get(ingredientId);
    if (!ing) return;
    const row = items.find((r) => r.id === rowId);
    const patch: Partial<ItemRow> = { ingredientId };
    // Auto-fill unit cost from master kalau row kosong.
    if (row && row.unitCost.trim() === "" && ing.costPerUnit > 0) {
      patch.unitCost = String(ing.costPerUnit);
    }
    // Auto-fill unit dari master kalau staff belum pilih.
    if (row && !row.unit) {
      patch.unit = ing.unit;
    }
    updateRow(rowId, patch);
    // Sesi AE-21 — kalau supplier sudah dipilih, lookup market list price
    // → override unit cost + unit kalau ada match. Lebih akurat dari
    // ingredient.cost_per_unit (yang aggregate global).
    if (supplierId) {
      void lookupMarketPriceForRow(rowId, supplierId, ingredientId);
    }
  }

  async function lookupMarketPriceForRow(
    rowId: string,
    supId: string,
    ingId: string,
  ) {
    const res = await lookupMarketPriceForPurchase({
      supplierId: supId,
      ingredientId: ingId,
    });
    if (!isOk(res) || !res.data) return;
    const m = res.data;
    setItems((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              // Pakai harga total per pack langsung — staff input qty
              // dalam pack unit, total = qty × unit_cost.
              unitCost: String(m.unitCost),
              unit: m.packUnit,
            }
          : r,
      ),
    );
    // Sesi AE-43 — simpan pack info untuk preview conversion. Server akan
    // re-lookup di transaction (source of truth tetap supplier_ingredients).
    setPackByIngredient((prev) => {
      const next = new Map(prev);
      next.set(ingId, { packSize: m.packSize, packUnit: m.packUnit });
      return next;
    });
  }

  // Sesi AE-21 — re-lookup all rows saat supplier diganti (auto-fill ulang).
  function onSupplierChange(nextSupplierId: string | null) {
    setSupplierId(nextSupplierId);
    if (!nextSupplierId) return;
    for (const r of items) {
      if (r.ingredientId) {
        void lookupMarketPriceForRow(r.id, nextSupplierId, r.ingredientId);
      }
    }
  }

  async function onSubmit() {
    if (submitting) return;
    setError(null);

    // Validate items.
    const validItems: Array<{
      ingredientId: string;
      qty: number;
      unitCost: number;
      unit: string | null;
    }> = [];
    for (const r of items) {
      if (!r.ingredientId && r.qty.trim() === "" && r.unitCost.trim() === "") {
        continue; // empty row, skip
      }
      if (!r.ingredientId) {
        setError("Setiap baris pembelian wajib pilih bahan");
        return;
      }
      const qty = parseQtyDecimal(r.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Qty tidak valid untuk salah satu bahan`);
        return;
      }
      const cost = parseRupiahSafe(r.unitCost);
      if (cost < 0) {
        setError("Harga tidak boleh negatif");
        return;
      }
      const ing = ingredientById.get(r.ingredientId);
      const masterUnit = ing?.unit ?? "";
      const chosenUnit = r.unit?.trim() || masterUnit;
      // Hanya simpan unit override kalau beda dari master — kalau sama,
      // simpan NULL supaya display fallback ke unitSnapshot historis.
      const unitOverride =
        chosenUnit && chosenUnit !== masterUnit ? chosenUnit : null;
      validItems.push({
        ingredientId: r.ingredientId,
        qty,
        unitCost: cost,
        unit: unitOverride,
      });
    }
    if (validItems.length === 0) {
      setError("Minimal isi 1 baris pembelian");
      return;
    }
    const ids = validItems.map((i) => i.ingredientId);
    if (new Set(ids).size !== ids.length) {
      setError("Bahan duplikat dalam 1 purchase — gabungkan jadi 1 baris");
      return;
    }

    /* Sesi AE-43 — validasi konversi unit di client sebelum hit server.
     * Server tetap re-validate (single source of truth), tapi feedback
     * di client lebih instan dan staff bisa koreksi tanpa round-trip. */
    for (const item of validItems) {
      const ing = ingredientById.get(item.ingredientId);
      if (!ing) continue;
      const conv = convertPurchaseQty({
        qty: item.qty,
        fromUnit: item.unit ?? ing.unit,
        masterUnit: ing.unit,
        pack: packByIngredient.get(item.ingredientId) ?? null,
        ingredientPacks:
          (ing.packConversions ??
            null) as IngredientPackConversion[] | null,
      });
      if (!conv.ok) {
        setError(`Bahan "${ing.name}": ${conv.message}`);
        return;
      }
    }

    const term = parseInt(paymentTerm, 10);
    if (paymentMethod === "top" && (!Number.isFinite(term) || term <= 0)) {
      setError("TOP wajib > 0 hari");
      return;
    }

    if (directMode && paymentMethod === "top") {
      setError(
        "Pembelian langsung tidak bisa pakai TOP — pilih Cash atau Transfer.",
      );
      return;
    }
    const place = directPlace.trim();
    const composedNotes = directMode
      ? [
          `[Direct]${place ? ` @ ${place}` : ""}`,
          notes.trim(),
        ]
          .filter(Boolean)
          .join(" — ")
      : notes.trim();

    setSubmitting(true);
    const res = await createPurchase({
      supplierId: directMode ? null : supplierId,
      purchaseDate,
      paymentMethod,
      paymentTermDays: paymentMethod === "top" ? term : 0,
      invoiceNo: invoiceNo.trim() || null,
      notes: composedNotes || null,
      receiptImageUrl: receiptUrl,
      updateCost,
      createKasEntry: createKas,
      items: validItems,
    });
    setSubmitting(false);

    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }

    toast.success(
      `Purchase tercatat — ${res.data.movementsCreated} bahan, total ${formatRupiah(res.data.totalAmount)}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat Pembelian"
      description="Catat semua belanja bahan / supply hari ini. Kalau cash, langsung masuk laporan kas. Untuk belanja sekali ke warung / Alfamart / pasar, toggle ke 'Pembelian langsung'."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan Belanja
          </Button>
        </>
      }
    >
      {loadingMaster ? (
        <p className="text-sm text-neutral-500">Memuat data…</p>
      ) : (
        <div className="space-y-4">
          <div
            role="radiogroup"
            aria-label="Tipe pembelian"
            className="flex flex-wrap gap-2"
          >
            {[
              {
                value: false,
                label: "Supplier reguler",
                hint: "Pilih dari daftar supplier",
              },
              {
                value: true,
                label: "Pembelian langsung",
                hint: "Warung / Alfamart / pasar — tanpa supplier",
              },
            ].map((opt) => {
              const active = directMode === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setDirectMode(opt.value);
                    if (opt.value) {
                      setSupplierId(null);
                      // Direct buys are always pay-now; force off TOP.
                      if (paymentMethod === "top") setPaymentMethod("cash");
                    } else {
                      setDirectPlace("");
                    }
                  }}
                  className={cn(
                    "flex flex-1 min-w-[180px] flex-col items-start rounded-md border px-3 py-2 text-left text-sm transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                    active
                      ? "border-mahakan-green-700 bg-mahakan-green-100/40 text-mahakan-green-900"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-[11px] text-neutral-500">
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <DatePicker
              label="Tanggal Pembelian"
              value={purchaseDate}
              onChange={(v) => setPurchaseDate(v ?? todayJakartaIso())}
              clearable={false}
            />
            {directMode ? (
              <Input
                label="Tempat belanja (opsional)"
                placeholder="mis. Warung Bu Tini, Alfamart Cijantung"
                value={directPlace}
                onChange={(e) => setDirectPlace(e.target.value.slice(0, 80))}
                hint="Disimpan di catatan untuk audit. Kalau Owner sering belanja di sini, tambahkan jadi supplier reguler nanti."
              />
            ) : (
              <Combobox
                label="Supplier"
                placeholder="Pilih supplier"
                searchPlaceholder="Cari supplier…"
                clearable
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
                      keywords: [s.category ?? ""],
                    })),
                  } satisfies ComboboxGroup,
                ]}
                value={supplierId}
                onChange={(v) => onSupplierChange(v)}
              />
            )}
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
                  ? "Berapa hari setelah purchase_date jatuh tempo"
                  : "Hanya aktif untuk TOP"
              }
            />
            <Input
              label="No. Invoice (opsional)"
              placeholder="mis. INV-2026-0042"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Daftar Belanja
              </h3>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-4" aria-hidden /> Tambah Bahan
              </Button>
            </div>
            <p className="text-xs text-neutral-600">
              Mirror Google Sheet — pilih bahan, isi QTY (boleh
              <strong> 0.5</strong> kalau setengah), pilih satuan, isi harga
              per unit. Total per baris hidup-update otomatis.
            </p>
            <div className="space-y-3 rounded-md border border-neutral-200 p-2">
              {items.map((row, idx) => {
                const ing = row.ingredientId
                  ? ingredientById.get(row.ingredientId)
                  : null;
                const qtyN = parseQtyDecimal(row.qty);
                const costN = parseRupiahSafe(row.unitCost);
                const hasQty = Number.isFinite(qtyN) && qtyN > 0;
                const lineTotal =
                  hasQty && costN >= 0 ? Math.round(qtyN * costN) : 0;
                const unit = row.unit || ing?.unit || "";
                const ingredientPacks =
                  (ing?.packConversions ??
                    null) as IngredientPackConversion[] | null;
                const unitOptions = buildUnitOptions(ing?.unit, ingredientPacks);
                /* Sesi AE-43 — preview konversi qty → master unit. Hanya
                 * compute kalau ada ingredient + qty valid + unit beda
                 * dari master. Server akan re-validate, tapi UI feedback
                 * langsung supaya staff bisa koreksi sebelum submit. */
                const conv =
                  ing && hasQty
                    ? convertPurchaseQty({
                        qty: qtyN,
                        fromUnit: unit || ing.unit,
                        masterUnit: ing.unit,
                        pack: packByIngredient.get(ing.id) ?? null,
                        ingredientPacks,
                      })
                    : null;
                const masterLabel = ing
                  ? resolveUnit(ing.unit)?.label ?? ing.unit
                  : "";
                const unitChanged =
                  ing && unit && unit !== ing.unit && unit !== masterLabel;
                return (
                  <div
                    key={row.id}
                    className="rounded-md bg-neutral-50 p-2"
                  >
                    <div className="grid gap-2 md:grid-cols-[1.5fr_90px_100px_140px_36px]">
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
                              hint: i.unit,
                              keywords: [i.section ?? "", i.unit],
                            })),
                          } satisfies ComboboxGroup,
                        ]}
                        value={row.ingredientId || null}
                        onChange={(v) => onIngredientPick(row.id, v)}
                      />
                      <Input
                        aria-label={`QTY baris ${idx + 1}`}
                        placeholder="QTY"
                        type="text"
                        inputMode="decimal"
                        value={row.qty}
                        onChange={(e) =>
                          updateRow(row.id, { qty: e.target.value })
                        }
                      />
                      <Select
                        ariaLabel={`Satuan baris ${idx + 1}`}
                        options={unitOptions}
                        value={unit}
                        onValueChange={(v) =>
                          updateRow(row.id, { unit: v })
                        }
                        disabled={!ing}
                      />
                      <Input
                        aria-label={`Harga per ${unit || "unit"} baris ${idx + 1}`}
                        placeholder="Harga per unit (Rp)"
                        type="text"
                        inputMode="numeric"
                        value={row.unitCost}
                        onChange={(e) =>
                          updateRow(row.id, { unitCost: e.target.value })
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRow(row.id)}
                        aria-label="Hapus baris"
                        title="Hapus baris"
                        className="text-danger-500 hover:bg-danger-100"
                        disabled={items.length <= 1}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {hasQty && costN > 0 ? (
                      <div className="mt-1.5 flex justify-end pr-12 text-xs text-neutral-700">
                        <span className="font-mono">
                          {formatQtyForDisplay(qtyN)} {unit || "unit"} ×{" "}
                          {formatRupiah(costN)} ={" "}
                          <strong className="text-mahakan-green-900">
                            {formatRupiah(lineTotal)}
                          </strong>
                        </span>
                      </div>
                    ) : ing ? (
                      <div className="mt-1.5 flex justify-end pr-12 text-xs text-neutral-500">
                        <span>Isi QTY + Harga buat lihat total</span>
                      </div>
                    ) : null}
                    {/* Sesi AE-43 — preview konversi unit ke master. Hijau
                     * = OK auto-convert; kuning = butuh Market List setup;
                     * merah = unit ga compatible, harus ganti unit. */}
                    {conv && unitChanged ? (
                      conv.ok ? (
                        <div className="mt-1 rounded-md bg-mahakan-green-100/60 px-2 py-1 text-[11px] text-mahakan-green-900">
                          ≈ {formatQtyForDisplay(conv.qtyMaster)}{" "}
                          {masterLabel}{" "}
                          {conv.mode === "via-pack" ? (
                            <span className="text-mahakan-green-900/70">
                              ({conv.explain})
                            </span>
                          ) : null}
                        </div>
                      ) : conv.error === "PACK_UNKNOWN" ? (
                        <div className="mt-1 rounded-md bg-warning-100 px-2 py-1 text-[11px] text-warning-500">
                          ⚠ {conv.message}
                        </div>
                      ) : (
                        <div className="mt-1 rounded-md bg-danger-100 px-2 py-1 text-[11px] text-danger-500">
                          ⛔ {conv.message}
                        </div>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={updateCost}
                onChange={(e) => setUpdateCost(e.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              <span className="flex-1">
                <strong>Update harga master bahan</strong>
                <span className="ml-1 text-xs text-neutral-500">
                  — centang kalau harga belanja ini bakal jadi acuan baru.
                  Hilangkan kalau cuma deal sekali / promo.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={createKas}
                onChange={(e) => setCreateKas(e.target.checked)}
                disabled={paymentMethod === "top"}
                className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              <span className="flex-1">
                <strong>Catat otomatis di kas hari ini</strong>
                {paymentMethod === "top" ? (
                  <span className="ml-1 text-xs text-neutral-500">
                    — TOP nanti masuk kas pas tandai lunas.
                  </span>
                ) : (
                  <span className="ml-1 text-xs text-neutral-500">
                    — hilangkan kalau belum dibayar / mau catat manual nanti.
                  </span>
                )}
              </span>
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Catatan (opsional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="mis. retur next batch, ada barang patah"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
            />
          </div>

          {/* Receipt / bukti transfer upload (sesi AA #2). Allows JPG/PNG/WebP
              (foto nota) + PDF (bank/aggregator e-receipt). Stored di Vercel
              Blob, file di-rename otomatis dengan timestamp + nama original. */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Bukti Pembelian / Transfer (opsional)
            </label>
            {receiptUrl ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center gap-2 text-xs text-mahakan-green-900 hover:underline min-w-0"
                >
                  <FileText className="size-4 shrink-0" />
                  <span className="truncate">
                    {receiptFileName ?? "Lihat di Google Drive"}
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptUrl(null);
                    setReceiptFileName(null);
                  }}
                  disabled={submitting || uploading}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                  aria-label="Hapus bukti dari form (file tetap di Drive)"
                  title="Hapus dari form. File yang sudah di Drive tidak ikut terhapus — hapus manual via Drive kalau perlu."
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setError(null);
                    try {
                      if (file.size > 5 * 1024 * 1024) {
                        throw new Error("Ukuran maks 5 MB");
                      }
                      // Upload to Google Drive via /api/v1/purchase-receipts/upload.
                      // Server handles auth + auto-creates year/month folders
                      // matching Owner's NOTA MAHAKAN structure (sesi AA #2 Opsi B).
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("purchaseDate", purchaseDate);
                      const res = await fetch(
                        "/api/v1/purchase-receipts/upload",
                        { method: "POST", body: fd },
                      );
                      const json = (await res.json()) as
                        | { success: true; data: { url: string; folderPath: string } }
                        | {
                            success: false;
                            error: { code: string; message: string };
                          };
                      if (!json.success) {
                        throw new Error(json.error.message);
                      }
                      setReceiptUrl(json.data.url);
                      setReceiptFileName(file.name);
                      toast.success(
                        `Bukti tersimpan di Drive · ${json.data.folderPath}`,
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Upload gagal",
                      );
                    } finally {
                      setUploading(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || submitting}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Uploading…
                    </>
                  ) : (
                    <>
                      <ImagePlus className="size-4" /> Upload Foto / PDF
                    </>
                  )}
                </Button>
                <p className="mt-1 text-xs text-neutral-500">
                  JPG / PNG / WebP / PDF, max 5 MB. Tersimpan otomatis di
                  Google Drive Anda — folder <strong>NOTA MAHAKAN</strong>{" "}
                  → tahun → bulan, sesuai struktur lama.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-md bg-mahakan-green-100/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-mahakan-green-900">
                Total Pembelian
              </span>
              <span className="font-mono text-lg font-bold text-mahakan-green-900">
                {formatRupiah(total)}
              </span>
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function parseRupiahSafe(s: string): number {
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}
