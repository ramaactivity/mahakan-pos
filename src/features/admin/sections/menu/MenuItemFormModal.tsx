"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator, Flame, Snowflake } from "lucide-react";
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

  // Bug fix (feedback Anisa) — form ini sebelumnya re-init tiap kali prop
  // `categories` ganti identitas. `categories` di-refetch tiap 20 dtk oleh
  // useLiveRefresh di ItemsList → array identity baru → useEffect re-run →
  // SEMUA field (termasuk HPP Hot/Iced yg lagi diketik tapi belum disimpan)
  // ke-reset ke nilai DB. Gejala: ngetik kolom kedua, kolom pertama hilang;
  // atau didiemkan beberapa detik angkanya lenyap.
  // Fix: hanya init sekali per "buka modal / ganti item", dijaga init-key ref —
  // BUKAN tiap identitas prop berubah.
  const initKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !mode) {
      // Modal tertutup → reset penanda supaya buka ulang item yg sama re-init.
      initKeyRef.current = null;
      return;
    }
    const initKey = mode.kind === "edit" ? `edit:${mode.item.id}` : "create";
    // Sudah di-init untuk konteks ini → JANGAN timpa ketikan user.
    if (initKeyRef.current === initKey) return;
    initKeyRef.current = initKey;

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
      // Default kategori diisi oleh effect terpisah (lihat bawah) supaya
      // categories yg datang belakangan / berubah identitas tak nimpa field lain.
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

  // Isi default kategori (create mode) saat daftar kategori baru tersedia,
  // TANPA menimpa field lain. Hanya jalan kalau user belum pilih kategori.
  useEffect(() => {
    if (open && mode?.kind === "create" && !categoryId && categories.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCategoryId(categories[0].id);
    }
  }, [open, mode, categories, categoryId]);

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
            leadingIcon={<span className="text-sm font-medium">Rp</span>}
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
              leadingIcon={<Flame className="size-4 text-amber-600" aria-hidden />}
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
              leadingIcon={<Snowflake className="size-4 text-sky-600" aria-hidden />}
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
              <VariantCostCard
                variant="hot"
                value={costHot}
                onChange={(v) => setCostHot(v)}
                parsedCost={parsedCostHot}
                marginPct={marginHot}
                price={parsedHot}
              />
              <VariantCostCard
                variant="iced"
                value={costIced}
                onChange={(v) => setCostIced(v)}
                parsedCost={parsedCostIced}
                marginPct={marginIced}
                price={parsedIced}
              />
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
                  leadingIcon={<span className="text-sm font-medium">Rp</span>}
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
  const positive = marginPct >= 0;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
      <span className="text-neutral-500">Margin</span>
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
          positive
            ? "bg-mahakan-green-50 text-mahakan-green-700"
            : "bg-danger-100 text-danger-500",
        )}
      >
        {marginPct.toFixed(1)}%
      </span>
      <span className="text-neutral-500">dari {formatRupiah(price ?? 0)}</span>
    </p>
  );
}

// Feedback Anisa — dua HPP per varian gampang ketuker karena identik.
// Kartu ini kasih identitas visual tegas: Hot = amber + ikon api,
// Iced = sky + ikon salju, plus prefix "Rp" biar jelas ini nominal rupiah.
const VARIANT_THEME = {
  hot: {
    label: "HPP Hot",
    icon: Flame,
    chip: "Hot",
    placeholder: "contoh: 4000",
    emptyHint: "Kosongkan kalau hot tak dijual / fallback resep",
    marginEmpty: "Isi harga & HPP Hot untuk lihat margin.",
    card: "border-amber-200 bg-amber-50/40",
    chipClass: "bg-amber-100 text-amber-700",
  },
  iced: {
    label: "HPP Iced",
    icon: Snowflake,
    chip: "Iced",
    placeholder: "contoh: 15000",
    emptyHint: "Kosongkan kalau iced tak dijual / fallback resep",
    marginEmpty: "Isi harga & HPP Iced untuk lihat margin.",
    card: "border-sky-200 bg-sky-50/40",
    chipClass: "bg-sky-100 text-sky-700",
  },
} as const;

function VariantCostCard({
  variant,
  value,
  onChange,
  parsedCost,
  marginPct,
  price,
}: {
  variant: "hot" | "iced";
  value: string;
  onChange: (next: string) => void;
  parsedCost: number | null;
  marginPct: number | null;
  price: number | null;
}) {
  const t = VARIANT_THEME[variant];
  const Icon = t.icon;
  return (
    <div className={cn("space-y-2 rounded-md border p-2.5", t.card)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
          t.chipClass,
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {t.chip}
      </span>
      <Input
        label={t.label}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        leadingIcon={<span className="text-sm font-medium">Rp</span>}
        placeholder={t.placeholder}
        hint={
          parsedCost !== null && parsedCost > 0
            ? `Preview: ${formatRupiah(parsedCost)}`
            : t.emptyHint
        }
      />
      <MarginLine marginPct={marginPct} price={price} emptyHint={t.marginEmpty} />
    </div>
  );
}
