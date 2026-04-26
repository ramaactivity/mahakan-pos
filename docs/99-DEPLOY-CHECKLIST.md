# 🚀 Mahakan POS — Deploy Checklist

**Status:** 📋 Ready to execute when user explicitly approves leaving offline-only mode.
**Date:** 2026-04-26
**For:** Phase 1 first production deploy → Vercel + Neon (existing).

---

## Pre-flight (✅ already done in dev, just verify)

| | Check | How |
|---|---|---|
| ☑ | Build passes locally | `npm run build` → 10 routes, no errors |
| ☑ | Type check clean | `npm run typecheck` → exit 0 |
| ☑ | Lint clean | `npm run lint` → 0 warnings |
| ☑ | All tests pass | `npx vitest run` → 151/151 |
| ☑ | DB migration applied | `npm run db:studio` → 13 tables present |
| ☑ | Seed populated | `npx tsx scripts/list-users.ts` → at minimum Owner row |
| ☑ | Service Worker bundle generates | After build, check `public/sw.js` exists (gitignored) |
| ☑ | Logo blends correctly | Eye-test `/login` and `/not-found` |

---

## Env vars required on Vercel

Copy these from `.env.local` → Vercel Project Settings → Environment Variables (set for **Production** + **Preview**, optional for **Development**).

### Critical (deploy will fail without these)

```
DATABASE_URL=                  # Neon pooled connection string
AUTH_SECRET=                   # same value as .env.local; rotating invalidates active sessions
AUTH_TRUST_HOST=true           # Auth.js v5 — required behind Vercel proxy
NEXT_PUBLIC_APP_URL=https://<your-vercel-domain>
NODE_ENV=production            # Vercel auto-sets, but fine to be explicit
```

### Seed-time only (safe to drop after first deploy)

```
SEED_OWNER_NAME=
SEED_OWNER_EMAIL=
SEED_OWNER_PASSWORD=
```

These are read by `npm run db:seed` when initializing a fresh DB. If your Neon instance is already seeded (it is, from the dev cycle), Vercel doesn't need them at runtime — drop them from Vercel env. Keep in `.env.local` for emergency re-seed of a new env.

### Optional (drop or set later)

```
SEED_OWNER_PIN=                # if you want script-set Owner PIN at deploy time
```

---

## Step-by-step

### 1. GitHub push

The branch `main` is **53+ commits ahead of origin** (offline-only mode). Push:

```bash
git push origin main
```

⚠️ Per memory `pat-handling-preference`: lo run push sendiri di terminal lo. Jangan paste PAT ke chat. Kalau pakai SSH key (recommended), token gak relevan.

If you want a PR-based flow (review-before-deploy), instead:

```bash
git checkout -b release/phase-1
git push -u origin release/phase-1
gh pr create --title "Phase 1 launch — POS + admin + offline" --body "..."
```

### 2. Vercel project setup

If repo not linked yet:

1. https://vercel.com/new → import the `mahakan-pos` GitHub repo
2. Framework: **Next.js** (auto-detected)
3. Build command: leave default (`next build`); Vercel runs Turbopack-vs-webpack negotiation. **Watch out:** our `package.json` has `"build": "next build --webpack"` because of Serwist's webpack plugin. Verify Vercel respects this. If not, override Build Command in project settings.
4. Output: leave default
5. Install command: leave default

### 3. Set env vars

Add the env vars from §"Critical" above. **Don't deploy yet** — Auth.js will refuse without `AUTH_SECRET`.

Common typo: `NEXT_PUBLIC_APP_URL` must include `https://` and **no trailing slash**.

### 4. Deploy

Push triggers auto-deploy. Watch the Vercel build log:

- Compile success
- Static pages generated (8 of the 10 routes are static; 2 are dynamic API routes + middleware)
- No "AUTH_SECRET missing" errors
- Service Worker emitted

### 5. First-load smoke test (production)

Open the Vercel-provided URL on a **fresh browser** (or incognito). Run through:

