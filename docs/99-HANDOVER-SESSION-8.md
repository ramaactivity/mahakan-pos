# 🤝 HANDOVER SESI 8 — Mahakan POS

**Untuk:** Claude AI agent (sesi 9)
**Dari:** Sesi 8 (Phase 2 Tier 1.2 — M23.2 Cost Cascade Engine)
**Date:** 2026-04-27
**Status:** **M23.2 cascade engine code-complete locally** (3 commits di `release/phase-1`, NOT yet pushed/deployed). Schema dari M23.1 sudah live di production sejak sesi 7 — code M23.2 aman di-defer karena tabel inventory di prod masih kosong (backwards-compatible: existing single-level recipe tetap jalan; new prep features inert sampai data di-import). Sesi 9 lanjut M23.3 UI.

---

## ⚡ TL;DR

Sesi 8 = full focus M23.2 backend + tests. 10 sub-step plan eksekusi tertib, 3 commit logical chunk, 232/232 tests pass, build 11 routes clean.

**Yang ship:**
- 5 spreadsheet Owner di-save ke `data/source-spreadsheets/` (gitignored). Importer M23.4 baca dari sini.
- Pure helpers (4 fn + 23 unit tests): `computePrepCostFromLines`, `splitLineForMovement`, `aggregateExpansion`, `validateNoCycle`.
- DB-touching helpers: `expandRecipeToAtomicLeaves` (recursive CTE), `detectCycleForRecipeUpsert` (recursive CTE dengan conditional exclude clause), `cascadeCostUpdate` (advisory lock + dependent-prep recompute), `computePrepCost` (recursive dengan dual `inProgress`+`computed` Map).
- Action hooks: cascade trigger di `updateIngredient`/`receiveStock` (atomic cost change), prep `createRecipe`/`updateRecipe` cycle detect + cascade, `deleteIngredient`/`deleteRecipe` refuse-with-dependents.
- Transaction flow: split sale_deduct + waste movements per atomic ingredient, recursive leaf expand di `computeStockFlowForOrder`, 1 combined restore movement per ingredient di void/refund, recursive sold-out re-eval (atomic + via prep dep).
- Schema/types/RBAC: extended dengan `isPreparation`/`preparationYield`/`wasteFactorPct`, 4 new `inventory.preparation.*` permissions.

**Yang harus dikerjain sesi 9 (M23.3 UI):**
- Preparations tab di Inventory section (list + form modal)
- COGS Calculator widget (modal di Inventory section)
- Recipe editor enhancements: waste factor field, grouped select (atomic vs preps), banded margin, GRABGOSO ×1.30 channel pricing display
- Filter `IngredientsList` ke atomic-only (preparations terpisah di tab dedicated)

Plan file referensi: `~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md` (decisions + sub-step ordering + appendix CTE SQL).

---

## 1. Production State (akhir sesi 8)

### 1.1 URLs

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest immutable | M23.1 deployment 2026-04-27 (commit `094dca3`) — **TIDAK ADA deploy baru sesi 8** |

### 1.2 Branch + deploy

- `release/phase-1` HEAD `e081f7f` — local only, **NOT pushed ke remote**.
- 3 commit M23.2 dari sesi 8:
  - `2000df6` — Foundation: pure helpers + DB CTE + types/schemas/queries/rbac/index/.gitignore + 23 unit tests
  - `e2fe24f` — Action hooks: cascade trigger + cycle detect + delete guards
  - `e081f7f` — Transaction flow: split movements + recursive leaf expand + recursive sold-out re-eval
- Production tetap `094dca3` (M23.1 schema only). Code M23.2 aman ditunda — backwards-compatible.

### 1.3 DB state (Neon, Singapore)

- Migration `0003_absent_metal_master` (sesi 7) tetap last-applied. **Tidak ada migration baru sesi 8.**
- Tabel `ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements` masih kosong di production. Owner data import via M23.4.
- Backup terakhir: GHA run 24999330539 pre-M23.1 migration.

### 1.4 5 Spreadsheet Owner (saved sesi 8)

`data/source-spreadsheets/` (gitignored):
- `Marketlist.tsv` (168 raw ingredient)
- `PREP_FOOD.csv` (12 sub-recipe food)
- `PREP_BEVERAGE.csv` (6 sub-recipe beverage)
- `UPDATE_HPP_FOOD_26042026.csv` (~25 menu food)
- `UPDATE_HPP_BEVERAGE_26042026.csv` (~25 menu drink)

