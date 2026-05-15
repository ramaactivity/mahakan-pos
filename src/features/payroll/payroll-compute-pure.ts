/**
 * Sesi AE-60 — Pure helpers untuk payroll computation. No DB / framework
 * deps — testable isolation. Dipakai di payroll/actions.ts saat compute
 * lines dan di UI untuk preview formula.
 */

export type PaymentType = "daily" | "monthly";

/* ---------------- Base salary ---------------- */

export interface BaseSalaryInput {
  /** Mekanisme gaji. NULL = legacy fallback to "monthly" behavior. */
  paymentType: PaymentType | null;
  /** Gaji bulanan (Rp). Dipakai kalau paymentType='monthly' atau legacy. */
  salaryAmount: number;
  /** Tarif harian (Rp/hari). Wajib > 0 jika paymentType='daily'. */
  dailyRate: number | null;
  /** Jumlah hari masuk dari attendance aggregation. */
  workDays: number;
}

export interface BaseSalaryResult {
  baseSalary: number;
  /** Mekanisme yang digunakan (resolved dari input + fallback). */
  resolvedType: PaymentType;
  /** Warning kalau ada misconfiguration (mis. daily tanpa dailyRate). */
  warning: string | null;
}

/**
 * Case-split base salary calc.
 *  - daily: dailyRate × workDays (workDays=0 → 0)
 *  - monthly (or null legacy): salaryAmount flat
 *  - daily + dailyRate=null: fallback to 0 + warning
 */
export function computeBaseSalary(input: BaseSalaryInput): BaseSalaryResult {
  const resolvedType: PaymentType = input.paymentType ?? "monthly";
  if (resolvedType === "daily") {
    if (input.dailyRate == null || input.dailyRate <= 0) {
      return {
        baseSalary: 0,
        resolvedType,
        warning:
          "Karyawan tipe Harian tapi belum punya tarif harian (dailyRate). Set dulu di profil karyawan.",
      };
    }
    if (input.workDays <= 0) {
      return {
        baseSalary: 0,
        resolvedType,
        warning: null, // 0 workDays = 0 baseSalary, ekspektasi
      };
    }
    return {
      baseSalary: Math.round(input.dailyRate * input.workDays),
      resolvedType,
      warning: null,
    };
  }
  // monthly fallback
  return {
    baseSalary: Math.max(0, Math.round(input.salaryAmount ?? 0)),
    resolvedType,
    warning: null,
  };
}

/* ---------------- THR ---------------- */

/**
 * Auto-suggest THR dari baseSalary × multiplier. Default UU Indonesia
 * = 1.0 (1× gaji bulanan). Owner edit manual di line kalau perlu beda.
 */
export function computeThrSuggestion(
  baseSalary: number,
  multiplier: number,
): number {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(0, Math.round(baseSalary * m));
}

/* ---------------- Gross / Net (V2) ---------------- */

export interface PayrollLineComputeInput {
  baseSalary: number;
  overtimePay: number;
  bonus: number;
  thr: number;
  lateDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
}

export interface PayrollLineComputeResult {
  grossPay: number;
  netPay: number;
}

/**
 * V2 formula (extends recomputeGrossNet existing):
 *   grossPay = baseSalary + overtimePay + bonus + thr
 *   netPay   = max(0, grossPay - lateDeduction - advanceDeduction - otherDeductions)
 */
export function recomputeGrossNetV2(
  input: PayrollLineComputeInput,
): PayrollLineComputeResult {
  const grossPay = Math.max(
    0,
    Math.round(
      (input.baseSalary ?? 0) +
        (input.overtimePay ?? 0) +
        (input.bonus ?? 0) +
        (input.thr ?? 0),
    ),
  );
  const totalDeductions =
    (input.lateDeduction ?? 0) +
    (input.advanceDeduction ?? 0) +
    (input.otherDeductions ?? 0);
  const netPay = Math.max(0, grossPay - totalDeductions);
  return { grossPay, netPay };
}

/* ---------------- Recompute warning detector ---------------- */

export interface PayrollLineSnapshot {
  bonus: number;
  thr: number;
  advanceDeduction: number;
  otherDeductions: number;
}

/**
 * Detect kalau line punya manual edits di luar auto-fill defaults. Owner
 * needs warning sebelum recompute (yang akan wipe + reinsert).
 */
export function hasManualEdits(snap: PayrollLineSnapshot): boolean {
  return (
    (snap.bonus ?? 0) > 0 ||
    (snap.thr ?? 0) > 0 ||
    (snap.advanceDeduction ?? 0) > 0 ||
    (snap.otherDeductions ?? 0) > 0
  );
}

export function countLinesWithManualEdits(
  lines: PayrollLineSnapshot[],
): number {
  return lines.filter(hasManualEdits).length;
}
