"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { Button, PinPad } from "@/components/ui";
import { verifyAttendancePin, type VerifiedKaryawan } from "./actions";
import { formatIndonesianDateTime } from "@/lib/date";
import { haversineDistanceMeters } from "@/lib/haversine";

type Mode = "in" | "out";

type Step =
  | { kind: "pin" }
  | { kind: "ready"; karyawan: VerifiedKaryawan; pin: string }
  | { kind: "act"; karyawan: VerifiedKaryawan; pin: string; mode: Mode }
  | {
      kind: "done";
      karyawan: VerifiedKaryawan;
      mode: Mode;
      clockedAt: string;
      isLate: boolean;
      minutesLate: number | null;
      workMinutes?: number | null;
    };

interface SubmitOk {
  recordId: string;
  mode: Mode;
  clockedAt: string;
  isLate: boolean;
  minutesLate: number | null;
  workMinutes?: number | null;
}

/**
 * Phase 4 (sesi AB) — mobile-first absensi state machine.
 *
 * Phase 4-C complete: full integrity flow:
 *   pin → ready → act (GPS + camera + submit) → done
 *
 * PIN is held in component state across pin → ready → act steps biar bisa
 * di-resend ke /api/v1/attendance/clock-mobile. Cleared saat reset (done /
 * cancel). Memory-only, never persisted.
 */
export function AttendanceShell() {
  const [step, setStep] = useState<Step>({ kind: "pin" });
  const [pinDraft, setPinDraft] = useState("");
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
      setPinDraft("");
      return;
    }
    setStep({ kind: "ready", karyawan: res.data, pin: value });
    setPinDraft("");
  }

  function handleStartAct(mode: Mode) {
    if (step.kind !== "ready") return;
    setStep({
      kind: "act",
      karyawan: step.karyawan,
      pin: step.pin,
      mode,
    });
  }

  function handleReset() {
    setStep({ kind: "pin" });
    setPinDraft("");
    setPinError(null);
  }

  function handleSubmitDone(result: SubmitOk) {
    if (step.kind !== "act") return;
    setStep({
      kind: "done",
      karyawan: step.karyawan,
      mode: result.mode,
      clockedAt: result.clockedAt,
      isLate: result.isLate,
      minutesLate: result.minutesLate,
      workMinutes: result.workMinutes,
    });
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
            pin={pinDraft}
            setPin={setPinDraft}
            onSubmit={handleVerifyPin}
            verifying={verifying}
            error={pinError}
          />
        ) : step.kind === "ready" ? (
          <ReadyStep
            karyawan={step.karyawan}
            onClockIn={() => handleStartAct("in")}
            onClockOut={() => handleStartAct("out")}
            onCancel={handleReset}
          />
        ) : step.kind === "act" ? (
          <ActStep
            karyawan={step.karyawan}
            pin={step.pin}
            mode={step.mode}
            onCancel={() =>
              setStep({ kind: "ready", karyawan: step.karyawan, pin: step.pin })
            }
            onDone={handleSubmitDone}
          />
        ) : (
          <DoneStep
            karyawan={step.karyawan}
            mode={step.mode}
            clockedAt={step.clockedAt}
            isLate={step.isLate}
            minutesLate={step.minutesLate}
            workMinutes={step.workMinutes}
            onDone={handleReset}
          />
        )}
      </main>

      <footer className="mt-6 text-center text-[11px] text-neutral-400">
        Lupa PIN? Hubungi Owner / Manager untuk reset.
      </footer>
    </div>
  );
}

// ============================================================
// Steps
// ============================================================

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
    </div>
  );
}

interface GpsState {
  status: "idle" | "loading" | "ok" | "error";
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  error?: string;
}

