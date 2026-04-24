# 🗑️ Legacy Code Salvage Report

**Date:** 2026-04-24
**Legacy folder:** `_legacy/`
**Target project:** Mahakan POS (Phase 1 MVP)
**Assessor:** AI Agent (analysis-only session, no files modified)

---

## Executive Summary

**Verdict: FULL REWRITE.** Legacy adalah UI prototype 1-commit yang dibuat untuk validasi ide POS di browser — bukan production code. Hanya **2 file meaningful** (total ~1.455 baris): satu monolit `app/page.tsx` (1.280 lines) yang gabungin seluruh app dalam 1 React component, dan 1 Zustand store untuk cart/history/KDS. Stack framework kompatibel (Next.js 16 + Tailwind v4 + React 19), tapi legacy melanggar semua hard-rule proyek target (`any` bertaburan, money pakai float, zero tests, monolith 1 file), dan fitur legacy justru condong ke feature yang Phase 1 PRD eksplisit tolak (KDS, split payment, meja). **Confidence: HIGH.** Waktu yang di-hemat kalau salvage: **~0 hari** (nothing worth copying). Risk kalau dipaksa salvage: **HIGH** (float-money bugs, `any` type pollution, scope creep ke feature non-goal).

---

## Stack Comparison

| Aspect | `_legacy/` | Target (per `AGENTS.md` §Tech Stack) | Compatible? |
|---|---|---|---|
| **Framework** | Next.js 16.2.2 | Next.js 16.2.4 | ✅ minor patch behind |
| **Router** | App Router (`app/` at root) | App Router (`src/app/`) | ✅ |
| **React** | 19.2.4 | 19.2.4 | ✅ identical |
| **Styling** | Tailwind v4 | Tailwind v4 | ✅ |
| **Icons** | lucide-react 1.7 | lucide-react 1.9 | ✅ |
| **State** | Zustand 5.x (client-only) | React Query + Server Actions + RSC | ⚠️ paradigm beda |
| **ORM / DB** | ❌ None (Zustand in-memory) | Drizzle + Neon Postgres | ❌ total gap |
| **Auth** | ❌ None | Auth.js v5 + RBAC ~80 permissions | ❌ total gap |
| **PWA** | ❌ None | Serwist | ❌ total gap |
| **Printer** | Mock button ("Print Command dikirim" toast) | Web Bluetooth + ESC/POS RPP02 | ❌ vaporware vs real |
| **Testing** | ❌ None | Vitest + TestSprite, 80% coverage | ❌ total gap |
| **Strict TS** | Nominal (`strict: true`) but uses `any` everywhere | Strict mode, **NO `any`** (AGENTS.md hard rule) | ❌ violates rule |
| **Money** | `number` via float math (`subtotal * 0.5`) | `bigint`/integer only, banker's rounding | ❌ violates hard rule |
| **Palette** | Slate + rainbow gradient-icons + emojis | Mahakan sage green `#539371`/`#3D7557`, WCAG AA | ❌ different design |
| **File structure** | Monolith: 1 file = 1 app | Feature-based `src/features/*/`, typed `src/lib/` | ❌ opposite |
| **Bahasa** | Mixed `nama`, `harga`, `waktu` (Indonesian vars) | English code + Bahasa Indonesia UI | ❌ violates AGENTS.md §Comm |

---

## File-by-File Assessment

Legacy cuma 2 file substantif. Sisanya boilerplate create-next-app default.

### 1. `_legacy/app/page.tsx` — 1.280 lines — 🔴 LOW VALUE

**Purpose:** Seluruh app POS dalam 1 React component. Sidebar, menu grid, cart, modal variant, modal pembayaran, modal split-bill, modal petty cash, modal closing shift, view riwayat, view KDS, virtual keyboard, receipt preview — semua di sini.

**State inside:** 26 `useState` calls (!) di satu component.

