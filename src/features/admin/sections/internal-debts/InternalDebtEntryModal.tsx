"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, HandCoins, Landmark, Loader2 } from "lucide-react";
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
  isOk as isCashOk,
  listExpenseCategories,
  type ExpenseCategory,
} from "@/features/cash";
import {
  isOk,
  postInternalDebtEntry,
  type InternalDebtEntryKind,
  type InternalDebtPartyListRow,
} from "@/features/internal-debts";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayJakarta } from "@/lib/tz";

/**
 * Sesi AE-180 — Modal catat hutang internal baru.
 *
 * 2 jenis:
 *  - Talangan biaya: owner bayar pengeluaran pakai uang pribadi.
 *    Jurnal Dr <akun beban kategori> / Cr 2170. Auto-create row Pengeluaran.
 *  - Pinjaman tunai: uang pribadi masuk rekening bisnis.
 *    Jurnal Dr <bank> / Cr 2170.
 */

interface InternalDebtEntryModalProps {
  open: boolean;
  parties: InternalDebtPartyListRow[];
  /** Pre-select pihak (dari tombol per-row). Null = pilih manual. */
  initialPartyId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const today = () => todayJakarta();

export function InternalDebtEntryModal({
  open,
  parties,
  initialPartyId,
  onClose,
  onSaved,
}: InternalDebtEntryModalProps) {
  const [partyId, setPartyId] = useState("");
  const [kind, setKind] = useState<InternalDebtEntryKind>("expense_advance");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(today());
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [bankList, setBankList] = useState<BankAccount[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPartyId(initialPartyId ?? "");
    setKind("expense_advance");
    setAmount("");
    setOccurredAt(today());
    setDescription("");
    setCategoryId("");
    setBankAccountId("");
    setSubmitting(false);
    setLoadingRefs(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void Promise.all([listExpenseCategories(), listBankAccounts()]).then(
      ([catRes, bankRes]) => {
        if (cancelled) return;
        if (isCashOk(catRes)) setCategories(catRes.data.items);
        if (bankRes.ok) setBankList(bankRes.data);
        setLoadingRefs(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, initialPartyId]);

  const parsedAmount = useMemo(() => {
    try {
      return parseRupiah(amount);
    } catch {
      return 0;
    }
  }, [amount]);

  const selectedParty = parties.find((p) => p.id === partyId);
  const selectedCategory = categories.find((c) => c.id === categoryId);

  const validation = useMemo(() => {
    if (!partyId) return { ok: false, message: "Pilih pihak yang nalangin" };
    if (parsedAmount <= 0) return { ok: false, message: "Nominal harus > 0" };
    if (description.trim().length < 3)
      return { ok: false, message: "Deskripsi minimal 3 karakter" };
    if (kind === "expense_advance" && !categoryId)
      return { ok: false, message: "Pilih kategori pengeluaran" };
    if (kind === "cash_loan" && !bankAccountId)
      return { ok: false, message: "Pilih rekening bisnis penerima" };
    return { ok: true, message: "" };
  }, [partyId, parsedAmount, description, kind, categoryId, bankAccountId]);

  async function handleSubmit() {
    if (submitting || !validation.ok) return;
    if (
      !window.confirm(
        kind === "expense_advance"
          ? `Catat talangan ${selectedParty?.name}?\nBiaya: ${description.trim()}\nNominal: ${formatRupiah(parsedAmount)}\n\nHutang ke ${selectedParty?.name} bertambah ${formatRupiah(parsedAmount)}.`
          : `Catat pinjaman tunai dari ${selectedParty?.name}?\nNominal: ${formatRupiah(parsedAmount)}\n\nHutang ke ${selectedParty?.name} bertambah ${formatRupiah(parsedAmount)}.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    const res = await postInternalDebtEntry({
      partyId,
      kind,
      amount: parsedAmount,
      occurredAt,
      description: description.trim(),
      categoryId: kind === "expense_advance" ? categoryId : null,
      bankAccountId: kind === "cash_loan" ? bankAccountId : null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `Hutang ke ${selectedParty?.name} dicatat: ${formatRupiah(parsedAmount)}`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catat Hutang Internal"
      description="Owner/pengelola nalangin biaya atau minjamin uang tunai ke bisnis."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!validation.ok || loadingRefs}
          >
            Catat {parsedAmount > 0 ? formatRupiah(parsedAmount) : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Jenis hutang */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-neutral-700">
            Jenis
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setKind("expense_advance")}
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-left transition-colors",
                kind === "expense_advance"
                  ? "border-mahakan-green-700 bg-mahakan-green-50"
                  : "border-neutral-200 bg-white hover:bg-neutral-50",
              )}
            >
              <HandCoins className="mt-0.5 size-4 shrink-0 text-mahakan-green-700" />
              <span>
                <span className="block text-sm font-semibold text-neutral-900">
                  Talangan Biaya
                </span>
                <span className="block text-[11px] text-neutral-600">
                  Bayar pengeluaran pakai uang pribadi — kas bisnis tidak
                  berkurang, tercatat di Pengeluaran
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("cash_loan")}
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-left transition-colors",
                kind === "cash_loan"
                  ? "border-mahakan-green-700 bg-mahakan-green-50"
                  : "border-neutral-200 bg-white hover:bg-neutral-50",
              )}
            >
              <Landmark className="mt-0.5 size-4 shrink-0 text-mahakan-green-700" />
              <span>
                <span className="block text-sm font-semibold text-neutral-900">
                  Pinjaman Tunai
                </span>
                <span className="block text-[11px] text-neutral-600">
                  Uang pribadi masuk ke rekening bisnis (top-up kas)
                </span>
              </span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Pihak yang Nalangin"
            placeholder="— Pilih pihak —"
            options={parties.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            value={partyId || undefined}
            onValueChange={setPartyId}
          />
          <Input
            label="Nominal"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="150000"
            hint={
              parsedAmount > 0
                ? `Preview: ${formatRupiah(parsedAmount)}`
                : undefined
            }
          />
        </div>

        <Input
          label={
            kind === "expense_advance"
              ? "Deskripsi Biaya"
              : "Deskripsi / Keperluan"
          }
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            kind === "expense_advance"
              ? "mis. Beli gas LPG mendadak"
              : "mis. Top-up kas untuk gajian"
          }
          maxLength={200}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <DatePicker
            label="Tanggal"
            value={occurredAt}
            onChange={(v) => setOccurredAt(v ?? today())}
            clearable={false}
          />
          {loadingRefs ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Memuat…
            </div>
          ) : kind === "expense_advance" ? (
            <Select
              label="Kategori Pengeluaran"
              placeholder="— Pilih kategori —"
              options={categories.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              value={categoryId || undefined}
              onValueChange={setCategoryId}
            />
          ) : (
            <Select
              label="Rekening Bisnis Penerima"
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
          )}
        </div>

        {validation.ok && parsedAmount > 0 ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-[11px] font-mono text-neutral-700">
            <p className="mb-1 font-semibold not-italic">Preview Jurnal:</p>
            {kind === "expense_advance" ? (
              <p>
                Dr Beban ({selectedCategory?.name ?? "kategori"}) ........{" "}
                {formatRupiah(parsedAmount)}
              </p>
            ) : (
              <p>Dr Bank (resolved) ............ {formatRupiah(parsedAmount)}</p>
            )}
            <p>
              &nbsp;&nbsp;Cr 2170 Hutang Internal ....{" "}
              {formatRupiah(parsedAmount)}
            </p>
            {kind === "expense_advance" ? (
              <p className="mt-1 not-italic text-neutral-500">
                + otomatis tercatat di Keuangan → Pengeluaran (tanpa kas
                keluar)
              </p>
            ) : null}
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
