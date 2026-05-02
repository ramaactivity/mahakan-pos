# 🤝 HANDOVER SESI 17 — Mahakan POS

**Untuk:** Claude AI agent (sesi 18 / sesi U accounting purchases + expenses)
**Dari:** Sesi 17 = sesi T (close 2026-05-02) — Auto-journal hooks shipped (flag OFF)
**Sesi 18 (sesi U) fokus:** **Auto-journal purchases + manual expense + income + opname adjustment + cutover wizard UI**

---

## ⚡ TL;DR

Sesi T = ship auto-journal hooks untuk 7 source actions (POS sale/refund/compliment, payroll paid, cash deposit, aggregator settlement, shift variance). All feature-flagged via `outlets.settings.features.accounting_auto_journal` default OFF. Migration 0022 (additive bank_account_id) + 4104 Penjualan via Aggregator account seeded.

Q1-Q7 design questions all answered + locked.

469/469 tests, 12 routes, prod live.

⚠️ **NEXT STEP UNTUK OWNER**: Toggle flag ON setelah test 1 dummy trx + verify journal entry. Sebelum toggle, semua POS/payroll/finance flow normal — tidak ada dampak.

---

## 1. Production State (akhir sesi T)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (HTTP/2 200) |
| Latest deploy | `mahakan-9ah9g9asd-ramaactivity98-5695s-projects.vercel.app` (2026-05-02) |

- `release/phase-1` HEAD `3662f5f` — local + remote synced
- Migration **0022** applied Neon prod (additive bank_account_id nullable cols)
- 63 default Chart of Accounts (62 sesi S + 4104 sesi T)
- typecheck + lint clean; **469/469 tests** (was 434, +35 mapping tests)
- 12 routes build via webpack + Serwist

---

## 2. Q1-Q7 Decisions Locked (sesi T)

| Q | Owner Answer | Implementation |
|---|---|---|
| **Q1** Aggregator mechanism | Saya investigate + recommend | Aggregator orders **SEPARATE dari POS** (no schema change ke transactions). Revenue dari gofood/grabfood/shopeefood masuk ledger HANYA via `aggregatorSettlement.create` event → Cr 4104 Penjualan via Aggregator. QRIS/EDC tetap individual POS sale + clear piutang saat settlement. P&L gap: aggregator revenue tanpa COGS attribution (acceptable, footnote) |
| **Q2** Food/drink mapping | Boleh | Heuristic-based: ricebowl/bakmie/snack/croffle/dessert → food (4101/5101/1140); coffee/non-coffee/manual brew/tea/milk/matcha → drink (4102/5102/1141). Owner can override per-category via `categories.accountingRevenueAccountId` (FK column added sesi S, UI deferred sesi V) |
| **Q3** Bank destination | Dropdown saja | Tambah `bankAccountId` nullable FK di `cash_deposits` + `aggregator_settlements` (migration 0022). Resolve to account.code di hook. Fallback heuristic kalau FK null (BCA/BRI/else) untuk legacy data backward-compat |
| **Q4** MDR fee | Iya boleh | `aggregatorSettlements.feeAmount` field already exists, hook auto-debit 6402 (MDR untuk QRIS/EDC) atau 6401 (komisi untuk GoFood/Grab/Shopee) |
| **Q5** Refund COGS reversal default | Boleh (default OFF) | mapPosRefund accepts optional `reverseCogs` flag, default false (asumsi barang habis). UI toggle deferred — currently always OFF |
| **Q6** Compliment-without-cogs | Ya boleh | mapPosCompliment returns empty array kalau total cogs=0; hook checks length, skips recordJournal call + console.warn untuk Owner review recipe data |
| **Q7** Owner kasbon | Sudah berjalan | Noted — currently informal. Formal recording via manual journal entry UI di sesi V (Dr 1130 Piutang Karyawan Cr Kas, settle via deduction di payroll). No special handling sesi T |

---

## 3. What Changed Sesi T (file-level)

### 3.1 Schema + Migration

