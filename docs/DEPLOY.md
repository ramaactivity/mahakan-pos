# DEPLOY — POS Mahakan

> **Deploy = `git push origin release/phase-1`.** Push memicu GitHub Actions
> workflow `.github/workflows/deploy.yml`, yang men-deploy ke Vercel memakai
> **Vercel token** (bukan native Git integration). Mekanisme ini selalu sama.
> JANGAN improvise.

## Kenapa lewat GitHub Actions + token, bukan native Git integration?

Satu akun GitHub dipakai untuk banyak project yang tersebar di **beberapa akun
Vercel berbeda** (email beda, free tier dipisah). Native Git integration hanya
bisa "login-connect" satu akun GitHub ke satu akun Vercel dalam satu waktu —
begitu project di akun Vercel lain menyambung, koneksi di sini lepas dan deploy
ke-block. Pola token bersifat permanen karena tidak bergantung pada koneksi
GitHub sama sekali.

Bukti nyata di repo ini (2026-08-04): dua push berturut-turut berstatus
**Blocked** dengan pesan

> The deployment was blocked because the commit author did not have contributing
> access to the project on Vercel. The Hobby Plan does not support collaboration
> for private repositories.

Selama ±20 jam tidak ada satu pun build yang naik, padahal kode sudah di GitHub.

## Identitas project

| Field | Nilai |
|---|---|
| Akun Vercel | `rama.activity98@gmail.com` |
| Team / scope | `ramaactivity98-5695s-projects` (plan **Hobby**) |
| Project | `mahakan-pos` |
| Org ID | `team_BSJVaxRgvlGYUgzntvcZZwcD` |
| Project ID | `prj_F9wxXfdniysOLSJWtM9kvIaWlroK` |
| Domain produksi | https://mahakan-pos.vercel.app |
| Branch produksi | `release/phase-1` (⚠️ **bukan** `main` — main dormant) |

Org ID & Project ID **bukan rahasia**, jadi sengaja di-inline sebagai `env` di
workflow. Yang rahasia hanya `VERCEL_TOKEN` (GitHub repo secret).

## Urutan deploy (semua langkah)

### 1. Pre-flight (semua harus green)

```bash
npx tsc --noEmit
npx vitest run
NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack
```

Ada yang merah → fix dulu, JANGAN push. (Vercel build ulang di server, tapi
pre-flight lokal mencegah deploy gagal & boros waktu.)

### 2. Migrate prod — HANYA kalau ada migration baru (⚠️ SEBELUM push)

```bash
npm run db:migrate:safe
```

⚠️ **Deploy TIDAK menjalankan migration.** Kalau ada migration baru, jalankan
ini DULU sebelum push — biar kolom/tabel sudah ada sebelum kode baru live.

PAKAI `db:migrate:safe`, BUKAN `npx drizzle-kit migrate` (dotenv-nya merusak
password Neon ber-`$`). Pre-authorized untuk ADDITIVE saja (ADD COLUMN
nullable/default, CREATE INDEX, CREATE TABLE). DROP / NOT NULL on existing data
/ TRUNCATE / rename → **WAJIB tanya owner dulu.**

### 3. Commit (file spesifik, BUKAN `-A` / `.`)

```bash
git add <file-spesifik>
git commit -m "$(cat <<'EOF'
<type>(<area>): <short> — <why> (sesi <code>)

<body kalau perlu, fokus WHY>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Type: feat / fix / chore / perf / refactor / docs.

### 4. Push → GitHub Actions deploy

```bash
git push origin release/phase-1
```

Pantau di **GitHub → tab Actions → "Deploy to Vercel (Production)"**.
Durasi normal ±2–4 menit. JANGAN push ke `main` (dormant). JANGAN force-push
tanpa izin eksplisit.

### 5. Verify

```bash
curl -sI https://mahakan-pos.vercel.app | head -3   # harus HTTP/2 200
```

Atau cek tab Deployments Vercel — deployment teratas harus **Ready** dengan
badge **Production**. Sumbernya akan tampil sebagai CLI/token, **bukan** GitHub
— itu memang yang diharapkan.

## Cara kerja workflow (dan kenapa tiap step ada)

`.github/workflows/deploy.yml`:

1. **`vercel pull --environment=production`** — tarik setelan project + env
   Production dari Vercel ke runner.
2. **`rm -rf .git`** — ⚠️ **WAJIB, jangan dihapus.** Vercel Hobby memblok deploy
   yang email commit author-nya tidak cocok dengan anggota team. Karena login
   GitHub sengaja TIDAK di-connect, metadata git dibuang supaya deploy
   diatribusikan ke **pemilik token** (yang jelas anggota team) → lolos.
3. **`vercel deploy --prod`** — build **DI VERCEL**. JANGAN ganti ke
   `vercel build` + `--prebuilt`: pernah dicoba, menggantung di "Building…" dan
   menuntut setup package manager di runner. Runner di sini tidak perlu
   npm/yarn/pnpm sama sekali.

`concurrency: vercel-production` + `cancel-in-progress` memastikan push beruntun
tidak menghasilkan dua deploy produksi yang saling salip.

## Secret yang dibutuhkan

GitHub → repo → Settings → Secrets and variables → Actions:

| Secret | Dipakai untuk |
|---|---|
| `VERCEL_TOKEN` | deploy (workflow ini) |
| `CRON_SECRET` | cron jam-an `notifications-cron.yml` |
| `DATABASE_URL_BACKUP` | backup Postgres mingguan |

## Troubleshooting

| Gejala | Sebab & solusi |
|---|---|
| Deployment **Blocked**, "commit email could not be matched" / "commit author did not have contributing access" | Step `rm -rf .git` hilang atau ter-skip. Kembalikan step itu. |
| Actions **merah** di step Deploy, pesan auth/forbidden | Token expired atau di-revoke → buat token baru di akun Vercel pemilik project, update secret `VERCEL_TOKEN`. |
| Actions **tidak jalan sama sekali** setelah push | Cek `branches:` di workflow — repo ini `release/phase-1`, bukan `main`. |
| Deploy dobel (dua deployment per push) | Native Git integration masih tersambung → Vercel project → Settings → Git → **Disconnect**. |
| Build gagal di Vercel padahal lokal hijau | Cek env Production di Vercel (mis. `DATABASE_URL`) — `vercel pull` hanya menarik, tidak membuat. |

## JANGAN lakukan

- ❌ Menghapus step `rm -rf .git` (deploy langsung ke-block).
- ❌ Mengganti ke `--prebuilt` / `vercel build` lokal.
- ❌ Menyambungkan kembali native Git integration (bikin dobel-deploy + rebutan
  koneksi GitHub dengan project di akun Vercel lain).
- ❌ `git push --force` ke main/release tanpa izin.
- ❌ Menaruh token di file yang di-commit. `.env*` dan `.vercel/` sudah
  di-gitignore — biarkan begitu.

## Fallback — CLI manual dari laptop

```bash
npx vercel teams ls          # ✔ HARUS di ramaactivity98-5695s-projects
npx vercel --prod --yes
```

Butuh login CLI ke akun yang benar (lihat [ACCOUNTS.md](./ACCOUNTS.md)). Untuk
alur normal ini tidak perlu — trigger-nya dari GitHub Actions.
