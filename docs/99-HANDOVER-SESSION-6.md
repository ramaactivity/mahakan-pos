# 🤝 HANDOVER SESI 6 — Mahakan POS

**Untuk:** Claude AI agent (sesi 7)
**Dari:** Sesi 6 (Phase 2 Tier 1.1 — Recipe/BOM + Inventory implementation)
**Date:** 2026-04-27
**Status:** **Phase 2 Tier 1.1 CODE-COMPLETE.** Production stable. Field validate (seed resep + transaksi smoke-test) belum dijalanin.

---

## ⚡ TL;DR

Sesi 6 ngirim **9 commit** + 1 schema migration + 6 production deploy untuk menutup seluruh M22 Recipe/BOM + Inventory tier:
- M22.1 schema (4 tabel: ingredients, recipes, recipe_ingredients, inventory_movements) + cogs cols.
- M22.2 ingredient module (CRUD + receive/adjust/waste).
- M22.3 recipe module (CRUD per menu_item × variant).
- M22.4a-c admin Inventory UI (Bahan / Pergerakan / Resep).
- M22.5 createTransaction COGS snapshot + atomic stock deduct + void/refund restore + post-commit sold-out re-eval.
- M22.6 P&L proper (Revenue − HPP = Laba Kotor − Pengeluaran = Laba Bersih) + Item Performance margin column + PDF export.

Plus 1 production-bug side-quest: **POS Pengaturan tab** — staff sekarang bisa pair printer Bluetooth sendiri (RBAC update + new in-POS settings panel), nutup bug "Printer belum di-pair" toast yang bikin staff stuck.

Plus 1 **production incident & recovery**: gua apply DB migration sebelum deploy code → live production code reference dropped columns selama ~5 menit, fix dengan manual `vercel --prod`. Memory `migration-ordering-rule` + `vercel-deploy-mode` di-saved supaya gak ngulang.

**Yang harus dikerjain sesi 7 (M22.7 field validate):**
1. Owner seed ingredient master di tab Inventory → Bahan (~30 menit, ~25 ingredient).
2. Owner seed resep untuk 43 menu di tab Inventory → Resep (~1 jam, masing-masing item 3-5 ingredient).
3. Smoke test 1 hari operasional kafe sambil monitor: COGS muncul di P&L, sold-out flag auto-trigger kalau stok habis, void/refund restore stok bener.
4. Kalau ada bug, fix. Kalau lancar, mark M22.7 done + pindah ke Tier 1.2 (Loyalty + Customer DB).

---

## 1. Production State (akhir sesi 6)

### 1.1 URLs

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| https://mahakan-i28h0fy63-... | M22.5 deploy (auto-deduct + COGS) |
| https://mahakan-...b18e3a7 | M22.6 deploy (latest, P&L + margin) |

Dashboard: https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos

### 1.2 Branch + deploy

- `release/phase-1` HEAD `b18e3a7` — local + remote synced.
- `main` HEAD `cd98828` — masih backlog (`vercel.json` + workflow only). Jangan push ke main tanpa explicit OK.
- **Production deploy IS MANUAL** — `release/phase-1` push hanya trigger Vercel Preview (yang fail karena env Preview kosong). Production cuma fire dari `npx --yes vercel --prod --yes` di working dir. (Memory `vercel-deploy-mode` capture ini.)

### 1.3 DB state (Neon, Singapore)

- Migration `0002_glossy_prodigy.sql` applied 2026-04-27.
- 4 tabel baru: `ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements` — empty di awal sesi 7. Owner harus seed.
- 2 kolom baru: `transactions.cogs`, `transaction_items.cogs` — nullable, NULL untuk transaksi pre-M22.5.
- 2 kolom drop dari `menu_items`: `cost_price`, `recipe_id` (placeholder Phase 1 yang gak pernah dipake).
- Backup pre-migration: GHA Actions run `24992122451` (2026-04-27 11:22 UTC, custom-format `pg_dump-17`).

