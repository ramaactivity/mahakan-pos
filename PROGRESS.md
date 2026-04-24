# Mahakan POS — Progress Log

Tracking milestone completion per `docs/99-EXECUTION-PLAN.md`.

## Current Status

**Phase:** Phase 1 — Foundation
**Fase:** A (UI Prototype)
**Active Milestone:** M2 — Design System Foundation
**Mode:** Offline-only (no git push, no Vercel deploy)

---

## Milestone Checklist

### Fase A — UI Prototype (Week 1-3)

- [x] **M0** — Housekeeping & Environment Prep _(done 2026-04-24, commit `48a4111`)_
- [x] **M1** — Environment Credentials Setup _(done 2026-04-24, Neon smoke test passed)_
- [ ] **M2** — Design System Foundation _(next)_
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

**Next session (M2):**
- Design system setup — Tailwind v4 Mahakan palette, Inter + JetBrains Mono fonts
- Base UI components — Button, Input, Card, Modal, Badge, Toast, PinPad, QuantityStepper, Spinner
- Core utils — `money.ts` (integer arithmetic + banker's rounding, 100% test coverage), `format.ts` (Indonesian Rp + date), `date.ts` (WIB timezone), `utils.ts` (`cn()` helper)
- Showcase page at `/` for visual verification
- Target: User screenshots approval of sage green palette + components

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
