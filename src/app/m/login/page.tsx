"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { Spinner, toast } from "@/components/ui";
import { StaffAvatarGrid } from "@/features/auth/StaffAvatarGrid";
import { useSession } from "@/features/auth/SessionProvider";
import { InstallAppButton } from "@/features/pwa/InstallAppButton";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

const MAX_PIN_LENGTH = 6;

interface PinUser {
  id: string;
  name: string;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Sesi AE-19 — dedicated staff login page di /m/login.
 *
 * Sebelumnya /m unauth redirect ke /pin?callbackUrl=/m yang campur
 * dengan POS/BackOffice login. Owner feedback: "membingungkan, dipisah
 * saja dengan link berbeda untuk halaman karyawan".
 *
 * Sekarang /m unauth redirect ke /m/login, halaman ini punya branding
 * Mahakan Karyawan (icon green-on-white logo, copy karyawan-only). PIN
 * flow sama dengan /pin (signIn pin provider) tapi UI tidak punya
 * dual switcher POS/BackOffice.
 */
export default function StaffLoginPage() {
  const router = useRouter();
  const { status, session, refresh } = useSession();

  const [users, setUsers] = useState<PinUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace("/m");
    }
  }, [status, session, router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/auth/pin-users");
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { items: PinUser[] };
        if (!cancelled) setUsers(json.items);
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit() {
    if (!selectedId || submitting) return;
    if (pin.length < 4) {
      setError("PIN minimal 4 digit");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await signIn("pin", {
      userId: selectedId,
      pin,
      redirect: false,
    });
    if (!res || res.error) {
      setError("PIN salah");
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 400);
      setSubmitting(false);
      return;
    }
    toast.success("Berhasil login");
    await refresh();
    router.replace("/m");
  }

  useEffect(() => {
    if (pin.length === MAX_PIN_LENGTH && selectedId && !submitting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void onSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      {/* Header — staff branded (green BG echoes /m PWA icon) */}
      <header className="rounded-2xl bg-gradient-to-br from-mahakan-green-700 to-mahakan-green-900 p-5 text-white shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
            <Image
              src="/icon-staff-192.png"
              alt="Mahakan Karyawan"
              width={48}
              height={48}
              className="size-10"
              priority
            />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">
              Mahakan Karyawan
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-white/70">
              Tools Login
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/80">
          Login PIN buat akses Absensi, Jadwal Kerja, Stock Opname, dan
          Purchase Order.
        </p>
      </header>

      <div
        className={cn(
          "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm",
          shake && "animate-shake",
        )}
      >
        {selectedUser ? (
          <div className="space-y-4">
            {/* Greeting + back */}
            <div className="flex items-start gap-3">
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mahakan-green-700 text-white text-sm font-bold"
                aria-hidden
              >
                {avatarInitials(selectedUser.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-neutral-900">
                  Halo, {selectedUser.name}
                </p>
                <p className="text-xs text-neutral-600">
                  Masukkan PIN 4–6 digit
                </p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  {ROLE_LABEL[selectedUser.role]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setPin("");
                  setError(null);
                }}
                className="text-xs text-mahakan-green-700 hover:underline"
              >
                Ganti
              </button>
            </div>

            {/* PIN dots */}
            <div
              className="flex justify-center gap-2"
              aria-live="polite"
            >
              {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-3 rounded-full transition-colors",
                    i < pin.length
                      ? "bg-mahakan-green-700"
                      : "bg-neutral-200",
                  )}
                />
              ))}
            </div>

            {error ? (
              <p
                role="alert"
                className="text-center text-sm font-medium text-danger-500"
              >
                {error}
              </p>
            ) : null}

            {/* Numpad — clean tiled layout */}
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                <PinKey
                  key={d}
                  label={String(d)}
                  onPress={() =>
                    setPin((p) =>
                      p.length < MAX_PIN_LENGTH ? p + String(d) : p,
                    )
                  }
                  disabled={submitting}
                />
              ))}
              <PinKey
                label="C"
                variant="muted"
                onPress={() => setPin("")}
                disabled={submitting}
              />
              <PinKey
                label="0"
                onPress={() =>
                  setPin((p) => (p.length < MAX_PIN_LENGTH ? p + "0" : p))
                }
                disabled={submitting}
              />
              <PinKey
                label="⌫"
                variant="muted"
                onPress={() => setPin((p) => p.slice(0, -1))}
                disabled={submitting}
              />
            </div>

            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={submitting || pin.length < 4}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700/40 focus-visible:ring-offset-2",
                submitting || pin.length < 4
                  ? "bg-mahakan-green-700/40 cursor-not-allowed"
                  : "bg-mahakan-green-700 hover:bg-mahakan-green-900 active:scale-[0.99]",
              )}
            >
              {submitting ? "Memproses…" : "Masuk"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                Pilih Nama Anda
              </h2>
              <p className="text-xs text-neutral-600">
                Tap nama untuk lanjut input PIN
              </p>
            </div>
            {loadingUsers ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner className="size-6 text-mahakan-green-700" />
              </div>
            ) : users.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-600">
                Belum ada user dengan PIN. Owner perlu set PIN dulu via Back
                Office.
              </p>
            ) : (
              <StaffAvatarGrid
                users={users}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setPin("");
                  setError(null);
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Sesi AE-24 — PWA install hint sebelum login. Owner request: /m
       * harus bisa di-install sebagai webapp di Android tablet. */}
      <InstallAppButton label="Install Mahakan Karyawan" />

      <footer className="text-center text-[11px] text-neutral-600">
        Mahakan Coffee &amp; Space · Cisarua, Bogor
      </footer>
    </div>
  );
}

function PinKey({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "muted";
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        onPress();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress();
        }
      }}
      disabled={disabled}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "flex h-14 items-center justify-center rounded-xl border font-mono text-xl font-semibold transition-all touch:h-12",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
        "active:scale-95 active:shadow-inner",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "muted"
          ? "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100"
          : "border-neutral-200 bg-white text-neutral-900 hover:bg-mahakan-green-50",
      )}
    >
      {label}
    </button>
  );
}
