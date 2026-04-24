# ⚙️ TSD — Mahakan Coffee & Space POS System

**Technical Specification Document**
**Version:** 1.0 — Phase 1 MVP
**Date:** April 2026
**Status:** ✅ APPROVED
**Depends on:** `01-PRD.md`, `02-FSD.md`

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer (PWA)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ POS Tablet   │  │ POS Phone    │  │ Back Office      │ │
│  │ (Chrome)     │  │ (Chrome)     │  │ (Desktop Browser)│ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │                  │                    │           │
│  ┌──────┴──────────────────┴────────────────────┴────────┐ │
│  │  Next.js 15 App Router (RSC + Client Components)      │ │
│  │  - Server Components (data fetching)                  │ │
│  │  - Client Components (interactivity)                  │ │
│  │  - Server Actions (mutations)                         │ │
│  │  - IndexedDB (offline queue + menu cache)             │ │
│  │  - Service Worker via Serwist (PWA)                   │ │
│  │  - Web Bluetooth (thermal printer ESC/POS)            │ │
│  └────────────────────────┬─────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTPS / WebSocket / SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Vercel Edge (Hosting & CDN)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Next.js API Routes (/api/v1/*)                      │   │
│  │  ├── Auth (Auth.js v5)                              │   │
│  │  ├── REST handlers (route.ts)                       │   │
│  │  ├── Server-Sent Events (menu sync, sold-out)       │   │
│  │  └── Middleware (auth, RBAC, audit log)             │   │
│  └─────────────────────┬───────────────────────────────┘   │
└────────────────────────┼───────────────────────────────────┘
                         │ Postgres wire protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Neon Postgres (Cloud DB)                  │
│  - Primary read/write branch                                │
│  - Auto-suspend when idle (free tier)                       │
│  - Drizzle ORM schema                                       │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ Async (when online)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          Vercel Blob Storage (Phase 1 optional)             │
│  - Expense receipt images                                   │
│  - Business logo                                            │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Request Flow Examples

**POS Transaction (Online):**
1. User taps "Bayar" in cart
2. Client calls Server Action `createTransaction(payload)`
3. Server Action validates session, role, runs business logic, writes to DB via Drizzle
4. Response includes `transaction_id`, full printed receipt structure
5. Client receives response, triggers Web Bluetooth print
6. UI transitions to success screen

**POS Transaction (Offline):**
1. User taps "Bayar"
2. Client detects offline via `navigator.onLine + health ping`
3. Transaction queued to IndexedDB with `client_ref_id` UUID + `sync_pending: true`
4. Local receipt structure generated, Web Bluetooth print executed
5. Background sync worker polls every 10s; on reconnect, POST queued transactions
6. Server returns final `TRX-YYYY-NNNN`, client updates local record

### 1.3 Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **Next.js App Router (not Pages)** | Server Components reduce client bundle; Server Actions simplify mutation flows |
| **Server Actions over REST for mutations** | Type-safe, co-located with UI, less boilerplate. REST `/api/v1/*` still exists for: external integrations, SSE, webhook endpoints |
| **Postgres (Neon) over SQLite** | Concurrent writes across tablet+phone+desktop need serializable transactions. Neon free tier sufficient |
| **Drizzle over Prisma** | Lighter bundle, SQL-first mental model, better Edge compatibility |
| **Auth.js v5 over Better Auth** | More battle-tested for financial systems; mature JWT handling |
| **Serwist over next-pwa** | Actively maintained successor; Next.js 15 compatible |
| **Web Bluetooth (not native bridge)** | Works in PWA without needing native wrapper; sufficient for RPP02 which is standard ESC/POS |
| **IndexedDB (not localStorage) for offline queue** | Async API, structured, larger quota, supports complex objects |
| **SSE over WebSocket for sold-out broadcast** | Simpler, unidirectional fits use case, works through proxies better |
| **Integer arithmetic for money** | Avoid all float errors |

---

## 2. Tech Stack Details

### 2.1 Dependencies (package.json snapshot)

```json
{
  "name": "mahakan-pos",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:e2e": "testsprite run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "5.0.0-beta.x",
    "@auth/drizzle-adapter": "^1.x",
    "drizzle-orm": "^0.36.x",
    "postgres": "^3.4.x",
    "@neondatabase/serverless": "^0.10.x",
    "bcryptjs": "^2.4.x",
    "zod": "^3.23.x",
    "@tanstack/react-query": "^5.x",
    "@tanstack/react-table": "^8.x",
    "serwist": "^9.x",
    "@serwist/next": "^9.x",
    "dexie": "^4.x",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x",
    "lucide-react": "^0.x",
    "recharts": "^2.x",
    "jspdf": "^2.5.x",
    "date-fns": "^4.x",
    "date-fns-tz": "^3.x",
    "nanoid": "^5.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "@types/react": "^19.x",
    "@types/bcryptjs": "^2.4.x",
    "drizzle-kit": "^0.28.x",
    "tailwindcss": "^4.x",
    "@tailwindcss/postcss": "^4.x",
    "eslint": "^9.x",
    "eslint-config-next": "^15.x",
    "vitest": "^2.x",
    "@testing-library/react": "^16.x",
    "tsx": "^4.x"
  }
}
```

**Notes:**
- Exact version numbers should be verified against latest stable at install time
- **Always verify library APIs via Context7 MCP** (if available) before writing implementation code
- Don't rely on training data for library usage patterns — they may be outdated

### 2.2 Runtime Environments

| Component | Runtime |
|---|---|
| Next.js API routes (auth, transactions) | Node.js runtime (for bcrypt + heavy DB ops) |
| Static pages / RSC | Default (Node.js) |
| Edge middleware (session check only) | Edge runtime |
| Client | Browser (Chrome/Edge primary) |

Do NOT use Edge runtime for routes that need bcrypt, DB writes, or PDF generation.

---

## 3. Folder Structure

```
mahakan-pos/
├── docs/                          # Documentation (this folder)
│   ├── 00-README.md
│   ├── 01-PRD.md
│   ├── 02-FSD.md
│   ├── 03-TSD.md
│   └── ...
├── public/                        # Static assets
│   ├── icons/                     # PWA icons
│   ├── logo.png
│   └── fonts/
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── layout.tsx             # Root layout (providers, PWA meta)
│   │   ├── page.tsx               # Landing / redirect by role
│   │   ├── globals.css            # Tailwind base + custom tokens
│   │   ├── (auth)/                # Auth route group (no layout)
│   │   │   ├── login/
│   │   │   │   └── page.tsx       # Email/password login
│   │   │   └── pos/
│   │   │       └── login/
│   │   │           └── page.tsx   # PIN login
│   │   ├── (pos)/                 # POS route group (tablet layout)
│   │   │   ├── layout.tsx         # POS nav, shift indicator
│   │   │   ├── page.tsx           # POS dashboard
│   │   │   ├── order/
│   │   │   │   ├── new/page.tsx   # New order flow
│   │   │   │   └── [id]/page.tsx  # View transaction detail
│   │   │   └── shifts/
│   │   │       └── my/page.tsx    # Staff's own shifts
│   │   ├── (admin)/               # Back office route group (desktop)
│   │   │   ├── layout.tsx         # Admin sidebar, top nav
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx       # Admin dashboard
│   │   │   ├── menu/
│   │   │   │   ├── items/         # Menu item CRUD
│   │   │   │   ├── categories/
│   │   │   │   └── modifiers/
│   │   │   ├── users/             # User management
│   │   │   ├── expenses/          # Expense register
│   │   │   ├── incomes/           # Manual income
│   │   │   ├── shifts/            # Shift history (all)
│   │   │   ├── reports/
│   │   │   │   ├── sales/
│   │   │   │   ├── items/
│   │   │   │   ├── pnl/
│   │   │   │   └── daily-cash/
│   │   │   └── settings/
│   │   │       ├── business/
│   │   │       ├── printer/
│   │   │       └── operational-hours/
│   │   └── api/
│   │       ├── v1/
│   │       │   ├── auth/
│   │       │   │   ├── [...nextauth]/route.ts    # Auth.js catch-all
│   │       │   │   ├── verify-approver/route.ts  # PIN override
│   │       │   │   └── logout/route.ts
│   │       │   ├── menu/
│   │       │   │   ├── items/route.ts            # GET list, POST create
│   │       │   │   ├── items/[id]/route.ts       # GET, PATCH, DELETE
│   │       │   │   ├── categories/route.ts
│   │       │   │   └── modifiers/[slug]/route.ts
│   │       │   ├── transactions/
│   │       │   │   ├── route.ts                  # POST create
│   │       │   │   ├── [id]/route.ts             # GET detail
│   │       │   │   ├── [id]/void/route.ts
│   │       │   │   └── [id]/refund/route.ts
│   │       │   ├── shifts/
│   │       │   │   ├── route.ts                  # POST open
│   │       │   │   └── [id]/close/route.ts
│   │       │   ├── expenses/
│   │       │   ├── incomes/
│   │       │   ├── users/
│   │       │   ├── reports/
│   │       │   ├── settings/
│   │       │   └── stream/
│   │       │       └── menu-updates/route.ts    # SSE endpoint
│   │       └── health/route.ts                  # Health check
│   │
│   ├── features/                  # Feature-based modules
│   │   ├── auth/
│   │   │   ├── actions.ts         # Server actions
│   │   │   ├── queries.ts         # DB queries
│   │   │   ├── schemas.ts         # Zod schemas
│   │   │   ├── types.ts
│   │   │   ├── components/
│   │   │   │   ├── LoginForm.tsx
│   │   │   │   ├── PinPad.tsx
│   │   │   │   └── ApproverOverrideModal.tsx
│   │   │   └── utils.ts
│   │   ├── menu/
│   │   │   ├── actions.ts
│   │   │   ├── queries.ts
│   │   │   ├── schemas.ts
│   │   │   ├── types.ts
│   │   │   └── components/
│   │   │       ├── MenuGrid.tsx
│   │   │       ├── MenuItemForm.tsx
│   │   │       └── ItemModifierModal.tsx
│   │   ├── pos/
│   │   │   ├── actions.ts
│   │   │   ├── queries.ts
│   │   │   ├── offline-queue.ts   # IndexedDB integration (Dexie)
│   │   │   ├── printer.ts         # Web Bluetooth + ESC/POS
│   │   │   ├── receipt-builder.ts # ESC/POS byte stream
│   │   │   ├── schemas.ts
│   │   │   ├── types.ts
│   │   │   └── components/
│   │   │       ├── NewOrderModal.tsx
│   │   │       ├── Cart.tsx
│   │   │       ├── PaymentScreen.tsx
│   │   │       ├── ActiveOrdersList.tsx
│   │   │       └── DraftOrdersSidebar.tsx
│   │   ├── shifts/
│   │   ├── expenses/
│   │   ├── incomes/
│   │   ├── reports/
│   │   ├── users/
│   │   ├── settings/
│   │   └── audit/
│   │       └── logger.ts          # Central audit log helper
│   │
│   ├── components/
│   │   ├── ui/                    # Primitive components (Button, Input, etc.)
│   │   ├── layout/
│   │   └── charts/
│   │
│   ├── db/
│   │   ├── index.ts               # DB connection
│   │   ├── schema/
│   │   │   ├── index.ts           # Re-exports
│   │   │   ├── users.ts
│   │   │   ├── outlets.ts
│   │   │   ├── menu.ts
│   │   │   ├── transactions.ts
│   │   │   ├── shifts.ts
│   │   │   ├── expenses.ts
│   │   │   ├── incomes.ts
│   │   │   ├── audit.ts
│   │   │   └── settings.ts
│   │   ├── migrations/
│   │   └── seed.ts
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── config.ts          # Auth.js config
│   │   │   ├── rbac.ts            # Permission checks
│   │   │   └── session.ts
│   │   ├── money.ts               # Integer-based money utilities
│   │   ├── date.ts                # date-fns-tz helpers (Asia/Jakarta)
│   │   ├── validators.ts          # Shared Zod schemas
│   │   ├── format.ts              # Number/currency formatters (id-ID)
│   │   ├── constants.ts           # MODIFIER_SLUGS, enum values, etc.
│   │   └── utils.ts               # cn(), etc.
│   │
│   ├── middleware.ts              # Next.js middleware (auth check)
│   │
│   └── types/
│       ├── global.d.ts
│       └── web-bluetooth.d.ts
│
├── tests/
│   ├── unit/
│   │   ├── money.test.ts
│   │   ├── discount.test.ts
│   │   ├── transaction.test.ts
│   │   └── ...
│   └── e2e/
│       └── testsprite.config.json
│
├── .env.example
├── .env.local                     # Not committed
├── drizzle.config.ts
├── next.config.mjs                # Serwist PWA config
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
├── .gitignore
├── package.json
└── README.md
```

---

## 4. Database Schema

### 4.1 Schema Design Principles

1. **UUIDs** for all primary keys (via `gen_random_uuid()` or `nanoid`)
2. **Timestamps** `created_at`, `updated_at`, `deleted_at` on all tables
3. **Audit columns** `created_by`, `updated_by` (FK to users)
4. **`outlet_id` on all business tables** (multi-outlet ready, default 1 outlet in Phase 1)
5. **Money columns as `bigint`** (satuan rupiah, no decimal)
6. **Enum values as text** (not native pg enum), constrained via Zod/app-level
7. **Soft delete** via `deleted_at` timestamp; never hard delete
8. **Indexes** on all FK + frequently queried columns

### 4.2 Entity Relationship Diagram (Textual)

```
outlets (1) ──── (N) users
outlets (1) ──── (N) categories
outlets (1) ──── (N) menu_items
outlets (1) ──── (N) transactions
outlets (1) ──── (N) shifts
outlets (1) ──── (N) expenses
outlets (1) ──── (N) incomes

categories (1) ──── (N) menu_items
menu_items (1) ──── (N) transaction_items
users (1) ──── (N) shifts
users (1) ──── (N) transactions (cashier)
shifts (1) ──── (N) transactions
transactions (1) ──── (N) transaction_items
transaction_items (1) ──── (N) transaction_item_modifiers
modifiers (config table, fixed 4 rows) ──── (N) transaction_item_modifiers
audit_logs (standalone, referenced by user_id + entity_id polymorphic)
```

### 4.3 Table Definitions (Drizzle Schema)

**File: `src/db/schema/outlets.ts`**

```typescript
import { pgTable, uuid, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

export const outlets = pgTable('outlets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
  logoUrl: text('logo_url'),
  operationalHours: jsonb('operational_hours').$type<OperationalHours>(),
  settings: jsonb('settings').$type<OutletSettings>().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type OperationalHours = {
  [day in 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun']: {
    isOpen: boolean;
    openTime?: string;  // "HH:mm"
    closeTime?: string;
  };
};

export type OutletSettings = {
  features?: {
    loyaltyEnabled?: boolean;
    recipeEnabled?: boolean;
    multiOutletEnabled?: boolean;
  };
  receipt?: {
    footerText?: string;
    showQrRating?: boolean;
  };
  thresholds?: {
    shiftVarianceAlert?: number;  // default 10000
  };
};
```

**File: `src/db/schema/users.ts`**

```typescript
import { pgTable, uuid, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import { outlets } from './outlets';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  name: text('name').notNull(),
  email: text('email'),  // null for Staff
  passwordHash: text('password_hash'),  // for Owner/Manager
  pinHash: text('pin_hash'),  // for Staff (also for override by Owner/Manager)

  role: text('role', { enum: ['owner', 'manager', 'staff'] }).notNull(),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),

  // Login throttling
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),  // FK self-reference
  updatedBy: uuid('updated_by'),
});
```

**File: `src/db/schema/menu.ts`**

```typescript
import { pgTable, uuid, text, timestamp, boolean, integer, bigint, unique, index } from 'drizzle-orm/pg-core';
import { outlets } from './outlets';
import { users } from './users';

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
}, (t) => ({
  uniqNameOutlet: unique().on(t.outletId, t.name),
  idxOutletActive: index().on(t.outletId, t.isActive),
}));

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),

  name: text('name').notNull(),
  description: text('description'),

  // Pricing: exactly one of these must be set
  priceType: text('price_type', { enum: ['fixed', 'variant', 'open'] }).notNull(),
  priceFixed: bigint('price_fixed', { mode: 'number' }),  // if price_type = 'fixed'
  priceHot: bigint('price_hot', { mode: 'number' }),      // if price_type = 'variant', nullable
  priceIced: bigint('price_iced', { mode: 'number' }),    // if price_type = 'variant', nullable

  isSignature: boolean('is_signature').notNull().default(false),
  isSoldOut: boolean('is_sold_out').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),

  displayOrder: integer('display_order').notNull().default(0),

  // Phase 2 placeholders (nullable)
  costPrice: bigint('cost_price', { mode: 'number' }),
  recipeId: uuid('recipe_id'),  // future FK

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
}, (t) => ({
  idxCategory: index().on(t.categoryId),
  idxOutletActive: index().on(t.outletId, t.isActive),
  uniqNamePerCategory: unique().on(t.categoryId, t.name),
}));

export const modifiers = pgTable('modifiers', {
  slug: text('slug').primaryKey(),  // 'sugar_level', 'ice_level', 'extra_shot', 'extra_topping_ayam'
  label: text('label').notNull(),
  type: text('type', { enum: ['single_select', 'toggle'] }).notNull(),
  optionsJson: jsonb('options_json'),  // for single_select: [{value, label}]
  price: bigint('price', { mode: 'number' }).notNull().default(0),  // for toggle
  appliesToCategories: text('applies_to_categories').array(),  // e.g. ['coffee_based']
  isActive: boolean('is_active').notNull().default(true),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});
```

**File: `src/db/schema/shifts.ts`**

```typescript
import { pgTable, uuid, text, timestamp, bigint, integer, index } from 'drizzle-orm/pg-core';
import { outlets } from './outlets';
import { users } from './users';

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  userId: uuid('user_id').notNull().references(() => users.id),

  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  openingCash: bigint('opening_cash', { mode: 'number' }).notNull(),
  actualCash: bigint('actual_cash', { mode: 'number' }),  // set on close
  variance: bigint('variance', { mode: 'number' }),  // actual - expected, set on close

  notes: text('notes'),

  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxUserStatus: index().on(t.userId, t.status),
  idxOpenedAt: index().on(t.openedAt),
}));
```

**File: `src/db/schema/transactions.ts`**

```typescript
import { pgTable, uuid, text, timestamp, bigint, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { outlets } from './outlets';
import { users } from './users';
import { shifts } from './shifts';
import { menuItems } from './menu';

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id),
  cashierId: uuid('cashier_id').notNull().references(() => users.id),

  // Client reference for offline sync dedup
  clientRefId: uuid('client_ref_id').unique(),

  // Human-readable number: TRX-YYYYMMDD-NNNN
  transactionNumber: text('transaction_number').notNull().unique(),

  pagerNumber: integer('pager_number').notNull(),
  orderType: text('order_type', { enum: ['dine_in', 'takeaway'] }).notNull(),

  subtotal: bigint('subtotal', { mode: 'number' }).notNull(),
  discountType: text('discount_type', { enum: ['percent', 'fixed'] }),
  discountValue: bigint('discount_value', { mode: 'number' }),  // percent (0-100) or fixed rupiah
  discountAmount: bigint('discount_amount', { mode: 'number' }).notNull().default(0),  // computed rupiah
  discountReason: text('discount_reason'),
  total: bigint('total', { mode: 'number' }).notNull(),

  paymentMethod: text('payment_method', { enum: ['cash', 'qris', 'card_bca'] }).notNull(),
  cashReceived: bigint('cash_received', { mode: 'number' }),  // null if not cash
  cashChange: bigint('cash_change', { mode: 'number' }),  // null if not cash

  status: text('status', { enum: ['paid', 'voided', 'refunded'] }).notNull().default('paid'),

  // Void info
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by').references(() => users.id),
  voidedApprover: uuid('voided_approver').references(() => users.id),
  voidReason: text('void_reason'),

  // Refund info
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  refundedBy: uuid('refunded_by').references(() => users.id),
  refundedApprover: uuid('refunded_approver').references(() => users.id),
  refundReason: text('refund_reason'),

  // Discount authorization
  discountApprover: uuid('discount_approver').references(() => users.id),

  // Service tracking
  servedAt: timestamp('served_at', { withTimezone: true }),

  // Phase 2 placeholders
  customerId: uuid('customer_id'),
  loyaltyPointsEarned: integer('loyalty_points_earned'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxShift: index().on(t.shiftId),
  idxOutletDate: index().on(t.outletId, t.createdAt),
  idxStatus: index().on(t.status),
  idxPaymentMethod: index().on(t.paymentMethod),
}));

export const transactionItems = pgTable('transaction_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id),

  // Snapshot data (don't rely on menu_items since that can change)
  itemName: text('item_name').notNull(),
  itemCategoryName: text('item_category_name').notNull(),

  variant: text('variant', { enum: ['hot', 'iced'] }),  // null if no variant
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),  // base price per unit
  quantity: integer('quantity').notNull(),
  modifiersPriceDelta: bigint('modifiers_price_delta', { mode: 'number' }).notNull().default(0),
  subtotal: bigint('subtotal', { mode: 'number' }).notNull(),  // (unit_price + modifiers_price_delta) * quantity

  note: text('note'),  // item-level free text
  openPriceNote: text('open_price_note'),  // for manual brew beans info

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxTransaction: index().on(t.transactionId),
  idxMenuItem: index().on(t.menuItemId),
}));

export const transactionItemModifiers = pgTable('transaction_item_modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionItemId: uuid('transaction_item_id').notNull().references(() => transactionItems.id),

  modifierSlug: text('modifier_slug').notNull(),  // FK to modifiers.slug
  selectedValue: text('selected_value'),  // e.g. 'less' for sugar_level, 'on' for extra_shot
  priceDelta: bigint('price_delta', { mode: 'number' }).notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxTxItem: index().on(t.transactionItemId),
}));
```

**File: `src/db/schema/expenses.ts`**

```typescript
import { pgTable, uuid, text, timestamp, bigint, date, index } from 'drizzle-orm/pg-core';
import { outlets } from './outlets';
import { users } from './users';
import { transactions } from './transactions';

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),  // system categories can't be deleted (e.g. 'Refund')
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  uniqName: unique().on(t.outletId, t.name),
}));

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  expenseDate: date('expense_date').notNull(),
  categoryId: uuid('category_id').notNull().references(() => expenseCategories.id),
  description: text('description').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  paymentMethod: text('payment_method', { enum: ['cash', 'transfer', 'other'] }).notNull(),
  receiptImageUrl: text('receipt_image_url'),

  // Auto-generated from refund
  refundedTransactionId: uuid('refunded_transaction_id').references(() => transactions.id),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  deletedBy: uuid('deleted_by').references(() => users.id),
}, (t) => ({
  idxDate: index().on(t.outletId, t.expenseDate),
  idxCategory: index().on(t.categoryId),
}));

export const incomes = pgTable('incomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  incomeDate: date('income_date').notNull(),
  description: text('description').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  paymentMethod: text('payment_method', { enum: ['cash', 'transfer', 'other'] }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
});
```

**File: `src/db/schema/audit.ts`**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),  // e.g. 'transaction.voided'
  userId: uuid('user_id').references(() => users.id),
  approverId: uuid('approver_id').references(() => users.id),
  entityType: text('entity_type'),  // e.g. 'transaction', 'menu_item'
  entityId: uuid('entity_id'),

  payload: jsonb('payload'),  // flexible context
  metadata: jsonb('metadata'),  // IP, user agent, etc.

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxEventType: index().on(t.eventType),
  idxUser: index().on(t.userId),
  idxEntity: index().on(t.entityType, t.entityId),
  idxCreatedAt: index().on(t.createdAt),
}));
```

### 4.4 Seed Data Overview

The `src/db/seed.ts` will populate:

1. Default outlet (Mahakan Coffee & Space)
2. Default Owner user (email + password from env vars)
3. 10 categories with display order
4. 45 menu items (see `04-MENU-DATA.md`)
5. 4 modifier config rows
6. 8 default expense categories
7. 1 system "Refund" expense category

### 4.5 Database Connection (File: `src/db/index.ts`)

```typescript
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

For local development: use `drizzle-orm/postgres-js` with local Postgres Docker container.

---

## 5. API Design

### 5.1 API Principles

- **Prefix:** All REST endpoints under `/api/v1/`
- **Server Actions:** Preferred for mutations from RSC/forms; defined in `features/*/actions.ts`
- **Response envelope:**
  ```json
  // Success
  { "success": true, "data": {...}, "meta": {...} }
  // Error
  { "success": false, "error": { "code": "...", "message": "...", "field": "..." } }
  ```
- **Auth:** All endpoints require session EXCEPT `/api/health`, `/api/v1/auth/login*`
- **Content-Type:** `application/json` except file uploads (`multipart/form-data`)

### 5.2 Endpoint Summary

Full detail in `08-API-SPEC.md`. Summary:

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/v1/auth/[...nextauth]` | Auth.js (login/logout/session) | Public |
| POST | `/api/v1/auth/verify-approver` | PIN override verification | Session |
| GET | `/api/v1/menu/items` | List menu items | Any |
| POST | `/api/v1/menu/items` | Create menu item | Manager+ |
| PATCH | `/api/v1/menu/items/:id` | Update menu item | Manager+ |
| DELETE | `/api/v1/menu/items/:id` | Soft-delete menu item | Manager+ |
| PATCH | `/api/v1/menu/items/:id/sold-out` | Toggle sold-out | Any |
| POST | `/api/v1/transactions` | Create transaction | Any (staff+) |
| GET | `/api/v1/transactions/:id` | Get transaction detail | Any |
| POST | `/api/v1/transactions/:id/void` | Void transaction | Manager+ (or Staff with approver) |
| POST | `/api/v1/transactions/:id/refund` | Refund transaction | Manager+ (or Staff with approver) |
| POST | `/api/v1/shifts` | Open shift | Any |
| POST | `/api/v1/shifts/:id/close` | Close shift | Any (own shift) |
| POST | `/api/v1/expenses` | Create expense | Manager+ |
| GET | `/api/v1/reports/sales/daily` | Daily sales report | Manager+ |
| GET | `/api/v1/reports/pnl` | P&L report | Owner only |
| GET | `/api/v1/stream/menu-updates` | SSE for real-time menu sync | Any session |

### 5.3 Example Server Action (for mutation)

```typescript
// src/features/pos/actions.ts
'use server';

import { z } from 'zod';
import { auth } from '@/lib/auth/config';
import { db } from '@/db';
import { transactions, transactionItems } from '@/db/schema';
import { createTransactionSchema } from './schemas';
import { generateTransactionNumber } from './utils';
import { logAudit } from '@/features/audit/logger';
import { computeTotal } from '@/lib/money';

export async function createTransaction(input: unknown) {
  const session = await auth();
  if (!session?.user) return { success: false, error: { code: 'AUTH_REQUIRED' } };

  const parsed = createTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: { code: 'VALIDATION', message: parsed.error.message } };
  }

  const data = parsed.data;

  // Server-side total recompute (security)
  const computed = computeTotal(data.items, data.discount);
  if (computed.total !== data.total) {
    return { success: false, error: { code: 'TOTAL_MISMATCH' } };
  }

  // DB transaction
  const result = await db.transaction(async (tx) => {
    const trxNumber = await generateTransactionNumber(tx);
    const [transaction] = await tx.insert(transactions).values({
      // ... fields
      transactionNumber: trxNumber,
      cashierId: session.user.id,
      // ...
    }).returning();

    for (const item of data.items) {
      await tx.insert(transactionItems).values({ /* ... */ });
    }

    return transaction;
  });

  await logAudit({
    eventType: 'transaction.created',
    userId: session.user.id,
    entityType: 'transaction',
    entityId: result.id,
    payload: { total: result.total, itemsCount: data.items.length },
  });

  return { success: true, data: result };
}
```

### 5.4 SSE: Menu Updates Stream

**File: `src/app/api/v1/stream/menu-updates/route.ts`**

```typescript
import { auth } from '@/lib/auth/config';
import { subscribeToMenuUpdates } from '@/features/menu/pubsub';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const stream = new ReadableStream({
    async start(controller) {
      const unsubscribe = subscribeToMenuUpdates(session.user.outletId, (event) => {
        const chunk = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      });

      request.signal.addEventListener('abort', () => {
        unsubscribe();
        controller.close();
      });

      // Initial ping
      controller.enqueue(new TextEncoder().encode(`: connected\n\n`));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

**Note on Vercel SSE limitations:** SSE on Vercel serverless has 60s max duration on free tier. Implement heartbeat + reconnect logic on client. For Phase 2 consider Vercel's Edge Runtime or third-party pub/sub (Ably, Pusher).

**Phase 1 pragmatic approach:** Client polls `/api/v1/menu/items?modifiedSince=X` every 30 seconds as fallback. SSE is enhancement, polling is baseline.

---

## 6. Authentication & Authorization

### 6.1 Auth.js v5 Configuration

**File: `src/lib/auth/config.ts`**

```typescript
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: 'jwt', maxAge: 2 * 60 * 60 }, // 2 hours default
  providers: [
    Credentials({
      id: 'email-password',
      name: 'Email & Password',
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const email = (credentials.email as string)?.toLowerCase();
        const password = credentials.password as string;
        if (!email || !password) return null;

        const [user] = await db.select().from(users).where(
          and(eq(users.email, email), isNull(users.deletedAt))
        );
        if (!user || user.status !== 'active') return null;
        if (!user.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          // Increment failed attempts
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          outletId: user.outletId,
        };
      },
    }),
    Credentials({
      id: 'pin',
      name: 'PIN',
      credentials: {
        userId: {},
        pin: {},
      },
      async authorize(credentials) {
        const userId = credentials.userId as string;
        const pin = credentials.pin as string;
        if (!userId || !pin) return null;

        const [user] = await db.select().from(users).where(
          and(eq(users.id, userId), isNull(users.deletedAt))
        );
        if (!user || user.status !== 'active' || !user.pinHash) return null;

        const ok = await bcrypt.compare(pin, user.pinHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          role: user.role,
          outletId: user.outletId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = user.role;
        token.outletId = user.outletId;
      }
      // Extend session for POS (12h) on PIN login
      if (trigger === 'signIn' && user?.role === 'staff') {
        token.exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as string;
      session.user.outletId = token.outletId as string;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
```

### 6.2 RBAC Helper

**File: `src/lib/auth/rbac.ts`**

```typescript
import { auth } from './config';

export type Role = 'owner' | 'manager' | 'staff';

export const permissions = {
  // POS
  'pos.transaction.create': ['owner', 'manager', 'staff'],
  'pos.transaction.void': ['owner', 'manager'],
  'pos.transaction.refund': ['owner', 'manager'],
  'pos.discount.apply': ['owner', 'manager'],

  // Menu
  'menu.item.crud': ['owner', 'manager'],
  'menu.item.mark_sold_out': ['owner', 'manager', 'staff'],
  'menu.item.mark_available': ['owner', 'manager'],

  // User
  'user.crud.staff': ['owner', 'manager'],
  'user.crud.manager': ['owner'],
  'user.crud.owner': ['owner'],

  // Reports
  'reports.operational': ['owner', 'manager'],
  'reports.financial': ['owner'],
  'reports.pnl': ['owner'],

  // Settings
  'settings.business': ['owner'],
  'settings.printer': ['owner', 'manager'],

  // Expenses
  'expense.create': ['owner', 'manager'],
  'expense.delete': ['owner'],
} as const satisfies Record<string, Role[]>;

export type PermissionKey = keyof typeof permissions;

export function hasPermission(role: Role, permission: PermissionKey): boolean {
  return (permissions[permission] as readonly Role[]).includes(role);
}

export async function requirePermission(permission: PermissionKey) {
  const session = await auth();
  if (!session?.user) {
    throw new Error('UNAUTHORIZED');
  }
  if (!hasPermission(session.user.role as Role, permission)) {
    throw new Error('FORBIDDEN');
  }
  return session;
}
```

### 6.3 Approver Override Pattern

Server Action or API endpoint that needs approver:

```typescript
export async function voidTransaction(input: { transactionId: string; approverToken?: string; reason: string }) {
  const session = await auth();
  if (!session?.user) return { success: false, error: { code: 'UNAUTHORIZED' } };

  const userRole = session.user.role as Role;

  if (userRole === 'staff') {
    if (!input.approverToken) {
      return { success: false, error: { code: 'APPROVER_REQUIRED' } };
    }
    const approverInfo = await verifyApproverToken(input.approverToken, {
      action: 'transaction.void',
      targetId: input.transactionId,
    });
    if (!approverInfo.valid) {
      return { success: false, error: { code: 'APPROVER_INVALID' } };
    }
    // proceed, record approver_id = approverInfo.approverId
  }
  // ... void logic
}
```

Approver token is a signed, single-use JWT with 5-min expiry. Redis/in-memory store for used-token blacklist (Phase 1: in-memory Map; Phase 2: Redis).

### 6.4 Middleware

**File: `src/middleware.ts`**

```typescript
import { auth } from '@/lib/auth/config';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public routes
  const isPublic = pathname === '/login' || pathname === '/pos/login' || pathname === '/api/health';
  if (isPublic) return;

  // Need auth
  if (!req.auth) {
    const loginUrl = pathname.startsWith('/pos') ? '/pos/login' : '/login';
    return NextResponse.redirect(new URL(loginUrl, req.url));
  }

  // Role-based redirects
  const role = req.auth.user?.role;
  if (pathname === '/') {
    if (role === 'owner' || role === 'manager') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
    if (role === 'staff') {
      return NextResponse.redirect(new URL('/pos', req.url));
    }
  }
});

export const config = {
  matcher: ['/((?!_next|favicon.ico|icons|fonts|logo.png).*)'],
};
```

---

## 7. PWA Strategy

### 7.1 Serwist Config

**File: `next.config.mjs`**

```javascript
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
});

