# 🧪 ACCOUNTING VALIDATION RUNBOOK — Mahakan POS

**Untuk:** Owner (Rama) + Manager (Galih)
**Versi:** 1.0 — Sesi W (2026-05-02)
**Konteks:** Phase 2 Accounting tier feature-complete sesi V (2026-05-02). Auto-journal default OFF. Sebelum aktifkan permanent, validasi end-to-end pakai runbook ini.

---

## 🎯 Tujuan Validasi

1. Pastikan Cutover Wizard menghasilkan saldo awal yang benar
2. Pastikan auto-journal hooks fire di semua 14 source actions
3. Pastikan Buku Besar match sumber data (Kas / Persediaan / Hutang Dagang)
4. Pastikan period close generate closing entry yang benar
5. Pastikan reports (TB / IS / BS / GL) tampil angka yang masuk akal

**Fail-fast principle**: kalau ada drift di langkah berapapun, STOP, fix dulu, ulang langkah.

---

## 📋 Pre-Cutover Checklist (Sebelum 1 Juni 2026)

Owner siapkan data di luar sistem dulu:

- [ ] Tutup semua shift POS yang masih "open" di akhir 31 Mei 2026 (jam tutup kafe)
- [ ] Hitung fisik kas tunai (drawer + brankas) per 31 Mei jam tutup
- [ ] Print mutasi rekening BCA + BRI per 31 Mei jam terakhir
- [ ] Total piutang QRIS + EDC + GoFood + GrabFood + ShopeeFood per 31 Mei (dari finance settlement reports)
- [ ] Modal Owner saldo awal (initial setoran + tambahan)
- [ ] Saldo Laba Ditahan (kalau ada pembukuan manual sebelumnya, atau 0 fresh start)
- [ ] **Pastikan tidak ada purchase TOP yang masih "pending_payment" tapi seharusnya sudah dibayar** (cek di Suppliers → Hutang Dagang tab) — kalau ada, mark-paid dulu
- [ ] Backup database via Drizzle Studio export (preventif kalau ada masalah cutover)

---

## 🚀 Day-of Cutover (1 Juni 2026 pagi sebelum buka kafe)

### Step 1: Verify Pre-Cutover Data Sehat

1. Login Admin sebagai **Owner**
2. Akuntansi → tab **Periode** — verify ada periode 2026-05 (Mei) status "open" (auto-created sesi S)
3. Akuntansi → tab **Bagan Akun** — verify 63 akun seeded (filter All)
4. Settings → cek toggle "Auto-Journal Akuntansi" — pastikan **OFF**

### Step 2: Run Cutover Wizard

1. Akuntansi → Periode → klik tombol **"Cutover (Jurnal Pembukaan)"** di header
2. Wizard buka — tunggu loading **"Auto-computed (server-side)"** display:
   - Persediaan Kitchen: harus match sum (kitchen ingredient.currentStock × cost_per_unit)
   - Persediaan Bar: harus match sum (bar)
   - Persediaan Pendukung: harus match sum (supporting + cleaning + null)
   - Hutang Dagang outstanding: harus match Suppliers → Hutang Dagang tab total
   - Kalau ada angka yang tidak masuk akal, **STOP** — fix data inventory/purchase dulu, baru ulang
3. Input saldo per 31 Mei 2026:
   - **Kas Tunai (Drawer)**: hasil hitungan fisik kas drawer POS
   - **Kas Tunai (Brankas)**: hasil hitungan fisik kas di brankas
   - **Bank BCA**: saldo dari mutasi rekening
   - **Bank BRI**: saldo dari mutasi rekening
   - **Bank Lain**: 0 kalau tidak ada
   - **Piutang QRIS / EDC / GoFood / GrabFood / ShopeeFood**: outstanding belum settle per 31 Mei
   - **Biaya Dibayar Dimuka**: mis. sewa Juni dibayar Mei = isi nilai prepaid
   - **Modal Owner**: initial capital + tambahan setoran
   - **Saldo Laba Ditahan**: 0 kalau fresh start
