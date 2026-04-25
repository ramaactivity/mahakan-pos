# 🤝 HANDOVER SESI 2 — Mahakan POS

**Untuk:** Claude AI agent (sesi baru)
**Dari:** Sesi 1 (sudah panjang, owner Rama mau lanjut di sesi baru)
**Date:** 2026-04-25
**Status:** **Fase A 6/7 milestone done** — tinggal M7 (UI Polish), lalu masuk Fase B (backend rebuild) di M8

---

## ⚡ TL;DR

Lo nanggepin handover dari sesi sebelumnya yang sudah ngerjain banyak. **Phase 1 milestone M0-M6 lengkap.** Mahakan POS punya:

- **2 single-page apps:** `/pos` (kasir 3-kolom) + `/dashboard` (admin sidebar + 7 sections)
- **Mock-driven** — semua data dari `src/mocks/services/` + Zustand cart store. **No backend yet.**
- **15 commits di main**, semua local (offline-only — gak push, gak deploy)
- **60/60 tests pass**, typecheck/lint/build clean

**Yang harus lo kerjain berikutnya: M7 — UI Review & Polish** (lihat §6.1). Setelah M7 → Fase A lengkap → masuk Fase B (backend) di M8.

**Cara mulai:**
1. Baca dokumen ini sampai habis (10 menit)
2. Baca `docs/99-EXECUTION-PLAN.md` untuk roadmap full
3. Baca `MEMORY.md` agent (auto-loaded oleh harness)
4. Verify state: `npm run typecheck && npm run build && npx vitest run`
5. Tanya user: "Lanjut M7 atau ada feedback dari M6?"

---

## 1. Project Status

### 1.1 Status milestone

| # | Milestone | Status | Commit |
|---|---|---|---|
| M0 | Housekeeping & env scaffolding | ✅ Done | `48a4111` |
| M1 | Env credentials + Neon smoke test | ✅ Done | `e1e9e7f` |
| M2 | Design system + 9 UI components + money.ts (100% cov) | ✅ Done | `31eabb6` |
| M3 | Mock data layer (types, seed, 7 services) | ✅ Done | `d14ca7f` |
| M4 | Auth UI prototype (login + pin + guards) | ✅ Done | `c0a0941` |
| M5 | POS UI prototype (single-page 3-col) | ✅ Done | `21e458b` (+ 4 polish commits) |
| M6 | Admin UI prototype (single-page sidebar) | ✅ Done | `667abb5` (6 chunks) |
| **M7** | **UI Polish (Fase A wrap-up)** | ⏳ **Next** | — |
| M8 | DB schema + seed (Drizzle + Neon) | 🔜 Fase B start | — |
| M9 | Auth backend (Auth.js v5) — HIGH RISK | 🔜 | — |
| M10-M20 | Backend rewire + printer + PWA + tests + deploy | 🔜 | — |

### 1.2 Decisions yang sudah dilock user

Per AskUserQuestion + chat:

| Decision | Value | Why |
|---|---|---|
| **Flow** | Hybrid: UI prototype (Fase A) → backend rebuild (Fase B) | User pilih lihat visual progress dulu sebelum backend |
| **Scope** | Full Phase 1 per PRD (semua fitur) | User mau end-to-end working |
| **Pace** | 5 jam/hari | Aggressive, on track |
| **Mode** | **Offline-only** | No `git push`, no deploy, no external publishing. Memory: `feedback_offline_only_mode` |
| **POS layout** | Single-page 3-col (sidebar/menu/order) | User explicit request M5 polish — "tidak pindah-pindah halaman" |
| **Admin layout** | Single-page sidebar + section tabs | Same pattern as POS, user request M6 |
| **Menu count** | 43 items (bukan 45 yang ada di PRD) | `docs/04-MENU-DATA.md` detail data shows 43; flagged for owner confirm at M8 |

### 1.3 Decisions yang masih PENDING (Critical, butuh jawaban user di milestone tertentu)

| ID | Question | Needed by |
|---|---|---|
| C1 | Dependency version lock strategy: pin current vs allow updates? | M8 |
| C2 | Session duration: A (Staff 12h, Owner/Manager 2h) vs B vs C? | M9 |
| C3 | Receipt image storage: Vercel Blob vs base64 vs skip Phase 1? | M13 |
| C4 | Staff seed strategy: A (1 test staff) vs B (Owner creates manually) vs C (hardcoded 2 staff)? | M9 |
| C5 | PIN policy: A (4-6 digit basic) vs B (min 6 + complexity) vs C (4 fixed)? | M9 |
| C6 | Sold-out broadcast: SSE vs polling vs postpone? | M11/M12 |
| C7 | Production domain | M19 — likely irrelevant due to offline-only |

