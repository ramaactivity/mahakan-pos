# 🤝 HANDOVER SESI 10 — Mahakan POS

**Untuk:** Claude AI agent (sesi 11)
**Dari:** Sesi 10 (Phase 2 Tier 1.2 — M23.4 CSV Importer/Exporter/Template)
**Date:** 2026-04-28
**Status:** **M23.3 + M23.4 deployed ke production** (`dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j`). 8 commits di `release/phase-1` HEAD `2764102` pushed + live. Sesi 11 = M23.5: Owner curate CSV + dry-run + first `--apply` di prod + smoke verify P&L.

---

## ⚡ TL;DR

**Sesi 9 (M23.3 UI)** — 3 commits:
- `c8b10fc` Preparations tab + atomic-only Bahan filter
- `1ecc604` Recipe editor: Q Factor field + grouped select + GRABGOSO + Q badge
- `b8daca2` COGS Calculator + InventorySection wire

**Sesi 10 (M23.4 CSV importer)** — 4 commits:
- `e509fc1` Plumbing + template generator (1/4): papaparse + csv-io + cli-args + `inventory:template` + 12 csv-io tests
- `f46d298` Outlet/actor resolvers + exporter (2/4): `inventory:export` DB→CSV
- `a48e696` Import engine + CLI (3/4): pure helpers (32 tests) + DB orchestration (cycle pre-flight + topo sort + REPLACE + atomic) + dry-run/apply + drop `import "server-only"` dari `preparation-flow.ts` + `audit/logger.ts`
- `3512df4` Operational guide doc (4/4)

**Verify:** typecheck ✓ lint ✓ vitest **276/276** (was 232 + 44 baru) ✓ build 11 routes ✓.

**Production state:** HEAD `2764102` deployed via `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j` 2026-04-28 (HTTP/2 200 verified). M23.3 UI + M23.4 CLI live; tabel inventory tetap kosong sampai Owner import.

**Sesi 11 work (M23.5):**
1. Owner curate CSV (load 5 file dari `data/source-spreadsheets/` → port ke standardized format, atau pakai `npm run inventory:template` → fill manual)
2. `npm run inventory:import` dry-run → reconcile mismatch (terutama menu names — engine refuse auto-create)
3. Owner add missing menu_items via Admin UI yang sekarang live di prod
4. **Backup DB pre-apply** via GHA workflow (per `migration-ordering-rule`)
5. `npm run inventory:import -- --apply` (first live write — destructive, irreversible without restore)
6. Smoke 1 transaksi POS end-to-end → verify COGS muncul di P&L (M22.6)
7. Handover sesi 12 + close M23 milestone

---

## 1. Production State (akhir sesi 10)

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| Latest immutable | `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j` deployed 2026-04-28 sesi 10 (HEAD `2764102`) |
| Inspector | https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/68UGimfxb3rxzANA3LpA1ZTS7c4j |

- `release/phase-1` HEAD `2764102` — pushed + live di prod. Backwards-compatible (no schema, no breaking change ke existing flows).
- M23.3 UI live: Preparations tab, COGS Calculator, recipe editor enhancements semua accessible via Admin → Inventory.
- M23.4 CLI live: 3 npm scripts (`inventory:template`, `inventory:export`, `inventory:import`) callable dari local terminal (server-side scripts, tidak deployed ke Vercel — jalan dari local box dengan akses ke Neon DATABASE_URL).
- DB tabel inventory tetap kosong di prod sampai Owner import.

---

## 2. What Changed Sesi 9 + 10 (combined; sesi 9 sudah didokumentasikan terpisah di handover sesi 9 yang gak ditulis explicit)

### 2.1 New scripts (Step 1-3 M23.4)

| Path | Lines | Purpose |
|---|---|---|
| `scripts/_shared/cli-args.ts` | 38 | Tiny argv parser (no commander dep) |
| `scripts/_shared/csv-io.ts` | 75 | papaparse wrapper: parseCsv + writeCsv (BOM + LF) |
| `scripts/_shared/outlet-resolver.ts` | 38 | Auto-detect single-outlet OR --outlet override |
| `scripts/_shared/actor-resolver.ts` | 18 | Lookup user via SEED_OWNER_EMAIL |
| `scripts/inventory-template.ts` | 130 | Generate 5 blank CSV → data/templates/ |
| `scripts/inventory-export.ts` | 270 | Dump current DB state → data/exports/<ts>/ |
| `scripts/inventory-import.ts` | 235 | CLI: parse → engine → report (+ JSON sidecar) |

### 2.2 New engine (M23.4)

