"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  Select,
  toast,
} from "@/components/ui";
import {
  computeDiffStats,
  computeHppPerSection,
  getOpnameInventoryFlow,
  isOk,
  saveOpnameCount,
  submitOpname,
  type HppEstimateRowInput,
  type IngredientSection,
  type OpnameInventoryFlowSerialized,
  type OpnameSessionDetail,
} from "@/features/stock-opname";
import { hasPermission } from "@/lib/auth/rbac";
import type { Role } from "@/lib/auth/rbac";
import { downloadCountSheet } from "./opname-csv";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EditUnitModal } from "./EditUnitModal";
import { AddOpnameItemModal } from "./AddOpnameItemModal";
import {
  buildOpnameUnitContext,
  computeOpnameQtyFromSplit,
  type IngredientPackConversion,
  type OpnameUnitContext,
} from "@/lib/unit-conversion";

interface OpnameCountViewProps {
  detail: OpnameSessionDetail;
  role: Role;
  onCancel: () => void;
  onChanged: () => void;
  onSubmittedForReview: () => void;
}

/**
 * Sesi AE-147 — split input model. Staff input qty dalam 2 field:
 *  - `primary` (string + unit) — qty "penuh" dalam unit yang dipilih
 *    (default = Purchase Unit kalau ada, else Recipe Unit).
 *  - `loose` (string, recipe unit only) — qty "sisa lepas" optional,
 *    dipakai untuk discrete pack (mis. Yakult: 3 pack + 2 pcs lepas).
 *
 * Server selalu terima qty in recipe (master) unit. UI compute via
 * `computeOpnameQtyFromSplit` sebelum saveOpnameCount.
 */
type LineState = {
  primaryInput: string;
  primaryUnit: string;
  /** Optional second input dalam recipe unit. "" = tidak diisi. */
  looseInput: string;
  /** Last persisted value (in recipe unit) — null means uncounted. */
  saved: number | null;
  status: "idle" | "saving" | "saved" | "error";
  errorMsg?: string;
};

const SAVE_DEBOUNCE_MS = 700;
const SAVED_TOAST_TTL_MS = 1500;

// Section grouping (sesi Z #2). Order is the operational order tim usually
// hitung di lapangan: Bar dulu (gampang dihitung, sedikit), Kitchen, lalu
// supplies. "Belum diset" disurface terakhir agar Owner sadar perlu
// klasifikasi via Admin → Inventory.
type SectionFilter = IngredientSection | "all" | "unassigned";

const SECTION_TABS: Array<{ value: SectionFilter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "bar", label: "Bar" },
  { value: "kitchen", label: "Kitchen" },
  { value: "cleaning", label: "Cleaning" },
  { value: "supporting", label: "Supporting" },
  { value: "unassigned", label: "Belum diset" },
];

function sectionKey(s: IngredientSection | null): SectionFilter {
  return s ?? "unassigned";
}

