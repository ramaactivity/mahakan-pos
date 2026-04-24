# Mahakan POS

Custom Point-of-Sale + Operations system untuk **Mahakan Coffee & Space**, coffee shop di Cisarua, Bogor. Replaces existing Majoo subscription dengan sistem milik sendiri — gratis selamanya, data 100% owned.

**Status:** Phase 1 MVP — in development (see [PROGRESS.md](./PROGRESS.md))

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19
- **Styling:** Tailwind CSS v4
- **Database:** Postgres via [Neon](https://neon.tech) (free tier) + Drizzle ORM
- **Auth:** Auth.js v5 (NextAuth)
- **PWA:** Serwist
- **Hardware:** Web Bluetooth + ESC/POS (RPP02 thermal printer)
- **Hosting:** Vercel (free tier)
- **Testing:** Vitest
- **Language:** TypeScript strict mode — no `any`

## Quickstart

### Prerequisites

- Node.js 22+ (see `.nvmrc`) — `nvm use`
- A [Neon](https://console.neon.tech) account with a Postgres project
- `openssl` (for generating `AUTH_SECRET`)

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create `.env.local`** (copy from `.env.example` and fill in real values)
   ```bash
   cp .env.example .env.local
   ```
   Then edit `.env.local`:
   - `DATABASE_URL` — paste pooled connection string from Neon console
   - `AUTH_SECRET` — generate with `openssl rand -base64 32`
   - `SEED_OWNER_PASSWORD` — pick a strong password (min 12 chars)

3. **(After M8)** Run migrations + seed data
   ```bash
   npm run db:generate    # generate migration SQL
   npm run db:migrate     # apply to Neon
   npm run db:seed        # seed 45 menu items + owner user
   ```

4. **Run dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run db:generate` | Generate Drizzle migration |
| `npm run db:migrate` | Apply migrations to DB |
| `npm run db:seed` | Seed initial data |
| `npm run db:studio` | Drizzle Studio (DB browser) |

## Documentation

Semua spec Phase 1 di `docs/`:

| File | Content |
|---|---|
| [`docs/00-README.md`](./docs/00-README.md) | Index + quick context |
| [`docs/01-PRD.md`](./docs/01-PRD.md) | Product requirements & scope |
| [`docs/02-FSD.md`](./docs/02-FSD.md) | Functional specs per feature |
| [`docs/03-TSD.md`](./docs/03-TSD.md) | Technical spec — architecture, DB, API |
| [`docs/04-MENU-DATA.md`](./docs/04-MENU-DATA.md) | Seed data — 45 SKU |
| [`docs/05-ROLES-RBAC.md`](./docs/05-ROLES-RBAC.md) | Permission matrix |
| [`docs/06-DATABASE-SCHEMA.md`](./docs/06-DATABASE-SCHEMA.md) | ERD + table reference |
| [`docs/07-UI-DESIGN-SYSTEM.md`](./docs/07-UI-DESIGN-SYSTEM.md) | Design tokens + components |
| [`docs/08-API-SPEC.md`](./docs/08-API-SPEC.md) | Endpoint contracts |
| [`docs/09-TESTING-STRATEGY.md`](./docs/09-TESTING-STRATEGY.md) | Test plan |
| [`docs/99-EXECUTION-PLAN.md`](./docs/99-EXECUTION-PLAN.md) | **Execution roadmap — start here** |
| [`AGENTS.md`](./AGENTS.md) | Rules for AI coding agents |

## Project Structure

```
src/
├── app/                 # Next.js App Router
│   ├── (auth)/          # Login pages
│   ├── (pos)/           # Tablet POS routes
│   ├── (admin)/         # Desktop back office routes
│   └── api/v1/          # REST endpoints (versioned)
├── features/            # Feature modules (pos, menu, shifts, ...)
├── components/ui/       # Primitive UI components
├── db/schema/           # Drizzle schemas
├── lib/                 # money, format, date, auth, rbac, utils
└── middleware.ts
```

## Hard Rules

- ❌ **Never** use `float`/`decimal` for money — always `bigint` in DB, `number` (integer rupiah) in TS
- ❌ **Never** use `any` in TypeScript — strict mode, use `unknown` + Zod at boundaries
- ✅ Server-side validation for every mutation — never trust client
- ✅ RBAC at server layer, not just UI
- ✅ API versioning `/api/v1/` from day 1
- ✅ Audit log for all sensitive actions

See [AGENTS.md](./AGENTS.md) for full rules.

## License

Private — internal use only.
