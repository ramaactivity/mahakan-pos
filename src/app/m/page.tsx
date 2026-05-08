import Image from "next/image";
import Link from "next/link";
import {
  ChevronRight,
  ClipboardList,
  Fingerprint,
  PackageSearch,
} from "lucide-react";

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
    href: "/m/opname",
    title: "Stock Opname",
    description:
      "Hitung stock fisik bahan dapur / bar. Submit ke owner untuk verifikasi.",
    icon: <PackageSearch className="size-6" aria-hidden />,
    status: "soon",
  },
  {
    href: "/m/po",
    title: "Purchase Order",
    description:
      "Buat permintaan belanja saat bahan menipis. Owner approve via WhatsApp.",
    icon: <ClipboardList className="size-6" aria-hidden />,
    status: "soon",
  },
];

/**
 * Sesi AD-9 — mobile landing page untuk karyawan ops.
 *
 * Karyawan akses /m dari shortcut HP, pilih modul yang mau dipakai.
 * Currently:
 *   - Absensi: live (existing /absenkaryawan)
 *   - Stock Opname: scaffold "Coming soon" — full impl di sesi follow-up
 *   - Purchase Order: scaffold "Coming soon"
 *
 * Mobile-first design: full-width cards, big tap targets ≥ 44px,
 * minimal scroll. Tipikal akses dari HP karyawan, bukan tablet POS.
 */
export default function MobileLanding() {
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

      <div>
        <p className="text-sm text-neutral-700">
          Pilih modul yang mau kamu gunakan.
        </p>
      </div>

      <div className="space-y-3">
        {MODULES.map((m) => (
          <ModuleCardLink key={m.href} module={m} />
        ))}
      </div>

      <footer className="pt-4 text-center text-[11px] text-neutral-600">
        Mahakan Coffee &amp; Space · Cisarua, Bogor
      </footer>
    </div>
  );
}

function ModuleCardLink({ module }: { module: ModuleCard }) {
  const isLive = module.status === "live";
  return (
    <Link
      href={isLive ? module.href : "#"}
      aria-disabled={!isLive}
      onClick={(e) => {
        if (!isLive) e.preventDefault();
      }}
      className={
        "block rounded-xl border bg-white p-4 transition-colors " +
        (isLive
          ? "border-neutral-200 hover:border-mahakan-green-700 active:scale-[0.99]"
          : "cursor-not-allowed border-neutral-200 opacity-60")
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            "flex size-12 shrink-0 items-center justify-center rounded-lg " +
            (isLive
              ? "bg-mahakan-green-100 text-mahakan-green-800"
              : "bg-neutral-100 text-neutral-600")
          }
        >
          {module.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900">
              {module.title}
            </h2>
            {!isLive ? (
              <span className="rounded-md bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-500">
                Soon
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-neutral-600">{module.description}</p>
        </div>
        {isLive ? (
          <ChevronRight
            className="mt-1 size-5 shrink-0 text-neutral-400"
            aria-hidden
          />
        ) : null}
      </div>
    </Link>
  );
}
