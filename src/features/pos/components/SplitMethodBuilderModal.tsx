"use client";

/**
 * Sesi AE-155 / AE-156 — Split metode payment modal untuk direct sale POS.
 *
 * Owner clarification (sesi AE-155): split METODE (1 orang bayar 1 bill
 * pakai beberapa metode, contoh cash 100k + QRIS 35k untuk bill 135k).
 *
 * Staff redesign feedback (sesi AE-156):
 *   - Pakai dedicated numpad seperti CloseOpenBillModal/PaymentModal
 *     (bukan native input → Android keyboard nutup setengah layar)
 *   - Native input bug: backspace tidak konsisten replace value (Android
 *     numpad event quirk)
 *   - JANGAN auto pre-seed 50:50 — kasir input bebas
 *   - Layout + visual hierarchy lebih jelas: focus field highlighted +
 *     numpad gating
 *
 * Architecture:
 *   - 2-col fullscreen-ish layout (size="3xl") mirror CloseOpenBillModal
 *   - LEFT: summary tiles + split row cards (no inputs — read-only display)
 *   - RIGHT: focused field detail + quick amounts + numpad
 *   - "Focused field": klik amount atau cash receive di row → set focus,
 *     numpad operate pada field tsb. Click row chip lain untuk switch.
 *   - Default: row 1 amount focused saat modal open. No pre-seeded values.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Hand,
  Plus,
  QrCode,
  Trash2,
  Wallet,
} from "lucide-react";
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
  /** String supaya leading zeros + typing position preserved. */
  amountStr: string;
  /** Cash received string. Empty unless paymentMethod=cash. */
  cashReceivedStr: string;
}

type FocusedField =
  | { rowId: string; field: "amount" }
  | { rowId: string; field: "cash" }
  | null;

interface SplitMethodBuilderModalProps {
  open: boolean;
  total: number;
  onCancel: () => void;
  onConfirm: (splits: CreateTransactionSplitInput[]) => void;
  submitting: boolean;
}

const METHOD_OPTIONS: Array<{ value: NonSplitMethod; label: string }> = [
  { value: "cash", label: "💵 Cash" },
  { value: "qris", label: "📱 QRIS" },
  { value: "card_bca", label: "💳 BCA EDC" },
  { value: "card_bni", label: "💳 BNI EDC" },
  { value: "card_mandiri", label: "💳 Mandiri EDC" },
  { value: "card_bri", label: "💳 BRI EDC" },
  { value: "card_other", label: "💳 Bank Lain" },
];

const QUICK_AMOUNTS = [10_000, 20_000, 50_000, 100_000, 200_000];

function newRow(method: NonSplitMethod): SplitRow {
  return {
    id: crypto.randomUUID(),
    paymentMethod: method,
    amountStr: "",
    cashReceivedStr: "",
  };
}

