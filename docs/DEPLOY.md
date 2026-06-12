# DEPLOY — Workflow PROVEN POS Mahakan

> **Deploy = `git push origin release/phase-1`.** Push ke branch ini OTOMATIS memicu
> Production deploy di Vercel (~2-3 menit). Tidak ada lagi `vercel --prod` manual.
> Mekanisme ini selalu sama. JANGAN improvise.

## Urutan (semua langkah)

### 1. Pre-flight (semua harus green)

```bash
npx tsc --noEmit
npx vitest run
NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack
```

Ada yang merah → fix dulu, JANGAN push. (Vercel akan build ulang di server, tapi
pre-flight lokal mencegah deploy gagal & boros waktu.)

### 2. Migrate prod — HANYA kalau ada migration baru (⚠️ SEBELUM push)

```bash
npm run db:migrate:safe
```

⚠️ **PENTING: auto-deploy TIDAK menjalankan migration.** Kalau ada migration baru,
jalankan ini DULU sebelum push — biar kolom/tabel sudah ada di DB sebelum kode baru live.
Kalau push duluan tanpa migrate, kode baru bisa error karena kolom belum ada.

PAKAI `db:migrate:safe`, BUKAN `npx drizzle-kit migrate` (dotenv-nya merusak password Neon ber-`$`).
Pre-authorized untuk ADDITIVE saja (ADD COLUMN nullable/default, CREATE INDEX, CREATE TABLE).
DROP / NOT NULL on existing data / TRUNCATE / rename → **WAJIB tanya owner dulu.**

### 3. Commit (specific files, BUKAN -A / .)

```bash
git add <file-spesifik>
git commit -m "$(cat <<'EOF'
<type>(<area>): <short> — <why> (sesi <code>)

<body kalau perlu, fokus WHY>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Type: feat / fix / chore / perf / refactor / docs.

### 4. Push → AUTO-DEPLOY

```bash
git push origin release/phase-1
```

Push ini **otomatis memicu Production deploy** di Vercel. JANGAN push ke `main` (dormant).
JANGAN force-push tanpa izin eksplisit.

### 5. Verify

Cek tab Deployments: https://vercel.com/ramaactivity98-5695s-projects/mahakan-pos/deployments
— deployment teratas harus dari commit barumu, status **Ready**, badge **Production** biru,
ikon sumber **GitHub**. Atau:

```bash
curl -sI https://mahakan-pos.vercel.app | head -3   # harus HTTP/2 200
```

## ⚠️ INVARIANT — syarat auto-deploy works (JANGAN DIUBAH tanpa paham)

Auto-deploy hanya aman selama SEMUA ini benar. Kalau salah satu berubah, push bisa
jadi **Preview build → crash** (Preview tidak punya `DATABASE_URL`):

1. **`vercel.json`** → `deploymentEnabled`: `release/phase-1: true`, `main: false`.
2. **Vercel Production Branch = `release/phase-1`** (Dashboard → Settings → Environments
   → Production → Branch Tracking). Ini yang bikin push jadi **Production** (bukan Preview).
   Kalau ini balik ke `main`, push release/phase-1 → Preview → crash.
3. **`DATABASE_URL`** (+ env lain) ada di scope **Production**. Sengaja TIDAK di Preview.

```json
// vercel.json
{ "git": { "deploymentEnabled": { "main": false, "release/phase-1": true } } }
```

## Fallback — CLI manual (kalau auto-deploy bermasalah / hotfix tanpa commit)

```bash
npx vercel teams ls          # ✔ HARUS di ramaactivity98-5695s-projects
npx vercel --prod --yes
```

Catatan: CLI butuh login akun benar (lihat [ACCOUNTS.md](./ACCOUNTS.md)). Untuk auto-deploy
biasa, login CLI TIDAK relevan — trigger-nya dari push GitHub, di server Vercel.

## JANGAN lakukan

- ❌ Set Production Branch Vercel kembali ke `main` (bikin push jadi Preview → crash).
- ❌ `git push --force` ke main/release tanpa izin.
- ❌ Vercel CLI `53.3.0`–`53.x` broken (`@vercel/cli-config`); kalau perlu pin `@53.2.0`.
