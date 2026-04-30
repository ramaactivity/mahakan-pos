import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, ShoppingBag } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-gradient-to-b from-mahakan-green-50 via-neutral-50 to-white px-4 py-8 sm:px-6 sm:py-12">
      <DecorativeBackdrop />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center text-center">
        <Image
          src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
          alt="Mahakan Coffee &amp; Space"
          width={160}
          height={226}
          className="h-auto w-24 animate-fade-up sm:w-28 md:w-36"
          priority
        />

        <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight text-mahakan-green-900 sm:mt-8 sm:text-3xl md:text-4xl animate-fade-up [animation-delay:120ms]">
          Mahakan Coffee &amp; Space
        </h1>
        <p className="mt-2 max-w-sm text-pretty text-sm text-neutral-600 sm:mt-3 md:text-base animate-fade-up [animation-delay:200ms]">
          Pilih cara masuk yang sesuai dengan peran Anda.
        </p>

        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 animate-fade-up [animation-delay:280ms]">
          <EntryCard
            href="/pin"
            icon={<ShoppingBag className="size-5" aria-hidden />}
            title="POS / Kasir"
            description="Login dengan PIN — untuk Staff, Manager, atau Owner yang mau buka kasir."
            cta="Masuk POS"
            variant="secondary"
          />
          <EntryCard
            href="/login"
            icon={<LayoutDashboard className="size-5" aria-hidden />}
            title="Back Office"
            description="Login dengan email + password — untuk Owner / Manager akses dashboard."
            cta="Masuk Back Office"
            variant="primary"
          />
        </div>

        <p className="mt-6 max-w-md text-xs text-neutral-500 sm:text-sm animate-fade-up [animation-delay:360ms]">
          Bingung pilih? <span className="font-medium text-neutral-700">Kasir / Staff lapangan → POS</span>.{" "}
          <span className="font-medium text-neutral-700">Owner / Manager mau lihat laporan → Back Office</span>.
        </p>
      </div>
    </main>
  );
}

interface EntryCardProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  variant: "primary" | "secondary";
}

function EntryCard({
  href,
  icon,
  title,
  description,
  cta,
  variant,
}: EntryCardProps) {
  return (
    <Link
      href={href}
      className={
        variant === "primary"
          ? "group flex flex-col items-start gap-3 rounded-2xl bg-mahakan-green-700 p-5 text-left text-white shadow-lg shadow-mahakan-green-900/15 transition-all hover:-translate-y-0.5 hover:bg-mahakan-green-800 hover:shadow-xl hover:shadow-mahakan-green-900/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mahakan-green-700 sm:p-6"
          : "group flex flex-col items-start gap-3 rounded-2xl border border-mahakan-green-200 bg-white/80 p-5 text-left text-mahakan-green-900 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-mahakan-green-300 hover:bg-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mahakan-green-700 sm:p-6"
      }
    >
      <span
        className={
          variant === "primary"
            ? "inline-flex size-10 items-center justify-center rounded-xl bg-white/15 text-white"
            : "inline-flex size-10 items-center justify-center rounded-xl bg-mahakan-green-100 text-mahakan-green-700"
        }
      >
        {icon}
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        <p
          className={
            variant === "primary"
              ? "text-xs leading-relaxed text-mahakan-green-50/85 sm:text-sm"
              : "text-xs leading-relaxed text-neutral-600 sm:text-sm"
          }
        >
          {description}
        </p>
      </div>
      <span
        className={
          variant === "primary"
            ? "mt-auto inline-flex items-center gap-1 text-sm font-medium text-white"
            : "mt-auto inline-flex items-center gap-1 text-sm font-medium text-mahakan-green-700"
        }
      >
        {cta}
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
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
