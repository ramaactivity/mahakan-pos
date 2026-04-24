# 🗺️ Mahakan POS — Execution Plan

**Document:** Execution Plan & Roadmap Phase 1
**Version:** 1.0
**Date:** 2026-04-24
**Author:** AI Agent (analysis-only session)
**Status:** 📋 Awaiting Owner approval
**Depends on:** `01-PRD.md`, `02-FSD.md`, `03-TSD.md`, `05-ROLES-RBAC.md`, `06-DATABASE-SCHEMA.md`, `07-UI-DESIGN-SYSTEM.md`, `08-API-SPEC.md`, `09-TESTING-STRATEGY.md`, `HANDOVER.md`, `AGENTS.md`

**User's locked-in decisions (via clarification):**
1. **Flow:** Hybrid — UI Prototype dulu (mock data), lalu Rebuild dengan backend terintegrasi
2. **Scope:** Full Phase 1 per PRD (semua fitur di `01-PRD.md §4`)
3. **Pace:** 5 jam/hari user bandwidth (agresif; review + test + business decisions)

---

## 1. Current State Assessment

### 1.1 Apa yang udah selesai ✅

Diverifikasi via `git log`, `package.json`, `ls src/`:

| Area | Status | Evidence |
|---|---|---|
| Dokumentasi Phase 1 (10 file) | ✅ Complete & self-consistent | `docs/00-09` |
| Brand assets (3 varian logo) | ✅ Placed | `public/assets/logo/` |
| GitHub repo private | ✅ | `ramaactivity/mahakan-pos` |
| Neon Postgres project | ✅ | Region Singapore (per HANDOVER) |
| Vercel account | ✅ | Ready, belum connect |
| Next.js 16.2.4 scaffold | ✅ | Commit `0c47b18` |
| TypeScript strict mode | ✅ | `tsconfig.json` |
| Tailwind v4 | ✅ | `@tailwindcss/postcss` di devDeps |
| Turbopack dev | ✅ | `package.json` scripts |
| Phase 1 dependencies | ✅ | Semua installed (lihat §1.3) |
| Git identity configured | ✅ | User: `ramaactivity` |
| AGENTS.md + HANDOVER.md | ✅ | Ter-commit |
| 6 commits baseline | ✅ | Clean history |

### 1.2 Apa yang masih missing ⏳

Diverifikasi via `find src/` dan `ls root/`:

| Area | Missing | Impact |
|---|---|---|
| `.env.local` file | Belum ada | Blocker untuk M1+ |
| `drizzle.config.ts` | Belum ada | Blocker untuk DB migration |
| `src/db/` (schemas, seed, connection) | Kosong | Blocker untuk M8+ |
| `src/features/` (feature modules) | Kosong | Main app logic |
| `src/components/` (UI library) | Kosong | Foundation Fase A |
| `src/lib/` (money, format, auth, rbac, utils) | Kosong | Foundation Fase A |
| `src/middleware.ts` | Kosong | Blocker untuk RBAC |
| `tests/` folder | Kosong | Testing infrastructure |
| `vitest.config.ts` | Belum ada | Testing setup |
| Seed script | Belum ada | 45 SKU + seed owner |
| Auth.js v5 config | Belum ada | Login flow |
| Serwist PWA config | Belum ada | PWA + offline |

### 1.3 Dependencies audit

Dari `package.json` — semua dependency Phase 1 sudah **installed** (tidak perlu `npm install` tambahan kecuali ada missing yang terdeteksi nanti):

**Production deps (22):**
```
next 16.2.4, react 19.2.4, react-dom 19.2.4
drizzle-orm 0.45.2, drizzle-kit 0.31.10 (devDep), @neondatabase/serverless 1.1.0, postgres 3.4.9
next-auth 5.0.0-beta.31, @auth/drizzle-adapter 1.11.2, bcryptjs 3.0.3
@serwist/next 9.5.7, serwist 9.5.7
@tanstack/react-query 5.100.1, @tanstack/react-table 8.21.3
dexie 4.4.2 (IndexedDB offline queue)
jspdf 4.2.1 (PDF export reports)
lucide-react 1.9.0 (icon library)
nanoid 5.1.9, clsx 2.1.1, tailwind-merge 3.5.0
date-fns 4.1.0, date-fns-tz 3.2.0
recharts 3.8.1 (charts)
zod 4.3.6
```

**Dev deps (13):**
```
vitest 4.1.5, @testing-library/react 16.3.2, tsx 4.21.0
typescript 5, eslint 9 + eslint-config-next 16.2.4
tailwindcss 4, @tailwindcss/postcss 4
@types/node 20, @types/react 19, @types/react-dom 19, @types/bcryptjs 2.4.6
```

**Assessment:** Stack Phase 1 sudah lengkap. Gak ada missing major dep. TestSprite belum ada (tapi per `09-TESTING-STRATEGY.md` itu tool eksternal, bukan npm package — E2E bisa ditunda atau diganti Playwright).

### 1.4 Technical debt & inconsistencies yang gua spot

**Diurutkan by severity:**

1. **[HIGH] Commit message vs actual version mismatch.** Commit `0c47b18` titled "feat(foundation): scaffold Next.js 15 + Tailwind v4 + TS strict" tapi `package.json` shows `next: 16.2.4`. Git history misleading. Bukan bug, tapi confusing. Sudah ter-flag di `docs/00-README.md` changelog v1.2. **Action:** tidak perlu fix, tapi future commit harus akurat.

2. **[HIGH] TSD section 2.1 vs actual deps version drift.** TSD draft originally documented Next.js 15, sekarang actual 16.2.4. Per memory `tsd-version-lock-pending`, keputusan pin vs latest masih open. **Action:** Confirm ke user via Critical Decision C1 (§4.1).

3. **[MEDIUM] Auth.js v5 beta.31 unstable.** Released < 6 bulan, breaking changes possible. `AGENTS.md §Library Versions` explicitly warn. **Action:** MUST verify via Context7 MCP sebelum M9 implementation.

4. **[MEDIUM] Next.js 16 `middleware.ts` deprecation warning.** Per AGENTS.md note, akan jadi `proxy.ts` di Next 17/18. Phase 1 keep pakai `middleware.ts` (Auth.js v5 compat). **Action:** document di code comment, plan migration kalau user commit ke Next 17 setelah launch.

5. **[MEDIUM] Zod v4 API changes.** `z.string().email()` deprecated → `z.email()` (per AGENTS.md). Harus gunakan Zod v4 syntax dari awal. **Action:** semua schema di-write dengan Zod 4 syntax; kalau ada stale training data example di docs pakai v3, override.

6. **[LOW] Empty file `note` di root.** 0 bytes, gak ada use. **Action:** delete di M0.

7. **[LOW] Docs inconsistency — PRD §7 masih menyebut Next.js 15.** Per table `01-PRD.md §7 Technical Constraints`. Bukan blocker, sudah superseded oleh `00-README.md` v1.2 changelog. **Action:** user putusin apakah update PRD atau biarkan (historical record).

8. **[LOW] `docs/01-PRD.md §10 Timeline` says 8-10 minggu** — ini optimistic estimate sebelum user pilih Hybrid flow + Full scope. **Action:** superseded by §6 document ini (10-14 minggu).

### 1.5 Doc-level risks (ambiguity/contradiction) yang di-flag

Baca ulang semua docs, gua temuin:

1. **RBAC ambiguity — Staff un-sold-out permission.** `05-ROLES-RBAC.md §3 table` bilang Staff "Mark Available" = ❌. Tapi `09-TESTING-STRATEGY.md` test RBAC-012 test flow yang sama. Consistent. ✅ (Just confirming no contradiction.)