User belum jawab C1-C7. Pas masuk milestone yang butuh, **stop dan tanya** pakai format `docs/99-EXECUTION-PLAN.md §4.1`.

---

## 2. Architecture Overview

### 2.1 Single-page apps

User explicitly minta gak pindah-pindah halaman. Implementasi:

```
/pos        → PosShell (3-col: TabNav | Menu/Riwayat/Shift | Cart/Pay/Paid)
/dashboard  → AdminShell (Sidebar + 7 sections: Dashboard, Menu, Staff,
                         Shifts, Kas, Laporan, Settings)
```

State machine in client. URL never changes during normal use.

### 2.2 Routes (6 total)

```
/                  showcase/landing dengan Mahakan logo + login buttons
/login             email+password form (Owner/Manager)
/pin               staff avatar grid + PIN pad (semua role)
/dashboard         AdminShell (Owner/Manager only)
/pos               PosShell (semua role)
/_not-found        Next.js default 404
```

### 2.3 Tech stack (per package.json)

**Production deps (24):**
- next 16.2.4 (App Router, Turbopack)
- react 19.2.4 + react-dom 19.2.4
- drizzle-orm 0.45.2, @neondatabase/serverless 1.1.0, postgres 3.4.9
- next-auth 5.0.0-beta.31 (⚠️ beta), @auth/drizzle-adapter 1.11.2, bcryptjs 3.0.3
- @serwist/next 9.5.7, serwist 9.5.7 (PWA, untouched yet)
- @tanstack/react-query 5.100.1, @tanstack/react-table 8.21.3
- zustand 5.x (cart store)
- recharts 3.8.1 (admin charts)
- sonner 1.x (toasts)
- dexie 4.4.2 (IndexedDB offline queue, untouched yet)
- jspdf 4.2.1 (PDF export, untouched yet)
- lucide-react, date-fns + date-fns-tz, nanoid, clsx, tailwind-merge, zod 4

**Dev deps:**
- vitest 4.1.5 + @vitest/coverage-v8 + @testing-library/react
- typescript 5, eslint 9 + eslint-config-next 16.2.4
- tailwindcss 4 + @tailwindcss/postcss
- drizzle-kit 0.31.10 (devDep)
- tsx 4.21.0 (run TS scripts)

### 2.4 Hard rules (per AGENTS.md)

**JANGAN langgar:**
- Money = integer rupiah (semua via `src/lib/money.ts`)
- No `any` di TypeScript (strict mode)
- Server-side validation always (will apply at Fase B)
- RBAC at server layer (Fase B)
- Audit log untuk action sensitive (Fase B)
- API versioning `/api/v1/...` (Fase B)
- Setiap table punya `outlet_id`, `created_at`, `updated_at`, `deleted_at`
- Phase 1 scope only — gak ada KDS, gak ada split payment, gak ada recipe/BOM, dll (lihat PRD §1.4)

---

## 3. File Structure Map

### 3.1 Top-level

