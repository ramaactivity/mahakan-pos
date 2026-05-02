# 🤝 HANDOVER SESI 18 — Mahakan POS

**Untuk:** Claude AI agent (sesi 19 / sesi V accounting reports + manual entry)
**Dari:** Sesi 18 = sesi U (close 2026-05-02) — All 11 source actions auto-journal wired
**Sesi 19 (sesi V) fokus:** **Manual journal entry UI + period close + Reports (Trial Balance, GL, Income Statement, Neraca) + cutover wizard**

---

## ⚡ TL;DR

Sesi U = wire remaining 6 source actions (purchases create/pay/cancel + expense + income + opname). Migration 0023 (additive expenses.account_id + expense_categories.default_account_id). Settings UI toggle "Auto-Journal Akuntansi" Owner-only. 492/492 tests, prod live.

**All 11 source actions sekarang terwire** (sesi T 7 + sesi U 4 mappers, 6 source action hooks each):
- ✅ POS sale (incl. compliment branch via discountReason prefix)
- ✅ POS refund (full)
- ✅ POS open bill close (transition open → paid)
- ✅ Payroll mark-paid
- ✅ Cash deposit verified
- ✅ Aggregator settlement create (channel-aware: piutang clear vs revenue recognition)
- ✅ Shift close (variance != 0)
- ✅ Purchase create (cash/transfer/TOP)
- ✅ Purchase mark-paid (TOP → paid)
- ✅ Purchase cancel (counter-entry)
- ✅ Manual expense create (sourceType='manual' filter)
- ✅ Income create
- ✅ Opname finalize

**Auto-journal flag tetap default OFF** — Owner sekarang ada UI di Admin → Settings → ToggleRow "Auto-Journal Akuntansi" untuk aktifkan post-test.

---

## 1. Production State (akhir sesi U)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (HTTP/2 200) |
| Latest deploy | Vercel `mahakan-*` (sesi U commit `7b77288`) |

- `release/phase-1` HEAD `7b77288` — local + remote synced
- Migration **0023** applied Neon prod (additive nullable cols: expenses.account_id + expense_categories.default_account_id)
- 63 default Chart of Accounts (sesi S 62 + sesi T 4104)
- typecheck + lint clean; **492/492 tests** (was 469, +23 sesi U mapping tests)
- 12 routes build via webpack + Serwist

---

## 2. What Changed Sesi U (file-level)

### 2.1 Schema + Migration

- **NEW** [drizzle/migrations/0023_special_tenebrous.sql](../drizzle/migrations/0023_special_tenebrous.sql) — `expenses.account_id uuid` + `expense_categories.default_account_id uuid` (both nullable, soft FK app-side)
- [src/db/schema/expenses.ts](../src/db/schema/expenses.ts) — `expenses.accountId` + `expenseCategories.defaultAccountId` fields with comments
- [src/db/schema/outlets.ts](../src/db/schema/outlets.ts) — `OutletSettings.features.accounting_auto_journal?: boolean` type extension

### 2.2 Mappers (Pure Functions)

- **NEW** [src/features/accounting/mapping/purchase.ts](../src/features/accounting/mapping/purchase.ts) — mapPurchaseCreate/Pay/Cancel
- **NEW** [src/features/accounting/mapping/expense.ts](../src/features/accounting/mapping/expense.ts) — mapExpenseCreate + expenseCashBankCode
- **NEW** [src/features/accounting/mapping/income.ts](../src/features/accounting/mapping/income.ts) — mapIncomeCreate + incomeCashBankCode
- **NEW** [src/features/accounting/mapping/opname.ts](../src/features/accounting/mapping/opname.ts) — mapOpnameAdjustment
- [src/features/accounting/mapping/index.ts](../src/features/accounting/mapping/index.ts) — barrel exports updated

### 2.3 Hook Wrappers (hooks.ts)

- 4 new wrappers: `postJournalForPurchaseCreate`, `postJournalForPurchasePay`, `postJournalForPurchaseCancel`, `postJournalForExpenseCreate`, `postJournalForIncomeCreate`, `postJournalForOpnameAdjustment`
- New helper `resolveExpenseAccountCode(outletId, expenseAccountId, categoryId)` — resolution priority chain: per-expense `accountId` → category `defaultAccountId` → `6901` fallback

### 2.4 Hook Wiring (existing actions modified)

