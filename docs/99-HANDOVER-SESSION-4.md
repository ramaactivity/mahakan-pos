# 🤝 HANDOVER SESI 4 — Mahakan POS

**Untuk:** Claude AI agent (sesi baru)
**Dari:** Sesi 3 (deploy + landing UX iteration)
**Date:** 2026-04-27
**Status:** **Production live di https://mahakan-pos.vercel.app** — M19 done. Tinggal M16 (hardware printer test) + M20 (soft launch).

---

## ⚡ TL;DR

Sesi 3 menyelesaikan **M19 deploy ke Vercel** + sejumlah polish UI yang dipicu screenshot user pas live-test di tablet. Phase 1 sekarang **publicly accessible** di internet — Owner bisa login dari mana aja.

**Cara mulai sesi 4:**
1. Baca file ini sampai habis (~10 menit)
2. Baca `MEMORY.md` (auto-loaded)
3. Verify state: `npm run typecheck && npm run lint && npx vitest run && npm run build`
4. Tanya user: "Mau lanjut hardware test M16, M20 soft launch, atau ada feedback dari pemakaian production?"

**Status code:**
- Branch active: **`release/phase-1`** (bukan main!) — production deploys dari sini
- 67 commits ahead of `origin/main` (PR belum di-merge ke main; deploy pake release branch)
- 175/175 tests passing
- Build: 11 routes (8 static + 3 dynamic API), webpack mode
- Vercel project: **`ramaactivity98-5695s-projects/mahakan-pos`** — GitHub-connected, auto-deploys on push
- DB: same Neon Singapore — no schema changes

---

## 1. Production State

### 1.1 URLs

| URL | Purpose |
|---|---|
| https://mahakan-pos.vercel.app | Production alias (stable) |
| https://mahakan-jnfq3yeo3-ramaactivity98-5695s-projects.vercel.app | First deploy immutable URL |
| (latest deploy hash changes per push) | Per-deploy immutable URLs |

Vercel dashboard: https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos

### 1.2 Vercel env vars set (Production scope)

```
DATABASE_URL          (Neon pooled)
AUTH_SECRET           (synced from .env.local)
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=https://mahakan-pos.vercel.app
NODE_ENV=production   (Vercel auto-set)
```

**Not set on Vercel** (development only): `SEED_OWNER_*` — DB sudah seeded, gak perlu.

**Preview env**: belum di-set. Kalau open PR, preview deploy akan fail karena `DATABASE_URL missing`. Belum jadi blocker karena belum ada PR review flow.

### 1.3 Branch + deploy strategy

- Local + remote `release/phase-1` synced (HEAD: `62b9d66`)
- `origin/main` stale (~67 commits behind release/phase-1)
- **Vercel auto-deploys dari release/phase-1** karena project linked ke repo + branch tracked
- PR belum dibuat/merged. URL untuk buat PR kalau user mau review-merge-to-main:
  https://github.com/ramaactivity/mahakan-pos/pull/new/release/phase-1
- `vercel.json` di repo: pin `buildCommand` ke `next build --webpack` (Serwist butuh webpack, bukan Turbopack default Vercel)

### 1.4 PWA install state

App fully PWA-installable:
- Manifest: `public/manifest.webmanifest` — `display: "fullscreen"` (no URL bar, no Android status bar)
- Icons: `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png` (Android adaptive), `/apple-touch-icon.png` (iOS)
- Service worker: `/sw.js` (Serwist, generated at build)
- Source logo: `public/assets/logo/Logo_Mahakan_Hijau_Transparent.png` (chroma-keyed dari source JPEG-as-PNG)

**Reinstall workflow** kalau icon di home screen masih lama: long-press icon → Uninstall → Chrome → fresh install dari address bar menu.

---

## 2. What Changed This Session (Sesi 3)

11 commits di atas `d09329c` (sesi 3 boot baseline). Order chronological:

| Commit | What |
|---|---|
| `13c8277` | `vercel.json` pin webpack build (Serwist compat) |
| `876deb8` | Landing redesign — premium hero at `/`, design system moved to `/showcase` |
| `e682a3e` | Whitelist `/showcase` di middleware (was redirecting to /login) |
| `a21fc4e` | PROGRESS.md M19 done |
| `804ef2d` | Simplify landing per user feedback — single-screen, transparent logo via chroma-key script |
| `ca8dfb3` | PWA proper PNG icons (192/512/maskable/apple-touch) + display fullscreen |
| `a3c1ca3` | Whitelist `icon-*.png` + `apple-touch-icon.png` di middleware (icon files were redirecting to /login) |
| `08df889` | Drop chunky `ring-2` focus stack on inputs — single border-color shift |
| `62b9d66` | (final) zero-box inputs (no focus border at all) + reliable logout via hard navigation |

