"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, toast } from "@/components/ui";
import {
  createInternalDebtParty,
  isOk,
  updateInternalDebtParty,
  PARTY_TYPE_LABELS,
  type InternalDebtParty,
  type InternalDebtPartyType,
} from "@/features/internal-debts";

/**
 * Sesi AE-180 — Form pihak hutang internal (create/edit).
 * initial=null → create, initial=row → edit.
 */

interface InternalDebtPartyFormModalProps {
  open: boolean;
  initial: InternalDebtParty | null;
  onClose: () => void;
  onSaved: () => void;
}

export function InternalDebtPartyFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: InternalDebtPartyFormModalProps) {
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<InternalDebtPartyType>("owner");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(initial?.name ?? "");
    setPartyType((initial?.partyType as InternalDebtPartyType) ?? "owner");
    setPhone(initial?.phone ?? "");
    setBankName(initial?.bankName ?? "");
    setBankAccountNumber(initial?.bankAccountNumber ?? "");
    setBankAccountHolderName(initial?.bankAccountHolderName ?? "");
    setNotes(initial?.notes ?? "");
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  async function handleSubmit() {
    if (submitting) return;
    if (name.trim().length < 2) {
      toast.error("Nama minimal 2 karakter");
      return;
    }
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      partyType,
      phone: phone.trim() || null,
      bankName: bankName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
      bankAccountHolderName: bankAccountHolderName.trim() || null,
      notes: notes.trim() || null,
    };
    const res = initial
      ? await updateInternalDebtParty({ id: initial.id, ...payload })
      : await createInternalDebtParty(payload);
    setSubmitting(false);
    if (!isOk(res)) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      initial ? `${name.trim()} di-update` : `${name.trim()} ditambahkan`,
    );
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit Pihak — ${initial.name}` : "Tambah Pihak"}
      description="Orang yang dipinjami uang oleh bisnis (owner/manager/pihak internal lain)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {initial ? "Simpan" : "Tambah"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Nama Lengkap"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mis. Rama (Owner)"
            maxLength={120}
          />
          <Select
            label="Tipe"
            options={(
              Object.entries(PARTY_TYPE_LABELS) as Array<
                [InternalDebtPartyType, string]
              >
            ).map(([value, label]) => ({ value, label }))}
            value={partyType}
            onValueChange={(v) => setPartyType(v as InternalDebtPartyType)}
          />
        </div>
        <Input
          label="No. HP (opsional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={30}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label="Bank (opsional)"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="BCA"
            maxLength={60}
          />
          <Input
            label="No. Rekening"
            value={bankAccountNumber}
            onChange={(e) => setBankAccountNumber(e.target.value)}
            maxLength={40}
          />
          <Input
            label="Atas Nama"
            value={bankAccountHolderName}
            onChange={(e) => setBankAccountHolderName(e.target.value)}
            maxLength={120}
          />
        </div>
        <Input
          label="Catatan (opsional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </div>
    </Modal>
  );
}