2. **Discount approver — staff initiate butuh approver.** Per `05-RBAC §3` + `API-SPEC §4.1`, staff butuh `discountApproverToken` kalau apply discount. UI flow ada di `02-FSD §3`. Consistent.

3. **Refund same-day only.** Per PRD `P1-POS-010` + API SPEC §4.5 error `REFUND_NOT_ALLOWED_PAST_DAY`. Consistent.

4. **Transaction idempotency — `clientRefId` UUID.** Per schema `06-DATABASE-SCHEMA.md §3.7` kolom `client_ref_id uuid UNIQUE`. Consistent.

5. **Shift variance threshold Rp 10.000.** Per PRD §12 item 7 + TSD settings. Consistent.

6. **Web Bluetooth platform limitation.** Dok konsisten — hanya Chrome/Edge Android. iPad Safari gak support (PRD §6.2, UI DESIGN §2.1). **Risk:** user test di tablet wrong browser → waste time. Mitigasi di M16 step-1 (install Chrome).

7. **SSE vs polling for sold-out broadcast.** Per API SPEC §10.1, SSE primary dengan polling fallback. Vercel free tier timeout 60s = SSE akan reconnect every ~50s. Per real-world Vercel experience, SSE at edge can work but unreliable. **Plan:** implement SSE + polling fallback at M11 atau M12.

8. **Menu price validation.** PRD menu data vs FSD validation — harga Rp 1.000-999.999.999 range. Ada batasan di `06-DB-SCHEMA §3.4`. Consistent.

**No major contradictions found.** Docs robust. 👍

---

## 2. Scope Clarification

### 2.1 Full Phase 1 scope (per PRD §4) — CONFIRMED by user

Modul yang wajib dibuild di Phase 1:

| Modul | Features | Ref |
|---|---|---|
| **POS** | New order, menu grid, variants, modifiers, open-price (Manual Brew), cart, item notes, discount (percent/fixed), payment (cash/QRIS/card), receipt print, reprint, void, refund, sold-out toggle, order queue, multi-draft, offline resilience | PRD §4.1 (14 features) |
| **Menu Mgmt** | CRUD items, CRUD categories, modifier price edit, bulk actions, export CSV | PRD §4.2 (4 features) |
| **Shift** | Open shift, close shift with variance, shift history | PRD §4.3 (3 features) |
| **Cash/Expense** | Expense logging (9 categories + upload receipt), income logging, daily cash summary | PRD §4.4 (3 features) |
| **Reports** | Daily sales, weekly/monthly, item performance, Simple P&L (Owner), shift report | PRD §4.5 (5 features) |
| **User Mgmt** | User CRUD, PIN reset | PRD §4.6 (2 features) |
| **Settings** | Business info, printer config, operational hours | PRD §4.7 (3 features) |
| **Auth+RBAC** | Email+password Owner/Manager, PIN Staff, 3-role matrix, PIN override supervisor approval | TSD §6 |
| **PWA** | Installable, offline shell, service worker via Serwist | TSD §11 |
| **Hardware** | Thermal printer RPP02 Bluetooth ESC/POS 58mm | TSD §8 |

Total: **~34 feature units** across 9 modules.

### 2.2 Ultra-MVP alternative (referensi saja, untuk fallback §8)

Kalau di tengah jalan Full scope terlalu berat, rekomendasi narrow ke:

**Ultra-MVP (4-5 minggu):**
- POS cash-only (skip QRIS/card)
- Menu grid dari DB (seed 45 SKU)
- Cart, modifier basic, payment cash, receipt on screen (skip thermal printer)
- Shift open/close sederhana (skip variance detail)
- Owner login (email+password only, skip PIN login for Staff + skip void/refund/discount flows)
- No reports, no expenses, no PWA, no offline, no printer
- Deploy to Vercel

Cukup buat kafe start pakai daily. QRIS/card/printer/reports bisa iterasi Phase 1.5.

### 2.3 Rekomendasi: Full Phase 1 dengan exit criteria

User pilih Full. Setuju, **TAPI** gua mau flag 2 guardrail:

1. **Kalau Week 6 (akhir Fase A + awal Fase B) kita tidak on track** (misal Auth stuck >3 hari, atau POS core >1 minggu), **pause dan tanya:** pivot ke Ultra-MVP, atau extend timeline 2 minggu?
2. **Deploy to Vercel lebih awal** (setelah M11 POS core) — jangan tunggu semua done. Lebih baik production partial yang bisa dipakai daripada perfect-but-not-shipped.

---

## 3. Milestone Breakdown

**Flow: Hybrid**. Re-numbered untuk match hybrid approach, superseding HANDOVER.md M0-M9 numbering.

**Kata kunci:**
- "**Durasi**" = work days estimate realistic, termasuk review cycle dengan user
- "**User checkpoint**" = moment di mana user wajib action
- "**Risk**" = Low/Med/High dengan justifikasi
- "**Success**" = verify command + expected result

### FASE A — UI PROTOTYPE (Week 1-3)

**Goal:** Semua screen Phase 1 visible di browser dengan mock data. User bisa approve UI/UX sebelum backend landing.

---

#### M0 — Housekeeping & Environment Prep
- **Durasi:** 0.5 hari (~3 jam)
- **Dependencies:** None
- **Deliverables:**
  - Delete empty file `note` di root
  - Create `.env.example` dengan placeholder semua env var (per TSD §11.1)
  - Create `.nvmrc` untuk lock Node version (optional)
  - Update `README.md` dengan quickstart instructions (how to run `npm run dev`, `npm test`)
  - Verify `npm run typecheck` + `npm run build` pass on current scaffold
  - Create `PROGRESS.md` (gitignored atau committed, per HANDOVER) untuk track milestone
- **User checkpoints:**
  - ⏳ Review `.env.example` to make sure no secrets leak
- **Risk:** Low — pure housekeeping
- **Success:**
  ```bash
  npm run typecheck  # exit 0
  npm run build      # success, no errors
  ls note            # "No such file"
  cat .env.example   # shows all env vars
  ```

---

#### M1 — Environment Credentials Setup (USER-ASSISTED)
- **Durasi:** 0.5 hari (user action 15 min + my smoke test 30 min)
- **Dependencies:** M0
- **Deliverables:**
  - User fill `.env.local` (instructions per HANDOVER.md §Milestone 1)
  - Smoke test script `scripts/smoke-db.ts` (temporary, to verify Neon connection)
  - Run smoke test, verify DB connects, delete temp script
  - Confirm `.env.local` gitignored
- **User checkpoints:**
  - ⏳ **USER ACTION REQUIRED:** Generate `AUTH_SECRET` via `openssl rand -base64 32`
  - ⏳ **USER ACTION REQUIRED:** Copy `DATABASE_URL` (pooled) dari Neon console
  - ⏳ **USER ACTION REQUIRED:** Choose `SEED_OWNER_PASSWORD` (min 12 char)
- **Risk:** Low — but blocked on user
- **Success:**
  ```bash
  ls -la .env.local                    # file exists
  git check-ignore .env.local          # confirms gitignored
  npx tsx scripts/smoke-db.ts          # prints timestamp from NOW()
  ```

---