```
mahakan-pos/
├── src/
│   ├── app/
│   │   ├── layout.tsx           # root: SessionProvider + Toaster + lang="id" + Inter+JetBrains
│   │   ├── page.tsx             # showcase landing
│   │   ├── globals.css          # Tailwind v4 @theme + Mahakan palette + shake animation
│   │   ├── (auth)/
│   │   │   ├── layout.tsx       # centered logo shell
│   │   │   ├── login/page.tsx   # email+password
│   │   │   └── pin/page.tsx     # avatar selector + PIN pad
│   │   ├── (admin)/
│   │   │   ├── layout.tsx       # auth guard owner/manager + slim header
│   │   │   └── dashboard/page.tsx  # → renders <AdminShell />
│   │   └── (pos)/
│   │       ├── layout.tsx       # auth guard all roles + slim header
│   │       └── pos/page.tsx     # → renders <PosShell />
│   ├── features/
│   │   ├── auth/
│   │   │   ├── SessionProvider.tsx   # React Context, useSession hook
│   │   │   ├── RequireAuth.tsx       # role-gated wrapper
│   │   │   └── StaffAvatarGrid.tsx
│   │   ├── pos/
│   │   │   ├── PosShell.tsx          # main 3-col POS (large file)
│   │   │   ├── cartStore.ts          # Zustand cart store w/ multi-draft
│   │   │   ├── types.ts              # CartLineItem, Draft
│   │   │   └── components/
│   │   │       ├── PosLeftNav.tsx
│   │   │       ├── MenuTile.tsx, CategoryTabs.tsx
│   │   │       ├── CartLineItem.tsx
│   │   │       ├── ItemModifierModal.tsx, OpenPriceModal.tsx
│   │   │       ├── ItemNoteModal.tsx, NewOrderModal.tsx
│   │   │       ├── DiscountModal.tsx
│   │   │       ├── ApproverOverrideModal.tsx
│   │   │       ├── HistoryPanel.tsx, HistoryDetailModal.tsx
│   │   │       ├── ShiftPanel.tsx
│   │   │       └── OpenShiftModal.tsx, CloseShiftModal.tsx
│   │   └── admin/
│   │       ├── AdminShell.tsx        # main sidebar + section content
│   │       ├── components/
│   │       │   └── AdminLeftNav.tsx
│   │       └── sections/
│   │           ├── DashboardHome.tsx       # stat cards + recharts hourly
│   │           ├── MenuSection.tsx
│   │           │   └── menu/{ItemsList,MenuItemFormModal,CategoriesList,ModifiersConfig}.tsx
│   │           ├── StaffSection.tsx
│   │           │   └── staff/{UserFormModal,ResetPinModal}.tsx
│   │           ├── ShiftsSection.tsx
│   │           │   └── shifts/ShiftDetailModal.tsx
│   │           ├── CashSection.tsx
│   │           │   └── cash/{ExpensesList,ExpenseFormModal,IncomesList,IncomeFormModal,DailySummary}.tsx
│   │           ├── ReportsSection.tsx
│   │           │   └── reports/{DailySalesView,ItemPerformanceView,PnlView}.tsx
│   │           ├── SettingsSection.tsx     # read-only display
│   │           └── SectionStub.tsx         # unused now (kept for future)
│   ├── components/ui/                # base components — barrel at index.ts
│   │   ├── Button.tsx, Input.tsx, Card.tsx, Modal.tsx
│   │   ├── Badge.tsx, Toast.tsx, Spinner.tsx
│   │   ├── PinPad.tsx, QuantityStepper.tsx
│   │   └── index.ts
│   ├── lib/
│   │   ├── money.ts          # integer arithmetic + banker's rounding (100% cov, 60 tests)
│   │   ├── format.ts         # Indonesian Rp + DD/MM/YYYY
│   │   ├── date.ts           # WIB timezone helpers
│   │   └── utils.ts          # cn() helper (clsx + tailwind-merge)
│   └── mocks/
│       ├── types.ts          # mirror DB schema TSD §4
│       ├── data.ts           # 1 outlet, 4 users, 11 cat, 43 items, 4 modifiers,
│       │                     #   9 expense cat, 3 shifts, 5 transactions, 3 expenses, 1 income
│       └── services/
│           ├── _helpers.ts   # delay(), ok/fail envelope, genId, genTransactionNumber
│           ├── menuService.ts        # list + full CRUD + reorder
│           ├── authService.ts        # login email+pass, login PIN, verifyApprover, listPinUsers, listApprovers
│           ├── transactionService.ts # create (full validation), void, refund (auto-expense), markServed
│           ├── shiftService.ts       # getActive, open (1-per-user), close
│           ├── expenseService.ts     # CRUD expenses + incomes + dailyCashSummary
│           ├── reportService.ts      # daily sales, range, item performance, P&L, shift report
│           ├── userService.ts        # list (viewer-role filter), createStaff/Manager, updateUser, resetPin, deactivate
│           └── index.ts              # barrel
├── tests/unit/money.test.ts   # 60 tests, 100% coverage on money.ts
├── docs/                       # 12 files
│   ├── 00-README.md            # docs index
│   ├── 01-PRD.md               # product requirements
│   ├── 02-FSD.md               # functional specs
│   ├── 03-TSD.md               # technical specs
│   ├── 04-MENU-DATA.md         # 43 SKU seed data (PRD says 45 — discrepancy flagged)
│   ├── 05-ROLES-RBAC.md        # permission matrix
│   ├── 06-DATABASE-SCHEMA.md   # ERD
│   ├── 07-UI-DESIGN-SYSTEM.md  # design tokens
│   ├── 08-API-SPEC.md          # endpoint contracts (Fase B target)
│   ├── 09-TESTING-STRATEGY.md  # test plan
│   ├── 99-EXECUTION-PLAN.md    # roadmap M0-M20
│   ├── 99-LEGACY-SALVAGE-REPORT.md  # verdict full rewrite (already executed)
│   └── 99-HANDOVER-SESSION-2.md     # this file
├── public/assets/logo/         # 3 logo variants
├── PROGRESS.md                 # milestone tracker
├── HANDOVER.md                 # original Sesi 1 handover (rules + escalation)
├── AGENTS.md                   # rules for AI agents
├── README.md                   # quickstart
├── .env.local                  # gitignored, user filled at M1
├── .env.example                # template
├── package.json, tsconfig.json, eslint.config.mjs, vitest.config.ts
└── drizzle.config.ts           # NOT YET CREATED — M8 will add
```

