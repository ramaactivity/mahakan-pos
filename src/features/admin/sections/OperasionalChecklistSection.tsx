"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Clock,
  ListChecks,
  Loader2,
  MessageCircle,
  PencilLine,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyCard,
  Input,
  Modal,
  Skeleton,
  toast,
} from "@/components/ui";
import {
  archiveTemplate,
  buildChecklistWhatsappText,
  buildWaLink,
  createTemplate,
  currentPeriodKey,
  formatPeriodLabel,
  FREQUENCY_LABELS,
  getChecklist,
  isOk,
  listTemplates,
  recordWaExport,
  reorderTemplates,
  restoreDefaultTemplates,
  SECTION_LABELS,
  toggleCompletion,
  updateTemplate,
  type ChecklistPeriodView,
  type OperasionalFrequency,
  type OperasionalSection,
  type PublicTaskTemplate,
} from "@/features/operasional-tasks";
import { useSession } from "@/features/auth/SessionProvider";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface OperasionalChecklistSectionProps {
  viewerRole: Role;
}

const FREQUENCIES: OperasionalFrequency[] = ["daily", "weekly", "monthly"];
const SECTIONS: OperasionalSection[] = ["bar", "kitchen", "general"];

const SECTION_EMOJI: Record<OperasionalSection, string> = {
  bar: "🥃",
  kitchen: "🍳",
  general: "🧹",
};

type ViewMode = "progress" | "manage";

export function OperasionalChecklistSection({
  viewerRole,
}: OperasionalChecklistSectionProps) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("progress");
  const [frequency, setFrequency] = useState<OperasionalFrequency>("daily");
  const [includeInactive, setIncludeInactive] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["op-tasks", "templates", { includeInactive }],
    queryFn: async () => {
      const res = await listTemplates({ includeInactive });
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["op-tasks", "templates"] });
  }

  const byFreqSection = useMemo(() => {
    const grouped = new Map<
      OperasionalFrequency,
      Map<OperasionalSection, PublicTaskTemplate[]>
    >();
    for (const t of templates) {
      if (!grouped.has(t.frequency)) grouped.set(t.frequency, new Map());
      const sec = grouped.get(t.frequency)!;
      if (!sec.has(t.section)) sec.set(t.section, []);
      sec.get(t.section)!.push(t);
    }
    return grouped;
  }, [templates]);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<
    | { kind: "create"; frequency: OperasionalFrequency; section: OperasionalSection }
    | { kind: "edit"; template: PublicTaskTemplate }
    | null
  >(null);
  const [pendingArchive, setPendingArchive] =
    useState<PublicTaskTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);

  function openCreate(
    freq: OperasionalFrequency,
    section: OperasionalSection,
  ) {
    setFormMode({ kind: "create", frequency: freq, section });
    setFormOpen(true);
  }

  function openEdit(template: PublicTaskTemplate) {
    setFormMode({ kind: "edit", template });
    setFormOpen(true);
  }

  async function handleArchive() {
    if (!pendingArchive || submitting) return;
    setSubmitting(true);
    const res = await archiveTemplate(pendingArchive.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Task "${pendingArchive.title}" dihapus`);
    setPendingArchive(null);
    setSubmitting(false);
    refresh();
  }

  async function handleRestoreDefault() {
    setRestoreSubmitting(true);
    const res = await restoreDefaultTemplates();
    setRestoreSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.inserted === 0) {
      toast.info("Semua default sudah ada");
    } else {
      toast.success(`${res.data.inserted} default task dipulihkan`);
      refresh();
    }
  }

  async function handleMove(
    template: PublicTaskTemplate,
    direction: "up" | "down",
  ) {
    const list =
      byFreqSection.get(template.frequency)?.get(template.section) ?? [];
    const idx = list.findIndex((t) => t.id === template.id);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const swap = list[targetIdx];
    const res = await reorderTemplates([
      { id: template.id, displayOrder: swap.displayOrder },
      { id: swap.id, displayOrder: template.displayOrder },
    ]);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    refresh();
  }

  const sectionsForFreq = SECTIONS;

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            Checklist Operasional
          </h1>
          <p className="text-sm text-neutral-700">
            Lihat progress ceklist staff (Progress) atau atur daftar tugas
            harian/mingguan/bulanan (Daftar Tugas).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewMode === "manage" ? (
            <Button
              variant="outline"
              size="sm"
              loading={restoreSubmitting}
              onClick={handleRestoreDefault}
            >
              <Sparkles className="size-4" aria-hidden /> Pulihkan default
            </Button>
          ) : null}
        </div>
      </header>

      {/* View mode toggle */}
      <div
        role="tablist"
        aria-label="Mode tampilan"
        className="inline-flex rounded-lg border border-neutral-200 bg-white p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "progress"}
          onClick={() => setViewMode("progress")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            viewMode === "progress"
              ? "bg-mahakan-green-700 text-white"
              : "text-neutral-700 hover:bg-neutral-100",
          )}
        >
          <ListChecks className="size-3.5" aria-hidden /> Progress
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "manage"}
          onClick={() => setViewMode("manage")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            viewMode === "manage"
              ? "bg-mahakan-green-700 text-white"
              : "text-neutral-700 hover:bg-neutral-100",
          )}
        >
          <Settings2 className="size-3.5" aria-hidden /> Daftar Tugas
        </button>
      </div>

      {viewMode === "progress" ? (
        <ProgressView viewerRole={viewerRole} />
      ) : (
        <ManageView
          frequency={frequency}
          onFrequencyChange={setFrequency}
          includeInactive={includeInactive}
          onIncludeInactiveChange={setIncludeInactive}
          isLoading={isLoading}
          byFreqSection={byFreqSection}
          openCreate={openCreate}
          openEdit={openEdit}
          setPendingArchive={setPendingArchive}
          handleMove={handleMove}
          sectionsForFreq={sectionsForFreq}
        />
      )}

      <TaskFormModal
        open={formOpen}
        mode={formMode}
        onClose={() => {
          setFormOpen(false);
          setFormMode(null);
        }}
        onSaved={() => {
          setFormOpen(false);
          setFormMode(null);
          refresh();
        }}
      />

      <Modal
        open={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        title="Hapus task?"
        description={
          pendingArchive
            ? `Task "${pendingArchive.title}" tidak akan ditampilkan lagi di ceklist staff. Data ceklist lama tetap tersimpan.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingArchive(null)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              loading={submitting}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-700">
          Kalau cuma butuh sementara nonaktif, edit dulu task-nya dan ubah
          status ke <strong>Nonaktif</strong>.
        </p>
      </Modal>
    </div>
  );
}

