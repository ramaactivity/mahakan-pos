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
import { computeGrossMarginPct } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode =
  | { kind: "create"; prefillPrice?: number; prefillSource?: string }
  | { kind: "edit"; item: MenuItem };

interface MenuItemFormModalProps {
  open: boolean;
  mode: Mode | null;
  categories: Category[];
  onClose: () => void;
  /** Sesi AE-168 — bawa item yang baru dibuat supaya caller (tab Resep)
   * bisa langsung buka editor resep. Undefined saat edit. */
  onSaved: (created?: MenuItem) => void;
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
  // Sesi AE-173 — HPP manual (Rp) untuk menu fixed. Kosong = fallback resep.
  const [cost, setCost] = useState("");
  // Sesi AE-175 — HPP manual per varian (Rp) untuk menu Hot/Iced.
  const [costHot, setCostHot] = useState("");
  const [costIced, setCostIced] = useState("");
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
      setCost(it.cost !== null && it.cost !== undefined ? String(it.cost) : "");
      // Sesi AE-175 — prefill HPP per varian. Data lama (variant) cuma punya
      // `cost` tunggal → jadikan starting point biar owner tinggal sesuaikan.
      const legacyVariantCost =
        it.priceType === "variant" && it.cost !== null && it.cost !== undefined
          ? String(it.cost)
          : "";
      setCostHot(
        it.costHot !== null && it.costHot !== undefined
          ? String(it.costHot)
          : legacyVariantCost,
      );
      setCostIced(
        it.costIced !== null && it.costIced !== undefined
          ? String(it.costIced)
          : legacyVariantCost,
      );
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
      setPriceFixed(
        mode.prefillPrice && mode.prefillPrice > 0
          ? String(mode.prefillPrice)
          : "",
      );
      setPriceHot("");
      setPriceIced("");
      setCost("");
      setCostHot("");
      setCostIced("");
      setIsSignature(false);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, mode, categories]);

  const createPrefillSource =
    mode?.kind === "create" && mode.prefillPrice && mode.prefillSource
      ? mode.prefillSource
      : null;

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
  const parsedCost = cost.trim() === "" ? null : parseInt(cost, 10) || 0;
  const parsedCostHot =
    costHot.trim() === "" ? null : parseInt(costHot, 10) || 0;
  const parsedCostIced =
    costIced.trim() === "" ? null : parseInt(costIced, 10) || 0;

  // Sesi AE-173 — isi HPP fixed dari COGS resep 'fixed'.
  function applyRecipeCost() {
    if (!suggestion) return;
    const fixed = suggestion.perVariant.find((s) => s.variant === "fixed");
    const picked = fixed?.cogs ?? suggestion.perVariant[0]?.cogs ?? 0;
    setCost(String(picked));
    toast.success("HPP terisi dari resep");
  }

  // Sesi AE-175 — isi HPP Hot & Iced dari COGS resep masing-masing varian.
  function applyRecipeCostVariant() {
    if (!suggestion) return;
    const hot = suggestion.perVariant.find((s) => s.variant === "hot");
    const iced = suggestion.perVariant.find((s) => s.variant === "iced");
    if (hot) setCostHot(String(hot.cogs));
    if (iced) setCostIced(String(iced.cogs));
    if (!hot && !iced) {
      toast.error("Resep belum punya varian Hot/Iced");
      return;
    }
    toast.success("HPP Hot & Iced terisi dari resep");
  }

  // Margin per konteks: fixed pakai (priceFixed, cost); variant per varian.
  const marginPct = computeGrossMarginPct(parsedFixed, parsedCost);
  const marginHot = computeGrossMarginPct(parsedHot, parsedCostHot);
  const marginIced = computeGrossMarginPct(parsedIced, parsedCostIced);

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
        ? {
            ...common,
            priceType: "fixed" as const,
            priceFixed: parsedFixed,
            cost: parsedCost,
          }
        : priceType === "variant"
          ? {
              ...common,
              priceType: "variant" as const,
              priceHot: parsedHot,
              priceIced: parsedIced,
              costHot: parsedCostHot,
              costIced: parsedCostIced,
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
      mode.kind === "create" ? "Menu ditambahkan" : "Menu disimpan",
    );
    onSaved(mode.kind === "create" ? res.data : undefined);
  }

  return (
    <Modal
      open={open && mode !== null}
      onClose={onClose}
      title={mode?.kind === "edit" ? "Edit Menu" : "Tambah Menu"}
      size="3xl"
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
          label="Nama Menu"
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

        {createPrefillSource ? (
          <div className="rounded-md border border-info-300 bg-info-100 p-3 text-xs text-info-500">
            <Calculator className="mr-1.5 inline size-4" aria-hidden />
            <strong>Pre-fill dari {createPrefillSource}.</strong> Harga
            sudah ter-isi otomatis — bebas override sebelum simpan.
          </div>
        ) : null}

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
            Menu open-price (mis. Manual Brew). Harga di-input barista per
            transaksi.
          </p>
        )}

        {/* Sesi AE-173/AE-175 — HPP manual + Hitung dari resep + preview margin.
            Menu variant punya kolom HPP Hot & Iced terpisah (bisa beda). */}
        {priceType === "variant" ? (
          <div className="space-y-2.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-neutral-900">
                HPP / Cost per Varian (Rp)
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyRecipeCostVariant}
                disabled={!suggestion}
                className="shrink-0"
              >
                <Calculator className="size-4" aria-hidden /> Hitung dari resep
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-2.5">
                <Input
                  label="HPP Hot"
                  type="text"
                  inputMode="numeric"
                  value={costHot}
                  onChange={(e) =>
                    setCostHot(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="contoh: 4000"
                  hint={
                    parsedCostHot !== null && parsedCostHot > 0
                      ? `Preview: ${formatRupiah(parsedCostHot)}`
                      : "Kosongkan kalau hot tak dijual / fallback resep"
                  }
                />
                <MarginLine
                  marginPct={marginHot}
                  price={parsedHot}
                  emptyHint="Isi harga & HPP Hot untuk lihat margin."
                />
              </div>
              <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-2.5">
                <Input
                  label="HPP Iced"
                  type="text"
                  inputMode="numeric"
                  value={costIced}
                  onChange={(e) =>
                    setCostIced(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="contoh: 15000"
                  hint={
                    parsedCostIced !== null && parsedCostIced > 0
                      ? `Preview: ${formatRupiah(parsedCostIced)}`
                      : "Kosongkan kalau iced tak dijual / fallback resep"
                  }
                />
                <MarginLine
                  marginPct={marginIced}
                  price={parsedIced}
                  emptyHint="Isi harga & HPP Iced untuk lihat margin."
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="HPP / Cost (Rp)"
                  type="text"
                  inputMode="numeric"
                  value={cost}
                  onChange={(e) =>
                    setCost(e.target.value.replace(/[^\d]/g, ""))
                  }
                  placeholder="contoh: 12000"
                  hint={
                    parsedCost !== null && parsedCost > 0
                      ? `Preview: ${formatRupiah(parsedCost)}`
                      : "Kosongkan kalau belum dihitung"
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyRecipeCost}
                disabled={!suggestion}
                className="mb-[2px] shrink-0"
              >
                <Calculator className="size-4" aria-hidden /> Hitung dari resep
              </Button>
            </div>
            <MarginLine
              marginPct={marginPct}
              price={parsedFixed}
              emptyHint={
                mode?.kind === "create"
                  ? "Tombol “Hitung dari resep” aktif setelah menu disimpan (butuh resep)."
                  : !suggestion
                    ? "Belum ada resep — isi HPP manual."
                    : "Isi HPP untuk lihat margin."
              }
            />
          </div>
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSignature}
            onChange={(e) => setIsSignature(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
          />
          <span className="text-sm text-neutral-900">
            Menu signature (♥ icon di POS)
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

// Sesi AE-175 — baris preview margin reusable (fixed + per varian).
function MarginLine({
  marginPct,
  price,
  emptyHint,
}: {
  marginPct: number | null;
  price: number | null;
  emptyHint: string;
}) {
  if (marginPct === null) {
    return <p className="text-xs text-neutral-500">{emptyHint}</p>;
  }
  return (
    <p className="text-xs text-neutral-600">
      Margin:{" "}
      <strong
        className={cn(
          marginPct >= 0 ? "text-mahakan-green-700" : "text-danger-500",
        )}
      >
        {marginPct.toFixed(1)}%
      </strong>{" "}
      (dari harga {formatRupiah(price ?? 0)})
    </p>
  );
}