4. Footer wizard tampilkan total Dr vs Cr — pastikan **"Balance"** (hijau)
5. Kalau "Selisih" merah/orange:
   - Kalau `Dr > Cr` → tambah Modal Owner atau Saldo Laba sampai balance
   - Kalau `Cr > Dr` → kurangin Modal Owner atau cek input lain (mungkin ada angka yang kurang seperti bank/piutang)
6. Sesudah balance hijau → klik **"Post Jurnal Pembukaan"**
7. Toast hijau muncul: "Jurnal Pembukaan JE-202605-0001 terposting. Periode 2026-05 dikunci."
8. Wizard close otomatis

### Step 3: Verify Cutover Result

1. Akuntansi → tab **Jurnal**
2. Verify entry baru muncul `JE-202605-0001` dengan source "opening_balance", status "posted"
3. Klik entry untuk expand — verify lines balance dan akun benar
4. Akuntansi → tab **Periode** — verify periode 2026-05 status "Locked" (otomatis lock setelah opening balance posted)
5. Akuntansi → tab **Laporan** → klik tab **Neraca** — set "Per tanggal" = 2026-05-31
   - Verify Total Aset = Total Kewajiban + Ekuitas (footer hijau "Balanced")
   - Spot-check: angka kas, bank, persediaan, hutang dagang sesuai input

### Step 4: Verify Validation Drift = 0

1. Akuntansi → Laporan → tab **Validasi Drift**
2. "Per tanggal" = 2026-05-31
3. Expected output: 3 row, semua **OK** badge hijau:
   - Kas Tunai: Buku Besar = Sumber (cashOnHand snapshot)
   - Persediaan: Buku Besar = Sumber (sum ingredients × cost)
   - Hutang Dagang: Buku Besar = Sumber (sum purchases pending_payment)
4. Kalau ada **Critical** badge merah → **STOP** — investigasi dulu (lihat §Troubleshooting)

### Step 5: Aktivasi Auto-Journal Flag

1. Settings → klik Edit di card "Threshold & Features"
2. Toggle **"Auto-Journal Akuntansi"** → ON
3. Save
4. Toast hijau "Settings tersimpan"

### Step 6: Smoke Test Auto-Journal

1. POS → buka shift dummy (kas Rp 100.000)
2. Buat transaksi cash kecil (Rp 50.000 espresso) → bayar tunai Rp 50.000
3. Tutup shift dummy (variance = 0)
4. Admin → Akuntansi → Jurnal — verify 2 entry baru:
   - `JE-202606-0001` source "pos_sale" (Dr 1101 50k, Cr 4102 50k + COGS lines kalau ada recipe)
   - (Tidak ada shift_variance entry karena variance = 0)
5. Akuntansi → Laporan → Validasi Drift → "Per tanggal" hari ini — masih semua OK?
6. **Kalau OK** → 🎉 Auto-journal active, kafe lanjut buka normal mode
7. **Kalau ada drift Critical** → toggle flag OFF, investigasi, fix, retry

---

## 📅 First-Week Monitoring (1-7 Juni 2026)

### Daily (sebelum buka kafe)

- [ ] Akuntansi → Validasi Drift "Per tanggal" hari ini — semua OK?
- [ ] Kalau Warning (drift < 1%) → catat angka, monitor trend
- [ ] Kalau Critical (drift > 1%) → **toggle Auto-Journal OFF**, escalate ke developer

### Mid-week (Rabu)

- [ ] Akuntansi → Laporan → Trial Balance, periode "1 Juni → hari ini" — verify balanced
- [ ] Akuntansi → Laporan → Buku Besar, akun 1101 Kas Tunai — saldo akhir match getCashOnHand?

### End of week (Sabtu / Minggu)

- [ ] Akuntansi → Laporan → Laba Rugi, periode "1 Juni → 7 Juni"
   - Cross-check vs existing P&L di Laporan section (sesi 5)
   - Net Income harus konsisten (atau bedanya bisa dijelaskan: e.g., aggregator settlement belum masuk)

---

## 🗓️ End-of-Month: Tutup Periode Pertama (akhir Juni 2026)

### Step 1: Pre-Close Checklist

