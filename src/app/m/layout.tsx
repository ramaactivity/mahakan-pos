import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Karyawan Mobile — Mahakan Coffee & Space",
  description:
    "Modul karyawan mobile: absen, stock opname, purchase order.",
};

export const viewport: Viewport = {
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