#### M2 — Design System Foundation
- **Durasi:** 3 hari
- **Dependencies:** M0
- **Deliverables:**
  - `src/app/globals.css` — Tailwind v4 custom theme dengan Mahakan palette (per `07-UI-DESIGN-SYSTEM.md §3`)
  - `src/app/layout.tsx` — Inter + JetBrains Mono via `next/font/google`, set `<html lang="id">`
  - `src/lib/utils.ts` — `cn()` helper (clsx + twMerge)
  - `src/lib/money.ts` — Full integer arithmetic per TSD §9 + `09-TESTING §3.1` test cases
  - `src/lib/format.ts` — Indonesian formatting (Rp, DD/MM/YYYY, WIB timezone)
  - `src/lib/date.ts` — `toJakartaDate`, `formatIndonesianDate` helpers
  - `src/components/ui/Button.tsx` — 5 variants × 4 sizes (per UI DESIGN §4.1)
  - `src/components/ui/Input.tsx` — dengan label, error, hint, leading/trailing slot
  - `src/components/ui/Card.tsx` — 3 variants (default, interactive, flat, emphasis)
  - `src/components/ui/Modal.tsx` — with focus trap, backdrop, ESC close
  - `src/components/ui/Badge.tsx` — paid/voided/refunded/sold-out/signature/open-price
  - `src/components/ui/Toast.tsx` — wrapper via `sonner` library (install kalau missing)
  - `src/components/ui/PinPad.tsx` — 3×4 grid numeric keypad
  - `src/components/ui/QuantityStepper.tsx` — +/- for cart
  - `src/components/ui/Spinner.tsx`
  - Unit tests untuk `money.ts` (MANDATORY per AGENTS.md + 09-TESTING §3.1)
  - `vitest.config.ts` + `tests/setup.ts`
- **User checkpoints:**
  - ⏳ Screenshot showcase page → user confirms warna sage green + components match design
- **Risk:** Medium — banyak komponen, tapi spec jelas di docs
- **Success:**
  ```bash
  npm run typecheck                           # pass
  npm test tests/unit/money.test.ts           # all pass (100% coverage money.ts)
  npm run dev                                 # browse localhost:3000 (showcase)
  ```

---

#### M3 — Mock Data Layer
- **Durasi:** 1 hari
- **Dependencies:** M2
- **Deliverables:**
  - `src/mocks/types.ts` — TypeScript types mirroring TSD §4 schemas
  - `src/mocks/data.ts` — 45 menu items, 11 categories, 4 modifiers, 3 users (1 owner, 1 manager, 2 staff), 9 expense categories, sample shifts, sample transactions
  - `src/mocks/services/` — Fake service layer yang return promise<T> dengan delay 200-500ms buat simulate network
    - `menuService.ts`, `authService.ts`, `transactionService.ts`, `shiftService.ts`, `expenseService.ts`, `reportService.ts`, `userService.ts`
  - **No DB** di fase ini — semua pure in-memory
  - Abstraksi layer yang kelak diganti real API call di Fase B (same interface, swap implementation)
- **User checkpoints:** None (internal refactor)
- **Risk:** Medium — desain interface yang bagus sangat penting supaya Fase B swap minim friction
- **Success:** Services ready to be consumed by page components di M4+

---

#### M4 — Auth UI Prototype
- **Durasi:** 1.5 hari
- **Dependencies:** M2, M3
- **Deliverables:**
  - `src/app/(auth)/login/page.tsx` — email+password form (Owner/Manager login)
  - `src/app/(auth)/pin/page.tsx` — PIN pad flow with staff avatar selector (Staff login)
  - `src/app/(auth)/layout.tsx` — auth layout dengan Mahakan logo centered
  - Mock auth: cek email/pass atau PIN vs `mocks/data.ts`, store "session" di cookie/localStorage temporarily
  - `src/components/auth/AuthLayout.tsx`, `StaffAvatarGrid.tsx`
  - Loading states, error states (wrong password/PIN shake animation)
- **User checkpoints:**
  - ⏳ User test login flow di browser (owner + staff PIN)
  - ⏳ Screenshot approval
- **Risk:** Low — UI only, no real auth
- **Success:**
  ```
  1. Navigate /login → see email+pass form, Mahakan logo
  2. Submit wrong credentials → error toast
  3. Submit correct → redirect /dashboard stub
  4. Navigate /pin → see staff grid → tap avatar → PIN pad → submit
  ```

---

#### M5 — POS UI Prototype
- **Durasi:** 4-5 hari
- **Dependencies:** M3, M4
- **Deliverables:**
  - `src/app/(pos)/layout.tsx` — POS shell with top bar (shift status, online indicator, draft counter, logout)
  - `src/app/(pos)/pos/page.tsx` — POS dashboard: "Buka Shift" card, "Order Baru" button, active orders list
  - `src/app/(pos)/pos/order/new/page.tsx` — pager input + order type selector
  - `src/app/(pos)/pos/order/[id]/page.tsx` — active order: menu grid + cart sidebar
    - `src/features/pos/components/MenuGrid.tsx`
    - `src/features/pos/components/CategoryTabs.tsx`
    - `src/features/pos/components/MenuTile.tsx`
    - `src/features/pos/components/Cart.tsx`
    - `src/features/pos/components/CartLineItem.tsx`
    - `src/features/pos/components/ItemModifierModal.tsx`
    - `src/features/pos/components/OpenPriceModal.tsx` (Manual Brew)
    - `src/features/pos/components/ItemNoteModal.tsx`
  - `src/app/(pos)/pos/order/[id]/payment/page.tsx` — payment screen: order summary, method buttons (xl size), cash input with change calc
  - `src/app/(pos)/pos/order/[id]/success/page.tsx` — success screen with "print again" option
  - `src/app/(pos)/pos/history/page.tsx` — today's transactions list
  - `src/app/(pos)/pos/history/[id]/page.tsx` — transaction detail with Void/Refund buttons
  - `src/app/(pos)/pos/shift/close/page.tsx` — close shift with variance calc
  - `src/app/(pos)/pos/shift/open/page.tsx` — open shift with opening cash input
  - `src/features/pos/components/ApproverOverrideModal.tsx` — PIN approval UI
  - `src/features/pos/components/DiscountModal.tsx`
  - State management: React Query + Zustand (optional) untuk cart + draft orders
- **User checkpoints:**
  - ⏳ User test seluruh flow POS di tablet (landscape) + phone (portrait)
  - ⏳ Screenshot semua screen untuk approve
  - ⏳ Tanya: "Ada yang mau diubah dari layout/flow? Sebelum backend landing lebih mudah refactor di stage ini."
- **Risk:** High — complex state, banyak edge case, tablet layout tricky
- **Success:**
  ```
  E2E walkthrough via mock:
  1. Open shift Rp 100.000
  2. Tap "Order Baru", pager 5, takeaway
  3. Tap Americano → pick Iced, sugar Less → add to order
  4. Tap V60 → open price modal → input 35.000, note "Ethiopia" → add
  5. Apply discount 10% via Owner PIN override
  6. Tap Bayar → Tunai → input 100.000 → shows change 49.900
  7. Confirm → success screen → mock receipt display (not printed, just on-screen)
  8. Navigate back to POS → cart empty, order in "active orders" list
  9. Tap order → void dengan reason "test" → status change to voided
  ```

---

