"use client";

import { useEffect, useState } from "react";
import { Button, Modal, TimePicker, toast } from "@/components/ui";
import { isOk, updateOperationalHours, type Outlet } from "@/features/outlets";
import type { OperationalHours } from "@/db/schema/outlets";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  outlet: Outlet;
  onClose: () => void;
  onSaved: (next: Outlet) => void;
}

const DAYS: Array<{ key: keyof OperationalHours; label: string }> = [
  { key: "mon", label: "Senin" },
  { key: "tue", label: "Selasa" },
  { key: "wed", label: "Rabu" },
  { key: "thu", label: "Kamis" },
  { key: "fri", label: "Jumat" },
  { key: "sat", label: "Sabtu" },
  { key: "sun", label: "Minggu" },
];

const DEFAULT_HOURS: OperationalHours = {
  mon: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
  tue: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
  wed: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
  thu: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
  fri: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
  sat: { isOpen: true, openTime: "09:00", closeTime: "23:00" },
  sun: { isOpen: true, openTime: "09:00", closeTime: "23:00" },
};

export function OperationalHoursModal({ open, outlet, onClose, onSaved }: Props) {
  const [hours, setHours] = useState<OperationalHours>(
    outlet.operationalHours ?? DEFAULT_HOURS,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setHours(outlet.operationalHours ?? DEFAULT_HOURS);
    setError(null);
    setSubmitting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, outlet]);

  function setDay(
    key: keyof OperationalHours,
    patch: Partial<OperationalHours[typeof key]>,
  ) {
    setHours((h) => ({ ...h, [key]: { ...h[key], ...patch } }));
  }

  async function onSubmit() {
    if (submitting) return;
    for (const d of DAYS) {
      const h = hours[d.key];
      if (h.isOpen && (!h.openTime || !h.closeTime)) {
        setError(`${d.label}: jam buka & tutup wajib`);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const res = await updateOperationalHours(hours);
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Jam operasional tersimpan");
    onSaved(res.data);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Jam Operasional"
      description="Info display saja — tidak enforce restriction di Phase 1."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {DAYS.map((d) => {
          const h = hours[d.key];
          return (
            <div
              key={d.key}
              className="grid grid-cols-12 items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2"
            >
              <span className="col-span-3 text-sm font-medium text-neutral-900">
                {d.label}
              </span>
              <button
                type="button"
                onClick={() => setDay(d.key, { isOpen: !h.isOpen })}
                aria-pressed={h.isOpen}
                className={cn(
                  "col-span-3 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  h.isOpen
                    ? "border-mahakan-green-700 bg-mahakan-green-50 text-mahakan-green-900"
                    : "border-neutral-300 bg-neutral-50 text-neutral-600",
                )}
              >
                {h.isOpen ? "Buka" : "Tutup"}
              </button>
              <div className="col-span-3">
                <TimePicker
                  size="sm"
                  ariaLabel={`${d.label} jam buka`}
                  value={h.openTime ?? null}
                  onChange={(v) => setDay(d.key, { openTime: v ?? "" })}
                  disabled={!h.isOpen}
                  clearable={false}
                />
              </div>
              <div className="col-span-3">
                <TimePicker
                  size="sm"
                  ariaLabel={`${d.label} jam tutup`}
                  value={h.closeTime ?? null}
                  onChange={(v) => setDay(d.key, { closeTime: v ?? "" })}
                  disabled={!h.isOpen}
                  clearable={false}
                />
              </div>
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="pt-2 text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