| Path | Purpose |
|---|---|
| `src/features/inventory/import-engine-pure.ts` | Pure: row normalizers (zod-style), diff helpers, dup detection, topo sort, key normalization. Importable in browser/Node/test. |
| `src/features/inventory/import-engine.ts` | DB orchestration: snapshot existing, build proposed adjacency, validateNoCycle pre-flight, topo-sort prep insert order, atomic single-tx (REPLACE recipe lines + cascade per prep), refuse-on-error commit. Dry-run via sentinel rollback. |

### 2.3 Modified core modules

| Path | Change | Why |
|---|---|---|
| `src/features/inventory/preparation-flow.ts` | Removed `import "server-only"` | Package throws unconditionally in plain Node (not just RSC). CLI scripts (M23.4) reuse `cascadeCostUpdate` + `detectCycleForRecipeUpsert` + `buildPrepAdjacency`. Module is inherently server (imports `@/db`); client-bundle inclusion would fail anyway. Pure helpers in `preparation-flow-pure.ts` remain client-safe. |
| `src/lib/audit/logger.ts` | Removed `import "server-only"` | Same reason — CLI emits `inventory.import.run` audit. |
| `package.json` | Add `papaparse` + `@types/papaparse`. 3 npm scripts (`inventory:template`/`export`/`import`). `--env-file-if-exists=.env.local` for tsx (Node 20+ feature). | Owner-facing CLI |
| `.gitignore` | `/data/templates/` + `/data/exports/` | Generated files, never commit |

### 2.4 New tests

| Path | Cases | Coverage |
|---|---|---|
| `tests/unit/csv-io.test.ts` | 12 | Round-trip dengan BOM, embedded comma/quote, blank rows, refuse-on-exist, trailing newline |
| `tests/unit/import-engine-pure.test.ts` | 32 | Row normalization, variant case folding, diff edge cases, duplicate detection, topo sort (chain/diamond/cycle) |

### 2.5 New docs

- `docs/M23.4-CSV-IMPORT.md` — 270-line operational guide: format spec per file, CLI commands, reconcile rules, edge cases + error resolution, audit trail summary, common workflows, troubleshooting.

### 2.6 Sesi 9 (M23.3 UI) — recap singkat

3 commit: `c8b10fc` (Preparations tab) + `1ecc604` (recipe editor enhancements) + `b8daca2` (COGS Calculator). Files:
- NEW: `PreparationsList.tsx` + `PreparationFormModal.tsx` + `CogsCalculatorWidget.tsx`
- MODIFIED: `InventorySection.tsx`, `IngredientsList.tsx`, `RecipeEditorModal.tsx`, `RecipesList.tsx`, `actions.ts` (3 new server action wrappers), `index.ts` (barrel exports)

---

## 3. Decisions Locked Sesi 10

Plan agent + user-confirmed via AskUserQuestion (D17, D18) + plan agent recommendations (D19-D30).

| ID | Decision |
|---|---|
| **D17** | Long format CSV, 5 file numbered (01-ingredients, 02-preparations, 03-prep-lines, 04-menu-recipes, 05-menu-recipe-lines) |
| **D18** | Ship `template` + `import` + `export` semua di M23.4 |
| **D19** | DROP `server-only` dari preparation-flow + audit/logger (was: add as devDep — but package throws in plain Node) |
| **D20** | papaparse + crypto.randomUUID (no nanoid dep) |
| **D21** | Outlet auto-detect, --outlet override |
| **D22** | REPLACE recipe lines (delete + insert) |
| **D23** | Single tx wrap; dry-run = sentinel rollback |
| **D24** | Cycle: in-memory validateNoCycle on merged adjacency |
| **D25** | Topological prep insert order |
| **D26** | ASCII markers + JSON sidecar |
| **D27** | Template: header + 1 example row, refuse-if-exists |
| **D28** | Export: timestamped dir, no symlink |
| **D29** | Apply refuses on error, atomic rollback |
| **D30** | Edge: dup → ERROR; initial_stock UPDATE → IGNORE; cost change → no movement; empty rows → SKIP |

---

## 4. M23.5 Step-by-Step Plan (sesi 11)

### Step 1 — DONE (sesi 10 sudah push + deploy)

`dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j` live. Sesi 11 mulai langsung di Step 2.

Sanity verify dulu sebelum continue:
- Login Admin POS → Admin → Inventory
- Tab "Preparations" terlihat
- "COGS Calculator" button accessible di header
- Edit any menu recipe → Q Factor field muncul

### Step 2 — Owner curate CSV (~30 min)

