"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  toast,
} from "@/components/ui";
import {
  isOk,
  resetAttendancePin,
  setAttendancePin,
  type EmployeeWithLink,
} from "@/features/employees";

interface EmployeeAttendancePinModalProps {
  open: boolean;
  employee: EmployeeWithLink | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Phase 4 (sesi AB) — set/reset attendance PIN per karyawan untuk login
 * mobile route `/absenkaryawan`. PIN 4-6 digit, bcrypt-hashed server-side.
 * Owner/Manager only (per RBAC `employee.attendance_pin.manage`).
 */
export function EmployeeAttendancePinModal({
  open,
  employee,
  onClose,
  onSaved,
}: EmployeeAttendancePinModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPin("");
    setConfirmPin("");
    setShowPin(false);
    setError(null);
    setSubmitting(false);
    setResetting(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, employee?.id]);

  if (!employee) return null;

  const hasExistingPin = employee.attendancePinHash !== null;

  async function handleSet() {
    if (!employee || submitting) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN harus 4-6 digit angka");
      return;
    }
    if (pin !== confirmPin) {
      setError("Konfirmasi PIN tidak cocok");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await setAttendancePin(employee.id, pin);
    setSubmitting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.success(`PIN absensi ${employee.fullName} tersimpan`);
    onSaved();
  }

  async function handleReset() {
    if (!employee || resetting) return;
    if (!confirm(`Reset PIN absensi ${employee.fullName}? Karyawan tidak bisa absen sampai PIN baru di-set.`)) {
      return;
    }
    setResetting(true);
    setError(null);
    const res = await resetAttendancePin(employee.id);
    setResetting(false);
    if (!isOk(res)) {
      setError(res.error.message);
      return;
    }
    toast.info(`PIN absensi ${employee.fullName} di-reset`);
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`PIN Absensi — ${employee.fullName}`}
      description={
        hasExistingPin
          ? "Karyawan sudah punya PIN. Set baru untuk replace, atau Reset untuk hapus."
          : "Set PIN baru biar karyawan bisa absensi via /absenkaryawan."
      }
      size="sm"
      footer={
        <>
          {hasExistingPin ? (
            <Button
              variant="ghost"
              onClick={handleReset}
              loading={resetting}
              disabled={submitting}
              className="!text-danger-500"
            >
              <Trash2 className="size-4" aria-hidden /> Reset PIN
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSet} loading={submitting}>
            <KeyRound className="size-4" aria-hidden />{" "}
            {hasExistingPin ? "Update PIN" : "Set PIN"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-info-300 bg-info-100 p-3 text-xs text-info-500">
          PIN ini terpisah dari PIN POS. Karyawan tanpa akun POS tetap bisa
          absensi via /absenkaryawan dengan PIN ini. PIN disimpan dalam bentuk
          hash — Owner/Manager tidak bisa lihat PIN existing, hanya replace.
        </div>

        <div className="space-y-2">
          <Input
            label="PIN baru (4-6 digit angka)"
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            placeholder="••••"
            disabled={submitting}
            autoFocus
          />
          <Input
            label="Konfirmasi PIN"
            type={showPin ? "text" : "password"}
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) =>
              setConfirmPin(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
            }
            placeholder="••••"
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setShowPin((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900"
          >
            {showPin ? (
              <>
                <EyeOff className="size-3.5" aria-hidden /> Sembunyikan PIN
              </>
            ) : (
              <>
                <Eye className="size-3.5" aria-hidden /> Tampilkan PIN
              </>
            )}
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
