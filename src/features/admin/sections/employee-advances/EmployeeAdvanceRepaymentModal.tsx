"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Paperclip,
  UploadCloud,
  X,
} from "lucide-react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import {
  isOk,
  postEmployeeAdvanceRepayment,
  type EmployeeAdvanceRepaymentMethod,
  type EmployeeAdvanceWithEmployee,
} from "@/features/employee-advances";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-209 — Modal cicilan kasbon karyawan.
 *
 * Sebelum ini kasbon cuma bisa lunas sekaligus (dipotong gaji penuh) atau
 * di-forgive. Sekarang karyawan boleh nyicil: setor tunai ke kasir atau
 * transfer ke rekening bisnis, dan buktinya bisa dilampirkan.
 *
 * Sisa kasbon setelah dicicil itulah yang nanti dipotong dari gaji saat
 * payroll di-compute — jadi tidak ada tagihan dobel.
 */

interface EmployeeAdvanceRepaymentModalProps {
  advance: EmployeeAdvanceWithEmployee;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => todayJakarta();

export function EmployeeAdvanceRepaymentModal({
  advance,
  onClose,
  onSaved,
}: EmployeeAdvanceRepaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] =
    useState<EmployeeAdvanceRepaymentMethod>("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [description, setDescription] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void listBankAccounts().then((res) => {
      if (cancelled) return;
      if (res.ok) setBankList(res.data);
      setLoadingBanks(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const parsedAmount = useMemo(() => {
    try {
      return parseRupiah(amount);
    } catch {
      return 0;
    }
  }, [amount]);

  const remaining = advance.remainingAmount;
  const newRemaining = remaining - parsedAmount;
  const byTransfer = method === "transfer";

  const validation = useMemo(() => {
    if (parsedAmount <= 0) return { ok: false, message: "Nominal harus > 0" };
    if (parsedAmount > remaining) {
      return {
        ok: false,
        message: `Cicilan melebihi sisa kasbon Rp ${remaining.toLocaleString("id-ID")}`,
      };
    }
    if (byTransfer && !bankAccountId) {
      return { ok: false, message: "Pilih rekening bisnis penerima transfer" };
    }
    return { ok: true, message: "" };
  }, [parsedAmount, remaining, byTransfer, bankAccountId]);

  /* Bukti transfer naik ke Drive lewat endpoint bukti jurnal (folder
   * BUKTI JURNAL/{tahun}/{bulan} mengikuti tanggal setor). */
  async function handleReceiptUpload(file: File) {
    if (uploadingReceipt) return;
    setUploadError(null);
    if (!occurredAt) {
      setUploadError("Isi Tanggal Setor dulu sebelum unggah bukti");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Bukti maksimal 5 MB");
      return;
    }
    setUploadingReceipt(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entryDate", occurredAt);
      const res = await fetch("/api/v1/journal-receipts/upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as
        | { success: true; data: { url: string; folderPath: string } }
        | { success: false; error: { code: string; message: string } };
      if (!json.success) throw new Error(json.error.message);
      setReceiptUrl(json.data.url);
      toast.success(`Bukti tersimpan di Drive · ${json.data.folderPath}`);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload bukti gagal");
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit() {
    if (submitting || !validation.ok) return;
    const selectedBank = bankList.find((b) => b.id === bankAccountId);
    const viaLine = byTransfer
      ? `Transfer ke: ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}`
      : "Setor tunai ke kasir";
    if (
      !window.confirm(
        `Catat cicilan kasbon ${advance.employeeName}?\nNominal: ${formatRupiah(parsedAmount)}\n${viaLine}\nSisa kasbon setelah ini: ${formatRupiah(newRemaining)}${newRemaining === 0 ? " (Lunas)" : ""}`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postEmployeeAdvanceRepayment({
      advanceId: advance.id,
      amount: parsedAmount,
      method,
      bankAccountId: byTransfer ? bankAccountId : null,
      occurredAt,
      description: description.trim() || null,
      receiptImageUrl: receiptUrl,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      res.data.remainingAmount === 0
        ? `Kasbon ${advance.employeeName} LUNAS — tidak akan dipotong dari gaji`
        : `Cicilan dicatat · sisa kasbon ${formatRupiah(res.data.remainingAmount)}`,
    );
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cicil Kasbon — ${advance.employeeName}`}
      description={`Sisa kasbon: ${formatRupiah(remaining)} dari total ${formatRupiah(Number(advance.amount))}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            /* Dikunci selagi bukti masih naik supaya cicilan tidak
             * tersimpan duluan tanpa lampiran (pola sesi AE-206). */
            disabled={!validation.ok || uploadingReceipt}
          >
            Catat {formatRupiah(parsedAmount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs">
          <div className="flex justify-between">
            <span>Kasbon {advance.issuedDate}</span>
            <span className="font-mono font-semibold">
              {formatRupiah(Number(advance.amount))}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sudah Dicicil</span>
            <span className="font-mono font-semibold">
              {formatRupiah(Number(advance.repaidAmount ?? 0))}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sisa</span>
            <span className="font-mono font-semibold text-mahakan-green-900">
              {formatRupiah(remaining)}
            </span>
          </div>
          {parsedAmount > 0 && validation.ok ? (
            <div className="mt-1 flex justify-between border-t border-mahakan-green-200 pt-1 text-mahakan-green-700">
              <span>Sisa setelah cicilan ini</span>
              <span className="font-mono font-semibold">
                {formatRupiah(newRemaining)}{" "}
                {newRemaining === 0 ? "(Lunas ✓)" : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Nominal Cicilan"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="200000"
            hint={
              parsedAmount > 0
                ? `Preview: ${formatRupiah(parsedAmount)}`
                : `Sisa kasbon ${formatRupiah(remaining)}`
            }
          />
          <DatePicker
            label="Tanggal Setor"
            value={occurredAt}
            onChange={(v) => setOccurredAt(v ?? today())}
            clearable={false}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Cara Bayar"
            options={[
              { value: "cash", label: "Setor Tunai (ke kasir)" },
              { value: "transfer", label: "Transfer ke Rekening Bisnis" },
            ]}
            value={method}
            onValueChange={(val) => {
              setMethod(val as EmployeeAdvanceRepaymentMethod);
              /* Reset rekening supaya tidak terkirim pasangan yang tidak
               * dipakai (dijaga juga oleh check constraint di DB). */
              if (val === "cash") setBankAccountId("");
            }}
          />
          {byTransfer ? (
            loadingBanks ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="size-4 animate-spin" /> Memuat rekening…
              </div>
            ) : (
              <Select
                label="Rekening Penerima"
                placeholder="— Pilih rekening —"
                options={bankList
                  .filter((b) => b.isActive)
                  .map((b) => ({
                    value: b.id,
                    label: formatBankAccountDisplay(b),
                  }))}
                value={bankAccountId || undefined}
                onValueChange={setBankAccountId}
              />
            )
          ) : null}
        </div>

        <Input
          label="Catatan (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="mis. dibayar pas gajian kecil"
        />

        {/* Bukti transfer/setor — naik ke Google Drive folder BUKTI JURNAL. */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Bukti Transfer{" "}
            <span className="font-normal text-neutral-500">(opsional)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleReceiptUpload(file);
            }}
          />
          {receiptUrl ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-mahakan-green-700/30 bg-mahakan-green-50 px-3 py-2">
              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-mahakan-green-900 hover:underline"
              >
                <Paperclip className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  Bukti tersimpan di Drive — klik untuk lihat
                </span>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              </a>
              <button
                type="button"
                onClick={() => setReceiptUrl(null)}
                disabled={submitting || uploadingReceipt}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-danger-100 hover:text-danger-500"
                aria-label="Lepas bukti dari cicilan ini (file tetap ada di Drive)"
                title="Lepas bukti dari cicilan ini (file tetap ada di Drive)"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleReceiptUpload(file);
              }}
              className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50/60 px-3 py-4 text-center"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingReceipt || submitting}
              >
                {uploadingReceipt ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Mengunggah…
                  </>
                ) : (
                  <>
                    <UploadCloud className="size-4" /> Lampirkan Bukti
                  </>
                )}
              </Button>
              <p className="text-[11px] text-neutral-500">
                Tarik file ke sini atau klik tombol · JPG / PNG / WebP / PDF,
                maks 5 MB · disimpan ke Google Drive folder{" "}
                <em>BUKTI JURNAL</em>
              </p>
            </div>
          )}
          {uploadError ? (
            <p className="text-xs text-danger-600">{uploadError}</p>
          ) : null}
        </div>

        {!validation.ok && parsedAmount > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{validation.message}</span>
          </div>
        ) : null}

        {/* Sesi AE-209b — kasbon sudah masuk pembukuan sebagai piutang, jadi
         * cicilannya ikut dijurnal. Kasbon lama (tanpa jurnal pembukaan)
         * tetap cuma jadi catatan. */}
        {advance.journalEntryId ? (
          parsedAmount > 0 && validation.ok ? (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
              <p className="mb-1 font-semibold">Preview Jurnal:</p>
              <p>
                Dr {byTransfer ? "Bank (resolved)" : "1101 Kas"} ..........{" "}
                {formatRupiah(parsedAmount)}
              </p>
              <p>
                &nbsp;&nbsp;Cr 1155 Piutang Kasbon Karyawan ..{" "}
                {formatRupiah(parsedAmount)}
              </p>
            </div>
          ) : null
        ) : (
          <p className="text-[11px] leading-relaxed text-neutral-500">
            Kasbon ini tercatat sebelum kasbon masuk pembukuan, jadi
            cicilannya hanya jadi catatan (tanpa jurnal) — sama seperti saat
            kasbonnya diberikan. Sisa kasbon tetap berkurang, dan potongan
            gaji periode berikutnya ikut berkurang.
          </p>
        )}
      </div>
    </Modal>
  );
}
