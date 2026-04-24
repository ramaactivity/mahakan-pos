# Mahakan POS — Progress Log

Tracking milestone completion per `docs/99-EXECUTION-PLAN.md`.

## Current Status

**Phase:** Phase 1 — Foundation
**Fase:** A (UI Prototype)
**Active Milestone:** M4 — Auth UI Prototype (next)
**Mode:** Offline-only (no git push, no Vercel deploy)

---

## Milestone Checklist

### Fase A — UI Prototype (Week 1-3)

- [x] **M0** — Housekeeping & Environment Prep _(done 2026-04-24, commit `48a4111`)_
- [x] **M1** — Environment Credentials Setup _(done 2026-04-24, Neon smoke test passed)_
- [x] **M2** — Design System Foundation _(done 2026-04-24, money.ts 100% coverage, 60/60 tests)_
- [x] **M3** — Mock Data Layer _(done 2026-04-24, 43 menu items + 7 fake services)_
- [ ] **M4** — Auth UI Prototype _(next)_
- [ ] **M3** — Mock Data Layer
- [ ] **M4** — Auth UI Prototype
- [ ] **M5** — POS UI Prototype
- [ ] **M6** — Admin UI Prototype
- [ ] **M7** — UI Review & Polish — 🎯 **Fase A complete**

### Fase B — Backend + Rebuild (Week 4-12)

- [ ] **M8** — Database Schema & Seed
- [ ] **M9** — Auth Backend (Auth.js v5 + RBAC)
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

**Next session (M4 — Auth UI Prototype):**
- `src/app/(auth)/login/page.tsx` — email+password form for Owner/Manager
- `src/app/(auth)/pin/page.tsx` — PIN pad flow with staff avatar selector
- `src/app/(auth)/layout.tsx` — centered Mahakan logo shell
- Wire to `authService` mocks (no real backend yet)
- Error state with shake animation on wrong credentials
- After login: redirect Owner → `/dashboard` (stub), Staff → `/pos` (stub)

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
