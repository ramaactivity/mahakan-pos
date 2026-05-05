# Server Components Migration — Analysis & Roadmap

**Status:** 📋 Analysis complete, migration deferred to dedicated session(s)
**Author:** sesi AC-5d (2026-05-05)
**Trigger:** code-review note #5 dari ramaactivity/temennya — "semua page-nya client component"

---

## 1. TL;DR

- Owner-facing pages (`page.tsx`) sudah server component ✅. Yang client component
  adalah **section components** + POS internals (~50 file pakai `"use client"`).
- Migration ke true Server Components akan kasih: smaller client bundle,
  faster TTI, no client→server data waterfall. **Tapi**: butuh major
  rewiring routing (AdminShell `useState` → URL-based).
- ROI moderate untuk proyek single-outlet auth-walled. **Recommend defer**
  ke Phase 12+ atau saat ada perf complaint konkret dari tablet ops.

---

## 2. Current State

### 2.1 Page-level (`src/app/**/page.tsx`)

| Path | Type | Notes |
|---|---|---|
| `app/page.tsx` | server | redirect-only |
| `app/(admin)/dashboard/page.tsx` | server | thin wrapper, render `<AdminShell />` |
| `app/(pos)/pos/page.tsx` | server | thin wrapper, render `<PosShell />` |
| `app/(auth)/login/page.tsx` | client | form state |
| `app/(auth)/pin/page.tsx` | client | PIN pad state |
| `app/absenkaryawan/page.tsx` | server | wraps `<AttendanceShell />` |
| `app/showcase/page.tsx` | client | dev showcase (non-prod) |

✅ Pages sudah benar — server kalau bisa, client hanya untuk auth forms.

### 2.2 Section-level (`src/features/admin/sections/*.tsx`)

**21/21 admin sections** = `"use client"`:
DashboardHome, MenuSection, InventorySection, SuppliersSection,
PurchaseRequestsSection, CustomersSection, StaffSection, EmployeesSection,
HrOperationsSection (yang internal render Attendance/Schedules/Payroll/
HrReports), ShiftsSection, CashSection, FinanceSection, AccountingSection,
PromoSection, ReportsSection, AuditLogSection, SettingsSection.

**Reasoning kenapa dulu pakai client:** AdminShell (parent) adalah
`"use client"` dengan `useState<AdminSection>` untuk track active tab.
React rule: client component children defaultnya juga di client tree.
Server child cuma boleh kalau di-pass via prop/children dari server parent.

### 2.3 POS internals

`src/features/pos/components/*.tsx` mostly client (PaymentModal, CartList,
NumericInput, dll). Wajib karena heavy interactivity (touch input, modals,
cart store).

`PosShell.tsx` adalah `"use client"` root yang menggabungkan semua.

---

## 3. Why Migrate?

| Benefit | Impact untuk Mahakan POS |
|---|---|
| Smaller client bundle | Tablet load time turun 100-300ms (low-end tablet) |
| Server-rendered initial data | Eliminate client→server waterfall (`useEffect` fetch) |
| Streaming with Suspense | Lebih instan paint header sambil data loading |
| SEO | ❌ Not applicable — auth-walled |
| Multi-tenant scale | ❌ Not applicable — single outlet |

**Honest assessment:** ROI moderate. Tablet ops di outlet pakai WiFi yang
relatively cepat, app sudah viable performance-wise. Bukan lighthouse 100
target. Bottleneck UX yang nyata datang dari WhatsApp interrupts + kasir
training, bukan TTI.

**Tapi** — ada hidden benefit di security:
- Server component yang fetch via direct DB tidak butuh server action
  endpoint. Surface area untuk auth bug turun.
- Reduces "use server" file count → less risk of accidental sensitive
  function exposure (insiden customers/bumpInTx pattern di sesi AC-5d).

---

## 4. Migration Approach

Tiga pilihan, dari paling minimal ke paling invasif:

### Option A — "Server Data Loader" pattern (LOW EFFORT)

Keep AdminShell `useState` routing. Untuk section yang punya stable initial
data (mis. SuppliersSection), tambah server action `loadSuppliersInitialData()`
yang server-side fetches. Section client masih `"use client"` tapi receives
initial data via prop, skip first `useEffect` fetch.

**Pros:** Minimal disruption, no routing change. Each section opt-in.
**Cons:** Bukan true server component. Bundle size masih sama.

