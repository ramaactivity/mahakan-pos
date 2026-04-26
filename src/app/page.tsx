import Image from "next/image";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-b from-mahakan-green-50 via-neutral-50 to-white px-6 py-12">
      <DecorativeBackdrop />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">
        <Image
          src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
          alt="Mahakan Coffee &amp; Space"
          width={160}
          height={226}
          className="h-auto w-32 md:w-40 animate-fade-up"
          priority
        />

        <h1 className="mt-8 text-balance text-3xl font-semibold tracking-tight text-mahakan-green-900 md:text-4xl animate-fade-up [animation-delay:120ms]">
          Mahakan Coffee &amp; Space
        </h1>
        <p className="mt-3 max-w-sm text-pretty text-sm text-neutral-600 md:text-base animate-fade-up [animation-delay:200ms]">
          Sistem kasir &amp; back-office. Silakan masuk untuk melanjutkan.
        </p>

        <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center animate-fade-up [animation-delay:280ms]">
          <Link
            href="/login"
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-mahakan-green-700 px-6 py-3.5 text-base font-medium text-white shadow-lg shadow-mahakan-green-900/15 transition hover:-translate-y-0.5 hover:bg-mahakan-green-800 hover:shadow-xl hover:shadow-mahakan-green-900/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mahakan-green-700"
          >
            Masuk Owner / Manager
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link
            href="/pin"
            className="group inline-flex items-center justify-center gap-2 rounded-xl border border-mahakan-green-200 bg-white/80 px-6 py-3.5 text-base font-medium text-mahakan-green-900 backdrop-blur transition hover:-translate-y-0.5 hover:border-mahakan-green-300 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mahakan-green-700"
          >
            <KeyRound className="size-4" aria-hidden />
            Login Staff dengan PIN
          </Link>
        </div>

        <p className="mt-6 text-xs text-neutral-500 animate-fade-up [animation-delay:360ms]">
          Owner pakai email + password · Staff cukup pilih avatar &amp; ketik PIN
        </p>
      </div>
    </main>
  );
}

function DecorativeBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-mahakan-green-200/40 blur-3xl animate-drift" />
      <div className="absolute -right-40 top-32 size-[32rem] rounded-full bg-mahakan-green-100/60 blur-3xl animate-drift [animation-delay:-7s]" />
      <div className="absolute bottom-0 left-1/2 size-[36rem] -translate-x-1/2 translate-y-1/3 rounded-full bg-neutral-100/80 blur-3xl" />
    </div>
  );
}