### 2.1 Landing page evolution

`src/app/page.tsx` rewritten 3x:
1. **First** (sesi 2 leftover): full design-system showcase
2. **Second**: premium marketing-style hero with capabilities + Owner pitch + scroll indicator + footer
3. **Final** (current): minimal single-screen — logo + brand name + tagline + 2 CTA + helper line. Decorative drift backdrop kept.

Design system reference moved to `/showcase` (still accessible via direct URL, no link from landing).

### 2.2 Logo handling

User wanted brand-color (green) logo, not the dark mix-blend-difference fallback. Source logos di `public/assets/logo/Logo_Mahakan_*.png` actually JPEG-as-PNG with **black background** (no alpha channel).

**Solution**: `scripts/process-logo.ts` — Sharp-based luma-threshold chroma-key. 71.3% pixels (the black bg) made transparent. Output: `Logo_Mahakan_Hijau_Transparent.png`.

PWA icons generated separately via `scripts/generate-icons.ts` — same Sharp utility, different fillRatio per icon spec (90% for "any" purpose, 70% for maskable safe zone).

Both scripts re-runnable. To regenerate (e.g., new threshold or new variant):
```bash
npx tsx scripts/process-logo.ts
npx tsx scripts/generate-icons.ts
```

### 2.3 Input UX fixes (per user explicit ask "hilangkan box seutuhnya")

- `src/components/ui/Input.tsx` wrapper drops `focus-within:border-*` entirely → border stays `neutral-300` always
- 5 native input/textarea inline styles in admin Cash/Menu sections + POS ItemNoteModal: same drop
- `globals.css`: `input/textarea/select:focus-visible { outline: none }` — opt out of global keyboard outline so chunky 2px+offset never appears
- `globals.css`: webkit-autofill background tint killed via canonical `-webkit-box-shadow: 0 0 0 1000px white inset` + 600000s color transition

Buttons + nav links **keep** their `focus-visible:ring-2` — only fires on keyboard tab, essential for a11y.

### 2.4 Logout bug fix

**Root cause**: `signOut({ redirect: false })` returned before cookie clear settled, AdminShell/PosShell did `router.replace` (Next.js client routing, no full reload), `/login` mounted with stale `useSession` context still returning "authenticated" → `useEffect` fired auto-redirect to dashboard. User saw "I clicked Masuk and it auto-logged me in to old account."

**Fix** in `src/features/auth/SessionProvider.tsx`:
```ts
logout: async (callbackUrl: string = "/login") => {
  await nextAuthSignOut({ redirect: false });
  window.location.assign(callbackUrl); // hard nav nukes all React state
}
```

`AdminShell.tsx` and `PosShell.tsx` call `await logout("/login")` and `await logout("/pin")` respectively — no `router.replace` follow-up needed. `useRouter` import + declaration removed from PosShell (unused after fix).

---

## 3. File Structure Updates

### 3.1 New files (sesi 3)

```
mahakan-pos/
├── vercel.json                              # Pin webpack build for Serwist
├── public/
│   ├── icon-192.png                         # PWA Android Chrome standard
│   ├── icon-512.png                         # PWA Android high-res
│   ├── icon-maskable-512.png                # PWA Android adaptive (sage-50 bg, 70% safe zone)
│   ├── apple-touch-icon.png                 # iOS Safari Add to Home Screen
│   └── assets/logo/
│       └── Logo_Mahakan_Hijau_Transparent.png  # Chroma-keyed source for icons
├── scripts/
│   ├── process-logo.ts                      # NEW — sharp chroma-key utility
│   └── generate-icons.ts                    # NEW — sharp PWA icon generator
├── src/app/
│   ├── page.tsx                             # REWRITTEN (3x) — final: minimal hero
│   ├── showcase/page.tsx                    # MOVED from old src/app/page.tsx
│   └── globals.css                          # Added: fade-up + drift keyframes,
│                                            #   input :focus-visible opt-out,
│                                            #   webkit-autofill kill
├── docs/
│   ├── 99-HANDOVER-SESSION-3.md (sesi 2→3, semi-stale now)
│   └── 99-HANDOVER-SESSION-4.md (this file, sesi 3→4)
└── (modified existing)
   ├── public/manifest.webmanifest           # display: fullscreen, new icons array
   ├── src/middleware.ts                     # Public path: + /showcase. Matcher: + icon-/apple-touch-icon
   ├── src/components/ui/Input.tsx           # Drop focus border shift entirely
   ├── src/features/auth/SessionProvider.tsx # Hard-nav logout
   ├── src/features/admin/AdminShell.tsx     # Pass /login to logout
   ├── src/features/pos/PosShell.tsx         # Pass /pin to logout, drop unused useRouter
   └── PROGRESS.md                           # M19 marked done
```

