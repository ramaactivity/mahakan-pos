"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
import { DashboardHome } from "@/features/admin/sections/DashboardHome";
import { MenuSection } from "@/features/admin/sections/MenuSection";
import { SectionStub } from "@/features/admin/sections/SectionStub";
import { useSession } from "@/features/auth/SessionProvider";

export function AdminShell() {
  const router = useRouter();
  const { session, logout } = useSession();
  const [section, setSection] = useState<AdminSection>("dashboard");

  if (!session) return null;

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-neutral-50">
      <AdminLeftNav
        active={section}
        onChange={setSection}
        onLogout={onLogout}
        role={session.user.role}
      />
      <main className="flex-1 overflow-y-auto">
        {section === "dashboard" ? (
          <DashboardHome user={session.user} />
        ) : section === "menu" ? (
          <MenuSection />
        ) : section === "staff" ? (
          <SectionStub
            title="Staff Management"
            description="Tambah/edit user staff + reset PIN."
            notes={[
              "List user (Manager hanya lihat Staff, Owner lihat semua)",
              "Form tambah Staff (PIN 4-6 digit) atau Manager (email + password)",
              "Reset PIN flow + audit log",
              "Last-Owner protection",
            ]}
          />
        ) : section === "shifts" ? (
          <SectionStub
            title="Shift History"
            description="Riwayat shift semua kasir + variance flag."
            notes={[
              "List shift dengan filter tanggal + user",
              "Detail shift: list transaksi + variance breakdown",
              "Highlight shift dengan variance > Rp 10.000",
            ]}
          />
        ) : section === "cash" ? (
          <SectionStub
            title="Kas & Pengeluaran"
            description="Catat pengeluaran + pemasukan + ringkasan kas harian."
            notes={[
              "List pengeluaran (8 kategori + Refund auto)",
              "Form tambah pengeluaran dengan upload foto bukti",
              "List pemasukan non-POS (sewa event, dll)",
              "Ringkasan kas harian: POS revenue + manual + expenses + net",
            ]}
          />
        ) : section === "reports" ? (
          <SectionStub
            title="Laporan"
            description="Daily sales, item performance, P&L (Owner only), shift report."
            notes={[
              "Daily sales dengan chart hourly + payment method + top items",
              "Range sales (week/month) dengan series",
              "Item performance sortable",
              "Simple P&L (Owner only) — revenue vs expenses",
              "Shift report dengan variance flag",
            ]}
          />
        ) : section === "settings" ? (
          <SectionStub
            title="System Settings"
            description="Business info, printer, jam operasional."
            notes={[
              "Business info: nama, alamat, telepon, logo upload (Owner only)",
              "Printer: pair Bluetooth RPP02 + test print (M16)",
              "Jam operasional per hari",
              "Receipt footer + threshold variance",
              "Feature flags (Phase 2 prep)",
            ]}
          />
        ) : null}
      </main>
    </div>
  );
}
