# 🤝 HANDOVER — Mahakan POS Full Automation Mode

**Untuk:** Claude AI Agent di Antigravity IDE
**Dari:** User (Rama Saputra, non-technical owner)
**Context:** User ingin delegate 100% coding work ke AI agent. Lanjutkan implementasi Phase 1 sampai selesai.

---

## 🎯 Context Singkat

User adalah owner Mahakan Coffee & Space (coffee shop di Cisarua, Bogor). Dia mau replace subscription POS (Majoo) dengan sistem custom. User **bukan developer** — dia mengandalkan lo untuk semua coding work.

Status saat ini:
- ✅ Dokumentasi lengkap di `docs/` (10 file markdown)
- ✅ Brand assets di `public/assets/logo/`
- ✅ Next.js 16.2.4 scaffold selesai
- ✅ Neon Postgres project dibuat (region Singapore)
- ✅ Vercel account ready
- ✅ GitHub repo `ramaactivity/mahakan-pos` (private)
- ✅ Git identity configured
- ⏳ `.env.local` belum ada (user akan bantu fill credentials)
- ⏳ DB schema belum ter-implement
- ⏳ Seed data belum ter-run
- ⏳ Auth belum di-setup
- ⏳ UI components belum ada
- ⏳ Business logic (POS, shift, payment) belum ada

---

## 🚨 ATURAN KERJA DENGAN USER INI

User ini beda dari developer biasa. Lo harus **adjust communication style**:

### DO:

1. **Jelaskan dengan bahasa sederhana.** User `/=` developer. Kalau lo bilang "refactor the Zustand store to use Redux", dia gak ngerti. Pakai bahasa biasa: "gua reorganize cara aplikasi save data sementara biar lebih rapi".

2. **Break task jadi potongan kecil.** Jangan kasih 10 langkah sekaligus. Kasih 1 langkah, tunggu approval, lanjut. User akan overwhelm kalau prompt lo kepanjangan.

3. **Eksplisit tentang apa yang lo kerjain vs apa yang user perlu kerjain.** Contoh:
   ```
   ✅ Yang gua kerjain sekarang: bikin file schema.ts buat database
   ⏳ Yang user perlu kerjain: paste DATABASE_URL ke .env.local (saya 
      tunggu)
   ```

4. **Warn user eksplisit kalau butuh input mereka.** Jangan silent assume. Kalau butuh business decision, tanya:
   ```
   STOP — butuh keputusan bisnis. Pager number di kafe itu reset per 
   hari atau per shift? (pilih salah satu, saya tunggu)
   ```

5. **Visual indicator progress.** User gak ngerti terminal output. Setelah tiap milestone, kasih summary:
   ```
   ✅ Done: Database schema dibuat
   ✅ Done: Seed 45 menu ke database
   ⏳ Next: Setup login page
   📊 Progress Week 1: 60% (3/5 tasks)
   ```

6. **Self-test sebelum claim "done".** Run command yang verify hasil (misal `npm run typecheck`, `npm run build`, atau manual navigation di browser). Jangan klaim selesai kalau belum verify works.

7. **Commit setiap milestone.** Format: `feat(module): description`. Jangan tunggu end-of-day, commit tiap fitur selesai.

### DON'T:

1. **Jangan pernah** commit credentials, secrets, API keys ke git. Selalu via `.env.local` (which is `.gitignore`d).

2. **Jangan skip validation untuk money logic.** Setiap transaksi, diskon, refund harus di-validate server-side dengan integer arithmetic. Refer `docs/03-TSD.md` section 9.

3. **Jangan deviate dari docs tanpa flag ke user.** Kalau PRD/FSD/TSD bilang X tapi lo mau Y, stop dan tanya user:
   ```
   TSD §4.3 spec shift table dengan field Z, tapi gua rasa lebih bagus 
   W karena [alasan]. Bolehkah gua deviate? (tunggu approval)
   ```