### 3.2 Untracked (do NOT commit)

- `.claude/` — VSCode extension state
- `note` — IDE auto-creates this empty file (recurring annoyance, ignore)

---

## 4. Test Credentials

Same as sesi 3:
- **Owner**: email `rama.activity98@gmail.com` + password from `.env.local SEED_OWNER_PASSWORD`
- **Manager**: Galih Pratama (created via admin UI in sesi 2 smoke test) — email + PIN
- **Staff**: Farhan (created via admin UI) — PIN

To list real DB state:
```bash
npx tsx scripts/list-users.ts
```

To set Owner PIN (kalau perlu PIN login Owner):
```bash
npx tsx scripts/set-user-pin.ts rama.activity98@gmail.com 1234
```

### 4.1 Verify state commands

```bash
cd /Users/macbookpro/Desktop/POS-ERP-MAHAKAN
npm run typecheck     # tsc --noEmit, must exit 0
npm run lint          # eslint, must exit 0 with no warnings
npx vitest run        # 175/175 passing
npm run build         # webpack mode, 11 routes (was 10 before /showcase split)
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
/showcase            static  (design system reference)
+ middleware (proxy)
```

### 4.2 Production smoke test (~10 menit)

Open https://mahakan-pos.vercel.app di fresh browser/incognito:

1. Landing `/` → minimal hero with green logo, 2 CTA
2. `/showcase` (direct URL) → design system page with all components
3. `/login` → Owner email + password → redirect ke `/dashboard`
4. Dashboard real Neon data (revenue cards, hourly chart, top items)
5. Menu / Staff / Cash / Laporan / Settings tabs
6. Logout → harus hard-reload → kosong di /login (test logout fix)
7. `/pin` → avatar grid (Farhan, Galih, anyone with PIN) → PIN login → /pos
8. POS: open shift → order → bayar → on-screen receipt
9. Void/refund flow with approver
10. **Offline test**: DevTools → Application → Service Workers → tick "Offline" → place order → "Tersimpan" toast → uncheck → "Tersync"
11. **PWA install** (Android Chrome / desktop Chrome): address bar install icon → install → app jalan fullscreen tanpa URL bar dan tanpa Android status bar

---

## 5. Memory & Context

### 5.1 Auto-loaded memory (`MEMORY.md`)

After this session:
```
- git-rebase-abort-caveat
- week1-day1-status (semi-stale; Foundation done 2026-04-24)
- pause-before-destructive
- pat-handling-preference
- tsd-version-lock-resolved
- offline-only-dev-mode (SUPERSEDED — production live now, push/deploy normal cadence allowed)
- session3-handover (semi-stale; this file replaces it for sesi 4)
- session4-handover (THIS file's pointer)
```

`offline-only-dev-mode` masih ada tapi explicitly marked superseded — content describes new policy: feature/release branch push OK without per-action approval; main push + force-push still need explicit confirm.

### 5.2 Critical files to (re-)read before starting sesi 4

1. `docs/99-HANDOVER-SESSION-4.md` (this file) — primary entry
2. `MEMORY.md` agent-side (auto-loaded)
3. `PROGRESS.md` — milestone tracker
4. `AGENTS.md` — hard rules
5. `docs/05-ROLES-RBAC.md` — kalau ada rbac question
6. `docs/04-MENU-DATA.md` — menu source of truth
7. `docs/03-TSD.md` — schema reference

### 5.3 User communication style (still in force)

- Bahasa: campur Indonesian + English; UI Indonesian, code English
- User bukan developer — pakai bahasa sederhana, visual progress (✓/⏳/⚠️)
- Confirm before destructive ops (push to main, branch delete, DB drop)
- Self-verify (typecheck + lint + tests + build) sebelum klaim done
- Terminal interactions all dijalanin oleh AI agent
- Commit per milestone or sub-chunk dengan format `feat(...)/fix(...)/docs(...)/chore(...)`

---

## 6. Known Issues / Tech Debt (Updated)

### 6.1 Hardware verify pending (M16)

ESC/POS encoder + receipt builder + Bluetooth wrapper coded against typical RPP02-class printers (UUID `000018f0-0000-1000-8000-00805f9b34fb`). User belum sempet pair RPP02 di tablet. Test print button di Settings.

### 6.2 PR not merged to main

