# 🗄️ DATABASE SCHEMA — Mahakan Coffee & Space

**Database Schema Reference**
**Version:** 1.0
**Database:** Postgres (Neon)
**ORM:** Drizzle
**Depends on:** `03-TSD.md` (section 4)
**Status:** ✅ APPROVED

---

## 1. Overview

This document is the **visual reference companion** to the Drizzle schema code in `03-TSD.md`. Use this document when you need:

- ASCII ERD to understand relationships at a glance
- Per-table reference during implementation
- Index and constraint justification
- Migration & seeding strategy

For executable schema definitions, always refer to `src/db/schema/*.ts`. This document must stay in sync with the code — if they diverge, **code is the source of truth**; update this doc accordingly.

---

## 2. Entity Relationship Diagram

```
                                  ┌─────────────┐
                                  │   outlets   │
                                  └──────┬──────┘
                                         │ 1
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
               ▼ N                       ▼ N                       ▼ N
         ┌──────────┐             ┌──────────────┐           ┌──────────┐
         │  users   │             │  categories  │           │  shifts  │
         └────┬─────┘             └──────┬───────┘           └────┬─────┘
              │ 1                        │ 1                      │ 1
              │                          │                        │
              │                          ▼ N                      │
              │                    ┌──────────────┐               │
              │                    │  menu_items  │               │
              │                    └──────┬───────┘               │
              │                           │ 1                     │
              │                           │                       │
              │              ┌────────────┘                       │
              │              │                                    │
              │              ▼ N                                  │
              │        ┌───────────────────┐                      │
              │        │ transaction_items │                      │
              │        └─────────┬─────────┘                      │
              │                  │ N                              │
              │                  │                                │
              │                  ▼ 1                              │
              │            ┌───────────────┐                      │
              └────────────┤ transactions  ├──────────────────────┘
                     N     └───────┬───────┘  N
                                   │ 1
                                   │
                                   ▼ N
                          ┌────────────────────────────┐
                          │ transaction_item_modifiers │
                          └────────────────────────────┘

        ┌────────────┐        ┌──────────┐        ┌──────────────────────┐
        │ modifiers  │        │ expenses │        │ expense_categories   │
        │  (config)  │        └────┬─────┘        └──────────┬───────────┘
        └────────────┘             │ N                       │ 1
                                   └─────────────────────────┘

        ┌──────────┐        ┌─────────────┐
        │ incomes  │        │ audit_logs  │
        └──────────┘        └─────────────┘
                             (polymorphic ref to any entity)
```

---

## 3. Tables Reference

All timestamps are `timestamp with timezone` (stored UTC). All money columns are `bigint` (rupiah satuan, integer). All primary keys are `uuid` unless noted.

### 3.1 `outlets`

Tenancy root. Phase 1 has 1 row; schema forward-compatible for multi-outlet.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `name` | text | No | | |
| `address` | text | Yes | | |
| `phone` | text | Yes | | |
| `logo_url` | text | Yes | | Blob storage URL |
| `operational_hours` | jsonb | Yes | | See `OperationalHours` type |
| `settings` | jsonb | No | `'{}'` | See `OutletSettings` type (feature flags, thresholds) |
| `is_active` | boolean | No | `true` | |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | Soft delete |

**Indexes:** `id` (PK)

**Phase 2+ expansion:**
- `parent_outlet_id` for franchise/chain structure
- `timezone` per-outlet if expanding beyond Indonesia
- `currency_code` per-outlet for multi-currency

### 3.2 `users`

All roles stored in same table; differentiated by `role` column.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK → outlets.id |
| `name` | text | No | | Display name |
| `email` | text | Yes | | Required for owner/manager, unique per outlet |
| `password_hash` | text | Yes | | bcrypt, for owner/manager |
| `pin_hash` | text | Yes | | bcrypt, for staff (and owner/manager who use POS) |
| `role` | text | No | | enum: `owner`, `manager`, `staff` |
| `status` | text | No | `'active'` | enum: `active`, `inactive` |
| `failed_attempts` | integer | No | `0` | For lockout logic |
| `locked_until` | timestamptz | Yes | | Null if not locked |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | Soft delete |
| `created_by` | uuid | Yes | | Self-FK, null for seed owner |
| `updated_by` | uuid | Yes | | Self-FK |

**Indexes:**
- PK on `id`
- Unique on `(outlet_id, email)` where `email IS NOT NULL` — partial index
- Index on `(outlet_id, role, status)` — for user listing
- Index on `outlet_id`

