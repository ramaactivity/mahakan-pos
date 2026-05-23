"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Clock,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import { Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  buildChecklistWhatsappText,
  buildWaLink,
  currentPeriodKey,
  FREQUENCY_LABELS,
  formatPeriodLabel,
  getChecklist,
  isOk,
  recordWaExport,
  SECTION_LABELS,
  toggleCompletion,
  type ChecklistPeriodView,
  type OperasionalFrequency,
  type OperasionalSection,
} from "@/features/operasional-tasks";
import { cn } from "@/lib/utils";

interface PageState {
  view: ChecklistPeriodView | null;
  loading: boolean;
}

const FREQUENCIES: OperasionalFrequency[] = ["daily", "weekly", "monthly"];

const SECTION_EMOJI: Record<OperasionalSection, string> = {
  bar: "🥃",
  kitchen: "🍳",
  general: "🧹",
};

export default function ChecklistPage() {
  const router = useRouter();
  const { status, session } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/m/login");
    }
  }, [status, session, router]);

  const [frequency, setFrequency] = useState<OperasionalFrequency>("daily");
  const [periodKey, setPeriodKey] = useState<string>(() =>
    currentPeriodKey("daily"),
  );
  const [state, setState] = useState<PageState>({ view: null, loading: true });
  /* Track pending toggle promises per templateId to avoid double-clicks. */
  const [pending, setPending] = useState<Set<string>>(new Set());

  /* Reset periodKey when frequency changes via tab click, biar tidak
   * carry-over key dari freq lama (mis. "2026-W21" tidak valid untuk
   * daily). Pakai handler explicit untuk hindari effect→setState. */
  function selectFrequency(f: OperasionalFrequency) {
    setFrequency(f);
    setPeriodKey(currentPeriodKey(f));
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const res = await getChecklist(frequency, periodKey);
      if (cancelled) return;
      if (!isOk(res)) {
        toast.error(res.error.message);
        setState({ view: null, loading: false });
        return;
      }
      setState({ view: res.data, loading: false });
    })();
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [frequency, periodKey, session]);

  const isCurrentPeriod = periodKey === currentPeriodKey(frequency);

  async function handleToggle(
    templateId: string,
    currentlyDone: boolean,
    title: string,
  ) {
    if (pending.has(templateId)) return;
    setPending((p) => new Set(p).add(templateId));

    /* Optimistic update — flip the entry locally first. */
    setState((s) => {
      if (!s.view) return s;
      const next = structuredClone(s.view) as ChecklistPeriodView;
      for (const sec of next.sections) {
        for (const entry of sec.entries) {
          if (entry.template.id === templateId) {
            if (currentlyDone) {
              entry.completion = null;
              sec.completedCount = Math.max(0, sec.completedCount - 1);
            } else {
              entry.completion = {
                id: "optimistic",
                templateId,
                periodKey,
                completedAt: new Date(),
                completedById: session?.user.id ?? "",
                completedByName: session?.user.name ?? "Saya",
                isLate: !isCurrentPeriod,
                lateReason: null,
                notes: null,
              };
              sec.completedCount = Math.min(
                sec.totalCount,
                sec.completedCount + 1,
              );
            }
          }
        }
      }
      return { ...s, view: next };
    });

    let lateReason: string | null = null;
    if (!currentlyDone && !isCurrentPeriod) {
      lateReason = prompt(
        `Catat terlambat untuk "${title}". Alasan kenapa baru dicentang sekarang?`,
        "",
      )?.trim() ?? "";
      if (!lateReason) {
        toast.error("Batal — alasan wajib diisi untuk backdate");
        /* Revert optimistic */
        setState((s) => {
          if (!s.view) return s;
          const next = structuredClone(s.view) as ChecklistPeriodView;
          for (const sec of next.sections) {
            for (const entry of sec.entries) {
              if (entry.template.id === templateId) {
                entry.completion = null;
                sec.completedCount = Math.max(0, sec.completedCount - 1);
              }
            }
          }
          return { ...s, view: next };
        });
        setPending((p) => {
          const n = new Set(p);
          n.delete(templateId);
          return n;
        });
        return;
      }
    }

    const res = await toggleCompletion({
      templateId,
      periodKey,
      done: !currentlyDone,
      lateReason,
    });
    setPending((p) => {
      const n = new Set(p);
      n.delete(templateId);
      return n;
    });
    if (!isOk(res)) {
      toast.error(res.error.message);
      /* Refetch to recover ground truth. */
      const refetch = await getChecklist(frequency, periodKey);
      if (isOk(refetch)) setState({ view: refetch.data, loading: false });
      return;
    }
  }

  function handleShareWhatsapp() {
    if (!state.view) return;
    const text = buildChecklistWhatsappText({
      view: state.view,
      senderName: session?.user.name ?? null,
      outletName: "Mahakan Coffee & Space",
    });
    const url = buildWaLink(text, null); // pilih grup di dialog share
    const totalCount = state.view.sections.reduce(
      (a, s) => a + s.totalCount,
      0,
    );
    const completedCount = state.view.sections.reduce(
      (a, s) => a + s.completedCount,
      0,
    );
    /* Stamp ke audit/log — best-effort. */
    void recordWaExport({
      frequency: state.view.frequency,
      periodKey: state.view.periodKey,
      section: null,
      completedCount,
      totalCount,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("Buka WhatsApp — pilih grup tujuan");
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }
  if (status === "unauthenticated" || !session) return null;

  const totalDone =
    state.view?.sections.reduce((a, s) => a + s.completedCount, 0) ?? 0;
  const totalAll =
    state.view?.sections.reduce((a, s) => a + s.totalCount, 0) ?? 0;
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Link
          href="/m"
          className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
          aria-label="Kembali"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-mahakan-green-900">
            Checklist Operasional
          </h1>
          <p className="text-xs text-neutral-600">
            Ceklist tugas berkala — boleh diisi kapan saja dalam kurun
            waktunya.
          </p>
        </div>
      </header>

      {/* Frequency tabs */}
      <div
        role="tablist"
        aria-label="Frekuensi ceklist"
        className="grid grid-cols-3 gap-1 rounded-xl border border-neutral-200 bg-white p-1"
      >
        {FREQUENCIES.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={frequency === f}
            onClick={() => selectFrequency(f)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              frequency === f
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-700 hover:bg-neutral-50",
            )}
          >
            {FREQUENCY_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <PeriodPicker
        frequency={frequency}
        periodKey={periodKey}
        onChange={setPeriodKey}
      />

      {/* Backdate banner */}
      {!isCurrentPeriod ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-100/50 p-3 text-xs text-warning-500">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <p>
            Lagi lihat periode lampau. Centang akan dicatat sebagai{" "}
            <strong>terlambat</strong> + butuh alasan.
          </p>
        </div>
      ) : null}

      {/* Progress overview */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-500">
              Progress {FREQUENCY_LABELS[frequency]}
            </p>
            <p className="mt-0.5 text-2xl font-bold text-mahakan-green-900">
              {totalDone}/{totalAll}{" "}
              <span className="text-base font-normal text-neutral-500">
                ({pct}%)
              </span>
            </p>
          </div>
          <CheckSquare className="size-8 text-mahakan-green-700" aria-hidden />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full bg-mahakan-green-700 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {state.view?.lastWaExportAt ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <Send className="size-3" aria-hidden /> Terakhir dikirim ke WA:{" "}
            {formatRelative(state.view.lastWaExportAt)}
            {state.view.lastWaExportBy ? ` · ${state.view.lastWaExportBy}` : ""}
          </p>
        ) : null}
      </div>

      {/* Sections */}
      {state.loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-neutral-400" />
        </div>
      ) : !state.view || state.view.sections.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {state.view.sections.map((sec) => (
            <SectionCard
              key={sec.section}
              section={sec.section}
              entries={sec.entries}
              done={sec.completedCount}
              total={sec.totalCount}
              pending={pending}
              showSectionHeader={state.view!.sections.length > 1}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* WA share footer */}
      {state.view && totalAll > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-t-xl sm:border-x">
          <button
            type="button"
            onClick={handleShareWhatsapp}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.99]"
          >
            <MessageCircle className="size-4" aria-hidden />
            Kirim ringkasan ke WA Grup
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface SectionCardProps {
  section: OperasionalSection;
  entries: ChecklistPeriodView["sections"][number]["entries"];
  done: number;
  total: number;
  pending: Set<string>;
  showSectionHeader: boolean;
  onToggle: (templateId: string, currentlyDone: boolean, title: string) => void;
}

function SectionCard({
  section,
  entries,
  done,
  total,
  pending,
  showSectionHeader,
  onToggle,
}: SectionCardProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {showSectionHeader ? (
        <header className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>
              {SECTION_EMOJI[section]}
            </span>
            <h2 className="text-sm font-bold text-mahakan-green-900">
              {SECTION_LABELS[section]}
            </h2>
          </div>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200">
            {done}/{total} · {pct}%
          </span>
        </header>
      ) : null}
      <ul className="divide-y divide-neutral-100">
        {entries.map((entry) => {
          const done = entry.completion !== null;
          const isPending = pending.has(entry.template.id);
          return (
            <li key={entry.template.id}>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  onToggle(entry.template.id, done, entry.template.title)
                }
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-mahakan-green-50",
                  done && "bg-mahakan-green-50/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                    done
                      ? "border-mahakan-green-700 bg-mahakan-green-700 text-white"
                      : "border-neutral-300 bg-white",
                    isPending && "opacity-60",
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="size-3.5" aria-hidden />
                  ) : isPending ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <Square className="size-3 opacity-0" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      done
                        ? "text-mahakan-green-900 line-through decoration-mahakan-green-700/40"
                        : "text-neutral-900",
                    )}
                  >
                    {entry.template.title}
                  </p>
                  {entry.template.description ? (
                    <p className="mt-0.5 text-xs text-neutral-600">
                      {entry.template.description}
                    </p>
                  ) : null}
                  {entry.completion ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-mahakan-green-900/80">
                      <Clock className="size-3" aria-hidden />
                      {entry.completion.completedByName} ·{" "}
                      {formatRelative(entry.completion.completedAt)}
                      {entry.completion.isLate ? (
                        <span className="ml-1 rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold text-warning-500">
                          Terlambat
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {entry.completion?.lateReason ? (
                    <p className="mt-0.5 text-[11px] italic text-warning-500">
                      “{entry.completion.lateReason}”
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-neutral-900">
        Belum ada task aktif
      </p>
      <p className="mt-1 text-xs text-neutral-600">
        Minta Owner/Manager untuk tambah daftar tugas via Back Office →
        Checklist Operasional.
      </p>
    </div>
  );
}

interface PeriodPickerProps {
  frequency: OperasionalFrequency;
  periodKey: string;
  onChange: (key: string) => void;
}

function PeriodPicker({ frequency, periodKey, onChange }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => buildPeriodOptions(frequency), [frequency]);
  const currentKey = currentPeriodKey(frequency);
  const label = formatPeriodLabel(frequency, periodKey);
  const isToday = periodKey === currentKey;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"
      >
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            Periode
          </p>
          <p className="text-sm font-semibold text-neutral-900">
            {label}{" "}
            {isToday ? (
              <span className="ml-1 rounded-full bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold text-mahakan-green-900">
                {frequency === "daily"
                  ? "HARI INI"
                  : frequency === "weekly"
                    ? "MINGGU INI"
                    : "BULAN INI"}
              </span>
            ) : null}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-neutral-500 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-10 max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-50",
                opt.key === periodKey && "bg-mahakan-green-50 font-semibold",
              )}
            >
              <span>{opt.label}</span>
              {opt.key === currentKey ? (
                <span className="rounded-full bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold text-mahakan-green-900">
                  Sekarang
                </span>
              ) : null}
            </button>
          ))}
          {periodKey !== currentKey ? (
            <button
              type="button"
              onClick={() => {
                onChange(currentKey);
                setOpen(false);
              }}
              className="flex w-full items-center justify-center gap-2 border-t border-neutral-100 bg-neutral-50 py-2 text-xs font-semibold text-mahakan-green-900"
            >
              <RotateCcw className="size-3" aria-hidden />
              Kembali ke periode sekarang
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildPeriodOptions(
  frequency: OperasionalFrequency,
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const now = new Date();
  if (frequency === "daily") {
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const k = currentPeriodKey("daily", d);
      out.push({ key: k, label: formatPeriodLabel("daily", k) });
    }
  } else if (frequency === "weekly") {
    for (let i = 0; i < 4; i += 1) {
      const d = new Date(now.getTime() - i * 7 * 86_400_000);
      const k = currentPeriodKey("weekly", d);
      if (!out.find((o) => o.key === k))
        out.push({ key: k, label: formatPeriodLabel("weekly", k) });
    }
  } else {
    for (let i = 0; i < 3; i += 1) {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() - i);
      const k = currentPeriodKey("monthly", d);
      if (!out.find((o) => o.key === k))
        out.push({ key: k, label: formatPeriodLabel("monthly", k) });
    }
  }
  return out;
}

function formatRelative(date: Date): string {
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "baru saja";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} hari lalu`;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
