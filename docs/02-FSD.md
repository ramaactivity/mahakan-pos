# 📋 FSD — Mahakan Coffee & Space POS System

**Functional Specification Document**
**Version:** 1.0 — Phase 1 MVP
**Date:** April 2026
**Status:** ✅ APPROVED
**Depends on:** `01-PRD.md`

---

## How to Read This Document

Setiap feature dari PRD (`P1-xxx-NNN`) di-ekspansi di sini dengan:

- **Purpose** — kenapa fitur ini ada (link kembali ke PRD)
- **Trigger** — kapan/bagaimana fitur di-invoke
- **Actor** — siapa yang bisa menggunakan
- **Preconditions** — state yang harus benar sebelum fitur aktif
- **Main Flow** — happy path step-by-step
- **Alternate Flows** — variasi dari happy path
- **Error Cases** — apa yang salah bisa terjadi dan bagaimana handling-nya
- **Validation Rules** — aturan input yang harus dipenuhi
- **Business Rules** — logika bisnis non-trivial
- **State Transitions** — jika fitur punya state machine
- **UI Acceptance Criteria** — visual/interaction requirements

---

## 1. Global Conventions

### 1.1 Input Validation Standards

| Input Type | Rule |
|---|---|
| Text (required) | Min 1 char, max sesuai konteks, trim whitespace |
| Email | RFC 5322 compliant, max 255 char, lowercase saat simpan |
| Password | Min 8 char, harus ada 1 huruf + 1 angka, no spaces |
| PIN | Exactly 4-6 digits, numeric only |
| Money (rupiah) | Integer ≥ 0, max 999.999.999 (hampir 1 miliar), no decimal, no negative |
| Percentage | Integer 0-100 |
| Phone number | Indonesia format: `08xxxxxxxxxx` atau `+628xxxxxxxxxx`, 10-13 digits |
| Date | ISO 8601 di backend, DD/MM/YYYY di UI |
| Pager number | Integer 1-99 |

### 1.2 Error Handling Convention

Setiap error punya struktur:
```
{
  code: "ERROR_CODE",       // machine-readable
  message: "Pesan user",    // UI display (Bahasa Indonesia)
  field?: "field_name",     // jika validation error
  context?: {...}           // debug info (dev only)
}
```

**Error display:**
- **Form errors** → inline di bawah field (red text)
- **API errors** → toast notification (top-right) dengan tombol retry
- **System errors** → full-screen error page dengan link back to home
- **Validation errors** → disable submit button + inline messages

### 1.3 Loading & Optimistic UI

- Setiap API call yang > 100ms → tampilkan loading state (spinner/skeleton)
- **Optimistic updates** untuk: add item ke cart, increase/decrease qty, toggle sold-out
- Jika optimistic update gagal → rollback + error toast
- Destructive actions (void, delete, refund) **tidak** optimistic — wajib tunggu server confirm

### 1.4 Confirmation Patterns

| Action | Confirmation Style |
|---|---|
| Delete menu, delete user, void, refund | Modal konfirmasi dengan input "ketik VOID untuk konfirmasi" |
| Process payment | Modal ringkas "Konfirmasi bayar Rp XXX via YYY?" |
| Close shift | Modal dengan summary + input kas aktual |
| Logout | Toast konfirmasi "Yakin logout?" |
| Toggle sold-out | No confirmation (easy to undo) |

### 1.5 Audit Log Events

Setiap action berikut **wajib** masuk audit log:

| Event | Payload |
|---|---|
| `user.login.success` | user_id, ip, user_agent |
| `user.login.fail` | email/pin_attempt_hash, ip, reason |
| `user.logout` | user_id |
| `user.created` | target_user_id, role, by_user_id |
| `user.updated` | target_user_id, changed_fields, before, after |
| `user.deactivated` | target_user_id, by_user_id, reason |
| `user.pin_reset` | target_user_id, by_user_id |
| `menu.item.created` | item_id, fields |
| `menu.item.updated` | item_id, changed_fields, before, after |
| `menu.item.deleted` | item_id |
| `menu.item.price_changed` | item_id, old_price, new_price |
| `transaction.created` | transaction_id, total, items_count |
| `transaction.voided` | transaction_id, by_user_id, approver_id, reason |
| `transaction.refunded` | transaction_id, by_user_id, approver_id, reason, amount |
| `transaction.discounted` | transaction_id, by_user_id, approver_id, discount_type, amount |
| `shift.opened` | shift_id, user_id, opening_cash |
| `shift.closed` | shift_id, user_id, actual_cash, variance |
| `expense.created` | expense_id, amount, category |
| `expense.updated` | expense_id, changed_fields |
| `expense.deleted` | expense_id (Owner only) |
| `setting.changed` | key, old_value, new_value |

Audit log **immutable** — tidak bisa di-edit atau di-hapus.

---

## 2. Authentication & Session

### 2.1 `FSD-AUTH-001` — Login (Owner & Manager)

**Purpose:** Memastikan hanya user terotorisasi yang bisa akses back office.

**Trigger:** User akses URL apapun tanpa session aktif.

**Actor:** Owner, Operational Manager.

**Preconditions:**
- User account sudah dibuat oleh Owner
- User status = active

**Main Flow:**
1. Sistem redirect ke `/login`
2. Form: Email + Password + tombol "Masuk"
3. User input email & password
4. Klik "Masuk" → client-side validation (email format, password non-empty)
5. POST ke `/api/v1/auth/login` dengan email + password
6. Server: cari user by email (lowercase), check `deleted_at IS NULL`, check `status = 'active'`, check role ∈ `[owner, manager]`
7. Server: bcrypt.compare(password, user.password_hash)
8. Jika cocok: generate session (JWT), set cookie `httpOnly, secure, sameSite=lax`, expire 2 jam
9. Audit log: `user.login.success`
10. Redirect ke `/dashboard` (Owner) atau `/manager/dashboard` (Manager)

**Alternate Flows:**
- **A1:** User sudah login → skip login, redirect ke dashboard
- **A2:** User pilih "Ingat Saya" → session 7 hari (opsional, Phase 1 skip)

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | Email tidak ditemukan atau password salah | "Email atau password salah" (jangan bedakan—security) |
| `AUTH_ACCOUNT_DISABLED` | User.status = 'inactive' | "Akun Anda telah dinonaktifkan. Hubungi Owner." |
| `AUTH_ACCOUNT_LOCKED` | 5 failed attempts dalam 15 menit | "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." |
| `AUTH_WRONG_ROLE` | Staff coba login via form email (seharusnya via PIN) | "Gunakan halaman login staff dengan PIN" |

**Validation Rules:**
- Email: valid format, max 255 char
- Password: min 8 char (validasi saat create, login hanya check exist)

**Business Rules:**
- Failed login: audit log `user.login.fail` dengan attempt count
- Rate limit: max 10 attempts per IP per 15 menit (cross-account)
- Account lockout: 5 failed attempts per akun per 15 menit
- Session token: JWT signed dengan `AUTH_SECRET`, payload {user_id, role, outlet_id, iat, exp}

**UI Acceptance Criteria:**
- Desktop: centered card, max-width 400px, Mahakan logo di atas
- Mobile: full-width form dengan padding 24px
- Password field: toggle show/hide
- Submit button disabled saat loading (spinner)
- Error muncul di bawah form, red text

---

### 2.2 `FSD-AUTH-002` — Login (Staff via PIN)

**Purpose:** Login cepat untuk barista tanpa ketik password panjang.

**Trigger:** Staff akses `/pos` atau URL yang butuh auth.

**Actor:** Staff only (Owner/Manager juga bisa override lewat sini untuk POS operations)

**Preconditions:**
- User account staff sudah dibuat
- User status = active
- Outlet sudah di-setup (default 1 outlet di Phase 1)

