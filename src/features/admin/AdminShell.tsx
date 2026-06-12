"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Loader2, Menu, X } from "lucide-react";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
import { cn } from "@/lib/utils";
/* Sesi AE-63 phase2 P2.1 — DashboardHome eager (entry point most-visited).
 * 21 section lain di-lazy-load supaya initial bundle parse jauh lebih ringan
 * di Mac browser + tablet. Pre-fix: AdminShell import all 22 section static
 * → ~200-300KB JS dipakai mount /dashboard walaupun user cuma di dashboard. */
import { DashboardHome } from "@/features/admin/sections/DashboardHome";
import { useSession } from "@/features/auth/SessionProvider";
import { useCashDepositDashboard } from "@/features/finance/useCashDepositDashboard";
import { useApprovalsSummary } from "@/features/approvals/useApprovalsSummary";
import { hasPermission } from "@/lib/auth/rbac";

/* Helper: convert named export ke lazy-loaded default. Tiap section di-named
 * export (function NamaSection), tapi React.lazy butuh default. */
const AuditLogSection = lazy(() =>
  import("@/features/admin/sections/AuditLogSection").then((m) => ({
    default: m.AuditLogSection,
  })),
);
const ApprovalsSection = lazy(() =>
  import("@/features/admin/sections/ApprovalsSection").then((m) => ({
    default: m.ApprovalsSection,
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
const PurchasingSection = lazy(() =>
  import("@/features/admin/sections/PurchasingSection").then((m) => ({
    default: m.PurchasingSection,
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
const CogsVarianceSection = lazy(() =>
  import("@/features/admin/sections/CogsVarianceSection").then((m) => ({
    default: m.CogsVarianceSection,
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
const AggregatorOnlineSection = lazy(() =>
  import("@/features/admin/sections/AggregatorOnlineSection").then((m) => ({
    default: m.AggregatorOnlineSection,
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
const OperasionalChecklistSection = lazy(() =>
  import("@/features/admin/sections/OperasionalChecklistSection").then((m) => ({
    default: m.OperasionalChecklistSection,
  })),
);
const InternalDebtsSection = lazy(() =>
  import("@/features/admin/sections/InternalDebtsSection").then((m) => ({
    default: m.InternalDebtsSection,
  })),
);
const NotaArchiveSection = lazy(() =>
  import("@/features/admin/sections/NotaArchiveSection").then((m) => ({
    default: m.NotaArchiveSection,
  })),
);

/* Sesi AE-63 polish-2 — daftar AdminSection valid untuk hash-routing
 * validation (filter invalid hash dari URL). */
const VALID_SECTIONS: ReadonlySet<AdminSection> = new Set([
  "dashboard",
  "approvals",
  "menu",
  "inventory",
  "suppliers",
  "purchase_requests",
  "purchasing",
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
  "aggregator_online",
  "promos",
  "reports",
  "audit",
  "journal_retry",
  "investors",
  "internal_debts",
  "operasional_checklist",
  "nota_archive",
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
  /* Sesi AE-126 — sidebar drawer state untuk mobile. Default closed di
   * mobile (drawer di-hide), default open behavior di desktop (sidebar
   * static lewat CSS md: breakpoint). */
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    /* Sesi AE-126 — auto-close drawer di mobile saat user pilih section.
     * Di desktop sidebar static, state ini tidak berpengaruh. */
    setSidebarOpen(false);
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

  /* Sesi AE-126 — Lock body scroll saat drawer open di mobile supaya
   * tidak ada double-scroll (sidebar list + page content). */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (sidebarOpen) {
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
  }, [sidebarOpen]);

  /* Sesi AE-123 — sidebar badge pending setoran. Hanya fetch kalau user
   * punya permission verify (owner). Cek session sebelum hook supaya hook
   * order tetap stabil walau session null. */
  const canVerifyDeposits = session
    ? hasPermission(session.user.role, "cash_deposit.verify")
    : false;
  const depositDashboardQuery = useCashDepositDashboard();
  /* Sesi AE-160 — Pusat Persetujuan: badge total pending across 5 flows.
   * Owner + Manager + Supervisor bisa view (approval_queue.view); direct
   * approve owner-only (di-enforce server-side per-action). */
  const canViewApprovals = session
    ? hasPermission(session.user.role, "approval_queue.view")
    : false;
  const approvalsSummary = useApprovalsSummary(canViewApprovals);
  const sidebarBadges: Partial<Record<AdminSection, number>> = {};
  if (canVerifyDeposits) {
    sidebarBadges.setoran_tunai = depositDashboardQuery.data?.pendingCount ?? 0;
  }
  if (canViewApprovals) {
    sidebarBadges.approvals = approvalsSummary.data?.total ?? 0;
  }
  const depositBadges =
    Object.keys(sidebarBadges).length > 0 ? sidebarBadges : undefined;

  if (!session) return null;

  async function onLogout() {
    await logout("/login");
  }

  return (
    <div className="relative flex h-[calc(100vh-4rem)] overflow-hidden bg-neutral-50">
      {/* Sesi AE-126 — Mobile hamburger toggle, fixed di top-left
       * content area, hidden di tablet+ (md:hidden). Pakai background
       * tegas + shadow supaya tetap visible di atas content apa pun. */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className={cn(
          "fixed left-3 top-[4.5rem] z-30 inline-flex size-10 items-center justify-center rounded-full border border-neutral-300 bg-white shadow-md transition-opacity md:hidden",
          sidebarOpen ? "pointer-events-none opacity-0" : "opacity-100",
        )}
        aria-label="Buka menu"
      >
        <Menu className="size-5 text-neutral-700" aria-hidden />
      </button>

      {/* Sesi AE-126 — Backdrop overlay saat drawer open di mobile. */}
      {sidebarOpen ? (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 top-16 z-30 bg-black/40 md:hidden"
          aria-label="Tutup menu"
        />
      ) : null}

      {/* Sesi AE-126 — Sidebar drawer di mobile (fixed, slide-in dari
       * kiri), static di tablet+ (md:relative). */}
      <div
        className={cn(
          "fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] transform transition-transform md:relative md:top-0 md:z-0 md:h-full md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Close button di top-right drawer, mobile only. */}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 md:hidden"
          aria-label="Tutup menu"
        >
          <X className="size-4" aria-hidden />
        </button>
        <AdminLeftNav
          active={section}
          onChange={setSection}
          onLogout={onLogout}
          role={session.user.role}
          badges={depositBadges}
        />
      </div>
      {/* Sesi AE-126 — main content. Padding-top adaptif: di mobile
       * tambah pt-14 supaya hamburger button (top-[4.5rem]) tidak overlap
       * judul section. Di tablet+ no extra padding (sidebar visible,
       * no hamburger). */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {section === "dashboard" ? (
          <DashboardHome user={session.user} onNavigate={setSection} />
        ) : (
          <Suspense fallback={<SectionFallback />}>
            {section === "approvals" ? (
              <ApprovalsSection />
            ) : section === "menu" ? (
              <MenuSection />
            ) : section === "cogs_variance" ? (
              <CogsVarianceSection />
            ) : section === "inventory" ? (
              <InventorySection onNavigate={setSection} />
            ) : section === "suppliers" ? (
              <SuppliersSection />
            ) : section === "purchasing" ? (
              <PurchasingSection />
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
              <ShiftsSection viewerRole={session.user.role} />
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
            ) : section === "aggregator_online" ? (
              <AggregatorOnlineSection />
            ) : section === "reports" ? (
              <ReportsSection viewerRole={session.user.role} />
            ) : section === "audit" ? (
              <AuditLogSection viewerRole={session.user.role} />
            ) : section === "journal_retry" ? (
              <JournalRetryQueueSection />
            ) : section === "investors" ? (
              <InvestorsSection viewerRole={session.user.role} />
            ) : section === "internal_debts" ? (
              <InternalDebtsSection viewerRole={session.user.role} />
            ) : section === "operasional_checklist" ? (
              <OperasionalChecklistSection viewerRole={session.user.role} />
            ) : section === "nota_archive" ? (
              <NotaArchiveSection viewerRole={session.user.role} />
            ) : section === "settings" ? (
              <SettingsSection />
            ) : null}
          </Suspense>
        )}
      </main>
    </div>
  );
}