**Constraints:**
- `CHECK (role IN ('owner', 'manager', 'staff'))`
- `CHECK (status IN ('active', 'inactive'))`
- `CHECK ((role IN ('owner', 'manager') AND email IS NOT NULL AND password_hash IS NOT NULL) OR role = 'staff')` — business rule, enforce at app level primarily

**Phase 2+:**
- `department`, `hire_date`, `pay_rate` for payroll
- `last_login_at` for activity tracking

### 3.3 `categories`

Menu categories (Ricebowl, Bakmie, Coffee Based, etc.)

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK → outlets.id |
| `name` | text | No | | e.g., 'Coffee Based' |
| `display_order` | integer | No | `0` | For POS tab sort |
| `is_active` | boolean | No | `true` | |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | |
| `created_by` | uuid | Yes | | FK → users.id |
| `updated_by` | uuid | Yes | | FK → users.id |

**Indexes:**
- PK on `id`
- Unique on `(outlet_id, name)` — partial index where `deleted_at IS NULL`
- Index on `(outlet_id, is_active, display_order)`

### 3.4 `menu_items`

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK → outlets.id |
| `category_id` | uuid | No | | FK → categories.id |
| `name` | text | No | | e.g., 'Americano' |
| `description` | text | Yes | | |
| `price_type` | text | No | | enum: `fixed`, `variant`, `open` |
| `price_fixed` | bigint | Yes | | Rupiah, if `price_type='fixed'` |
| `price_hot` | bigint | Yes | | Rupiah, if `price_type='variant'` |
| `price_iced` | bigint | Yes | | Rupiah, if `price_type='variant'` |
| `is_signature` | boolean | No | `false` | ♥ icon on POS |
| `is_sold_out` | boolean | No | `false` | Operational toggle |
| `is_active` | boolean | No | `true` | |
| `display_order` | integer | No | `0` | |
| `cost_price` | bigint | Yes | | Phase 2: for HPP tracking |
| `recipe_id` | uuid | Yes | | Phase 2: FK to recipes |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | |
| `created_by` | uuid | Yes | | FK → users.id |
| `updated_by` | uuid | Yes | | FK → users.id |

**Indexes:**
- PK on `id`
- Unique on `(category_id, name)` where `deleted_at IS NULL`
- Index on `(outlet_id, is_active, is_sold_out)` — for POS menu fetch
- Index on `category_id`

**Constraints (app-level):**
- `price_type = 'fixed'`: `price_fixed IS NOT NULL`, other prices null
- `price_type = 'variant'`: at least one of `price_hot`, `price_iced` is not null; `price_fixed` null
- `price_type = 'open'`: all price columns null
- All non-null prices `>= 1000` and `<= 999_999_999`

### 3.5 `modifiers`

Configuration table, fixed rows. Primary key is `slug` (not UUID) for readability in code.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `slug` | text | No | | PK, e.g., `sugar_level`, `extra_shot` |
| `label` | text | No | | Display label |
| `type` | text | No | | enum: `single_select`, `toggle` |
| `options_json` | jsonb | Yes | | For `single_select`: `[{value, label}]` |
| `price` | bigint | No | `0` | Rupiah, for `toggle` modifiers |
| `applies_to_categories` | text[] | Yes | | e.g., `['coffee_based']`; null means all drinks |
| `is_active` | boolean | No | `true` | |
| `updated_at` | timestamptz | No | `now()` | |
| `updated_by` | uuid | Yes | | FK → users.id |

**Seed rows:**
- `sugar_level` (single_select, price 0)
- `ice_level` (single_select, price 0)
- `extra_shot` (toggle, price 8000)
- `extra_topping_ayam` (toggle, price 10000)

**Phase 2:** Allow dynamic modifiers. Add `outlet_id`, allow non-system slugs, CRUD endpoints.

### 3.6 `shifts`

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK → outlets.id |
| `user_id` | uuid | No | | FK → users.id (the cashier) |
| `status` | text | No | `'open'` | enum: `open`, `closed` |
| `opening_cash` | bigint | No | | Rupiah |
| `actual_cash` | bigint | Yes | | Set at close |
| `variance` | bigint | Yes | | actual - expected, set at close |
| `notes` | text | Yes | | Closing note |
| `opened_at` | timestamptz | No | `now()` | |
| `closed_at` | timestamptz | Yes | | |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |

