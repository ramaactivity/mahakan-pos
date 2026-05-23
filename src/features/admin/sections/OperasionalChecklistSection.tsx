"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  PencilLine,
  Plus,
  RotateCcw,
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
  createTemplate,
  FREQUENCY_LABELS,
  isOk,
  listTemplates,
  reorderTemplates,
  restoreDefaultTemplates,
  SECTION_LABELS,
  updateTemplate,
  type OperasionalFrequency,
  type OperasionalSection,
  type PublicTaskTemplate,
} from "@/features/operasional-tasks";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface OperasionalChecklistSectionProps {
  viewerRole: Role;
}

const FREQUENCIES: OperasionalFrequency[] = ["daily", "weekly", "monthly"];
const SECTIONS: OperasionalSection[] = ["bar", "kitchen", "general"];

export function OperasionalChecklistSection({
  viewerRole,
}: OperasionalChecklistSectionProps) {
  const queryClient = useQueryClient();
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
            {viewerRole === "owner"
              ? "Atur daftar tugas harian, mingguan, dan bulanan untuk staff. Ceklist ditampilkan di halaman staff & bisa di-export ke WA grup."
              : "Atur daftar tugas operasional untuk staff. Hapus/edit yang tidak relevan + tambah task khusus outlet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={restoreSubmitting}
            onClick={handleRestoreDefault}
          >
            <Sparkles className="size-4" aria-hidden /> Pulihkan default
          </Button>
        </div>
      </header>

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
            onClick={() => setFrequency(f)}
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
          onChange={(e) => setIncludeInactive(e.target.checked)}
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