Owner ada 2 opsi:
- **A**: Translate manual dari `data/source-spreadsheets/` (Owner spreadsheet messy) ke standardized format. Akurat tapi labor-intensive.
- **B**: Pakai `npm run inventory:template` → blank CSV → fill 1-2 menu dulu sebagai sanity check, lalu bulk-fill setelah dry-run sukses.

Recommend: B. Owner kasih staff list ingredient + prep + menu yang real (bukan spreadsheet messy).

### Step 3 — Dry-run (~5 min)

```bash
mv data/templates/*.csv data/source-spreadsheets/  # atau langsung edit di templates
npm run inventory:import
```

Output:
- Per-row [NEW]/[UPDATE]/[SKIP]/[ERROR] table
- Summary counts per file
- JSON sidecar di `data/exports/import-<runId>/`

Common errors yang akan muncul:
- `menu_name tidak ditemukan` → Owner add via Admin UI dulu
- `name duplikat` → Owner pick salah satu
- `cycle dependency` → Owner refactor recipe

Iterate sampai dry-run bersih (0 error).

### Step 4 — `--apply` di prod (~5 min)

**Sebelum apply**, trigger backup via GHA workflow (per `migration-ordering-rule`):
```bash
gh workflow run db-backup.yml -f reason="pre-M23.5-apply"
```

Setelah backup READY:
```bash
npm run inventory:import -- --apply
```

Expected output:
- All rows COMMITTED
- `inventory.import.run` audit event emitted
- Cascade events di audit log untuk preps yang berubah

### Step 5 — Smoke transaksi end-to-end (~5 min)

1. Login Admin POS → buat 1 transaksi (Iced Americano 1x)
2. Verify `inventory_movements` table:
   - Sale: 1 `kind=sale_deduct` row + 1 `kind=waste` row per atomic ingredient (espresso → beans + water leaves)
   - Stock decreased correctly
3. Check P&L (M22.6 Item Performance):
   - Revenue cell terisi
   - HPP cell ≠ 0
   - Margin terhitung

### Step 6 — Update PROGRESS + handover sesi 12

- Mark M23.5 as DONE
- Mark M23 (Tier 1.2) as COMPLETE
- Note next milestone: Phase 2 Tier 1.3 (Loyalty + Customer DB) atau Tier 1.2 polish (M23.6 menu engineering matrix)

---

## 5. Critical Files (M23.5 may touch)

| Path | Action |
|---|---|
| `data/source-spreadsheets/*.csv` | Owner-curated source (gitignored) |
| `data/exports/import-<runId>/import-report.json` | Per-run audit sidecar |
| `PROGRESS.md` | Mark M23.5 + close M23 |
| `docs/99-HANDOVER-SESSION-11.md` | NEW handover |
| `audit_logs` table | Verify cascade + import.run events post-apply |

---

