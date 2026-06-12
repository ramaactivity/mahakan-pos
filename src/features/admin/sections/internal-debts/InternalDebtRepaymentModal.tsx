"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  postInternalDebtRepayment,
  type InternalDebtPartyListRow,
} from "@/features/internal-debts";
import { formatRupiah, parseRupiah } from "@/lib/format";

/**
 * Sesi AE-180 — Modal cicilan hutang internal (mirror CreditorRepaymentModal
 * tanpa komponen bunga). Journal: Dr 2170 / Cr Bank.
 */

interface InternalDebtRepaymentModalProps {
  open: boolean;
  party: InternalDebtPartyListRow;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function InternalDebtRepaymentModal({
  open,
  party,
  onClose,
  onSaved,
}: InternalDebtRepaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [description, setDescription] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setAmount("");
    setBankAccountId("");
    setOccurredAt(today());
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
  }, [open, party]);

  const parsedAmount = useMemo(() => {
    try {
      return parseRupiah(amount);
    } catch {
      return 0;
    }
  }, [amount]);

  const newOutstanding = party.totalOutstanding - parsedAmount;

  const validation = useMemo(() => {
    if (parsedAmount <= 0) return { ok: false, message: "Nominal harus > 0" };
    if (parsedAmount > party.totalOutstanding)
      return {
        ok: false,
        message: `Cicilan melebihi sisa hutang Rp ${party.totalOutstanding.toLocaleString("id-ID")}`,
      };
    if (!bankAccountId) return { ok: false, message: "Pilih bank sumber" };
    return { ok: true, message: "" };
  }, [parsedAmount, party.totalOutstanding, bankAccountId]);

  async function handleSubmit() {
    if (submitting || !validation.ok) return;
    const selectedBank = bankList.find((b) => b.id === bankAccountId);
    if (
      !window.confirm(
        `Bayar cicilan ke ${party.name}?\nNominal: ${formatRupiah(parsedAmount)}\nVia: ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}\nSisa setelah bayar: ${formatRupiah(newOutstanding)}`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postInternalDebtRepayment({
      partyId: party.id,
      bankAccountId,
      amount: parsedAmount,
      occurredAt,
      description: description.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Cicilan ke ${party.name} dicatat`);
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bayar Cicilan — ${party.name}`}
      description={`Sisa hutang: ${formatRupiah(party.totalOutstanding)} (total hutang lifetime ${formatRupiah(party.totalDebt)})`}
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
            Bayar {formatRupiah(parsedAmount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-mahakan-green-200 bg-mahakan-green-50/40 p-3 text-xs">
          <div className="flex justify-between">
            <span>Total Hutang Lifetime</span>
            <span className="font-mono font-semibold">
              {formatRupiah(party.totalDebt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sudah Dicicil</span>
            <span className="font-mono font-semibold">
              {formatRupiah(party.totalRepaid)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sisa Hutang</span>
            <span className="font-mono font-semibold text-mahakan-green-900">
              {formatRupiah(party.totalOutstanding)}
            </span>
          </div>
          {parsedAmount > 0 && validation.ok ? (
            <div className="mt-1 flex justify-between border-t border-mahakan-green-200 pt-1 text-mahakan-green-700">
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
            label="Nominal Cicilan"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="500000"
            hint={
              parsedAmount > 0
                ? `Preview: ${formatRupiah(parsedAmount)}`
                : undefined
            }
          />
          <DatePicker
            label="Tanggal Bayar"
            value={occurredAt}
            onChange={(v) => setOccurredAt(v ?? today())}
            clearable={false}
          />
        </div>

        {loadingBanks ? (
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

        <Input
          label="Catatan (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />

        {validation.ok && parsedAmount > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
            <p className="mb-1 font-semibold not-italic">Preview Jurnal:</p>
            <p>Dr 2170 Hutang Internal ........ {formatRupiah(parsedAmount)}</p>
            <p>&nbsp;&nbsp;Cr Bank (resolved) .......... {formatRupiah(parsedAmount)}</p>
          </div>
        ) : null}

        {!validation.ok && parsedAmount > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-2 text-xs text-warning-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{validation.message}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
