"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
import { AuditLogSection } from "@/features/admin/sections/AuditLogSection";
import { JournalRetryQueueSection } from "@/features/admin/sections/JournalRetryQueueSection";
import { HrOperationsSection } from "@/features/admin/sections/HrOperationsSection";
import { CashSection } from "@/features/admin/sections/CashSection";
import { FinanceSection } from "@/features/admin/sections/FinanceSection";
import { AccountingSection } from "@/features/admin/sections/AccountingSection";
import { PromoSection } from "@/features/admin/sections/PromoSection";
import { PurchaseRequestsSection } from "@/features/admin/sections/PurchaseRequestsSection";
import { CustomersSection } from "@/features/admin/sections/CustomersSection";
import { DashboardHome } from "@/features/admin/sections/DashboardHome";
import { EmployeesSection } from "@/features/admin/sections/EmployeesSection";
import { InventorySection } from "@/features/admin/sections/InventorySection";
import { InvestorsSection } from "@/features/admin/sections/InvestorsSection";
import { MenuSection } from "@/features/admin/sections/MenuSection";
import { BalanceAccountSection } from "@/features/admin/sections/BalanceAccountSection";
import { ReconciliationSection } from "@/features/admin/sections/ReconciliationSection";
import { ReportsSection } from "@/features/admin/sections/ReportsSection";
import { SettingsSection } from "@/features/admin/sections/SettingsSection";
import { SetoranTunaiSection } from "@/features/admin/sections/SetoranTunaiSection";
import { ShiftsSection } from "@/features/admin/sections/ShiftsSection";
import { StaffSection } from "@/features/admin/sections/StaffSection";
import { SuppliersSection } from "@/features/admin/sections/SuppliersSection";
import { useSession } from "@/features/auth/SessionProvider";

/* Sesi AE-63 polish-2 — daftar AdminSection valid untuk hash-routing
 * validation (filter invalid hash dari URL). */
const VALID_SECTIONS: ReadonlySet<AdminSection> = new Set([
  "dashboard",
  "menu",
  "inventory",
  "suppliers",
  "purchase_requests",
  "customers",
  "staff",
  "employees",
  "hr_operations",
  "shifts",
  "cash",
  "setoran_tunai",
  "finance",
  "accounting",
  "balance_account",
  "reconciliation",
  "promos",
  "reports",
  "audit",
  "journal_retry",
  "investors",
  "settings",
]);

function readSectionFromHash(): AdminSection {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace(/^#/, "");
  return VALID_SECTIONS.has(hash as AdminSection)
    ? (hash as AdminSection)
    : "dashboard";
}

export function AdminShell() {
  const { session, logout } = useSession();
  const [section, setSectionState] = useState<AdminSection>("dashboard");

  /* Sesi AE-63 polish-2 — Section state persist via URL hash.
   * Owner directive: refresh harus stay di section yang sama (sebelumnya
   * selalu kembali ke dashboard). URL hash approach:
   *  - shareable link (mis. /dashboard#investors)
   *  - browser back/forward natural
   *  - no localStorage staleness
   * Listen hashchange untuk back-button support. */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSectionState(readSectionFromHash());
    /* eslint-enable react-hooks/set-state-in-effect */
    function onHashChange() {
      setSectionState(readSectionFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setSection = useCallback((next: AdminSection) => {
    setSectionState(next);
    if (typeof window !== "undefined") {
      /* History.replaceState supaya tidak menumpuk entries setiap klik
       * nav. User pakai back-button balik ke halaman previous (login/POS)
       * bukan section sebelumnya, sesuai expectation. */
      const nextHash = `#${next}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", nextHash);
      }
    }
  }, []);

  if (!session) return null;

  async function onLogout() {
    await logout("/login");
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
          <DashboardHome user={session.user} onNavigate={setSection} />
        ) : section === "menu" ? (
          <MenuSection />
        ) : section === "inventory" ? (
          <InventorySection onNavigate={setSection} />
        ) : section === "suppliers" ? (
          <SuppliersSection />
        ) : section === "purchase_requests" ? (
          <PurchaseRequestsSection />
        ) : section === "customers" ? (
          <CustomersSection />
        ) : section === "staff" ? (
          <StaffSection
            viewerRole={session.user.role}
            viewerUserId={session.user.id}
          />
        ) : section === "employees" ? (
          <EmployeesSection />
        ) : section === "hr_operations" ? (
          <HrOperationsSection viewerRole={session.user.role} />
        ) : section === "shifts" ? (
          <ShiftsSection />
        ) : section === "cash" ? (
          <CashSection viewerUserId={session.user.id} />
        ) : section === "setoran_tunai" ? (
          <SetoranTunaiSection viewerRole={session.user.role} />
        ) : section === "finance" ? (
          <FinanceSection viewerRole={session.user.role} />
        ) : section === "accounting" ? (
          <AccountingSection viewerRole={session.user.role} />
        ) : section === "promos" ? (
          <PromoSection />
        ) : section === "balance_account" ? (
          <BalanceAccountSection />
        ) : section === "reconciliation" ? (
          <ReconciliationSection viewerRole={session.user.role} />
        ) : section === "reports" ? (
          <ReportsSection viewerRole={session.user.role} />
        ) : section === "audit" ? (
          <AuditLogSection viewerRole={session.user.role} />
        ) : section === "journal_retry" ? (
          <JournalRetryQueueSection />
        ) : section === "investors" ? (
          <InvestorsSection viewerRole={session.user.role} />
        ) : section === "settings" ? (
          <SettingsSection />
        ) : null}
      </main>
    </div>
  );
}
