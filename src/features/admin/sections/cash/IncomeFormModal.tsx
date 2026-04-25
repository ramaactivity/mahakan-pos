"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { expenseService, isOk } from "@/mocks/services";
import type { ExpensePaymentMethod } from "@/mocks/types";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface IncomeFormModalProps {
  open: boolean;
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
}

export function IncomeFormModal({
  open,
  createdBy,
  onClose,
  onSaved,
}: IncomeFormModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ExpensePaymentMethod>("transfer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(today);
    setDescription("");
    setAmount("");
    setMethod("transfer");
    setError(null);
    setSubmitting(false);
  }, [open, today]);

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
    const res = await expenseService.createIncome({
      incomeDate: date,
      description: description.trim(),
      amount: parsedAmount,
      paymentMethod: method,
      createdBy,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Pemasukan ${formatRupiah(parsedAmount)} dicatat`);
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tambah Pemasukan Non-POS"
      description="Sewa ruang event, titip jual, dll. Pemasukan POS otomatis dari transaksi."
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
        <Input
          label="Deskripsi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Misal: sewa ruang event komunitas fotografi"
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
            Metode Terima
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