### 1.4 GitHub repo state

- Sama dengan akhir sesi 5: `gh` CLI di `/tmp/gh_2.62.0_macOS_amd64/bin/gh`, `DATABASE_URL_BACKUP` secret aktif, weekly cron Sunday 09:00 WIB live.

---

## 2. What Changed Sesi 6

9 commits. Order chronological:

| # | Commit | Summary |
|---|---|---|
| 1 | `6aa280e` | `feat(db): inventory schema + cogs columns (M22.1)` — 4 new tables, drop 2 placeholders, gen migration `0002_glossy_prodigy.sql`. |
| 2 | `6ce1253` | `feat(inventory): ingredient module + stock movements (M22.2)` — `src/features/inventory/` module + 13 new RBAC perms + 21 tests. |
| 3 | `797abff` | `feat(pos): in-POS Pengaturan tab — staff can pair printer mandiri` — production bug-fix side-quest, RBAC update, PosSettingsPanel, sonner action UX. |
| 4 | `4e32e05` | `feat(inventory): recipe module + variant/ingredient validation (M22.3)` — recipe CRUD + ApiFailure typing fix. |
| 5 | `c008ff6` | `feat(admin): Inventory section — Bahan tab + stock CRUD modals (M22.4a)` — IngredientsList + 4 modals. |
| 6 | `3c9e29e` | `feat(admin): inventory Pergerakan tab — movement log with filters (M22.4b)` — MovementsList. |
| 7 | `89a9235` | `feat(admin): inventory Resep tab — recipe editor per menu+variant (M22.4c)` — RecipesList + RecipeEditorModal. |
| 8 | `43ab0f4` | `feat(transactions): COGS snapshot + auto-deduct stok + sold-out re-eval (M22.5)` — `src/features/inventory/transaction-flow.ts` + `createTransaction`/`void`/`refund` integration. |
| 9 | `b18e3a7` | `feat(reports): proper P&L with COGS + per-item margin column (M22.6)` — types/queries/PnlView/ItemPerformance/pdf-export. |

### 2.1 Production deploys saat sesi 6

```
mahakan-...b18e3a7 (M22.6) ← LIVE NOW
mahakan-i28h0fy63 (43ab0f4 / 89a9235 batched)
mahakan-o1khmx8k9 (c008ff6 / 3c9e29e batched)
mahakan-d9cmervaz (6ce1253 + 797abff batched)
mahakan-m6oe5jhau (6aa280e — recovery deploy)
mahakan-3uilkwes3 (b0a56a5, sesi 5 final, sebelum sesi 6)
```

---

## 3. File Structure (Sesi 6 additions)

### 3.1 New files

```
src/features/inventory/                      # Phase 2 module
├── types.ts                                  # Ingredient, Recipe, Movement, ApiFailure
├── schemas.ts                                # Zod 4 validation (ingredient + recipe)
├── queries.ts                                # server-only fetchers
├── actions.ts                                # 16 Server Actions
├── transaction-flow.ts                       # COGS + deduct + restore + sold-out re-eval
└── index.ts                                  # barrel

src/features/admin/sections/InventorySection.tsx     # 3-tab section
src/features/admin/sections/inventory/
├── IngredientsList.tsx
├── IngredientFormModal.tsx
├── StockReceiveModal.tsx
├── StockAdjustModal.tsx
├── StockWasteModal.tsx
├── MovementsList.tsx
├── RecipesList.tsx
└── RecipeEditorModal.tsx

src/features/pos/components/PosSettingsPanel.tsx     # POS Pengaturan tab
drizzle/migrations/0002_glossy_prodigy.sql           # 4 new tables + cogs cols
drizzle/migrations/meta/0002_snapshot.json
docs/99-HANDOVER-SESSION-6.md                        # this file
tests/unit/inventory-schemas.test.ts                 # 32 schema test cases
```

### 3.2 Modified files

