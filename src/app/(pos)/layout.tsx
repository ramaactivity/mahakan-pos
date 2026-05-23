import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PosClientShell } from "./client-shell";

/**
 * Sesi AE-126 — Server layout untuk POS route group. Metadata override
 * supaya install dari /pos pakai manifest.webmanifest (POS tablet).
 */
export const metadata: Metadata = {
  title: "Mahakan POS — Kasir",
  description:
    "Sistem POS Mahakan Coffee & Space untuk kasir tablet (Galaxy A7 Lite).",
  manifest: "/manifest.webmanifest",
  applicationName: "Mahakan POS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mahakan POS",
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

export default function PosLayout({ children }: { children: ReactNode }) {
  return <PosClientShell>{children}</PosClientShell>;
}