- **NEW** [drizzle/migrations/0022_cultured_donald_blake.sql](../drizzle/migrations/0022_cultured_donald_blake.sql) — `cash_deposits.bank_account_id uuid` + `aggregator_settlements.bank_account_id uuid` (both nullable, soft FK app-side resolved)
- [src/db/schema/cash_deposits.ts](../src/db/schema/cash_deposits.ts) — `bankAccountId` field added with comment "Sesi T: optional FK ke chart_of_accounts"
- [src/db/schema/aggregator_settlements.ts](../src/db/schema/aggregator_settlements.ts) — same

### 3.2 Seed Update

- [scripts/seed-accounts.ts](../scripts/seed-accounts.ts) — added `4104 Penjualan via Aggregator` system account. Total now 63 (was 62)

### 3.3 Feature Module `src/features/accounting/`

- **NEW** [flag.ts](../src/features/accounting/flag.ts) — `isAutoJournalEnabled(outletId)` reads outlets.settings.features.accounting_auto_journal default false
- **NEW** [posting.ts](../src/features/accounting/posting.ts) — `recordJournal(input)` TX-atomic + idempotent per (sourceType, sourceId) + advisory lock per (outlet, period) untuk entry number gen `JE-YYYYMM-NNNN` + period auto-create + balance check
- **NEW** [hooks.ts](../src/features/accounting/hooks.ts) — high-level wrappers: `postJournalForPosSale`, `postJournalForPosRefund`, `postJournalForPayrollPaid`, `postJournalForCashDepositVerified`, `postJournalForAggregatorSettlement`, `postJournalForShiftVariance`. Plus `fireJournalHook()` fire-and-forget helper
- **NEW** [mapping/categoryMapper.ts](../src/features/accounting/mapping/categoryMapper.ts) — `mapCategoryToAccounts(name)` → {revenueCode, cogsCode, persediaanCode, bucket}, plus `aggregateByCategory(items)`
- **NEW** [mapping/posSale.ts](../src/features/accounting/mapping/posSale.ts) — POS sale mapper
- **NEW** [mapping/posRefund.ts](../src/features/accounting/mapping/posRefund.ts) — Refund mapper (full or partial)
- **NEW** [mapping/posCompliment.ts](../src/features/accounting/mapping/posCompliment.ts) — Compliment (marketing expense)
- **NEW** [mapping/payrollPaid.ts](../src/features/accounting/mapping/payrollPaid.ts) — Payroll mark-paid
- **NEW** [mapping/cashDeposit.ts](../src/features/accounting/mapping/cashDeposit.ts) — Cash deposit verified, plus `resolveBankCodeFromDestination()` heuristic helper
- **NEW** [mapping/aggregatorSettlement.ts](../src/features/accounting/mapping/aggregatorSettlement.ts) — Channel-aware (Q1)
- **NEW** [mapping/shiftVariance.ts](../src/features/accounting/mapping/shiftVariance.ts) — Sign-aware
- **NEW** [mapping/index.ts](../src/features/accounting/mapping/index.ts) — Barrel export

### 3.4 Hook Wiring (existing actions modified)

- [src/features/transactions/actions.ts](../src/features/transactions/actions.ts):
  - `createTransaction` — fire `postJournalForPosSale` post-commit kalau status='paid' AND skipEarn=false
  - `closeOpenBill` — fire `postJournalForPosSale` post-commit (open bill → paid transition)
  - `refundTransaction` (full refund) — fire `postJournalForPosRefund` post-commit
- [src/features/payroll/actions.ts](../src/features/payroll/actions.ts):
  - `markPayrollPaid` — fire `postJournalForPayrollPaid` post-commit kalau totalNet > 0
- [src/features/finance/actions.ts](../src/features/finance/actions.ts):
  - `verifyCashDeposit` — fire `postJournalForCashDepositVerified` post-commit, resolve bankAccountCode dari FK
  - `createAggregatorSettlement` — fire `postJournalForAggregatorSettlement` post-commit, channel-aware
- [src/features/shifts/actions.ts](../src/features/shifts/actions.ts):
  - `closeShift` — fire `postJournalForShiftVariance` post-commit kalau variance != 0

All hooks use **fireJournalHook fire-and-forget pattern**: errors logged via console.error, source action TIDAK rollback. Trade-off: ledger bisa drift, mitigation = idempotency + future catch-up job.

