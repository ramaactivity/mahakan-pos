"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import { Button, Input, Modal, toast } from "@/components/ui";
import {
  getLastClosedShiftAtOutlet,
  isOk,
  openShift,
  type Shift,
} from "@/features/shifts";
import { formatIndonesianDateTime } from "@/lib/date";
import { formatRupiah, parseRupiah } from "@/lib/format";
import type { Category, MenuItem } from "@/features/menu";
import type { Role } from "@/lib/auth/rbac";
import { MenuStatusCard } from "./MenuStatusCard";

interface OpenShiftModalProps {
  open: boolean;
  /** Kept for callsite compatibility; the action derives userId from session. */
  userId: string;
  /** Menu data lifted from PosShell — passed through to MenuStatusCard. */
  menuItems: MenuItem[];
  categories: Category[];
  role: Role;
  onItemUpdated: (next: MenuItem) => void;
  onClose: () => void;
  onOpened: () => void;
}

type Step = "cash" | "stock";

/**
 * 2-step buka-shift flow (Galih ask #6):
 *   1. Cash awal — kasir input nominal kas di laci
 *   2. Stok review — kasir scan menu, mark item sold-out di awal shift
 *      sebelum customer datang. Optional skip.
 *
 * Step 1 calls the openShift action so the shift is open even if kasir
 * skips step 2. Step 2 is just MenuStatusCard embedded — toggleSoldOut
 * mutations already work in real time once shift is active.
 */
export function OpenShiftModal({
  open,
  menuItems,
  categories,
  role,
  onItemUpdated,
  onClose,
  onOpened,
}: OpenShiftModalProps) {
  const [step, setStep] = useState<Step>("cash");
  const [openingCash, setOpeningCash] = useState("100000");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previousShift, setPreviousShift] = useState<Shift | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep("cash");
    setOpeningCash("100000");
    setError(null);
    setSubmitting(false);
    setPreviousShift(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    void (async () => {
      const res = await getLastClosedShiftAtOutlet();
      if (cancelled) return;
      if (isOk(res)) setPreviousShift(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  let parsed = 0;
  try {
    parsed = parseRupiah(openingCash);
  } catch {
    parsed = 0;
  }

  async function onSubmitCash(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (parsed < 0) {
      setError("Kas awal tidak boleh negatif");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await openShift({ openingCash: parsed });
    if (!isOk(res)) {
      setError(res.error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`Shift dibuka — kas awal ${formatRupiah(parsed)}`);
    setSubmitting(false);
    setStep("stock");
  }

  function handleSkipOrFinish() {
    onOpened();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === "cash" ? "Buka Shift — Kas Awal" : "Buka Shift — Cek Stok Menu"}
      description={
        step === "cash"
          ? "Hitung kas yang ada di laci sekarang dan masukin jumlahnya."
          : "Tandai item yang sudah habis sebelum mulai jualan. Bisa skip kalau gak ada perubahan stok."
      }
      size={step === "stock" ? "lg" : "md"}
      footer={
        step === "cash" ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button
              onClick={(e) => onSubmitCash(e)}
              loading={submitting}
              disabled={parsed < 0}
              size="lg"
            >
              Lanjut → Cek Stok
            </Button>
          </>
        ) : (
          <Button onClick={handleSkipOrFinish} size="lg">
            Selesai
          </Button>
        )
      }
    >
      {step === "cash" ? (
        <form
          onSubmit={onSubmitCash}
          className="space-y-3"
          aria-label="Form buka shift"
        >
          {previousShift &&
          previousShift.handoverMessage &&
          previousShift.handoverMessage.length > 0 ? (
            <div className="rounded-lg border border-mahakan-green-200 bg-mahakan-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-mahakan-green-900">
                <MessageSquare className="size-4" aria-hidden />
                Pesan dari shift sebelumnya
                {previousShift.closedAt ? (
                  <span className="ml-auto text-mahakan-green-700/70">
                    {formatIndonesianDateTime(previousShift.closedAt)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">
                {previousShift.handoverMessage}
              </p>
            </div>
          ) : null}
          <Input
            label="Kas Awal"
            type="text"
            inputMode="numeric"
            value={openingCash}
            onChange={(e) =>
              setOpeningCash(e.target.value.replace(/[^\d]/g, ""))
            }
            hint={`Preview: ${formatRupiah(parsed)}`}
            required
            autoFocus
            disabled={submitting}
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <MenuStatusCard
            menuItems={menuItems}
            categories={categories}
            role={role}
            onItemUpdated={onItemUpdated}
          />
        </div>
      )}
    </Modal>
  );
}