- [ ] Semua transaksi Juni sudah ter-input (POS, expense, income, purchase, payroll)
- [ ] Aggregator settlement Juni sudah di-input via Finance → Rekonsiliasi (bank statement Juni harus sudah keluar)
- [ ] Stok opname akhir bulan finalized (kalau ada cadence bulanan)
- [ ] Payroll Juni mark-paid (kalau gaji bulan Juni dibayar awal Juli, postpone close sampai gaji ter-bayar)

### Step 2: Run Period Close

1. Akuntansi → Periode → row "Juni 2026" status "Open" → klik tombol checkmark hijau (Tutup Periode)
2. Confirm dialog: "Tutup periode Juni 2026? Closing entry akan generate..."
3. Kalau ada draft entries: error "X entri draft belum di-post" → kembali ke Jurnal, post atau discard semua draft → coba lagi
4. Kalau OK: closing entry generated otomatis, periode flip ke "Closed"
5. Toast hijau: "Periode ditutup. Closing entry: JE-202606-XXXX"

### Step 3: Verify Closing Entry

1. Jurnal → cari `JE-202606-XXXX` source "period_close"
2. Expand — verify struktur:
   - Dr semua revenue accounts (4101, 4102, 4104, dll yang ada balance)
   - Cr semua kontra-revenue + cogs + expense
   - Net Dr/Cr 3302 (Laba Rugi Berjalan) — equal sum revenue net
   - Dr/Cr 3301 (Saldo Laba Ditahan) — net profit/loss transferred

### Step 4: Cross-Check Reports Juni 2026

1. Laporan → Laba Rugi, periode 1-30 Juni — note Net Income angka X
2. Laporan → Neraca, "Per tanggal" 30 Juni — verify Saldo Laba Ditahan bertambah ≈ X (kalau profit) atau berkurang ≈ X (kalau loss)
3. Laporan → Validasi Drift, "Per tanggal" 30 Juni — semua OK?
4. Cross-check Net Income vs existing P&L di Laporan section — bedanya bisa dijelaskan?

### Step 5: Lock Period (Opsional)

Setelah Owner yakin semua angka final dan tidak akan diubah lagi:
1. Periode → row Juni → klik tombol shield (Lock)
2. Confirm: **IRREVERSIBLE** dialog
3. Periode flip ke "Locked" — tidak ada entry baru bisa post di periode ini, tidak bisa reopen via UI

**Catatan**: Lock dibuat untuk audit trail integrity. Kalau Owner ragu-ragu, biarkan "Closed" dulu (bisa reopen). Lock setelah audit eksternal selesai (kalau ada).

---

## 🚨 Troubleshooting Drift

### Kas Tunai Drift Critical

**Possible causes:**
1. Setoran tunai diverify TANPA auto-journal flag ON di tanggal sebelumnya — manual fix: post manual journal entry Dr Bank Cr 1101 untuk match
2. Shift variance hook gak fire (auto-journal flag OFF saat shift close) — manual fix: post manual journal Dr/Cr 6902 + 1101
3. Owner edit cash_deposits.amount manual via DB tanpa repost journal — manual fix: reverse old journal + post correct
4. Cash deposit bank_destination ke akun yang gak ada di COA fallback (1112 default kalau gak match BCA/BRI) — verify bankAccountCode mapping

**Quick fix path:**
1. Akuntansi → Jurnal → cari semua entry sourceType=cash_deposit_verified bulan ini
2. Cross-check vs Finance → Setoran Tunai tab "Verified" filter — list match?
3. Kalau ada cash deposit verified TANPA journal entry → toggle flag ON sementara, run "Re-verify" via DB UPDATE: set status='pending_verification' → verify lagi (hook akan fire) → atau post manual journal

### Persediaan Drift Critical

**Possible causes:**
1. Opname finalize TANPA auto-journal flag ON — manual fix: post manual journal sesuai diff per section
2. Purchase create/cancel TANPA flag ON — same
3. Cost_per_unit ingredient diubah Owner (mis. update harga beli) — perubahan cost tidak otomatis revaluate persediaan. Need manual journal: Dr/Cr 1140-1142 untuk delta value, counter Dr/Cr 6903 (treat sebagai opname adjustment)

