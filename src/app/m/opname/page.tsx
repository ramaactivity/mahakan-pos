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
import { Input, Spinner, toast } from "@/components/ui";
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
  cogsToTracking,
  compatibleUnitsFor,
  convertQtyWithIngredientPacks,
  resolveUnit,
  type IngredientPackConversion,
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
    inputUnit: string,
  ) {
    if (!detail) return;
    const trimmed = raw.trim();
    let actualQty: number | null = null;
    if (trimmed.length > 0) {
      /* Sesi AE-136 — strict Indonesian parser: koma desimal, titik
       * ribuan. Tolak format Inggris ("0.5" → NaN). */
      const parsed = parseIndonesianNumber(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setDrafts((d) => ({
          ...d,
          [line.ingredientId]: {
            input: raw,
            inputUnit,
            status: "error",
            errorMsg:
              "Format angka invalid. Pakai koma untuk desimal (mis. 0,5 bukan 0.5).",
          },
        }));
        return;
      }
      // Sesi AE-20 → AE-62y — convert ke master unit kalau staff pilih unit
      // lain. Pakai convertQtyWithIngredientPacks supaya ingredient-scoped
      // pack conversions (mis. 1 packs = 20 pcs untuk Lychee Kaleng) bisa
      // di-honor. Fallback ke same-dimension (Kg↔gr) lewat helper internal.
      const masterUnit = line.ingredient.unit;
      if (inputUnit !== masterUnit) {
        const convertRes = convertQtyWithIngredientPacks(
          parsed,
          inputUnit,
          masterUnit,
          line.ingredient.packConversions ?? null,
        );
        if (!convertRes.ok || convertRes.qtyMaster === null) {
          setDrafts((d) => ({
            ...d,
            [line.ingredientId]: {
              input: raw,
              inputUnit,
              status: "error",
              errorMsg: `Tidak bisa convert ${inputUnit} ke ${masterUnit}`,
            },
          }));
          return;
        }
        actualQty = convertRes.qtyMaster;
      } else {
        actualQty = parsed;
      }
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { input: raw, inputUnit, status: "saving" },
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
          input: raw,
          inputUnit,
          status: "error",
          errorMsg: res.error.message,
        },
      }));
      toast.error(res.error.message);
      return;
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { input: raw, inputUnit, status: "saved" },
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
                      inputUnit,
                      status: "idle",
                    },
                  }));
                }}
                onUnitChange={(nextUnit) => {
                  setDrafts((d) => ({
                    ...d,
                    [line.ingredientId]: {
                      input: draft?.input ?? "",
                      inputUnit: nextUnit,
                      status: draft?.status === "saved" ? "idle" : (draft?.status ?? "idle"),
                    },
                  }));
                }}
                onBlur={(input) => {
                  const current = drafts[line.ingredientId];
                  if (
                    current?.status === "saved" &&
                    current.input === input &&
                    current.inputUnit === inputUnit
                  ) {
                    return;
                  }
                  if (
                    input.trim() === "" &&
                    line.actualQty === null
                  ) {
                    return;
                  }
                  void handleSaveLine(line, input, inputUnit);
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

function LineRow({
  line,
  draft,
  inputUnit,
  onChange,
  onUnitChange,
  onBlur,
}: {
  line: OpnameLineWithIngredient;
  draft: LineDraft | undefined;
  inputUnit: string;
  onChange: (raw: string) => void;
  onUnitChange: (nextUnit: string) => void;
  onBlur: (raw: string) => void;
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

  /* Sesi AE-130 — extend ingredientPacks dengan tier labels (tracking +
   * belanja) supaya staff bisa pilih label "Kotak"/"Karung"/"L" di
   * unit picker tanpa harus duplicate ke packConversions JSONB. */
  const basePacks = (line.ingredient.packConversions ??
    null) as IngredientPackConversion[] | null;
  const tierPacks: IngredientPackConversion[] = [];
  if (
    line.ingredient.unitTracking &&
    line.ingredient.unitTrackingPerCogs
  ) {
    const per = parseFloat(line.ingredient.unitTrackingPerCogs);
    if (Number.isFinite(per) && per > 0) {
      tierPacks.push({
        unitLabel: line.ingredient.unitTracking,
        qtyPerBase: per,
      });
    }
  }
  if (line.ingredient.unitBelanja && line.ingredient.unitBelanjaPerCogs) {
    const per = parseFloat(line.ingredient.unitBelanjaPerCogs);
    if (Number.isFinite(per) && per > 0) {
      tierPacks.push({
        unitLabel: line.ingredient.unitBelanja,
        qtyPerBase: per,
      });
    }
  }
  const ingredientPacks: IngredientPackConversion[] | null = (() => {
    const merged: IngredientPackConversion[] = [];
    const seen = new Set<string>();
    for (const p of basePacks ?? []) {
      const lc = p.unitLabel.trim().toLowerCase();
      if (!lc || seen.has(lc)) continue;
      seen.add(lc);
      merged.push(p);
    }
    for (const p of tierPacks) {
      const lc = p.unitLabel.trim().toLowerCase();
      if (!lc || seen.has(lc)) continue;
      seen.add(lc);
      merged.push(p);
    }
    return merged.length > 0 ? merged : null;
  })();

  let convertedToMaster: number | null = parsedActual;
  if (parsedActual !== null && inputUnit !== masterUnit) {
    const r = convertQtyWithIngredientPacks(
      parsedActual,
      inputUnit,
      masterUnit,
      ingredientPacks,
    );
    convertedToMaster = r.qtyMaster;
  }
  const diff =
    convertedToMaster !== null
      ? convertedToMaster - expectedQtyValue
      : null;

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

  // Sesi AE-62y — unit options include ingredient pack alternatives.
  // Untuk ingredient yang punya pack mapping (mis. "packs" 20 pcs untuk
  // Lychee Kaleng), picker exposed walaupun master discrete. Tanpa pack
  // alternatives + master discrete → picker disabled (fallback ke master only).
  const unitOptions = compatibleUnitsFor(masterUnit, ingredientPacks);
  const masterMeta = resolveUnit(masterUnit);
  const hasPackAlternatives =
    ingredientPacks !== null && ingredientPacks.length > 0;
  const canPickUnit =
    unitOptions.length > 1 &&
    (hasPackAlternatives ||
      (masterMeta !== null && masterMeta.dimension !== "discrete"));

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
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">
            {line.ingredient.name}
          </p>
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
          onBlur={(e) => onBlur(e.target.value)}
          placeholder="0"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-mono tabular-nums text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
        />
        {canPickUnit ? (
          <select
            value={inputUnit}
            onChange={(e) => onUnitChange(e.target.value)}
            onBlur={() => onBlur(inputValue)}
            className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm font-medium text-neutral-900 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
            aria-label={`Satuan ${line.ingredient.name}`}
          >
            {unitOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex shrink-0 items-center px-2 text-sm font-medium text-neutral-700">
            {masterUnit}
          </span>
        )}
      </div>
      {/* Auto-convert preview — staff lihat hasil conversion sebelum save. */}
      {parsedActual !== null &&
      inputUnit !== masterUnit &&
      convertedToMaster !== null ? (
        <p className="mt-1 text-[11px] text-neutral-600">
          ={" "}
          <span className="font-mono">{fmt(convertedToMaster)}</span>{" "}
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
 * — konversi di-handle di handleSaveLine via convertQtyWithIngredientPacks.
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
