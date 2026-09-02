"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import {
  createIncome,
  updateIncome,
  isOk,
  type CashPaymentMethod,
  type Income,
} from "@/features/cash";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import { fetchAccounts } from "@/features/accounting/actions";
import type { AccountListRow } from "@/features/accounting";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

interface IncomeFormModalProps {
  open: boolean;
  /** Kept for callsite compatibility; action derives userId from session. */
  createdBy: string;
  /** Sesi AE-123 — kalau di-set, modal jadi edit mode dengan pre-fill. */
  edit?: Income | null;
  onClose: () => void;
  onSaved: () => void;
}

export function IncomeFormModal({
  open,
  edit,
  onClose,
  onSaved,
}: IncomeFormModalProps) {
  const isEdit = edit != null;
  const today = todayJakarta();
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
  /* Sesi AE-123 — track if description was blurred to show live validation
   * error only after user finishes typing (better UX than red-on-type). */
  const [descTouched, setDescTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (edit) {
      setDate(edit.incomeDate);
      setDescription(edit.description);
      setAmount(String(edit.amount));
      setMethod(edit.paymentMethod);
      setBankAccountId(edit.bankAccountId ?? "");
      setAccountId(edit.accountId ?? "");
    } else {
      setDate(today);
      setDescription("");
      setAmount("");
      setMethod("transfer");
      setBankAccountId("");
      setAccountId("");
    }
    setError(null);
    setDescTouched(false);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, edit, today]);

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

  const parsedAmount = amount ? Number(amount) : 0;
  const descEmpty = description.trim().length === 0;
  const showDescError = descTouched && descEmpty;

  async function onSubmit() {
    if (submitting) return;
    if (parsedAmount < 1) {
      setError("Nominal minimal Rp 1");
      return;
    }
    if (descEmpty) {
      setError("Deskripsi wajib diisi");
      setDescTouched(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
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
    };
    const res = isEdit
      ? /* Edit TIDAK mengirim entryOrigin — asal entry tidak boleh berubah
         * hanya karena diperbaiki dari dashboard. Entry yang dulu dicatat
         * kasir di POS tetap terhitung sebagai isi laci. */
        await updateIncome(edit!.id, payload)
      : await createIncome({
          ...payload,
          /* Sesi AE-227 — dicatat dari dashboard: tidak menambah Kas
           * Harusnya kasir, karena uangnya tidak masuk ke laci. Kalau
           * uangnya diterima di kasir, kasir yang mencatatnya lewat Petty
           * Cash di POS. */
          entryOrigin: "backoffice",
        });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(
      isEdit
        ? `Pemasukan ${formatRupiah(parsedAmount)} diperbarui`
        : `Pemasukan ${formatRupiah(parsedAmount)} dicatat`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Pemasukan" : "Tambah Pemasukan Non-POS"}
      description={
        isEdit
          ? "Ubah detail pemasukan. Perubahan akan otomatis update jurnal akuntansi."
          : "Sewa ruang event, titip jual, dll. Pemasukan POS otomatis dari transaksi."
      }
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {isEdit ? "Simpan Perubahan" : "Simpan"}
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
          {/* Sesi AE-123 — pakai NumericInput supaya auto-format
           * thousand-separator (50000 → 50.000) live saat ketik. */}
          <NumericInput
            label="Nominal"
            prefix="Rp"
            value={amount}
            onChange={setAmount}
            placeholder="0"
            hint={
              parsedAmount > 0 ? `${formatRupiah(parsedAmount)}` : undefined
            }
            required
          />
        </div>
        <div>
          <Input
            label="Deskripsi"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (e.target.value.trim().length > 0) setDescTouched(false);
            }}
            onBlur={() => setDescTouched(true)}
            placeholder="Misal: sewa ruang event komunitas fotografi"
            required
            maxLength={200}
            className={
              showDescError
                ? "border-danger-500 focus:border-danger-500 focus:ring-danger-500/40"
                : undefined
            }
          />
          {showDescError ? (
            <p className="mt-1 text-xs font-medium text-danger-500">
              Deskripsi wajib diisi
            </p>
          ) : null}
        </div>
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

        {/* Sesi AE-69 — Bank account selector (hanya kalau metode != cash).
         * Sesi AE-74 — switched dari native <select> ke Select reusable. */}
        {method !== "cash" ? (
          bankAccounts.length === 0 ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-neutral-900">
                Rekening Bank{" "}
                <span className="text-xs font-normal text-neutral-500">
                  (opsional — pilih kalau spesifik)
                </span>
              </label>
              <p className="rounded-md border border-warning-300 bg-warning-100/40 px-3 py-2 text-xs text-warning-700">
                Belum ada master rekening bank. Set di Pengaturan → Rekening
                Bank. Sementara akan pakai default mapping per metode.
              </p>
            </div>
          ) : (
            <Select
              label="Rekening Bank"
              placeholder="— Pilih rekening (opsional) —"
              options={bankAccounts.map((b) => ({
                value: b.id,
                label: formatBankAccountDisplay(b),
              }))}
              value={bankAccountId || undefined}
              onValueChange={(v) => setBankAccountId(v)}
              hint="Pemasukan terkait dengan rekening yang dipilih. Resolver pakai nama bank (BCA / BRI / dll) untuk derive akun GL yang sesuai di jurnal — kalau kosong, fallback ke mapping default."
            />
          )
        ) : null}

        {/* Sesi AE-71 — Kategori Pendapatan selector (Cr side override).
         * Sesi AE-73 — rename "Akun Pendapatan" → "Kategori Pendapatan"
         * supaya konsisten dengan form Pengeluaran yang pakai "Kategori".
         * Sesi AE-74 — switched dari native <select> ke Select reusable.
         * Radix Select disallow empty-string sebagai option value, jadi
         * "Default (4201)" pakai sentinel "__default__" → convert ke "" di
         * onValueChange. */}
        {revenueAccounts.length === 0 ? (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Kategori Pendapatan{" "}
              <span className="text-xs font-normal text-neutral-500">
                (untuk breakdown di Laporan Laba Rugi)
              </span>
            </label>
            <p className="rounded-md border border-warning-300 bg-warning-100/40 px-3 py-2 text-xs text-warning-700">
              Memuat akun pendapatan…
            </p>
          </div>
        ) : (
          <Select
            label="Kategori Pendapatan"
            options={[
              {
                value: "__default__",
                label: "Default (4201 Pendapatan Lain-lain)",
              },
              ...revenueAccounts
                .filter((a) => a.code !== "4201")
                .map((a) => ({
                  value: a.id,
                  label: `${a.code} — ${a.name}`,
                })),
            ]}
            value={accountId || "__default__"}
            onValueChange={(v) => setAccountId(v === "__default__" ? "" : v)}
            hint="Pilih akun pendapatan specific (mis. 4202 Sewa Ruang, 4203 Titip Jual) untuk breakdown lebih granular di Laporan Laba Rugi. Default → 4201 Pendapatan Lain-lain (generic)."
          />
        )}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