Importer M23.4 baca dari sini. Path baru — added ke `.gitignore` di chunk 1.

---

## 2. What Changed Sesi 8

### 2.1 3 commits (in order)

| Commit | Summary | Files | Lines |
|---|---|---|---|
| `2000df6` | `feat(inventory): cascade engine + recursive expansion foundation (M23.2 1/3)` | 9 files | +882 / −15 |
| `e2fe24f` | `feat(inventory): wire cascade + cycle detection + delete guards (M23.2 2/3)` | 1 file (actions.ts) | +273 / −41 |
| `e081f7f` | `feat(transactions): split movements + recursive leaf expansion at sale time (M23.2 3/3)` | 2 files | +239 / −121 |

Total: 12 files touched, ~1394 insertions, ~177 deletions, 3 new files (`preparation-flow.ts`, `preparation-flow-pure.ts`, `tests/unit/preparation-flow.test.ts`).

### 2.2 Key architectural decisions resolved (selama sesi 8)

Plan agent + Plan mode validation menghasilkan refinement vs plan awal:

1. **CTE outlet + soft-delete + depth scoping** — semua 3 recursive CTE filter `r.outlet_id = $outletId AND r.is_active = true AND i.deleted_at IS NULL AND depth < 10`. Defense-in-depth meskipun cycle detect di upsert mencegah depth blow-up.
2. **Conditional SQL fragment for "exclude edited recipe"** — `($recipeId::uuid IS NULL OR r.id != $recipeId)` instead of UUID nil sentinel. Cleaner, no magic constants.
3. **Dual visited tracking di cascade**: `inProgress: Set<string>` (cycle defense, throws CYCLE_DURING_CASCADE) + `computed: Map<string, number>` (memoize untuk diamond deps).
4. **Refuse-with-dependents on delete** — both `deleteIngredient` (any ref) and `deleteRecipe` (prep recipe + ingredient referenced elsewhere). Owner-trust > convenience.
5. **Restore movement shape (user-confirmed)**: 1 combined `void_restore`/`refund_restore` per ingredient dengan `qty_delta = lean + waste`, reason 'incl. waste buffer'. Sale-side tetap 2 movement. 2 deduct rows + 1 restore row per ingredient.
6. **Stock-deduction split convention**: `total = round(rawQty × (1 + waste/100))`, `lean = round(rawQty)`, `waste = total − lean`. Total = ground truth, waste = derived.
7. **Pure / DB split** — pure helpers di `preparation-flow-pure.ts` (no `server-only`), DB-touching di `preparation-flow.ts`. Vitest dapat import pure tanpa server-only error; importer M23.4 + nanti M23.3 client COGS calculator bisa pakai pure helpers tanpa Postgres deps.
8. **Forbid `isPreparation` toggle** setelah create — schema doesn't accept it on update. Allow `preparationYield` change (triggers cascade).
9. **0-cost prep edge case** — prep yang dipakai di menu sebelum recipe-nya dibuat: COGS jadi 0 sementara, cascade auto-fix begitu recipe ada. UI warning deferred ke M23.3.

### 2.3 New audit events (live, dari sesi 7 M23.1)

Dipakai sesi 8:
- `inventory.preparation.create` — di `createIngredient` (kalau prep) + `createRecipe` (kalau target prep)
- `inventory.preparation.update` — di `updateIngredient` (kalau prep) + `updateRecipe` (kalau prep recipe)
- `inventory.preparation.delete` — di `deleteRecipe` (kalau prep recipe)
- `inventory.preparation.recompute` — di `computePrepCost` (per prep saat cost berubah)
- `inventory.cost.cascade` — 1× per cascade run di `cascadeCostUpdate`
- `inventory.import.run` — belum dipakai (M23.4 importer)

---

## 3. File-Level Changes

