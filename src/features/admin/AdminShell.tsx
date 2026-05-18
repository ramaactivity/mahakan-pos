"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
/* Sesi AE-63 phase2 P2.1 — DashboardHome eager (entry point most-visited).
 * 21 section lain di-lazy-load supaya initial bundle parse jauh lebih ringan
 * di Mac browser + tablet. Pre-fix: AdminShell import all 22 section static
 * → ~200-300KB JS dipakai mount /dashboard walaupun user cuma di dashboard. */
import { DashboardHome } from "@/features/admin/sections/DashboardHome";
import { useSession } from "@/features/auth/SessionProvider";

/* Helper: convert named export ke lazy-loaded default. Tiap section di-named
 * export (function NamaSection), tapi React.lazy butuh default. */
const AuditLogSection = lazy(() =>
  import("@/features/admin/sections/AuditLogSection").then((m) => ({
    default: m.AuditLogSection,
  })),
);
const JournalRetryQueueSection = lazy(() =>
  import("@/features/admin/sections/JournalRetryQueueSection").then((m) => ({
    default: m.JournalRetryQueueSection,
  })),
);
const HrOperationsSection = lazy(() =>
  import("@/features/admin/sections/HrOperationsSection").then((m) => ({
    default: m.HrOperationsSection,
  })),
);
const CashSection = lazy(() =>
  import("@/features/admin/sections/CashSection").then((m) => ({
    default: m.CashSection,
  })),
);
const FinanceSection = lazy(() =>
  import("@/features/admin/sections/FinanceSection").then((m) => ({
    default: m.FinanceSection,
  })),
);
const AccountingSection = lazy(() =>
  import("@/features/admin/sections/AccountingSection").then((m) => ({
    default: m.AccountingSection,
  })),
);
const PromoSection = lazy(() =>
  import("@/features/admin/sections/PromoSection").then((m) => ({
    default: m.PromoSection,
  })),
);
const PurchaseRequestsSection = lazy(() =>
  import("@/features/admin/sections/PurchaseRequestsSection").then((m) => ({
    default: m.PurchaseRequestsSection,
  })),
);
const CustomersSection = lazy(() =>
  import("@/features/admin/sections/CustomersSection").then((m) => ({
    default: m.CustomersSection,
  })),
);
const EmployeesSection = lazy(() =>
  import("@/features/admin/sections/EmployeesSection").then((m) => ({
    default: m.EmployeesSection,
  })),
);
const InventorySection = lazy(() =>
  import("@/features/admin/sections/InventorySection").then((m) => ({
    default: m.InventorySection,
  })),
);
const InvestorsSection = lazy(() =>
  import("@/features/admin/sections/InvestorsSection").then((m) => ({
    default: m.InvestorsSection,
  })),
);
const MenuSection = lazy(() =>
  import("@/features/admin/sections/MenuSection").then((m) => ({
    default: m.MenuSection,
  })),
);
const BalanceAccountSection = lazy(() =>
  import("@/features/admin/sections/BalanceAccountSection").then((m) => ({
    default: m.BalanceAccountSection,
  })),
);
const ReconciliationSection = lazy(() =>
  import("@/features/admin/sections/ReconciliationSection").then((m) => ({
    default: m.ReconciliationSection,
  })),
);
const ReportsSection = lazy(() =>
  import("@/features/admin/sections/ReportsSection").then((m) => ({
    default: m.ReportsSection,
  })),
);
const SettingsSection = lazy(() =>
  import("@/features/admin/sections/SettingsSection").then((m) => ({
    default: m.SettingsSection,
  })),
);
const SetoranTunaiSection = lazy(() =>
  import("@/features/admin/sections/SetoranTunaiSection").then((m) => ({
    default: m.SetoranTunaiSection,
  })),
);
const ShiftsSection = lazy(() =>
  import("@/features/admin/sections/ShiftsSection").then((m) => ({
    default: m.ShiftsSection,
  })),
);
const StaffSection = lazy(() =>
  import("@/features/admin/sections/StaffSection").then((m) => ({
    default: m.StaffSection,
  })),
);
const SuppliersSection = lazy(() =>
  import("@/features/admin/sections/SuppliersSection").then((m) => ({
    default: m.SuppliersSection,
  })),
);

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

/* Sesi AE-63 phase2 P2.1 — Suspense fallback untuk section yang lazy. */
function SectionFallback() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex items-center gap-2 text-neutral-500">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Memuat section…</span>
      </div>
    </div>
  );
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
        ) : (
          <Suspense fallback={<SectionFallback />}>
            {section === "menu" ? (
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
          </Suspense>
        )}
      </main>
    </div>
  );
}
