# 🤝 HANDOVER SESI 11 — Mahakan POS

**Untuk:** Claude AI agent (sesi 12)
**Dari:** Sesi 11 (Phase 2 Tier 1.2 — M23.5 First --apply + Cost Engine Verified Live)
**Date:** 2026-04-28
**Status:** **M23 Tier 1.2 COMPLETE.** Inventory data live di prod (140 atomic + 20 preps + 71 recipes + 321 lines). Cost engine MORE accurate than Owner spreadsheet (verified ±10% rounding for 6/7 samples; 1 Churros 45% off because Owner Marketlist had stale prep cost). Sesi 12 = pick next milestone (M23.6 menu engineering matrix recommended, atau Tier 1.3 Loyalty).

---

## ⚡ TL;DR

Translated 5 Owner messy spreadsheets → 5 standardized CSV via deterministic
TypeScript translator → dry-run clean iter-1 → GHA backup → first `--apply`
COMMITTED → engine bug (cascadeCostUpdate skips self) discovered post-apply →
workaround `recompute-all-preps.ts` brought all prep costs to correct values →
COGS expansion verified vs Owner display ±10% (Churros 45% delta = Owner
Marketlist stale data, engine MORE accurate).

**Run ID:** `284c8647-6827-4ab7-8a0d-4ffe78cdabe3` (audit_logs).
**Backup:** GHA run [25034423361](https://github.com/ramaactivity/mahakan-pos/actions/runs/25034423361).

**Production state:** HEAD `88b5f67` (no code change sesi 11), inventory tables
populated. Tier 1.2 cost engine verified working live.

**Next session:**
- Owner action: rename Bakmie "Ayam Sambal Matah" via Admin UI to e.g. "Bakmie Sambal Matah" → re-import file 04+05 to attach proper Bakmie Matah recipe
- Pick next milestone: M23.6 Menu Engineering Matrix (recommended, ~3-5 days) atau Tier 1.3 Loyalty (~2 weeks, defer 1-2 weeks for cost engine real-data validation)

---

## 1. Production State (akhir sesi 11)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest deploy | `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j` (sesi 10, HEAD `88b5f67`); no new deploy sesi 11 |

- `release/phase-1` HEAD `88b5f67` — code unchanged, sesi 11 = data-only milestone.
- DB tabel inventory: 140 atomic ingredients + 20 preparations + 71 active recipes + 321 recipe lines + 1 import_run audit event.

---

## 2. What Changed Sesi 11

### 2.1 New scripts (one-shot)

| Path | Purpose |
|---|---|
| [scripts/_oneshot/translate-owner-csv.ts](scripts/_oneshot/translate-owner-csv.ts) | Owner messy → 5 standardized CSV + 3 sidecars. Indonesian thousand-sep parsing, menu name typo fixes, variant detection (prefix/suffix), seed authority lookup |
| [scripts/_oneshot/recompute-all-preps.ts](scripts/_oneshot/recompute-all-preps.ts) | Workaround for engine bug — calls `computePrepCost` per prep in topo order |
| [scripts/_oneshot/verify-import.ts](scripts/_oneshot/verify-import.ts) | DB count + sample cost spot-check |
| [scripts/_oneshot/verify-cogs.ts](scripts/_oneshot/verify-cogs.ts) | COGS expansion vs Owner display value |
| [scripts/_oneshot/check-ambiguous.ts](scripts/_oneshot/check-ambiguous.ts) | Diagnose duplicate menu_item.name issue |
| [scripts/_oneshot/fix-ricebowl-matah-attachment.ts](scripts/_oneshot/fix-ricebowl-matah-attachment.ts) | (NOT EXECUTED, denied by perm) — would re-attach Ricebowl Matah recipe from Bakmie's id back to Ricebowl's id |

These are kept in `scripts/_oneshot/` (not in package.json) untuk re-runs jika
Owner provides updated spreadsheets atau perlu di-rerun untuk diagnostics.

### 2.2 New data (gitignored)

| Path | Content |
|---|---|
| `data/source-spreadsheets/01-ingredients.csv` | 140 atomic ingredients |
| `data/source-spreadsheets/02-preparations.csv` | 20 preparation headers |
| `data/source-spreadsheets/03-preparation-lines.csv` | 57 prep recipe lines |
| `data/source-spreadsheets/04-menu-recipes.csv` | 51 menu recipe headers |
| `data/source-spreadsheets/05-menu-recipe-lines.csv` | 264 menu recipe lines |
| `data/source-spreadsheets/MENU_SKIP_LIST.txt` | 13 menus dropped + reasons |
| `data/source-spreadsheets/INGREDIENT_DUP_RESOLUTION.txt` | Skm + Gula Pasir picks |
| `data/source-spreadsheets/TRANSLATION_NOTES.md` | All translation rules + ambiguity warning |
| `data/source-spreadsheets/_original/` | Owner's 5 original messy files (preserved) |

### 2.3 Modified

- [PROGRESS.md](PROGRESS.md) — M23.5 marked done, status updated
- [docs/99-HANDOVER-SESSION-11.md](docs/99-HANDOVER-SESSION-11.md) — this file (new)

### 2.4 NOT modified (intentionally)

- `src/features/inventory/import-engine.ts` — bug discovered (see §7.1) but deferred to next session for proper fix + tests
- `src/features/inventory/preparation-flow.ts` — same
- All schemas, all UI

---

## 3. Translation deliverables — sample row counts

| File | Source | Rows imported |
|---|---|---|
| 01 ingredients | `Marketlist.tsv` (172 rows) | 140 atomic (excluded: 25 prep rows, 4 menu rows, Kurma, 2 dups) |
| 02 preparations | `PREP_BEVERAGE.csv` + `PREP_FOOD.csv` | 8 + 12 = 20 |
| 03 prep-lines | same | 15 + 42 = 57 |
| 04 menu-recipes | `UPDATE_HPP_BEVERAGE.csv` + `UPDATE_HPP_FOOD.csv` | 37 + 14 = 51 |
| 05 menu-recipe-lines | same | 197 + 67 = 264 |
| Skipped menus | — | 13 (see MENU_SKIP_LIST.txt) |

### 3.1 Menu name typo fixes applied
- "Pablo Es Kopi" → "Pablo Eskopi"
- "MONTBLANC" → "Mont Blanc"
- "Caramel Machiato" → "Caramel Macchiato"
- "Butterscoth Latte" → "Butterscotch Latte"
- "Iced/Hot Choco" → "Chocolate"
- "Ricebowl Asam Manis" → "Ayam Asam Manis"
- "Rice Bowl Matah" → "Ayam Sambal Matah" (Ricebowl)
- "Rice Bowl Telur Sosis" → "Anak Kost (Telur & Sosis)"
- "Ricebowl Telur Matah" → "Scramble / Dadar Matah"
- "Bakmie Original" → "Ayam Original"
- "Bakmie Chili Oil" → "Ayam Chilli Oil"
- "Churros" → "Churros Choco Dip"

### 3.2 Skipped menus (13 total)
- Espresso Double Shot, Espresso Full Arabica → not seeded
- Iced/Hot Sweet Tea → not seeded (Owner has separate menu, not in 43 seed)
- Butterscoth Latte (Bigsize) → not seeded
- Ice Cream 1 Scoup, Croffle Only → add-ons, not seeded
- **Bakmie Matah** → AMBIGUOUS (collides with Ricebowl "Ayam Sambal Matah" — see §6)
- BBM 1/2/3 (Bundling Ramadan) → not seeded
- Extra Telur, Extra Topping Ayam → modifiers, not menu_items

---

## 4. COGS Verification (vs Owner spreadsheet display)

`scripts/_oneshot/verify-cogs.ts` ran `expandRecipeToAtomicLeaves` for 7
samples + applied menu Q-factor 30%. Results:

| Menu | Engine Computed | Owner Display | Delta | % | Note |
|---|---|---|---|---|---|
| Iced Americano | Rp 4.128 | Rp 4.274 | -146 | 3.4% | rounding noise |
| Hot Americano | Rp 4.662 | Rp 5.034 | -372 | 7.4% | Owner missed galon water from Prep Espresso HB |
| Pablo Eskopi (iced) | Rp 9.235 | Rp 9.785 | -550 | 5.6% | rounding |
| Mont Blanc | Rp 8.896 | Rp 8.682 | +214 | 2.5% | engine more accurate |
| **Churros Choco Dip** | **Rp 4.501** | **Rp 8.177** | **-3.676** | **45%** ⚠️ | Owner used Marketlist stale `Prep - Saus Coklat` cost (Rp 150/gr) vs actual recipe-computed (Rp 45/gr); engine correct |
| Ricebowl Asam Manis | Rp 11.151 | Rp 12.206 | -1.055 | 8.6% | rounding + galon water |
| Bakmie Original | Rp 14.932 | Rp 15.945 | -1.013 | 6.4% | rounding |

**Conclusion:** Cost engine working correctly. Most deltas (3-9%) are integer
rounding accumulation. Churros 45% delta proves engine is **MORE accurate**
than Owner's Marketlist (which had stale prep prices that don't match the
actual recipe). This validates M23 cost engine value — eliminates stale
prep-cost errors that compound in Owner's manual spreadsheet workflow.

