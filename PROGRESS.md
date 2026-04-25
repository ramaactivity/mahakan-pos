# Mahakan POS — Progress Log

Tracking milestone completion per `docs/99-EXECUTION-PLAN.md`.

## Current Status

**Phase:** Phase 1 — Foundation
**Fase:** B (Backend) — M8+M9 done, M10 next (Menu CRUD backend + rewire)
**Active Milestone:** M10 — Menu Management Backend
**Mode:** Offline-only (no git push, no Vercel deploy)

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
- [ ] **M10** — Menu Management Backend + Rewire UI
- [ ] **M11** — POS Core Backend + Rewire UI ⚠️ Critical
- [ ] **M12** — Shift Management Backend + Rewire
- [ ] **M13** — Expense/Income Backend + Rewire
- [ ] **M14** — Reports Backend + Rewire
- [ ] **M15** — Void/Refund/Discount with PIN Override
- [ ] **M16** — Thermal Printer Integration
- [ ] **M17** — PWA + Offline Resilience
- [ ] **M18** — Testing Pass
- [ ] **M19** — Deploy to Vercel
- [ ] **M20** — Soft Launch Support

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
