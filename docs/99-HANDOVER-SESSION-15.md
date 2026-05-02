# 🤝 HANDOVER SESI 15 — Mahakan POS

**Untuk:** Claude AI agent (sesi 16 / sesi S accounting)
**Dari:** Sesi 15 = sesi R (close 2026-05-02) — DESIGN ONLY
**Sesi 16 (sesi S) fokus:** **Migration 0021 + COA seed 52 akun + Admin UI Akuntansi read-only** sebagai foundation accounting tier (sesi S–V).

> ⚠️ Naming note: handover doc ini mengikuti urutan filesystem (`SESSION-14` → `SESSION-15`), tapi internal session-letter nomenclature udah pasca-Q. Sesi 15 = sesi R = pure design. Sesi 16 = sesi S = first code sesi accounting.

---

## ⚡ TL;DR

Sesi R = pure design sesi. Owner direction: focus finance, lanjut ke proper double-entry accounting on top of single-entry Finance module yang sesi Q ship.

5 keputusan locked (D56-D60). Design doc lengkap di [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md).

Implementation phasing: sesi S (schema + COA + read-only UI), sesi T (auto-journal POS+payroll+deposit+aggregator + cutover wizard), sesi U (auto-journal purchases+expense+income+opname), sesi V (manual journal + period close + reports), sesi W opsional (fixed asset + depresiasi).

**Cutover date: 1 Juni 2026.** Pre-cutover transactions tetap pakai Finance views existing.

---

## 1. Production State (akhir sesi R)

**Tidak berubah dari sesi Q.** No code changes sesi R.

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest deploy | Sesi Q Finance module (HEAD `259a03a`) — masih latest |

- `release/phase-1` HEAD `259a03a` — local + remote synced
- DB Neon: migration 0020 (Finance module Q1+Q2+Q3) terakhir applied
- typecheck + lint clean; **421/421 tests** (no new tests sesi R — design only)
- 12 routes build via webpack + Serwist

---

## 2. What Changed Sesi R (file-level)

3 file docs modifications, 0 code changes, 0 migration, 0 deploy:

| File | Change |
|---|---|
| **NEW** [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md) | Full design spec v1.0 — scope, decisions D56-D60, 52-account COA listing, 4-table schema design, auto-journal mapping per event (17 event types), period close logic, reports (TB/GL/IS/Neraca), RBAC + audit, implementation phasing sesi S-V + opsional W, open questions, risks, test strategy |
| [docs/99-PHASE-2-ROADMAP.md](99-PHASE-2-ROADMAP.md) | §10 +D56-D60 decisions; §12 new accounting tier overview pointing ke design doc; closing line bumped to 2026-05-02 |
| [PROGRESS.md](../PROGRESS.md) | Sesi R close entry at top; Active Milestone updated |

---

## 3. Decisions Locked (D56-D60)

| ID | Decision | Recap |
|---|---|---|
| **D56** | Hybrid basis | Accrual untuk POS sale (revenue saat sale, piutang per channel sampai settle), TOP purchase, payroll mark-paid. Cash basis untuk operasional kecil (sewa, listrik, internet) |
| **D57** | Standard ~52 akun | 4-digit code: 1xxx aset / 2xxx kewajiban / 3xxx ekuitas / 4xxx pendapatan / 5xxx HPP / 6xxx beban. Lengkap di design doc §2 |
| **D58** | Cutover 1 Juni 2026 | Owner input "Jurnal Pembukaan" via wizard di sesi T. Pre-cutover skip backfill |
| **D59** | Monthly close | Asia/Jakarta calendar, state machine open→closed→locked, reopen Owner-only |
| **D60** | Manual entry Owner-only PIN | Manager bisa draft, post wajib Owner re-PIN |

---

## 4. Sesi S Scope (Next Sesi)

**Estimasi:** 3-4 hari, Risk Medium (additive schema, no live flow touched yet).

**Deliverables:**