## 6. Verify Commands (Step 0 — sebelum mulai sesi 11)

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
git log --oneline -10               # expect 3512df4 ... 094dca3
npm run typecheck && npm run lint   # clean
npx vitest run                      # 276/276 (bcrypt parallel may flake → re-run isolated)
npm run build                       # 11 routes
ls data/templates/                  # 5 CSV (gitignored, regen if missing: npm run inventory:template)
curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200, M23.2 deployment
```

---

## 7. Known Issues / Tech Debt

### 7.1 No live `--apply` test on prod yet

Engine smoke-tested di dry-run mode against prod DB (synthetic + template fixtures). Apply path 100% code-path tested via dry-run + sentinel rollback (same orchestrator). First real `--apply` planned di sesi 11.

### 7.2 (resolved sesi 10) — 8 commits pushed + deployed

`release/phase-1` HEAD `2764102` synced ke remote, deployed via `dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j`. Production tetap backwards-compatible (M22.x sale path kompatibel; M23 prep features inert sampai data import).

### 7.4 `server-only` removed dari 2 module

Trade-off: Next.js build-time client-bundle protection lost untuk `preparation-flow.ts` + `audit/logger.ts`. Mitigations:
- Both modules import `@/db` directly (Postgres pool) — would fail at runtime kalau client component pull them
- Pure helpers di `preparation-flow-pure.ts` separately maintained for client use
- Convention discipline: never `import` from these 2 dari `"use client"` files (lint check could be added later)

### 7.5 `note` file di working tree

Untracked. Bukan part dari M23 — leave alone.

---

## 8. Memory Updates Sesi 10

`MEMORY.md` belum di-update sesi 10 (no new user feedback yang persist). Akan tambah `session10-closeout` di sesi 11 (markdown dosen sesi 8 closeout supersede).

Aktif yang tetap force:
- `migration-ordering-rule` — code-first untuk DROP/ALTER, additive bisa apply-first
- `vercel-deploy-mode` — manual `vercel --prod` after push
- `pause-before-destructive` — explicit OK before destructive ops (`--apply` first time = destructive)
- `pat-handling-preference` — user push via own terminal preferred

---

## 9. Important Reminders

### 9.1 Don't (still in force)

- ❌ Don't `--apply` di prod tanpa backup pre-run
- ❌ Don't push to main without explicit OK
- ❌ Don't deploy non-additive migration before code deploy
- ❌ Don't expect `release/phase-1` push to auto-deploy (manual `vercel --prod`)
- ❌ Don't commit `note` file or `.claude/`
- ❌ Don't use `any` di TypeScript
- ❌ Don't introduce float math for money — pakai `src/lib/money.ts`

### 9.2 Do (still in force)

- ✅ Verify typecheck + lint + tests + build before claim done
- ✅ Commit per logical chunk dengan conventional format
- ✅ For destructive `--apply`: backup pre-run via GHA, atomic single-tx, refuse-on-error
- ✅ For Mahakan deploy: `npx --yes vercel --prod --yes` + wait `readyState: READY`
- ✅ Audit log untuk every mutation
- ✅ Update PROGRESS.md as milestones complete

### 9.3 Sesi 10 lessons captured

- **`server-only` package throws in plain Node, not just at Next.js build time.** SO-A from M23.4 plan was wrong — adding as devDep doesn't help (package's `index.js` always throws). Correct fix: drop the import from modules that need to be reused di Node CLI. Trade-off: lose Next.js build-time guard. Mitigated by inherent server dep (`@/db`) blocking client bundle inclusion at module load.
- **`tsx --env-file-if-exists=<path>` Node 20+ feature** — proper way to load `.env.local` BEFORE module hoisting (vs `import "dotenv/config"` di entrypoint, which runs AFTER imports due to ESM hoisting).
- **Long-format CSV more reusable than wide-format** — DB row → CSV row is 1:1, no slot caps, easy bulk edit by sort. Owner mental model "1 baris = 1 recipe" sacrificed for cleaner schema. Excel/Sheets sort by parent column gives wide-like view anyway.
- **Pre-flight cycle check via in-memory `validateNoCycle` (M23.2 pure helper) is essential** — DB-side `detectCycleForRecipeUpsert` only catches single-prep cycles; importer can introduce multi-prep cycles in same run.
- **REPLACE semantics for recipe lines** simpler than diff-aware update (delete-by-recipe + bulk insert). Recipe sets kecil (5-15 rows), audit captures full before/after via cascade engine.

---

## 10. Final Status Snapshot

```
Date:        2026-04-28 (end of sesi 10, post-deploy)
Branch:      release/phase-1 (HEAD 2764102, pushed)
Build:       ✓ 11 routes, webpack mode
Tests:       ✓ 276/276 (232 sesi 8 baseline + 12 csv-io + 32 import-engine-pure)
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:  ✓ https://mahakan-pos.vercel.app (deploy dpl_68UGimfxb3rxzANA3LpA1ZTS7c4j 2026-04-28)
             — M23.3 UI live, M23.4 CLI ready dari local box
DB on Neon:  Migration 0003 (sesi 7) applied. Tables empty. No new migration sesi 9-10.
Backup:      GHA run 24999330539 pre-M23.1 (still last; M23.5 MUST trigger pre-apply)

Phase 2:
  Tier 1.1 Recipe/BOM + Inventory  ✅ CODE-COMPLETE (sesi 6)
  Tier 1.2 Cost Engine M23         🔄 M23.1-M23.4 done + deployed; M23.5 pending
  Tier 1.3 Loyalty + Customer DB   ⏸ defer until Tier 1.2 ship + 1 week stable

Next action: M23.5 — Owner curate CSV + dry-run + backup + first --apply
             + smoke verify P&L COGS + handover. ~1 sesi work.
             High-risk step (live DB writes); explicit Owner approval +
             pre-backup MANDATORY.
```

---

## 11. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-28 | Sesi 10 → 11 handover. M23.4 importer/exporter/template code-complete + M23.3 UI bundled. 7 commits NOT pushed. M23.5 = deploy + Owner reconcile + first apply. |

---

# 🛑 END HANDOVER SESI 10

**M23 cost engine 4/5 chunks done locally. M23.5 = single-release window: push + deploy + Owner CSV + dry-run + apply + smoke. Boot prompt di §6 (verify) + Step-by-step di §4 ready untuk dipakai sesi 11.**