**Main Flow:**
1. Sistem redirect ke `/pos/login`
2. Layar menampilkan: grid foto/nama staff aktif (avatar + nama)
3. Staff tap foto/nama mereka
4. PIN pad muncul (tombol angka besar, 0-9, backspace, submit)
5. Staff input PIN 4-6 digit (masked sebagai •••)
6. Auto-submit saat PIN lengkap (atau tap "Masuk")
7. POST ke `/api/v1/auth/login-pin` dengan user_id + pin
8. Server: cari user by id, check `deleted_at IS NULL`, check `status = 'active'`, check `role = 'staff'` atau Owner/Manager yang allow POS
9. Server: bcrypt.compare(pin, user.pin_hash)
10. Jika cocok: generate session (JWT), expire **12 jam**, set cookie
11. Audit log: `user.login.success`
12. Redirect ke `/pos` (dashboard POS)

**Alternate Flows:**
- **A1:** Staff sudah ada session aktif → skip, redirect langsung ke `/pos`
- **A2:** Owner/Manager login via PIN → session scope tetap role-nya (full access), hanya device behavior sebagai POS

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `AUTH_INVALID_PIN` | PIN salah | "PIN salah. Coba lagi." + shake animation |
| `AUTH_ACCOUNT_DISABLED` | User inactive | "Akun Anda tidak aktif. Hubungi Manager/Owner." |
| `AUTH_ACCOUNT_LOCKED` | 5 failed attempts | "PIN diblokir sementara. Tunggu 15 menit." |
| `AUTH_NO_SHIFT` | Login berhasil tapi belum ada shift dibuka | Banner warning "Belum ada shift aktif. Buka shift sekarang?" (ini bukan error, hanya prompt) |

**Validation Rules:**
- PIN: 4-6 digit, numeric only

**Business Rules:**
- PIN hash disimpan dengan bcrypt (≥ 12 rounds)
- PIN lockout: 5 failed attempts per user per 15 menit
- Session duration: 12 jam (agar tidak perlu re-login di tengah shift panjang)
- Logout otomatis jika tidak ada aktivitas > 2 jam (heartbeat check)

**UI Acceptance Criteria:**
- Tablet landscape: grid 4-5 kolom foto staff, tombol besar (min 120×120px)
- Mobile portrait: grid 3 kolom
- PIN pad: angka besar (min 72×72px tap target), haptic feedback jika device support
- Masked PIN: tampilkan dot (•) untuk tiap digit
- Auto-submit saat PIN lengkap (bisa diatur default 4 atau 6 di settings)
- Wrong PIN: shake animation + clear input + retry
- Logout button di top-right POS

---

### 2.3 `FSD-AUTH-003` — PIN Override Flow

**Purpose:** Izinkan Staff melakukan aksi restricted dengan approval Manager/Owner on-site.

**Trigger:** Staff tap aksi yang restricted (void, refund, diskon manual).

**Actor:** Staff (initiator), Owner/Manager (approver).

**Preconditions:**
- Staff sudah login dan punya session aktif
- Aksi yang dilakukan adalah aksi yang butuh approval

**Main Flow:**
1. Staff tap aksi restricted (misal "Void Transaksi")
2. Modal muncul: "Butuh persetujuan Manager/Owner"
3. Grid Manager/Owner aktif ditampilkan (hanya yang punya role approver)
4. Approver pilih nama mereka → PIN pad muncul
5. Approver input PIN-nya
6. POST ke `/api/v1/auth/verify-approver` dengan approver_user_id + pin + action_context
7. Server: verify PIN, check role ∈ `[owner, manager]`, check approver berhak untuk action tersebut
8. Jika valid: return short-lived approval token (5 menit)
9. Staff melanjutkan aksi dengan approval token di request
10. Server: validate approval token sebelum eksekusi action
11. Audit log: `transaction.voided` dengan `approver_id`

**Alternate Flows:**
- **A1:** Approver cancel → modal tertutup, aksi dibatalkan
- **A2:** Approver Owner override aksi yang manager tidak bisa → OK
- **A3:** Approver sama dengan initiator (Owner tap void-nya sendiri) → skip flow ini, langsung eksekusi

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `APPROVER_INVALID_PIN` | PIN approver salah | "PIN salah" |
| `APPROVER_NOT_AUTHORIZED` | PIN benar tapi role tidak cukup | "Role ini tidak bisa setujui aksi ini" |
| `APPROVAL_TOKEN_EXPIRED` | Token > 5 menit | "Sesi persetujuan kadaluarsa. Coba lagi." |

**Validation Rules:**
- PIN: sama dengan FSD-AUTH-002
- Approval token: JWT signed, payload {approver_id, action_type, target_id, exp}, expire 5 menit, single-use

**Business Rules:**
- Approval token hanya valid untuk 1 action specific (tidak reusable untuk action lain)
- Approval token di-invalidate setelah dipakai
- Audit log mencatat `initiator_id` dan `approver_id` terpisah

---

### 2.4 `FSD-AUTH-004` — Logout

**Purpose:** Terminate session securely.

**Trigger:** User tap "Logout" atau session expire.

**Main Flow:**
1. User tap tombol "Logout"
2. Toast konfirmasi "Yakin logout?" → OK/Batal
3. POST ke `/api/v1/auth/logout`
4. Server: invalidate session (blacklist token sampai exp)
5. Client: clear cookie, clear local state
6. Redirect ke `/login` atau `/pos/login` (tergantung last role context)
7. Audit log: `user.logout`

**Alternate Flow:**
- **A1 (Staff dengan shift terbuka):** Modal warning "Shift Anda masih terbuka. Logout tetap keluar dari aplikasi, tapi shift tetap aktif. Lanjutkan?"

**Business Rules:**
- Logout tidak auto-close shift
- Jika session expire di middle transaksi draft: transaksi tersimpan di IndexedDB, akan tampil saat login ulang

---

## 3. POS — Point of Sale

### 3.1 `FSD-POS-001` — Create New Order

**Maps to PRD:** `P1-POS-001`

**Purpose:** Memulai order baru untuk customer.

**Trigger:** Staff tap "Order Baru" di POS dashboard.

**Actor:** All POS roles (Owner, Manager, Staff).

**Preconditions:**
- User logged in
- Shift aktif milik user tersebut
- Setidaknya 1 menu item active tersedia (tidak semua sold-out)

**Main Flow:**
1. Staff tap "Order Baru"
2. Modal muncul:
   - Label "Nomor Pager" + numeric input (auto-focus)
   - Toggle "Tipe Order": Takeaway (default selected) / Dine-in
   - Tombol "Mulai Order" (disabled sampai pager diisi)
3. Staff input pager (misal 5), pilih tipe order
4. Tap "Mulai Order"
5. Client-side validasi: pager 1-99, tidak duplikat dengan order draft aktif lain
6. Navigate ke `/pos/order/new` dengan state `{pager: 5, type: 'takeaway'}`
7. Screen menampilkan: Menu grid (kiri 70%) + Cart kosong (kanan 30%)

**Alternate Flows:**
- **A1:** User punya order draft belum selesai → tombol "Order Baru" tetap aktif, order draft masuk ke sidebar (lihat FSD-POS-013)

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `ORDER_NO_ACTIVE_SHIFT` | Belum buka shift | Banner merah "Buka shift dulu sebelum transaksi" + tombol "Buka Shift Sekarang" |
| `ORDER_PAGER_DUPLICATE` | Pager 5 sudah dipakai di draft lain | "Pager 5 sudah dipakai. Pilih nomor lain." |
| `ORDER_PAGER_OUT_OF_RANGE` | Pager < 1 atau > 99 | "Nomor pager harus 1-99" |

**Validation Rules:**
- Pager: integer 1-99
- Type: enum `['dine_in', 'takeaway']`

**Business Rules:**
- Order draft disimpan di client state + IndexedDB (resilient online)
- Order draft tidak ter-persist di server sampai dibayar
- Pager duplicate check: hanya terhadap order draft aktif hari ini, BUKAN terhadap order yang sudah dibayar (pager bisa reuse setelah customer ambil pesanan)

**UI Acceptance Criteria:**
- Modal: width 400px (desktop), full-width (mobile)
- Numeric keypad untuk input pager di mobile
- Toggle Dine-in/Takeaway: segmented control, tap target ≥ 44px

---

### 3.2 `FSD-POS-002` — Menu Grid Display & Search

**Maps to PRD:** `P1-POS-002`

**Purpose:** Menampilkan menu dengan cara yang cepat dipilih barista.

