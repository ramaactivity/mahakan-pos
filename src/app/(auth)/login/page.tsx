"use client";

import {
  Suspense,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
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

/**
 * Terjemahkan `code` dari signIn (lihat LoginError di lib/auth/config.ts) jadi
 * pesan yang jujur. Default tetap generik "Email atau password salah" supaya
 * kasus no-user/no-credential tidak membocorkan keberadaan akun.
 */
function loginErrorMessage(code?: string): string {
  if (code?.startsWith("locked:")) {
    const mins = Number(code.slice("locked:".length)) || 1;
    return `Akun terkunci sementara karena terlalu banyak percobaan. Coba lagi dalam ${mins} menit, atau minta owner reset.`;
  }
  if (code?.startsWith("invalid:")) {
    const left = Number(code.slice("invalid:".length));
    if (left >= 1) {
      return `Email atau password salah. Tinggal ${left} percobaan lagi sebelum akun terkunci sementara.`;
    }
  }
  return "Email atau password salah";
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
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

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
      const code = (res as { code?: string } | undefined)?.code;
      setError(loginErrorMessage(code));
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
            autoFocus
            leadingIcon={<Mail className="size-4" aria-hidden />}
            required
            disabled={submitting}
          />
          <div className="space-y-1.5">
            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              size="lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e: KeyboardEvent<HTMLInputElement>) =>
                setCapsLock(e.getModifierState?.("CapsLock") ?? false)
              }
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) =>
                setCapsLock(e.getModifierState?.("CapsLock") ?? false)
              }
              onBlur={() => setCapsLock(false)}
              placeholder="Password Anda"
              autoComplete="current-password"
              leadingIcon={<Lock className="size-4" aria-hidden />}
              trailingSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={submitting}
                  className="-mr-1 flex size-8 items-center justify-center rounded text-neutral-500 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 disabled:opacity-50"
                  aria-label={
                    showPassword ? "Sembunyikan password" : "Lihat password"
                  }
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              }
              required
              disabled={submitting}
            />
            {capsLock ? (
              <p className="text-xs font-medium text-warning-500">
                ⚠️ Caps Lock aktif — password peka huruf besar/kecil.
              </p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-500">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={submitting} fullWidth size="lg">
            {submitting ? "Memproses…" : "Masuk"}
          </Button>
        </form>
        {/* Sesi AE-153 — link bantu staff/kasir yang nyasar ke email login.
            Default cari ke /pin. Preserve callbackUrl/next supaya tetap balik
            ke destination yg sama setelah PIN sukses. */}
        <p className="mt-4 text-center text-xs text-neutral-500">
          Kasir / staff? Pakai{" "}
          <a
            href={`/pin${
              safeNext
                ? `?callbackUrl=${encodeURIComponent(safeNext)}`
                : ""
            }`}
            className="font-medium text-mahakan-green-700 hover:underline"
          >
            Login PIN
          </a>{" "}
          di sini.
        </p>
      </CardContent>
    </Card>
  );
}
