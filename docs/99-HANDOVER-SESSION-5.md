# 🤝 HANDOVER SESI 5 — Mahakan POS

**Untuk:** Claude AI agent (sesi 6)
**Dari:** Sesi 5 (PRD gap closure + production stabilization)
**Date:** 2026-04-27
**Status:** **Phase 1 PRD-COMPLETE.** Production stable di `https://mahakan-pos.vercel.app`. M16 hardware verified (RPP02 test print). M20 soft launch pending. Phase 2 roadmap drafted.

---

## ⚡ TL;DR

Sesi 5 menutup semua celah PRD §4–6 yang masih ngutang dari Phase 1 (audit log, settings forms, weekly/monthly reports + PDF, menu bulk, cash CRUD), plus 3 upgrade keamanan (approver-token DB-persistent, login rate-limit, weekly DB backup). Total **15 commit** dan **2 deploy production cycle**: 8 commit gap-closure dulu, lalu 7 commit bug-fix wave saat surface bugs muncul setelah deploy (CI workflow, vercel main auto-regress, middleware redirect loop, POS reprint stub).

Phase 1 sekarang **PRD-complete**. Yang tersisa hanya:
- M16 — hardware confirmed via Settings test print, reprint button + auto-print di POS shipped tapi belum field-tested di transaksi real
- M20 — soft launch (training script + handover ke karyawan) belum mulai

**Cara mulai sesi 6:**
1. Baca file ini sampai habis (~12 menit)
2. Baca `MEMORY.md` (auto-loaded)
3. Verify state: `npm run typecheck && npm run lint && npx vitest run && npm run build`
4. `curl -sI https://mahakan-pos.vercel.app/` — harus HTTP/2 200
5. `git branch --show-current` — harus `release/phase-1`
6. Tanya user pilihan: M16 field test / M20 soft launch / Phase 2 starter / feedback

---

## 1. Production State

### 1.1 URLs

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| https://mahakan-3uilkwes3-... | Latest immutable URL (sesi 5 final, commit `b0a56a5`) |

Dashboard: https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos

### 1.2 Vercel env vars (Production scope, unchanged)

```
DATABASE_URL          (Neon pooled)
AUTH_SECRET           (synced from .env.local)
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=https://mahakan-pos.vercel.app
NODE_ENV=production   (Vercel auto-set)
```

**Preview env**: belum di-set. PR previews akan fail kalau dibuat.

### 1.3 Branch + deploy strategy

- `release/phase-1` (HEAD `b0a56a5`) — production source. Local + remote synced.
- `main` (HEAD `cd98828`) — **2 commits** of `.github/workflows/db-backup.yml` + `vercel.json` deploy-disabled. Intentionally behind app-code.
- `vercel.json` punya `git.deploymentEnabled.main = false` — **safety net** supaya push ke main TIDAK trigger Production deploy lagi (regress di sesi 5 gara-gara ini).
- Vercel auto-deploys dari push `release/phase-1` ke Production. Untuk push manual: `npx --yes vercel --prod --yes` dari local working dir.

### 1.4 GitHub repo state

- Secret `DATABASE_URL_BACKUP` SUDAH set (Neon **unpooled** URL). Gua set tadi via `gh secret set` pakai stdin pipe (gak echo ke chat).
- Workflow `db-backup` ada di main → cron Sunday 02:00 UTC (= 09:00 WIB Sunday). Sudah test-run sukses, artifact `mahakan-pos-20260427T075306Z.dump` ada di Actions tab (90-day retention).
- `gh` CLI ter-authenticated (token in macOS keychain, scope `repo + workflow`). Binary at `/tmp/gh_2.62.0_macOS_amd64/bin/gh` — manual download karena Homebrew error. Per memory, kalau butuh gh lagi, panggil dari path itu (atau install permanen).

### 1.5 PWA install state (unchanged from sesi 4)

App fully installable. Kalau home-screen icon stale, uninstall + reinstall via Chrome address bar. Manifest: `display: fullscreen`.

---

## 2. What Changed Sesi 5

15 commits. Order chronological:

### Wave 1 — PRD gap closure (8 commits)

