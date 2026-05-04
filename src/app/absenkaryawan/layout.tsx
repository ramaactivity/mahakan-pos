import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Absensi Karyawan — Mahakan Coffee & Space",
  description: "Absen masuk / pulang kerja",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Phase 4 (sesi AB) — mobile absensi route. Bypass admin/POS shell.
 * No NextAuth; auth via attendance PIN per karyawan. Mobile-first
 * layout with no max-width — designed for phone portrait.
 */
export default function AbsenKaryawanLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-gradient-to-b from-mahakan-green-50 via-neutral-50 to-white">
      {children}
    </div>
  );
}
