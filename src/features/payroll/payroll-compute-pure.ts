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

/* ---------------- Double-shift bonus (sesi AE-62ac) ---------------- */

export interface DoubleShiftBonusConfig {
  /** Threshold workMinutes/day untuk dianggap double-shift. Default 600 (10 jam). */
  minMinutes: number;
  /** "fixed" = rupiah flat per double day. "multiplier" = decimal × baseDailyAmount. */
  bonusType: "fixed" | "multiplier";
  /** Fixed: rupiah (mis. 100_000). Multiplier: decimal (mis. 1.5 = 50% extra di atas base). */
  bonusValue: number;
}

export interface DoubleShiftBonusInput {
  /** Workminutes aggregated per shift day dari attendance records. */
  workMinutesPerDay: number[];
  config: DoubleShiftBonusConfig | null | undefined;
  /** Base amount per hari (untuk multiplier mode):
   *   - daily payment: dailyRate
   *   - monthly: salaryAmount / 30
   * Tidak relevan untuk fixed mode. */
  baseDailyAmount: number;
}

export interface DoubleShiftBonusResult {
  totalBonus: number;
  daysFlagged: number;
  /** Diagnostic untuk audit / UI preview. */
  perDayBonus: number[];
}

/**
 * Sesi AE-62ac — compute total bonus untuk double-shift days.
 *
 * Per owner directive (Mahakan): weekend full-shift 08:00-23:00 ATAU
 * weekday holiday open-pagi 09:00-23:00 = double-shift. Karyawan
 * (fixed atau daily) dapat tambahan flat bonus / multiplier.
 *
 * Implementasi:
 *   - Loop workMinutesPerDay
 *   - Day dengan workMinutes >= minMinutes → flag double
 *   - Per flagged day, add bonus:
 *     - "fixed": bonusValue (rupiah)
 *     - "multiplier": baseDailyAmount × (bonusValue - 1)
 *       (bonusValue=1.5 → 50% extra atas base; bonusValue=2 → 100% extra)
 *   - Return totalBonus + daysFlagged + per-day breakdown
 *
 * config null/undefined → totalBonus=0 (feature off).
 */
export function computeDoubleShiftBonus(
  input: DoubleShiftBonusInput,
): DoubleShiftBonusResult {
  if (!input.config) {
    return {
      totalBonus: 0,
      daysFlagged: 0,
      perDayBonus: input.workMinutesPerDay.map(() => 0),
    };
  }
  const { minMinutes, bonusType, bonusValue } = input.config;
  if (!Number.isFinite(minMinutes) || minMinutes <= 0) {
    return {
      totalBonus: 0,
      daysFlagged: 0,
      perDayBonus: input.workMinutesPerDay.map(() => 0),
    };
  }
  if (!Number.isFinite(bonusValue) || bonusValue <= 0) {
    return {
      totalBonus: 0,
      daysFlagged: 0,
      perDayBonus: input.workMinutesPerDay.map(() => 0),
    };
  }

  const perDayBonus: number[] = [];
  let totalBonus = 0;
  let daysFlagged = 0;
  for (const workMin of input.workMinutesPerDay) {
    if (!Number.isFinite(workMin) || workMin < minMinutes) {
      perDayBonus.push(0);
      continue;
    }
    daysFlagged += 1;
    let dayBonus = 0;
    if (bonusType === "fixed") {
      dayBonus = Math.round(bonusValue);
    } else {
      // multiplier mode — extra ATAS base, jadi (multiplier - 1) × base
      const extraMultiplier = Math.max(0, bonusValue - 1);
      dayBonus = Math.round(input.baseDailyAmount * extraMultiplier);
    }
    totalBonus += dayBonus;
    perDayBonus.push(dayBonus);
  }
  return { totalBonus, daysFlagged, perDayBonus };
}