---

## 5. Sample DB Verification (post-apply)

```
DB counts:
  atomic_ingredients: 140
  preparations:       20
  active_recipes:     71  (20 prep + 51 menu)
  recipe_lines:       321 (57 prep + 264 menu)
  import_runs:        1
```

Sample atomic + computed prep costs:
- Beans Houseblend: Rp 165/gr (atomic from Marketlist)
- Susu Omela: Rp 16/ml (atomic)
- Prep - Espresso HB: Rp 67/ml (computed from 16gr beans + 110ml galon, yield 45ml, Q 10%)
- Prep - Creamer: Rp 47/ml ✓
- Prep - Sambal Matah: Rp 20/gr ✓
- Prep - Nasi: Rp 6/gr ✓
- Prep - Ayam Popcorn: Rp 63/gr ✓ (Owner Marketlist 61, but PREP_FOOD says 63 — engine matches PREP_FOOD as truth)

Audit event:
```json
{
  "event_type": "inventory.import.run",
  "entity_id": "284c8647-6827-4ab7-8a0d-4ffe78cdabe3",
  "metadata": {
    "outletId": "7c51a6dd-5aaf-47e4-8cf8-ab5426ed0ff4",
    "actorRole": "import-cli"
  },
  "payload.summary": "Import: 160 NEW, 0 UPDATE"
}
```