```
src/db/schema/menu.ts                        # drop cost_price + recipe_id placeholders
src/db/schema/transactions.ts                # add cogs to transactions + transaction_items
src/db/schema/index.ts                       # export inventory schema
src/lib/audit/types.ts                       # 9 new event types + 3 entity types under inventory
src/lib/auth/rbac.ts                         # 13 inventory perms + staff added to printer.pair
src/features/admin/AdminShell.tsx            # render InventorySection
src/features/admin/components/AdminLeftNav.tsx  # Inventory nav item (Owner+Manager)
src/features/admin/sections/AuditLogSection.tsx # Inventory event group filter
src/features/admin/sections/reports/PnlView.tsx # 5-section flow with COGS + Gross Margin + Net
src/features/admin/sections/reports/ItemPerformanceView.tsx # margin column
src/features/pos/PosShell.tsx                # render PosSettingsPanel + improved reprint toast
src/features/pos/components/PosLeftNav.tsx   # PENGATURAN nav item
src/features/pos/components/HistoryDetailModal.tsx # improved reprint toast UX
src/features/reports/queries.ts              # SUM(cogs) in pnl + item perf
src/features/reports/types.ts                # PnlReport.cogs + grossMargin + netProfit; ItemPerformanceRow.cogs + marginPct
src/features/transactions/actions.ts         # M22.5 wiring
src/lib/pdf-export/index.ts                  # PnL pdf restructured for COGS + Gross Margin
tests/unit/auth-rbac.test.ts                 # +2 inventory + +1 staff-printer test cases
PROGRESS.md                                  # M22 sub-chunks logged
```

---

## 4. Test Credentials

Same as sesi 5 — `MEMORY.md` and `docs/99-HANDOVER-SESSION-5.md` §4 still valid.