### 3.5 Tests

- **NEW** [tests/unit/accounting-mapping.test.ts](../tests/unit/accounting-mapping.test.ts) — 35 cases:
  - categoryMapper: 6 (food/drink/other routing, aggregation)
  - mapPosSale: 6 (cash/qris/split + discount + no-cogs + split mismatch)
  - mapPosRefund: 5 (full cash/qris, split breakdown, reverseCogs ON/OFF)
  - mapPosCompliment: 2 (with cogs balanced, without cogs returns empty)
  - mapPayrollPaid: 3 (transfer, cash, zero throws)
  - mapCashDepositVerified + resolveBankCodeFromDestination: 4
  - mapAggregatorSettlement: 5 (gofood revenue, qris piutang, edc piutang, net mismatch throws)
  - mapShiftVariance: 3 (zero empty, kurang, lebih)
  - isPiutangChannel + piutangCodeForChannel: 1

---

## 4. ⚠️ Activation Steps for Owner

**Auto-journal default OFF** — production POS/payroll/finance flow tetap normal, journal table tetap kosong. Untuk aktifkan:

### 4.1 Test pre-activation (Owner)

1. Login Admin → Akuntansi → Periode tab → klik "Buat Periode Bulan Ini" (otomatis create periode 2026-05). Verify status badge "Open"
2. Login POS → buka shift dummy → buat 1 transaksi cash kecil (misal Rp 50.000) → bayar → verify struk dapat tercetak
3. Sebelum aktifkan flag: Akuntansi → Jurnal tab → harusnya **kosong** (auto-journal OFF, no entry created)

### 4.2 Toggle flag ON (Owner via direct DB atau Admin Settings UI nanti)

Currently no UI untuk toggle — Owner harus run SQL:
```sql
UPDATE outlets
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{features,accounting_auto_journal}',
  'true'::jsonb
)
WHERE id = '<outlet-id>';
```

Or run via Drizzle Studio: `npm run db:studio` → outlets table → edit `settings` JSON column → add `{"features": {"accounting_auto_journal": true}}`.

**Sesi U deliverable**: tambah toggle UI di Admin → Settings → "Akuntansi" section.

### 4.3 Verify activation

