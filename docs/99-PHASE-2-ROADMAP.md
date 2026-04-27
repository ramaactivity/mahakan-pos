# 🗺️ Mahakan POS — Phase 2 Roadmap

**Status:** DRAFT — disusun setelah Phase 1 PRD-COMPLETE 2026-04-27.
**Audience:** Owner (Rama) + AI agent sesi 6+.
**Aim:** Tingkatkan akurasi finansial, drive repeat business, dan rapikan operasional sebelum scaling.

---

## 1. Context

Phase 1 menutup 100% PRD. Apa yang kita punya sekarang:
- POS lengkap (order → bayar → struk → print)
- Back office: menu, staff, shift, kas, laporan, settings, audit log
- Authentication + RBAC (Owner / Manager / Staff)
- PWA installable, offline-resilient (single-device)
- Production live + di-pakai karyawan untuk transaksi real
- Integrasi: thermal printer (Bluetooth), Neon Postgres (Singapore), Vercel hosting
- Backup automated weekly + manual script

Apa yang **belum dipotret oleh sistem**:
- **HPP / COGS** — revenue masuk, tapi cost-of-goods-sold belum dihitung otomatis. Margin per item tidak akurat. P&L overstated.
- **Customer identity** — kita gak tahu pelanggan repeat vs one-time. Gak bisa ngasih reward.
- **Promo terstruktur** — discount manual ada, tapi happy hour / bundle / kode promo belum ada.
- **Real-time stock** — sold-out manual flag. Kalau stok bahan habis tengah hari, staff harus inget toggle manual.
- **Operational hygiene** — supplier invoice belum di-track, bank reconciliation manual.

---

## 2. Prinsip Prioritisasi

1. **Impact vs effort** — fitur dengan ROI paling jelas duluan, terutama yang langsung mempengaruhi keputusan finansial Owner.
2. **Prerequisite chain** — beberapa fitur saling tergantung (mis. inventory butuh master ingredient sebelum recipe). Tidak skip prereq.
3. **No scope creep dalam tier** — jangan tambah requirement saat sedang ngerjain tier. Tier berikutnya selalu jadi "nanti".
4. **Field-validate dulu sebelum tier berikut** — setelah Tier 1 deploy, jalanin di kafe minimal 2 minggu sebelum mulai Tier 2.
5. **Tech debt bareng feature** — kalau ada cleanup yang berhubungan dengan fitur baru, kerjain bareng. Jangan dipisah jadi "cleanup sprint".

---

## 3. Tier 1 — Akurasi finansial + repeat business (~6.5 minggu, RECOMMENDED START)

### 3.1 Recipe / BOM + Inventory tracking (~3 minggu)

**Why:** Tanpa ini, P&L Owner hanya placeholder — gak tahu margin sebenarnya per item. Ini fondasi semua report keuangan beneran.

**Output:**
- Master `ingredients` table (nama, satuan, cost-per-satuan, current-stock).
- Master `recipes` linking `menu_items` → ingredients dengan qty & satuan (mis. Americano Hot = 18g espresso bean + 200ml air + 1 cup paper).
- Auto-deduct stock saat transaksi paid (atomic, dalam DB transaction yang sama dengan createTransaction).
- Auto sold-out kalau stok bahan turun di bawah threshold per resep.
- COGS per transaction = sum(ingredient.cost × qty) → `transactions.cogs` kolom snapshot.
- P&L report jadi proper: Gross Margin = Revenue − COGS; Net Margin = GM − Expenses.
- Inventory section di admin: stock count, low-stock alert, manual adjust (terima barang).

**Pre-req:**
- Schema migration: `ingredients`, `recipes`, `recipe_ingredients`, `inventory_movements` (audit history).
- Seed: convert 43 menu items ke draft recipes (Owner konfirmasi & adjust).

**Risk:**
- Recipe data entry effort untuk 43 item (~1 hari Owner).
- Ingredient cost price update: butuh workflow (per delivery).

**Est: 3 minggu** (1 minggu schema + seed, 1 minggu UI master + recipe builder, 1 minggu auto-deduct + COGS reporting + sold-out wiring).

### 3.2 Loyalty + Customer DB (~2 minggu)

**Why:** Repeat-business adalah moat untuk cafe. Phone number sebagai identifier (SMS/WA bisa nyusul). Reward sederhana: 1 point per Rp 1.000 spent, 100 points = Rp 10.000 voucher.

