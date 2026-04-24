# 📄 PRD — Mahakan Coffee & Space POS/ERP System

**Product Requirements Document**
**Version:** 1.0 — Phase 1 MVP
**Date:** April 2026
**Status:** ✅ APPROVED

---

## 1. Executive Summary

### 1.1 Product Vision

Membangun sistem POS + operasional management internal untuk **Mahakan Coffee & Space** yang **menggantikan subscription POS berbayar (Majoo)** dengan sistem milik sendiri. Sistem harus **ready untuk jualan hari ke-1 setelah launch**, dengan arsitektur yang **mudah di-extend** ke modul accounting, payroll, dan CRM di fase berikutnya.

### 1.2 Problem Statement

| Problem | Current State | Desired State |
|---|---|---|
| Biaya subscription POS bulanan | Bayar Majoo tiap bulan, biaya terus naik | Sistem sendiri, gratis selamanya |
| Vendor lock-in | Data tersandera di sistem pihak ketiga | Data 100% milik Mahakan |
| Fitur tidak bisa kustomisasi | Harus ikut fitur vendor | Bebas tambah fitur sesuai kebutuhan |
| Laporan tidak sesuai kebutuhan | Laporan generik | Laporan dirancang untuk workflow Mahakan |

### 1.3 Success Criteria (Phase 1)

| Kriteria | Target | Cara Ukur |
|---|---|---|
| Kafe bisa beroperasi penuh tanpa Majoo | 100% | Semua transaksi hari kerja masuk ke sistem baru |
| Waktu rata-rata per transaksi | ≤ 45 detik (pesan → bayar → cetak struk) | Stopwatch manual, minggu pertama |
| Downtime sistem di jam operasional | 0% | Monitoring uptime Vercel |
| Total biaya operasional bulanan | Rp 0 | Vercel free tier + Neon free tier |
| Laporan harian akurat | 100% match dengan hitungan manual | Cross-check 7 hari pertama |

### 1.4 Non-Goals (Phase 1 — eksplisit TIDAK dibangun)

- ❌ Full double-entry accounting (COA, journal, trial balance, balance sheet)
- ❌ Payroll & HR system
- ❌ Inventory recipe/BOM dengan auto-deduct bahan baku
- ❌ Multi-outlet support (arsitektur siap, implementasi tidak)
- ❌ Offline-first sync engine (hanya resilient online)
- ❌ KDS (Kitchen Display System)
- ❌ Table management & floor plan
- ❌ Delivery platform integration (GoFood, GrabFood, ShopeeFood)
- ❌ Customer-facing display/queue screen
- ❌ Loyalty program & member tier
- ❌ Investor portal & cap table
- ❌ Konsinyasi (inbound/outbound)
- ❌ Self-ordering kiosk
- ❌ Promo engine kompleks (happy hour, bundle, voucher)
- ❌ Gift card & customer credit tab
- ❌ WhatsApp Business API
- ❌ Biometric clock-in
- ❌ Bank reconciliation
- ❌ Supplier & Purchase Order workflow
- ❌ Split payment (cash + QRIS di transaksi yang sama)

Semua di atas adalah kandidat untuk **Phase 2+**. Arsitektur Phase 1 harus **siap menampung** fitur-fitur ini di masa depan (lihat section 8 — Upgradeability Requirements).

---

## 2. Business Context

### 2.1 Business Profile

| Field | Value |
|---|---|
| Nama | Mahakan Coffee & Space |
| Tagline | "A homely space for everyone to gather, dine & get caffeinated" |
| Tipe | Coffee shop + ruang berkumpul |
| Skala | Single outlet |
| Total SKU menu | ~45 items dalam 10 kategori |
| Mode servis | Dine-in & Takeaway (order via pager number) |
| Jam operasional | Configurable di settings |
| Bahasa UI | Bahasa Indonesia |
| Bahasa kode & dokumentasi | English |

### 2.2 Struktur Menu (per kategori)

| Kategori | SKU | Variant Hot/Iced | Catatan |
|---|---|---|---|
| Ricebowl | 4 | Tidak | Harga fixed |
| Bakmie | 3 | Tidak | Ada modifier "Extra Topping Ayam" (+10rb) |
| Sweets | 3 | Tidak | Harga fixed |
| Bites | 5 | Tidak | Harga fixed |
| Coffee Based | 7 | Ya (harga beda) | Beberapa Iced-only (Pablo Eskopi, Butterscotch) |
| Non-Coffee | 9 | Ya (harga beda) | Beberapa Iced-only (Yakult variants, Milkshake) |
| Tea Based | 2 | Ya (Lychee Tea Iced-only) | |
| Frappe | 2 | Tidak (Iced by nature) | |
| Mocktail | 4 | Tidak | Harga fixed |
| Manual Brew | 2 | Tidak | **Open-price**: barista input harga manual + free-text note untuk jenis beans |
| Ice Cream | 3 | Tidak | Harga fixed |

**Detail lengkap 45 SKU** akan di-dokumentasikan di `04-MENU-DATA.md` selama TSD phase.

