"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Modal,
  Select,
  toast,
  type SelectOption,
} from "@/components/ui";
import {
  createInvestor,
  isOk,
  updateInvestor,
  type Investor,
  type InvestorStatus,
} from "@/features/investors";
import { formatRupiah, parseRupiah } from "@/lib/format";

/** Defensive wrapper — parseRupiah throws on empty/invalid input.
 *  Render path tidak boleh throw, jadi fallback ke 0. */
function safeParseRupiah(s: string): number {
  if (!s || s.trim() === "") return 0;
  try {
    return parseRupiah(s);
  } catch {
    return 0;
  }
}

interface InvestorFormModalProps {
  open: boolean;
  initial: Investor | null;
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Tidak aktif" },
  { value: "exited", label: "Keluar (Exit)" },
];

export function InvestorFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: InvestorFormModalProps) {
  const editing = initial !== null;
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [nik, setNik] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [occupation, setOccupation] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [modalInput, setModalInput] = useState("");
  const [status, setStatus] = useState<InvestorStatus>("active");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setErr(null);
    if (initial) {
      setFullName(initial.fullName);
      setNickname(initial.nickname ?? "");
      setNik(initial.nik ?? "");
      setEmail(initial.email ?? "");
      setPhone(initial.phone ?? "");
      setAddress(initial.address ?? "");
      setDateOfBirth(initial.dateOfBirth ?? "");
      setOccupation(initial.occupation ?? "");
      setIgHandle(initial.igHandle ?? "");
      setBankName(initial.bankName ?? "");
      setBankAccountNumber(initial.bankAccountNumber ?? "");
      setBankAccountHolderName(initial.bankAccountHolderName ?? "");
      setModalInput(String(initial.modalDisetor ?? 0));
      setStatus(initial.status);
      setNotes(initial.notes ?? "");
    } else {
      setFullName("");
      setNickname("");
      setNik("");
      setEmail("");
      setPhone("");
      setAddress("");
      setDateOfBirth("");
      setOccupation("");
      setIgHandle("");
      setBankName("");
      setBankAccountNumber("");
      setBankAccountHolderName("");
      setModalInput("");
      setStatus("active");
      setNotes("");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  async function onSubmit() {
    if (submitting) return;
    setErr(null);

    const modal = safeParseRupiah(modalInput);
    if (!Number.isFinite(modal) || modal < 0) {
      setErr("Modal harus angka non-negatif");
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
      occupation: occupation.trim() || null,
      igHandle: igHandle.trim() || null,
      bankName: bankName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
      bankAccountHolderName: bankAccountHolderName.trim() || null,
      modalDisetor: modal,
      status,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    const res = editing
      ? await updateInvestor(initial!.id, payload)
      : await createInvestor(payload);
    setSubmitting(false);

    if (!isOk(res)) {
      setErr(res.error.message);
      return;
    }
    toast.success(
      editing
        ? `Investor ${res.data.fullName} di-update`
        : `Investor ${res.data.fullName} ditambahkan`,
    );
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit Investor" : "Tambah Investor"}
      description={
        editing
          ? `Update profil ${initial?.fullName}`
          : "Isi data investor baru — minimal nama + modal disetor."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {editing ? "Simpan" : "Tambah Investor"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Nama Lengkap *"
          value={fullName}
          onChange={(e) => setFullName(e.target.value.slice(0, 120))}
          disabled={submitting}
          required
        />
        <Input
          label="Panggilan / Nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 60))}
          disabled={submitting}
        />
        <Input
          label="NIK (16 digit)"
          value={nik}
          onChange={(e) =>
            setNik(e.target.value.replace(/\D/g, "").slice(0, 16))
          }
          disabled={submitting}
          hint="Opsional, unique kalau di-set"
        />
        <Input
          label="Tanggal Lahir"
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          disabled={submitting}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.slice(0, 120))}
          disabled={submitting}
          hint="Untuk auto-kirim statement dividen bulanan"
        />
        <Input
          label="No. HP"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.slice(0, 20))}
          disabled={submitting}
        />
        <Input
          label="Pekerjaan"
          value={occupation}
          onChange={(e) => setOccupation(e.target.value.slice(0, 80))}
          disabled={submitting}
        />
        <Input
          label="Instagram"
          value={igHandle}
          onChange={(e) => setIgHandle(e.target.value.slice(0, 60))}
          disabled={submitting}
          placeholder="@username"
        />
        <Input
          label="Alamat"
          value={address}
          onChange={(e) => setAddress(e.target.value.slice(0, 500))}
          disabled={submitting}
          className="md:col-span-2"
        />
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">
          Investasi & Bank
        </h4>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Modal Disetor (Rp) *"
            value={modalInput}
            onChange={(e) =>
              setModalInput(e.target.value.replace(/[^\d]/g, ""))
            }
            inputMode="numeric"
            disabled={submitting}
            hint={
              safeParseRupiah(modalInput) > 0
                ? `= ${formatRupiah(safeParseRupiah(modalInput))}`
                : "Angka rupiah tanpa titik"
            }
          />
          <Select
            label="Status"
            value={status}
            onValueChange={(v) => setStatus((v ?? "active") as InvestorStatus)}
            options={STATUS_OPTIONS}
            disabled={submitting}
          />
          <Input
            label="Bank"
            value={bankName}
            onChange={(e) => setBankName(e.target.value.slice(0, 40))}
            disabled={submitting}
          />
          <Input
            label="No. Rekening"
            value={bankAccountNumber}
            onChange={(e) =>
              setBankAccountNumber(e.target.value.slice(0, 40))
            }
            disabled={submitting}
          />
          <Input
            label="Atas Nama"
            value={bankAccountHolderName}
            onChange={(e) =>
              setBankAccountHolderName(e.target.value.slice(0, 120))
            }
            disabled={submitting}
            className="md:col-span-2"
            hint="Boleh beda dari nama lengkap (rekening family OK)"
          />
        </div>
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-4">
        <Input
          label="Catatan"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          disabled={submitting}
        />
      </div>

      {err ? (
        <p
          role="alert"
          className="mt-3 rounded-md bg-danger-100/60 px-3 py-2 text-sm font-medium text-danger-500"
        >
          {err}
        </p>
      ) : null}
    </Modal>
  );
}
