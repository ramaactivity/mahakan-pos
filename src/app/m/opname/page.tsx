"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  PackageSearch,
  Plus,
  Save,
  Search,
} from "lucide-react";
import { Input, Select, Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  getActiveOpname,
  getOpnameDetail,
  isOk,
  saveOpnameCount,
} from "@/features/stock-opname";
import type {
  OpnameLineWithIngredient,
  OpnameSessionDetail,
} from "@/features/stock-opname/types";
import { AddOpnameItemModal } from "@/features/admin/sections/inventory/opname/AddOpnameItemModal";
import {
  buildOpnameUnitContext,
  cogsToTracking,
  computeOpnameQtyFromSplit,
  displayUnit,
  type IngredientPackConversion,
  type OpnameUnitContext,
  type IngredientUnitTiers,
} from "@/lib/unit-conversion";
import { parseIndonesianNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type SectionFilter = "all" | "bar" | "kitchen" | "supporting" | "cleaning" | "other";

interface SectionTab {
  key: SectionFilter;
  label: string;
}

const SECTION_TABS: SectionTab[] = [
  { key: "all", label: "Semua" },
  { key: "bar", label: "Bar" },
  { key: "kitchen", label: "Kitchen" },
  { key: "supporting", label: "Support" },
  { key: "cleaning", label: "Cleaning" },
  { key: "other", label: "Lainnya" },
];

interface LineDraft {
  input: string;
  /** Sesi AE-173 — "sisa lepas" optional dalam RECIPE unit (mis. 3 pack + 200 g). */
  loose?: string;
  /** Sesi AE-20 — unit yang dipakai staff input (boleh beda dari master).
   *  Default = master unit; staff pilih lain via picker, qty di-konversi
   *  saat save. Decimal allowed (0.5 Kg = 500 gr). */
  inputUnit: string;
  status: "idle" | "saving" | "saved" | "error";
  errorMsg?: string;
}

/**
 * Sesi AD-10 — Stock Opname mobile module.
 *
 * Flow:
 *   1. Auth check via NextAuth session (redirect /pin kalau belum login).
 *   2. Fetch active opname session via getActiveOpname().
 *   3. If no session → "Owner perlu start opname dulu" + back link.
 *   4. If session exists → fetch full detail (lines + ingredients).
 *   5. Group lines by ingredient.section, show tab filter.
 *   6. Per ingredient row: input physical count, save on blur.
 *   7. Permission: staff bisa count, manager finalize via Back Office.
 *
 * Layout: mobile-first, full-width cards, sticky tab bar at top after
 * scroll. No dedicated numpad — pakai native keyboard mobile dengan
 * inputMode="decimal" (works for kg/liter input).
 */
export default function MobileOpnamePage() {
  const router = useRouter();
  const { session, status } = useSession();

  // Auth redirect
  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/m/login");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return null;
  }

  return <OpnameView />;
}

