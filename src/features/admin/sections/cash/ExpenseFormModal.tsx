"use client";

import { useEffect, useState } from "react";
import { Button, DatePicker, Input, Modal, Select, toast } from "@/components/ui";
import {
  createExpense,
  isOk,
  updateExpense,
  type CashPaymentMethod,
  type Expense,
  type ExpenseCategory,
} from "@/features/cash";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExpenseFormModalProps {
  open: boolean;
  categories: ExpenseCategory[];
  /** Kept for callsite compatibility; action derives userId from session. */
  createdBy: string;
  /** When set, the modal acts as edit instead of create. */
  edit?: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ExpenseFormModal({
  open,
  categories,
  edit,
  onClose,
  onSaved,
}: ExpenseFormModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CashPaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (edit) {
      setDate(edit.expenseDate);
      setCategoryId(edit.categoryId);
      setDescription(edit.description);
      setAmount(String(edit.amount));
      setMethod(edit.paymentMethod);
    } else {
      setDate(today);
      const firstNonSystem = categories.find((c) => !c.isSystem);
      setCategoryId(firstNonSystem?.id ?? categories[0]?.id ?? "");
      setDescription("");
      setAmount("");
      setMethod("cash");
    }
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, categories, today, edit]);

  let parsedAmount = 0;
  try {
    parsedAmount = parseRupiah(amount);
  } catch {
    parsedAmount = 0;
  }

  async function onSubmit() {
    if (submitting) return;
    if (parsedAmount < 1) {
      setError("Nominal minimal Rp 1");
      return;
    }
    if (description.trim().length === 0) {
      setError("Deskripsi wajib diisi");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = edit
      ? await updateExpense(edit.id, {
          expenseDate: date,
          categoryId,
          description: description.trim(),
          amount: parsedAmount,
          paymentMethod: method,
        })
      : await createExpense({
          expenseDate: date,
          categoryId,
          description: description.trim(),
          amount: parsedAmount,
          paymentMethod: method,
          receiptImageUrl: null,
        });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(
      edit
        ? `Pengeluaran diperbarui (${formatRupiah(parsedAmount)})`
        : `Pengeluaran ${formatRupiah(parsedAmount)} dicatat`,
    );
    onSaved();
  }

  // Hide system categories (e.g. Refund) from manual create
  const userVisibleCategories = categories.filter((c) => !c.isSystem);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? "Edit Pengeluaran" : "Tambah Pengeluaran"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DatePicker
          label="Tanggal"
          value={date}
          onChange={(v) => setDate(v ?? today)}
          required
          clearable={false}
        />

        <Select
          label="Kategori"
          options={userVisibleCategories.map((c) => ({
            value: c.id,
            label: c.name,
          }))}
          value={categoryId}
          onValueChange={setCategoryId}
        />

        <Input
          label="Deskripsi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Misal: beli susu UHT 12L"
          required
          maxLength={200}
        />

        <Input
          label="Nominal"
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          hint={parsedAmount > 0 ? `Preview: ${formatRupiah(parsedAmount)}` : undefined}
          required
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Metode Bayar
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { v: "cash" as const, label: "Tunai" },
                { v: "transfer" as const, label: "Transfer" },
                { v: "other" as const, label: "Lainnya" },
              ]
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setMethod(opt.v)}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-all",
                  method === opt.v
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}

      </div>
    </Modal>
  );
}