export default withSerwist({
  experimental: { typedRoutes: true },
});
```

### 7.2 Service Worker

**File: `src/app/sw.ts`**

```typescript
import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope {
    __SW_MANIFEST: (string | { revision: string | null; url: string })[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Cache menu API
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/v1/menu/items'),
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'menu-cache',
        expiration: { maxAgeSeconds: 60 * 60 }, // 1 hour
      },
    },
    // Don't cache transaction API (always fresh)
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/v1/transactions'),
      handler: 'NetworkOnly',
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
```

### 7.3 Manifest

**File: `src/app/manifest.ts`**

```typescript
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mahakan Coffee POS',
    short_name: 'Mahakan POS',
    description: 'POS System for Mahakan Coffee & Space',
    start_url: '/pos',
    display: 'standalone',
    background_color: '#FAFAF7',  // warm off-white (neutral-50)
    theme_color: '#539371',  // Mahakan logo sage green
    orientation: 'any',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

### 7.4 Offline Queue (Dexie/IndexedDB)

**File: `src/features/pos/offline-queue.ts`**

```typescript
import Dexie, { Table } from 'dexie';

export interface PendingTransaction {
  id?: number;
  clientRefId: string;  // UUID
  payload: any;  // serialized transaction request
  createdAt: Date;
  syncStatus: 'pending' | 'synced' | 'failed';
  syncAttempts: number;
  lastError?: string;
  serverTransactionId?: string;
  serverTransactionNumber?: string;
}

export interface CachedMenuItem {
  id: string;
  data: any;
  cachedAt: Date;
}

class MahakanDB extends Dexie {
  pendingTransactions!: Table<PendingTransaction>;
  cachedMenu!: Table<CachedMenuItem>;
  draftOrders!: Table<any>;

  constructor() {
    super('mahakan-pos');
    this.version(1).stores({
      pendingTransactions: '++id, clientRefId, syncStatus, createdAt',
      cachedMenu: 'id, cachedAt',
      draftOrders: 'id, updatedAt',
    });
  }
}

export const offlineDB = new MahakanDB();

export async function enqueueTransaction(payload: any): Promise<string> {
  const clientRefId = crypto.randomUUID();
  await offlineDB.pendingTransactions.add({
    clientRefId,
    payload,
    createdAt: new Date(),
    syncStatus: 'pending',
    syncAttempts: 0,
  });
  return clientRefId;
}

export async function syncPendingTransactions(): Promise<{ synced: number; failed: number }> {
  const pending = await offlineDB.pendingTransactions
    .where('syncStatus').equals('pending')
    .toArray();

  let synced = 0, failed = 0;
  for (const tx of pending) {
    try {
      const res = await fetch('/api/v1/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tx.payload, clientRefId: tx.clientRefId }),
      });
      if (res.ok) {
        const data = await res.json();
        await offlineDB.pendingTransactions.update(tx.id!, {
          syncStatus: 'synced',
          serverTransactionId: data.data.id,
          serverTransactionNumber: data.data.transactionNumber,
        });
        synced++;
      } else {
        await offlineDB.pendingTransactions.update(tx.id!, {
          syncStatus: 'failed',
          syncAttempts: tx.syncAttempts + 1,
          lastError: await res.text(),
        });
        failed++;
      }
    } catch (e: any) {
      await offlineDB.pendingTransactions.update(tx.id!, {
        syncAttempts: tx.syncAttempts + 1,
        lastError: e.message,
      });
      failed++;
    }
  }
  return { synced, failed };
}
```

