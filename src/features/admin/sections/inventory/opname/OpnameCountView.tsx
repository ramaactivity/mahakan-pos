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

interface OpnameCountViewProps {
  detail: OpnameSessionDetail;
  role: Role;
  onCancel: () => void;
  onChanged: () => void;
  onSubmittedForReview: () => void;
}

type LineState = {
  /** Local input string (may be empty / partial). */
  input: string;
  /** Last persisted value — null means uncounted, number means counted. */
  saved: number | null;
  /** "saving" while debounced action is in flight, "saved" after success,
   * null when idle or hasn't been touched. */
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
  const [editUnitFor, setEditUnitFor] = useState<{
    id: string;
    name: string;
    unit: string;
  } | null>(null);

  // Map of ingredientId → state. Re-init when session id changes (rare).
  const [stateMap, setStateMap] = useState<Map<string, LineState>>(() =>
    initialState(detail),
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
    setStateMap(initialState(detail));
    /* eslint-enable react-hooks/set-state-in-effect */
    // We intentionally re-init only when the session id changes — when the
    // parent refresh just bumps line counts but session is the same, we
    // don't want to overwrite the user's in-flight typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

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
      return {
        expectedQty: l.expectedQty,
        actualQty: s ? s.saved : l.actualQty,
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

  function scheduleSave(ingredientId: string, raw: string) {
    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId) ?? blankLineState();
      next.set(ingredientId, { ...cur, input: raw, status: "saving" });
      return next;
    });

    // Reset existing timer.
    const existing = timersRef.current.get(ingredientId);
    if (existing) window.clearTimeout(existing);

    const t = window.setTimeout(() => {
      void persistLine(ingredientId, raw);
    }, SAVE_DEBOUNCE_MS);
    timersRef.current.set(ingredientId, t);
  }

  async function persistLine(ingredientId: string, raw: string) {
    // Sesi AE-15 — accept decimal (mirror sesi AE-12 pattern dari purchases).
    // Allow koma OR titik as decimal separator (staff Indo biasa pakai koma).
    const trimmed = raw.trim().replace(",", ".");
    let actualQty: number | null;
    if (trimmed === "") {
      actualQty = null;
    } else {
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        setStateMap((prev) => {
          const next = new Map(prev);
          const cur = next.get(ingredientId) ?? blankLineState();
          next.set(ingredientId, {
            ...cur,
            status: "error",
            errorMsg: "Angka tidak valid",
          });
          return next;
        });
        return;
      }
      actualQty = n;
    }

    const res = await saveOpnameCount({
      sessionId: detail.id,
      ingredientId,
      actualQty,
      note: null,
    });

    setStateMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(ingredientId) ?? blankLineState();
      if (!isOk(res)) {
        next.set(ingredientId, {
          ...cur,
          status: "error",
          errorMsg: res.error.message,
        });
        return next;
      }
      next.set(ingredientId, {
        input: actualQty === null ? "" : String(actualQty),
        saved: actualQty,
        status: "saved",
      });
      return next;
    });
    // Intentionally NOT calling onChanged() here. Parent has nothing to
    // refresh — per-line counts only render inside this component, and a
    // parent re-render would unmount us mid-typing and wipe other cells'
    // in-flight (still-debouncing) input. Parent learns about line changes
    // only at submit/finalize/cancel boundaries.

    // Auto-clear "saved" state after a short moment.
    window.setTimeout(() => {
      setStateMap((prev) => {
        const next = new Map(prev);
        const cur = next.get(ingredientId);
        if (!cur || cur.status !== "saved") return prev;
        next.set(ingredientId, { ...cur, status: "idle" });
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
                return (
                  <CountRow
                    key={line.id}
                    ingredientId={line.ingredientId}
                    name={line.ingredientNameSnapshot}
                    unit={effectiveUnit}
                    expectedQty={line.expectedQty}
                    openingQty={f?.openingQty ?? 0}
                    purchasesQty={f?.purchasesQty ?? 0}
                    unitCost={line.unitCostAtSnapshot}
                    flowLoaded={flow !== null}
                    hasPriorOpname={flow?.hasPriorOpname ?? false}
                    state={stateMap.get(line.ingredientId) ?? blankLineState()}
                    revealExpected={revealExpected}
                    onChange={(raw) => scheduleSave(line.ingredientId, raw)}
                    onEditUnit={
                      canEditUnit
                        ? () =>
                            setEditUnitFor({
                              id: line.ingredientId,
                              name: line.ingredientNameSnapshot,
                              unit: effectiveUnit,
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
            // the new unit on next render. The override hides the race.
            onChanged();
          }}
        />
      ) : null}
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
  unit: string;
  expectedQty: number;
  /** Stok Awal — qty dari opname terakhir (atau 0 fallback). */
  openingQty: number;
  /** Pembelian — sum purchase_items.qty di window opname. */
  purchasesQty: number;
  /** Cost-per-unit untuk hitung Bahan Terpakai dalam rupiah. */
  unitCost: number;
  /** True saat fetch flow data sudah balik. False = "memuat…" placeholder. */
  flowLoaded: boolean;
  /** False = "Stok Awal" estimate karena belum ada opname sebelumnya. */
  hasPriorOpname: boolean;
  state: LineState;
  revealExpected: boolean;
  onChange: (raw: string) => void;
  onEditUnit?: () => void;
}

function CountRow({
  ingredientId,
  name,
  unit,
  expectedQty,
  openingQty,
  purchasesQty,
  unitCost,
  flowLoaded,
  hasPriorOpname,
  state,
  revealExpected,
  onChange,
  onEditUnit,
}: CountRowProps) {
  const counted = state.saved !== null;
  const diff =
    state.saved !== null ? state.saved - expectedQty : null;
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

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex flex-1 items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex size-6 flex-none items-center justify-center rounded-full text-[11px] font-bold",
            counted
              ? "bg-mahakan-green-700 text-white"
              : "bg-neutral-200 text-neutral-500",
          )}
          aria-hidden
        >
          {counted ? <Check className="size-3.5" /> : "—"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-neutral-900">{name}</p>
          <p className="text-xs text-neutral-500">
            Unit: {unit}
            {onEditUnit ? (
              <button
                type="button"
                onClick={onEditUnit}
                className="ml-1 inline-flex items-center rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-mahakan-green-700"
                aria-label={`Edit unit ${name}`}
                title="Edit satuan bahan"
              >
                <Pencil className="size-3" />
              </button>
            ) : null}
            {revealExpected ? (
              <>
                {" · "}
                <span className="font-mono text-neutral-700">
                  Expected: {expectedQty.toLocaleString("id-ID")}
                </span>
              </>
            ) : null}
            {diff !== null && revealExpected ? (
              <>
                {" · "}
                <span
                  className={cn(
                    "font-mono",
                    diff === 0
                      ? "text-mahakan-green-900"
                      : diff > 0
                        ? "text-success-500"
                        : "text-danger-500",
                  )}
                >
                  {diff === 0
                    ? "sesuai"
                    : `${diff > 0 ? "+" : ""}${diff.toLocaleString("id-ID")}`}
                </span>
              </>
            ) : null}
          </p>
          {/* Inventory flow formula line — Stok Awal + Pembelian − Opname
              = Bahan Terpakai. Reads as math so Owner/staff cepet pahami
              basis HPP. Sesi AA #1. */}
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] tabular-nums text-neutral-600">
            {!flowLoaded ? (
              <span className="text-neutral-400">memuat data alur…</span>
            ) : (
              <>
                <FlowMetric
                  label="Stok Awal"
                  value={openingQty}
                  unit={unit}
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
                  unit={unit}
                  hint="Total pembelian sejak opname terakhir"
                />
                <FlowMetric
                  label="Opname"
                  value={closingQty}
                  unit={unit}
                  placeholder="—"
                  hint="Stok akhir hasil hitung kamu"
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
                  Terpakai:{" "}
                  {usedQty === null
                    ? "—"
                    : `${usedQty.toLocaleString("id-ID")} ${unit}`}
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
      <div className="flex items-center gap-2 sm:w-[200px]">
        <input
          aria-label={`Qty aktual ${name}`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={state.input}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-11 w-full rounded-md border bg-white px-3 text-right font-mono text-base tabular-nums shadow-sm transition focus:outline-none focus:ring-2",
            state.status === "error"
              ? "border-danger-500 focus:ring-danger-500"
              : "border-neutral-300 focus:border-mahakan-green-700 focus:ring-mahakan-green-700/40",
          )}
          data-testid={`count-input-${ingredientId}`}
        />
        <div className="w-5 flex-none text-center" aria-live="polite">
          {state.status === "saving" ? (
            <Loader2
              className="mx-auto size-4 animate-spin text-neutral-400"
              aria-label="Menyimpan"
            />
          ) : state.status === "saved" ? (
            <Check
              className="mx-auto size-4 text-mahakan-green-700"
              aria-label="Tersimpan"
            />
          ) : state.status === "error" ? (
            <AlertCircle
              className="mx-auto size-4 text-danger-500"
              aria-label="Gagal"
            />
          ) : null}
        </div>
      </div>
      {state.status === "error" ? (
        <p className="text-xs text-danger-500 sm:basis-full sm:pl-8">
          {state.errorMsg}
        </p>
      ) : null}
    </li>
  );
}

interface FlowMetricProps {
  label: string;
  value: number | null;
  unit: string;
  hint: string;
  placeholder?: string;
  warn?: boolean;
}

function FlowMetric({
  label,
  value,
  unit,
  hint,
  placeholder = "0",
  warn,
}: FlowMetricProps) {
  return (
    <span title={hint} className="inline-flex items-baseline gap-1">
      <span className="text-neutral-500">{label}:</span>
      <span
        className={cn(
          "font-medium",
          warn ? "text-warning-500" : "text-neutral-900",
        )}
      >
        {value === null
          ? placeholder
          : `${value.toLocaleString("id-ID")} ${unit}`}
      </span>
    </span>
  );
}

function blankLineState(): LineState {
  return { input: "", saved: null, status: "idle" };
}

function initialState(detail: OpnameSessionDetail): Map<string, LineState> {
  const m = new Map<string, LineState>();
  for (const l of detail.lines) {
    m.set(l.ingredientId, {
      input: l.actualQty === null ? "" : String(l.actualQty),
      saved: l.actualQty,
      status: "idle",
    });
  }
  return m;
}