### 3.2 Yang BELUM ada (akan dibuat di Fase B)

```
src/db/                # M8 will create — Drizzle schemas
src/db/schema/         # outlets, users, categories, menu_items, modifiers,
                       #   shifts, transactions, transaction_items,
                       #   transaction_item_modifiers, expense_categories,
                       #   expenses, incomes, audit_logs
src/db/seed.ts         # M8 — replace mocks/data.ts logic
src/lib/auth/          # M9 — Auth.js v5 config + RBAC helper
src/middleware.ts      # M9 — route-level protection
src/app/api/v1/        # Fase B — REST endpoints
src/lib/printer/       # M16 — Web Bluetooth + ESC/POS
src/lib/offline/       # M17 — IndexedDB queue + sync
drizzle/migrations/    # M8 — generated SQL
```

---

## 4. Test Credentials & Verification

### 4.1 Mock test users

Plaintext PINs/passwords (mock only — Fase B akan bcrypt):

| Role | Email | Password | PIN |
|---|---|---|---|
| Owner | `rama.activity98@gmail.com` | `Owner1234!` | `1234` |
| Manager | `siti@mahakan.id` | `Manager1234!` | `2345` |
| Staff Rina | — | — | `5678` |
| Staff Budi | — | — | `5679` |

Source: `src/mocks/data.ts` lines ~78-130.

### 4.2 Verification commands

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN

# Type check (should be clean)
npm run typecheck

# Lint (should be clean)
npm run lint

# Build (6 routes)
npm run build

# Tests (60/60 should pass)
npx vitest run

# Dev server
npm run dev
# Then open http://localhost:3000
```

### 4.3 Manual smoke test (~5 menit)

1. `npm run dev` → buka `http://localhost:3000`
2. **Showcase** — klik "Coba Login" → login Owner Rama → redirect `/dashboard`
3. **Admin** — sidebar 7 sections, click each:
   - Dashboard → liat stat cards + chart
   - Menu → 3 sub-tabs, coba tambah item baru
   - Staff → tambah Staff dummy + reset PIN
   - Shifts → liat detail modal salah satu shift
   - Kas → coba "Tambah Pengeluaran"
   - Laporan → 3 sub-tabs (P&L visible karena Owner)
   - Settings → read-only display
4. Logout → `/login` → klik "Login dengan PIN" → `/pin`
5. **POS** — login Staff Rina (PIN 5678) → redirect `/pos`
6. Tab Shift → buka shift Rp 100k → Order Baru pager 5 → tambah item dengan modifier → bayar Tunai → success → Selesai
7. Tab Riwayat → liat transaksi → tambahin void via Owner approver PIN

Kalau semua ini smooth, state aman.

---

## 5. Memory & Context Pointers

### 5.1 Auto-loaded memory (di `MEMORY.md` agent)

```
- git-rebase-abort-caveat   — git rebase --abort warning
- week1-day1-status         — Foundation done 2026-04-24
- pause-before-destructive  — User wants explicit approval for destructive ops
- pat-handling-preference   — User pushes themselves; never paste PAT
- tsd-version-lock-pending  — Deps newer than TSD spec (decided: deferred to M8)
- offline-only-dev-mode     — No push, no deploy until user explicitly asks
```

