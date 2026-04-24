# 📚 Mahakan Coffee & Space — Documentation Index

**Project:** POS + Operations System for Mahakan Coffee & Space
**Current Phase:** Phase 1 — MVP (Pragmatic Launch)
**Last Updated:** April 2026
**Status:** 📦 Documentation complete, ready for implementation

---

## 📖 How To Read These Docs

Urutan baca dokumen (wajib sequential untuk pemahaman penuh):

1. **`01-PRD.md`** — Product Requirements Document ✅ APPROVED
   Vision, user personas, feature list, scope Phase 1, non-goals, upgradeability.
   **Baca dulu untuk pahami "apa yang dibangun dan kenapa".**

2. **`02-FSD.md`** — Functional Specification Document ✅ APPROVED
   Detail tiap fitur: flow, error case, business rule, state transition, validation.
   **Baca untuk pahami "bagaimana tiap fitur berperilaku".**

3. **`03-TSD.md`** — Technical Specification Document ✅ APPROVED
   Arsitektur, DB schema code, API design, folder structure, auth strategy, PWA config, thermal printer integration.
   **Baca untuk pahami "bagaimana membangunnya secara teknis".**

### Supporting Documents ✅ All Complete

- **`04-MENU-DATA.md`** — Seed data 45 SKU menu Mahakan + modifiers + default outlet config
- **`05-ROLES-RBAC.md`** — Role-Based Access Control matrix ~80 actions × 3 roles + PIN override flow
- **`06-DATABASE-SCHEMA.md`** — ASCII ERD + per-table reference + indexes + query patterns + migration strategy
- **`07-UI-DESIGN-SYSTEM.md`** — Design tokens (Mahakan sage green palette from logo), component patterns, Tailwind v4 config
- **`08-API-SPEC.md`** — REST endpoint contracts + Server Actions + error codes + flow examples
- **`09-TESTING-STRATEGY.md`** — Unit test (Vitest) + E2E test (TestSprite) plan + coverage targets

### Brand Assets

Folder `assets/logo/` berisi:
- `Logo_Mahakan_Hijau.png` — primary (sage green `#539371`, light backgrounds)
- `Logo_Mahakan_Hitam.png` — monochrome (print, formal docs, receipt binarization)
- `Logo_Mahakan_Putih.png` — white variant (dark backgrounds, splash)

Pindahkan saat setup repo: `public/assets/logo/`

---

## 🎯 Quick Context for AI Assistants

Jika lo adalah AI assistant (Claude, Copilot, Windsurf, Antigravity, dll) yang baru dipanggil ke repo ini:

**Business:**
- Mahakan Coffee & Space — coffee shop single outlet di Indonesia
- Alamat: `Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750`
- Phone: `0838-1977-5665`
- Jam: Weekday 14:00-22:00, Weekend 09:00-23:00
- 45 SKU menu dalam 11 kategori (ricebowl, bakmie, coffee, non-coffee, manual brew, dll)
- Service mode: Dine-in & Takeaway (pakai pager number, tidak pakai sistem meja)
- Barista merangkap kasir

**System:**
- POS + Back Office (no full ERP/accounting di Phase 1)
- 3 roles: Owner, Operational Manager, Staff (PIN login untuk staff)
- Device utama: Android tablet + smartphone (PWA)
- Back office: desktop/laptop browser
- Bahasa UI: Bahasa Indonesia
- Bahasa kode & dokumentasi: English
- Currency: IDR (integer, no decimal)
- Timezone: Asia/Jakarta (WIB)

**Tech Stack:**
- Next.js 15 (App Router)
- Tailwind CSS v4
- Postgres via Neon (free tier)
- Drizzle ORM
- Auth.js v5 (NextAuth)
- Serwist (PWA)
- Web Bluetooth API + ESC/POS (thermal printer RPP02 58mm)
- Vercel (hosting)
- Vitest + TestSprite (testing)

**Hard Constraints (NEVER VIOLATE):**
- ❌ NO floating point untuk uang — SELALU integer (satuan rupiah)
- ❌ NO `any` di TypeScript — strict mode
- ❌ NO fitur di luar Phase 1 scope (lihat PRD section 1.4 untuk non-goals)
- ❌ NO trust client-side validation — server wajib re-validate total, price, RBAC
- ✅ Semua tabel punya `outlet_id` (multi-outlet ready)
- ✅ Semua tabel punya `created_at`, `updated_at`, `deleted_at`
- ✅ API route di-versioning: `/api/v1/...`
- ✅ Feature-based folder structure: `src/features/pos/`, `src/features/menu/`, dll
- ✅ Role check di middleware/server action, BUKAN hanya di UI
- ✅ Audit log untuk semua action sensitive (transactions, user changes, settings)