#### M6 — Admin UI Prototype
- **Durasi:** 4-5 hari
- **Dependencies:** M3, M4
- **Deliverables:**
  - `src/app/(admin)/layout.tsx` — admin shell dengan sidebar (per UI DESIGN §5.2)
  - `src/app/(admin)/dashboard/page.tsx` — Owner dashboard dengan stat cards + charts (recharts mock data)
  - `src/app/(admin)/menu/items/page.tsx` — data table (via @tanstack/react-table)
  - `src/app/(admin)/menu/items/new/page.tsx` — create form (price type discriminator)
  - `src/app/(admin)/menu/items/[id]/edit/page.tsx`
  - `src/app/(admin)/menu/categories/page.tsx` — drag-reorder list (optional lib: `@dnd-kit`)
  - `src/app/(admin)/menu/modifiers/page.tsx` — config cards
  - `src/app/(admin)/users/page.tsx` — user list with role filters
  - `src/app/(admin)/users/new/page.tsx` — form with role selector
  - `src/app/(admin)/shifts/page.tsx` — shift history with variance flags
  - `src/app/(admin)/shifts/[id]/page.tsx` — shift detail with transaction list
  - `src/app/(admin)/expenses/page.tsx` — expense list + quick filter
  - `src/app/(admin)/expenses/new/page.tsx` — form with image upload (mock only, no storage)
  - `src/app/(admin)/incomes/page.tsx`
  - `src/app/(admin)/reports/sales/page.tsx` — daily sales report with charts
  - `src/app/(admin)/reports/items/page.tsx` — item performance sortable table
  - `src/app/(admin)/reports/pnl/page.tsx` — Simple P&L (Owner only in Fase B)
  - `src/app/(admin)/reports/daily-cash/page.tsx`
  - `src/app/(admin)/settings/business/page.tsx` — form
  - `src/app/(admin)/settings/printer/page.tsx` — pairing status UI (actual pairing di M16)
  - `src/app/(admin)/settings/operational-hours/page.tsx` — per-day time pickers
- **User checkpoints:**
  - ⏳ User test semua admin screen di desktop browser
  - ⏳ Screenshot approval
  - ⏳ Tanya: "Report charts yang perlu apa aja? Pie/Bar/Line? Default recharts style OK?"
- **Risk:** Medium — volume tinggi tapi pattern konsisten
- **Success:**
  ```
  1. Navigate /dashboard → see mock stat cards + chart
  2. Navigate /menu/items → see 45 items, filterable, sortable
  3. Click "Tambah Item" → form renders, validates
  4. Navigate /reports/sales → date picker works, charts render
  5. All sidebar links functional
  ```

---

#### M7 — UI Review & Polish
- **Durasi:** 2 hari
- **Dependencies:** M4, M5, M6
- **Deliverables:**
  - Fix all UI feedback dari user dari M4/M5/M6 checkpoints
  - Responsive testing (tablet landscape, phone portrait, desktop)
  - Empty states untuk semua list pages
  - Loading skeletons untuk semua async UI
  - Error boundaries (`error.tsx`) di tiap route group
  - Accessibility audit (keyboard nav, aria-labels, focus visible)
  - Lighthouse check (performance baseline)
  - Final screenshot batch for "Fase A complete" milestone
- **User checkpoints:**
  - ⏳ **Final Fase A approval** — user explicitly OK untuk start Fase B
- **Risk:** Low
- **Success:**
  ```bash
  npm run build          # no errors, no warnings
  npm run lint           # clean
  npm run typecheck      # pass
  # Lighthouse > 90 performance on /pos (target, tablet viewport)
  ```
- **🎯 Fase A Complete:** User dapet full visual prototype yang bisa di-demo-in, di-foto, di-share ke stakeholders (kalau ada).

---

### FASE B — BACKEND + REBUILD (Week 4-12)

**Goal:** Replace mock services dengan real backend. Vertical slice per feature: DB schema → Server Action → wire up existing UI.

---

#### M8 — Database Schema & Seed
- **Durasi:** 2-3 hari
- **Dependencies:** M1 (env), M7 (Fase A done)
- **Deliverables:**
  - `drizzle.config.ts` — config pointing to Neon
  - `src/db/index.ts` — DB connection (Neon serverless driver)
  - `src/db/schema/outlets.ts`
  - `src/db/schema/users.ts`
  - `src/db/schema/menu.ts` (categories, menu_items, modifiers)
  - `src/db/schema/shifts.ts`
  - `src/db/schema/transactions.ts` (transactions, transaction_items, transaction_item_modifiers)
  - `src/db/schema/expenses.ts` (expense_categories, expenses, incomes)
  - `src/db/schema/audit.ts`
  - `src/db/schema/index.ts` (re-exports)
  - `src/db/types.ts` (TypeScript types derived from schema)
  - `src/db/seed.ts` — 1 outlet + 1 owner + 11 cat + 45 items + 4 modifiers + 9 expense cat (per `04-MENU-DATA.md`)
  - Generate migration: `npm run db:generate` → review SQL di `drizzle/migrations/0001_xxx.sql`
  - Apply migration: `npm run db:migrate`
  - Run seed: `npm run db:seed`
  - Verify via Drizzle Studio atau Neon console
- **User checkpoints:**
  - ⏳ User verify di Neon Tables UI: jumlah menu_items = 45, categories = 11, users = 1
- **Risk:** Medium — schema complexity tinggi (13 tables), FK relationships, partial indexes
- **Success:**
  ```bash
  npm run db:generate    # migration file created
  npm run db:migrate     # apply success
  npm run db:seed        # seed complete
  npm run db:studio      # browse, verify counts
  ```

---

#### M9 — Auth Backend (Auth.js v5 + RBAC) ⚠️ HIGH RISK
- **Durasi:** 3-4 hari
- **Dependencies:** M8
- **Deliverables:**
  - **MUST:** Fetch latest Auth.js v5 docs via Context7 MCP sebelum implement
  - `src/lib/auth/config.ts` — Auth.js v5 NextAuth config dengan Credentials provider (email+password) + custom PIN provider
  - `src/lib/auth/rbac.ts` — Permission enum ~80 keys (per `05-ROLES-RBAC.md §4`), `hasPermission(role, permission)`, `requirePermission()`
  - `src/lib/auth/session.ts` — `getSession()` server-side helper
  - `src/lib/auth/password.ts` — bcrypt wrapper (min 12 rounds)
  - `src/lib/auth/pin.ts` — bcrypt untuk PIN
  - `src/middleware.ts` — route-level protection (redirect Staff from /admin, protect /pos, /dashboard)
  - `src/app/api/v1/auth/[...nextauth]/route.ts` — catch-all Auth.js
  - `src/app/api/v1/auth/verify-approver/route.ts` — PIN override endpoint (single-use JWT)
  - `src/app/api/v1/auth/logout/route.ts`
  - Rewire `src/app/(auth)/login/page.tsx` — real auth via server action
  - Rewire `src/app/(auth)/pin/page.tsx`
  - `src/components/auth/PermissionGate.tsx`
  - Integration tests `tests/integration/auth.test.ts` (per 09-TESTING §5)
- **User checkpoints:**
  - ⏳ User test login dengan real Owner credentials (email + SEED_OWNER_PASSWORD)
  - ⏳ User verify redirect logic: Owner → /dashboard, Staff (future) → /pos
- **Risk:** **HIGH** — Auth.js v5 beta.31 volatile, middleware + App Router + Neon adapter bisa rumit
- **Mitigation:**
  - Pre-flight Context7 MCP docs lookup
  - Build incremental: email+pass first, verify, commit. Then add PIN. Then add approver flow.
  - If stuck >1 day: ask user to allow pivot ke simpler session pattern (e.g., iron-session) sementara Phase 1
- **Success:**
  ```
  1. Login via /login dengan SEED_OWNER_EMAIL + SEED_OWNER_PASSWORD
  2. Redirect to /dashboard, session cookie set
  3. Navigate /api/v1/auth/session → returns user JSON
  4. Logout → session cleared
  5. Navigate /admin as unauthenticated → 401 or redirect /login
  ```

---

