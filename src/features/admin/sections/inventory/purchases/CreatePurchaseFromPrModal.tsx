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
import { createPurchase, isOk } from "@/features/purchases";
import type { PaymentMethod } from "@/features/purchases";
import { listOpenPurchaseRequestsForPurchase } from "@/features/purchase-requests/actions";
import {
  isOk as prIsOk,
  type PrForPurchase,
} from "@/features/purchase-requests/types";
import { listSuppliers, type Supplier } from "@/features/suppliers";
import { isOk as suppliersIsOk } from "@/features/suppliers";
import {
  groupItemsBySupplier,
  validatePurchaseGroupItems,
  type PrPurchaseItemRow,
} from "@/features/purchase-requests/group-items-pure";
import { formatRupiah, parseRupiah } from "@/lib/format";
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

function todayIso(): string {
  const d = new Date();
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
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
  const [loading, setLoading] = useState(false);
  const [selectedPr, setSelectedPr] = useState<PrForPurchase | null>(null);
  const [items, setItems] = useState<PrPurchaseItemRow[]>([]);
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [prRes, supRes] = await Promise.all([
      listOpenPurchaseRequestsForPurchase(),
      listSuppliers(),
    ]);
    if (prIsOk(prRes)) setPrList(prRes.data);
    else toast.error(prRes.error.message);
    if (suppliersIsOk(supRes)) setSuppliers(supRes.data);
    setLoading(false);
  }, []);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(1);
    setSelectedPr(null);
    setItems([]);
    setPurchaseDate(todayIso());
    setPaymentMethod("cash");
    void loadData();
  }, [open, loadData]);

  // Auto-select PR kalau prefilled
  useEffect(() => {
    if (!open || !prefilledPrId || prList.length === 0) return;
    const pr = prList.find((p) => p.requestId === prefilledPrId);
    if (pr) {
      handleSelectPr(pr);
    }
  }, [open, prefilledPrId, prList]);

  function handleSelectPr(pr: PrForPurchase) {
    setSelectedPr(pr);
    setItems(
      pr.items.map((i) => ({
        purchaseRequestItemId: i.purchaseRequestItemId,
        ingredientId: i.ingredientId ?? "",
        ingredientName: i.ingredientName,
        unit: i.unit,
        outstandingQty: i.outstandingQty,
        qty: i.outstandingQty,
        supplierId: i.suggestedSupplierId,
        unitCost: i.suggestedUnitCost ?? 0,
        unitOverride: null,
        selected: true,
      })),
    );
    setStep(2);
  }

  function updateItem(idx: number, patch: Partial<PrPurchaseItemRow>) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  const supplierLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of suppliers) m.set(s.id, s.name);
    return m;
  }, [suppliers]);

  const groups = useMemo(
    () =>
      groupItemsBySupplier(items, {
        supplierNameLookup: (id) => (id ? supplierLookup.get(id) ?? null : null),
      }),
    [items, supplierLookup],
  );

  const validIssues = useMemo(
    () => validatePurchaseGroupItems(items),
    [items],
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

  async function handleSubmit() {
    if (!selectedPr) return;
    if (submitting) return;
    if (selectedCount === 0) {
      toast.error("Pilih minimal 1 item");
      return;
    }
    if (validIssues.length > 0) {
      toast.error(validIssues[0].message);
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
      const res = await createPurchase({
        supplierId: group.supplierId,
        purchaseDate,
        paymentMethod,
        paymentTermDays: paymentMethod === "top" ? 7 : 0,
        notes: `Tarik dari PR ${selectedPr.requestId.slice(0, 8)}`,
        fromPurchaseRequestId: selectedPr.requestId,
        items: group.items.map((i) => ({
          ingredientId: i.ingredientId,
          qty: i.qty,
          unitCost: i.unitCost,
          unit: i.unitOverride ?? null,
          purchaseRequestItemId: i.purchaseRequestItemId,
        })),
      });
      if (isOk(res)) successCount++;
      else errors.push(`${group.supplierName}: ${res.error.message}`);
    }
    setSubmitting(false);

    if (errors.length === 0) {
      toast.success(
        `${successCount} pembelian dibuat dari PR (${selectedCount} item ter-link)`,
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
          : "Pilih item + supplier. 1 PR bisa split jadi banyak pembelian."
      }
      size="2xl"
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
                validIssues.length > 0 ||
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
                ? `${grossGroupsToSubmit.length} Pembelian`
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
        <Step1Picker prList={prList} onSelect={handleSelectPr} />
      ) : selectedPr ? (
        <Step2Wizard
          pr={selectedPr}
          items={items}
          groups={groups}
          validIssues={validIssues}
          suppliers={suppliers}
          supplierComboGroups={supplierComboGroups}
          purchaseDate={purchaseDate}
          paymentMethod={paymentMethod}
          onUpdateItem={updateItem}
          onPurchaseDate={setPurchaseDate}
          onPaymentMethod={setPaymentMethod}
        />
      ) : null}
    </Modal>
  );
}

