"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Package,
  Plus,
  Sparkles,
} from "lucide-react";
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
  createPurchase,
  createPurchaseOrder,
  isOk,
} from "@/features/purchases";
import type { PaymentMethod } from "@/features/purchases";
import { listOpenPurchaseRequestsForPurchase } from "@/features/purchase-requests/actions";
import {
  isOk as prIsOk,
  type PrForPurchase,
} from "@/features/purchase-requests/types";
import { listSuppliers, type Supplier } from "@/features/suppliers";
import { isOk as suppliersIsOk } from "@/features/suppliers";
import {
  getPurchaseGroupBlockers,
  groupItemsBySupplier,
  validatePurchaseGroupItems,
  type PrPurchaseItemRow,
} from "@/features/purchase-requests/group-items-pure";
import {
  listAtomicIngredients,
  type Ingredient,
  isOk as inventoryIsOk,
} from "@/features/inventory";
import { formatRupiah } from "@/lib/format";
import {
  buildUnitSelectOptions,
  CANONICAL_UNIT_PRESETS,
  convertPurchaseQty,
  convertQty,
  displayUnit,
  type IngredientPackConversion,
} from "@/lib/unit-conversion";
import {
  applyQtyChange,
  applyTotalChange,
  applyUnitChange,
  applyUnitCostChange,
  computePrLineDefault,
  formatPurchaseQty,
  parsePurchaseQty,
  parseRupiahSafe,
  parseTotalRupiah,
  todayJakartaIso,
  type SmartMathInputMode,
} from "./purchase-line-helpers";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  /** Sesi AE-57 — kalau di-set, skip step 1 (pilih PR) langsung step 2. */
  prefilledPrId?: string | null;
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

/* Sesi AE-173 — baca tier "satuan belanja" ingredient (mis. 1 Kg = 1000 g).
 * `unitBelanjaPerCogs` di-store sebagai numeric → string saat runtime, jadi
 * di-parse defensif. Return perCogs hanya kalau valid & > 0. */
function readBelanjaTier(ing: Ingredient | null | undefined): {
  unit: string | null;
  perCogs: number | null;
} {
  const unit = ing?.unitBelanja?.trim() || null;
  const raw = ing?.unitBelanjaPerCogs;
  const parsed =
    raw != null && String(raw).trim() !== "" ? parseFloat(String(raw)) : NaN;
  const perCogs =
    unit && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  return { unit: perCogs ? unit : null, perCogs };
}

/* Sesi AE-122 — Extended row type dengan smart math + qty/cost as STRING
 * (mirror PurchaseFormModal). Original PrPurchaseItemRow di pure helper
 * pakai number — UI layer ini transform string ↔ number saat submit. */
interface UiPurchaseRow {
  purchaseRequestItemId: string;
  ingredientId: string;
  ingredientName: string;
  /** Unit asal dari PR (display only). */
  prUnit: string;
  outstandingQty: number;
  /** Qty input sebagai string (UI flexible decimal). */
  qty: string;
  /** Unit override yang dipilih owner. Kalau "" pakai prUnit. */
  unit: string;
  /** Harga per unit input sebagai string. */
  unitCost: string;
  /** Total bayar (smart math derived atau input langsung). */
  total: string;
  inputMode: SmartMathInputMode;
  supplierId: string | null;
  selected: boolean;
}