**Indexes:**
- PK on `id`
- Index on `(user_id, status)` — for "does this user have active shift" query
- Index on `(outlet_id, opened_at)` — for date-range reports
- Partial unique index on `user_id` where `status = 'open'` — enforces 1 active shift per user

```sql
CREATE UNIQUE INDEX ux_shifts_user_active ON shifts (user_id) WHERE status = 'open';
```

**Constraints:**
- `CHECK (opening_cash >= 0)`
- `CHECK (actual_cash IS NULL OR actual_cash >= 0)`
- `CHECK (status IN ('open', 'closed'))`
- `CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR (status = 'open' AND closed_at IS NULL))`

### 3.7 `transactions`

The most critical table. Central to POS.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK |
| `shift_id` | uuid | No | | FK → shifts.id |
| `cashier_id` | uuid | No | | FK → users.id |
| `client_ref_id` | uuid | Yes | | UNIQUE, for offline dedup |
| `transaction_number` | text | No | | UNIQUE, format `TRX-YYYYMMDD-NNNN` |
| `pager_number` | integer | No | | 1-99 |
| `order_type` | text | No | | enum: `dine_in`, `takeaway` |
| `subtotal` | bigint | No | | Sum of `transaction_items.subtotal` |
| `discount_type` | text | Yes | | enum: `percent`, `fixed` |
| `discount_value` | bigint | Yes | | Either percent (0-100) or fixed rupiah |
| `discount_amount` | bigint | No | `0` | Computed rupiah amount |
| `discount_reason` | text | Yes | | |
| `total` | bigint | No | | `subtotal - discount_amount` |
| `payment_method` | text | No | | enum: `cash`, `qris`, `card_bca` |
| `cash_received` | bigint | Yes | | Null if not cash |
| `cash_change` | bigint | Yes | | Null if not cash |
| `status` | text | No | `'paid'` | enum: `paid`, `voided`, `refunded` |
| `voided_at` | timestamptz | Yes | | |
| `voided_by` | uuid | Yes | | FK → users.id |
| `voided_approver` | uuid | Yes | | FK → users.id (for Staff-initiated void) |
| `void_reason` | text | Yes | | |
| `refunded_at` | timestamptz | Yes | | |
| `refunded_by` | uuid | Yes | | FK → users.id |
| `refunded_approver` | uuid | Yes | | FK → users.id |
| `refund_reason` | text | Yes | | |
| `discount_approver` | uuid | Yes | | FK → users.id (for Staff-initiated discount) |
| `served_at` | timestamptz | Yes | | Marked when "Selesai" tapped |
| `customer_id` | uuid | Yes | | Phase 2 |
| `loyalty_points_earned` | integer | Yes | | Phase 2 |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |

**Indexes:**
- PK on `id`
- UNIQUE on `transaction_number`
- UNIQUE on `client_ref_id` where not null (for offline sync dedup)
- Index on `shift_id` — for shift summary aggregation
- Index on `(outlet_id, created_at)` — for date-range reports
- Index on `status` — for filtering voided/refunded
- Index on `(outlet_id, status, created_at)` — composite for reports
- Index on `payment_method` — for breakdown by payment

**Constraints:**
- `CHECK (subtotal >= 0)`
- `CHECK (total >= 0)`
- `CHECK (discount_amount >= 0 AND discount_amount <= subtotal)`
- `CHECK (pager_number BETWEEN 1 AND 99)`
- `CHECK (status IN ('paid', 'voided', 'refunded'))`
- `CHECK ((payment_method = 'cash' AND cash_received >= total) OR payment_method != 'cash')`

### 3.8 `transaction_items`

Line items. Uses snapshot fields so historical data survives menu changes.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `transaction_id` | uuid | No | | FK → transactions.id, ON DELETE CASCADE |
| `menu_item_id` | uuid | No | | FK → menu_items.id (soft reference) |
| `item_name` | text | No | | Snapshot at transaction time |
| `item_category_name` | text | No | | Snapshot |
| `variant` | text | Yes | | enum: `hot`, `iced`, null if no variant |
| `unit_price` | bigint | No | | Snapshot of base price at time of transaction |
| `quantity` | integer | No | | ≥ 1 |
| `modifiers_price_delta` | bigint | No | `0` | Sum of modifier price deltas per unit |
| `subtotal` | bigint | No | | `(unit_price + modifiers_price_delta) * quantity` |
| `note` | text | Yes | | Item-level free text |
| `open_price_note` | text | Yes | | For Manual Brew beans info |
| `created_at` | timestamptz | No | `now()` | |

