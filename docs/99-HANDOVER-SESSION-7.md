# 🤝 HANDOVER SESI 7 — Mahakan POS

**Untuk:** Claude AI agent (sesi 8)
**Dari:** Sesi 7 (Phase 2 Tier 1.2 kickoff — M23 Cost Engine)
**Date:** 2026-04-27
**Status:** **M23.1 schema landed di production.** Owner upload 5 spreadsheet real → kami pivot dari M22.7 manual-seed ke M23 full cost-engine redesign. Sesi 7 selesai chunk pertama (schema). Sesi 8 lanjut M23.2 cascade engine.

---

## ⚡ TL;DR

Sesi 7 punya 3 fase:

**Fase 1 — POS Settings side-quest (sebenarnya sudah selesai sesi 6)**: Handover sesi 6 ditulis untuk transition ke field validate M22.7. Owner mau seed manual via UI vs script auto-generated.

**Fase 2 — Owner upload 5 real spreadsheet** dan minta gua kritisi pendekatannya: "tolong sempurnakan sistem dan mekanismenya karena bisa saja approach sebelumnya yang gua gunakan itu keliru". Files yang di-upload:
1. `Marketlist.tsv` — 168 raw ingredient + harga + qty + unit
2. `UPDATE HPP FOOD 26042026.csv` — ~25 menu food dengan resep + Q Factor + Markup + Margin
3. `UPDATE HPP BEVERAGE 26042026.csv` — ~25 menu drink (sama struktur)
4. `PREP FOOD.csv` — 9 sub-recipe yang yield "computed ingredient" (Prep-Nasi, Prep-Churros, Prep-Saus-Coklat, Prep-Sambal-Matah, Prep-Asam-Manis, Prep-Ayam-Popcorn, Prep-Scramble-Egg, Prep-Bumbu-Bakmie, Prep-Ayam-Panggang, Prep-Kuah-Bakmie, Prep-Chili-Oil, Prep-Chicken)
5. `PREP BEVERAGE.csv` — 6 sub-recipe (Prep-Creamer, Prep-Gula-Aren, Prep-Espresso-HB, Prep-Cold-Brew, Prep-Simple-Syrup, Prep-Espresso-Arabica, Prep-Liquid-Tea, Prep-Extract-Lemon)

Plan agent di-engaged untuk validate design. Result: **M22.7 manual-seed superseded by M23 full cost-engine** dengan 10 keputusan locked. Plan file: `/Users/macbookpro/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md`.

**Fase 3 — M23.1 schema landed**:
- 1 commit (`094dca3`) + 1 migration (`0003_absent_metal_master.sql`) applied
- Backup pre-migration (GHA run 24999330539, success 47s)
- Schema verified on Neon (5/5 checks pass)
- Production deployed; HTTP/2 200

**Yang harus dikerjain sesi 8 (M23.2-M23.5):**
- M23.2: Cost cascade engine + recursive leaf expand + split movements (~1 sesi)
- M23.3: UI Preparations tab + COGS Calculator widget + Recipe editor enhancements (~1.5 sesi)
- M23.4: TSV Importer CLI script (~1 sesi)
- M23.5: Import dry-run + Owner reconcile + apply + handover (~0.5 sesi)

Total sisa Tier 1.2: ~4 sesi.

---

## 1. Production State (akhir sesi 7)

### 1.1 URLs

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest immutable | M23.1 deployment 2026-04-27 (commit `094dca3`) |

Dashboard: https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos

### 1.2 Branch + deploy

- `release/phase-1` HEAD `094dca3` — local + remote synced.
- `main` HEAD `cd98828` — backlog (vercel.json + workflow only).
- **Production deploy IS MANUAL** — push tidak auto-deploy. Setelah push, jalanin `npx --yes vercel --prod --yes` dari working dir.

### 1.3 DB state (Neon, Singapore)

- Migration sequence: `0000_cute_vector` (Phase 1 M8) → `0001_cute_iron_fist` (sesi 5 approver tokens) → `0002_glossy_prodigy` (sesi 6 inventory base) → `0003_absent_metal_master` (sesi 7 prep + waste).
- Tabel sekarang punya: `ingredients` (17 cols, including `is_preparation`, `preparation_yield`, `cost_last_changed_at`), `recipes` (12 cols, including nullable `menu_item_id`, `ingredient_id`, `waste_factor_pct`), `recipe_ingredients`, `inventory_movements` — **all empty di production**, Owner belum import.
- Backup terakhir: GHA run 24999330539 pre-M23.1 migration.

