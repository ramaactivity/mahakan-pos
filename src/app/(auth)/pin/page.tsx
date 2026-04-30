"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
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
        "p-4 sm:p-5",
        shake && "animate-shake",
      )}
    >
      <CardHeader className="mb-3 sm:mb-4">
        <CardTitle className="text-lg sm:text-xl">
          {selectedUser ? `Halo, ${selectedUser.name}` : "Login Kasir"}
        </CardTitle>
        <CardDescription className="text-sm">
          {selectedUser
            ? "Masukkan PIN 4–6 digit untuk masuk POS"
            : "Pilih nama Anda untuk lanjut input PIN"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadingUsers ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            Belum ada user dengan PIN. Owner perlu set PIN via admin dulu.
          </p>
        ) : !selectedId ? (
          <StaffAvatarGrid
            users={users}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setPin("");
              setError(null);
            }}
          />
        ) : (
          <div className="space-y-3 sm:space-y-4 md:space-y-5">
            <div className="flex justify-center gap-2" aria-live="polite">
              {Array.from({ length: MAX_PIN_LENGTH }).map((_, i) => (
                <span
                  key={i}
                  className={`size-3 rounded-full transition-colors ${
                    i < pin.length
                      ? "bg-mahakan-green-700"
                      : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>
            <PinPad
              value={pin}
              onChange={(next) => {
                setPin(next);
                if (error) setError(null);
              }}
              maxLength={MAX_PIN_LENGTH}
              disabled={submitting}
            />
            {error ? (
              <p
                role="alert"
                className="text-center text-sm font-medium text-danger-500"
              >
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="outline"
                fullWidth
                onClick={() => {
                  setSelectedId(null);
                  setPin("");
                  setError(null);
                }}
                disabled={submitting}
              >
                Ganti User
              </Button>
              <Button
                onClick={onSubmit}
                loading={submitting}
                disabled={pin.length < 4}
                fullWidth
              >
                Masuk
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