### 5.2 Critical files to (re-)read before starting

1. `docs/99-EXECUTION-PLAN.md` — full roadmap (M0-M20) + open questions
2. `docs/99-LEGACY-SALVAGE-REPORT.md` — verdict full rewrite (already done)
3. `AGENTS.md` — hard rules + tech stack lock
4. `HANDOVER.md` (Sesi 1 original) — workflow rules + escalation patterns + DO/DON'T list
5. `PROGRESS.md` — current milestone tracker
6. **This file** (`docs/99-HANDOVER-SESSION-2.md`) — session 2 entry point

### 5.3 Pattern user prefers (gleaned from Sesi 1)

- **Communicate dengan bahasa sederhana** — User bukan developer
- **Break task jadi potongan kecil** — Multi-chunk commits, not one giant
- **Eksplisit tentang yang lo kerjain vs yang user kerjain**
- **Visual indicator progress** — pakai checkboxes/emoji buat ringkasan
- **Self-verify sebelum klaim "done"** — Selalu run typecheck + lint + build + tests
- **Commit setiap milestone** — format `feat(mN): description` atau `feat(mN.x): ...`
- **Confirm before destructive ops** — even when auto mode active
- **Auto mode active currently** — user said "lanjut" / "M5 OK" → continue without asking permission for routine work
- **5-menit smoke test scenarios** — Setelah commit, kasih user steps test di browser
- **Indonesian/English mix in chat** — code English, UI Indonesian, casual chat mixed

---

## 6. Next Steps — Execution Plan

### 6.1 M7 — UI Review & Polish (Fase A wrap-up) — ~2 days

Per `docs/99-EXECUTION-PLAN.md §3 Milestone M7`:

**Deliverables:**
- Fix all UI feedback dari user dari M4/M5/M6 checkpoints
- **Responsive testing** — tablet landscape (primary), phone portrait, desktop
- **Empty states** untuk semua list pages — banyak udah ada, audit & polish
- **Loading skeletons** untuk semua async UI — sekarang pakai Spinner, replace dengan skeleton shimmer untuk better UX
- **Error boundaries** (`error.tsx`) di tiap route group: `(auth)`, `(admin)`, `(pos)`
- **Accessibility audit** — keyboard nav, aria-labels, focus visible (sebagian sudah, audit final)
- **Lighthouse check** — performance baseline, target >90 untuk `/pos` di tablet viewport
- **Visual final pass** — consistency check di semua section

**User checkpoint:**
- ⏳ Final Fase A approval — user explicitly OK untuk start Fase B (M8)

**Suggested chunks:**
- M7.1: error boundaries + empty states audit
- M7.2: loading skeletons (replace Spinner di list views)
- M7.3: a11y pass + responsive QA
- M7.4: final visual polish + cleanup unused (e.g., SectionStub kalau gak dipakai)

**🎯 Setelah M7: Fase A complete.** User dapet full visual prototype yang bisa di-demo-in.

### 6.2 Fase B — Backend rebuild (M8-M20)

Per execution plan §3, urutan mandatory:

| M | What | Risk | Notes |
|---|---|---|---|
| **M8** | DB schema + seed (Drizzle + Neon, generate + apply migration) | Med | Resolve C1 (deps lock); confirm 43 vs 45 menu count with owner |
| **M9** | Auth backend (Auth.js v5) | **HIGH** | Beta volatile; use Context7 MCP; resolve C2/C4/C5 first |
| M10 | Menu CRUD backend + rewire UI (replace mock service imports) | Med | Pattern: feature folder, Server Actions |
| **M11** | POS core backend (createTransaction with full server validation) | **CRITICAL** | Most important; reuse `src/lib/money.ts` logic; idempotency via clientRefId; integration tests mandatory |
| M12 | Shift backend + rewire | Med | |
| M13 | Expense/income backend + rewire + image upload | Med | Resolve C3 |
| M14 | Reports backend + rewire (aggregate queries + PDF export) | Med | jspdf already installed |
| M15 | Void/refund/discount with PIN override (single-use JWT) | Med | |
| M16 | Thermal printer (Web Bluetooth + ESC/POS RPP02) | **HIGH** | Hardware test required; user has Android tablet ready |
| M17 | PWA + offline (Serwist + Dexie IndexedDB queue) | High | Untested combo |
| M18 | Testing pass — fill gaps to 80% coverage | Low-Med | |
| M19 | Deploy to Vercel | — | **DEFERRED** under offline-only mode unless user explicitly asks |
| M20 | Soft launch support | — | |

