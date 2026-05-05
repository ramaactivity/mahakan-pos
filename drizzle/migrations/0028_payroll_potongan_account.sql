-- Phase 5.2 (sesi AC-2) — additive COA seed for payroll component breakdown.
--
-- mapPayrollPaid sekarang emit multi-line breakdown:
--   Dr 6101 Gaji Karyawan      baseSalary
--   Dr 6103 Lembur             overtimePay
--   Dr 6102 Tunjangan & Bonus  bonus
--      Cr 6105 Potongan        deductions   (kontra-expense, NEW)
--      Cr 1101 Kas / 1110 Bank netPay
--
-- 6101/6102/6103 sudah seeded sejak sesi S. Hanya 6105 yang baru. Akun
-- ini kontra-expense (normal_balance='credit', is_contra=true) — semantically
-- mengurangi beban gaji bruto sehingga net expense pada P&L = netPay aktual.
--
-- Auto-journal flag default OFF, jadi safe untuk apply kapan saja relatif
-- ke deploy code.
--
-- Idempotent via partial unique index ux_coa_outlet_code (outlet_id, code)
-- WHERE deleted_at IS NULL.

INSERT INTO chart_of_accounts (
  outlet_id, code, name, type, normal_balance, parent_code,
  is_contra, is_system, display_order, notes
)
SELECT o.id, '6105', 'Potongan Karyawan', 'expense', 'credit', '6100',
       true, true, 5,
       'Kontra-expense. Auto-credit saat payroll mark-paid (sum lateDeduction + otherDeductions, sesi AC-2). Mengurangi total beban gaji efektif.'
FROM outlets o
ON CONFLICT (outlet_id, code) WHERE deleted_at IS NULL DO NOTHING;