#### M10 — Menu Management Backend + Rewire UI
- **Durasi:** 2-3 hari
- **Dependencies:** M8, M9
- **Deliverables:**
  - `src/features/menu/actions.ts` — Server Actions (create, update, delete, bulk, sold-out toggle)
  - `src/features/menu/queries.ts` — DB queries (list, get-by-id, by-category)
  - `src/features/menu/schemas.ts` — Zod v4 schemas
  - `src/features/menu/types.ts`
  - `src/app/api/v1/menu/items/route.ts` (GET list, POST create)
  - `src/app/api/v1/menu/items/[id]/route.ts` (GET, PATCH, DELETE)
  - `src/app/api/v1/menu/items/[id]/sold-out/route.ts`
  - `src/app/api/v1/menu/categories/route.ts`
  - `src/app/api/v1/menu/modifiers/route.ts`
  - Rewire `src/app/(admin)/menu/items/page.tsx` — real data via Server Component
  - Rewire create/edit forms to call Server Actions
  - Unit tests untuk schemas, integration tests untuk actions
- **User checkpoints:**
  - ⏳ User test: create new item, edit, delete, verify in DB
- **Risk:** Medium — straightforward CRUD
- **Success:**
  ```
  1. Navigate /menu/items → list fetched from DB (45 items)
  2. Create new "Test Item" → appears in list
  3. Edit price → persists after refresh
  4. Soft delete → hidden in list, row in DB still exists with deleted_at
  5. Toggle sold-out → updates
  ```

---

#### M11 — POS Core Backend + Rewire UI ⚠️ CRITICAL
- **Durasi:** 5-6 hari
- **Dependencies:** M9, M10
- **Deliverables:**
  - `src/features/pos/actions.ts` — `createTransaction`, `voidTransaction`, `refundTransaction`, `markServed`
  - `src/features/pos/queries.ts` — active orders, history, by-shift
  - `src/features/pos/schemas.ts` — Zod schemas (per `02-FSD §3` validation rules)
  - `src/features/pos/validation.ts` — **CRITICAL SERVER-SIDE VALIDATION** (per TSD §5.3):
    - Re-compute subtotal from items
    - Re-compute discount amount
    - Re-compute total
    - Validate cash_received ≥ total
    - Verify approverToken for staff-initiated restricted actions
    - Idempotency check via `client_ref_id`
    - Transaction number generation (atomic per day, via Postgres advisory lock)
  - `src/features/pos/receipt.ts` — build receipt payload for client-side thermal print
  - `src/app/api/v1/transactions/route.ts` (POST + GET)
  - `src/app/api/v1/transactions/[id]/route.ts`
  - `src/app/api/v1/transactions/[id]/void/route.ts`
  - `src/app/api/v1/transactions/[id]/refund/route.ts`
  - `src/app/api/v1/transactions/[id]/serve/route.ts`
  - Rewire all POS pages (from M5) to use real Server Actions
  - **Unit tests untuk money/transaction validation (MANDATORY per 09-TESTING §3.2)**
  - Integration tests untuk createTransaction happy path + 5 edge cases (insufficient cash, price mismatch, sold-out, no shift, idempotent retry)
- **User checkpoints:**
  - ⏳ **Owner + Staff real-world test** — owner login, open shift, create 3 real transactions (different payment methods mock), verify in DB
- **Risk:** **HIGHEST** — money logic, race conditions, validation complexity, state management
- **Mitigation:**
  - Test-driven: write tests first per `09-TESTING §3.2`
  - Review every transaction-related PR manually (no auto-accept per AGENTS.md)
  - Integer arithmetic enforcement via TypeScript type (`type Rupiah = number & { __brand: 'rupiah' }`)
  - Postgres `SERIALIZABLE` isolation atau advisory lock untuk `transaction_number` sequence
- **Success:**
  ```
  Critical unit tests pass:
  - money.test.ts (100% coverage)
  - transaction.test.ts (all 20+ cases)
  - validation.test.ts (all edge cases)
  
  Integration:
  - Create transaction with mixed payment methods
  - Idempotent retry (same client_ref_id) returns same result
  - Server rejects price mismatch
  - Server rejects insufficient cash
  - Audit log entries exist
  ```

---

#### M12 — Shift Management Backend + Rewire
- **Durasi:** 2 hari
- **Dependencies:** M9
- **Deliverables:**
  - `src/features/shifts/actions.ts` — `openShift`, `closeShift` (with variance calc per `08-API §5.2`)
  - `src/features/shifts/queries.ts` — active shift lookup, shift history, shift detail
  - `src/features/shifts/schemas.ts`
  - `src/app/api/v1/shifts/route.ts`, `[id]/close/route.ts`, `active/route.ts`
  - Rewire `src/app/(pos)/pos/shift/*.tsx`
  - Rewire `src/app/(admin)/shifts/*.tsx`
  - Enforce 1 active shift per user via partial unique index (already di schema M8)
- **User checkpoints:**
  - ⏳ User test: open shift, create 5 cash trx, close shift, verify variance
- **Risk:** Medium — variance calc critical for money accuracy
- **Success:**
  ```
  Open shift Rp 100.000 → create 3 cash trx total Rp 150.000 → close shift with actualCash Rp 248.000
  → Expected: variance -Rp 2.000, flag in UI
  ```

---

#### M13 — Expense/Income Backend + Rewire
- **Durasi:** 2-3 hari
- **Dependencies:** M9, M10
- **Deliverables:**
  - `src/features/expenses/actions.ts`, `queries.ts`, `schemas.ts`
  - Image upload via Vercel Blob atau simple on-disk (decide: user question Q6)
  - `src/app/api/v1/expenses/*`, `incomes/*`, `cash/daily-summary/*`
  - Rewire admin expense pages
  - Auto-generated expense on refund (per `03-TSD §8.5`)
  - Expense categories CRUD (protect system category "Refund")
- **User checkpoints:**
  - ⏳ User test: record expense with receipt image upload
- **Risk:** Medium — image storage decision + blob URL handling
- **Success:**
  ```
  1. Record expense 450000 + upload receipt photo
  2. Verify image URL in DB
  3. Verify image accessible via URL
  4. Refund a transaction → verify auto-expense created with category "Refund"
  ```

---

#### M14 — Reports Backend + Rewire
- **Durasi:** 3-4 hari
- **Dependencies:** M11, M12, M13
- **Deliverables:**
  - `src/features/reports/actions.ts`, `queries.ts` (aggregate queries per `06-DB-SCHEMA §4`)
  - Daily sales report (API §7.1)
  - Weekly/monthly range report (API §7.2)
  - Item performance report (API §7.3)
  - Simple P&L (Owner only, API §7.4)
  - Shift report with variance flags (API §7.5)
  - PDF export via `jspdf` (Owner only for P&L, Manager for operational)
  - Rewire admin report pages dengan real charts (recharts)
- **User checkpoints:**
  - ⏳ User verify akurasi laporan harian vs manual count
- **Risk:** Medium — aggregate query performance, PDF formatting
- **Success:**
  ```
  After 50 test transactions:
  - Daily sales report matches manual count (sum cross-check)
  - P&L computed: revenue - expenses = gross profit
  - PDF exports succeed
  - Chart renders correctly
  ```

---

#### M15 — Void/Refund/Discount with PIN Override
- **Durasi:** 2-3 hari
- **Dependencies:** M9, M11
- **Deliverables:**
  - `/api/v1/auth/verify-approver` route (sudah di M9 stub, sekarang production-ready)
  - Single-use JWT with jti blacklist (in-memory Map for Phase 1)
  - `src/features/pos/approver.ts` — verify token, consume jti
  - Integrate approver flow di POS UI: void, refund, discount all require PIN override untuk Staff
  - Audit log entries captures both initiator + approver
  - Integration tests RBAC-002, RBAC-003, RBAC-004, RBAC-005, RBAC-006 (per 09-TESTING §5.2)
- **User checkpoints:**
  - ⏳ User (as Owner) provides PIN in POS flow, verify token flow works
