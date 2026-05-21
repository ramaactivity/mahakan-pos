# E2E Tests — Playwright

## Quick start

```bash
# Default: smoke tests Tier 1 against prod URL (read-only, safe)
npx playwright test

# Pakai URL berbeda (preview deploy / local)
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test

# Liat hasil HTML report
npx playwright show-report

# UI mode (interactive debug)
npx playwright test --ui

# Tier 2 (mutation, butuh env isolation — lihat tier2/_README.md)
E2E_INCLUDE_TIER2=1 npx playwright test e2e/tier2
```

## Struktur

- `smoke.spec.ts` — **Tier 1** read-only smoke tests
  - Render check semua public + auth-gated routes
  - Verify auth redirect bekerja
  - Catch build/deploy break (console error, error boundary fallback)
  - Aman jalan di prod URL kapan saja
- `tier2/` — **Tier 2** mutation tests (skip by default, lihat folder
  README untuk setup environment)

## Run kapan

- **Per deploy** — Tier 1 sebagai smoke validator setelah `vercel --prod`
- **Per PR** — Tier 1 + Tier 2 (lewat CI) sebelum merge ke release branch
- **Ad-hoc** — saat suspect regression di UI flow tertentu

## Target environment

| Test tier | Target | Data safety |
|---|---|---|
| Tier 1 (smoke) | prod URL by default | Read-only — no mutation |
| Tier 2 (mutation) | localhost atau Neon branch | Wajib isolated env |

Smoke test aman di-jalankan terus-menerus tanpa konsekuensi data.