**Why LOW VALUE, bukan MEDIUM:**
- **Violates `AGENTS.md` hard rule "No `any`":** `selectedProduct: any`, `variantState.addons as any[]`, `lastTrx: any`, handlers terima `setter: any`, receipt map pakai `(i: any, idx: number)` — total ~20+ `any` di file ini
- **Violates "Money = integer":** `item.harga * (diskon.nilai / 100)` murni float; `Math.max(0, total - refund)` tanpa integer guarantee
- **Violates feature-based structure:** 1.280 lines di 1 file, no separation of concerns
- **Built-in non-goals:** KDS routing (`id.startsWith('F')` → kitchen), split payment (pax/custom/item), table numbers — semuanya explicit **tidak di Phase 1** per PRD §1.4
- **Receipt pakai emojis 📝** yang thermal printer ESC/POS gak dukung (bitmap-binarization tanpa fallback)
- **Menu data inline 24 items** — Phase 1 butuh 45 items per `docs/04-MENU-DATA.md`. Legacy pakai kategori "Coffee/Non-Coffee/Food/Snack" vs target 11 kategori (Ricebowl, Bakmie, Sweets, Bites, Coffee Based, Non-Coffee, Tea Based, Frappe, Mocktail, Manual Brew, Ice Cream)
- **Random transaction ID** `TRX-{Math.random * 90000 + 10000}` — collision risk, bukan deterministic sequence per TSD/DB-schema (`TRX-YYYYMMDD-NNNN` atomic)

**What it does OK (but already planned better in target):**
- Menu grid → sudah direncana di M5 (POS UI) pakai `MenuTile` component typed
- Modal variant → sudah di M5 pakai `ItemModifierModal` typed
- Numpad for cash → kita udah punya `PinPad` component (M2), bisa di-adapt
- Closing shift variance calc (lines 123-127) → simple logic yang bakal ditulis ulang di M12 dalam 10 baris

### 2. `_legacy/app/store/useCartStore.ts` — 175 lines — 🔴 LOW VALUE

**Purpose:** Zustand store — cart, saved bills, history, petty cash, active discount, partial payment, KDS tickets, refund actions.

**Why LOW VALUE:**
- **Paradigm clash:** Target pakai Server Actions + DB-persisted state, bukan client-only Zustand memory. Semua yang disimpan di Zustand ilang pas refresh. Data asli harus di Neon.
- **Float math:** `subtotal * (diskon.nilai / 100)` — no banker's rounding, no integer guarantee
- **Phase 1 non-goals baked in:** KDS dispatch (`dispatchToKds`), partial payment (`addPartialPayment`, `getRemainingTotal`)
- **Refund logic ada** tapi logic-nya sederhana (tandain `refundedItems: string[]`) dan violates transaction-audit pattern target (kita butuh audit_logs + auto-generated expense entry per TSD §8.5)

**What it reminds us:**
- `CartItem.cartItemId` (distinct dari menu item `id`) — pattern bagus, **kebetulan** sama dengan plan kita
- Full + item-level refund → legacy point us toward consider item-level refund di Phase 2+, Phase 1 kita cukup full-refund per PRD P1-POS-010

### 3. `_legacy/app/globals.css` — 27 lines — ⚫ SKIP

Default create-next-app boilerplate dengan Geist font + dark mode media query. Kita udah punya globals.css yang lebih kaya (`src/app/globals.css` di M2 commit `31eabb6`).

### 4. `_legacy/app/layout.tsx` — 19 lines — ⚫ SKIP

Default dengan `lang="en"`, Geist font. Kita udah override pakai `lang="id"` + Inter + JetBrains Mono + Toaster di M2.

### 5. `_legacy/public/*.svg` — ⚫ SKIP

Next.js default icons. Kita pakai Mahakan logo yang sudah di `public/assets/logo/`.

### 6. `_legacy/package.json`, config files — ⚫ SKIP

Subset dari deps kita. Target sudah punya semua + additional (Drizzle, Auth.js, Serwist, date-fns-tz, jspdf, recharts, dexie, dll).

---

## Salvage Plan

**Tidak ada.** Keputusan: **FULL REWRITE**.

### Items to Salvage
**Nothing.** Zero file di-copy dari `_legacy/` ke project.

### Integration Strategy
N/A.

---

## Not Salvaging Because

Dalam bahasa manusia, kenapa gak ada yang dicuri:

1. **Legacy melanggar hard rules proyek kita.** `AGENTS.md` bilang "No `any`" dan "Money harus integer" — legacy terang-terangan langgar keduanya di hampir setiap file. Fixing = basically rewriting from scratch.

2. **Fitur yang legacy punya justru Phase 1 PRD eksplisit TOLAK.** KDS, split payment, table management — semuanya di PRD §1.4 "Non-Goals". Salvage berarti copy kode yang kita nggak butuh.

3. **Fitur yang Phase 1 BUTUH, legacy nggak punya.** DB (Drizzle + Neon), Auth (Auth.js v5), RBAC, audit log, PWA (Serwist), thermal printer (Web Bluetooth + ESC/POS), offline resilience (Dexie + IndexedDB), reports (recharts + jspdf), multi-role. Legacy zero dari semua ini.