| Commit | What |
|---|---|
| `33faa2d` | `feat(audit): full audit log + login rate-limiting` — `src/lib/audit/{types,logger,queries}.ts` typed event registry + fire-and-forget logger; wired to auth (success/failed with reasons + locked), transactions (void/refund/discount), users (CRUD/reset_pin), menu (item CRUD/sold-out/category CRUD/modifier), cash (expense/income create). Login lockout: 5 fail → 15 min via existing `users.failed_attempts` + `users.locked_until` columns. Owner-only viewer at admin sidebar "Audit Log" tab dengan filter event group + date range + paginated 50/page + expandable diff/context. |
| `e8970ec` | `feat(settings): owner-editable forms` — 5 server actions (updateBusinessInfo, updateOperationalHours, updateReceiptSettings, updateThresholds, updateFeatures), 3 modal (BusinessInfoModal, OperationalHoursModal, SettingsTunablesModal). Setiap card di Settings dapat tombol "Edit" Owner-gated. |
| `66acb20` | `feat(reports): weekly/monthly + PDF + best/slow mover badges` — `SalesRangeView` dengan preset 7d/30d/MTD/custom, line chart Recharts, prior-period comparison %. PDF export via jsPDF di `lib/pdf-export/index.ts` untuk Daily Sales + P&L + Range (branded outlet header). Item Performance dapat badge auto-detect quartile Q1/Q3. |
| `ac8c612` | `feat(menu): bulk actions + CSV export` — `bulkUpdateMenuItems(ids, action)` 3 action (sold-out, available, adjust_pct). `exportMenuCsv()` Owner-only. UI: checkbox kolom + select-all dengan indeterminate state + BulkActionsBar appears when ≥1 selected. |
| `89a6c51` | `feat(cash): expense edit/delete + category CRUD` — `updateExpense` (Owner anytime, Manager ≤24h since createdAt), `deleteExpense` (Owner-only), full CRUD for `expenseCategories` (system rows protected). UI: edit/delete buttons di ExpensesList + new "Kategori" tab di CashSection. |
| `fecacbe` | `fix(auth): persist approver-token blacklist to DB` — `consumed_approver_tokens` table (jti PK, expires_at, consumed_at). INSERT...ON CONFLICT DO NOTHING + return-rows = 0 → `APPROVER_TOKEN_ALREADY_USED`. Atomic single-use across multi-instance Vercel. Probabilistic GC ~1% of consumes. Migration `0001_cute_iron_fist.sql` applied. Unit tests pakai `vi.mock("@/db", ...)` dengan in-memory Set untuk simulasi. |
| `0a853e5` | `feat(ops): weekly Postgres backup via GitHub Actions + manual script` — `.github/workflows/db-backup.yml` cron Sunday + workflow_dispatch + `scripts/backup-db.sh` manual fallback. Custom-format pg_dump, 90-day artifact retention. |
| `7fc0234` | `fix(audit): split barrel so client components can't pull server-only` — `@/lib/audit` barrel sekarang types/consts only. Server callers harus import dari `@/lib/audit/logger` atau `@/lib/audit/queries` directly. Build-blocker fix sebelumnya. |

### Wave 2 — post-deploy bug-fix wave (7 commits)

| Commit | What |
|---|---|
| `e050870` | `fix(ci): force pg_dump-17 path in backup workflow` — first GitHub Actions run failed because Ubuntu's preinstalled pg_dump 16.13 was first in PATH (server is 17.8 → version mismatch). Fix: prepend `/usr/lib/postgresql/17/bin` to PATH in dump step. |
| `27bd12c` (main) | Cherry-pick of `0a853e5` to main. Workflow has to live on default branch for GitHub schedule + workflow_dispatch to register. |
| `8ce7597` (main) | Cherry-pick of `e050870` to main (CI fix). |
| `cd98828` (main) | `chore(deploy): add vercel.json with main-deploy disabled` — main wasn't supposed to auto-deploy. Pushing workflow files to main triggered a Production rebuild from main's pre-sesi-3 app code → landing balik ke "UI Showcase", auth cookies dari sesi 5 deploy mismatch → redirect loop. Add `vercel.json` with `git.deploymentEnabled.main = false` to lock down. |
| `219f5c9` | `fix(deploy): disable Vercel auto-deploy from main branch` — same vercel.json change on release/phase-1 (matching main). Vercel reads vercel.json from each commit being deployed, so the rule must exist on every branch we want to skip. |
| `e7a4d70` | `fix(middleware): break redirect loop on expired session` — two bugs: (1) `cookies.delete(name)` defaults path to *request path*, so clearing session-cookie from `/dashboard` doesn't override the `/`-scoped Auth.js cookie. Fix with explicit `path: "/"` (and `secure: true` for `__Secure-` prefix). (2) `/login` route bounced authenticated users to `/dashboard` without checking roleExp, so expired-but-signature-valid JWT loop forever. Fix: treat expired as unauthenticated globally, clear-and-continue (no redirect) on public paths. |
| `b0a56a5` | `fix(pos): wire reprint button — was still M16-stub after M16 shipped` — extracted `printTransactionReceipt(trx, cashierName) → PrintOutcome` to `src/lib/printer/print-transaction.ts`. Both PaidPanel (POS post-payment) and HistoryDetailModal reprint buttons sekarang real-print dengan toast feedback (success / not_paired / send_failed). Auto-print on payment migrates to same helper, still best-effort silent. |