4. **Jangan implement fitur Phase 2+.** User cuma butuh Phase 1. Kalau ada temptation untuk "sekalian bikin recipe tracking karena gampang", TAHAN. Refer PRD §1.4 untuk list non-goals.

5. **Jangan push ke GitHub sebelum test.** Run `npm run typecheck` dan `npm run build` dulu. Kalau fail, fix dulu sebelum push.

6. **Jangan hallucinate API Next.js 16.** Versi ini masih baru (Oct 2025 release). Kalau ragu soal API, **MUST use Context7 MCP** untuk fetch docs terbaru. Refer `AGENTS.md` untuk tool availability.

7. **Jangan panik kalau user frustasi.** User bilang "gua ga ngerti" — itu bukan blame ke lo, itu invitation untuk explain more simply. Re-phrase, kasih analogi, lanjut.

---

## 📋 EXECUTION PLAN — Ikuti Urutan Ini

Lo punya otonomi untuk eksekusi plan berikut. Setiap milestone, report ke user dengan format yang gua contohin di atas ("Visual indicator progress"). Tunggu approval sebelum lanjut milestone berikutnya **kecuali** milestone tersebut butuh credentials user — kalau butuh, explicit request.

### 🏁 MILESTONE 0: Housekeeping (Today, 10 min)

Lo baru saja commit dokumentasi sync. Sekarang:

1. **Read `AGENTS.md` fully.** Ini rule book lo.
2. **Read `docs/00-README.md` fully.** Ini roadmap.
3. **Check current state:**
   ```bash
   git status
   git log --oneline | head -10
   ls -la
   npm run typecheck 2>&1 | head -20
   ```
4. **Report** ke user:
   - Confirm docs ter-commit ✓
   - Confirm scaffold working ✓
   - List what's present vs what's missing
5. **Request** dari user:
   - "Mohon buat file `.env.local` dengan 3 value berikut... [instructions]"

### 🏁 MILESTONE 1: Environment Setup (User-assisted, 30 min)

**Lo TIDAK BISA lakuin ini sendiri — butuh user input.**

Instruksi yang lo kasih ke user:

```
⏳ PERLU BANTUAN USER — Setup credentials (10 menit)

1. Di terminal, jalankan:
   openssl rand -base64 32
   Copy output (string panjang random).

2. Di Antigravity, buat file baru: .env.local (di root project)

3. Isi dengan template ini, ganti bagian [PASTE_...]:

---
DATABASE_URL=[PASTE_NEON_POOLED_CONNECTION_STRING]
AUTH_SECRET=[PASTE_OPENSSL_OUTPUT]
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
SEED_OWNER_NAME=Rama Saputra
SEED_OWNER_EMAIL=rama.activity98@gmail.com
SEED_OWNER_PASSWORD=[GANTI_PASSWORD_KUAT_MIN_12_CHAR]
---

4. Cara dapet DATABASE_URL:
   - Buka https://console.neon.tech
   - Klik project "mahakan-pos"
   - Klik tombol "Connect" di top-right
   - Toggle ke "Pooled connection"
   - Copy connection string
   - Format: postgresql://neondb_owner:XXXXX@ep-XXX-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

5. Setelah filled, save file dan reply di chat: "done"

⚠️ JANGAN paste isi .env.local ke chat atau commit ke git. 
File ini udah di-ignore, aman di local machine.
```

Setelah user reply "done":

1. **Verify file ada (tanpa baca isinya):** `ls -la .env.local`
2. **Verify gak ke-track git:** `git status` — `.env.local` HARUS TIDAK muncul
3. **Smoke test DB connection:** bikin script temporary di `/tmp/test-db.ts`:
   ```typescript
   import { Pool } from '@neondatabase/serverless';
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   const result = await pool.query('SELECT NOW()');
   console.log('DB connected:', result.rows[0]);
   process.exit(0);
   ```
   Run: `npx tsx /tmp/test-db.ts`
   Expected: print current timestamp. Kalau error, **stop dan minta user cek connection string**.

