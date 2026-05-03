"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { formatRupiah, parseRupiah } from "@/lib/format";
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
  unitCost: string;
}

function newRow(): ItemRow {
  return {
    id: Math.random().toString(36).slice(2),
    ingredientId: "",
    qty: "",
    unitCost: "",
  };
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
  const [updateCost, setUpdateCost] = useState(true);
  const [createKas, setCreateKas] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([newRow(), newRow()]);

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
    setUpdateCost(true);
    setCreateKas(true);
    setItems([newRow(), newRow()]);
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
      const qty = parseInt(r.qty, 10);
      const cost = parseRupiahSafe(r.unitCost);
      if (Number.isFinite(qty) && qty > 0 && cost >= 0) {
        t += qty * cost;
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
      updateRow(rowId, { ingredientId: "" });
      return;
    }
    const ing = ingredientById.get(ingredientId);
    if (!ing) return;
    // Auto-fill unit cost from master kalau row kosong (Owner masih bisa override).
    const row = items.find((r) => r.id === rowId);
    const patch: Partial<ItemRow> = { ingredientId };
    if (row && row.unitCost.trim() === "" && ing.costPerUnit > 0) {
      patch.unitCost = String(ing.costPerUnit);
    }
    updateRow(rowId, patch);
  }

  async function onSubmit() {
    if (submitting) return;
    setError(null);

    // Validate items.
    const validItems: Array<{
      ingredientId: string;
      qty: number;
      unitCost: number;
    }> = [];
    for (const r of items) {
      if (!r.ingredientId && r.qty.trim() === "" && r.unitCost.trim() === "") {
        continue; // empty row, skip
      }
      if (!r.ingredientId) {
        setError("Setiap baris pembelian wajib pilih bahan");
        return;
      }
      const qty = parseInt(r.qty, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Qty tidak valid untuk salah satu bahan`);
        return;
      }
      const cost = parseRupiahSafe(r.unitCost);
      if (cost < 0) {
        setError("Harga tidak boleh negatif");
        return;
      }
      validItems.push({
        ingredientId: r.ingredientId,
        qty,
        unitCost: cost,
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
      description="Replace `Form Pembelanjaan Cash` + `Form TOP` lama. Pilih supplier reguler, atau toggle Pembelian Langsung untuk warung/Alfamart/pasar mendadak. Stok bahan auto-update; kalau Cash + 'Buat entry kas' aktif, expense kas otomatis dibuat."
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan Purchase
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
                onChange={(v) => setSupplierId(v)}
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
                Item Pembelian
              </h3>
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-4" aria-hidden /> Tambah Baris
              </Button>
            </div>
            <div className="space-y-2 rounded-md border border-neutral-200 p-2">
              {items.map((row, idx) => {
                const ing = row.ingredientId
                  ? ingredientById.get(row.ingredientId)
                  : null;
                const qtyN = parseInt(row.qty, 10);
                const costN = parseRupiahSafe(row.unitCost);
                const lineTotal =
                  Number.isFinite(qtyN) && qtyN > 0 && costN >= 0
                    ? qtyN * costN
                    : 0;
                return (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-md bg-neutral-50 p-2 md:grid-cols-[1fr_90px_140px_100px_36px]"
                  >
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
                      aria-label={`Qty ${idx + 1}`}
                      placeholder={ing ? `Qty (${ing.unit})` : "Qty"}
                      type="text"
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(e) =>
                        updateRow(row.id, { qty: e.target.value })
                      }
                    />
                    <Input
                      aria-label={`Unit cost ${idx + 1}`}
                      placeholder="Harga per unit (Rp)"
                      type="text"
                      inputMode="numeric"
                      value={row.unitCost}
                      onChange={(e) =>
                        updateRow(row.id, { unitCost: e.target.value })
                      }
                    />
                    <div className="flex items-center justify-end pr-2 text-xs font-mono">
                      {lineTotal > 0 ? formatRupiah(lineTotal) : "—"}
                    </div>
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
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={updateCost}
                onChange={(e) => setUpdateCost(e.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              <span>
                <strong>Update cost master</strong> dari harga pembelian ini
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
              <span>
                <strong>Buat entry kas otomatis</strong>
                {paymentMethod === "top" ? (
                  <span className="text-neutral-500">
                    {" "}
                    (TOP buat saat tandai lunas)
                  </span>
                ) : null}
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
