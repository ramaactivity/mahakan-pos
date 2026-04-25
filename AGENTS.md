# AGENTS.md — Mahakan Coffee POS

This file is automatically read by Antigravity (and compatible tools like Cursor, Claude Code) at the start of every agent session. It provides project context so the agent doesn't need to be re-briefed each time.

---

## 📚 Documentation — Read These First

**Before writing any code, read the relevant docs in `./docs/`:**

- `docs/00-README.md` — Index + quick context primer (read first!)
- `docs/01-PRD.md` — Product requirements, Phase 1 scope, non-goals
- `docs/02-FSD.md` — Functional specs: every feature's flow, validation, errors
- `docs/03-TSD.md` — Technical specs: architecture, Drizzle schema, API, printer
- `docs/04-MENU-DATA.md` — 45 SKU seed data + modifiers + outlet config
- `docs/05-ROLES-RBAC.md` — Permission matrix (Owner/Manager/Staff)
- `docs/06-DATABASE-SCHEMA.md` — ERD + per-table reference + indexes
- `docs/07-UI-DESIGN-SYSTEM.md` — Colors, components, Tailwind v4 config
- `docs/08-API-SPEC.md` — Endpoint contracts, error codes, flow examples
- `docs/09-TESTING-STRATEGY.md` — Vitest + TestSprite test cases

**These docs are the source of truth. If a request conflicts with docs, ask for clarification — don't silently deviate.**

---

## 🎯 Project At a Glance

**Business:** Mahakan Coffee & Space — single-outlet coffee shop in Bogor, Indonesia. Owner building custom POS+ERP to replace Majoo subscription.

**Phase:** Phase 1 MVP (8-10 weeks). Target: replace Majoo for daily transactions.

**Users:** Owner (email+password login), Operational Manager (email+password), Staff (PIN login, tablet POS).

**Devices:** Android tablet + smartphone for POS (PWA), desktop browser for back office.

---

## 🛠 Tech Stack (Locked)

- **Framework:** Next.js 16 (App Router, Server Actions)
- **Styling:** Tailwind CSS v4
- **Database:** Postgres via Neon (free tier), ORM: Drizzle
- **Auth:** Auth.js v5 (NextAuth)
- **PWA:** Serwist
- **Printer:** Web Bluetooth + ESC/POS (RPP02 58mm)
- **Hosting:** Vercel
- **Testing:** Vitest (unit/integration), TestSprite (E2E)
- **Language:** TypeScript strict mode (NO `any`)
- **UI Language:** Bahasa Indonesia
- **Code/Docs Language:** English

---

## ⛔ Hard Rules — NEVER VIOLATE

1. **Money = integer rupiah.** NEVER use float/decimal for money. All amounts are `bigint` in DB, `number` (integer) in TS.
2. **No `any` in TypeScript.** Strict mode. Use `unknown` + Zod if source is untrusted.
3. **Server-side validation ALWAYS.** Never trust client. Re-validate prices, totals, RBAC in Server Actions.
4. **RBAC at server layer.** UI hiding is UX, not security. See `docs/05-ROLES-RBAC.md`.
5. **Audit log for sensitive actions.** Transactions, user changes, settings — all logged. See FSD §1.5.
6. **API versioning from day 1.** `/api/v1/...` always.
7. **Every table has `outlet_id`, `created_at`, `updated_at`, `deleted_at`.** Multi-outlet ready, soft delete default.
8. **Phase 1 scope only.** No recipe/BOM, no double-entry accounting, no payroll, no loyalty. See PRD §1.4 for non-goals.

---

## 📁 Folder Structure (from TSD §3)

```
src/
├── app/                 # Next.js App Router
│   ├── (auth)/          # Login pages
│   ├── (pos)/           # Tablet POS routes
│   ├── (admin)/         # Desktop back office routes
│   └── api/v1/          # REST endpoints
├── features/            # Feature-based modules
│   ├── auth/
│   ├── menu/
│   ├── pos/
│   ├── shifts/
│   ├── expenses/
│   ├── reports/
│   ├── users/
│   ├── settings/
│   └── audit/
├── components/ui/       # Primitive components
├── db/schema/           # Drizzle schemas
├── lib/                 # Money, date, utils, auth config, rbac
└── middleware.ts
```

Each feature folder has: `actions.ts`, `queries.ts`, `schemas.ts`, `types.ts`, `components/`.

---

## ✅ Before Proposing Any Code

1. Has the relevant doc been read? (Use file reference like `@docs/02-FSD.md` to pull into context)
2. Does the proposed solution align with PRD Phase 1 scope?
3. Is money logic using integer arithmetic?
4. Is there a server-side validation layer?
5. Are audit logs emitted for sensitive actions?
6. Are there unit tests for business logic?

---

## ⚠️ Library Versions — Verify via Context7 MCP

Training data for AI agents may be outdated. **Always verify current library APIs via Context7 MCP** (if available) before writing code. Libraries that frequently change:

- Next.js 16 App Router (Server Actions, `loading.tsx`, `error.tsx` patterns) — breaking vs 15: `middleware.ts` deprecated (→ `proxy.ts` by Next 17/18), Turbopack is default for `next dev`/`next build`, `revalidateTag` now takes a second `cacheLife` arg. Phase 1 keeps `middleware.ts` (Auth.js v5 compat) and does not use `revalidateTag`.
- Zod v4 (was v3): `z.string().email()` deprecated → use `z.email()`. Error structure changed. Refer Context7 MCP for zod@4 patterns.
- Vitest v4 (was v2): mostly backward compat. Syntax contoh di docs should still work.
- Tailwind CSS v4 (new CSS-first config, different from v3)
- Drizzle ORM (schema syntax, relations API)
- Auth.js v5 (beta — major changes from NextAuth v4)
- Serwist (migration target from next-pwa)

---

## 🔒 Safe-to-Automate vs Human-Review-Required

**Safe to auto-accept:**
- CSS/Tailwind class tweaks
- Component layout changes
- Copy/text refinement (Bahasa Indonesia)
- Icon selections
- Empty state + loading state implementations

**ALWAYS review before commit:**
- Money calculations (discount, total, change, rounding)
- Auth middleware + JWT handling
- Destructive DB operations (DELETE, UPDATE WHERE)
- RBAC permission checks
- Payment flow logic
- Offline sync conflict resolution
- Database migrations
- Schema changes

---

## 🗣 Communication Preferences

- Respond in Indonesian/English mix is OK (casual project chat)
- Code, comments, commit messages: English
- Variable names, function names: English
- UI text (labels, toasts, errors): Bahasa Indonesia (see FSD §1.2 for error copy)
- Be direct with tradeoffs. Push back if user request conflicts with docs — don't silently comply.

---

## 📌 Owner Info (for seed data and receipt header)

- **Business name:** Mahakan Coffee & Space
- **Address:** Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750
- **Phone:** 0838-1977-5665
- **Hours:** Weekday 14:00-22:00, Weekend 09:00-23:00
- **Logo:** `public/assets/logo/Logo_Mahakan_Hijau.png` (primary), `Logo_Mahakan_Hitam.png` (thermal print), `Logo_Mahakan_Putih.png` (dark bg)
- **Brand color:** `#539371` (sage green, from logo) — decorative only; use `#3D7557` (green-700) for action text to meet WCAG AA

---

## 🚦 Current Status

**Phase 1 implementation — Week 0 (Pre-Foundation)**

Docs complete, no code yet. Next step: Week 1 Foundation — `npx create-next-app@latest mahakan-pos --typescript --tailwind --app`, Drizzle migration, Auth.js v5 config, seed data, design tokens.
