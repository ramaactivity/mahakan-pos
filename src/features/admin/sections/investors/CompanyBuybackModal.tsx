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
  Combobox,
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
  listInvestors,
  isOk as investorsIsOk,
  type InvestorWithStats,
} from "@/features/investors";
import {
  companyBuyback,
  isOk as shareIsOk,
} from "@/features/share-transactions";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-80 — Company buyback modal.
 *
 * Outlet beli kembali share investor. Journal Dr 3401 Treasury Stock /
 * Cr Bank. Sisa share (100 - sum) jadi "company hold" — compute v2
 * alokasi sisa% ke pengelola_pool.
 *
 * Sesi AE-208 — bukti transfer: kas keluar ke investor, jadi filenya
 * diunggah ke Google Drive (folder BUKTI JURNAL, pola sesi AE-206) dan
 * URL-nya nempel di mutasi sahamnya + jurnalnya.
 */

interface CompanyBuybackModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function CompanyBuybackModal({
  open,
  onClose,
  onSaved,
}: CompanyBuybackModalProps) {
  const [investors, setInvestors] = useState<InvestorWithStats[]>([]);
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [fromId, setFromId] = useState<string | null>(null);
  const [sharePctDelta, setSharePctDelta] = useState("");
  const [amountIdr, setAmountIdr] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFromId(null);
    setSharePctDelta("");
    setAmountIdr("");
    setBankAccountId("");
    setDescription("");
    setReceiptUrl(null);
    setUploadError(null);
    setUploadingReceipt(false);
    setSubmitting(false);
    setLoadingList(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void Promise.all([
      listInvestors({ status: "active", pageSize: 200 }),
      listBankAccounts(),
    ]).then(([invRes, bankRes]) => {
      if (cancelled) return;
      if (investorsIsOk(invRes)) setInvestors(invRes.data.items);
      if (bankRes.ok) setBankList(bankRes.data);
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const fromInvestor = investors.find((i) => i.id === fromId) ?? null;
  const delta = Number(sharePctDelta) || 0;
  const fromCurrent = fromInvestor ? Number(fromInvestor.sharePct) : 0;
  const fromAfter = fromCurrent - delta;

  const parsedAmount = useMemo(() => {
    try {
      return parseRupiah(amountIdr);
    } catch {
      return 0;
    }
  }, [amountIdr]);

  const validation = useMemo(() => {
    if (!fromId) return { ok: false, message: "Pilih investor" };
    if (delta <= 0) return { ok: false, message: "Delta > 0" };
    if (fromCurrent < delta)
      return {
        ok: false,
        message: `Investor hanya punya ${fromCurrent.toFixed(4)}%`,
      };
    if (parsedAmount <= 0)
      return { ok: false, message: "Nominal pembayaran > 0" };
    if (!bankAccountId) return { ok: false, message: "Pilih bank sumber" };
    return { ok: true, message: "" };
  }, [fromId, delta, fromCurrent, parsedAmount, bankAccountId]);

  /* Sesi AE-208 — bukti transfer naik ke Drive lewat endpoint bukti jurnal.
   * Buyback tidak punya field tanggal (selalu dicatat hari ini), jadi
   * subfolder tahun/bulan-nya ikut tanggal WIB hari ini. */
  async function handleReceiptUpload(file: File) {
    if (uploadingReceipt) return;
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Bukti transfer maksimal 5 MB");
      return;
    }
    setUploadingReceipt(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entryDate", todayJakarta());
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
    if (submitting || !validation.ok || !fromId) return;
    const selectedBank = bankList.find((b) => b.id === bankAccountId);
    if (
      !confirm(
        `Company buyback?\n\n${fromInvestor?.fullName}: ${fromCurrent.toFixed(4)}% → ${fromAfter.toFixed(4)}%\nBayar: ${formatRupiah(parsedAmount)} via ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}\n\nJurnal: Dr 3401 Treasury Stock / Cr Bank\nSisa ${delta.toFixed(4)}% jadi "company hold".`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await companyBuyback({
      fromInvestorId: fromId,
      sharePctDelta: delta,
      amountIdr: parsedAmount,
      bankAccountId,
      description: description.trim() || null,
      receiptImageUrl: receiptUrl,
    });
    setSubmitting(false);
    if (!shareIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Buyback ${delta}% saham ${fromInvestor?.fullName}`);
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Company Buyback Saham"
      description="Outlet beli kembali share dari investor. Kas keluar, share jadi treasury (company hold)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            /* Dikunci selagi bukti masih naik supaya buyback tidak tersimpan
             * duluan tanpa lampiran (pola sesi AE-206). */
            disabled={!validation.ok || uploadingReceipt}
          >
            Buyback {formatRupiah(parsedAmount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" /> Memuat data…
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-neutral-900">
                Dari Investor
              </label>
              <Combobox
                placeholder="Pilih investor…"
                searchPlaceholder="Cari investor…"
                clearable={false}
                groups={[
                  {
                    label: "",
                    options: investors.map((i) => ({
                      value: i.id,
                      label: i.fullName,
                      hint: `${Number(i.sharePct).toFixed(4)}%`,
                    })),
                  },
                ]}
                value={fromId}
                onChange={setFromId}
              />
              {fromInvestor ? (
                <p className="mt-1 text-[11px] text-neutral-600">
                  Share saat ini: {fromCurrent.toFixed(4)}%
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Delta Share % yang dibeli"
                type="number"
                value={sharePctDelta}
                onChange={(e) => setSharePctDelta(e.target.value)}
                placeholder="5"
                step={0.0001}
                min={0}
                max={100}
              />
              <Input
                label="Nominal Pembayaran"
                type="text"
                inputMode="numeric"
                value={amountIdr}
                onChange={(e) =>
                  setAmountIdr(e.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="5000000"
                hint={
                  parsedAmount > 0
                    ? `Preview: ${formatRupiah(parsedAmount)}`
                    : undefined
                }
              />
            </div>

            <Select
              label="Bank Sumber Kas"
              placeholder="— Pilih bank —"
              options={bankList
                .filter((b) => b.isActive)
                .map((b) => ({
                  value: b.id,
                  label: formatBankAccountDisplay(b),
                }))}
              value={bankAccountId || undefined}
              onValueChange={setBankAccountId}
            />

            <Input
              label="Catatan (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />

            {/* Sesi AE-208 — bukti transfer. Filenya naik ke Google Drive
             * (folder BUKTI JURNAL/{tahun}/{bulan}) dan URL-nya nempel di
             * mutasi sahamnya + jurnalnya, jadi bisa dibuka lagi dari
             * Riwayat Mutasi Saham maupun halaman Jurnal. */}
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
                    aria-label="Lepas bukti dari buyback ini (file tetap ada di Drive)"
                    title="Lepas bukti dari buyback ini (file tetap ada di Drive)"
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
                        Transfer
                      </>
                    )}
                  </Button>
                  <p className="text-[11px] text-neutral-500">
                    Tarik file ke sini atau klik tombol · JPG / PNG / WebP /
                    PDF, maks 5 MB · disimpan ke Google Drive folder{" "}
                    <em>BUKTI JURNAL</em>
                  </p>
                </div>
              )}
              {uploadError ? (
                <p className="text-xs text-danger-600">{uploadError}</p>
              ) : null}
            </div>

            {validation.ok ? (
              <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs">
                <p className="mb-2 font-semibold text-mahakan-green-900">
                  Preview Setelah Buyback:
                </p>
                <div className="flex justify-between">
                  <span>{fromInvestor?.fullName}</span>
                  <span className="font-mono">
                    {fromCurrent.toFixed(4)}% →{" "}
                    <strong className="text-danger-600">
                      {fromAfter.toFixed(4)}%
                    </strong>
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-neutral-700">
                  <span>Company hold (treasury)</span>
                  <span className="font-mono font-semibold">
                    +{delta.toFixed(4)}%
                  </span>
                </div>
                <div className="mt-2 border-t border-mahakan-green-200 pt-2 text-[11px] font-mono">
                  <p>Dr 3401 Treasury Stock .... {formatRupiah(parsedAmount)}</p>
                  <p>&nbsp;&nbsp;Cr Bank ........... {formatRupiah(parsedAmount)}</p>
                </div>
              </div>
            ) : null}

            {!validation.ok && (fromId || sharePctDelta || amountIdr) ? (
              <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{validation.message}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