**Trigger:** Staff di screen order aktif.

**Main Flow:**
1. Fetch daftar menu items dari cache (atau fallback ke `/api/v1/menu/items?active=true`)
2. Render tab kategori di atas (scrollable horizontal)
3. Tap kategori → filter grid
4. Default tab: kategori pertama (by `display_order`)
5. Setiap tile item menampilkan:
   - Nama (bold, max 2 baris, ellipsis)
   - Harga: jika fixed → "Rp 21.000", jika variant → "Rp 20-21rb" (range), jika open price → "Harga Manual"
   - Icon ♥ hijau jika `is_signature = true`
   - Badge "Habis" merah + grayscale jika `is_sold_out = true`
   - Badge "Manual" biru jika `is_open_price = true`

**Alternate Flows:**
- **A1 — Search:** Staff tap search icon → input field muncul → fuzzy match nama item (case-insensitive, substring match). Hasil filter grid.
- **A2 — Sold out toggle:** Long-press tile → menu "Mark Sold Out / Mark Available". Toggle → optimistic UI update + API call.

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `MENU_FETCH_FAIL` | API error atau offline tanpa cache | Fallback ke cached menu (IndexedDB), banner "Menu dari cache. Perbarui internet." |
| `MENU_EMPTY` | Tidak ada item aktif | Empty state "Belum ada menu. Minta Owner/Manager tambahkan menu." |

**Business Rules:**
- Sold-out status sync real-time via Server-Sent Events (SSE) atau polling 30 detik
- Cached menu di IndexedDB, TTL 1 jam
- Tap item sold-out tidak melakukan apa-apa (tile disabled)

**UI Acceptance Criteria:**
- Tablet landscape: 4 kolom
- Tablet portrait: 3 kolom
- Phone: 2-3 kolom
- Tile aspect ratio: 4:3 atau 1:1, min height 100px
- Touch target ≥ 80×80px
- Loading: skeleton shimmer 8 tiles
- Empty state: ilustrasi + CTA

---

### 3.3 `FSD-POS-003` — Add Item to Cart (Dengan Modifier)

**Maps to PRD:** `P1-POS-003`

**Purpose:** Tambahkan item ke cart dengan konfigurasi modifier sesuai.

**Trigger:** Staff tap tile item di menu grid.

**Main Flow:**

**Untuk item TANPA variant & TANPA modifier:**
1. Tap tile → item langsung masuk cart dengan qty 1
2. Optimistic UI: cart update + subtle animation (tile highlighted 300ms)
3. Tidak ada modal

**Untuk item DENGAN variant (Hot/Iced):**
1. Tap tile → modal muncul
2. Modal sections (scrollable jika panjang):
   - **Varian (wajib):** radio Hot / Iced. Jika salah satu Iced-only, Hot di-disable dengan label "(tidak tersedia)"
   - **Sugar Level (jika minuman):** radio Normal / Less / No Sugar (default Normal)
   - **Ice Level (jika Iced):** radio Normal / Less / No Ice (default Normal) — hanya muncul jika varian Iced dipilih
   - **Extra Shot (jika Coffee Based):** toggle on/off, label "+ Rp 8.000"
3. Harga dinamis update di footer modal sesuai pilihan
4. Tombol "Tambah ke Order" di bawah
5. Tap → item masuk cart dengan config tersimpan

**Untuk item OPEN PRICE (Manual Brew):**
1. Tap tile → modal muncul
2. Field:
   - Input harga (numeric, required, min 1.000, max 999.999.999)
   - Textarea "Catatan beans" (free text, max 200 char, opsional)
3. Tap "Tambah ke Order"
4. Item masuk cart dengan harga custom dan note

**Untuk item dengan ADD-ON (Bakmie dengan Extra Topping Ayam):**
1. Modal muncul
2. Toggle "Extra Topping Ayam + Rp 10.000"
3. Tap "Tambah ke Order"

**Alternate Flows:**
- **A1 (edit existing item):** Tap item di cart (bukan di menu) → modal yang sama muncul pre-filled dengan config lama. Save → replace item di cart.

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `ITEM_VARIANT_REQUIRED` | Item punya variant tapi user tidak pilih | Highlight field merah + "Pilih varian dulu" |
| `ITEM_INVALID_PRICE` | Open-price < 1.000 atau > 999.999.999 | "Harga harus antara Rp 1.000 - Rp 999.999.999" |
| `ITEM_SOLD_OUT_DURING_MODAL` | Race condition: item jadi sold-out saat modal terbuka | Close modal + toast "Item baru saja habis. Refresh menu." |

**Validation Rules:**
- Variant: required jika item has variant, enum `['hot', 'iced']`
- Sugar level: enum `['normal', 'less', 'none']`, default `normal`
- Ice level: enum `['normal', 'less', 'none']`, default `normal`, hanya valid jika variant = 'iced'
- Extra shot: boolean, hanya valid jika kategori = 'coffee_based'
- Extra topping ayam: boolean, hanya valid jika kategori = 'bakmie'
- Open price: integer, 1.000 ≤ price ≤ 999.999.999
- Catatan beans: string max 200 char

**Business Rules:**
- Harga final per item = harga base + (extra shot ? 8.000 : 0) + (extra topping ayam ? 10.000 : 0)
- Modifier "free" (sugar/ice level) tidak pengaruh harga
- Item di cart di-identifikasi dengan UUID (`cart_line_id`), bukan menu_item_id, karena bisa ada beberapa line item sama dengan modifier berbeda

**UI Acceptance Criteria:**
- Modal: slide up dari bawah di mobile, center modal di desktop
- Footer modal: harga total (dinamis) + tombol "Tambah ke Order" (primary)
- Modifier toggle: switch component, on state hijau
- Radio groups: tombol ber-tile, selected state border tebal

---

### 3.4 `FSD-POS-004` — Item-Level Notes

**Maps to PRD:** `P1-POS-004`

**Purpose:** Barista bisa catat request khusus per item.

**Trigger:** Staff tap icon "Catatan" (📝) di cart line item.

**Main Flow:**
1. Modal muncul dengan textarea + cart line item reference
2. Staff ketik note (max 200 char, counter ditampilkan)
3. Tap "Simpan"
4. Note tersimpan di cart line item state
5. Icon 📝 di cart line berubah jadi solid (menunjukkan ada note)

**Validation Rules:**
- Note: max 200 char
- Sanitize: no HTML, newlines diperbolehkan

**Business Rules:**
- Note akan tercetak di struk di bawah item bersangkutan
- Note tidak pengaruh harga atau logic

---

### 3.5 `FSD-POS-005` — Cart Management (Update Qty, Remove)

**Purpose:** Staff bisa adjust order sebelum bayar.

**Trigger:** Interaction dengan cart line items.

**Main Flow:**

**Tambah qty:**
1. Tap tombol "+" di cart line → qty increment by 1
2. Subtotal cart auto-update
3. Max qty: 99 (hard limit untuk safety)

**Kurang qty:**
1. Tap "−" di cart line → qty decrement by 1
2. Jika qty = 1 dan user tap "−" → toast konfirmasi "Hapus item?" YES/NO
3. Qty minimum 1, tidak bisa 0

**Remove item:**
1. Tap icon trash di cart line → konfirmasi "Hapus [nama item]?"
2. YES → item dihapus dari cart
3. Animation: slide out

**Alternate Flows:**
- **A1 (swipe to delete - mobile):** Swipe kiri di cart line → tombol "Hapus" muncul di kanan
- **A2 (clear cart):** Tombol "Kosongkan" di header cart → konfirmasi "Hapus semua item?" → cart kosong

**Business Rules:**
- Cart state di-persist di IndexedDB per-draft-order
- Maximum 50 unique items per order (soft limit, mostly untuk UX)

---

### 3.6 `FSD-POS-006` — Order Discount

**Maps to PRD:** `P1-POS-005`

**Purpose:** Apply diskon ke order sebelum bayar.

**Actor:** Owner, Manager native. Staff butuh PIN override.

