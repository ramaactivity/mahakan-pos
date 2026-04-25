"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import type { MenuItem } from "@/mocks/types";
import { buildLineItem } from "@/features/pos/cartStore";
import { formatRupiah, parseRupiah } from "@/lib/format";

interface OpenPriceModalProps {
  item: MenuItem | null;
  categoryName: string;
  onClose: () => void;
  onAdd: (line: ReturnType<typeof buildLineItem>) => void;
}

export function OpenPriceModal({
  item,
  categoryName,
  onClose,
  onAdd,
}: OpenPriceModalProps) {
  const [price, setPrice] = useState("");
  const [beans, setBeans] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    // Reset state on new item — sync with external trigger
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrice("");
    setBeans("");
    setError(null);
  }, [item]);

  if (!item) return null;

  let parsed = 0;
  try {
    parsed = parseRupiah(price);
  } catch {
    parsed = 0;
  }

  function onSubmit() {
    if (!item) return;
    if (parsed < 1_000) {
      setError("Harga minimal Rp 1.000");
      return;
    }
    if (parsed > 999_999_999) {
      setError("Harga di atas batas wajar");
      return;
    }
    if (beans.trim().length === 0) {
      setError("Catatan beans wajib diisi (misal: Ethiopia Yirgacheffe)");
      return;
    }
    const line = buildLineItem({
      menuItemId: item.id,
      name: item.name,
      categoryName,
      variant: null,
      unitPrice: parsed,
      quantity: 1,
      modifiers: [],
      note: null,
      openPriceNote: beans.trim(),
    });
    onAdd(line);
    onClose();
  }

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={item.name}
      description="Manual brew — input harga + catatan jenis beans"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            onClick={onSubmit}
            size="lg"
            disabled={parsed < 1_000 || beans.trim().length === 0}
          >
            Tambah · {parsed > 0 ? formatRupiah(parsed) : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Harga (Rupiah)"
          type="text"
          inputMode="numeric"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value.replace(/[^\d]/g, ""));
            setError(null);
          }}
          placeholder="35000"
          hint={`Preview: ${formatRupiah(parsed)}`}
          autoFocus
        />
        <Input
          label="Catatan Beans"
          type="text"
          value={beans}
          onChange={(e) => {
            setBeans(e.target.value);
            setError(null);
          }}
          placeholder="Ethiopia Yirgacheffe"
          hint="Akan dicetak di struk"
          maxLength={120}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