- **Risk:** Medium — JWT security, single-use enforcement
- **Success:**
  ```
  1. Staff initiates void → ApproverOverrideModal appears
  2. Owner selects tile, enters PIN
  3. Token issued (300s expiry)
  4. Void submitted with token → 200
  5. Reuse same token → 403 TOKEN_ALREADY_USED
  6. Audit log shows both staff_id + approver_id
  ```

---

#### M16 — Thermal Printer Integration ⚠️ HARDWARE DEPENDENT
- **Durasi:** 2-3 hari
- **Dependencies:** M11
- **Deliverables:**
  - `src/lib/printer/bluetooth.ts` — Web Bluetooth API wrapper (pair, connect, disconnect)
  - `src/lib/printer/esc-pos.ts` — ESC/POS command builder (init, text, align, font, cut, bitmap)
  - `src/lib/printer/receipt-builder.ts` — build receipt bytes from transaction payload (per TSD §8.1)
  - `src/features/pos/components/PrinterStatusIndicator.tsx`
  - `src/app/(admin)/settings/printer/page.tsx` — pairing flow with test print button
  - Logo binarization utility (1-bit bitmap, GS v 0 command) for print header
  - Auto-print on transaction success + manual reprint from history
  - Fallback UI: screen receipt + "retry print" button on Bluetooth failure
  - Unit tests untuk receipt builder (per `09-TESTING §3.6`)
- **User checkpoints:**
  - ⏳ **USER ACTION REQUIRED:** User run di Android tablet (Chrome), navigate to settings/printer, pair RPP02
  - ⏳ User test print (10 consecutive prints per 09-TESTING §6.1 MAN-PRT-009)
- **Risk:** **HIGH** — Web Bluetooth compatibility varies, RPP02 ESC/POS dialect may differ
- **Mitigation:**
  - Test on Chrome Android first (primary device)
  - Fallback: tampilkan receipt on-screen dengan "skip print" button kalau Bluetooth fail
  - Timeline buffer: allow +1 day for compat debugging
- **Success:**
  ```
  Manual tests (hardware):
  - Pair printer in settings → "Connected"
  - Test print → receipt emerges clean with logo + address
  - Create transaction → auto-print within 3s
  - 10 consecutive trx prints without BT disconnect
  - Receipt format matches on-screen preview
  ```

---

#### M17 — PWA + Offline Resilience
- **Durasi:** 3-4 hari
- **Dependencies:** M11, M16
- **Deliverables:**
  - Serwist config (`next.config.ts` + `src/app/sw.ts`)
  - Manifest.json dengan Mahakan icon (per PRD)
  - Offline fallback page
  - Service worker: cache menu items, shell, static assets
  - `src/lib/offline/queue.ts` — IndexedDB via Dexie (transaction queue)
  - `src/lib/offline/sync.ts` — sync pending transactions when online (use `client_ref_id` for idempotency)
  - Online/offline indicator in top bar (from M5 stub, now wired)
  - Banner "Offline — transaksi akan sync saat online"
  - E2E scenario per `09-TESTING §5.2 E2E-002`
- **User checkpoints:**
  - ⏳ User test PWA install flow (Add to Home Screen)
  - ⏳ User test offline: disconnect wifi, create transaction, reconnect, verify sync
- **Risk:** High — Serwist Next 16 compat, service worker lifecycle, IndexedDB race conditions
- **Mitigation:**
  - Use dexie (installed) patterns proven in Next 15; confirm Next 16 via Context7 MCP
- **Success:**
  ```
  1. Install PWA on tablet → app icon on home screen
  2. Launch → runs standalone
  3. Disconnect wifi → banner shows "Offline"
  4. Create transaction offline → queued to IndexedDB, receipt prints (Bluetooth local)
  5. Reconnect → auto-sync runs, toast "1 transaksi ter-sync"
  6. Verify in DB: transaction exists with correct `client_ref_id`
  ```

---

#### M18 — Testing Pass
- **Durasi:** 4-5 hari
- **Dependencies:** M17
- **Deliverables:**
  - Fill gaps in unit tests (target 80% line coverage per `09-TESTING §1.2`)
  - Integration test suite lengkap (auth, transactions, shifts, menu, expenses, reports, approver)
  - E2E smoke tests (10 scenarios per 09-TESTING §5.2 — decide: TestSprite vs Playwright vs manual)
  - Manual QA matrix (printer, EDC, tablet UX per 09-TESTING §6)
  - Performance tests (k6 atau simple script per 09-TESTING §7)
  - Fix bugs yang muncul
- **User checkpoints:**
  - ⏳ User review bug list, prioritize for Phase 1 vs Phase 1.5
- **Risk:** Low-Medium
- **Success:**
  ```
  npm test --coverage              # 80%+ coverage
  npm run build                    # no warnings
  npm run typecheck                # clean
  Lighthouse perf /pos > 90
  ```

---

#### M19 — Deploy to Vercel
- **Durasi:** 1-2 hari
- **Dependencies:** M18 (or M15 earliest for preview deploy)
- **Deliverables:**
  - Vercel project connect to GitHub repo
  - Environment variables configured (user action)
  - Production domain (mahakan-pos.vercel.app default atau custom)
  - Preview deployments on PR
  - Production smoke test (login, create transaction, etc.)
  - Serverless function config review (timeout for reports)
- **User checkpoints:**
  - ⏳ **USER ACTION REQUIRED:** Vercel OAuth flow, paste env vars (per HANDOVER M8 instructions)
- **Risk:** Medium — Neon connection from Vercel, env var typos
- **Success:**
  ```
  1. Visit https://mahakan-pos.vercel.app → login works
  2. Create transaction → persists in Neon
  3. All Fase B flows work in prod
  ```

---

#### M20 — Soft Launch Support (Ongoing)
- **Durasi:** 1-2 minggu monitoring
- **Dependencies:** M19
- **Deliverables:**
  - Daily bug triage (user reports from real usage)
  - Hotfix deployments
  - Sentry/logging setup (optional — Vercel logs usually cukup)
  - Training video 5-min untuk staff (per PRD risk mitigation)
- **User checkpoints:** Daily check-in untuk 2 minggu pertama
- **Risk:** High — real-world data surfaces unexpected edge cases
- **Success:** Kafe run 1 week parallel with Majoo, no critical bugs, owner decides cut-over

---

## 4. Open Questions / Business Decisions Needed

### 4.1 Critical (harus dijawab sebelum milestone terkait)

**C1 — Dependency version lock strategy (butuh sebelum M9)**
- Konteks: TSD §7 originally spec Next 15, actual 16.2.4. Zod 4, Auth.js v5 beta.31. Lock ke versi sekarang atau update TSD?
- Opsi:
  - A) Lock ke versi installed (Next 16.2.4, Auth.js 5.0.0-beta.31) — tidak auto-update, stable
  - B) Allow minor update (Next 16.x latest, Auth.js 5.0.0-beta latest) — fresh bug fixes
  - C) Update TSD jadi align dengan current, lalu lock
- **Rekomendasi: C** — update TSD as source of truth, lalu lock. Prevent drift.

**C2 — Session duration per role (butuh sebelum M9)**
- Konteks: PRD §3.3 bilang "POS 12h, back office 2h". TSD §6 belum eksplisit.
- Opsi:
  - A) Staff PIN login 12h (shift-long), Owner/Manager email 2h (tight)
  - B) All roles 12h (simple)
  - C) Custom: Staff 12h, Manager 4h, Owner 1h (security-first)
- **Rekomendasi: A** — sesuai PRD

