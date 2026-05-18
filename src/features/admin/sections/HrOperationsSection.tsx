"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { AttendanceSection } from "./AttendanceSection";
import { EmployeeAdvancesSection } from "./EmployeeAdvancesSection";
import { HrReportsSection } from "./HrReportsSection";
import { PayrollSection } from "./PayrollSection";
import { SchedulesSection } from "./SchedulesSection";
import { SlipGajiSection } from "./SlipGajiSection";

type HrOperationsTab =
  | "attendance"
  | "schedules"
  | "payroll"
  | "slip_gaji"
  | "kasbon"
  | "reports";

const TABS: Array<{ key: HrOperationsTab; label: string }> = [
  { key: "attendance", label: "Absensi" },
  { key: "schedules", label: "Jadwal" },
  { key: "payroll", label: "Payroll" },
  { key: "slip_gaji", label: "Slip Gaji" },
  { key: "kasbon", label: "Kasbon" },
  { key: "reports", label: "Laporan" },
];

const INITIAL_TAB_STORAGE_KEY = "hr-ops:initial-tab";

const VALID_TABS: ReadonlySet<string> = new Set([
  "attendance",
  "schedules",
  "payroll",
  "slip_gaji",
  "kasbon",
  "reports",
]);

/**
 * Cross-section handover: a caller (e.g. DashboardHome HrPayrollCard)
 * sets the initial tab before navigating to "hr_operations". Read once
 * on mount, then cleared so subsequent visits start at "attendance".
 */
export function setHrOperationsInitialTab(tab: HrOperationsTab) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(INITIAL_TAB_STORAGE_KEY, tab);
}

interface HrOperationsSectionProps {
  viewerRole: Role;
}

export function HrOperationsSection({ viewerRole }: HrOperationsSectionProps) {
  const [tab, setTab] = useState<HrOperationsTab>("attendance");

  useEffect(() => {
    const stored = sessionStorage.getItem(INITIAL_TAB_STORAGE_KEY);
    if (stored && VALID_TABS.has(stored)) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTab(stored as HrOperationsTab);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    sessionStorage.removeItem(INITIAL_TAB_STORAGE_KEY);
  }, []);

  return (
    <div>
      <div className="space-y-3 px-6 pt-6">
        <header>
          <h1 className="text-2xl font-bold text-mahakan-green-900">
            HR Operations
          </h1>
          <p className="text-sm text-neutral-700">
            Pantau absensi, atur jadwal, kelola payroll, dan ekspor laporan HR
            di satu dashboard.
          </p>
        </header>

        <div
          role="tablist"
          aria-label="HR Operations tabs"
          className="flex gap-1 border-b border-neutral-200"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700",
                tab === t.key
                  ? "border-mahakan-green-700 text-mahakan-green-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "attendance" ? (
        <AttendanceSection />
      ) : tab === "schedules" ? (
        <SchedulesSection />
      ) : tab === "payroll" ? (
        <PayrollSection viewerRole={viewerRole} />
      ) : tab === "slip_gaji" ? (
        <SlipGajiSection />
      ) : tab === "kasbon" ? (
        <EmployeeAdvancesSection />
      ) : (
        <HrReportsSection />
      )}
    </div>
  );
}
