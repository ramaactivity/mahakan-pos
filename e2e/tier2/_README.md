# Tier 2 — Mutation E2E Tests

> **Dokumentasi lengkap:** [../PLAYWRIGHT_E2E.md](../PLAYWRIGHT_E2E.md) —
> coverage map, locator convention, gotcha, roadmap. File ini hanya quick
> setup reference.

## Status

✅ **Live.** 130 tes di 40 file passing terhadap Neon test branch
(per sesi AE-96, 2026-05-22).

Auto-skipped via `testIgnore: ["**/tier2/**"]` di playwright.config.ts —
run dengan flag eksplisit (lihat **Run Tests** di bawah).

## Setup (one-time per branch)

### 1. Bikin Neon branch dari prod

Via Neon Console → Branches → "New Branch":
- **Name**: `e2e-test`
- **Auto-delete**: After 1 day ✓ (auto-cleanup)
- **Parent**: production
- **Branch data and schema** ✓

Setelah created, copy **Connection string** dari overview branch.

### 2. Setup `.env.test`

```bash
# Copy .env.local lalu override DATABASE_URL
cp .env.local .env.test

# Set DATABASE_URL ke branch connection string
sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL="postgresql://YOUR_BRANCH_URL"|' .env.test

# Generate random AUTH_SECRET (test only, beda dari prod)
SECRET=$(openssl rand -base64 32)
sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$SECRET\"|" .env.test

# Set AUTH_TRUST_HOST=true supaya Auth.js trust localhost
sed -i '' 's|^AUTH_TRUST_HOST=.*|AUTH_TRUST_HOST="true"|' .env.test
```

### 3. Verify branch reachable

```bash
npx tsx --env-file=.env.test scripts/_oneshot/verify-e2e-branch.ts
```

Expected output:
```
Investors: 73 (mirror prod)
Outlets: 1 (Mahakan Coffee & Space)
Users: 12 (+ e2e-owner setelah test run)
Chart of Accounts: 76
✓ Branch OK, ready untuk E2E mutation tests
```

## Run Tests

```bash
# Option A: full auto (Playwright auto-spawn dev server)
npm run test:e2e:tier2

# Option B: manual (lebih fast untuk dev iteration)
# Terminal 1: start dev server pointing ke test branch
npm run dev:e2e

# Terminal 2: run tests against running dev
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test e2e/tier2

# UI mode untuk debug
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test e2e/tier2 --ui
```

## Existing test specs

| File | Coverage |
|---|---|
| `auth-flow.spec.ts` | PIN login flow, session cookie, callbackUrl preserve, dashboard greeting |
| `investor-list.spec.ts` | BackOffice Modal & Dividen tab render, no error boundary |

**6 tests pass** di chromium-desktop.

## Auth fixture

Global setup [_fixtures/global-setup.ts](_fixtures/global-setup.ts) creates
test user di branch:
- **Email**: `e2e-owner@mahakan.local`
- **PIN**: `000000`
- **Role**: owner
- **Outlet**: pertama (Mahakan Coffee & Space)

Tests panggil `loginAsE2EOwner(page)` dari `_fixtures/auth.ts` untuk login
flow standar.

Safety guard: setup REFUSE jalan kalau DATABASE_URL tidak punya `e2e`,
`test`, atau hostname branch (`twilight-bread`) di URL — prevent
accidental run terhadap prod.

## Expansion plan — future happy paths

Critical flows yang belum di-test:

1. **POS — open shift + transaction + close shift**
2. **Open bill flow** (save → close → struk auto-print)
3. **Refund parsial** (loyalty rollback + journal reverse)
4. **Modal & Dividen v2 compute** (waterfall preview + approve)
5. **Convert investor → kreditur** (re-classify equity → liability)
6. **Opname submit + finalize** (replace-semantic from AE-81)

Tiap test ~10-30 lines + auth fixture reuse. Estimasi 1-2 sesi untuk
cover semua 6 flow di atas + cleanup helpers.

## Cleanup

- Branch auto-delete dalam 24 jam (Neon setting saat create branch)
- Atau hapus manual via Neon Console → Branches → `e2e-test` → Delete
- `.env.test` lokal (gitignored, jangan commit)

## CI integration (future)

GitHub Actions workflow yang trigger di PR:
1. Spin up Neon branch via `neonctl branches create` (butuh NEON_API_KEY)
2. Deploy preview ke Vercel
3. Run `E2E_INCLUDE_TIER2=1 npm run test:e2e:tier2`
4. `neonctl branches delete` on success/failure

Workflow file: `.github/workflows/e2e.yml` (belum dibuat).
