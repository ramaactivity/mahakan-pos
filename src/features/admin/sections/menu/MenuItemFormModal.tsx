"use client";

import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  isOk,
  computeMenuItemPriceSuggestion,
  createMenuItem,
  updateMenuItem,
  type Category,
  type MenuItem,
  type MenuItemPriceSuggestion,
  type PriceType,
} from "@/features/menu";
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
  // Phase 7.2 — BOM-based price suggestion (edit mode only)
  const [suggestion, setSuggestion] =
    useState<MenuItemPriceSuggestion | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setSubmitting(false);
    setSuggestion(null);
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
      // Fetch BOM-based price suggestion async — doesn't block the form
      void (async () => {
        const res = await computeMenuItemPriceSuggestion(it.id);
        if (isOk(res) && res.data) setSuggestion(res.data);
      })();
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
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, mode, categories]);

  function applySuggestion() {
    if (!suggestion) return;
    if (priceType === "fixed") {
      const fixedSugg = suggestion.perVariant.find(
        (s) => s.variant === "fixed",
      );
      if (fixedSugg) setPriceFixed(String(fixedSugg.suggestedPrice));
    } else if (priceType === "variant") {
      const hotSugg = suggestion.perVariant.find((s) => s.variant === "hot");
      const icedSugg = suggestion.perVariant.find((s) => s.variant === "iced");
      if (hotSugg) setPriceHot(String(hotSugg.suggestedPrice));
      if (icedSugg) setPriceIced(String(icedSugg.suggestedPrice));
    }
    toast.success("Harga ter-apply dari BOM");
  }

  const parsedFixed = parseInt(priceFixed, 10) || 0;
  const parsedHot = priceHot.trim() === "" ? null : parseInt(priceHot, 10) || 0;
  const parsedIced =
    priceIced.trim() === "" ? null : parseInt(priceIced, 10) || 0;

  async function onSubmit() {
    if (submitting || !mode) return;
    setSubmitting(true);
    setError(null);

    const common = {
      name,
      description: description.trim() || null,
      categoryId,
      isSignature,
      displayOrder: mode.kind === "edit" ? mode.item.displayOrder : 999,
    };
    const input =
      priceType === "fixed"
        ? { ...common, priceType: "fixed" as const, priceFixed: parsedFixed }
        : priceType === "variant"
          ? {
              ...common,
              priceType: "variant" as const,
              priceHot: parsedHot,
              priceIced: parsedIced,
            }
          : { ...common, priceType: "open" as const };

    const res =
      mode.kind === "create"
        ? await createMenuItem(input)
        : await updateMenuItem(mode.item.id, input);

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

        <Select
          label="Kategori"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onValueChange={setCategoryId}
        />

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

        {suggestion && priceType !== "open" ? (
          <div className="space-y-2 rounded-lg border border-info-300 bg-info-100 p-3">
            <div className="flex items-start gap-2">
              <Calculator
                className="mt-0.5 size-4 shrink-0 text-info-500"
                aria-hidden
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-info-500">
                  Saran harga dari BOM (markup {suggestion.markupPct}%
                  {suggestion.fromOutletSetting
                    ? ""
                    : " — default"}
                  )
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-neutral-700">
                  {suggestion.perVariant
                    .filter((s) =>
                      priceType === "fixed"
                        ? s.variant === "fixed"
                        : s.variant === "hot" || s.variant === "iced",
                    )
                    .map((s) => (
                      <li
                        key={s.variant}
                        className="flex justify-between gap-2"
                      >
                        <span className="capitalize text-neutral-600">
                          {s.variant === "fixed" ? "Harga" : s.variant}:
                        </span>
                        <span className="font-mono">
                          COGS {formatRupiah(s.cogs)} →{" "}
                          <strong>{formatRupiah(s.suggestedPrice)}</strong>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={applySuggestion}
                className="shrink-0"
              >
                Apply
              </Button>
            </div>
          </div>
        ) : null}

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
