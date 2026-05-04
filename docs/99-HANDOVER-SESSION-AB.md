# Handover Sesi AB — Owner+Staff Field-Test Bundle

**Tanggal handover:** 2026-05-04
**Branch:** `release/phase-1`
**HEAD terakhir:** `34f7d62` (sesi AA polish — Drive auto-rename + parent refresh)
**Production:** https://mahakan-pos.vercel.app — DEPLOYED
**Tests:** 580/580 passing
**Phase 2 Accounting tier:** FULLY COMPLETE (sesi R-Y, 7 sesi). Cutover deadline 1 Juni 2026.
**Reminder agent:** `trig_01QG2yjEfcxjVs1z4x4LqZYE` fires 2026-05-09 09:00 Jakarta — JANGAN dibuat ulang.

---

## Status Sesi AA (closed 2026-05-04)

✅ HPP estimate per row + per-section card di OpnameCountView (`5b60c32`)
✅ Purchase ANY() bug fix + Direct purchase toggle + receipt upload via Vercel Blob (`6995180`)
✅ Edit unit optimistic UI override (`4dee08c`)
✅ Drive integration via OAuth refresh token (Service Account → OAuth pivot, `b6ec35a`)
✅ Drive extension ke 3 modul: Purchase + HR + Expense (`85e7af0`)
✅ HR doc deferred upload + tombol Simpan Dokumen (`ee01db6`)
✅ Drive auto-rename `{ts}_{LABEL}_{parts}_by_{Uploader}.{ext}` + parent refresh (`34f7d62`)

Old session handovers (14, 15, 16, 17, 18, 19, 20, 21, Z, AA) sudah dipindah ke
`~/Desktop/BACKUP-MAHAKANPOS-ERP/` untuk arsip.

---

## Owner + Staff Field-Test Notes (input untuk sesi AB)

Owner + staff melakukan deep testing sesi AA deploy. Banyak temuan baik bug
critical, missing features, maupun UX polish. Saya kelompokkan ke **10 phase**
dengan prioritas + dependencies — eksekusi BERTAHAP per phase agar zero
regression.

### Phase 1 — CRITICAL BUGS (ship first, blocks daily ops)

