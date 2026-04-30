"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, ShieldCheck, Lock } from "lucide-react";
import { Button, Modal, Spinner, toast } from "@/components/ui";
import {
  evaluateAll,
  isOk,
  listActivePromosForPos,
  type CartContext,
  type Promo,
  type PromoEligibility,
} from "@/features/promos";
import type { CartLineItem } from "@/features/pos/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PromoPickerModalProps {
  open: boolean;
  subtotal: number;
  cartLines: CartLineItem[];
  orderType: "dine_in" | "takeaway";
  paymentMethod: "cash" | "qris" | "card_bca" | "split" | null;
  /** When set, current draft already has a promo applied — modal lets user
   * remove it (alternative to picking a new one). */
  appliedPromoId: string | null;
  onClose: () => void;
  /** Called when user picks an eligible promo. Caller decides whether
   * approval popup is needed (based on `promo.requiresApproval`). */
  onPick: (promo: Promo, computedDiscount: number) => void;
  onClear: () => void;
}

export function PromoPickerModal({
  open,
  subtotal,
  cartLines,
  orderType,
  paymentMethod,
  appliedPromoId,
  onClose,
  onPick,
  onClear,
}: PromoPickerModalProps) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      try {
        const res = await listActivePromosForPos();
        if (cancelled) return;
        if (isOk(res)) setPromos(res.data);
        else toast.error(res.error.message);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Gagal load promo";
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const ctx = useMemo<CartContext>(
    () => ({
      subtotal,
      lines: cartLines.map((l) => ({
        categoryId: l.categoryId,
        lineSubtotal: l.subtotal,
      })),
      orderType,
      paymentMethod,
      now: new Date(),
    }),
    [subtotal, cartLines, orderType, paymentMethod],
  );

  const { eligible, ineligible } = useMemo(
    () => evaluateAll(promos, ctx),
    [promos, ctx],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pilih Promo"
      description={`Subtotal: ${formatRupiah(subtotal)}`}
      size="md"
      footer={
        <>
          {appliedPromoId ? (
            <Button
              variant="ghost"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Hapus Promo Aktif
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="size-6 text-mahakan-green-700" />
        </div>
      ) : promos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
          <Sparkles className="mx-auto size-8 text-neutral-300" aria-hidden />
          <p className="mt-2 text-sm font-medium text-neutral-700">
            Belum ada promo aktif
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Owner setup promo dulu di Back Office → Promo.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Eligible */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mahakan-green-700">
              Tersedia ({eligible.length})
            </p>
            {eligible.length === 0 ? (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-4 text-center text-xs italic text-neutral-500">
                Tidak ada promo yang cocok dengan order saat ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {eligible.map((e) => (
                  <PromoCard
                    key={e.promoId}
                    eligibility={e}
                    isApplied={e.promoId === appliedPromoId}
                    onPick={() => {
                      onPick(e.promo, e.computedDiscount);
                      onClose();
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Ineligible (greyed) */}
          {ineligible.length > 0 ? (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Tidak Eligible ({ineligible.length})
              </p>
              <ul className="space-y-2">
                {ineligible.map((e) => (
                  <PromoCard
                    key={e.promoId}
                    eligibility={e}
                    isApplied={false}
                    onPick={null}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function PromoCard({
  eligibility,
  isApplied,
  onPick,
}: {
  eligibility: PromoEligibility;
  isApplied: boolean;
  onPick: (() => void) | null;
}) {
  const { promo, eligible, computedDiscount, reason } = eligibility;
  const valueLabel =
    promo.discountType === "percent"
      ? `${promo.discountValue}%`
      : formatRupiah(promo.discountValue);

  return (
    <li>
      <button
        type="button"
        onClick={onPick ?? undefined}
        disabled={!onPick}
        className={cn(
          "w-full rounded-lg border p-3 text-left transition-all",
          eligible
            ? isApplied
              ? "border-mahakan-green-700 bg-mahakan-green-50 ring-2 ring-mahakan-green-700/30"
              : "border-mahakan-green-200 bg-white hover:border-mahakan-green-700 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            : "cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-70",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  eligible ? "text-neutral-900" : "text-neutral-500",
                )}
              >
                {promo.name}
              </span>
              {promo.requiresApproval ? (
                <span
                  title="Butuh PIN Owner / Manager"
                  className="inline-flex items-center gap-0.5 rounded-full bg-info-100 px-1.5 py-0.5 text-[10px] font-medium text-info-500"
                >
                  <ShieldCheck className="size-2.5" aria-hidden /> Approval
                </span>
              ) : null}
            </div>
            {promo.description ? (
              <p className="mt-0.5 truncate text-xs text-neutral-500">
                {promo.description}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">-{valueLabel}</span>
              {promo.scope === "category" ? " · kategori tertentu" : ""}
              {promo.discountType === "percent" && promo.maxDiscountAmount
                ? ` · max -${formatRupiah(promo.maxDiscountAmount)}`
                : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            {eligible ? (
              <>
                <p className="font-mono text-sm font-bold text-mahakan-green-700">
                  -{formatRupiah(computedDiscount)}
                </p>
                <p className="text-[10px] text-neutral-500">
                  {isApplied ? "Aktif" : "Tap untuk pakai"}
                </p>
              </>
            ) : (
              <span
                title={reason ?? ""}
                className="inline-flex items-center gap-1 text-[11px] text-neutral-500"
              >
                <Lock className="size-3" aria-hidden /> {reason ?? "Tidak eligible"}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