function ActStep({
  karyawan,
  pin,
  mode,
  onCancel,
  onDone,
}: {
  karyawan: VerifiedKaryawan;
  pin: string;
  mode: Mode;
  onCancel: () => void;
  onDone: (result: SubmitOk) => void;
}) {
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [selfie, setSelfie] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clientRefIdRef = useRef<string>(crypto.randomUUID());

  // Auto-fetch GPS on mount
  useEffect(() => {
    fetchGps();
    return () => {
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fetchGps() {
    if (!navigator.geolocation) {
      setGps({
        status: "error",
        error:
          "Browser tidak support GPS — pakai browser modern (Chrome/Safari)",
      });
      return;
    }
    setGps({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dist = haversineDistanceMeters(
          { lat: latitude, lng: longitude },
          {
            lat: karyawan.outletGpsCenter.lat,
            lng: karyawan.outletGpsCenter.lng,
          },
        );
        setGps({
          status: "ok",
          lat: latitude,
          lng: longitude,
          distanceMeters: dist,
        });
      },
      (err) => {
        setGps({
          status: "error",
          error:
            err.code === err.PERMISSION_DENIED
              ? "Izin lokasi ditolak — aktifkan di browser settings, lalu refresh"
              : err.message || "Gagal ambil GPS",
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfie(f);
    setSelfiePreview(URL.createObjectURL(f));
    setError(null);
  }

  const inRadius =
    gps.status === "ok" &&
    typeof gps.distanceMeters === "number" &&
    gps.distanceMeters <= karyawan.outletGpsCenter.radiusMeters;

  const canSubmit = inRadius && selfie !== null && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !selfie || gps.status !== "ok") return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("pin", pin);
      formData.append("selfie", selfie);
      formData.append("gpsLat", String(gps.lat ?? ""));
      formData.append("gpsLng", String(gps.lng ?? ""));
      formData.append("mode", mode);
      formData.append("clientRefId", clientRefIdRef.current);

      const res = await fetch("/api/v1/attendance/clock-mobile", {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as
        | { ok: true; data: SubmitOk }
        | { ok: false; error: { code: string; message: string } };
      if (!res.ok || !json.ok) {
        const msg =
          (!json.ok && json.error?.message) ||
          `Submit gagal (HTTP ${res.status})`;
        setError(msg);
        setSubmitting(false);
        return;
      }
      onDone(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit gagal");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="text-center">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          {mode === "in" ? "Clock In" : "Clock Out"}
        </p>
        <p className="text-base font-semibold text-mahakan-green-900">
          {karyawan.fullName}
        </p>
      </header>

      {/* GPS card */}
      <div
        className={`rounded-xl border-2 p-4 ${
          gps.status === "ok" && inRadius
            ? "border-success-500 bg-success-100"
            : gps.status === "ok" && !inRadius
              ? "border-warning-500 bg-warning-100"
              : gps.status === "error"
                ? "border-danger-500 bg-danger-100"
                : "border-neutral-200 bg-neutral-50"
        }`}
      >
        <div className="flex items-start gap-2">
          {gps.status === "loading" ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-neutral-500" />
          ) : gps.status === "error" ? (
            <AlertTriangle className="size-5 shrink-0 text-danger-500" />
          ) : (
            <MapPin
              className={`size-5 shrink-0 ${
                inRadius ? "text-success-500" : "text-warning-500"
              }`}
              aria-hidden
            />
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {gps.status === "loading"
                ? "Mengambil lokasi..."
                : gps.status === "ok"
                  ? inRadius
                    ? `✓ Di area kedai (${gps.distanceMeters}m)`
                    : `Di luar radius (${gps.distanceMeters}m / batas ${karyawan.outletGpsCenter.radiusMeters}m)`
                  : "Lokasi gagal di-baca"}
            </p>
            {gps.status === "error" && gps.error ? (
              <p className="mt-1 text-xs text-danger-700">{gps.error}</p>
            ) : null}
            {gps.status === "ok" && !inRadius ? (
              <p className="mt-1 text-xs text-warning-500">
                Pastikan kamu di lokasi kedai. Tap refresh kalau pindah.
              </p>
            ) : null}
          </div>
          {gps.status !== "loading" ? (
            <button
              type="button"
              onClick={fetchGps}
              className="rounded-md p-1 text-neutral-500 hover:bg-white/40"
              aria-label="Refresh GPS"
            >
              <RefreshCw className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* Selfie capture */}
      <div className="rounded-xl border-2 border-neutral-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-neutral-900">
          Selfie wajib dari kamera depan
        </p>
        {selfiePreview ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selfiePreview}
                alt="Selfie preview"
                className="aspect-square w-full object-cover"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <Camera className="size-4" /> Foto Ulang
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            fullWidth
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
            className="!h-16 !flex-col !gap-1"
          >
            <Camera className="size-6" />
            <span className="text-sm">Buka Kamera</span>
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handleFileChange}
          disabled={submitting}
        />
        <p className="mt-2 text-[11px] text-neutral-500">
          Foto harus diambil sekarang dari kamera depan. Upload galeri akan
          ditolak.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger-300 bg-danger-100 px-3 py-2 text-sm font-medium text-danger-700"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <Button
          size="xl"
          fullWidth
          disabled={!canSubmit}
          loading={submitting}
          onClick={handleSubmit}
          className="!h-16 !text-base"
        >
          {submitting ? (
            "Memproses..."
          ) : (
            <>
              {mode === "in" ? (
                <LogIn className="size-5" />
              ) : (
                <LogOut className="size-5" />
              )}
              {mode === "in" ? "Submit Clock In" : "Submit Clock Out"}
            </>
          )}
        </Button>
        <Button variant="ghost" fullWidth size="sm" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  karyawan,
  mode,
  clockedAt,
  isLate,
  minutesLate,
  workMinutes,
  onDone,
}: {
  karyawan: VerifiedKaryawan;
  mode: Mode;
  clockedAt: string;
  isLate: boolean;
  minutesLate: number | null;
  workMinutes?: number | null;
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
          {formatIndonesianDateTime(clockedAt)}
        </p>
        {mode === "in" && isLate ? (
          <div className="mt-2 rounded-md bg-warning-100 px-3 py-1.5 text-xs font-semibold text-warning-500">
            Telat {minutesLate ?? 0} menit
          </div>
        ) : null}
        {mode === "out" && typeof workMinutes === "number" ? (
          <div className="mt-2 rounded-md bg-info-100 px-3 py-1.5 text-xs font-semibold text-info-500">
            Total kerja: {Math.floor(workMinutes / 60)}j {workMinutes % 60}m
          </div>
        ) : null}
      </div>
      <Button fullWidth onClick={onDone}>
        Selesai
      </Button>
    </div>
  );
}