**Indexes:**
- PK on `id`
- Index on `transaction_id` (for fetch)
- Index on `menu_item_id` (for item performance reports)

**Constraints:**
- `CHECK (quantity > 0)`
- `CHECK (unit_price >= 0)`
- `CHECK (subtotal >= 0)`

**Why snapshot fields?** Menu items can be edited/renamed/soft-deleted, but historical transactions must remain accurate. Snapshots ensure receipts from 6 months ago render correctly even if the item was renamed.

### 3.9 `transaction_item_modifiers`

Records which modifiers were applied to each line item.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `transaction_item_id` | uuid | No | | FK, ON DELETE CASCADE |
| `modifier_slug` | text | No | | FK → modifiers.slug (soft) |
| `selected_value` | text | Yes | | e.g., `less` for sugar, `on` for extra_shot |
| `price_delta` | bigint | No | `0` | Snapshot of modifier price at time of transaction |
| `created_at` | timestamptz | No | `now()` | |

**Indexes:**
- PK on `id`
- Index on `transaction_item_id`

### 3.10 `expense_categories`

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK |
| `name` | text | No | | |
| `is_system` | boolean | No | `false` | System categories cannot be deleted (e.g., 'Refund') |
| `display_order` | integer | No | `0` | |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | |

**Indexes:**
- PK on `id`
- Unique on `(outlet_id, name)` where `deleted_at IS NULL`

### 3.11 `expenses`

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK |
| `expense_date` | date | No | | Date of expense (not created_at) |
| `category_id` | uuid | No | | FK → expense_categories.id |
| `description` | text | No | | |
| `amount` | bigint | No | | Rupiah |
| `payment_method` | text | No | | enum: `cash`, `transfer`, `other` |
| `receipt_image_url` | text | Yes | | Blob storage URL |
| `refunded_transaction_id` | uuid | Yes | | FK → transactions.id, set if auto-generated from refund |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | |
| `created_by` | uuid | No | | FK → users.id |
| `updated_by` | uuid | Yes | | FK → users.id |
| `deleted_by` | uuid | Yes | | FK → users.id |

**Indexes:**
- PK on `id`
- Index on `(outlet_id, expense_date)` — for date-range reports
- Index on `category_id`
- Index on `refunded_transaction_id` (rare but useful)

**Constraints:**
- `CHECK (amount >= 1)`

### 3.12 `incomes`

For non-POS income (event rental, titip jual).

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `outlet_id` | uuid | No | | FK |
| `income_date` | date | No | | |
| `description` | text | No | | |
| `amount` | bigint | No | | Rupiah |
| `payment_method` | text | No | | enum: `cash`, `transfer`, `other` |
| `created_at` | timestamptz | No | `now()` | |
| `updated_at` | timestamptz | No | `now()` | |
| `deleted_at` | timestamptz | Yes | | |
| `created_by` | uuid | No | | FK |
| `updated_by` | uuid | Yes | | FK |

**Indexes:**
- PK on `id`
- Index on `(outlet_id, income_date)`

### 3.13 `audit_logs`

Immutable. All sensitive actions logged here.

| Column | Type | Nullable | Default | Notes |
|---|---|:---:|---|---|
| `id` | uuid | No | `gen_random_uuid()` | PK |
| `event_type` | text | No | | e.g., `transaction.voided` |
| `user_id` | uuid | Yes | | FK, the actor |
| `approver_id` | uuid | Yes | | FK, if PIN-override was used |
| `entity_type` | text | Yes | | e.g., `transaction`, `menu_item` |
| `entity_id` | uuid | Yes | | polymorphic ref |
| `payload` | jsonb | Yes | | event-specific data |
| `metadata` | jsonb | Yes | | IP, user agent, device info |
| `created_at` | timestamptz | No | `now()` | |

**Indexes:**
- PK on `id`
- Index on `event_type`
- Index on `user_id`
- Index on `(entity_type, entity_id)`
- Index on `created_at` DESC — for recent activity queries

**Write-only table.** No UPDATE, no DELETE ever (enforce via DB role privileges in production if possible, or app-level discipline).

---

## 4. Query Patterns Reference

Common queries the app will run. Indexes above are designed to make these fast.

### 4.1 POS Menu Fetch (frequent)

