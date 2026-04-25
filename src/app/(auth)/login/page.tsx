"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
import { authService, isOk } from "@/mocks/services";

export default function LoginPage() {
  const router = useRouter();
  const { status, session, refresh } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await authService.loginWithEmailPassword(email, password);

    if (!isOk(res)) {
      setError(res.error.message);
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setSubmitting(false);
      return;
    }

    toast.success(`Selamat datang, ${res.data.user.name}`);
    await refresh();
    router.replace(
      res.data.user.role === "staff" ? "/pos" : "/dashboard",
    );
  }

  return (
    <Card className={shake ? "animate-shake" : undefined}>
      <CardHeader>
        <CardTitle>Masuk — Owner / Manager</CardTitle>
        <CardDescription>
          Login dengan email dan password untuk akses back office.
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
          Kamu barista/kasir?{" "}
          <Link
            href="/pin"
            className="font-medium text-mahakan-green-700 hover:underline"
          >
            Login dengan PIN
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
