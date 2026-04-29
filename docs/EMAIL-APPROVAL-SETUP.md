# Setup Email Approval Code (Gmail SMTP)

Cara setup email auto-send untuk approval code void/refund pakai Gmail biasa, tanpa biaya, tanpa Google Workspace.

## TL;DR

1. Aktifkan 2-Step Verification di akun Gmail Owner (sekali saja).
2. Generate App Password 16-digit khusus untuk Mahakan POS.
3. Paste 2 env vars di Vercel project: `GMAIL_USER` + `GMAIL_APP_PASSWORD`.
4. Test: kasir minta refund → cek email Owner → input code → refund jalan.

Estimasi waktu: **5 menit**.

---

## 1. Aktifkan 2-Step Verification (sekali doang per akun)

Kalau sudah aktif, lewati ke langkah 2.

1. Buka https://myaccount.google.com/security
2. Cari section "How you sign in to Google" → klik "2-Step Verification"
3. Ikuti wizard (pakai HP nomor verifikasi atau aplikasi authenticator)
4. Selesai → balik ke halaman security; sekarang muncul section "App passwords"

**Kenapa harus 2-Step?** Google cuma kasih App Password kalau akun pakai 2FA — proteksi extra.

## 2. Generate App Password

1. Buka https://myaccount.google.com/apppasswords
   (kalau gak muncul: cek 2-Step Verification step 1 sudah selesai belum)
2. Field "App name" → ketik `Mahakan POS`
3. Klik "Create"
4. Google tampilin password 16 karakter (4 grup, contoh: `abcd efgh ijkl mnop`)
5. **Copy passwordnya sekarang** — Google gak bakal tampilin lagi setelah dialog ditutup

> **Tips:** simpan di password manager (1Password / Bitwarden / Apple Keychain). Kalau hilang, generate baru aja — App Passwords gak punya rate limit.

## 3. Set env vars di Vercel

1. Buka https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/settings/environment-variables
2. Klik "Add New"
3. Tambah dua env var:

   | Key | Value | Environments |
   |---|---|---|
   | `GMAIL_USER` | email Gmail Owner (contoh: `workwithrama98@gmail.com`) | Production, Preview, Development |
   | `GMAIL_APP_PASSWORD` | 16-digit App Password dari step 2 (boleh tanpa spasi: `abcdefghijklmnop`) | Production, Preview, Development |

4. Save
5. Redeploy: Vercel → Deployments → tap "..." pada latest deployment → Redeploy
   (atau push commit baru → otomatis redeploy)

## 4. Aktifkan Code Mode di Mahakan POS

1. Login Owner di https://mahakan-pos.vercel.app/login
2. Sidebar → "Pengaturan"
3. Card "Receipt, Threshold & Feature Flags" → klik tombol **Edit**
4. Scroll ke section "Approval Void / Refund"
5. Toggle ON salah satu (atau dua-duanya):
   - **Void pakai Kode Email (Owner-only)**
   - **Refund pakai Kode Email (Owner-only)**
6. (Opsional) "Email override" — kosongin aja, default = email Owner pertama (yang udah di-set di Pengaturan → akun Owner)
7. Klik **Simpan**

## 5. Test Flow

1. Login Staff atau Manager
2. Tab Riwayat → tap transaksi paid → tap **Void** atau **Refund**
3. Pilih alasan, klik Submit → modal "Approval Code" terbuka
4. Tap **Minta Kode dari Owner**
5. Buka inbox Gmail Owner — email subject `[Mahakan POS] Kode Approval Void/Refund — TRX ...`
   - Body email berisi kode 6-digit dengan font besar
6. Owner forward kode ke staff via WhatsApp
7. Staff input kode di POS → tap **Approve** → void/refund berhasil
8. Audit log: `Pengaturan → Audit Log` → filter `approval_code.consume` muncul

## Troubleshooting

**Email tidak masuk:**
- Cek spam folder
- Cek env vars `GMAIL_USER` + `GMAIL_APP_PASSWORD` benar (re-deploy setelah set)
- Cek Vercel deployment logs → cari error "Gmail SMTP" — biasanya credential salah
- Cek Audit Log → filter `approval_code.email_failed` — tampil error message

**Kode salah / "Tidak ada kode aktif":**
- Kode expired (default 10 menit). Tap "Minta kode baru" di modal.
- Owner generate kode untuk transaksi LAIN — kode binding ke TRX spesifik.
- Salah input >5x → kode auto-locked. Minta kode baru.

**Mau revoke kode aktif:**
- Owner login → Pengaturan → scroll ke section "Approval Codes (Void/Refund)"
- Tap tombol **Revoke** di baris kode yang dimaksud

**Mau switch balik ke PIN mode:**
- Pengaturan → Edit Tunables → Approval section → toggle OFF Void/Refund Code Email → Simpan
- Mode kembali ke legacy PIN (Manager/Owner approve via PIN di tablet kasir)

## Limit & Pricing

- Gmail SMTP App Password: **gratis**, ~500 email/day per akun (Mahakan estimasi <10/day, jauh dari limit)
- Email keluar dari `<GMAIL_USER>` (Owner Gmail), display name auto-prefix `Mahakan POS <...>`
- Tidak butuh domain custom, tidak butuh Google Workspace berbayar
- Reliability deliverability: bagus (Gmail-to-Gmail delivery hampir 100%)

## Alternative: Resend (kalau scale naik)

Resend (https://resend.com) gratis 100 email/day, butuh signup + API key. Cocok kalau:
- Mau email branded `noreply@mahakancoffee.id` (butuh domain + DNS records)
- Mau dashboard tracking lengkap
- Volume >500/day (tapi Mahakan jauh dari ini)

Code sudah support both — set `RESEND_API_KEY` aja, otomatis dipakai. Atau kalau dua-dua di-set, Gmail menang (preferred).

## Tanpa Setup (Dev Mode)

Kalau env Gmail/Resend kosong, code falls back ke **dev mode console log**: kode di-print ke server log Vercel, gak terkirim. Berguna untuk testing tanpa nyetup email infra. Cek Vercel deployment logs → cari `[email/send] DEV MODE`.
