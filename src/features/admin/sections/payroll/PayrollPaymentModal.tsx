"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  formatBankAccountDisplay,
  listBankAccounts,
  type BankAccount,
} from "@/features/bank-accounts";
import {
  isOk,
  markPayrollPaid,
  updatePayrollPaymentMethod,
} from "@/features/payroll";
import { formatRupiah } from "@/lib/format";

/**
 * Sesi AE-210 — REKENING SUMBER PEMBAYARAN GAJI.
 *
 * Kejadian nyata yang ditutup modal ini: gaji ditransfer dari BRI, tapi
 * sistem mencatatnya keluar dari BCA — dulu tombol "Mark Paid" langsung
 * memanggil markPayrollPaid tanpa menanyakan apa pun, dan SEMUA pembayaran
 * non-tunai hardcoded mengkredit 1110 Bank BCA. Saldo BCA di Neraca jadi
 * minus dan saldo BRI ketinggian, tanpa satu error pun yang muncul.
 *
 * Dua mode dalam satu modal:
 *   - "pay"    : saat menandai periode lunas (status finalized → paid).
 *   - "correct": saat rekeningnya terlanjur salah (status sudah paid).
 *                Jurnal lama dibalik lalu diposting ulang ke akun yang
 *                benar, jadi alasan koreksi WAJIB diisi untuk jejak audit.
 */

export type PayrollPaymentMode = "pay" | "correct";

interface PayrollPaymentModalProps {
  mode: PayrollPaymentMode;
  periodId: string;
  periodLabel: string;
  /** Total netPay periode — dipakai di ringkasan konfirmasi. */
  totalNetPay: number;
  /** Nilai tercatat sekarang (mode "correct"). */
  currentPaymentMethod?: "cash" | "transfer" | "other" | null;
  currentBankAccountId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PayrollPaymentModal({
  mode,
  periodId,
  periodLabel,
  totalNetPay,
  currentPaymentMethod,
  currentBankAccountId,
  onClose,
  onSaved,
}: PayrollPaymentModalProps) {
  const [method, setMethod] = useState<"cash" | "transfer">(
    currentPaymentMethod === "cash" ? "cash" : "transfer",
  );
  const [bankAccountId, setBankAccountId] = useState(
    currentBankAccountId ?? "",
  );
  const [reason, setReason] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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

  const byTransfer = method === "transfer";
  const selectedBank = useMemo(
    () => bankList.find((b) => b.id === bankAccountId) ?? null,
    [bankList, bankAccountId],
  );

  /* Rekening WAJIB dipilih untuk transfer. Tanpa rem ini pilihan kosong
   * diam-diam jatuh ke 1110 BCA lagi — persis bug yang sedang ditutup. */
  const isCorrection = mode === "correct";
  const changed =
    !isCorrection ||
    method !== (currentPaymentMethod === "cash" ? "cash" : "transfer") ||
    (byTransfer && bankAccountId !== (currentBankAccountId ?? ""));
  const canSubmit =
    (!byTransfer || bankAccountId !== "") &&
    (!isCorrection || (reason.trim().length >= 5 && changed));

  async function handleSubmit() {
    if (!canSubmit) return;
    const viaLine = byTransfer
      ? `Transfer dari: ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}`
      : "Tunai dari kas";
    if (
      !window.confirm(
        isCorrection
          ? `Koreksi rekening pembayaran gaji ${periodLabel}?\n${viaLine}\n\nJurnal lama akan DIBALIK dan diposting ulang ke akun yang benar.`
          : `Tandai payroll "${periodLabel}" sebagai Paid?\nTotal: ${formatRupiah(totalNetPay)}\n${viaLine}`,
      )
    ) {
      return;
    }

    setSubmitting(true);
    /* Dua action punya bentuk data sukses yang beda, jadi hasilnya
     * disederhanakan jadi pesan error saja — cabangnya dipisah supaya
     * penyempitan tipe `isOk` tetap bekerja pada masing-masing. */
    let errorMessage: string | null = null;
    if (isCorrection) {
      const res = await updatePayrollPaymentMethod({
        periodId,
        paymentMethod: method,
        bankAccountId: byTransfer ? bankAccountId : null,
        reason: reason.trim(),
      });
      if (!isOk(res)) errorMessage = res.error.message;
    } else {
      const res = await markPayrollPaid(
        periodId,
        method,
        byTransfer ? bankAccountId : null,
      );
      if (!isOk(res)) errorMessage = res.error.message;
    }
    setSubmitting(false);

    if (errorMessage) {
      toast.error(errorMessage);
      return;
    }
    toast.success(
      isCorrection
        ? `Rekening dikoreksi — jurnal diposting ulang ke ${
            byTransfer ? (selectedBank?.bankName ?? "rekening baru") : "Kas Tunai"
          }`
        : "Payroll ditandai paid",
    );
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isCorrection
          ? `Koreksi Rekening Pembayaran — ${periodLabel}`
          : `Bayar Payroll — ${periodLabel}`
      }
      description={
        isCorrection
          ? "Jurnal lama dibalik lalu diposting ulang ke akun bank yang benar. Tanggal jurnal tidak berubah."
          : `Pilih dari mana gaji dibayar. Total ${formatRupiah(totalNetPay)}.`
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          >
            {isCorrection ? "Koreksi & Posting Ulang" : "Tandai Paid"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Alasan kenapa modal ini ada — supaya owner paham taruhannya. */}
        <div className="flex gap-2 rounded-md border border-warning-200 bg-warning-50/60 p-3 text-xs text-warning-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Rekening yang dipilih menentukan <strong>saldo bank mana</strong>{" "}
            yang berkurang di Neraca. Salah pilih = saldo rekening itu jadi
            minus padahal uangnya keluar dari rekening lain.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Dibayar Lewat"
            options={[
              { value: "transfer", label: "Transfer Bank" },
              { value: "cash", label: "Tunai (kas)" },
            ]}
            value={method}
            onValueChange={(val) => {
              setMethod(val as "cash" | "transfer");
              /* Reset rekening supaya pasangan yang tidak dipakai tidak
               * ikut terkirim (dijaga juga oleh check constraint di DB). */
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
                label="Rekening Asal Transfer"
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

        {byTransfer && !loadingBanks && bankList.length === 0 ? (
          <p className="text-xs text-warning-700">
            Belum ada rekening terdaftar. Owner perlu daftar dulu di{" "}
            <strong>Pengaturan → Rekening Bank</strong>.
          </p>
        ) : null}

        {isCorrection ? (
          <Input
            label="Alasan Koreksi"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="mis. gaji Juli ditransfer dari BRI, bukan BCA"
            hint="Wajib — tersimpan di jejak audit & deskripsi jurnal pembalik."
          />
        ) : null}
      </div>
    </Modal>
  );
}