function OpnameView() {
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OpnameSessionDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [filter, setFilter] = useState<SectionFilter>("all");
  const [search, setSearch] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const activeRes = await getActiveOpname();
      if (cancelled) return;
      if (!isOk(activeRes) || !activeRes.data) {
        setDetail(null);
        setLoading(false);
        return;
      }
      const detailRes = await getOpnameDetail(activeRes.data.id);
      if (cancelled) return;
      if (!isOk(detailRes) || !detailRes.data) {
        setDetail(null);
        setLoading(false);
        return;
      }
      setDetail(detailRes.data);
      // Pre-fill drafts from existing actualQty values. Sesi AE-15 — prefer
      // decimal mirror kalau ada (precise, e.g. "2.5" not "3").
      // Sesi AE-136 — restored value di-convert dari master/recipe unit ke
      // purchase unit (kalau ingredient punya unitBelanja set) supaya
      // konsisten dengan default input unit baru.
      const initialDrafts: Record<string, LineDraft> = {};
      for (const line of detailRes.data.lines) {
        if (line.actualQty !== null) {
          const masterQty =
            line.actualQtyDecimal !== null
              ? parseFloat(line.actualQtyDecimal)
              : line.actualQty;
          const preferred = preferredInputUnit(line.ingredient);
          const displayQty = convertMasterToPreferred(
            masterQty,
            line.ingredient,
          );
          /* Tampilkan format Indonesian (koma desimal) supaya konsisten
           * dengan parser strict. */
          const rawValue = formatQtyForInput(displayQty);
          initialDrafts[line.ingredientId] = {
            input: rawValue,
            inputUnit: preferred,
            status: "saved",
          };
        }
      }
      setDrafts(initialDrafts);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredLines = useMemo(() => {
    if (!detail) return [];
    const q = search.trim().toLowerCase();
    return detail.lines.filter((line) => {
      const sectionMatch =
        filter === "all"
          ? true
          : filter === "other"
            ? line.ingredient.section === null
            : line.ingredient.section === filter;
      if (!sectionMatch) return false;
      if (!q) return true;
      return line.ingredient.name.toLowerCase().includes(q);
    });
  }, [detail, filter, search]);

  const stats = useMemo(() => {
    if (!detail)
      return { counted: 0, total: 0, uncounted: 0 };
    let counted = 0;
    for (const line of detail.lines) {
      if (line.actualQty !== null) counted++;
    }
    return {
      counted,
      total: detail.lines.length,
      uncounted: detail.lines.length - counted,
    };
  }, [detail]);

  async function handleSaveLine(
    line: OpnameLineWithIngredient,
    raw: string,
    looseRaw: string,
    inputUnit: string,
  ) {
    if (!detail) return;
    const trimmed = raw.trim();
    const looseTrim = looseRaw.trim();
    const base: Omit<LineDraft, "status"> = { input: raw, loose: looseRaw, inputUnit };

    /* Sesi AE-136 — strict Indonesian parser: koma desimal, titik ribuan. */
    const primaryParsed =
      trimmed.length > 0 ? parseIndonesianNumber(trimmed) : null;
    const looseParsed =
      looseTrim.length > 0 ? parseIndonesianNumber(looseTrim) : null;

    const invalid = (v: number | null) =>
      v !== null && (!Number.isFinite(v) || v < 0);
    if (invalid(primaryParsed) || invalid(looseParsed)) {
      setDrafts((d) => ({
        ...d,
        [line.ingredientId]: {
          ...base,
          status: "error",
          errorMsg:
            "Format angka invalid. Pakai koma untuk desimal (mis. 0,5 bukan 0.5).",
        },
      }));
      return;
    }

    let actualQty: number | null = null;
    if (primaryParsed !== null || looseParsed !== null) {
      // Sesi AE-173 — gabung "penuh" (inputUnit) + "sisa lepas" (recipe unit)
      // → recipe unit via computeOpnameQtyFromSplit (sama dengan back office).
      const ctx = buildOpnameCtxFor(line.ingredient);
      actualQty = computeOpnameQtyFromSplit({
        primaryQty: primaryParsed,
        primaryUnit: inputUnit,
        looseQtyRecipe: looseParsed,
        context: ctx,
      });
      if (actualQty === null) {
        setDrafts((d) => ({
          ...d,
          [line.ingredientId]: {
            ...base,
            status: "error",
            errorMsg: `Tidak bisa convert ${inputUnit} ke ${line.ingredient.unit}`,
          },
        }));
        return;
      }
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { ...base, status: "saving" },
    }));

    const res = await saveOpnameCount({
      sessionId: detail.id,
      ingredientId: line.ingredientId,
      actualQty,
    });

    if (!isOk(res)) {
      setDrafts((d) => ({
        ...d,
        [line.ingredientId]: {
          ...base,
          status: "error",
          errorMsg: res.error.message,
        },
      }));
      toast.error(res.error.message);
      return;
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { ...base, status: "saved" },
    }));

    // Update detail line.actualQty so revisit shows saved value
    setDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((l) =>
          l.ingredientId === line.ingredientId
            ? { ...l, actualQty }
            : l,
        ),
      };
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <Link
          href="/m"
          className="inline-flex items-center gap-2 text-sm text-mahakan-green-700 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden /> Kembali ke menu
        </Link>
        <header className="flex flex-col items-start gap-2">
          <div className="flex size-14 items-center justify-center rounded-xl bg-mahakan-green-100 text-mahakan-green-800">
            <PackageSearch className="size-7" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-mahakan-green-900">
            Stock Opname
          </h1>
        </header>
        <div className="rounded-xl border border-warning-300 bg-warning-100 p-4 text-sm text-warning-500">
          Belum ada session opname aktif. Owner / Manager perlu start
          session dulu via Back Office.
        </div>
        <Link
          href="/m"
          className="block rounded-md border border-neutral-300 bg-white px-5 py-3 text-center text-base font-medium text-neutral-900 transition-colors hover:bg-neutral-100 active:bg-neutral-200"
        >
          Pilih Modul Lain
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/m"
        className="inline-flex items-center gap-2 text-sm text-mahakan-green-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Kembali ke menu
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <PackageSearch className="size-5 text-mahakan-green-700" aria-hidden />
          <h1 className="text-lg font-bold text-mahakan-green-900">
            Stock Opname
          </h1>
        </div>
        <p className="text-sm text-neutral-700">
          {detail.periodLabel ?? "Opname Bulan Ini"} ·{" "}
          <span className="font-mono">
            {stats.counted}/{stats.total}
          </span>{" "}
          counted
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full bg-mahakan-green-700 transition-all"
            style={{
              width: `${stats.total > 0 ? (stats.counted / stats.total) * 100 : 0}%`,
            }}
          />
        </div>
      </header>

      {/* Search */}
      <Input
        type="text"
        size="lg"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cari bahan…"
        leadingIcon={<Search className="size-4" aria-hidden />}
      />

      {/* Section tabs */}
      <div
        role="tablist"
        aria-label="Section filter"
        className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100/60 p-1"
      >
        {SECTION_TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? detail.lines.length
              : detail.lines.filter((l) =>
                  tab.key === "other"
                    ? l.ingredient.section === null
                    : l.ingredient.section === tab.key,
                ).length;
          if (count === 0 && tab.key !== "all") return null;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                filter === tab.key
                  ? "bg-white text-mahakan-green-900 shadow-sm ring-1 ring-mahakan-green-700/20"
                  : "text-neutral-600 hover:bg-white/70",
              )}
            >
              {tab.label}
              <span className="ml-1 text-[11px] text-neutral-500">
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Sesi AE-22 — Tombol tambah bahan baru. Staff sering ketemu bahan
       * yang lupa di-master. Tombol di sini biar gampang diakses sebelum
       * scroll list. */}
      <button
        type="button"
        onClick={() => setAddItemOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-mahakan-green-700/40 bg-mahakan-green-50/40 px-4 py-3 text-sm font-medium text-mahakan-green-700 transition-colors hover:border-mahakan-green-700 hover:bg-mahakan-green-50 active:scale-[0.99]"
      >
        <Plus className="size-4" aria-hidden /> Tambah Bahan Baru
      </button>

      {/* Lines list */}
      {filteredLines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white py-8 text-center text-sm text-neutral-600">
          Tidak ada bahan untuk filter ini.
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredLines.map((line) => {
            const draft = drafts[line.ingredientId];
            /* Sesi AE-136 — default ke purchase unit kalau set, fallback
             * ke recipe unit. */
            const inputUnit =
              draft?.inputUnit ?? preferredInputUnit(line.ingredient);
            return (
              <LineRow
                key={line.id}
                line={line}
                draft={draft}
                inputUnit={inputUnit}
                onChange={(input) => {
                  setDrafts((d) => ({
                    ...d,
                    [line.ingredientId]: {
                      input,
                      loose: d[line.ingredientId]?.loose ?? "",
                      inputUnit,
                      status: "idle",
                    },
                  }));
                }}
                onLooseChange={(loose) => {
                  setDrafts((d) => ({
                    ...d,
                    [line.ingredientId]: {
                      input: d[line.ingredientId]?.input ?? "",
                      loose,
                      inputUnit,
                      status: "idle",
                    },
                  }));
                }}
                onUnitChange={(nextUnit) => {
                  setDrafts((d) => ({
                    ...d,
                    [line.ingredientId]: {
                      input: d[line.ingredientId]?.input ?? "",
                      loose: d[line.ingredientId]?.loose ?? "",
                      inputUnit: nextUnit,
                      status:
                        d[line.ingredientId]?.status === "saved"
                          ? "idle"
                          : (d[line.ingredientId]?.status ?? "idle"),
                    },
                  }));
                }}
                onBlur={(input, loose) => {
                  const current = drafts[line.ingredientId];
                  if (
                    current?.status === "saved" &&
                    current.input === input &&
                    (current.loose ?? "") === loose &&
                    current.inputUnit === inputUnit
                  ) {
                    return;
                  }
                  if (
                    input.trim() === "" &&
                    loose.trim() === "" &&
                    line.actualQty === null
                  ) {
                    return;
                  }
                  void handleSaveLine(line, input, loose, inputUnit);
                }}
              />
            );
          })}
        </ul>
      )}

      <p className="rounded-lg bg-info-100/60 p-3 text-xs text-info-500">
        💡 Tip: isi jumlah fisik, pilih satuan yang kamu pakai (mis. Kg
        untuk timbangan), lalu tap di luar field untuk simpan otomatis.
        Decimal boleh (0.5 Kg = 500 gr). Untuk finalize opname,
        Owner/Manager review via Back Office.
      </p>

      <AddOpnameItemModal
        open={addItemOpen}
        sessionId={detail.id}
        onClose={() => setAddItemOpen(false)}
        onAdded={(newLine) => {
          setAddItemOpen(false);
          // Append ke detail.lines + pre-fill draft (sudah counted di server).
          setDetail((prev) => {
            if (!prev) return prev;
            return { ...prev, lines: [newLine, ...prev.lines] };
          });
          const decimalStr =
            newLine.actualQtyDecimal !== null
              ? String(parseFloat(newLine.actualQtyDecimal))
              : String(newLine.actualQty ?? 0);
          setDrafts((d) => ({
            ...d,
            [newLine.ingredientId]: {
              input: decimalStr,
              /* Sesi AE-136 — default ke purchase unit kalau set. */
              inputUnit: preferredInputUnit(newLine.ingredient),
              status: "saved",
            },
          }));
        }}
      />
    </div>
  );
}