**Hook usage:**

```typescript
export function useOnlineSync() {
  useEffect(() => {
    const handleOnline = () => { syncPendingTransactions(); };
    window.addEventListener('online', handleOnline);
    const interval = setInterval(() => {
      if (navigator.onLine) syncPendingTransactions();
    }, 30_000);
    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, []);
}
```

---

## 8. Thermal Printer Integration

### 8.1 ESC/POS Receipt Builder

**File: `src/features/pos/receipt-builder.ts`**

```typescript
// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: new Uint8Array([ESC, 0x40]),
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),
  DOUBLE_SIZE: new Uint8Array([ESC, 0x21, 0x30]),
  NORMAL_SIZE: new Uint8Array([ESC, 0x21, 0x00]),
  LF: new Uint8Array([LF]),
  CUT: new Uint8Array([GS, 0x56, 0x42, 0x00]),
};

const CHARS_PER_LINE_58MM = 32;

export interface ReceiptData {
  business: { name: string; address?: string; phone?: string };
  transactionNumber: string;
  pagerNumber: number;
  orderType: 'dine_in' | 'takeaway';
  cashierName: string;
  timestamp: Date;
  items: Array<{
    name: string;
    variant?: 'hot' | 'iced';
    quantity: number;
    unitPrice: number;
    modifiers?: string[];
    note?: string;
  }>;
  subtotal: number;
  discountAmount?: number;
  total: number;
  paymentMethod: 'cash' | 'qris' | 'card_bca';
  cashReceived?: number;
  cashChange?: number;
  footerText?: string;
}

export function buildReceipt(data: ReceiptData): Uint8Array {
  const chunks: Uint8Array[] = [CMD.INIT];

  // Header
  chunks.push(CMD.ALIGN_CENTER, CMD.DOUBLE_SIZE);
  chunks.push(text(data.business.name));
  chunks.push(CMD.NORMAL_SIZE, CMD.LF);

  if (data.business.address) {
    chunks.push(text(data.business.address), CMD.LF);
  }
  if (data.business.phone) {
    chunks.push(text(`Telp: ${data.business.phone}`), CMD.LF);
  }
  chunks.push(separator());

  // Order info
  chunks.push(CMD.ALIGN_LEFT);
  chunks.push(text(`Order: ${data.transactionNumber}`), CMD.LF);
  chunks.push(text(`Pager: ${data.pagerNumber} | ${data.orderType === 'dine_in' ? 'Dine-in' : 'Takeaway'}`), CMD.LF);
  chunks.push(text(`Kasir: ${data.cashierName}`), CMD.LF);
  chunks.push(text(formatDate(data.timestamp)), CMD.LF);
  chunks.push(separator());

  // Items
  for (const item of data.items) {
    const nameWithVariant = item.variant
      ? `${item.name} ${item.variant === 'hot' ? 'Hot' : 'Iced'}`
      : item.name;
    const line = formatItemLine(`${item.quantity}x ${nameWithVariant}`, item.quantity * item.unitPrice);
    chunks.push(text(line), CMD.LF);

    if (item.modifiers && item.modifiers.length > 0) {
      chunks.push(text(`   ${item.modifiers.join(', ')}`), CMD.LF);
    }
    if (item.note) {
      chunks.push(text(`   Catatan: "${item.note}"`), CMD.LF);
    }
  }
  chunks.push(separator());

  // Totals
  chunks.push(text(formatItemLine('Subtotal', data.subtotal)), CMD.LF);
  if (data.discountAmount && data.discountAmount > 0) {
    chunks.push(text(formatItemLine('Diskon', -data.discountAmount)), CMD.LF);
  }
  chunks.push(CMD.BOLD_ON, text(formatItemLine('TOTAL', data.total)), CMD.BOLD_OFF, CMD.LF);
  chunks.push(separator());

  // Payment
  const methodLabel = {
    cash: 'Tunai',
    qris: 'QRIS',
    card_bca: 'Kartu BCA',
  }[data.paymentMethod];
  chunks.push(text(`Metode: ${methodLabel}`), CMD.LF);
  if (data.paymentMethod === 'cash' && data.cashReceived != null) {
    chunks.push(text(formatItemLine('Diterima', data.cashReceived)), CMD.LF);
    chunks.push(text(formatItemLine('Kembalian', data.cashChange ?? 0)), CMD.LF);
  }
  chunks.push(separator());

  // Footer
  chunks.push(CMD.ALIGN_CENTER);
  chunks.push(text(data.footerText ?? 'Terima kasih, sampai jumpa!'), CMD.LF);
  chunks.push(CMD.LF, CMD.LF, CMD.LF);
  chunks.push(CMD.CUT);

  return concat(chunks);
}

// Helpers
function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);  // UTF-8; for CP850 translate manually
}

function separator(): Uint8Array {
  return text('-'.repeat(CHARS_PER_LINE_58MM) + '\n');
}

function formatItemLine(label: string, amount: number): string {
  const amountStr = formatRupiah(amount);
  const spaces = CHARS_PER_LINE_58MM - label.length - amountStr.length;
  return label + ' '.repeat(Math.max(1, spaces)) + amountStr;
}

function formatRupiah(amount: number): string {
  return amount.toLocaleString('id-ID');
}

function formatDate(d: Date): string {
  // format: DD/MM/YYYY HH:mm (WIB)
  const opt: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  };
  return d.toLocaleString('id-ID', opt);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
```