### 4.1 Migration 0021

```sql
-- New tables
CREATE TABLE chart_of_accounts (...);
CREATE TABLE accounting_periods (...);
CREATE TABLE journal_entries (...);
CREATE TABLE journal_lines (...);

-- Additive columns to existing categories
ALTER TABLE categories ADD COLUMN accounting_revenue_account_id uuid;
ALTER TABLE categories ADD COLUMN accounting_cogs_account_id uuid;
```

Schema detail di design doc §3.

**Migration order:** migrate FIRST, deploy SECOND (additive only, follows D55 pattern untuk pure additive + new TS schema).

### 4.2 Seed 52 Default Accounts

`src/db/seed-accounts.ts` (atau extend existing seed) — idempotent INSERT 52 rows dengan `is_system=true` untuk system accounts (47 aktif sesi S-V, 5 fixed asset placeholder inactive untuk sesi W).

Seed default mapping untuk existing 11 categories ke food (4101/5101) atau drink (4102/5102) heuristic — Owner bisa override via UI.

**Open question untuk Owner saat sesi S boot**: confirm 11 kategori ke food/drink mapping (ricebowl/bakmie/snack = food; coffee/non-coffee/manual-brew/tea = drink). Croffle ambigu — clarify.

### 4.3 Feature Module `src/features/accounting/`

```
src/features/accounting/
  types.ts          # Account, JournalEntry, JournalLine, AccountingPeriod
  schemas.ts        # Zod
  queries.ts        # fetchAccounts, fetchAccountsByType, fetchJournalEntries (filter by period/source/account), fetchPeriod (current/by year-month)
  actions.ts        # createAccount, updateAccount, deactivateAccount (system accounts protected)
  index.ts          # barrel
  helpers/
    accountCode.ts  # validate code format, parent code derivation
```

**No journal posting actions yet.** Hanya CRUD COA + read queries.

### 4.4 Admin UI

New "Akuntansi" sidebar item antara Keuangan & Promo (icon: BookOpen dari lucide-react).

3 tabs:
- **Bagan Akun** — table view 52 akun, filter by type, search, edit (system accounts read-only fields kecuali display order), create custom account (Owner only)
- **Jurnal** — list entries (kosong sampai sesi T), filter by period/source/account, click entry → modal dengan detail lines
- **Periode** — list periods, current month auto-created, status badge (open/closed/locked), buttons disabled (close action sesi V)

### 4.5 RBAC + Audit (registered, no enforcement on writes yet)

- `accounting.coa.view` (owner+manager)
- `accounting.coa.manage` (owner-only)
- `accounting.journal.view` (owner+manager)
- `accounting.period.view` (owner+manager)
- `accounting.report.view` (owner+manager) — placeholder, reports built sesi V

Audit events sesi S: `chart_of_accounts.create`, `chart_of_accounts.update`, `chart_of_accounts.deactivate`.

### 4.6 Tests

- Schema validation tests (zod)
- COA seed integrity test (52 accounts, system flag, normal balance per type, no duplicate codes)
- Helper functions (account code format, parent derivation)
- Target ~10-15 new tests, total **~431-436 tests**

### 4.7 No Auto-Journal, No Posting

Sesi S = foundation only. Journal entries table schema ready, tapi:
- ❌ No auto-journal hooks ke createTransaction/payroll/deposit/etc
- ❌ No manual entry UI
- ❌ No period close action
- ❌ No reports (TB/GL/IS/Neraca)

Itu semua sesi T-V.

---

## 5. Open Questions for Owner Saat Sesi S Boot

Sebelum sesi T mapping bisa di-finalize, butuh klarifikasi dari Owner:

1. **Aggregator transaction mechanism**: Apakah ada flag channel di `transactions` table sekarang? Atau Galih input pesanan GoFood/Grab/Shopee sebagai transaksi cash + record settlement separately? Cek schema `shifts.{gofood,grabfood,shopeefood,edc_bca}Settlement` — apa sumber data-nya? **Decision needed before sesi T mapping #4.4**.
2. **Kategori → food/drink mapping**: confirm 11 kategori. Default heuristic:
   - Food (4101/5101): Ricebowl, Bakmie, Snack
   - Drink (4102/5102): Coffee Based, Non-Coffee, Manual Brew, Tea
   - **Croffle, dessert, dll — Owner clarify masuk mana**
3. **Bank destination rule** untuk cash deposit + aggregator settlement: free-text fuzzy match ("BCA" → 1110, "BRI" → 1111) atau force dropdown selector akun? **Rekomendasi**: dropdown selector (less ambiguity).
4. **MDR fee untuk QRIS/EDC**: cek schema `aggregator_settlements` — apa ada fee field untuk channels qris+edc_bca? Kalau iya, auto-journal include 6402. Kalau tidak, manual monthly recap.
5. **Refund COGS reversal**: default OFF (asumsi barang habis dikonsumsi) atau default ON (asumsi return). **Rekomendasi default OFF**, Owner toggle per refund.
6. **Compliment-without-cogs**: kalau menu_item belum punya recipe (cogs=0), compliment journal entry skip dengan warning "Compliment tanpa cogs — review recipe untuk akurasi marketing expense". OK?
7. **Owner kasbon karyawan**: ada use case sekarang? Kalau iya, mekanisme: form di Admin → HR → Karyawan detail, generate manual journal Dr 1130 Cr Kas, settle via deduction di payroll. Push ke sesi V atau later?

Simpan jawaban Owner di handover sesi S close, dipakai untuk implement sesi T mapping.

---

## 6. Critical Files for Sesi S

**Reference (read-only sesi S):**
- [docs/10-ACCOUNTING-DESIGN.md](10-ACCOUNTING-DESIGN.md) — full spec, esp §2 (COA list), §3 (schema), §8 (sesi S scope detail)
- [src/db/schema/index.ts](../src/db/schema/index.ts) — pattern untuk schema export
- [src/db/schema/expenses.ts](../src/db/schema/expenses.ts) — pattern untuk pgTable + check constraints + indexes
- [src/db/schema/cash_deposits.ts](../src/db/schema/cash_deposits.ts) — newest table, refer for style consistency
- [src/features/finance/](../src/features/finance/) — newest feature module (sesi Q), pattern reference
- [src/features/admin/sections/FinanceSection.tsx](../src/features/admin/sections/FinanceSection.tsx) — pattern untuk multi-tab admin section

**To create sesi S:**
- `drizzle/migrations/0021_*.sql` (drizzle-kit auto-gen)
- `src/db/schema/accounting.ts` (4 tables — atau split per-table kalau lebih readable)
- `scripts/seed-accounts.ts` atau extend existing seed (52 default accounts)
- `src/features/accounting/` (full module)
- `src/features/admin/sections/AccountingSection.tsx` (3 tabs)
- `src/lib/auth/rbac.ts` — register new perms
- `src/lib/audit/types.ts` — register new event types
- `tests/unit/accounting/` (zod schemas + helpers)

**To modify sesi S:**
- [src/db/schema/menu.ts](../src/db/schema/menu.ts) — `categories` table tambah 2 kolom nullable FK
- [src/features/admin/AdminLeftNav.tsx](../src/features/admin/AdminLeftNav.tsx) (atau wherever nav defined) — tambah "Akuntansi" item antara Keuangan & Promo
- [src/features/admin/AdminShell.tsx](../src/features/admin/AdminShell.tsx) — route ke AccountingSection

---

## 7. Sesi S Boot Prompt

**Copy-paste ke Claude di sesi baru:**