/** Sesi AE-173 — context satuan opname (merge base + tier packs), dipakai
 *  bareng LineRow & handleSaveLine supaya konversi konsisten. */
function buildOpnameCtxFor(
  ingredient: OpnameLineWithIngredient["ingredient"],
): OpnameUnitContext {
  const basePacks = (ingredient.packConversions ??
    null) as IngredientPackConversion[] | null;
  const tierPacks: IngredientPackConversion[] = [];
  if (ingredient.unitTracking && ingredient.unitTrackingPerCogs) {
    const per = parseFloat(ingredient.unitTrackingPerCogs);
    if (Number.isFinite(per) && per > 0)
      tierPacks.push({ unitLabel: ingredient.unitTracking, qtyPerBase: per });
  }
  if (ingredient.unitBelanja && ingredient.unitBelanjaPerCogs) {
    const per = parseFloat(ingredient.unitBelanjaPerCogs);
    if (Number.isFinite(per) && per > 0)
      tierPacks.push({ unitLabel: ingredient.unitBelanja, qtyPerBase: per });
  }
  const merged: IngredientPackConversion[] = [];
  const seen = new Set<string>();
  for (const p of [...(basePacks ?? []), ...tierPacks]) {
    const lc = p.unitLabel.trim().toLowerCase();
    if (!lc || seen.has(lc)) continue;
    seen.add(lc);
    merged.push(p);
  }
  return buildOpnameUnitContext({
    recipeUnit: ingredient.unit,
    unitBelanja: ingredient.unitBelanja,
    unitBelanjaPerCogs: ingredient.unitBelanjaPerCogs,
    packConversions: merged.length > 0 ? merged : null,
  });
}