### 8.2 Printer Connection

**File: `src/features/pos/printer.ts`**

```typescript
// RPP02 58mm printer — Web Bluetooth
// UUIDs may vary by firmware; these are common defaults

const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';  // Generic Serial
const CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';  // Write

export class ThermalPrinter {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;

  async pair(): Promise<void> {
    if (!('bluetooth' in navigator)) {
      throw new Error('Web Bluetooth tidak didukung di browser ini');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });

    await this.connect();
  }

  async connect(): Promise<void> {
    if (!this.device) throw new Error('No device paired');
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  }

  async print(data: Uint8Array): Promise<void> {
    if (!this.characteristic) {
      await this.connect();
    }

    // Write in chunks of 512 bytes (BLE MTU limit)
    const CHUNK = 512;
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      await this.characteristic!.writeValueWithoutResponse(chunk);
    }
  }

  get isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }
}

export const printer = new ThermalPrinter();
```

### 8.3 Print Flow Usage

```typescript
// After successful transaction
import { printer } from './printer';
import { buildReceipt } from './receipt-builder';

async function printTransaction(transaction) {
  try {
    const bytes = buildReceipt({ /* ... */ });
    await printer.print(bytes);
    toast.success('Struk tercetak');
  } catch (e) {
    toast.error('Printer gagal. Coba lagi?', {
      action: { label: 'Cetak Ulang', onClick: () => printTransaction(transaction) },
    });
  }
}
```