### 2.3 Modifier Global (Phase 1)

| Modifier | Tipe | Harga | Berlaku untuk |
|---|---|---|---|
| Sugar level | Single select: Normal / Less / No sugar | Gratis | Semua minuman |
| Ice level | Single select: Normal / Less / No ice | Gratis | Semua minuman Iced |
| Extra shot | Toggle on/off | +Rp 8.000 | Coffee Based only |
| Extra Topping Ayam | Toggle on/off | +Rp 10.000 | Bakmie only |

Modifier tidak mempengaruhi harga kecuali Extra Shot dan Extra Topping Ayam. Harga modifier dapat diubah oleh Owner/Manager di back office.

### 2.4 Hardware Yang Sudah Ada

| Hardware | Detail | Status Integrasi Phase 1 |
|---|---|---|
| Thermal Printer | RPP02, Bluetooth, kertas 58mm, ESC/POS compatible (confirmed via Majoo compatibility) | **Harus berfungsi** untuk cetak struk |
| EDC BCA | Mesin EDC fisik untuk QRIS + kartu debit/kredit | **Manual confirm** di POS setelah transaksi di EDC sukses |
| Android tablet/smartphone | Device POS utama | **Primary target device** |
| Desktop/laptop | Device back office | **Secondary target device** |

### 2.5 Metode Pembayaran (Phase 1)

| Metode | Implementasi |
|---|---|
| Cash | Auto-kalkulasi kembalian |
| QRIS (via EDC BCA) | Manual confirm: kasir tap "QRIS Lunas" setelah EDC sukses |
| Kartu Debit/Kredit BCA (via EDC) | Manual confirm: kasir tap "Kartu Lunas" setelah EDC sukses |
| Split payment (cash + QRIS) | Phase 2 — **tidak termasuk Phase 1** |

---

## 3. User Personas & Roles

### 3.1 Role Definition (3 Roles)

#### 🟢 Role A: Owner

- **Siapa:** Pemilik kafe
- **Akses:** Penuh ke semua modul, semua data, semua settings
- **Device utama:** Laptop/desktop untuk back office, kadang tablet/HP untuk supervise
- **Goal:** Memastikan kafe profitable, memahami performa harian, manage staff

#### 🟡 Role B: Operational Manager

- **Siapa:** Orang yang dipercaya handle operasional harian saat owner tidak di tempat
- **Akses:**
  - ✅ POS (semua fitur, termasuk void dengan alasan)
  - ✅ Back office: menu, stok flag sold-out, pengeluaran harian, laporan penjualan harian
  - ✅ Manage user staff (tambah/edit/nonaktifkan staff)
  - ❌ **Tidak bisa:** lihat margin/HPP, lihat daftar pengguna role owner, edit settings sistem, export data penuh
- **Device utama:** Tablet saat operasional, laptop untuk review
- **Goal:** Memastikan operasional lancar, laporan harian rapi

#### 🔵 Role C: Staff (Barista + Kasir)

- **Siapa:** Barista merangkap kasir
- **Akses:**
  - ✅ POS (buat order, bayar, cetak struk)
  - ✅ Mark menu sold-out
  - ✅ Clock in/out shift sendiri
  - ✅ Lihat ringkasan shift sendiri (jumlah transaksi, total kas yang harusnya ada)
  - ❌ Tidak bisa void transaksi (harus minta Owner/Manager PIN)
  - ❌ Tidak bisa lihat laporan harian/keuangan
  - ❌ Tidak bisa akses menu CRUD, user management, settings
- **Device utama:** Tablet POS
- **Goal:** Cepat ambil order, cepat bayar, struk tercetak rapi

### 3.2 Permission Matrix (Phase 1)

| Action | Owner | Op. Manager | Staff |
|---|---|---|---|
| **POS Transaction** | | | |
| Buat order baru | ✅ | ✅ | ✅ |
| Tambah/edit item di order aktif | ✅ | ✅ | ✅ |
| Apply modifier | ✅ | ✅ | ✅ |
| Set harga manual brew | ✅ | ✅ | ✅ |
| Proses pembayaran | ✅ | ✅ | ✅ |
| Cetak/cetak ulang struk | ✅ | ✅ | ✅ |
| Void transaksi | ✅ | ✅ | ❌ (butuh PIN approver) |
| Refund transaksi | ✅ | ✅ | ❌ (butuh PIN approver) |
| Diskon manual (fixed/percent) | ✅ | ✅ | ❌ (butuh PIN approver) |
| **Shift Management** | | | |
| Open shift dengan kas awal | ✅ | ✅ | ✅ |
| Close shift & rekonsiliasi | ✅ | ✅ | ✅ (shift sendiri) |
| Lihat shift orang lain | ✅ | ✅ | ❌ |
| **Menu Management** | | | |
| Lihat menu | ✅ | ✅ | ✅ |
| Mark item sold out | ✅ | ✅ | ✅ |
| CRUD menu item & kategori | ✅ | ✅ | ❌ |
| CRUD modifier | ✅ | ✅ | ❌ |
| Bulk price update | ✅ | ✅ | ❌ |
| **Kas & Pengeluaran** | | | |
| Input pengeluaran harian | ✅ | ✅ | ❌ |
| Edit pengeluaran | ✅ | ✅ | ❌ |
| Hapus pengeluaran | ✅ | ❌ | ❌ |
| **Reports** | | | |
| Lihat laporan penjualan harian | ✅ | ✅ | ❌ |
| Lihat laporan penjualan mingguan/bulanan | ✅ | ✅ | ❌ |
| Lihat laba kotor (Revenue − COGS terestimasi − Pengeluaran) | ✅ | ❌ | ❌ |
| Export data (CSV/PDF) | ✅ | ⚠️ Laporan operasional saja | ❌ |
| **User Management** | | | |
| Lihat daftar staff | ✅ | ✅ | ❌ |
| Tambah/edit staff | ✅ | ✅ | ❌ |
| Tambah/edit manager | ✅ | ❌ | ❌ |
| Reset PIN staff | ✅ | ✅ | ❌ |
| **System Settings** | | | |
| Edit info bisnis (nama, alamat, dll) | ✅ | ❌ | ❌ |
| Edit konfigurasi printer | ✅ | ✅ | ❌ |
| Edit jam operasional | ✅ | ❌ | ❌ |

