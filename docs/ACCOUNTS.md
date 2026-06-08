# ACCOUNTS — Akun yang BENAR untuk POS Mahakan

> ⚠️ **WAJIB BACA SEBELUM DEPLOY.** Deploy HARUS selalu pakai akun Vercel yang sama
> (yang sudah proven works). Kalau lagi login pakai akun lain → STOP, ganti dulu.

## ✅ Akun Vercel yang BENAR (PRODUCTION) — satu-satunya

| Field | Nilai |
|---|---|
| Email | `rama.activity98@gmail.com` |
| Team / scope | **`ramaactivity98-5695s-projects`** (plan: Hobby) |
| URL dashboard | https://vercel.com/ramaactivity98-5695s-projects |
| Project | **mahakan-pos** |
| Project ID | `prj_F9wxXfdniysOLSJWtM9kvIaWlroK` (✓ cocok dgn `.vercel/project.json`) |
| Org ID | `team_BSJVaxRgvlGYUgzntvcZZwcD` |
| URL produksi | https://mahakan-pos.vercel.app |

## ❌ Akun yang SALAH (JANGAN dipakai deploy)

| Field | Nilai |
|---|---|
| Team / scope | `masram-s-projects` ("Masram's projects") |

> Catatan: per 2026-06-08, Vercel CLI di mesin ini sedang **login ke akun SALAH
> (`masram-s-projects`)**. Sebelum deploy WAJIB ganti ke `ramaactivity98-5695s-projects` dulu.

## Cara CEK akun sebelum deploy (WAJIB)

```bash
npx vercel teams ls
```

Tanda ✔ **harus** di baris `ramaactivity98-5695s-projects`.
Kalau ✔ ada di `masram-s-projects` atau akun lain → **JANGAN deploy** → ganti dulu (bawah).

## Ganti ke akun yang BENAR

```bash
# Kalau akun ramaactivity98 sudah pernah login di CLI ini:
npx vercel switch ramaactivity98-5695s-projects

# Kalau belum / perlu login ulang:
npx vercel logout
npx vercel login            # login pakai rama.activity98@gmail.com
npx vercel switch ramaactivity98-5695s-projects
```

Setelah ganti, ulangi `npx vercel teams ls` untuk konfirmasi ✔ pindah ke akun benar.

## Binding project — ✓ SUDAH BENAR (verified 2026-06-08 via dashboard)

`.vercel/project.json` (`projectId = prj_F9wxXfdniysOLSJWtM9kvIaWlroK`, `orgId = team_BSJVaxRgvlGYUgzntvcZZwcD`)
cocok dgn project **mahakan-pos** di scope `ramaactivity98-5695s-projects`. Tidak perlu re-link.
Cukup pastikan akun aktif benar (lihat atas), lalu `npx vercel --prod --yes`.

## Akun GitHub (push source-of-truth)

- Git user: `ramaactivity`
- Branch produksi: `release/phase-1` (push ke sini; **JANGAN** ke `main` yang dormant)
- Push ke GitHub **tidak** trigger build Vercel (sengaja — lihat [DEPLOY.md](./DEPLOY.md)).

---
Lihat juga: [DEPLOY.md](./DEPLOY.md) untuk langkah commit → push → deploy lengkap.