### 8.4 Known Printer Compatibility Notes

- **RPP02 confirmed working with ESC/POS** (user tested with Majoo for 3 years)
- Service UUID `000018f0-...` is the most common for these printers; if different, use Bluetooth device info to discover
- Some RPP02 variants use CP437 encoding; Indonesian characters (ó, é) may render as "?"

### 8.5 Logo Printing (Mahakan Specific)

Source: `Logo_Mahakan_Hitam.png` (black variant — best for thermal).

**Binarize preprocessing (done once, server-side or build-time):**

```typescript
// scripts/prepare-receipt-logo.ts — run once, output to public/assets/logo/receipt-logo.bin
import sharp from 'sharp';

async function prepareLogo() {
  const input = 'public/assets/logo/Logo_Mahakan_Hitam.png';
  // Thermal 58mm printer: max 384 dots wide. Use 200px for safety with margins.
  const TARGET_WIDTH = 200;
  const TARGET_HEIGHT = 280;  // proportional to logo aspect ratio (~1.41)

  const { data } = await sharp(input)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'contain', background: 'white' })
    .greyscale()
    .threshold(128)  // binarize: pixels below 128 become black, above become white
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert to ESC/POS bitmap format (GS v 0)
  // Each byte = 8 horizontal pixels, LSB first
  const bytesPerRow = Math.ceil(TARGET_WIDTH / 8);
  const bitmap = new Uint8Array(bytesPerRow * TARGET_HEIGHT);
  // ... packing loop
  return bitmap;
}
```

