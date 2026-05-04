"use client";

import { useState } from "react";
import Image from "next/image";
import { CheckCircle2, Clock, KeyRound, LogIn, LogOut } from "lucide-react";
import { Button, toast } from "@/components/ui";
import { PinPad } from "@/components/ui";
import { verifyAttendancePin, type VerifiedKaryawan } from "./actions";
import { formatIndonesianDateTime } from "@/lib/date";

type Step =
  | { kind: "pin" }
  | { kind: "ready"; karyawan: VerifiedKaryawan }
  | { kind: "submitting"; karyawan: VerifiedKaryawan; mode: "in" | "out" }
  | {
      kind: "done";
      karyawan: VerifiedKaryawan;
      mode: "in" | "out";
      isLate: boolean;
      minutesLate: number | null;
    };

/**
 * Phase 4 (sesi AB) — mobile-first absensi state machine.
 *
 * Flow:
 *   pin → enter PIN → verify → ready (show karyawan info + clock-in / clock-out
 *   button) → submit (Phase 4-C: GPS check + camera + Drive upload) → done
 *
 * Phase 4-B (this sesi): pin → ready → mock submit → done. Tujuan: validate
 * UX flow + state machine sebelum Phase 4-C tambah camera/GPS/Drive.
 */
export function AttendanceShell() {
  const [step, setStep] = useState<Step>({ kind: "pin" });
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  async function handleVerifyPin(value: string) {
    if (verifying) return;
    setVerifying(true);
    setPinError(null);
    const res = await verifyAttendancePin(value);
    setVerifying(false);
    if (!res.ok) {
      setPinError(res.error.message);
      setPin("");
      return;
    }
    setPin("");
    setStep({ kind: "ready", karyawan: res.data });
  }

  async function handleClockMode(mode: "in" | "out") {
    if (step.kind !== "ready") return;
    // Phase 4-B mock — Phase 4-C akan replace dengan GPS + camera flow
    setStep({ kind: "submitting", karyawan: step.karyawan, mode });
    // Simulate Phase 4-C placeholder
    setTimeout(() => {
      toast.info(
        "Phase 4-B preview: clock-in/out belum aktif. Tunggu Phase 4-C.",
      );
      setStep({ kind: "pin" });
    }, 800);
  }

  function handleCancel() {
    setStep({ kind: "pin" });
    setPin("");
    setPinError(null);
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-6 flex flex-col items-center gap-2">
        <Image
          src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
          alt="Mahakan Coffee & Space"
          width={120}
          height={170}
          priority
          className="h-14 w-auto"
        />
        <h1 className="text-base font-bold text-mahakan-green-900">
          Absensi Karyawan
        </h1>
        <p className="text-xs text-neutral-500">
          Mahakan Coffee &amp; Space
        </p>
      </header>

      <main className="flex-1">
        {step.kind === "pin" ? (
          <PinStep
            pin={pin}
            setPin={setPin}
            onSubmit={handleVerifyPin}
            verifying={verifying}
            error={pinError}
          />
        ) : step.kind === "ready" ? (
          <ReadyStep
            karyawan={step.karyawan}
            onClockIn={() => handleClockMode("in")}
            onClockOut={() => handleClockMode("out")}
            onCancel={handleCancel}
          />
        ) : step.kind === "submitting" ? (
          <SubmittingStep mode={step.mode} />
        ) : (
          <DoneStep
            karyawan={step.karyawan}
            mode={step.mode}
            isLate={step.isLate}
            minutesLate={step.minutesLate}
            onDone={handleCancel}
          />
        )}
      </main>

      <footer className="mt-6 text-center text-[11px] text-neutral-400">
        Lupa PIN? Hubungi Owner / Manager untuk reset.
      </footer>
    </div>
  );
}

