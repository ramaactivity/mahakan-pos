"use client";

import { useEffect, useState } from "react";
import { Button, DatePicker, Input, Modal, toast } from "@/components/ui";
import {
  createIncome,
  isOk,
  type CashPaymentMethod,
} from "@/features/cash";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import { fetchAccounts } from "@/features/accounting/actions";
import type { AccountListRow } from "@/features/accounting";
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
  /* Sesi AE-69 — bank account selector untuk transfer/other */
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  /* Sesi AE-71 — revenue account selector untuk granular P&L */
  const [accountId, setAccountId] = useState<string>("");
  const [revenueAccounts, setRevenueAccounts] = useState<AccountListRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(today);
    setDescription("");
    setAmount("");
    setMethod("transfer");
    setBankAccountId("");
    setAccountId("");
    setError(null);
    setSubmitting(false);
  }, [open, today]);

  /* Load bank accounts list saat modal terbuka */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listBankAccounts().then((res) => {
      if (cancelled) return;
      if (res.ok) setBankAccounts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /* Sesi AE-71 — Load revenue accounts (untuk dropdown Akun Pendapatan).
   * Accounting ApiResult pakai shape {ok, data} (beda dengan cash {success,
   * data}), jadi cek `res.ok` langsung. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAccounts({ type: "revenue", isActive: true }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        /* Filter out kontra-revenue (Diskon, Refund) — incomes shouldn't
         * post to those. */
        setRevenueAccounts(
          res.data.filter((a: AccountListRow) => !a.isContra),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
      /* Sesi AE-69 — bankAccountId hanya relevan untuk transfer/other.
       * Tunai = cash drawer (1101), tidak butuh pilih bank account. */
      bankAccountId:
        method === "cash" || !bankAccountId ? null : bankAccountId,
      /* Sesi AE-71 — revenue account override. Empty = default 4201. */
      accountId: accountId || null,
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
      size="2xl"
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
        {/* Sesi AE-73 — Layout 2-col supaya form tidak memanjang ke bawah.
         * Kiri: Tanggal, Nominal, Metode. Kanan: Deskripsi, Rekening Bank,
         * Kategori Pendapatan. */}
        <div className="grid gap-4 md:grid-cols-2">
          <DatePicker
            label="Tanggal"
            value={date}
            onChange={(v) => setDate(v ?? today)}
            required
            clearable={false}
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
        </div>
        <Input
          label="Deskripsi"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Misal: sewa ruang event komunitas fotografi"
          required
          maxLength={200}
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

        {/* Sesi AE-69 — Bank account selector (hanya kalau metode != cash) */}
        {method !== "cash" ? (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Rekening Bank{" "}
              <span className="text-xs font-normal text-neutral-500">
                (opsional — pilih kalau spesifik)
              </span>
            </label>
            {bankAccounts.length === 0 ? (
              <p className="rounded-md border border-warning-300 bg-warning-100/40 px-3 py-2 text-xs text-warning-700">
                Belum ada master rekening bank. Set di Pengaturan → Rekening
                Bank. Sementara akan pakai default mapping per metode.
              </p>
            ) : (
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
              >
                <option value="">— Pilih rekening (opsional) —</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {formatBankAccountDisplay(b)}
                  </option>
                ))}
              </select>
            )}
            <p className="text-[11px] text-neutral-500">
              Pemasukan terkait dengan rekening yang dipilih. Resolver pakai
              nama bank (BCA / BRI / dll) untuk derive akun GL yang sesuai di
              jurnal — kalau kosong, fallback ke mapping default.
            </p>
          </div>
        ) : null}

        {/* Sesi AE-71 — Kategori Pendapatan selector (Cr side override).
         * Sesi AE-73 — rename "Akun Pendapatan" → "Kategori Pendapatan"
         * supaya konsisten dengan form Pengeluaran yang pakai "Kategori". */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Kategori Pendapatan{" "}
            <span className="text-xs font-normal text-neutral-500">
              (untuk breakdown di Laporan Laba Rugi)
            </span>
          </label>
          {revenueAccounts.length === 0 ? (
            <p className="rounded-md border border-warning-300 bg-warning-100/40 px-3 py-2 text-xs text-warning-700">
              Memuat akun pendapatan…
            </p>
          ) : (
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-200"
            >
              <option value="">
                Default (4201 Pendapatan Lain-lain)
              </option>
              {revenueAccounts
                .filter((a) => a.code !== "4201")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
            </select>
          )}
          <p className="text-[11px] text-neutral-500">
            Pilih akun pendapatan specific (mis. 4202 Sewa Ruang, 4203 Titip
            Jual) untuk breakdown lebih granular di Laporan Laba Rugi.
            Default → 4201 Pendapatan Lain-lain (generic).
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
