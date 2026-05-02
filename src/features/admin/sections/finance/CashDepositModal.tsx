"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  toast,
} from "@/components/ui";
import {
  createCashDeposit,
  updateCashDeposit,
} from "@/features/finance/actions";
import type { CashDeposit } from "@/features/finance/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, opens in edit mode (only pending deposits editable). */
  editing?: CashDeposit | null;
}

function todayIso(): string {
  const wibOffset = 7 * 60 * 60 * 1000;
  return new Date(Date.now() + wibOffset).toISOString().slice(0, 10);
}

export function CashDepositModal({ open, onClose, onSaved, editing }: Props) {
  const [depositDate, setDepositDate] = useState<string | null>(todayIso());
  const [amount, setAmount] = useState("");
  const [bankDestination, setBankDestination] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [coversFromDate, setCoversFromDate] = useState<string | null>(
    todayIso(),
  );
  const [coversToDate, setCoversToDate] = useState<string | null>(todayIso());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (editing) {
      setDepositDate(editing.depositDate);
      setAmount(String(editing.amount));
      setBankDestination(editing.bankDestination);
      setReferenceNo(editing.referenceNo ?? "");
      setPhotoUrl(editing.photoUrl ?? "");
      setNotes(editing.notes ?? "");
      setCoversFromDate(editing.coversFromDate);
      setCoversToDate(editing.coversToDate);
    } else {
      const t = todayIso();
      setDepositDate(t);
      setAmount("");
      setBankDestination("");
      setReferenceNo("");
      setPhotoUrl("");
      setNotes("");
      setCoversFromDate(t);
      setCoversToDate(t);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editing]);

  async function onSubmit() {
    if (!depositDate || !coversFromDate || !coversToDate) {
      toast.error("Tanggal wajib diisi");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Nominal harus lebih dari 0");
      return;
    }
    if (bankDestination.trim().length < 2) {
      toast.error("Tujuan bank wajib diisi");
      return;
    }
    if (coversToDate < coversFromDate) {
      toast.error("Periode akhir harus >= awal");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        depositDate,
        amount: amt,
        bankDestination: bankDestination.trim(),
        referenceNo: referenceNo.trim() || null,
        photoUrl: photoUrl.trim() || null,
        notes: notes.trim() || null,
        coversFromDate,
        coversToDate,
      };
      const res = editing
        ? await updateCashDeposit({ id: editing.id, ...payload })
        : await createCashDeposit(payload);
      if (res.ok) {
        toast.success(editing ? "Setoran diupdate" : "Setoran dicatat");
        onSaved();
        onClose();
      } else {
        toast.error(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={editing ? "Edit Setoran Tunai" : "Catat Setoran Tunai"}
      size="lg"
    >
      <div className="space-y-4">
        <DatePicker
          label="Tanggal Setor"
          value={depositDate}
          onChange={setDepositDate}
          required
        />
        <NumericInput
          label="Nominal"
          value={amount}
          onChange={setAmount}
          prefix="Rp"
          formatThousands
          required
        />
        <Input
          label="Tujuan Bank"
          placeholder="BCA — Owner 1234567890"
          value={bankDestination}
          onChange={(e) => setBankDestination(e.target.value)}
          required
        />
        <Input
          label="No. Referensi"
          placeholder="Slip / m-banking ref"
          value={referenceNo}
          onChange={(e) => setReferenceNo(e.target.value)}
        />
        <Input
          label="URL Foto Bukti"
          placeholder="https://..."
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          hint="Optional — paste link upload (Drive/Imgur/dst)"
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label="Periode (Dari)"
            value={coversFromDate}
            onChange={setCoversFromDate}
            required
            hint="Tanggal awal kas yg ditutupi setoran ini"
          />
          <DatePicker
            label="Periode (Sampai)"
            value={coversToDate}
            onChange={setCoversToDate}
            required
          />
        </div>
        <Input
          label="Catatan"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Batal
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Menyimpan…" : editing ? "Update" : "Simpan"}
        </Button>
      </div>
    </Modal>
  );
}
