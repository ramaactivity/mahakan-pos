# 🤝 HANDOVER SESI 16 — Mahakan POS

**Untuk:** Claude AI agent (sesi 17 / sesi T accounting auto-journal)
**Dari:** Sesi 16 = sesi S (close 2026-05-02) — Accounting foundation deployed
**Sesi 17 (sesi T) fokus:** **Auto-journal hooks + cutover wizard** — POS sale/refund/compliment, payroll mark-paid, cash deposit verified, aggregator settlement, shift variance + Owner "Jurnal Pembukaan" wizard untuk cutover 1 Juni 2026.

---

## ⚡ TL;DR

Sesi S = Accounting foundation. Migration 0021 (additive, applied Neon prod) + 62-account COA seeded + Admin UI 3-tab read-only deployed. Single commit `7753f41`, prod live `https://mahakan-pos.vercel.app`. 434/434 tests, 12 routes.

NO auto-journal posting yet. Sesi T = wire all auto-journal hooks dengan feature flag default OFF.

---

## 1. Production State (akhir sesi S)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (HTTP/2 200) |
| Latest deploy | `mahakan-iq4pf6k0g-ramaactivity98-5695s-projects.vercel.app` (2026-05-02) |

- `release/phase-1` HEAD `7753f41` — local + remote synced
- Migration **0021** applied Neon prod (additive only, idempotent verified): 4 new tables + 2 nullable cols di categories
- 62 default Chart of Accounts seeded via `npm run seed:accounts -- --apply` (idempotent)
- typecheck + lint clean; **434/434 tests** (was 421 + 13 accounting schema tests)
- 12 routes build via webpack + Serwist

---

## 2. What Changed Sesi S (file-level)

### 2.1 Schema + Migration

- **NEW** [drizzle/migrations/0021_lumpy_photon.sql](../drizzle/migrations/0021_lumpy_photon.sql) — 4 new tables + 2 nullable cols
- **NEW** [src/db/schema/accounting.ts](../src/db/schema/accounting.ts) — chartOfAccounts, accountingPeriods, journalEntries, journalLines (full Drizzle definitions dengan check constraints)
- [src/db/schema/menu.ts](../src/db/schema/menu.ts) — `categories.accountingRevenueAccountId` + `accountingCogsAccountId` nullable cols (soft FK, app-side resolved)
- [src/db/schema/index.ts](../src/db/schema/index.ts) — barrel export `./accounting`

### 2.2 Seed Script

- **NEW** [scripts/seed-accounts.ts](../scripts/seed-accounts.ts) — 62 default accounts dengan 4-digit code (15 aset lancar + 5 aset tetap inactive [sesi W placeholder] + 4 kewajiban + 4 ekuitas + 7 pendapatan [incl. 4110 diskon + 4111 refund kontra-revenue] + 3 HPP + 22 beban [61xx personalia + 62xx sewa/utilitas + 63xx ops + 64xx channel/payment + 65xx penyusutan inactive + 69xx lain-lain]). 5 fixed asset (1201-1204, 1290) + 4 depresiasi (6501-6504) seeded `is_active=false` sampai sesi W aktifkan.
- [package.json](../package.json) — `seed:accounts` npm script

### 2.3 Feature Module `src/features/accounting/`

- **NEW** [types.ts](../src/features/accounting/types.ts) — `ChartOfAccount`, `JournalEntry`, `JournalLine`, `AccountingPeriod` (Drizzle InferSelectModel) + enum unions + ApiResult helpers
- **NEW** [schemas.ts](../src/features/accounting/schemas.ts) — `accountCodeSchema` regex 1xxx-6xxx, `createAccountSchema`, `updateAccountSchema`, `deactivateAccountSchema`, `isNormalBalanceValid()` pure helper untuk kontra-flip rule
- **NEW** [queries.ts](../src/features/accounting/queries.ts) — `listAccounts(outletId, filters)`, `getAccountById/getAccountByCode`, `listPeriods` dengan `entryCount` join, `getCurrentPeriod` WIB calendar, `getPeriodByYearMonth`, `listJournalEntries` dengan lines+account join
- **NEW** [actions.ts](../src/features/accounting/actions.ts) — read wrappers (`fetchAccounts/fetchPeriods/fetchCurrentPeriod/fetchJournalEntries/fetchPeriodStats`) + `ensureCurrentPeriod` auto-create idempotent + COA CRUD (`createAccount/updateAccount/deactivateAccount` Owner-gated dengan system protection: system accounts hanya boleh edit displayOrder + notes)
- **NEW** [index.ts](../src/features/accounting/index.ts) — type-only re-export per `use-server-barrel-trap` memory

### 2.4 Admin UI