**Before Coding, Always:**
1. Baca PRD, FSD, TSD, dan dokumen supporting yang relevan dengan fitur
2. Cek scope Phase 1 — jangan implement fitur Phase 2+
3. Follow folder structure & naming convention dari TSD section 3
4. Unit test untuk semua logic uang (money.ts, discount.ts, transaction.ts)
5. Untuk library docs (Next.js 15, Drizzle, Tailwind v4, Auth.js v5), **selalu verify lewat Context7 MCP** kalau tersedia — jangan andalkan training data yang mungkin outdated

**Design System Quick Reference:**
- Primary action color: `mahakan-green-700` (`#3D7557`) — WCAG AA compliant ✅
- Logo/brand accent: `mahakan-green-600` (`#539371`) — decorative only, fails 4.5:1 on white
- Backgrounds: `neutral-50` (`#FAFAF7` warm off-white)
- Typography: Inter (UI), JetBrains Mono (numbers/amounts)

---

## 📌 Phase Roadmap

| Phase | Status | Durasi Estimasi | Scope |
|---|---|---|---|
| **Phase 1 — Bisa Jualan** | 📦 Docs done, implementation next | 8-10 minggu | POS, menu, shift, kas & pengeluaran, laporan harian, 3 roles |
| **Phase 2 — Profesional** | 🔜 Planned | 4-6 minggu | Recipe/BOM, inventory, full double-entry accounting, payroll simple, loyalty basic |
| **Phase 3 — Tumbuh** | 🔜 Planned | 4-6 minggu | Delivery integration (GoFood/Grab/Shopee), WhatsApp, promo engine, CRM member tier |
| **Phase 4 — Multi-Outlet** | 🔮 Future | TBD | Multi-outlet support, consolidated reporting, inter-outlet transfer |

**Phase 1 Implementation Order (Recommended):**

1. **Week 1 — Foundation:** Next.js 15 setup, Drizzle migration, Neon connection, Auth.js v5, seed data, design tokens
2. **Week 2 — POS Core:** Menu fetch, new order flow, cart, modifiers, payment (cash first), receipt print
3. **Week 3 — POS Complete:** QRIS/card payment, void, refund, sold-out, multi-draft, offline resilience
4. **Week 4 — Shift + Cash:** Shift open/close with variance, expense/income logging, daily cash summary
5. **Week 5 — Back Office CRUD:** Menu CRUD, user management, settings pages, RBAC enforcement
6. **Week 6 — Reports:** Daily/range sales, item performance, P&L, PDF export
7. **Week 7 — Testing:** Unit tests for money logic, integration tests, E2E scenarios via TestSprite
8. **Week 8 — Hardware QA + Soft Launch:** Thermal printer + EDC real-world testing, owner training, soft launch 1-week parallel run with Majoo

---

## 🚨 Change Log

| Date | Version | Change |
|---|---|---|
| 2026-04-20 | 1.0 | Initial PRD for Phase 1 |
| 2026-04-20 | 1.1 | All 10 docs complete, owner info finalized (logo, address, phone, hours), palette updated to actual sage green `#539371` from logo with WCAG AA dual-token strategy |

---

## 🤝 Approval Status

| Document | Status | Approved By | Date |
|---|---|---|---|
| `01-PRD.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `02-FSD.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `03-TSD.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `04-MENU-DATA.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `05-ROLES-RBAC.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `06-DATABASE-SCHEMA.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `07-UI-DESIGN-SYSTEM.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `08-API-SPEC.md` | ✅ APPROVED | Owner | 2026-04-20 |
| `09-TESTING-STRATEGY.md` | ✅ APPROVED | Owner | 2026-04-20 |

---

## ✅ Pre-Implementation Checklist

Sebelum mulai coding:

- [ ] Create GitHub repo (private)
- [ ] Setup branch protection for `main`
- [ ] Setup Vercel project (but don't deploy yet)
- [ ] Setup Neon account + create `mahakan-pos` project
- [ ] Create `.env.example` with all required env vars (see TSD §11.1)
- [ ] Copy `docs/` folder + `assets/logo/` into repo root
- [ ] Install Claude extension in Antigravity IDE
- [ ] Configure Claude to read `/docs` as grounding context
- [ ] Install Context7 MCP for fresh library docs lookup
- [ ] Start with Week 1 Foundation — Next.js 15 scaffold

## ⚠️ Safety Reminders untuk Vibe Coding

- **NEVER auto-accept** AI-generated code untuk:
  - Money calculations (discount, total, change)
  - Auth middleware + JWT handling
  - Destructive DB queries (DELETE, UPDATE WHERE)
  - RBAC permission checks
  - Payment flow
  - Offline sync conflict resolution
- **Safe to vibe-code:**
  - CSS styling & Tailwind classes
  - Component layouts
  - Copy text refinement
  - Icon choices
  - Loading states & empty states
- **Always review before commit:**
  - Database migrations
  - Schema changes
  - Audit log emissions
  - Server Actions that modify data
