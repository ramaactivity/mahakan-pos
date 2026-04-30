"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  createSupplier,
  isOk,
  updateSupplier,
  type Supplier,
} from "@/features/suppliers";

interface SupplierFormModalProps {
  open: boolean;
  edit: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SupplierFormModal({
  open,
  edit,
  onClose,
  onSaved,
}: SupplierFormModalProps) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [category, setCategory] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("0");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(edit?.name ?? "");
    setContact(edit?.contact ?? "");
    setCategory(edit?.category ?? "");
    setPaymentTerm(String(edit?.defaultPaymentTermDays ?? 0));
    setNotes(edit?.notes ?? "");
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, edit]);

  async function onSubmit() {
    if (submitting) return;
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Nama wajib diisi");
      return;
    }
    const term = parseInt(paymentTerm, 10);
    if (!Number.isFinite(term) || term < 0) {
      setError("Term harus angka >= 0");
      return;
    }

    setSubmitting(true);
    const payload = {
      name: trimmedName,
      contact: contact.trim() || null,
      category: category.trim() || null,
      defaultPaymentTermDays: term,
      notes: notes.trim() || null,
    };

    const res = edit
      ? await updateSupplier(edit.id, payload)
      : await createSupplier(payload);
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(edit ? "Supplier diupdate" : "Supplier ditambah");
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? `Edit Supplier — ${edit.name}` : "Tambah Supplier"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {edit ? "Simpan" : "Tambah"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nama Supplier"
          placeholder="mis. Vina, Asep Roti, Bang Izza"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Kategori (opsional)"
            placeholder="mis. Beans, Cleaning, Belanja Pasar"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <Input
            label="Default TOP (hari)"
            type="text"
            inputMode="numeric"
            placeholder="0 = cash"
            value={paymentTerm}
            onChange={(e) => setPaymentTerm(e.target.value)}
            hint="Term of Payment default. 0 = cash on delivery."
          />
        </div>
        <Input
          label="Kontak (opsional)"
          placeholder="No HP / WhatsApp / email"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-900">
            Catatan (opsional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="mis. orang BCA, prefer call sebelum jam 9"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </div>
        {error ? (
          <p className="rounded-md bg-danger-100 p-2 text-sm text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