### 🏁 MILESTONE 2: Database Schema & Seed (Lo Solo, 1-2 jam)

Follow `docs/03-TSD.md` section 4 dan `docs/06-DATABASE-SCHEMA.md` LENGKAP.

1. **Implement all Drizzle schemas:**
   - `src/db/schema/outlets.ts`
   - `src/db/schema/users.ts`
   - `src/db/schema/menu.ts` (categories, menu_items, modifiers)
   - `src/db/schema/shifts.ts`
   - `src/db/schema/transactions.ts` (transactions, transaction_items, transaction_item_modifiers)
   - `src/db/schema/expenses.ts` (expense_categories, expenses, incomes)
   - `src/db/schema/audit.ts`
   - `src/db/schema/index.ts` (re-exports)
   - `src/db/index.ts` (connection)

2. **Setup Drizzle config:** `drizzle.config.ts` di root.

3. **Generate migration:**
   ```bash
   npm run db:generate
   ```
   **Review the generated SQL file** at `drizzle/migrations/0001_xxx.sql`.
   Verify: all tables, all indexes, all constraints match TSD.

4. **Apply migration:**
   ```bash
   npm run db:migrate
   ```

5. **Verify at Neon:** Use SQL query in drizzle-kit studio or tell user to check Neon Tables UI.

6. **Implement seed:** `src/db/seed.ts`. Follow `docs/04-MENU-DATA.md` EXACTLY:
   - 1 outlet "Mahakan Coffee & Space" with owner data
   - 1 owner user from SEED_OWNER_* env
   - 11 categories
   - 45 menu items (exact prices from 04-MENU-DATA.md)
   - 4 modifiers
   - 9 expense categories (8 regular + 1 system "Refund")

7. **Run seed:**
   ```bash
   npm run db:seed
   ```

8. **Verify:** Query via Drizzle or ask user to check Neon:
   ```sql
   SELECT COUNT(*) FROM menu_items;  -- should be 45
   SELECT COUNT(*) FROM categories;  -- should be 11
   SELECT COUNT(*) FROM users;       -- should be 1
   SELECT COUNT(*) FROM expense_categories; -- should be 9
   ```

9. **Commit:**
   ```bash
   git add .
   git commit -m "feat(db): implement Drizzle schema + seed Phase 1 data
   
   - 12 tables per TSD §4.3
   - Initial migration generated + applied to Neon
   - Seeded: 1 outlet, 1 owner, 11 categories, 45 menu items, 4 modifiers, 9 expense categories
   - All constraints + indexes per 06-DATABASE-SCHEMA.md"
   git push
   ```

10. **Report** ke user dengan summary + progress bar.

### 🏁 MILESTONE 3: Design System Setup (Lo Solo, 1 jam)

Follow `docs/07-UI-DESIGN-SYSTEM.md` LENGKAP.

1. **Setup Tailwind v4 custom theme** — Mahakan sage green palette (`green-600 #539371`, action `green-700 #3D7557`). Refer section 2.1 + 2.2.

2. **Setup fonts:** Inter + JetBrains Mono via `next/font/google`.

3. **Setup `src/app/globals.css`** sesuai section 3.

4. **Implement `src/lib/utils.ts`** dengan `cn()` helper.

5. **Implement `src/lib/money.ts`** LENGKAP dari TSD §9.
   - Integer arithmetic only
   - Banker's rounding
   - Unit tests MANDATORY

6. **Implement `src/lib/format.ts`** untuk Indonesian formatting (Rp, DD/MM/YYYY).

7. **Implement base UI components:**
   - `src/components/ui/Button.tsx` — primary/secondary/ghost/destructive/outline, sizes sm/md/lg/xl
   - `src/components/ui/Input.tsx`
   - `src/components/ui/Card.tsx`
   - `src/components/ui/Toast.tsx` — use `sonner` library
   - `src/components/ui/Modal.tsx`
   - `src/components/ui/Badge.tsx`
   - `src/components/ui/PinPad.tsx` — for POS login later

   Refer section 4.x untuk setiap component spec.

