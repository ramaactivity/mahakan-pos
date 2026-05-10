"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Fingerprint,
  LogOut,
  PackageSearch,
} from "lucide-react";
import { Spinner, toast } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { InstallAppButton } from "@/features/pwa/InstallAppButton";

interface ModuleCard {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  status: "live" | "soon";
}

const MODULES: ModuleCard[] = [
  {
    href: "/absenkaryawan",
    title: "Absensi",
    description:
      "Clock-in / clock-out kerja dengan foto selfie + GPS lokasi outlet.",
    icon: <Fingerprint className="size-6" aria-hidden />,
    status: "live",
  },
  {
    href: "/m/jadwal",
    title: "Jadwal Kerja",
    description:
      "Lihat jadwal masuk minggu ini + minggu berikutnya. Disusun oleh HR.",
    icon: <CalendarDays className="size-6" aria-hidden />,
    status: "live",
  },
  {
    href: "/m/opname",
    title: "Stock Opname",
    description:
      "Hitung stock fisik bahan dapur / bar. Submit ke owner untuk verifikasi.",
    icon: <PackageSearch className="size-6" aria-hidden />,
    status: "live",
  },
  {
    href: "/m/po",
    title: "Purchase Order",
    description:
      "Buat permintaan belanja saat bahan menipis. Owner approve via WhatsApp.",
    icon: <ClipboardList className="size-6" aria-hidden />,
    status: "live",
  },
];

/**
 * Sesi AE-15 — Mobile staff landing dengan auth gate.
 * Sesi AE-19 — redirect unauth ke /m/login (dedicated staff login),
 * bukan /pin?callbackUrl=/m (yang dipakai shared POS/BackOffice flow).
 * Owner feedback: login page bercampur bikin bingung — pisah saja.
 *
 * Auth flow:
 *   - status="loading" → spinner
 *   - status="unauthenticated" → redirect /m/login
 *   - status="authenticated" → render dashboard
 */
export default function MobileLanding() {
  const router = useRouter();
  const { status, session, logout } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated" || !session) {
      router.replace("/m/login");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-mahakan-green-700" />
      </div>
    );
  }
  if (status === "unauthenticated" || !session) return null;

  const userName = session.user.name ?? "Karyawan";
  const firstName = userName.split(/\s+/)[0] ?? userName;

  async function handleLogout() {
    try {
      await logout("/m/login");
    } catch {
      toast.error("Gagal logout");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <Image
          src="/assets/logo/Logo_Mahakan_Hijau_Transparent.png"
          alt="Mahakan Coffee & Space"
          width={120}
          height={170}
          priority
          className="h-14 w-auto"
        />
        <div>
          <h1 className="text-xl font-bold text-mahakan-green-900">
            Mahakan Karyawan
          </h1>
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-600">
            Mobile Tools
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-mahakan-green-700/30 bg-mahakan-green-50 p-4">
        <p className="text-xs uppercase tracking-wider text-mahakan-green-900/70">
          Login sebagai
        </p>
        <p className="mt-0.5 text-base font-bold text-mahakan-green-900">
          Hai, {firstName}!
        </p>
        <p className="text-xs text-neutral-700">
          Pilih modul yang mau kamu gunakan.
        </p>
      </section>

      <div className="space-y-3">
        {MODULES.map((m) => (
          <ModuleCardLink key={m.href} module={m} />
        ))}
      </div>

      {/* Sesi AE-24 — PWA install button. Hanya muncul kalau browser
       * support beforeinstallprompt + belum installed. iOS Safari kasih
       * instruksi manual via modal. */}
      <InstallAppButton />

      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
      >
        <LogOut className="size-4" aria-hidden /> Keluar
      </button>

      <footer className="pt-4 text-center text-[11px] text-neutral-600">
        Mahakan Coffee &amp; Space · Cisarua, Bogor
      </footer>
    </div>
  );
}

function ModuleCardLink({ module: m }: { module: ModuleCard }) {
  const isLive = m.status === "live";

  const inner = (
    <div className="flex items-start gap-3">
      <div
        className={
          "flex size-12 shrink-0 items-center justify-center rounded-lg " +
          (isLive
            ? "bg-mahakan-green-100 text-mahakan-green-800"
            : "bg-neutral-100 text-neutral-600")
        }
      >
        {m.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-neutral-900">
            {m.title}
          </h2>
          {!isLive ? (
            <span className="rounded-md bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-500">
              Soon
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-neutral-600">{m.description}</p>
      </div>
      {isLive ? (
        <ChevronRight
          className="mt-1 size-5 shrink-0 text-neutral-400"
          aria-hidden
        />
      ) : null}
    </div>
  );

  if (!isLive) {
    return (
      <div
        aria-disabled
        className="block rounded-xl border border-neutral-200 bg-white p-4 opacity-60"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={m.href}
      className="block rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-mahakan-green-700 active:scale-[0.99]"
    >
      {inner}
    </Link>
  );
}