**C3 — Image storage untuk receipt photo (butuh sebelum M13)**
- Konteks: `PRD P1-CASH-001` — receipt photo upload optional. Storage?
- Opsi:
  - A) Vercel Blob (paid but cheap, reliable)
  - B) Convert to base64 stored di DB kolom `bytea` (free, tapi bloat)
  - C) Skip receipt upload Phase 1 (text-only expense entry)
- **Rekomendasi: A** — Vercel Blob has free tier 500MB, cukup Phase 1

**C4 — Staff data bootstrap (butuh sebelum M9 testing)**
- Konteks: seed cuma bikin 1 Owner. Perlu staff data untuk test PIN flow + approver flow.
- Opsi:
  - A) Seed 1 test Staff + 1 test Manager via env var
  - B) Owner create staff manually via admin UI setelah login
  - C) Seed 2 staff + 1 manager hardcoded di seed.ts
- **Rekomendasi: B** — more realistic flow, tests admin UI early

**C5 — PIN policy (butuh sebelum M9)**
- Konteks: PRD bilang "4-6 digit PIN". Lebih specific:
- Opsi:
  - A) Enforce min 4, max 6 digit, no complexity (simple untuk staff)
  - B) Min 6 digit, no repeating digits (1111 blocked) — security
  - C) 4 digit fixed, no complexity
- **Rekomendasi: A** — balance staff UX + security

**C6 — SSE vs polling for sold-out broadcast (butuh sebelum M11 or M12)**
- Konteks: Vercel free tier SSE timeout 60s. Alternative: poll `/api/v1/menu/items?modifiedSince=X` every 30s.
- Opsi:
  - A) SSE dengan reconnect (more real-time, ~50s reconnect cycle)
  - B) Polling every 30s (simpler, free-tier friendly)
  - C) Postpone ke Phase 1.5 (stale for up to next page load)
- **Rekomendasi: B** — simpler, cukup real-time untuk coffee shop scale

**C7 — Domain production (butuh sebelum M19)**
- Opsi:
  - A) `mahakan-pos.vercel.app` (free, default)
  - B) Custom domain `pos.mahakancoffee.com` atau similar (beli domain ~$10/year)
- **Rekomendasi: A** untuk Phase 1, B nanti after validation

### 4.2 Nice-to-know (bisa diputusin saat muncul)

**N1 — Discount reason dropdown options**
- Default: `['Promo Staff', 'Kompensasi', 'Lainnya']`
- User bebas tambah lebih banyak atau pakai default

**N2 — Sound notification saat print selesai?**
- Default: silent, visual toast only
- Kalau user mau: add haptic vibration + toast sound via Web Audio

**N3 — Dark mode?**
- Default: light only (per UI DESIGN)
- Kafe pencahayaan OK, gak perlu dark mode

**N4 — Receipt QR code (untuk rating/feedback)?**
- Per PRD §P1-POS-007: optional Phase 2
- Skip Phase 1

**N5 — Backup policy Phase 1?**
- Neon free tier has 7-day PITR
- Weekly cron `pg_dump` ke GitHub Actions atau manual? Monthly owner-download?
- **Rekomendasi:** Phase 1 skip. Phase 1.5 setup GitHub Actions weekly dump.

**N6 — Error logging (Sentry)?**
- Default: Vercel logs cukup Phase 1
- Phase 2 kalau traffic scale → Sentry free tier

**N7 — Menu image?**
- PRD spec gak ada image per item (hanya text + price)
- Skip Phase 1, image Phase 2

---

## 5. Technical Risks & Mitigations

**Sorted by severity × probability.**

