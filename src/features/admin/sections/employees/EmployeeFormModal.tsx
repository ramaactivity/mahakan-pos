"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarClock, Plus, Trash2, UserCircle2, X } from "lucide-react";
import {
  differenceInDays,
  differenceInMonths,
  differenceInYears,
  parseISO,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import { format as formatDate } from "date-fns";
import {
  Badge,
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  Spinner,
  toast,
  type ComboboxOption,
  type SelectOption,
} from "@/components/ui";
import {
  createCareerHistoryEntry,
  createEmployee,
  deleteCareerHistoryEntry,
  isOk,
  listEmployeeCareerHistory,
  updateEmployee,
  type Employee,
  type EmployeeCareerHistoryEntry,
  type EmployeeStatus,
  type EmploymentType,
} from "@/features/employees";
import { listUsers, type PublicUser } from "@/features/users";
import { isOk as usersIsOk } from "@/features/users";
import { formatRupiah, parseRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

interface EmployeeFormModalProps {
  open: boolean;
  /** When set, edit existing employee; null = create. */
  initial: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPLOYMENT_TYPES: Array<{ value: EmploymentType; label: string }> = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Kontrak" },
  { value: "freelance", label: "Freelance" },
];

const STATUS_OPTIONS: Array<{
  value: EmployeeStatus;
  label: string;
  description: string;
}> = [
  {
    value: "active",
    label: "Aktif",
    description: "Karyawan aktif bekerja",
  },
  {
    value: "on_leave",
    label: "Cuti",
    description: "Sedang cuti / izin panjang (tetap akan kembali)",
  },
  {
    value: "resigned",
    label: "Resign",
    description: "Mengundurkan diri secara baik-baik",
  },
  {
    value: "terminated",
    label: "Terminated",
    description: "Diberhentikan / kontrak berakhir",
  },
];

const STATUS_BADGE: Record<
  EmployeeStatus,
  { variant: "success" | "warning" | "neutral" | "danger"; label: string }
> = {
  active: { variant: "success", label: "Aktif" },
  on_leave: { variant: "warning", label: "Cuti" },
  resigned: { variant: "neutral", label: "Resign" },
  terminated: { variant: "danger", label: "Terminated" },
};

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Kontrak",
  freelance: "Freelance",
};

export function EmployeeFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: EmployeeFormModalProps) {
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [nik, setNik] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">("");
  /* Sesi AE-60 — dual salary mechanism */
  const [paymentType, setPaymentType] = useState<"daily" | "monthly" | "">("");
  const [salaryInput, setSalaryInput] = useState("");
  const [dailyRateInput, setDailyRateInput] = useState("");
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<EmployeeStatus>("active");
  const [resignedAt, setResignedAt] = useState("");
  const [resignReason, setResignReason] = useState("");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [careerHistory, setCareerHistory] = useState<
    EmployeeCareerHistoryEntry[]
  >([]);
  const [careerLoading, setCareerLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual career entry sub-form state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [manualPosition, setManualPosition] = useState("");
  const [manualDepartment, setManualDepartment] = useState("");
  const [manualEmploymentType, setManualEmploymentType] =
    useState<EmploymentType | "">("");
  const [manualSalary, setManualSalary] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSubmitting(false);
    setError(null);
    setFullName(initial?.fullName ?? "");
    setNickname(initial?.nickname ?? "");
    setNik(initial?.nik ?? "");
    setEmail(initial?.email ?? "");
    setPhone(initial?.phone ?? "");
    setAddress(initial?.address ?? "");
    setDateOfBirth(initial?.dateOfBirth ?? "");
    setEmployeeNumber(initial?.employeeNumber ?? "");
    setPosition(initial?.position ?? "");
    setDepartment(initial?.department ?? "");
    setHireDate(initial?.hireDate ?? "");
    setEmploymentType(initial?.employmentType ?? "");
    setPaymentType(
      (initial as { paymentType?: "daily" | "monthly" | null } | null)?.paymentType ??
        "",
    );
    setSalaryInput(
      initial?.salaryAmount != null ? String(initial.salaryAmount) : "",
    );
    setDailyRateInput(
      (initial as { dailyRate?: number | null } | null)?.dailyRate != null
        ? String((initial as { dailyRate?: number | null }).dailyRate)
        : "",
    );
    setUserId(initial?.userId ?? "");
    setNotes(initial?.notes ?? "");
    setStatus(initial?.status ?? "active");
    setResignedAt(
      initial?.resignedAt
        ? new Date(initial.resignedAt).toISOString().slice(0, 10)
        : "",
    );
    setResignReason(initial?.resignReason ?? "");
    setCareerHistory([]);
    setManualOpen(false);
    setManualDate("");
    setManualPosition("");
    setManualDepartment("");
    setManualEmploymentType("");
    setManualSalary("");
    setManualNote("");
    setManualSubmitting(false);
    setManualError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    void (async () => {
      try {
        const res = await listUsers();
        if (cancelled) return;
        if (usersIsOk(res)) setUsers(res.data.items);
      } catch {
        /* ignore */
      }
    })();

    // Load career history only when editing existing employee.
    if (initial) {
      setCareerLoading(true);
      void (async () => {
        try {
          const res = await listEmployeeCareerHistory(initial.id);
          if (cancelled) return;
          if (isOk(res)) setCareerHistory(res.data);
        } catch {
          /* ignore */
        } finally {
          if (!cancelled) setCareerLoading(false);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [open, initial]);

  let parsedSalary: number | null = null;
  if (salaryInput.trim().length > 0) {
    try {
      const n = parseRupiah(salaryInput);
      parsedSalary = n >= 0 ? n : null;
    } catch {
      parsedSalary = null;
    }
  }

  async function refetchCareerHistory(employeeId: string) {
    setCareerLoading(true);
    try {
      const res = await listEmployeeCareerHistory(employeeId);
      if (isOk(res)) setCareerHistory(res.data);
    } finally {
      setCareerLoading(false);
    }
  }

  async function handleManualSubmit() {
    if (!initial || manualSubmitting) return;
    setManualError(null);
    if (!manualDate) {
      setManualError("Tanggal efektif wajib diisi");
      return;
    }
    let salary: number | null = null;
    if (manualSalary.trim().length > 0) {
      try {
        const n = parseRupiah(manualSalary);
        salary = n >= 0 ? n : null;
      } catch {
        setManualError("Format gaji tidak valid");
        return;
      }
    }
    setManualSubmitting(true);
    const res = await createCareerHistoryEntry({
      employeeId: initial.id,
      effectiveDate: manualDate,
      position: manualPosition.trim() || null,
      department: manualDepartment.trim() || null,
      employmentType: manualEmploymentType === "" ? null : manualEmploymentType,
      salaryAmount: salary,
      note: manualNote.trim() || null,
    });
    setManualSubmitting(false);
    if (!isOk(res)) {
      setManualError(res.error.message);
      return;
    }
    toast.success("Riwayat karir ditambahkan");
    // Reset form + close
    setManualOpen(false);
    setManualDate("");
    setManualPosition("");
    setManualDepartment("");
    setManualEmploymentType("");
    setManualSalary("");
    setManualNote("");
    void refetchCareerHistory(initial.id);
  }

  async function handleDeleteEntry(entry: EmployeeCareerHistoryEntry) {
    if (!initial) return;
    const label = `${entry.position ?? "—"} (${entry.effectiveDate})`;
    if (!confirm(`Hapus riwayat karir "${label}"? Tindakan ini akan tercatat di audit log.`)) {
      return;
    }
    const res = await deleteCareerHistoryEntry(entry.id);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Riwayat karir dihapus");
    void refetchCareerHistory(initial.id);
  }

  const tenure = useMemo(() => {
    if (!hireDate) return null;
    return computeTenure(hireDate, status === "resigned" || status === "terminated" ? resignedAt : null);
  }, [hireDate, status, resignedAt]);

  const isResigned = status === "resigned" || status === "terminated";

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    if (fullName.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    if (isResigned && resignReason.trim().length === 0) {
      setError("Alasan resign / terminated wajib diisi");
      return;
    }
    setSubmitting(true);

    /* Sesi AE-60 — parse dailyRate */
    let parsedDailyRate: number | null = null;
    if (dailyRateInput.trim().length > 0) {
      try {
        const n = parseRupiah(dailyRateInput);
        parsedDailyRate = n >= 0 ? n : null;
      } catch {
        parsedDailyRate = null;
      }
    }

    /* Sesi AE-60 — validate paymentType=daily wajib dailyRate > 0 */
    if (paymentType === "daily" && (parsedDailyRate == null || parsedDailyRate <= 0)) {
      setError("Karyawan tipe Harian wajib punya tarif harian (Rp/hari) > 0");
      setSubmitting(false);
      return;
    }

    const payload = {
      fullName: fullName.trim(),
      nickname: nickname.trim() || null,
      nik: nik.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      dateOfBirth: dateOfBirth || null,
      employeeNumber: employeeNumber.trim() || null,
      position: position.trim() || null,
      department: department.trim() || null,
      hireDate: hireDate || null,
      employmentType: employmentType === "" ? null : employmentType,
      paymentType: paymentType === "" ? null : paymentType,
      salaryAmount: parsedSalary,
      dailyRate: parsedDailyRate,
      userId: userId === "" ? null : userId,
      notes: notes.trim() || null,
    };

    const res = initial
      ? await updateEmployee({
          id: initial.id,
          ...payload,
          status,
          resignedAt: isResigned ? (resignedAt || new Date().toISOString().slice(0, 10)) : null,
          resignReason: isResigned ? resignReason.trim() || null : null,
        })
      : await createEmployee(payload);

    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(initial ? "Karyawan disimpan" : "Karyawan ditambahkan");
    onSaved();
  }

  const statusBadge = STATUS_BADGE[status];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit Karyawan — ${initial.fullName}` : "Tambah Karyawan"}
      description="Data master karyawan. Field yang diberi tanda * wajib."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting} size="lg">
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Header summary card — only when editing existing employee */}
        {initial && tenure ? (
          <div className="grid gap-3 rounded-xl border border-mahakan-green-200 bg-mahakan-green-50/40 p-4 sm:grid-cols-3">
            <SummaryStat
              icon={<UserCircle2 className="size-4" aria-hidden />}
              label="Status"
              value={
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              }
            />
            <SummaryStat
              icon={<CalendarClock className="size-4" aria-hidden />}
              label="Tanggal Masuk"
              value={formatIndonesianDate(hireDate)}
              hint={tenure.untilLabel}
            />
            <SummaryStat
              icon={<Briefcase className="size-4" aria-hidden />}
              label="Lama Bekerja"
              value={tenure.label}
              hint={
                position
                  ? `Posisi: ${position}${department ? ` · ${department}` : ""}`
                  : undefined
              }
            />
          </div>
        ) : null}

        <Section title="Identitas">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Nama Lengkap *"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value.slice(0, 120))}
              required
              disabled={submitting}
            />
            <Input
              label="Panggilan"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 60))}
              disabled={submitting}
            />
            <Input
              label="NIK / KTP"
              type="text"
              inputMode="numeric"
              value={nik}
              onChange={(e) =>
                setNik(e.target.value.replace(/[^\d]/g, "").slice(0, 32))
              }
              disabled={submitting}
            />
            <DatePicker
              label="Tanggal Lahir"
              value={dateOfBirth || null}
              onChange={(v) => setDateOfBirth(v ?? "")}
              disabled={submitting}
              placeholder="Pilih tanggal lahir"
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.slice(0, 120))}
              disabled={submitting}
            />
            <Input
              label="No. HP"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.slice(0, 32))}
              disabled={submitting}
            />
          </div>
          <Input
            label="Alamat"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value.slice(0, 500))}
            disabled={submitting}
          />
        </Section>

        <Section title="Kepegawaian">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Nomor Karyawan"
              type="text"
              value={employeeNumber}
              onChange={(e) =>
                setEmployeeNumber(e.target.value.slice(0, 32).toUpperCase())
              }
              placeholder="Mis. MK-001"
              disabled={submitting}
            />
            <DatePicker
              label="Tanggal Masuk"
              value={hireDate || null}
              onChange={(v) => setHireDate(v ?? "")}
              disabled={submitting}
              placeholder="Pilih tanggal masuk"
            />
            <Input
              label="Posisi"
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value.slice(0, 80))}
              placeholder="Mis. Helper / Barista / Head Bar"
              disabled={submitting}
              hint={
                initial && initial.position && initial.position !== position.trim()
                  ? `Sebelumnya: ${initial.position}`
                  : undefined
              }
            />
            <Input
              label="Departemen"
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value.slice(0, 80))}
              placeholder="Mis. Service / Kitchen / Bar"
              disabled={submitting}
            />
            <Select
              label="Tipe Kepegawaian"
              value={employmentType === "" ? undefined : employmentType}
              onValueChange={(v) =>
                setEmploymentType(v === "" ? "" : (v as EmploymentType))
              }
              placeholder="— Belum diset —"
              disabled={submitting}
              options={EMPLOYMENT_TYPES.map<SelectOption>((t) => ({
                value: t.value,
                label: t.label,
              }))}
            />
            {/* Sesi AE-60 — Mekanisme Gaji (paymentType + conditional rate) */}
            <Select
              label="Mekanisme Gaji"
              value={paymentType === "" ? undefined : paymentType}
              onValueChange={(v) =>
                setPaymentType(v === "" ? "" : (v as "daily" | "monthly"))
              }
              placeholder="— Pilih mekanisme —"
              disabled={submitting}
              options={[
                {
                  value: "monthly",
                  label: "Bulanan Tetap (gaji flat per bulan)",
                },
                {
                  value: "daily",
                  label: "Harian (gaji = tarif × hari masuk)",
                },
              ]}
            />
            {paymentType === "daily" ? (
              <Input
                label="Tarif Harian (Rp/hari) *"
                type="text"
                inputMode="numeric"
                value={dailyRateInput}
                onChange={(e) =>
                  setDailyRateInput(e.target.value.replace(/[^\d]/g, ""))
                }
                hint="Gaji = Tarif Harian × jumlah hari masuk dari attendance"
                disabled={submitting}
              />
            ) : (
              <Input
                label={
                  paymentType === "monthly"
                    ? "Gaji Pokok / Bulan *"
                    : "Gaji Pokok / Bulan"
                }
                type="text"
                inputMode="numeric"
                value={salaryInput}
                onChange={(e) =>
                  setSalaryInput(e.target.value.replace(/[^\d]/g, ""))
                }
                hint={
                  paymentType === "monthly"
                    ? "Gaji bulanan flat — tidak tergantung jumlah hari masuk"
                    : parsedSalary !== null && parsedSalary > 0
                      ? `Preview: ${formatRupiah(parsedSalary)}${
                          initial &&
                          initial.salaryAmount !== null &&
                          initial.salaryAmount !== parsedSalary
                            ? ` · sebelumnya ${formatRupiah(initial.salaryAmount)}`
                            : ""
                        }`
                      : "Pilih mekanisme dulu"
                }
                disabled={submitting}
              />
            )}
          </div>
        </Section>

        {/* Status section — only meaningful for existing employees. For new
            employees we always start as active. */}
        {initial ? (
          <Section title="Status & Lifecycle">
            <div className="space-y-3">
              <div
                role="radiogroup"
                aria-label="Status karyawan"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={status === opt.value}
                    onClick={() => setStatus(opt.value)}
                    disabled={submitting}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                      status === opt.value
                        ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                    )}
                  >
                    <span className="text-sm font-semibold">{opt.label}</span>
                    <span className="text-[11px] text-neutral-500">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>

              {isResigned ? (
                <div className="grid grid-cols-2 gap-3">
                  <DatePicker
                    label="Tanggal Resign / Terminated"
                    value={resignedAt || null}
                    onChange={(v) => setResignedAt(v ?? "")}
                    disabled={submitting}
                    placeholder="Pilih tanggal akhir"
                    minDate={hireDate || undefined}
                  />
                  <Input
                    label={status === "resigned" ? "Alasan Resign *" : "Alasan Terminated *"}
                    type="text"
                    value={resignReason}
                    onChange={(e) =>
                      setResignReason(e.target.value.slice(0, 500))
                    }
                    placeholder={
                      status === "resigned"
                        ? "Mis. Pindah kota / lanjut kuliah"
                        : "Mis. Kontrak berakhir / pelanggaran"
                    }
                    disabled={submitting}
                    required
                  />
                </div>
              ) : null}

              {status === "on_leave" ? (
                <p className="rounded-md border border-warning-500/30 bg-warning-100/30 px-3 py-2 text-xs text-warning-700">
                  Karyawan tidak akan muncul di kiosk Absensi sampai status
                  diubah kembali ke <strong>Aktif</strong>.
                </p>
              ) : null}
            </div>
          </Section>
        ) : null}

        {/* Career history — only when editing */}
        {initial ? (
          <Section title="Riwayat Karir">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 text-xs text-neutral-500">
                  Otomatis tercatat saat posisi / departemen / tipe / gaji
                  berubah. Tambah manual untuk backfill historis sebelum
                  sistem dipakai.
                </p>
                {!manualOpen ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setManualOpen(true)}
                    disabled={submitting}
                  >
                    <Plus className="size-3.5" aria-hidden /> Tambah Manual
                  </Button>
                ) : null}
              </div>

              {/* Manual entry inline form */}
              {manualOpen ? (
                <div className="space-y-3 rounded-md border border-mahakan-green-200 bg-mahakan-green-50/30 p-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-mahakan-green-900">
                      Backfill Riwayat Karir
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setManualOpen(false);
                        setManualError(null);
                      }}
                      aria-label="Tutup form"
                      className="rounded-sm p-1 text-neutral-500 hover:bg-neutral-100"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <DatePicker
                      label="Tanggal Efektif *"
                      value={manualDate || null}
                      onChange={(v) => setManualDate(v ?? "")}
                      placeholder="Kapan posisi ini mulai"
                      disabled={manualSubmitting}
                      required
                    />
                    <Input
                      label="Posisi"
                      type="text"
                      value={manualPosition}
                      onChange={(e) =>
                        setManualPosition(e.target.value.slice(0, 80))
                      }
                      placeholder="Mis. Helper / Barista"
                      disabled={manualSubmitting}
                    />
                    <Input
                      label="Departemen"
                      type="text"
                      value={manualDepartment}
                      onChange={(e) =>
                        setManualDepartment(e.target.value.slice(0, 80))
                      }
                      placeholder="Mis. Bar / Service"
                      disabled={manualSubmitting}
                    />
                    <Select
                      label="Tipe"
                      value={
                        manualEmploymentType === ""
                          ? undefined
                          : manualEmploymentType
                      }
                      onValueChange={(v) =>
                        setManualEmploymentType(
                          v === "" ? "" : (v as EmploymentType),
                        )
                      }
                      placeholder="— Pilih tipe —"
                      disabled={manualSubmitting}
                      options={EMPLOYMENT_TYPES.map<SelectOption>((t) => ({
                        value: t.value,
                        label: t.label,
                      }))}
                    />
                    <Input
                      label="Gaji saat itu (Rp)"
                      type="text"
                      inputMode="numeric"
                      value={manualSalary}
                      onChange={(e) =>
                        setManualSalary(e.target.value.replace(/\D/g, ""))
                      }
                      hint={
                        manualSalary
                          ? `Preview: ${formatRupiah(parseInt(manualSalary, 10) || 0)}`
                          : undefined
                      }
                      disabled={manualSubmitting}
                    />
                    <Input
                      label="Catatan"
                      type="text"
                      value={manualNote}
                      onChange={(e) =>
                        setManualNote(e.target.value.slice(0, 500))
                      }
                      placeholder="Mis. Promosi ke Head Bar"
                      disabled={manualSubmitting}
                    />
                  </div>
                  {manualError ? (
                    <p
                      role="alert"
                      className="text-xs font-medium text-danger-500"
                    >
                      {manualError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setManualOpen(false);
                        setManualError(null);
                      }}
                      disabled={manualSubmitting}
                    >
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleManualSubmit}
                      loading={manualSubmitting}
                    >
                      Simpan Entry
                    </Button>
                  </div>
                </div>
              ) : null}

              {careerLoading ? (
                <div className="flex h-16 items-center justify-center">
                  <Spinner className="size-4 text-mahakan-green-700" />
                </div>
              ) : careerHistory.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-center text-xs italic text-neutral-500">
                  Belum ada riwayat tercatat.
                </p>
              ) : (
                <ol className="relative space-y-3 border-l border-mahakan-green-200 pl-5">
                  {careerHistory.map((entry, idx) => (
                    <li key={entry.id} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[1.45rem] top-1.5 size-3 rounded-full border-2 border-white shadow",
                          idx === 0
                            ? "bg-mahakan-green-700"
                            : "bg-neutral-400",
                        )}
                        aria-hidden
                      />
                      <div className="group rounded-md border border-neutral-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-neutral-900">
                                {entry.position ?? "—"}
                              </span>
                              {entry.department ? (
                                <span className="text-xs text-neutral-500">
                                  · {entry.department}
                                </span>
                              ) : null}
                              {entry.employmentType ? (
                                <Badge variant="neutral">
                                  {
                                    EMPLOYMENT_TYPE_LABELS[
                                      entry.employmentType as EmploymentType
                                    ]
                                  }
                                </Badge>
                              ) : null}
                              {entry.source === "manual" ? (
                                <Badge variant="info">Manual</Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-neutral-500">
                              {formatIndonesianDate(entry.effectiveDate)}
                              {entry.salaryAmount !== null
                                ? ` · ${formatRupiah(entry.salaryAmount)}`
                                : ""}
                            </p>
                            {entry.note ? (
                              <p className="mt-1 text-xs italic text-neutral-600">
                                {entry.note}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry)}
                            aria-label="Hapus entry"
                            className="rounded-sm p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-danger-100/40 hover:text-danger-500 focus:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>
        ) : null}

        <Section title="Akun & Catatan">
          <div>
            <Combobox
              label="Tautkan ke Akun POS / Back Office (opsional)"
              value={userId === "" ? null : userId}
              onChange={(v) => setUserId(v ?? "")}
              placeholder="— Belum dilink —"
              disabled={submitting}
              options={users.map<ComboboxOption>((u) => ({
                value: u.id,
                label: u.name,
                hint: `${u.role}${u.email ? ` · ${u.email}` : ""}`,
              }))}
              hint="Tambah / kelola akun login dulu di tab Staff. Kalau karyawan gak butuh login (dishwasher, runner), tinggalkan kosong."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-900">
              Catatan Internal
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
              rows={3}
              placeholder="Catatan HR, performance notes, dll."
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700"
              disabled={submitting}
            />
          </div>
        </Section>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-neutral-900">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-neutral-900">{value}</div>
      {hint ? (
        <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>
      ) : null}
    </div>
  );
}

interface TenureResult {
  /** "1 tahun 3 bulan" or "5 hari" */
  label: string;
  /** "sampai sekarang" or "sampai 12 Mei 2026" */
  untilLabel: string;
}

function computeTenure(
  hireDateIso: string,
  resignedAtIso: string | null,
): TenureResult | null {
  let start: Date;
  try {
    start = parseISO(hireDateIso);
  } catch {
    return null;
  }
  const end = resignedAtIso ? parseISO(resignedAtIso) : new Date();
  if (end < start) return null;

  const years = differenceInYears(end, start);
  const monthsTotal = differenceInMonths(end, start);
  const months = monthsTotal - years * 12;
  const days = differenceInDays(
    end,
    new Date(start.getFullYear() + years, start.getMonth() + months, start.getDate()),
  );

  let label: string;
  if (years > 0) {
    label = months > 0 ? `${years} tahun ${months} bulan` : `${years} tahun`;
  } else if (monthsTotal > 0) {
    label = days > 0 ? `${monthsTotal} bulan ${days} hari` : `${monthsTotal} bulan`;
  } else {
    label = `${differenceInDays(end, start)} hari`;
  }

  const untilLabel = resignedAtIso
    ? `sampai ${formatIndonesianDate(resignedAtIso)}`
    : "sampai sekarang";

  return { label, untilLabel };
}

function formatIndonesianDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDate(parseISO(iso), "d MMM yyyy", { locale: localeId });
  } catch {
    return iso;
  }
}