### 3.3 Authentication & Authorization

- **Owner & Operational Manager:** Login via email + password
- **Staff:** Login via PIN 4-6 digit (lebih cepat untuk shift barista)
- **Session timeout:** 12 jam untuk POS (biar gak perlu login ulang di tengah shift), 2 jam untuk back office
- **PIN override:** Untuk action yang butuh approver (void, refund, diskon manual), Staff bisa panggil Manager/Owner yang input PIN-nya di screen. Audit log mencatat siapa yang approve.

---

## 4. Feature Requirements — Phase 1

Setiap feature punya **ID unik** untuk direferensikan di FSD dan TSD nanti.

### 4.1 POS — Point of Sale

#### `P1-POS-001` — New Order Creation

- Barista tap tombol "Order Baru" di dashboard POS
- Modal input: **Nomor Pager** (wajib, angka 1-99) + **Tipe Order** (Dine-in / Takeaway, default Takeaway)
- Setelah confirm, masuk ke screen order aktif

#### `P1-POS-002` — Menu Grid Display

- Menu ditampilkan dalam grid responsive: **4 kolom di tablet landscape**, 2-3 kolom di phone portrait
- Kategori sebagai tab horizontal di bagian atas (scrollable)
- Setiap item menampilkan: nama, harga (atau harga Hot/Iced bila ada variant), icon "♥ Signature" jika applicable
- Item yang sold-out: grayed out, tidak bisa di-tap, badge "Habis"
- Item open-price (V60, Japanese): badge "Harga Manual"

#### `P1-POS-003` — Add Item to Order

- Tap item → jika ada variant/modifier, muncul modal: pilih Hot/Iced (jika applicable), sugar level, ice level, extra shot, dll
- Jika item adalah open-price (Manual Brew): modal wajib input harga + field free-text untuk catatan beans
- Confirm → item masuk ke cart di sidebar/section order aktif
- Tiap item di cart bisa di-adjust quantity (+/−) atau dihapus

#### `P1-POS-004` — Item-Level Notes

- Tiap item di cart punya tombol "Catatan" untuk free-text note (max 200 char)
- Contoh: "tolong agak panas", "gula aren aja"
- Catatan ini akan tercetak di struk untuk barista referensi

#### `P1-POS-005` — Order Discount (Phase 1: Simple Only)

- Tombol "Diskon" di order aktif (hanya muncul untuk Owner/Manager, atau Staff dengan PIN override)
- Input: persentase (0-100%) ATAU nominal fixed (rupiah)
- Input: alasan diskon (wajib, dropdown: "Promo staff", "Kompensasi", "Lainnya + catatan")
- Diskon diterapkan ke total order (bukan per item di Phase 1)
- Tercatat di audit log

#### `P1-POS-006` — Payment Screen

- Setelah "Bayar", tampil summary:
  - List item + modifier + notes
  - Subtotal, diskon (jika ada), total akhir
- Pilihan metode bayar (tombol besar untuk tablet):
  - **Tunai** → modal input nominal diterima + auto-kalkulasi kembalian
  - **QRIS (EDC BCA)** → konfirmasi "Sudah lunas di EDC?" → YES/NO
  - **Kartu (EDC BCA)** → konfirmasi "Sudah lunas di EDC?" → YES/NO
- Setelah confirm bayar: transaksi tersimpan, struk langsung dicetak, screen balik ke POS kosong

#### `P1-POS-007` — Thermal Printer Integration

- Koneksi via Web Bluetooth API ke printer RPP02 58mm
- Protocol: ESC/POS
- Print content:
  - Header: Logo/nama Mahakan, alamat (dari settings), nomor telepon
  - Nomor order + nomor pager + tipe order (Dine-in/Takeaway)
  - Tanggal, jam, nama kasir
  - List item: nama item, variant (Hot/Iced), modifier, qty, harga subtotal
  - Notes per item (jika ada)
  - Subtotal, diskon, total
  - Metode pembayaran
  - Footer: "Terima kasih, sampai jumpa lagi!"
  - QR code untuk rating/feedback (opsional, Phase 2)