export function CreatePurchaseFromPrModal({
  open,
  prefilledPrId,
  onClose,
  onSaved,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [prList, setPrList] = useState<PrForPurchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPr, setSelectedPr] = useState<PrForPurchase | null>(null);
  const [items, setItems] = useState<UiPurchaseRow[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(todayJakartaIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  // Sesi AE-173 — false = Langsung Terima; true = Buat PO dulu (GR nanti).
  const [asPurchaseOrder, setAsPurchaseOrder] = useState(false);
  const [updateCost, setUpdateCost] = useState(true);
  /* Sesi AE-122 — sort PR list (newest first default). */
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [prRes, supRes, ingRes] = await Promise.all([
      listOpenPurchaseRequestsForPurchase(),
      listSuppliers(),
      listAtomicIngredients({ activeOnly: true }),
    ]);
    if (prIsOk(prRes)) setPrList(prRes.data);
    else toast.error(prRes.error.message);
    if (suppliersIsOk(supRes)) setSuppliers(supRes.data);
    if (inventoryIsOk(ingRes)) setIngredients(ingRes.data.items);
    setLoading(false);
  }, []);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep(1);
    setSelectedPr(null);
    setItems([]);
    setPurchaseDate(todayJakartaIso());
    setPaymentMethod("cash");
    setUpdateCost(true);
    setSortOrder("newest");
    /* eslint-enable react-hooks/set-state-in-effect */
    void loadData();
  }, [open, loadData]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const ing of ingredients) m.set(ing.id, ing);
    return m;
  }, [ingredients]);

  const handleSelectPr = useCallback(
    (pr: PrForPurchase) => {
      setSelectedPr(pr);
      setItems(
        pr.items.map((i) => {
          const ing = i.ingredientId ? ingredientById.get(i.ingredientId) : null;
          const masterUnit = ing?.unit ?? i.unit;
          /* Sesi AE-173 — default ke SATUAN BELANJA (mis. Kg) + konversi qty
           * & harga lewat pure helper, biar konsisten dgn "Catat Pembelian".
           * Tanpa ini qty satuan-COGS (gram) × harga-per-kg = total meledak. */
          const belanja = readBelanjaTier(ing);
          const d = computePrLineDefault({
            outstandingQty: i.outstandingQty,
            costPerUnit: ing?.costPerUnit ?? 0,
            suggestedUnitCost: i.suggestedUnitCost,
            masterUnit,
            prUnit: i.unit,
            belanjaUnit: belanja.unit,
            belanjaPerCogs: belanja.perCogs,
          });
          const total =
            d.qty > 0 && d.unitCost > 0
              ? String(Math.round(d.qty * d.unitCost))
              : "";
          return {
            purchaseRequestItemId: i.purchaseRequestItemId,
            ingredientId: i.ingredientId ?? "",
            ingredientName: i.ingredientName,
            prUnit: i.unit,
            outstandingQty: i.outstandingQty,
            qty: formatPurchaseQty(d.qty),
            unit: displayUnit(d.unit),
            unitCost: d.unitCost > 0 ? String(d.unitCost) : "",
            total,
            inputMode: "unit" as SmartMathInputMode,
            supplierId: i.suggestedSupplierId,
            selected: true,
          };
        }),
      );
      setStep(2);
    },
    [ingredientById],
  );

  // Auto-select PR kalau prefilled
  useEffect(() => {
    if (!open || !prefilledPrId || prList.length === 0) return;
    const pr = prList.find((p) => p.requestId === prefilledPrId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pr) handleSelectPr(pr);
  }, [open, prefilledPrId, prList, handleSelectPr]);

  function updateItem(idx: number, patch: Partial<UiPurchaseRow>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function setRowQty(idx: number, value: string) {
    setItems((prev) => {
      const next = [...prev];
      const row = next[idx];
      const result = applyQtyChange(
        {
          qty: row.qty,
          unitCost: row.unitCost,
          total: row.total,
          inputMode: row.inputMode,
        },
        value,
      );
      next[idx] = { ...row, ...result };
      return next;
    });
  }

  function setRowUnitCost(idx: number, value: string) {
    setItems((prev) => {
      const next = [...prev];
      const row = next[idx];
      const result = applyUnitCostChange(
        {
          qty: row.qty,
          unitCost: row.unitCost,
          total: row.total,
          inputMode: row.inputMode,
        },
        value,
      );
      next[idx] = { ...row, ...result };
      return next;
    });
  }

  function setRowTotal(idx: number, value: string) {
    setItems((prev) => {
      const next = [...prev];
      const row = next[idx];
      const result = applyTotalChange(
        {
          qty: row.qty,
          unitCost: row.unitCost,
          total: row.total,
          inputMode: row.inputMode,
        },
        value,
      );
      next[idx] = { ...row, ...result };
      return next;
    });
  }

  function setRowUnit(idx: number, newUnit: string) {
    setItems((prev) => {
      const next = [...prev];
      const row = next[idx];
      /* Sesi AE-173 — ganti satuan: konversi QTY + scale harga (lewat pure
       * helper applyUnitChange) supaya jumlah fisik & total tetap. */
      const result = applyUnitChange(
        {
          qty: row.qty,
          unitCost: row.unitCost,
          total: row.total,
          inputMode: row.inputMode,
        },
        row.unit,
        newUnit,
      );
      next[idx] = { ...row, unit: newUnit, ...result };
      return next;
    });
  }

  const supplierLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  /* Convert UI rows → pure helper rows (for grouping + validation). */
  const pureRows: PrPurchaseItemRow[] = useMemo(
    () =>
      items.map((it) => {
        const qty = parsePurchaseQty(it.qty);
        const cost = parseRupiahSafe(it.unitCost);
        const ing = it.ingredientId ? ingredientById.get(it.ingredientId) : null;
        const masterUnit = ing?.unit ?? it.prUnit;
        const chosenUnit = it.unit || it.prUnit;
        /* Sesi AE-173 — outstanding di-rekam dalam satuan COGS. Kalau baris
         * pakai satuan belanja, convert dulu biar warning "lebih dari
         * request" apple-to-apple (mis. 5.726 Kg vs 5.726 Kg, bukan vs 5726 g). */
        const belanja = readBelanjaTier(ing);
        const outstandingInUnit =
          belanja.perCogs != null &&
          belanja.unit != null &&
          displayUnit(chosenUnit) === displayUnit(belanja.unit)
            ? it.outstandingQty / belanja.perCogs
            : it.outstandingQty;
        return {
          purchaseRequestItemId: it.purchaseRequestItemId,
          ingredientId: it.ingredientId,
          ingredientName: it.ingredientName,
          unit: chosenUnit,
          outstandingQty: outstandingInUnit,
          qty: Number.isFinite(qty) ? qty : 0,
          supplierId: it.supplierId,
          unitCost: Number.isFinite(cost) ? cost : 0,
          unitOverride:
            it.unit && it.unit !== masterUnit ? it.unit : null,
          selected: it.selected,
        };
      }),
    [items, ingredientById],
  );

  const groups = useMemo(
    () =>
      groupItemsBySupplier(pureRows, {
        supplierNameLookup: (id) => (id ? supplierLookup.get(id) ?? null : null),
      }),
    [pureRows, supplierLookup],
  );

  const allIssues = useMemo(
    () => validatePurchaseGroupItems(pureRows),
    [pureRows],
  );
  const blockers = useMemo(
    () => getPurchaseGroupBlockers(allIssues),
    [allIssues],
  );

  const selectedCount = items.filter((i) => i.selected).length;
  const totalAmount = groups.reduce((s, g) => s + g.totalAmount, 0);
  const grossGroupsToSubmit = groups.filter((g) => g.supplierId != null);

  const supplierComboGroups: ComboboxGroup[] = useMemo(
    () => [
      {
        label: "Supplier",
        options: suppliers.map((s) => ({ value: s.id, label: s.name })),
      },
    ],
    [suppliers],
  );

  /* Sesi AE-122 — apply sort order ke PR list. */
  const sortedPrList = useMemo(() => {
    const arr = [...prList];
    arr.sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return sortOrder === "newest" ? diff : -diff;
    });
    return arr;
  }, [prList, sortOrder]);

  async function handleSubmit() {
    if (!selectedPr) return;
    if (submitting) return;
    if (selectedCount === 0) {
      toast.error("Pilih minimal 1 item");
      return;
    }
    if (blockers.length > 0) {
      toast.error(blockers[0].message);
      return;
    }
    if (grossGroupsToSubmit.length === 0) {
      toast.error("Semua item butuh supplier");
      return;
    }

    setSubmitting(true);
    let successCount = 0;
    const errors: string[] = [];
    for (const group of grossGroupsToSubmit) {
      const payload = {
        supplierId: group.supplierId,
        purchaseDate,
        paymentMethod,
        paymentTermDays: paymentMethod === "top" ? 7 : 0,
        notes: `Tarik dari PR ${selectedPr.requestId.slice(0, 8)}`,
        fromPurchaseRequestId: selectedPr.requestId,
        updateCost,
        items: group.items.map((i) => ({
          ingredientId: i.ingredientId,
          qty: i.qty,
          unitCost: i.unitCost,
          unit: i.unitOverride ?? null,
          purchaseRequestItemId: i.purchaseRequestItemId,
        })),
      };
      const res = asPurchaseOrder
        ? await createPurchaseOrder(payload)
        : await createPurchase(payload);
      if (isOk(res)) successCount++;
      else errors.push(`${group.supplierName}: ${res.error.message}`);
    }
    setSubmitting(false);

    if (errors.length === 0) {
      toast.success(
        asPurchaseOrder
          ? `${successCount} PO dibuat dari PR — tekan "Terima" saat barang datang`
          : `${successCount} pembelian dibuat dari PR (${selectedCount} item ter-link)`,
      );
      onSaved();
    } else if (successCount > 0) {
      toast.error(
        `${successCount} berhasil, ${errors.length} gagal: ${errors[0]}`,
      );
      onSaved();
    } else {
      toast.error(errors[0] ?? "Gagal buat pembelian");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        step === 1
          ? "Tarik dari Permintaan Belanja"
          : `Tarik ke Pembelian — ${selectedPr?.label ?? ""}`
      }
      description={
        step === 1
          ? "Pilih PR yang ingin di-proses menjadi pembelian"
          : "Atur qty, satuan, dan harga per item. Owner bebas override request staff (lebih atau kurang)."
      }
      size={step === 1 ? "2xl" : "full"}
      footer={
        step === 1 ? undefined : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (prefilledPrId) {
                  onClose();
                } else {
                  setStep(1);
                  setSelectedPr(null);
                }
              }}
              disabled={submitting}
            >
              <ArrowLeft className="size-4" />
              {prefilledPrId ? "Tutup" : "Pilih PR Lain"}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                selectedCount === 0 ||
                blockers.length > 0 ||
                grossGroupsToSubmit.length === 0
              }
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Buat{" "}
              {grossGroupsToSubmit.length > 0
                ? `${grossGroupsToSubmit.length} ${asPurchaseOrder ? "PO" : "Pembelian"}`
                : asPurchaseOrder
                  ? "PO"
                  : "Pembelian"}{" "}
              · {formatRupiah(totalAmount)}
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : step === 1 ? (
        <Step1Picker
          prList={sortedPrList}
          sortOrder={sortOrder}
          onChangeSort={setSortOrder}
          onSelect={handleSelectPr}
        />
      ) : selectedPr ? (
        <>
          {/* Sesi AE-173 — pilih tahap: langsung terima vs buat PO dulu. */}
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-1.5">
            {[
              { v: false, label: "Langsung Terima", hint: "Barang sudah di tangan" },
              { v: true, label: "Buat PO dulu", hint: "Pesan dulu, terima nanti (GR)" },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                onClick={() => setAsPurchaseOrder(opt.v)}
                className={cn(
                  "rounded-md px-3 py-2 text-left text-sm transition-colors",
                  asPurchaseOrder === opt.v
                    ? "bg-mahakan-green-700 text-white shadow-sm"
                    : "text-neutral-700 hover:bg-neutral-100",
                )}
              >
                <span className="block font-semibold">{opt.label}</span>
                <span
                  className={cn(
                    "block text-xs",
                    asPurchaseOrder === opt.v
                      ? "text-mahakan-green-50"
                      : "text-neutral-500",
                  )}
                >
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>
          <Step2Wizard
          pr={selectedPr}
          items={items}
          groups={groups}
          issues={allIssues}
          ingredients={ingredients}
          ingredientById={ingredientById}
          supplierComboGroups={supplierComboGroups}
          purchaseDate={purchaseDate}
          paymentMethod={paymentMethod}
          updateCost={updateCost}
          onUpdateItem={updateItem}
          onSetRowQty={setRowQty}
          onSetRowUnitCost={setRowUnitCost}
          onSetRowTotal={setRowTotal}
          onSetRowUnit={setRowUnit}
          onPurchaseDate={setPurchaseDate}
          onPaymentMethod={setPaymentMethod}
          onUpdateCost={setUpdateCost}
        />
        </>
      ) : null}
    </Modal>
  );
}

