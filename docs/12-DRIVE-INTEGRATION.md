# Google Drive Integration — Setup Guide (OAuth variant)

**Untuk:** Mahakan POS — receipts/dokumen ke Google Drive
**Sesi:** AA #2 (Opsi B — OAuth user delegation), 2026-05-04
**Estimasi waktu:** ~10 menit (sebagian besar tunggu propagation)

---

## Konteks + Modul yang ter-integrasi

Sesi AA #2 + extension: 3 modul Mahakan POS sekarang upload langsung ke
folder Google Drive Owner, dengan struktur subfolder otomatis:

```
MAHAKAN COFFEE/                                    ← root parent
  NOTA MAHAKAN/                                    ← purchase receipts (Inventory → Pembelian)
    NOTA MAHAKAN 2026/
      01. JANUARI / 02. FEBRUARI / ... / 12. DESEMBER /
    NOTA MAHAKAN 2027 / ...
  DOKUMEN HR/                                      ← HR documents (Karyawan)
    Charlotte Hillary (a1b2c3d4)/                  ← per-karyawan folder
      KTP_xxx.jpg, BPJS_xxx.pdf, Kontrak_xxx.pdf
    Galih Pratama (e5f6g7h8)/
      ...
  STRUK PENGELUARAN/                               ← expense receipts (Kas)
    2026/
      01. JANUARI / 02. FEBRUARI / ... /
  BUKTI JURNAL/                                    ← bukti transfer/nota entry jurnal manual (sesi AE-206)
    2026/
      01. JANUARI / 02. FEBRUARI / ... /
```

Folder `NOTA MAHAKAN`, `DOKUMEN HR`, `STRUK PENGELUARAN`, `BUKTI JURNAL` + subfolder
year/month/employee semua **auto-created** di first upload module
masing-masing. Owner cuma perlu kasih ID parent folder MAHAKAN COFFEE.

**Kenapa OAuth, bukan Service Account?**
Service Account TIDAK punya storage quota di personal Gmail account
(Google policy — service accounts cuma boleh upload ke Workspace Shared
Drives, yang berbayar). Untuk personal Gmail, kita pakai **OAuth user
delegation**: Owner authorize 1× pakai akun Gmail, app act atas nama
Owner, file count terhadap Owner's 15GB Gmail quota. File tetap owned
by Owner, tetap di folder Owner.

---

## Step 1 — Setup Google Cloud Console (~5 menit)

> **Catatan:** kalau Anda sudah selesai Step 1 versi Service Account
> sebelumnya (project sudah ada + Drive API sudah enabled), lewati ke
> Step 1.4 (buat OAuth Client) saja.

### 1.1 Project + Drive API
1. Buka https://console.cloud.google.com (login dengan Gmail Owner)
2. Project selector atas → **NEW PROJECT** → name: `Mahakan POS Drive` → CREATE
3. Pastikan project barusan ke-pilih
4. Sidebar → **APIs & Services** → **Library** → search `Google Drive API` → **ENABLE**

### 1.2 OAuth Consent Screen
5. Sidebar → **APIs & Services** → **OAuth consent screen**
6. User Type: **External** → CREATE
7. App name: `Mahakan POS` → User support email: pilih Gmail Anda
8. Developer contact email: Gmail Anda → SAVE AND CONTINUE
9. **Scopes:** klik ADD OR REMOVE SCOPES → search `drive.file` → centang
   `https://www.googleapis.com/auth/drive.file` → UPDATE → SAVE AND CONTINUE
10. **Test users:** ADD USERS → masukkan email Gmail Anda → SAVE AND CONTINUE
11. Summary → BACK TO DASHBOARD

> **Penting:** App tetap di mode "Testing" (gak perlu Verification Google).
> Refresh token untuk Test User TIDAK expire setelah 7 hari (myth umum).
> Hanya untuk app published unverified yang refresh token expire.
> Source: https://developers.google.com/identity/protocols/oauth2#expiration

### 1.3 OAuth Client ID
12. Sidebar → **APIs & Services** → **Credentials**
13. Klik **+ CREATE CREDENTIALS** → **OAuth client ID**
14. Application type: **Web application**
15. Name: `Mahakan POS OAuth`
16. **Authorized redirect URIs** → ADD URI → masukkan:
    ```
    http://localhost:8765/callback
    ```
17. Klik **CREATE**
18. Modal muncul dengan **Client ID** + **Client secret** — copy keduanya,
    simpan sementara (Notepad/notes app).

✅ GCP setup selesai.

---

## Step 2 — Authorize via CLI (1× di laptop Owner) (~3 menit)

### 2.1 Set credentials di .env.local lokal

Di repo Mahakan POS lokal Anda, edit (atau buat) file `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=<paste Client ID dari Step 1.18>
GOOGLE_OAUTH_CLIENT_SECRET=<paste Client Secret dari Step 1.18>
```

> ⚠️ Jangan commit `.env.local` ke git (sudah di `.gitignore`).

### 2.2 Jalankan auth script

Di terminal, dari repo root:

```bash
npm run drive:auth
```

Script akan:
1. Print URL Google consent — copy paste ke browser
2. Browser → login Gmail Owner → "Continue" pada warning "Google hasn't verified this app" → klik nama app → ALLOW akses Drive
3. Browser auto-redirect ke `localhost:8765` → tab muncul "✅ Authorized!"
4. Terminal print refresh token

