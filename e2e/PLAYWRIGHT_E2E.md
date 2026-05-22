# Playwright E2E — Mahakan POS

Dokumentasi lengkap setup, struktur, dan panduan menjalankan end-to-end test
suite Playwright untuk Mahakan POS-ERP.

**Status (per 2026-05-22, sesi AE-96):** 130 tes di 40 file spec.
- **Tier 1 (smoke, read-only):** 1 file di `e2e/`, jalan terhadap prod URL.
- **Tier 2 (mutation, butuh auth + DB):** 39 file di `e2e/tier2/`, jalan
  terhadap Neon test branch.

---

## 1. Arsitektur

### Dua tier, dua tujuan

```
e2e/
├── smoke.spec.ts            ← Tier 1: read-only smoke (prod URL)
├── README.md                ← Quick reference Tier 1
├── PLAYWRIGHT_E2E.md        ← Dokumentasi ini (full guide)
└── tier2/
    ├── _README.md           ← Setup tier 2 step-by-step
    ├── _fixtures/
    │   ├── auth.ts          ← loginAsE2EOwner() helper
    │   └── global-setup.ts  ← Seed e2e-owner user di test branch
    └── *.spec.ts            ← 39 file mutation specs
```

**Tier 1** — Health check murni:
- Target: `https://mahakan-pos.vercel.app` (production) default.
- Tidak butuh DB, tidak butuh auth, tidak butuh dev server.
- Cek: route render, auth redirect (`/pin?callbackUrl=...`), no SSR crash.

**Tier 2** — Mutation testing:
- Target: dev server lokal (`http://localhost:3001`) yang konek ke Neon
  **test branch** (parallel ke prod, auto-delete dalam 24 jam).
- Login via PIN flow (user `e2e-owner@mahakan.local`, PIN `000000`).
- Aman untuk data mutation karena branch DB terisolasi.

### Konfigurasi central

[playwright.config.ts](../playwright.config.ts) — kunci-kunci:

| Field | Tier 1 | Tier 2 (`E2E_INCLUDE_TIER2=1`) |
|---|---|---|
| `testIgnore` | `**/tier2/**` (skip mutation) | none |
| `globalSetup` | none | `e2e/tier2/_fixtures/global-setup.ts` (seed user) |
| `webServer` | none (target prod URL) | auto-spawn `npm run dev:e2e` di port 3001 |
| `baseURL` | `https://mahakan-pos.vercel.app` | `http://localhost:3001` (set via `PLAYWRIGHT_BASE_URL`) |

### Browser projects

3 device profile:
- `chromium-desktop` — default, Desktop Chrome.
- `tablet-galaxy-a7-lite` — 1340×800 landscape, touch (POS primary device).
- `mobile-android` — Pixel 7.

Pilih project via `--project=<name>`. Default semua project akan ke-run.

---

## 2. Setup (one-time)

### 2.1 Bikin Neon test branch

Via Neon Console → Branches → **New Branch**:
- **Name:** `e2e-test`
- **Auto-delete:** After 1 day ✓
- **Parent:** production
- **Branch data and schema** ✓

Salin **connection string** dari overview branch.

### 2.2 Setup `.env.test`

```bash
cp .env.local .env.test

# Override DATABASE_URL → branch
sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL="postgresql://YOUR_BRANCH_URL"|' .env.test

# Random AUTH_SECRET (test only, beda dari prod)
SECRET=$(openssl rand -base64 32)
sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$SECRET\"|" .env.test

# Trust localhost
sed -i '' 's|^AUTH_TRUST_HOST=.*|AUTH_TRUST_HOST="true"|' .env.test
```

### 2.3 Verify branch sehat

```bash
npx tsx --env-file=.env.test scripts/_oneshot/verify-e2e-branch.ts
```

Expected output (kira-kira):
```
Investors: 73 (mirror prod)
Outlets: 1 (Mahakan Coffee & Space)
Users: 12 (+ e2e-owner setelah test run)
Chart of Accounts: 76
✓ Branch OK, ready untuk E2E mutation tests
```

