"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
 * PIN login flow — sesi AD-5 redesign.
 *
 * 2 modes inside one Card:
 *   1. Avatar select (no user selected yet) — single column, grid
 *      avatar responsive (2 → 3 → 4 cols).
 *   2. PIN entry (user selected) — split 2-col on `lg:` for tablet
 *      landscape (Galaxy A7 Lite) so greeting+dots+back button fit
 *      LEFT, numpad+Masuk button fit RIGHT, all without scroll.
 *
 * Below `lg:`, PIN entry stacks vertically (existing pattern, fits
 * mobile portrait fine).
 */
export default function PinLoginPage() {
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
      router.replace(session.user.role === "staff" ? "/pos" : "/dashboard");
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
    const updated = await refresh();
    const role =
      updated && typeof updated === "object" && "user" in updated
        ? (updated as { user: { role: string } }).user.role
        : null;
    router.replace(role === "staff" ? "/pos" : "/dashboard");
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
        "p-4 sm:p-5 lg:p-6",
        shake && "animate-shake",
      )}
    >
      {selectedUser ? (
        // ============================================================
        // PIN entry — split 2-col on lg+
        // ============================================================
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
          {/* LEFT — greeting + dots + back */}
          <div className="flex flex-col gap-4 lg:gap-5">
            <CardHeader className="flex flex-col items-start gap-3">
              <div
                className={cn(
                  "flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-bold lg:size-20 lg:text-2xl",
                  "bg-mahakan-green-700 text-white shadow-sm",
                )}
                aria-hidden
              >
                {avatarInitials(selectedUser.name)}
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl lg:text-2xl">
                  Halo, {selectedUser.name}
                </CardTitle>
                <CardDescription className="text-sm">
                  Masukkan PIN 4–6 digit untuk masuk POS
                </CardDescription>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                  {ROLE_LABEL[selectedUser.role]}
                </p>
              </div>
            </CardHeader>

            <div
              className="flex justify-center gap-2 lg:justify-start"
              aria-live="polite"
            >
              {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-3 rounded-full transition-colors lg:size-3.5",
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
                className="text-center text-sm font-medium text-danger-500 lg:text-left"
              >
                {error}
              </p>
            ) : (
              <p className="text-center text-xs text-neutral-600 lg:text-left">
                PIN otomatis submit setelah 6 digit. Atau tap tombol Masuk.
              </p>
            )}

            <Button
              variant="outline"
              size="lg"
              fullWidth
              onClick={() => {
                setSelectedId(null);
                setPin("");
                setError(null);
              }}
              disabled={submitting}
              className="lg:mt-auto"
            >
              <ArrowLeft className="size-4" aria-hidden /> Ganti User
            </Button>
          </div>

          {/* RIGHT — numpad + masuk */}
          <CardContent className="flex flex-col gap-3 lg:gap-4">
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
          <CardHeader className="mb-3 sm:mb-4">
            <CardTitle className="text-xl lg:text-2xl">Login Kasir</CardTitle>
            <CardDescription className="text-sm">
              Pilih nama Anda untuk lanjut input PIN
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex h-40 items-center justify-center">
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