function LineRow({
  line,
  draft,
  inputUnit,
  onChange,
  onLooseChange,
  onUnitChange,
  onBlur,
}: {
  line: OpnameLineWithIngredient;
  draft: LineDraft | undefined;
  inputUnit: string;
  onChange: (raw: string) => void;
  onLooseChange: (raw: string) => void;
  onUnitChange: (nextUnit: string) => void;
  onBlur: (primary: string, loose: string) => void;
}) {
  // Sesi AE-15 — prefer decimal mirror untuk display + diff calc.
  const masterUnit = line.ingredient.unit;
  const expectedQtyValue =
    line.expectedQtyDecimal !== null
      ? parseFloat(line.expectedQtyDecimal)
      : Number(line.expectedQty);
  const inputValue = draft?.input ?? "";
  const status = draft?.status ?? "idle";

  let parsedActual: number | null = null;
  const trimmed = inputValue.trim();
  if (trimmed.length > 0) {
    /* Sesi AE-136 — strict Indonesian parser. */
    const p = parseIndonesianNumber(trimmed);
    if (Number.isFinite(p) && p >= 0) parsedActual = p;
  }

  /* Sisa lepas (recipe unit) — Sesi AE-173 split input parity dgn back office. */
  const looseValue = draft?.loose ?? "";
  let looseParsed: number | null = null;
  const looseTrim = looseValue.trim();
  if (looseTrim.length > 0) {
    const p = parseIndonesianNumber(looseTrim);
    if (Number.isFinite(p) && p >= 0) looseParsed = p;
  }

  /* Context satuan (shared dgn handleSaveLine: merge base + tier packs). */
  const opnameCtx = buildOpnameCtxFor(line.ingredient);
  const canPickUnit = opnameCtx.options.length > 1;
  const purchaseMultiplier =
    opnameCtx.purchaseUnit !== null
      ? (opnameCtx.multipliers.get(opnameCtx.purchaseUnit) ?? 1)
      : null;
  const showLooseField =
    opnameCtx.supportsSplitInput && inputUnit !== masterUnit;

  /* Gabung "penuh" (inputUnit) + "sisa lepas" (recipe) → recipe unit,
   * sama persis dengan yang disimpan handleSaveLine. */
  const convertedToMaster =
    parsedActual !== null || looseParsed !== null
      ? computeOpnameQtyFromSplit({
          primaryQty: parsedActual,
          primaryUnit: inputUnit,
          looseQtyRecipe: looseParsed,
          context: opnameCtx,
        })
      : null;
  const diff =
    convertedToMaster !== null ? convertedToMaster - expectedQtyValue : null;

  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);

  /* Sesi AE-130 — tracking preview (Anisa: "untuk sisa pakai satuan
   * terbesar"). Saat ingredient punya unit_tracking + per_cogs, tampilkan
   * input dalam tracking unit sebagai sanity check buat staff. */
  const tiers: IngredientUnitTiers = {
    cogsUnit: masterUnit,
    trackingUnit: line.ingredient.unitTracking,
    trackingPerCogs: line.ingredient.unitTrackingPerCogs,
  };
  const trackingPreview =
    convertedToMaster !== null && line.ingredient.unitTracking
      ? cogsToTracking(convertedToMaster, tiers)
      : null;

  return (
    <li
      className={cn(
        "rounded-lg border bg-white p-3 transition-colors",
        status === "saving" && "border-info-300",
        status === "saved" && "border-success-500/40 bg-success-100/30",
        status === "error" && "border-danger-300 bg-danger-100/30",
        status === "idle" && "border-neutral-200",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-neutral-900">
            {line.ingredient.name}
          </p>
          {/* Sesi AE-148 — Unit info chips: Resep + Belanja + Pack alts. */}
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
              Resep:&nbsp;<span className="font-semibold">{masterUnit}</span>
            </span>
            {opnameCtx.purchaseUnit && purchaseMultiplier !== null ? (
              <span className="inline-flex items-center rounded bg-mahakan-green-100/70 px-1.5 py-0.5 font-medium text-mahakan-green-900">
                1 {opnameCtx.purchaseUnit} ={" "}
                {new Intl.NumberFormat("id-ID", {
                  maximumFractionDigits: 4,
                }).format(purchaseMultiplier)}{" "}
                {masterUnit}
              </span>
            ) : null}
            {opnameCtx.options
              .filter((o) => o.source === "pack-alt")
              .map((alt) => (
                <span
                  key={alt.value}
                  className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-900"
                >
                  1 {alt.value} ={" "}
                  {new Intl.NumberFormat("id-ID", {
                    maximumFractionDigits: 4,
                  }).format(alt.multiplierToRecipe)}{" "}
                  {masterUnit}
                </span>
              ))}
          </div>
          <p className="text-[11px] text-neutral-600">
            Expected:{" "}
            <span className="font-mono">{fmt(expectedQtyValue)}</span>{" "}
            {masterUnit}
          </p>
        </div>
        <StatusIcon status={status} />
      </div>
      {/* Sesi AE-20 — input QTY + unit picker side-by-side. Mirror
       * pattern Catat Pembelian (bahan + qty + unit + harga). Decimal
       * QTY allowed (0.5 Kg = 500 gr). Auto-convert ke master unit
       * saat blur / save. */}
      <div className="mt-2 flex items-stretch gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onBlur(e.target.value, looseValue)}
          placeholder="0"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-mono tabular-nums text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
        />
        {canPickUnit ? (
          <div className="w-[116px] flex-none">
            <Select
              size="md"
              ariaLabel={`Satuan ${line.ingredient.name}`}
              options={opnameCtx.options.map((o) => ({
                value: displayUnit(o.value),
                label: displayUnit(o.label),
                hint: o.hint ?? undefined,
              }))}
              value={displayUnit(inputUnit)}
              onValueChange={(v) => {
                onUnitChange(v);
                /* Save dengan unit baru — match prev onBlur behavior. */
                onBlur(inputValue, looseValue);
              }}
            />
          </div>
        ) : (
          <span className="flex w-[72px] shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 px-2 text-sm font-medium text-neutral-700">
            {displayUnit(masterUnit)}
          </span>
        )}
      </div>

      {/* Sesi AE-173 — "+ sisa lepas" (split): pack tidak full, mis. 3 pack +
          200 g. Hanya muncul saat satuan ≠ resep & punya konversi. */}
      {showLooseField ? (
        <div className="mt-2 flex items-stretch gap-2">
          <span className="flex flex-none items-center px-0.5 text-[11px] font-medium text-neutral-500">
            + sisa lepas
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={looseValue}
            onChange={(e) => onLooseChange(e.target.value)}
            onBlur={(e) => onBlur(inputValue, e.target.value)}
            placeholder="0"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono tabular-nums text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
          />
          <span className="flex w-[72px] flex-none items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 px-2 text-sm font-medium text-neutral-700">
            {masterUnit}
          </span>
        </div>
      ) : null}

      {/* Sesi AE-173 — tandai kosong/habis (parity dengan back office). */}
      <button
        type="button"
        onClick={() => {
          onChange("0");
          onLooseChange("");
          onBlur("0", "");
        }}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 transition-colors active:scale-95 hover:border-mahakan-green-700 hover:bg-mahakan-green-50 hover:text-mahakan-green-700"
      >
        Tandai kosong / habis (0)
      </button>
      {/* Total preview — gabungan penuh + sisa lepas dalam recipe unit. */}
      {convertedToMaster !== null &&
      (inputUnit !== masterUnit || looseParsed !== null) ? (
        <p className="mt-1 text-[11px] text-neutral-600">
          Total:{" "}
          <span className="font-mono font-semibold">
            {fmt(convertedToMaster)}
          </span>{" "}
          {masterUnit}
        </p>
      ) : null}
      {/* Sesi AE-130 — tracking preview (Anisa: "untuk sisa pakai satuan
          terbesar"). Tampil saat ingredient punya unit_tracking yang scale-nya
          beda dari unit yang sedang di-input, sebagai sanity check. */}
      {trackingPreview !== null &&
      line.ingredient.unitTracking &&
      line.ingredient.unitTracking !== inputUnit &&
      line.ingredient.unitTracking !== masterUnit ? (
        <p className="mt-0.5 text-[11px] text-mahakan-green-700">
          ≈{" "}
          <span className="font-mono">{fmt(trackingPreview)}</span>{" "}
          {line.ingredient.unitTracking}
        </p>
      ) : null}
      {diff !== null && diff !== 0 ? (
        <p
          className={cn(
            "mt-1.5 text-[11px] font-medium",
            diff > 0 ? "text-success-500" : "text-danger-500",
          )}
        >
          Selisih:{" "}
          <span className="font-mono">
            {diff > 0 ? "+" : ""}
            {fmt(diff)}
          </span>{" "}
          {masterUnit}
        </p>
      ) : null}
      {status === "error" && draft?.errorMsg ? (
        <p className="mt-1 text-[11px] font-medium text-danger-500">
          {draft.errorMsg}
        </p>
      ) : null}
    </li>
  );
}

/* ============================================================
 * Sesi AE-136 — Unit preference helpers untuk opname.
 *
 * Konvensi 2-unit baru: input + display pakai Purchase Unit (kg/L/btl)
 * kalau ingredient punya unitBelanja set, fallback ke Recipe Unit (g/ml)
 * untuk legacy data. Internal storage tetap di Recipe Unit untuk presisi
 * — konversi di-handle di handleSaveLine via computeOpnameQtyFromSplit.
 * ============================================================ */

interface IngredientWithTiers {
  unit: string;
  unitBelanja: string | null;
  unitBelanjaPerCogs: string | null;
}

/** Pilih input unit default: purchase kalau set valid, recipe sebagai fallback. */
function preferredInputUnit(ing: IngredientWithTiers): string {
  const b = ing.unitBelanja?.trim();
  if (!b) return ing.unit;
  const per = parseFloat(ing.unitBelanjaPerCogs ?? "");
  if (!Number.isFinite(per) || per <= 0) return ing.unit;
  return b;
}

/** Convert qty dari master/recipe unit ke preferred display unit. */
function convertMasterToPreferred(
  qtyMaster: number,
  ing: IngredientWithTiers,
): number {
  const b = ing.unitBelanja?.trim();
  if (!b) return qtyMaster;
  const per = parseFloat(ing.unitBelanjaPerCogs ?? "");
  if (!Number.isFinite(per) || per <= 0) return qtyMaster;
  return qtyMaster / per;
}

/** Format qty untuk input field — Indonesian (koma desimal), trim
 * trailing zeros. "2.5000" → "2,5", "100" → "100". */
function formatQtyForInput(n: number): string {
  if (!Number.isFinite(n)) return "0";
  /* Round-trip through toFixed(4) lalu trim trailing zeros + dot. */
  const fixed = n.toFixed(4);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed.replace(".", ",");
}

function StatusIcon({ status }: { status: LineDraft["status"] }) {
  if (status === "saving") {
    return (
      <Loader2
        className="size-4 shrink-0 animate-spin text-info-500"
        aria-label="Menyimpan"
      />
    );
  }
  if (status === "saved") {
    return (
      <Check
        className="size-4 shrink-0 text-success-500"
        aria-label="Tersimpan"
      />
    );
  }
  if (status === "error") {
    return (
      <Save
        className="size-4 shrink-0 text-danger-500"
        aria-label="Error simpan"
      />
    );
  }
  return null;
}
