"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PinPad,
  Spinner,
  toast,
} from "@/components/ui";
import { StaffAvatarGrid } from "@/features/auth/StaffAvatarGrid";
import { useSession } from "@/features/auth/SessionProvider";
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
 * PIN login flow — sesi AD-6b redesign for Galaxy A7 Lite.
 *
 * Trigger split layout via `landscape:md:` (≥768px landscape) which
 * reliably matches A7 Lite landscape (1340×800). Earlier `lg:` (1024)
 * was inconsistent on Chrome Android.
 *
 * Height budget on tablet landscape (800px viewport):
 *   - Header (logo + switcher): ~110px
 *   - Card padding + outer gap: ~50px
 *   - Available card content height: ~640px
 *   - LEFT inner col: avatar 56 + greeting 80 + dots 32 + hint 32 +
 *     Ganti User 48 + gaps = ~250px ✓
 *   - RIGHT inner col: numpad 4 rows × 56 + gaps + Masuk 48 = ~290px ✓
 *
 * Avatar select mode: single-column with responsive grid (handled by
 * StaffAvatarGrid).
 */
function defaultRedirectFor(role: string | null | undefined): string {
  if (role === "staff") return "/pos";
  return "/dashboard";
}

/** Sanitize callback URL — only allow same-origin paths starting with "/".
 * Prevents open-redirect via query param manipulation. */
function safeCallback(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null; // protocol-relative, reject
  return raw;
}

export default function PinLoginPage() {
  // useSearchParams forces dynamic rendering; wrap in Suspense supaya
  // Next.js build prerender ga error untuk this client page.
  return (
    <Suspense fallback={<PinLoginFallback />}>
      <PinLoginInner />
    </Suspense>
  );
}

function PinLoginFallback() {
  return (
    <Card className="p-3 sm:p-4 lg:p-5">
      <CardContent className="flex h-40 items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </CardContent>
    </Card>
  );
}

function PinLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams?.get("callbackUrl") ?? null);
  // Sesi AE-17 — staff context kalau callback dari /m. Swap title +
  // description supaya UI ga ambigu antara "Login Kasir" vs "Login
  // Karyawan".
  const isStaffContext = callbackUrl?.startsWith("/m") ?? false;
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
      // Sesi AE-15 — honor callbackUrl param (e.g., /m for staff mobile),
      // else fallback default per role.
      const dest =
        callbackUrl ?? defaultRedirectFor(session.user.role);
      router.replace(dest);
    }
  }, [status, session, router, callbackUrl]);

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
    const updated = await refresh();
    const role =
      updated && typeof updated === "object" && "user" in updated
        ? (updated as { user: { role: string } }).user.role
        : null;
    const dest = callbackUrl ?? defaultRedirectFor(role);
    router.replace(dest);
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
    <Card
      className={cn(
        "p-3 sm:p-4 landscape:md:p-4 lg:p-5",
        shake && "animate-shake",
      )}
    >
      {selectedUser ? (
        // ============================================================
        // PIN entry — split 2-col on landscape:md+ (Galaxy A7 Lite)
        // ============================================================
        <div className="grid gap-4 landscape:md:grid-cols-2 landscape:md:gap-5 lg:gap-6">
          {/* LEFT — greeting + dots + back */}
          <div className="flex flex-col gap-3 landscape:md:gap-3.5">
            <CardHeader className="flex flex-col items-start gap-2 landscape:md:gap-2.5">
              <div
                className={cn(
                  "flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-bold landscape:md:size-14 lg:size-16 lg:text-xl",
                  "bg-mahakan-green-700 text-white shadow-sm",
                )}
                aria-hidden
              >
                {avatarInitials(selectedUser.name)}
              </div>
              <div className="space-y-0.5">
                <CardTitle className="text-lg landscape:md:text-lg lg:text-xl">
                  Halo, {selectedUser.name}
                </CardTitle>
                <CardDescription className="text-xs landscape:md:text-xs lg:text-sm">
                  Masukkan PIN 4–6 digit untuk{" "}
                  {isStaffContext ? "akses Tools Karyawan" : "masuk POS"}
                </CardDescription>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                  {ROLE_LABEL[selectedUser.role]}
                </p>
              </div>
            </CardHeader>

            <div
              className="flex justify-center gap-2 landscape:md:justify-start"
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
                className="text-center text-sm font-medium text-danger-500 landscape:md:text-left"
              >
                {error}
              </p>
            ) : (
              <p className="text-center text-[11px] text-neutral-600 landscape:md:text-left">
                PIN otomatis submit setelah 6 digit. Atau tap Masuk.
              </p>
            )}

            <Button
              variant="outline"
              size="md"
              fullWidth
              onClick={() => {
                setSelectedId(null);
                setPin("");
                setError(null);
              }}
              disabled={submitting}
              className="landscape:md:mt-auto"
            >
              <ArrowLeft className="size-4" aria-hidden /> Ganti User
            </Button>
          </div>

          {/* RIGHT — numpad + masuk */}
          <CardContent className="flex flex-col gap-2.5 landscape:md:gap-3">
            <PinPad
              value={pin}
              onChange={(next) => {
                setPin(next);
                if (error) setError(null);
              }}
              maxLength={MAX_PIN_LENGTH}
              disabled={submitting}
            />
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={pin.length < 4}
              size="lg"
              fullWidth
            >
              {submitting ? "Memproses…" : "Masuk"}
            </Button>
          </CardContent>
        </div>
      ) : (
        // ============================================================
        // Avatar select — single column, responsive grid
        // ============================================================
        <>
          <CardHeader className="mb-3 landscape:md:mb-3">
            <CardTitle className="text-lg landscape:md:text-xl lg:text-2xl">
              {isStaffContext ? "Login Karyawan" : "Login Kasir"}
            </CardTitle>
            <CardDescription className="text-xs landscape:md:text-sm">
              {isStaffContext
                ? "Pilih nama Anda untuk akses Tools Karyawan (Absensi, Jadwal, Opname, PO)"
                : "Pilih nama Anda untuk lanjut input PIN"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex h-32 items-center justify-center landscape:md:h-40">
                <Spinner className="size-6 text-mahakan-green-700" />
              </div>
            ) : users.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-600">
                Belum ada user dengan PIN. Owner perlu set PIN via admin
                dulu.
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
          </CardContent>
        </>
      )}
    </Card>
  );
}