- Jika printer gagal connect: fallback tampilkan struk di screen dengan tombol "Coba cetak ulang" dan "Skip (print nanti)"

#### `P1-POS-008` — Receipt Reprint

- Di riwayat transaksi, tombol "Cetak Ulang Struk"
- Cek koneksi printer, cetak ulang struk yang sama

#### `P1-POS-009` — Void Transaction

- Di riwayat transaksi (dalam shift yang sama), tombol "Void"
- Staff: butuh Manager/Owner PIN override
- Input: alasan void (wajib, dropdown + free-text)
- Void mark transaksi sebagai voided (soft delete), tidak bisa di-undo
- Transaksi voided tidak masuk ke total penjualan, tapi tetap ada di audit trail

#### `P1-POS-010` — Refund (Cash Only, Same-Day Only)

- Untuk Phase 1, refund hanya untuk transaksi hari yang sama, hanya cash
- Tombol "Refund" di riwayat transaksi
- Staff butuh PIN override
- Input: alasan refund (wajib)
- Kas keluar tercatat otomatis di pengeluaran dengan kategori "Refund"

#### `P1-POS-011` — Mark Item Sold Out

- Di screen menu POS, tombol "Sold Out" di tiap item (all roles)
- Tap → konfirmasi → item di-gray out di semua device yang sedang online
- Untuk un-sold-out: Owner/Manager only

#### `P1-POS-012` — Order Queue (Active Orders)

- Tidak ada kitchen display, tapi POS perlu track order yang sedang aktif
- Staff bisa lihat list "Order Aktif Hari Ini" dengan status:
  - **Paid** (sudah bayar, masih perlu disiapkan barista)
  - **Voided** (dibatalkan)
- Order yang sudah selesai dihidangkan → manual tap "Selesai" untuk bersihkan dari list aktif (tapi tetap ada di riwayat)

#### `P1-POS-013` — Multi-Order Hold

- Staff bisa buka order baru tanpa harus close order sebelumnya
- List order draft (belum dibayar) di sidebar: "Pager 3", "Pager 7", "Pager 12"
- Tap untuk switch antar order draft

#### `P1-POS-014` — Offline Resilience (Resilient Online)

- Jika internet putus saat transaksi:
  - Transaksi **tersimpan lokal** di IndexedDB
  - UI tampilkan banner "Offline — transaksi akan sync saat online"
  - Struk tetap bisa dicetak (printer koneksi Bluetooth lokal, tidak butuh internet)
- Saat internet kembali: auto-sync semua transaksi pending ke server
- **Batasan Phase 1:** Satu device hanya. Multi-device offline sync bukan di scope Phase 1 (butuh conflict resolution yang kompleks)

### 4.2 Back Office — Menu Management

#### `P1-MENU-001` — Menu CRUD

- List semua menu items, filterable by kategori, searchable by nama
- Action: Tambah, Edit, Delete (soft delete), Toggle Active/Inactive
- Field: nama, kategori, deskripsi (opsional), harga Hot (nullable), harga Iced (nullable), harga fixed (nullable — untuk item tanpa variant), flag "Signature", flag "Open Price", flag "Sold Out"
- Validasi: minimal salah satu harga harus terisi
- Field "urutan tampil" untuk custom sort di POS

#### `P1-MENU-002` — Category CRUD

- List kategori dengan jumlah item per kategori
- Reorder via drag (urutan muncul di POS)

#### `P1-MENU-003` — Modifier Management

- Di Phase 1, modifier-nya **hard-coded terbatas**: sugar level, ice level, extra shot, extra topping ayam
- Owner/Manager bisa edit harga extra shot dan extra topping ayam
- Modifier assignment ke item: per kategori (semua minuman dapat sugar/ice level, dll)
- Tidak ada modifier custom/bebas di Phase 1 — itu Phase 2

#### `P1-MENU-004` — Bulk Actions

- Multi-select items → bulk "mark sold out", "mark available", "adjust price by %"
- Export menu ke CSV (Owner only)

### 4.3 Shift Management

#### `P1-SHIFT-001` — Open Shift

- Staff tap "Mulai Shift" → input kas awal (modal kas) → confirm
- Shift log mencatat: staff ID, waktu mulai, kas awal
- Tidak bisa transaksi tanpa shift aktif

#### `P1-SHIFT-002` — Close Shift

- Tap "Tutup Shift" → tampil summary:
  - Jumlah transaksi
  - Total kas yang harusnya ada (kas awal + penjualan cash − refund cash)
  - Total QRIS
  - Total Kartu
  - Total penjualan (semua metode)
  - Total void/refund
- Staff input kas aktual (hitung fisik kas di laci)
- Sistem hitung selisih (surplus/minus)
- Staff input catatan (opsional)
- Confirm → shift tertutup, tidak bisa transaksi lagi sampai shift baru

