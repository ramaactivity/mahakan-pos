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
  postRepayment,
  type Creditor,
  type RepaymentFundingSource,
} from "@/features/creditors";
import { listPengelola } from "@/features/pengelola";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-80 — Modal cicilan kreditur.
 *
 * Auto-calc bunga sesuai outstanding × rate kalau period='monthly'
 * (sebagai suggestion; owner bisa edit manual).
 *
 * Journal: Dr 2150 (pokok) + Dr 6701 (bunga, skip kalau 0) / Cr Bank.
 *
 * Sesi AE-208 — tambahan permintaan owner:
 *  - Bukti transfer di-upload ke Google Drive (folder BUKTI JURNAL, sama
 *    seperti bukti entry jurnal manual) dan URL-nya nempel di cicilan +
 *    jurnalnya.
 *  - Sumber dana bisa uang perusahaan (Mahakan) atau uang pribadi
 *    pengelola. Kalau pengelola yang menalangi, kas perusahaan tidak
 *    bergerak — hutang ke kreditur berpindah jadi modal pengelola:
 *    Cr 3101 Modal Owner dan `pengelola.modalDisetor` naik sebesar total
 *    cicilan (pokok + bunga).
 */

interface CreditorRepaymentModalProps {
  open: boolean;
  creditor: Creditor;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => todayJakarta();

interface PengelolaOption {
  id: string;
  fullName: string;
  modalDisetor: number;
}

export function CreditorRepaymentModal({
  open,
  creditor,
  onClose,
  onSaved,
}: CreditorRepaymentModalProps) {
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestAmount, setInterestAmount] = useState("");
  const [fundingSource, setFundingSource] =
    useState<RepaymentFundingSource>("company");
  const [bankAccountId, setBankAccountId] = useState("");
  const [pengelolaId, setPengelolaId] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [description, setDescription] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [pengelolaList, setPengelolaList] = useState<PengelolaOption[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [loadingPengelola, setLoadingPengelola] = useState(true);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrincipalAmount("");
    /* Auto-suggest bunga: outstanding × rate kalau monthly. */
    const interestRate = Number(creditor.interestRatePct);
    const suggestedInterest =
      creditor.interestPeriod === "monthly"
        ? Math.round((creditor.principalOutstanding * interestRate) / 100)
        : 0;
    setInterestAmount(String(suggestedInterest));
    setFundingSource("company");
    setBankAccountId("");
    setPengelolaId("");
    setOccurredAt(today());
    setDescription("");
    setReceiptUrl(null);
    setUploadError(null);
    setUploadingReceipt(false);
    setSubmitting(false);
    setLoadingBanks(true);
    setLoadingPengelola(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void listBankAccounts().then((res) => {
      if (cancelled) return;
      if (res.ok) setBankList(res.data);
      setLoadingBanks(false);
    });
    void listPengelola().then((res) => {
      if (cancelled) return;
      if (res.success) {
        setPengelolaList(
          res.data
            .filter((p) => p.status === "active")
            .map((p) => ({
              id: p.id,
              fullName: p.fullName,
              modalDisetor: p.modalDisetor,
            })),
        );
      }
      setLoadingPengelola(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, creditor]);

  const parsedPrincipal = useMemo(() => {
    try {
      return parseRupiah(principalAmount);
    } catch {
      return 0;
    }
  }, [principalAmount]);

  const parsedInterest = useMemo(() => {
    try {
      return parseRupiah(interestAmount);
    } catch {
      return 0;
    }
  }, [interestAmount]);

  const total = parsedPrincipal + parsedInterest;
  const newOutstanding = creditor.principalOutstanding - parsedPrincipal;
  const byPengelola = fundingSource === "pengelola";
  const selectedPengelola = pengelolaList.find((p) => p.id === pengelolaId);

  const validation = useMemo(() => {
    if (total <= 0) return { ok: false, message: "Total cicilan harus > 0" };
    if (parsedPrincipal > creditor.principalOutstanding)
      return {
        ok: false,
        message: `Pokok cicilan melebihi sisa hutang Rp ${creditor.principalOutstanding.toLocaleString("id-ID")}`,
      };
    if (byPengelola) {
      if (!pengelolaId)
        return { ok: false, message: "Pilih pengelola yang membayar" };
    } else if (!bankAccountId) {
      return { ok: false, message: "Pilih bank sumber" };
    }
    return { ok: true, message: "" };
  }, [
    total,
    parsedPrincipal,
    creditor.principalOutstanding,
    byPengelola,
    bankAccountId,
    pengelolaId,
  ]);

  /* Sesi AE-208 — bukti transfer naik ke Drive lewat endpoint bukti jurnal
   * (folder BUKTI JURNAL/{tahun}/{bulan} mengikuti tanggal bayar), lalu
   * URL-nya nempel di cicilan + jurnalnya. */
  async function handleReceiptUpload(file: File) {
    if (uploadingReceipt) return;
    setUploadError(null);
    if (!occurredAt) {
      setUploadError("Isi Tanggal Bayar dulu sebelum unggah bukti");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Bukti transfer maksimal 5 MB");
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
    const sumberLine = byPengelola
      ? `Sumber: uang pengelola ${selectedPengelola?.fullName ?? "-"}\nModal ${selectedPengelola?.fullName ?? ""} naik jadi ${formatRupiah((selectedPengelola?.modalDisetor ?? 0) + total)}`
      : `Via: ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}`;
    if (
      !window.confirm(
        `Bayar cicilan ${creditor.fullName}?\nPokok: ${formatRupiah(parsedPrincipal)}\nBunga: ${formatRupiah(parsedInterest)}\nTotal: ${formatRupiah(total)}\n${sumberLine}`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postRepayment({
      creditorId: creditor.id,
      fundingSource,
      bankAccountId: byPengelola ? null : bankAccountId,
      paidByPengelolaId: byPengelola ? pengelolaId : null,
      principalAmount: parsedPrincipal,
      interestAmount: parsedInterest,
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
      byPengelola
        ? `Cicilan ${creditor.fullName} dicatat — modal ${selectedPengelola?.fullName ?? "pengelola"} naik ${formatRupiah(total)}`
        : `Cicilan ${creditor.fullName} dicatat`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Cicilan — ${creditor.fullName}`}
      description={`Outstanding: ${formatRupiah(creditor.principalOutstanding)} dari pokok awal ${formatRupiah(creditor.principalOriginal)}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            /* Tombol dikunci selagi bukti masih naik supaya cicilan tidak
             * tersimpan duluan tanpa lampiran (pola sesi AE-206). */
            disabled={!validation.ok || loadingBanks || uploadingReceipt}
          >
            Bayar {formatRupiah(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs">
          <div className="flex justify-between">
            <span>Pokok Awal</span>
            <span className="font-mono font-semibold">
              {formatRupiah(creditor.principalOriginal)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sisa Hutang</span>
            <span className="font-mono font-semibold text-mahakan-green-900">
              {formatRupiah(creditor.principalOutstanding)}
            </span>
          </div>
          {parsedPrincipal > 0 && validation.ok ? (
            <div className="mt-1 border-t border-mahakan-green-200 pt-1 flex justify-between text-mahakan-green-700">
              <span>Sisa setelah bayar</span>
              <span className="font-mono font-semibold">
                {formatRupiah(newOutstanding)}{" "}
                {newOutstanding === 0 ? "(Lunas ✓)" : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Pokok Cicilan"
            type="text"
            inputMode="numeric"
            value={principalAmount}
            onChange={(e) =>
              setPrincipalAmount(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="500000"
            hint={
              parsedPrincipal > 0
                ? `Preview: ${formatRupiah(parsedPrincipal)}`
                : undefined
            }
          />
          <Input
            label={`Bunga (${creditor.interestRatePct}%/${creditor.interestPeriod})`}
            type="text"
            inputMode="numeric"
            value={interestAmount}
            onChange={(e) =>
              setInterestAmount(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="0"
            hint={
              parsedInterest > 0
                ? `Preview: ${formatRupiah(parsedInterest)}`
                : "0 = tanpa bunga periode ini"
            }
          />
        </div>

        {/* Sesi AE-208 — sumber dana. Pilihannya menentukan lawan jurnal:
         * kas bank (uang perusahaan) atau 3101 Modal Owner (talangan
         * pengelola). */}
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Dibayar Pakai Uang"
            options={[
              { value: "company", label: "Uang Perusahaan (Mahakan)" },
              { value: "pengelola", label: "Uang Pengelola (pribadi)" },
            ]}
            value={fundingSource}
            onValueChange={(val) => {
              setFundingSource(val as RepaymentFundingSource);
              /* Reset pilihan jalur sebelahnya supaya tidak terkirim
               * pasangan yang tidak dipakai. */
              if (val === "pengelola") setBankAccountId("");
              else setPengelolaId("");
            }}
          />
          {byPengelola ? (
            loadingPengelola ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="size-4 animate-spin" /> Memuat pengelola…
              </div>
            ) : (
              <Select
                label="Pengelola yang Membayar"
                placeholder="— Pilih pengelola —"
                options={pengelolaList.map((p) => ({
                  value: p.id,
                  label: `${p.fullName} · modal ${formatRupiah(p.modalDisetor)}`,
                }))}
                value={pengelolaId || undefined}
                onValueChange={setPengelolaId}
              />
            )
          ) : loadingBanks ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Memuat bank…
            </div>
          ) : (
            <Select
              label="Bank Sumber"
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
          )}
        </div>

        {byPengelola && selectedPengelola && total > 0 ? (
          <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/60 p-2 text-xs text-mahakan-green-900">
            Kas Mahakan tidak berkurang. Hutang ke {creditor.fullName} berpindah
            jadi modal {selectedPengelola.fullName}:{" "}
            <span className="font-mono font-semibold">
              {formatRupiah(selectedPengelola.modalDisetor)} →{" "}
              {formatRupiah(selectedPengelola.modalDisetor + total)}
            </span>
            . Porsi bagi hasil pengelola ikut menyesuaikan.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <DatePicker
            label="Tanggal Bayar"
            value={occurredAt}
            onChange={(v) => setOccurredAt(v ?? today())}
            clearable={false}
          />
        </div>

        <Input
          label="Catatan (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />

        {/* Sesi AE-208 — bukti transfer. Filenya naik ke Google Drive
         * (folder BUKTI JURNAL/{tahun}/{bulan}) dan URL-nya nempel di
         * cicilan + jurnalnya, jadi bisa dibuka lagi dari Riwayat Cicilan
         * maupun halaman Jurnal. */}
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
                    <UploadCloud className="size-4" /> Lampirkan Bukti Transfer
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

        {validation.ok && total > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
            <p className="mb-1 font-semibold not-italic">Preview Jurnal:</p>
            {parsedPrincipal > 0 ? (
              <p>Dr 2150 Hutang Kreditur ........ {formatRupiah(parsedPrincipal)}</p>
            ) : null}
            {parsedInterest > 0 ? (
              <p>Dr 6701 Beban Bunga Kreditur ... {formatRupiah(parsedInterest)}</p>
            ) : null}
            <p>
              &nbsp;&nbsp;Cr{" "}
              {byPengelola
                ? "3101 Modal Owner (pengelola)"
                : "Bank (resolved) ..........."}{" "}
              {formatRupiah(total)}
            </p>
          </div>
        ) : null}

        {!validation.ok && (parsedPrincipal > 0 || parsedInterest > 0) ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{validation.message}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
