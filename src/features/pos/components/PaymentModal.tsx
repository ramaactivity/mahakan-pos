"use client";

import { useEffect } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
  Wallet,
} from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import type { Draft } from "@/features/pos/types";
import type { PaymentMethod } from "@/features/transactions";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

const QUICK_AMOUNTS = [20_000, 50_000, 100_000, 200_000];

interface PaymentModalProps {
  open: boolean;
  draft: Draft;
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  setCashInput: React.Dispatch<React.SetStateAction<string>>;
  cashReceived: number;
  cashChange: number;
  cashSufficient: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

/**
 * Phase 3.1+3.2 (sesi AB) — full-viewport payment modal mengganti PayingPanel
 * yang muter di kolom kanan POS. 2-kolom layout:
 *
 *   LEFT  (~40%) → customer info + cart items full-detail (modifiers visible
 *                  biar kasir tidak miss modifier sebelum konfirmasi) +
 *                  breakdown subtotal/discount/total
 *   RIGHT (~60%) → payment method + numpad (untuk cash) atau instruction
 *                  (untuk QRIS/Card) + Konfirmasi button
 *
 * Polish:
 *   - Big touch targets (h-16 numpad, h-20 confirm)
 *   - Active-press scale feedback
 *   - Color-coded kembalian (green sufficient / red kurang)
 *   - Smart QRIS/Card mode hides numpad, shows instruction
 *   - Keyboard shortcuts (digit/Backspace/Enter/Escape)
 *   - Modal blocks backdrop close (form-data safety per Phase 1.2)
 */
export function PaymentModal({
  open,
  draft,
  subtotal,
  discountAmount,
  total,
  paymentMethod,
  setPaymentMethod,
  setCashInput,
  cashReceived,
  cashChange,
  cashSufficient,
  submitting,
  error,
  onCancel,
  onSubmit,
}: PaymentModalProps) {
  const isCash = paymentMethod === "cash";
  const cardLabel = methodLabel(paymentMethod);

  // Keyboard shortcuts — only when modal open + cash method active.
  // Hook MUST run unconditionally per Rules of Hooks; the early-return
  // sentinel (`if (!open) return null`) below is placed AFTER all hooks.
  useEffect(() => {
    if (!open || !isCash) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        if (!submitting && cashSufficient) {
          e.preventDefault();
          onSubmit();
        }
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        setCashInput((s) => s.slice(0, -1));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setCashInput((s) => s + e.key);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isCash, submitting, cashSufficient, onSubmit, setCashInput]);

  // CRITICAL: only render Modal + children when actually open. JSX expressions
  // accessing `draft.items.map(...)` etc. are evaluated eagerly when the
  // <Modal> element is constructed, even though Modal's own `if (!open)
  // return null` would skip mounting. So if PaymentModal is invoked with
  // open=false + an empty draft fallback, JSX evaluation throws before Modal
  // ever gets a chance to short-circuit. Fix: early-return null here so the
  // children expression never runs when closed.
  if (!open) return null;

  const headerSubtitle = [
    draft.customerName?.trim() || null,
    draft.pagerNumber !== null ? `Pager ${draft.pagerNumber}` : null,
    draft.orderType === "dine_in" ? "Dine-in" : "Takeaway",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Bayar Transaksi"
      description={headerSubtitle || undefined}
      size="fullscreen"
      bodyPadding="none"
      disableEscClose={submitting}
      footer={
        <Button
          size="xl"
          onClick={onSubmit}
          loading={submitting}
          disabled={!cashSufficient || submitting}
          fullWidth
          className="!h-14 !text-base touch:!h-12"
        >
          {submitting
            ? "Memvalidasi stok & mencatat transaksi…"
            : isCash
              ? cashSufficient
                ? `Konfirmasi Bayar ${formatRupiah(total)}`
                : `Kurang ${formatRupiah(total - cashReceived)}`
              : `Sudah Lunas ${cardLabel}`}
        </Button>
      }
    >
      <div className="grid h-full divide-y divide-neutral-200 lg:grid-cols-[2fr_3fr] lg:divide-x lg:divide-y-0 touch:grid-cols-[5fr_7fr] touch:divide-x touch:divide-y-0">
        {/* ============================================================ */}
        {/* LEFT — Cart summary, full detail biar kasir verify sebelum   */}
        {/* konfirmasi (owner standard: full detail, no miss).           */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-3 overflow-y-auto p-4 touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none touch:min-h-0">
          <CustomerCard draft={draft} />

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Items ({draft.items.reduce((s, i) => s + i.quantity, 0)})
            </h3>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
              {draft.items.map((item) => (
                <PaymentItemRow
                  key={item.cartItemId}
                  name={item.name}
                  variant={item.variant}
                  quantity={item.quantity}
                  unitPrice={item.unitPrice}
                  modifiersPriceDelta={item.modifiersPriceDelta}
                  subtotal={item.subtotal}
                  modifiers={item.modifiers
                    .filter(
                      (m) =>
                        m.selectedValue !== null && m.selectedValue !== "normal",
                    )
                    .map((m) => m.selectedLabel ?? m.modifierSlug)}
                  note={item.note}
                  openPriceNote={item.openPriceNote}
                />
              ))}
            </ul>
          </section>

          {draft.billNote ? (
            <div className="rounded-md bg-neutral-100 p-3 text-xs text-neutral-700">
              <strong>Catatan bill:</strong> {draft.billNote}
            </div>
          ) : null}

          <section className="space-y-1.5 rounded-lg border border-neutral-200 bg-white p-4">
            <BreakdownRow label="Subtotal" value={formatRupiah(subtotal)} muted />
            {discountAmount > 0 ? (
              <BreakdownRow
                label={
                  draft.loyaltyPointsRedeemed && draft.loyaltyPointsRedeemed > 0
                    ? `Tukar Poin (-${draft.loyaltyPointsRedeemed})`
                    : draft.discount
                      ? `Diskon${
                          draft.discount.type === "percent"
                            ? ` (${draft.discount.value}%)`
                            : ""
                        }${
                          draft.discountReason ? ` — ${draft.discountReason}` : ""
                        }`
                      : "Diskon"
                }
                value={`- ${formatRupiah(discountAmount)}`}
                negative
              />
            ) : null}
            <div className="my-2 border-t border-dashed border-neutral-200" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-neutral-900">
                TOTAL
              </span>
              <span className="font-mono text-2xl font-bold text-mahakan-green-900">
                {formatRupiah(total)}
              </span>
            </div>
          </section>
        </div>

        {/* ============================================================ */}
        {/* RIGHT — Payment method + amount / instruction               */}
        {/* ============================================================ */}
        <div className="flex flex-col gap-2.5 overflow-y-auto p-4 touch:gap-2 touch:overflow-hidden touch:p-3 lg:max-h-[calc(92vh-9rem)] touch:max-h-none touch:min-h-0">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Metode Pembayaran
            </h3>
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 touch:grid-cols-7 touch:gap-1.5"
              role="radiogroup"
              aria-label="Metode pembayaran"
            >
              <MethodTile
                active={paymentMethod === "cash"}
                onClick={() => setPaymentMethod("cash")}
                label="Tunai"
                Icon={Banknote}
              />
              <MethodTile
                active={paymentMethod === "qris"}
                onClick={() => setPaymentMethod("qris")}
                label="QRIS"
                Icon={QrCode}
              />
              <MethodTile
                active={paymentMethod === "card_bca"}
                onClick={() => setPaymentMethod("card_bca")}
                label="BCA"
                Icon={CreditCard}
              />
              <MethodTile
                active={paymentMethod === "card_bni"}
                onClick={() => setPaymentMethod("card_bni")}
                label="BNI"
                Icon={CreditCard}
              />
              <MethodTile
                active={paymentMethod === "card_mandiri"}
                onClick={() => setPaymentMethod("card_mandiri")}
                label="Mandiri"
                Icon={CreditCard}
              />
              <MethodTile
                active={paymentMethod === "card_bri"}
                onClick={() => setPaymentMethod("card_bri")}
                label="BRI"
                Icon={CreditCard}
              />
              <MethodTile
                active={paymentMethod === "card_other"}
                onClick={() => setPaymentMethod("card_other")}
                label="Lainnya"
                Icon={Wallet}
              />
            </div>
          </section>

          {isCash ? (
            <CashInputPanel
              setCashInput={setCashInput}
              cashReceived={cashReceived}
              cashChange={cashChange}
              cashSufficient={cashSufficient}
              total={total}
              submitting={submitting}
            />
          ) : (
            <NonCashInstruction
              method={paymentMethod}
              total={total}
              submitting={submitting}
            />
          )}

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
            >
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// LEFT COLUMN — sub-components
// ============================================================

function CustomerCard({ draft }: { draft: Draft }) {
  const hasName = (draft.customerName ?? "").trim().length > 0;
  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Customer
          </p>
          <p className="mt-1 text-sm font-medium text-neutral-900">
            {hasName ? draft.customerName : <span className="text-neutral-400 italic">Tanpa nama</span>}
          </p>
          {draft.customerPhone ? (
            <p className="font-mono text-xs text-neutral-600">
              {draft.customerPhone}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {draft.pagerNumber !== null ? (
            <Badge variant="signature">
              Pager <span className="font-mono">{draft.pagerNumber}</span>
            </Badge>
          ) : null}
          <Badge variant="neutral">
            {draft.orderType === "dine_in" ? "Dine-in" : "Takeaway"}
          </Badge>
        </div>
      </div>
    </section>
  );
}

function PaymentItemRow({
  name,
  variant,
  quantity,
  unitPrice,
  modifiersPriceDelta,
  subtotal,
  modifiers,
  note,
  openPriceNote,
}: {
  name: string;
  variant: "hot" | "iced" | null;
  quantity: number;
  unitPrice: number;
  modifiersPriceDelta: number;
  subtotal: number;
  modifiers: string[];
  note: string | null;
  openPriceNote: string | null;
}) {
  const variantLabel =
    variant === "hot" ? "Hot" : variant === "iced" ? "Iced" : null;
  const unitPlusMods = unitPrice + modifiersPriceDelta;
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-900">
            <span className="mr-2 inline-flex size-6 items-center justify-center rounded-md bg-mahakan-green-100 text-xs font-bold text-mahakan-green-900">
              {quantity}
            </span>
            {name}
            {variantLabel ? (
              <span className="ml-1.5 text-xs text-neutral-500">
                · {variantLabel}
              </span>
            ) : null}
          </p>
          {modifiers.length > 0 ? (
            <p className="mt-0.5 pl-8 text-xs text-neutral-600">
              {modifiers.join(", ")}
            </p>
          ) : null}
          {openPriceNote ? (
            <p className="mt-0.5 pl-8 text-xs italic text-neutral-700">
              {openPriceNote}
            </p>
          ) : null}
          {note ? (
            <p className="mt-0.5 pl-8 text-xs italic text-neutral-600">
              &ldquo;{note}&rdquo;
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold text-neutral-900">
            {formatRupiah(subtotal)}
          </p>
          {quantity > 1 ? (
            <p className="font-mono text-[10px] text-neutral-500">
              @ {formatRupiah(unitPlusMods)}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function BreakdownRow({
  label,
  value,
  muted,
  negative,
}: {
  label: string;
  value: string;
  muted?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between text-sm",
        muted ? "text-neutral-500" : "text-neutral-900",
        negative ? "text-danger-500" : "",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

// ============================================================
// RIGHT COLUMN — sub-components
// ============================================================

function CashInputPanel({
  setCashInput,
  cashReceived,
  cashChange,
  cashSufficient,
  total,
  submitting,
}: {
  setCashInput: React.Dispatch<React.SetStateAction<string>>;
  cashReceived: number;
  cashChange: number;
  cashSufficient: boolean;
  total: number;
  submitting: boolean;
}) {
  return (
    <>
      {/* Big amount display */}
      <div
        className={cn(
          "flex h-14 items-center justify-end rounded-xl border-2 px-4 transition-colors touch:h-12",
          submitting && "opacity-60",
          cashReceived === 0
            ? "border-neutral-300 bg-white"
            : cashSufficient
              ? "border-success-500 bg-success-100"
              : "border-warning-500 bg-warning-100",
        )}
      >
        {cashReceived > 0 ? (
          <span className="font-mono text-3xl font-bold tabular-nums text-neutral-900 touch:text-2xl">
            {formatRupiah(cashReceived)}
          </span>
        ) : (
          <span className="font-mono text-base text-neutral-400 touch:text-sm">
            Tap angka atau quick amount
          </span>
        )}
      </div>

      {/* Quick amounts */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {QUICK_AMOUNTS.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => setCashInput(String(amt))}
            disabled={submitting}
            className={cn(
              "rounded-lg border border-neutral-300 bg-white py-1.5 text-sm font-medium transition-all",
              "hover:bg-neutral-100 active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {formatRupiah(amt).replace("Rp ", "")}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCashInput(String(total))}
          disabled={submitting}
          className={cn(
            "rounded-lg border-2 border-mahakan-green-700 bg-mahakan-green-50 py-1.5 text-sm font-bold text-mahakan-green-900 transition-all",
            "hover:bg-mahakan-green-100 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          Pas
        </button>
      </div>

      {/* Numpad — h-12 keys (48px), tablet-friendly tetap fit di viewport */}
      <div className="grid grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <NumpadKey
            key={d}
            label={d}
            onPress={() => setCashInput((s) => s + d)}
            disabled={submitting}
          />
        ))}
        <NumpadKey
          label="C"
          onPress={() => setCashInput("")}
          disabled={submitting}
          variant="muted"
        />
        <NumpadKey
          label="0"
          onPress={() => setCashInput((s) => s + "0")}
          disabled={submitting}
        />
        <NumpadKey
          label="⌫"
          onPress={() => setCashInput((s) => s.slice(0, -1))}
          disabled={submitting}
          variant="muted"
        />
      </div>

      {/* Kembalian / Kurang — color coded */}
      <div
        className={cn(
          "flex items-center justify-between rounded-lg border-2 px-4 py-2",
          cashReceived === 0
            ? "border-neutral-200 bg-neutral-50"
            : cashSufficient
              ? "border-success-500 bg-success-100 text-success-500"
              : "border-warning-500 bg-warning-100 text-warning-500",
        )}
      >
        <span className="text-sm font-semibold">
          {cashReceived === 0
            ? "Kembalian"
            : cashSufficient
              ? "Kembalian"
              : "Kurang"}
        </span>
        <span className="font-mono text-lg font-bold tabular-nums">
          {cashReceived === 0
            ? "—"
            : cashSufficient
              ? formatRupiah(cashChange)
              : formatRupiah(total - cashReceived)}
        </span>
      </div>
    </>
  );
}

function NonCashInstruction({
  method,
  total,
  submitting,
}: {
  method: PaymentMethod;
  total: number;
  submitting: boolean;
}) {
  const isQris = method === "qris";
  const Icon = isQris ? QrCode : CreditCard;
  const title = isQris ? "Tunggu konfirmasi QRIS" : `Tunggu approval ${methodLabel(method)}`;
  const hint = isQris
    ? "Customer scan QRIS dari struk / sticker. Cek aplikasi bank merchant kalau perlu."
    : "Tap kartu di mesin EDC. Pastikan struk approved + sesuai amount sebelum konfirmasi.";

  return (
    <div className="space-y-3 rounded-xl border border-info-300 bg-info-100 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {submitting ? (
          <Loader2 className="size-10 animate-spin text-info-500" />
        ) : (
          <Icon className="size-10 text-info-500" aria-hidden />
        )}
        <p className="text-sm font-semibold text-info-500">{title}</p>
        <p className="font-mono text-2xl font-bold text-mahakan-green-900">
          {formatRupiah(total)}
        </p>
        <p className="max-w-md text-xs text-neutral-700">{hint}</p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs text-neutral-600">
        <CheckCircle2 className="size-3.5 shrink-0 text-success-500" aria-hidden />
        Tap <strong>Sudah Lunas</strong> di footer setelah customer berhasil bayar.
      </div>
    </div>
  );
}

// ============================================================
// Atoms
// ============================================================

function MethodTile({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 py-2 text-xs font-medium transition-all touch:py-1.5 touch:text-[11px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95",
        active
          ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900 shadow-sm"
          : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
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
        "flex h-12 items-center justify-center rounded-lg border font-mono text-xl font-semibold transition-all touch:h-11 touch:text-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95 active:shadow-inner",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
          : "border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}

// ============================================================
// Helpers
// ============================================================

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "card_bca":
      return "Kartu BCA";
    case "card_bni":
      return "Kartu BNI";
    case "card_mandiri":
      return "Kartu Mandiri";
    case "card_bri":
      return "Kartu BRI";
    case "card_other":
      return "Kartu Lainnya";
    case "split":
      return "Split";
  }
}