| # | Risk | Probability | Impact | Mitigation |
|---|---|:---:|:---:|---|
| R1 | Auth.js v5 beta breaking changes mid-Phase 1 | Medium | High | Pin specific beta version in package.json (`next-auth: 5.0.0-beta.31` exact). Use Context7 MCP to verify latest patterns before M9. If breaks: fallback ke iron-session + custom RBAC |
| R2 | Web Bluetooth compat issue dengan RPP02 di Android tablet user | Medium | High | Test di dev device pertama (user's actual tablet). Prepare fallback: on-screen receipt + print-later queue. Document known-working Chrome version |
| R3 | Transaction money logic bug ship ke prod | Low | **Critical** | Test-first development for M11. Manual review every money PR. Integer-only type. Integration tests covering all edge cases per 09-TESTING §3.2 |
| R4 | Next.js 16 Turbopack build issue di Vercel | Low | High | Monitor Next 16 release notes. Fallback ke webpack via `next build --experimental-webpack` kalau Turbopack break |
| R5 | Neon free tier 0.5GB penuh mid-Phase 1 | Low | Medium | Monitor storage. Estimate ~50MB/month growth, 2-3 tahun comfortable. Archive policy Phase 2 |
| R6 | Zod v4 migration issue (deprecated `.email()`) | Low | Medium | Always use Zod 4 syntax from day 1. Linter rule preventing `.string().email()` |
| R7 | Serwist + Next 16 PWA incompatibility | Medium | Medium | Verify Serwist 9 + Next 16 compat via Context7 or Serwist GitHub issues. Fallback: `next-pwa` atau manual service worker |
| R8 | Idempotency race condition (offline sync double-post) | Medium | High | Enforce `client_ref_id UNIQUE` di DB (already di schema). Server returns existing tx on conflict (per API SPEC §14.2) |
| R9 | Vercel free tier timeout di daily report aggregation | Medium | Medium | Optimize queries via indexes. If slow: cached materialized views (Phase 1.5). Preload via Server Component |
| R10 | RBAC UI bypass via direct API call | High (if not careful) | High | All API routes MUST check server-side. Use `requirePermission()` helper. Tests per RBAC-001 through RBAC-014 (09-TESTING §9) |
| R11 | Printer test di wrong browser (Safari iPad) | Medium | Low | Detect browser di printer settings, show warning "Chrome/Edge required" |
| R12 | User forgot Owner password | Low | High | `AUTH_SECRET` cannot reset password without reset flow. Phase 1 recovery: user has SEED_OWNER_PASSWORD in .env.local as fallback. Phase 1.5: email reset flow |
| R13 | Dependency vulnerability (npm audit) | Medium | Low | Weekly `npm audit` during active dev. Patch minor bumps |
| R14 | Timeline slip due to unknown unknowns | **High** | Medium | Guardrail at Week 6 checkpoint: pivot to Ultra-MVP or extend |

---

## 6. Timeline & Calendar

### 6.1 Assumption

- **User 5h/day bandwidth (active for review/test/decisions)** — high
- **AI agent code production speed** — moderate; complex milestones (M9, M11, M16, M17) take 1.5x simple milestones
- **Review cycles** — user same-day feedback given 5h bandwidth
- **Holidays/off-days** — assume none built in; real delays may apply

### 6.2 Realistic Calendar

**Start date: Monday 27 April 2026**

| Week | Milestones | Key Deliverables | User Action |
|---|---|---|---|
| **1** (Apr 27 - May 3) | M0, M1, M2 | Housekeeping, env, design system, base UI, money/format lib | Paste .env.local credentials (M1), review design showcase (M2) |
| **2** (May 4 - May 10) | M3, M4, M5 (start) | Mock data layer, auth UI prototype, POS UI half | Test login flows, review POS dashboard + order flow |
| **3** (May 11 - May 17) | M5 (finish), M6, M7 | POS complete (mock), admin all pages (mock), polish | **Fase A approval** — full visual prototype done |
| **4** (May 18 - May 24) | M8, M9 (start) | DB schema + seed, Auth backend begin | Verify seed data, test login dengan real creds |
| **5** (May 25 - May 31) | M9 (finish), M10 | Auth complete, menu backend + rewire | Test Owner login end-to-end, CRUD menu |
| **6** (Jun 1 - Jun 7) | M11 (start) | POS core backend — most critical | **⚠️ Week 6 guardrail: on track?** If not, pivot Ultra-MVP discussion |
| **7** (Jun 8 - Jun 14) | M11 (finish), M12 | POS complete, shift backend | Real-world test: owner mode, create 10+ trx, close shift |
| **8** (Jun 15 - Jun 21) | M13, M14 (start) | Expense/income, reports begin | Test expense entry + receipt upload |
| **9** (Jun 22 - Jun 28) | M14 (finish), M15 | Reports complete, void/refund/discount | Verify report accuracy vs manual |
| **10** (Jun 29 - Jul 5) | M16, M17 (start) | Thermal printer, PWA begin | **⚠️ Hardware test** — user pair printer di tablet |
| **11** (Jul 6 - Jul 12) | M17 (finish), M18 (start) | PWA complete, testing begin | Test offline flow |
| **12** (Jul 13 - Jul 19) | M18 (finish), M19 | Full testing, deploy Vercel | OAuth Vercel, paste prod env vars |
| **13** (Jul 20 - Jul 26) | M20 | Soft launch support, bug fixes | Daily usage check-in |
| **14** (Jul 27 - Aug 2) | M20 cont. | Stabilization, training material | Decide: cut-over from Majoo atau extend parallel |

**Total: 12 minggu development + 2 minggu stabilization = 14 minggu end-to-end**

### 6.3 Alternative pace scenarios

Jika user bandwidth berubah:

- **5h/day (locked):** 14 minggu (base plan di atas)
- **2h/day weekday + weekend:** ~18-20 minggu (+40%)
- **Weekend only:** 24-28 minggu (+70-100%)

---

## 7. Required From User (Upfront)

Biar gak interupt alur eksekusi, kumpulin semua yang user perlu siapin di muka.

### 7.1 Credentials (wajib sebelum M1)

- [ ] `DATABASE_URL` — Neon pooled connection string (from console.neon.tech)
- [ ] `AUTH_SECRET` — generate via `openssl rand -base64 32`
- [ ] `SEED_OWNER_PASSWORD` — pilih password kuat min 12 karakter, save di password manager
- [ ] `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` (dev), ganti `https://mahakan-pos.vercel.app` di prod
- [ ] `AUTH_TRUST_HOST=true`
- [ ] `NODE_ENV=development`
- [ ] `SEED_OWNER_NAME=Rama Saputra`
- [ ] `SEED_OWNER_EMAIL=rama.activity98@gmail.com`

### 7.2 Business Decisions (answer §4.1 Critical)

Reply dengan pilihan A/B/C untuk masing-masing:

- [ ] **C1** Dependency version strategy: **A / B / C** (rekomendasi C)
- [ ] **C2** Session duration: **A / B / C** (rekomendasi A)
- [ ] **C3** Receipt image storage: **A / B / C** (rekomendasi A — Vercel Blob)
- [ ] **C4** Staff seed strategy: **A / B / C** (rekomendasi B — manual via UI)
- [ ] **C5** PIN policy: **A / B / C** (rekomendasi A — 4-6 digit basic)
- [ ] **C6** Sold-out broadcast: **A / B / C** (rekomendasi B — polling 30s)
- [ ] **C7** Production domain: **A / B** (rekomendasi A — vercel.app default)

### 7.3 Approvals Needed

- [ ] **Scope:** Full Phase 1 ✅ (user sudah pilih)
- [ ] **Flow:** Hybrid UI prototype → Rebuild ✅ (user sudah pilih)
- [ ] **Timeline:** 12-14 minggu realistic ✅ or agressif 10 minggu without buffer? (saran: realistic)
- [ ] **Deploy timing:** M19 (Week 12) atau earlier preview deploy setelah M11? (saran: preview deploy after M11 untuk real-world test)
- [ ] **Week 6 guardrail:** OK untuk pause + review at end of Week 6? (Yes/No)
- [ ] **Approve plan ini:** Ready to start M0?

### 7.4 Hardware Readiness

- [ ] Android tablet (Chrome or Edge latest) — untuk test POS + printer Bluetooth
- [ ] RPP02 thermal printer — confirm masih powered on, paired capability
- [ ] Test kertas thermal 58mm (min 1 roll untuk print testing)

### 7.5 GitHub + Vercel Access

- [ ] Confirm: gua bisa push via user's PAT atau user push manually per session (per memory `pat-handling-preference`)
- [ ] Vercel account OAuth access — akan dibutuhkan di M19

---

## 8. Recommendation Summary

**Honest assessment:**

Plan ini **achievable dengan 5h/day user bandwidth + Full Phase 1 + Hybrid flow = ~14 minggu end-to-end**. Timeline ini bukan optimistic. Buffer udah built in untuk debug M9 (Auth), M11 (POS core), M16 (printer), M17 (PWA) — 4 milestone paling riskan.

**Confidence level: Medium-High.**
- **High confidence** untuk M0-M8, M10, M12-M14 (CRUD-heavy, pattern clear di docs)
- **Medium confidence** untuk M9 (Auth.js v5 beta volatile), M11 (transaction complexity), M15 (PIN override security)
- **Medium-low confidence** untuk M16 (Web Bluetooth hardware compat), M17 (Serwist + Next 16 untested combo)

**Yang bikin gua optimis:**
1. Docs super solid — semua spec jelas, no ambiguity mayor
2. Scaffold sudah clean, deps lengkap
3. User udah commit 5h/day — fast feedback loop = fast iteration
4. Hybrid flow = bisa pivot kalau stuck (UI works di mock, backend swap later)
5. Ultra-MVP fallback available kalau scope terlalu ambitious

**Yang bikin gua cautious:**
1. Auth.js v5 beta — kalau breaking change, bisa lose 2-3 hari
2. Web Bluetooth RPP02 — hardware test baru bisa di Week 10, late discovery
3. PWA di Next 16 + Serwist 9 — untested combo, risk unknown
4. 45+ pages to build (Fase A) — sheer volume

**Alternatif kalau plan ini gagal mid-way:**

1. **Pivot to Ultra-MVP (Week 6 guardrail):** Jika M9/M10/M11 cumulative slip >1 minggu, cut scope:
   - Keep: POS cash, menu DB, Owner login, simple shift
   - Defer to Phase 1.5: QRIS/card, void/refund, PWA/offline, printer, reports complex
   - New timeline: 7-8 minggu total (save 5-6 minggu)

2. **Freelance escalation:** Kalau Auth.js v5 / Web Bluetooth stuck berkali-kali, consider hire freelance 1-2 hari untuk unblock. Budget~$200-500.

3. **Pause project:** Kalau user bandwidth drop atau business priority shift, save progress, resume later. Code di-commit semua, DB di Neon, resume kapanpun.

4. **Soft launch earlier:** Deploy after M11 (Week 7) dengan POS core only, test parallel dengan Majoo while building sisanya. Real-world feedback inform priority.

**Rekomendasi final: PROCEED dengan plan ini**, dengan 3 condition:
1. Lock business decisions §4.1 Critical dulu (C1-C7) sebelum M0
2. Commit ke Week 6 guardrail review
3. Commit ke preview deploy after M11 (jangan tunggu M19)

---

## 9. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-24 | Initial execution plan after user decisions locked (Hybrid / Full / 5h-day) |

---

# 🛑 END OF EXECUTION PLAN v1.0

**Status:** 📋 Awaiting Owner review + approval
**Next Step:** User review this doc → approve or request revisions → jika approve, AI mulai Milestone 0 (Housekeeping) di sesi berikutnya