### 1.4 GitHub repo state

Sama dengan akhir sesi 6: `gh` CLI di `/tmp/gh_2.62.0_macOS_amd64/bin/gh`, `DATABASE_URL_BACKUP` secret, weekly cron Sunday 09:00 WIB.

---

## 2. What Changed Sesi 7

### 2.1 1 commit

| Commit | Summary |
|---|---|
| `094dca3` | `feat(db): preparations + waste factor + recipe XOR (M23.1)` — schema extension; 8 file changed; migration `0003_absent_metal_master.sql` |

### 2.2 Schema delta (already migrated)

`ingredients` (3 new cols + 2 CHECK):
- `is_preparation BOOLEAN NOT NULL DEFAULT FALSE`
- `preparation_yield BIGINT NULL` (only when is_preparation=true)
- `cost_last_changed_at TIMESTAMPTZ NULL`
- `ck_ingredients_prep_yield_required` (is_preparation=true → preparation_yield NOT NULL)
- `ck_ingredients_prep_yield_pos` (preparation_yield > 0 if not null)

`recipes` (2 new cols + structural change + 2 CHECK + 3 partial unique):
- `menu_item_id` relaxed NOT NULL → nullable
- `ingredient_id UUID NULL REFERENCES ingredients(id)` (when set, recipe targets a preparation)
- `waste_factor_pct INT NOT NULL DEFAULT 30`
- `ck_recipes_target_xor` (exactly one of menu_item_id OR ingredient_id NOT NULL)
- `ck_recipes_waste_range` (0-200)
- Old UNIQUE `ux_recipes_menu_variant` REPLACED with 3 partial uniques:
  - `ux_recipes_menu_variant_set` ON `(menu_item_id, variant)` WHERE both NOT NULL — variant items
  - `ux_recipes_menu_no_variant` ON `(menu_item_id)` WHERE variant IS NULL — fixed items
  - `ux_recipes_preparation` ON `(ingredient_id)` WHERE NOT NULL — prep recipes

### 2.3 Audit registry (already shipped)

6 new event types + 2 entity types under inventory.preparation.* + inventory.cost.cascade + inventory.import.run.

### 2.4 Code adjustments untuk nullable menu_item_id

3 callers diadjust agar typecheck pass:
- `src/features/inventory/transaction-flow.ts` `reevaluateSoldOutForIngredients` — JOIN filter `isNotNull(menuItemId)`, narrow type after map
- `src/features/admin/sections/inventory/RecipesList.tsx` — skip preparation recipes (menuItemId IS NULL) dari menu Resep view
- `src/features/inventory/actions.ts` `updateRecipe` — skip variant validation untuk prep recipes (D5)

---

## 3. The 5 Spreadsheet Files (Owner data)

**Belum disimpan ke disk repo.** Owner upload via chat as document attachments. Sesi 8 akan butuh untuk M23.4 importer.

**Action sesi 8:**
- Boot prompt asks Owner re-upload OR Owner save di lokal `data/source-spreadsheets/` (gitignored).
- Importer script `scripts/import-mahakan-data.ts` (M23.4) baca dari path tersebut.

**Struktur yang harus di-handle parser:**
- Indonesian number format: `Rp 57.000` → 57000, `1.000` → 1000
- TSV/CSV mixed (Marketlist=TSV, others=CSV)
- "Q FACTOR 30%" footer extraction
- Multi-table layout per file (one menu per recipe block)
- Preparation references by name (e.g., "Prep - Espresso HB" used by menu recipe)
- Variant detection: "Iced Americano" / "Hot Americano" → split to base="Americano" + variant=iced/hot

---

## 4. Decisions Locked (M23 plan, copied for quick reference)

Plan file `/Users/macbookpro/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md` punya detail lengkap + rationale per decision.

| ID | Decision | Status |
|---|---|---|
| D1 | Preparations as flagged ingredients (not separate table) | Implemented in M23.1 |
| D2 | Q Factor per-recipe (not per-ingredient), default 30 menu / 10 prep | Schema in M23.1; logic in M23.2 |
| D3 | Stock deduction WITH waste factor + split into 2 movements (sale_deduct lean + waste buffer) | M23.2 |
| D4 | Recursive cost cascade + cycle detection + advisory lock | M23.2 |
| D5 | No variant on preps (separate prep ingredient if needed) | Schema in M23.1; logic in M23.2 |
| D6 | Multi-channel pricing display only (no schema field) | M23.3 UI |
| D7 | Importer CLI first, UI nanti | M23.4 |
| D8 | Menu engineering matrix Tier B optional (M23.6) | Defer post-M23.5 |
| D9 | Q Factor rounding = Math.round (match spreadsheet) | M23.2 / M23.4 |
| D10 | listAtomicIngredients vs listPreparations split | M23.2 backend / M23.3 UI |

