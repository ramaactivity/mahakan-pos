"use client";

import { useEffect, useState } from "react";
import { Button, DatePicker, Input, Modal, toast } from "@/components/ui";
import {
  createIncome,
  isOk,
  type CashPaymentMethod,
} from "@/features/cash";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface IncomeFormModalProps {
  open: boolean;
  /** Kept for callsite compatibility; action derives userId from session. */
  createdBy: string;
  onClose: () => void;
  onSaved: () => void;
}

export function IncomeFormModal({
  open,
  onClose,
  onSaved,
}: IncomeFormModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CashPaymentMethod>("transfer");
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
    const res = await createIncome({
      incomeDate: date,
      description: description.trim(),
      amount: parsedAmount,
      paymentMethod: method,
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
        <DatePicker
          label="Tanggal"
          value={date}
          onChange={(v) => setDate(v ?? today)}
          required
          clearable={false}
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
            <span className="ml-2 text-xs font-normal text-neutral-500">
              (pilih akun GL tujuan)
            </span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                {
                  v: "cash" as const,
                  label: "Tunai",
                  sub: "1101 Kas Tunai",
                },
                {
                  v: "transfer" as const,
                  label: "Transfer BCA",
                  sub: "1110 Bank BCA",
                },
                {
                  v: "other" as const,
                  label: "Bank Lain-lain",
                  sub: "1112 Bank Lain-lain",
                },
              ]
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setMethod(opt.v)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-sm font-medium transition-all",
                  method === opt.v
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100",
                )}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-[10px] font-normal text-neutral-500">
                  → {opt.sub}
                </div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">
            Pemasukan otomatis ter-post ke jurnal: Dr akun di atas / Cr 4201
            Pendapatan Lain-lain. Untuk adjustment Saldo Awal bank, pilih
            metode bank-nya — saldo akun akan langsung bertambah di Buku Besar.
          </p>
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
