"use client";

/**
 * Sesi AE-155 — Split metode payment modal untuk direct sale POS.
 *
 * Owner clarification: split METODE (1 orang bayar 1 bill pakai beberapa
 * metode, contoh cash 100k + QRIS 35k untuk bill 135k). Beda dengan split
 * BILL (1 bill dibagi multi orang via per_menu — SplitPaymentModal sudah
 * handle).
 *
 * Workflow:
 *   1. Kasir klik tombol "Pakai Split" di PaymentModal
 *   2. Modal ini open dengan total bill ter-prefill
 *   3. Kasir tambah row split: pick method + input amount (+ cash received
 *      kalau cash). Minimum 2 splits.
 *   4. Live preview: total tersisa = bill.total - sum(splits)
 *   5. Saat sum = total exact, button "Bayar" enabled
 *   6. Submit → onConfirm(splits[]) → caller propagate ke createTransaction
 *
 * UX:
 *   - Numpad keyboard untuk amount (tablet-friendly)
 *   - Auto-add row pertama dengan amount = total / 2 (anggap split 50:50
 *     sebagai starting point yang umum dipakai)
 *   - Quick fill: "Pakai sisa" button untuk last row supaya sum exact tanpa
 *     hitung manual
 *   - Auto cash change calc per split cash row
 */

import { useEffect, useMemo, useState } from "react";
import { Banknote, CreditCard, Plus, QrCode, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Modal, Select } from "@/components/ui";
import type { CreateTransactionSplitInput } from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type NonSplitMethod =
  | "cash"
  | "qris"
  | "card_bca"
  | "card_bni"
  | "card_mandiri"
  | "card_bri"
  | "card_other";

interface SplitRow {
  id: string;
  paymentMethod: NonSplitMethod;
  /** Amount sebagai string untuk preserve typing position. */
  amountStr: string;
  /** Cash received sebagai string. Hanya relevant kalau cash. */
  cashReceivedStr: string;
}

interface SplitMethodBuilderModalProps {
  open: boolean;
  total: number;
  onCancel: () => void;
  onConfirm: (splits: CreateTransactionSplitInput[]) => void;
  submitting: boolean;
}

const METHOD_OPTIONS: Array<{
  value: NonSplitMethod;
  label: string;
  hint?: string;
}> = [
  { value: "cash", label: "💵 Cash" },
  { value: "qris", label: "📱 QRIS" },
  { value: "card_bca", label: "💳 BCA EDC" },
  { value: "card_bni", label: "💳 BNI EDC" },
  { value: "card_mandiri", label: "💳 Mandiri EDC" },
  { value: "card_bri", label: "💳 BRI EDC" },
  { value: "card_other", label: "💳 Bank Lain" },
];

function newRow(method: NonSplitMethod, amount: number): SplitRow {
  return {
    id: crypto.randomUUID(),
    paymentMethod: method,
    amountStr: amount > 0 ? String(amount) : "",
    cashReceivedStr: "",
  };
}

