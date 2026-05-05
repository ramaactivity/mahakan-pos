"use client";

import { useState } from "react";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
import { AuditLogSection } from "@/features/admin/sections/AuditLogSection";
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
import { MenuSection } from "@/features/admin/sections/MenuSection";
import { ReportsSection } from "@/features/admin/sections/ReportsSection";
import { SettingsSection } from "@/features/admin/sections/SettingsSection";
import { ShiftsSection } from "@/features/admin/sections/ShiftsSection";
import { StaffSection } from "@/features/admin/sections/StaffSection";
import { SuppliersSection } from "@/features/admin/sections/SuppliersSection";
import { useSession } from "@/features/auth/SessionProvider";

export function AdminShell() {
  const { session, logout } = useSession();
  const [section, setSection] = useState<AdminSection>("dashboard");

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
        ) : section === "finance" ? (
          <FinanceSection viewerRole={session.user.role} />
        ) : section === "accounting" ? (
          <AccountingSection viewerRole={session.user.role} />
        ) : section === "promos" ? (
          <PromoSection />
        ) : section === "reports" ? (
          <ReportsSection viewerRole={session.user.role} />
        ) : section === "audit" ? (
          <AuditLogSection />
        ) : section === "settings" ? (
          <SettingsSection />
        ) : null}
      </main>
    </div>
  );
}