function parseAmount(s: string): number {
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function MethodIconFor({
  method,
  className,
}: {
  method: NonSplitMethod;
  className?: string;
}) {
  if (method === "cash")
    return <Banknote className={className} aria-hidden />;
  if (method === "qris") return <QrCode className={className} aria-hidden />;
  return <CreditCard className={className} aria-hidden />;
}

function methodLabel(m: NonSplitMethod): string {
  if (m === "cash") return "Cash";
  if (m === "qris") return "QRIS";
  if (m === "card_bca") return "BCA EDC";
  if (m === "card_bni") return "BNI EDC";
  if (m === "card_mandiri") return "Mandiri EDC";
  if (m === "card_bri") return "BRI EDC";
  return "Bank Lain";
}

export function SplitMethodBuilderModal({
  open,
  total,
  onCancel,
  onConfirm,
  submitting,
}: SplitMethodBuilderModalProps) {
  /* No pre-seed. Mulai dengan 2 row kosong (minimum split). Kasir input
   * amount manual via numpad. */
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [focused, setFocused] = useState<FocusedField>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const initial = [newRow("cash"), newRow("qris")];
    setRows(initial);
    setFocused({ rowId: initial[0].id, field: "amount" });
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const sumSplits = useMemo(
    () => rows.reduce((acc, r) => acc + parseAmount(r.amountStr), 0),
    [rows],
  );
  const remaining = total - sumSplits;

  const focusedRow = focused
    ? rows.find((r) => r.id === focused.rowId) ?? null
    : null;

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
    const next = newRow("cash");
    setRows((prev) => [...prev, next]);
    setFocused({ rowId: next.id, field: "amount" });
  }

  function removeRow(id: string) {
    if (rows.length <= 2) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (focused?.rowId === id) {
      const fallback = rows.find((r) => r.id !== id);
      setFocused(fallback ? { rowId: fallback.id, field: "amount" } : null);
    }
  }

  function updateRow(id: string, patch: Partial<SplitRow>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  /* Numpad operations on focused field. */
  function appendDigit(d: string) {
    if (!focused) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== focused.rowId) return r;
        const key =
          focused.field === "amount" ? "amountStr" : "cashReceivedStr";
        const cur = r[key];
        if (cur === "0") return { ...r, [key]: d };
        if (cur.length >= 12) return r;
        return { ...r, [key]: cur + d };
      }),
    );
  }

  function backspace() {
    if (!focused) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== focused.rowId) return r;
        const key =
          focused.field === "amount" ? "amountStr" : "cashReceivedStr";
        return { ...r, [key]: r[key].slice(0, -1) };
      }),
    );
  }

  function clearField() {
    if (!focused) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== focused.rowId) return r;
        const key =
          focused.field === "amount" ? "amountStr" : "cashReceivedStr";
        return { ...r, [key]: "" };
      }),
    );
  }

  function setFieldValue(v: number) {
    if (!focused) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== focused.rowId) return r;
        const key =
          focused.field === "amount" ? "amountStr" : "cashReceivedStr";
        return { ...r, [key]: String(v) };
      }),
    );
  }

  /** Quick action: set focused row's amount = remaining (auto-balance). */
  function fillRemainingForFocused() {
    if (!focused) return;
    const otherSum = rows
      .filter((r) => r.id !== focused.rowId)
      .reduce((acc, r) => acc + parseAmount(r.amountStr), 0);
    const target = Math.max(0, total - otherSum);
    setRows((prev) =>
      prev.map((r) =>
        r.id === focused.rowId
          ? {
              ...r,
              [focused.field === "amount" ? "amountStr" : "cashReceivedStr"]:
                String(target),
            }
          : r,
      ),
    );
  }

  function handleSubmit() {
    setError(null);
    if (sumSplits !== total) {
      setError(
        `Total split (${formatRupiah(sumSplits)}) belum sama dengan bill (${formatRupiah(total)}). Sisa ${formatRupiah(Math.abs(remaining))}.`,
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

  /* Focused row computed values for the right column display. */
  const focusedValueStr = focused
    ? focused.field === "amount"
      ? focusedRow?.amountStr ?? ""
      : focusedRow?.cashReceivedStr ?? ""
    : "";
  const focusedValue = parseAmount(focusedValueStr);
  const focusedLabel = focused
    ? focused.field === "amount"
      ? `Jumlah Bayar — ${methodLabel(focusedRow?.paymentMethod ?? "cash")}`
      : `Uang Diterima — ${methodLabel(focusedRow?.paymentMethod ?? "cash")}`
    : "Pilih kolom untuk input";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onCancel();
      }}
      title="Split Metode Payment"
      description={`Bagi pembayaran bill ${formatRupiah(total)} ke beberapa metode (mis. cash + QRIS).`}
      size="3xl"
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
      <div className="grid items-start gap-4 landscape:md:grid-cols-[1fr_1fr] landscape:md:gap-5">
        {/* LEFT — summary + rows (scroll independent dari numpad). */}
        <div className="space-y-3">
          {/* Summary band — sticky di atas modal scroll supaya kasir selalu
              lihat Sisa walau scroll ke row bawah. Sesi AE-156. */}
          <div className="sticky top-0 z-10 -mx-1 grid grid-cols-3 gap-2 bg-white px-1 pb-1 pt-0.5">
            <SummaryTile
              label="Bill"
              value={formatRupiah(total)}
              tone="neutral"
            />
            <SummaryTile
              label="Di-split"
              value={formatRupiah(sumSplits)}
              tone={sumSplits === total ? "success" : "neutral"}
            />
            <SummaryTile
              label={remaining > 0 ? "Sisa" : remaining < 0 ? "Lebih" : "Pas"}
              value={
                remaining === 0
                  ? formatRupiah(0)
                  : formatRupiah(Math.abs(remaining))
              }
              tone={
                remaining === 0
                  ? "success"
                  : remaining > 0
                    ? "warning"
                    : "danger"
              }
            />
          </div>

          {/* Rows */}
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <SplitRowCard
                key={r.id}
                index={idx + 1}
                row={r}
                canRemove={rows.length > 2}
                focused={focused}
                onFocusField={(field) =>
                  setFocused({ rowId: r.id, field })
                }
                onChangeMethod={(method) =>
                  updateRow(r.id, {
                    paymentMethod: method,
                    cashReceivedStr:
                      method === "cash" ? r.cashReceivedStr : "",
                  })
                }
                onRemove={() => removeRow(r.id)}
              />
            ))}
          </div>

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

        {/* RIGHT — focused field display + numpad. Sticky di landscape:md+
            (tablet+ desktop) supaya tetap visible saat user scroll LEFT
            untuk lihat row #2/#3 di bawah. Sesi AE-156 fix. */}
        <div className="space-y-3 landscape:md:sticky landscape:md:top-0 landscape:md:self-start">
          {/* Focused field display */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                {focusedLabel}
              </p>
              {focused ? (
                <button
                  type="button"
                  onClick={fillRemainingForFocused}
                  className="text-xs font-semibold text-mahakan-green-700 hover:underline"
                >
                  Pakai sisa
                </button>
              ) : null}
            </div>
            <div
              className={cn(
                "flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
                submitting && "opacity-60",
                !focused
                  ? "border-neutral-200 bg-neutral-50"
                  : focusedValue === 0
                    ? "border-neutral-300 bg-white"
                    : "border-mahakan-green-700 bg-mahakan-green-50",
              )}
              aria-live="polite"
            >
              {!focused ? (
                <span className="font-mono text-sm text-neutral-400">
                  Klik kolom di sebelah kiri
                </span>
              ) : focusedValue === 0 ? (
                <span className="font-mono text-base text-neutral-400 touch:text-sm">
                  Tap angka atau quick amount
                </span>
              ) : (
                <span className="font-mono text-2xl font-bold tabular-nums text-neutral-900 touch:text-xl">
                  {formatRupiah(focusedValue)}
                </span>
              )}
            </div>
          </div>

          {/* Quick amounts */}
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                disabled={!focused || submitting}
                onClick={() => setFieldValue(amt)}
                className={cn(
                  "rounded-lg border border-neutral-300 bg-white py-1.5 text-xs font-medium transition-colors",
                  "hover:bg-neutral-100 active:scale-95",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {(amt / 1000).toLocaleString("id-ID")}k
              </button>
            ))}
            <button
              type="button"
              disabled={!focused || submitting}
              onClick={fillRemainingForFocused}
              className={cn(
                "rounded-lg border-2 border-mahakan-green-700 bg-mahakan-green-50 py-1.5 text-xs font-bold text-mahakan-green-900 transition-colors",
                "hover:bg-mahakan-green-100 active:scale-95",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              Sisa
            </button>
          </div>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <NumpadKey
                key={d}
                label={d}
                onPress={() => appendDigit(d)}
                disabled={!focused || submitting}
              />
            ))}
            <NumpadKey
              label="C"
              onPress={clearField}
              disabled={!focused || submitting}
              variant="muted"
            />
            <NumpadKey
              label="0"
              onPress={() => appendDigit("0")}
              disabled={!focused || submitting}
            />
            <NumpadKey
              label="⌫"
              onPress={backspace}
              disabled={!focused || submitting}
              variant="muted"
            />
          </div>

          {/* Helper hint */}
          {focused && focusedRow?.paymentMethod === "cash" && focused.field === "amount" ? (
            <div className="flex items-start gap-2 rounded-md bg-info-50 px-3 py-2 text-[11px] text-info-700">
              <Hand className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Setelah isi <strong>Jumlah Bayar</strong>, klik kolom{" "}
                <strong>Uang Diterima</strong> di kiri untuk input uang
                customer kasih. Kembalian auto-hitung.
              </span>
            </div>
          ) : focused && focusedRow?.paymentMethod !== "cash" ? (
            <div className="flex items-start gap-2 rounded-md bg-info-50 px-3 py-2 text-[11px] text-info-700">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {focusedRow?.paymentMethod === "qris"
                  ? "Pastikan QRIS sudah ter-scan customer sebelum konfirmasi."
                  : "Pastikan EDC sukses (struk approved) sebelum konfirmasi."}
              </span>
            </div>
          ) : null}
        </div>
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
        "rounded-lg border px-3 py-2",
        tone === "success" && "border-mahakan-green-300 bg-mahakan-green-50",
        tone === "warning" && "border-warning-300 bg-warning-50",
        tone === "danger" && "border-danger-300 bg-danger-50",
        tone === "neutral" && "border-neutral-200 bg-neutral-50",
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-sm font-bold tabular-nums sm:text-base",
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
  focused,
  onFocusField,
  onChangeMethod,
  onRemove,
}: {
  index: number;
  row: SplitRow;
  canRemove: boolean;
  focused: FocusedField;
  onFocusField: (field: "amount" | "cash") => void;
  onChangeMethod: (method: NonSplitMethod) => void;
  onRemove: () => void;
}) {
  const isCash = row.paymentMethod === "cash";
  const amount = parseAmount(row.amountStr);
  const received = parseAmount(row.cashReceivedStr);
  const change = Math.max(0, received - amount);
  const cashSufficient = !isCash || (received >= amount && amount > 0);

  const isAmountFocused =
    focused?.rowId === row.id && focused.field === "amount";
  const isCashFocused =
    focused?.rowId === row.id && focused.field === "cash";

  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3 shadow-sm transition-colors",
        focused?.rowId === row.id
          ? "border-mahakan-green-700/60 bg-mahakan-green-50/30"
          : "border-neutral-200",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-mahakan-green-700 text-xs font-bold text-white">
            {index}
          </span>
          <MethodIconFor
            method={row.paymentMethod}
            className="size-4 text-neutral-500"
          />
          <span className="text-sm font-semibold text-neutral-900">
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

      <div className="mt-3 space-y-2">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-neutral-700">
            Metode Pembayaran
          </label>
          <Select
            ariaLabel={`Metode ${index}`}
            options={METHOD_OPTIONS.map((m) => ({
              value: m.value,
              label: m.label,
            }))}
            value={row.paymentMethod}
            onValueChange={(v) => onChangeMethod(v as NonSplitMethod)}
            size="sm"
          />
        </div>

        {/* Read-only display field — klik untuk focus, numpad di kanan. */}
        <FieldChip
          label="Jumlah Bayar"
          value={amount}
          placeholder="Tap untuk input"
          active={isAmountFocused}
          onClick={() => onFocusField("amount")}
        />

        {isCash ? (
          <div className="grid grid-cols-2 gap-2">
            <FieldChip
              label="Uang Diterima"
              value={received}
              placeholder="Tap untuk input"
              active={isCashFocused}
              onClick={() => onFocusField("cash")}
              tone={
                amount > 0 && received > 0
                  ? cashSufficient
                    ? "success"
                    : "warning"
                  : "neutral"
              }
            />
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-neutral-700">
                Kembalian
              </p>
              <div
                className={cn(
                  "flex h-9 items-center justify-end rounded-md border px-3 font-mono text-sm tabular-nums",
                  amount > 0 && received > 0 && received < amount
                    ? "border-danger-300 bg-danger-50 text-danger-700"
                    : change > 0
                      ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
                      : "border-neutral-200 bg-neutral-50 text-neutral-500",
                )}
              >
                {amount > 0 && received > 0 && received < amount ? (
                  <Badge variant="danger">Kurang</Badge>
                ) : (
                  formatRupiah(change)
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldChip({
  label,
  value,
  placeholder,
  active,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  placeholder: string;
  active: boolean;
  tone?: "neutral" | "success" | "warning";
  onClick: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-neutral-700">{label}</p>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-9 w-full items-center justify-end rounded-md border-2 px-3 text-right font-mono text-sm tabular-nums transition-all",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40",
          active
            ? "border-mahakan-green-700 bg-white shadow-sm ring-2 ring-mahakan-green-700/20"
            : value === 0
              ? "border-neutral-300 bg-white text-neutral-400 hover:border-neutral-400"
              : tone === "success"
                ? "border-mahakan-green-300 bg-mahakan-green-50 text-mahakan-green-900"
                : tone === "warning"
                  ? "border-warning-300 bg-warning-50 text-warning-700"
                  : "border-neutral-300 bg-white text-neutral-900",
        )}
      >
        {value === 0 ? placeholder : formatRupiah(value)}
      </button>
    </div>
  );
}

function NumpadKey({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "muted";
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={cn(
        "rounded-lg border-2 py-3 text-lg font-bold transition-colors touch:py-2.5 touch:text-base",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-300 bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
          : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
      )}
    >
      {label}
    </button>
  );
}

// silence Wallet unused — keeping import for future expansion
void Wallet;
