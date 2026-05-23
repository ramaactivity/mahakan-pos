import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AdminClientShell } from "./client-shell";

/**
 * Sesi AE-126 — Server layout untuk admin route group supaya metadata
 * (manifest, app name, icon) bisa di-override. Sebelumnya layout client-only
 * → tidak bisa export metadata → fallback ke /manifest.webmanifest (POS).
 *
 * Owner install Mahakan POS dari URL /dashboard (atau mahakan-pos.vercel.app
 * yang redirect ke /dashboard untuk owner) → manifest-admin.webmanifest
 * dipakai → home screen icon → klik buka → start_url /dashboard.
 */
export const metadata: Metadata = {
  title: "Mahakan POS — Back Office",
  description:
    "Back office Mahakan Coffee & Space: dashboard, keuangan, inventory, HR, laporan.",
  manifest: "/manifest-admin.webmanifest",
  applicationName: "Mahakan Admin",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mahakan Admin",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3D7557",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminClientShell>{children}</AdminClientShell>;
}