export function OpnameCountView({
  detail,
  role,
  onCancel,
  onChanged,
  onSubmittedForReview,
}: OpnameCountViewProps) {
  const canCancel = hasPermission(role, "inventory.opname.cancel");
  const canEditUnit = hasPermission(role, "inventory.ingredient.update");
  const canAddItem = hasPermission(role, "inventory.opname.add_item");
  const [editUnitFor, setEditUnitFor] = useState<{
    id: string;
    name: string;
    unit: string;
    /** Sesi AE-62y — current pack conversions (jsonb dari ingredients). */
    packConversions: Array<{ unitLabel: string; qtyPerBase: number }> | null;
  } | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);

  // Map of ingredientId → state. Re-init when session id changes (rare).
  // Sesi AE-147 — overlay localStorage draft di atas server initialState
  // supaya in-flight typing yang belum tersave ke server tetap utuh saat
  // user kembali ke halaman opname.
  const [stateMap, setStateMap] = useState<Map<string, LineState>>(() =>
    mergeDraftIntoState(detail, readDraft(detail.id)),
  );

  // Optimistic unit overrides — populated when EditUnitModal saves so the
  // CountRow updates instantly without waiting for the parent's silent
  // refresh round-trip (sesi AA hotfix #2: even though server-side updates
  // unitSnapshot for in_progress sessions, parent re-fetch had a race
  // window where stale detail re-rendered before the new query landed).
  const [unitOverrides, setUnitOverrides] = useState<Map<string, string>>(
    () => new Map(),
  );
  // Reset overrides when session changes (new session = new snapshots).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setUnitOverrides(new Map());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [detail.id]);
  // If detail prop changes (e.g. parent refreshes after cancel), reseed.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setStateMap(mergeDraftIntoState(detail, readDraft(detail.id)));
    /* eslint-enable react-hooks/set-state-in-effect */
    // We intentionally re-init only when the session id changes — when the
    // parent refresh just bumps line counts but session is the same, we
    // don't want to overwrite the user's in-flight typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  /* Sesi AE-147 — Auto-save draft ke localStorage on every stateMap change,
   * debounced 400ms. Key namespaced per sessionId. Restored on remount.
   * Purged when session completes/cancels (handled via parent on transition). */
  const draftSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      writeDraft(detail.id, stateMap);
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [detail.id, stateMap]);

  const [search, setSearch] = useState("");
  const [showOnlyUncounted, setShowOnlyUncounted] = useState(false);
  const [revealExpected, setRevealExpected] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>("all");

  // Inventory flow per ingredient (Stok Awal + Pembelian) for the active
  // window. Reuses HPP report's underlying helpers so opname view ↔ HPP
  // report ↔ accounting auto-journal stay 100% konsisten. Sesi AA #1.
  const [flow, setFlow] = useState<OpnameInventoryFlowSerialized | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    /* Sesi AE-62ag — reset flow ke null saat session id berubah supaya
     * UI tidak briefly show stale prior-session data sebelum fetch baru
     * landing. Pre-fix: flow tetap di nilai lama → FlowMetric tampil number
     * misleading di transition antara sessions. */
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setFlow(null);
    void (async () => {
      const res = await getOpnameInventoryFlow(detail.id);
      if (cancelled) return;
      if (isOk(res)) setFlow(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitMode, setSubmitMode] = useState<"strict" | "fill">("strict");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const timersRef = useRef<Map<string, number>>(new Map());

  // Cleanup timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return detail.lines.filter((l) => {
      if (
        sectionFilter !== "all" &&
        sectionKey(l.ingredient.section) !== sectionFilter
      ) {
        return false;
      }
      if (q && !l.ingredientNameSnapshot.toLowerCase().includes(q)) {
        return false;
      }
      if (showOnlyUncounted) {
        const s = stateMap.get(l.ingredientId);
        if (s && s.saved !== null) return false;
      }
      return true;
    });
  }, [detail.lines, search, showOnlyUncounted, stateMap, sectionFilter]);

  // Per-section progress (counted / total) so each tab can render a hint
  // like "Bar 5/12" — helps tim track which section masih outstanding.
  const sectionProgress = useMemo(() => {
    const map = new Map<SectionFilter, { counted: number; total: number }>();
    for (const l of detail.lines) {
      const key = sectionKey(l.ingredient.section);
      const cur = map.get(key) ?? { counted: 0, total: 0 };
      cur.total += 1;
      if ((stateMap.get(l.ingredientId)?.saved ?? null) !== null) {
        cur.counted += 1;
      }
      map.set(key, cur);
    }
    return map;
  }, [detail.lines, stateMap]);

  const stats = useMemo(() => {
    const lines = detail.lines.map((l) => {
      const s = stateMap.get(l.ingredientId);
      const savedOverride = s ? s.saved : null;
      return {
        expectedQty: l.expectedQty,
        expectedQtyDecimal: l.expectedQtyDecimal,
        actualQty: s ? s.saved : l.actualQty,
        // Sesi AE-62e — saat staff baru ngetik (sebelum server save),
        // overlay saved value ke decimal supaya preview diff accurate
        // walau bigint expected sudah di-clamp ke 0 (negative-stock case).
        actualQtyDecimal:
          savedOverride !== null
            ? savedOverride.toFixed(4)
            : l.actualQtyDecimal,
        unitCostAtSnapshot: l.unitCostAtSnapshot,
      };
    });
    return computeDiffStats(lines);
  }, [detail.lines, stateMap]);

  const progressPct =
    stats.totalLines === 0
      ? 0
      : Math.round((stats.countedLines / stats.totalLines) * 100);

  // Per-section HPP estimate (sesi AA #1) — sum of (used × unitCost)
  // grouped by section, mapped to Owner's P&L accounts. Uses pure helper
  // so the math is testable + reusable.
  const hppEstimate = useMemo(() => {
    if (!flow) return null;
    const rows: HppEstimateRowInput[] = detail.lines.map((l) => {
      const f = flow.perIngredient[l.ingredientId];
      const closing = stateMap.get(l.ingredientId)?.saved ?? null;
      return {
        section: l.ingredient.section,
        openingQty: f?.openingQty ?? 0,
        openingUnitCost: f?.openingUnitCost ?? l.unitCostAtSnapshot,
        purchasesCost: f?.purchasesCost ?? 0,
        closingQty: closing,
        closingUnitCost: l.unitCostAtSnapshot,
      };
    });
    return computeHppPerSection(rows);
  }, [detail.lines, flow, stateMap]);

  /* Sesi AE-147 — Unit context dipre-compute per ingredient supaya
   * scheduleSave dan persistLine bisa reuse tanpa rebuild tiap keystroke. */
  const ctxMap = useMemo(() => {
    const m = new Map<string, OpnameUnitContext>();
    for (const line of detail.lines) {
      const effectiveUnit = unitOverrides.get(line.ingredientId) ?? line.unitSnapshot;
      m.set(
        line.ingredientId,
        buildOpnameUnitContext({
          recipeUnit: effectiveUnit,
          unitBelanja: line.ingredient.unitBelanja,
          unitBelanjaPerCogs: line.ingredient.unitBelanjaPerCogs,
          packConversions:
            (line.ingredient.packConversions ??
              null) as IngredientPackConversion[] | null,
        }),
      );
    }
    return m;
  }, [detail.lines, unitOverrides]);

  /** Schedule debounced save dari current state (split-aware). */
  function scheduleSaveFromState(ingredientId: string) {
    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId);
      if (!cur) return prev;
      next.set(ingredientId, { ...cur, status: "saving" });
      return next;
    });
    const existing = timersRef.current.get(ingredientId);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      void persistLine(ingredientId);
    }, SAVE_DEBOUNCE_MS);
    timersRef.current.set(ingredientId, t);
  }

  function setPrimaryInput(ingredientId: string, raw: string) {
    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId) ?? blankLineState();
      next.set(ingredientId, { ...cur, primaryInput: raw });
      return next;
    });
    scheduleSaveFromState(ingredientId);
  }

  function setLooseInput(ingredientId: string, raw: string) {
    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId) ?? blankLineState();
      next.set(ingredientId, { ...cur, looseInput: raw });
      return next;
    });
    scheduleSaveFromState(ingredientId);
  }

  function setPrimaryUnit(ingredientId: string, nextUnit: string) {
    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId) ?? blankLineState(nextUnit);
      next.set(ingredientId, { ...cur, primaryUnit: nextUnit });
      return next;
    });
    /* Re-trigger save kalau sudah ada qty input — interpretasi berubah. */
    const cur = stateMap.get(ingredientId);
    if (
      cur &&
      (cur.primaryInput.trim().length > 0 || cur.looseInput.trim().length > 0)
    ) {
      scheduleSaveFromState(ingredientId);
    }
  }

  /** Parse Indonesian decimal — accept koma atau titik sebagai pemisah. */
  function parseQtyInput(raw: string): number | null | "invalid" {
    const t = raw.trim().replace(",", ".");
    if (t === "") return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n < 0) return "invalid";
    return n;
  }

  async function persistLine(ingredientId: string) {
    const cur = stateMap.get(ingredientId);
    if (!cur) return;
    const ctx = ctxMap.get(ingredientId);
    if (!ctx) return;

    const primaryParsed = parseQtyInput(cur.primaryInput);
    const looseParsed = parseQtyInput(cur.looseInput);

    if (primaryParsed === "invalid" || looseParsed === "invalid") {
      setStateMap((prev) => {
        const next = new Map(prev);
        const c = next.get(ingredientId);
        if (!c) return prev;
        next.set(ingredientId, {
          ...c,
          status: "error",
          errorMsg: "Angka tidak valid",
        });
        return next;
      });
      return;
    }

    const actualQty = computeOpnameQtyFromSplit({
      primaryQty: primaryParsed,
      primaryUnit: cur.primaryUnit,
      looseQtyRecipe: looseParsed,
      context: ctx,
    });

    /* Validate: kalau ada input tapi convert fail → unit unknown. */
    if (
      actualQty === null &&
      (primaryParsed !== null || looseParsed !== null)
    ) {
      setStateMap((prev) => {
        const next = new Map(prev);
        const c = next.get(ingredientId);
        if (!c) return prev;
        next.set(ingredientId, {
          ...c,
          status: "error",
          errorMsg: `Gagal konversi ${cur.primaryUnit} → ${ctx.recipeUnit}`,
        });
        return next;
      });
      return;
    }

    const res = await saveOpnameCount({
      sessionId: detail.id,
      ingredientId,
      actualQty,
      note: null,
    });

    setStateMap((prev) => {
      const next = new Map(prev);
      const c = next.get(ingredientId) ?? blankLineState(cur.primaryUnit);
      if (!isOk(res)) {
        next.set(ingredientId, {
          ...c,
          status: "error",
          errorMsg: res.error.message,
        });
        return next;
      }
      next.set(ingredientId, { ...c, saved: actualQty, status: "saved" });
      return next;
    });

    window.setTimeout(() => {
      setStateMap((prev) => {
        const next = new Map(prev);
        const c = next.get(ingredientId);
        if (!c || c.status !== "saved") return prev;
        next.set(ingredientId, { ...c, status: "idle" });
        return next;
      });
    }, SAVED_TOAST_TTL_MS);
  }

  async function onSubmitSession() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitErr(null);
    const res = await submitOpname({
      sessionId: detail.id,
      treatUncountedAsExpected: submitMode === "fill",
    });
    setSubmitting(false);
    if (!isOk(res)) {
      if (res.error.code === "UNCOUNTED") {
        setSubmitMode("fill");
        setSubmitErr(res.error.message);
        return;
      }
      setSubmitErr(res.error.message);
      return;
    }
    toast.success(
      "Opname disubmit untuk review. Tunggu manager untuk finalize.",
    );
    /* Sesi AE-147 — draft sudah committed ke server, hapus dari localStorage
     * supaya tidak rehydrate stale data kalau owner reopen session. */
    clearDraft(detail.id);
    setSubmitOpen(false);
    onSubmittedForReview();
  }

  function onPrintCountSheet() {
    downloadCountSheet(detail.periodLabel, detail.lines);
    toast.success("Lembar hitung di-download. Print dari Excel/Google Sheets.");
  }

  return (
    <div className="space-y-4">
      <Card className="border-mahakan-green-700/30 bg-mahakan-green-100/20">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-mahakan-green-900">
                Opname {detail.periodLabel}
              </h2>
              <p className="text-xs text-neutral-600">
                Mulai{" "}
                {new Date(detail.startedAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                oleh {detail.startedByName ?? "—"}
              </p>
            </div>
            <Badge variant="info">Sedang berjalan</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-1">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-neutral-900">
                Progress: {stats.countedLines} / {stats.totalLines}
              </span>
              <span className="font-mono text-mahakan-green-900">
                {progressPct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full bg-mahakan-green-700 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-neutral-500">
              {stats.uncountedLines} bahan belum dihitung. Input bisa
              di-pause kapan aja — hasil tersimpan otomatis tiap kamu
              mengetik.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setSubmitOpen(true)}
              disabled={stats.countedLines === 0}
            >
              <CheckCircle2 className="size-4" aria-hidden /> Submit untuk
              Review
            </Button>
            {canAddItem ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddItemOpen(true)}
                className="text-mahakan-green-700"
              >
                <Plus className="size-4" aria-hidden /> Tambah Bahan Baru
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onPrintCountSheet}>
              <Download className="size-4" aria-hidden /> Lembar Hitung
              (CSV)
            </Button>
            {canCancel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
                className="ml-auto text-danger-500 hover:bg-danger-100"
              >
                <X className="size-4" aria-hidden /> Cancel Sesi
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {hppEstimate && hppEstimate.bySection.length > 0 ? (
        <Card className="border-mahakan-green-700/20">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-900">
                Estimasi HPP Periode Ini
              </h3>
              <p className="text-[11px] text-neutral-500">
                Periode {flow?.windowFrom} → {flow?.windowTo}
                {!flow?.hasPriorOpname ? (
                  <span className="ml-1.5 text-warning-500">
                    · belum ada opname sebelumnya, Stok Awal = 0
                  </span>
                ) : null}
              </p>
            </div>
            <p className="text-[11px] text-neutral-500">
              Formula: Stok Awal + Pembelian − Opname (input kamu) ×
              cost. Angka ini yang akan tercatat sebagai HPP di Laporan
              Laba Rugi setelah opname di-finalize.
            </p>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <ul className="divide-y divide-neutral-100">
              {hppEstimate.bySection.map((sec) => (
                <li
                  key={sec.pnlLabel}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900 truncate">
                      {sec.pnlLabel}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {sec.lineCount} bahan
                    </p>
                  </div>
                  <span
                    className={cn(
                      "font-mono font-semibold tabular-nums",
                      sec.hppCost < 0
                        ? "text-danger-500"
                        : sec.hppCost === 0
                          ? "text-neutral-400"
                          : "text-neutral-900",
                    )}
                  >
                    {formatRupiah(sec.hppCost)}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-semibold text-neutral-900">
                  Total Estimasi HPP
                </span>
                <span
                  className={cn(
                    "font-mono text-base font-bold tabular-nums",
                    hppEstimate.grandTotal < 0
                      ? "text-danger-500"
                      : "text-mahakan-green-900",
                  )}
                >
                  {formatRupiah(hppEstimate.grandTotal)}
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-3 pb-2">
          <div
            role="tablist"
            aria-label="Filter section"
            className="flex flex-wrap gap-1.5"
          >
            {SECTION_TABS.map((t) => {
              const p = sectionProgress.get(t.value);
              const isAll = t.value === "all";
              const counted = isAll
                ? stats.countedLines
                : (p?.counted ?? 0);
              const total = isAll ? stats.totalLines : (p?.total ?? 0);
              if (!isAll && total === 0) return null;
              const active = sectionFilter === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSectionFilter(t.value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                    active
                      ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : counted === total && total > 0
                          ? "bg-mahakan-green-100 text-mahakan-green-900"
                          : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    {counted}/{total}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <Input
                label="Cari bahan"
                placeholder="mis. susu, espresso, cup"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leadingIcon={<Search className="size-4" aria-hidden />}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={showOnlyUncounted}
                onChange={(e) => setShowOnlyUncounted(e.target.checked)}
                className="size-4 rounded border-neutral-300 text-mahakan-green-700 focus:ring-mahakan-green-700"
              />
              Belum dihitung saja
            </label>
            <button
              type="button"
              onClick={() => setRevealExpected((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs",
                revealExpected
                  ? "border-warning-500 bg-warning-100/40 text-warning-500"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
              )}
              title={
                revealExpected
                  ? "Sembunyikan stok sistem agar input objektif"
                  : "Tampilkan stok sistem (tidak disarankan saat menghitung)"
              }
            >
              {revealExpected ? (
                <Eye className="size-3.5" aria-hidden />
              ) : (
                <EyeOff className="size-3.5" aria-hidden />
              )}
              {revealExpected ? "Tampil expected" : "Sembunyikan expected"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {filteredLines.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              {search || showOnlyUncounted || sectionFilter !== "all"
                ? "Tidak ada bahan cocok dengan filter."
                : "Tidak ada bahan untuk di-opname."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {filteredLines.map((line) => {
                const f = flow?.perIngredient[line.ingredientId];
                const effectiveUnit =
                  unitOverrides.get(line.ingredientId) ?? line.unitSnapshot;
                const ctx =
                  ctxMap.get(line.ingredientId) ??
                  buildOpnameUnitContext({ recipeUnit: effectiveUnit });
                return (
                  <CountRow
                    key={line.id}
                    ingredientId={line.ingredientId}
                    name={line.ingredientNameSnapshot}
                    ctx={ctx}
                    expectedQty={
                      /* Sesi AE-62e — prefer decimal (real value, mungkin
                       * negative dari oversold). Bigint di-clamp 0 untuk
                       * pass check constraint. */
                      line.expectedQtyDecimal !== null
                        ? parseFloat(line.expectedQtyDecimal)
                        : line.expectedQty
                    }
                    openingQty={f?.openingQty ?? 0}
                    purchasesQty={f?.purchasesQty ?? 0}
                    unitCost={line.unitCostAtSnapshot}
                    flowLoaded={flow !== null}
                    hasPriorOpname={flow?.hasPriorOpname ?? false}
                    state={
                      stateMap.get(line.ingredientId) ??
                      blankLineState(ctx.defaultUnit)
                    }
                    revealExpected={revealExpected}
                    onPrimaryChange={(raw) =>
                      setPrimaryInput(line.ingredientId, raw)
                    }
                    onLooseChange={(raw) =>
                      setLooseInput(line.ingredientId, raw)
                    }
                    onUnitChange={(next) =>
                      setPrimaryUnit(line.ingredientId, next)
                    }
                    onEditUnit={
                      canEditUnit
                        ? () =>
                            setEditUnitFor({
                              id: line.ingredientId,
                              name: line.ingredientNameSnapshot,
                              unit: effectiveUnit,
                              packConversions:
                                line.ingredient.packConversions ?? null,
                            })
                        : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit opname untuk review?"
        description="Setelah disubmit, sesi terkunci dan menunggu manager untuk finalize. Manager bisa reopen kalau perlu revisi."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setSubmitOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={onSubmitSession} loading={submitting}>
              Submit
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Sudah dihitung" value={`${stats.countedLines}`} />
            <Stat label="Belum dihitung" value={`${stats.uncountedLines}`} />
            <Stat label="Sesuai" value={`${stats.matchingLines}`} />
            <Stat
              label="Selisih"
              value={`${stats.surplusLines + stats.shortageLines}`}
            />
          </div>
          {stats.uncountedLines > 0 ? (
            <div className="space-y-2 rounded-md border border-warning-500/40 bg-warning-100/30 p-3 text-xs">
              <p className="font-medium text-warning-500">
                <AlertCircle className="mr-1 inline size-3.5" aria-hidden />{" "}
                {stats.uncountedLines} bahan belum dihitung
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="submit-mode"
                  checked={submitMode === "strict"}
                  onChange={() => setSubmitMode("strict")}
                  className="mt-0.5"
                />
                <span>
                  <strong>Lengkapi dulu</strong> — kembali ke form untuk
                  hitung sisanya.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="submit-mode"
                  checked={submitMode === "fill"}
                  onChange={() => setSubmitMode("fill")}
                  className="mt-0.5"
                />
                <span>
                  <strong>Anggap sesuai expected</strong> — bahan yang
                  belum dihitung dianggap stoknya tepat (selisih = 0).
                  Cocok kalau sebagian bahan udah pasti tidak berubah.
                </span>
              </label>
            </div>
          ) : null}
          {submitErr ? (
            <p className="rounded-md bg-danger-100 p-2 text-xs text-danger-500">
              {submitErr}
            </p>
          ) : null}
        </div>
      </Modal>

      {editUnitFor ? (
        <EditUnitModal
          open
          onClose={() => setEditUnitFor(null)}
          ingredientId={editUnitFor.id}
          ingredientName={editUnitFor.name}
          currentUnit={editUnitFor.unit}
          currentPackConversions={editUnitFor.packConversions ?? null}
          onSaved={(newUnit) => {
            // Optimistic UI: push override so the row updates instantly,
            // independent of when the parent's silent refetch completes.
            // Server-side updateIngredient already updates ingredient.unit
            // AND stockOpnameLines.unitSnapshot for in_progress sessions
            // atomically (sesi AA backend fix).
            const ingId = editUnitFor.id;
            setUnitOverrides((prev) => {
              const next = new Map(prev);
              next.set(ingId, newUnit);
              return next;
            });
            setEditUnitFor(null);
            // Still trigger parent refresh so HppEstimate + history reflect
            // the new unit AND new packConversions on next render. The
            // override hides the race for unit; packConversions tampak
            // setelah refresh next.
            onChanged();
          }}
        />
      ) : null}

      <AddOpnameItemModal
        open={addItemOpen}
        sessionId={detail.id}
        onClose={() => setAddItemOpen(false)}
        onAdded={() => {
          setAddItemOpen(false);
          // Parent refetch the detail untuk pick up new line dari server.
          onChanged();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-50 p-2">
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="font-mono text-base font-semibold text-neutral-900">
        {value}
      </p>
    </div>
  );
}

interface CountRowProps {
  ingredientId: string;
  name: string;
  /** Sesi AE-147 — unit context (purchase/recipe/pack alts + conversion).
   *  Recipe unit terbaca dari ctx.recipeUnit; tidak perlu prop terpisah. */
  ctx: OpnameUnitContext;
  expectedQty: number;
  openingQty: number;
  purchasesQty: number;
  unitCost: number;
  flowLoaded: boolean;
  hasPriorOpname: boolean;
  state: LineState;
  revealExpected: boolean;
  onPrimaryChange: (raw: string) => void;
  onLooseChange: (raw: string) => void;
  onUnitChange: (nextUnit: string) => void;
  onEditUnit?: () => void;
}

function CountRow({
  ingredientId,
  name,
  ctx,
  expectedQty,
  openingQty,
  purchasesQty,
  unitCost,
  flowLoaded,
  hasPriorOpname,
  state,
  revealExpected,
  onPrimaryChange,
  onLooseChange,
  onUnitChange,
  onEditUnit,
}: CountRowProps) {
  const counted = state.saved !== null;
  const diff = state.saved !== null ? state.saved - expectedQty : null;
  const closingQty = state.saved ?? null;
  const usedQty =
    closingQty === null ? null : openingQty + purchasesQty - closingQty;
  const usedCost = usedQty === null ? null : usedQty * unitCost;
  const usedTone =
    usedQty === null
      ? "neutral"
      : usedQty < 0
        ? "danger"
        : usedQty === 0
          ? "warning"
          : "ok";

  const currentPrimaryUnit = state.primaryUnit || ctx.defaultUnit;
  const canPickUnit = ctx.options.length > 1;
  /* "Sisa lepas" hanya muncul kalau primary unit beda dari recipe AND
   * conversion > 1. Continuous unit (kg → g) tetap support tapi staff
   * jarang pakai (1,5 kg cukup); kita tetap allow untuk uniformity. */
  const showLooseField =
    ctx.supportsSplitInput && currentPrimaryUnit !== ctx.recipeUnit;

  /* Live total preview pakai existing computeOpnameQtyFromSplit logic.
   * Parse Indonesian (koma) jadi number; null kalau kosong. */
  const primaryRaw = state.primaryInput.trim().replace(",", ".");
  const looseRaw = state.looseInput.trim().replace(",", ".");
  const primaryNum = primaryRaw === "" ? null : parseFloat(primaryRaw);
  const looseNum = looseRaw === "" ? null : parseFloat(looseRaw);
  const showTotalPreview =
    (Number.isFinite(primaryNum) && (primaryNum as number) > 0) ||
    (Number.isFinite(looseNum) && (looseNum as number) > 0);
  let totalPreview: number | null = null;
  if (showTotalPreview) {
    totalPreview = computeOpnameQtyFromSplit({
      primaryQty: Number.isFinite(primaryNum) ? (primaryNum as number) : null,
      primaryUnit: currentPrimaryUnit,
      looseQtyRecipe: Number.isFinite(looseNum) ? (looseNum as number) : null,
      context: ctx,
    });
  }

  /* Sesi AE-148 — Polish: info chips dengan warna + icon untuk hierarchy
   * visual yang lebih jelas. Resep = neutral, Belanja = green pill, Pack
   * alt = blue pill. */
  const purchaseMultiplier =
    ctx.purchaseUnit !== null
      ? (ctx.multipliers.get(ctx.purchaseUnit) ?? 1)
      : null;
  const packAlts = ctx.options.filter((o) => o.source === "pack-alt");

  return (
    <li className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-neutral-50/40 sm:flex-row sm:items-start sm:gap-5">
      {/* LEFT: status + name + chips + flow */}
      <div className="flex flex-1 items-start gap-3 min-w-0">
        <div
          className={cn(
            "mt-1 flex size-7 flex-none items-center justify-center rounded-full text-xs font-bold",
            counted
              ? "bg-mahakan-green-700 text-white"
              : "bg-neutral-200 text-neutral-500",
          )}
          aria-hidden
        >
          {counted ? <Check className="size-4" /> : "—"}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {/* Row 1: name + edit button */}
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-neutral-900 truncate">
              {name}
            </p>
            {onEditUnit ? (
              <button
                type="button"
                onClick={onEditUnit}
                className="flex-none inline-flex items-center rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-mahakan-green-700"
                aria-label={`Edit unit ${name}`}
                title="Edit satuan bahan + konversi"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
          </div>

          {/* Row 2: unit info chips */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
              Resep:&nbsp;<span className="font-semibold">{ctx.recipeUnit}</span>
            </span>
            {ctx.purchaseUnit && purchaseMultiplier !== null ? (
              <span className="inline-flex items-center rounded bg-mahakan-green-100/70 px-1.5 py-0.5 font-medium text-mahakan-green-900">
                Belanja:&nbsp;
                <span className="font-semibold">
                  1 {ctx.purchaseUnit} = {formatRatioForChip(purchaseMultiplier)}{" "}
                  {ctx.recipeUnit}
                </span>
              </span>
            ) : null}
            {packAlts.map((alt) => (
              <span
                key={alt.value}
                className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-900"
              >
                Pack:&nbsp;
                <span className="font-semibold">
                  1 {alt.value} = {formatRatioForChip(alt.multiplierToRecipe)}{" "}
                  {ctx.recipeUnit}
                </span>
              </span>
            ))}
            {revealExpected ? (
              <>
                <span className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 font-mono font-medium text-amber-900">
                  Expected: {expectedQty.toLocaleString("id-ID")}{" "}
                  {ctx.recipeUnit}
                </span>
                {diff !== null ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 font-mono font-medium",
                      diff === 0
                        ? "bg-mahakan-green-100 text-mahakan-green-900"
                        : diff > 0
                          ? "bg-success-100 text-success-500"
                          : "bg-danger-100 text-danger-500",
                    )}
                  >
                    {diff === 0
                      ? "sesuai"
                      : `${diff > 0 ? "+" : ""}${diff.toLocaleString("id-ID")}`}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Row 3: inventory flow (Stok Awal → Opname → Terpakai) */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] tabular-nums">
            {!flowLoaded ? (
              <span className="text-neutral-400">memuat data alur…</span>
            ) : (
              <>
                <FlowMetric
                  label="Stok Awal"
                  value={openingQty}
                  unit={ctx.recipeUnit}
                  hint={
                    hasPriorOpname
                      ? "Dari opname sebelumnya"
                      : "Estimasi — belum ada opname sebelumnya"
                  }
                  warn={!hasPriorOpname}
                />
                <FlowMetric
                  label="Pembelian"
                  value={purchasesQty}
                  unit={ctx.recipeUnit}
                  hint="Total pembelian sejak opname terakhir"
                />
                <FlowMetric
                  label="Opname"
                  value={closingQty}
                  unit={ctx.recipeUnit}
                  placeholder="—"
                  hint="Stok akhir hasil hitung kamu"
                  emphasized
                />
                <span
                  className={cn(
                    "font-medium",
                    usedTone === "danger" && "text-danger-500",
                    usedTone === "warning" && "text-warning-500",
                    usedTone === "ok" && "text-mahakan-green-900",
                    usedTone === "neutral" && "text-neutral-400",
                  )}
                  title={
                    usedQty === null
                      ? "Isi opname dulu untuk hitung pemakaian"
                      : usedQty < 0
                        ? "Anomali — opname > (awal + beli). Cek pembelian belum dicatat?"
                        : usedQty === 0
                          ? "Tidak ada pemakaian — verifikasi"
                          : "Pemakaian periode ini"
                  }
                >
                  <span className="text-neutral-500">Terpakai:</span>{" "}
                  {usedQty === null
                    ? "—"
                    : `${usedQty.toLocaleString("id-ID")} ${ctx.recipeUnit}`}
                  {usedCost !== null && unitCost > 0 ? (
                    <span className="ml-1 text-neutral-500">
                      ({formatRupiah(usedCost)})
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: input zone */}
      <div className="flex flex-col gap-1.5 sm:w-[320px] sm:flex-none">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          Hitung stok aktual
        </p>
        <div className="flex items-stretch gap-2">
          <input
            aria-label={`Qty aktual ${name}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={state.primaryInput}
            onChange={(e) => onPrimaryChange(e.target.value)}
            className={cn(
              "h-12 flex-1 rounded-md border bg-white px-3 text-right font-mono text-lg tabular-nums shadow-sm transition focus:outline-none focus:ring-2",
              state.status === "error"
                ? "border-danger-500 focus:ring-danger-500"
                : "border-neutral-300 focus:border-mahakan-green-700 focus:ring-mahakan-green-700/40",
            )}
            data-testid={`count-input-${ingredientId}`}
          />
          {canPickUnit ? (
            <div className="w-[96px] flex-none">
              <Select
                size="md"
                ariaLabel={`Satuan ${name}`}
                options={ctx.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                  hint: o.hint ?? undefined,
                }))}
                value={currentPrimaryUnit}
                onValueChange={onUnitChange}
                className="h-12"
              />
            </div>
          ) : (
            <span className="flex h-12 w-[60px] flex-none items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-sm font-medium text-neutral-700">
              {ctx.recipeUnit}
            </span>
          )}
          <div
            className="flex w-5 flex-none items-center justify-center"
            aria-live="polite"
          >
            {state.status === "saving" ? (
              <Loader2
                className="size-4 animate-spin text-neutral-400"
                aria-label="Menyimpan"
              />
            ) : state.status === "saved" ? (
              <Check
                className="size-5 text-mahakan-green-700"
                aria-label="Tersimpan"
              />
            ) : state.status === "error" ? (
              <AlertCircle
                className="size-5 text-danger-500"
                aria-label="Gagal"
              />
            ) : null}
          </div>
        </div>

        {/* Sesi AE-173 — tandai kosong/habis: set actual=0 supaya TETAP tercatat
            sudah diopname walau stoknya nol (bukan "belum dihitung"). */}
        <button
          type="button"
          onClick={() => {
            onLooseChange("");
            onPrimaryChange("0");
          }}
          className="self-end rounded text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-mahakan-green-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40"
        >
          Tandai kosong / habis (0)
        </button>

        {/* Loose input — only when primary unit != recipe AND ratio > 1.
            Pakai untuk kasus pack tidak full (Yakult 3 pack + 2 pcs lepas). */}
        {showLooseField ? (
          <div className="flex items-stretch gap-2">
            <span className="flex h-9 flex-none items-center px-1 text-[11px] font-medium text-neutral-500">
              + sisa lepas
            </span>
            <input
              aria-label={`Sisa lepas ${name}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={state.looseInput}
              onChange={(e) => onLooseChange(e.target.value)}
              className={cn(
                "h-9 flex-1 rounded-md border bg-white px-3 text-right font-mono text-sm tabular-nums shadow-sm transition focus:outline-none focus:ring-2",
                state.status === "error"
                  ? "border-danger-500 focus:ring-danger-500"
                  : "border-neutral-300 focus:border-mahakan-green-700 focus:ring-mahakan-green-700/40",
              )}
            />
            <span className="flex h-9 w-[60px] flex-none items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-700">
              {ctx.recipeUnit}
            </span>
            <span className="w-5 flex-none" aria-hidden />
          </div>
        ) : null}

        {/* Total preview — kalau split input atau unit beda dari recipe. */}
        {totalPreview !== null && totalPreview > 0 && currentPrimaryUnit !== ctx.recipeUnit ? (
          <div className="flex items-center justify-end gap-1 rounded bg-mahakan-green-100/40 px-2 py-1 text-[11px] text-mahakan-green-900">
            <span className="text-mahakan-green-700">Total tersimpan:</span>
            <span className="font-mono font-semibold tabular-nums">
              {totalPreview.toLocaleString("id-ID", {
                maximumFractionDigits: 4,
              })}{" "}
              {ctx.recipeUnit}
            </span>
          </div>
        ) : null}
      </div>
      {state.status === "error" ? (
        <p className="text-xs text-danger-500 sm:basis-full sm:pl-10">
          {state.errorMsg}
        </p>
      ) : null}
    </li>
  );
}

function formatRatioForChip(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "?";
  if (Number.isInteger(n)) return n.toLocaleString("id-ID");
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(n);
}

interface FlowMetricProps {
  label: string;
  value: number | null;
  unit: string;
  hint: string;
  placeholder?: string;
  warn?: boolean;
  emphasized?: boolean;
}

function FlowMetric({
  label,
  value,
  unit,
  hint,
  placeholder = "0",
  warn,
  emphasized,
}: FlowMetricProps) {
  return (
    <span title={hint} className="inline-flex items-baseline gap-1">
      <span className="text-neutral-500">{label}:</span>
      <span
        className={cn(
          "font-medium",
          warn
            ? "text-warning-500"
            : emphasized
              ? "font-semibold text-mahakan-green-900"
              : "text-neutral-900",
        )}
      >
        {value === null
          ? placeholder
          : `${value.toLocaleString("id-ID")} ${unit}`}
      </span>
    </span>
  );
}

function blankLineState(unit = ""): LineState {
  return {
    primaryInput: "",
    primaryUnit: unit,
    looseInput: "",
    saved: null,
    status: "idle",
  };
}

/** Sesi AE-147 — initialize state per line.
 *  - Server saved actualQty selalu dalam recipe unit.
 *  - Default primary unit = purchase unit kalau ada, else recipe.
 *  - Default primary input = saved qty di-convert ke primary unit (kalau
 *    primary != recipe). Tidak ada loose split saat load awal — staff
 *    yang punya breakdown 3 pack + 2 pcs bisa ulang input manual saat
 *    revise. (Trade-off: backend cuma simpan single decimal.)
 */
function initialState(detail: OpnameSessionDetail): Map<string, LineState> {
  const m = new Map<string, LineState>();
  for (const l of detail.lines) {
    const masterUnit = l.unitSnapshot ?? l.ingredient.unit ?? "";
    const ctx = buildOpnameUnitContext({
      recipeUnit: masterUnit,
      unitBelanja: l.ingredient.unitBelanja,
      unitBelanjaPerCogs: l.ingredient.unitBelanjaPerCogs,
      packConversions:
        (l.ingredient.packConversions ?? null) as IngredientPackConversion[] | null,
    });
    const savedQty =
      l.actualQtyDecimal !== null
        ? parseFloat(l.actualQtyDecimal)
        : l.actualQty;
    const primaryUnit = ctx.defaultUnit;
    let primaryInput = "";
    if (savedQty !== null) {
      const mult = ctx.multipliers.get(primaryUnit) ?? 1;
      const qtyInPrimary = savedQty / mult;
      /* Format pakai locale id-ID (koma decimal) kalau perlu desimal. */
      primaryInput = formatQtyForInput(qtyInPrimary);
    }
    m.set(l.ingredientId, {
      primaryInput,
      primaryUnit,
      looseInput: "",
      saved: savedQty,
      status: "idle",
    });
  }
  return m;
}

/** Format number to input string. Integer → no decimal. Float → koma 4 max. */
function formatQtyForInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  /* Trim trailing zeros, pakai koma decimal id-ID. */
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
    useGrouping: false,
  }).format(n);
}

/* ──────────────────────────────────────────────────────────────────
 * Sesi AE-147 — localStorage draft persistence.
 *
 * Key namespaced per sessionId: `mahakan.opname.draft.<sessionId>`.
 * Stored shape: { ingredientId: { primaryInput, primaryUnit, looseInput } }.
 *
 * Server saved value is source of truth — draft hanya carry "typing
 * position" untuk in-flight changes yang belum kesave / staff navigate
 * away tanpa wait debounce. On mount: merge draft over initialState dengan
 * preference: kalau draft punya entry untuk ingredientId AND draft entry
 * non-empty, pakai draft input strings (server `saved` field tetap).
 * ────────────────────────────────────────────────────────────────── */

interface DraftLineEntry {
  primaryInput: string;
  primaryUnit: string;
  looseInput: string;
}

type DraftPayload = Record<string, DraftLineEntry>;

function draftKey(sessionId: string): string {
  return `mahakan.opname.draft.${sessionId}`;
}

function readDraft(sessionId: string): DraftPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as DraftPayload;
    return null;
  } catch {
    return null;
  }
}

function writeDraft(sessionId: string, stateMap: Map<string, LineState>): void {
  if (typeof window === "undefined") return;
  try {
    const payload: DraftPayload = {};
    for (const [id, s] of stateMap.entries()) {
      /* Hanya simpan entry yang punya typing (skip empty supaya payload
       * ringan + first load tidak overlay default empty state). */
      if (
        s.primaryInput.trim().length === 0 &&
        s.looseInput.trim().length === 0
      ) {
        continue;
      }
      payload[id] = {
        primaryInput: s.primaryInput,
        primaryUnit: s.primaryUnit,
        looseInput: s.looseInput,
      };
    }
    if (Object.keys(payload).length === 0) {
      window.localStorage.removeItem(draftKey(sessionId));
      return;
    }
    window.localStorage.setItem(draftKey(sessionId), JSON.stringify(payload));
  } catch {
    /* Quota exceeded atau localStorage disabled — silent. */
  }
}

function clearDraft(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* silent */
  }
}

function mergeDraftIntoState(
  detail: OpnameSessionDetail,
  draft: DraftPayload | null,
): Map<string, LineState> {
  const base = initialState(detail);
  if (!draft) return base;
  for (const [id, entry] of Object.entries(draft)) {
    const cur = base.get(id);
    if (!cur) continue;
    /* Overlay typing position — keep server-saved field. */
    base.set(id, {
      ...cur,
      primaryInput: entry.primaryInput ?? cur.primaryInput,
      primaryUnit: entry.primaryUnit ?? cur.primaryUnit,
      looseInput: entry.looseInput ?? "",
    });
  }
  return base;
}