| File | Action | Notes |
|---|---|---|
| `src/features/inventory/preparation-flow-pure.ts` | NEW | 4 pure helpers, importable in vitest + browser |
| `src/features/inventory/preparation-flow.ts` | NEW | Server-only DB CTE engine; `DbOrTx` type widening untuk `expandRecipeToAtomicLeaves` panggilan dari `reevaluateSoldOutForIngredients` (post-tx) |
| `src/features/inventory/transaction-flow.ts` | REWRITE | `computeStockFlowForOrder` ambil `outletId` arg baru; `applyStockDeductions` split jadi 2 movement; `restoreStockForTransaction` query both kinds → 1 combined restore; `reevaluateSoldOutForIngredients` walk via direct atomic + via dependent prep + atomic-leaf expand untuk feasibility |
| `src/features/inventory/actions.ts` | EXTEND | createIngredient (prep flag), updateIngredient (tx + cascade), receiveStock (cascade in tx), createRecipe (branch menu vs prep, cycle detect, cascade), updateRecipe (waste field, prep cycle detect, cascade, prep audit events), deleteIngredient (refuse with dependents), deleteRecipe (refuse if prep has deps, prep audit) |
| `src/features/inventory/queries.ts` | EXTEND | `fetchAtomicIngredients`, `fetchPreparations`, `fetchRecipeForPreparation` |
| `src/features/inventory/schemas.ts` | EXTEND | createIngredient {isPreparation, preparationYield + refine}; updateIngredient {preparationYield}; createRecipe XOR refine + waste field; updateRecipe + waste field |
| `src/features/inventory/types.ts` | EXTEND | Preparation, RecipeNode, RecipeTarget, LeafExpansion |
| `src/features/inventory/index.ts` | UPDATE | export new types + pure helpers |
| `src/lib/auth/rbac.ts` | EXTEND | 4 inventory.preparation.* permissions |
| `src/features/transactions/actions.ts` | TOUCH | pass outletId ke `computeStockFlowForOrder` |
| `tests/unit/preparation-flow.test.ts` | NEW | 23 cases (math edges, rounding convention, cycle detection scenarios) |
| `.gitignore` | TOUCH | `/data/source-spreadsheets/` block |

---

## 4. Test Status

```
typecheck: ✓ (tsc --noEmit clean)
lint:      ✓ (eslint clean)
vitest:    ✓ 232/232 (12 files; 209 existing + 23 new)
build:     ✓ 11 routes, webpack mode
```

New unit test cases coverage:
- `computePrepCostFromLines` (6 cases): single line, multi-line, zero waste, yield=1, throws on yield≤0, empty lines
- `splitLineForMovement` (6 cases): zero waste, standard 30%, fractional raw, zero raw, negative raw, sweep convention check
- `aggregateExpansion` (4 cases): sum-then-round-once, single fractional, multi-ingredient independent, empty
- `validateNoCycle` (7 cases): empty, self, indirect 2-hop, deep chain 3-hop, diamond non-cycle, unrelated, exclusion semantics

---

## 5. Decisions LOCKED dari Sesi 8 (additive ke 10 dari sesi 7)

| ID | Decision | Why |
|---|---|---|
| **D11** | Split-into-2-files: `preparation-flow.ts` (server-only) + `preparation-flow-pure.ts` (pure) | Vitest can't load `server-only`. Pure helpers reusable di importer M23.4 + browser COGS calculator M23.3. |
| **D12** | 1 combined restore movement per ingredient (qty = lean + waste) | User-confirmed via AskUserQuestion. Audit log lebih ringkas; total math correct (2 deduct rows + 1 restore row). |
| **D13** | Stock split convention: `total = round(raw × (1+w/100))`, `waste = total − lean` | Total = ground truth, waste derived. Avoids drift dari independent rounding. |
| **D14** | `DbOrTx` type widening untuk `expandRecipeToAtomicLeaves` | `reevaluateSoldOutForIngredients` runs post-commit (out of tx) but needs the same CTE. Type widening cleaner than tx-wrapper just for re-eval. |
| **D15** | Forbid `isPreparation` toggle in updateIngredient | Schema doesn't accept the field. Owner harus delete-recreate kalau salah set. Avoids invariant chaos. |
| **D16** | 0-cost prep used in menu before recipe = silent COGS=0 | Cascade auto-fixes once recipe ada. UI warning deferred ke M23.3. |

---

## 6. Boot Prompt for Sesi 9