### 2.3 Catat refresh token

Output terminal:
```
PASTE INI KE VERCEL ENV VARS:

  GOOGLE_OAUTH_REFRESH_TOKEN=1//0gXxx...long string...
```

Copy bagian setelah `=`.

---

## Step 3 — Set/update env vars di Vercel (~2 menit)

1. Buka https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/settings/environment-variables

2. **Tambah/update 4 env vars** (Production + Preview):
   - `GOOGLE_OAUTH_CLIENT_ID` = (dari Step 1.18)
   - `GOOGLE_OAUTH_CLIENT_SECRET` = (dari Step 1.18)
   - `GOOGLE_OAUTH_REFRESH_TOKEN` = (dari Step 2.3)
   - `GOOGLE_DRIVE_ROOT_PARENT_ID` = ID folder **MAHAKAN COFFEE** (root, parent dari NOTA MAHAKAN). Copy dari URL Drive (segmen setelah `/folders/`), contoh: `1k9ZIW0TTb1RwEcOb3pW2sAI0qyt4X6h-`. Modul subfolder (NOTA MAHAKAN, DOKUMEN HR, STRUK PENGELUARAN) auto-created saat first upload.

3. **Hapus env var lama** (sudah tidak dipakai):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — klik Delete
   - `GOOGLE_DRIVE_NOTA_PARENT_ID` — klik Delete (digantikan ROOT_PARENT_ID; tetap backward-compat — kalau Anda lupa hapus, purchase modul masih jalan)

---

## Step 4 — Hapus folder share lama (opsional, 30 detik)

Service account email yang sebelumnya Anda share ke folder NOTA MAHAKAN
sudah tidak diperlukan. Untuk kebersihan:

1. Buka folder NOTA MAHAKAN di Drive
2. Klik kanan → Share → cari email service account (`mahakan-pos-uploader@xxx.iam.gserviceaccount.com`)
3. Klik dropdown → Remove access

> Tidak akan break apa-apa kalau di-skip — service account memang sudah
> tidak punya use case lagi.

---

## Step 5 — Redeploy + tes

Saya akan jalankan deploy `npx vercel --prod --yes` setelah Anda confirm
3 env vars di-set. Lalu tes upload pertama:

1. Hard refresh browser (Cmd/Ctrl + Shift + R)
2. Inventory → Pembelian → **+ Catat Pembelian** → isi 1 item dummy
3. Klik **Upload Foto / PDF** → pilih file
4. Toast harus muncul: `Bukti tersimpan di Drive · NOTA MAHAKAN 2026/05. MEI`
5. Klik link "Lihat di Google Drive" → file ke-buka di Drive viewer
6. Cek di Drive: folder `NOTA MAHAKAN/NOTA MAHAKAN 2026/05. MEI/` — file ada

---

## Troubleshooting

### Step 2 script — "Tidak dapat refresh_token"
Anda sebelumnya sudah authorize app ini, jadi Google skip kasih refresh
token (cuma kasih access token short-lived). Solusi:
1. Buka https://myaccount.google.com/permissions
2. Cari nama OAuth client (`Mahakan POS OAuth`)
3. Klik → Remove access
4. Re-run `npm run drive:auth`

### Browser warning "Google hasn't verified this app"
Normal untuk app di mode Testing dengan scope drive.file. Klik:
- **Advanced** (link kecil di kiri-bawah)
- **Go to Mahakan POS (unsafe)**

Owner bisa proceed dengan aman karena Anda sendiri yang setup app.

### "redirect_uri_mismatch" error
Step 1.16 (Authorized redirect URIs) belum di-set persis ke
`http://localhost:8765/callback`. Cek typo, save ulang.

### "User does not have sufficient permissions for file" saat upload
Folder `GOOGLE_DRIVE_NOTA_PARENT_ID` tidak owned by user yang authorize,
ATAU user yang authorize tidak punya Editor access ke folder itu. Pastikan
Owner yang authorize adalah owner folder NOTA MAHAKAN.

### "API has not been used in project" error
Step 1.4 (enable Google Drive API) belum dilakukan.

---

## Keamanan

- Refresh token = setara password Owner untuk Drive (scope `drive.file`
  saja — app cuma bisa baca/tulis file yang dia create + folder yang
  Owner pilih, BUKAN seluruh Drive).
- JANGAN commit refresh token ke git.
- Kalau bocor: revoke di https://myaccount.google.com/permissions, re-run
  `npm run drive:auth`, update env var Vercel.
- File baru di-upload owned by Owner (Anda) — count terhadap 15GB Gmail
  quota Anda. Receipts ~1 MB jadi ratusan tahun ga habis.
- Anyone-with-link reader = file accessible via URL, tapi URL hanya
  tersimpan di DB Mahakan POS + di Drive Anda — tidak public-listed.

---

## Rollback (kalau perlu)

Kalau mau nonaktifkan Drive integration sementara:
1. Hapus 3 env vars OAuth + GOOGLE_DRIVE_NOTA_PARENT_ID di Vercel
2. Redeploy → upload route return error 500 "DRIVE_NOT_CONFIGURED"
3. Tim purchasing tidak bisa upload sampai env vars di-restore atau
   kode revert ke pattern Vercel Blob

File yang sudah ke-upload ke Drive **tetap di Drive** — tidak ikut hapus.
URL tersimpan di `purchases.receipt_image_url` tetap valid.
