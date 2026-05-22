# E2E Audit & Improvement Plan — sesi AE-97

Audit hasil 130 tes Playwright untuk identifikasi pattern, blind spot, dan
peluang improvement sistem.

**Audit date:** 2026-05-22
**Sesi:** AE-97 (follow-up dari AE-95+AE-96)

---

## 1. Findings dari analisis test suite

### Finding F1 — Anti-pattern `role="tab"` di 16 file

```bash
$ grep -rln 'role="tab"' src/features | wc -l
16
```

16 komponen render raw `<button role="tab">` tanpa pakai komponen Tabs
terstandar. Konsekuensinya:

1. **Inkonsistensi ARIA** — tablist sering tidak ada `aria-controls`,
   keyboard arrow nav (↔), atau `role="tabpanel"` di content.
2. **Test fragile** — spec harus tahu apakah render pakai `button` atau
   `tab` role. Sesi AE-95 punya 3 test gagal karena ini.
3. **Accessibility debt** — screen reader user dapat experience yang tidak
   konsisten.

**Affected files:**
- `AuthPathSwitcher.tsx`, `ReportsSection.tsx`, `PurchaseRequestsSection.tsx`,
  `FinanceSection.tsx`, `CashSection.tsx`, `JournalRetryQueueSection.tsx`,
  `HrOperationsSection.tsx`, `AggregatorOnlineSection.tsx`,
  `ReconciliationSection.tsx`, `InventorySection.tsx`, `MenuSection.tsx`,
  `AccountingSection.tsx`, `inventory/IngredientsList.tsx`,
  `inventory/opname/OpnameCountView.tsx`,
  `finance/ReconciliationDrillDownModal.tsx`, `pos/CategoryTabs.tsx`

**Tingkat severity:** Medium — aplikasi jalan, tapi inkonsistensi.

### Finding F2 — 100 instance `waitForTimeout` di tier2 specs

```bash
$ grep -rn 'waitForTimeout' e2e/tier2 --include="*.spec.ts" | wc -l
100
```

Test menunggu pakai sleep eksplisit (`page.waitForTimeout(2_500)`) alih-alih
menunggu state spesifik (`waitFor` element). Ini smell:

1. **Test lambat** — total ~2.5s × 100 = 4 menit sleep cumulative.
2. **Flaky** — kalau lazy-load lebih lama dari sleep, test fail. Sudah
   terjadi di sesi AE-95 untuk printer-pairing.
3. **Indikator UX** — app tidak ekspose deterministic "ready" signal
   (mis. `data-ready` attr) untuk consumer (testing, automation, A11y
   announcements).

**Tingkat severity:** Medium — test berjalan, tapi maintenance burden.

### Finding F3 — Console errors tidak dikoleksi

```bash
$ grep -rn 'page.on("console"|pageerror"' e2e/ | wc -l
0
```

Tidak ada spec yang listen `page.on("console")` atau `page.on("pageerror")`.
Konsekuensi:

1. **Silent JS errors lolos** — kalau `console.error("Failed to fetch
   foo")` muncul tapi UI tetap render dengan stale state, test pass meski
   ada bug.
2. **No telemetry catch** — Sentry/Datadog dst belum di-config (cek perlu).
3. Tes saat ini cuma cek body text untuk "something went wrong" — itu
   hanya error boundary, bukan semua JS error.

**Tingkat severity:** **High** — bisa ada bug production yang lolos.

### Finding F4 — POS primary device (Galaxy A7 Lite tablet) tidak di test loop

[feedback_pos_primary_device.md](../.claude/projects/-Users-masrampc-Desktop-POS-ERP-MAHAKAN/memory/feedback_pos_primary_device.md)
mengamanat: POS UI **wajib** design + test untuk Galaxy A7 Lite 1340×800
landscape **pertama**.

Reality:
- `playwright.config.ts` sudah punya project `tablet-galaxy-a7-lite`.
- Tapi sesi-sesi terakhir (AE-92 sampai AE-96) **hanya run
  `--project=chromium-desktop`**.
- Tablet project tidak pernah benar-benar jalan di test cycle terakhir.

**Tingkat severity:** **High** — POS regression di tablet bisa ke-deploy
tanpa di-catch.

### Finding F5 — `test.skip()` state-dependent (1 test)

`correction-chain.spec.ts:72` skip kalau no transaction. `transaction-correction.spec.ts:49` skip
juga.