**Main Flow:**
1. Tombol "Diskon" di footer cart
2. Jika Staff tap: PIN override flow (FSD-AUTH-003)
3. Modal diskon muncul:
   - Toggle "Persentase" / "Nominal" (default Persentase)
   - Input: 0-100 (jika %) atau 0-999.999.999 (jika nominal)
   - Dropdown "Alasan": `['Promo Staff', 'Kompensasi Customer', 'Free Gift', 'Lainnya']`
   - Textarea alasan detail jika pilih "Lainnya" (required min 3 char)
4. Preview: subtotal → diskon → total baru
5. Tap "Terapkan"
6. Diskon tersimpan di cart state, audit log pending (commit saat transaksi selesai)

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `DISCOUNT_INVALID_PERCENT` | Persen < 0 atau > 100 | "Persen harus 0-100" |
| `DISCOUNT_EXCEED_SUBTOTAL` | Diskon nominal > subtotal | "Diskon tidak boleh lebih dari subtotal" |
| `DISCOUNT_REASON_TOO_SHORT` | Lainnya dipilih, alasan < 3 char | "Isi alasan minimal 3 karakter" |

**Business Rules:**
- Hanya 1 diskon per order (tidak bisa combo persen + nominal)
- Diskon dihitung dari subtotal (total item), bukan dari setiap line item
- Hitungan: `total = subtotal - discount_amount` where `discount_amount = is_percent ? (subtotal * percent / 100) : fixed_amount`
- Hasil dibulatkan ke integer terdekat (banker's rounding)
- Diskon hanya di-commit ke server saat payment success, bersama transaksi

---

### 3.7 `FSD-POS-007` — Payment Processing

**Maps to PRD:** `P1-POS-006`

**Purpose:** Terima pembayaran dari customer.

**Trigger:** Staff tap "Bayar" setelah semua item di cart.

**Preconditions:**
- Cart tidak kosong
- Minimal 1 item valid
- Staff punya shift aktif

**Main Flow:**
1. Tap "Bayar" → screen transisi ke payment page (bukan modal, full screen untuk tablet)
2. Layout: kiri summary order, kanan metode pembayaran (3 tombol besar)
3. Summary order:
   - List item + modifier + note
   - Subtotal
   - Diskon (jika ada)
   - **Total** (bold, font besar)
4. Tombol metode pembayaran: "Tunai" / "QRIS (EDC BCA)" / "Kartu (EDC BCA)"

**Flow — Tunai:**
1. Tap "Tunai" → sub-screen input nominal diterima
2. Quick buttons: `[Pas (total)]`, `[50.000]`, `[100.000]`, `[200.000]` (nominal > total)
3. Atau input manual via numeric keypad
4. Display: "Diterima: Rp X | Kembalian: Rp Y" (Y = max(0, X - total))
5. Tap "Konfirmasi Pembayaran" (disabled jika X < total)
6. POST `/api/v1/transactions` dengan payload lengkap
7. On success: save transaction_id, trigger print struk (FSD-POS-008), navigate ke screen sukses

**Flow — QRIS (EDC BCA):**
1. Tap "QRIS (EDC BCA)" → sub-screen "Konfirmasi Pembayaran QRIS"
2. Instruksi: "Swipe/tap QRIS di EDC. Setelah sukses, tap konfirmasi."
3. Tombol besar "Sudah Lunas di EDC" (primary) + "Batal" (secondary)
4. Tap "Sudah Lunas" → POST `/api/v1/transactions` dengan method=qris
5. Print struk

**Flow — Kartu (EDC BCA):**
1. Sama dengan QRIS, hanya method=card_bca

**Success Screen (1.5 detik auto-redirect):**
- Icon checkmark hijau besar
- "Pembayaran Berhasil"
- Total: Rp XXX, Kembalian: Rp YY (jika tunai)
- Tombol "Order Baru" (primary)
- Status printing (spinner → "Struk tercetak" atau "Struk gagal, cetak ulang?")
- Auto-redirect ke POS home setelah 3 detik (kecuali ada error printing)

**Alternate Flows:**
- **A1 — Simpan sebagai Draft:** Tombol "Simpan Nanti" di payment screen → transaksi kembali ke list draft, tidak commit
- **A2 — Batal dari Payment:** Tombol back → konfirmasi "Batalkan pembayaran?" → balik ke cart

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `PAYMENT_CASH_INSUFFICIENT` | Nominal diterima < total | Disable submit, "Nominal kurang Rp X" |
| `PAYMENT_INVALID_AMOUNT` | Nominal 0 atau negatif | "Nominal harus > 0" |
| `TRANSACTION_CREATE_FAILED` | API error saat POST | Toast merah "Gagal simpan transaksi. Coba lagi." + retry button. Transaksi tersimpan di IndexedDB untuk retry |
| `TRANSACTION_NETWORK_OFFLINE` | Offline | Banner "Offline. Transaksi disimpan lokal." + tetap lanjut ke print struk |

**Validation Rules:**
- Jika tunai: `cash_received ≥ total_amount`
- Method: enum `['cash', 'qris', 'card_bca']`

**Business Rules:**
- Transaksi ter-assign ke shift yang aktif saat payment
- Transaction number auto-generate: `TRX-YYYYMMDD-NNNN` (NNNN = sequence per hari, 4 digit)
- Jika offline: transaksi di IndexedDB dengan flag `sync_pending = true`, akan sync saat online
- Saat sync: jika server menolak (misal menu sudah ter-delete), tandai `sync_failed` dan notify Manager/Owner
- Cash change = `cash_received - total_amount`
- Total wajib dihitung di server ulang (security), client value hanya untuk preview

---

### 3.8 `FSD-POS-008` — Thermal Printer Integration

**Maps to PRD:** `P1-POS-007`

**Purpose:** Cetak struk fisik untuk customer.

**Trigger:** Otomatis setelah payment success, atau manual via "Cetak Ulang".

**Main Flow:**
1. Client side: setelah payment success, cek koneksi Bluetooth printer
2. Jika belum pair: redirect ke pairing screen (FSD-SETTING-002)
3. Jika pair: kirim ESC/POS command buffer ke printer
4. Show loading: "Mencetak..."
5. On success: toast "Struk tercetak" (dismissable 2 detik)
6. On fail: modal "Printer error: [reason]" + tombol "Coba Lagi" / "Lewati"

**Struk Layout (58mm, ~32 char per line untuk font normal):**

```
          [LOGO]
       MAHAKAN COFFEE
     Jl. [TBD-OWNER]
     Telp: [TBD-OWNER]
--------------------------------
ORDER: TRX-20260420-0012
Pager: 5  |  Takeaway
Kasir: Rina
20/04/2026  14:32
--------------------------------
1x Americano Iced         16.000
   Sugar: Less
   Catatan: "extra hot"
1x Croffle Ice Cream      21.000
2x V60 - Ethiopia          70.000
   Catatan: "Ethiopia Yirgacheffe"
--------------------------------
Subtotal              107.000
Diskon (10%)          -10.700
--------------------------------
TOTAL                  96.300
--------------------------------
Tunai                 100.000
Kembalian               3.700
--------------------------------
  Terima kasih, sampai jumpa!
         [QR RATING - opsional]
```

**Implementation Detail:**
- Web Bluetooth API: `navigator.bluetooth.requestDevice(...)` (user gesture required)
- Filter by service UUID (ESC/POS printer standard): `000018f0-0000-1000-8000-00805f9b34fb` (Generic Serial)
- Write chunks max 512 bytes per GATT characteristic write
- ESC/POS commands:
  - `\x1B\x40` — initialize
  - `\x1B\x61\x01` — center alignment
  - `\x1B\x21\x30` — double height+width (for header)
  - `\x0A` — newline
  - `\x1D\x56\x42\x00` — cut paper
- Text encoding: CP437 (default) atau CP850 (Indonesia-friendly)
- Jika gagal encode karakter spesial (é, ñ), fallback ke ASCII

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `PRINTER_NOT_PAIRED` | User belum pair printer | Modal "Printer belum dihubungkan. Pair sekarang?" |
| `PRINTER_CONNECTION_LOST` | Bluetooth terputus | Modal "Koneksi printer terputus. Reconnect?" |
| `PRINTER_OUT_OF_PAPER` | Detect via status bit | "Printer kehabisan kertas" |
| `PRINTER_TIMEOUT` | > 10 detik tidak respons | "Printer tidak merespons. Coba lagi." |
| `PRINTER_UNSUPPORTED_BROWSER` | Safari atau browser tanpa Web Bluetooth | Modal "Browser tidak support printer. Gunakan Chrome/Edge." |

**Business Rules:**
- Jika printer error: transaksi tetap tersimpan di server. Print bisa di-retry dari riwayat.
- Limit retry otomatis: 2x. Setelah itu manual retry required.
- Cetak ulang struk: pakai data transaksi dari server (bukan generate ulang di client), untuk memastikan konsistensi.

**UI Acceptance Criteria:**
- Printing toast: non-blocking, auto-dismiss
- Printer error modal: full attention, blocks other actions sampai dismissed
- Settings → Printer: status indicator (connected/disconnected) dengan dot berwarna

---

### 3.9 `FSD-POS-009` — Void Transaction

**Maps to PRD:** `P1-POS-009`

**Purpose:** Batalkan transaksi yang sudah di-save (error, customer batal).

**Actor:** Owner, Manager. Staff butuh PIN override.

**Preconditions:**
- Transaksi `status = 'paid'`
- Transaksi dibuat di shift yang sama (same-day only untuk Phase 1)

**Main Flow:**
1. Di riwayat transaksi, tap transaksi → detail view
2. Tombol "Void" (hanya muncul jika transaksi = same shift, status = paid)
3. Tap → jika Staff: PIN override flow
4. Modal konfirmasi:
   - Header: "Void Transaksi TRX-YYYYMMDD-NNNN"
   - Summary: total Rp XXX, item count
   - Dropdown alasan: `['Customer Batal', 'Salah Input', 'Sistem Error', 'Lainnya']`
   - Textarea detail (required jika "Lainnya")
   - Input konfirmasi: ketik "VOID" untuk proceed
5. Tap "Konfirmasi Void"
6. POST `/api/v1/transactions/{id}/void` dengan reason + approver_token (jika Staff)
7. Server: update `status = 'voided'`, simpan reason, set `voided_at`, `voided_by`, `voided_approver`
8. Kas otomatis disesuaikan di shift (jika cash payment): cash expected balance dikurangi total
9. Audit log: `transaction.voided`
10. Screen: banner sukses "Transaksi dibatalkan", refresh riwayat

**Error Cases:**

| Kode | Kondisi | UI Response |
|---|---|---|
| `VOID_NOT_ALLOWED_DIFFERENT_SHIFT` | Transaksi dari shift lain/kemarin | "Void hanya untuk transaksi di shift aktif" |
| `VOID_ALREADY_VOIDED` | Transaksi sudah voided | "Transaksi ini sudah dibatalkan" |
| `VOID_CONFIRMATION_TEXT_MISMATCH` | User tidak ketik "VOID" | Disable submit |
| `VOID_REASON_REQUIRED` | Alasan kosong | Inline error |

**Business Rules:**
- Void = soft delete (`status = 'voided'`), data asli tetap ada untuk audit
- Transaksi voided **tidak** masuk ke total penjualan, tapi muncul di laporan dengan label "voided"
- Jika payment cash: shift expected cash dikurangi total (karena uang dikembalikan)
- Jika payment QRIS/card: no kas adjustment, tapi total penjualan by method dikurangi
- Void tidak trigger refund otomatis ke customer (itu tanggung jawab kasir menyerahkan kembalian fisik)

---

### 3.10 `FSD-POS-010` — Refund (Cash-Only, Same-Day)

**Maps to PRD:** `P1-POS-010`

**Purpose:** Kembalikan uang ke customer untuk transaksi yang sudah selesai.

**Actor:** Owner, Manager. Staff butuh PIN override.

**Preconditions:**
- Transaksi status = paid
- Payment method = cash
- Dibuat di shift yang sama (same-day)

**Main Flow:**
1. Di detail transaksi, tombol "Refund" (hanya muncul jika kondisi terpenuhi)
2. Tap → PIN override jika Staff
3. Modal:
   - Radio: "Refund Penuh" / "Refund Sebagian" (Phase 1: hanya refund penuh, partial di Phase 2)
   - Input alasan (required)
   - Input konfirmasi: ketik "REFUND"
4. Tap "Proses Refund"
5. POST `/api/v1/transactions/{id}/refund`
6. Server: update `status = 'refunded'`, buat entri baru di expense dengan kategori "Refund" (auto-categorized)
7. Audit log: `transaction.refunded`

**Business Rules:**
- Refund = soft marker, transaksi asli tetap terlihat
- Expense otomatis ter-generate: amount = total transaction, category = "Refund", reference ke transaction_id
- Kas fisik di laci dikurangi sebesar total
- Refund **tidak bisa** di-undo (pikir matang-matang sebelum)

---

### 3.11 `FSD-POS-011` — Mark Sold Out

**Maps to PRD:** `P1-POS-011`

**Main Flow:**

**Mark sold-out (all roles):**
1. Long-press tile menu → context menu "Mark Sold Out"
2. Tap → optimistic UI: tile grayed out + badge "Habis"
3. PATCH `/api/v1/menu/items/{id}` dengan `{ is_sold_out: true }`
4. Real-time broadcast ke semua device online (via SSE channel `menu.updates`)
5. Jika API fail: rollback UI + toast error

**Mark available (Owner/Manager only):**
1. Long-press tile sold-out → context menu "Mark Available"
2. Staff: tidak punya opsi ini (menu disembunyikan)

**Business Rules:**
- Sold-out tersimpan di field `menu_items.is_sold_out` (boolean)
- Broadcast via SSE ke channel outlet-wide
- Jika client offline: state lokal saja, sync saat online. Risiko: staff lain buat order pakai item yang sebenarnya sudah habis. Mitigasi: server validate saat create transaction (reject jika sold-out).

---

### 3.12 `FSD-POS-012` — Order Queue & History

**Maps to PRD:** `P1-POS-012`

**Purpose:** Staff lihat daftar order yang perlu disiapkan + riwayat hari ini.

**Main Flow:**

**Order Aktif (Paid, Belum Selesai):**
1. Tab "Order Aktif" di sidebar POS
2. List transaksi status = `paid`, `served_at IS NULL`
3. Urutan: oldest first
4. Setiap kartu: pager, items ringkas, waktu bayar, tombol "Selesai"
5. Tap "Selesai" → `served_at = now()`, item hilang dari list aktif

**Riwayat Hari Ini:**
1. Tab "Riwayat"
2. List semua transaksi hari ini (paid, voided, refunded)
3. Filter: semua / paid / voided / refunded
4. Search by nomor TRX atau pager
5. Tap → detail view

**Business Rules:**
- `served_at` optional, hanya tracking internal, tidak ter-print di struk
- Order aktif hanya untuk hari ini (untuk simplicity Phase 1)

---

### 3.13 `FSD-POS-013` — Multi-Order Hold (Draft Orders)

**Maps to PRD:** `P1-POS-013`

**Purpose:** Support multiple customer secara bersamaan.

**Main Flow:**
1. Staff buat order pager 3 → add items → belum bayar
2. Customer lain datang, Staff tap "Order Baru" → pager 5 → draft baru
3. Sidebar "Draft Orders" muncul dengan list: `[Pager 3 - 3 items] [Pager 5 - 1 item]`
4. Staff tap "Pager 3" untuk switch, state cart restore dari draft 3
5. Selesaikan pager 3 → bayar → draft removed
6. Switch ke pager 5, lanjutkan

**Business Rules:**
- Max 10 concurrent drafts (soft limit)
- Drafts tersimpan di IndexedDB, keyed by user_id + session + pager
- Draft expire setelah 4 jam idle (auto-clear untuk mencegah akumulasi)
- Switch antar draft: smooth, no API call, pure client state

---

### 3.14 `FSD-POS-014` — Offline Resilience

**Maps to PRD:** `P1-POS-014`

**Purpose:** POS tetap berfungsi saat internet flaky.

**Connection States:**

| State | Indicator | Behavior |
|---|---|---|
| `online` | Dot hijau di top bar | Normal, real-time sync |
| `degraded` | Dot kuning "Internet lambat" | Operasional normal, tapi UI show warning |
| `offline` | Dot merah + banner "Offline Mode" | Transaksi tersimpan lokal, sync pending |

**Detection:**
- `navigator.onLine` event listener
- Ping `/api/health` setiap 30 detik
- Jika ping fail 2x berturut: state → offline
- Jika ping sukses setelah offline: state → online + trigger sync

**Offline Behavior:**
- **Bisa:** Buat order, add items, apply modifier, proses payment, print struk, clock in/out shift
- **Tidak bisa:** Fetch menu baru (pakai cache), lihat real-time sold-out dari device lain, void transaksi orang lain, user management
- **Tersimpan lokal:** transaksi, shift events, expense entries, audit log
- **Tidak tersimpan lokal:** menu CRUD, user CRUD, settings change

**Sync Process (saat online kembali):**
1. Fetch pending queue dari IndexedDB
2. Iterate dalam urutan: shift events → transactions → expenses → audit log
3. POST setiap item ke API
4. Sukses → tandai `synced_at`
5. Gagal (conflict, validation) → tandai `sync_failed`, notify user
6. Sync selesai → toast "Sinkronisasi selesai. X transaksi ter-sync."

**Conflict Resolution:**
- **Menu item sold-out race:** Server validate. Jika transaksi offline pakai item yang sold-out di server, tetap accept (diasumsikan item fisik masih ada saat transaksi offline).
- **Shift sudah ditutup di device lain:** Sangat jarang karena 1 staff per shift. Jika terjadi: user diprompt manual reconcile.
- **Duplicate transaction number:** Client generate temporary `client_ref_id` (UUID), server yang assign `TRX-YYYY-NNNN` final.

**UI Acceptance Criteria:**
- Banner offline: fixed top, merah, "Offline Mode. X transaksi menunggu sync."
- Indicator: dot warna + label singkat di top bar
- Toast saat sync: progress bar (misal "3/5 transaksi ter-sync")

---

## 4. Menu Management

### 4.1 `FSD-MENU-001` — Menu Item CRUD

**Maps to PRD:** `P1-MENU-001`

**Actor:** Owner, Manager.

**Create Flow:**
1. Dashboard menu → tombol "Tambah Item"
2. Form:
   - Nama (required, max 80 char)
   - Kategori (required, dropdown dari existing)
   - Deskripsi (optional, max 300 char)
   - Harga type: [Fixed / Variant Hot-Iced / Open Price]
   - Jika Fixed: single price input
   - Jika Variant: dua input (Hot price, Iced price), each nullable tapi minimal salah satu
   - Jika Open Price: no price input
   - Toggle "Signature" (untuk ♥ icon)
   - Toggle "Active" (default on)
   - Modifier assignment: auto-checked sesuai kategori (e.g. coffee-based → extra shot)
   - Display order: integer (auto-suggest next available)
3. Submit → POST `/api/v1/menu/items`
4. Server validate + save + broadcast sold-out channel
5. Redirect ke list

**Update Flow:**
1. Tap item → detail view
2. Tombol "Edit" → form pre-filled
3. Submit → PATCH `/api/v1/menu/items/{id}`
4. Audit log: `menu.item.updated` dengan diff (before/after)
5. Broadcast perubahan ke POS devices

**Delete Flow (Soft):**
1. Tap "Hapus" di detail item
2. Konfirmasi "Hapus [nama item]? Item akan hilang dari POS. Transaksi historis tidak terpengaruh."
3. DELETE `/api/v1/menu/items/{id}` → set `deleted_at = now()`
4. Audit log: `menu.item.deleted`

**Error Cases:**

| Kode | Kondisi | Response |
|---|---|---|
| `MENU_NAME_DUPLICATE` | Nama item sudah ada di kategori yang sama | "Nama item sudah dipakai di kategori ini" |
| `MENU_NO_PRICE` | Variant mode tapi tidak ada harga | "Minimal salah satu harga (Hot/Iced) harus diisi" |
| `MENU_INVALID_PRICE` | Harga < 1 atau > 999.999.999 | "Harga harus 1 - 999.999.999" |
| `MENU_DELETE_CONSTRAINT` | (Phase 2+) Item dipakai di recipe aktif | Tidak berlaku di Phase 1 |

**Business Rules:**
- Soft delete: item tidak muncul di POS tapi tetap ada di DB untuk join dengan historical transactions
- Harga berubah: audit log + broadcast ke POS
- Tidak ada versioning harga di Phase 1 (bisa ditambah Phase 2)

---

### 4.2 `FSD-MENU-002` — Category CRUD

**Main Flow:**
1. List kategori di /menu/categories
2. Kolom: Nama, Jumlah Item, Display Order, Status Active, Actions
3. Tambah: modal simple (nama + display order)
4. Edit: inline atau modal
5. Delete: hanya jika `item_count = 0`, confirmation "Hapus kategori?"
6. Drag handle untuk reorder (affects POS display order)

**Validation:**
- Nama: required, max 50 char, unique
- Display order: integer, auto-suggest max + 1

---

### 4.3 `FSD-MENU-003` — Modifier Management

**Phase 1 Scope:**
- Sugar level, ice level: hard-coded, tidak bisa diubah
- Extra shot: bisa edit **harga saja** (default Rp 8.000)
- Extra topping ayam: bisa edit **harga saja** (default Rp 10.000)

**Main Flow:**
1. Halaman `/menu/modifiers`
2. List 4 modifier dengan info assignment
3. Tap "Edit" di Extra Shot → modal input harga baru
4. PATCH `/api/v1/modifiers/{slug}` dengan `{ price: newPrice }`
5. Broadcast ke POS (harga future orders pakai baru)

**Business Rules:**
- Perubahan harga tidak retroactive ke transaksi sebelumnya
- Modifier bisa di-deactivate (flag `is_active`), tapi historical transactions tetap ter-render

---

### 4.4 `FSD-MENU-004` — Bulk Actions

**Main Flow:**
1. Di list menu, checkbox multi-select
2. Action bar muncul saat ≥ 1 selected: `[Mark Sold Out] [Mark Available] [Adjust Price] [Export CSV]`
3. Adjust Price: modal input "% change" (-20% to +50%), preview sebelum apply
4. Export CSV: Owner only, download file `menu_YYYYMMDD.csv`

**Business Rules:**
- Bulk adjust price: audit log per-item (individual events, bukan satu bulk event)
- CSV format: id, nama, kategori, harga_hot, harga_iced, harga_fixed, is_signature, is_active

---

## 5. Shift Management

### 5.1 `FSD-SHIFT-001` — Open Shift

**Maps to PRD:** `P1-SHIFT-001`

**Main Flow:**
1. Staff login → dashboard POS
2. Jika belum ada shift aktif: banner "Buka shift untuk mulai transaksi" + CTA
3. Tap "Buka Shift"
4. Modal:
   - Input kas awal (numeric, required)
   - Quick buttons: Rp 0, 50.000, 100.000, 200.000, 500.000
   - Optional: catatan pembukaan
5. Tap "Mulai Shift"
6. POST `/api/v1/shifts` dengan `{ opening_cash }`
7. Server: create shift record, status = `open`, link user_id, timestamp
8. Dashboard update: banner "Shift aktif sejak [waktu]"

**Validation:**
- Opening cash: integer ≥ 0
- Hanya 1 shift aktif per user

**Error Cases:**

| Kode | Kondisi | Response |
|---|---|---|
| `SHIFT_ALREADY_OPEN` | User sudah punya shift aktif | "Anda sudah punya shift aktif. Tutup dulu." |
| `SHIFT_OUTLET_CLOSED` | (Phase 2+) Outlet force-closed oleh owner | N/A Phase 1 |

---

### 5.2 `FSD-SHIFT-002` — Close Shift

**Maps to PRD:** `P1-SHIFT-002`

**Main Flow:**
1. Staff tap "Tutup Shift" di dashboard
2. System fetch shift summary (aggregate dari transaksi)
3. Modal summary:
   ```
   Shift: 08:00 - (sekarang)
   Jumlah Transaksi: 67
   
   Pemasukan:
   - Tunai: Rp 1.150.000 (23 trx)
   - QRIS: Rp 1.200.000 (32 trx)
   - Kartu: Rp 500.000 (12 trx)
   Total Penjualan: Rp 2.850.000
   
   Void & Refund:
   - Void: 2 (Rp 50.000)
   - Refund: 1 (Rp 25.000)
   
   Kas Expected:
   Kas Awal (Rp 100.000) + Tunai (Rp 1.150.000) - Refund Tunai (Rp 25.000)
   = Rp 1.225.000
   ```
4. Input "Kas Aktual" (staff hitung fisik)
5. Selisih auto-calculate: `actual - expected`. Kalau minus warna merah, surplus warna kuning
6. Textarea catatan (opsional)
7. Tap "Konfirmasi Tutup Shift"
8. POST `/api/v1/shifts/{id}/close` dengan `{ actual_cash, note }`
9. Server: set `status = closed`, `closed_at`, `actual_cash`, `variance`, `note`
10. Tampil receipt shift (bisa di-print), navigate ke logout screen

**Validation:**
- Actual cash: integer ≥ 0

**Business Rules:**
- Expected cash formula: `opening_cash + sum(cash_payments.paid) - sum(cash_refunds.refunded)`
- Variance: `actual - expected` (positive = surplus, negative = shortage)
- Flag di shift report jika |variance| > threshold (`[TBD-OWNER]` default Rp 10.000)
- Setelah close: tidak bisa create transaksi di shift tersebut
- Shift tidak bisa di-reopen (sekali close, selesai)

---

### 5.3 `FSD-SHIFT-003` — Shift History

**Main Flow:**
- Owner/Manager akses `/shifts` → list semua shift
- Filter: tanggal, staff, flag variance
- Kolom: Staff, Start, End, Durasi, Transaksi, Total Revenue, Variance (colored)
- Tap row → detail shift (full breakdown, list transaksi)

**Staff view:**
- `/pos/my-shifts` → hanya shift miliknya
- Same layout, read-only

---

## 6. Cash & Expense Management

### 6.1 `FSD-CASH-001` — Expense Logging

**Maps to PRD:** `P1-CASH-001`

**Main Flow:**
1. Back office `/expenses` → tombol "Tambah Pengeluaran"
2. Form:
   - Tanggal (default today, date picker)
   - Kategori (required, dropdown, default list di PRD 4.4)
   - Deskripsi (required, max 200 char)
   - Nominal (required, integer > 0)
   - Metode Pembayaran (required, enum `[cash, transfer, other]`)
   - Upload bukti (optional, image max 2MB, jpeg/png)
3. Submit → POST `/api/v1/expenses`
4. Server validate + save + audit log

**Edit Flow:**
- Owner/Manager edit dalam 24 jam setelah create
- Setelah 24 jam: read-only, kecuali Owner

**Delete Flow:**
- Owner only
- Konfirmasi "Hapus pengeluaran ini? Tindakan ini tercatat di audit log."
- Soft delete (set `deleted_at`)

**Validation:**
- Tanggal: tidak lebih dari 30 hari ke belakang (kecuali Owner)
- Nominal: integer 1 - 999.999.999
- Image: max 2MB, format jpeg/png/webp

**Business Rules:**
- Bukti upload disimpan di Vercel Blob atau alternatif object storage (Phase 1 bisa skip kalau Vercel Blob free tier cukup)
- Kategori kustom: Owner bisa tambah kategori di settings
- Expense dari refund: auto-generated, kategori "Refund", non-editable

---

### 6.2 `FSD-CASH-002` — Income Logging (Non-POS)

**Main Flow:**
1. `/income/manual` → tombol "Tambah Pemasukan"
2. Form:
   - Tanggal
   - Deskripsi (required)
   - Nominal (required)
   - Metode Pembayaran
3. Submit → POST `/api/v1/incomes`

**Use Case:** Sewa ruang event, titip jual, pemasukan non-retail.

---

### 6.3 `FSD-CASH-003` — Daily Cash Summary

**Main Flow:**
1. `/reports/daily-cash?date=YYYY-MM-DD`
2. Server aggregate:
   ```
   Pemasukan:
   - POS Tunai: Rp X
   - POS QRIS: Rp Y
   - POS Kartu: Rp Z
   - Manual Income: Rp A
   Total Pemasukan: Rp SUM
   
   Pengeluaran (by kategori):
   - Belanja Bahan Baku: Rp B
   - ... dst
   Total Pengeluaran: Rp SUM2
   
   Selisih Kas Fisik (dari shift):
   - Total Variance: Rp V
   ```
3. Display table + chart pie breakdown expense

---

## 7. Reports

### 7.1 `FSD-REPORT-001` — Daily Sales Report

**Main Flow:**
1. `/reports/sales/daily?date=YYYY-MM-DD`
2. Server response:
   - Total revenue (paid only, exclude voided/refunded)
   - Transaction count
   - Average ticket size = revenue / count
   - Revenue by payment method (cash/qris/card) — stacked bar
   - Revenue by category — pie chart
   - Top 10 items by qty — horizontal bar
   - Hourly distribution — line chart (00-23 jam)
   - List voided (count + amount)
   - List refunded (count + amount)
3. Filter: date picker, compare dengan tanggal lain
4. Export: tombol "Export PDF" (Owner only)

**Performance Requirement:**
- Load time < 3 detik untuk 1 hari data (< 500 transaksi)
- Aggregation done server-side with indexed columns

---

### 7.2 `FSD-REPORT-002` — Weekly & Monthly Reports

- Same pattern as daily, but aggregate by week/month
- Compare vs previous period
- Day-level drill-down

---

### 7.3 `FSD-REPORT-003` — Item Performance

**Main Flow:**
1. `/reports/items?from=X&to=Y`
2. Table columns:
   - Item name
   - Category
   - Qty sold
   - Revenue
   - Average price
   - % of total revenue
3. Sortable by any column
4. Color badge:
   - Top 20% by revenue: "Best Seller" (green)
   - Bottom 20%: "Slow Mover" (gray)
5. Filter by category

---

### 7.4 `FSD-REPORT-004` — Simple P&L

**Owner only.**

**Main Flow:**
1. `/reports/pnl?from=X&to=Y`
2. Layout:
   ```
   Periode: 01/04/2026 - 30/04/2026
   
   PEMASUKAN
   Total Revenue POS:          Rp 85.000.000
   Income Manual:              Rp  2.000.000
   ─────────────────────────────────
   Total Pemasukan:            Rp 87.000.000
   
   PENGELUARAN
   Belanja Bahan Baku:         Rp 25.000.000
   Gaji Harian:                Rp 15.000.000
   Listrik & Air:              Rp  2.500.000
   Sewa:                       Rp 10.000.000
   Perawatan Alat:             Rp  1.000.000
   Kemasan:                    Rp  2.000.000
   Marketing:                  Rp    500.000
   Lain-lain:                  Rp  1.000.000
   Refund:                     Rp    250.000
   ─────────────────────────────────
   Total Pengeluaran:          Rp 57.250.000
   
   ═════════════════════════════════
   LABA KOTOR:                 Rp 29.750.000
   ═════════════════════════════════
   ```
3. Export PDF dengan header Mahakan

**Important Caveat:**
- Display prominent disclaimer: "Ini bukan laporan akuntansi resmi. Laporan ini hanya summary arus kas sederhana."

---

### 7.5 `FSD-REPORT-005` — Shift Report

**Main Flow:**
- Same as Shift History (FSD-SHIFT-003) tapi dengan aggregate metrics
- Flag shift variance > threshold dengan icon warning
- Drill-down ke detail shift

---

## 8. User Management

### 8.1 `FSD-USER-001` — User CRUD

**Actor Matrix:**
| Action | Owner | Manager |
|---|---|---|
| List users | ✅ | ✅ (tidak lihat Owner) |
| Create Staff | ✅ | ✅ |
| Create Manager | ✅ | ❌ |
| Create Owner | ✅ | ❌ |
| Edit Staff | ✅ | ✅ |
| Edit Manager | ✅ | ❌ |
| Deactivate | ✅ | ✅ (Staff only) |

**Create Flow:**
1. `/users/new`
2. Form:
   - Nama (required)
   - Role (dropdown: Staff / Manager / Owner — Manager hanya lihat Staff)
   - Jika Manager/Owner: Email + Password (required)
   - Jika Staff: PIN 4-6 digit (required)
   - Status: Active (default)
3. Submit → POST `/api/v1/users`
4. Server: hash password/pin, save, audit log

**Edit Flow:**
1. Detail user → tombol "Edit"
2. Tidak bisa ubah role via edit (butuh flow "Change Role" separate, Owner only)
3. Nama, email, status bisa diubah
4. Tombol "Reset Password/PIN" terpisah

**Validation:**
- Nama: required, 2-100 char
- Email: valid format, unique, required untuk Manager/Owner
- Password: min 8 char, 1 huruf + 1 angka
- PIN: 4-6 digit numeric, unique (untuk avoid ambiguity di staff selection screen — atau allow duplicate PIN tapi pair dengan user_id)

**Business Rules:**
- Tidak bisa delete user (hanya deactivate) — untuk preserve referential integrity dengan historical data
- Minimal 1 Owner aktif selalu ada (tidak bisa deactivate last Owner)

---

### 8.2 `FSD-USER-002` — PIN Reset

**Main Flow:**
1. Di detail user → tombol "Reset PIN"
2. Modal:
   - Input PIN baru (4-6 digit)
   - Konfirmasi PIN
3. Submit → PATCH `/api/v1/users/{id}/pin`
4. Audit log: `user.pin_reset` (PIN value TIDAK di-log, hanya event)

---

## 9. System Settings

### 9.1 `FSD-SETTING-001` — Business Info

**Owner only.**

**Form fields:**
- Nama bisnis (default "Mahakan Coffee & Space")
- Alamat (textarea)
- Nomor telepon
- Logo upload (image, square, max 1MB, displayed at 80x80 di struk setelah binarize)

**Business Rules:**
- Logo di-resize server-side ke 200x200 untuk struk printing (binarized untuk thermal)
- Changes broadcast ke POS untuk header struk update

---

### 9.2 `FSD-SETTING-002` — Printer Configuration

**Main Flow:**
1. Settings → Printer
2. Status card: "Connected to [device name]" atau "Not paired"
3. Tombol "Pair Printer":
   - Memicu `navigator.bluetooth.requestDevice()` dengan filter service UUID
   - User pilih printer dari native Bluetooth dialog
   - Setelah sukses: connect GATT, save device ID ke localStorage
4. Tombol "Test Print": kirim test struk (Mahakan header + "Test Print Berhasil")
5. Toggle "Auto-print saat transaksi selesai" (default on)
6. Paper width: 58mm (locked, 80mm di Phase 2)

**Error Handling:**
- Browser tidak support Web Bluetooth: warning "Gunakan Chrome atau Edge"
- User cancel dialog: no error, silent

---

### 9.3 `FSD-SETTING-003` — Operational Hours

**Owner only.**

**Form:**
- Per hari (Sen-Min): open time + close time (atau "Tutup")
- 24-hour format

**Business Rules:**
- Phase 1: hanya display di struk/dashboard, tidak enforce restriction
- Phase 2+: bisa dijadikan auto-toggle POS availability

---

## 10. State Transition Diagrams

### 10.1 Transaction State

```
[DRAFT (client-only)]
        |
        | payment confirmed
        v
    [ PAID ]
    /       \
   /         \
  | void     | refund
  v           v
[VOIDED]  [REFUNDED]
  |
  | (terminal state)
  v
  X
```

- DRAFT: hanya di client state, tidak di DB
- PAID → VOIDED: possible jika same-shift
- PAID → REFUNDED: possible jika same-day, cash-only
- VOIDED, REFUNDED: terminal states, tidak bisa berubah lagi

### 10.2 Shift State

```
[OPEN]
  |
  | close
  v
[CLOSED] (terminal)
```

### 10.3 Menu Item State

```
[ACTIVE]  <--toggle-->  [INACTIVE]
   |
   | soft delete
   v
[DELETED] (terminal for UI, data kept)
```

Orthogonal flag:
- `is_sold_out`: true/false (toggleable any time)

---

## 11. Business Rules Summary (Critical)

Konsolidasi semua business rules penting agar AI coding assistant gampang reference:

### Money

1. **Semua amount disimpan sebagai integer** (satuan rupiah, no decimal, no cents)
2. Kalkulasi diskon: `discount_amount = is_percent ? Math.round(subtotal * percent / 100) : fixed_amount`
3. Kalkulasi total: `total = subtotal - discount_amount`
4. Cash change: `change = cash_received - total`; jika negative → validation error
5. Rounding: banker's rounding (round half to even) untuk persen calculation

### Authorization

6. **Setiap endpoint wajib check role** di server middleware (jangan trust client)
7. PIN override token: 5 menit expiry, single-use, scoped to action
8. Session: 12 jam POS, 2 jam back office
9. Audit log untuk semua action sensitive (lihat Section 1.5)

### Transaction Integrity

10. Transaction number: `TRX-YYYYMMDD-NNNN`, generated oleh server (bukan client)
11. Void = soft delete, data asli preserved
12. Refund = soft delete + auto-generate expense entry
13. Void/Refund: same-shift/same-day only di Phase 1
14. Offline transaction: queue di IndexedDB, sync saat online, server reconcile

### Menu

15. Menu item: soft delete (set `deleted_at`), tidak hard delete
16. Sold-out: broadcast real-time via SSE ke semua device online
17. Harga change: audit log dengan before/after
18. Harga modifier (extra shot, extra topping): configurable per-setting
19. Open-price item (manual brew): harga wajib input ≥ Rp 1.000

### Shift

20. 1 shift aktif per user max
21. Transaksi wajib ter-link ke shift aktif
22. Close shift: final, tidak bisa reopen
23. Variance formula: `actual_cash - (opening + cash_in - cash_out)`

### Data Retention

24. Soft-deleted data: kept indefinitely di Phase 1 (Phase 2+ bisa archive)
25. Audit log: immutable, no delete ever

---

## 12. Validation Rule Reference Table

| Entity | Field | Rule |
|---|---|---|
| User | email | RFC 5322, unique, max 255 |
| User | password | min 8, 1 letter + 1 digit |
| User | pin | 4-6 digits numeric |
| User | name | 2-100 char |
| MenuItem | name | 1-80 char, unique per category |
| MenuItem | description | max 300 char |
| MenuItem | price_* | integer, 1 - 999.999.999 |
| Category | name | 1-50 char, unique |
| Order | pager_number | integer 1-99 |
| Order | note (per item) | max 200 char |
| Order | discount_percent | integer 0-100 |
| Order | discount_amount | integer, 0 ≤ x ≤ subtotal |
| Order | cash_received | integer ≥ 0 (and ≥ total if cash payment) |
| Expense | amount | integer 1 - 999.999.999 |
| Expense | description | 1-200 char |
| Expense | image | max 2MB, jpeg/png/webp |
| Shift | opening_cash | integer ≥ 0 |
| Shift | actual_cash | integer ≥ 0 |
| Shift | note | max 500 char |

---

## 13. Accessibility & Keyboard Shortcuts

### 13.1 POS (Tablet Priority)

| Shortcut | Action |
|---|---|
| Tap & hold | Long-press menu (e.g., sold-out toggle) |
| Swipe left on cart item | Delete |
| Double-tap | Edit item in cart |

### 13.2 Back Office (Desktop)

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Quick search |
| `Ctrl+N` | New (context-dependent: menu item, expense, user) |
| `Esc` | Close modal |
| `/` | Focus search |

### 13.3 Accessibility

- Minimum tap target: 44×44px
- Contrast ratio: WCAG AA (4.5:1 for text)
- Focus indicator: visible 2px outline
- All actions keyboard accessible in back office
- POS primarily touch, keyboard support optional

---

## 14. FSD Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial FSD based on PRD v1.0 |

---

# 🛑 END OF FSD v1.0

**Status:** ✅ APPROVED
**Next Step:** Proceed to TSD (Technical Specification Document)