**Output:**
- `customers` table (phone PK, name, points_balance, total_spent, last_visit, tags).
- POS: input phone customer di payment screen (opsional, skip kalau gak mau). Sticky default empty.
- Auto-credit points pada transaction.paid; hold pada void/refund.
- Redeem flow: customer punya balance → Owner/Manager apply redemption (tidak bisa staff sendiri tanpa approval).
- Customer-detail view: history transaksi, total spend, top items, last visit.
- Audit log: customer create, points earned, points redeemed.

**Pre-req:** Audit log infra (sudah ada).

**Est: 2 minggu**.

### 3.3 Promo engine (~1.5 minggu)

**Why:** Happy hour discount, bundle (2 ricebowl + 1 minuman 50rb), kode promo (KOMUNITAS10) — semua ini di-execute manual sekarang via discount field, error-prone.

**Output:**
- `promos` table: name, type (percent / fixed / bundle), trigger (time-window / code / cart-min), discount, max_uses_per_day, expiry.
- POS: auto-suggest promo yang berlaku saat ini (mis. happy hour 14:00-17:00 → "Diskon 20% all coffee" otomatis applied dengan badge).
- Code input field di payment screen.
- Bundle detection: kalau cart cocok dengan rule bundle, harga otomatis adjust.
- Reporting: promo usage count, revenue impact.

**Pre-req:** Loyalty done (untuk member-only promo).

**Est: 1.5 minggu**.

### Tier 1 timeline ringkasan

```
Week 1-3: Recipe/BOM + Inventory
Week 4-5: Loyalty + Customer DB
Week 6-7: Promo engine (overlap minor dengan loyalty)
Week 8: Field validation, Owner training, monitoring
```

---

## 4. Tier 2 — Operational quality (~4-5 minggu)

Mulai setelah Tier 1 stable di production minimal 2 minggu.

### 4.1 Split payment (~1 minggu)
Cash + QRIS untuk satu transaksi. Schema: array `transaction_payments` instead of single `paymentMethod`. UI: payment screen support multi-method input dengan validation total = subtotal − discount.

### 4.2 Tip / service charge (~3 hari)
Field di POS payment + reporting. Configurable di Settings (default 10% optional).

### 4.3 Receipt photo upload (~1 minggu)
Phase 1 C3 di-skip (Vercel Blob butuh paid). Sekarang bisa: integrate Vercel Blob, store URL di `expenses.receiptImageUrl`, view & re-download dari Cash UI.

### 4.4 Supplier + Purchase Order (~2 minggu)
`suppliers` master + `purchase_orders` workflow (draft → received → invoiced). Link to inventory: PO `received` → ingredient stock+, expense draft auto-generated.

### 4.5 Bank reconciliation sederhana (~1 minggu)
Upload bank statement CSV. UI match: `transactions` (POS QRIS/card) ↔ statement entries. Flag unmatched.

### 4.6 Customer-facing display sederhana (~3 hari)
Tablet/monitor di kasir untuk customer melihat order + total. Read-only public route, refresh real-time via polling tiap 3 detik (no SSE complexity di Phase 2).

---

## 5. Tier 3 — Analytics deepening (~2-3 minggu)

### 5.1 Customer LTV + cohort retention
Per customer: total spend, avg ticket, frequency, gap between visits. Cohort: bulan first-visit → retention %.

### 5.2 Item attach rate (basket analysis)
Kalau order Coffee, paling sering ditambahin Croffle? Sederhana: pair frequency dari `transaction_items`.

### 5.3 Hour-of-week heatmap
Jam x hari = revenue + transaction count. Identifikasi peak / dead hours untuk staffing.

### 5.4 Audit log retention
Auto-prune > 6 months (atau archive ke artifact). Cap table growth.

### 5.5 Forecast staffing
Berdasarkan tren H-1 minggu: estimasi transaksi per jam → rekomendasi jumlah staff.

---

## 6. Tier 4 — Situational (only if use-case appears)