function Step1Picker({
  prList,
  onSelect,
}: {
  prList: PrForPurchase[];
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
      <p className="text-[11px] text-neutral-500">
        Sort: oldest first (FIFO). {prList.length} PR aktif.
      </p>
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
              <p className="font-mono text-[11px] text-neutral-600">
                {pr.totalOutstandingQty.toLocaleString("id-ID")} qty
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
  validIssues,
  suppliers,
  supplierComboGroups,
  purchaseDate,
  paymentMethod,
  onUpdateItem,
  onPurchaseDate,
  onPaymentMethod,
}: {
  pr: PrForPurchase;
  items: PrPurchaseItemRow[];
  groups: ReturnType<typeof groupItemsBySupplier>;
  validIssues: ReturnType<typeof validatePurchaseGroupItems>;
  suppliers: Supplier[];
  supplierComboGroups: ComboboxGroup[];
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  onUpdateItem: (idx: number, patch: Partial<PrPurchaseItemRow>) => void;
  onPurchaseDate: (v: string) => void;
  onPaymentMethod: (v: PaymentMethod) => void;
}) {
  const selectedCount = items.filter((i) => i.selected).length;

  return (
    <div className="space-y-4">
      {/* PR meta */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <Package className="mr-1 inline size-3.5" />
            {pr.outstandingItemCount} item outstanding ·{" "}
            {pr.totalOutstandingQty.toLocaleString("id-ID")} qty total
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

      {/* Items table */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Items ({selectedCount}/{items.length} dipilih)
          </p>
          <p className="text-[11px] text-neutral-500">
            Centang untuk include. Per row: supplier + qty + harga.
          </p>
        </div>
        <div className="space-y-2">
          {items.map((it, idx) => {
            const issuesForItem = validIssues.filter(
              (v) => v.itemId === it.purchaseRequestItemId,
            );
            return (
              <div
                key={it.purchaseRequestItemId}
                className={cn(
                  "rounded-md border p-2.5 transition-colors",
                  it.selected
                    ? "border-mahakan-green-700 bg-mahakan-green-50/50"
                    : "border-neutral-200 bg-white",
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={(e) =>
                      onUpdateItem(idx, { selected: e.target.checked })
                    }
                    className="mt-1 size-4 shrink-0"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-900">
                        {it.ingredientName}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        Sisa{" "}
                        <span className="font-mono">
                          {it.outstandingQty.toLocaleString("id-ID")} {it.unit}
                        </span>
                      </p>
                    </div>
                    {it.selected ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                        <SupplierComboField
                          value={it.supplierId}
                          onChange={(v) =>
                            onUpdateItem(idx, { supplierId: v })
                          }
                          groups={supplierComboGroups}
                          suppliers={suppliers}
                          suggested={Boolean(it.supplierId)}
                        />
                        <QtyField
                          value={it.qty}
                          maxQty={it.outstandingQty}
                          unit={it.unit}
                          onChange={(v) => onUpdateItem(idx, { qty: v })}
                        />
                        <CostField
                          value={it.unitCost}
                          onChange={(v) =>
                            onUpdateItem(idx, { unitCost: v })
                          }
                        />
                      </div>
                    ) : null}
                    {issuesForItem.length > 0 ? (
                      <p className="text-[11px] text-danger-500">
                        {issuesForItem.map((i) => i.message).join("; ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

function SupplierComboField({
  value,
  onChange,
  groups,
  suppliers,
  suggested,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  groups: ComboboxGroup[];
  suppliers: Supplier[];
  suggested: boolean;
}) {
  const supplier = value ? suppliers.find((s) => s.id === value) : null;
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Supplier{" "}
        {suggested ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-info-100 px-1 py-0.5 text-[9px] font-normal text-info-500">
            <Sparkles className="size-2.5" /> Auto
          </span>
        ) : null}
      </label>
      <Combobox
        groups={groups}
        value={value}
        onChange={(v) => onChange(v)}
        placeholder={supplier?.name ?? "Pilih supplier..."}
      />
    </div>
  );
}

function QtyField({
  value,
  maxQty,
  unit,
  onChange,
}: {
  value: number;
  maxQty: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      label={`Qty ${unit} (maks ${maxQty})`}
      type="number"
      inputMode="decimal"
      value={String(value)}
      onChange={(e) => {
        const n = parseFloat(e.target.value.replace(",", "."));
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}

function CostField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      label="Harga"
      type="text"
      inputMode="numeric"
      value={value > 0 ? value.toLocaleString("id-ID") : ""}
      onChange={(e) => onChange(parseRupiah(e.target.value))}
      placeholder="Rp 0"
    />
  );
}