8. **Bikin showcase page** di `src/app/page.tsx` yang render semua variant component untuk visual verification.

9. **Visual test:**
   ```bash
   npm run dev
   ```
   Ask user: "Buka http://localhost:3000, screenshot, attach ke chat. Kalau gua lihat warna + komponennya udah match design system, lanjut."

10. **Write unit tests untuk money.ts:**
    ```bash
    npm test
    ```
    Sesuai `docs/09-TESTING-STRATEGY.md` section 3.1. ALL edge cases.

11. **Commit:**
    ```bash
    git commit -m "feat(ui): design system setup + base components + money utils
    
    - Tailwind v4 config with Mahakan sage green palette
    - 7 base UI components (Button, Input, Card, Toast, Modal, Badge, PinPad)
    - Money utilities with banker's rounding (unit tested)
    - Indonesian formatting helpers
    - Showcase page at / for visual verification"
    git push
    ```

### 🏁 MILESTONE 4: Authentication (Lo Solo, 2-3 jam)

Follow `docs/03-TSD.md` section 6 dan `docs/05-ROLES-RBAC.md`.

**⚠️ Ini sensitive. JANGAN skip validation apapun. JANGAN pakai `any` di TypeScript.**

1. **Install dependencies yang mungkin missing:**
   ```bash
   npm list next-auth @auth/drizzle-adapter bcryptjs
   ```
   Kalau ada yang missing, `npm install ...`.

2. **Configure Auth.js v5:**
   - `src/lib/auth/config.ts` — NextAuth config dengan 2 providers (email-password + pin). Refer TSD §6.1.
   - `src/lib/auth/rbac.ts` — Permission enum + `hasPermission()` helper. Refer TSD §6.2 + RBAC §4.
   - `src/lib/auth/session.ts` — helpers get session server-side.

3. **Verify via Context7 MCP:** Auth.js v5 API sering berubah. Use Context7 untuk fetch latest auth.js v5 patterns sebelum implement.

4. **Middleware:** `src/middleware.ts`. Refer TSD §6.4.
   - Redirect logic: Staff → `/pos`, Owner/Manager → `/dashboard`
   - Protect `/admin/*`, `/dashboard/*`, `/pos/*`

5. **Auth API routes:**
   - `src/app/api/v1/auth/[...nextauth]/route.ts` — catch-all
   - `src/app/api/v1/auth/verify-approver/route.ts` — PIN override endpoint
   - `src/app/api/v1/auth/logout/route.ts`

6. **Login pages:**
   - `src/app/(auth)/login/page.tsx` — email + password untuk Owner/Manager
   - **SKIP PIN login untuk Staff dulu** — ini Week 2 task

7. **Test flow:**
   ```bash
   npm run dev
   ```
   User test manual:
   - Buka `http://localhost:3000/login`
   - Input SEED_OWNER_EMAIL + SEED_OWNER_PASSWORD
   - Should redirect to `/dashboard` (bikin page kosong dulu dengan "Hello Owner")
   - Screenshot ke chat

8. **Write integration tests untuk auth:**
   - `tests/integration/auth.test.ts` — sesuai testing strategy

9. **Commit:**
   ```bash
   git commit -m "feat(auth): Auth.js v5 with email+password for Owner/Manager
   
   - Auth.js v5 config with Credentials provider
   - RBAC helper with permission enum (~80 permissions)
   - Middleware for route protection
   - Login page + protected /dashboard stub
   - PIN login (Staff) deferred to Week 2
   - Integration tests for login flow"
   git push
   ```

### 🏁 MILESTONE 5: Menu Management Back Office (Lo Solo, 2-3 jam)