### 2.4 Permission Claude (otomatis-allow)

`.claude/settings.json` allow list sudah mencakup:
```
"Bash(npx playwright test*)",
"Bash(npm run test:e2e*)",
"Bash(npm run dev:e2e)",
"Bash(E2E_INCLUDE_TIER2=* PLAYWRIGHT_BASE_URL=* npx playwright test*)",
```

Tidak perlu approve manual setiap run.

---

## 3. Cara run tests

### 3.1 Tier 1 smoke (prod, fast)

```bash
npm run test:e2e
```

~10 detik. Target prod URL. Aman dijalankan kapan saja.

### 3.2 Tier 2 mutation — auto-spawn dev server

```bash
npm run test:e2e:tier2
```

Playwright auto-spawn `npm run dev:e2e` di port 3001, jalankan global setup
(seed e2e-owner), lalu run semua spec di `e2e/tier2/`. ~2-3 menit.

### 3.3 Tier 2 — manual (lebih cepat untuk dev iteration)

Buka 2 terminal:

```bash
# Terminal 1: nyalakan dev server pointing ke test branch
npm run dev:e2e

# Terminal 2: run tests (dev sudah running)
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test e2e/tier2
```

### 3.4 Filter spesifik

```bash
# Single file
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test e2e/tier2/payroll-period.spec.ts

# Multiple file
npx playwright test e2e/tier2/payroll-period.spec.ts e2e/tier2/correction-chain.spec.ts

# By name pattern
npx playwright test e2e/tier2 -g "Periode Baru"

# Single project (lebih cepat)
npx playwright test --project=chromium-desktop
```

### 3.5 Debug

```bash
# UI mode — step through visual
E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test e2e/tier2 --ui

# Headed (lihat browser jalan)
npx playwright test e2e/tier2 --headed

# Open HTML report dari last run
npx playwright show-report
```

### 3.6 Saat test fail

- Screenshot disimpan di `test-results/<test-name>/test-failed-1.png`.
- Trace (kalau retry) di `test-results/<test-name>/trace.zip` — buka via
  `npx playwright show-trace test-results/.../trace.zip`.
- Error context (DOM snapshot) di `error-context.md`.

---

## 4. Auth fixture

[_fixtures/auth.ts](tier2/_fixtures/auth.ts) — `loginAsE2EOwner(page, callbackUrl?)`:

1. Goto `/pin?callbackUrl=<encoded>` (atau `/pin` kalau no callback).
2. Wait untuk StaffAvatarGrid `radiogroup name="Pilih user"`.
3. Click radio `E2E Test Owner`.
4. Tap digit `0` enam kali di PinPad.
5. Auto-submit triggered di MAX_PIN_LENGTH=6 → NextAuth signIn.
6. Wait sampai URL keluar dari `/pin/...`.

User credentials:
- **Email:** `e2e-owner@mahakan.local`
- **PIN:** `000000`
- **Role:** owner
- **Outlet:** pertama (Mahakan Coffee & Space)

[_fixtures/global-setup.ts](tier2/_fixtures/global-setup.ts) — Idempotent:
- Refuse jalan kalau DATABASE_URL bukan branch test (safety guard).
- Skip kalau user sudah ada.
- Insert dengan PIN hash bcrypt + role=owner kalau belum ada.

---

## 5. Coverage map per area

