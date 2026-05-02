"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, NumericInput } from "@/components/ui";
import type { Discount } from "@/lib/money";
import { computeDiscountAmount } from "@/lib/money";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DiscountModalProps {
  open: boolean;
  subtotal: number;
  initialDiscount: Discount | null;
  initialReason: string | null;
  onClose: () => void;
  onApply: (discount: Discount, reason: string) => void;
  onClear: () => void;
}

const PRESET_REASONS = [
  "Promo Staff",
  "Kompensasi",
  "Lainnya",
] as const;

export function DiscountModal({
  open,
  subtotal,
  initialDiscount,
  initialReason,
  onClose,
  onApply,
  onClear,
}: DiscountModalProps) {
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [reasonPreset, setReasonPreset] = useState<string>("Promo Staff");
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Sync from props when modal opens
    if (initialDiscount) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(initialDiscount.type);
      setValue(String(initialDiscount.value));
      const presetMatch = (PRESET_REASONS as readonly string[]).includes(
        initialReason ?? "",
      );
      setReasonPreset(presetMatch ? (initialReason as string) : "Lainnya");
      setCustomReason(presetMatch ? "" : (initialReason ?? ""));
    } else {
      setType("percent");
      setValue("");
      setReasonPreset("Promo Staff");
      setCustomReason("");
    }
    setError(null);
  }, [open, initialDiscount, initialReason]);

  const numericValue = parseInt(value, 10) || 0;
  const previewAmount =
    type === "percent" && numericValue > 0 && numericValue <= 100
      ? computeDiscountAmount(subtotal, { type: "percent", value: numericValue })
      : type === "fixed" && numericValue > 0
        ? Math.min(numericValue, subtotal)
        : 0;

  function onSubmit() {
    setError(null);
    if (type === "percent" && (numericValue < 1 || numericValue > 100)) {
      setError("Persentase harus 1-100");
      return;
    }
    if (type === "fixed" && (numericValue < 1 || numericValue > subtotal)) {
      setError(`Nominal harus 1 - ${formatRupiah(subtotal)}`);
      return;
    }
    const finalReason =
      reasonPreset === "Lainnya" ? customReason.trim() : reasonPreset;
    if (finalReason.length === 0) {
      setError("Alasan diskon wajib diisi");
      return;
    }
    onApply({ type, value: numericValue }, finalReason);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply Diskon"
      description={`Subtotal: ${formatRupiah(subtotal)}`}
      size="md"
      footer={
        <>
          {initialDiscount ? (
            <Button
              variant="ghost"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Hapus Diskon
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} disabled={previewAmount === 0}>
            Apply · -{formatRupiah(previewAmount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-900">Tipe Diskon</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipe diskon">
            <button
              type="button"
              role="radio"
              aria-checked={type === "percent"}
              onClick={() => setType("percent")}
              className={cn(
                "rounded-md border py-2.5 text-sm font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                type === "percent"
                  ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                  : "border-neutral-300 bg-white hover:bg-neutral-100",
              )}
            >
              Persentase
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={type === "fixed"}
              onClick={() => setType("fixed")}
              className={cn(
                "rounded-md border py-2.5 text-sm font-medium transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                type === "fixed"
                  ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                  : "border-neutral-300 bg-white hover:bg-neutral-100",
              )}
            >
              Nominal Rupiah
            </button>
          </div>
        </div>

        <NumericInput
          label={type === "percent" ? "Persentase (1-100)" : "Nominal (Rupiah)"}
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(null);
          }}
          prefix={type === "percent" ? "%" : "Rp"}
          hint={
            type === "fixed" && numericValue > 0
              ? `Preview: ${formatRupiah(numericValue)}`
              : undefined
          }
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-900">Alasan</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Alasan diskon">
            {PRESET_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reasonPreset === r}
                onClick={() => setReasonPreset(r)}
                className={cn(
                  "rounded-md border py-2 text-sm transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  reasonPreset === r
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white hover:bg-neutral-100",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          {reasonPreset === "Lainnya" ? (
            <Input
              label=""
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Tulis alasan diskon"
              maxLength={120}
            />
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
