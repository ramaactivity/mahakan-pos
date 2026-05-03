# Google Drive Integration — Setup Guide

**Untuk:** Mahakan POS — bukti pembelian (purchase receipts) ke Google Drive
**Sesi:** AA #2 (Opsi B), 2026-05-03
**Estimasi waktu:** ~10 menit

---

## Konteks

Sebelum sesi ini, Owner mengumpulkan seluruh nota di Google Drive folder:
```
MAHAKAN COFFEE / NOTA MAHAKAN /
  NOTA MAHAKAN 2026 /
    01. JANUARI / 02. FEBRUARI / ... / 12. DESEMBER /
  NOTA MAHAKAN 2027 / ...
```

Sesi AA Opsi B mengintegrasikan Mahakan POS supaya upload bukti
pembelian dari tab "Catat Pembelian" **langsung** masuk ke folder ini —
auto-create subfolder tahun + bulan kalau belum ada. Sehingga:

- Workflow Owner tidak berubah (semua nota tetap di Drive).
- Akuntan eksternal tetap akses lewat Drive yang familiar (no Mahakan login).
- File auto-named dengan tanggal pembelian + timestamp + nama original.
- Anyone-with-link reader permission → URL aman di-paste ke chat akuntan.

---

## Step 1 — Buat Service Account di Google Cloud (5 menit)

1. Buka https://console.cloud.google.com (login dengan akun Google
   yang **own** folder NOTA MAHAKAN — ini penting nanti untuk share).
2. Klik dropdown project di pojok kiri-atas → **NEW PROJECT**.
   - Project name: `Mahakan POS Drive` (atau bebas)
   - Klik **CREATE**, tunggu ~10 detik sampai project aktif.
3. Pastikan project barusan ke-pilih (cek di dropdown atas).
4. Sidebar kiri (☰ menu) → **APIs & Services** → **Library**.
5. Search `Google Drive API` → klik hasilnya → klik **ENABLE**.
6. Sidebar kiri → **IAM & Admin** → **Service Accounts**.
7. Klik **+ CREATE SERVICE ACCOUNT** di atas.
   - Name: `mahakan-pos-uploader`
   - ID: auto-fill (biarkan)
   - Description: `Upload purchase receipts dari Mahakan POS`
   - Klik **CREATE AND CONTINUE**
8. Step 2 (Grant access) → **SKIP** (klik CONTINUE — kita kasih akses
   via folder share, bukan project-level role).
9. Step 3 → klik **DONE**.
10. Service account barusan muncul di list. Klik nama-nya.
11. Tab **KEYS** di atas → **ADD KEY** → **Create new key** →
    pilih **JSON** → **CREATE**.
12. File JSON otomatis ke-download. Simpan, jangan share publicly.
    Filename biasanya: `mahakan-pos-drive-xxxx.json`.

---

## Step 2 — Share folder NOTA MAHAKAN ke service account (1 menit)

1. Buka file JSON yang barusan di-download (text editor).
2. Cari field `"client_email"`. Value-nya berbentuk:
   ```
   mahakan-pos-uploader@mahakan-pos-drive-xxxxx.iam.gserviceaccount.com
   ```
   **Copy** email ini.
3. Buka folder NOTA MAHAKAN di Drive:
   https://drive.google.com/drive/folders/1jeWbV75ElGiLdtcT7GTAHj6XZbEfOK1F
4. Klik kanan nama folder (di breadcrumb atas) → **Share** → **Share**.
5. Paste email service account → role pilih **Editor** → **Send**.
   (Notify centang gak penting karena ini bukan email manusia.)

✅ Service account sekarang bisa baca + tulis ke folder ini.

---

## Step 3 — Set 2 env vars di Vercel (3 menit)

