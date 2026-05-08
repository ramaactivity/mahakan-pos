"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  PackageSearch,
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
      router.replace("/pin");
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
      // Pre-fill drafts from existing actualQty values
      const initialDrafts: Record<string, LineDraft> = {};
      for (const line of detailRes.data.lines) {
        if (line.actualQty !== null) {
          initialDrafts[line.ingredientId] = {
            input: String(line.actualQty),
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

  async function handleSaveLine(line: OpnameLineWithIngredient, raw: string) {
    if (!detail) return;
    const trimmed = raw.trim();
    let actualQty: number | null = null;
    if (trimmed.length > 0) {
      const parsed = parseFloat(trimmed.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setDrafts((d) => ({
          ...d,
          [line.ingredientId]: {
            input: raw,
            status: "error",
            errorMsg: "Angka tidak valid",
          },
        }));
        return;
      }
      actualQty = parsed;
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { input: raw, status: "saving" },
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
          status: "error",
          errorMsg: res.error.message,
        },
      }));
      toast.error(res.error.message);
      return;
    }

    setDrafts((d) => ({
      ...d,
      [line.ingredientId]: { input: raw, status: "saved" },
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

      {/* Lines list */}
      {filteredLines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white py-8 text-center text-sm text-neutral-600">
          Tidak ada bahan untuk filter ini.
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredLines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              draft={drafts[line.ingredientId]}
              onChange={(input) => {
                setDrafts((d) => ({
                  ...d,
                  [line.ingredientId]: { input, status: "idle" },
                }));
              }}
              onBlur={(input) => {
                const current = drafts[line.ingredientId];
                if (current?.status === "saved" && current.input === input) {
                  return; // No change, skip save
                }
                if (
                  input.trim() ===
                  (line.actualQty !== null ? String(line.actualQty) : "")
                ) {
                  return;
                }
                void handleSaveLine(line, input);
              }}
            />
          ))}
        </ul>
      )}

      <p className="rounded-lg bg-info-100/60 p-3 text-xs text-info-500">
        💡 Tip: tap field, isi jumlah fisik di laci, lalu tap di luar field
        untuk simpan otomatis. Untuk finalize opname, Owner/Manager perlu
        review via Back Office.
      </p>
    </div>
  );
}

function LineRow({
  line,
  draft,
  onChange,
  onBlur,
}: {
  line: OpnameLineWithIngredient;
  draft: LineDraft | undefined;
  onChange: (raw: string) => void;
  onBlur: (raw: string) => void;
}) {
  const expectedQty = line.expectedQty;
  const inputValue = draft?.input ?? "";
  const status = draft?.status ?? "idle";
  let parsedActual: number | null = null;
  const trimmed = inputValue.trim();
  if (trimmed.length > 0) {
    const p = parseFloat(trimmed.replace(",", "."));
    if (Number.isFinite(p) && p >= 0) parsedActual = p;
  }
  const diff =
    parsedActual !== null && expectedQty !== null
      ? parsedActual - Number(expectedQty)
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
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900">
            {line.ingredient.name}
          </p>
          <p className="text-[11px] text-neutral-600">
            Expected:{" "}
            <span className="font-mono">
              {Number(expectedQty).toLocaleString("id-ID")}
            </span>{" "}
            {line.ingredient.unit}
          </p>
        </div>
        <StatusIcon status={status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onBlur(e.target.value)}
          placeholder="0"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-mono tabular-nums text-neutral-900 placeholder:text-neutral-400 focus:border-mahakan-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
        />
        <span className="shrink-0 text-sm font-medium text-neutral-700">
          {line.ingredient.unit}
        </span>
      </div>
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
            {diff.toLocaleString("id-ID")}
          </span>{" "}
          {line.ingredient.unit}
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
