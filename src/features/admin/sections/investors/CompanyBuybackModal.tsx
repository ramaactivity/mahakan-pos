"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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

/**
 * Sesi AE-80 — Company buyback modal.
 *
 * Outlet beli kembali share investor. Journal Dr 3401 Treasury Stock /
 * Cr Bank. Sisa share (100 - sum) jadi "company hold" — compute v2
 * alokasi sisa% ke pengelola_pool.
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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setFromId(null);
    setSharePctDelta("");
    setAmountIdr("");
    setBankAccountId("");
    setDescription("");
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
            disabled={!validation.ok}
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