function parseAmount(s: string): number {
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function SplitMethodBuilderModal({
  open,
  total,
  onCancel,
  onConfirm,
  submitting,
}: SplitMethodBuilderModalProps) {
  /* Pre-seed 2 row default: cash setengah + QRIS setengah. Kasir biasanya
   * tinggal adjust angka. */
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const half = Math.floor(total / 2);
    setRows([newRow("cash", half), newRow("qris", total - half)]);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, total]);

  const sumSplits = useMemo(
    () => rows.reduce((acc, r) => acc + parseAmount(r.amountStr), 0),
    [rows],
  );
  const remaining = total - sumSplits;
  const canSubmit =
    rows.length >= 2 &&
    sumSplits === total &&
    rows.every((r) => {
      const amt = parseAmount(r.amountStr);
      if (amt <= 0) return false;
      if (r.paymentMethod === "cash") {
        const received = parseAmount(r.cashReceivedStr);
        return received >= amt;
      }
      return true;
    });

  function addRow() {
    if (rows.length >= 4) return;
    setRows((prev) => [...prev, newRow("cash", Math.max(remaining, 0))]);
  }

  function removeRow(id: string) {
    if (rows.length <= 2) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<SplitRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  /** Quick action: set last row's amount = remaining (auto-balance). */
  function fillRemaining(rowId: string) {
    const otherSum = rows
      .filter((r) => r.id !== rowId)
      .reduce((acc, r) => acc + parseAmount(r.amountStr), 0);
    const target = Math.max(0, total - otherSum);
    updateRow(rowId, { amountStr: String(target) });
  }

  function handleSubmit() {
    setError(null);
    if (sumSplits !== total) {
      setError(
        `Total split (${formatRupiah(sumSplits)}) tidak sama dengan bill (${formatRupiah(total)}). Sisa: ${formatRupiah(remaining)}`,
      );
      return;
    }
    const splits: CreateTransactionSplitInput[] = rows.map((r) => {
      const amt = parseAmount(r.amountStr);
      if (r.paymentMethod === "cash") {
        const received = parseAmount(r.cashReceivedStr);
        return {
          paymentMethod: r.paymentMethod,
          amount: amt,
          cashReceived: received,
          cashChange: received - amt,
        };
      }
      return {
        paymentMethod: r.paymentMethod,
        amount: amt,
        cashReceived: null,
        cashChange: null,
      };
    });
    onConfirm(splits);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onCancel();
      }}
      title="Split Metode Payment"
      description={`Bagi pembayaran bill ${formatRupiah(total)} ke beberapa metode (mis. cash + QRIS).`}
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            loading={submitting}
          >
            <Banknote className="size-4" aria-hidden /> Bayar{" "}
            {formatRupiah(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Summary card */}
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile
            label="Total Bill"
            value={formatRupiah(total)}
            tone="neutral"
          />
          <SummaryTile
            label="Sudah Di-split"
            value={formatRupiah(sumSplits)}
            tone={sumSplits === total ? "success" : "neutral"}
          />
          <SummaryTile
            label={remaining > 0 ? "Sisa" : remaining < 0 ? "Lebih" : "Selisih"}
            value={formatRupiah(Math.abs(remaining))}
            tone={remaining === 0 ? "success" : remaining > 0 ? "warning" : "danger"}
          />
        </div>

        {/* Rows */}
        <div className="space-y-3">
          {rows.map((r, idx) => (
            <SplitRowCard
              key={r.id}
              index={idx + 1}
              row={r}
              canRemove={rows.length > 2}
              onChange={(patch) => updateRow(r.id, patch)}
              onRemove={() => removeRow(r.id)}
              onFillRemaining={() => fillRemaining(r.id)}
            />
          ))}
        </div>

        {/* Add row button */}
        {rows.length < 4 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={addRow}
            fullWidth
            className="border-dashed"
          >
            <Plus className="size-4" aria-hidden /> Tambah Metode (
            {rows.length}/4)
          </Button>
        ) : (
          <p className="text-center text-xs text-neutral-500">
            Maksimum 4 metode per split.
          </p>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "success" && "border-mahakan-green-300 bg-mahakan-green-50",
        tone === "warning" && "border-warning-300 bg-warning-50",
        tone === "danger" && "border-danger-300 bg-danger-50",
        tone === "neutral" && "border-neutral-200 bg-neutral-50",
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-base font-bold tabular-nums",
          tone === "success" && "text-mahakan-green-900",
          tone === "warning" && "text-warning-700",
          tone === "danger" && "text-danger-700",
          tone === "neutral" && "text-neutral-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SplitRowCard({
  index,
  row,
  canRemove,
  onChange,
  onRemove,
  onFillRemaining,
}: {
  index: number;
  row: SplitRow;
  canRemove: boolean;
  onChange: (patch: Partial<SplitRow>) => void;
  onRemove: () => void;
  onFillRemaining: () => void;
}) {
  const isCash = row.paymentMethod === "cash";
  const amount = parseAmount(row.amountStr);
  const received = parseAmount(row.cashReceivedStr);
  const change = Math.max(0, received - amount);
  const cashSufficient = !isCash || received >= amount;

  const MethodIcon =
    row.paymentMethod === "cash"
      ? Banknote
      : row.paymentMethod === "qris"
        ? QrCode
        : CreditCard;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-mahakan-green-700 text-xs font-bold text-white">
            {index}
          </span>
          <MethodIcon className="size-4 text-neutral-500" aria-hidden />
          <span className="text-sm font-medium text-neutral-900">
            Metode #{index}
          </span>
        </div>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-7 items-center justify-center rounded-md text-danger-500 hover:bg-danger-50"
            aria-label="Hapus metode"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-700">
            Metode Pembayaran
          </label>
          <Select
            ariaLabel={`Metode ${index}`}
            options={METHOD_OPTIONS.map((m) => ({
              value: m.value,
              label: m.label,
            }))}
            value={row.paymentMethod}
            onValueChange={(v) =>
              onChange({
                paymentMethod: v as NonSplitMethod,
                /* Reset cash received saat ganti method (avoid stale). */
                cashReceivedStr: v === "cash" ? row.cashReceivedStr : "",
              })
            }
            size="sm"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label className="block text-xs font-medium text-neutral-700">
              Jumlah Rp
            </label>
            <button
              type="button"
              onClick={onFillRemaining}
              className="text-[11px] font-medium text-mahakan-green-700 hover:underline"
            >
              Pakai sisa
            </button>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={row.amountStr}
            onChange={(e) =>
              onChange({ amountStr: e.target.value.replace(/[^\d]/g, "") })
            }
            placeholder="0"
            className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-right font-mono text-sm tabular-nums focus:border-mahakan-green-700 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700/40"
          />
          {amount > 0 ? (
            <p className="text-right text-[10px] text-neutral-500">
              {formatRupiah(amount)}
            </p>
          ) : null}
        </div>
      </div>

      {/* Cash receive + change (only kalau cash). */}
      {isCash ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">
              Uang Diterima Rp
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={row.cashReceivedStr}
              onChange={(e) =>
                onChange({
                  cashReceivedStr: e.target.value.replace(/[^\d]/g, ""),
                })
              }
              placeholder="0"
              className={cn(
                "h-9 w-full rounded-md border bg-white px-3 text-right font-mono text-sm tabular-nums focus:outline-none focus:ring-2",
                cashSufficient
                  ? "border-neutral-300 focus:border-mahakan-green-700 focus:ring-mahakan-green-700/40"
                  : "border-danger-300 focus:border-danger-500 focus:ring-danger-500/40",
              )}
            />
            {received > 0 ? (
              <p className="text-right text-[10px] text-neutral-500">
                {formatRupiah(received)}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">
              Kembalian
            </label>
            <div
              className={cn(
                "flex h-9 items-center justify-end rounded-md border px-3 font-mono text-sm tabular-nums",
                received < amount
                  ? "border-danger-300 bg-danger-50 text-danger-700"
                  : change > 0
                    ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-200 bg-neutral-50 text-neutral-700",
              )}
            >
              {received < amount ? (
                <Badge variant="danger">Kurang</Badge>
              ) : (
                formatRupiah(change)
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-info-50 px-3 py-1.5 text-[11px] text-info-700">
          <Wallet className="size-3.5" aria-hidden />
          Konfirmasi {row.paymentMethod === "qris" ? "QRIS sudah ter-scan" : "EDC sukses"} dengan customer.
        </div>
      )}
    </div>
  );
}
