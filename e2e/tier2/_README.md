# Tier 2 — Mutation E2E Tests (BLOCKED — awaiting Neon branch setup)

## Status

🚧 **Scaffold only.** Tests di folder ini akan mutate database (create
transactions, post journal entries, dst). Aman untuk run **hanya kalau**
target environment isolated dari prod.

Default `npx playwright test` **SKIP folder ini** (`testIgnore` di
playwright.config.ts). Untuk run:

```bash
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  DATABASE_URL=postgres://... \
  npx playwright test e2e/tier2
```

## Prerequisite — pilih salah satu

### Option A: Neon branch (recommended)

```bash
# 1. Install neonctl (sekali setup)
npm install -g neonctl

# 2. Auth ke Neon (butuh NEON_API_KEY dari owner via dashboard.neon.tech)
export NEON_API_KEY=<owner's API key>

# 3. Buat branch dari prod
neonctl branches create \
  --project-id <mahakan-neon-project-id> \
  --name e2e-test-$(date +%Y%m%d-%H%M)

# 4. Export DATABASE_URL dari branch
export DATABASE_URL=$(neonctl connection-string e2e-test-<timestamp>)

# 5. Run test
npx playwright test e2e/tier2

# 6. Cleanup branch saat selesai
neonctl branches delete e2e-test-<timestamp>
```

**Pros:** mirror prod data, no manual seed.
**Cons:** butuh Neon API key dari owner.

### Option B: Local Postgres docker

```bash
# 1. Spin up postgres
docker run -d --name mahakan-test-pg \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=mahakan_test \
  -p 5433:5432 postgres:16

# 2. Run migrations
DATABASE_URL=postgres://postgres:test@localhost:5433/mahakan_test \
  npx drizzle-kit migrate

# 3. Seed minimal data (TODO: write seed script)
npx tsx scripts/_oneshot/seed-e2e.ts

# 4. Run test
DATABASE_URL=postgres://postgres:test@localhost:5433/mahakan_test \
  PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  E2E_INCLUDE_TIER2=1 \
  npx playwright test e2e/tier2
```

**Pros:** no Neon dependency, full control.
**Cons:** butuh seed script untuk minimal data (outlet, user, COA, etc).

## Test plan (akan di-implement setelah env setup)

### Auth fixture
- `e2e/tier2/_fixtures/auth.ts` — helper buat:
  - `loginAsOwner(page)` — bypass NextAuth via API + cookie injection
  - `loginAsStaffPin(page, pin)` — use /pin endpoint dengan test PIN
  - `cleanupAfter(testName)` — wipe rows yang di-create test (by metadata
    marker `e2e-test-${runId}`)

### Critical happy paths

1. **POS — open shift + transaction + close shift**
   - Login owner → /pos → open shift Rp 500k
   - Add menu item → checkout cash Rp 30k → struk render
   - Close shift → variance Rp 0 → posted
   - Verify journal entries posted dengan benar

2. **Open bill flow**
   - Login → create open bill dengan nama customer → save
   - Close bill via cash → status='paid' → struk render
   - Verify stock di-deduct di closeOpenBill (defer pattern AE-62x)

3. **Refund parsial**
   - Buka riwayat → refund 1 item dari transaksi paid
   - Verify journal reverse entry posted dengan amount benar
   - Customer points di-rollback proportional

4. **Modal & Dividen v2 compute**
   - Login owner → BackOffice → Investor → Distribusi
   - Pilih month Y/M dengan net profit > 0
   - Toggle waterfall v2 di Settings (per outlet)
   - Compute → preview waterfall card → approve
   - Verify: journal Dr 3201 / Cr 3202 posted, dividend_balance per
     investor incremented

5. **Convert investor → kreditur**
   - Pilih investor active dengan dividendBalance=0
   - Convert dengan bunga 2% monthly
   - Verify: investor.status='exited', sharePct=0, kreditur baru
     ter-create dengan linkedInvestorId

6. **Opname submit + finalize**
   - Login staff /m/opname → mulai sesi → count beberapa bahan
   - Submit → manager finalize via BackOffice
   - Verify: stock = actual_count (replace semantic AE-81), journal
     adjust posted

### CI integration (future)

GitHub Actions workflow yang trigger di PR:
1. Spin up Neon branch atau Postgres
2. Deploy preview ke Vercel
3. Run `E2E_INCLUDE_TIER2=1 npx playwright test` against preview URL
4. Cleanup branch on success/failure

Workflow file: `.github/workflows/e2e.yml` (belum dibuat).
