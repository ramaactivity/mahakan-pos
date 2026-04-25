"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { expenseService, isOk } from "@/mocks/services";
import type { ExpenseCategory, ExpensePaymentMethod } from "@/mocks/types";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExpenseFormModalProps {
  open: boolean;
  categories: ExpenseCategory[];
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ExpenseFormModal({
  open,
  categories,
  createdBy,
  onClose,
  onSaved,
}: ExpenseFormModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ExpensePaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(today);
    // Default to first non-system category
    const firstNonSystem = categories.find((c) => !c.isSystem);
    setCategoryId(firstNonSystem?.id ?? categories[0]?.id ?? "");
    setDescription("");
    setAmount("");
    setMethod("cash");
    setError(null);
    setSubmitting(false);
  }, [open, categories, today]);

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
    const res = await expenseService.createExpense({
      expenseDate: date,
      categoryId,
      description: description.trim(),
      amount: parsedAmount,
      paymentMethod: method,
      receiptImageUrl: null,
      createdBy,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Pengeluaran ${formatRupiah(parsedAmount)} dicatat`);
    onSaved();
  }

  // Hide system categories (e.g. Refund) from manual create
  const userVisibleCategories = categories.filter((c) => !c.isSystem);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Pengeluaran"
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
        <Input
          label="Tanggal"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Kategori
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700"
          >
            {userVisibleCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

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

        <p className="text-xs text-neutral-500">
          📷 Upload foto bukti akan ada di M13 (Vercel Blob storage).
        </p>
      </div>
    </Modal>
  );
}
