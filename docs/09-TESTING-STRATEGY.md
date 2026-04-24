# 🧪 TESTING STRATEGY — Mahakan Coffee & Space

**Testing Plan & Test Case Reference**
**Version:** 1.0
**Depends on:** `01-PRD.md`, `02-FSD.md`, `03-TSD.md`, `05-ROLES-RBAC.md`, `08-API-SPEC.md`
**Status:** ✅ APPROVED
**Frameworks:** Vitest (unit & integration), TestSprite (E2E), Manual QA (hardware)

---

## 1. Testing Philosophy

### 1.1 Why We Test

This system handles real money. A missed calculation, a silent bug in discount logic, or an auth bypass can cost Mahakan actual revenue and trust. **Testing is not optional for money-touching code.**

### 1.2 The Testing Pyramid for Phase 1

```
         ┌──────────────────┐
         │  Manual QA (20%) │   Hardware (printer, EDC), UX feel
         └──────────────────┘
       ┌──────────────────────┐
       │  E2E TestSprite (15%)│   Critical user journeys
       └──────────────────────┘
    ┌──────────────────────────────┐
    │  Integration (20%)           │   API routes + DB
    └──────────────────────────────┘
┌──────────────────────────────────────┐
│  Unit Tests (45%)                    │   Money, validation, business logic
└──────────────────────────────────────┘
```