function Step1Picker({
  prList,
  sortOrder,
  onChangeSort,
  onSelect,
}: {
  prList: PrForPurchase[];
  sortOrder: "newest" | "oldest";
  onChangeSort: (v: "newest" | "oldest") => void;
  onSelect: (pr: PrForPurchase) => void;
}) {
  if (prList.length === 0) {
    return (
      <div className="py-8 text-center">
        <Package className="mx-auto mb-2 size-8 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-700">
          Tidak ada PR yang outstanding
        </p>
        <p className="text-xs text-neutral-500">
          Semua PR sudah selesai atau belum ada PR baru. Buat PR dulu di tab
          Permintaan Belanja.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-500">
          {prList.length} PR aktif.
        </p>
        <div className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => onChangeSort("newest")}
            className={cn(
              "rounded px-2 py-1 font-medium transition-colors",
              sortOrder === "newest"
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-600 hover:text-neutral-900",
            )}
            aria-pressed={sortOrder === "newest"}
          >
            Terbaru
          </button>
          <button
            type="button"
            onClick={() => onChangeSort("oldest")}
            className={cn(
              "rounded px-2 py-1 font-medium transition-colors",
              sortOrder === "oldest"
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-600 hover:text-neutral-900",
            )}
            aria-pressed={sortOrder === "oldest"}
          >
            Terlama (FIFO)
          </button>
        </div>
      </div>
      {prList.map((pr) => (
        <button
          key={pr.requestId}
          type="button"
          onClick={() => onSelect(pr)}
          className={cn(
            "w-full rounded-md border border-neutral-200 bg-white p-3 text-left transition-colors",
            "hover:border-mahakan-green-700 hover:bg-mahakan-green-50/40",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900">
                {pr.label}
              </p>
              <p className="text-xs text-neutral-500">
                {pr.createdByName ?? "—"} ·{" "}
                {pr.createdAt.toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              {pr.notes ? (
                <p className="mt-1 line-clamp-1 text-[11px] italic text-neutral-500">
                  {pr.notes}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-warning-500">
                {pr.outstandingItemCount} item
              </p>
              <span
                className={cn(
                  "mt-0.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                  pr.status === "open"
                    ? "bg-info-100 text-info-500"
                    : "bg-warning-50 text-warning-500",
                )}
              >
                {pr.status === "open" ? "Open" : "Sebagian"}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function Step2Wizard({
  pr,
  items,
  groups,
  issues,
  ingredients,
  ingredientById,
  supplierComboGroups,
  purchaseDate,
  paymentMethod,
  updateCost,
  onUpdateItem,
  onSetRowQty,
  onSetRowUnitCost,
  onSetRowTotal,
  onSetRowUnit,
  onPurchaseDate,
  onPaymentMethod,
  onUpdateCost,
}: {
  pr: PrForPurchase;
  items: UiPurchaseRow[];
  groups: ReturnType<typeof groupItemsBySupplier>;
  issues: ReturnType<typeof validatePurchaseGroupItems>;
  ingredients: Ingredient[];
  ingredientById: Map<string, Ingredient>;
  supplierComboGroups: ComboboxGroup[];
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  updateCost: boolean;
  onUpdateItem: (idx: number, patch: Partial<UiPurchaseRow>) => void;
  onSetRowQty: (idx: number, value: string) => void;
  onSetRowUnitCost: (idx: number, value: string) => void;
  onSetRowTotal: (idx: number, value: string) => void;
  onSetRowUnit: (idx: number, value: string) => void;
  onPurchaseDate: (v: string) => void;
  onPaymentMethod: (v: PaymentMethod) => void;
  onUpdateCost: (v: boolean) => void;
}) {
  const selectedCount = items.filter((i) => i.selected).length;

  return (
    <div className="space-y-4">
      {/* PR meta */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <Package className="mr-1 inline size-3.5" />
            {pr.outstandingItemCount} item outstanding
          </span>
          <span className="text-neutral-500">
            {pr.createdByName ?? "—"} ·{" "}
            {pr.createdAt.toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
            })}
          </span>
        </div>
        {pr.notes ? (
          <p className="mt-1 text-[11px] italic">Catatan PR: {pr.notes}</p>
        ) : null}
      </div>

      {/* Purchase date + payment method */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DatePicker
          label="Tanggal Pembelian"
          value={purchaseDate}
          onChange={(v) => onPurchaseDate(v ?? "")}
        />
        <Select
          label="Metode Pembayaran"
          value={paymentMethod}
          onValueChange={(v) => onPaymentMethod(v as PaymentMethod)}
          options={PAYMENT_OPTIONS}
        />
      </div>

      {/* Items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Items ({selectedCount}/{items.length} dipilih)
          </p>
          <p className="text-[11px] text-neutral-500">
            Centang untuk include. Owner boleh ubah qty, satuan, atau harga
            sebelum simpan.
          </p>
        </div>
        <div className="space-y-3">
          {items.map((it, idx) => (
            <PurchaseLineRow
              key={it.purchaseRequestItemId}
              row={it}
              idx={idx}
              issues={issues.filter(
                (v) => v.itemId === it.purchaseRequestItemId,
              )}
              ingredients={ingredients}
              ingredient={
                it.ingredientId ? ingredientById.get(it.ingredientId) : null
              }
              supplierComboGroups={supplierComboGroups}
              onUpdateItem={onUpdateItem}
              onSetRowQty={onSetRowQty}
              onSetRowUnitCost={onSetRowUnitCost}
              onSetRowTotal={onSetRowTotal}
              onSetRowUnit={onSetRowUnit}
            />
          ))}
        </div>
      </div>

      {/* Update master cost checkbox */}
      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={updateCost}
          onChange={(e) => onUpdateCost(e.target.checked)}
          className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
        />
        <span className="flex-1">
          <strong>Update harga master bahan (WAC)</strong>
          <span className="ml-1 text-xs text-neutral-500">
            — centang kalau harga belanja ini bakal jadi acuan baru. Sistem
            akan running-average (bukan overwrite).
          </span>
        </span>
      </label>

      {/* Groups preview */}
      {selectedCount > 0 && groups.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Pembelian yang akan dibuat ({groups.length})
          </p>
          <div className="space-y-1.5">
            {groups.map((g) => (
              <div
                key={g.supplierId ?? "__null__"}
                className={cn(
                  "flex items-center justify-between rounded-md border px-3 py-2 text-xs",
                  g.supplierId == null
                    ? "border-danger-100 bg-danger-100/30"
                    : "border-mahakan-green-100 bg-mahakan-green-50/40",
                )}
              >
                <div>
                  <p className="font-semibold text-neutral-900">
                    {g.supplierName}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {g.itemCount} item
                    {g.supplierId == null
                      ? " — perlu pilih supplier dulu"
                      : null}
                  </p>
                </div>
                <p className="font-mono font-semibold text-neutral-900">
                  {formatRupiah(g.totalAmount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Sesi AE-122 — Per-item row dengan smart math (qty + unit + harga +
 * total). Mirror PurchaseFormModal pattern supaya owner familiar antara
 * "Catat Pembelian" manual dan "Tarik ke Pembelian" dari PR. */
function PurchaseLineRow({
  row,
  idx,
  issues,
  ingredients,
  ingredient,
  supplierComboGroups,
  onUpdateItem,
  onSetRowQty,
  onSetRowUnitCost,
  onSetRowTotal,
  onSetRowUnit,
}: {
  row: UiPurchaseRow;
  idx: number;
  issues: ReturnType<typeof validatePurchaseGroupItems>;
  ingredients: Ingredient[];
  ingredient: Ingredient | null | undefined;
  supplierComboGroups: ComboboxGroup[];
  onUpdateItem: (idx: number, patch: Partial<UiPurchaseRow>) => void;
  onSetRowQty: (idx: number, value: string) => void;
  onSetRowUnitCost: (idx: number, value: string) => void;
  onSetRowTotal: (idx: number, value: string) => void;
  onSetRowUnit: (idx: number, value: string) => void;
}) {
  const qtyN = parsePurchaseQty(row.qty);
  const costN = parseRupiahSafe(row.unitCost);
  const hasQty = Number.isFinite(qtyN) && qtyN > 0;
  const lineTotal = hasQty && costN >= 0 ? Math.round(qtyN * costN) : 0;
  const masterUnit = ingredient?.unit ?? row.prUnit;
  const ingredientPacks =
    (ingredient?.packConversions ??
      null) as IngredientPackConversion[] | null;
  /* Sesi AE-173 — dropdown satuan KANONIK + anti-blank: value & options
   * selalu pakai label kanonik (mis. "kg" tersimpan → tampil "Kg"), dan
   * nilai terpilih dijamin selalu ada di options. */
  const { options: unitOptions, value: unit } = buildUnitSelectOptions({
    presets: CANONICAL_UNIT_PRESETS,
    packLabels: [
      masterUnit,
      ingredient?.unitBelanja ?? "",
      ingredient?.unitTracking ?? "",
      ...(ingredientPacks?.map((p) => p.unitLabel) ?? []),
    ],
    current: row.unit || ingredient?.unit || row.prUnit,
  });
  const masterLabel = displayUnit(ingredient?.unit ?? masterUnit);
  const unitChanged =
    !!ingredient &&
    !!unit &&
    unit !== ingredient.unit &&
    unit !== masterLabel;
  const conv =
    ingredient && hasQty
      ? convertPurchaseQty({
          qty: qtyN,
          fromUnit: unit || ingredient.unit,
          masterUnit: ingredient.unit,
          pack: null,
          ingredientPacks,
        })
      : null;
  const equivCostPerMaster =
    ingredient && unitChanged && costN > 0
      ? (() => {
          const factor = convertQty(1, masterLabel, unit);
          if (factor === null || factor <= 0) return null;
          return Math.round(costN * factor);
        })()
      : null;

  const errorIssues = issues.filter((i) => i.severity === "error");
  const warningIssues = issues.filter((i) => i.severity === "warning");

  return (
    <div
      className={cn(
        "rounded-md border p-2.5 transition-colors",
        row.selected
          ? errorIssues.length > 0
            ? "border-danger-300 bg-danger-50/30"
            : "border-mahakan-green-700 bg-mahakan-green-50/50"
          : "border-neutral-200 bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onUpdateItem(idx, { selected: e.target.checked })}
          className="mt-1 size-4 shrink-0"
          aria-label={`Pilih ${row.ingredientName}`}
        />
        <div className="flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900">
                {row.ingredientName}
              </p>
              <p className="text-[11px] text-neutral-500">
                Request staff:{" "}
                <span className="font-mono">
                  {row.outstandingQty.toLocaleString("id-ID")} {row.prUnit}
                </span>
              </p>
            </div>
          </div>

          {row.selected ? (
            <>
              {/* Sesi AE-122 — Row of fields mirror PurchaseFormModal.
               * Mobile: stack vertical. Desktop: grid 6-col seperti
               * Catat Pembelian. */}
              <div className="grid gap-2 md:grid-cols-[1.5fr_90px_110px_160px_160px]">
                {/* Supplier */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Supplier{" "}
                    {row.supplierId ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-info-100 px-1 py-0.5 text-[9px] font-normal text-info-500">
                        <Sparkles className="size-2.5" /> Auto
                      </span>
                    ) : null}
                  </label>
                  <Combobox
                    groups={supplierComboGroups}
                    value={row.supplierId}
                    onChange={(v) =>
                      onUpdateItem(idx, { supplierId: v })
                    }
                    placeholder="Pilih supplier..."
                  />
                </div>

                {/* QTY */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Qty
                  </label>
                  <Input
                    aria-label={`Qty baris ${idx + 1}`}
                    placeholder="0"
                    type="text"
                    inputMode="decimal"
                    value={row.qty}
                    onChange={(e) => onSetRowQty(idx, e.target.value)}
                  />
                </div>

                {/* Satuan */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Satuan
                  </label>
                  <Select
                    ariaLabel={`Satuan baris ${idx + 1}`}
                    options={unitOptions}
                    value={unit}
                    onValueChange={(v) => onSetRowUnit(idx, v)}
                    disabled={!ingredient}
                  />
                </div>

                {/* Harga per satuan */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Harga / Satuan
                  </label>
                  <div className="relative">
                    <Input
                      aria-label={`Harga per ${unit || "unit"} baris ${idx + 1}`}
                      placeholder={row.inputMode === "total" ? "auto" : "0"}
                      type="text"
                      inputMode="numeric"
                      value={row.unitCost}
                      onChange={(e) => onSetRowUnitCost(idx, e.target.value)}
                      className={cn(
                        "pr-14",
                        row.inputMode === "total" &&
                          "bg-neutral-100 text-neutral-600",
                      )}
                    />
                    <span
                      className={cn(
                        "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        row.inputMode === "total"
                          ? "bg-neutral-200 text-neutral-500"
                          : unit
                            ? "bg-mahakan-green-100 text-mahakan-green-900"
                            : "bg-neutral-200 text-neutral-500",
                      )}
                      aria-hidden
                    >
                      {row.inputMode === "total" ? "auto" : `per ${unit || "—"}`}
                    </span>
                  </div>
                </div>

                {/* Total bayar */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Total Bayar
                  </label>
                  <div className="relative">
                    <Input
                      aria-label={`Total bayar baris ${idx + 1}`}
                      placeholder={row.inputMode === "unit" ? "auto" : "0"}
                      type="text"
                      inputMode="numeric"
                      value={row.total}
                      onChange={(e) => onSetRowTotal(idx, e.target.value)}
                      className={cn(
                        "pr-14",
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
                </div>
              </div>

              {/* Live math echo */}
              {hasQty && costN > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-xs text-neutral-700">
                  <span className="font-mono">
                    {formatPurchaseQty(qtyN)} {unit || "unit"} ×{" "}
                    {formatRupiah(costN)} ={" "}
                    <strong className="text-mahakan-green-900">
                      {formatRupiah(lineTotal)}
                    </strong>
                  </span>
                  {row.inputMode === "total" ? (
                    <span className="font-mono text-[11px] text-neutral-500">
                      ({formatRupiah(parseTotalRupiah(row.total))} ÷{" "}
                      {formatPurchaseQty(qtyN)} = {formatRupiah(costN)}/
                      {unit || "unit"})
                    </span>
                  ) : null}
                  {equivCostPerMaster !== null ? (
                    <span className="font-mono text-[11px] text-neutral-500">
                      ≈ {formatRupiah(equivCostPerMaster)}/{masterLabel}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {/* Unit conversion preview */}
              {conv && unitChanged ? (
                conv.ok ? (
                  <div className="rounded-md bg-mahakan-green-100/60 px-2 py-1 text-[11px] text-mahakan-green-900">
                    ≈ {formatPurchaseQty(conv.qtyMaster)} {masterLabel}{" "}
                    {conv.mode === "via-pack" ? (
                      <span className="text-mahakan-green-900/70">
                        ({conv.explain})
                      </span>
                    ) : null}
                  </div>
                ) : conv.error === "PACK_UNKNOWN" ? (
                  <div className="rounded-md bg-warning-100 px-2 py-1 text-[11px] text-warning-500">
                    ⚠ {conv.message}
                  </div>
                ) : (
                  <div className="rounded-md bg-danger-100 px-2 py-1 text-[11px] text-danger-500">
                    ⛔ {conv.message}
                  </div>
                )
              ) : null}

              {/* Manual ingredient picker kalau PR item tidak ke-link */}
              {!ingredient && row.ingredientId === "" ? (
                <div className="rounded-md bg-warning-50 px-2 py-1.5 text-[11px] text-warning-700">
                  Item ini di-input manual oleh staff (tidak ke-link ke
                  master bahan). Pilih bahan master kalau perlu:
                  <div className="mt-1.5">
                    <Combobox
                      groups={[
                        {
                          label: "",
                          options: ingredients.map((i) => ({
                            value: i.id,
                            label: i.name,
                            hint: i.unit,
                            keywords: [i.section ?? "", i.unit],
                          })),
                        } satisfies ComboboxGroup,
                      ]}
                      value={row.ingredientId || null}
                      onChange={(v) => {
                        if (!v) return;
                        const newIng = ingredients.find((i) => i.id === v);
                        if (!newIng) return;
                        onUpdateItem(idx, {
                          ingredientId: v,
                          unit: newIng.unit,
                        });
                      }}
                      placeholder="Cari bahan master..."
                    />
                  </div>
                </div>
              ) : null}

              {/* Warning + error messages */}
              {warningIssues.length > 0 ? (
                <div className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                  {warningIssues.map((i) => (
                    <p key={i.field}>⚠ {i.message}</p>
                  ))}
                </div>
              ) : null}
              {errorIssues.length > 0 ? (
                <p className="text-[11px] text-danger-500">
                  {errorIssues.map((i) => i.message).join("; ")}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