**Quick fix path:**
1. Akuntansi → Jurnal → filter sourceType=purchase_create / opname_adjustment
2. Cross-check vs Inventory → Pergerakan tab — list movement match?
3. Run smoke test inventory: post 1 dummy purchase → verify persediaan ledger naik sesuai amount

### Hutang Dagang Drift Critical

**Possible causes:**
1. Purchase TOP create TANPA flag ON
2. Mark-paid TANPA flag ON
3. Cancel purchase yang sebelumnya pending_payment
4. Owner edit purchases.status manual via DB

**Quick fix path:**
1. Akuntansi → Jurnal → filter sourceType=purchase_pay or purchase_cancel
2. Cross-check vs Suppliers → Hutang Dagang tab list pending vs paid

### Kalau Drift Tidak Bisa Resolve

1. **Toggle Auto-Journal Flag OFF** dulu — stop bleeding
2. Reverse semua journal entries di periode kalau memungkinkan
3. Re-run Cutover Wizard kalau perlu (kalau opening balance salah)
4. Escalate developer dengan:
   - Screenshot Validasi Drift tab
   - List entries yang suspect (Akuntansi → Jurnal filter)
   - Sumber data yang tidak match (mis. screenshot Finance Setoran Tunai vs ledger)

---

## 🛠️ Common Manual Journal Scenarios

### Owner Kasbon / Pinjam Kas

**Scenario**: Galih kasbon Rp 200rb dari kas drawer, akan deduct dari gaji bulan depan.

**Manual Journal**:
1. Akuntansi → Jurnal → Buat Entry Manual
2. Tanggal: hari kasbon
3. Deskripsi: "Kasbon Galih (deduct payroll Juli)"
4. Lines:
   - Dr `1130 Piutang Karyawan (Kasbon)` Rp 200.000
   - Cr `1101 Kas Tunai (Drawer POS)` Rp 200.000
5. Status: Posted (Owner) atau Draft (Manager → Owner approve)

Saat payroll bulan depan: deduct dari gaji + manual entry settle:
- Dr `6101 Gaji Karyawan` net pay - 200k
- Dr `1130 Piutang Karyawan` -200k (Cr 200k untuk reverse piutang)
- Cr `1101 Kas Tunai` net pay paid

### Bank Charge Bulanan

**Scenario**: Bank BCA potong admin fee Rp 17.500 di akhir bulan.

**Manual Journal**:
1. Tanggal akhir bulan
2. Deskripsi: "Admin fee BCA Mei"
3. Lines:
   - Dr `6403 Biaya Bank` Rp 17.500
   - Cr `1110 Bank BCA` Rp 17.500

### Sewa Dibayar Dimuka

**Scenario**: Bayar sewa 12 bulan dimuka Rp 36 jt.

**Manual Journal saat bayar**:
- Dr `1150 Biaya Dibayar Dimuka` Rp 36.000.000
- Cr `1110 Bank BCA` Rp 36.000.000

**Manual Journal akhir tiap bulan** (alokasi):
- Dr `6201 Sewa Tempat` Rp 3.000.000
- Cr `1150 Biaya Dibayar Dimuka` Rp 3.000.000

### Penambahan Modal Owner

**Scenario**: Owner setor tambahan modal Rp 5 jt ke kas.

**Manual Journal**:
- Dr `1101 Kas Tunai` Rp 5.000.000
- Cr `3101 Modal Owner` Rp 5.000.000

### Prive (Owner Withdraw)

**Scenario**: Owner ambil Rp 2 jt dari bank untuk personal.

**Manual Journal**:
- Dr `3201 Prive Owner` Rp 2.000.000
- Cr `1110 Bank BCA` Rp 2.000.000

---

## 📞 Escalation

Kalau ada masalah yang tidak bisa di-resolve via runbook:
1. Screenshot semua: Validasi Drift, Trial Balance period berjalan, Neraca per tanggal hari ini
2. Export journal entries period yang bermasalah (manual: copy-paste dari Akuntansi → Jurnal)
3. Catat exact steps yang lead to drift (tanggal, action, hasil)
4. Toggle Auto-Journal OFF kalau drift ongoing
5. Hubungi developer

---

## 📝 Change Log

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 2026-05-02 | Initial runbook untuk sesi W field validation |