### 2.1 Production deploys saat sesi 5

```
2m  ago — mahakan-3uilkwes3 (b0a56a5) ← LIVE NOW
~10m ago — mahakan-... (e7a4d70)         middleware fix
~50m ago — mahakan-d7mjcekxi (7fc0234)   first sesi 5 PRD-complete deploy
~3h ago  — mahakan-1v1ysokry (62b9d66)   pre-sesi-5 baseline
```

---

## 3. File Structure Updates

### 3.1 New files (sesi 5)

```
mahakan-pos/
├── .github/workflows/
│   └── db-backup.yml                       # Weekly Postgres dump cron
├── scripts/
│   └── backup-db.sh                        # Local manual backup
├── drizzle/migrations/
│   ├── 0001_cute_iron_fist.sql             # consumed_approver_tokens table
│   └── meta/0001_snapshot.json
├── src/
│   ├── db/schema/
│   │   └── approver-tokens.ts              # consumed_approver_tokens schema
│   ├── lib/
│   │   ├── audit/                          # NEW MODULE
│   │   │   ├── index.ts                    # public types/consts only (client-safe)
│   │   │   ├── logger.ts                   # server: logAudit, diffShallow
│   │   │   ├── queries.ts                  # server: fetchAuditLogs
│   │   │   └── types.ts                    # AuditEventType registry
│   │   ├── pdf-export/
│   │   │   └── index.ts                    # branded jsPDF helpers
│   │   └── printer/
│   │       └── print-transaction.ts        # NEW — shared print helper used by
│   │                                       #   auto-print + 2 reprint buttons
│   └── features/
│       ├── audit/                          # NEW (server action wrapper)
│       │   ├── actions.ts                  # listAuditLogs (Owner-only)
│       │   └── index.ts
│       └── admin/sections/
│           ├── AuditLogSection.tsx         # NEW (Owner sidebar tab)
│           ├── settings/                   # NEW folder
│           │   ├── BusinessInfoModal.tsx
│           │   ├── OperationalHoursModal.tsx
│           │   └── SettingsTunablesModal.tsx
│           ├── reports/
│           │   └── SalesRangeView.tsx      # NEW (weekly/monthly tab)
│           ├── menu/
│           │   └── BulkActionsBar.tsx      # NEW
│           └── cash/
│               └── CategoriesList.tsx      # NEW (expense categories tab)
├── vercel.json                             # NEW: git.deploymentEnabled.main = false
└── docs/
    ├── 99-HANDOVER-SESSION-5.md            # this file
    └── 99-PHASE-2-ROADMAP.md               # Phase 2 planning
```

### 3.2 Modified existing files (sesi 5)

