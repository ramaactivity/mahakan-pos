"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
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

  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(session.user.role === "staff" ? "/pos" : "/dashboard");
    }
  }, [status, session, router]);

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
    <Card className={shake ? "animate-shake" : undefined}>
      <CardHeader>
        <CardTitle>Masuk — Back Office</CardTitle>
        <CardDescription>
          Login dengan email dan password untuk akses dashboard, laporan, dan
          pengaturan. Khusus Owner / Manager.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
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
        <div className="mt-6 border-t border-neutral-200 pt-4 text-center text-sm text-neutral-500">
          Mau langsung ke kasir?{" "}
          <Link
            href="/pin"
            className="font-medium text-mahakan-green-700 hover:underline"
          >
            Masuk POS dengan PIN
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