### 4.1 Verify state commands

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
npm run typecheck     # tsc --noEmit, must exit 0
npm run lint          # eslint, clean
npx vitest run        # ~210 tests; bcrypt parallel may flake → re-run isolated if 4 fail
npm run build         # 11 routes, webpack mode
git branch --show-current   # release/phase-1
git log --oneline -1        # b18e3a7
curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200
```

### 4.2 Sesi 7 smoke test plan (M22.7 — field validate)

1. Login Owner → Inventory → tab Bahan:
   a. Klik **+ Tambah Bahan** untuk seed ~25 ingredient master. Suggested list:
      - Espresso bean (g, Rp 200/g)
      - Susu full cream (ml, Rp 30/ml)
      - Susu oat (ml, Rp 100/ml)
      - Sirup vanilla (ml, Rp 80/ml)
      - Cup paper 8oz (pcs, Rp 1500/pcs)
      - Cup paper 12oz (pcs, Rp 2000/pcs)
      - Lid plastik (pcs, Rp 300/pcs)
      - Sedotan (pcs, Rp 100/pcs)
      - Es batu (g, Rp 5/g)
      - Air mineral (ml, Rp 5/ml)
      - Gula (g, Rp 15/g)
      - Bubuk coklat (g, Rp 50/g)
      - Bubuk matcha (g, Rp 200/g)
      - Croffle base (pcs, Rp 5000/pcs)
      - Saus karamel (ml, Rp 100/ml)
      - … sisanya per kebutuhan menu real Mahakan
   b. Set `reorder_threshold` per ingredient (~50% dari typical daily usage).
   c. Owner: bisa input initial stock saat create.
2. Login Owner → Inventory → tab Resep:
   a. Klik "Atur Resep" per menu_item, isi ingredient list per variant (kalau variant menu).
   b. Modal preview margin% — kalau marginPct < 30%, sanity check resep + harga jual.
   c. Total estimasi: 43 item × 30 detik = ~22 menit.
3. POS smoke test (login staff):
   a. Buka shift → bikin order → bayar → verify:
      - Auto-print struk (kalau printer paired di POS Pengaturan)
      - Stock berkurang di Inventory → Bahan
      - Pergerakan tab tampil row baru kind=`Penjualan`
   b. Bikin order yang trigger sold-out (e.g. order > stok available) → setelah paid, menu_item harus auto-flag is_sold_out=true.
   c. Void salah satu transaksi → stok kembali, audit log entry, Pergerakan tab tampil `Void (kembali)`.
   d. Refund cash transaction → stok kembali, expense Refund auto-create, Pergerakan tab tampil `Refund (kembali)`.
4. Reports verify:
   a. Owner login → Reports → Daily Sales → COGS muncul (atau 0 kalau hari ini belum ada paid trx pakai resep).
   b. P&L tab → 5 section: Pendapatan, HPP, Laba Kotor, Pengeluaran Operasional, Laba Bersih. Pastikan number consistent.
   c. Item Performance tab → margin% column muncul, color-coded (green ≥50%, brand ≥30%, warning ≥0%, red <0%).
   d. Export PnL PDF → check struktur sama dengan on-screen.
5. Kalau ada bug atau angka aneh, fix dulu. Kalau lancar, **mark M22.7 done** dan plan Tier 1.2 (Loyalty + Customer DB).

### 4.3 Edge cases yang sudah di-handle

- Open-price items (Manual Brew) → no recipe required, cogs=0, no deduct.
- Menu item baru tanpa resep → cogs=0, no deduct (graceful — sale tidak fail).
- Concurrent order pada bahan yang sama → atomic UPDATE Postgres serialize.
- Receipt cost_per_unit berubah after sale → COGS tetap pake snapshot saat sale (immutable historical).
- Stok jadi negatif akibat receive belum tercatat → sale tetap proses, sold-out flag auto-flip true setelah re-eval.
- Variant menu (hot+iced) dengan recipe beda → query JOIN by `(menu_item_id, variant)` tuple via `UNIQUE NULLS NOT DISTINCT`.

---

## 5. Memory Updates Sesi 6

`MEMORY.md` ditambah 2 entries:

1. **`migration-ordering-rule`** — Code deploy FIRST, DB migration SECOND untuk non-additive schema change. Reverse order break live old code. Captured from incident saat M22.1 saat gua salah urut.
2. **`vercel-deploy-mode`** — `release/phase-1` push tidak auto-deploy ke Production (Vercel project's Production Branch = main, main disabled). Manual `npx vercel --prod --yes` setiap kali butuh deploy.

Existing memory yang dipake sesi 6:
- `pause-before-destructive` — masih in force; Owner approve setiap step destructive (migration apply, prod deploy).
- `offline-only-dev-mode` — masih SUPERSEDED; production push/deploy normal cadence allowed.

---

## 6. Known Issues / Tech Debt (Updated)

### 6.1 No recipe seed data → solved by Owner manual entry (M22.7)

`ingredients` + `recipes` tables empty di prod sesi 6 end. Owner harus seed via Inventory UI (~1.5 jam total). Kalau perlu accelerate, bisa bikin `scripts/seed-inventory.ts` mirip `src/db/seed.ts`. **Decision: skip — manual entry lebih kontrol.**

### 6.2 Sold-out re-eval is best-effort (post-commit, fire-and-forget)

`reevaluateSoldOutForIngredients` runs setelah main DB transaction commit. Kalau crash di tengah, sale tetap valid tapi sold-out flag bisa lag. Owner bisa manual flag via Menu CRUD. Tracked sebagai future polish kalau jadi masalah.

### 6.3 Tidak auto-flip is_sold_out=false setelah restock

Per M22.5 design: Owner manually flips back to available untuk preserve intent. Acceptable trade-off; kalau Owner forget, item terus sold-out di POS — visible di sidebar badge. Phase 2.x mungkin tambah auto-unflip logic.

### 6.4 Modifier ingredient cost — di-skip

Per Decision D5: extra shot (+18g espresso) tidak deduct stock di Tier 1.1. Phase 2.x kalau ada impact ke akurasi.

### 6.5 Receive stock tidak auto-bikin expense

Receive stock cuma update inventory_movements + ingredient.current_stock. Owner harus manual catat di Cash → Pengeluaran kalau perlu sinkron dengan kas. Tracked sebagai Phase 2.x (Supplier + PO).

### 6.6 Integration tests masih deferred

Per AGENTS.md M18: integration tests against live DB deferred. M22.5 transaction-flow.ts + sold-out re-eval logika kompleks tapi tetap unit-test gap. Reliance pada manual smoke test in production.

### 6.7 Inventory cost_per_unit replacement-cost (no FIFO/LIFO)

Per Decision D7: cost_per_unit replaced with latest unit cost saat receive (kalau `updateCost=true`). Bukan weighted-average. Phase 2.x kalau ada concern.

### 6.8 PnlReport renamed `grossProfit` → `netProfit`

Breaking change di `PnlReport` type. PnlView + pdf-export consumer sudah di-update. Tidak ada external consumer yang ke-affect.

---

## 7. How to Resume (Sesi 7)

### 7.1 Boot prompt

```
Halo, gua mau lanjut Mahakan POS. Sesi 6 selesai dengan Phase 2 Tier 1.1
CODE-COMPLETE — semua M22.1 sampai M22.6 ter-shipped + deployed.
Sekarang masuk M22.7 = field validate (seed + smoke test).