**Coverage targets Phase 1:**
- Business logic (money, discount, validation): **95%+**
- Service layer (features/*/actions.ts): **80%+**
- API routes: **70%+**
- UI components: **best-effort** (skip pure presentational)

### 1.3 Principles

1. **Test behavior, not implementation.** Refactor-proof.
2. **One assertion per test where possible.** Readable failures.
3. **No flaky tests.** If a test is flaky, fix it or delete it.
4. **Fast feedback.** Unit tests run < 10s total. E2E < 2 min.
5. **Money tests are non-negotiable.** Every edge case covered.
6. **AI coding assistants MUST NOT skip tests.** New feature → new tests, same commit.

---

## 2. Test Infrastructure

### 2.1 Vitest Setup

**File: `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/features/**/*.ts', 'src/lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/types.ts',
        '**/schemas.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

### 2.2 Test Database

For integration tests, use an isolated test database:

```typescript
// tests/setup.ts
import { beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'child_process';

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  // Reset schema, run migrations
  execSync('npm run db:migrate', { stdio: 'inherit' });
});

afterEach(async () => {
  // Truncate all tables between tests (fast, avoids full migration)
  await db.execute(sql`TRUNCATE TABLE transactions, transaction_items, shifts, expenses, incomes, menu_items, categories, users, outlets RESTART IDENTITY CASCADE`);
});
```

**Option:** Use `testcontainers` to spin up a disposable Postgres in Docker. Overkill for Phase 1 but Phase 2+ recommended.

**Phase 1 practical:** Run tests against a dedicated Neon branch. Neon branching is cheap and makes tests isolated.

### 2.3 Mocks and Stubs

- **Web Bluetooth** mocked in tests (no real printer)
- **bcrypt** used real (slow but correct)
- **fetch** mocked for offline tests
- **Time** mocked via `vi.useFakeTimers()` for date/shift tests

---

## 3. Unit Tests

### 3.1 Money Utilities (`src/lib/money.ts`)

**CRITICAL MODULE — 100% COVERAGE REQUIRED**

**File: `tests/unit/money.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { computeDiscountAmount, computeTotal, computeItemSubtotal, formatRupiah, parseRupiah } from '@/lib/money';

describe('computeDiscountAmount', () => {
  describe('with null discount', () => {
    it('returns 0', () => {
      expect(computeDiscountAmount(50000, null)).toBe(0);
    });
  });

  describe('with fixed discount', () => {
    it('returns the fixed amount when less than subtotal', () => {
      expect(computeDiscountAmount(50000, { type: 'fixed', value: 10000 })).toBe(10000);
    });

    it('caps at subtotal when fixed value exceeds subtotal', () => {
      expect(computeDiscountAmount(50000, { type: 'fixed', value: 60000 })).toBe(50000);
    });

    it('returns 0 when fixed value is 0', () => {
      expect(computeDiscountAmount(50000, { type: 'fixed', value: 0 })).toBe(0);
    });

    it('returns 0 for negative fixed value (defensive)', () => {
      expect(computeDiscountAmount(50000, { type: 'fixed', value: -5000 })).toBe(0);
    });
  });

  describe('with percent discount', () => {
    it('computes 10% of 50000 as 5000', () => {
      expect(computeDiscountAmount(50000, { type: 'percent', value: 10 })).toBe(5000);
    });

    it('computes 100% as full subtotal', () => {
      expect(computeDiscountAmount(37000, { type: 'percent', value: 100 })).toBe(37000);
    });

    it('computes 0% as 0', () => {
      expect(computeDiscountAmount(50000, { type: 'percent', value: 0 })).toBe(0);
    });

    // BANKERS ROUNDING EDGE CASES
    it('rounds half to even: 12.5 -> 12', () => {
      expect(computeDiscountAmount(25, { type: 'percent', value: 50 })).toBe(12);
    });

    it('rounds half to even: 13.5 -> 14', () => {
      expect(computeDiscountAmount(27, { type: 'percent', value: 50 })).toBe(14);
    });

    it('handles fractional percentage: 7% of 1000 = 70', () => {
      expect(computeDiscountAmount(1000, { type: 'percent', value: 7 })).toBe(70);
    });

    it('handles fractional result: 7% of 1025 rounds consistently', () => {
      // 1025 * 0.07 = 71.75 -> 72 (not .5 case, normal rounding)
      expect(computeDiscountAmount(1025, { type: 'percent', value: 7 })).toBe(72);
    });
  });

  describe('boundary values', () => {
    it('handles max rupiah subtotal', () => {
      const max = 999_999_999;
      expect(computeDiscountAmount(max, { type: 'percent', value: 50 })).toBe(500_000_000);
    });

    it('returns integer always (no float leak)', () => {
      const result = computeDiscountAmount(17, { type: 'percent', value: 33 });
      expect(Number.isInteger(result)).toBe(true);
    });
  });
});

describe('computeTotal', () => {
  it('subtracts discount from subtotal', () => {
    expect(computeTotal(50000, 5000)).toBe(45000);
  });

  it('returns 0 when discount exceeds subtotal (floor)', () => {
    expect(computeTotal(10000, 15000)).toBe(0);
  });

  it('returns subtotal when discount is 0', () => {
    expect(computeTotal(50000, 0)).toBe(50000);
  });
});

describe('computeItemSubtotal', () => {
  it('multiplies price and quantity', () => {
    expect(computeItemSubtotal(16000, 0, 2)).toBe(32000);
  });

  it('includes modifier delta in unit price', () => {
    expect(computeItemSubtotal(16000, 8000, 2)).toBe(48000);  // (16k + 8k) * 2
  });

  it('returns 0 for quantity 0', () => {
    expect(computeItemSubtotal(16000, 0, 0)).toBe(0);
  });

  it('handles zero modifier delta', () => {
    expect(computeItemSubtotal(21000, 0, 3)).toBe(63000);
  });
});

describe('formatRupiah', () => {
  it('formats 1250000 as "Rp 1.250.000"', () => {
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
  });

  it('formats 0 as "Rp 0"', () => {
    expect(formatRupiah(0)).toBe('Rp 0');
  });

  it('formats negative as "Rp -10.000"', () => {
    expect(formatRupiah(-10000)).toBe('Rp -10.000');
  });
});

describe('parseRupiah', () => {
  it('parses "1.250.000" to 1250000', () => {
    expect(parseRupiah('1.250.000')).toBe(1250000);
  });

  it('parses "Rp 1.250.000" to 1250000', () => {
    expect(parseRupiah('Rp 1.250.000')).toBe(1250000);
  });

  it('parses raw number string "1250000"', () => {
    expect(parseRupiah('1250000')).toBe(1250000);
  });

  it('throws on non-numeric input', () => {
    expect(() => parseRupiah('abc')).toThrow();
  });

  it('returns 0 for empty-ish input (after strip)', () => {
    // "Rp " becomes "" after strip; parseInt("") is NaN
    expect(() => parseRupiah('Rp ')).toThrow();
  });
});
```

### 3.2 Transaction Logic

**File: `tests/unit/transaction.test.ts`**

```typescript
describe('validateAndComputeTransaction', () => {
  it('accepts a valid transaction with no discount', () => {
    const input = {
      items: [
        { menuItemId: 'uuid1', unitPrice: 16000, modifiersPriceDelta: 0, quantity: 1, subtotal: 16000 },
      ],
      subtotal: 16000,
      discount: null,
      discountAmount: 0,
      total: 16000,
    };
    expect(() => validateAndComputeTransaction(input)).not.toThrow();
  });

  it('rejects when client subtotal does not match sum of items', () => {
    const input = {
      items: [{ subtotal: 16000 }, { subtotal: 20000 }],
      subtotal: 40000,  // wrong; should be 36000
      /* ... */
    };
    expect(() => validateAndComputeTransaction(input)).toThrow('SUBTOTAL_MISMATCH');
  });

  it('rejects when total does not match computed', () => {
    const input = {
      subtotal: 50000,
      discountAmount: 5000,
      total: 44000,  // should be 45000
    };
    expect(() => validateAndComputeTransaction(input)).toThrow('TOTAL_MISMATCH');
  });

  it('rejects when cash payment has cash < total', () => {
    const input = {
      paymentMethod: 'cash',
      total: 50000,
      cashReceived: 40000,
    };
    expect(() => validateAndComputeTransaction(input)).toThrow('INSUFFICIENT_CASH');
  });

  it('computes correct cash change', () => {
    const input = {
      paymentMethod: 'cash',
      total: 37000,
      cashReceived: 50000,
    };
    const result = validateAndComputeTransaction(input);
    expect(result.cashChange).toBe(13000);
  });
});

describe('generateTransactionNumber', () => {
  it('generates format TRX-YYYYMMDD-NNNN', () => {
    const num = generateTransactionNumber(new Date('2026-04-20'), 12);
    expect(num).toBe('TRX-20260420-0012');
  });

  it('pads sequence to 4 digits', () => {
    expect(generateTransactionNumber(new Date('2026-04-20'), 1)).toBe('TRX-20260420-0001');
    expect(generateTransactionNumber(new Date('2026-04-20'), 999)).toBe('TRX-20260420-0999');
  });

  it('handles 4-digit sequence', () => {
    expect(generateTransactionNumber(new Date('2026-04-20'), 1234)).toBe('TRX-20260420-1234');
  });
});
```

### 3.3 RBAC

**File: `tests/unit/rbac.test.ts`**

```typescript
import { hasPermission } from '@/lib/auth/rbac';

describe('hasPermission', () => {
  it('owner has all permissions', () => {
    expect(hasPermission('owner', 'pos.transaction.void')).toBe(true);
    expect(hasPermission('owner', 'report.pnl.view')).toBe(true);
    expect(hasPermission('owner', 'user.create.owner')).toBe(true);
  });

  it('manager can void but not view P&L', () => {
    expect(hasPermission('manager', 'pos.transaction.void')).toBe(true);
    expect(hasPermission('manager', 'report.pnl.view')).toBe(false);
  });

  it('staff cannot void without override', () => {
    expect(hasPermission('staff', 'pos.transaction.void')).toBe(false);
  });

  it('staff can mark sold out but not un-sold-out', () => {
    expect(hasPermission('staff', 'pos.menu.mark_sold_out')).toBe(true);
    expect(hasPermission('staff', 'pos.menu.mark_available')).toBe(false);
  });

  it('manager cannot create Owner users', () => {
    expect(hasPermission('manager', 'user.create.owner')).toBe(false);
  });
});
```

### 3.4 Validation (Zod Schemas)

**File: `tests/unit/schemas.test.ts`**

```typescript
import { createTransactionSchema } from '@/features/pos/schemas';

describe('createTransactionSchema', () => {
  it('accepts valid payload', () => {
    const valid = {
      pagerNumber: 5,
      orderType: 'takeaway',
      items: [{ /* ... */ }],
      /* ... */
    };
    expect(createTransactionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects pagerNumber 0', () => {
    const invalid = { pagerNumber: 0, /* ... */ };
    expect(createTransactionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects pagerNumber 100', () => {
    expect(createTransactionSchema.safeParse({ pagerNumber: 100, /* ... */ }).success).toBe(false);
  });

  it('rejects invalid orderType', () => {
    expect(createTransactionSchema.safeParse({ orderType: 'delivery', /* ... */ }).success).toBe(false);
  });

  it('rejects empty items array', () => {
    expect(createTransactionSchema.safeParse({ items: [], /* ... */ }).success).toBe(false);
  });

  it('rejects quantity <= 0', () => {
    const invalid = { items: [{ quantity: 0, /* ... */ }], /* ... */ };
    expect(createTransactionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects negative price', () => {
    const invalid = { items: [{ unitPrice: -1000, /* ... */ }], /* ... */ };
    expect(createTransactionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('menuItemSchema', () => {
  it('rejects fixed price type without priceFixed', () => {
    const invalid = { priceType: 'fixed', priceFixed: null };
    expect(menuItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts variant with only priceHot', () => {
    const valid = { priceType: 'variant', priceHot: 20000, priceIced: null };
    expect(menuItemSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts variant with only priceIced (iced-only item)', () => {
    const valid = { priceType: 'variant', priceHot: null, priceIced: 23000 };
    expect(menuItemSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects variant with both prices null', () => {
    const invalid = { priceType: 'variant', priceHot: null, priceIced: null };
    expect(menuItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects open price type with non-null price', () => {
    const invalid = { priceType: 'open', priceFixed: 10000 };
    expect(menuItemSchema.safeParse(invalid).success).toBe(false);
  });
});
```

### 3.5 Date Utilities

**File: `tests/unit/date.test.ts`**

```typescript
describe('toJakartaDate', () => {
  it('converts UTC to Jakarta timezone', () => {
    const utc = new Date('2026-04-20T16:00:00.000Z');
    const jkt = toJakartaDate(utc);
    expect(jkt.getHours()).toBe(23);  // UTC+7
  });
});

describe('formatIndonesianDate', () => {
  it('formats as DD/MM/YYYY', () => {
    expect(formatIndonesianDate(new Date('2026-04-20'))).toBe('20/04/2026');
  });
});
```

### 3.6 Receipt Builder

**File: `tests/unit/receipt-builder.test.ts`**

```typescript
describe('buildReceipt', () => {
  const sampleData = {
    business: { name: 'Mahakan Coffee', address: 'Jl. Test', phone: '081234567890' },
    transactionNumber: 'TRX-20260420-0001',
    pagerNumber: 5,
    orderType: 'takeaway' as const,
    cashierName: 'Rina',
    timestamp: new Date('2026-04-20T07:15:00.000Z'),
    items: [
      {
        name: 'Americano', variant: 'iced' as const, quantity: 1, unitPrice: 16000,
        modifiers: ['Sugar: Less'], note: 'extra hot',
      },
    ],
    subtotal: 16000,
    total: 16000,
    paymentMethod: 'cash' as const,
    cashReceived: 20000,
    cashChange: 4000,
  };

  it('produces non-empty bytes', () => {
    const bytes = buildReceipt(sampleData);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('includes initialization command at start', () => {
    const bytes = buildReceipt(sampleData);
    expect(bytes[0]).toBe(0x1b);  // ESC
    expect(bytes[1]).toBe(0x40);  // @
  });

  it('ends with cut command', () => {
    const bytes = buildReceipt(sampleData);
    const lastBytes = bytes.slice(-4);
    expect(Array.from(lastBytes)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('includes business name', () => {
    const bytes = buildReceipt(sampleData);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('Mahakan Coffee');
  });

  it('includes transaction number', () => {
    const decoded = new TextDecoder().decode(buildReceipt(sampleData));
    expect(decoded).toContain('TRX-20260420-0001');
  });

  it('formats rupiah in item lines', () => {
    const decoded = new TextDecoder().decode(buildReceipt(sampleData));
    expect(decoded).toContain('16.000');
  });

  it('includes item note when present', () => {
    const decoded = new TextDecoder().decode(buildReceipt(sampleData));
    expect(decoded).toContain('extra hot');
  });

  it('handles open price note', () => {
    const data = {
      ...sampleData,
      items: [{ name: 'V60', quantity: 1, unitPrice: 35000, note: null, openPriceNote: 'Ethiopia Yirgacheffe' }],
    };
    const decoded = new TextDecoder().decode(buildReceipt(data as any));
    expect(decoded).toContain('Ethiopia Yirgacheffe');
  });
});
```

### 3.7 Discount Reason Validation

**File: `tests/unit/discount-validation.test.ts`**

```typescript
describe('discount reason validation', () => {
  it('requires reason for "Lainnya"', () => {
    const result = discountSchema.safeParse({ type: 'percent', value: 10, reason: 'Lainnya' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain('detailReason');
  });

  it('accepts "Lainnya" with detailReason', () => {
    const result = discountSchema.safeParse({
      type: 'percent', value: 10, reason: 'Lainnya', detailReason: 'Customer baru pertama kali',
    });
    expect(result.success).toBe(true);
  });

  it('does not require detailReason for preset reasons', () => {
    const result = discountSchema.safeParse({ type: 'percent', value: 10, reason: 'Promo Staff' });
    expect(result.success).toBe(true);
  });
});
```

---

## 4. Integration Tests

These hit a real test database (isolated) through Drizzle, testing the service/API layer end-to-end (without HTTP layer).

**File: `tests/integration/transactions.integration.test.ts`**

```typescript
import { beforeEach, describe, it, expect } from 'vitest';
import { seedTestData } from './helpers/seed';
import { createTransaction } from '@/features/pos/actions';
import { mockSession } from './helpers/auth';

describe('Transaction integration', () => {
  let outlet, shift, cashier, menuItem;

  beforeEach(async () => {
    ({ outlet, shift, cashier, menuItem } = await seedTestData());
  });

  it('creates a transaction with correct computed total', async () => {
    await mockSession(cashier);
    const result = await createTransaction({
      pagerNumber: 1,
      orderType: 'takeaway',
      items: [{
        menuItemId: menuItem.id,
        variant: 'iced',
        quantity: 2,
        unitPrice: 16000,
        modifiersPriceDelta: 0,
        subtotal: 32000,
      }],
      subtotal: 32000,
      discount: null,
      discountAmount: 0,
      total: 32000,
      paymentMethod: 'cash',
      cashReceived: 50000,
      cashChange: 18000,
    });
    expect(result.success).toBe(true);
    expect(result.data.transactionNumber).toMatch(/^TRX-\d{8}-\d{4}$/);
    expect(result.data.total).toBe(32000);
  });

  it('rejects when shift is not open', async () => {
    await closeShift(shift.id);
    await mockSession(cashier);
    const result = await createTransaction({ /* ... */ });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NO_ACTIVE_SHIFT');
  });

  it('is idempotent on clientRefId', async () => {
    const clientRefId = crypto.randomUUID();
    await mockSession(cashier);

    const first = await createTransaction({ clientRefId, /* ... */ });
    const second = await createTransaction({ clientRefId, /* ... */ });

    expect(first.data.id).toBe(second.data.id);
    expect(second.meta?.deduplicated).toBe(true);
  });

  it('records audit log on void', async () => {
    await mockSession(cashier);  // owner role for direct void
    const trx = await createTransaction({ /* ... */ });
    await voidTransaction({ transactionId: trx.data.id, reason: 'Test' });

    const auditEntries = await db.select().from(auditLogs).where(eq(auditLogs.eventType, 'transaction.voided'));
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].entityId).toBe(trx.data.id);
  });

  it('rejects void from different shift', async () => {
    /* ... create trx in shift A, close A, open shift B, attempt void -> 422 */
  });
});

describe('Menu item integration', () => {
  it('broadcasts sold-out change to subscribers', async () => {
    /* ... set up SSE subscriber, toggle sold-out, verify event received */
  });

  it('prevents transaction creation with sold-out item', async () => {
    /* ... */
  });
});

describe('Shift integration', () => {
  it('enforces one active shift per user', async () => {
    await openShift({ openingCash: 100000 });
    await expect(openShift({ openingCash: 50000 })).rejects.toThrow('SHIFT_ALREADY_OPEN');
  });

  it('computes variance correctly on close', async () => {
    const shift = await openShift({ openingCash: 100000 });
    // Create 3 cash transactions, total cash paid: 150000
    await createCashTrx(50000);
    await createCashTrx(50000);
    await createCashTrx(50000);
    // Refund 1 of 25000
    await refundTrx(trx3.id);

    const closed = await closeShift(shift.id, { actualCash: 200000 });
    expect(closed.expectedCash).toBe(100000 + 150000 - 25000);  // 225000
    expect(closed.variance).toBe(200000 - 225000);  // -25000
  });
});
```

---

## 5. E2E Tests (TestSprite)

### 5.1 TestSprite Overview

TestSprite runs user-journey scenarios against the deployed app. Phase 1 targets critical flows only.

**File: `tests/e2e/testsprite.config.json`**

```json
{
  "baseUrl": "http://localhost:3000",
  "testFiles": ["tests/e2e/scenarios/**/*.test.ts"],
  "timeout": 60000,
  "retries": 1,
  "headless": true
}
```

### 5.2 E2E Scenarios

### Scenario E2E-001: Staff login and new order (happy path)

```
1. Navigate to /pos/login
2. Tap on "Rina" staff avatar
3. Enter PIN "1234"
4. Verify redirected to /pos
5. Verify shift banner shows
6. Tap "Buka Shift" → enter opening cash 100000 → confirm
7. Verify "Shift aktif" banner
8. Tap "Order Baru" → enter pager 5 → takeaway → start
9. Tap "Americano" menu tile → select Iced, sugar Less → Add to Order
10. Verify cart shows 1x Americano Iced with note
11. Tap "Bayar" → tap "Tunai" → enter 20000 → confirm
12. Verify success screen
13. Verify receipt print toast shown
14. Verify return to POS dashboard empty cart
```

### Scenario E2E-002: Offline transaction then sync

```
1. Start session with login
2. Simulate offline (DevTools → Offline)
3. Create transaction → verify queued to IndexedDB
4. Verify banner "Offline Mode"
5. Simulate online
6. Verify sync starts
7. Verify queued transaction posted to server
8. Verify transaction appears in riwayat
```

### Scenario E2E-003: Void transaction with approver override

```
1. Staff creates a transaction, prints receipt
2. Staff taps "Void" in transaction detail
3. Modal shows approver list
4. Select "Owner" avatar → enter PIN
5. Enter void reason → type "VOID" to confirm
6. Verify transaction status = voided
7. Verify audit log shows both staff and approver IDs
```

### Scenario E2E-004: Shift close with variance

```
1. Login as staff, open shift with 100000
2. Create 5 cash transactions totaling 500000
3. Tap "Tutup Shift"
4. System shows expected cash: 600000
5. Enter actual cash: 598000
6. Verify variance displayed: -2000 (red)
7. Enter note, confirm close
8. Verify shift appears in history with variance flag
```

### Scenario E2E-005: Menu CRUD (admin)

```
1. Login as Owner
2. Navigate to /menu/items
3. Click "Tambah Item"
4. Fill form: name "Test Item", category Coffee, variant Hot 20000 / Iced 18000
5. Submit
6. Verify item appears in list
7. Verify item appears in POS menu grid (open new tab as Staff)
8. Edit item, change price Iced to 19000
9. Verify change reflected in POS (SSE broadcast)
10. Soft-delete item
11. Verify item removed from POS
```

### Scenario E2E-006: Refund flow

```
1. Staff login, create cash transaction 50000
2. Mark as served
3. Navigate to transaction detail
4. Tap "Refund"
5. Approver override with Owner PIN
6. Enter reason, type "REFUND" to confirm
7. Verify transaction status = refunded
8. Navigate to /expenses
9. Verify auto-generated expense entry: category Refund, amount 50000, linked to transaction
```

### Scenario E2E-007: RBAC enforcement

```
1. Login as Staff
2. Try to navigate to /dashboard (admin)
3. Verify redirect to /pos
4. Call GET /api/v1/reports/sales/daily directly (via fetch in browser context)
5. Verify 403 response
6. Try POST /api/v1/transactions/xxx/void without approver token
7. Verify 403 response
```

### Scenario E2E-008: Manual brew open price

```
1. Staff creates order, taps V60
2. Modal prompts for price and beans note
3. Enter 35000, note "Ethiopia Yirgacheffe"
4. Verify item in cart shows custom price
5. Complete transaction
6. Verify receipt includes "V60 - Ethiopia Yirgacheffe"
```

### Scenario E2E-009: Sold out toggle

```
1. Staff long-presses Americano tile
2. Taps "Mark Sold Out"
3. Verify tile grays out
4. Open second device/tab
5. Verify sold-out status propagates (via SSE or polling)
6. Attempt to add sold-out item via direct API call
7. Verify 422 response
8. Manager logs in, un-sold-outs item
9. Verify tile returns to normal on all devices
```

### Scenario E2E-010: Daily sales report

```
1. Create 5 transactions of various types (cash, qris, card)
2. Void 1
3. Refund 1 cash
4. Login as Owner
5. Navigate to /reports/sales/daily
6. Verify metrics match expectations
7. Verify hourly distribution chart renders
8. Verify top items chart renders
9. Click "Export PDF"
10. Verify PDF downloads with correct data
```

---

## 6. Manual Test Matrix

Hardware and UX-sensitive items that cannot be fully automated.

### 6.1 Printer Tests

| Test | Steps | Pass Criteria |
|---|---|---|
| MAN-PRT-001 | Pair printer in Settings | Status shows "Connected" |
| MAN-PRT-002 | Test print from settings | Receipt prints cleanly, all Mahakan header visible |
| MAN-PRT-003 | Complete transaction, verify auto-print | Receipt prints within 3s |
| MAN-PRT-004 | Turn off printer mid-transaction | Toast shows error + "Coba Lagi" button |
| MAN-PRT-005 | Print with 2 items + discount + 3 modifiers | All details render correctly, amounts align right |
| MAN-PRT-006 | Print manual brew with long bean note | Note wraps correctly, doesn't overflow 32-char width |
| MAN-PRT-007 | Reprint from transaction history | Same receipt reproduces exactly |
| MAN-PRT-008 | Run out of paper mid-print | Error detected, user prompted |
| MAN-PRT-009 | 10 consecutive transactions | No BT disconnect, all prints clean |

### 6.2 EDC BCA Integration

| Test | Steps | Pass Criteria |
|---|---|---|
| MAN-EDC-001 | QRIS payment flow: tap QRIS → confirm lunas | Transaction marked as QRIS |
| MAN-EDC-002 | Cancel QRIS confirm (tap Batal) | Returns to payment screen, no transaction created |
| MAN-EDC-003 | Card payment flow | Transaction marked as card_bca |

### 6.3 Tablet UX

| Test | Criteria |
|---|---|
| MAN-UX-001 | Landscape 10" tablet: all POS elements visible without scroll |
| MAN-UX-002 | Portrait 8" tablet: menu grid usable, cart as drawer |
| MAN-UX-003 | Tap targets ≥ 44×44px everywhere |
| MAN-UX-004 | Text readable under daylight glare |
| MAN-UX-005 | PIN entry with one hand |
| MAN-UX-006 | Loading states visible within 100ms for slow ops |

### 6.4 Network Resilience

| Test | Criteria |
|---|---|
| MAN-NET-001 | WiFi toggle off mid-transaction: UI goes offline mode, can continue |
| MAN-NET-002 | Reconnect after 10 min offline: pending sync all succeed |
| MAN-NET-003 | Mobile data switch between WiFi and 4G: no user disruption |
| MAN-NET-004 | Neon DB cold start: loading state visible, no error toast |

### 6.5 Browser Compatibility

| Browser | Version | Expected |
|---|---|---|
| Chrome Android | Latest | ✅ Full support incl. Web Bluetooth |
| Edge Android | Latest | ✅ Full support |
| Chrome Desktop | Latest | ✅ Back office perfect |
| Safari iPad | Latest | ⚠️ Works except Web Bluetooth (show warning) |
| Firefox | Latest | ⚠️ Best effort; Web Bluetooth unavailable |

### 6.6 Soft Launch Smoke Test

The day before real-world use, run a 1-hour simulation:

1. Owner, Manager, 2 Staff all login simultaneously
2. Open 2 shifts (2 tablets)
3. Create 20 orders across 1 hour mixing all payment methods
4. Apply at least 3 discounts
5. Void at least 1, refund at least 1
6. Mark 2 items sold-out
7. Close both shifts
8. Generate daily report, verify accuracy by hand-counting
9. Generate P&L with test expense entries

---

## 7. Performance Tests

Run before production launch.

### 7.1 Load Test Scenarios

| Test | Metric | Target |
|---|---|---|
| POS menu fetch | p95 latency under 20 concurrent users | < 500ms |
| Create transaction | p95 latency, 10 req/s | < 800ms |
| Daily report (30 days) | p95 | < 3s |
| Menu bulk update (20 items) | p95 | < 2s |

**Tool:** k6, Artillery, or simple scripted Vitest loop for Phase 1.

### 7.2 Bundle Size Budget

| Route | Max JS bundle |
|---|---|
| `/pos` (tablet critical path) | 250 KB gzipped |
| `/admin/*` | 400 KB gzipped |
| Shared vendor | 150 KB gzipped |

Track via Next.js build output. Regressions flagged in PR.

---

## 8. Test Data Fixtures

**File: `tests/fixtures/index.ts`**

```typescript
export const testOutlet = {
  id: 'outlet-test-1',
  name: 'Mahakan Test',
  settings: { features: { loyaltyEnabled: false }, thresholds: { shiftVarianceAlert: 10000 } },
};

export const testUsers = {
  owner: { id: 'user-owner', role: 'owner', email: 'owner@test.id', password: 'Test1234' },
  manager: { id: 'user-manager', role: 'manager', email: 'manager@test.id', password: 'Test1234' },
  staff: { id: 'user-staff', role: 'staff', pin: '1234' },
};

export const testMenuItems = {
  americano: { id: 'item-americano', name: 'Americano', priceType: 'variant', priceHot: 17000, priceIced: 16000 },
  v60: { id: 'item-v60', name: 'V60', priceType: 'open' },
  croffle: { id: 'item-croffle', name: 'Croffle Ice Cream', priceType: 'fixed', priceFixed: 21000 },
};
```

Use these consistently across tests for clarity and less setup boilerplate.

---

## 9. CI/CD Integration

### 9.1 GitHub Actions Workflow (suggested)

**File: `.github/workflows/test.yml`**

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - name: Run migrations
        env: { DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres }
        run: npm run db:migrate
      - name: Unit + integration tests
        env: { DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres }
        run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
```

### 9.2 Pre-commit Hook (Husky)

```bash
# .husky/pre-commit
npm run typecheck && npm test -- --run --changed
```

Runs fast checks on only changed files. Full suite runs in CI.

### 9.3 E2E in CI

TestSprite E2E should run in a separate workflow, triggered on:
- Every merge to `main`
- Before production deploy

---

## 10. Testing Checklist for New Features

AI coding assistants and human developers: follow this checklist whenever adding a feature.

### ✅ Before Submitting

- [ ] Unit tests for all new business logic functions
- [ ] Validation tests for all Zod schemas (happy + rejection cases)
- [ ] Integration test for the main Server Action / API route
- [ ] E2E test for at least 1 user-facing scenario (if UI feature)
- [ ] Money logic: all edge cases (0, max, rounding, negative, null)
- [ ] RBAC: test each role's permission (or lack thereof)
- [ ] Audit log emission verified
- [ ] Coverage doesn't drop below threshold
- [ ] No `.only` or `skip` left in test files
- [ ] Tests pass locally (`npm test`)
- [ ] Manual QA for printer/EDC/tablet UX if applicable

### ❌ Common Mistakes

- Testing implementation (e.g., asserting internal function calls) instead of behavior
- Mocking too much → tests pass but real code breaks
- Flaky tests swept under the rug
- Over-reliance on E2E for logic better tested at unit level
- Skipping edge cases because "unlikely"
- Money tests with only one happy-path case

---

## 11. Incident Response

When a bug ships despite tests:

1. Write a **failing test that reproduces the bug** first
2. Fix the bug
3. Verify test now passes
4. Commit both together (regression test)

This ensures the bug never returns silently.

---

## 12. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial testing strategy |