### 6.3 Pattern: Fase B mock → backend swap

Semua UI consumer di Fase A ngambil dari `@/mocks/services`. Strategy Fase B:

```typescript
// Fase A:
import { menuService } from "@/mocks/services";
const res = await menuService.listMenuItems();

// Fase B (after M10):
import { listMenuItems } from "@/features/menu/queries"; // Server Action
const items = await listMenuItems();
```

Find-replace pattern. Service interfaces sudah dirancang match future Server Action signatures.

---

## 7. Known Issues / Tech Debt

### 7.1 Active warnings (low priority)

```
4 npm audit moderate vulnerabilities
```
Plan resolves at M18 testing pass.

### 7.2 Pre-existing modifications (untouched per user direction)

`AGENTS.md`, `docs/00-README.md`, `docs/03-TSD.md` masih punya uncommitted changes dari sesi sebelum lo. User bilang "biarkan dulu" — kemungkinan related Next.js 15→16 version sync. Memory `tsd-version-lock-pending` track this.

Action saat M8: tanya user mau bundle commits ini atau discard.

### 7.3 Doc inconsistency

PRD §1.4/§2.2 nyebut **45 SKU**, tapi `docs/04-MENU-DATA.md` detail data lists **43 items**. Mock data pakai 43 (faithful to detail). **Confirm dengan owner saat M8** seed work.

### 7.4 `note` file recurring

User's IDE keeps re-creating empty file `note` di root. Each commit step gua skip — gak destructive but annoying. Don't commit it accidentally.

### 7.5 React 19 ESLint rule

`react-hooks/set-state-in-effect` rule strict. Beberapa pattern legitimate (init from external async source, sync from props on modal open) butuh `eslint-disable-next-line`. Sudah scattered di:
- `src/features/auth/SessionProvider.tsx`
- Modal components (DiscountModal, OpenPriceModal, ItemNoteModal, ApproverOverrideModal, ItemModifierModal)
- Form modals di admin sections

Pattern: disable comment + reason in comment. Don't fight the rule globally.

### 7.6 Lighthouse + perf untouched

Belum lighthouse-test apapun. Address di M7.

---

## 8. How to Resume — Next Session Start

### 8.1 Boot prompt suggestion (kasih ke AI agent baru)

```
Halo, gua mau lanjut Mahakan POS. Sesi sebelumnya udah panjang.
Baca handover di `docs/99-HANDOVER-SESSION-2.md` dulu sampai habis.
Setelah itu, baca AGENTS.md + HANDOVER.md + 99-EXECUTION-PLAN.md.
Verify state via npm run typecheck + lint + build + vitest.
Kalau semua green, kasih ringkasan status + tanya: lanjut M7?
```

### 8.2 Context loading order untuk AI agent

1. **MEMORY.md** (auto-loaded) — base context
2. **This file** — session 2 entry, all you need to know
3. **PROGRESS.md** — milestone tracker
4. **docs/99-EXECUTION-PLAN.md** — full roadmap detail
5. **AGENTS.md** — hard rules
6. (Optional) **HANDOVER.md** original — workflow + escalation patterns

### 8.3 Before any edit

```bash
git -C /Users/macbookpro/Desktop/POS-ERP-MAHAKAN log --oneline | head -10
git -C /Users/macbookpro/Desktop/POS-ERP-MAHAKAN status
```

Verify lo melihat 17 commits ending in `1d2246c docs(m6): mark M6 complete`. Kalau gak match, ada yang berubah outside session — re-baseline.

### 8.4 First action

Tanya user: **"M6 udah ke-test full di browser? Kalau OK, lanjut M7? Kalau ada feedback dari M6, kasih sekarang biar bisa di-include di polish."**

Jangan asumsi user sudah test M6 (sesi sebelumnya gua belum dapet konfirmasi "M6 OK" sebelum dia minta handover). Bisa jadi ada bug yang user catat tapi belum lapor.

---

## 9. Commit History Reference

