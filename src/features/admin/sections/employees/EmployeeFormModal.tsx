"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Combobox,
  DatePicker,
  Input,
  Modal,
  Select,
  toast,
  type ComboboxOption,
  type SelectOption,
} from "@/components/ui";
import {
  createEmployee,
  isOk,
  updateEmployee,
  type Employee,
  type EmploymentType,
} from "@/features/employees";
import { listUsers, type PublicUser } from "@/features/users";
import { isOk as usersIsOk } from "@/features/users";
import { formatRupiah, parseRupiah } from "@/lib/format";

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
  const [salaryInput, setSalaryInput] = useState("");
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSalaryInput(
      initial?.salaryAmount != null ? String(initial.salaryAmount) : "",
    );
    setUserId(initial?.userId ?? "");
    setNotes(initial?.notes ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    void (async () => {
      const res = await listUsers();
      if (cancelled) return;
      if (usersIsOk(res)) setUsers(res.data.items);
    })();
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

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    if (fullName.trim().length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    setSubmitting(true);

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
      salaryAmount: parsedSalary,
      userId: userId === "" ? null : userId,
      notes: notes.trim() || null,
    };

    const res = initial
      ? await updateEmployee({ id: initial.id, ...payload })
      : await createEmployee(payload);

    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(initial ? "Karyawan disimpan" : "Karyawan ditambahkan");
    onSaved();
  }

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
              placeholder="Mis. Kasir / Barista / Manager"
              disabled={submitting}
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
              label="Status Kepegawaian"
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
            <Input
              label="Gaji Pokok / Bulan"
              type="text"
              inputMode="numeric"
              value={salaryInput}
              onChange={(e) =>
                setSalaryInput(e.target.value.replace(/[^\d]/g, ""))
              }
              hint={
                parsedSalary !== null && parsedSalary > 0
                  ? `Preview: ${formatRupiah(parsedSalary)}`
                  : "Kosongkan kalau dibayar harian/freelance"
              }
              disabled={submitting}
            />
          </div>
        </Section>

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