#### `P1-SHIFT-003` — Shift History

- Owner/Manager bisa lihat semua shift history
- Staff hanya lihat shift sendiri
- Filter by tanggal, staff

### 4.4 Daily Cash & Expense Register

#### `P1-CASH-001` — Expense Logging

- Input pengeluaran harian (Owner/Manager only)
- Field: tanggal (default hari ini), kategori (dropdown), deskripsi, nominal, metode bayar (cash/transfer), bukti (upload foto opsional)
- Kategori default: Belanja Bahan Baku, Listrik & Air, Gaji Harian, Sewa, Perawatan Alat, Kemasan, Marketing, Lain-lain
- Owner bisa tambah/edit kategori

#### `P1-CASH-002` — Income Logging (Manual, Non-POS)

- Untuk pemasukan di luar POS (contoh: sewa ruang untuk event, titip jual cookies)
- Field: tanggal, deskripsi, nominal, metode bayar

#### `P1-CASH-003` — Daily Cash Summary

- Untuk tanggal yang dipilih:
  - Total pemasukan POS (by metode: cash, QRIS, kartu)
  - Total pemasukan non-POS
  - Total pengeluaran (by kategori)
  - Kas awal harian (dari shift pertama)
  - Kas akhir harian (dari shift terakhir)
  - Selisih kas (surplus/minus)

### 4.5 Reports — Laporan

#### `P1-REPORT-001` — Daily Sales Report

- Tampilan per tanggal (default hari ini, bisa pilih tanggal lain)
- Metrics utama:
  - Total revenue
  - Jumlah transaksi
  - Rata-rata per transaksi
  - Breakdown by metode bayar
  - Breakdown by kategori menu
  - Top 10 item terlaris hari itu
  - Item yang di-void & refund
- Grafik tren penjualan per jam (line chart sederhana)
- Export ke PDF (Owner only)

#### `P1-REPORT-002` — Weekly & Monthly Sales Report

- Sama seperti daily, tapi aggregate by minggu atau bulan
- Tambahan: perbandingan minggu/bulan sebelumnya (% change)
- Grafik tren harian

#### `P1-REPORT-003` — Item Performance Report

- List semua menu items dengan: qty terjual, revenue total, avg per transaksi
- Sortable, filterable by date range dan kategori
- Badge: "Best Seller", "Slow Mover" (auto-detect dari quartile)

#### `P1-REPORT-004` — Simple P&L (Owner Only)

- Catatan: **Ini BUKAN double-entry accounting.** Hanya laporan arus kas sederhana.
- Untuk periode yang dipilih:
  - Total Revenue (dari POS + income manual)
  - Total Pengeluaran (dari expense log, by kategori)
  - **Laba Kotor** = Revenue − Pengeluaran
- Export ke PDF

#### `P1-REPORT-005` — Shift Report

- List semua shift dengan: staff, waktu, total transaksi, total revenue, selisih kas
- Flag shift dengan selisih kas > threshold (default Rp 10.000) untuk perhatian

### 4.6 User Management

#### `P1-USER-001` — User CRUD

- List user dengan role dan status aktif
- Tambah user: nama, email (untuk Owner/Manager), PIN 4-6 digit (untuk Staff), role, status
- Edit: nama, PIN, role (Owner only), status
- Deactivate (soft disable, tidak hard delete)

#### `P1-USER-002` — PIN Reset

- Manager bisa reset PIN staff
- Owner bisa reset PIN siapa saja
- Audit log mencatat

### 4.7 System Settings

#### `P1-SETTING-001` — Business Info

- Nama bisnis, alamat, nomor telepon, logo upload
- Muncul di header struk

#### `P1-SETTING-002` — Printer Configuration

- Pair/unpair Bluetooth printer RPP02
- Test print button
- Pilih width 58mm
- Toggle auto-print saat transaksi selesai (default on)

#### `P1-SETTING-003` — Operational Hours

- Set jam buka-tutup per hari
- Info, tidak enforce restriction di Phase 1

---

## 5. User Journeys (Key Flows)

### 5.1 Journey: Staff Buka Shift & Ambil Order Pertama

1. Staff buka app di tablet → login dengan PIN
2. Dashboard muncul: "Shift belum dibuka" banner
3. Tap "Buka Shift" → input kas awal Rp 100.000 → confirm
4. Dashboard update: shift aktif, tombol "Order Baru" menyala
5. Customer datang, pesan "1 Americano Iced, 1 Croffle Ice Cream"
6. Staff tap "Order Baru" → input pager 5, tipe Takeaway
7. Tap menu "Americano" → modal variant muncul → pilih "Iced", sugar level normal, ice level normal → confirm
8. Tap "Croffle Ice Cream" → confirm langsung (tidak ada variant)
9. Total auto-kalkulasi: 16.000 + 21.000 = 37.000
10. Tap "Bayar" → customer bilang cash 50.000
11. Tap "Tunai" → input 50.000 → kembalian 13.000 ditampilkan
12. Tap "Konfirmasi" → struk auto-print ke RPP02
13. Screen balik ke POS kosong, ready untuk order berikutnya