```
src/
├── db/schema/
│   └── index.ts                            # added export for approver-tokens
├── lib/auth/
│   ├── config.ts                           # rate-limit + audit on login/out
│   └── approver.ts                         # in-memory Map → DB INSERT
├── middleware.ts                           # cookie clear path=/ + expired-as-unauth
├── features/
│   ├── auth/SessionProvider.tsx            # (no change sesi 5; sesi 3 fix retained)
│   ├── transactions/actions.ts             # audit logs on void/refund/discount
│   ├── users/actions.ts                    # audit logs on user CRUD
│   ├── menu/actions.ts                     # bulk + CSV + audit logs
│   ├── menu/index.ts                       # export bulkUpdate + exportCsv
│   ├── cash/actions.ts                     # expense edit/delete + category CRUD
│   ├── cash/index.ts                       # export new actions
│   ├── reports/{queries,actions,index,types}.ts  # range report
│   ├── outlets/actions.ts                  # 5 update functions
│   ├── outlets/index.ts                    # export update functions
│   ├── pos/PosShell.tsx                    # printTransactionReceipt import +
│   │                                       #   PaidPanel reprint wiring
│   ├── pos/components/HistoryDetailModal.tsx  # reprint button wiring
│   └── admin/
│       ├── AdminShell.tsx                  # render AuditLogSection
│       ├── components/AdminLeftNav.tsx     # add "Audit Log" Owner-only nav
│       ├── sections/CashSection.tsx        # add "Kategori" tab
│       ├── sections/ReportsSection.tsx     # add "Mingguan / Bulanan" tab
│       ├── sections/SettingsSection.tsx    # add Edit buttons per card
│       ├── sections/cash/ExpenseFormModal.tsx  # support edit mode
│       ├── sections/cash/ExpensesList.tsx     # edit/delete buttons
│       └── sections/menu/ItemsList.tsx        # checkbox + bulk + CSV
└── tests/unit/
    └── auth-approver.test.ts               # mock @/db for DB blacklist
PROGRESS.md                                  # updated session log
.gitignore                                   # /backups/, *.dump
.claude/settings.json                        # +4 Bash allowlist entries
```

### 3.3 Untracked (do NOT commit)

- `.claude/` — VSCode extension state (kecuali `settings.json` yang udah committed di sesi sebelumnya — udah ada di repo)
- `note` — IDE auto-creates this empty file (still annoying)

---

## 4. Test Credentials

Same as sesi 4:
- **Owner**: email `rama.activity98@gmail.com` + password from `.env.local SEED_OWNER_PASSWORD`
- **Manager**: Galih Pratama (admin-created sesi 2 smoke test) — email + PIN
- **Staff**: Farhan (admin-created) — PIN

To list real DB state:
```bash
npx tsx scripts/list-users.ts
```

To set Owner PIN:
```bash
npx tsx scripts/set-user-pin.ts rama.activity98@gmail.com 1234
```

