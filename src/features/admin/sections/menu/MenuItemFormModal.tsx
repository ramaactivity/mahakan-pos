"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { isOk, menuService } from "@/mocks/services";
import type {
  Category,
  MenuItem,
  PriceType,
} from "@/mocks/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = { kind: "create" } | { kind: "edit"; item: MenuItem };

interface MenuItemFormModalProps {
  open: boolean;
  mode: Mode | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

export function MenuItemFormModal({
  open,
  mode,
  categories,
  onClose,
  onSaved,
}: MenuItemFormModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceType, setPriceType] = useState<PriceType>("fixed");
  const [priceFixed, setPriceFixed] = useState("");
  const [priceHot, setPriceHot] = useState("");
  const [priceIced, setPriceIced] = useState("");
  const [isSignature, setIsSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setSubmitting(false);
    if (mode.kind === "edit") {
      const it = mode.item;
      setName(it.name);
      setDescription(it.description ?? "");
      setCategoryId(it.categoryId);
      setPriceType(it.priceType);
      setPriceFixed(it.priceFixed !== null ? String(it.priceFixed) : "");
      setPriceHot(it.priceHot !== null ? String(it.priceHot) : "");
      setPriceIced(it.priceIced !== null ? String(it.priceIced) : "");
      setIsSignature(it.isSignature);
    } else {
      setName("");
      setDescription("");
      setCategoryId(categories[0]?.id ?? "");
      setPriceType("fixed");
      setPriceFixed("");
      setPriceHot("");
      setPriceIced("");
      setIsSignature(false);
    }
  }, [open, mode, categories]);

  const parsedFixed = parseInt(priceFixed, 10) || 0;
  const parsedHot = priceHot.trim() === "" ? null : parseInt(priceHot, 10) || 0;
  const parsedIced =
    priceIced.trim() === "" ? null : parseInt(priceIced, 10) || 0;

  async function onSubmit() {
    if (submitting || !mode) return;
    setSubmitting(true);
    setError(null);

    const input = {
      name,
      description: description.trim() || null,
      categoryId,
      priceType,
      priceFixed: priceType === "fixed" ? parsedFixed : null,
      priceHot: priceType === "variant" ? parsedHot : null,
      priceIced: priceType === "variant" ? parsedIced : null,
      isSignature,
      displayOrder: mode.kind === "edit" ? mode.item.displayOrder : 999,
    };

    const res =
      mode.kind === "create"
        ? await menuService.createMenuItem(input)
        : await menuService.updateMenuItem(mode.item.id, input);

    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }

    toast.success(
      mode.kind === "create" ? "Item ditambahkan" : "Item disimpan",
    );
    onSaved();
  }

  return (
    <Modal
      open={open && mode !== null}
      onClose={onClose}
      title={mode?.kind === "edit" ? "Edit Menu Item" : "Tambah Menu Item"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nama Item"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          maxLength={120}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Kategori
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-mahakan-green-500 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Deskripsi (opsional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-neutral-900">
            Tipe Harga
          </span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipe harga">
            {(
              [
                { v: "fixed" as const, label: "Fixed" },
                { v: "variant" as const, label: "Variant Hot/Iced" },
                { v: "open" as const, label: "Open Price" },
              ]
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                role="radio"
                aria-checked={priceType === opt.v}
                onClick={() => setPriceType(opt.v)}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-1",
                  priceType === opt.v
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {priceType === "fixed" ? (
          <Input
            label="Harga"
            type="text"
            inputMode="numeric"
            value={priceFixed}
            onChange={(e) =>
              setPriceFixed(e.target.value.replace(/[^\d]/g, ""))
            }
            hint={parsedFixed > 0 ? `Preview: ${formatRupiah(parsedFixed)}` : undefined}
            placeholder="20000"
          />
        ) : priceType === "variant" ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Harga Hot (kosongkan kalau iced-only)"
              type="text"
              inputMode="numeric"
              value={priceHot}
              onChange={(e) =>
                setPriceHot(e.target.value.replace(/[^\d]/g, ""))
              }
              hint={
                parsedHot !== null && parsedHot > 0
                  ? formatRupiah(parsedHot)
                  : undefined
              }
            />
            <Input
              label="Harga Iced (kosongkan kalau hot-only)"
              type="text"
              inputMode="numeric"
              value={priceIced}
              onChange={(e) =>
                setPriceIced(e.target.value.replace(/[^\d]/g, ""))
              }
              hint={
                parsedIced !== null && parsedIced > 0
                  ? formatRupiah(parsedIced)
                  : undefined
              }
            />
          </div>
        ) : (
          <p className="rounded-md bg-info-100 p-3 text-sm text-info-500">
            Open-price item (e.g. Manual Brew). Harga di-input barista per
            transaksi.
          </p>
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSignature}
            onChange={(e) => setIsSignature(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
          />
          <span className="text-sm text-neutral-900">
            Signature item (♥ icon di POS)
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