```
1d2246c docs(m6): mark M6 complete in PROGRESS.md
667abb5 feat(m6.5+6.6): Reports + Settings sections — M6 complete
bc719af feat(m6.4): admin Cash & Expense section
d665c4e feat(m6.3): admin Staff + Shifts sections
d43b094 feat(m6.2): admin Menu Management section
32f08ac feat(m6.1): single-page admin shell + dashboard home
21e458b refactor(m5): single-page 3-column POS shell
0f63727 fix(m5): correct modifier coverage + consolidate POS into single page
cfac92d fix(m5): avoid useSyncExternalStore infinite loop on dashboard
499cafd fix(m5): PIN login surfaces all PIN-capable users (incl. staff)
3147c78 feat(m5): POS UI prototype — full order, payment, history flow
c0a0941 feat(m4): auth UI prototype — login, PIN, protected route shells
d14ca7f feat(m3): mock data layer — types, seed, fake services
5f00779 chore(cleanup): delete _legacy prototype + scrub config references
31eabb6 feat(m2): design system foundation + base UI components
e1e9e7f docs(m1): log M1 completion — Neon DB connection verified
48a4111 chore(m0): housekeeping & environment scaffolding
7fcced2 chore: remove redundant CLAUDE.md
0c47b18 feat(foundation): scaffold Next.js 15 + Tailwind v4 + TS strict
... (older commits before this session)
```

All local. Origin/main is stale (per offline-only mode). Pushing requires user explicit OK.

---

## 10. Important Reminders

### 10.1 Don't

- ❌ **Don't push** to origin (offline-only mode)
- ❌ **Don't deploy** to Vercel
- ❌ **Don't commit** the `note` file (recurring empty file)
- ❌ **Don't bundle** pre-existing AGENTS.md / docs/00 / docs/03 modifications without asking
- ❌ **Don't use** `any` in TypeScript
- ❌ **Don't introduce** float math for money — use `src/lib/money.ts`
- ❌ **Don't skip** server-side validation when Fase B starts (M8+)
- ❌ **Don't add** features outside Phase 1 scope (no KDS, no split payment, no recipe/BOM, etc.)

### 10.2 Do

- ✅ **Verify** typecheck + lint + build + tests before every commit
- ✅ **Commit per milestone or sub-chunk** (atomic, focused)
- ✅ **Use Context7 MCP** sebelum implement Auth.js v5 / Drizzle / Next.js 16 / Serwist (training data may be outdated)
- ✅ **Ask user** for business decisions (C1-C7) when entering relevant milestone
- ✅ **Test in browser** after major changes (kalau possible)
- ✅ **Keep PROGRESS.md updated** as you complete milestones
- ✅ **Communicate progress** dengan ringkasan visual (✓/⏳/⚠️) di chat

### 10.3 Blockers

- M9 (Auth.js v5): blocked sampai user jawab C2/C4/C5
- M16 (Printer): blocked sampai user pair tablet + RPP02 (hardware test)
- M19 (Deploy): blocked sampai user explicitly OK push + deploy

---

## 11. Final Status Snapshot

```
Date:        2026-04-25
Branch:      main (local)
Commits:     17 ahead of origin (offline-only)
Build:       ✓ 6 routes, no warnings
Tests:       ✓ 60/60 (money.ts 100% coverage)
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no `any`

Phase 1 progress: M0 ✓ M1 ✓ M2 ✓ M3 ✓ M4 ✓ M5 ✓ M6 ✓
Fase A:           6/7 milestones (M7 polish remaining)
Fase B:           0/13 milestones (starts M8 after Fase A wrap-up)

Mock data seeded:
- 1 outlet (Mahakan Coffee & Space, Cisarua)
- 4 users (1 Owner, 1 Manager, 2 Staff)
- 11 categories
- 43 menu items
- 4 modifiers
- 9 expense categories (8 regular + 1 system Refund)
- 3 shifts (1 active, 2 closed)
- 5 transactions (mixed paid/voided/refunded)
- 3 expenses (1 auto-refund) + 1 income

Dependencies: 24 prod + 13 dev. All Phase 1 deps installed; no
missing packages until M8 (which already has drizzle-kit ready).

Next action: Tanya user — "M6 OK? Lanjut M7?"
```

---

## 12. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-25 | Initial handover for sesi baru — captures M0-M6 state |

---

# 🛑 END HANDOVER

**Selamat melanjutkan, AI agent baru. Lo punya semua context untuk bantu Rama lanjutin Mahakan POS. Mulai dari `docs/99-EXECUTION-PLAN.md §3 M7` setelah konfirmasi user.**