| Area | File spec | Test count | Status |
|---|---|---:|---|
| **Auth** | `auth-flow.spec.ts` | 4 | ✓ |
| **POS** | `pos-smoke.spec.ts`, `pos-shift-flow.spec.ts`, `pos-transaction.spec.ts`, `open-bill.spec.ts`, `riwayat-smoke.spec.ts` | 12 | ✓ |
| **Admin nav** | `admin-navigation.spec.ts`, `admin-sections-deep.spec.ts`, `operational-modules.spec.ts` | 11 | ✓ |
| **Inventory** | `inventory-flow.spec.ts`, `stock-movements.spec.ts`, `opname-flow.spec.ts`, `opname-mobile.spec.ts`, `menu-section.spec.ts`, `supplier-crud.spec.ts` | 14 | ✓ |
| **Purchases** | `purchase-create.spec.ts`, `purchase-requests.spec.ts` | 6 | ✓ |
| **Cash flow** | `cash-section.spec.ts`, `setoran-tunai.spec.ts` | 5 | ✓ |
| **Investor / Modal & Dividen** | `investor-list.spec.ts`, `investor-crud.spec.ts`, `convert-investor.spec.ts`, `share-transactions.spec.ts`, `distribution-v2.spec.ts`, `distribution-v2-approve.spec.ts`, `distribution-reverse.spec.ts`, `withdrawal-flow.spec.ts` | 21 | ✓ |
| **Creditor / Hutang** | `creditor-create.spec.ts`, `creditor-repayment.spec.ts` | 4 | ✓ |
| **Pengelola** | `pengelola-crud.spec.ts` | 2 | ✓ |
| **HR / Payroll** | `employee-bank-journal.spec.ts`, `payroll-period.spec.ts` | 9 | ✓ |
| **Aggregator** | `aggregator-import.spec.ts` | 2 | ✓ |
| **Reconciliation** | `reconciliation-deep.spec.ts`, `settlement-import-deep.spec.ts` | 6 | ✓ |
| **Transaction correction** | `transaction-correction.spec.ts`, `correction-chain.spec.ts` | 5 | ✓ |
| **CSV importers** | `csv-importer.spec.ts` | 3 | ✓ |
| **Settings (printer)** | `printer-pairing.spec.ts` | 2 | ✓ |

**Total:** 130 tes (1 expected skip — `correction-chain.spec.ts` & `transaction-correction.spec.ts` skip
kalau no eligible transaction).

---

## 6. Anatomi spec (template)

```ts
import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

test.describe("Feature X", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#section_hash");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500); // section lazy-load
  });

  test("Behavior Y", async ({ page }) => {
    // Pattern 1 — verify render via heading (PALING ROBUST)
    const heading = page.getByRole("heading", { name: /Judul/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Pattern 2 — click button → modal opens
    const btn = page.getByRole("button", { name: /Tambah/i });
    await btn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Pattern 3 — skip when target tidak available (state-dependent)
    if (!(await someBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "Reason");
    }
  });
});
```

---

## 7. Konvensi & gotcha penting

### Locator: pilih role yang tepat

Mahakan POS render banyak tablist via raw `<button role="tab">` — **bukan**
default `<button>`. Pakai locator yang tepat:

```ts
// ❌ MISMATCH — button role tidak match tab
page.getByRole("button", { name: /Pergerakan/i })

// ✓ Correct — pakai role yang sebenarnya di markup
page.getByRole("tab", { name: /Pergerakan/i })
```

**Daftar section yang pakai `role="tab"`:**
- `InventorySection` — Bahan, Pergerakan, Opname, Resep, dst
- `ReconciliationSection` — Saldo Awal, Import Histori, Daftar Historis
- `PurchaseRequestsSection` — filter status (Open, Sebagian, Selesai)
- `AggregatorOnlineSection` — Summary + per-channel tabs
- `PayrollSection` (dalam HR Operations) — sub-tab

Section yang pakai plain `<button>`:
- Filter chip Riwayat POS (Lunas, Open, Void, Refund)
- Navigation sidebar

### Timing: jangan asumsi networkidle = section rendered

Banyak section lazy-load via React Suspense — `networkidle` selesai sebelum
component selesai render. Pakai salah satu:

```ts
// Pattern 1 — wait for specific element (RECOMMENDED)
await page
  .getByRole("heading", { name: /Section Title/i })
  .waitFor({ timeout: 15_000 });

// Pattern 2 — fixed delay (less reliable, untuk smoke saja)
await page.waitForTimeout(2_500);
```