**Estimated effort:** 21 sections × 30 menit = ~10 jam total. Bisa ship
incremental.

### Option B — URL-based section routing (MEDIUM EFFORT)

Refactor AdminShell:
- Hapus `useState<AdminSection>`
- Sidebar menu pakai `<Link href="/dashboard/suppliers">` instead of
  `onClick`
- Tambah `app/(admin)/dashboard/[section]/page.tsx` server route handler
  dengan switch by section param

**Pros:** Browser back/forward bekerja. Bookmark-able. Server-render
section initial paint.
**Cons:** Section components masih harus client (form, modal). Hanya
data loading + route shell yang server.

**Estimated effort:** 1 hari refactor AdminShell + sidebar wiring + tweak
~5 sections yang punya complex state retention.

### Option C — Full server/client split (HIGH EFFORT)

Setiap section di-pecah jadi `*.server.tsx` (data fetch) + `*.client.tsx`
(interactivity). Server kompose: load data + render `<XClient initialData={...} />`.

**Pros:** Full RSC benefit — minimal client JS shipped.
**Cons:** ~21 sections × 2 files = 42 files. Forms + modals state
boundary tricky (e.g. CreateSupplierModal trigger lives in list, but
the modal sendiri client). Refactor risk regression.

**Estimated effort:** 2-3 hari fokus + retest tiap section + regression
QA. Not weekend project.

---

## 5. Recommended Approach

**Phase 11.x kalau ada justified perf complaint:**

1. **Step 1 (foundational, 1 day):** Option B — URL-based routing.
   Convert AdminShell ke nav-by-link pattern. Tidak refactor section
   internals.

2. **Step 2 (incremental, opportunistic):** Pilih 3 section dengan data
   load paling berat (DashboardHome, ReportsSection, AccountingSection)
   untuk Option C split. Validate bundle size delta + TTI delta. Kalau
   terbukti benefit, lanjut sisa section.

3. **Step 3 (cleanup):** Audit "use server" files, identify functions
   yang sebenarnya internal helper (mis. customers.bumpInTx) — relocate
   ke non-"use server" lib file untuk hindari accidental exposure.

**Defer indicator:** Phase 11.x trigger kalau:
- Lighthouse / WebPageTest score di tablet bottleneck di "Total Blocking Time"
- Owner / staff lapor admin page slow load
- Bundle size > 300kb gzipped (current ~?? — check via `npm run build`)

Kalau tablet ops jalan smooth tanpa complaint, defer indefinitely.

---

## 6. Anti-Pattern yang Sudah Di-Handle

Beberapa hal yang **sudah benar** di codebase (jangan regress):

- ✅ Page-level files (`page.tsx`) sudah server component — auth wall di
  `(admin)/layout.tsx` `RequireAuth allowRoles=...`
- ✅ Server actions di `src/features/<feature>/actions.ts` dengan
  `"use server"` — proper RSC pattern
- ✅ Type files (`types.ts`) tidak `"use server"` — bisa di-share antara
  server + client
- ✅ Memory `auth-barrel-pulls-db`: client jangan import via barrel
  yang pull DB. Sudah ada `server-only` guard di `src/db/index.ts`
- ✅ Memory `use-server-barrel-trap`: client component import direct
  dari `actions.ts` + `types.ts`, jangan via `index.ts` barrel kalau
  mix server + client exports

---

## 7. Owner Decision Required

Untuk progress migration ke Phase 11.x:

1. **Q1:** Apakah ada perf complaint nyata dari tablet ops? Kalau ada,
   prioritas. Kalau tidak, defer.
2. **Q2:** Prefer Option A (incremental data loader) atau B (URL
   routing)? B adalah foundational tapi 1-day commit; A bisa cicil.
3. **Q3:** Kalau Phase 11.x dijalankan, mau dedicate full session atau
   spread di multiple? Spread = lower regression risk per session.

Default kalau owner tidak respon: defer indefinite, refactor saat ada
perf metric yang justify.

---

## 8. Reference

- code-review note #5 dari ramaactivity/temannya: "semua page-nya
  client component"
- Memory `feedback_use_server_barrel`, `feedback_auth_barrel_pulls_db`
- Sesi AC-5c + AC-5d security hardening (resolves #1-4 dari note;
  #5 dideferred ke doc ini)