```
Halo, gua mau lanjut Mahakan POS. Sesi 8 selesai dengan M23.2 cascade
engine code-complete locally (3 commits di release/phase-1). Sekarang
lanjut M23.3 UI work.

Baca dulu:
  1. docs/99-HANDOVER-SESSION-8.md (this file) — full context sesi 8
  2. ~/.claude/plans/halo-gua-mau-lanjut-gleaming-fern.md — M23.2 plan
     (decisions D11-D16 + appendix CTE shapes)
  3. ~/.claude/plans/halo-gua-mau-lanjut-twinkling-bentley.md — M23 root
     plan (10 decisions D1-D10 dari sesi 7)
  4. MEMORY.md (auto-loaded)

Verify state:
  npm run typecheck && npm run lint && npx vitest run && npm run build
  curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200 (production
                                              # masih M23.1 — code M23.2
                                              # belum di-deploy)
  git log --oneline -3   # e081f7f, e2fe24f, 2000df6 expected
  ls data/source-spreadsheets/   # 5 file expected (gitignored)

M23.3 scope (~1.5 sesi work):
  - NEW: src/features/admin/sections/inventory/PreparationsList.tsx
  - NEW: src/features/admin/sections/inventory/PreparationFormModal.tsx
  - NEW: src/features/admin/sections/inventory/CogsCalculatorWidget.tsx
  - UPDATE src/features/admin/sections/InventorySection.tsx — tab
    "Preparations" + COGS Calculator button
  - UPDATE src/features/admin/sections/inventory/IngredientsList.tsx
    — filter atomic only (preparations punya tab terpisah)
  - UPDATE src/features/admin/sections/inventory/RecipeEditorModal.tsx
    — waste factor field + grouped select atomic vs preps + live cost
    preview includes waste + GRABGOSO 30% display (selling × 1.30)
  - UPDATE src/features/admin/sections/inventory/RecipesList.tsx —
    waste_factor di row + recipe-level margin badge

After M23.3: M23.4 TSV importer CLI (script/import-mahakan-data.ts)
              akan baca dari data/source-spreadsheets/.
```

---

## 7. Critical Files (M23.3 will touch)

| Path | Action | Existing pattern to reuse |
|---|---|---|
| `src/features/admin/sections/inventory/PreparationsList.tsx` | NEW | clone `IngredientsList.tsx` shape |
| `src/features/admin/sections/inventory/PreparationFormModal.tsx` | NEW | clone `IngredientFormModal.tsx` + add yield + recipe builder embedded |
| `src/features/admin/sections/inventory/CogsCalculatorWidget.tsx` | NEW | reuse `computePrepCostFromLines` + `splitLineForMovement` from `@/features/inventory` barrel |
| `src/features/admin/sections/InventorySection.tsx` | UPDATE | add tab + button |
| `src/features/admin/sections/inventory/IngredientsList.tsx` | UPDATE | switch `listIngredients` → `fetchAtomicIngredients` (already in queries.ts) |
| `src/features/admin/sections/inventory/RecipeEditorModal.tsx` | UPDATE | wasteFactorPct field + grouped select via `fetchAtomicIngredients` + `fetchPreparations` |
| `src/features/admin/sections/inventory/RecipesList.tsx` | UPDATE | margin/cost% banded color (sama seperti M22.6 P&L) |
| `src/features/inventory/actions.ts` | TOUCH | maybe add `listPreparations` server action wrapper |

---

## 8. Known Issues / Tech Debt

### 8.1 Tabel inventory empty di production

Sama dengan akhir sesi 7. M23.4 importer akan populate. M23.2 code aman dideploy kapan saja (backwards-compatible: existing single-level menu recipe path tetap jalan; prep-related code paths inert sampai data di-import).

### 8.2 No prod deploy sesi 8

Sengaja. Per `migration-ordering-rule` + `vercel-deploy-mode`: code M23.2 punya zero schema impact (M23.1 sudah landed), jadi technically aman deploy. Tapi karena masih ada M23.3 UI + M23.4 importer yang akan ship sebelum data populate, defer deploy ke M23.5 (single Owner-facing release moment).

### 8.3 Production push pending

`release/phase-1` HEAD `e081f7f` belum di-push ke remote (sesuai memory `pat-handling-preference` — user prefer push via own terminal). Sesi 9 boleh push setelah confirm OK.

### 8.4 No DB-touching tests for new CTE engines

Per plan agent rec + project culture: pure-helper tests cover algorithm correctness; CTE-touching code di-validate manual saat M23.5 deploy + import data nyata. Kalau Owner experience drift, fallback adalah inspect cascade behavior via Drizzle Studio + Inventory UI.

### 8.5 `note` file di working tree

Untracked. Bukan part dari M23 — leave alone.

---

## 9. Memory Updates Sesi 8