- [src/features/purchases/actions.ts](../src/features/purchases/actions.ts):
  - `createPurchase` — fire `postJournalForPurchaseCreate` post-commit; query `purchase_items` untuk per-section breakdown
  - `cancelPurchase` — fire `postJournalForPurchaseCancel` post-commit; same section query
  - `markPurchasePaid` — fire `postJournalForPurchasePay` post-commit
- [src/features/cash/actions.ts](../src/features/cash/actions.ts):
  - `createExpense` — fire `postJournalForExpenseCreate` post-commit (hook itself filters sourceType='manual')
  - `createIncome` — fire `postJournalForIncomeCreate` post-commit
- [src/features/stock-opname/actions.ts](../src/features/stock-opname/actions.ts):
  - `finalizeOpname` — fire `postJournalForOpnameAdjustment` post-commit; query stockOpnameLines joined ingredients groupBy section

### 2.5 Settings UI

- [src/features/admin/sections/SettingsSection.tsx](../src/features/admin/sections/SettingsSection.tsx) — Field display "Auto-Journal Akuntansi"
- [src/features/admin/sections/settings/SettingsTunablesModal.tsx](../src/features/admin/sections/settings/SettingsTunablesModal.tsx) — ToggleRow di "Feature Flags" section dengan hint guidance, Owner-only edit
- [src/features/outlets/actions.ts](../src/features/outlets/actions.ts) — `featuresSchema.accounting_auto_journal: z.boolean().optional()`

### 2.6 Tests

- **NEW** [tests/unit/accounting-mapping-u.test.ts](../tests/unit/accounting-mapping-u.test.ts) — 23 cases:
  - mapPurchaseCreate: 5 (cash kitchen-only, transfer mixed sections, TOP, null section, lines mismatch)
  - mapPurchasePay: 2 (cash, transfer_bri)
  - mapPurchaseCancel: 2 (cash, TOP)
  - mapExpenseCreate: 3 (cash to 6201, transfer to 6202/1110, zero throws)
  - expenseCashBankCode: 1
  - mapIncomeCreate: 2 (cash, transfer)
  - incomeCashBankCode: 1
  - mapOpnameAdjustment: 7 (pure shortage, pure surplus, mixed net loss, mixed net gain, perfect cancel, all zero, supporting+cleaning aggregation)

---

## 3. Sesi V Scope (Next Sesi) — REPORTS + MANUAL JOURNAL + PERIOD CLOSE + CUTOVER WIZARD

**Estimasi:** 4-5 hari, **Risk: MEDIUM** (no live flow touched — semua read/write ke ledger sendiri, kecuali period close yang affect P&L → Saldo Laba transfer).

### 3.1 Cutover Wizard UI (Owner Action Item)

Owner butuh ini paling cepat — sebelum 1 Juni 2026 (cutover date).

- New tab/dialog di Admin → Akuntansi → "Cutover" (atau wizard dari Periode tab)
- Owner-only, PIN required at final post step
- Inputs Owner type:
  - Kas Tunai aktual (drawer + brankas) per 31 Mei 2026
  - Saldo Bank BCA + BRI per 31 Mei 2026
  - Modal Owner (input)
  - Saldo Laba (input atau 0 fresh start)
- Auto-computed (server-side):
  - Persediaan value (sum ingredients × cost_per_unit grouped by section → 1140/1141/1142)
  - Hutang Dagang outstanding (sum purchases.totalAmount where status='pending_payment')
  - Piutang Aggregator (sum from shifts settlement reports — atau placeholder 0)
- Compute total Dr vs Cr; Owner adjust nilai sampai balance
- Submit → insert special period 2026-05 status='locked' + journal entry sourceType='opening_balance', dated 2026-05-31

### 3.2 Manual Journal Entry UI

- Multi-line builder (≥ 2 lines), dropdown account selector (filtered by isActive + searchable via Combobox)
- Real-time balance indicator (sum debit vs sum credit)
- Save as draft (Manager+) atau Post (Owner-only PIN)
- Reverse posted entry (Owner-only PIN, dengan reason)
- All audit-logged

### 3.3 Period Close Action

- Owner clicks "Tutup Periode {YYYY-MM}" di Periode tab
- Validation:
  - Period harus status='open'
  - Semua draft entries harus di-post atau di-discard
  - Optional warning: piutang/hutang outstanding > 30 hari
- Closing entry generator (auto-generated, sourceType='period_close'):
  - Untuk semua revenue accounts (4xxx) credit balance B → Dr revenue, Cr 3302 Laba Rugi Berjalan
  - Untuk semua kontra-revenue + expense + cogs (4110/4111/5xxx/6xxx) debit balance B → Dr 3302, Cr account
  - Transfer 3302 → 3301 Saldo Laba: Dr/Cr 3302, Cr/Dr 3301 per net direction
