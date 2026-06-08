# DEPLOY — Workflow PROVEN POS Mahakan

> Mekanisme commit → push → deploy ini **selalu sama**. JANGAN improvise.
> Akun yang dipakai HARUS yang di [ACCOUNTS.md](./ACCOUNTS.md). Cek akun dulu sebelum deploy.

## 0. Cek akun (WAJIB, langkah pertama)

```bash
npx vercel teams ls   # tanda ✔ HARUS di "ramaactivity98-5695s-projects"
```

Kalau ✔ ada di `masram-s-projects` / akun lain → **JANGAN deploy** → ganti dulu:
`npx vercel switch ramaactivity98-5695s-projects` (atau `vercel logout && vercel login`
dgn `rama.activity98@gmail.com`). Detail di [ACCOUNTS.md](./ACCOUNTS.md).

## 1. Pre-flight (semua harus green)

```bash
npx tsc --noEmit
npx vitest run
NODE_OPTIONS="--max-old-space-size=8192" npx next build --webpack
```

Ada yang merah → fix dulu, JANGAN lanjut.

## 2. Commit (specific files, BUKAN -A / .)

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

## 3. Push (source-of-truth, TIDAK trigger build)

```bash
git push origin release/phase-1
```

JANGAN push ke `main`. JANGAN force-push tanpa izin eksplisit.

## 4. Migrate prod (HANYA kalau ada migration baru)

```bash
npm run db:migrate:safe
```

PAKAI `db:migrate:safe`, BUKAN `npx drizzle-kit migrate` (dotenv-nya merusak password Neon ber-`$`).
Pre-authorized untuk ADDITIVE saja (ADD COLUMN nullable/default, CREATE INDEX, CREATE TABLE).
DROP / NOT NULL on existing data / TRUNCATE / rename → **WAJIB tanya owner dulu.**

## 5. Deploy production (COMMAND TUNGGAL)

```bash
npx vercel --prod --yes
```

Verify:

```bash
curl -sI https://mahakan-pos.vercel.app | head -3   # harus HTTP/2 200
```

## JANGAN lakukan (anti-pattern terbukti gagal)

- ❌ Edit `vercel.json` `git.deploymentEnabled` jadi `true` → Preview build crash (Preview env tidak punya `DATABASE_URL`).
- ❌ `vercel deploy` tanpa `--prod` (jadi Preview).
- ❌ Trigger build via dashboard "Redeploy" / webhook / empty commit.
- ❌ Deploy pakai akun selain `ramaactivity98-5695s-projects` (mis. `masram-s-projects`) — lihat [ACCOUNTS.md](./ACCOUNTS.md).
- ❌ Vercel CLI `53.3.0`–`53.x` broken (`@vercel/cli-config`); kalau perlu pin `@53.2.0`.

## INVARIANT vercel.json (JANGAN DIUBAH)

```json
{ "git": { "deploymentEnabled": { "main": false, "release/phase-1": false } } }
```

Keduanya HARUS `false`. Sengaja. Kalau "deploy tidak muncul di Vercel" → langsung `npx vercel --prod --yes`, JANGAN sentuh file ini.