### 4.1 Verify state commands

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
npm run typecheck     # tsc --noEmit, must exit 0
npm run lint          # eslint, clean
npx vitest run        # 175/175 passing
npm run build         # webpack mode, 11 routes
git branch --show-current   # release/phase-1
curl -sI https://mahakan-pos.vercel.app/   # HTTP/2 200
```

Expected build output route list:
```
/                    static  (minimal hero landing)
/_not-found          static
/api/auth/[...]      dynamic
/api/v1/auth/{...}   dynamic (3 routes)
/dashboard           static
/login               static
/pin                 static
/pos                 static
/showcase            static
+ middleware (proxy)
```

### 4.2 Production smoke test for sesi 5 features (~15 menit)

1. **Audit Log** — login Owner → sidebar "Audit Log" → filter event "auth.login.success" → record terlihat
2. **Settings edit** — Settings → Business Info card → klik Edit → ubah nomor telepon → Simpan → reload → kebawa
3. **Threshold edit** — Settings → Receipt/Threshold → klik Edit → ubah variance ke 5000 → Simpan
4. **Operational hours** — Settings → Jam Operasional → Edit → ubah Sabtu jam → Simpan
5. **Weekly report** — Reports → tab "Mingguan / Bulanan" → preset 7d → liat % change vs week before
6. **PDF export** — Daily Sales → tombol "Export PDF" → file ter-download dengan branded outlet header
7. **Best/Slow Mover badges** — Item Performance → kalau >4 item dengan sales → badge muncul di top/bottom rows
8. **Menu bulk** — Menu → centang 3 item → BulkActionsBar appears → "Adjust Price %" → +10 → terapkan
9. **CSV export** — Menu (Owner) → tombol "Export CSV" → file ter-download
10. **Cash CRUD** — Cash → Pengeluaran → klik Edit di salah satu row (Owner anytime, Manager ≤24h) → save
11. **Category CRUD** — Cash → tab "Kategori" → tambah "Bonus karyawan" → muncul di dropdown ExpenseFormModal
12. **Login rate-limit** — logout → login dengan password salah 5x → cek error "account locked" → tunggu 15 min atau reset via `scripts/set-user-pin.ts`-style intervention
13. **Approver token DB** — staff logout → masuk POS → buat order → bayar → klik discount → approver flow (Owner PIN) → coba pakai token sama 2x harus fail di kedua kali (sesi 5 fix)
14. **Reprint POS** — pas success screen → klik "Cetak Ulang" → harus print (kalau printer paired) atau toast "belum di-pair"
15. **Reprint History** — buka Riwayat → trx detail → klik "Cetak Ulang" → sama seperti #14
16. **Auto-print** — bayar order → pas tap "Konfirmasi" → printer otomatis print (kalau paired)

---

## 5. Memory & Context

### 5.1 Auto-loaded memory (`MEMORY.md`)

Setelah sesi 5:
```
- git-rebase-abort-caveat
- week1-day1-status (semi-stale; Foundation done 2026-04-24)
- pause-before-destructive
- pat-handling-preference
- tsd-version-lock-resolved
- offline-only-dev-mode (SUPERSEDED — production live)
- session3-handover (semi-stale)
- session4-handover (SUPERSEDED by sesi 5)
- session5-handover (THIS file's pointer — to be added at end of sesi 5)
```

### 5.2 Critical files to (re-)read before starting sesi 6

1. `docs/99-HANDOVER-SESSION-5.md` (this file) — primary entry
2. `MEMORY.md` agent-side (auto-loaded)
3. `PROGRESS.md` — milestone tracker
4. `docs/99-PHASE-2-ROADMAP.md` — Phase 2 planning + tier 1 starting point
5. `AGENTS.md` — hard rules
6. `docs/05-ROLES-RBAC.md` — kalau ada rbac question
7. `docs/04-MENU-DATA.md` — menu source of truth
8. `docs/03-TSD.md` — schema reference

### 5.3 User communication style (still in force)

- Bahasa: campur Indonesian + English; UI Indonesian, code English
- User bukan developer — pakai bahasa sederhana, visual progress (✓/⏳/⚠️)
- Confirm sebelum destructive ops (push to main, branch delete, DB drop)
- Self-verify (typecheck + lint + tests + build) sebelum klaim done
- Terminal interactions all dijalanin oleh AI agent
- Commit per milestone atau sub-chunk dengan format `feat(...)/fix(...)/docs(...)/chore(...)`

---

## 6. Known Issues / Tech Debt (Updated)

### 6.1 M16 hardware — partial verified

- ✓ Settings → Pair Printer + Test Print: confirmed by user (RPP02 print struk "Test Print" sukses 2026-04-27 15:16 WIB)
- ⏳ Auto-print pas bayar: shipped tapi belum field-tested di transaksi real
- ⏳ Reprint button (PaidPanel + HistoryDetailModal): just shipped sesi 5 final commit, belum field-tested

### 6.2 PR not merged to main

`release/phase-1` is 75+ commits ahead of `main` (di app code). Merging tidak urgent karena Vercel deploy dari release branch. Kalau mau merge nanti, perlu open PR.

### 6.3 Preview env vars on Vercel not configured

Production vars set, Preview environment kosong. PR previews bakal fail. Defer sampai PR-review flow benar-benar dipakai.

### 6.4 Next.js 16 deprecation: `middleware` → `proxy`

Next 16.2.4 emits warning at every build:
```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```
Non-blocking. Cleanup task: rename `src/middleware.ts` → `src/proxy.ts`.

### 6.5 Receipt config hardcoded in print-transaction.ts

`src/lib/printer/print-transaction.ts` punya `OUTLET_META` const dengan name/address/phone/footer hardcoded. Owner-edit di Settings UI **tidak** terkirim ke struk yang dicetak. Tracked sebagai Phase 2 polish.

### 6.6 Audit log retention belum ada

Table `audit_logs` akan tumbuh terus. Belum ada policy auto-prune. Phase 2 task: cron to delete > 6 months OR archive ke artifact.

### 6.7 Approver token GC observability

GC probabilistic 1%. Belum ada metric berapa rows tersisa di `consumed_approver_tokens`. Bisa cek manual via Drizzle Studio.

### 6.8 Audit writes synchronous

`logAudit()` di-await dalam server action. Performance impact kecil tapi bisa async (queue) di Phase 2 kalau audit volume naik.

### 6.9 Receipt photo upload skipped (C3=C from Phase 1)

`expenses.receiptImageUrl` schema-ready. UI upload di-skip. Phase 2 dengan Vercel Blob bisa.

### 6.10 No backup automation → SOLVED

Weekly cron via GitHub Actions live. Artifact `mahakan-pos-*.dump` 90-day retention. Manual trigger via Actions tab.

### 6.11 Rate limiting on auth → SOLVED

5 failed attempts → 15 min lock via `users.failed_attempts` + `users.locked_until`.

### 6.12 Approver token blacklist in-memory → SOLVED

DB-persistent via `consumed_approver_tokens` table. Atomic single-use across multi-instance Vercel.

### 6.13 LAN dev access requires IP whitelist (unchanged)

`next.config.ts` has `allowedDevOrigins: ['192.168.1.101']`.

### 6.14 React 19 ESLint rule (unchanged)

`react-hooks/set-state-in-effect` strict. Use eslint-disable for legitimate "sync from external async source" patterns.

### 6.15 Vercel auto-deploy from main → DISABLED via vercel.json

Locked via `git.deploymentEnabled.main = false`. Push to main akan TIDAK trigger Production deploy. Kalau di masa depan main perlu deploy (after merge release/phase-1 → main), hapus rule itu.

---

## 7. How to Resume (Sesi 6)

### 7.1 Boot prompt (copy-paste ke Claude Code)

```
Halo, gua mau lanjut Mahakan POS. Sesi 5 selesai dengan production
stable + Phase 1 PRD-complete. Baca handover di
docs/99-HANDOVER-SESSION-5.md sampai habis. Lalu Phase 2 roadmap di
docs/99-PHASE-2-ROADMAP.md.

Verify state:
  - npm run typecheck && npm run lint && npx vitest run && npm run build
  - curl -sI https://mahakan-pos.vercel.app/  (confirm production hidup)
  - git branch --show-current  (HARUS release/phase-1)

Kalau semua green, kasih ringkasan status + tanya:
  - M16 field test (auto-print + reprint di POS dengan transaksi real)?
  - M20 soft launch (training script + walkthrough doc untuk staff)?
  - Phase 2 Tier 1 starter (rekomendasi: Recipe/BOM + Inventory)?
  - Atau ada feedback / bug dari pemakaian production minggu ini?
```

### 7.2 Context loading order

1. **MEMORY.md** (auto-loaded)
2. **`docs/99-HANDOVER-SESSION-5.md`** (this file)
3. **`docs/99-PHASE-2-ROADMAP.md`**
4. **`PROGRESS.md`**
5. **`AGENTS.md`**
6. (Optional) docs/05-ROLES-RBAC.md, docs/03-TSD.md

### 7.3 Before any edit

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
git log --oneline | head -10
git status
git branch --show-current  # MUST be release/phase-1
```

Verify HEAD = `b0a56a5` (or progressed in sesi 6). Branch HARUS `release/phase-1`.

---

## 8. Phase 1 Milestone Status (FINAL)

```
Fase A (UI Prototype):
M0 ✅ M1 ✅ M2 ✅ M3 ✅ M4 ✅ M5 ✅ M6 ✅ M7 ✅

Fase B (Backend):
M8 ✅ M9 ✅ M10 ✅ M11 ✅ M12 ✅ M13 ✅ M14 ✅ M15 ✅
M16 🟡 (code-complete + Settings test print verified; auto-print + reprint shipped, awaiting field test)
M17 ✅ M18 ✅
M19 ✅ DONE 2026-04-26
M20 ⏸ Soft launch — pending user trigger

Phase-1-extra:
M21 ✅ DONE 2026-04-27 — full PRD §4-6 gap closure (sesi 5)
```

---

## 9. Important Reminders (Updated)

### 9.1 Don't (still in force)

- ❌ **Don't push to main** without user explicit OK per push (release/phase-1 push OK)
- ❌ **Don't force-push** without explicit OK
- ❌ **Don't commit** the `note` file
- ❌ **Don't bundle** changes the user didn't ask for; suggest first
- ❌ **Don't use** `any` di TypeScript
- ❌ **Don't introduce** float math for money — use `src/lib/money.ts`
- ❌ **Don't skip** server-side validation
- ❌ **Don't add** features outside Phase 2 scope yang lagi dikerjain (no scope creep within tier)
- ❌ **Don't echo** secrets to chat — point user to file paths
- ❌ **Don't remove** `--webpack` flag from `next build` (Serwist needs it)
- ❌ **Don't remove** `vercel.json` `git.deploymentEnabled.main = false` (safety net)
- ❌ **Don't re-add** server-only exports to `@/lib/audit` barrel — split was intentional (build error otherwise)

### 9.2 Do (still in force)

- ✅ **Verify** typecheck + lint + tests + build before claim done
- ✅ **Commit per logical chunk** dengan conventional format
- ✅ **Hard-nav after auth state changes** via `window.location.assign`
- ✅ **Log audit** for new mutations (use `logAudit` from `@/lib/audit/logger`)
- ✅ **Reuse `printTransactionReceipt`** untuk print apa pun — jangan re-build
- ✅ **Update PROGRESS.md** as milestones complete
- ✅ **Test in browser** after major changes (kalau bisa user yang test di tablet)
- ✅ **Communicate progress** dengan ringkasan visual (✓/⏳/⚠️)

### 9.3 Sesi 5 lessons captured

- Vercel auto-deploy from non-default branches needs explicit project config; `vercel.json` `git.deploymentEnabled` per-branch is the right gate.
- `cookies.delete(name)` in Next.js middleware defaults path to request path — always pass `path: "/"` for session cookies.
- `__Secure-` prefixed cookies require `Secure: true` on Set-Cookie or browser ignores.
- GitHub Actions only schedules + dispatches workflows defined on the **default branch**.
- Server-only code can't be re-exported through a client-imported barrel — Next 16 build will block.
- For unit-testing DB-backed helpers, `vi.mock("@/db", ...)` works (lihat `tests/unit/auth-approver.test.ts`).

---

## 10. Final Status Snapshot

```
Date:        2026-04-27 (end of sesi 5)
Branch:      release/phase-1 (HEAD b0a56a5)
Main:        cd98828 (vercel.json + workflow only; 75+ behind in app code)
Build:       ✓ 11 routes, webpack mode (Serwist), 0 warnings beyond 1 deprecation note
Tests:       ✓ 175/175
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:   ✓ https://mahakan-pos.vercel.app
Vercel:       ramaactivity98-5695s-projects/mahakan-pos
PWA:          ✓ installable, fullscreen
DB on Neon (mahakan-pos, Singapore): consumed_approver_tokens table added; data unchanged

Phase 1 progress:
  Fase A: M0-M7   ✅ (all)
  Fase B: M8-M19  ✅ (all)
          M16     🟡 hardware partial-verified (Settings ✓; field test pending)
          M20     ⏸ soft launch
  M21     ✅ PRD gap closure (sesi 5)

GitHub:
  Repo secret DATABASE_URL_BACKUP set (Neon unpooled)
  Workflow db-backup live on main, last run 2026-04-27T07:53Z artifact saved
  Vercel.json git.deploymentEnabled.main = false (locked)

Next action: Tanya user — "M16 field test, M20 soft launch, Phase 2 Tier 1 (Recipe/BOM), atau bug feedback?"
```

---

## 11. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-27 | Sesi 5 → 6 handover. Captures PRD gap closure (8 commits) + post-deploy bug-fix wave (7 commits) + Phase 2 roadmap reference. Phase 1 PRD-complete. |

---

# 🛑 END HANDOVER SESI 5

**Mahakan POS Phase 1 PRD-COMPLETE. Production stable. AI agent baru: lo punya semua context untuk help Rama M16 field-validate, M20 soft-launch, atau mulai Phase 2 Tier 1 (Recipe/BOM + Inventory). Mulai dengan boot prompt di §7.1.**
