# Mahakan POS — Progress Log

Tracking milestone completion per `docs/99-EXECUTION-PLAN.md`.

## Current Status

**Phase:** Phase 2 — **Sesi C-4 CLOSE 2026-04-30**: 3-item cash management ops bundle deployed. Shift handover message (#10 — `shifts.handover_message` via migration 0011, banner di OpenShiftModal step 1 nampilin pesan dari shift terakhir di outlet), tutup kasir extended (#11 — settlement channel inputs EDC + GoFood + GrabFood + ShopeeFood, plus petty cash recap dari getDailyCashSummary), petty cash POS (#12 — new PettyCashCard di PosSettingsPanel dengan create expense/income inline + RBAC extension supaya staff bisa create). 1 commit, migration 0011 applied to Neon, vitest 372/372 + build 11 routes + bundle leak scan empty.
**Active Milestone (sesi C-5 next):** Split bill (#13 — nominal + per-menu, paling architectural). HR module bumped to C-6..C-8.
**Local HEAD:** `12aa458` — synced with `origin/release/phase-1`, all deployed.
**Mode:** Online (production live at https://mahakan-pos.vercel.app, inventory data populated — 140 ingredients + 20 preparations + 71 active recipes + 321 recipe lines).
**Production URL:** https://mahakan-pos.vercel.app
**Vercel Project:** ramaactivity98-5695s-projects/mahakan-pos
**Branch:** `release/phase-1` (HEAD `12aa458` local + remote, latest deploy 2026-04-30 sesi C-4 cash management bundle, migration 0011 applied)
**Sesi C plan:** `~/.claude/plans/compiled-hugging-marble.md` (REWRITTEN as handover; 17 staff revisions sequenced as C-1..C-5, then HR C-6..C-8; ~11-12 sesi total)
**Phase 2 roadmap:** see `docs/99-PHASE-2-ROADMAP.md` (updated §11 + decisions D44-D55 for sesi 12-14 drift; M29 Loyalty landed)
**Phase 2 Tier 1.2 plan (M23.1):** `~/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md` (10 locked decisions)
**Phase 2 Tier 1.2 plan (M23.2):** `~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md` (cascade engine implementation)
**Sesi 12-13 close plan:** `~/.claude/plans/halo-gua-mau-lanjut-nested-riddle.md` (M26 + M27 + handover)
**Sesi 14 plan:** `~/.claude/plans/halo-gua-mau-lanjut-streamed-goose.md` (M28 quick-wins bundle)

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
- [x] **M23.3** — UI: Preparations tab (`PreparationsList` + `PreparationFormModal`) + COGS Calculator widget (`CogsCalculatorWidget`) + IngredientsList atomic-only filter + RecipeEditorModal enhancements (Q Factor field, grouped select atomic/prep via `<optgroup>`, banded margin green/amber/red, GRABGOSO 30% display) + RecipesList Q badge inline + 3 server action wrappers (`listAtomicIngredients`, `listPreparations`, `getPreparationRecipe`) _(done 2026-04-28 sesi 9-10, commits `c8b10fc` + `1ecc604` + `b8daca2`, pushed + deployed `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j`)_
- [x] **M23.4** — CSV Importer/Exporter/Template generator (long-format 5-file CSV, NOT Owner spreadsheet layout — clean standardized template). 3 npm scripts (`inventory:template`, `inventory:export`, `inventory:import`); `import-engine-pure.ts` (zod-style row normalizers + diff + topological sort + duplicate detection, 32 unit tests) + `import-engine.ts` (DB orchestration: pre-flight cycle check via merged adjacency, atomic single-tx, REPLACE recipe lines, cascade auto-fire per prep, refuse-on-error commit semantics); CLI prints per-row [NEW]/[UPDATE]/[SKIP]/[ERROR] table + JSON sidecar; audit `inventory.import.run` with runId; outlet auto-detect + actor via `SEED_OWNER_EMAIL`; csv-io tests (12 cases); `docs/M23.4-CSV-IMPORT.md` operational guide. Drop `import "server-only"` dari `preparation-flow.ts` + `audit/logger.ts` agar reusable dari Node CLI _(done 2026-04-28 sesi 10, commits `e509fc1` + `f46d298` + `a48e696` + `3512df4`, pushed + deployed `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j`; --apply belum dijalankan di prod, menunggu Owner-curated CSV di sesi 11)_
- [x] **M23.5** — First live --apply ke production. Translated 5 Owner messy spreadsheets (Marketlist.tsv 165 rows + PREP_BEVERAGE/PREP_FOOD wide-format + UPDATE_HPP_BEVERAGE/FOOD wide-format) → 5 standardized CSV via deterministic translator (`scripts/_oneshot/translate-owner-csv.ts`). Dry-run clean iter-1 (0 errors). GHA backup #5 + Owner browser-triggered. `--apply` runId `284c8647-6827-4ab7-8a0d-4ffe78cdabe3` COMMITTED: 140 ingredients NEW, 20 preparations NEW, 57 prep lines NEW, 51 menu recipes NEW, 264 menu lines NEW. Engine bug discovered: `cascadeCostUpdate(prepId)` only recomputes dependents, not changedId itself → all prep costs landed at 0. Workaround `scripts/_oneshot/recompute-all-preps.ts` calls `computePrepCost` per prep in topo order; all 20 prep costs computed correctly (Espresso HB 67/ml, Sambal Matah 20/gr, Nasi 6/gr — match Owner display ±1). COGS verification via `expandRecipeToAtomicLeaves`: 6/7 sample menus within ±10% Owner display (rounding); Churros 45% delta = Owner Marketlist had stale `Prep - Saus Coklat` cost (150/gr) vs actual recipe-computed (45/gr) — engine MORE accurate than Owner spreadsheet. **Tier 1.2 cost engine VERIFIED LIVE.** Bakmie "Ayam Sambal Matah" naming conflict deferred to Owner: rename via Admin UI then re-import file 04+05 _(done 2026-04-28 sesi 11, commit `e640f11`; data-only milestone, no code deploy; backup artifact GHA run `25034423361`)_
- [x] **M23.6** — Menu Engineering Matrix view (Kasavana-Smith 2x2). New "Matriks Menu" sub-tab di Admin → Laporan (owner-only) yang klasifikasi 51 menu ke 4 quadrant berdasarkan median split popularitas (qty) × contribution margin Rp. Pure classifier `src/features/reports/menu-engineering-pure.ts` (Excel linear-interp median + 4-item MIN guard + ties-up convention). Backend `fetchMenuEngineeringMatrix` reuses `fetchItemPerformance` + applies pure classifier (no new SQL). Server action gated by `report.items.view` + `report.cost_visibility`. UI: 2x2 grid cards (Star/Puzzle/Plowhorse/Dog dengan action labels Indonesian) + summary header (revenue/cogs/contribMargin totals + median split values) + sortable list per quadrant by contribMargin DESC + drop-down "Belum diklasifikasi" untuk items tanpa sales/HPP. 15 unit tests covering median edge cases + 4-corner classification + ties + MIN_ITEMS=4 boundary + null cogs handling _(done 2026-04-28 sesi 11, commit `b0f5d84`; verify typecheck ✓ lint ✓ vitest 291/291 ✓ build 11 routes ✓)_
- [x] **M23.7** — Engine bug fixes (A) + CSV export polish (C) — sesi 11 follow-up. **A1**: `cascadeCostUpdate` di [preparation-flow.ts](src/features/inventory/preparation-flow.ts) sekarang juga recompute changedIngredientId ITSELF kalau itu prep (bukan cuma dependents). Atomic ingredient flow tidak berubah. Eliminates need for `recompute-all-preps.ts` workaround pada future imports. **A2**: `menuIdByLower` di [import-engine.ts](src/features/inventory/import-engine.ts) sekarang detect duplicate menu_item names + emit clear ERROR message instead of silently last-seen-wins. Verified via dry-run: `Ayam Sambal Matah` correctly errors di row 47 + cascades 6 lines. **C**: CSV export button di Matriks Menu — 2 file (summary per quadrant + full rows) menggunakan papaparse + browser Blob download _(done 2026-04-28 sesi 11, commits `32eb883` + `d92b94e`; verify typecheck ✓ lint ✓ vitest 291/291 ✓ build 11 routes ✓)_

#### M24 — Kitchen + Bar Print Routing (single-printer multi-ticket model)

- [x] **M24** — Setiap transaksi `paid` sekarang emit 3-cut sequence: kitchen ticket (food only) → bar ticket (drinks only) → customer receipt. Empty station skip (mis. pure-drink order = 2 cut). Hardcoded `category → station` map untuk 11 seeded categories di [src/lib/printer/station-mapping.ts](src/lib/printer/station-mapping.ts). Pure ticket builder [src/lib/printer/ticket-builder.ts](src/lib/printer/ticket-builder.ts) — no prices, no totals, big bold pager + items dengan variant/modifiers/notes. [print-transaction.ts](src/lib/printer/print-transaction.ts) modified untuk concat 3 ticket bytes dalam 1 send call (single Bluetooth transmission). 17 unit tests covering station mapping, item filtering, build edge cases (empty, takeaway, no-prices invariant, total count footer). Void/refund transactions tidak emit prep tickets (operasi sudah done). Schema field per kategori deferred — single-outlet + 11 seed-locked cats sufficient untuk hardcoded approach _(done 2026-04-28 sesi 11, commit `eabe648`; verify typecheck ✓ lint ✓ vitest 308/308 ✓ build 11 routes ✓; awaiting Owner push + deploy + hardware test on RPP02)_

#### M25 — POS UX Improvements (Phase 2 Tier 2.1)

- [x] **M25-S** — Audit-driven cashier rush-hour speed wins. Audit identified 4 highest-impact daily-friction items (S1-S4). **S1**: Cache item tapped from idle state in `pendingTapItem`, auto-dispatch via `dispatchItem(draftId, item)` post-`handleNewOrderCreated` — eliminates "tap ulang" friction. Cancel NewOrderModal clears cache. **S2**: Pre-fetch all modifiers + build `categoryId→Modifier[]` map saat PosShell mount; predicate di `dispatchItem` skip ItemModifierModal entirely untuk fixed-price items dengan empty modifiers list (Bites/Sweets/Ricebowl/IceCream ~15 menu items) — direct addItem dengan defaults. **S3**: `isMergeableLine` helper + `addItem` merge logic — same `(menuItemId, variant, unitPrice, modifiers slug+value)` increments existing line qty instead of appending. Items dengan note/openPriceNote stay separate (custom by intent). **S4**: NewOrderModal pre-fills pager dengan `max(active drafts) + 1` via `useCartStore.getState()` di useEffect saat open. 15 unit tests di [tests/unit/cart-merge.test.ts](tests/unit/cart-merge.test.ts) covering merge edge cases (different menu/variant/price/modifiers, notes block merge, identical modifier sets, addItem merge behavior) _(done 2026-04-28 sesi 11, commit `f5b2c9f`; verify typecheck ✓ lint ✓ vitest 323/323 ✓ build 11 routes ✓)_

#### M24-fix — Receipt + Prep Ticket Layout Polish (sesi 12 hardware feedback)

- [x] **M24-fix** — Galih hardware-test feedback (foto WA): `·` middle dot di "Pager 1 · Takeaway" rendered as `┬·` mojibake di RPP02 (UTF-8 0xC2 0xB7 baca sebagai 2 byte di CP437); item name overflow merge dengan divider line; `…` ellipsis sama bug; `Tunai` label kurang prominent. Fix: `·` → `\|` (ASCII pipe), `…` → `..`, outlet name `size(2,2)` → `size(1,2)` no auto-wrap, item header bold + mods/notes prefix `  - `, modifier separator `,`, price line `@Rp X x N` format, address split 2 lines via `wrapAddress` array, TUNAI/KEMBALI/TOTAL bold uppercase, feed 3→4 _(done 2026-04-28 sesi 12, commit `560e287`; deployed; verify typecheck ✓ lint ✓ tests 323/323 ✓)_

#### M26 — Admin UI/UX Overhaul (Linear/Notion clean minimal density)

User complaint sesi 12-13: COGS Calculator + Recipe modal overflow di tablet, banyak native browser dropdown + date picker yang mood-killing. Approach: shadcn/ui (Radix + Tailwind), per-component opt-in, copy-paste owned source.

- [x] **M26.0** — Foundation primitives di [src/components/ui/](src/components/ui/): `Select.tsx` (Radix Select), `Combobox.tsx` (cmdk-powered searchable + grouped + clearable), `DatePicker.tsx` (react-day-picker + Radix Popover, ID locale), `DateRangePicker.tsx` (range + 5 presets sidebar). Modal enhanced: sticky header + scrollable body + sticky footer + new sizes `2xl/3xl/full` + `bodyPadding` prop. Deps added: `@radix-ui/react-select/popover/dialog`, `react-day-picker`, `cmdk` (~120KB gzipped) _(done 2026-04-28 sesi 12, commit `0aa9813`)_
- [x] **M26.1** — Hot-spot redesign per Owner foto overflow: [CogsCalculatorWidget](src/features/admin/sections/inventory/CogsCalculatorWidget.tsx) + [RecipeEditorModal](src/features/admin/sections/inventory/RecipeEditorModal.tsx) — Combobox replaces native `<select>` (140 atomic + 20 preps searchable), table-style row layout with desktop header strip + mobile stacked, modal size `3xl`, RecipeEditor action buttons (Save/Delete) promoted to per-form card header _(done 2026-04-28 sesi 12, same commit `0aa9813`)_
- [x] **M26.2** — Inventory section migration: [MovementsList](src/features/admin/sections/inventory/MovementsList.tsx) Bahan filter as searchable Combobox (140 ingredients) + Tipe Select + 2 DatePicker, [RecipesList](src/features/admin/sections/inventory/RecipesList.tsx) Kategori + Status Select, [IngredientFormModal](src/features/admin/sections/inventory/IngredientFormModal.tsx) + [PreparationFormModal](src/features/admin/sections/inventory/PreparationFormModal.tsx) unit Select + Combobox (recipe lines), [StockAdjustModal](src/features/admin/sections/inventory/StockAdjustModal.tsx) + [StockWasteModal](src/features/admin/sections/inventory/StockWasteModal.tsx) reason Select _(done 2026-04-28 sesi 13, commit `b95a456`)_
- [x] **M26.3** — Reports section migration: [DailySalesView](src/features/admin/sections/reports/DailySalesView.tsx) DatePicker, [SalesRangeView](src/features/admin/sections/reports/SalesRangeView.tsx) DateRangePicker (drops separate preset radio buttons; presets di popover), [ItemPerformanceView](src/features/admin/sections/reports/ItemPerformanceView.tsx) + [PnlView](src/features/admin/sections/reports/PnlView.tsx) + [MenuEngineeringView](src/features/admin/sections/reports/MenuEngineeringView.tsx) DateRangePicker _(done 2026-04-28 sesi 13, same commit `b95a456`)_
- [x] **M26.4** — Cash + Menu + Audit migration: [ExpensesList](src/features/admin/sections/cash/ExpensesList.tsx) + [IncomesList](src/features/admin/sections/cash/IncomesList.tsx) DateRangePicker + Kategori Select, [ExpenseFormModal](src/features/admin/sections/cash/ExpenseFormModal.tsx) + [IncomeFormModal](src/features/admin/sections/cash/IncomeFormModal.tsx) + [DailySummary](src/features/admin/sections/cash/DailySummary.tsx) DatePicker, [ItemsList](src/features/admin/sections/menu/ItemsList.tsx) + [MenuItemFormModal](src/features/admin/sections/menu/MenuItemFormModal.tsx) Kategori Select, [AuditLogSection](src/features/admin/sections/AuditLogSection.tsx) Event filter as Select with grouped sections (Auth / Transaksi / Menu / User / Kas / Settings / Inventory) + 2 DatePicker. **Total**: 16 native `<select>` + 20 native date inputs across 13+12 files migrated to 0 native UI elements in admin _(done 2026-04-28 sesi 13, same commit `b95a456`)_

#### M27 — Operational Feature Set (Galih + Owner requests, sesi 12-13)

- [x] **M27.1** — Owner role creation flow ([UserFormModal](src/features/admin/sections/staff/UserFormModal.tsx)). Permission `user.create.owner` already in RBAC; missing piece was action + UI. Server: `createOwner` di [users/actions.ts](src/features/users/actions.ts) (password min 12 chars vs Manager 8; audit log explicit "OWNER ... — granted full access"). UI: 3-button role picker (Staff/Manager/Owner amber warning) + ShieldAlert banner saat Owner selected, RoleButton sub-component _(done 2026-04-28 sesi 12, commit `909428c`)_
- [x] **M27.2** — POS fullscreen toggle button ([FullscreenToggle](src/features/pos/components/FullscreenToggle.tsx)). Browser Fullscreen API + `fullscreenchange` listener untuk state sync. Maximize↔Minimize icon flip. Mounted di [POS layout header](src/app/\(pos\)/layout.tsx). iOS Safari restricted = silent no-op (PWA `display=fullscreen` covers itu) _(done 2026-04-28 sesi 12, commit `8fde3d9`)_
- [x] **M27.3** — Cross-workspace switcher ([WorkspaceSwitcher](src/components/ui/WorkspaceSwitcher.tsx)). Owner+Manager often flip antara back office & POS dalam 1 shift; sebelumnya harus manual ketik URL. Single button di topbar mau ke workspace yang lain (ShoppingBag icon untuk POS, LayoutDashboard untuk admin). Hidden untuk Staff (gak punya akses admin). Mounted di kedua [(admin)/layout.tsx](src/app/\(admin\)/layout.tsx) + [(pos)/layout.tsx](src/app/\(pos\)/layout.tsx) topbar _(done 2026-04-28 sesi 12, commit `946b603`)_
- [x] **M27.4** — Order queue tab + per-station print split. **Galih hardware feedback**: auto-bundled bar/dapur/customer print → kacau workflow. **Solution**: refactor `printTransactionReceipt` → `printTickets(trx, name, sections[], config?)` with section selection ([print-transaction.ts](src/lib/printer/print-transaction.ts)). Auto-print on payment **only customer struk** now (prep tickets manual). New reusable [PrintStationButtons](src/features/pos/components/PrintStationButtons.tsx) 4-button (Customer/Dapur/Bar/Semua) dengan station-aware disabled state. New "Pesanan" tab di POS + [OrderQueuePanel](src/features/pos/components/OrderQueuePanel.tsx) KDS-style queue, items grouped by station, "Tandai Dikirim" button via existing `markServed` action, auto-refresh 30s, lazy-fetch detail. Side benefit: smaller payload reduces BLE buffer overflow risk _(done 2026-04-28 sesi 13, commit `2c1aea7`)_
- [x] **M27.5** — Receipt editor (advanced) + POS menu layout switcher. **Receipt editor** ([ReceiptEditorModal](src/features/admin/sections/settings/ReceiptEditorModal.tsx)): schema extended `OutletSettings.receipt` dengan `headerLines[]` (1-3 promo banner di atas outlet name), `wifiSsid` + `wifiPassword`, `extraFooterLines[]`. RBAC `settings.receipt.update` opened ke `["owner", "manager"]` (Galih bisa edit). 2-col modal: form di kiri, live monospace 32-col preview di kanan. Server-side `outletToReceiptConfig()` helper bridge outlet DB → ReceiptConfig threaded through `printTickets`. **Layout switcher** ([MenuLayoutSwitcher](src/features/pos/components/MenuLayoutSwitcher.tsx) + [MenuListRow](src/features/pos/components/MenuListRow.tsx)): 4 modes Compact/Normal/Comfy/List dengan `useMenuLayout` localStorage persistence per device _(done 2026-04-28 sesi 13, commit `b1e5557`)_
- [x] **M27.6** — Menu sort 6 modes + PIN-required void/refund (all roles). **Sort** ([MenuSortSelect](src/features/pos/components/MenuSortSelect.tsx) + `applyMenuSort`): Default / Nama A-Z / Nama Z-A / Termurah / Termahal / Signature dulu (open-price items sort to end on price-asc), localStorage persisted. **PIN guard**: void/refund actions di [transactions/actions.ts](src/features/transactions/actions.ts) sekarang require approverToken untuk SEMUA role (sebelumnya Owner/Manager skip). Owner self-approve via own PIN. HistoryDetailModal `onSubmitAction` always opens ApproverOverrideModal regardless of `isStaff` _(done 2026-04-28 sesi 13, commit `e8be08c`)_
- [x] **M27.7** — Compliment feature ([ComplimentModal](src/features/pos/components/ComplimentModal.tsx)). Galih ask: tombol gratis 100% transaksi sebagai goodwill (VIP/karyawan/service recovery/test menu/tamu owner/lainnya). Implementation: 100% discount via `discount = { type: "fixed", value: subtotal }` + reason prefix `"Compliment: "`. Audit event `transaction.compliment.applied` (separate dari `transaction.discount.applied`) — registered di [audit/types.ts](src/lib/audit/types.ts) AUDIT_EVENT_TYPES. createTransaction emits compliment event when reason matches `^Compliment:`. ALWAYS requires approver PIN regardless of role (deliberate two-step + clean approver record). Cart panel: 2-col row "Diskon | Compliment" (warning amber) above full-width Bayar button _(done 2026-04-28 sesi 13, commit `0496faa`)_
- [x] **M27.8** — Open Bill workflow. Galih ask: customer order tapi belum bayar → save bill → kembali nanti → bayar + struk auto-cetak. **Schema**: `transactions.status` enum extended ke `["paid", "voided", "refunded", "open"]` (no DB migration karena Drizzle text+enum compile-time only; existing `ck_transactions_cash_fields` constraint satisfied via placeholder `paymentMethod="cash"` + `cashReceived=0`). **Actions** ([transactions/actions.ts](src/features/transactions/actions.ts)): `saveAsOpenBill` wraps createTransaction with placeholder cash fields then mutates row to `status="open"`; `closeOpenBill(trxId, paymentMethod, cashReceived)` validates + transitions to paid. Stock deducted at SAVE (kitchen prep timing accurate). Audit events `transaction.open_bill.create` + `transaction.open_bill.close`. **UI**: New "Bill Aktif" tab (FileText icon, antara Kasir & Pesanan) + [OpenBillPanel](src/features/pos/components/OpenBillPanel.tsx) KDS-style listing dengan stale warning >2h via `useBillAge` hook + [CloseOpenBillModal](src/features/pos/components/CloseOpenBillModal.tsx) payment picker + auto-print struk via `printTickets(["customer"])` on close. Receipt-builder ReceiptData status type extended; `*** BELUM LUNAS ***` banner kalau status="open". Cart panel: "Simpan sebagai Open Bill" button antara Diskon/Compliment row dan Bayar button _(done 2026-04-28 sesi 13, commit `3105302`)_

#### M28 — Galih Quick-Wins Bundle (sesi 14, 4 items unified into single commit)

Owner picked direction C (continued Galih asks) over field-validate (A) at sesi 14 boot. 9 items grouped into bundles; Owner picked **Quick-wins** (4 small items, similar pattern, 1 sesi). Single commit `a170b56` deployed 2026-04-29.

- [x] **M28.1+M28.2** — Customer name field di transaction (#1 + #4 unified). Single nullable `transactions.customer_name` TEXT column subsumes both customer-name (#1) and bill-label/customer-hint open-bill (#4) use cases (D51). Migration `0004_demonic_wasp.sql` (additive, deploy-safe). Threading: NewOrderModal input → Draft.customerName → CreateTransactionInput / SaveOpenBillInput → DB. Zod nullish + transform "" to null. Display surfaces: NewOrderModal "Nama Customer (opsional)" input, CartPanel header subline, PaidPanel summary "Nama" line, OpenBillPanel BillCard appended `· <name>`, HistoryDetailModal description appended. Receipt struk renders `Nama : <label>` line after Kasir, truncated 25 chars; prep ticket prints customer name beneath the pager block (size 1,2 emphasis) so kitchen/bar can call out by name when pager is misplaced (D52) _(done 2026-04-29 sesi 14, commit `a170b56`)_
- [x] **M28.3** — HistoryDetailModal split print buttons (#7). Replaced single "Cetak Ulang" button with `<PrintStationButtons>` component (4-button reusable: Customer / Dapur / Bar / Semua) — same UX as PaidPanel + OrderQueuePanel. ReceiptConfig prop threaded from PosShell → HistoryDetailModal so reprints match the live struk format including edited header / WiFi / footer. Drop legacy `handleReprint` + `reprinting` state _(done 2026-04-29 sesi 14, same commit `a170b56`)_
- [x] **M28.4** — Audit reprint events (#9). New audit event `transaction.reprint` registered di AUDIT_EVENT_TYPES (auto-appears di AuditLogSection filter "Transaksi" group via existing `startsWith("transaction.")` derivation). New server action `logTransactionReprint(transactionId, sections)` di [transactions/actions.ts](src/features/transactions/actions.ts) (no permission gate — D54: any role yang bisa view trx bisa reprint, audit = passive observation). Emit ONLY dari HistoryDetailModal (post-paid scenarios) via PrintStationButtons new optional `onAfterPrint` callback (D53: signal-to-noise — PaidPanel in-flow + OrderQueuePanel prep-ticket prints stay un-audited). Fire-and-forget: kasir not blocked by audit RPC _(done 2026-04-29 sesi 14, same commit `a170b56`)_
- [x] **M28.5** — Edit open bill items workflow (Galih ask #6). Galih's M27.8 open bill locked items once saved; this unlocks via clone-into-draft pattern. New server action `editOpenBill` di [transactions/actions.ts](src/features/transactions/actions.ts) restores stock from old items (kind=`edit_restore`, new TS-only enum value), atomically deletes + re-inserts items, recomputes totals, fires audit event `transaction.open_bill.edit`. UI: OpenBillPanel BillCard tambah "Edit" button → `loadOpenBillIntoDraft` clones bill into fresh Draft with `editingBillId` set → kasir uses normal cart UI → "Update Bill" button replaces "Simpan Open Bill + Bayar" pair when `editingBillId` set → save calls `editOpenBill` instead of `saveAsOpenBill`. `restoreStockForTransaction` signature extended dengan `edit_restore` kind option (TS-only, no DB CHECK constraint). MovementsList admin filter mapping diupdate _(done 2026-04-29 sesi 14, commit `f9fcdf0`)_

#### Tech Debt Sweep (sesi 14 cycle 2)

- [x] **TD-1** — `src/middleware.ts` → `src/proxy.ts` rename (Next 16 deprecation). File handler signature + config matcher unchanged; Next 16 picks up either name but `proxy.ts` is canonical going forward. Comment di [auth/config.ts](src/lib/auth/config.ts) diupdate _(done 2026-04-29 sesi 14, commit `59a2203`)_
- [x] **TD-2** — Drop `DEFAULT_RECEIPT_CONFIG` hardcoded outlet info dari [print-transaction.ts](src/lib/printer/print-transaction.ts). Holdover dari M16 sebelum outlet fetch + receipt editor shipped. `printTickets` signature now requires non-null `config: ReceiptConfig` (was `Partial + optional`). All call sites (PosShell auto-print, CloseOpenBillModal auto-print, PrintStationButtons split prints) thread outlet-derived config from PosShell mount; null-guard dengan toast / silent skip kalau belum loaded. `printTransactionReceipt` deprecated wrapper deleted (no callers). `DEFAULT_FOOTER_TEXT` kept for `outletToReceiptConfig` fallback _(done 2026-04-29 sesi 14, same commit `59a2203`)_

#### M29 — Tier 1.3 Loyalty + Customer DB (sesi 14 cycle 3)

Original Phase 2 roadmap §3.2. Jumped from Tier 1.3 design-stage to live production in 1 sesi as a continuation push after Galih quick-wins + tech debt.

- [x] **M29.1** — Schema customers table + transactions FK migration `0005_melted_spitfire.sql` (additive: CREATE TABLE customers + ADD CONSTRAINT transactions_customer_id_customers_id_fk). Phone is natural key (digits-only normalized, unique per outlet active rows), with totalPoints + totalSpent denormalized for fast POS member-lookup card. Migration applied to Neon prod 2026-04-29 BEFORE code deploy per D55 _(done 2026-04-29 sesi 14, commit `960f4b0`)_
- [x] **M29.2** — Customer feature module di [src/features/customers/](src/features/customers/): types.ts (pure helpers `computePointsEarned` + `normalisePhone` + `POINTS_PER_RUPIAH = 1/1000` constant + `ApiResult` helpers), queries.ts (server-only fetch by id/phone, list with search, top, stats), actions.ts (`listCustomers`, `getCustomer`, `lookupCustomerByPhone`, `findOrCreateCustomer` idempotent, `updateCustomer`, `bumpCustomerEarnInTx`, `earnPointsForTransaction` idempotent guard on status=paid + customerId set + loyaltyPointsEarned=null). 4 new RBAC perms (customer.lookup all roles, customer.create all roles idempotent, customer.view + customer.update owner+manager). 3 new audit events (customer.create, customer.update, transaction.points.earned) + new entity type "customer" _(done 2026-04-29 sesi 14, same commit `960f4b0`)_
- [x] **M29.3** — Wired createTransaction + saveAsOpenBill + closeOpenBill + editOpenBill earn flow. CreateTransactionInput / SaveOpenBillInput / EditOpenBillInput accept optional `customerPhone` (max 30 char, normalised server-side). createTransaction body: resolves customer via findOrCreateCustomer (best-effort; failure doesn't block sale), sets transactions.customerId + customerName snapshot. New `opts.skipEarn` flag (default false). saveAsOpenBill calls createTransaction with skipEarn=true so placeholder paid → open transition doesn't earn prematurely. closeOpenBill fires `earnPointsForTransaction` at end (best-effort, fire-and-forget). editOpenBill re-resolves customerId (empty phone preserves linkage — kasir can't accidentally un-link) _(done 2026-04-29 sesi 14, same commit `960f4b0`)_
- [x] **M29.4** — POS UI: NewOrderModal "Nomor HP Member (opsional)" input above existing customer name field. Debounced `lookupCustomerByPhone` fires at 6+ digits → surfaces "✓ Member: <name> · <X> poin" hint atau "Member baru — auto daftar saat bayar". Auto-fills name from member record kalau name field kosong. Draft.customerPhone added; threaded through PosShell to all transaction payloads. CartPanel header: customer name + phone subline shown when set _(done 2026-04-29 sesi 14, same commit `960f4b0`)_
- [x] **M29.5** — Receipt loyalty info. ReceiptData extended dengan memberPhone + memberTotalPoints + pointsEarned. buildReceipt prints "MEMBER" centered + phone + "Poin diperoleh: +N" + "Saldo poin: <total>" block above the existing footer when sale has loyalty data. TransactionWithItems extended dengan optional `member: { id, name, phone, totalPoints }`; queries.ts fetchTransactionById LEFT JOIN customers when customerId set. print-transaction.buildCustomerBytes threads via trx.member _(done 2026-04-29 sesi 14, same commit `960f4b0`)_
- [x] **M29.6** — Admin Customers section. New "Member" sidebar item (Heart icon) between Inventory dan Staff. CustomersSection: stat cards (total / poin beredar / lifetime spend) + search bar (name atau phone) + sortable table (nama / HP / poin badge / lifetime spend / diupdate). Owner+Manager only via customer.view permission _(done 2026-04-29 sesi 14, same commit `960f4b0`)_

#### Sesi B Opening — M29.7 Redemption + Admin CSV Export + B-1 Sold-Out POS (2026-04-29)

End-of-sesi 15 close-out followed by Owner pivot ke broader B-bundle (refund partial + Owner-code approval + HR module ~6.5 sesi total per [compiled-hugging-marble.md](~/.claude/plans/compiled-hugging-marble.md)). Triple-deploy `dpl_9wz1tXHuiQWr3ZnZFMvKFzDwu46x` ships:

- [x] **M29.7 Loyalty Redemption Flow** — schema `loyalty_points_redeemed` int (additive, migration 0006 applied to Neon prod sebelum deploy per D55). Pure helpers `computeRedemptionAmount` + `clampRedemption` (13 vitest cases). Server: `bumpCustomerRedeemInTx` atomic decrement (throws `INSUFFICIENT_POINTS_RACE` rolling back the entire sale on race), `createTransaction` validates redemption (customerId + balance + discountAmount match + reason starts "Tukar Poin:"), audit `transaction.points.redeemed`. Receipt: discount line relabel "Tukar Poin (-N)" + MEMBER block adds redeem line. POS UI: `Draft.loyaltyPointsRedeemed` + cartStore `applyRedemption` (XOR vs manual discount/compliment) + `RedeemPointsModal` (max preset, clamp, 10/25/50/Max presets) + Cart "Tukar Poin Member" button (gated by `customerPhone` set). Out of scope: open-bill close redemption, edit-bill redemption, void/refund reversal of points _(done 2026-04-29 sesi B opening, commit `d90c51e`)_
- [x] **Admin CSV export** — Audit Log + Stock Movements export buttons reuse papaparse `downloadCsv`. Bumped `fetchAuditLogs` cap 200→5000 + `fetchMovements` upper cap 5000 untuk export use case (paginated viewer tetap 50). Toast warning kalau hasil >5000 (export di-cap, persempit range). Stock Movements CSV mengikuti permission `inventory.cost.view` untuk Nilai column _(done 2026-04-29 sesi B opening, commit `3f715ce`)_
- [x] **B-1 Sold-out POS settings card** (Galih ask) — Surface existing `toggleSoldOut` action di POS Pengaturan tab. Same RBAC server-side (`pos.menu.mark_sold_out` semua roles + `pos.menu.mark_available` owner+manager only). New [MenuStatusCard.tsx](src/features/pos/components/MenuStatusCard.tsx): grouped-by-category, search box, collapse per category, optimistic update + rollback, custom switch UI dengan pending-pulse state. PosSettingsPanel takes new menuItems+categories+onItemUpdated props; lifted state from PosShell so Kasir tab grid auto-syncs immediately on Pengaturan toggle _(done 2026-04-29 sesi B opening, commit `1660340`)_
- [x] **B-2 Owner-only approval code via email (Resend)** (Galih ask anti-fraud) — Replace PIN flow for void/refund dengan email-delivered 6-digit code. Schema `approval_codes` (migration 0007 applied): bcrypt-hashed code + first-2-digits hint, transaction-bound (prevents code laundering), 10-min TTL, 5-failed-attempts auto-lockout, paired consumed_at + revoked_at fields. Resend SDK added; new `src/lib/email/send.ts` wrapper dengan dev-mode console fallback; Indonesian email template. New [src/features/approval-codes/](src/features/approval-codes/) module: `requestApprovalCode` (any role with `*.request`) + `consumeApprovalCode` + `listApprovalCodes` + `revokeApprovalCode` (owner). [transactions/actions.ts](src/features/transactions/actions.ts) `voidTransaction` + `refundTransaction` accept `approverToken` OR `approvalCode`; helper `authorizeVoidRefund` branches by outlet flag. New [ApprovalCodeModal.tsx](src/features/pos/components/ApprovalCodeModal.tsx) 2-step (request → code-input); HistoryDetailModal flag-routes between PIN modal vs code modal. Settings → Tunables extended dengan Approval section (voidMode/refundMode toggle + notifyEmail override). New owner-only [ApprovalCodesPanel.tsx](src/features/admin/sections/settings/ApprovalCodesPanel.tsx) di Settings dengan table 50-recent codes + status badges + manual revoke. Compliment unchanged (PIN, owner+manager). 5 new audit events (`approval_code.{generate,consume,failed_attempt,revoked,email_failed}`) + entity type. Default mode `pin` preserves field-test; Owner flips to `code` saat ready. 11 new vitest cases (generateNumericCode6 + maskEmail + constants); 359/359 total _(done 2026-04-29 sesi B-2, commit `7772c7e`)_

Verify post-deploy: HTTP 200 di `/`, `/login`, `/pin`, `/pos`. typecheck + lint clean, 348/348 vitest, 11 routes build. Field-test Galih + staff continues — additional surfaces sekarang termasuk redemption flow + sold-out toggle di Pengaturan.

#### Sesi 15 — Admin polish + POS quick-favorites (C+D bundle, 2026-04-29)

Direction C (continued Galih asks tersisa) + D (tech debt sweep) selected by Owner setelah sesi 14 multi-cycle. 2 commits orthogonal untuk rollback boundary, single Vercel prod deploy.

- [x] **D-detail** — `CustomerDetailModal` (admin Member section). Tap row → modal: stat cards (saldo poin + lifetime spend) + nama/HP/catatan + tanggal bergabung+diupdate. Edit mode (Pencil button) → form yang call `updateCustomer` action (audit emit otomatis). Update list row + modal state via `onUpdated` callback. New file [CustomerDetailModal.tsx](src/features/admin/sections/customers/CustomerDetailModal.tsx); [CustomersSection.tsx](src/features/admin/sections/CustomersSection.tsx) clickable rows _(done 2026-04-29 sesi 15, commit `0648d8b`)_
- [x] **D-topmember** — Top Member report tab (Admin → Laporan). New tab "Top Member" (visible owner+manager via existing admin gate). [TopCustomersView.tsx](src/features/admin/sections/reports/TopCustomersView.tsx) reuse existing `topCustomers(limit)` action: limit Top 10/25/50/100 select + sort spend/poin/diupdate + CSV export (papaparse). [ReportsSection.tsx](src/features/admin/sections/ReportsSection.tsx) tab list extended _(done 2026-04-29 sesi 15, same commit `0648d8b`)_
- [x] **C-itemsfilter** — ItemPerformance polish ([ItemPerformanceView.tsx](src/features/admin/sections/reports/ItemPerformanceView.tsx)): kategori Select filter (auto-derived dari result row categoryNames sorted A-Z) + CSV export button (filename includes period + category tag). Quartile + totals re-compute terhadap filtered subset _(done 2026-04-29 sesi 15, same commit `0648d8b`)_
- [x] **C-favorites** — Quick-favorites bar di POS. New [useFavorites.ts](src/features/pos/components/useFavorites.ts) hook: localStorage-backed (key `mahakan-pos-favorites-v1`, max 10 items, per-device, no server roundtrip). New [FavoritesBar.tsx](src/features/pos/components/FavoritesBar.tsx): horizontal strip muncul di atas search header dalam CashierMiddle saat ada favorit. Each pinned item = small button (name + price), tap = dispatch via existing `onItemTap`, X = unpin. Items yang dihapus dari menu di-skip silently dari bar (tetap di storage in case kembali). [MenuTile.tsx](src/features/pos/components/MenuTile.tsx) + [MenuListRow.tsx](src/features/pos/components/MenuListRow.tsx) get optional Star button overlay (top-right corner / right-side) dengan `aria-pressed` toggle. [PosShell.tsx](src/features/pos/PosShell.tsx) wires `useFavorites()` + `menuItemsById` map → CashierMiddle props _(done 2026-04-29 sesi 15, commit `3ebfb52`)_

Verify: typecheck ✓ lint ✓ vitest 337/337 ✓ build 11 routes ✓. Production deploy `dpl_EviYNH7XdnBkjZXNBBpcQz6ybeJW` aliased ke mahakan-pos.vercel.app, HTTP 200. Field-test Galih + staff still in progress (sesi 14 features + new sesi 15 surfaces).

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

---

### 2026-04-28 (Session 12-13 — Hardware feedback chain → off-roadmap UX overhaul + Galih ops feature set)

Sesi panjang yang dimulai sebagai sesi 12 (M24 hardware-verify focus) tapi melebar ke 11 commits karena Galih (manager kafe) mengajukan banyak operational ask saat field-test, plus Owner UX requests muncul (Owner CRUD, fullscreen, workspace switch). Sesi log lompat dari 11 langsung ke "12-13" karena scope dua-sesi-worth.

**Wave 1 — M24 hardware-feedback fix (commit `560e287`):**
Galih foto WA struk customer: `Pager 1 · Takeaway` muncul `┬·` mojibake; "Iced Americano" wrap merge dengan divider line; `…` ellipsis sama bug; `Tunai` label hilang/kurang prominent. Fix: middle dot `·` (UTF-8 0xC2 0xB7 = 2 byte di CP437) → ASCII `|`; `…` → `..`; outlet name `size(2,2)` → `size(1,2)` no auto-wrap; item header bold + `  - ` prefix sub-line; modifier separator `,`; price line `@Rp X x N`; address split 2 lines centered; TUNAI/KEMBALI/TOTAL bold uppercase; feed 3→4. Tests update: `…` → `..`, `Tunai` → `TUNAI`, `Kartu BCA` → `KARTU BCA`. typecheck + lint + 323/323 tests. Push + deploy.

**Wave 2 — Admin UI overhaul (M26.0-M26.4, commits `0aa9813` + `b95a456`):**
Owner foto admin: COGS Calculator overflow di tablet, banyak native dropdown + date picker yang mood-killing. Decision (per AskUserQuestion): shadcn/ui (Radix + Tailwind) per-component opt-in, scope = entire admin dashboard, reference Linear/Notion clean minimal density. Foundation 4 primitives di `src/components/ui/`. Modal enhanced sticky header/scrollable body/sticky footer + `2xl/3xl/full` sizes. Hot spots refactored (CogsCalculatorWidget + RecipeEditorModal). Then full sweep: 16 native `<select>` + 20 native date inputs across admin → 0 native UI elements. Reports section consolidated (DateRangePicker replaces preset radio buttons di SalesRangeView).

**Wave 3 — Owner UX requests (commits `909428c` + `8fde3d9` + `946b603`):**
Owner ask: Owner CRUD (currently single owner from seed). Permission `user.create.owner` already in RBAC; missing was action + UI. Added `createOwner` server action + 3-button picker (Staff/Manager/Owner amber) + warning banner + RoleButton sub-component. Owner ask: tombol fullscreen di POS untuk hide address bar di tablet. Built `FullscreenToggle` reusable. Owner ask: gampangin switch admin↔POS. Built `WorkspaceSwitcher` button mounted di kedua topbar; hidden untuk Staff. Q3 (multi-user concurrent login safety) answered in chat: stack safe via stateless JWT + Postgres ACID + audit log per actor.

**Wave 4 — Galih ops feature set (commits `2c1aea7` + `b1e5557` + `e8be08c` + `0496faa` + `3105302`):**
Galih kembali setelah hardware test M24 dengan banyak request:
- Print buttons split: bar/dapur/customer jangan auto-bundle. Solution: `printTickets(trx, name, sections[])` refactor + auto-print on payment customer-only + new "Pesanan" tab (KDS-style queue) + `PrintStationButtons` reusable 4-button.
- Receipt editor: tambah header promo, WiFi info, footer extra. Solution: schema extension `OutletSettings.receipt.{headerLines, wifiSsid, wifiPassword, extraFooterLines}` + RBAC opens ke `["owner", "manager"]` (Galih bisa edit) + dedicated `ReceiptEditorModal` dengan live monospace preview + `outletToReceiptConfig` helper threaded ke `printTickets`.
- POS layout customization: 4 modes (Compact/Normal/Comfy/List) via `MenuLayoutSwitcher` + `MenuListRow` + `useMenuLayout` localStorage.
- Menu sort/filter: 6 modes via `MenuSortSelect` + `applyMenuSort` pure function.
- Compliment di payment + PIN + audit. Solution: 100% discount via reason prefix `"Compliment: "` + new audit event `transaction.compliment.applied` + ALWAYS PIN required regardless of role.
- Void/Refund harus PIN semua role: changed actions to require approver token even for Owner/Manager (was only Staff). Owner self-approve via own PIN.
- Open Bill workflow: schema status enum extended `"open"` (no DB migration via placeholder pattern) + `saveAsOpenBill` + `closeOpenBill` actions + new "Bill Aktif" tab + `OpenBillPanel` KDS-style + stale warning >2h + auto-print struk on close. Stock deducted at SAVE (kitchen prep accurate).

**Decisions D44-D50 locked** (see `docs/99-PHASE-2-ROADMAP.md` §10):
D44 customer-only auto-print, D45 compliment via reason prefix (no schema), D46 PIN void/refund all roles, D47 open bill via status enum + placeholder (no migration), D48 receipt edit opened to manager, D49 per-device localStorage for POS prefs, D50 drift dari Tier 1.3 Loyalty intentional.

**State akhir sesi 12-13:**
- Branch `release/phase-1` HEAD `3105302`, synced dengan remote, all 11 commits deployed
- typecheck + lint clean; **323/323 tests** (no new tests added for M27 features — backlog)
- 11 routes build via webpack + Serwist
- Production stable
- Galih + staff awaiting field-validate sesi 14

**Pending field-validate (sesi 14 priority):**
1. M27.5 Receipt editor: Galih test edit header promo + WiFi → cetak → verify format
2. M27.6 PIN guard: Owner test void → verify modal PIN muncul
3. M27.7 Compliment: scenario VIP customer + Owner self-approve → verify Rp 0 + audit log
4. M27.8 Open Bill: end-to-end save → leave → return → close → struk auto-cetak
5. M24 ulang: hardware kitchen+bar split print after Q4 deploy (BLE buffer overflow likely fixed via customer-only auto-print)

**Items NOT YET BUILT (sesi 14+ candidates)** dari Galih invitation "jika ada fitur lain boleh juga ditambahkan":
- ~~Customer name field di transaction~~ — DONE M28.1 sesi 14
- Sort/filter di Reports views (currently DateRangePicker only; could add category filter, sort by metric in tables)
- Quick-favorites bar in POS (pin frequent items)
- ~~Bill_label / customer hint di open bill~~ — DONE M28.2 sesi 14 (unified dengan M28.1)
- Receipt logo print (currently text-only header)
- Edit open bill items (currently locked once saved)
- ~~HistoryDetailModal split print buttons~~ — DONE M28.3 sesi 14
- ~~Audit reprint events~~ — DONE M28.4 sesi 14
- Multi-printer routing (separate physical printers untuk dapur vs bar)

Handover for sesi 14: `docs/99-HANDOVER-SESSION-13.md`. Phase 2 roadmap update: `docs/99-PHASE-2-ROADMAP.md` §11 + decisions D44+.

---

### 2026-04-29 (Session 14 — M28 Galih quick-wins bundle)

Owner picked **direction C** (continued Galih asks) over field-validate (A) at sesi 14 boot. 9 candidate items split into 4 bundles; Owner picked **Quick-wins (4 items)** — small, similar pattern, 1 sesi feasible. All 4 features delivered as single commit `a170b56`.

**Wave 1 — Schema + types + actions:**
Drizzle migration `0004_demonic_wasp.sql` adds `transactions.customer_name TEXT NULL`. Threaded through `CreateTransactionInput` + `SaveOpenBillInput` (optional via `customerName?: string | null`), zod schema accepts nullish + trims-then-null on empty. `createTransaction` + `saveAsOpenBill` insert customerName.

**Wave 2 — Audit + reprint action:**
Registered `transaction.reprint` audit event. New server action `logTransactionReprint(trxId, sections)` — no permission gate (D54), passive observation via audit log. Auto-appears in AuditLogSection "Transaksi" group filter via existing `startsWith("transaction.")` derivation.

**Wave 3 — Receipt + ticket builders:**
`ReceiptData` + `PrepTicketData` extended with optional `customerName`. Customer struk: `Nama : <label>` line after Kasir, ASCII-truncated 25 chars. Prep ticket: customer name shown beneath pager block, size(1,2) emphasis. Build threading via `print-transaction.ts` `buildCustomerBytes` + `buildPrepBytes`. 5 new printer + ticket-builder unit tests (323→328).

**Wave 4 — POS UI:**
`Draft.customerName: string | null` di types + cartStore (with `setCustomerName` mutator + `startDraft(pager, type, customerName?)`). NewOrderModal extra "Nama Customer (opsional)" input field (maxLength 60, hint "mis. Andi / Meja 5 / Gojek"). CartPanel header subline shows name. PaidPanel summary `Nama` row. OpenBillPanel BillCard appends `· <name>` to time-line. HistoryDetailModal: replaced "Cetak Ulang" button with `<PrintStationButtons>` (4-button), receiptConfig prop threaded from PosShell, customerName appended to modal description. PrintStationButtons grew optional `onAfterPrint(key, sections)` callback used by HistoryDetailModal to fire `logTransactionReprint`.

**Decisions D51-D55 locked** (see `docs/99-PHASE-2-ROADMAP.md` §10):
D51 single column subsumes #1 + #4 (no separate bill_label), D52 prep ticket also prints customer name (kitchen call-out), D53 reprint audit only from HistoryDetailModal (signal-to-noise), D54 no PIN gate on reprint (passive observation), D55 migrate-first deploy-second untuk additive col + new TS schema reference.

**State akhir sesi 14:**
- Branch `release/phase-1` HEAD `a170b56`, synced dengan remote, deployed 2026-04-29 (Vercel deploy `mahakan-g8tysjnk6-...`)
- typecheck + lint clean; **328/328 tests** (was 323; +5 customer name unit tests)
- 11 routes build via webpack + Serwist
- DB Neon: `customer_name` column live (NULL untuk all existing transactions)
- Production stable, awaiting Galih + staff field-validate

**Pending field-validate (sesi 15 priority — sama seperti sesi 13 boot prompt):**
1. M28.1+M28.2 customer name end-to-end: NewOrderModal input → cart panel display → struk customer + prep ticket include nama → OpenBillPanel display → HistoryDetailModal display
2. M28.3 HistoryDetailModal split print: 4 button replace single Cetak Ulang, all sections work
3. M28.4 audit reprint: tap reprint at any section di HistoryDetailModal → entry baru di Audit Log filter "transaction.reprint"
4. Sesi 12-13 features juga belum field-tested (compliment, open bill, PIN void/refund, M24 hardware re-test, queue, owner CRUD, fullscreen+workspace, layout+sort)

Handover for sesi 15: `docs/99-HANDOVER-SESSION-14.md`. Phase 2 roadmap §10 decisions D44-D55, §11 sesi 12-13 drift recap.

---

### 2026-04-29 (Session 14 cont. — Multi-cycle production push)

After sesi 14 close-out (M28 customer name etc), Owner kicked an extended autonomous push: continue Galih asks tersisa → tech debt → Tier 1.3 Loyalty, each ending in commit + push + Vercel prod deploy. 4 commits across 3 cycles in one continuous run.

**Cycle 1 — M28.5 Edit open bill items** (commit `f9fcdf0`):
Galih's open bill workflow (M27.8) locked items once saved. New `editOpenBill` server action restores stock (kind=edit_restore, new TS-only enum) → deletes old items+modifiers → re-inserts new → applies new flow. UI: "Edit" button on OpenBillPanel BillCard clones bill into Draft via new `loadOpenBillIntoDraft` cartStore mutator. Cart panel swaps "Simpan + Bayar" pair with single "Update Bill" button when `editingBillId` set. Bakmie data fix deferred to Owner via Admin UI (data integrity needs human judgment); stock-take + threshold deferred to Owner via existing Admin UI / CSV importer.

**Cycle 2 — Tech debt sweep** (commit `59a2203`):
1. `src/middleware.ts` → `src/proxy.ts` rename (Next 16 deprecation).
2. Drop `DEFAULT_RECEIPT_CONFIG` hardcoded outlet info from print-transaction.ts. printTickets signature now requires non-null `config: ReceiptConfig`. Call sites null-guard before invoking. printTransactionReceipt deprecated wrapper deleted.

**Cycle 3 — M29 Tier 1.3 Loyalty + Customer DB** (commit `960f4b0`, schema migration `0005_melted_spitfire.sql`):
- New customers table (phone unique per outlet active, totalPoints + totalSpent denormalized, soft-delete, audit cols). transactions.customer_id wired to FK customers.id.
- Customer feature module (types pure helpers + ApiResult, queries, actions: lookup/findOrCreate/list/stats/earn).
- Earn flow: Rp 1000 = 1 pt. createTransaction resolves customer via findOrCreateCustomer + sets customerId. opts.skipEarn flag for saveAsOpenBill internal call. closeOpenBill fires earn at close. editOpenBill re-resolves linkage. Idempotent earn guard on status=paid + customerId + loyaltyPointsEarned=null.
- POS UI: NewOrderModal phone input above customer name, debounced lookup, auto-fills name from member record. Draft.customerPhone threaded. CartPanel header shows member info.
- Receipt: MEMBER block prints phone + points earned + total balance when sale linked. ReceiptData + ReceiptItem types extended; fetchTransactionById JOINs customers.
- Admin: new "Member" sidebar item (Heart icon) between Inventory + Staff. CustomersSection: stat cards + search + sortable table. Owner+Manager only.
- 4 RBAC perms (customer.lookup/create/view/update). 3 audit events (customer.create, customer.update, transaction.points.earned).
- 9 new unit tests (customers/types pure helpers).

**State akhir cycle push 2026-04-29:**
- Branch `release/phase-1` HEAD `960f4b0`, 4 prod deploys ready: `mahakan-g8tysjnk6` (M28) → `mahakan-4tv5gpja1` (M28.5 edit bill) → `mahakan-7zzsx9nw7` (tech debt) → `mahakan-6jnxh6vw2` (Loyalty M29).
- typecheck + lint clean; **337/337 tests** (was 328 + 9 customer tests).
- DB Neon: `customer_name` column (sesi 14 morning) + `customers` table (sesi 14 cycle 3) live.
- Production stable, Galih + staff field-test in progress per Owner.

**Items still NOT YET BUILT (sesi 15+ candidates):**
- Loyalty redemption flow (1pt = Rp 1000 discount) — designed schema + backend hooks, UI/redemption logic deferred
- Edit customer detail page in admin (currently list-only)
- Top customers report
- Customer detail / edit modal
- Sort/filter di Reports views
- Quick-favorites bar di POS
- Receipt logo print (large)
- Multi-printer routing (large)

**Carry-over Owner action items (independent dari sesi 14):**
1. 🔴 HIGH Bakmie "Ayam Sambal Matah" rename via Admin UI — STILL pending; investigation showed recipe `46792d0b...` mis-attached to Bakmie menu_item, ingredients are Ricebowl. Recommend: Owner moves recipe to Ricebowl entry via Admin → Inventory → Resep tab edit, or rename Bakmie entry + re-import file 04+05 (Sesi 11 D2 plan).
2. 🟡 First stock-take 160 ingredients (initial_stock=0 saat ini) — gunakan Admin → Inventory → Bahan tab → tap each ingredient → "Adjust Stock" untuk set count. Per ingredient.
3. 🟡 Reorder threshold per ingredient — bisa via Admin UI yang sama, atau re-export dengan `npm run inventory:export` + edit `reorder_threshold` column di 01-ingredients.csv + re-import dengan `npm run inventory:import -- --apply` (existing M23.4 importer mendukung UPDATE pada threshold).