### 5.2 Journey: Manual Brew dengan Harga Manual

1. Customer pesan "V60 Ethiopia Yirgacheffe"
2. Staff tap menu "V60" → modal harga manual muncul
3. Staff input harga Rp 35.000, note: "Ethiopia Yirgacheffe"
4. Confirm → item masuk cart dengan harga 35rb
5. Lanjut ke bayar seperti biasa
6. Struk tercetak dengan: "V60 - Ethiopia Yirgacheffe - 35.000"

### 5.3 Journey: Owner Review Laporan Harian

1. Owner login di laptop dari rumah, malam hari
2. Dashboard: overview revenue hari ini, top items, shift summary
3. Klik "Laporan Harian" → tanggal hari ini
4. Lihat: revenue Rp 2.850.000, 67 transaksi, top item "Ayam Sambal Matah Bakmie" (12 qty)
5. Klik "Pengeluaran Hari Ini" → total 450.000 (belanja bahan baku 380rb, kemasan 70rb)
6. Laba kotor hari ini: 2.850.000 − 450.000 = Rp 2.400.000
7. Export PDF untuk arsip

### 5.4 Journey: Void dengan Supervisor Override

1. Staff buat order, customer berubah pikiran setelah bayar
2. Staff tap transaksi di riwayat → "Void"
3. Modal: "Butuh approval Manager/Owner"
4. Owner datang → input PIN-nya sendiri di tablet staff
5. Alasan void: "Customer batal"
6. Confirm → transaksi voided, kas otomatis dicatat dikurangi di shift
7. Audit log mencatat: void by Staff X, approved by Owner Y

### 5.5 Journey: Tutup Shift Akhir Hari

1. Staff tap "Tutup Shift" di akhir hari
2. Summary muncul:
   - Transaksi: 67
   - Total cash masuk (harus ada): 1.250.000 (kas awal 100rb + penjualan cash 1.150rb)
   - Total QRIS: 1.200.000
   - Total Kartu: 500.000
3. Staff hitung kas fisik di laci: 1.248.000
4. Input kas aktual: 1.248.000 → sistem hitung selisih: minus Rp 2.000
5. Catatan: "Kemungkinan kembalian kurang pas"
6. Confirm tutup shift → logout

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Metric | Target |
|---|---|
| POS initial load time | < 2 detik di 4G |
| Tap item → masuk cart | < 200ms (optimistic UI) |
| Bayar → struk tercetak | < 3 detik (termasuk Bluetooth print) |
| Back office report load | < 3 detik untuk 1 bulan data |

### 6.2 Device Support

| Device | Target |
|---|---|
| Tablet Android 10"+ (landscape) | Primary, harus perfect |
| Smartphone Android (portrait) | Secondary, usable |
| iPad (Safari) | Nice-to-have, test jika ada |
| Desktop/Laptop Chrome/Edge | Back office harus perfect |
| Bluetooth API support | **Web Bluetooth hanya di Chrome/Edge Android.** iPad/Safari TIDAK support Web Bluetooth — fallback: install sebagai PWA dan pastikan user pakai Chrome |

### 6.3 Reliability

- POS harus bisa terima order meski internet flaky (resilient online pattern)
- Data transaksi **tidak boleh hilang** — double confirmation sebelum apapun yang destructive
- Auto-backup database harian (Neon punya ini built-in di paid tier; di free tier, kita bikin cron manual untuk export ke file)

### 6.4 Security

- Password hashing: bcrypt (min 12 rounds)
- PIN hashing: bcrypt
- Session token: signed JWT atau secure session cookie
- HTTPS only (Vercel enforce otomatis)
- Role check di **setiap API endpoint** (bukan hanya di UI)
- Audit log untuk: login, void, refund, diskon manual, user CRUD, menu price change, setting change

### 6.5 Localization

- Semua UI text, error message, email, struk: **Bahasa Indonesia**
- Angka format: ribuan pakai titik (Rp 1.250.000)
- Tanggal format: DD/MM/YYYY
- Timezone: Asia/Jakarta (WIB)
- Currency: IDR (Rupiah), **integer arithmetic** — semua amount disimpan sebagai integer (tidak ada desimal untuk rupiah)

### 6.6 Browser Support

- Chrome 120+ (primary)
- Edge 120+
- Safari (back office only, tanpa Web Bluetooth)
- Firefox (best effort)

---

## 7. Technical Constraints & Decisions

