import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Mahakan Staff — Tools Karyawan",
  description:
    "Tools karyawan Mahakan: absensi, stock opname, purchase order, jadwal.",
  // Staff PWA manifest (sesi AD-12). Different name + icon + theme dari
  // /pos manifest, supaya kalau staff "Add to Home Screen" iconnya
  // ke-label "Mahakan Staff" + warna amber, bukan green POS.
  manifest: "/manifest-staff.webmanifest",
  applicationName: "Mahakan Staff",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mahakan Staff",
  },
  icons: {
    icon: [
      { url: "/icon-staff-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-staff-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-staff-512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#C1996B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Sesi AD-9 — mobile landing untuk karyawan ops. Container untuk
 * route /m, /m/opname, /m/po. /absenkaryawan tetap independent
 * (backward-compat link yang sudah dibagi ke staff).
 *
 * Layout: vertikal stack, max-width container biar gak ke-stretch
 * di tablet landscape. Background sama dengan /absenkaryawan untuk
 * brand consistency.
 */
export default function MobileLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-gradient-to-b from-mahakan-green-50 via-neutral-50 to-white">
      <div className="mx-auto w-full max-w-md px-4 py-6 sm:max-w-lg sm:py-8">
        {children}
      </div>
    </div>
  );
}