1. Buat 1 transaksi POS cash dummy kedua (Rp 50.000)
2. Akuntansi → Jurnal tab → harus muncul entry baru `JE-202605-0001` (atau next sequence) dengan source='pos_sale', balanced
3. Expand entry → verify lines: Dr 1101 50000, Cr 4101 atau 4102 50000 (per category), + COGS lines kalau menu_item punya recipe data
4. Kalau OK: terus pakai prod normal, hook akan auto-fire setiap action
5. Kalau ada bug: matikan flag (set false) langsung, no rollback needed (fire-and-forget = doesn't break source actions)

---

## 5. Sesi U Scope (Next Sesi) — PURCHASES + EXPENSE + INCOME + OPNAME + CUTOVER WIZARD

**Estimasi:** 3-4 hari, **Risk: MEDIUM** (touches purchase confirm/pay/cancel + expense create flows yang juga live).

### 5.1 mapPurchaseCreate / mapPurchasePay / mapPurchaseCancel

Per design doc §4.7-4.8:
- Cash purchase: Dr Persediaan (per ingredient.section: kitchen=1140, bar=1141, supporting=1142), Cr Kas/Bank per paymentMethod
- TOP purchase: Dr Persediaan, Cr 2101 Hutang Dagang
- Mark-paid TOP: Dr 2101 Hutang Dagang, Cr Kas/Bank
- Cancel: counter-entry (reverse debit/credit)

**Special handling**: Q1 sesi T flow already auto-creates kas expense untuk non-TOP purchases (sesi O Q1 logic). Sesi U journal hook MUST avoid double-counting expense entry. Solution: skip journal hook untuk `expenses` rows dengan `sourceType='purchase'` (sudah covered upstream by purchase journal).

### 5.2 mapExpenseCreate (manual classification)

Per design doc §4.12. New requirement: tambah `accountId` FK column ke `expenses` table (migration 0023). Default mapping per `expenseCategories.defaultAccountId` (kolom baru di expense_categories migration 0023 juga).

UI: account selector di expense form (Admin → Kas → Tambah Pengeluaran). Owner pick akun 6xxx (mostly 6201-6305 untuk operasional).

Hook: `expense.create` action fires journal post-commit kalau sourceType='manual' (sourceType='payroll'/'purchase'/'refund' bypass — already covered upstream).

### 5.3 mapIncomeCreate

Per design doc §4.13. Income (non-POS event/rental):
- Dr Kas/Bank per paymentMethod
- Cr 4201 Pendapatan Lain-lain

Hook: `income.create`.

### 5.4 mapOpnameAdjustment

Per design doc §4.15. Stock opname finalize:
- Shortage: Dr 6903 Penghapusan Persediaan, Cr Persediaan section
- Surplus: Dr Persediaan, Cr 6903 (gain)

Hook: `stockOpname.finalize`.

### 5.5 Cutover Wizard UI

- New tab "Cutover" di Admin → Akuntansi (atau wizard dialog dari Periode)
- Owner-only, PIN required at final post step
- Inputs: kas tunai aktual, saldo bank BCA + BRI, modal Owner, saldo laba per 31 Mei 2026
- Auto-computed: persediaan value (sum ingredients × cost), hutang dagang (purchases status='pending_payment')
- Compute total debit vs credit; Owner adjust until balance
- Submit: insert special period 2026-05 status='locked', journal entry sourceType='opening_balance', dated 2026-05-31

### 5.6 Settings UI for accounting_auto_journal flag toggle

Admin → Settings → "Akuntansi" section dengan single toggle "Aktifkan Auto-Journal". Owner-only. Update outlets.settings.features.accounting_auto_journal via existing Settings update flow.

---

## 6. Critical Files for Sesi U

**Reference (existing, don't modify):**
- [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md) §4.7-4.18 (purchase/expense/income/opname/cutover mapping detail)
- [src/features/accounting/](../src/features/accounting/) — full module sesi T
- [src/features/purchases/actions.ts](../src/features/purchases/actions.ts) — purchase confirm/pay/cancel flows
- [src/features/cash/actions.ts](../src/features/cash/actions.ts) — expense + income flows
- [src/features/stock-opname/actions.ts](../src/features/stock-opname/actions.ts) — opname finalize

**To create sesi U:**
- `src/features/accounting/mapping/purchase.ts` — mapPurchaseCreate/Pay/Cancel
- `src/features/accounting/mapping/expense.ts`
- `src/features/accounting/mapping/income.ts`
- `src/features/accounting/mapping/opname.ts`
- `src/features/accounting/mapping/openingBalance.ts` — for cutover wizard
- `src/features/admin/sections/accounting/CutoverWizard.tsx`
- Migration 0023: `expenses.account_id` nullable FK + `expense_categories.default_account_id` nullable FK

**To modify sesi U:**
- [src/features/accounting/hooks.ts](../src/features/accounting/hooks.ts) — add `postJournalForPurchaseCreate`, `postJournalForExpenseCreate`, `postJournalForIncomeCreate`, `postJournalForOpnameAdjustment`, `postJournalForOpeningBalance`
- [src/features/purchases/actions.ts](../src/features/purchases/actions.ts) — wire journal hooks
- [src/features/cash/actions.ts](../src/features/cash/actions.ts) — wire expense.create + income.create hooks (skip kalau sourceType payroll/purchase/refund)
- [src/features/stock-opname/actions.ts](../src/features/stock-opname/actions.ts) — wire opname finalize hook
- [src/db/schema/expenses.ts](../src/db/schema/expenses.ts) — add accountId nullable col
- [src/features/admin/sections/SettingsSection.tsx](../src/features/admin/sections/SettingsSection.tsx) — add Akuntansi section dengan auto-journal toggle

---

## 7. Sesi U Boot Prompt

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi U (sesi 18). Sesi T selesai dengan
auto-journal hooks shipped (feature flag default OFF), HEAD `3662f5f`,
deployed prod. Q1-Q7 decisions locked.

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-17.md — handover sesi T close (this doc)
  2. docs/10-ACCOUNTING-DESIGN.md — full design spec, esp §4.7-4.18 (purchase/expense/income/opname/cutover mapping)
  3. PROGRESS.md — overall state (sesi T close)
  4. MEMORY.md — terutama sesiT-accounting-hooks, pause-before-destructive,
     migration-ordering-rule, no-native-pickers

Verify state pertama:
  git log --oneline -5                 # expect HEAD = 3662f5f
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 469/469
  npm run build                        # expect 12 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200

OWNER ACTION RECOMMENDED SEBELUM MULAI: Toggle accounting_auto_journal flag
ON via Drizzle Studio + run 1 dummy POS trx + verify journal entry tampil di
Admin → Akuntansi → Jurnal. Kalau OK lanjut sesi U; kalau ada bug, debug dulu.

Sesi U scope:
  1. mapPurchaseCreate / mapPurchasePay / mapPurchaseCancel — wire ke
     purchase.confirm + purchase.markPaid + purchase.cancel actions
  2. mapExpenseCreate (manual sourceType only — payroll/purchase/refund
     skip karena upstream coverage). Migration 0023: expenses.account_id +
     expense_categories.default_account_id nullable FK. UI selector di
     expense form
  3. mapIncomeCreate
  4. mapOpnameAdjustment — wire ke stock_opname.finalize
  5. mapOpeningBalance + cutover wizard UI Owner-only PIN
  6. Settings UI toggle untuk accounting_auto_journal flag (Admin →
     Settings → Akuntansi section)
  7. ~30+ tests (target ~500 total)

Pause-points yang perlu konfirmasi Owner:
  - Sebelum push code commit baru
  - Sebelum vercel --prod deploy
  - Sebelum apply migration 0023

Token efficiency mode tetap aktif:
  - Pakai Edit tool (diff-only) untuk existing file
  - Trust harness — skip post-edit re-read
  - Batch parallel tool calls

Carry-forward Owner action items (independent dari sesi T):
  - 🔴 HIGH Bakmie "Ayam Sambal Matah" rename via Admin Menu UI
  - 🟡 First stock-take 175 ingredient
  - 🟡 Reorder threshold per ingredient
  - 🟢 Toggle accounting_auto_journal ON post-test (recommended sebelum sesi U)
```

---

## 8. Memory Updates

Sesi T close akan write:
- `sesiT-accounting-hooks` — supersede `sesiS-accounting-foundation`. Resume point post-sesi-T dengan auto-journal hooks shipped + Q1-Q7 locked.

Memories yang tetap force:
- `migration-ordering-rule` (sesi T = pure additive, OK)
- `vercel-deploy-mode`
- `pause-before-destructive`
- `pat-handling-preference`
- `no-native-pickers` (sesi U cutover wizard wajib custom popover)
- `use-server-barrel-trap` (sesi T pakai dynamic import `await import("@/features/accounting/hooks")` dari client/server actions untuk avoid bundle pollution — pattern proven works)
- `auth-barrel-pulls-db`

---

## 9. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-02 | Sesi T close. Migration 0022 (additive bank_account_id) + 4104 seed (63 total accounts). Auto-journal foundation: flag.ts + posting.ts (recordJournal + advisory lock + idempotency) + 7 mappers (categoryMapper + posSale/Refund/Compliment/payrollPaid/cashDeposit/aggregatorSettlement/shiftVariance) + hooks.ts wrappers. 6 source actions wired (createTransaction/closeOpenBill/refundTransaction/markPayrollPaid/verifyCashDeposit/createAggregatorSettlement/closeShift). 35 new tests (469/469 total). 1 commit `3662f5f`, deployed `mahakan-9ah9g9asd`. Pre-flight clean. ⚠️ Auto-journal flag default OFF — Owner toggle setelah test. Sesi U = purchases + expenses + income + opname + cutover wizard + settings UI. |

---

# 🛑 END HANDOVER SESI 17 (sesi T close)

**Sesi T delivered POS+payroll+finance auto-journal hooks. Sesi U = purchases + expenses + income + opname + cutover wizard. Owner activation step §4 critical sebelum production journal mulai isi.**