- **NEW** [src/features/admin/sections/AccountingSection.tsx](../src/features/admin/sections/AccountingSection.tsx) — 3-tab shell (Bagan Akun / Jurnal / Periode), BookOpen header icon
- **NEW** [src/features/admin/sections/accounting/CoaView.tsx](../src/features/admin/sections/accounting/CoaView.tsx) — table list dengan filter chips per type, search by kode/nama, toggle "tampilkan nonaktif", system + kontra badges per row
- **NEW** [src/features/admin/sections/accounting/AccountFormModal.tsx](../src/features/admin/sections/accounting/AccountFormModal.tsx) — create/edit Owner-only, system account guard
- **NEW** [src/features/admin/sections/accounting/JournalView.tsx](../src/features/admin/sections/accounting/JournalView.tsx) — entries list expandable details, empty state dengan info "auto-jurnal aktif sesi T"
- **NEW** [src/features/admin/sections/accounting/PeriodsView.tsx](../src/features/admin/sections/accounting/PeriodsView.tsx) — monthly list, ensureCurrentPeriod button
- [src/features/admin/AdminShell.tsx](../src/features/admin/AdminShell.tsx) + [src/features/admin/components/AdminLeftNav.tsx](../src/features/admin/components/AdminLeftNav.tsx) — wire `accounting` section antara `finance` dan `promos`

### 2.5 RBAC + Audit

- [src/lib/auth/rbac.ts](../src/lib/auth/rbac.ts) — 13 perms baru: `accounting.coa.{view,manage}`, `accounting.journal.{view,draft,post,reverse}`, `accounting.period.{view,close,reopen,lock}`, `accounting.report.{view,export}`, `accounting.opening_balance.input`
- [src/lib/audit/types.ts](../src/lib/audit/types.ts) — 14 event types: `chart_of_accounts.{create,update,deactivate}`, `accounting_period.{open,close,lock,reopen}`, `journal_entry.{draft,post,update_draft,reverse}`, `opening_balance.posted`, `report.{income_statement,balance_sheet}.export`. Entity types: `chart_of_accounts`, `accounting_period`, `journal_entry`

### 2.6 Tests

- **NEW** [tests/unit/accounting-schemas.test.ts](../tests/unit/accounting-schemas.test.ts) — 13 cases:
  - `accountCodeSchema`: 9 cases (accept 1101/4101/6999, reject non-4-digit, reject 0xxx/7xxx/9xxx)
  - `createAccountSchema`: 4 cases (minimal valid, trim+empty-to-null, name min length, parent code format)
  - `updateAccountSchema`: 3 cases (require id, accept partial, isActive toggle)
  - `isNormalBalanceValid`: 9 cases (asset/cogs/expense → debit; liability/equity/revenue → credit; kontra-flip)

---

## 3. Sesi T Scope (Next Sesi) — AUTO-JOURNAL HOOKS + CUTOVER WIZARD

**Estimasi:** 4-5 hari, **Risk: HIGH** (touches createTransaction live flow + payroll + finance actions yang dipakai harian).

**Mitigation strategy**:
- **Feature flag** `outlets.settings.features.accounting_auto_journal` default OFF. Auto-journal helper checks flag — kalau OFF, no-op tanpa error.
- Owner toggle ON SETELAH sesi T deploy + Owner test 1 transaksi dummy + verify journal entry benar di Admin → Akuntansi → Jurnal tab.
- Idempotency: per `(outletId, sourceType, sourceId)`, at most 1 active entry. On retry skip.

### 3.1 Helper `recordJournal(tx, payload)`