```sql
SELECT i.*, c.name AS category_name, c.display_order AS category_order
FROM menu_items i
JOIN categories c ON c.id = i.category_id
WHERE i.outlet_id = $1
  AND i.is_active = true
  AND i.deleted_at IS NULL
  AND c.is_active = true
  AND c.deleted_at IS NULL
ORDER BY c.display_order, i.display_order, i.name;
```

Uses indexes: `(outlet_id, is_active)` on menu_items, `(outlet_id, is_active, display_order)` on categories.

### 4.2 Active Shift for User

```sql
SELECT * FROM shifts
WHERE user_id = $1 AND status = 'open'
LIMIT 1;
```

Uses partial unique index `ux_shifts_user_active`.

### 4.3 Shift Summary (on close)

```sql
SELECT
  payment_method,
  COUNT(*) AS trx_count,
  SUM(total) AS total_amount
FROM transactions
WHERE shift_id = $1
  AND status = 'paid'
GROUP BY payment_method;

-- Cash for shift variance
SELECT
  COALESCE(SUM(CASE WHEN payment_method = 'cash' AND status = 'paid' THEN total ELSE 0 END), 0) AS cash_paid,
  COALESCE(SUM(CASE WHEN status = 'refunded' AND payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_refunded
FROM transactions
WHERE shift_id = $1;
```

Uses index on `shift_id`.

### 4.4 Daily Sales Report

```sql
SELECT
  DATE(created_at AT TIME ZONE 'Asia/Jakarta') AS date,
  COUNT(*) AS trx_count,
  SUM(total) AS revenue,
  payment_method,
  status
FROM transactions
WHERE outlet_id = $1
  AND created_at >= $2 AND created_at < $3
GROUP BY DATE(created_at AT TIME ZONE 'Asia/Jakarta'), payment_method, status;
```

Uses index `(outlet_id, created_at)`.

### 4.5 Top Items Report

```sql
SELECT
  ti.menu_item_id,
  ti.item_name,
  ti.item_category_name,
  SUM(ti.quantity) AS total_qty,
  SUM(ti.subtotal) AS total_revenue
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
WHERE t.outlet_id = $1
  AND t.created_at >= $2 AND t.created_at < $3
  AND t.status = 'paid'
GROUP BY ti.menu_item_id, ti.item_name, ti.item_category_name
ORDER BY total_qty DESC
LIMIT $4;
```

### 4.6 Transaction Number Generation (atomic, daily sequence)

Use Postgres advisory lock or sequence per day:

**Option A (simple, using Postgres):**

```sql
-- Pseudo-code in Drizzle transaction:
BEGIN;
SELECT pg_advisory_xact_lock(hashtext(concat('trx-seq', outlet_id, to_char(now(), 'YYYYMMDD'))));

SELECT COUNT(*)::text AS seq FROM transactions
WHERE outlet_id = $1
  AND DATE(created_at AT TIME ZONE 'Asia/Jakarta') = CURRENT_DATE;

-- Assemble TRX-YYYYMMDD-NNNN
INSERT INTO transactions (...) VALUES (..., $trx_number, ...);
COMMIT;
```

**Option B (explicit sequence per day):** Not recommended, complicates multi-outlet.

---

## 5. Migration Strategy

### 5.1 Tools

- **Drizzle Kit** for schema migration generation: `npm run db:generate`
- Review SQL before applying: `drizzle/migrations/XXXX_name.sql`
- Apply: `npm run db:migrate`

### 5.2 Migration Rules

1. **Every schema change = new migration file.** Never edit applied migrations.
2. **Backwards compatible where possible.** New columns: always nullable with default. New tables: independent.
3. **Destructive changes require 2-step deploy:**
   - Step 1: deploy code that works with both old + new schema
   - Step 2: run migration that removes old
4. **Index additions:** can be separate migration; may need `CREATE INDEX CONCURRENTLY` for large tables (Phase 2+)

### 5.3 Initial Migration Sequence

1. `0001_create_outlets.sql` — outlets table
2. `0002_create_users.sql` — users + indexes
3. `0003_create_menu.sql` — categories, menu_items, modifiers
4. `0004_create_shifts.sql` — shifts + active-shift partial unique index
5. `0005_create_transactions.sql` — transactions, transaction_items, transaction_item_modifiers
6. `0006_create_expenses.sql` — expense_categories, expenses, incomes
7. `0007_create_audit.sql` — audit_logs

One logical grouping per migration; easier to review.

### 5.4 Data Seeding

After migrations, run seed separately:
```bash
npm run db:seed
```

See `04-MENU-DATA.md` for seed script reference.

