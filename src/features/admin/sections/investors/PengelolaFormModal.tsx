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
  createPengelola,
  isOk,
  updatePengelola,
  type Pengelola,
  type PengelolaStatus,
} from "@/features/pengelola";
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

interface PengelolaFormModalProps {
  open: boolean;
  initial: Pengelola | null;
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Tidak aktif" },
  { value: "exited", label: "Keluar" },
];

export function PengelolaFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: PengelolaFormModalProps) {
  const editing = initial !== null;
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [nik, setNik] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [modalInput, setModalInput] = useState("");
  const [status, setStatus] = useState<PengelolaStatus>("active");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setErr(null);
    if (initial) {
      setFullName(initial.fullName);
      setNik(initial.nik ?? "");
      setEmail(initial.email ?? "");
      setPhone(initial.phone ?? "");
      setBankName(initial.bankName ?? "");
      setBankAccountNumber(initial.bankAccountNumber ?? "");
      setBankAccountHolderName(initial.bankAccountHolderName ?? "");
      setModalInput(String(initial.modalDisetor ?? 0));
      setStatus(initial.status);
      setNotes(initial.notes ?? "");
    } else {
      setFullName("");
      setNik("");
      setEmail("");
      setPhone("");
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
      nik: nik.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      bankName: bankName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
      bankAccountHolderName: bankAccountHolderName.trim() || null,
      modalDisetor: modal,
      status,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    const res = editing
      ? await updatePengelola(initial!.id, payload)
      : await createPengelola(payload);
    setSubmitting(false);

    if (!isOk(res)) {
      setErr(res.error.message);
      return;
    }
    toast.success(
      editing
        ? `Pengelola ${res.data.fullName} di-update`
        : `Pengelola ${res.data.fullName} ditambahkan`,
    );
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit Pengelola" : "Tambah Pengelola"}
      description={
        editing
          ? `Update profil ${initial?.fullName}`
          : "Pengelola adalah shareholder yang juga manage Mahakan. Mereka dapat dividen 65% pool (bukan gaji bulanan)."
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {editing ? "Simpan" : "Tambah"}
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
          className="md:col-span-2"
        />
        <Input
          label="NIK"
          value={nik}
          onChange={(e) =>
            setNik(e.target.value.replace(/\D/g, "").slice(0, 16))
          }
          disabled={submitting}
        />
        <Input
          label="No. HP"
          value={phone}
          onChange={(e) => setPhone(e.target.value.slice(0, 20))}
          disabled={submitting}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value.slice(0, 120))}
          disabled={submitting}
          className="md:col-span-2"
          hint="Untuk auto-kirim statement dividen"
        />
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
              : undefined
          }
        />
        <Select
          label="Status"
          value={status}
          onValueChange={(v) =>
            setStatus((v ?? "active") as PengelolaStatus)
          }
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
        />
        <Input
          label="Catatan"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          disabled={submitting}
          className="md:col-span-2"
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
