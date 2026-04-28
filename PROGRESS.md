# Mahakan POS — Progress Log

Tracking milestone completion per `docs/99-EXECUTION-PLAN.md`.

## Current Status

**Phase:** Phase 2 Tier 1.2 — **IN PROGRESS** (sesi 10 selesai 2026-04-28 dengan M23.4 importer/exporter/template code-complete; M23.3 + M23.4 belum di-deploy).
**Active Milestone:** M23.5 verify + Owner reconcile + first --apply + handover.
**Mode:** Online (production stable at https://mahakan-pos.vercel.app dengan M23.2 code live; tabel inventory masih kosong; M23.3 UI + M23.4 CLI tools menunggu single-release window di M23.5)
**Production URL:** https://mahakan-pos.vercel.app
**Vercel Project:** ramaactivity98-5695s-projects/mahakan-pos
**Branch:** `release/phase-1` (HEAD `3512df4`; production tetap di `37d9350` deploy `dpl_5PonsDNfLQkor4hQ3uS6FHaS8Gee`)
**Phase 2 roadmap:** see `docs/99-PHASE-2-ROADMAP.md`
**Phase 2 Tier 1.2 plan (M23.1):** `~/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md` (10 locked decisions)
**Phase 2 Tier 1.2 plan (M23.2):** `~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md` (cascade engine implementation)

---

## Milestone Checklist

### Fase A — UI Prototype (Week 1-3)

- [x] **M0** — Housekeeping & Environment Prep _(done 2026-04-24, commit `48a4111`)_
- [x] **M1** — Environment Credentials Setup _(done 2026-04-24, Neon smoke test passed)_
- [x] **M2** — Design System Foundation _(done 2026-04-24, money.ts 100% coverage, 60/60 tests)_
- [x] **M3** — Mock Data Layer _(done 2026-04-24, 43 menu items + 7 fake services)_
- [x] **M4** — Auth UI Prototype _(done 2026-04-24, login + PIN + protected routes wired to mocks)_
- [x] **M5** — POS UI Prototype _(done 2026-04-24, full order→pay→history flow, single-page 3-col)_
- [x] **M6** — Admin UI Prototype _(done 2026-04-25, single-page sidebar + 7 sections live)_
- [x] **M7** — UI Review & Polish _(done 2026-04-25, error boundaries + skeletons + a11y + cleanup)_ — 🎯 **Fase A complete**

### Fase B — Backend + Rebuild (Week 4-12)

- [x] **M8** — Database Schema & Seed _(done 2026-04-25, 13 tables on Neon, Owner+11 cats+43 items+4 mods+9 exp cats seeded)_
- [x] **M9** — Auth Backend (Auth.js v5 + RBAC) _(done 2026-04-25, JWT session, email+password + PIN providers, middleware role-routing, per-role expiry, approver-token flow, 32 unit tests)_
- [x] **M10** — Menu Management Backend + Rewire UI _(done 2026-04-25, src/features/menu module + Server Actions, admin Menu section + POS rewired to real DB)_
- [x] **M11** — POS Core Backend + Rewire UI ⚠️ Critical _(done 2026-04-25, transactions feature module with full server-side validation, atomic txn number, idempotency, void/refund + 17 validation tests)_
- [x] **M12** — Shift Management Backend + Rewire _(done 2026-04-25, shifts module + POS rewired)_
- [x] **M13** — Expense/Income Backend + Rewire _(done 2026-04-26, cash module + admin Cash rewired; C3=C: receipt photo upload skipped Phase 1)_
- [x] **M14** — Reports Backend + Rewire _(done 2026-04-26, reports module + admin Reports + DashboardHome rewired)_
- [x] **M15** — Void/Refund/Discount with PIN Override _(done 2026-04-26 — already covered in M9.5+M11; this milestone added users + outlets feature modules and finalized full mock-cutover across runtime consumers)_
- [x] **M16** — Thermal Printer Integration _(code-complete 2026-04-26 — ESC/POS encoder + receipt builder + Web Bluetooth wrapper + Settings pairing UI + PosShell auto-print on payment success. 24 unit tests. Hardware verify pending: user pair RPP02 on Chrome/Edge Android, tap Test Print, verify auto-print after live transaction.)_
- [x] **M17** — PWA + Offline Resilience _(done 2026-04-26 — Serwist service worker + manifest, online/offline banner, Dexie offline queue, PosShell auto-sync on reconnect)_
- [x] **M18** — Testing Pass _(unit-level done 2026-04-26 — 109 → 151 tests covering money, auth helpers, validation, schemas, helpers, utils. Integration tests against live DB deferred for post-launch given Phase 1 scope + offline-only mode.)_
- [x] **M19** — Deploy to Vercel _(done 2026-04-26 — branch `release/phase-1` pushed, Vercel project linked + GitHub connected, env vars set Production, deploy ready in 1m, alias https://mahakan-pos.vercel.app live, sw.js + landing + login HTTP 200)_
- [ ] **M20** — Soft Launch Support
- [x] **M21** — Phase-1 PRD Gap Closure _(done 2026-04-27, sesi 5; full audit log + login rate-limit, owner Settings edit forms, weekly/monthly sales report + PDF export + Best/Slow Mover badges, menu bulk actions + CSV export, expense CRUD + category CRUD, approver-blacklist DB-persistent, weekly DB backup workflow)_

### Phase 2 — see `docs/99-PHASE-2-ROADMAP.md`

Tier 1 candidates (in priority order):
- [x] **M22 Recipe/BOM + Inventory tracking** — code-complete 2026-04-27 sesi 6 (see §M22 sub-chunks below)
- [ ] M23 Loyalty + Customer DB (~2 weeks) — next after Tier 1.1 field validate
- [ ] M24 Promo engine (~1.5 weeks) — depends on loyalty

#### M22 — Recipe/BOM + Inventory Tracking (Phase 2 Tier 1.1)

- [x] **M22.1** — Schema (4 tables) + cogs cols + drop placeholder cols _(done 2026-04-27, commit `6aa280e`, migration `0002_glossy_prodigy.sql` applied to Neon)_
- [x] **M22.2** — Ingredient module (CRUD + receive/adjust/waste + 13 RBAC perms + tests) _(done 2026-04-27, commit `6ce1253`)_
- [x] **POS-S Side-quest** — In-POS Pengaturan tab (printer pair untuk staff, sync card, about card) _(done 2026-04-27, commit `797abff`)_
- [x] **M22.3** — Recipe module (CRUD + variant/ingredient validation + 12 schema tests) _(done 2026-04-27, commit `4e32e05`)_
- [x] **M22.4a** — Admin Inventory UI: Bahan tab + 4 modals (form/receive/adjust/waste) _(done 2026-04-27, commit `c008ff6`)_
- [x] **M22.4b** — Admin Inventory UI: Pergerakan tab dengan filters + paginated movement log _(done 2026-04-27, commit `3c9e29e`)_
- [x] **M22.4c** — Admin Inventory UI: Resep tab + RecipeEditorModal dengan variant + ingredient lines + COGS preview _(done 2026-04-27, commit `89a9235`)_
- [x] **M22.5** — createTransaction COGS snapshot + atomic auto-deduct + post-commit sold-out re-eval; voidTransaction + refundTransaction restore stock _(done 2026-04-27, commit `43ab0f4`)_
- [x] **M22.6** — P&L proper (Revenue − HPP = Laba Kotor − Pengeluaran = Laba Bersih) + Item Performance margin column + PDF export update _(done 2026-04-27, commit `b18e3a7`)_
- [ ] **M22.7** — **FIELD VALIDATE**: seed recipes untuk 43 menu, smoke-test transaksi end-to-end di tablet kafe, verify P&L numbers actual. **SUPERSEDED by M23** — Owner uploaded real spreadsheets, M23 builds proper import flow + cost engine.

#### M23 — Cost Engine: Real-data integration + sub-recipes + waste + COGS calculator (Phase 2 Tier 1.2)

Triggered when Owner uploaded 5 real Mahakan spreadsheets (Marketlist 168 ingredients + PREP FOOD/BEVERAGE 12+ sub-recipes + UPDATE HPP FOOD/BEVERAGE 50 menu recipes + Q Factor + Markup) and asked to be critically improved beyond spreadsheet limits. See `~/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md` for full design + 10 locked decisions.

System upgrades over spreadsheet:
1. Cost denormalization fix (1 update → cascade)
2. Sub-recipe nested arbitrary depth (Plan agent: prep-of-prep is real)
3. Stock count drift fix (deduct includes waste, split into sale_deduct + waste movement)
4. COGS sandbox calculator standalone

- [x] **M23.1** — Schema extension: ingredients `{is_preparation, preparation_yield, cost_last_changed_at}` + recipes `{ingredient_id, waste_factor_pct}` + nullable `menu_item_id` + XOR check + 3 partial unique indexes + 6 audit event types _(done 2026-04-27 sesi 7, commit `094dca3`, migration `0003_absent_metal_master.sql` applied; backup run `24999330539`)_
- [x] **M23.2** — Cost cascade engine: `preparation-flow-pure.ts` (4 pure helpers + 23 unit tests) + `preparation-flow.ts` (server-only DB CTE: `expandRecipeToAtomicLeaves`, `detectCycleForRecipeUpsert`, `cascadeCostUpdate` with `pg_advisory_xact_lock`, `computePrepCost` recursive with `inProgress`+`computed` dual visited); cascade hooks wired in `updateIngredient`/`receiveStock`/prep `createRecipe`/`updateRecipe`; cycle detect + RECIPE_CYCLE error in prep recipe upserts; delete guards (INGREDIENT_HAS_DEPENDENTS, PREP_HAS_DEPENDENTS); transaction-flow split into `kind=sale_deduct` + `kind=waste` movements + 1 combined `void_restore`/`refund_restore` per ingredient; recursive recipe expansion in `computeStockFlowForOrder` + `reevaluateSoldOutForIngredients` _(done 2026-04-27 sesi 8, commits `2000df6` + `e2fe24f` + `e081f7f`, pushed + deployed `dpl_5PonsDNfLQkor4hQ3uS6FHaS8Gee`; backwards-compatible — DB tabel inventory masih kosong, prep features inert sampai import M23.4)_
- [x] **M23.3** — UI: Preparations tab (`PreparationsList` + `PreparationFormModal`) + COGS Calculator widget (`CogsCalculatorWidget`) + IngredientsList atomic-only filter + RecipeEditorModal enhancements (Q Factor field, grouped select atomic/prep via `<optgroup>`, banded margin green/amber/red, GRABGOSO 30% display) + RecipesList Q badge inline + 3 server action wrappers (`listAtomicIngredients`, `listPreparations`, `getPreparationRecipe`) _(done 2026-04-28 sesi 9, commits `c8b10fc` + `1ecc604` + `b8daca2`; deploy ditunda ke M23.5 single-release)_
- [x] **M23.4** — CSV Importer/Exporter/Template generator (long-format 5-file CSV, NOT Owner spreadsheet layout — clean standardized template). 3 npm scripts (`inventory:template`, `inventory:export`, `inventory:import`); `import-engine-pure.ts` (zod-style row normalizers + diff + topological sort + duplicate detection, 32 unit tests) + `import-engine.ts` (DB orchestration: pre-flight cycle check via merged adjacency, atomic single-tx, REPLACE recipe lines, cascade auto-fire per prep, refuse-on-error commit semantics); CLI prints per-row [NEW]/[UPDATE]/[SKIP]/[ERROR] table + JSON sidecar; audit `inventory.import.run` with runId; outlet auto-detect + actor via `SEED_OWNER_EMAIL`; csv-io tests (12 cases); `docs/M23.4-CSV-IMPORT.md` operational guide. Drop `import "server-only"` dari `preparation-flow.ts` + `audit/logger.ts` agar reusable dari Node CLI _(done 2026-04-28 sesi 10, commits `e509fc1` + `f46d298` + `a48e696` + `3512df4`; smoke verified dry-run; --apply belum dijalankan di prod, menunggu Owner-curated CSV)_
- [ ] **M23.5** — Verify e2e: deploy M23.3 + M23.4 ke production; Owner curate CSV (export current state via UI yang baru, fill data dari spreadsheet existing); import dry-run di prod; Owner reconcile menu name mismatch via Admin UI; first `--apply` di prod; smoke 1 transaksi end-to-end → verify P&L COGS; handover sesi 12.

---

## Session Log

### 2026-04-24 (Session 1)

**Done:**
- Analyzed full docs suite (PRD, FSD, TSD, RBAC, DB schema, UI, API, testing)
- Created `docs/99-EXECUTION-PLAN.md` (v1.0) — 14-week realistic plan
- Locked decisions: Hybrid flow, Full Phase 1 scope, 5h/day user bandwidth
- **M0 complete** — housekeeping, `.env.example`, `.nvmrc`, PROGRESS.md, README rewrite (commit `48a4111`)
- **M1 complete** — user created `.env.local`; smoke test verified Neon connection (Postgres 17.8, ap-southeast-1 Singapore, pooled)
- Locked additional decision: **offline-only mode** (no git push, no deploy)

**M2 done (2026-04-24):**
- Tailwind v4 @theme with Mahakan sage green palette + warm neutrals + semantic colors (`src/app/globals.css`)
- Fonts — Inter + JetBrains Mono via `next/font/google`
- `src/lib/money.ts` — integer arithmetic + banker's rounding (100% coverage, 60 tests in `tests/unit/money.test.ts`)
- `src/lib/format.ts`, `src/lib/date.ts`, `src/lib/utils.ts` (cn helper)
- 9 base UI components in `src/components/ui/`: Button, Input, Card, Modal, Badge, Toast (sonner), PinPad, QuantityStepper, Spinner
- Showcase page at `/` demonstrating all components + palette
- Vitest config + coverage provider (`@vitest/coverage-v8`)
- ESLint config updated to ignore `_legacy/`, `coverage/`, `drizzle/`
- tsconfig excludes `_legacy/`

**M3 done (2026-04-24):**
- `src/mocks/types.ts` — all DB schemas mirrored (outlets/users/categories/menu/modifiers/shifts/transactions/expenses/audit) + `ApiResult` envelope + `Session`
- `src/mocks/data.ts` — seed data: 1 outlet, 4 users (1 owner, 1 manager, 2 staff), 11 categories, **43 menu items** (doc inconsistency flagged: PRD/README say 45 but `04-MENU-DATA.md` detail lists 43; real count = 43), 4 modifiers, 9 expense categories, 3 shifts (1 active, 2 closed), 5 sample transactions (mix paid/voided/refunded), 3 expenses (1 auto-refund), 1 income
- `src/mocks/services/` — 7 fake services + `_helpers.ts` + barrel `index.ts`:
  - `menuService` (list/filter/sold-out toggle, modifiers-by-category)
  - `authService` (email+pass login, PIN login, approver token, session, listApprovers, `__devImpersonate`)
  - `transactionService` (list, get, create with **full server-side validation** using `src/lib/money.ts`, void, refund with auto-expense, mark served)
  - `shiftService` (getActive, open with 1-per-user lock, close with variance calc)
  - `expenseService` (CRUD expenses + incomes, daily cash summary, `_internalAddRefundExpense` called by transaction refund)
  - `reportService` (daily sales, range sales, item performance, simple P&L, shift report)
  - `userService` (list filtered by viewer role, createStaff/createManager, update with last-owner protection, resetPin, deactivate)
- 200-500ms simulated latency; all services return `ApiResult<T>` envelope
- Interface matches future Server Action signatures so Fase B swap = swap imports, no consumer changes

**Pending decisions that became clearer:**
- Menu count discrepancy: PRD/README mention 45, actual 43 — to confirm with Owner; mock data uses 43 faithfully
- C4 (staff seed strategy) — mocks seeded 2 staff (Rina, Budi); production seed via owner-creates-manually (recommended path) still valid

**M4 done (2026-04-24):**
- `src/features/auth/SessionProvider.tsx` — React Context + `useSession` hook (loading/authenticated/unauthenticated states)
- `src/features/auth/RequireAuth.tsx` — guard component (role check + redirect)
- `src/features/auth/StaffAvatarGrid.tsx` — avatar tile selector with initials
- `src/app/layout.tsx` — `<SessionProvider>` mounted root-level
- `src/app/(auth)/layout.tsx` — centered Mahakan logo shell (uses `Logo_Mahakan_Hijau.png`)
- `src/app/(auth)/login/page.tsx` — email+password form, shake-on-error, link to /pin
- `src/app/(auth)/pin/page.tsx` — 2-step (select user → PIN pad), auto-submit at 6 digits, link to /login
- `src/app/(admin)/layout.tsx` — guards owner/manager + top bar + logout
- `src/app/(admin)/dashboard/page.tsx` — stub (3 stat cards + session info)
- `src/app/(pos)/layout.tsx` — guards any role + top bar + logout, redirect to /pin
- `src/app/(pos)/pos/page.tsx` — stub (shift card + session info)
- `src/app/page.tsx` — showcase nav buttons → /login, /pin
- Shake animation `@keyframes mahakan-shake` in globals.css
- Sessions: 2h owner/manager, 12h staff (per PRD §3.3)

**Test credentials (mock):**
- Owner: `rama.activity98@gmail.com` / `Owner1234!` (or PIN `1234`)
- Manager: `siti@mahakan.id` / `Manager1234!` (or PIN `2345`)
- Staff Rina: PIN `5678` (no email login)
- Staff Budi: PIN `5679`

**M5 done (2026-04-24):**
- `src/features/pos/cartStore.ts` — Zustand store (drafts keyed by id, supports multi-order hold)
- `src/features/pos/types.ts` — CartLineItem, Draft types
- 7 components in `src/features/pos/components/`: MenuTile, CategoryTabs, CartLineItem, ItemModifierModal (variant + sugar/ice/extra-shot), OpenPriceModal (Manual Brew), ItemNoteModal, DiscountModal (percent/fixed + reason preset), ApproverOverrideModal (PIN flow for staff actions)
- 9 routes:
  - `/pos` — dashboard (shift card, Order Baru, drafts, active orders)
  - `/pos/shift/open` — opening cash input
  - `/pos/shift/close` — variance calc with summary preview + threshold flag
  - `/pos/order/new` — pager + order type
  - `/pos/order/[id]` — menu grid (4-col responsive) + cart sidebar (70/30 desktop landscape)
  - `/pos/order/[id]/payment` — order summary + 3 payment methods + cash numpad with quick amounts + change calc
  - `/pos/order/[id]/success` — on-screen receipt preview + Selesai action
  - `/pos/history` — today's transactions with status filter
  - `/pos/history/[id]` — detail with Void/Refund (PIN approval for staff)
- All wired to `menuService`, `transactionService`, `shiftService`, `authService` mocks
- Server-side validation paths exercised (price match, sold-out check, idempotent retry, cash sufficient)
- Discount → ApproverOverrideModal flow for staff role (PIN→token→discount apply)

**Test scenarios manual:**
1. Login as Rina (PIN 5678) → /pos → Buka Shift Rp 100rb → Order Baru pager 5 takeaway
2. Tap Americano → variant Iced + sugar Less → Tambah · Rp 16.000
3. Tap V60 → input price 35.000 + beans "Ethiopia" → Tambah
4. Apply discount 10% → ApproverOverrideModal opens (Owner PIN 1234) → applied
5. Bayar → Tunai → input 100.000 → Konfirmasi → success screen with receipt preview → Selesai
6. /pos/history → see transaction → tap → Void with reason → ApproverOverrideModal → Owner PIN → voided

**Next session (M6 — Admin UI Prototype, ~4-5 days):**
- `/dashboard` — stat cards + recent trx + charts (recharts mock)
- `/menu/items` — data table (tanstack/react-table) + create/edit/delete
- `/menu/categories` — drag reorder
- `/menu/modifiers` — config cards
- `/users` — user CRUD + PIN reset
- `/shifts` + `/shifts/[id]` — history + detail
- `/expenses` + `/expenses/new` — form with image upload mock
- `/incomes`
- `/reports/sales` — daily + range with charts
- `/reports/items` — item performance sortable
- `/reports/pnl` — Owner-only Simple P&L
- `/reports/daily-cash`
- `/settings/business`, `/settings/printer`, `/settings/operational-hours`

**Pending user decisions (Critical):**
- C1 — Dependency version lock strategy (needed before M8)
- C2 — Session duration per role (needed before M9)
- C3 — Receipt image storage: Vercel Blob / base64 / skip (needed before M13)
- C4 — Staff seed strategy (needed before M9)
- C5 — PIN policy (needed before M9)
- C6 — Sold-out broadcast: SSE vs polling (needed before M11-M12)
- C7 — Production domain (needed before M19) — **may be irrelevant under offline-only mode**

**Pre-existing modifications (not yet decided):**
- `AGENTS.md`, `docs/00-README.md`, `docs/03-TSD.md` — modified in prior session, likely Next.js 15→16 version sync (per memory `tsd-version-lock-pending`). User to review before committing.

---

### 2026-04-25 (Session 2)

**M7 done (4 atomic commits):**
- **m7.1** `feat(m7.1): error boundaries + custom 404` — root + per-route-group `error.tsx` (`(auth)`, `(admin)`, `(pos)`), `global-error.tsx` last-resort fallback, custom `not-found.tsx` with Mahakan logo.
- **m7.2** `feat(m7.2): loading skeletons across list views` — added `Skeleton` primitive (animate-pulse, respects `prefers-reduced-motion`) and replaced `Spinner` in 14 list/detail views (admin Dashboard, Menu items/categories/modifiers, Staff, Shifts + detail modal, Cash expenses/incomes/daily summary, Reports daily/items/P&L, Settings, POS menu grid). Skeleton shapes mimic final layout to reduce hydration shift. `Spinner` retained for transient states (auth gate, button loading, PIN screen, showcase).
- **m7.3** `feat(m7.3): a11y pass — radiogroups + main landmark + select label` — segmented controls (price-type, order-type, discount-type + reason, payment-method) get `role="radiogroup"` / `role="radio"` / `aria-checked` + `focus-visible` rings; `(auth)` layout wraps content in `<main>`; ItemsList category filter `<select>` gets `aria-label`.
- **m7.4** `chore(m7.4): cleanup orphan + polish empty cart state` — deleted unused `SectionStub.tsx`; POS empty-cart state gets cart icon + two-line copy.

**Verification:** `npm run typecheck` ✓, `npm run lint` ✓, `npx vitest run` ✓ 60/60, `npm run build` ✓ 6 routes static.

**Fase A complete.** Next: M8 (Database Schema & Seed) — kick off Fase B. Need user confirmation on:
- C1 dependency lock decision (TSD spec vs current installed)
- Bundle the pre-existing `AGENTS.md` / `docs/00-README.md` / `docs/03-TSD.md` modifications, or discard?
- Menu count: 43 (mock) vs 45 (PRD spec) — confirm correct figure for seed.

**M8 done (2026-04-25, kickoff Fase B):**
- Decisions resolved before kickoff: C1=C (TSD now reflects installed versions, locked); pre-existing docs modifs bundled in `c9a396f`; menu count=43; C4=B (Owner-only seed, manual staff creation via UI later).
- **m8.1-3** `feat(m8.1-3): Drizzle schema + initial migration` — `drizzle.config.ts` + `src/db/index.ts` (Neon serverless pool); 7 schema files / 13 tables (outlets, users, categories, menu_items, modifiers, shifts, transactions, transaction_items, transaction_item_modifiers, expense_categories, expenses, incomes, audit_logs); DB-level hard guarantees: partial unique idxs (`ux_shifts_user_active`, `ux_users_email_active`), CHECK constraints (`ck_users_auth`, `ck_menu_items_price_consistency`, `ck_transactions_total_consistency`, `ck_transactions_cash_fields`, money-nonneg across tables); migration generated as `drizzle/migrations/0000_cute_vector.sql` (291 lines).
- **m8.5** Migration applied to Neon — 13 CREATE TABLE + 30 FKs + 22 indexes + 12 CHECKs successful (one harmless NOTICE about FK name truncation to Postgres' 63-char limit).
- **m8.6** `feat(m8.6): seed script` — `src/db/seed.ts` with dotenv + bcrypt(12) + idempotency guard, reuses `src/mocks/data` as source-of-truth during transition.
- **m8.7** Seed run successful: 1 outlet, 1 Owner, 11 categories, 43 menu items (24 fixed + 17 variant + 2 open), 4 modifiers, 9 expense categories (1 system "Refund").
- **m8.8** Verification queries on Neon confirmed all counts match expected.

**Pending decisions (Critical, due at M9):**
- C2 — Session duration per role (recommend A: Staff 12h, Owner/Manager 2h)
- C4 — Already resolved as B
- C5 — PIN policy (recommend A: 4-6 digit basic)

**Next: M9 — Auth.js v5 backend.** ⚠️ HIGH RISK per execution plan §3 (beta volatile). Strategy: Context7 MCP lookup before implementing, build incrementally (email+pass first → PIN → approver flow), commit per slice.

**M9 done (2026-04-25, 6 atomic commits + RBAC docs alignment):**
- C2 + C5 resolved as A (recommended). All 7 critical decisions now closed (C7 still pending — production domain, irrelevant under offline-only).
- **m9.1** Auth.js v5 config + RBAC (~80 perms per docs/05) + bcrypt(12) password / bcrypt(10) PIN helpers + module augmentation (Session/JWT extended with role + outletId + roleExp).
- **m9.2** `src/middleware.ts` — route protection (public allow / authed redirect to home / role-based admin gate / per-role hard expiry: Owner+Manager 2h, Staff 12h via `token.roleExp` check).
- **m9.3** SessionProvider rewired to wrap `next-auth/react` (same `useSession` shape). Login page uses `signIn("email-password", {...})`. Suspense boundary for `useSearchParams` (Next 16 prerender requirement).
- **m9.4** PIN page uses `signIn("pin", {...})` against new pin-users endpoint. Dev tool `scripts/set-user-pin.ts` for emergency Owner PIN reset until admin Reset PIN UI lands.
- **m9.5** Approver flow: `issueApproverToken` (HS256 JWT via jose, 5-min expiry, narrow-scoped: action + entity + jti) and `consumeApproverToken` (single-use in-memory blacklist, mismatch detection). Endpoints `POST /api/v1/auth/verify-approver` + `GET /api/v1/auth/approvers`. Token consumption in Server Actions deferred to M11/M15.
- **m9.6** 32 unit tests added (60 → 92 passing): password roundtrip, PIN format validator + hash, hasPermission/requirePermission/canActOnRole/sessionMaxAgeSeconds, approver issue/consume/replay/mismatch/tampered.

Build green: 10 routes (added /api/auth/[...nextauth], /api/v1/auth/{pin-users, approvers, verify-approver}). Middleware deprecation warning expected per AGENTS.md (Next 16 wants proxy.ts; Phase 1 keeps middleware.ts for Auth.js v5 compat).

**Known limitation flagged for later:**
- The mock `authService` is still wired for some POS approver-modal call sites (PosShell.tsx). Those rewire to the new `/api/v1/auth/{approvers, verify-approver}` endpoints alongside transaction backend at M11 + M15.

**Next: M10 — Menu Management Backend + Rewire UI.**

**M10 done (2026-04-25, single commit + logo polish):**
- `fix(ui): logo blends with app bg via mix-blend-difference` — switched (auth)/layout + not-found.tsx to Logo_Mahakan_Putih.png with mix-blend-difference. The 3 logo files are JPEGs without alpha; the difference blend math inverts white-on-black to clean black silhouette on the warm-off-white app bg.
- `feat(m10): menu CRUD backend + rewire admin + POS to real DB` — `src/features/menu/` module with types/schemas/queries/actions/index. Drizzle-derived types (InferSelectModel), Zod 4 discriminated union for create/update menu items (fixed/variant/open), `"server-only"` queries layer, `"use server"` actions layer wrapping with ApiResult envelope + RBAC checks via `hasPermission`. Atomic category reorder via DB transaction. Admin Menu section (ItemsList, CategoriesList, ModifiersConfig, MenuItemFormModal) and POS (PosShell, MenuTile, CategoryTabs, ItemModifierModal, OpenPriceModal) all rewired off mock service.

**Outstanding mock dependencies for later milestones:**
- `shiftService`, `transactionService` (PosShell) → M11/M12
- `expenseService`, `reportService`, `userService` (admin sections) → M13/M14/M15

**Next: M11 — POS Core Backend.** ⚠️ CRITICAL per execution plan §3 — most important milestone for money correctness. Test-first development required for createTransaction with full server-side validation per docs/03-TSD.md §5.3.

**M11+M12 done (2026-04-25, 2 commits):**
- **m11** `feat(m11): POS core backend — createTransaction + void + refund` — full src/features/transactions/ module: types/schemas/validation/helpers/queries/actions/index. Server-side validation re-derives every line subtotal from authoritative menu_items (catches price tampering, sold-out, open-price out of bounds, subtotal/discount/total/cash mismatch). Atomic transaction-number generation via pg_advisory_xact_lock keyed on outlet+WIB-day. Idempotency via clientRefId UNIQUE. Approver token consumption for Staff-initiated discount/void/refund. Refund auto-inserts expense row under system Refund category in same DB transaction. 17 unit tests cover every validation path.
- **m11.6+m12** `feat(m11.6+m12): shifts backend + POS rewire` — src/features/shifts/ module: open (with active-shift guard via partial unique index), close (aggregates paid/voided/refunded by method, computes variance). PosShell + HistoryPanel + Open/CloseShiftModal + HistoryDetailModal + ShiftPanel rewired off mocks. End-to-end POS now hits Neon: shift → order → pay → void/refund.

Total tests: 109. Build: 10 routes (no new endpoints — all Server Actions).

**Outstanding mock dependencies for M13/M14/M15:**
- `expenseService` (admin Cash section) → M13
- `reportService` (admin Reports section + DashboardHome) → M14
- `userService` (admin Staff section) → M15

**Next: M13 — Expense/Income backend + admin Cash rewire.** Lower risk than M11 — straightforward CRUD + image upload (C3 decision needed: Vercel Blob vs base64 vs skip).

---

### 2026-04-26 (Session 2 cont.)

**M13 done** (`feat(m13): cash backend`) — full src/features/cash/ module: types, helpers (WIB-day boundary), queries (expenses+incomes ranges, daily summary aggregating POS by method+manual income+expenses by category+refunds → netCashFlow), actions (RBAC-gated CRUD). C3 decision = C (skip receipt upload Phase 1; offline-only blocks Vercel Blob). Admin Cash section (ExpensesList, IncomesList, ExpenseFormModal, IncomeFormModal, DailySummary) all hit Neon.

**M14 done** (`feat(m14): reports backend`) — src/features/reports/ module: DailySalesReport (revenue, transactionCount, avgTicket, void/refund counts, payment-method breakdown, hourly bucket WIB, top 10 items, byCategory), ItemPerformanceRow (GROUP BY query for date range, sortable qty/revenue/avg), PnlReport (POS revenue + manual income − expenses by category, gross profit, Owner-only). Admin Reports views + DashboardHome rewired.

**M15 done** (`feat(m15): users + outlets`) — src/features/users/ (RBAC-scoped CRUD with Last-Owner-Active protection, role-aware update perm, hashed password+PIN seperately) + src/features/outlets/ (single getOwnOutlet Server Action). Admin Staff section (StaffSection, UserFormModal, ResetPinModal) + Settings (now reads outlet from DB) + ShiftsSection user lookup + Admin ShiftDetailModal all rewired. POS ApproverOverrideModal moved off authService → fetch /api/v1/auth/{approvers, verify-approver}. Final type-only import sweep: Role from `@/lib/auth`, OrderType/Variant from `@/features/transactions`, Shift/PublicUser/Outlet from their feature modules.

**Status:** runtime fully off mocks. `src/db/seed.ts` keeps importing mocks/data as one-shot transition source-of-truth. Build: 10 routes, 109/109 tests, no warnings.

**Next options:**
- **M16 — Thermal printer**: HIGH RISK + BLOCKED on user device. Web Bluetooth + ESC/POS RPP02. Needs user to physically pair printer + test.
- **M17 — PWA + offline (Serwist + Dexie)**: HIGH RISK, untested combo Next 16 + Serwist 9. Implementable without user input.
- **M18 — Testing pass**: fill coverage gaps, add integration tests against live DB.

Recommendation: pause for user smoke testing of M11-M15 in browser before tackling more. M16 needs hardware. M17 is implementable now but ideally validated against real PWA install on tablet.

---

### 2026-04-26 (Session 2 cont. — M17 PWA)

**M17 done (4 atomic commits):**
- **m17.1** `feat(m17.1): PWA shell` — `next.config.ts` wraps with `@serwist/next withSerwistInit`; service worker disabled in dev (Turbopack HMR-safe), built in production. `next build` script gets `--webpack` flag because Serwist's webpack-plugin can't run under Turbopack. `src/app/sw.ts` Serwist worker (defaultCache + skipWaiting + clientsClaim + navigationPreload). `public/manifest.webmanifest` (start_url=/pos, display=standalone, theme=#3D7557, bg=#fafaf7). `layout.tsx` adds metadata.manifest + appleWebApp + viewport.themeColor. `.gitignore` excludes generated `public/sw*.js` and `public/swe-worker-*.js`.
- **m17.2** `feat(m17.2): online/offline indicator banner` — `useOnlineStatus` hook (SSR-safe default true) + `<OfflineBanner>` mounted in admin + POS layouts. eslint.config.mjs globalIgnores the Serwist bundle.
- **m17.3+4** `feat(m17.3+4): Dexie offline queue + PosShell auto-sync` — Dexie `mahakan-pos-offline` DB with `pendingTransactions` table (`++id, &clientRefId UNIQUE, [state+createdAt]` index). `syncPendingTransactions()` single-flight reentrancy guard, replays via `createTransaction` (server idempotency by clientRefId UNIQUE), drops permanent errors (validation/forbidden/business-rule) to prevent infinite retry, marks transient ones for next online cycle. `usePendingSync()` hook ties it together — auto-syncs on online transition, toasts summary. PosShell mounts the hook + `handleProcessPayment` fork: offline-at-submit → queue + idle, network-error-mid-flight → queue + fallback to idle.

Verification: typecheck ✓, lint ✓, 109/109 tests ✓, build ✓ 10 routes.

Mahakan POS now installable as PWA (tablet "Add to Home Screen"), runs offline with shell + asset cache, and queues offline transactions to local IndexedDB that drain to Neon on reconnect — the full Phase 1 offline POS path.

**Phase 1 status:** every milestone except M16 (hardware-blocked printer) and M18 (testing pass) is done. Deploy (M19) is offline-only-blocked until user explicitly OKs.

---

### 2026-04-26 (Session 2 cont. — M18 unit-test pass)

**M18 unit-level done** (`test(m18): expand unit coverage`):
- helpers.test.ts (19 cases): formatPercent + truncate, WIB-aware formatters, transactions/helpers (todayWibYmd, formatTransactionNumber zero-pad, day-boundary math), cash/helpers (todayWibIso, startOfWibDateUtc/endOfWibDateUtc 24h delta).
- schemas.test.ts (18 cases): createMenuItemSchema discriminated union (fixed/variant/open) + variant-must-have-one-price + price upper bound + negative reject + empty name; categoryNameSchema trim + min/max; createTransactionSchema minimal valid + pager 1-99 + non-empty items + qty>=1 + non-negative money + clientRefId optional UUID; voidTransactionSchema reason length + UUID format.
- utils.test.ts (4 cases): cn() merger across truthy/falsy/object/tailwind-conflict cases.

Tests: 109 → 151 passing. typecheck + lint clean.

**Coverage snapshot (lines):** ~16% overall — Server Actions and queries (DB-bound) are uncovered. Critical pure logic (money.ts, validation, RBAC, approver tokens, password/PIN bcrypt, helpers) is well-covered. Integration tests against live DB deferred — captured as M18.x extension for post-launch when staging DB available.

**Phase 1 effective complete.** Remaining items are user-gated:
- **M16** Thermal Printer — needs user to pair RPP02 to Android tablet via Web Bluetooth + run live test prints
- **M19** Deploy to Vercel — blocked under offline-only-mode; needs user explicit OK
- **M20** Soft Launch — follows M19

Total commits in Phase 1 work: 56 ahead of origin (offline-only). Ready for user smoke-test pass + push-to-Vercel decision.

---

### 2026-04-26 (Session 2 cont. — final hygiene + M16)

Pos-test cleanups + M16 implementation in one push:
- **fix(middleware)** `/api/*` no longer redirected to /login — restored /pin user list rendering after Staff create.
- **chore: delete src/mocks** — runtime fully off mocks since M15; seed.ts now imports from `src/db/seed-data.ts` (typed sibling). Net -3268 LOC of dead code.
- **fix(next): allowedDevOrigins** — Next 15+ blocks cross-origin dev resources from LAN (192.168.x.x); whitelisted for tablet smoke testing.
- **docs: 99-DEPLOY-CHECKLIST.md** — pre-deploy walkthrough captured.
- **feat(m16)** Thermal printer end-to-end:
  * ESC/POS encoder (init/feed/align/bold/size/cut/dualLine/centerLine/divider) — pure logic, 12 unit tests
  * Receipt builder (Transaction → Uint8Array) — 12 scenario tests covering header/items/discount/cash/qris/card/voided/refunded
  * Web Bluetooth wrapper (singleton PrinterClient with subscribe pub-sub, pair via user gesture, GATT auto-reconnect, 256-byte chunked writes for BLE MTU safety)
  * `<PrinterControls>` in Settings → Pair + Test Print + status badge
  * PosShell `printReceiptForTransaction()` runs best-effort after createTransaction success — silent failure (on-screen receipt + history reprint as fallbacks)

Tests: 151 → 175. Hardware verify pending — user pairs RPP02 on Chrome/Edge Android, taps Test Print in Settings, then runs live transaction.

---

### 2026-04-27 (Session 3 — deploy + landing UX iteration)

**M19 deploy completed.** Production live at https://mahakan-pos.vercel.app on Vercel project `ramaactivity98-5695s-projects/mahakan-pos`. GitHub-connected for auto-deploys from `release/phase-1` branch (PR to main not yet merged).

11 commits in this session. Order chronological:

- **chore(deploy)** `vercel.json` pin `next build --webpack` (Serwist v9 needs webpack, Vercel default is Turbopack which crashes with the SW plugin).
- **feat(ui): split landing** — premium hero at `/` (logo + brand + 2 CTA + capabilities + Owner pitch + scroll indicator + footer); design system reference moved to `/showcase`. Added 3 CSS keyframes (fade-up entrance cascade, drift for decorative blobs, nudge for scroll indicator).
- **fix(middleware)** whitelist `/showcase` as public route (was being redirected to /login).
- **docs(m19)** PROGRESS.md M19 marked done.
- **feat(ui): simplify landing** — per user feedback "tidak perlu ada ini cukup landing page sederhana untuk login", stripped capabilities + Owner pitch + scroll indicator + footer. Result: single-screen logo + tagline + 2 CTA + helper line. Added `scripts/process-logo.ts` — sharp-based luma chroma-key that turns `Logo_Mahakan_Hijau.png` (JPEG-as-PNG with black bg) into proper transparent PNG. 71.3% of pixels (the black square) made transparent; green logo preserved at full opacity with anti-aliased edges.
- **feat(pwa): proper PNG icons + fullscreen** — `manifest.webmanifest` icons array replaced (out: single JPEG-as-PNG entry that rendered as black square on home screen; in: proper 192/512/maskable-512 PNG entries). `display: standalone` → `fullscreen` so Android status bar also hidden when launched from home screen. Added `scripts/generate-icons.ts` (sharp-based icon generator from the transparent logo + per-spec fillRatio + sage-50 bg for maskable safe zone).
- **fix(middleware)** whitelist `icon-*.png` + `apple-touch-icon.png` (auth matcher was 307-redirecting them to /login, breaking manifest icon resolution).
- **fix(ui)** drop chunky focus ring on inputs — Input.tsx + 5 native input/textarea inline styles in admin Cash/Menu sections + POS ItemNoteModal had `border + ring-2 + ring-offset` triple-stack on focus that looked like a chunky frame around typing area. Replaced system-wide with a single border-color shift to mahakan-green-700.
- **fix(ui+auth)** Per user feedback "hilangkan box seutuhnya" + logout bug:
  * **Box**: drop ALL focus border-shift on inputs; opt input/textarea/select out of `:focus-visible` outline; kill webkit-autofill blue/yellow tint via canonical 1000px-inset white box-shadow + 600000s color transition. Buttons + nav links keep their focus-visible:ring-2 (only fires on keyboard tab — essential a11y, invisible to mouse users).
  * **Logout**: `signOut({ redirect: false })` was racing the React session context; AdminShell/PosShell did `router.replace('/login')` (Next client routing, no full reload), `/login` mounted with stale "authenticated" status, useEffect immediately replaced back to /dashboard. Fix: `SessionProvider.logout(callbackUrl?)` now calls `window.location.assign()` after signOut — full page reload guarantees React state is discarded and the new mount sees a clean unauthenticated session. AdminShell + PosShell pass their own callback (`/login`, `/pin`) and drop redundant `router.replace`.

**State at end of sesi 3:**
- Branch `release/phase-1` synced with origin (HEAD `62b9d66`)
- 67 commits ahead of `origin/main` (PR not merged yet — Vercel happily deploys from release branch)
- Build: 11 routes (was 10 — added `/showcase`), webpack mode, 0 warnings beyond Next 16's middleware-deprecation note
- Tests: 175/175 still
- PWA fully installable; Android home screen shows clean green Mahakan logo; launches edge-to-edge fullscreen
- M16 hardware test still pending; M20 soft launch still pending
- `offline-only-dev-mode` memory marked SUPERSEDED — production is live, push/deploy normal cadence allowed (main + force-push still need explicit confirm)

Handover for sesi 4: `docs/99-HANDOVER-SESSION-4.md`.

---

### 2026-04-27 (Session 5 — PRD gap closure + bug-fix wave)

**Wave 1 — PRD §4-6 gap closure (8 commits):**
- **`33faa2d`** `feat(audit): full audit log + login rate-limiting` — typed event registry, fire-and-forget logger, joined viewer. Wired to auth (login.success/failed with reason + locked, logout), transactions (void/refund/discount.applied), users (CRUD + reset_pin), menu (item CRUD/sold-out/category CRUD/modifier price), cash (expense.create + income.create). Login rate-limit: 5 fail → 15 min lock via `users.failed_attempts` + `users.locked_until` columns. Owner-only Audit Log section in admin sidebar with event-group + date-range filters.
- **`e8970ec`** `feat(settings): owner-editable forms` — 5 outlet update server actions (business info, operational hours per-day, receipt footer + QR rating, threshold variance, HPP toggle) + 3 modals. Per-card "Edit" Owner-gated buttons.
- **`66acb20`** `feat(reports): weekly/monthly + PDF + best/slow mover badges` — `SalesRangeView` with 7d/30d/MTD/custom presets, line chart, prior-period % comparison. PDF export via jsPDF for Daily Sales + P&L + Range with branded outlet header. Excel-style quartile badges on Item Performance.
- **`ac8c612`** `feat(menu): bulk actions + CSV export` — `bulkUpdateMenuItems` with mark_sold_out / mark_available / adjust_price_pct (skips open-price). Owner-only `exportMenuCsv`. UI checkbox column + indeterminate select-all + BulkActionsBar.
- **`89a6c51`** `feat(cash): expense edit/delete + category CRUD` — Owner anytime / Manager ≤24h edit; Owner-only delete; full category CRUD (system rows protected, blocks delete with active expenses).
- **`fecacbe`** `fix(auth): persist approver-token blacklist to DB` — `consumed_approver_tokens` table with INSERT...ON CONFLICT atomic single-use (closes §6.12 race). Migration `0001_cute_iron_fist.sql` applied.
- **`0a853e5`** `feat(ops): weekly Postgres backup via GitHub Actions + manual script` — Sunday 09:00 WIB cron via `pg_dump --format=custom`, 90-day artifact. `scripts/backup-db.sh` for ad-hoc local.
- **`7fc0234`** `fix(audit): split barrel so client components can't pull server-only` — public `@/lib/audit` types/consts only; server callers use `/logger` or `/queries` direct paths.

**Wave 2 — post-deploy bug-fix (7 commits):**
- **`e050870`** `fix(ci): force pg_dump-17 path in backup workflow` — server v17.8 vs PATH-default pg_dump v16.13 mismatch.
- **`27bd12c`** + **`8ce7597`** (on `main`) — cherry-picks of workflow + CI fix; required for GitHub schedule + dispatch to register on default branch.
- **`219f5c9`** + **`cd98828`** (on `release/phase-1` and `main`) `fix(deploy): disable Vercel auto-deploy from main branch` — `vercel.json git.deploymentEnabled.main = false`. Push to `main` had silently triggered Production rebuild from main's pre-sesi-3 app code, regressing landing + creating cookie/auth mismatch loop.
- **`e7a4d70`** `fix(middleware): break redirect loop on expired session` — two bugs: `cookies.delete(name)` defaulted path to request path (didn't override `/`-scoped session cookie), and `/login` route bounced expired-but-signature-valid JWT to `/dashboard` without checking roleExp. Fix: explicit `path: "/"` + `secure: true` on cookie set; treat expired as unauthenticated globally.
- **`b0a56a5`** `fix(pos): wire reprint button — was still M16-stub after M16 shipped` — extracted `printTransactionReceipt` to `src/lib/printer/print-transaction.ts` with `PrintOutcome` result. Both PaidPanel (post-payment) and HistoryDetailModal reprint buttons now real-print with toast feedback.

**Lesson learned:** Vercel reads `vercel.json` from the deploying commit's tree, so `git.deploymentEnabled` rule must exist on every branch you want to skip — not just the default. GitHub Actions schedule + workflow_dispatch only register from default branch, forcing workflow files to live on `main` even when app code lives on `release/phase-1`.

**Auth & ops upgrades closed:**
- **§6.11** rate-limit: SOLVED (5 attempts, 15 min lock)
- **§6.12** approver token race: SOLVED (DB single-use)
- **§6.10** backup automation: SOLVED (weekly cron, 90-day retention)

**State at end of sesi 5:**
- Branch `release/phase-1` synced (HEAD `b0a56a5`); main HEAD `cd98828`
- Tests: 175/175; typecheck clean; lint clean; build 11 routes
- Production stable at `https://mahakan-pos.vercel.app`
- PRD §4-6 gap closed (M21). Phase 1 PRD-COMPLETE.
- M16 partial-verified (Settings test print confirmed 2026-04-27 15:16 WIB by user; auto-print + reprint shipped, awaiting field test)
- M20 soft launch still pending

Handover for sesi 6: `docs/99-HANDOVER-SESSION-5.md`. Phase 2 roadmap: `docs/99-PHASE-2-ROADMAP.md`.