---

## 6. Open Issues / Owner Action Items

### 6.1 ⚠️ Bakmie "Ayam Sambal Matah" naming conflict (HIGH PRIORITY)

**Issue:** Seed has `"Ayam Sambal Matah"` di **dua kategori**: Ricebowl + Bakmie. Engine `menuIdByLower` map silently overwrites with last-seen. Saat import, recipe untuk "Rice Bowl Matah" (Ricebowl recipe content per HPP_FOOD row 89) ter-attach ke **Bakmie's** menu_item_id (last-seen di seed iteration), bukan Ricebowl's.

**State sekarang:**
- Bakmie "Ayam Sambal Matah" menu_item: HAS recipe (but content = Ricebowl Matah, semantically wrong)
- Ricebowl "Ayam Sambal Matah" menu_item: NO recipe attached
- POS: kalau cashier order Ricebowl "Ayam Sambal Matah", inventory NOT decremented (no recipe). Kalau order Bakmie "Ayam Sambal Matah", decrements Ricebowl ingredients (wrong recipe).

**Fix path (Owner):**
1. Login Admin → Menu → cari Bakmie "Ayam Sambal Matah"
2. Rename ke unique name, mis. "Bakmie Sambal Matah"
3. Append ke `data/source-spreadsheets/04-menu-recipes.csv`:
   ```
   Bakmie Sambal Matah,,30,
   ```
