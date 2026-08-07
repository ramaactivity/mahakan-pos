"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
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
  createExpense,
  isOk,
  updateExpense,
  type CashPaymentMethod,
  type Expense,
  type ExpenseCategory,
} from "@/features/cash";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

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
  const today = todayJakarta();
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<CashPaymentMethod>("cash");
  /* Sesi AE-69 — bank account selector untuk transfer/other */
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (edit) {
      setDate(edit.expenseDate);
      setCategoryId(edit.categoryId);
      setDescription(edit.description);
      setAmount(String(edit.amount));
      setMethod(edit.paymentMethod);
      setBankAccountId(edit.bankAccountId ?? "");
      setReceiptImageUrl(edit.receiptImageUrl ?? null);
    } else {
      setDate(today);
      const firstNonSystem = categories.find((c) => !c.isSystem);
      setCategoryId(firstNonSystem?.id ?? categories[0]?.id ?? "");
      setDescription("");
      setAmount("");
      setMethod("cash");
      setBankAccountId("");
      setReceiptImageUrl(null);
    }
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, categories, today, edit]);

  /* Load bank accounts */
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

  /* Sesi AE-123 — pakai NumericInput, value sudah raw digits string. */
  const parsedAmount = amount ? Number(amount) : 0;

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
    /* Sesi AE-69 — bankAccountId hanya relevan untuk transfer/other.
     * Tunai = cash drawer (1101), tidak butuh pilih bank account. */
    const resolvedBankAccountId =
      method === "cash" || !bankAccountId ? null : bankAccountId;
    const res = edit
      ? await updateExpense(edit.id, {
          expenseDate: date,
          categoryId,
          description: description.trim(),
          amount: parsedAmount,
          paymentMethod: method,
          receiptImageUrl,
          bankAccountId: resolvedBankAccountId,
        })
      : await createExpense({
          expenseDate: date,
          categoryId,
          description: description.trim(),
          amount: parsedAmount,
          paymentMethod: method,
          receiptImageUrl,
          bankAccountId: resolvedBankAccountId,
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
        {/* Sesi AE-73 — Layout 2-col, supaya form tidak memanjang ke bawah. */}
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

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Metode Bayar
            <span className="ml-2 text-xs font-normal text-neutral-500">
              (akun GL sumber dana)
            </span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                { v: "cash" as const, label: "Tunai", sub: "1101 Kas Tunai" },
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
              hint="Pengeluaran dari rekening yang dipilih. Resolver pakai nama bank (BCA / BRI / dll) untuk derive akun GL yang sesuai di jurnal — kalau kosong, fallback ke mapping default."
            />
          )
        ) : null}

        {/* Receipt photo upload (sesi V deferred — now live) */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Foto Struk (opsional)
          </label>
          {receiptImageUrl ? (
            receiptImageUrl.includes("drive.google.com") ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <a
                  href={receiptImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center gap-2 text-xs text-mahakan-green-900 hover:underline min-w-0"
                >
                  <ImagePlus className="size-4 shrink-0" />
                  <span className="truncate">
                    Lihat foto struk di Google Drive
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => setReceiptImageUrl(null)}
                  disabled={submitting || uploading}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                  aria-label="Hapus foto struk dari form (file tetap di Drive)"
                  title="Hapus dari form. File yang sudah di Drive tidak ikut hapus."
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative rounded-md border border-neutral-200 bg-neutral-50 p-2">
                <a
                  href={receiptImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receiptImageUrl}
                    alt="Foto struk"
                    className="max-h-48 w-full rounded object-contain"
                  />
                </a>
                <button
                  type="button"
                  onClick={() => setReceiptImageUrl(null)}
                  disabled={submitting || uploading}
                  className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-sm hover:bg-danger-100 hover:text-danger-500"
                  aria-label="Hapus foto struk"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          ) : (
            <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
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
                    // Upload to Google Drive via /api/v1/expense-receipts/upload.
                    // Server auto-creates "STRUK PENGELUARAN/{YYYY}/{NN. MONTH}/"
                    // subfolder per bulan (sesi AA #2 extension).
                    const fd = new FormData();
                    fd.append("file", file);
                    fd.append("expenseDate", date);
                    const res = await fetch(
                      "/api/v1/expense-receipts/upload",
                      { method: "POST", body: fd },
                    );
                    const json = (await res.json()) as
                      | {
                          success: true;
                          data: { url: string; folderPath: string };
                        }
                      | {
                          success: false;
                          error: { code: string; message: string };
                        };
                    if (!json.success) {
                      throw new Error(json.error.message);
                    }
                    setReceiptImageUrl(json.data.url);
                    toast.success(
                      `Struk tersimpan di Drive · ${json.data.folderPath}`,
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
                    <Loader2 className="size-4 animate-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <ImagePlus className="size-4" /> Upload Foto
                  </>
                )}
              </Button>
              <p className="mt-1 text-xs text-neutral-500">
                JPG / PNG / WebP, max 5 MB. Foto disimpan di Vercel Blob.
              </p>
            </div>
          )}
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