`release/phase-1` (production deploy source) is 67 commits ahead of origin/main. Vercel happily deploys from release branch. Merging to main is **optional** — kalau user mau "rebaseline main = production":
- Open PR via https://github.com/ramaactivity/mahakan-pos/pull/new/release/phase-1
- Review (or just merge) → Vercel will redeploy from main
- Then can delete release/phase-1 branch

Per memory `pause-before-destructive` — confirm dengan user dulu sebelum merge atau delete branch.

### 6.3 Preview env vars on Vercel not configured

Production vars set (DATABASE_URL, AUTH_SECRET, etc), but Preview environment doesn't have them. Akibatnya kalau open PR, preview deploy will fail. Fix kalau user mau PR-review flow:
```bash
# For each var needed in Preview, run interactively (specifies branch glob)
npx -y vercel env add DATABASE_URL preview
# ...etc for AUTH_SECRET, AUTH_TRUST_HOST, NEXT_PUBLIC_APP_URL
```

### 6.4 Next.js 16 deprecation: `middleware` → `proxy`

Next 16.2.4 emits warning at every build:
```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```

Non-blocking, runtime works. Cleanup task: rename `src/middleware.ts` → `src/proxy.ts`, update related Next config if any. Defer until annoying or until upgrade to Next 17.

### 6.5 Status bar Android hidden in PWA fullscreen

Per manifest `display: "fullscreen"` — staff using POS gak liat clock/baterai/notifikasi while di app. Cocok untuk POS use-case. Kalau Owner ngeluh karena admin work hours-long, ganti manifest ke `"standalone"` + redeploy. URL bar tetap hidden, status bar muncul lagi.

### 6.6 PWA icon cache aggressively

Chrome / Android launcher cache icon hash. Setelah redeploy dengan icon baru, kalau home screen icon masih old:
- Long-press icon → Uninstall (or "Remove from Home screen")
- Clear Chrome cache untuk mahakan-pos.vercel.app (Settings → Site settings)
- Reinstall dari address bar menu

### 6.7 `note` file recurring

User's IDE re-creates empty `note` di root. Each commit step skipped — gak destructive but annoying. **Don't commit it.**

### 6.8 Preview env (no PR previews work yet)

See §6.3.

### 6.9 Audit log table empty

`audit_logs` table exists but no writes happen yet. Phase 2 work.

### 6.10 No backup automation

Neon free tier 7-day PITR is the only backup.

### 6.11 Rate limiting on auth

Not implemented. `users.failed_attempts` column exists but not incremented.

### 6.12 Approver token blacklist in-memory

`src/lib/auth/approver.ts` keeps consumed jti in process Map. Vercel serverless = multiple instances; race possible (5-min token expiry caps blast radius).

### 6.13 LAN dev access requires IP whitelist

`next.config.ts` has `allowedDevOrigins: ['192.168.1.101']`. If user's home network IP changes, update or replace with glob (`192.168.*.*`).

### 6.14 React 19 ESLint rule

`react-hooks/set-state-in-effect` strict. `eslint-disable-next-line` scattered for legitimate "sync from external async source" patterns. Don't fight globally.

---

## 7. How to Resume (Sesi 4)

### 7.1 Boot prompt (copy-paste ke Claude Code)

```
Halo, gua mau lanjut Mahakan POS. Sesi sebelumnya udah deploy ke production.
Baca handover di `docs/99-HANDOVER-SESSION-4.md` dulu sampai habis.
Verify state via npm run typecheck + lint + build + vitest.
Production live di https://mahakan-pos.vercel.app — confirm masih hidup via curl.
Kalau semua green, kasih ringkasan status + tanya:
  - Mau hardware test M16 (RPP02 ready)?
  - Atau M20 soft launch (training script + handover ke staff)?
  - Atau ada feedback / bug dari pemakaian production?
```

### 7.2 Context loading order

1. **MEMORY.md** (auto-loaded)
2. **This file** (`docs/99-HANDOVER-SESSION-4.md`)
3. **PROGRESS.md** (milestone tracker)
4. **AGENTS.md** (hard rules)
5. (Optional) **docs/05-ROLES-RBAC.md** kalau ada rbac question

### 7.3 Before any edit

```bash
git -C /Users/macbookpro/Desktop/POS-ERP-MAHAKAN log --oneline | head -10
git -C /Users/macbookpro/Desktop/POS-ERP-MAHAKAN status
git -C /Users/macbookpro/Desktop/POS-ERP-MAHAKAN branch --show-current  # MUST be release/phase-1
```

Verify HEAD matches `62b9d66` (or whatever sesi 4 progresses to). Branch HARUS `release/phase-1` — main is stale.