function PinStep({
  pin,
  setPin,
  onSubmit,
  verifying,
  error,
}: {
  pin: string;
  setPin: (s: string) => void;
  onSubmit: (pin: string) => void;
  verifying: boolean;
  error: string | null;
}) {
  const canSubmit = pin.length >= 4 && !verifying;
  return (
    <div className="space-y-4">
      <div className="text-center">
        <KeyRound className="mx-auto mb-2 size-8 text-mahakan-green-700" />
        <p className="text-sm font-medium text-neutral-900">
          Masukkan PIN Absensi
        </p>
        <p className="text-xs text-neutral-500">4-6 digit angka</p>
      </div>

      {/* PIN dots indicator */}
      <div className="flex justify-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`size-3 rounded-full transition-colors ${
              i < pin.length ? "bg-mahakan-green-700" : "bg-neutral-200"
            }`}
          />
        ))}
      </div>

      <PinPad value={pin} onChange={setPin} maxLength={6} disabled={verifying} />

      <Button
        size="xl"
        fullWidth
        onClick={() => onSubmit(pin)}
        disabled={!canSubmit}
        loading={verifying}
        className="!h-14 !text-base"
      >
        {verifying ? "Memverifikasi..." : "Lanjut"}
      </Button>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-center text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReadyStep({
  karyawan,
  onClockIn,
  onClockOut,
  onCancel,
}: {
  karyawan: VerifiedKaryawan;
  onClockIn: () => void;
  onClockOut: () => void;
  onCancel: () => void;
}) {
  const isClockOutMode = karyawan.hasOpenRecord;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-mahakan-green-300 bg-white p-4 text-center shadow-sm">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Halo,
        </p>
        <p className="mt-1 text-lg font-bold text-mahakan-green-900">
          {karyawan.fullName}
        </p>
        {karyawan.position ? (
          <p className="text-xs text-neutral-600">{karyawan.position}</p>
        ) : null}
      </div>

      {isClockOutMode && karyawan.openRecord ? (
        <div className="rounded-md border border-info-300 bg-info-100 p-3 text-xs text-info-500">
          <Clock className="mr-1.5 inline size-3.5" aria-hidden />
          Sudah clock-in pukul{" "}
          {formatIndonesianDateTime(karyawan.openRecord.clockInAt)}
          {karyawan.openRecord.isLate === "yes" ? (
            <span className="ml-1 font-semibold text-warning-500">
              (telat {karyawan.openRecord.lateMinutes ?? 0} menit)
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        {isClockOutMode ? (
          <Button
            size="xl"
            fullWidth
            onClick={onClockOut}
            className="!h-16 !text-base"
          >
            <LogOut className="size-5" aria-hidden /> Clock Out
          </Button>
        ) : (
          <Button
            size="xl"
            fullWidth
            onClick={onClockIn}
            className="!h-16 !text-base"
          >
            <LogIn className="size-5" aria-hidden /> Clock In
          </Button>
        )}

        <Button variant="ghost" fullWidth onClick={onCancel} size="sm">
          Batal — Bukan saya
        </Button>
      </div>

      <p className="rounded-md bg-warning-100 p-3 text-center text-[11px] text-warning-500">
        ⚠ Phase 4-B preview — Clock In/Out belum aktif. Phase 4-C akan tambah
        GPS check + selfie kamera + upload Drive.
      </p>
    </div>
  );
}

function SubmittingStep({ mode }: { mode: "in" | "out" }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="size-12 animate-spin rounded-full border-4 border-mahakan-green-700/30 border-t-mahakan-green-700" />
      <p className="text-sm text-neutral-700">
        Memproses {mode === "in" ? "clock-in" : "clock-out"}...
      </p>
    </div>
  );
}

function DoneStep({
  karyawan,
  mode,
  isLate,
  minutesLate,
  onDone,
}: {
  karyawan: VerifiedKaryawan;
  mode: "in" | "out";
  isLate: boolean;
  minutesLate: number | null;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-success-500 bg-success-100 p-6 text-center">
        <CheckCircle2 className="size-12 text-success-500" aria-hidden />
        <p className="text-base font-bold text-success-500">
          {mode === "in" ? "Clock-in berhasil" : "Clock-out berhasil"}
        </p>
        <p className="text-sm text-neutral-700">{karyawan.fullName}</p>
        <p className="font-mono text-xs text-neutral-500">
          {formatIndonesianDateTime(new Date())}
        </p>
        {mode === "in" && isLate ? (
          <div className="mt-2 rounded-md bg-warning-100 px-3 py-1.5 text-xs font-semibold text-warning-500">
            Telat {minutesLate ?? 0} menit
          </div>
        ) : null}
      </div>
      <Button fullWidth onClick={onDone}>
        Selesai
      </Button>
    </div>
  );
}
