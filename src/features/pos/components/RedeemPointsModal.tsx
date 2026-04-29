"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import {
  clampRedemption,
  computeRedemptionAmount,
  RUPIAH_PER_POINT_REDEEMED,
} from "@/features/customers";
import { formatRupiah } from "@/lib/format";

interface RedeemPointsModalProps {
  open: boolean;
  /** Member info — name shown in title for confirmation. */
  memberName: string | null;
  /** Member's current point balance. */
  balance: number;
  /** Cart subtotal — caps redemption so total can't go negative. */
  eligibleSubtotal: number;
  onClose: () => void;
  onSubmit: (points: number) => void;
}

export function RedeemPointsModal({
  open,
  memberName,
  balance,
  eligibleSubtotal,
  onClose,
  onSubmit,
}: RedeemPointsModalProps) {
  const maxPoints = useMemo(
    () => clampRedemption(balance, balance, eligibleSubtotal),
    [balance, eligibleSubtotal],
  );

  const [pointsInput, setPointsInput] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPointsInput(String(maxPoints));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, maxPoints]);

  const requested = useMemo(() => {
    const n = parseInt(pointsInput, 10);
    return Number.isFinite(n) ? n : 0;
  }, [pointsInput]);

  const clamped = useMemo(
    () => clampRedemption(requested, balance, eligibleSubtotal),
    [requested, balance, eligibleSubtotal],
  );

  const rupiah = computeRedemptionAmount(clamped);
  const overRequested = requested > clamped;
  const canSubmit = clamped > 0;

  function setPreset(n: number) {
    setPointsInput(String(Math.min(n, maxPoints)));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tukar Poin"
      description={
        memberName ? `Member: ${memberName}` : "Aplikasikan tukar poin ke order"
      }
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={() => onSubmit(clamped)} disabled={!canSubmit}>
            <Sparkles className="size-4" /> Tukar {clamped} poin
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-700">Saldo poin</span>
            <span className="font-mono font-semibold text-amber-700">
              {balance.toLocaleString("id-ID")}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-neutral-700">Maksimal redeem</span>
            <span className="font-mono text-neutral-900">{maxPoints} poin</span>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            1 poin = {formatRupiah(RUPIAH_PER_POINT_REDEEMED)} discount.
            Maksimal dibatasi saldo dan subtotal Rp{" "}
            {eligibleSubtotal.toLocaleString("id-ID")}.
          </p>
        </div>

        <div>
          <Input
            label="Jumlah poin ditukar"
            type="number"
            min={0}
            max={maxPoints}
            value={pointsInput}
            onChange={(e) => setPointsInput(e.target.value)}
            inputMode="numeric"
            hint={
              overRequested
                ? `Diminta ${requested}, akan di-clamp ke ${clamped}`
                : `Discount: -${formatRupiah(rupiah)}`
            }
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[10, 25, 50, maxPoints]
              .filter((n) => n > 0 && n <= maxPoints)
              .filter((n, i, arr) => arr.indexOf(n) === i)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPreset(n)}
                  className="rounded-md border border-neutral-200 px-3 py-1 text-xs font-medium hover:border-amber-400 hover:bg-amber-50"
                >
                  {n === maxPoints ? `Max (${n})` : n}
                </button>
              ))}
          </div>
        </div>

        {maxPoints === 0 ? (
          <p className="rounded-md bg-warning-100/40 p-2 text-xs text-warning-500">
            Tidak ada poin yang bisa ditukar (saldo 0 atau subtotal terlalu
            kecil).
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