**Idempotent seed:** Check if outlet already exists before inserting. Use `ON CONFLICT DO NOTHING` for reference data.

---

## 6. Data Integrity Rules

These rules are enforced a mix of DB-level (constraints/triggers) and app-level (Zod schemas, service layer):

### 6.1 DB-Level (hard guarantees)

| Rule | Mechanism |
|---|---|
| One open shift per user | Partial unique index `ux_shifts_user_active` |
| Transaction totals non-negative | CHECK constraint |
| Subtotal matches sum of items | App-level (computed in Server Action) |
| Pager 1-99 | CHECK constraint |
| Email unique per outlet | Partial unique index |
| Soft-deleted item not referenced in new transaction | App-level (validate before insert) |

### 6.2 App-Level (business rules)

| Rule | Location |
|---|---|
| Total = subtotal - discount | Server Action recomputes, compares to client value |
| Discount amount ≤ subtotal | Zod schema `refine()` |
| Cash received ≥ total (for cash payment) | Zod schema `refine()` |
| Menu item price_type matches which price fields are set | Zod discriminated union |
| Shift must be open to create transaction | Query before insert |
| Transaction must be same-shift to void | Query before update |
| Transaction must be same-day + cash to refund | Query before update |
| Last owner cannot be deactivated | Query before update |

### 6.3 Referential Integrity

All FKs use `ON DELETE RESTRICT` by default (prevent accidental cascade), **except**:

- `transaction_items.transaction_id` → `ON DELETE CASCADE` (if transaction deleted for any reason, items go with it — though Phase 1 never hard-deletes transactions)
- `transaction_item_modifiers.transaction_item_id` → `ON DELETE CASCADE`

For soft-deletes, parent rows retain `deleted_at` but children remain intact.

---

## 7. Performance Considerations

### 7.1 Anticipated Query Load (Phase 1 single outlet)

| Operation | Frequency | Target latency |
|---|---|---|
| Menu fetch | ~10/min (per device) | < 100ms |
| Create transaction | ~1/min peak | < 500ms |
| Menu item update | ~5/day | < 200ms |
| Daily report | ~5/day | < 3s for 30 days data |
| Audit log write | ~50/day | < 50ms (fire-and-forget OK) |

### 7.2 Optimization Guidelines

1. **Avoid N+1 queries.** Use Drizzle's `with` for joins, or explicit `INNER JOIN` in raw SQL.
2. **Preload menu in POS** at login, then cache + SSE updates. Don't fetch on every tap.
3. **Aggregate reports server-side.** Don't fetch all raw transactions to JS and sum there.
4. **Index-only scans** where possible for reports.
5. **LIMIT results** in list queries (paginate if > 100 rows). Back office expense list: 50 per page.

### 7.3 Neon-Specific

- **Free tier: 0.5 GB storage.** Monitor after 6 months. Estimated growth: ~50 MB/month with 60 trx/day (very comfortable).
- **Auto-suspend:** Connection cold start ~1-2s after 5 min idle. Client shows loading state.
- **Connection pooling:** Use Neon's built-in pooler (serverless pool URL).

### 7.4 When to Denormalize (Phase 2+)

If daily reports become slow (>3s for 1 month data):
- Add `daily_summaries` table (pre-aggregated, cron'd)
- Cache top-N queries with TTL

---

## 8. Backup & Recovery

### 8.1 Phase 1 Strategy

1. **Neon built-in:** Point-in-time recovery within free tier retention window (7 days typically)
2. **Manual export:** Weekly cron (GitHub Actions or Vercel Cron) runs `pg_dump` and saves to S3-compatible storage (or Vercel Blob)
3. **Owner downloads**: Monthly manual `pg_dump` download as safety net

### 8.2 Recovery Drills

Test recovery at least once before launch:
1. Snapshot current DB
2. Drop tables
3. Restore from backup
4. Verify all data present

---

## 9. Future-Proofing Annotations

Columns marked in `03-TSD.md` as "Phase 2 placeholder" are already present but nullable:

| Table | Column | Purpose |
|---|---|---|
| `menu_items` | `cost_price`, `recipe_id` | HPP tracking, BOM |
| `transactions` | `customer_id`, `loyalty_points_earned` | Loyalty program |
| `outlets.settings.features` | feature flag JSON | Gradual Phase 2 rollout |

These do not need migration when Phase 2 starts — just populate and flip feature flags.

---

## 10. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial schema for Phase 1 |