| # | Issue | Severity | Hint root cause |
|---|---|---|---|
| 1.1 | Keyboard glitch saat typing — type 1 huruf, fokus keluar dari box, klik lagi, type 1 huruf, keluar lagi | 🔴 Critical | Likely re-render mid-type karena parent state change. Cek custom NumericInput + Input components — controlled value binding might re-mount on each char. Suspect: `key` prop yang berubah, atau parent passes new ref each render. |
| 1.2 | Klik area diluar popup → form input data hilang. Tutup tidak intentional, harus input ulang dari awal | 🔴 Critical | Modal probably uses `Dialog onPointerDownOutside` default close. Need either: (a) confirm dialog kalau ada unsaved changes, (b) persist form draft di sessionStorage, (c) ignore outside-click kalau form dirty. Pilih (c) + tombol close X eksplisit. |
| 1.3 | Double transaction muncul saat klik Bayar | 🔴 Critical (financial) | Race condition — button bisa di-click 2x sebelum first request resolve. Need: optimistic disable button on click + show overlay loading state + idempotency via clientRefId (already exists at server side, but UI doesn't gate). Add proper "processing..." overlay yang block all input until response. |
| 1.4 | Absensi page show "ghost box" di beberapa device — empty rendering | 🟡 High | Likely web Bluetooth API check fails on some browsers, or layout breaks on certain viewport. Investigate device matrix + DevTools logs. |

### Phase 2 — POS HARDENING (financial integrity)

| # | Issue | Notes |
|---|---|---|
| 2.1 | Block Tutup Kasir kalau ada open bills (popup warning) | Add validation di closeShift action: if open bills exist for this shift → reject dengan list bill numbers. UI: confirm modal dengan daftar open bills + arahan "selesaikan dulu atau batalkan". |
| 2.2 | Notification 30/15 menit before expected close | New shift settings: `expectedCloseTime`. Background timer di POS shell yang trigger toast warning kalau open bills > 0 dan waktu tinggal sedikit. Optional sound alert. |
| 2.3 | Petty Cash punya tab sendiri (out of Settings) | Move PettyCashCard dari PosSettingsPanel ke standalone tab di PosLeftNav. Update navigasi. |
| 2.4 | Tutup Kasir: rekonsiliasi petty cash + inter-cash + setoran tracking | CloseShiftModal extend: section "Petty Cash" (in/out summary + verifikasi sisa drawer), section "Inter-Cash" (cash di drawer vs disetor ke owner — perlu konfirmasi setoran amount). Auto-create cash_deposit pending entry kalau ada selisih. |
| 2.5 | Allow stok bahan baku negative (menu tetap aktif) | Saat ini sold-out re-eval di-disable kalau stock < 0. Owner mau menu TETAP available walaupun bahan minus — recon nanti via opname. Change: hapus auto-disable when stock crosses 0. Tambah warning badge "stok minus" di admin Inventory tapi tidak block POS. |
| 2.6 | EDC options: tambahkan selain BCA + BNI | Currently `card_bca` only. Extend `paymentMethod` enum: `card_bca`, `card_bni`, `card_mandiri`, `card_bri`, `card_other`. Migration additive, UI options dropdown extended. Plus update accounting hooks (sesi T) for new bank routing. |

### Phase 3 — POS UX REDESIGN (cashier productivity)

| # | Issue | Notes |
|---|---|---|
| 3.1 | Numpad Payment dedicated 2-column layout, no native keyboard, no scroll | New PaymentModal dengan 2-kolom: kiri = detail transaksi (subtotal, diskon, total, customer info), kanan = numpad besar + amount input. Pakai full viewport width. |
| 3.2 | Payment popup standalone (bukan di kolom kanan POS) | Currently `RightPanelState.kind="paying"` muter di kolom kanan. Replace dengan dedicated Modal — clear focus pada transaksi yang sedang diproses. |
| 3.3 | Close-keyboard button + better keyboard mechanism | Add tombol "Tutup Keyboard" di NumericInput keypad. Optional: keyboard inline (fixed) vs popup mode toggle di settings. |
| 3.4 | Sort/filter ascending/descending alphabetical per kolom | Add sort headers ke list views (Inventory, Menu, Suppliers, Karyawan, Pembelian, etc.). Sticky-state per session. |

### Phase 4 — ABSENSI MOBILE + INTEGRITY

**Goal:** Each staff scans selfie at the cafe, app validates GPS radius
50m dari `https://maps.app.goo.gl/i3SfZXvqPXK285Zo7`, blocks upload of
saved images (camera-only), late detection auto.

| # | Issue | Notes |
|---|---|---|
| 4.1 | Standalone mobile route `/absenkaryawan` | New page dengan mobile-first layout. Auth via PIN ke karyawan PIN bukan staff PIN (separate). Bypass admin shell. |
| 4.2 | Selfie REQUIRED via `<input type="file" accept="image/*" capture="user">` | `capture="user"` force front-camera, no upload. Kalau browser allow override, server-side reject EXIF mismatch (no DateTimeOriginal = upload, reject). |
| 4.3 | GPS check radius 50m dari kedai | `navigator.geolocation.getCurrentPosition`, compute haversine distance, reject kalau > 50m. Show "Anda terlalu jauh dari kedai" + map. |
| 4.4 | Selfie archive ke Drive folder ABSENSI/{karyawan}/{tanggal}/ | Reuse Drive uploader (sesi AA), new module `attendance`. Pattern: `{YYYYMMDD-HHmm}_{IN|OUT}_{Nama}.jpg`. |
| 4.5 | Late detection auto | Compare clock_in_at vs employee.shift_start_time → flag `is_late=true` + minutes_late. |

### Phase 5 — HR + PAYROLL INTEGRATION

| # | Issue | Notes |
|---|---|---|
| 5.1 | Absensi → Payroll auto-fill | Hook attendance_records → payroll_lines: hours_worked, overtime_hours, late_minutes. Per period close → recompute. |
| 5.2 | Payroll detail + integrate dengan keuangan | Sesi T sudah ada `mapPayrollPaid` accounting hook — extend untuk include detail per komponen (gaji pokok, lembur, THR, potongan, dll.). |
| 5.3 | Merge Absensi + Laporan HR (atau enhance both) | Currently 2 tab terpisah. Merge jadi 1 dashboard "HR Operations" dengan sub-tab: Absensi (real-time), Schedules, Payroll, Reports. |

### Phase 6 — KEUANGAN ENHANCEMENT

| # | Issue | Notes |
|---|---|---|
| 6.1 | Settlement harian: CRUD per channel mutasi bank | Currently read-only summary. Add CRUD form: per channel (cash/MDR/EDC/QRIS/aggregator) input mutasi bank actual + expected vs actual variance log. |
| 6.2 | Inter-cash: cash → bank movement clarity | `cash_deposits` table (sesi Q) + UI yang lebih clear di PosShell + Backoffice Keuangan. Cash on hand widget di POS show "yang belum disetor: Rp X". Notifikasi ke Owner kalau over threshold. |
| 6.3 | Balance Sheet / saldo per akun tile | Sesi V `buildBalanceSheet` sudah ada. Surface ke Akuntansi → Reports → Neraca tile dashboard untuk current period. |
| 6.4 | PNL comparison antar periode | ReportsView IncomeStatement: tambah toggle "Bandingkan dengan periode sebelumnya" (prev month, prev year, custom range). |
| 6.5 | Request belanja form di tutup shift | New form di CloseShiftModal: list items yang stoknya minus / low. Submit → tabel `purchase_requests`. Auto-send WhatsApp via WhatsApp Business API atau wa.me link. |
| 6.6 | Goods Receive feature | Setelah purchase request masuk + manager belanja → receive screen: per item tick "received qty" → close request. Item yang belum receive auto-roll ke request berikutnya. |

### Phase 7 — MENU + INVENTORY

| # | Issue | Notes |
|---|---|---|
| 7.1 | Modifier CRUD enhancements | Currently read-only display. Add full CRUD UI di backoffice Menu tab. Plus drag-reorder + bulk price update. |
| 7.2 | Harga jual via master menu + BOM (terkoneksi 2-arah) | Saat ini `menu_items.price` manual. New: kalau BOM ada → auto-suggest price = COGS * markup_pct (dari outlet settings). Owner bisa override. |
| 7.3 | Add menu via COGS calculator (use BOM/recipe to derive) | New flow: COGS Calculator → tap "Save as menu item" → pre-fill MenuFormModal dengan recipe + suggested price. |

### Phase 8 — ROLE & PERMISSIONS

| # | Issue | Notes |
|---|---|---|
| 8.1 | Role CRUD di backoffice | Currently 3 hardcoded roles (Owner / Manager / Staff). Owner ingin custom roles + assign permissions per-feature. New table `roles` + `role_permissions`. Migration + UI. |
| 8.2 | Permissions matrix configurable | Per-feature toggle UI (mis. Manager bisa lihat HPP report? Manager bisa edit menu price?). Defer ke sesi tersendiri kalau scope besar. |

### Phase 9 — UI/UX POLISH

| # | Issue | Notes |
|---|---|---|
| 9.1 | Tab menu backoffice grouped per kategori | Sidebar sudah > 15 items. Group: **Operations** (Dashboard, POS Live), **Inventory** (Bahan, Pembelian, Opname, Pergerakan, Suppliers), **Menu** (Items, Modifiers, Recipes), **Cashflow** (Kas, Petty Cash, Settlement), **HR** (Karyawan, Absensi, Schedules, Payroll, Reports), **Finance** (Keuangan, Akuntansi, Reports), **Marketing** (Promo, Member), **Settings** (Outlet, Roles). |
| 9.2 | Empty states konsisten + skeleton uniform | Replicate sesi Y polish #7 pattern ke section yang belum dipoles. |

### Phase 10 — RESEARCH

| # | Issue | Notes |
|---|---|---|
| 10.1 | Riset ESB POS feature yang bisa diadopsi | Lihat ESB POS (esb.id atau kompetitor). Identify fitur yang missing di Mahakan + relevant ke kafe segment. Output: gap analysis doc. |

---

## Saran Eksekusi (urutan ship)

**Hari 1 (sesi AB):** Phase 1 (4 critical bugs) — semua wajib ship dulu sebelum lanjut. Risk: kalau ada keyboard glitch parah, blocks daily ops.

**Hari 2-3:** Phase 2 (POS hardening — financial integrity). Tutup kasir guard + petty cash standalone + EDC expansion + stok minus allowance.

**Hari 4-5:** Phase 3 (POS UX redesign — payment popup + numpad layout).

**Sesi AC+** (Owner choose):
- Phase 4 (Absensi mobile) — high value, scope besar (~3 hari)
- Phase 5 (HR + Payroll integration) — depends on Phase 4
- Phase 6 (Keuangan enhancement) — Owner-facing high priority
- Phase 7 (Menu + Inventory) — quality of life
- Phase 8 (Role + Permissions) — scope besar, defer kalau bisa
- Phase 9 (UI polish) — fill leftover time
- Phase 10 (Research) — async, no code

---

## Constraints & Reminders

- **Permanent rule:** NO native pickers (`<select>`, `<input type=date|time>`, `captionLayout="dropdown"`). Always custom Radix popover. Owner re-flagged 3x.
- **`use server` barrel trap:** client components import direct dari `actions.ts` + `types.ts`, jangan via barrel. `hasPermission` import direct dari `@/lib/auth/rbac`, jangan via `@/lib/auth`.
- **Migration:** additive only, no DROP/ALTER. Apply ke Neon prod via `npm run db:migrate` after Owner confirm.
- **ApiResult shape:** Inventory pakai `{success}`, Accounting/Cash pakai `{ok}`. JANGAN salah pakai.
- **Auto-journal flag:** masih default OFF. Owner toggle di Admin → Settings → "Auto-Journal Akuntansi" SETELAH 1 Juni 2026 cutover.
- **Pre-flight wajib sebelum commit:** `npx tsc --noEmit && npx eslint <files> && npx vitest run && NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack` (heap bump untuk googleapis).
- **Deploy:** push ke `release/phase-1` TIDAK auto-deploy production. Run `npx vercel --prod --yes` manual.
- **Drive integration:** OAuth refresh token (sesi AA), 4 env vars di Vercel. Auto-rename via `buildFriendlyFilename()` helper di `src/lib/google-drive/filename.ts`. Folder structure: `MAHAKAN COFFEE/{NOTA MAHAKAN|DOKUMEN HR|STRUK PENGELUARAN}/{...}`.
- **Reminder agent:** sudah scheduled 2026-05-09. JANGAN buat baru.
- **Pause-before-destructive (refined):** routine commits/push/deploy/additive migrations OK; truly destructive (force-push, reset --hard, drop col) tetap perlu confirm.

---

## Open Questions (untuk Owner clarify before sesi AB execution)

1. **Phase 4 absensi mobile** — apakah Owner mau staff PIN terpisah dari POS PIN, atau pakai PIN yang sama? (impact: schema + login flow)
2. **Phase 6.5 WhatsApp** — pakai WhatsApp Business API (paid, ~Rp 100k/bulan) atau cukup `wa.me` link manual? (impact: auto-send vs manual)
3. **Phase 8 role custom** — Owner mau full custom roles atau cukup 1-2 role tambahan (mis. "Supervisor" intermediate)? (impact: schema scope)
4. **Phase 10 ESB research** — Owner punya akses ke ESB demo / docs yang bisa di-share?