- After post: period.status='closed', period.closingEntryId set, audit logged

### 3.4 Period Reopen + Lock

- Reopen closed period (Owner-only): closing entry status='reversed' (counter-entry created), period status flip ke 'open', audit
- Lock locked-permanently (Owner-only): irreversible, no entries can post or reverse, audit

### 3.5 Reports

Owner+Manager view, Owner-only export:

#### 3.5.1 Trial Balance

Per period (or as-of date):
```
Akun                           Debit          Credit
1101 Kas Tunai                  X
1110 Bank BCA                   X
2101 Hutang Dagang                              X
3101 Modal Owner                                X
4101 Penjualan Makanan                          X
5101 HPP Makanan                X
...
TOTAL                          ΣD            ΣC  (must equal)
```

Query: aggregate journal_lines joined chart_of_accounts, filter entry.periodId IN range AND entry.status='posted', sum debit/credit per account.

#### 3.5.2 General Ledger per Akun

Detail transaksi per akun, per range:
```
Akun: 1101 Kas Tunai (Drawer POS)
Periode: Juni 2026

Tanggal       Entry      Description                    Debit       Credit       Balance
2026-06-01    JE-202606-0001  Saldo Awal 1 Juni             5,000,000              5,000,000
2026-06-01    JE-202606-0002  POS Sale TRX-...              45,000                 5,045,000
...
```

#### 3.5.3 Income Statement (Laba Rugi)

Per period or range. Format:
```
PENDAPATAN
  Penjualan Makanan                    X
  Penjualan Minuman                    X
  Penjualan via Aggregator             X
  Pendapatan Lain-lain                 X
  (-) Diskon Penjualan                 (X)
  (-) Refund Penjualan                 (X)
TOTAL PENDAPATAN BERSIH                ────  X

HARGA POKOK PENJUALAN
  HPP Makanan                          X
  HPP Minuman                          X
TOTAL HPP                              ────  (X)

LABA KOTOR                             ════  X

BEBAN OPERASIONAL
  Gaji Karyawan                        X
  Sewa Tempat                          X
  Listrik                              X
  Marketing & Iklan                    X
  Biaya Aggregator                     X
  Selisih Kas                          X
  ...
TOTAL BEBAN                            ────  (X)

LABA / RUGI BERSIH                     ════  X
```

PDF export Owner-only (mirror existing P&L export pattern).

#### 3.5.4 Balance Sheet (Neraca)

As-of date. Format per design doc §5.4. PDF export.

### 3.6 RBAC + Audit (already registered sesi S — just enforce now)

Already registered: `accounting.journal.{view,draft,post,reverse}`, `accounting.period.{close,reopen,lock}`, `accounting.report.{view,export}`, `accounting.opening_balance.input`.

Audit events already registered: `chart_of_accounts.*`, `accounting_period.{open,close,lock,reopen}`, `journal_entry.{draft,post,update_draft,reverse}`, `opening_balance.posted`, `report.{income_statement,balance_sheet}.export`.

---

## 4. Critical Files for Sesi V

