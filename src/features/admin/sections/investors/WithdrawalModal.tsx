"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Button,
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
import { isOk, postWithdrawal } from "@/features/withdrawals";
import { formatRupiah, parseRupiah } from "@/lib/format";

/**
 * Sesi AE-80 — Modal "Tarik Saldo Dividen Investor".
 *
 * Triple validation realtime:
 *   - amount ≥ Rp 50.000 (DB CHECK + UI)
 *   - amount ≤ saldo dividen investor
 *   - bank account aktif + valid
 *
 * Server-side: lockInvestor + lockBankAccountAdvisory + re-check post-lock.
 *
 * Journal: Dr 3202 Hutang Dividen / Cr <bank code>. Capital movement
 * kind='dividend_withdrawal' di-create dengan link ke journal.
 */

interface WithdrawalModalProps {
  open: boolean;
  investorId: string;
  investorName: string;
  /** Saldo dividen investor saat ini (snapshot). Realtime balance pakai
   *  fetch ulang dari server lebih baik, tapi snapshot cukup untuk UI
   *  pre-validation. Server re-check anyway. */
  dividendBalance: number;
  onClose: () => void;
  onSaved: () => void;
}

const MIN_WITHDRAWAL = 50_000;

export function WithdrawalModal({
  open,
  investorId,
  investorName,
  dividendBalance,
  onClose,
  onSaved,
}: WithdrawalModalProps) {
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount("");
    setBankAccountId("");
    setDescription("");
    setSubmitting(false);
    setLoadingBanks(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void listBankAccounts().then((res) => {
      if (cancelled) return;
      if (res.ok) setBankList(res.data);
      setLoadingBanks(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const parsedAmount = useMemo(() => {
    try {
      return parseRupiah(amount);
    } catch {
      return 0;
    }
  }, [amount]);

  /* Realtime validation. */
  const validation = useMemo(() => {
    if (parsedAmount < MIN_WITHDRAWAL) {
      return {
        ok: false,
        message: `Min Rp ${MIN_WITHDRAWAL.toLocaleString("id-ID")}`,
      };
    }
    if (parsedAmount > dividendBalance) {
      return {
        ok: false,
        message: `Saldo dividen hanya Rp ${dividendBalance.toLocaleString("id-ID")}`,
      };
    }
    if (!bankAccountId) {
      return { ok: false, message: "Pilih bank tujuan" };
    }
    return { ok: true, message: "" };
  }, [parsedAmount, dividendBalance, bankAccountId]);

  async function handleSubmit() {
    if (submitting || !validation.ok) return;
    const selectedBank = bankList.find((b) => b.id === bankAccountId);
    if (
      !window.confirm(
        `Yakin tarik Rp ${parsedAmount.toLocaleString("id-ID")} ke ${selectedBank ? formatBankAccountDisplay(selectedBank) : "bank yang dipilih"}?\n\nJurnal: Dr 3202 / Cr Bank\nSaldo dividen ${investorName}: Rp ${dividendBalance.toLocaleString("id-ID")} → Rp ${(dividendBalance - parsedAmount).toLocaleString("id-ID")}`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postWithdrawal({
      investorId,
      amount: parsedAmount,
      bankAccountId,
      description: description.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Pencairan Rp ${parsedAmount.toLocaleString("id-ID")} ke ${investorName} berhasil`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Tarik Saldo Dividen — ${investorName}`}
      description={`Saldo tersedia: Rp ${dividendBalance.toLocaleString("id-ID")}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!validation.ok || loadingBanks}
          >
            Tarik Saldo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Sesi AE-80 — info card */}
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs text-neutral-700">
          <div className="flex items-baseline justify-between">
            <span>Investor</span>
            <span className="font-semibold">{investorName}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span>Saldo Dividen</span>
            <span className="font-bold text-mahakan-green-900">
              {formatRupiah(dividendBalance)}
            </span>
          </div>
          {parsedAmount > 0 && parsedAmount <= dividendBalance ? (
            <div className="mt-1 flex items-baseline justify-between text-mahakan-green-700">
              <span>Sisa setelah tarik</span>
              <span className="font-semibold">
                {formatRupiah(dividendBalance - parsedAmount)}
              </span>
            </div>
          ) : null}
        </div>

        <Input
          label="Nominal Tarik"
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) =>
            setAmount(e.target.value.replace(/[^\d]/g, ""))
          }
          placeholder="500000"
          hint={
            parsedAmount > 0
              ? `Preview: ${formatRupiah(parsedAmount)}`
              : `Min: ${formatRupiah(MIN_WITHDRAWAL)}`
          }
          error={
            amount && !validation.ok && parsedAmount > 0
              ? validation.message
              : undefined
          }
          required
        />

        {loadingBanks ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="size-4 animate-spin" /> Memuat daftar bank…
          </div>
        ) : bankList.length === 0 ? (
          <div className="rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            ⚠ Belum ada master bank. Tambah dulu di Pengaturan → Rekening
            Bank.
          </div>
        ) : (
          <Select
            label="Bank Tujuan"
            placeholder="— Pilih bank —"
            options={bankList
              .filter((b) => b.isActive)
              .map((b) => ({
                value: b.id,
                label: formatBankAccountDisplay(b),
              }))}
            value={bankAccountId || undefined}
            onValueChange={setBankAccountId}
            required
          />
        )}

        <Input
          label="Catatan (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="mis. tarik akhir bulan"
          maxLength={500}
        />

        {/* Sesi AE-80 — journal preview */}
        {validation.ok && parsedAmount > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
            <p className="mb-1 font-semibold not-italic">Preview Jurnal:</p>
            <p>Dr 3202 Hutang Dividen ............ {formatRupiah(parsedAmount)}</p>
            <p>&nbsp;&nbsp;Cr Bank (resolved) ......... {formatRupiah(parsedAmount)}</p>
          </div>
        ) : null}

        {amount && !validation.ok && parsedAmount > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
            <span>{validation.message}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