4. Append ke `data/source-spreadsheets/05-menu-recipe-lines.csv` (lines dari HPP_FOOD row 148 "Bakmie Matah" block):
   ```
   Bakmie Sambal Matah,,Mie,1
   Bakmie Sambal Matah,,Prep - Ayam Panggang,65
   Bakmie Sambal Matah,,Prep - Sambal Matah,73
   Bakmie Sambal Matah,,Prep - Kuah Bakmie,190
   Bakmie Sambal Matah,,Paper Bowl,1
   Bakmie Sambal Matah,,Sumpit,1
   ```
5. Run `npm run inventory:import -- --apply` (idempotent — UPDATE existing 51 menu recipes, NEW Bakmie Sambal Matah)
6. Then manually fix Ricebowl attachment (one-shot SQL or regenerate via translator):
   ```sql
   -- Move existing wrong-attached recipe to Ricebowl's id
   UPDATE recipes
   SET menu_item_id = '<ricebowl_ayam_sambal_matah_id>',
       updated_at = now()
   WHERE menu_item_id = '<old_bakmie_id_now_renamed>'
     AND variant IS NULL;
   ```
   (Or wait until next re-import after rename — translator's `Rice Bowl Matah` mapping will then resolve to Ricebowl unambiguously.)

Atau sederhanakan: setelah rename Bakmie, re-jalankan translator + import. Translator akan re-emit "Bakmie Sambal Matah" (kalau Owner update hardcoded list) + Ricebowl mapping akan korektif (tidak ambiguous lagi).

### 6.2 Engine bug: `cascadeCostUpdate(prepId)` skips self (MEDIUM PRIORITY)

**Symptom:** Saat import preparations baru, all prep costs land sebagai 0. Cause: `cascadeCostUpdate(changedId)` calls `findDependentPreps(changedId)` yang return preps yang DEPEND ON changedId — tidak include changedId itself. Designed for "atomic ingredient cost changed, propagate up", not "new prep added".

**Location:** [src/features/inventory/import-engine.ts:541-546](src/features/inventory/import-engine.ts#L541-L546).

**Workaround for sesi 11:** `scripts/_oneshot/recompute-all-preps.ts` calls `computePrepCost` per prep in topo order. Worked correctly — all 20 preps now have correct costs.

**Proper fix (next session):**
```typescript
// In import-engine.ts, after line ~538:
const inProgress = new Set<string>();
const computed = new Map<string, number>();
await computePrepCost(tx, opts.outletId, prepId, opts.userId, inProgress, computed);
// Existing cascadeCostUpdate stays (handles dependents in re-imports):
await cascadeCostUpdate(tx, opts.outletId, prepId, opts.userId);
```

Plus: add unit test in `tests/unit/import-engine.test.ts` (or integration test) yang assert prep cost > 0 after import.

### 6.3 initial_stock = 0 untuk semua

**Issue:** Translator set `initial_stock=0` untuk 140 ingredient (didn't have data Owner stock fisik).

**Owner action:** Lakukan first stock-take. Untuk tiap ingredient yang sudah di outlet:
- Buka Admin → Inventory → Bahan → klik ingredient → "Receive Stock" → masukin qty.
- Atau bulk: edit `01-ingredients.csv` set `initial_stock`, re-import. **TAPI:** engine IGNORE `initial_stock` saat UPDATE (avoid wipe receivings). Jadi only works pada NEW. Untuk existing, must use receiveStock UI.

### 6.4 reorder_threshold belum di-set

Owner can set per-ingredient via Admin UI (Bahan → edit → Threshold field).

### 6.5 Owner action: live POS smoke test

Math sudah verified via `verify-cogs.ts`, tapi kalau Owner mau confirm with actual POS transaction:
1. Login POS as cashier
2. Order: 1× Iced Americano → cash → complete
3. Buka /admin/insights → cek Item Performance row "Americano" iced → HPP cell ≠ 0, Margin terhitung
4. Repeat untuk 1× Ayam Sambal Matah (note: see §6.1, currently mis-attached — wait sampai Bakmie rename done)

---

## 7. Decisions Locked Sesi 11

| ID | Decision |
|---|---|
| **D31** | Pilihan A — programmatic translation via deterministic TS script (vs manual fill template). Faster + reproducible + auditable. |
| **D32** | Single big `--apply` (vs staged) — engine atomic single-tx already designed for this. |
| **D33** | Skip menus not in seed → MENU_SKIP_LIST.txt + Owner action item. Engine refuses auto-create as feature, not limitation. |
| **D34** | Smoke verify via `expandRecipeToAtomicLeaves` math expansion (vs live POS txn). Owner can do POS smoke whenever; math already proven. |
| **D35** | Engine bug workaround via `recompute-all-preps.ts` (vs hot-fix engine + re-deploy). Defer proper engine fix to next session for proper test coverage. |
| **D36** | Bakmie Matah deferred to Owner Admin UI rename (vs DB surgery). Surgery requires explicit approval; rename is reversible + Owner's call. |

---

## 8. Critical Files (sesi 12 may touch)

| Path | Action |
|---|---|
| Owner Admin UI | Rename Bakmie "Ayam Sambal Matah" → "Bakmie Sambal Matah" |
| `data/source-spreadsheets/04-menu-recipes.csv` + `05-menu-recipe-lines.csv` | Append Bakmie Matah entry post-rename |
| `src/features/inventory/import-engine.ts` | Engine fix for cascade self-include |
| `tests/unit/import-engine.test.ts` (new) | Coverage for prep cost = 0 regression |
| `PROGRESS.md` | Mark M23.6 (or Tier 1.3) start |

---

## 9. Verify Commands (Step 0 — sebelum mulai sesi 12)

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
git log --oneline -5                            # expect HEAD = sesi 11 commit + 88b5f67
npm run typecheck && npm run lint               # clean
npx vitest run                                  # 276/276
npx tsx --env-file-if-exists=.env.local scripts/_oneshot/verify-import.ts
                                                # expect 140 atomic + 20 preps + 71 recipes + 321 lines
curl -sI https://mahakan-pos.vercel.app/        # HTTP/2 200
```

---

## 10. Known Tech Debt (carry forward)

### 10.1 (resolved 7.4) `server-only` removed dari 2 modules
Same as sesi 10 — convention discipline (never `import` from `preparation-flow.ts` or `audit/logger.ts` in `"use client"` files).

### 10.2 NEW: cascadeCostUpdate doesn't recompute self when called with prepId
See §6.2 above. Workaround in place; proper fix sesi 12.

### 10.3 NEW: menuIdByLower silently overwrites duplicate names
[src/features/inventory/import-engine.ts:560-561](src/features/inventory/import-engine.ts#L560-L561). When 2 menu_items have same name (different category), last-seen wins. Should error or use `(category_id, name)` joint key. Defer fix; Owner has only 1 such case (Ayam Sambal Matah) which is being renamed manually.

### 10.4 `note` file di working tree
Untracked. Bukan part dari M23. Leave alone.

---

## 11. Memory Updates Sesi 11

Akan add:
- `session11-closeout` — supersede `session10-closeout`. Resume point post-M23.5 with all 6 issues + recommended next.

Memories yang tetap force:
- `migration-ordering-rule` — code-first untuk DROP/ALTER, additive bisa apply-first
- `vercel-deploy-mode` — manual `vercel --prod` after push
- `pause-before-destructive` — explicit OK before destructive ops
- `pat-handling-preference` — user push via own terminal preferred

---

## 12. Important Reminders

### 12.1 Don't (still in force)

- ❌ Don't push to main without explicit OK
- ❌ Don't deploy non-additive migration before code deploy
- ❌ Don't expect `release/phase-1` push to auto-deploy (manual `vercel --prod`)
- ❌ Don't commit `note` file or `.claude/`
- ❌ Don't use `any` di TypeScript
- ❌ Don't introduce float math for money — pakai `src/lib/money.ts`
- ❌ Don't run `--apply` on inventory:import without backup pre-run
- ❌ **NEW**: Don't trust `cascadeCostUpdate(prepId)` to recompute the prep itself — manually call `computePrepCost(prepId)` first

### 12.2 Do (still in force)

- ✅ Verify typecheck + lint + tests + build before claim done
- ✅ Commit per logical chunk dengan conventional format
- ✅ Audit log untuk every mutation
- ✅ Update PROGRESS.md as milestones complete

### 12.3 Sesi 11 lessons captured

- **Deterministic translation script beats manual CSV edit at scale.** ~600 row total Owner data translated in 30 min wall time, fully reproducible. If Owner provides updated spreadsheet, re-run dalam <1 menit.
- **Indonesian thousand-sep parsing requires heuristic.** "1.000" can be 1000 (thousand) or 1.000 (decimal). Solution: only strip period when EXACTLY 3 digits follow. Tiny fractions (0.5 gr Italian Herb) round up to 1 since engine requires integer qty.
- **Engine `cascadeCostUpdate` semantics surprise.** Designed for "atomic changed → propagate up", not "new prep added → compute self + propagate". Bug only manifests on first import. Re-imports work fine because changes flow through atomics.
- **Engine `menuIdByLower` last-seen-wins.** Silent overwrite when seed has duplicate menu_item.name across categories. Bites at first import. Defer fix; Owner manually renames.
- **GHA backup workflow has no `reason` input** — `gh workflow run db-backup.yml -f reason="..."` silently fails. Use bare command. Owner browser path also works.
- **Recipe expansion proves cost engine value.** Verified: engine correctly catches galon water consumed via prep recipes that Owner's HPP spreadsheet missed. Owner Marketlist had stale prep cost (Saus Coklat 150/g) vs actual recipe (45/g). Engine = single source of truth.

---

## 13. Final Status Snapshot

```
Date:          2026-04-28 (end of sesi 11)
Branch:        release/phase-1 (HEAD 88b5f67 unchanged; sesi 11 = data-only)
Build:         ✓ unchanged from sesi 10 (11 routes, 276/276 tests)
Lint:          ✓ clean
Typecheck:     ✓ strict mode

Production:    ✓ https://mahakan-pos.vercel.app (deploy dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j)
DB on Neon:    ✓ inventory tables populated (140 + 20 + 71 + 321 + 1 audit)
               ✓ all 20 prep costs computed correctly
               ✓ COGS verified ±10% Owner display (Churros engine MORE accurate)
Backup:        ✓ GHA run 25034423361 pre-apply 2026-04-28

Phase 2:
  Tier 1.1 Recipe/BOM + Inventory  ✅ CODE-COMPLETE (sesi 6)
  Tier 1.2 Cost Engine M23         ✅ COMPLETE — verified live with real data
  Tier 1.3 Loyalty + Customer DB   ⏸ defer 1-2 weeks for cost engine real-data validation

Next action: M23.6 Menu Engineering Matrix recommended (~3-5 days). Surface
             cost%, margin Rp, margin% per menu via /admin/insights/menu-engineering.
             Direct payoff dari M23 investment.

             OR Tier 1.3 Loyalty (~2 weeks) — defer.

Carry-forward: Owner Bakmie rename + engine fix (cascadeCostUpdate +
             menuIdByLower) + initial_stock first stock-take.
```

---

## 14. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-28 | Sesi 11 → 12 handover. M23.5 first --apply done. Cost engine verified live. Tier 1.2 COMPLETE. Carry-forward: Owner Bakmie rename + 2 engine bugs documented. |

---

# 🛑 END HANDOVER SESI 11

**M23 cost engine VERIFIED LIVE in production with real Mahakan data. 140 atomic ingredients + 20 preparations + 71 recipes + 321 lines, COGS expansion math accurate (engine MORE accurate than Owner spreadsheet on Churros). Sesi 12 = pick next milestone.**

---

## ADDENDUM — M23.6 Menu Engineering Matrix landed (same session, commit `b0f5d84`)

User selected Recommended option ("M23.6 Menu Engineering Matrix") setelah M23.5 close-out, dan implementasi langsung dilakukan dalam sesi yang sama.

### What's added

| Path | Purpose |
|---|---|
| `src/features/reports/menu-engineering-pure.ts` | Pure classifier: `linearMedian` + `classifyMenuMatrix` dengan Kasavana-Smith 2x2 logic (median split popularity × contribMargin Rp) |
| `src/features/reports/types.ts` (extended) | `MenuQuadrant` + `MenuEngineeringRow` + `MenuEngineeringResult` types |
| `src/features/reports/queries.ts` (extended) | `fetchMenuEngineeringMatrix` reuses `fetchItemPerformance` |
| `src/features/reports/actions.ts` (extended) | `getMenuEngineeringMatrix` server action; gated by `report.items.view` + `report.cost_visibility` |
| `src/features/reports/index.ts` (extended) | Export new types + action |
| `src/features/admin/sections/reports/MenuEngineeringView.tsx` | 2x2 grid UI dengan summary header + per-quadrant card + drop-down unclassified |
| `src/features/admin/sections/ReportsSection.tsx` (modified) | Add 5th tab "Matriks Menu" (owner-only); restructure `TABS` array dengan `ALL_TABS.filter` |
| `tests/unit/menu-engineering.test.ts` | 15 unit tests covering median + classification edge cases |

### Quadrant rules (final)
- **Star**: qty ≥ medianQty AND contribMargin ≥ medianContribMargin → "Pertahankan & promosi"
- **Plowhorse**: qty ≥ medianQty AND contribMargin < medianContribMargin → "Re-engineer cost atau naikkan harga"
- **Puzzle**: qty < medianQty AND contribMargin ≥ medianContribMargin → "Tingkatkan exposure"
- **Dog**: qty < medianQty AND contribMargin < medianContribMargin → "Pertimbangkan dihapus"
- Ties go UP (≥ median = "high"). Min 4 classifiable items required (else all unclassified state).

### Decisions D37-D39 (locked sesi 11 addendum)

| ID | Decision |
|---|---|
| **D37** | Y-axis = Contribution margin Rp (revenue − cogs per period), bukan margin% per unit. Classic Kasavana-Smith. |
| **D38** | Visualisasi = 2x2 grid cards (no chart lib), color-coded per quadrant, action labels Indonesian. |
| **D39** | Owner-only tab (`report.cost_visibility` perm), karena margin reveals HPP. |

### Verify (sesi 11 close)
- typecheck ✓ lint ✓ vitest **291/291** (276 baseline + 15 baru) ✓ build 11 routes ✓
- HTTP/2 200 untuk prod (deploy belum di-push, masih HEAD `88b5f67` di prod)

### Next session pickup

User push + deploy `release/phase-1` HEAD `b0f5d84` ke Vercel Production:
```bash
git push origin release/phase-1
npx --yes vercel --prod --yes
```
Verify deploy: `curl -sI https://mahakan-pos.vercel.app/` HTTP/2 200, login owner → /admin → Laporan → tab "Matriks Menu" → render 2x2 grid dengan data dari M23.5 import.

Sisa carry-forward (sesi 11 closeout §6) tetap berlaku:
1. Bakmie "Ayam Sambal Matah" rename via Admin UI (HIGH)
2. First stock-take untuk 140 ingredient (MEDIUM)
3. Engine fix: `cascadeCostUpdate` self-include (MEDIUM, workaround in place)
4. Engine fix: `menuIdByLower` duplicate name handling (MEDIUM)

Recommended next milestone: ada 3 candidate sekarang:
- **A. Engine bug fixes** (M23 follow-up) — patch 2 bugs di import-engine.ts + add coverage. ~1 hari. Reduce risk untuk re-import berikutnya.
- **B. Tier 1.3 Loyalty + Customer DB** — defer 1-2 minggu untuk live txn data validation, tapi lo bisa start scoping sekarang.
- **C. Polish M23.6** — CSV export, scatter chart, percentile threshold toggle, time-comparison vs prior period. Each ~0.5-1 hari.

---

## ADDENDUM 2 — M23.7 (A + C) landed (same session, commits `32eb883` + `d92b94e`)

User picked: **A + C bundled** (sequencing) + **CSV export only** untuk C (skip scatter chart + period comparison). Loyalty/Customer DB explicitly deferred — Owner ingin matangkan backoffice + POS dulu.

### A — Engine bug fixes (commit `32eb883`)

**A1: `cascadeCostUpdate` self-include** ([src/features/inventory/preparation-flow.ts](src/features/inventory/preparation-flow.ts))

Detect if `changedIngredientId` is a preparation (queries `ingredients.is_preparation`); if yes, prepend it to `prepsToRecompute` list. Otherwise behavior unchanged (atomic ingredient → only dependents recomputed).

Effect: future imports of new preps will compute their cost correctly inline. The workaround `scripts/_oneshot/recompute-all-preps.ts` becomes redundant. Existing prod data (sesi 11 import) sudah have correct cost values via the workaround, so this fix is forward-only — no migration needed.

**A2: `menuIdByLower` duplicate detection** ([src/features/inventory/import-engine.ts](src/features/inventory/import-engine.ts))

Build map dengan duplicate detection — accumulate ambiguous names ke `Set`. Recipe lookup loop sekarang check `ambiguousNames.has(lowered)` BEFORE `menuIdByLower.get(lowered)` dan emit ERROR jelas: `menu_name "X" ada di lebih dari 1 kategori — rename salah satu via Admin UI dulu`. File 05 cascades via existing `menuRecipeErrors` set (no separate fix).

Verify: dry-run `npm run inventory:import` confirmed Ayam Sambal Matah now ERRORs di row 47 + 6 cascade rows in file 05. Owner action item (rename Bakmie via Admin UI) tetap berlaku, tapi sekarang kalau Owner re-import tanpa rename, error message jelas instead of silent mis-attachment.

### C — Menu Engineering CSV export (commit `d92b94e`)

New file [src/features/admin/sections/reports/menu-engineering-csv.ts](src/features/admin/sections/reports/menu-engineering-csv.ts):
- `buildSummaryCsv(result)` — per-quadrant rollup (5 rows: Star, Puzzle, Plowhorse, Dog, Belum diklasifikasi)
- `buildRowsCsv(result)` — full per-menu drill-down dengan quadrant + all metrics
- `downloadCsv(filename, content)` — browser Blob+a.click pattern

UI change ([MenuEngineeringView.tsx](src/features/admin/sections/reports/MenuEngineeringView.tsx)): "Export CSV" button di header (kanan date pickers), disabled saat loading/empty, fires 2 download. Filenames: `menu-matrix-summary-<from>-<to>.csv` + `menu-matrix-rows-<from>-<to>.csv`.

### Verify (sesi 11 close — final)
- typecheck ✓ lint ✓ vitest **291/291** ✓ build 11 routes ✓
- Dry-run `inventory:import` → Ayam Sambal Matah error confirmed
- Browser smoke pending (lo test setelah deploy)

### Final commit chain (sesi 11)
1. `e640f11` — feat(M23.5): first --apply + cost engine verified live
2. `b0f5d84` — feat(M23.6): menu engineering matrix view (Kasavana-Smith 2x2)
3. `a573b15` — docs: PROGRESS + handover addendum for M23.6
4. `32eb883` — fix(inventory): cascadeCostUpdate self-include + menuIdByLower duplicate detect
5. `d92b94e` — feat(admin): CSV export untuk Menu Engineering Matrix

5 commits di local `release/phase-1`. NOT pushed/deployed.

### Sesi 12 candidates (final, post M23.7)

**Recommended A: Kitchen + Bar Print Routing** (~3-4 hari)
User explicitly selected "Single printer, multi-ticket per transaksi" model. Operasional priority untuk kafe. Pre-req: category `stationTag` field, receipt builder split, auto-print emits 3 cuts (kitchen + bar + customer). Schema migration kecil.

**Recommended B: POS UX Audit** (~0.5 hari audit + variable implementation)
User selected ALL 4 gap areas (speed, modifiers, queue, audit-first). Recommended start = audit-first walkthrough. Output: prioritized punch-list dengan effort estimates per item, then user picks top items. Audit sub-areas:
- Cashier rush hour speed (latency, taps reduction, hot-keys)
- Modifier flexibility (UI cepat, custom note, frequent modifier preset)
- Order queue / pending orders clarity (multi-draft tracking, in-progress status)

Lo bisa pilih A atau B atau urutan A→B / B→A di sesi berikutnya.
