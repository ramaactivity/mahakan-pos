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
  postRepayment,
  type Creditor,
} from "@/features/creditors";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-80 — Modal cicilan kreditur.
 *
 * Auto-calc bunga sesuai outstanding × rate kalau period='monthly'
 * (sebagai suggestion; owner bisa edit manual).
 *
 * Journal: Dr 2150 (pokok) + Dr 6701 (bunga, skip kalau 0) / Cr Bank.
 */

interface CreditorRepaymentModalProps {
  open: boolean;
  creditor: Creditor;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => todayJakarta();

export function CreditorRepaymentModal({
  open,
  creditor,
  onClose,
  onSaved,
}: CreditorRepaymentModalProps) {
  const [principalAmount, setPrincipalAmount] = useState("");
  const [interestAmount, setInterestAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [description, setDescription] = useState("");
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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

  const validation = useMemo(() => {
    if (total <= 0) return { ok: false, message: "Total cicilan harus > 0" };
    if (parsedPrincipal > creditor.principalOutstanding)
      return {
        ok: false,
        message: `Pokok cicilan melebihi sisa hutang Rp ${creditor.principalOutstanding.toLocaleString("id-ID")}`,
      };
    if (!bankAccountId) return { ok: false, message: "Pilih bank sumber" };
    return { ok: true, message: "" };
  }, [total, parsedPrincipal, creditor.principalOutstanding, bankAccountId]);

  async function handleSubmit() {
    if (submitting || !validation.ok) return;
    const selectedBank = bankList.find((b) => b.id === bankAccountId);
    if (
      !window.confirm(
        `Bayar cicilan ${creditor.fullName}?\nPokok: ${formatRupiah(parsedPrincipal)}\nBunga: ${formatRupiah(parsedInterest)}\nTotal: ${formatRupiah(total)}\nVia: ${selectedBank ? formatBankAccountDisplay(selectedBank) : "-"}`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postRepayment({
      creditorId: creditor.id,
      bankAccountId,
      principalAmount: parsedPrincipal,
      interestAmount: parsedInterest,
      occurredAt,
      description: description.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Cicilan ${creditor.fullName} dicatat`);
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
            disabled={!validation.ok || loadingBanks}
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

        <div className="grid gap-3 md:grid-cols-2">
          <DatePicker
            label="Tanggal Bayar"
            value={occurredAt}
            onChange={(v) => setOccurredAt(v ?? today())}
            clearable={false}
          />
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
        </div>

        <Input
          label="Catatan (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />

        {validation.ok && total > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
            <p className="mb-1 font-semibold not-italic">Preview Jurnal:</p>
            {parsedPrincipal > 0 ? (
              <p>Dr 2150 Hutang Kreditur ........ {formatRupiah(parsedPrincipal)}</p>
            ) : null}
            {parsedInterest > 0 ? (
              <p>Dr 6701 Beban Bunga Kreditur ... {formatRupiah(parsedInterest)}</p>
            ) : null}
            <p>&nbsp;&nbsp;Cr Bank (resolved) ............ {formatRupiah(total)}</p>
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