| Area | Keputusan | Alasan |
|---|---|---|
| Framework | Next.js 15 (App Router) | Modern, PWA-friendly, server actions untuk form |
| Styling | Tailwind CSS v4 | Sesuai request, design system via config |
| Database | Postgres via Neon | Free tier 0.5GB (cukup 2-3 tahun), auto-backup, reliable concurrent write |
| ORM | Drizzle | Type-safe, lightweight |
| Auth | Auth.js v5 (NextAuth) | Battle-tested, support credentials + PIN flow |
| PWA | Serwist | Modern maintainer, Next.js 15 compatible |
| Hosting | Vercel (primary), migration path ke VPS jika butuh | Free tier cukup untuk Phase 1 |
| Printer | Web Bluetooth API + ESC/POS | Native browser, no middleware |
| Testing | Vitest (unit) + TestSprite (E2E flows) | Vitest untuk logic, TestSprite untuk smoke test |
| Money representation | Integer (satuan rupiah terkecil, tanpa desimal) | Hindari floating point error untuk uang |

---

## 8. Upgradeability Requirements

Phase 1 harus **siap** untuk ekstensi Phase 2+. Ini bukan fitur, tapi **prinsip arsitektur** yang wajib ditaati:

### 8.1 Database Design Principles

- **Semua tabel punya `id` (UUID), `created_at`, `updated_at`, `deleted_at`** (soft delete)
- **Audit columns**: `created_by`, `updated_by` (foreign key ke user)
- **Semua tabel yang berhubungan dengan outlet punya kolom `outlet_id`** — di Phase 1 isi dengan 1 outlet default. Phase 4 tinggal tambah outlet baru, tidak ada migration besar.
- **Enum values** disimpan sebagai string di kode, jangan native enum Postgres (biar mudah tambah value baru)
- **Money stored as integer** (satuan rupiah), kolom `bigint`

### 8.2 Code Structure Principles

- **Feature-based folder structure**, bukan layer-based (misal `features/pos/`, `features/menu/`, bukan `components/`, `services/` global)
- Setiap feature punya sub-folder: `ui/`, `api/`, `db/`, `types.ts`, `utils.ts`
- **API route di-versioning** sejak awal: `/api/v1/...` — biar Phase 2 bisa introduce `/api/v2/` tanpa breaking Phase 1
- **Permission check di middleware**, bukan di tiap handler
- **Money helper utility** (format, calculate, percentage) centralized — jangan tulis manual di tiap component

### 8.3 Feature Flag Pattern

- Tambah kolom `config.features` (JSON) di tabel settings
- Setiap fitur Phase 2+ di-wrap dengan flag check
- Contoh: `if (config.features.loyaltyEnabled) { ... }`
- Phase 1: semua flag off by default

### 8.4 Data Model Extensibility

Tabel utama yang harus **forward-compatible** sejak Phase 1:

| Tabel | Phase 1 Scope | Phase 2+ Extension |
|---|---|---|
| `transactions` | Basic order | Link ke recipe/BOM untuk COGS, loyalty points |
| `menu_items` | Nama, harga, kategori | Link ke recipe, cost price, allergen info |
| `users` | 3 roles sederhana | Banyak role, department, contract info |
| `expenses` | Kategori sederhana | Link ke COA, supplier, PO number |
| `shifts` | Buka/tutup + kas | Link ke payroll, commission, tips |

Di TSD nanti akan spec schema-nya dengan kolom "placeholder nullable" untuk hal-hal ini.

---

## 9. Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Web Bluetooth gagal connect ke RPP02 di beberapa device Android | High | Medium | Test di Chrome Android dulu di minggu 1. Jika gagal: fallback ke Android app bridge (capacitor/tauri mobile) |
| Vercel free tier tidak cukup | Medium | Low | Monitor usage; migrate ke VPS jika butuh (code structure agnostic) |
| Internet outage > 1 jam | High | Medium | Resilient online mode handle ini; staff bisa lanjut transaksi offline |
| Neon free tier penuh | Medium | Low | Setup data retention policy (archive transaksi > 2 tahun) sebelum kehabisan storage |
| Staff training kurang | High | High | Wajib: video tutorial singkat (5 menit) per modul, QR code di dinding belakang kasir |
| Bug logic perhitungan uang | **Critical** | Medium | Wajib unit test untuk semua money calculation. Integer arithmetic. TestSprite end-to-end untuk flow bayar |
| Lupa password owner | Critical | Low | Setup recovery email + backup admin account |

---

## 10. Timeline & Milestones

Berikut estimasi kasar (subject to revisi setelah TSD finalized):

| Week | Milestone | Deliverable |
|---|---|---|
| 1 | PRD + FSD finalized | Dokumen approved |
| 2 | TSD + Design System + DB Schema | Dokumen approved, setup project |
| 3 | UI Frontend: POS screens (mock data) | Tablet POS demo-able |
| 4 | UI Frontend: Back Office screens (mock data) | Desktop back office demo-able |
| 5 | Backend: DB + Auth + Menu API | Login jalan, CRUD menu jalan |
| 6 | Backend: Transaction API + Thermal Printer | End-to-end POS flow jalan + print struk |
| 7 | Backend: Reports + Shift + Expense | Full feature parity dengan PRD |
| 8 | Testing (TestSprite + Manual) + Bug fix | Ready for soft launch |
| 9 | **Soft Launch** — real use di kafe | Monitoring ketat, quick fix |
| 10 | Stabilisasi + dokumentasi user | Ready full production |