Baca handover di docs/99-HANDOVER-SESSION-6.md sampai habis. Lalu:

  1. npm run typecheck && npm run lint && npx vitest run && npm run build
  2. curl -sI https://mahakan-pos.vercel.app/
  3. git log --oneline -1   # harus b18e3a7

Kalau semua green, kasih ringkasan + tanya gua mau:
  A. Mulai seed ingredient + recipes manual via UI bareng-bareng (gua execute,
     lo monitor + suggest list).
  B. Bikin scripts/seed-inventory.ts untuk speed up seed (tapi less control).
  C. Ada bug yang muncul dari Tier 1.1 deployment terakhir.
  D. Pindah ke Tier 1.2 Loyalty (skip field validate — TIDAK RECOMMENDED).
```

### 7.2 Context loading order

1. `MEMORY.md` (auto-loaded) — pay attention to `migration-ordering-rule` + `vercel-deploy-mode`.
2. `docs/99-HANDOVER-SESSION-6.md` (this file) — primary entry.
3. `docs/99-HANDOVER-SESSION-5.md` — sesi 5 close-out (still relevant for production state pre-Phase 2).
4. `docs/99-PHASE-2-ROADMAP.md` — Phase 2 plan + decision log.
5. `PROGRESS.md` — milestone tracker.
6. `AGENTS.md` — hard rules.

### 7.3 Before any edit

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
git status
git branch --show-current  # release/phase-1
git log --oneline -3
```

---

## 8. Phase 2 Tier 1.1 Final Status

```
M22 — Recipe/BOM + Inventory:
M22.1 Schema                        ✅ (commit 6aa280e)
M22.2 Ingredient module             ✅ (commit 6ce1253)
[POS-S Side-quest Pengaturan tab]  ✅ (commit 797abff)
M22.3 Recipe module                 ✅ (commit 4e32e05)
M22.4a Inventory UI Bahan           ✅ (commit c008ff6)
M22.4b Inventory UI Pergerakan      ✅ (commit 3c9e29e)
M22.4c Inventory UI Resep           ✅ (commit 89a9235)
M22.5 createTransaction COGS+deduct ✅ (commit 43ab0f4)
M22.6 P&L proper + margin column    ✅ (commit b18e3a7)
M22.7 Field validate                ⏸ (manual seed + smoke test)
```

Sembilan commit, satu schema migration, enam production deploy, satu insiden recovery — semua di satu sesi. Database-side infrastructure + Server Actions + UI sudah siap. Tinggal Owner seed data + jalanin sehari di kafe.

---

## 9. Important Reminders (Updated for Sesi 7)

### 9.1 Don't (still in force from sesi 5 + sesi 6)