`MEMORY.md` belum di-update sesi 8 (tidak ada user feedback baru atau project state lasting beyond sesi). Update yang akan ditambah saat handover diserap:
- `session8-closeout` — resume point untuk sesi 9 (M23.3)

Existing memory yang masih aktif:
- `migration-ordering-rule` — code-first untuk DROP/ALTER, additive bisa apply-first
- `vercel-deploy-mode` — manual `vercel --prod` after push
- `pause-before-destructive` — explicit OK before destructive ops
- `pat-handling-preference` — user push via own terminal

---

## 10. Important Reminders

### 10.1 Don't (still in force)

- ❌ Don't push to main without explicit OK
- ❌ Don't apply non-additive DB migration before code deploy (per `migration-ordering-rule`)
- ❌ Don't expect `release/phase-1` push to auto-deploy Production (per `vercel-deploy-mode`)
- ❌ Don't commit `note` file or `.claude/`
- ❌ Don't use `any` di TypeScript
- ❌ Don't introduce float math for money — pakai `src/lib/money.ts`
- ❌ Don't deploy M23.2 to production sebelum M23.3 + M23.4 + Owner data ready (single release window di M23.5)

### 10.2 Do (still in force)

- ✅ Verify typecheck + lint + tests + build before claim done
- ✅ Commit per logical chunk dengan conventional format
- ✅ For non-additive DB change: deploy code, verify Vercel deploy READY, lalu apply migration
- ✅ For Mahakan-specific deploy: `npx --yes vercel --prod --yes` from working dir + wait for `readyState: READY`
- ✅ Backup via GHA workflow before any DB migration
- ✅ Audit log untuk every mutation
- ✅ Update PROGRESS.md as milestones complete

### 10.3 Sesi 8 lessons captured

- **`server-only` blocks vitest** — pure helpers harus di-extract ke file terpisah agar testable. Future: any new server-only module dengan testable algorithms harus split.
- **Drizzle CTE typing** — `tx.execute(sql\`...\`)` returns dengan shape `{ rows: ... }` atau direct array depending on driver. Pakai dual-cast pattern: `(result as { rows: T[] }).rows ?? (result as T[])` untuk safety. Di-document di preparation-flow.ts.
- **`DbOrTx` type widening** untuk fungsi yang kadang dipakai dalam tx kadang post-commit (e.g. sold-out re-eval) — clean alternative ke wrapping in dummy tx.
- **3-chunk commit boundary** matches sub-step ordering: foundation (low risk) → action hooks (cost-edit behavior) → sale-time (sale behavior). User dapat revert intermediate commit kalau ada surprise di prod tanpa kehilangan foundation.

---

## 11. Final Status Snapshot

```
Date:        2026-04-27 (end of sesi 8)
Branch:      release/phase-1 (HEAD e081f7f, NOT pushed)
Build:       ✓ 11 routes, webpack mode
Tests:       ✓ 232/232 (209 existing + 23 new preparation-flow tests)
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:  ✓ https://mahakan-pos.vercel.app (commit 094dca3 from sesi 7)
DB on Neon:  Migration 0003 (sesi 7) applied. Tables empty.
             No new migration sesi 8.
Backup:      GHA run 24999330539 pre-M23.1 (still last)

Phase 2:
  Tier 1.1 Recipe/BOM + Inventory  ✅ CODE-COMPLETE (sesi 6)
  Tier 1.2 Cost Engine M23         🔄 M23.1 + M23.2 done; M23.3-M23.5 pending
  Tier 1.3 Loyalty + Customer DB   ⏸ defer until Tier 1.2 ship + 1 week stable

Next action: M23.3 UI — Preparations tab + COGS Calculator + recipe editor
             enhancements. ~1.5 sesi work. After M23.3: M23.4 importer CLI.
```

---

## 12. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-27 | Sesi 8 → 9 handover. M23.2 cascade engine code-complete locally (3 commits). 232/232 tests pass. 5 spreadsheet Owner saved. No production deploy — defer to M23.5. |

---

# 🛑 END HANDOVER SESI 8

**M23.2 cascade engine + recursive expansion + split movements + cycle detect terbangun penuh dengan 23 unit tests + manual verify path. Schema sudah live di prod (sejak M23.1 sesi 7); code M23.2 aman di-defer karena tabel inventory masih kosong di prod. Sesi 9 lanjut M23.3 UI: Preparations tab + COGS Calculator + recipe editor enhancements. Boot prompt di §6 ready untuk dipakai.**
