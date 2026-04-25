"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { authService, isOk } from "@/mocks/services";
import type { PublicUser } from "@/mocks/types";

const MAX_PIN_LENGTH = 6;

export default function PinLoginPage() {
  const router = useRouter();
  const { status, session, refresh } = useSession();

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(
        session.user.role === "staff" ? "/pos" : "/dashboard",
      );
    }
  }, [status, session, router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Mocks: surface all PIN-capable users (owner/manager/staff) for login.
      // Production: only staff visible here; managers use /login.
      const res = await authService.listApprovers();
      if (cancelled) return;
      if (isOk(res)) {
        setUsers(res.data);
      }
      setLoadingUsers(false);
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

    const res = await authService.loginWithPin(selectedId, pin);
    if (!isOk(res)) {
      setError(res.error.message);
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 400);
      setSubmitting(false);
      return;
    }

    toast.success(`Selamat bekerja, ${res.data.user.name}`);
    await refresh();
    router.replace(
      res.data.user.role === "staff" ? "/pos" : "/dashboard",
    );
  }

  // Auto-submit when PIN reaches max length (convenience for 6-digit PINs).
  // setState-in-effect is intentional: we react to user input (external event).
  useEffect(() => {
    if (pin.length === MAX_PIN_LENGTH && selectedId && !submitting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void onSubmit();
    }
    // Only trigger when pin changes — onSubmit closure captures latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  return (
    <Card className={shake ? "animate-shake" : undefined}>
      <CardHeader>
        <CardTitle>Masuk — Staff</CardTitle>
        <CardDescription>
          {selectedUser
            ? `Masukkan PIN untuk ${selectedUser.name}`
            : "Pilih nama kamu lalu masukkan PIN"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadingUsers ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="size-6 text-mahakan-green-700" />
          </div>
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
          <div className="space-y-5">
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
              <p role="alert" className="text-center text-sm font-medium text-danger-500">
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
        <div className="mt-6 border-t border-neutral-200 pt-4 text-center text-sm text-neutral-500">
          Owner / Manager?{" "}
          <Link
            href="/login"
            className="font-medium text-mahakan-green-700 hover:underline"
          >
            Login dengan email
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