---

## 5. Test Credentials & Verify

Same as sesi 5/6. Verify state commands:

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
npm run typecheck     # tsc --noEmit, must exit 0
npm run lint          # eslint clean
npx vitest run        # ~210 tests; bcrypt parallel may flake → re-run isolated if 4 fail
npm run build         # 11 routes, webpack mode
git branch --show-current   # release/phase-1
git log --oneline -1        # 094dca3 atau lebih baru
curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200
```

---

## 6. Boot Prompt for Sesi 8

```
Halo, gua mau lanjut Mahakan POS. Sesi 7 selesai dengan M23.1 schema
landed (preparations + waste factor + XOR recipes). Sekarang lanjut
M23.2 Cost cascade engine.

Baca dulu:
  1. docs/99-HANDOVER-SESSION-7.md (this file) — full context sesi 7
  2. ~/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md — full
     M23 plan with 10 decisions + sub-chunks M23.1-M23.5
  3. MEMORY.md (auto-loaded)

Verify state:
  npm run typecheck && npm run lint && npx vitest run && npm run build
  curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200
  git log --oneline -1   # 094dca3

M23.2 scope:
  - NEW: src/features/inventory/preparation-flow.ts dengan
    computePrepCost (recursive CTE), cascadeCostUpdate (advisory lock),
    detectCycle (recursive CTE refuse circular refs), expandRecipeToLeaves
  - UPDATE src/features/inventory/transaction-flow.ts:
    * computeStockFlowForOrder pakai expandRecipeToLeaves (recursive)
    * COGS = sum(leaf_qty × leaf_cost) × (1 + recipe.waste_factor / 100)
    * applyStockDeductions split jadi 2 inventory_movements per ingredient:
      kind=sale_deduct (lean qty) + kind=waste (buffer qty), both
      decrement current_stock
    * restoreStockForTransaction handle 2 movement kinds
  - UPDATE src/features/inventory/actions.ts:
    * createIngredient/updateIngredient with is_preparation support
    * updateIngredient cost change → trigger cascadeCostUpdate
    * deleteIngredient refuse if dependent menu/prep recipe
    * createRecipe/updateRecipe untuk prep target (ingredientId set)
    * Cycle detection on recipe upsert
  - NEW unit tests: tests/unit/preparation-flow.test.ts
    (cycle detection, recursive expand, cascade topological order)