**Embed in receipt (receipt-builder.ts):**

```typescript
// GS v 0 m xL xH yL yH d1..dk — Print bitmap
function logoBitmapCommand(bitmap: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  const widthBytes = Math.ceil(widthPx / 8);
  const xL = widthBytes & 0xFF;
  const xH = (widthBytes >> 8) & 0xFF;
  const yL = heightPx & 0xFF;
  const yH = (heightPx >> 8) & 0xFF;
  return new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,  // GS v 0, mode=0 (normal)
    xL, xH, yL, yH,
    ...bitmap,
  ]);
}
```

**Receipt layout with logo:**

```
         [LOGO 200x280 binarized]
         MAHAKAN COFFEE & SPACE
  Puncak Rd No.KM 22, Cisarua, Bogor
           Telp: 0838-1977-5665
--------------------------------
ORDER: TRX-20260420-0012
...
```

**Phase 1 fallback:** If binarize logo printing is complex to implement on MVP, ship with text-only header first (still looks professional). Add logo rendering in Week 4-5 refinement pass.

---

## 9. Money Utilities

**File: `src/lib/money.ts`**

```typescript
/**
 * All money is INTEGER (rupiah satuan), no decimals.
 * NEVER use floating point for money.
 */

export type Rupiah = number;  // brand type for clarity

export function toRupiah(n: number): Rupiah {
  if (!Number.isFinite(n)) throw new Error('Invalid number');
  return Math.trunc(n);
}

/**
 * Discount amount from subtotal.
 * Rounds using banker's rounding (round half to even).
 */
export function computeDiscountAmount(
  subtotal: Rupiah,
  discount: { type: 'percent'; value: number } | { type: 'fixed'; value: Rupiah } | null,
): Rupiah {
  if (!discount) return 0;
  if (discount.type === 'fixed') {
    return Math.max(0, Math.min(subtotal, discount.value));
  }
  const raw = (subtotal * discount.value) / 100;
  return bankersRound(raw);
}

export function computeTotal(subtotal: Rupiah, discountAmount: Rupiah): Rupiah {
  return Math.max(0, subtotal - discountAmount);
}

export function computeItemSubtotal(unitPrice: Rupiah, modifiersDelta: Rupiah, quantity: number): Rupiah {
  return (unitPrice + modifiersDelta) * quantity;
}

function bankersRound(n: number): Rupiah {
  const rounded = Math.round(n);
  const diff = Math.abs(n - Math.trunc(n));
  if (diff === 0.5) {
    // Round half to even
    const truncated = Math.trunc(n);
    return truncated % 2 === 0 ? truncated : truncated + Math.sign(n);
  }
  return rounded;
}

/**
 * Format rupiah for display: 1250000 -> "Rp 1.250.000"
 */
export function formatRupiah(n: Rupiah): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

/**
 * Parse "1.250.000" or "1250000" -> 1250000
 */
export function parseRupiah(s: string): Rupiah {
  const cleaned = s.replace(/[^\d]/g, '');
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n)) throw new Error('Invalid rupiah string');
  return n;
}
```

