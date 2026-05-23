"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Lock, Mail } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toast,
} from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, session, refresh } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("expired") === "1" ? "Sesi habis. Silakan login ulang." : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  /* Sesi AE-127 — Destination setelah login sukses, prefer:
   *   1. `?next=` (dari RequireAuth client-side)
   *   2. `?callbackUrl=` (dari proxy.ts middleware Next.js 16)
   *   3. role-based default (staff → /pos, lainnya → /dashboard)
   *
   * Safety: hanya accept relative path yang valid (start with /,
   * bukan //... untuk prevent open redirect). */
  const nextRaw = params.get("next") ?? params.get("callbackUrl") ?? "";
  const safeNext =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  useEffect(() => {
    if (status === "authenticated" && session) {
      const fallback = session.user.role === "staff" ? "/pos" : "/dashboard";
      router.replace(safeNext ?? fallback);
    }
  }, [status, session, router, safeNext]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await signIn("email-password", {
      email,
      password,
      redirect: false,
    });

    if (!res || res.error) {
      setError("Email atau password salah");
      setShake(true);
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

  return (
    <Card
      className={cn(
        "mx-auto max-w-md p-4 sm:p-5 lg:p-6",
        shake && "animate-shake",
      )}
    >
      <CardHeader className="mb-3 sm:mb-4">
        <CardTitle className="text-xl lg:text-2xl">
          Login Owner / Manager
        </CardTitle>
        <CardDescription className="text-sm">
          Masuk Back Office dengan email + password untuk akses dashboard,
          laporan, dan pengaturan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            size="lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@mahakan.id"
            autoComplete="email"
            leadingIcon={<Mail className="size-4" aria-hidden />}
            required
            disabled={submitting}
          />
          <Input
            label="Password"
            type="password"
            size="lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password Anda"
            autoComplete="current-password"
            leadingIcon={<Lock className="size-4" aria-hidden />}
            required
            disabled={submitting}
          />
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={submitting} fullWidth size="lg">
            {submitting ? "Memproses…" : "Masuk"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