Follow `docs/02-FSD.md` section 4.

1. Feature folder: `src/features/menu/`
   - `actions.ts` — Server Actions (create, update, delete, sold-out toggle)
   - `queries.ts` — DB queries
   - `schemas.ts` — Zod schemas (use Zod v4 syntax per AGENTS.md note)
   - `types.ts`
   - `components/MenuItemForm.tsx`
   - `components/MenuList.tsx`

2. Admin pages:
   - `src/app/(admin)/menu/items/page.tsx` — list
   - `src/app/(admin)/menu/items/new/page.tsx` — create
   - `src/app/(admin)/menu/items/[id]/edit/page.tsx` — edit
   - `src/app/(admin)/menu/categories/page.tsx`

3. ⚠️ **Server-side validation wajib.** Refer FSD §4.1 untuk validation rules.

4. **Test manual** per FSD flow:
   - Buat item baru → appears in list
   - Edit price → persists
   - Soft delete → hidden in list
   - Toggle sold-out → updates

5. Commit.

### 🏁 MILESTONE 6: POS Core (Lo Solo, 3-4 jam)

Follow `docs/02-FSD.md` section 3 + `docs/03-TSD.md` relevant sections.

**Most critical milestone. Take time, don't rush.**

1. Feature folder: `src/features/pos/`
2. Components: `NewOrderModal`, `MenuGrid`, `Cart`, `PaymentScreen`, `SuccessScreen`, `ItemModifierModal`
3. Server Action: `createTransaction` with SERVER-SIDE total validation.
4. Routes: `src/app/(pos)/order/new/page.tsx`, etc.
5. ⚠️ **Money validation:** Refer TSD §5.3 contoh code. JANGAN skip.
6. Unit tests untuk transaction validation (critical, per testing strategy 3.2).
7. E2E manual test: user login as staff → open shift → create order → pay cash → verify transaction di DB.
8. Commit.

### 🏁 MILESTONE 7: Shift Management (Lo Solo, 1-2 jam)

Follow FSD section 5.

1. Open shift, close shift flow.
2. Variance calculation.
3. Commit.

### 🏁 MILESTONE 8: Deploy to Vercel (Lo Solo + User OAuth, 30 min)

1. **Prompt user:**
   ```
   ⏳ PERLU BANTUAN USER — Deploy ke Vercel (5 menit)
   
   1. Buka https://vercel.com/new
   2. Import Git Repository: ramaactivity/mahakan-pos
   3. Framework: Next.js (auto-detect)
   4. Environment Variables — add semua dari .env.local kecuali NODE_ENV:
      - DATABASE_URL
      - AUTH_SECRET
      - AUTH_TRUST_HOST
      - NEXT_PUBLIC_APP_URL (ganti jadi https://mahakan-pos.vercel.app)
      - SEED_OWNER_NAME
      - SEED_OWNER_EMAIL
      - SEED_OWNER_PASSWORD
   5. Deploy
   6. Setelah deployed, copy URL yang muncul (misal mahakan-pos-abc123.vercel.app)
   7. Reply: "deployed: [URL]"
   ```

2. **Setelah user reply:**
   - Test login di production URL
   - Verify DB connection works di prod
   - Commit any final fixes.

### 🏁 MILESTONE 9+: Iterate Remaining Modules

Ikuti urutan di `docs/00-README.md` Phase 1 Implementation Order:
- Week 3: QRIS/card payment, void, refund, sold-out broadcast (SSE)
- Week 4: Expense/income, daily cash summary
- Week 5: Full menu CRUD, user management (add staff), settings
- Week 6: Reports (daily sales, items, P&L)
- Week 7: Offline resilience (IndexedDB queue), Web Bluetooth printer
- Week 8: Testing + soft launch

---

## 🔄 WORKFLOW PER DAY

Setiap kali user mulai session baru di Antigravity:

1. **Greet + status check:**
   ```
   👋 Halo, lanjut dari session kemarin. Status saat ini:
   ✅ Milestone 2: DB schema + seed — DONE
   ✅ Milestone 3: Design system — DONE
   ⏳ Milestone 4: Authentication — IN PROGRESS (60%)
   
   Mau lanjut Milestone 4 atau switch ke task lain?
   ```

2. **Execute 1-2 milestones max per session.** Jangan overload.

3. **End session dengan summary:**
   ```
   📊 Session selesai:
   ✅ Milestone 4 (Auth) — DONE, commit pushed
   🎯 Next session: Milestone 5 (Menu management back office)
   
   Notes untuk user:
   - Kalau mau test login, buka localhost:3000/login dengan email+password di .env.local
   - Database udah ada 1 owner user, 45 menu items
   ```

---

## 🆘 ESCALATION RULES

Jika lo encounter:

### Situasi 1: Pertanyaan business decision yang tidak dijawab di docs

**Tindakan:** STOP, tanya user dengan format:
```
❓ Butuh keputusan bisnis:

[Pertanyaan spesifik]

Opsi:
A) [opsi a + tradeoff]
B) [opsi b + tradeoff]

Rekomendasi gua: [pilih salah satu + alasan singkat]

Pilih A atau B?
```

### Situasi 2: Library/API behavior tidak sesuai expectations

**Tindakan:**
1. Use Context7 MCP untuk fetch latest docs
2. Kalau masih belum jelas, post error + context ke user, minta manual check

### Situasi 3: Error yang lo gak bisa debug dalam 10 menit

**Tindakan:**
1. Roll back ke last working commit
2. Report ke user:
   ```
   ⚠️ Stuck di [task]. Error: [error]
   
   Yang udah gua coba:
   - [attempt 1]
   - [attempt 2]
   
   Gua rollback ke commit [hash] biar project tetap jalan. 
   User, mohon decide:
   A) Skip fitur ini dulu, lanjut next milestone
   B) Kita pair debug bareng — minta user buka [file] dan jalanin [command]
   C) Post issue ke GitHub Next.js / Auth.js / Drizzle untuk community help
   ```

### Situasi 4: User bilang frustasi / overwhelmed

**Tindakan:**
1. **Jangan push back.** Acknowledge.
2. **Offer simplification:**
   ```
   Gua ngerti, ini emang overwhelming. Mari gua simplify.
   
   Option 1: Hari ini kita fokus 1 thing aja. Gua lanjut coding, 
             lo cukup baca summary gua di akhir session.
   
   Option 2: Pause project 1-2 hari, gua kasih rekomendasi 
             workflow yang lebih ringan.
   
   Option 3: Lo mau explain apa yang paling bikin overwhelm? 
             Mungkin ada yang bisa gua automate lebih banyak.
   
   Pilih?
   ```

---

## 📝 PROGRESS TRACKING

Maintain file `PROGRESS.md` di root (gitignored or committed, lo putuskan). Update tiap session:

```markdown
# Mahakan POS — Progress Log

## Week 1 — Foundation
- [x] M0: Housekeeping (2026-04-24)
- [x] M1: Environment setup (2026-04-24)
- [x] M2: DB schema + seed (2026-04-25)
- [ ] M3: Design system (in progress)
- [ ] M4: Auth
...
```

---

## ✅ FINAL NOTES

- **User udah approve full automation mode.** Lo punya otonomi tinggi.
- **Tapi user tetap final decision-maker** untuk business questions + credentials + deployment.
- **Pace wajar:** 1-2 milestone per session. Jangan maksa.
- **Quality > Speed.** Lebih baik slower + working than faster + bug-prone.
- **Commit often, push often.** Setiap milestone selesai = commit + push.
- **Self-verify before claim done.** Selalu run `npm run typecheck` + `npm run build` + manual smoke test.

---

**Start with Milestone 0 (Housekeeping). Report back status + request .env.local setup (Milestone 1).**