---

## 10. Testing Strategy (Summary)

Full detail in `09-TESTING-STRATEGY.md`. Summary:

- **Unit tests (Vitest):** All utils (`money.ts`, `date.ts`), business logic in `features/*/utils.ts`, Zod schemas. Target 80%+ coverage on business logic.
- **Integration tests:** API routes with test DB, Drizzle migrations against fresh schema.
- **E2E tests (TestSprite):** Happy paths: login → new order → payment → print; shift open/close; menu CRUD; expense logging.
- **Manual test matrix:** Before soft launch, exercise every P1-xxx FSD flow with real printer, EDC, and offline toggle.

---

## 11. Deployment

### 11.1 Environment Variables

```
# .env.example
DATABASE_URL=postgres://user:pass@host/db
AUTH_SECRET=<generate-with-openssl-rand-base64-32>
AUTH_TRUST_HOST=true
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://mahakan-pos.vercel.app

# Vercel Blob (optional Phase 1)
BLOB_READ_WRITE_TOKEN=

# Default admin bootstrap (only used on first seed)
SEED_OWNER_EMAIL=
SEED_OWNER_PASSWORD=
SEED_OWNER_NAME=
```

### 11.2 Vercel Deployment Steps

1. Push code to GitHub
2. Import project in Vercel
3. Set env vars (Neon connection string, auth secret)
4. Connect Neon Postgres branch (Vercel has Neon integration)
5. First deploy → run migrations: `npm run db:migrate`
6. Seed initial data: manually run `npm run db:seed` via Vercel CLI or separate bootstrap endpoint
7. Verify: `/api/health` returns 200

