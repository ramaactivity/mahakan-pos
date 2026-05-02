"use client";

import { useEffect, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  NumericInput,
  Select,
  toast,
} from "@/components/ui";
import { createAggregatorSettlement } from "@/features/finance/actions";
import type { AggregatorChannel } from "@/features/finance/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CHANNEL_OPTIONS: Array<{ value: AggregatorChannel; label: string }> = [
  { value: "edc_bca", label: "EDC BCA" },
  { value: "qris", label: "QRIS" },
  { value: "gofood", label: "GoFood" },
  { value: "grabfood", label: "GrabFood" },
  { value: "shopeefood", label: "ShopeeFood" },
];

function todayIso(): string {
  const wibOffset = 7 * 60 * 60 * 1000;
  return new Date(Date.now() + wibOffset).toISOString().slice(0, 10);
}

export function AggregatorSettlementModal({ open, onClose, onSaved }: Props) {
  const [channel, setChannel] = useState<AggregatorChannel>("edc_bca");
  const [periodFrom, setPeriodFrom] = useState<string | null>(todayIso());
  const [periodTo, setPeriodTo] = useState<string | null>(todayIso());
  const [grossAmount, setGrossAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("0");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    const t = todayIso();
    setChannel("edc_bca");
    setPeriodFrom(t);
    setPeriodTo(t);
    setGrossAmount("");
    setFeeAmount("0");
    setReferenceNo("");
    setNotes("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  async function onSubmit() {
    if (!periodFrom || !periodTo) {
      toast.error("Periode wajib diisi");
      return;
    }
    const gross = Number(grossAmount);
    const fee = Number(feeAmount || 0);
    if (!gross || gross < 0) {
      toast.error("Gross harus diisi");
      return;
    }
    if (fee > gross) {
      toast.error("Fee tidak boleh > gross");
      return;
    }
    if (periodTo < periodFrom) {
      toast.error("Periode akhir harus >= awal");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createAggregatorSettlement({
        channel,
        periodFrom,
        periodTo,
        grossAmount: gross,
        feeAmount: fee,
        referenceNo: referenceNo.trim() || null,
        notes: notes.trim() || null,
      });
      if (res.ok) {
        toast.success("Settlement aggregator dicatat");
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
      title="Catat Settlement Aggregator"
      size="lg"
    >
      <div className="space-y-4">
        <Select
          label="Channel"
          value={channel}
          onValueChange={(v) => setChannel(v as AggregatorChannel)}
          options={CHANNEL_OPTIONS}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            label="Periode (Dari)"
            value={periodFrom}
            onChange={setPeriodFrom}
            required
          />
          <DatePicker
            label="Periode (Sampai)"
            value={periodTo}
            onChange={setPeriodTo}
            required
          />
        </div>
        <NumericInput
          label="Gross (sebelum fee)"
          value={grossAmount}
          onChange={setGrossAmount}
          prefix="Rp"
          formatThousands
          required
        />
        <NumericInput
          label="Fee / MDR (opsional)"
          value={feeAmount}
          onChange={setFeeAmount}
          prefix="Rp"
          formatThousands
          hint="Biarkan 0 kalau Mahakan tidak kena potongan"
        />
        <Input
          label="No. Referensi"
          placeholder="Statement bank / portal aggregator"
          value={referenceNo}
          onChange={(e) => setReferenceNo(e.target.value)}
        />
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
          {submitting ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>
    </Modal>
  );
}