**Estimasi realistis: 8-10 minggu** dari mulai coding ke production, dengan asumsi vibe coding produktif + tidak ada blocker besar.

---

## 11. Decisions Locked-In (Owner Approved)

Hal-hal yang sudah diputuskan dan **tidak akan berubah tanpa approval Owner**:

| # | Decision | Value |
|---|---|---|
| 1 | Scope Phase 1 | Sesuai section 4 — tidak boleh scope creep |
| 2 | Non-goals Phase 1 | Sesuai section 1.4 — tidak boleh dicampur ke Phase 1 |
| 3 | Tech stack | Next.js 15 + Tailwind v4 + Postgres Neon + Drizzle + Auth.js v5 + Serwist + Vercel |
| 4 | 3 roles | Owner, Operational Manager, Staff |
| 5 | Payment methods | Cash, QRIS (manual confirm), Kartu (manual confirm) — no split payment Phase 1 |
| 6 | Table system | Pager number only, no table management |
| 7 | KDS | No KDS Phase 1, thermal printer receipt to barista |
| 8 | Stock tracking | Flag sold-out manual saja, no recipe/BOM |
| 9 | Accounting | Simple cash & expense, no double-entry |
| 10 | Modifier | Hard-coded: sugar level, ice level, extra shot (+8rb), extra topping ayam (+10rb) |
| 11 | Manual brew | Open-price, free-text note untuk beans, no beans master data |
| 12 | UI language | Bahasa Indonesia |
| 13 | Money representation | Integer (satuan rupiah) — zero floating point |
| 14 | Upgradeability | All architectural principles in section 8 wajib ditaati |

---

## 12. Owner-Provided Information (Answered 2026-04-20)

Semua pertanyaan yang sebelumnya "Open" sekarang sudah terjawab:

1. ✅ **Logo Mahakan** — 3 file PNG provided:
   - `Logo_Mahakan_Hijau.png` — varian hijau (primary, untuk light background)
   - `Logo_Mahakan_Hitam.png` — varian hitam (alternatif, monochrome)
   - `Logo_Mahakan_Putih.png` — varian putih (untuk dark background)
   - **Warna brand asli:** `#539371` (sage green, diambil dari file logo hijau)
   - Design ikon: archway + tunas/daun di tengah + 3 kaki kaligrafi di bawah. Gestalt: homely, organic, grounded.
   - Taruh di repo: `public/assets/logo/` saat implementation

2. ✅ **Alamat resmi:** `Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750`

3. ✅ **Nomor telepon:** `0838-1977-5665`

4. ✅ **Footer struk:** Pakai default `"Terima kasih, sampai jumpa!"` (Owner bisa edit kapan saja via `/settings/receipt`)

5. ✅ **Jam operasional resmi:**
   - **Weekday (Senin-Jumat):** 14:00 - 22:00
   - **Weekend (Sabtu-Minggu):** 09:00 - 23:00
   - Detail seed JSON di `04-MENU-DATA.md`

6. ✅ **Kategori pengeluaran:** Pakai 8 default + 1 system "Refund" (total 9). Owner bisa tambah/edit nanti via `/expenses/categories`

7. ✅ **Threshold selisih kas:** `Rp 10.000`. Di atas threshold ini, shift report akan flag warning merah. Owner bisa adjust via `/settings/thresholds`

8. ✅ **HPP visibility untuk staff:** `false` (staff TIDAK lihat harga modal/margin). Owner bisa toggle via `/settings/features`

---

## 13. Glossary

| Istilah | Definisi |
|---|---|
| POS | Point of Sale — sistem transaksi di kasir |
| ERP | Enterprise Resource Planning — sistem manajemen sumber daya (Phase 2+) |
| HPP / COGS | Harga Pokok Penjualan / Cost of Goods Sold — biaya produksi per item |
| Variant | Variasi harga untuk item yang sama (Hot/Iced) |
| Modifier | Tambahan/kustomisasi item (sugar level, extra shot) |
| Open Price | Item dengan harga ditentukan saat transaksi (Manual Brew) |
| Pager Number | Nomor urut yang customer pegang untuk ambil pesanan |
| Shift | Periode kerja staff dari buka kasir sampai tutup kasir |
| Sold Out / 86'd | Status item yang tidak tersedia |
| Void | Pembatalan transaksi yang sudah dibuat |
| Refund | Pengembalian uang customer |
| Resilient Online | Mode koneksi: online by default, offline sebagai fallback temporer |
| PWA | Progressive Web App — web app yang bisa di-install seperti native app |
| BOM | Bill of Materials — daftar bahan baku per menu (Phase 2) |
| COA | Chart of Accounts — daftar akun akuntansi (Phase 2) |
| ESC/POS | Epson Standard Code for POS — protokol thermal printer |
| RBAC | Role-Based Access Control |
| PIN Override | Mekanisme approval: user dengan role tinggi input PIN di device staff untuk authorize aksi restricted |

---

# 🛑 END OF PRD v1.0

**Status:** ✅ APPROVED by Owner on 2026-04-20
**Next Step:** Proceed to FSD (Functional Specification Document)