After M23.2: M23.3 UI work (Preparations tab + COGS Calculator).
After M23.3: M23.4 TSV importer CLI.
After M23.4: M23.5 verify + import + Owner reconcile + handover.
```

---

## 7. Critical Files (M23.2 will modify)

| Path | Action |
|---|---|
| `src/features/inventory/preparation-flow.ts` | **NEW** — recursive CTE engine |
| `src/features/inventory/transaction-flow.ts` | UPDATE — recursive leaf expand + split movements + waste in COGS |
| `src/features/inventory/actions.ts` | UPDATE — prep CRUD + cascade triggers + cycle detect |
| `src/features/inventory/queries.ts` | UPDATE — `listAtomicIngredients`, `listPreparations`, `fetchRecipeForPreparation` |
| `src/features/inventory/types.ts` | UPDATE — Preparation type, leaf expand shape |
| `src/features/inventory/schemas.ts` | UPDATE — preparationCreateSchema, preparationUpdateSchema |
| `src/features/inventory/index.ts` | UPDATE — export new |
| `tests/unit/preparation-flow.test.ts` | **NEW** — cycle, expand, cascade |

---

## 8. Known Issues / Tech Debt (Updated)

### 8.1 Tabel inventory empty di production

`ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements` semua kosong. Owner belum import. Akan jalan via M23.4 importer setelah M23.2 + M23.3 + M23.4 lengkap.

### 8.2 Existing M22.5 transaction-flow uses single-level recipe lookup

Sekarang masih jalan apa adanya (no recipes = no COGS, default behavior). Saat M23.2 ship, transaction-flow akan switch ke recursive expand.

### 8.3 RecipesList UI menampilkan recipe gabungan (menu + prep)

Sesi 7 fix temporal: skip preparation recipes di menu Resep view. M23.3 akan ship Preparations tab dedicated.

### 8.4 5 Spreadsheet files belum di-disk

Akan dibutuhkan sesi 8 saat M23.4. Owner harus re-attach atau save di local repo `data/source-spreadsheets/`.

### 8.5 Single-flight cascade lock

Per design D4: `cost-cascade-{outletId}` advisory lock. Implementasi di M23.2.

---

## 9. Memory Updates Sesi 7

`MEMORY.md` ditambah pointer:
- `session7-closeout` — resume point untuk sesi 8

Existing memory yang aktif:
- `migration-ordering-rule` — code-first untuk DROP/ALTER, additive bisa apply-first
- `vercel-deploy-mode` — manual `vercel --prod` after push
- `pause-before-destructive` — explicit OK before destructive ops

---

## 10. Important Reminders

### 10.1 Don't (still in force)

- ❌ Don't push to main without explicit OK
- ❌ Don't apply non-additive DB migration before code deploy (per `migration-ordering-rule`)
- ❌ Don't expect `release/phase-1` push to auto-deploy Production (per `vercel-deploy-mode`)
- ❌ Don't commit `note` file or `.claude/`
- ❌ Don't use `any` di TypeScript
- ❌ Don't introduce float math for money — pakai `src/lib/money.ts`
- ❌ Don't re-add server-only exports ke `@/lib/auth` barrel
- ❌ Don't use Drizzle `uniqueIndex().nullsNotDistinct()` chained — gak ada (lesson sesi 6 confirmed sesi 7)

### 10.2 Do (still in force)

- ✅ Verify typecheck + lint + tests + build before claim done
- ✅ Commit per logical chunk dengan conventional format
- ✅ For non-additive DB change: deploy code, verify Vercel deploy READY, lalu apply migration
- ✅ For Mahakan-specific deploy: `npx --yes vercel --prod --yes` from working dir + wait for `readyState: READY`
- ✅ Backup via GHA workflow before any DB migration (additive or not)
- ✅ Audit log untuk every mutation
- ✅ Update PROGRESS.md as milestones complete

### 10.3 Sesi 7 lessons captured

- Drizzle `uniqueIndex().on().nullsNotDistinct()` masih gak ada di Drizzle ORM versi sekarang. Workaround: 2 partial unique indexes `(col, var)` WHERE var NOT NULL + `(col)` WHERE var IS NULL.
- Plan agent push-back saved a bad design: lean-only stock deduct → drift; recommended split-into-2-movements pattern.
- Plan mode → ExitPlanMode workflow harus di-respect; user explicitly disable plan-related interruptions kalau perlu.

---

## 11. Final Status Snapshot

```
Date:        2026-04-27 (end of sesi 7)
Branch:      release/phase-1 (HEAD 094dca3)
Build:       ✓ 11 routes, webpack mode
Tests:       ✓ existing 210+ pass; new test file pending M23.2
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:  ✓ https://mahakan-pos.vercel.app (commit 094dca3)
DB on Neon:  Migration 0003 applied. ingredients + recipes have new cols.
             Tables empty (Owner data import via M23.4).
Backup:      GHA run 24999330539 pre-migration (47s success)

Phase 2:
  Tier 1.1 Recipe/BOM + Inventory  ✅ CODE-COMPLETE (sesi 6)
  Tier 1.2 Cost Engine M23         🔄 M23.1 done; M23.2-M23.5 pending
  Tier 1.3 Loyalty + Customer DB   ⏸ defer until Tier 1.2 ship + 1 week stable

Next action: M23.2 Cost cascade engine — recursive CTE + cycle detect +
             split inventory movements + advisory lock + COGS waste factor.
             ~1 sesi work, complex; better to start with focus.
```

---

## 12. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-27 | Sesi 7 → 8 handover. Captures pivot from M22.7 manual-seed to M23 cost engine after Owner uploaded real spreadsheets. M23.1 schema landed (preparations + waste factor + recipe XOR). 1 commit + 1 migration + production deploy. |

---

# 🛑 END HANDOVER SESI 7

**Schema foundation untuk M23 cost engine sudah tertanam. Sesi 8 lanjut M23.2 — recursive CTE cascade + split movement audit. Plan file di `~/.claude/plans/` punya 10 decisions terlocked. Boot prompt di §6 ready untuk dipakai.**