/* ============================================================
 * ManageView — current template CRUD (extracted into sub-component
 * supaya OperasionalChecklistSection bisa swap antara Progress vs
 * Manage tanpa duplicate state.
 * ============================================================ */

interface ManageViewProps {
  frequency: OperasionalFrequency;
  onFrequencyChange: (f: OperasionalFrequency) => void;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
  isLoading: boolean;
  byFreqSection: Map<
    OperasionalFrequency,
    Map<OperasionalSection, PublicTaskTemplate[]>
  >;
  openCreate: (f: OperasionalFrequency, s: OperasionalSection) => void;
  openEdit: (template: PublicTaskTemplate) => void;
  setPendingArchive: (t: PublicTaskTemplate) => void;
  handleMove: (
    template: PublicTaskTemplate,
    direction: "up" | "down",
  ) => void | Promise<void>;
  sectionsForFreq: OperasionalSection[];
}

function ManageView({
  frequency,
  onFrequencyChange,
  includeInactive,
  onIncludeInactiveChange,
  isLoading,
  byFreqSection,
  openCreate,
  openEdit,
  setPendingArchive,
  handleMove,
  sectionsForFreq,
}: ManageViewProps) {
  return (
    <div className="space-y-4">
      {/* Frequency tabs */}
      <div
        role="tablist"
        aria-label="Frekuensi"
        className="inline-flex rounded-lg border border-neutral-200 bg-white p-1"
      >
        {FREQUENCIES.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={frequency === f}
            onClick={() => onFrequencyChange(f)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              frequency === f
                ? "bg-mahakan-green-700 text-white"
                : "text-neutral-700 hover:bg-neutral-100",
            )}
          >
            {FREQUENCY_LABELS[f]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="size-3.5 rounded border-neutral-300 text-mahakan-green-700"
        />
        Tampilkan task yang dinonaktifkan
      </label>

      {/* Body: card per section */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {sectionsForFreq.map((section) => {
            const items = byFreqSection.get(frequency)?.get(section) ?? [];
            return (
              <Card key={section}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-mahakan-green-900">
                      {SECTION_LABELS[section]}{" "}
                      <span className="ml-1 text-xs font-normal text-neutral-500">
                        ({items.length})
                      </span>
                    </h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openCreate(frequency, section)}
                    >
                      <Plus className="size-4" aria-hidden /> Tambah
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {items.length === 0 ? (
                    <div className="px-4 pb-4">
                      <EmptyCard
                        icon={CheckSquare}
                        title="Belum ada task"
                        description={`Tambah task ${FREQUENCY_LABELS[frequency].toLowerCase()} untuk section ${SECTION_LABELS[section]}.`}
                      />
                    </div>
                  ) : (
                    <ul className="divide-y divide-neutral-100">
                      {items.map((tmpl, idx) => (
                        <li
                          key={tmpl.id}
                          className={cn(
                            "flex items-start gap-2 px-4 py-3",
                            !tmpl.isActive && "bg-neutral-50/60",
                          )}
                        >
                          <div className="flex flex-col gap-0.5 pt-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMove(tmpl, "up")}
                              className="inline-flex size-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                              aria-label="Geser ke atas"
                            >
                              <ArrowUp className="size-3.5" aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={idx === items.length - 1}
                              onClick={() => handleMove(tmpl, "down")}
                              className="inline-flex size-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                              aria-label="Geser ke bawah"
                            >
                              <ArrowDown className="size-3.5" aria-hidden />
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p
                                className={cn(
                                  "text-sm font-medium",
                                  tmpl.isActive
                                    ? "text-neutral-900"
                                    : "text-neutral-500 line-through",
                                )}
                              >
                                {tmpl.title}
                              </p>
                              {tmpl.isSeed ? (
                                <Badge variant="neutral">Default</Badge>
                              ) : null}
                              {!tmpl.isActive ? (
                                <Badge variant="voided">Nonaktif</Badge>
                              ) : null}
                            </div>
                            {tmpl.description ? (
                              <p className="mt-0.5 text-xs text-neutral-600">
                                {tmpl.description}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEdit(tmpl)}
                              aria-label="Edit"
                            >
                              <PencilLine className="size-4" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingArchive(tmpl)}
                              aria-label="Hapus"
                              className="text-danger-500 hover:bg-danger-100"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * ProgressView — live checklist progress dengan period picker.
 * Mirroring /m/checklist UX tapi adapted untuk back office layout
 * (lebih wide, multi-section side-by-side di lg+, tanpa floating WA
 * button — pakai inline button di header).
 * ============================================================ */

interface ProgressViewProps {
  /* viewerRole reserved untuk future role-aware behavior (mis. supervisor
   * tidak bisa toggle). Sekarang Owner+Manager keduanya bisa toggle. */
  viewerRole: Role;
}

function ProgressView(props: ProgressViewProps) {
  void props.viewerRole;
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [frequency, setFrequency] = useState<OperasionalFrequency>("daily");
  const [periodKey, setPeriodKey] = useState<string>(() =>
    currentPeriodKey("daily"),
  );

  function selectFrequency(f: OperasionalFrequency) {
    setFrequency(f);
    setPeriodKey(currentPeriodKey(f));
  }

  const { data: view, isLoading } = useQuery({
    queryKey: ["op-tasks", "progress", { frequency, periodKey }],
    queryFn: async () => {
      const res = await getChecklist(frequency, periodKey);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const [pending, setPending] = useState<Set<string>>(new Set());

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["op-tasks", "progress", { frequency, periodKey }],
    });
  }

  const isCurrentPeriod = periodKey === currentPeriodKey(frequency);

  async function handleToggle(
    templateId: string,
    currentlyDone: boolean,
    title: string,
  ) {
    if (pending.has(templateId)) return;
    setPending((p) => new Set(p).add(templateId));
    let lateReason: string | null = null;
    if (!currentlyDone && !isCurrentPeriod) {
      lateReason =
        prompt(
          `Catat terlambat untuk "${title}". Alasan kenapa baru dicentang sekarang?`,
          "",
        )?.trim() ?? "";
      if (!lateReason) {
        toast.error("Batal — alasan wajib diisi untuk backdate");
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
      return;
    }
    refresh();
  }

  function handleShareWhatsapp() {
    if (!view) return;
    const text = buildChecklistWhatsappText({
      view,
      senderName: session?.user.name ?? null,
      outletName: "Mahakan Coffee & Space",
    });
    const url = buildWaLink(text, null);
    const totalCount = view.sections.reduce((a, s) => a + s.totalCount, 0);
    const completedCount = view.sections.reduce(
      (a, s) => a + s.completedCount,
      0,
    );
    void recordWaExport({
      frequency: view.frequency,
      periodKey: view.periodKey,
      section: null,
      completedCount,
      totalCount,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("Buka WhatsApp — pilih grup tujuan");
  }

  const totalDone =
    view?.sections.reduce((a, s) => a + s.completedCount, 0) ?? 0;
  const totalAll =
    view?.sections.reduce((a, s) => a + s.totalCount, 0) ?? 0;
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Frequency tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Frekuensi"
          className="inline-flex rounded-lg border border-neutral-200 bg-white p-1"
        >
          {FREQUENCIES.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={frequency === f}
              onClick={() => selectFrequency(f)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                frequency === f
                  ? "bg-mahakan-green-700 text-white"
                  : "text-neutral-700 hover:bg-neutral-100",
              )}
            >
              {FREQUENCY_LABELS[f]}
            </button>
          ))}
        </div>

        <AdminPeriodPicker
          frequency={frequency}
          periodKey={periodKey}
          onChange={setPeriodKey}
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleShareWhatsapp}
            disabled={!view || totalAll === 0}
            className="bg-[#25D366] text-white hover:bg-[#1faa55]"
          >
            <MessageCircle className="size-4" aria-hidden /> Kirim ke WA
          </Button>
        </div>
      </div>

      {/* Backdate banner */}
      {!isCurrentPeriod ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-100/50 p-3 text-sm text-warning-500">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <p>
            Lagi lihat periode lampau. Centang akan dicatat sebagai{" "}
            <strong>terlambat</strong> dengan alasan wajib.
          </p>
        </div>
      ) : null}

      {/* Progress overview */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
            {view?.lastWaExportAt ? (
              <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                <Send className="size-3" aria-hidden />
                Terakhir dikirim ke WA:{" "}
                {formatRelativeAdmin(view.lastWaExportAt)}
                {view.lastWaExportBy ? ` · ${view.lastWaExportBy}` : ""}
              </div>
            ) : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full bg-mahakan-green-700 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sections grid */}
      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : !view || view.sections.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium text-neutral-900">
              Belum ada task aktif untuk {FREQUENCY_LABELS[frequency]}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Tambah task dari tab <strong>Daftar Tugas</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {view.sections.map((sec) => (
            <ProgressSectionCard
              key={sec.section}
              section={sec.section}
              entries={sec.entries}
              done={sec.completedCount}
              total={sec.totalCount}
              pending={pending}
              showSectionHeader={view.sections.length > 1}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProgressSectionCardProps {
  section: OperasionalSection;
  entries: ChecklistPeriodView["sections"][number]["entries"];
  done: number;
  total: number;
  pending: Set<string>;
  showSectionHeader: boolean;
  onToggle: (templateId: string, currentlyDone: boolean, title: string) => void;
}

function ProgressSectionCard({
  section,
  entries,
  done,
  total,
  pending,
  showSectionHeader,
  onToggle,
}: ProgressSectionCardProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Card>
      {showSectionHeader ? (
        <CardHeader className="border-b border-neutral-100">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-mahakan-green-900">
              <span aria-hidden>{SECTION_EMOJI[section]}</span>
              {SECTION_LABELS[section]}
            </h2>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200">
              {done}/{total} · {pct}%
            </span>
          </div>
        </CardHeader>
      ) : null}
      <CardContent className="p-0">
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
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-mahakan-green-50/40 active:bg-mahakan-green-50",
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
                    ) : null}
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
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-mahakan-green-900/80">
                        <Clock className="size-3" aria-hidden />
                        {entry.completion.completedByName} ·{" "}
                        {formatRelativeAdmin(entry.completion.completedAt)}
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
      </CardContent>
    </Card>
  );
}

interface AdminPeriodPickerProps {
  frequency: OperasionalFrequency;
  periodKey: string;
  onChange: (key: string) => void;
}

function AdminPeriodPicker({
  frequency,
  periodKey,
  onChange,
}: AdminPeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => buildAdminPeriodOptions(frequency), [frequency]);
  const currentKey = currentPeriodKey(frequency);
  const label = formatPeriodLabel(frequency, periodKey);
  const isCurrent = periodKey === currentKey;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
      >
        <span>{label}</span>
        {isCurrent ? (
          <span className="rounded-full bg-mahakan-green-100 px-1.5 py-0.5 text-[10px] font-bold text-mahakan-green-900">
            {frequency === "daily"
              ? "HARI INI"
              : frequency === "weekly"
                ? "MINGGU INI"
                : "BULAN INI"}
          </span>
        ) : null}
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.25rem)] z-10 min-w-[18rem] max-w-xs rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50",
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
        </div>
      ) : null}
    </div>
  );
}

function buildAdminPeriodOptions(
  frequency: OperasionalFrequency,
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  const now = new Date();
  if (frequency === "daily") {
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const k = currentPeriodKey("daily", d);
      out.push({ key: k, label: formatPeriodLabel("daily", k) });
    }
  } else if (frequency === "weekly") {
    for (let i = 0; i < 8; i += 1) {
      const d = new Date(now.getTime() - i * 7 * 86_400_000);
      const k = currentPeriodKey("weekly", d);
      if (!out.find((o) => o.key === k))
        out.push({ key: k, label: formatPeriodLabel("weekly", k) });
    }
  } else {
    for (let i = 0; i < 6; i += 1) {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() - i);
      const k = currentPeriodKey("monthly", d);
      if (!out.find((o) => o.key === k))
        out.push({ key: k, label: formatPeriodLabel("monthly", k) });
    }
  }
  return out;
}

function formatRelativeAdmin(date: Date): string {
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

interface TaskFormModalProps {
  open: boolean;
  mode:
    | { kind: "create"; frequency: OperasionalFrequency; section: OperasionalSection }
    | { kind: "edit"; template: PublicTaskTemplate }
    | null;
  onClose: () => void;
  onSaved: () => void;
}

function TaskFormModal({ open, mode, onClose, onSaved }: TaskFormModalProps) {
  const isEdit = mode?.kind === "edit";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [section, setSection] = useState<OperasionalSection>("general");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !mode) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null);
    setSubmitting(false);
    if (mode.kind === "edit") {
      setTitle(mode.template.title);
      setDescription(mode.template.description ?? "");
      setSection(mode.template.section);
      setIsActive(mode.template.isActive);
    } else {
      setTitle("");
      setDescription("");
      setSection(mode.section);
      setIsActive(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, mode]);

  async function handleSubmit() {
    if (!mode || submitting) return;
    setSubmitting(true);
    setError(null);

    const t = title.trim();
    if (t.length === 0) {
      setError("Judul wajib diisi");
      setSubmitting(false);
      return;
    }

    if (mode.kind === "edit") {
      const res = await updateTemplate({
        id: mode.template.id,
        title: t,
        description: description.trim() || null,
        section,
        isActive,
      });
      if (!isOk(res)) {
        setError(res.error.message);
        setSubmitting(false);
        return;
      }
      toast.success("Task disimpan");
      onSaved();
      return;
    }

    const res = await createTemplate({
      frequency: mode.frequency,
      section,
      title: t,
      description: description.trim() || null,
    });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Task ditambahkan");
    onSaved();
  }

  const freqLabel = mode
    ? FREQUENCY_LABELS[
        mode.kind === "edit" ? mode.template.frequency : mode.frequency
      ]
    : "";

  return (
    <Modal
      open={open && mode !== null}
      onClose={onClose}
      title={isEdit ? "Edit Task" : "Tambah Task"}
      description={`Frekuensi: ${freqLabel}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Judul Task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          maxLength={120}
          placeholder='Contoh: "Bersihin area umum"'
        />
        <div>
          <label className="block text-sm font-medium text-neutral-900">
            Deskripsi (opsional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Tambah detail kalau perlu (mis. zona mana, item apa)."
            className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-mahakan-green-700 focus:outline-none focus:ring-2 focus:ring-mahakan-green-700/20"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Section
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-colors",
                  section === s
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                )}
              >
                {SECTION_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        {isEdit ? (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-neutral-900">
              Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsActive(true)}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                )}
              >
                Aktif
              </button>
              <button
                type="button"
                onClick={() => setIsActive(false)}
                className={cn(
                  "rounded-md border py-2 text-sm font-medium transition-colors",
                  !isActive
                    ? "border-warning-500 bg-warning-100/60 text-warning-500"
                    : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
                )}
              >
                Nonaktif
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Nonaktif = tidak muncul di ceklist staff, tapi history-nya
              masih tersimpan. Boleh aktifkan kembali kapan saja.
            </p>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-500/40 bg-danger-100/50 px-3 py-2 text-sm font-medium text-danger-500"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* Silence unused — RotateCcw kept for future "Cancel edit" affordance. */
void RotateCcw;
