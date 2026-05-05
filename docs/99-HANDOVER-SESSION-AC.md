# Handover Sesi AC — Lanjutan Phase 5–10 (Sesi AB Field-Test In Progress)

**Tanggal handover:** 2026-05-05
**Branch:** `release/phase-1`
**HEAD terakhir:** `1b097b9` (sesi AB-29 — Phase 4-C absensi mobile full integrity)
**Production:** https://mahakan-pos.vercel.app — DEPLOYED
**Tests:** 580/580 passing
**Migrations applied prod:** 0001 → 0027 (terakhir 0027 Phase 4 attendance mobile)
**Reminder agent:** `trig_01QG2yjEfcxjVs1z4x4LqZYE` fires 2026-05-09 09:00 Jakarta — JANGAN dibuat ulang.

---

## Status Sesi AB (closed 2026-05-04, 29 staged deploys AB-1 → AB-29)

✅ **Phase 1** critical bugs (4): keyboard glitch, outside-click data loss, double txn race, absensi ghost box
✅ **Phase 2** POS hardening (6): tutup kasir guard, 30/15min notifikasi, petty cash standalone, setor ke owner auto-deposit, allow stok minus, EDC expand BNI/Mandiri/BRI/Lainnya
✅ **Phase 3** POS UX (5): full-viewport PaymentModal, numpad redesign, close-keyboard btn, click-outside, AB-22 JSX eager hotfix, AB-23 compact, AB-24 PaidPanel polish, AB-25 hardcoded BCA audit
✅ **Phase 4** absensi mobile trio:
  - 4-A: schema migration 0027 + admin attendance PIN modal + GPS settings
  - 4-B: `/absenkaryawan` PIN-only mobile route + verifyAttendancePin
  - 4-C: full integrity flow (PIN bcrypt → JPEG+EXIF DateTimeOriginal max 5 menit → haversine GPS → clientRefId UUID dedup 60s → workflow guard → Drive `ABSENSI/{Nama}/{date}/` hard-fail → late detect)
✅ **Phase 6.2** Cash on Hand widget di POS Shifts tab
✅ **Phase 6.3** Neraca tile di DashboardHome (3-col Aset/Liabilitas/Ekuitas)
✅ **Phase 6.4** PNL comparison toggle (prev month / prev year / custom range)
✅ **Phase 7.1** Modifier full CRUD + RBAC + audit
✅ **Phase 7.2** BOM-based price suggestion (`computeMenuItemPriceSuggestion`, default markup 250%)
✅ **Phase 7.3** Save as Menu Item dari COGS Calculator (sessionStorage prefill)
✅ **Phase 9.1** Sidebar admin grouping (19 items dalam 8 group)
✅ **Phase 9.2** EmptyCard primitive applied ke 14+ sections
✅ **Phase 3.4** Sortable column headers + sessionStorage persist (5 list views)

**Implicit auto-completed:**
- **Phase 5.1** (attendance → payroll auto-fill): `computePayrollLines` aggregates dari `attendance_records` table — Phase 4-C mobile clocks tulis ke kolom yang sama (`workMinutes`/`lateMinutes`/`overtimeMinutes`), jadi flow jalan otomatis tanpa code tambahan.

---

## Field Test In Progress (Owner + Staff)

**Yang sedang ditest** (parallel dengan sesi AC):
1. Phase 4 absensi mobile end-to-end:
   - Set PIN 6-digit untuk 1 karyawan via Admin → Karyawan → 🔑 button
   - Set GPS center via Admin → Pengaturan → Operasional → Absensi Mobile
   - Buka `mahakan-pos.vercel.app/absenkaryawan` di HP karyawan
   - PIN → allow GPS → ambil selfie kamera (bukan galeri) → submit
   - Verify Drive folder `ABSENSI/{Nama}/{YYYY-MM-DD}/` + `attendance_records` row terisi
2. Phase 1 keyboard glitch + outside-click + double txn dalam ops harian
3. Phase 2 tutup kasir guard + 30/15min notifikasi
4. Phase 3 PaymentModal full-viewport di tablet ops
5. Phase 7.1 Modifier CRUD oleh manager

**Bug reports atau gesekan UX dari field test akan masuk ke sesi AD.**

