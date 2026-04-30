"use client";

import { useState } from "react";
import {
  AdminLeftNav,
  type AdminSection,
} from "@/features/admin/components/AdminLeftNav";
import { AttendanceSection } from "@/features/admin/sections/AttendanceSection";
import { AuditLogSection } from "@/features/admin/sections/AuditLogSection";
import { HrReportsSection } from "@/features/admin/sections/HrReportsSection";
import { PayrollSection } from "@/features/admin/sections/PayrollSection";
import { SchedulesSection } from "@/features/admin/sections/SchedulesSection";
import { CashSection } from "@/features/admin/sections/CashSection";
import { CustomersSection } from "@/features/admin/sections/CustomersSection";
import { DashboardHome } from "@/features/admin/sections/DashboardHome";
import { EmployeesSection } from "@/features/admin/sections/EmployeesSection";
import { InventorySection } from "@/features/admin/sections/InventorySection";
import { MenuSection } from "@/features/admin/sections/MenuSection";
import { ReportsSection } from "@/features/admin/sections/ReportsSection";
import { SettingsSection } from "@/features/admin/sections/SettingsSection";
import { ShiftsSection } from "@/features/admin/sections/ShiftsSection";
import { StaffSection } from "@/features/admin/sections/StaffSection";
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
          <DashboardHome user={session.user} />
        ) : section === "menu" ? (
          <MenuSection />
        ) : section === "inventory" ? (
          <InventorySection />
        ) : section === "customers" ? (
          <CustomersSection />
        ) : section === "staff" ? (
          <StaffSection
            viewerRole={session.user.role}
            viewerUserId={session.user.id}
          />
        ) : section === "employees" ? (
          <EmployeesSection />
        ) : section === "attendance" ? (
          <AttendanceSection />
        ) : section === "schedules" ? (
          <SchedulesSection />
        ) : section === "payroll" ? (
          <PayrollSection viewerRole={session.user.role} />
        ) : section === "hr_reports" ? (
          <HrReportsSection />
        ) : section === "shifts" ? (
          <ShiftsSection />
        ) : section === "cash" ? (
          <CashSection viewerUserId={session.user.id} />
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