Core utility di `src/features/accounting/posting.ts`:
- Inputs: `tx` (Drizzle DB transaction), `outletId`, `sourceType`, `sourceId`, `entryDate`, `description`, `lines[]` (account ref + debit/credit), `metadata`, `actorId`
- Resolves period (auto-create kalau belum ada untuk entryDate)
- Generates entry number `JE-YYYYMM-NNNN` via Postgres advisory lock per (outlet, period)
- Validates sum debit = sum credit (throw kalau imbalanced — caller's TX rolls back)
- Idempotency check: kalau exists active entry untuk (sourceType, sourceId), return existing
- Inserts entry header + lines

### 3.2 Hook Wiring

Dalam `db.transaction(async (tx) => { ... })` blocks, panggil `recordJournal(tx, payload)` SEBELUM commit. Kalau imbalanced atau period locked, throw → rollback semua perubahan transactional (POS sale gagal, dst).

| Source action | sourceType | Mapping rules |
|---|---|---|
| `createTransaction` (cash/qris/card_bca/split) | `pos_sale` | §4.1-4.3 design doc |
| `refundTransaction` | `pos_refund` | §4.5 |
| `createTransaction` (Compliment branch — reason prefix `Compliment:`) | `pos_compliment` | §4.6, treat as marketing expense, no revenue |
| `markPayrollPaid` | `payroll_paid` | §4.11 |
| `cashDeposit.verify` | `cash_deposit_verified` | §4.9 |
| `aggregatorSettlement.create` | `aggregator_settlement` | §4.10 |
| `closeShift` (kalau variance != 0) | `shift_variance` | §4.14 |

### 3.3 Cutover Wizard

UI baru di Admin → Akuntansi → tab keempat "Cutover" (atau dialog wizard dari Periode tab):
- One-time. Owner-only. PIN required at final post step.
- Inputs Owner type: kas tunai aktual (drawer + brankas), saldo bank BCA + BRI per 31 Mei 2026, modal Owner, saldo laba (atau 0 fresh start)
- Auto-computed: persediaan value (sum ingredients × cost), hutang dagang (purchases status='pending_payment')
- Compute: total debit vs total credit. Owner adjust nilai sampai balance.
- Submit → insert special `accountingPeriods` row 2026-05 status='locked' + journal entry `sourceType='opening_balance'` dated 2026-05-31 dengan all opening balance lines.
- Setelah submit → period 2026-06 di-create status='open'. Auto-journal (kalau flag ON) start active dari trx tanggal >= 2026-06-01.

### 3.4 Open Questions yang Harus Owner Clarify Sebelum Mapping Finalized

Lihat [docs/99-HANDOVER-SESSION-15.md §5](99-HANDOVER-SESSION-15.md) — 7 items, esp:

1. **Aggregator transaction mechanism** — apakah ada flag channel di transactions table sekarang, atau Galih input pesanan GoFood/Grab/Shopee sebagai cash transactions terpisah dengan settlement separately? Cek schema `shifts.{gofood,grabfood,shopeefood,edc_bca}Settlement`. **Decision needed before mapping #4.4 di design doc.**
2. **Kategori → food/drink mapping** — confirm 11 kategori. Default heuristic: ricebowl/bakmie/snack=food (4101/5101), coffee/non-coffee/manual brew/tea=drink (4102/5102). **Croffle/dessert clarify masuk mana**.
3. **Bank destination rule** — free-text fuzzy ("BCA"→1110) atau dropdown selector akun di UI? **Rekomendasi: dropdown** (less ambiguity).
4. **MDR fee untuk QRIS/EDC** — apakah `aggregator_settlements` punya fee field untuk channels qris+edc_bca? Kalau iya auto-journal include 6402.
5. **Refund COGS reversal default** — OFF (asumsi habis dikonsumsi) atau ON (return). Rekomendasi default OFF.
6. **Compliment-without-cogs** — kalau menu_item belum punya recipe (cogs=0), skip entry + warning. OK?
7. **Owner kasbon** — push ke sesi V atau later?

---

## 4. Critical Files for Sesi T

**Reference (existing, don't modify):**
- [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md) §4 (auto-journal mapping detail per event)
- [src/features/accounting/](../src/features/accounting/) — types, queries, actions sesi S
- [src/features/transactions/actions.ts](../src/features/transactions/actions.ts) — POS createTransaction + refund + open bill flows
- [src/features/payroll/actions.ts](../src/features/payroll/actions.ts) — markPayrollPaid (Q1 already auto-creates expense)
- [src/features/finance/actions.ts](../src/features/finance/actions.ts) — verifyCashDeposit, createAggregatorSettlement
- [src/features/shifts/actions.ts](../src/features/shifts/actions.ts) — closeShift dengan variance computation

**To create sesi T:**
- `src/features/accounting/posting.ts` — `recordJournal(tx, payload)` helper + entry number generator (advisory lock)
- `src/features/accounting/mapping/` — per-event compute functions (pure, testable):
  - `mapPosSale.ts` — POS sale → journal lines (cash/qris/card_bca/split, food/drink split, COGS, kitchen/bar persediaan split)
  - `mapPosRefund.ts`
  - `mapPosCompliment.ts`
  - `mapPayrollPaid.ts`
  - `mapCashDepositVerified.ts`
  - `mapAggregatorSettlement.ts`
  - `mapShiftVariance.ts`
  - `mapOpeningBalance.ts` — for cutover wizard
- `src/features/admin/sections/accounting/CutoverWizard.tsx` — Owner UI
- Tests untuk per-event mapping (~30+ unit tests target)

**To modify sesi T:**
- [src/db/schema/outlets.ts](../src/db/schema/outlets.ts) — extend `settings.features` JSON dengan `accounting_auto_journal: boolean`
- [src/features/transactions/actions.ts](../src/features/transactions/actions.ts) — wire recordJournal hooks dalam db.transaction
- [src/features/payroll/actions.ts](../src/features/payroll/actions.ts) — wire payroll_paid hook
- [src/features/finance/actions.ts](../src/features/finance/actions.ts) — wire deposit_verified + aggregator_settlement hooks
- [src/features/shifts/actions.ts](../src/features/shifts/actions.ts) — wire shift_variance hook

---

## 5. Sesi T Boot Prompt

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi T (sesi 17). Sesi S selesai dengan
foundation accounting (migration 0021 + 62 COA seeded + read-only Admin UI),
HEAD `7753f41`, deployed prod.

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-16.md — handover sesi S close (this doc)
  2. docs/10-ACCOUNTING-DESIGN.md — full design spec, esp §4 (auto-journal mapping)
  3. docs/99-HANDOVER-SESSION-15.md §5 — 7 open questions yang harus Owner clarify
  4. PROGRESS.md — overall state (sesi S close)
  5. MEMORY.md — terutama sesiS-accounting-foundation, pause-before-destructive,
     migration-ordering-rule, no-native-pickers, use-server-barrel-trap

Verify state pertama:
  git log --oneline -5                 # expect HEAD = 7753f41
  git status                           # docs/99-HANDOVER-SESSION-16 + PROGRESS modified, memory file new
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 434/434
  npm run build                        # expect 12 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200

OWNER ACTION REQUIRED SEBELUM MULAI: Tanya Owner 7 open questions di
docs/99-HANDOVER-SESSION-15.md §5 — esp #1 (aggregator mechanism) yang
critical untuk mapping #4.4 di design doc. Jangan mulai coding hooks
sebelum jawaban masuk.

Setelah 7 open questions terjawab, sesi T scope:
  1. recordJournal helper + entry number generator (advisory lock)
  2. Per-event mapping pure functions (mapPosSale, mapPosRefund,
     mapPosCompliment, mapPayrollPaid, mapCashDepositVerified,
     mapAggregatorSettlement, mapShiftVariance, mapOpeningBalance)
  3. Wire hooks ke createTransaction/refundTransaction/markPayrollPaid/
     verifyCashDeposit/aggregatorSettlement.create/closeShift
  4. Cutover wizard UI Owner-only
  5. Feature flag `outlets.settings.features.accounting_auto_journal`
     default OFF
  6. Tests: ~30+ unit tests per-event mapping (target ~465 total)

Pause-points yang perlu konfirmasi Owner:
  - Sebelum push code commit baru
  - Sebelum vercel --prod deploy
  - Sebelum schema migration apply (kalau ada — sesi T mungkin tambah
    feature flag column, mungkin tidak)
  - SEBELUM Owner toggle accounting_auto_journal ON di production —
    Owner test 1 transaksi dummy dulu, verify journal entry di Admin
    → Akuntansi → Jurnal, baru toggle ON

Token efficiency mode tetap aktif:
  - Pakai Edit tool (diff-only) untuk existing file
  - Trust harness — skip post-edit re-read
  - Batch parallel tool calls

Carry-forward Owner action items (independent dari sesi S):
  - 🔴 HIGH Bakmie "Ayam Sambal Matah" rename via Admin Menu UI
  - 🟡 First stock-take 175 ingredient (initial_stock=0)
  - 🟡 Reorder threshold per ingredient
```

---

## 6. Memory Updates

Sesi S close akan write:
- `sesiS-accounting-foundation` — supersede `sesiR-finance-design`. Resume point post-sesi-S dengan accounting tier foundation deployed (migration + COA + read-only UI).

Memories yang tetap force:
- `migration-ordering-rule` (sesi S = additive only, migrate-first OK per D55 pattern; sesi T mungkin tambah feature flag column — also additive)
- `vercel-deploy-mode`
- `pause-before-destructive` (refined: routine commits/push/deploy/additive migrations proceed; sesi T tambah pause point: SEBELUM toggle accounting_auto_journal flag ON di prod)
- `pat-handling-preference`
- `no-native-pickers` (PERMANENT — sesi T cutover wizard wajib custom popover)
- `use-server-barrel-trap`
- `auth-barrel-pulls-db`

---

## 7. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-02 | Sesi S close. Migration 0021 (4 new tables + 2 nullable cols di categories), 62 default COA seeded, feature module + Admin UI 3-tab read-only, 13 RBAC perms + 14 audit events + 3 entity types, 13 new unit tests (434/434 total). 1 commit `7753f41`, deployed `mahakan-iq4pf6k0g.vercel.app`. Pre-flight clean. Sesi T = auto-journal hooks + cutover wizard. |

---

# 🛑 END HANDOVER SESI 16 (sesi S close)

**Sesi S delivered accounting tier foundation. Sesi T = auto-journal hooks + cutover wizard. Owner answers to 7 open questions di handover-15 §5 needed before sesi T mapping finalized. Boot prompt §5 ready dipakai di sesi baru.**