**Reference (existing, don't modify):**
- [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md) §5 (Reports), §4.16-4.18 (Manual entry, Opening balance, Period close)
- [src/features/accounting/](../src/features/accounting/) — full module sesi T+U
- [src/features/accounting/posting.ts](../src/features/accounting/posting.ts) — recordJournal helper
- [src/features/accounting/queries.ts](../src/features/accounting/queries.ts) — read queries

**To create sesi V:**
- `src/features/accounting/mapping/openingBalance.ts` — for cutover wizard
- `src/features/accounting/mapping/periodClose.ts` — closing entry generator
- `src/features/accounting/reports/` — TB / GL / IS / Neraca pure compute functions
- `src/features/accounting/actions.ts` — extend dengan postJournalManual, reverseJournalEntry, closeAccountingPeriod, reopenAccountingPeriod, lockAccountingPeriod, postOpeningBalance, fetchTrialBalance, fetchGeneralLedger, fetchIncomeStatement, fetchBalanceSheet
- `src/features/admin/sections/accounting/CutoverWizard.tsx` — Owner UI Modal
- `src/features/admin/sections/accounting/JournalEntryModal.tsx` — manual entry create/edit
- `src/features/admin/sections/accounting/ReportsView.tsx` — 4 report tabs (TB/GL/IS/Neraca) dengan PDF export
- Tests untuk all of the above (target ~30+ new, total ~525)

**To modify sesi V:**
- [src/features/admin/sections/AccountingSection.tsx](../src/features/admin/sections/AccountingSection.tsx) — add tabs "Cutover", "Laporan", "Buat Entry"
- [src/features/admin/sections/accounting/JournalView.tsx](../src/features/admin/sections/accounting/JournalView.tsx) — add "Buat Entry Manual" button, reverse button per entry
- [src/features/admin/sections/accounting/PeriodsView.tsx](../src/features/admin/sections/accounting/PeriodsView.tsx) — enable close/reopen/lock action buttons
- [src/features/accounting/queries.ts](../src/features/accounting/queries.ts) — extend dengan getAccountBalance(accountId, asOfDate), getTrialBalanceData, getIncomeStatementData, etc

---

## 5. Sesi V Boot Prompt

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi V (sesi 19). Sesi U selesai dengan
all 11 source actions auto-journal wired + Settings UI toggle, HEAD `7b77288`,
deployed prod. Auto-journal default OFF.

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-18.md — handover sesi U close (this doc)
  2. docs/10-ACCOUNTING-DESIGN.md — full design spec, esp §4.16-4.18 + §5
  3. PROGRESS.md — overall state (sesi U close)
  4. MEMORY.md — terutama sesiU-accounting-extensions, pause-before-destructive,
     no-native-pickers (cutover wizard wajib custom popover)

Verify state pertama:
  git log --oneline -5                 # expect HEAD = 7b77288 atau 7b77288 + docs
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 492/492
  npm run build                        # expect 12 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200

OWNER ACTION TIMING-SENSITIVE:
1. Owner harus run cutover wizard (yang dibikin sesi V) SEBELUM 1 Juni 2026.
   Kalau wizard belum ready, Owner bisa input opening balance manual via
   direct DB (insert journal_entry sourceType='opening_balance' dengan
   period 2026-05).
2. Sebelum aktifkan auto-journal flag (Settings → Auto-Journal Akuntansi),
   sebaiknya cutover wizard udah jalan supaya saldo awal benar.

Sesi V scope (priority order):
  1. CRITICAL — Cutover Wizard UI (Owner-only PIN, opening balance input)
  2. Manual journal entry UI (Owner PIN gate)
  3. Period close action + closing entry generator
  4. Period reopen + lock
  5. Reports: Trial Balance, General Ledger, Income Statement, Neraca + PDF export
  6. Tests (~30+, target ~525 total)

Pause-points yang perlu konfirmasi Owner:
  - Sebelum push code commit baru
  - Sebelum vercel --prod deploy
  - Sebelum apply migration baru (kalau ada)
  - Sebelum first period close run real (irreversible without reopen flow)

Token efficiency mode tetap aktif:
  - Pakai Edit tool (diff-only) untuk existing file
  - Trust harness — skip post-edit re-read
  - Batch parallel tool calls

Carry-forward Owner action items (independent):
  - 🔴 HIGH Bakmie "Ayam Sambal Matah" rename via Admin Menu UI
  - 🟡 First stock-take 175 ingredient
  - 🟡 Reorder threshold per ingredient
  - 🟢 Toggle accounting_auto_journal ON post-test (sebelum real prod usage)
```

---

## 6. Memory Updates

Sesi U close akan write:
- `sesiU-accounting-extensions` — supersede `sesiT-accounting-hooks`. Resume point post-sesi-U dengan all 11 source actions wired + Settings UI toggle live.

Memories yang tetap force:
- `migration-ordering-rule`
- `vercel-deploy-mode`
- `pause-before-destructive`
- `pat-handling-preference`
- `no-native-pickers` (sesi V cutover wizard + manual journal modal wajib custom popover)
- `use-server-barrel-trap` + dynamic `await import` pattern
- `auth-barrel-pulls-db`

---

## 7. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-02 | Sesi U close. Migration 0023 (additive expenses.account_id + expense_categories.default_account_id) + 4 mappers (purchase/expense/income/opname) + 6 source action hooks + Settings UI toggle. 23 new tests (492/492 total). 1 commit `7b77288`, deployed. Auto-journal flag default OFF; toggle UI live di Admin → Settings. Sesi V = manual journal + period close + Reports + cutover wizard. |

---

# 🛑 END HANDOVER SESI 18 (sesi U close)

**All 11 source actions wired auto-journal. Sesi V = Reports + manual entry + period close + cutover wizard. Owner timing: run cutover wizard SEBELUM 1 Juni 2026 (atau input via DB direct kalau wizard belum ready).**