### Body text assertion: hati-hati sidebar nav

`page.locator("body").innerText()` include sidebar navigation. Kalau test
cek substring "Settings" — bisa false-positive dari nav label, padahal
section belum render. Pakai role-based locator dulu, baru body text:

```ts
// Robust pattern: wait specific element first, baru body text untuk
// error boundary check
const heading = page.getByRole("heading", { name: /Thermal Printer/i });
await expect(heading).toBeVisible({ timeout: 15_000 });
const bodyText = await page.locator("body").innerText();
expect(bodyText).not.toMatch(/something went wrong|client-side exception/i);
```

### Skip vs fail

Pakai `test.skip()` untuk **state-dependent** test (data tidak ada di
branch):

```ts
const trxRow = page.locator('text=/TRX-?\\d/').first();
if (!(await trxRow.isVisible({ timeout: 5_000 }).catch(() => false))) {
  test.skip(true, "Tidak ada transaksi di test branch");
}
```

Skip **bukan** untuk mengubur bug — kalau button hilang karena bug, fail.
Skip hanya kalau memang prerequisite data missing.

### Tablet & mobile project

Galaxy A7 Lite (1340×800 landscape) adalah POS primary device. Spec yang
test POS flow harus lulus di project `tablet-galaxy-a7-lite` (lihat
[feedback_pos_primary_device.md](../../.claude/projects/-Users-masrampc-Desktop-POS-ERP-MAHAKAN/memory/feedback_pos_primary_device.md)).

Spec yang test admin section umumnya cukup di `chromium-desktop`.

---

## 8. Workflow: nambah spec baru

1. **Survey komponen target** dulu:
   ```bash
   grep -rn "Tombol Yang Mau Saya Test" src/features --include="*.tsx"
   ```
   Catat label, role, dan parent section.

2. **Tulis spec smoke dulu** (render + main click):
   ```ts
   await loginAsE2EOwner(page, "/dashboard#section");
   const btn = page.getByRole("button", { name: /Label/i });
   await expect(btn).toBeVisible({ timeout: 10_000 });
   await btn.click();
   const dialog = page.getByRole("dialog");
   await expect(dialog).toBeVisible();
   ```

3. **Run cepat tunggal**:
   ```bash
   E2E_INCLUDE_TIER2=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
     npx playwright test e2e/tier2/<file>.spec.ts --project=chromium-desktop
   ```

4. **Fix locator jika fail** — biasanya issue: salah role (tab vs button)
   atau timing (section lazy-load). Pakai screenshot di `test-results/...`
   untuk debug.

5. **Deep-coverage iteration** — tambah test untuk field auto-fill, form
   submit, error state, dst.

6. **Commit + push + deploy** (per [feedback_deploy_authorization.md](../../.claude/projects/-Users-masrampc-Desktop-POS-ERP-MAHAKAN/memory/feedback_deploy_authorization.md)):
   ```bash
   git commit -m "test(e2e): ..."
   git push origin release/phase-1
   npx vercel --prod --yes
   ```

---

## 9. Roadmap & gaps

### High-value next targets

- **Payroll full mutation** — create periode → recompute → adjust line →
  finalize → verify journal entries. Butuh employee + attendance fixture.
- **Multi-koreksi chain mutation** — seed paid transaksi → request koreksi
  round 1 → approve via code → request round 2 → verify
  `correctedJournalEntryId` linkage (sesi AE-83 fix).
- **Historical Import full path** — upload realistis CSV (Majoo format) →
  mapping → preview → confirm → verify `historical_summary` rows.

### Marginal-value (skip kecuali masalah spesifik)

- Promo CRUD full path
- Customer/Loyalty deep
- Settings → Bank Account CRUD
- Receipt template editor

### CI integration (belum)

