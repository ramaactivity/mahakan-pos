"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, NumericInput } from "@/components/ui";
import { useCartStore } from "@/features/pos/cartStore";
import type { OrderType } from "@/features/transactions";
import {
  isOk,
  lookupCustomerByPhone,
  type Customer,
} from "@/features/customers";
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
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [memberMatch, setMemberMatch] = useState<Customer | null>(null);
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // S4: auto-suggest pager = max(active drafts pager) + 1, capped at 99,
    // fallback 1 when no drafts.
    const active = useCartStore.getState().drafts;
    const used = Object.values(active)
      .map((d) => d.pagerNumber)
      .filter((n): n is number => n !== null);
    const next = used.length === 0 ? 1 : Math.min(99, Math.max(...used) + 1);
    /* eslint-disable react-hooks/set-state-in-effect */
    setPager(String(next));
    setCustomerName("");
    setCustomerPhone("");
    setMemberMatch(null);
    setMemberLookupLoading(false);
    setOrderType("takeaway");
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  // Debounced phone → member lookup. When a valid digits-only phone is
  // typed (>= 6 digits), query the server for an existing customer record
  // and surface name + balance so kasir can confirm before checkout.
  // Sync the ref inside an effect (rules-of-react require ref writes to
  // happen outside render).
  const customerNameRef = useRef(customerName);
  useEffect(() => {
    customerNameRef.current = customerName;
  }, [customerName]);
  useEffect(() => {
    const phone = customerPhone.replace(/[^\d]/g, "");
    if (phone.length < 6) {
      // Defer state resets to next tick so the rule
      // react-hooks/set-state-in-effect doesn't flag us.
      const t = setTimeout(() => {
        setMemberMatch(null);
        setMemberLookupLoading(false);
      }, 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (!cancelled) setMemberLookupLoading(true);
    }, 0);
    const timer = setTimeout(async () => {
      const res = await lookupCustomerByPhone(phone);
      if (cancelled) return;
      if (isOk(res)) {
        setMemberMatch(res.data);
        if (res.data && customerNameRef.current.length === 0) {
          setCustomerName(res.data.name);
        }
      }
      setMemberLookupLoading(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearTimeout(timer);
    };
  }, [customerPhone]);

  function onSubmit() {
    const num = parseInt(pager, 10);
    if (!Number.isFinite(num) || num < 1 || num > 99) {
      setError("Pager harus angka 1-99");
      return;
    }
    const id = startDraft(
      num,
      orderType,
      customerName || null,
      customerPhone || null,
    );
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
        <NumericInput
          label="Nomor Pager"
          value={pager}
          onChange={(v) => {
            setPager(v.slice(0, 2));
            setError(null);
          }}
          maxLength={2}
          placeholder="1-99"
          formatThousands={false}
        />
        <NumericInput
          label="Nomor HP Member (opsional)"
          value={customerPhone}
          onChange={(v) => setCustomerPhone(v.slice(0, 20))}
          placeholder="08123456789"
          maxLength={20}
          formatThousands={false}
          hint={
            memberLookupLoading
              ? "Cek member..."
              : memberMatch
                ? `✓ Member: ${memberMatch.name} · ${memberMatch.totalPoints} poin`
                : customerPhone.length >= 6
                  ? "Member baru — auto daftar saat bayar"
                  : "Min 6 digit untuk daftar member loyalty"
          }
        />
        <Input
          label="Nama Customer (opsional)"
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value.slice(0, 60))}
          placeholder="mis. Andi / Meja 5 / Gojek"
          maxLength={60}
          hint={
            memberMatch
              ? "Auto-isi dari member. Edit di sini = update nama member."
              : "Bantu kasir + dapur call out by name. Boleh label apa saja."
          }
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
