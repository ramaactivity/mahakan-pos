import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Coffee,
  KeyRound,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-mahakan-green-50 via-neutral-50 to-white">
      <DecorativeBackdrop />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <div className="flex items-center gap-2.5 animate-fade-up">
          <Image
            src="/assets/logo/Logo_Mahakan_Hijau.png"
            alt="Mahakan Coffee &amp; Space"
            width={36}
            height={36}
            className="size-9 mix-blend-multiply"
            priority
          />
          <span className="font-semibold tracking-tight text-mahakan-green-900">
            Mahakan
          </span>
        </div>
        <Link
          href="/showcase"
          className="hidden text-xs font-medium text-neutral-500 underline-offset-4 transition hover:text-mahakan-green-700 hover:underline sm:inline"
        >
          Design system
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pb-16 pt-12 text-center md:pb-24 md:pt-20 md:px-10">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-mahakan-green-200 bg-white/70 px-3 py-1 text-xs font-medium text-mahakan-green-800 backdrop-blur animate-fade-up [animation-delay:80ms]"
        >
          <Coffee className="size-3.5" aria-hidden />
          Mahakan Coffee &amp; Space — POS Phase 1
        </span>

        <Image
          src="/assets/logo/Logo_Mahakan_Hijau.png"
          alt=""
          width={140}
          height={140}
          className="mt-10 size-28 mix-blend-multiply md:size-36 animate-fade-up [animation-delay:160ms]"
          priority
          aria-hidden
        />

        <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-mahakan-green-900 md:text-6xl lg:text-7xl animate-fade-up [animation-delay:240ms]">
          Homely space,
          <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-mahakan-green-700 via-mahakan-green-600 to-mahakan-green-800 bg-clip-text text-transparent">
            {" "}quietly powerful POS.
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-base text-neutral-600 md:text-lg animate-fade-up [animation-delay:320ms]">
          Sistem kasir &amp; back-office untuk Mahakan Coffee &amp; Space —
          ringan, offline-aware, dan dirancang khusus untuk ritme kafe sehari-hari.
        </p>

        <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center animate-fade-up [animation-delay:400ms]">
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

        <p className="mt-5 text-xs text-neutral-500 animate-fade-up [animation-delay:480ms]">
          Owner pakai email + password · Staff cukup pilih avatar &amp; ketik PIN
        </p>

        <a
          href="#capabilities"
          aria-label="Lihat fitur"
          className="mt-16 hidden flex-col items-center gap-1 text-neutral-400 hover:text-mahakan-green-700 md:flex animate-fade-up [animation-delay:600ms]"
        >
          <span className="text-[10px] uppercase tracking-[0.2em]">Scroll</span>
          <span className="animate-nudge">↓</span>
        </a>
      </section>

      {/* Capabilities */}
      <section
        id="capabilities"
        className="relative z-10 mx-auto max-w-6xl px-6 pb-20 md:px-10 md:pb-28"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Capability
            icon={<Coffee className="size-5" aria-hidden />}
            title="Kasir cepat 3-kolom"
            description="Tap menu, atur modifier, bayar — semua di satu layar tablet, tanpa pindah halaman."
          />
          <Capability
            icon={<WifiOff className="size-5" aria-hidden />}
            title="Tetap jalan saat offline"
            description="Wi-Fi mati? Transaksi tersimpan lokal, otomatis sync begitu jaringan kembali."
          />
          <Capability
            icon={<Smartphone className="size-5" aria-hidden />}
            title="Install seperti app"
            description="PWA di Chrome / Edge — icon di home screen, tanpa Play Store."
          />
        </div>

        <div className="mt-14 grid items-start gap-10 rounded-2xl border border-mahakan-green-100 bg-white/60 p-8 shadow-sm backdrop-blur md:grid-cols-2 md:p-12">
          <div>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-mahakan-green-700">
              Untuk Owner Rama
            </span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-mahakan-green-900 md:text-3xl">
              Satu sistem dari pesanan sampai laporan harian.
            </h2>
            <p className="mt-4 text-neutral-600">
              Buka shift pagi, terima pesanan sepanjang hari, void / refund dengan
              persetujuan PIN, tutup shift dengan ringkasan variance kas — semuanya
              tercatat ke Postgres dan bisa direview kapan saja dari Dashboard.
            </p>
          </div>
          <ul className="grid gap-3 text-sm text-neutral-700">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mahakan-green-700" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-mahakan-green-100/60 bg-white/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-6 text-xs text-neutral-500 md:flex-row md:items-center md:px-10">
          <span>
            © {new Date().getFullYear()} Mahakan Coffee &amp; Space · Internal POS
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/showcase"
              className="underline-offset-4 transition hover:text-mahakan-green-700 hover:underline"
            >
              Design system
            </Link>
            <span aria-hidden className="text-neutral-300">·</span>
            <span>Phase 1 build</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Capability({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-mahakan-green-100 bg-white/70 p-6 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-mahakan-green-200 hover:shadow-md">
      <div className="absolute -right-12 -top-12 size-32 rounded-full bg-mahakan-green-100/60 blur-2xl transition group-hover:bg-mahakan-green-200/70" aria-hidden />
      <div className="relative flex size-10 items-center justify-center rounded-xl bg-mahakan-green-100 text-mahakan-green-800">
        {icon}
      </div>
      <h3 className="relative mt-4 text-lg font-semibold tracking-tight text-mahakan-green-900">
        {title}
      </h3>
      <p className="relative mt-2 text-sm text-neutral-600">
        {description}
      </p>
    </div>
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

const HIGHLIGHTS = [
  "Manajemen menu 43 item + modifier (Hot / Iced, ukuran, susu)",
  "Riwayat transaksi dengan void & refund (perlu PIN approver untuk Staff)",
  "Catat pengeluaran & pemasukan tunai di luar transaksi",
  "Laporan harian, performa item, dan P&L (khusus Owner)",
  "PWA installable + auto-sync setelah offline",
] as const;
