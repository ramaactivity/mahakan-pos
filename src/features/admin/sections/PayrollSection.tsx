"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  DollarSign,
  Gift,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DatePicker,
  EmptyCard,
  Input,
  Modal,
  ResponsiveTable,
  Skeleton,
  toast,
  type ResponsiveColumn,
} from "@/components/ui";
import {
  applyThr,
  computePayrollLines,
  createPayrollPeriod,
  deletePayrollPeriod,
  finalizePayrollPeriod,
  isOk,
  listPayrollLines,
  listPayrollPeriods,
  markPayrollPaid,
  updatePayrollLine,
  type PayrollLineWithEmployee,
  type PayrollStatus,
} from "@/features/payroll";
import {
  getOwnOutlet,
  isOk as outletIsOk,
  updatePayrollSettings,
} from "@/features/outlets";
import type { Role } from "@/lib/auth";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { formatIndonesianDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<PayrollStatus, { variant: "warning" | "info" | "success"; label: string }> =
  {
    draft: { variant: "warning", label: "Draft" },
    finalized: { variant: "info", label: "Finalized" },
    paid: { variant: "success", label: "Paid" },
  };

interface PayrollSectionProps {
  viewerRole: Role;
}

export function PayrollSection({ viewerRole }: PayrollSectionProps) {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const [editingLine, setEditingLine] =
    useState<PayrollLineWithEmployee | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [latePerMin, setLatePerMin] = useState<string>("");
  const [otPerMin, setOtPerMin] = useState<string>("");

  const canManage = viewerRole === "owner";

  const {
    data: periods = [],
    isLoading: loadingPeriods,
  } = useQuery({
    queryKey: ["admin", "payroll", "periods"],
    queryFn: async () => {
      const res = await listPayrollPeriods();
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
  });

  const {
    data: lines = [],
    isLoading: loadingLines,
  } = useQuery({
    queryKey: ["admin", "payroll", "lines", selectedPeriodId],
    queryFn: async () => {
      if (!selectedPeriodId) return [];
      const res = await listPayrollLines(selectedPeriodId);
      if (!isOk(res)) throw new Error(res.error.message);
      return res.data;
    },
    enabled: selectedPeriodId !== null,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "payroll"] });
  };

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      const res = await getOwnOutlet();
      if (cancelled) return;
      if (outletIsOk(res)) {
        const p = res.data.settings?.payroll ?? {};
        setLatePerMin(p.latePerMinute != null ? String(p.latePerMinute) : "");
        setOtPerMin(
          p.overtimePerMinute != null ? String(p.overtimePerMinute) : "",
        );
        setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  async function handleSaveSettings() {
    if (savingSettings) return;
    const lateNum = latePerMin.trim() === "" ? 0 : parseInt(latePerMin, 10);
    const otNum = otPerMin.trim() === "" ? 0 : parseInt(otPerMin, 10);
    if (
      !Number.isFinite(lateNum) ||
      lateNum < 0 ||
      !Number.isFinite(otNum) ||
      otNum < 0
    ) {
      toast.error("Rate harus angka non-negatif");
      return;
    }
    setSavingSettings(true);
    const res = await updatePayrollSettings({
      latePerMinute: lateNum,
      overtimePerMinute: otNum,
    });
    setSavingSettings(false);
    if (!outletIsOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Formula payroll disimpan");
    setSettingsOpen(false);
  }

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  async function handleCompute(force = false) {
    if (!selectedPeriod) return;
    const res = await computePayrollLines(selectedPeriod.id, { force });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    /* Sesi AE-60 — kalau backend balikin needsConfirm, tampilkan warning
     * sebelum overwrite manual edits (bonus/THR/kasbon). */
    if ("needsConfirm" in res.data) {
      const proceed = confirm(
        `${res.data.manualEditCount} dari ${res.data.totalLines} line punya manual edit (bonus/THR/kasbon/other deductions). Recompute akan TIMPA semua. Lanjut?`,
      );
      if (!proceed) return;
      void handleCompute(true);
      return;
    }
    const warnings =
      res.data.warnings.length > 0
        ? ` · ${res.data.warnings.length} warning`
        : "";
    const advLink =
      res.data.totalAdvancesLinked > 0
        ? ` · Kasbon ter-link Rp ${res.data.totalAdvancesLinked.toLocaleString("id-ID")}`
        : "";
    toast.success(`${res.data.lineCount} line di-compute${warnings}${advLink}`);
    if (res.data.warnings.length > 0) {
      // Surface first warning prominently
      toast.error(
        `⚠ ${res.data.warnings[0].employeeName}: ${res.data.warnings[0].message}`,
      );
    }
    refresh();
  }

  /* Sesi AE-60 — Apply THR semua line di period sekaligus.
   * Multiplier dari outlet settings (default 1.0 = 1× baseSalary). */
  async function handleApplyThr() {
    if (!selectedPeriod) return;
    const proceed = confirm(
      `Hitung THR untuk semua line di "${selectedPeriod.label}"? Field THR akan di-overwrite dengan baseSalary × multiplier (default 1.0×).`,
    );
    if (!proceed) return;
    const res = await applyThr({ periodId: selectedPeriod.id });
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      `THR di-apply ke ${res.data.updatedCount} line · Total Rp ${res.data.totalThr.toLocaleString("id-ID")}`,
    );
    refresh();
  }

  async function handleFinalize() {
    if (!selectedPeriod) return;
    if (!confirm(`Finalize payroll "${selectedPeriod.label}"? Setelah ini line tidak bisa diedit non-Owner.`))
      return;
    const res = await finalizePayrollPeriod(selectedPeriod.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Payroll di-finalize");
    refresh();
  }

  async function handleMarkPaid() {
    if (!selectedPeriod) return;
    if (!confirm(`Tandai payroll "${selectedPeriod.label}" sebagai Paid?`)) return;
    const res = await markPayrollPaid(selectedPeriod.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Payroll ditandai paid");
    refresh();
  }

  async function handleDelete() {
    if (!selectedPeriod) return;
    if (!confirm(`Hapus periode payroll "${selectedPeriod.label}"?`)) return;
    const res = await deletePayrollPeriod(selectedPeriod.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Periode dihapus");
    setSelectedPeriodId(null);
    refresh();
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-mahakan-green-100 text-mahakan-green-900">
            <DollarSign className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-mahakan-green-900">
              Payroll
            </h1>
            <p className="text-sm text-neutral-600">
              Periode bulanan + recompute dari attendance + adjust per line.
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              disabled={!settingsLoaded}
              aria-label="Pengaturan formula payroll"
            >
              <SettingsIcon className="size-4" aria-hidden /> Formula
            </Button>
            <Button onClick={() => setCreateOpen(true)} size="lg">
              <Plus className="size-4" aria-hidden /> Periode Baru
            </Button>
          </div>
        ) : null}
      </header>

      <Modal
        open={settingsOpen}
        onClose={() => (savingSettings ? null : setSettingsOpen(false))}
        title="Formula Payroll"
        description="Rate per menit untuk auto-fill saat Recompute. Kosongkan / 0 = tidak auto-fill (Owner input manual)."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setSettingsOpen(false)}
              disabled={savingSettings}
            >
              Batal
            </Button>
            <Button
              onClick={handleSaveSettings}
              loading={savingSettings}
              size="lg"
            >
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Late Deduction (Rp/menit)"
            type="text"
            inputMode="numeric"
            value={latePerMin}
            onChange={(e) =>
              setLatePerMin(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="0"
            hint={
              latePerMin && parseInt(latePerMin, 10) > 0
                ? `Contoh: 30 menit telat → ${formatRupiah(parseInt(latePerMin, 10) * 30)}`
                : "Default 0 = tidak auto-fill late_deduction"
            }
            disabled={savingSettings}
          />
          <Input
            label="Overtime Pay (Rp/menit)"
            type="text"
            inputMode="numeric"
            value={otPerMin}
            onChange={(e) =>
              setOtPerMin(e.target.value.replace(/[^\d]/g, ""))
            }
            placeholder="0"
            hint={
              otPerMin && parseInt(otPerMin, 10) > 0
                ? `Contoh: 60 menit OT → ${formatRupiah(parseInt(otPerMin, 10) * 60)}`
                : "Default 0 = tidak auto-fill overtime_pay"
            }
            disabled={savingSettings}
          />
          <p className="rounded-md bg-mahakan-green-50 p-3 text-xs text-mahakan-green-900">
            Diaplikasikan saat klik &ldquo;Recompute&rdquo; di periode draft.
            Owner masih bisa override per line lewat tombol pencil.
          </p>
        </div>
      </Modal>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="px-0 py-2">
            <p className="border-b border-neutral-200 px-4 py-2 text-xs uppercase tracking-wider text-neutral-500">
              Periode
            </p>
            {loadingPeriods ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : periods.length === 0 ? (
              <div className="p-2">
                <EmptyCard
                  icon={DollarSign}
                  title="Belum ada periode"
                  description="Buat periode payroll baru untuk mulai compute gaji."
                />
              </div>
            ) : (
              <ul className="space-y-0.5 p-2">
                {periods.map((p) => {
                  const status = STATUS_LABELS[p.status as PayrollStatus];
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPeriodId(p.id)}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                          selectedPeriodId === p.id
                            ? "bg-mahakan-green-100 text-mahakan-green-900"
                            : "hover:bg-neutral-100",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {p.label}
                          </span>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-600">
                          {p.periodStart} → {p.periodEnd}
                        </div>
                        <div className="text-xs text-neutral-600">
                          {p.lineCount} karyawan ·{" "}
                          {formatRupiah(p.netPayTotal)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 px-6 py-4">
            {!selectedPeriod ? (
              <p className="py-12 text-center text-sm italic text-neutral-500">
                Pilih periode di kiri untuk lihat detail.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-900">
                      {selectedPeriod.label}
                    </h2>
                    <p className="text-xs text-neutral-600">
                      {selectedPeriod.periodStart} → {selectedPeriod.periodEnd}
                    </p>
                    {selectedPeriod.finalizedAt ? (
                      <p className="text-xs text-neutral-600">
                        Finalized{" "}
                        {formatIndonesianDateTime(selectedPeriod.finalizedAt)}
                      </p>
                    ) : null}
                    {selectedPeriod.paidAt ? (
                      <p className="text-xs text-neutral-600">
                        Paid {formatIndonesianDateTime(selectedPeriod.paidAt)}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCompute(false)}
                        disabled={selectedPeriod.status !== "draft"}
                      >
                        <RefreshCw className="size-3.5" aria-hidden /> Recompute
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleApplyThr}
                        disabled={selectedPeriod.status !== "draft"}
                        title="Hitung THR semua line × multiplier (default 1× baseSalary)"
                      >
                        <Gift className="size-3.5" aria-hidden /> Hitung THR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleFinalize}
                        disabled={selectedPeriod.status !== "draft"}
                      >
                        <Lock className="size-3.5" aria-hidden /> Finalize
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleMarkPaid}
                        disabled={selectedPeriod.status !== "finalized"}
                      >
                        <CheckCircle2 className="size-3.5" aria-hidden /> Mark Paid
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDelete}
                        disabled={selectedPeriod.status === "paid"}
                        className="!text-danger-500 hover:!bg-danger-100/40"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>

                {loadingLines ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : lines.length === 0 ? (
                  <EmptyCard
                    icon={RefreshCw}
                    title="Belum ada line"
                    description="Klik “Recompute” untuk generate line dari attendance periode ini."
                  />
                ) : (
                  <ResponsiveTable<PayrollLineWithEmployee>
                    rows={lines}
                    rowKey={(l) => l.id}
                    columns={payrollLineColumns()}
                    rowActions={
                      canManage
                        ? (l) => (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingLine(l)}
                              disabled={selectedPeriod.status === "paid"}
                              aria-label={`Edit ${l.employeeFullName}`}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </Button>
                          )
                        : undefined
                    }
                    footer={
                      <div className="flex items-center justify-between font-semibold">
                        <span>Total Net Pay</span>
                        <span className="font-mono text-base">
                          {formatRupiah(
                            lines.reduce((s, l) => s + l.netPay, 0),
                          )}
                        </span>
                      </div>
                    }
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <CreatePeriodDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setSelectedPeriodId(id);
          refresh();
        }}
      />

      <EditLineDialog
        line={editingLine}
        onClose={() => setEditingLine(null)}
        onSaved={() => {
          setEditingLine(null);
          refresh();
        }}
      />
    </div>
  );
}

function CreatePeriodDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (periodId: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const now = new Date();
    const monthLabel = now.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
    setLabel(monthLabel);
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setPeriodStart(first.toISOString().slice(0, 10));
    setPeriodEnd(last.toISOString().slice(0, 10));
    setNotes("");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (label.trim().length === 0) {
      setError("Label wajib");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Tanggal wajib");
      return;
    }
    setSubmitting(true);
    const res = await createPayrollPeriod({
      label: label.trim(),
      periodStart,
      periodEnd,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`Periode "${res.data.label}" dibuat`);
    onCreated(res.data.id);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Periode Payroll Baru"
      description="Setelah dibuat, klik Recompute untuk generate line dari attendance."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting} size="lg">
            Buat
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 100))}
          placeholder="Mis. April 2026"
          required
          disabled={submitting}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label="Mulai"
            value={periodStart || null}
            onChange={(v) => setPeriodStart(v ?? "")}
            required
            disabled={submitting}
            clearable={false}
          />
          <DatePicker
            label="Selesai"
            value={periodEnd || null}
            onChange={(v) => setPeriodEnd(v ?? "")}
            minDate={periodStart || undefined}
            required
            disabled={submitting}
            clearable={false}
          />
        </div>
        <Input
          label="Catatan (opsional)"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          disabled={submitting}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function EditLineDialog({
  line,
  onClose,
  onSaved,
}: {
  line: PayrollLineWithEmployee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseSalary, setBaseSalary] = useState("");
  const [overtimePay, setOvertimePay] = useState("");
  const [lateDeduction, setLateDeduction] = useState("");
  const [bonus, setBonus] = useState("");
  /* Sesi AE-60 */
  const [thr, setThr] = useState("");
  const [advanceDeduction, setAdvanceDeduction] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!line) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setBaseSalary(String(line.baseSalary));
    setOvertimePay(String(line.overtimePay));
    setLateDeduction(String(line.lateDeduction));
    setBonus(String(line.bonus));
    setThr(String(line.thr ?? 0));
    setAdvanceDeduction(String(line.advanceDeduction ?? 0));
    setOtherDeductions(String(line.otherDeductions));
    setNotes(line.notes ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [line]);

  function tryParse(s: string): number {
    const trimmed = s.trim();
    if (trimmed.length === 0) return 0;
    try {
      const n = parseRupiah(trimmed);
      return n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  async function handleSave() {
    if (!line) return;
    if (submitting) return;
    setSubmitting(true);
    const res = await updatePayrollLine({
      id: line.id,
      baseSalary: tryParse(baseSalary),
      overtimePay: tryParse(overtimePay),
      lateDeduction: tryParse(lateDeduction),
      bonus: tryParse(bonus),
      thr: tryParse(thr),
      advanceDeduction: tryParse(advanceDeduction),
      otherDeductions: tryParse(otherDeductions),
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success("Line disimpan");
    onSaved();
  }

  if (!line) return null;

  const previewGross =
    tryParse(baseSalary) +
    tryParse(overtimePay) +
    tryParse(bonus) +
    tryParse(thr);
  const previewNet = Math.max(
    0,
    previewGross -
      tryParse(lateDeduction) -
      tryParse(advanceDeduction) -
      tryParse(otherDeductions),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit Line — ${line.employeeFullName}`}
      description={`Hari ${line.workDays} · Telat ${line.totalLateMinutes}m · OT ${line.totalOvertimeMinutes}m`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSave} loading={submitting} size="lg">
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Base Salary (snapshot)"
          type="text"
          inputMode="numeric"
          value={baseSalary}
          onChange={(e) => setBaseSalary(e.target.value.replace(/[^\d]/g, ""))}
          disabled={submitting}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Overtime Pay"
            type="text"
            inputMode="numeric"
            value={overtimePay}
            onChange={(e) =>
              setOvertimePay(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Bonus"
            type="text"
            inputMode="numeric"
            value={bonus}
            onChange={(e) => setBonus(e.target.value.replace(/[^\d]/g, ""))}
            disabled={submitting}
          />
          <Input
            label="THR (Tunjangan Hari Raya)"
            type="text"
            inputMode="numeric"
            value={thr}
            onChange={(e) => setThr(e.target.value.replace(/[^\d]/g, ""))}
            disabled={submitting}
          />
          <Input
            label="Late Deduction"
            type="text"
            inputMode="numeric"
            value={lateDeduction}
            onChange={(e) =>
              setLateDeduction(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Kasbon (Advance)"
            type="text"
            inputMode="numeric"
            value={advanceDeduction}
            onChange={(e) =>
              setAdvanceDeduction(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
          <Input
            label="Other Deductions"
            type="text"
            inputMode="numeric"
            value={otherDeductions}
            onChange={(e) =>
              setOtherDeductions(e.target.value.replace(/[^\d]/g, ""))
            }
            disabled={submitting}
          />
        </div>
        <Input
          label="Catatan (opsional)"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          disabled={submitting}
        />
        <div className="rounded-md bg-mahakan-green-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-700">Gross</span>
            <span className="font-mono font-semibold">
              {formatRupiah(previewGross)}
            </span>
          </div>
          <div className="flex justify-between border-t border-mahakan-green-200 pt-2 mt-2 text-mahakan-green-900">
            <span className="font-semibold">Net</span>
            <span className="font-mono text-lg font-bold">
              {formatRupiah(previewNet)}
            </span>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function payrollLineColumns(): ResponsiveColumn<PayrollLineWithEmployee>[] {
  return [
    {
      key: "employee",
      label: "Karyawan",
      primary: true,
      render: (l) => {
        const ptLabel =
          l.employeePaymentType === "daily"
            ? "Harian"
            : l.employeePaymentType === "monthly"
              ? "Bulanan"
              : "Legacy";
        const ptVariant =
          l.employeePaymentType === "daily"
            ? "info"
            : l.employeePaymentType === "monthly"
              ? "success"
              : "neutral";
        return (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-neutral-900">
                {l.employeeFullName}
              </span>
              <Badge variant={ptVariant}>{ptLabel}</Badge>
            </div>
            {l.employeePosition ? (
              <div className="text-[10px] text-neutral-500">
                {l.employeePosition}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "workDays",
      label: "Hari",
      align: "right",
      mono: true,
      render: (l) => l.workDays,
    },
    {
      key: "lateMinutes",
      label: "Telat (m)",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) => l.totalLateMinutes,
    },
    {
      key: "otMinutes",
      label: "OT (m)",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) => l.totalOvertimeMinutes,
    },
    {
      key: "base",
      label: "Base",
      align: "right",
      mono: true,
      render: (l) => {
        const formula =
          l.employeePaymentType === "daily" && l.employeeDailyRate
            ? `Rp ${l.employeeDailyRate.toLocaleString("id-ID")} × ${l.workDays}`
            : l.employeePaymentType === "monthly"
              ? "Bulanan flat"
              : "Legacy fallback";
        return (
          <div title={formula}>
            <div>{formatRupiah(l.baseSalary)}</div>
            <div className="text-[9px] text-neutral-400">{formula}</div>
          </div>
        );
      },
    },
    {
      key: "ot",
      label: "OT",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) => formatRupiah(l.overtimePay),
    },
    {
      key: "bonus",
      label: "Bonus",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) => formatRupiah(l.bonus),
    },
    {
      key: "thr",
      label: "THR",
      align: "right",
      mono: true,
      render: (l) => (
        <span className={l.thr > 0 ? "text-info-500 font-semibold" : ""}>
          {formatRupiah(l.thr)}
        </span>
      ),
    },
    {
      key: "lateDed",
      label: "- Telat",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) =>
        l.lateDeduction > 0 ? (
          <span className="text-danger-500">
            -{formatRupiah(l.lateDeduction)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "advanceDed",
      label: "- Kasbon",
      align: "right",
      mono: true,
      render: (l) =>
        l.advanceDeduction > 0 ? (
          <span className="text-warning-500">
            -{formatRupiah(l.advanceDeduction)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "otherDed",
      label: "- Other",
      align: "right",
      mono: true,
      desktopOnly: true,
      render: (l) =>
        l.otherDeductions > 0 ? (
          <span className="text-danger-500">
            -{formatRupiah(l.otherDeductions)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "net",
      label: "Net",
      align: "right",
      mono: true,
      render: (l) => (
        <span className="font-bold">{formatRupiah(l.netPay)}</span>
      ),
    },
  ];
}