1. **Landing** `/` → showcase loads, no flashes of unstyled content
2. **404** `/foo-bar` → custom Mahakan 404 page
3. **Login** `/login` → email + password form, Mahakan logo
4. **Login as Owner** → email = `SEED_OWNER_EMAIL`, password = whatever you set → redirects to `/dashboard`
5. **Dashboard** loads with real data from Neon (revenue cards, hourly chart, top items)
6. **Menu tab** → 43 items list visible
7. **Staff tab** → Owner + any seeded staff visible
8. **PIN login** logout, navigate `/pin` → avatar grid loads (must have at least one PIN-set user; if empty, set one via admin)
9. **POS flow** → open shift, place order, pay, verify in DB via Drizzle Studio
10. **Offline test** → DevTools → Application → Service Workers → tick "Offline" → place order → toast "Offline — tersimpan" → uncheck → toast "Tersync"
11. **PWA install** → Chrome address bar should show install icon → install → app icon on home screen → opens in standalone window

### 6. Post-deploy hardening

- ☐ Rotate `AUTH_SECRET` if you ever shared it in dev. Generate fresh: `openssl rand -base64 32`
- ☐ Audit Vercel logs for unhandled errors during the first day of usage
- ☐ Set Neon's auto-suspend threshold higher (default 5 min idle = ~1s cold start on first request after gap)
- ☐ Enable Vercel Analytics (free tier) for traffic baseline
- ☐ Add domain (optional) → Project Settings → Domains. Update `NEXT_PUBLIC_APP_URL` to match.

---

## Known caveats Phase 1

| | Caveat | Mitigation |
|---|---|---|
| 1 | **No thermal printer** (M16 deferred — hardware test required) | UI shows on-screen receipt preview at success; "cetak ulang" button toasts a Phase 2 message |
| 2 | **No QRIS/card validation** | POS marks payment method as confirmed; cashier verifies physical EDC → tap "Konfirmasi QRIS/Kartu BCA" |
| 3 | **Receipt photo upload disabled** | C3=C: text-only expense entries Phase 1 |
| 4 | **No backup automation** | Neon free tier has 7-day PITR; manual `pg_dump` if you want offline copy |
| 5 | **Rate limiting on auth** | Not implemented — Phase 1 single-tenant single-outlet, low abuse risk. Add at M18.x or Vercel WAF later |
| 6 | **Single-instance approver token blacklist** | jti tracked in process memory. Vercel serverless = multiple instances → race possible. Mitigated by 5-min token expiry + UNIQUE constraint indirectly via single-use intent. Move to Redis if scale warrants |
| 7 | **Web Bluetooth (M16) requires Chrome/Edge Android** | iPad Safari unsupported. Document at runtime via Settings → Printer warning |

---

## Rollback

If first deploy hits an unrecoverable issue:

1. **Vercel rollback** → Project Deployments → previous green deploy → "Promote to Production". Instant.
2. **DB rollback** — schema migrations are forward-only. If a future migration breaks, restore from Neon PITR (Neon console → Backups → Restore to point-in-time).
3. **Hard kill** → Pause Vercel project + remove all env vars. Public URL serves 404. Re-enable when fixed.

---

## After M16 lands (printer)

Re-deploy with:

- Web Bluetooth requires HTTPS → already covered by Vercel.
- User pairs RPP02 once on tablet → settings persisted in localStorage per device.
- No env var change needed.

---

## Production user flow training

When ready, give Rama (or whoever runs the cafe) a 5-minute walkthrough:

1. **Open shift di pagi** — kas awal Rp <X>
2. **Order Baru** — pager # → tap menu → bayar → cetak struk (atau on-screen kalau printer belum)
3. **Void/Refund** — Owner/Manager bisa langsung; Staff perlu PIN approver
4. **Tutup shift sore** — input kas aktual → variance ditampilkan; > Rp 10k = warning
5. **Admin sehari-hari** — lihat Dashboard untuk omzet hari ini, Laporan untuk weekly trend, Kas untuk pengeluaran

---

## Change log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-26 | Initial pre-deploy checklist after Phase 1 wrap-up |
