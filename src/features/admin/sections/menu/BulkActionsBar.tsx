"use client";

import { useState } from "react";
import { Button, Input, Modal } from "@/components/ui";

interface BulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onMarkSoldOut: () => Promise<void>;
  onMarkAvailable: () => Promise<void>;
  onAdjustPrice: (pct: number) => Promise<void>;
}

export function BulkActionsBar({
  selectedCount,
  onClear,
  onMarkSoldOut,
  onMarkAvailable,
  onAdjustPrice,
}: BulkActionsBarProps) {
  const [showPctModal, setShowPctModal] = useState(false);
  const [pctText, setPctText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (selectedCount === 0) return null;

  async function applyPct() {
    const trimmed = pctText.trim();
    const pct = Number(trimmed);
    if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) {
      setError("Persen harus angka antara -99 dan 1000");
      return;
    }
    setSubmitting(true);
    setError(null);
    await onAdjustPrice(pct);
    setSubmitting(false);
    setShowPctModal(false);
    setPctText("");
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-mahakan-green-700 bg-mahakan-green-50 px-4 py-2.5">
        <span className="text-sm font-medium text-mahakan-green-900">
          {selectedCount} item dipilih
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={onMarkSoldOut}>
            Mark Sold Out
          </Button>
          <Button size="sm" variant="ghost" onClick={onMarkAvailable}>
            Mark Available
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowPctModal(true)}>
            Adjust Price %
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Batal
          </Button>
        </div>
      </div>

      <Modal
        open={showPctModal}
        onClose={() => setShowPctModal(false)}
        title={`Sesuaikan harga ${selectedCount} item`}
        description='Masukkan persen perubahan. "10" = naik 10%, "-5" = turun 5%. Item open-price (Manual Brew) di-skip.'
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowPctModal(false)} disabled={submitting}>
              Batal
            </Button>
            <Button onClick={applyPct} loading={submitting}>
              Terapkan
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="Persen perubahan"
            type="text"
            inputMode="decimal"
            value={pctText}
            onChange={(e) => setPctText(e.target.value)}
            placeholder="10"
            trailingSlot={<span className="text-sm">%</span>}
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