Skip karena prerequisite data missing = OK, tapi:
- Skip silent = bisa ada bug yang tidak ke-cover karena data kebetulan ada
  atau tidak.
- Better: seed helper yang bikin paid transaction idempotent.

**Tingkat severity:** Low — di-cover oleh test smoke lain, tapi nice-to-have.

### Finding F6 — No CI integration

- `.github/workflows/` cuma punya `db-backup.yml`.
- Memory mengkonfirmasi deploy = manual `npx vercel --prod --yes`.
- Tidak ada gate yang memastikan test pass **sebelum** deploy.

**Tingkat severity:** **High** — kalau spec break di branch tapi tidak
ke-run sebelum push, prod bisa deploy dengan UI broken.

---

## 2. Severity matrix

| # | Finding | Severity | Effort | Impact | Priority |
|---|---|---|---|---|---|
| F1 | Raw `role="tab"` di 16 file | Medium | High (refactor) | Medium | P3 |
| F2 | 100× `waitForTimeout` | Medium | High (per-spec) | Medium | P3 |
| F3 | Console error tidak dikoleksi | **High** | Low | High | **P1** |
| F4 | Tablet not in test loop | **High** | Low | High | **P1** |
| F5 | Skip state-dependent | Low | Medium | Low | P4 |
| F6 | No CI for E2E | **High** | Medium | High | **P2** |

---

## 3. Improvement plan (sesi AE-97)

### Ship dalam sesi ini

**1. Console error collector di auth helper (F3 → P1)**

Pasang `page.on("console")` + `page.on("pageerror")` di `loginAsE2EOwner`,
collect ke array yang accessible dari test. Default policy:
- `console.error` selain known noisy (mis. dari Next dev mode) = fail.
- `pageerror` (uncaught exception) = fail.
- Test bisa explicit `dismissConsoleErrors()` kalau memang expected.

Add helper `attachConsoleErrorCollector(page)` di `_fixtures/console-errors.ts`.

**2. Tablet POS coverage (F4 → P1)**

Run critical POS spec terhadap `tablet-galaxy-a7-lite` project juga:
- `pos-smoke.spec.ts`
- `pos-shift-flow.spec.ts`
- `pos-transaction.spec.ts`
- `open-bill.spec.ts`
- `riwayat-smoke.spec.ts`

Options:
- (a) Update `npm run test:e2e:tier2` agar pakai 2 project default
- (b) Add npm script khusus `test:e2e:tablet` untuk POS critical

Pilih opsi (b) supaya tidak double runtime untuk semua spec. Owner bisa
trigger explicit kapan butuh tablet validation.

**3. GitHub Actions CI smoke (F6 → P2)**

Workflow `.github/workflows/e2e-smoke.yml`:
- Trigger: push ke `release/phase-1` atau `main`.
- Run Tier 1 smoke terhadap `https://mahakan-pos.vercel.app`.
- No Neon secret required (read-only test).
- Notify GitHub run status — visible di branch badge.

Bonus: jalankan `npx playwright install --with-deps chromium` di CI.

### Skip untuk sesi ini (defer ke future)

- **F1 — unified Tabs primitive component** — refactor scope besar (16 file),
  butuh design system discussion. Defer ke sesi tersendiri (mungkin AE-100).
- **F2 — remove waitForTimeout** — per-spec migration. Defer ke berkala
  cleanup, atau parse ulang setelah F3 console-error catch kasih signal
  baru mana spec yang sebenarnya butuh wait.
- **F5 — seed helper** — kompleksitas tinggi (perlu paid transaction +
  shift open di test branch). Defer ke kalau benar-benar butuh assert
  multi-koreksi chain.
- **Tier 2 CI** — butuh Neon API key + sembunyi secret. Tier 1 dulu, Tier 2
  fase berikutnya.

---

## 4. Post-improvement state

Setelah F3+F4+F6 selesai:

- **Console error catch live** — silent JS bug auto-fail di test cycle.
- **Tablet validated** — POS regression terdeteksi di Galaxy A7 Lite
  viewport.
- **CI smoke active** — push ke release branch otomatis verify prod tidak
  break.

**Next session targets** (audit lagi setelah F3-F6 ship):
- F1 — unified Tabs (refactor)
- F2 — bulk migrate waitForTimeout → waitFor
- F5 — seed helper untuk state-dependent spec

---

_Author: Claude (sesi AE-97, auto-mode for Rama)._