- ❌ Don't push to main without explicit OK
- ❌ Don't force-push without explicit OK
- ❌ **Don't apply DB migration before code deploy** (per `migration-ordering-rule`)
- ❌ **Don't expect `release/phase-1` push to auto-deploy Production** (per `vercel-deploy-mode`)
- ❌ Don't commit `note` file or `.claude/`
- ❌ Don't bundle changes user didn't ask for
- ❌ Don't use `any` di TypeScript
- ❌ Don't introduce float math for money — pakai `src/lib/money.ts`
- ❌ Don't re-add server-only exports ke `@/lib/auth` barrel (build error otherwise — same lesson sebagai `@/lib/audit`)
- ❌ Don't remove `vercel.json` `git.deploymentEnabled.main = false`

### 9.2 Do (still in force)

- ✅ Verify typecheck + lint + tests + build before claim done
- ✅ Commit per logical chunk dengan conventional format
- ✅ For non-additive DB change: deploy code, verify Vercel deploy READY, lalu apply migration
- ✅ For Mahakan-specific deploy: `npx --yes vercel --prod --yes` from working dir + wait for `readyState: READY`
- ✅ Log audit untuk new mutations (use `logAudit` from `@/lib/audit/logger`)
- ✅ For inventory mutations: `logAudit` dengan event type `inventory.*`
- ✅ Reuse `printTransactionReceipt` untuk print apa pun
- ✅ Update PROGRESS.md as milestones complete
- ✅ Test in browser after major changes — kalau bisa user yang test di tablet
- ✅ Communicate progress with visual ✓/⏳/⚠️

### 9.3 Sesi 6 lessons captured

- Drizzle's `uniqueIndex(...).nullsNotDistinct()` doesn't exist; use `unique(...).nullsNotDistinct()` (table constraint).
- For partial unique with null deduplication, you trade off soft-delete: `recipes` chosen hard-delete since historical COGS is captured on `transactions.cogs`.
- `fail()` should return strict `ApiFailure` shape, not `ApiResult<never>` — improves cross-module type compatibility (helper validators that return errors).
- Server-only barrel imports: `@/lib/auth` index re-exports `auth/config.ts` which depends on `server-only`. Client components must import `hasPermission` directly from `@/lib/auth/rbac`.

---

## 10. Final Status Snapshot

```
Date:        2026-04-27 (end of sesi 6)
Branch:      release/phase-1 (HEAD b18e3a7)
Build:       ✓ 11 routes, webpack mode, 0 warnings beyond Next 16 middleware deprecation
Tests:       ✓ 33 RBAC + 32 inventory schema + 17 transaction validation +
             ~133 lainnya = ~210 total. bcrypt parallel may flake (re-run isolated).
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:  ✓ https://mahakan-pos.vercel.app (commit b18e3a7)
DB on Neon:  4 new tables (empty) + 2 cogs cols. Migration 0002 applied.

Phase 1:     ✅ PRD-COMPLETE (sesi 5)
Phase 2:
  Tier 1.1 Recipe/BOM + Inventory   ✅ CODE-COMPLETE (sesi 6)
  Tier 1.2 Loyalty + Customer DB    ⏸ next after field validate
  Tier 1.3 Promo engine             ⏸ depends on loyalty

Next action: Owner seed inventory + recipes via UI, run 1 day operasional kafe
             with Tier 1.1 active, then validate P&L numbers + COGS sanity.
```

---

## 11. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-27 | Sesi 6 → 7 handover. Captures M22.1-M22.6 implementation (9 commits, 1 schema migration, 6 production deploy) + 1 production incident recovery. Phase 2 Tier 1.1 code-complete, awaiting field validate. |

---

# 🛑 END HANDOVER SESI 6

**Phase 2 Tier 1.1 (Recipe/BOM + Inventory) infrastructure live di production. Owner needs to seed 25 ingredient + 43 recipe via UI lalu jalanin sehari di kafe untuk M22.7 field validate. Sesi 7 = seed bareng + monitor + tier 1.2 plan.**