### 7.4 Suggested first questions to user

**"Phase 1 production live & polished. Lo prioritas mana:"**
- **A**: Hardware test M16 — pair RPP02 ke tablet, validate auto-print di POS checkout
- **B**: M20 soft launch — bikin training script + walkthrough doc untuk Rama / staff
- **C**: Feedback dari pemakaian production (bug, UX issue, design tweak)
- **D**: Address tech debt (PR merge ke main, preview env vars, middleware → proxy rename, dll)

---

## 8. Phase 1 Milestone Status (Updated)

```
Fase A (UI Prototype):
M0 ✅ M1 ✅ M2 ✅ M3 ✅ M4 ✅ M5 ✅ M6 ✅ M7 ✅

Fase B (Backend):
M8 ✅ M9 ✅ M10 ✅ M11 ✅ M12 ✅ M13 ✅ M14 ✅ M15 ✅
M16 ✅ (code-complete, hardware-verify pending)
M17 ✅ M18 ✅
M19 ✅ DONE 2026-04-26 — production live di https://mahakan-pos.vercel.app
M20 ⏸ Soft launch — pending user trigger
```

---

## 9. Important Reminders (Updated)

### 9.1 Don't (still in force)

- ❌ **Don't push to main** without user explicit OK (release/phase-1 push OK, main is special)
- ❌ **Don't force-push** without explicit OK (rewrites shared history)
- ❌ **Don't commit** the `note` file
- ❌ **Don't bundle** changes the user didn't ask for; suggest first
- ❌ **Don't use** `any` di TypeScript
- ❌ **Don't introduce** float math for money — use `src/lib/money.ts`
- ❌ **Don't skip** server-side validation
- ❌ **Don't add** features outside Phase 1 scope (no KDS, split payment, recipe/BOM, loyalty)
- ❌ **Don't echo** secrets to chat — point user to file paths instead
- ❌ **Don't remove** `--webpack` flag from `next build` (Serwist needs it)
- ❌ **Don't remove** `vercel.json` — it pins the build command on Vercel side too

### 9.2 Do (still in force)

- ✅ **Verify** typecheck + lint + tests + build before claim done
- ✅ **Commit per milestone or sub-chunk** dengan conventional format
- ✅ **Hard-nav after auth state changes** (login/logout) via `window.location.assign` — Next router.replace alone is racy
- ✅ **Reuse scripts/process-logo.ts + scripts/generate-icons.ts** kalau perlu regen logo/icons
- ✅ **Update PROGRESS.md** as milestones complete
- ✅ **Test in browser** after major changes
- ✅ **Communicate progress** dengan ringkasan visual (✓/⏳/⚠️)

### 9.3 New post-deploy do's

- ✅ **Use Vercel CLI** via `npx -y vercel` (no global install — perms issue with `npm install -g`)
- ✅ **Confirm Vercel build** uses `next build --webpack` (vercel.json pins this)
- ✅ **After production redeploy**, advise user hard-refresh (Cmd+Shift+R) for CSS changes; for PWA changes, advise reinstall

---

## 10. Final Status Snapshot

```
Date:        2026-04-27 (end of sesi 3)
Branch:      release/phase-1 (synced with origin)
Main:        7fcced2 (67 commits behind release/phase-1, no PR merged yet)
Build:       ✓ 11 routes, webpack mode (Serwist), 0 warnings (1 deprecation note)
Tests:       ✓ 175/175
Lint:        ✓ clean
Typecheck:   ✓ strict mode, no any

Production:  ✓ https://mahakan-pos.vercel.app
Vercel:      ramaactivity98-5695s-projects/mahakan-pos
PWA:         ✓ installable, fullscreen display, proper icon set
DB on Neon (mahakan-pos, Singapore): unchanged

Phase 1 progress:
  Fase A: M0-M7   ✅ (all)
  Fase B: M8-M19  ✅ (M19 done in sesi 3)
          M16     ⏸ hardware verify (RPP02 printer)
          M20     ⏸ soft launch (training/handover to user)

Next action: Tanya user — "Mau hardware M16, M20 soft launch, feedback prod, atau tech debt?"
```

---

## 11. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-26 | Initial sesi 2→3 handover (predecessor) |
| 1.0 | 2026-04-27 | Sesi 3→4 handover. Captures M19 deploy + landing UX iteration + PWA polish + logout fix. |

---

# 🛑 END HANDOVER SESI 4

**Mahakan POS Phase 1 publicly live. AI agent baru: lo punya semua context untuk help Rama hardware-test, soft-launch, atau iterate UX. Mulai dengan check-in question di §7.4.**