Workflow `.github/workflows/e2e.yml` (belum dibuat) yang trigger di PR:
1. Spin Neon branch via `neonctl branches create` (butuh `NEON_API_KEY` secret).
2. Deploy preview ke Vercel.
3. Run `npm run test:e2e:tier2`.
4. `neonctl branches delete` on finish.

---

## 10. Sejarah singkat (siklus AE-85 → AE-96)

| Sesi | Highlight | File spec |
|---|---|---|
| AE-85 | Foundation: Playwright config + auth fixture + 6 first specs | `auth-flow`, `investor-list`, `pos-smoke`, `opname-mobile`, `distribution-v2`, `inventory-flow` |
| AE-86–AE-87 | Tier 2 happy path + Turbopack bug fix | `purchase-create`, dst |
| AE-88 | Full POS transaction + pengelola/creditor | `pos-transaction`, `pengelola-crud`, `creditor-create` |
| AE-89 | Open bill + opname + riwayat smoke | `open-bill`, `opname-flow`, `riwayat-smoke` |
| AE-90 | Broader admin coverage | `supplier-crud`, `menu-section`, `admin-sections-deep` |
| AE-91 | COA 3202 → 2160 Hutang Dividen fix | (production fix) |
| AE-92 | Purchase + cash + reverse distribution | `purchase-create`, `cash-section`, `distribution-reverse` |
| AE-93 | Share-tx + creditor-repay + employee + journal + CSV | `share-transactions`, `creditor-repayment`, `employee-bank-journal`, `csv-importer` |
| AE-94 | Operational modules smoke | `operational-modules` (Promo, Customer, Payroll, Reports, Audit, HR) |
| **AE-95** | **Purchase Request + Reconciliation deep + Stock + Aggregator + Printer + Correction** | `purchase-requests`, `reconciliation-deep`, `transaction-correction`, `stock-movements`, `aggregator-import`, `printer-pairing` |
| **AE-96** | **Payroll period + Settlement Log import deep + Multi-koreksi chain** | `payroll-period`, `settlement-import-deep`, `correction-chain` |

---

## 11. Troubleshooting cepat

| Gejala | Kemungkinan penyebab | Fix |
|---|---|---|
| `Cannot navigate to invalid URL` | `PLAYWRIGHT_BASE_URL` kosong | Set env var atau pakai `npm run test:e2e:tier2` |
| `getByRole('button') ... not found` di tablist | Element pakai `role="tab"` | Ganti ke `getByRole('tab', ...)` |
| `toBeVisible` timeout 10s | Lazy-load belum selesai | Tambah `waitFor` di element spesifik |
| Test pass di run pertama, fail di re-run | Race condition / state pollution | Pakai unique data per run, atau cleanup di `afterEach` |
| `[e2e setup] user 'e2e-owner@...' sudah ada` | Normal | Idempotent — global setup skip kalau user exist |
| `Refusing to run E2E setup against non-test DB` | `DATABASE_URL` pointing ke prod | Cek `.env.test`, harus mengandung `twilight-bread` atau `test` di hostname |
| Browser tidak terinstall | Playwright runtime missing | `npx playwright install chromium` |

---

## 12. Referensi

- [Playwright official docs](https://playwright.dev)
- [tier2/_README.md](tier2/_README.md) — quick setup
- [_fixtures/auth.ts](tier2/_fixtures/auth.ts) — login helper
- [_fixtures/global-setup.ts](tier2/_fixtures/global-setup.ts) — user seed
- Memory: [feedback_deploy_authorization.md](../../.claude/projects/-Users-masrampc-Desktop-POS-ERP-MAHAKAN/memory/feedback_deploy_authorization.md) — deploy workflow
- Memory: [feedback_pos_primary_device.md](../../.claude/projects/-Users-masrampc-Desktop-POS-ERP-MAHAKAN/memory/feedback_pos_primary_device.md) — Galaxy A7 Lite first

---

_Last updated: 2026-05-22 (sesi AE-96)._