1. Buka https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/settings/environment-variables
2. Klik **Add New** → setup variable pertama:
   - Key: `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Value: **Copy seluruh isi file JSON** yang di-download tadi
     (mulai `{` sampai `}` terakhir, satu blob).
   - Environment: pilih semua (Production + Preview + Development) atau
     Production saja kalau lebih aman.
   - Klik **Save**.
3. Klik **Add New** lagi → variable kedua:
   - Key: `GOOGLE_DRIVE_NOTA_PARENT_ID`
   - Value: `1jeWbV75ElGiLdtcT7GTAHj6XZbEfOK1F`
     (Ini ID folder NOTA MAHAKAN — sudah saya extract dari URL share Anda.)
   - Environment: sama seperti di atas.
   - Klik **Save**.

---

## Step 4 — Redeploy (~2 menit)

Vercel umumnya auto-redeploy saat env vars berubah. Kalau tidak:

1. Buka https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/deployments
2. Deploy paling atas (most recent) → klik `⋯` → **Redeploy**.
3. Centang "Use existing Build Cache" → **Redeploy**.

Atau Anda bisa kasih tahu saya, saya jalankan `npx vercel --prod --yes`
dari local.

---

## Step 5 — Tes

1. Login ke https://mahakan-pos.vercel.app sebagai Owner.
2. Inventory → Pembelian → **+ Catat Pembelian**.
3. Isi 1 item dummy.
4. Klik **Upload Foto / PDF** di section "Bukti Pembelian / Transfer".
5. Pilih file PDF/JPG.
6. Toast harus muncul: `Bukti tersimpan di Drive · NOTA MAHAKAN 2026/05. MEI`.
7. Klik link ke "Lihat di Google Drive" — file ke-buka di Drive viewer.
8. Cek di Drive: folder `NOTA MAHAKAN/NOTA MAHAKAN 2026/05. MEI/` —
   file harus ada dengan nama `2026-05-03_<timestamp>_<filename>`.

---

## Troubleshooting

### "GOOGLE_SERVICE_ACCOUNT_JSON env var belum di-set"
Step 3 belum dilakukan, atau redeploy belum jalan.

### "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid"
JSON di-edit tidak sengaja saat copy-paste. Buka ulang file `.json`,
copy lagi seluruh isi tanpa edit.

### "User does not have sufficient permissions for file"
Step 2 belum dilakukan, atau email service account salah ketik.
Re-cek field `client_email` di JSON, share ulang folder.

### "File too large" (upload error)
Receipt > 5 MB. Compress dulu (foto dari HP biasanya bisa < 1 MB
kalau pakai mode "Document" atau setting kompresi sedang).

### Folder year/month tidak ke-create
Service account dapet "Editor" bukan "Viewer"? Re-cek di Drive
folder share dialog.

### "API has not been used in project" error
Step 1.5 belum: enable **Google Drive API** di Library. Penting,
beda dari Drive App SDK / Google Workspace API.

---

## Keamanan

- File JSON service account = **kunci rahasia**. JANGAN commit ke git,
  JANGAN share di chat. `.gitignore` sudah cover `*.json` di root,
  tapi tetep hati-hati taruh dimana.
- Service account hanya punya akses ke folder NOTA MAHAKAN (yang Anda
  share manual). Tidak bisa baca Drive Anda yang lain.
- Anyone-with-link reader = file bisa di-akses siapa saja yang punya URL.
  URL tersimpan di DB Mahakan POS + di Drive Anda — tidak public-listed.
  Kalau perlu strict, bisa di-tighten ke "Specific people" via Drive
  share dialog per file (overhead manual).
- Service account email tidak bisa login ke Mahakan POS (RBAC scope).

---

## Rollback (kalau perlu)

Kalau mau revert ke Vercel Blob:
1. Hapus 2 env vars di Vercel → redeploy.
2. Upload route akan return error 500 "DRIVE_NOT_CONFIGURED" —
   tim purchasing tidak bisa upload sampai env vars di-restore atau
   kode revert ke pattern Blob.
3. File yang sudah ke-upload ke Drive **tetap di Drive** — tidak ikut
   ke-hapus. URL tersimpan di `purchases.receipt_image_url` tetap valid.

---

## Catatan Owner

- Folder ID `1jeWbV75ElGiLdtcT7GTAHj6XZbEfOK1F` dari URL Drive Anda. Kalau
  pindah folder atau ganti parent, update env var `GOOGLE_DRIVE_NOTA_PARENT_ID`.
- Quota Drive API gratis: 1 milyar request/hari per project. Mahakan POS
  pakai ~5 request per upload (1 list + 1 create folder + 1 upload + 1
  permission + 1 metadata fetch). Tidak akan kena quota selama Anda hidup.
- Kalau ada outlet baru, cukup tambah env var pakai folder ID baru — atau
  pakai folder yang sama, kode auto-create year/month subfolder per
  outlet (semua outlet share parent).