4. **Code quality gap terlalu lebar.** Legacy = 1 file 1.280 baris, no tests, no types strict, state di 26 useState. Target = feature-based folders, Vitest 60/60 tests, 100% coverage on `money.ts`, typed + a11y-compliant UI components (9 sudah ada di M2).

5. **Design system incompatible.** Legacy: slate + rainbow gradient + emoji icons + text-button-berwarna-warni. Target: Mahakan sage green palette (WCAG AA), lucide-react, consistent spacing/radius/shadow scale. Udah ke-commit di M2.

6. **M2 kita udah jauh lebih bagus dari legacy.** Base components kita (Button, Input, Card, Modal, Badge, Toast, PinPad, QuantityStepper, Spinner) sudah strict-typed, a11y-aware, themeable, reusable. Legacy punya inline-styled monolith yang gabisa di-reuse untuk admin back office. Salvaging = downgrade.

7. **Money logic kita udah superior.** Legacy: float `* 0.5`. Kita: `src/lib/money.ts` integer-only dengan banker's rounding, 100% test coverage, 60 tests (M2). Replacing would be regression.

---

## Recommendation for User (Rama)

**Final call: FULL REWRITE. Jangan salvage satu file pun.**

Alasannya simple: legacy itu **prototype buat bikin mockup cepet di browser**, bukan code yang siap jadi production POS untuk Mahakan. Cuma ada 1 commit ("Initial commit from Create Next App"), semuanya di-gabung di 1 file raksasa (1.280 baris), gak ada database/login/printer beneran — cuma tombol-tombol yang ngeluarin toast "Print Command dikirim". Kalau dipaksa salvage, lo bayar biaya _detangling_ (pisahin komponen dari monolith, fix `any` types, ganti float ke integer, buang KDS/split payment yang emang gak di-PRD) yang lebih mahal daripada nulis fresh dengan arsitektur target yang udah jelas di docs.

**Yang kita udah punya (M0-M2) sudah lebih bagus dari seluruh legacy:**
- Design system typed + tested + WCAG AA → legacy cuma inline style slate
- Money lib 100% coverage, integer-safe → legacy float math
- Component library 9 pieces reusable → legacy 1280-line monolith
- DB connection Neon verified → legacy zero DB
- Execution plan 14-minggu → legacy zero plan

**Apa yang legacy OK-ish:**
- Concept POS-nya (kasir → menu → cart → bayar) — tapi ini nggak perlu "salvage", udah ada di PRD/FSD lebih rapi
- Keberanian coba KDS + split payment — bisa jadi inspirasi buat Phase 2+, tapi bukan buat dicopy

**Next step:**
- **Opsi A (Recommended):** Delete `_legacy/` folder sepenuhnya. Sudah nggak useful, cuma bikin noise di workspace (ESLint/tsconfig udah di-exclude tapi masih 294 node_modules dir yang bikin `find`/`grep` lambat). Safe karena legacy punya `.git` sendiri — kalau suatu saat lo kangen, reinit clone dari mana aja.
- **Opsi B (Kalau masih pengen jaga-jaga):** Keep `_legacy/` read-only sampai M7 (end of Fase A UI Prototype). Kalau selama Fase A ada momen "eh, dulu gua bikin UX X kayak gini, let me lihat lagi" — buka di VS Code baca, jangan copy. Delete setelah M7 selesai.
- **Opsi C (Not recommended):** Pull in specific files via git cherry-pick atau manual copy. Don't. Setiap file yang masuk = butuh 3-5x rewrite effort untuk konform ke hard rules.

**Rekomendasi gua:** Opsi A. Delete sekarang juga. Lo udah punya execution plan lengkap, docs yang robust, fondasi M0-M2 yang jauh lebih solid. Legacy cuma deadweight.

Kalau mau Opsi A, kasih confirm "delete _legacy" dan gua execute `rm -rf _legacy/` (1 command, irreversible tapi file-nya gak ada yang berharga). Kalau Opsi B, gua leave it alone.

---

## Appendix — Observed Metrics

| Metric | Value |
|---|---|
| Total legacy files (excl. node_modules/.next/.git) | 22 |
| Legacy LoC (app/page.tsx + store) | 1.455 |
| Legacy git commits | 1 ("Initial commit from Create Next App") |
| Legacy tests | 0 |
| Legacy `any` occurrences in page.tsx (approx) | ~20 |
| Files matching Phase 1 feature spec | 0 |
| Files worth copying | 0 |
| node_modules directories in `_legacy/node_modules/` | 294 |

---

## Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-24 | Initial salvage assessment; verdict FULL REWRITE |
