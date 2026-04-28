"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { useCartStore } from "@/features/pos/cartStore";
import type { OrderType } from "@/features/transactions";
import { cn } from "@/lib/utils";

interface NewOrderModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new draft id after creation. Caller navigates. */
  onCreated: (draftId: string) => void;
}

export function NewOrderModal({ open, onClose, onCreated }: NewOrderModalProps) {
  const startDraft = useCartStore((s) => s.startDraft);

  const [pager, setPager] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // S4: auto-suggest pager = max(active drafts pager) + 1, capped at 99,
    // fallback 1 when no drafts.
    const active = useCartStore.getState().drafts;
    const used = Object.values(active).map((d) => d.pagerNumber);
    const next = used.length === 0 ? 1 : Math.min(99, Math.max(...used) + 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPager(String(next));
    setOrderType("takeaway");
    setError(null);
  }, [open]);

  function onSubmit() {
    const num = parseInt(pager, 10);
    if (!Number.isFinite(num) || num < 1 || num > 99) {
      setError("Pager harus angka 1-99");
      return;
    }
    const id = startDraft(num, orderType);
    onCreated(id);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order Baru"
      description="Masukin pager + tipe order. Multi-draft didukung."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={onSubmit} size="lg">
            Mulai Order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nomor Pager"
          type="text"
          inputMode="numeric"
          value={pager}
          onChange={(e) => {
            setPager(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
            setError(null);
          }}
          placeholder="1-99"
          autoFocus
        />
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-neutral-900">
            Tipe Order
          </span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipe order">
            {(
              [
                { value: "takeaway", label: "Takeaway" },
                { value: "dine_in", label: "Dine-in" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={orderType === opt.value}
                onClick={() => setOrderType(opt.value)}
                className={cn(
                  "rounded-md border py-3 text-sm font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                  orderType === opt.value
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