---

## Pending Phases — Sesi AC scope

### Phase 5.2 — Payroll detail per komponen + accounting integration

**Status:** Saat ini `mapPayrollPaid` hanya emit 2 journal lines (Dr 6101 total / Cr Kas-Bank). Owner ingin breakdown per komponen.

**Scope:**
- Tambah COA accounts baru: 6101.1 Gaji Pokok, 6101.2 Lembur, 6101.3 Bonus, 6101.4 THR, dan akun kontra Potongan
- Extend `mapPayrollPaid` (di `src/features/accounting/mapping/payrollPaid.ts`) untuk emit multi-line journal: per komponen debit terpisah, total credit ke Kas/Bank
- Migration additive — tambah row ke `chart_of_accounts` seed
- UI di payroll detail tetap sama (sudah show breakdown), perubahan hanya di journal lines
- Test: verify journal balanced (debit total = credit total) per period

**Risk:** medium. Idempotency via `sourceId = payrollPeriodId` sudah ada — re-run safe.

### Phase 5.3 — Merge Absensi + Laporan HR ke 1 dashboard

**Status:** Currently 2 admin tabs terpisah. Owner ingin satu dashboard "HR Operations" dengan sub-tabs.

**Scope:**
- New container component `HrOperationsSection` dengan inner tabs:
  - Absensi (real-time live view, today's clock-ins)
  - Schedules (existing)
  - Payroll (existing)
  - Reports (existing CSV exports + late grace + tenure)
- Sidebar grouping (sesi AB Phase 9.1) sekarang HR group punya: Karyawan / HR Operations (single entry replace 4 entries)
- Preserve URL routing — route `/admin?section=hr-ops&tab=absensi`
- No schema change

**Risk:** low (refactor + UX). Hati-hati state management antar inner-tabs (preserve filters between switches).

### Phase 6.1 — Settlement harian CRUD per channel mutasi bank

**Status:** Currently read-only summary di Keuangan tab. Owner ingin input mutasi bank actual + variance log.

**Scope OQ-driven** (lihat Open Questions #1):
- Per channel (cash/EDC-BCA/EDC-BNI/EDC-Mandiri/EDC-BRI/EDC-Lainnya/QRIS/aggregator)
- Form: tanggal + channel + expected amount (auto from POS) + actual mutasi bank + variance (auto-calc) + notes
- Tabel `settlement_logs` baru atau extend `cash_deposits`?
- UI: row per channel per hari, color-coded variance (green = match, red = >1% variance)
- Audit trail per edit
- Export CSV

**Risk:** medium-high. Schema decision needed dulu — confirm dengan owner sebelum migration.

### Phase 6.5 — Request belanja form di tutup shift

**Status:** New feature. Saat tutup shift, form list items yang stoknya minus / low → submit jadi purchase request.

**Scope OQ-driven** (lihat Open Questions #2 WhatsApp):
- Migration `purchase_requests` table (id, outletId, shiftId, items jsonb, status, createdAt)
- Form di CloseShiftModal — auto-list ingredients dengan stock <= reorder threshold
- Submit → INSERT purchase_requests + (optional) `wa.me` link auto-generate dengan pre-filled message
- Server action `createPurchaseRequest` + `listPurchaseRequests`
- Admin → Pembelian → Permintaan tab untuk view + close

**Risk:** low (additive). UX scope moderate — perlu reorder threshold per ingredient.

### Phase 6.6 — Goods Receive feature

**Status:** Pair dengan 6.5. Setelah purchase request → manager belanja → receive screen mark per-item received qty.

**Scope:**
- Receive screen per `purchase_request`: list items, input received qty, partial receive supported
- Item yang belum receive auto-roll ke request berikutnya (status carryover)
- Update existing `purchases` flow — link `purchase.requestId` (FK ke purchase_requests)
- Migration additive (kolom requestId nullable di purchases)

**Risk:** low-medium. Depends on 6.5 ship dulu.

### Phase 8.1 — Role CRUD + permissions matrix

**Status:** Currently 3 hardcoded roles (Owner / Manager / Staff). Owner ingin custom roles.

**Scope OQ-driven** (lihat Open Questions #3):
- Option A — full custom: tabel `roles` + `role_permissions` (m:n), UI matrix per feature toggle, migration besar
- Option B — 1-2 extra roles fixed (mis. "Supervisor"): extend enum + RBAC map, scope kecil
- Owner pilih dulu sebelum execute

**Risk:** A = high (RBAC refactor menyentuh 50+ permission gates). B = low (just extend enum + map).

### Phase 10.1 — Riset ESB POS gap analysis

**Status:** Async, no code. Output: markdown gap analysis doc.

**Scope OQ-driven** (lihat Open Questions #4):
- Owner share ESB demo / docs / screenshot competitor
- Identify fitur missing di Mahakan + relevan ke kafe segment
- Output: `docs/RESEARCH-ESB-GAP.md` dengan tabel fitur + estimasi effort

**Risk:** zero (research only).

---

## Saran Eksekusi (urutan ship sesi AC)

**Sambil tunggu field-test feedback:**

1. **Phase 5.3** (HR Operations dashboard merge) — low risk, contained UI refactor, ship cepat untuk dapat momentum
2. **Phase 5.2** (payroll detail per komponen) — medium risk, sebaiknya setelah 5.3 jadi UI siap show breakdown
3. **Phase 6.5 + 6.6** (belanja form + goods receive pair) — ship sekaligus karena interconnected
4. **Phase 6.1** (settlement CRUD) — pause sampai owner spec confirm
5. **Phase 8.1** (Role CRUD) — pause sampai OQ#3 jawab
6. **Phase 10.1** (ESB research) — async, owner share materi

**Hari 1 sesi AC:** 5.3 ship → owner verify dashboard merge
**Hari 2:** 5.2 ship + new COA accounts via additive migration
**Hari 3:** 6.5 + 6.6 ship pair (purchase_requests table + receive flow)
**Hari 4+:** menunggu OQ jawab + field-test feedback dari sesi AB

---

## Open Questions (untuk Owner clarify sebelum sesi AC execute)

1. **Phase 6.1 settlement schema** — apakah extend `cash_deposits` table (per-channel) atau buat tabel baru `settlement_logs`? Saya recommend tabel baru karena cash_deposits semantically beda (cash → bank movement only). Variance threshold default 1% atau owner mau set per channel?
2. **Phase 6.5 WhatsApp** — pakai WhatsApp Business API (paid, ~Rp 100k/bulan, async webhook) atau cukup `wa.me` link manual (free, owner click → manual send)? Saya recommend `wa.me` MVP, escalate kalau friction tinggi.
3. **Phase 8.1 role scope** — full custom (tabel `roles` + `role_permissions`, UI matrix) atau cukup 1-2 role tambahan fixed (mis. "Supervisor" antara Manager/Staff)? Full custom = scope ~3 hari, fixed extra = ~1 hari.
4. **Phase 10.1 ESB akses** — owner punya demo / login / screenshot competitor yang bisa di-share? Tanpa ini saya cuma bisa baca public docs (mungkin shallow).
5. **Migration order strategy** — sesi AB sudah deploy 0027 + accounting 1 Juni cutover masih jauh. Untuk Phase 5.2 + 6.1 + 6.5 yang butuh new COA accounts atau new tables, deploy CODE FIRST baru migrate (sesuai memory `migration-ordering-rule`)?
6. **Field-test bug intake** — kalau owner / staff lapor bug critical dari Phase 1-4 mid-sesi AC, prioritas: ship hotfix (interrupt) atau queue ke akhir sesi?

---

## Constraints & Reminders (carry forward dari sesi AB)

- **Permanent rule:** NO native pickers (`<select>`, `<input type=date|time>`, `captionLayout="dropdown"`). Always custom Radix popover. Owner re-flagged 3x.
- **`use server` barrel trap:** client components import direct dari `actions.ts` + `types.ts`, jangan via barrel. `hasPermission` import direct dari `@/lib/auth/rbac`, jangan via `@/lib/auth`.
- **JSX children eager eval:** Modal `if(!open) return null` TIDAK short-circuit parent's `<Modal>{draft.items.map(...)}</Modal>` — `.map` jalan dulu. Selalu conditional-render di call site OR internal early-return AFTER hooks. (AB-22 hotfix lesson.)
- **Migration:** additive only, no DROP/ALTER. Apply ke Neon prod via `npm run db:migrate` after Owner confirm.
- **Migration ordering rule:** non-additive changes — deploy CODE FIRST, apply DB migration SECOND (otherwise live old code breaks on dropped cols).
- **ApiResult shape:** Inventory pakai `{success}`, Accounting/Cash pakai `{ok}`. JANGAN salah pakai.
- **Auto-journal flag:** masih default OFF. Owner toggle di Admin → Settings → "Auto-Journal Akuntansi" SETELAH 1 Juni 2026 cutover.
- **Pre-flight wajib sebelum commit:** `npx tsc --noEmit && npx eslint <files> && npx vitest run && NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack` (heap bump untuk googleapis).
- **Deploy:** push ke `release/phase-1` TIDAK auto-deploy production. Run `npx vercel --prod --yes` manual.
- **Drive integration:** OAuth refresh token, 4 env vars di Vercel. Auto-rename via `buildFriendlyFilename()`. Folder structure: `MAHAKAN COFFEE/{NOTA MAHAKAN|DOKUMEN HR|STRUK PENGELUARAN|ABSENSI}/{...}`. Modul "attendance" baru di sesi AB-29.
- **Pause-before-destructive (refined):** routine commits/push/deploy/additive migrations OK; truly destructive (force-push, reset --hard, drop col) tetap perlu confirm.
- **Reminder agent:** sudah scheduled 2026-05-09. JANGAN buat baru.

---

## Files & Primitives Baru di Sesi AB (untuk reference sesi AC)

- `src/lib/payment-method.ts` → `paymentMethodLabel()` central helper (replace 6 hardcoded "Kartu BCA")
- `src/components/ui/SortableHeader.tsx` + `useColumnSort` hook → sortable list views
- `src/components/ui/EmptyCard.tsx` → uniform empty state (icon + title + helper + optional action)
- `src/lib/haversine.ts` → `haversineDistanceMeters({lat,lng}, {lat,lng})` WGS-84
- `src/lib/exif-check.ts` → `validateSelfieEXIF(buffer, now)` JPEG sig + DateTimeOriginal max 5 menit
- `src/lib/google-drive/uploader.ts` → "attendance" module added (ABSENSI root folder)
- `src/features/attendance-mobile/actions.ts` → `verifyAttendancePin(pin)` PIN-only auth
- `src/features/attendance-mobile/AttendanceShell.tsx` → state machine pin → ready → act → done
- `src/app/api/v1/attendance/clock-mobile/route.ts` → multipart POST endpoint
- `src/features/admin/sections/employees/EmployeeAttendancePinModal.tsx` → admin set/reset PIN
- `src/db/schema/attendance.ts` → 6 new cols (selfie_drive_url, selfie_drive_file_id, gps_lat, gps_lng, gps_distance_meters, client_ref_id)
- `src/db/schema/employees.ts` → `attendancePinHash` text col (separate from POS PIN)
- `src/db/schema/outlets.ts` → `OutletSettings.attendance.gpsCenter` (lat/lng/radiusMeters)

**RBAC keys baru:** `employee.attendance_pin.manage`, `outlet.attendance_gps.manage`, `modifier.create`, `modifier.delete`

**Audit eventTypes baru:** `employee.attendance_pin.set/.reset`, `outlet.attendance_gps.update`, `attendance.mobile_clock_in/_out/_rejected`

---

## Memory Pointers (auto-loaded)

Memory checkpoint utama: `project_sesiAB_close.md` (29 deploys ringkasan).

Key feedback memories (active):
- `feedback_no_native_pickers` — PERMANENT, no `<select>`/`<input date>`/dropdown captionLayout
- `feedback_use_server_barrel` — client jangan import via barrel `use server` actions
- `feedback_auth_barrel_pulls_db` — client import `@/lib/auth/rbac` direct, bukan `@/lib/auth`
- `feedback_jsx_children_eager_eval` — JSX children eval eagerly, Modal early-return tidak guard
- `feedback_pause_destructive` — routine ops auto, destructive perlu confirm
- `feedback_migration_ordering` — code first, migration second untuk non-additive
- `feedback_offline_only_mode` — SUPERSEDED (production live, normal cadence allowed)