```
Halo, gua mau lanjut Mahakan POS sesi S (sesi 16). Sesi R selesai dengan
design doc accounting + roadmap update + handover-15 (NO code).

Baca dulu (urutan ini penting):
  1. docs/99-HANDOVER-SESSION-15.md — handover sesi R close (this doc)
  2. docs/10-ACCOUNTING-DESIGN.md — full design spec (esp §2 COA list, §3 schema, §8 sesi S scope)
  3. docs/99-PHASE-2-ROADMAP.md — §10 D56-D60 decisions, §12 accounting tier
  4. PROGRESS.md — overall state (sekarang sesi R close)
  5. MEMORY.md (auto-loaded) — terutama sesiR-finance-design,
     pause-before-destructive, vercel-deploy-mode, migration-ordering-rule, no-native-pickers

Verify state pertama:
  git log --oneline -5                 # expect HEAD = 259a03a
  git status                           # docs/10-ACCOUNTING-DESIGN.md baru, 99-PHASE-2-ROADMAP + PROGRESS modified, 99-HANDOVER-15 baru
  npm run typecheck && npm run lint    # expect clean
  npx vitest run                       # expect 421/421
  npm run build                        # expect 12 routes
  curl -sI https://mahakan-pos.vercel.app/   # expect HTTP/2 200

Sesi S scope = Migration 0021 + COA seed 52 + read-only Admin UI Akuntansi.
Detail: docs/99-HANDOVER-SESSION-15.md §4.

OPEN QUESTIONS yang harus dijawab Owner SEBELUM mulai (handover-15 §5):
1. Aggregator transaction mechanism (channel flag di transactions atau separate?)
2. Kategori → food/drink mapping (terutama Croffle / dessert)
3. Bank destination rule (free-text vs dropdown selector)
4. MDR fee field di aggregator_settlements untuk QRIS+EDC?
5. Refund COGS reversal default
6. Compliment-without-cogs handling
7. Owner kasbon karyawan use case

Tunggu Owner jawab #1-#7, lalu mulai dengan migration 0021.

Pause-points yang perlu konfirmasi Owner (per pause-before-destructive memory):
- Sebelum push code commit baru
- Sebelum vercel --prod deploy
- Sebelum schema migration apply
- Sebelum git revert atau rollback

Token efficiency mode tetap aktif:
- Pakai Edit tool (diff-only) untuk existing file
- Trust harness — skip post-edit re-read
- Batch parallel tool calls

Carry-forward Owner action items (independent, dari sesi sebelumnya):
- 🔴 HIGH Bakmie "Ayam Sambal Matah" rename via Admin Menu UI
- 🟡 First stock-take 175 ingredient (initial_stock=0)
- 🟡 Reorder threshold per ingredient
```

---

## 8. Memory Updates

Sesi R close akan write:
- `sesiR-finance-design` — supersede `sesiQ-close`. Resume point post-sesi-R dengan accounting design doc complete + decisions D56-D60 locked + sesi S scope ready.

Memories yang tetap force:
- `migration-ordering-rule` (sesi S = additive only, migrate-first OK per D55 pattern)
- `vercel-deploy-mode`
- `pause-before-destructive`
- `pat-handling-preference`
- `no-native-pickers` (PERMANENT — sesi S Admin UI Akuntansi wajib custom popover)
- `use-server-barrel-trap` (sesi S buat feature module, hindari barrel re-export server actions + types)
- `auth-barrel-pulls-db`

---

## 9. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-02 | Sesi R close. Design-only sesi: 1 doc baru (10-ACCOUNTING-DESIGN.md), 2 doc updates (99-PHASE-2-ROADMAP §10+§12, PROGRESS.md). Decisions D56-D60 locked. No code, no migration, no deploy. Sesi S = first code sesi accounting tier (3-4 hari, schema + COA + read-only UI). |

---

# 🛑 END HANDOVER SESI 15 (sesi R close)

**Sesi R delivered comprehensive accounting design spec. Implementation across sesi S–V (next 4 sesi). Owner answers to §5 open questions needed before sesi T mapping finalized. Boot prompt §7 ready dipakai di sesi baru.**
