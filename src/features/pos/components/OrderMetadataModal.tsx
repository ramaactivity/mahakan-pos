"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input, Modal } from "@/components/ui";
import {
  isOk,
  lookupCustomerByPhone,
  type Customer,
} from "@/features/customers";

interface OrderMetadataModalProps {
  open: boolean;
  /** Pre-fill from current draft. */
  initialPager: number | null;
  initialCustomerName: string | null;
  initialCustomerPhone: string | null;
  /** "save_bill" requires customerName so kasir can locate the bill later
   * via Bill Aktif. "pay" allows blank (e.g. Gojek pickup, walk-in). */
  mode: "pay" | "save_bill";
  onClose: () => void;
  onSubmit: (values: {
    pagerNumber: number | null;
    customerName: string | null;
    customerPhone: string | null;
  }) => void;
}

/**
 * Cashier-flow reorder (Galih ask #4): instead of prompting pager + name
 * upfront via NewOrderModal, items go in first then this modal collects
 * metadata at Bayar / Simpan Bill. Pager is fully optional. Customer
 * name is required only when saving as open bill (so the bill is
 * findable in Bill Aktif tab) — kasir can still pay walk-in customers
 * without a name.
 */
export function OrderMetadataModal({
  open,
  initialPager,
  initialCustomerName,
  initialCustomerPhone,
  mode,
  onClose,
  onSubmit,
}: OrderMetadataModalProps) {
  const [pager, setPager] = useState(
    initialPager !== null ? String(initialPager) : "",
  );
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(
    initialCustomerPhone ?? "",
  );
  const [memberMatch, setMemberMatch] = useState<Customer | null>(null);
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPager(initialPager !== null ? String(initialPager) : "");
    setCustomerName(initialCustomerName ?? "");
    setCustomerPhone(initialCustomerPhone ?? "");
    setMemberMatch(null);
    setMemberLookupLoading(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initialPager, initialCustomerName, initialCustomerPhone]);

  // Debounced phone → member lookup, mirrors NewOrderModal logic.
  const customerNameRef = useRef(customerName);
  useEffect(() => {
    customerNameRef.current = customerName;
  }, [customerName]);
  useEffect(() => {
    const phone = customerPhone.replace(/[^\d]/g, "");
    if (phone.length < 6) {
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

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);

    let pagerNumber: number | null = null;
    if (pager.trim().length > 0) {
      const num = parseInt(pager, 10);
      if (!Number.isFinite(num) || num < 1 || num > 99) {
        setError("Pager harus angka 1-99 atau kosongkan");
        return;
      }
      pagerNumber = num;
    }

    const trimmedName = customerName.trim();
    if (mode === "save_bill" && trimmedName.length === 0) {
      setError(
        "Nama / label customer wajib diisi untuk Simpan Bill — biar bisa di-find lagi.",
      );
      return;
    }

    const phone = customerPhone.replace(/[^\d]/g, "");
    onSubmit({
      pagerNumber,
      customerName: trimmedName.length > 0 ? trimmedName : null,
      customerPhone: phone.length >= 6 ? phone : null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "pay" ? "Konfirmasi Order" : "Simpan Bill"}
      description={
        mode === "pay"
          ? "Pager + nama customer opsional. Boleh langsung Lanjut Bayar."
          : "Customer name wajib biar bill ke-find di tab Bill Aktif."
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={() => handleSubmit()} size="lg">
            {mode === "pay" ? "Lanjut Bayar" : "Simpan"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label="Form metadata order"
      >
        <Input
          label="Nomor Pager (opsional)"
          type="text"
          inputMode="numeric"
          value={pager}
          onChange={(e) => {
            setPager(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
            setError(null);
          }}
          placeholder="1-99 atau kosongkan"
          autoFocus
          hint="Kosongkan kalau pesanan Gojek / takeaway tanpa pager."
        />
        <Input
          label="Nomor HP Member (opsional)"
          type="tel"
          inputMode="numeric"
          value={customerPhone}
          onChange={(e) =>
            setCustomerPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 20))
          }
          placeholder="08123456789"
          maxLength={20}
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
          label={
            mode === "save_bill"
              ? "Nama Customer (wajib)"
              : "Nama Customer (opsional)"
          }
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value.slice(0, 60))}
          placeholder="mis. Andi / Meja 5 / Gojek"
          maxLength={60}
          required={mode === "save_bill"}
          hint={
            memberMatch
              ? "Auto-isi dari member. Edit di sini = update nama member."
              : "Bantu kasir + dapur call out by name. Boleh label apa saja."
          }
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