### 11.3 Vercel Specific Considerations

- **Free tier constraints:** 100GB bandwidth, serverless function timeout 10s (paid 60s). For reports > 1 month data, may hit timeout — optimize queries with proper indexes.
- **SSE 60s limit:** Client must reconnect. Fallback polling handles this.
- **Cold start:** First request after inactivity is slower (~1-3s). Acceptable for POS which keeps connection warm.
- **Neon auto-suspend:** Free tier Neon suspends after 5 min idle. Cold reconnect ~1-2s. Keep-alive via periodic health check from client.

### 11.4 Migration Path Away from Vercel (if needed)

Future-proofing: if Vercel becomes constrained:
- Code is plain Next.js, deployable to any Node.js host
- Alternatives: Railway, Render, Fly.io, self-hosted VPS (Biznet Gio, IDCloudHost)
- Replace Vercel Blob with S3-compatible storage (Cloudflare R2, MinIO)
- Replace Neon with managed Postgres (Supabase, self-hosted)

---

## 12. Security Checklist

| Item | Implementation |
|---|---|
| HTTPS enforced | Vercel default |
| Password hashing | bcrypt 12 rounds |
| PIN hashing | bcrypt 12 rounds |
| Session via JWT | httpOnly, secure, sameSite=lax cookie |
| CSRF protection | Auth.js built-in + Server Actions include CSRF token |
| SQL injection | Drizzle parameterizes all queries |
| XSS | React escapes by default; sanitize user input in receipts/logs |
| Rate limiting | Per-endpoint middleware (Upstash Ratelimit or in-memory for Phase 1) |
| Audit logs | Every sensitive action logged with user_id, timestamp, before/after |
| RBAC enforced server-side | Middleware + Server Action check |
| Secrets in env vars | Never commit; Vercel env UI |
| Input validation | Zod on every endpoint |
| File upload validation | Mime check + size limit (2MB) + extension whitelist |
| Session expiry | 12h POS, 2h admin |
| Auto-logout on inactivity | Client-side heartbeat, logout after idle |

---

## 13. Performance Targets

| Metric | Target | Strategy |
|---|---|---|
| POS cold load | < 2s on 4G | PWA precache, code split by route |
| Tap → cart update | < 200ms | Optimistic UI |
| Payment → receipt print | < 3s | Server Action + Web Bluetooth |
| Menu CRUD response | < 500ms | Indexed queries, no N+1 |
| Daily sales report | < 3s for 1 month | Pre-aggregated queries with date index |
| SSE reconnect | < 5s after online | Exponential backoff |

---

## 14. TSD Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial TSD based on PRD v1.0, FSD v1.0 |

---

# 🛑 END OF TSD v1.0

**Status:** ✅ APPROVED
**Next Step:** Implementation — Phase 0 (Foundation: setup project, DB schema, auth, design system)