| Feature | Trigger to start |
|---|---|
| KDS (Kitchen Display) | Barista mengeluh struk thermal kurang bagus untuk preparation queue |
| Table management + floor plan | Dine-in volume jadi >50% transaksi |
| Delivery integration (GoFood/GrabFood/ShopeeFood) | Owner sign-up partner program |
| Self-ordering kiosk | Antrian kasir >3 orang konsisten di peak |
| Multi-outlet readiness | Outlet ke-2 dalam pipeline |
| WhatsApp Business API | Customer service volume >20/day |
| Biometric clock-in | HR audit findings |
| Investor portal | Fundraising round |
| Konsinyasi (titip jual produk lain) | Partnership lokal muncul |
| Gift card / customer credit tab | Repeat-customer request |

---

## 7. Tech Debt Cleanup (interleave dengan tier features)

Sebaiknya dikerjain bareng feature yang berhubungan, bukan di sprint khusus.

| Debt | Where to bundle |
|---|---|
| `middleware` → `proxy` rename (Next 16 deprecation) | First sesi Phase 2 (warm-up) |
| Receipt config sourced from DB (currently hardcoded di `print-transaction.ts`) | Bundle dengan Tier 2 receipt photo upload |
| Audit log retention policy | Tier 3 retention task |
| Approver blacklist GC observability | Bundle dengan first feature yang pakai approver |
| Migrate audit writes to async/queue | Defer sampai audit volume jadi masalah |
| Integration tests vs live DB (deferred dari M18) | Bundle dengan Tier 1 inventory schema work |

---

## 8. Architecture Decisions yang Nunggu Phase 2

### 8.1 Multi-device offline sync
Phase 1 = single-device offline only. Kalau Mahakan punya 2 tablet POS, kita butuh conflict resolution. Pilihan: SSE-based broadcast, polling, atau CRDTs. Recommended: SSE setelah Vercel paid tier.

### 8.2 Connection pool tuning
Saat ini Drizzle + Neon pooled connection sufficient untuk single outlet. Kalau QPS naik (delivery integration, multi-device, kiosk), tuning pool size + retry logic perlu dipertimbangkan.

### 8.3 Vercel free tier → paid
Trigger pindah:
- Background Functions (untuk async audit / notification) butuh paid.
- Long-running cron > 10 menit butuh paid.
- Multi-region edge butuh paid (currently sin1 only — fine for Indonesia).

### 8.4 Dedicated staging environment
Saat ini production = release/phase-1 langsung. Phase 2 mungkin butuh staging branch dengan staging DB schema mirror untuk testing migration tanpa risiko ke production data.

---

## 9. Rekomendasi Sesi 6 (Next Session) Starting Point

**Opsi A — Mulai dari Tier 1.1 Recipe/BOM (RECOMMENDED).**
- Highest impact pada akurasi finansial.
- Pre-req paling siap (schema sudah extensible, audit log infra sudah ada).
- Prerequisite untuk semua reporting yang lebih dalam.

**Opsi B — M20 soft launch dulu (1-2 sesi singkat).**
- Bikin training script + walkthrough doc untuk Rama dan staff.
- Field-validate Phase 1 selama 1-2 minggu.
- Kumpulin feedback real → adjust priority Phase 2 berdasarkan apa yang sebenarnya jadi pain point.
- **Rekomendasi: Opsi B dulu untuk de-risk Phase 2 prioritization.** Phase 1 baru live, jangan langsung tambah scope tanpa observability.

**Opsi C — M16 hardware field validation.**
- Auto-print + reprint udah shipped tapi belum tested di transaksi real. Quick (1 sesi).

**Suggested order: C → B → A.** C dan B bisa selesai dalam ~1 minggu. Lalu Tier 1 dengan informasi feedback yang real.

---

## 10. Decision Log

| Decision | Rationale | Date |
|---|---|---|
| Tier 1 starts dengan Recipe/BOM, bukan Loyalty | Akurasi finansial > customer growth pada tahap ini | 2026-04-27 |
| Defer multi-device offline sync ke setelah outlet ke-2 | Single device sufficient untuk single outlet | 2026-04-27 |
| Audit log retention = Tier 3 (bukan urgent) | Volume rendah, table growth slow | 2026-04-27 |
| middleware → proxy rename = bundle dengan Phase 2 sesi pertama | Non-blocking, warm-up task | 2026-04-27 |

Decisions baru selama Phase 2 ditambahkan di sini saat pengambilan keputusan.

---

# 🛑 END PHASE 2 ROADMAP DRAFT

**Reviewed dan approved oleh Owner sebelum implementation. Update sesuai realita field testing Phase 1.**
