# 🔐 ROLES & RBAC — Mahakan Coffee & Space

**Role-Based Access Control Specification**
**Version:** 1.0
**Depends on:** `01-PRD.md`, `02-FSD.md`, `03-TSD.md`
**Status:** ✅ APPROVED

---

## 1. Overview

Phase 1 system has **3 roles** with strict, non-overlapping responsibilities. This document is the definitive reference for:

- Who can do what
- How permission is enforced (code patterns)
- How PIN override (supervisor approval) works
- Which events are audit-logged

---

## 2. Role Definitions

### 2.1 Owner 🟢

**Identity:** Single user in Phase 1 (owner of Mahakan Coffee & Space). Phase 2+ may allow multiple owners.

**Primary device:** Laptop/desktop (back office). Occasionally tablet for supervise.

**Login method:** Email + password.

**Scope:** Full access to everything. No restrictions.

**Cannot be:** Deactivated if last Owner (system enforces at least 1 active Owner always).

### 2.2 Operational Manager 🟡

**Identity:** Trusted person running day-to-day operations when Owner absent.

**Primary device:** Tablet for operational oversight, laptop for review.

**Login method:** Email + password.

**Scope:** Operational + staff management, but no financial deep dives (no HPP/margin visibility, no full financial P&L).

**Restrictions:**
- Cannot see margin/HPP/COGS data
- Cannot manage other Owners/Managers (only Staff)
- Cannot delete expenses (only edit, and only within 24h)
- Cannot edit business info (name, address, logo)
- Cannot see financial P&L report

### 2.3 Staff 🔵

**Identity:** Barista who doubles as cashier.

**Primary device:** Tablet at POS station.

**Login method:** PIN 4-6 digit.

**Scope:** POS transactions + own shift. Nothing else.

**Restrictions:**
- Cannot void/refund/discount without Manager/Owner PIN approval
- Cannot see any financial or operational reports
- Cannot access menu CRUD (can only mark sold-out, which is temporary operational flag)
- Cannot access user management, settings, expenses
- Can see **only their own shift** data

---

## 3. Complete Permission Matrix

Legend:
- ✅ = Full access, no approval needed
- 🔑 = Can perform **with PIN override from Manager/Owner**
- ⚠️ = Conditional access (see notes)
- ❌ = No access; UI hides feature entirely

| Resource / Action | Owner | Manager | Staff |
|---|:---:|:---:|:---:|
| **AUTH** | | | |
| Login via email+password | ✅ | ✅ | ❌ |
| Login via PIN | ✅ | ✅ | ✅ |
| Reset own password | ✅ | ✅ | ❌ |
| Reset own PIN | ❌ | ❌ | ⚠️ Through Manager/Owner |
| Logout | ✅ | ✅ | ✅ |
| **POS — Transactions** | | | |
| Create new order | ✅ | ✅ | ✅ |
| Add/edit items in draft | ✅ | ✅ | ✅ |
| Apply modifiers | ✅ | ✅ | ✅ |
| Input open-price for Manual Brew | ✅ | ✅ | ✅ |
| Process payment (cash/QRIS/card) | ✅ | ✅ | ✅ |
| Print receipt | ✅ | ✅ | ✅ |
| Reprint receipt | ✅ | ✅ | ✅ |
| Apply order discount | ✅ | ✅ | 🔑 |
| Void transaction (same-shift) | ✅ | ✅ | 🔑 |
| Refund transaction (same-day, cash) | ✅ | ✅ | 🔑 |
| Mark order "Selesai" (served) | ✅ | ✅ | ✅ |
| **POS — Menu** | | | |
| View menu | ✅ | ✅ | ✅ |
| Mark item "Sold Out" | ✅ | ✅ | ✅ |
| Mark item "Available" (un-sold-out) | ✅ | ✅ | ❌ |
| **SHIFT** | | | |
| Open own shift | ✅ | ✅ | ✅ |
| Close own shift | ✅ | ✅ | ✅ |
| View own shift history | ✅ | ✅ | ✅ |
| View all shifts | ✅ | ✅ | ❌ |
| Force close someone else's shift (emergency) | ✅ | ❌ | ❌ |
| **MENU MANAGEMENT (Back office)** | | | |
| Create menu item | ✅ | ✅ | ❌ |
| Edit menu item (name, desc, price, category) | ✅ | ✅ | ❌ |
| Delete menu item (soft) | ✅ | ✅ | ❌ |
| Bulk adjust prices | ✅ | ✅ | ❌ |
| Export menu CSV | ✅ | ❌ | ❌ |
| Create/edit/delete category | ✅ | ✅ | ❌ |
| Edit modifier prices (extra shot, extra topping) | ✅ | ✅ | ❌ |
| **CASH & EXPENSES** | | | |
| Create expense entry | ✅ | ✅ | ❌ |
| Edit expense (within 24h after create) | ✅ | ✅ | ❌ |
| Edit expense (anytime) | ✅ | ❌ | ❌ |
| Delete expense | ✅ | ❌ | ❌ |
| Create/edit expense categories | ✅ | ⚠️ Add only, no edit/delete | ❌ |
| Create income (manual, non-POS) | ✅ | ✅ | ❌ |
| Edit income | ✅ | ⚠️ Within 24h | ❌ |
| Delete income | ✅ | ❌ | ❌ |
| View daily cash summary | ✅ | ✅ | ❌ |
| **REPORTS** | | | |
| Daily sales report | ✅ | ✅ | ❌ |
| Weekly/monthly sales report | ✅ | ✅ | ❌ |
| Item performance report | ✅ | ✅ | ❌ |
| Shift report (all staff) | ✅ | ✅ | ❌ |
| Simple P&L report | ✅ | ❌ | ❌ |
| HPP/margin/cost visibility | ✅ | ❌ | ❌ |
| Export PDF reports | ✅ | ⚠️ Operational only (no P&L) | ❌ |
| **USER MANAGEMENT** | | | |
| View list of users (all) | ✅ | ⚠️ Can see Staff only; managers are hidden | ❌ |
| Create Staff user | ✅ | ✅ | ❌ |
| Create Manager user | ✅ | ❌ | ❌ |
| Create Owner user | ✅ | ❌ | ❌ |
| Edit Staff (name, PIN, status) | ✅ | ✅ | ❌ |
| Edit Manager | ✅ | ❌ | ❌ |
| Edit Owner | ✅ | ❌ | ❌ |
| Deactivate Staff | ✅ | ✅ | ❌ |
| Deactivate Manager | ✅ | ❌ | ❌ |
| Reset Staff PIN | ✅ | ✅ | ❌ |
| Reset Manager password | ✅ | ❌ | ❌ |
| View audit log | ✅ | ⚠️ Own actions + Staff only | ❌ |
| **SYSTEM SETTINGS** | | | |
| Edit business info (name, address, phone, logo) | ✅ | ❌ | ❌ |
| Pair/unpair thermal printer | ✅ | ✅ | ❌ |
| Test print | ✅ | ✅ | ✅ |
| Edit operational hours | ✅ | ❌ | ❌ |
| Toggle receipt settings (footer, QR) | ✅ | ❌ | ❌ |
| Edit variance alert threshold | ✅ | ❌ | ❌ |
| Change feature flags (Phase 2+ enablement) | ✅ | ❌ | ❌ |

---

## 4. Implementation: Permission Enum

All permission checks in code reference this enum from `src/lib/auth/rbac.ts`:

```typescript
export const permissions = {
  // Auth
  'auth.password_login': ['owner', 'manager'],
  'auth.pin_login': ['owner', 'manager', 'staff'],

  // POS - Transactions
  'pos.transaction.create': ['owner', 'manager', 'staff'],
  'pos.transaction.view': ['owner', 'manager', 'staff'],
  'pos.transaction.void': ['owner', 'manager'],
  'pos.transaction.refund': ['owner', 'manager'],
  'pos.discount.apply': ['owner', 'manager'],
  'pos.receipt.print': ['owner', 'manager', 'staff'],
  'pos.receipt.reprint': ['owner', 'manager', 'staff'],

  // POS - Menu (operational toggles)
  'pos.menu.mark_sold_out': ['owner', 'manager', 'staff'],
  'pos.menu.mark_available': ['owner', 'manager'],

  // Shift
  'shift.open_own': ['owner', 'manager', 'staff'],
  'shift.close_own': ['owner', 'manager', 'staff'],
  'shift.view_own': ['owner', 'manager', 'staff'],
  'shift.view_all': ['owner', 'manager'],
  'shift.force_close': ['owner'],

  // Menu CRUD
  'menu.item.create': ['owner', 'manager'],
  'menu.item.update': ['owner', 'manager'],
  'menu.item.delete': ['owner', 'manager'],
  'menu.item.bulk_update': ['owner', 'manager'],
  'menu.export_csv': ['owner'],
  'menu.category.crud': ['owner', 'manager'],
  'menu.modifier.update': ['owner', 'manager'],

  // Cash & Expenses
  'expense.create': ['owner', 'manager'],
  'expense.update_within_24h': ['owner', 'manager'],
  'expense.update_anytime': ['owner'],
  'expense.delete': ['owner'],
  'expense.category.create': ['owner', 'manager'],
  'expense.category.update': ['owner'],
  'expense.category.delete': ['owner'],
  'income.create': ['owner', 'manager'],
  'income.update_within_24h': ['owner', 'manager'],
  'income.update_anytime': ['owner'],
  'income.delete': ['owner'],
  'cash.daily_summary.view': ['owner', 'manager'],

  // Reports
  'report.sales.view': ['owner', 'manager'],
  'report.items.view': ['owner', 'manager'],
  'report.shift.view_all': ['owner', 'manager'],
  'report.pnl.view': ['owner'],
  'report.cost_visibility': ['owner'],
  'report.export.operational': ['owner', 'manager'],
  'report.export.financial': ['owner'],

  // User Management
  'user.list.all': ['owner'],
  'user.list.staff': ['owner', 'manager'],
  'user.create.staff': ['owner', 'manager'],
  'user.create.manager': ['owner'],
  'user.create.owner': ['owner'],
  'user.update.staff': ['owner', 'manager'],
  'user.update.manager': ['owner'],
  'user.update.owner': ['owner'],
  'user.deactivate.staff': ['owner', 'manager'],
  'user.deactivate.manager': ['owner'],
  'user.reset_pin.staff': ['owner', 'manager'],
  'user.reset_password.manager': ['owner'],
  'audit.view.all': ['owner'],
  'audit.view.staff_actions': ['owner', 'manager'],

  // Settings
  'settings.business.update': ['owner'],
  'settings.printer.pair': ['owner', 'manager'],
  'settings.printer.test': ['owner', 'manager', 'staff'],
  'settings.hours.update': ['owner'],
  'settings.receipt.update': ['owner'],
  'settings.thresholds.update': ['owner'],
  'settings.features.update': ['owner'],
} as const satisfies Record<string, ReadonlyArray<Role>>;
```

---

## 5. Enforcement Pattern

### 5.1 Three Layers of Enforcement

Every permission check MUST happen at **all three layers**:

1. **UI layer** — Hide/disable buttons the user can't use (UX, not security)
2. **Server Action / API route** — Check permission before any DB mutation (security)
3. **Database layer** — Row-level filters via `outletId` (multi-tenant safety, even though Phase 1 = 1 outlet)

> **Never rely on UI hiding alone.** Staff could craft API calls directly. Server must always verify.

### 5.2 Server-Side Pattern

```typescript
// src/features/pos/actions.ts
'use server';

import { requirePermission } from '@/lib/auth/rbac';

export async function voidTransaction(input: { transactionId: string; reason: string; approverToken?: string }) {
  const session = await requirePermission('pos.transaction.void').catch(async (err) => {
    // Staff doesn't have direct permission — check if approver token provided
    if (err.message === 'FORBIDDEN' && input.approverToken) {
      return await verifyApproverFlow(input.approverToken, 'pos.transaction.void', input.transactionId);
    }
    throw err;
  });

  // ... rest of void logic
}
```

### 5.3 UI Layer Pattern

```typescript
// src/components/ui/PermissionGate.tsx
'use client';

import { useSession } from 'next-auth/react';
import { hasPermission, PermissionKey, Role } from '@/lib/auth/rbac';

export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { data: session } = useSession();
  if (!session?.user) return <>{fallback}</>;
  return hasPermission(session.user.role as Role, permission) ? <>{children}</> : <>{fallback}</>;
}

// Usage:
<PermissionGate permission="pos.transaction.void">
  <Button onClick={handleVoid}>Void</Button>
</PermissionGate>

// Or "allow with override":
<PermissionGate
  permission="pos.transaction.void"
  fallback={<Button onClick={() => openOverrideModal('void')}>Void (butuh approval)</Button>}
>
  <Button onClick={handleVoid}>Void</Button>
</PermissionGate>
```

### 5.4 Middleware Pattern (for route-level protection)

Middleware handles coarse-grained routing (e.g., Staff redirect from `/admin/*`). Fine-grained permission is in Server Actions.

```typescript
// src/middleware.ts — illustrative
if (pathname.startsWith('/admin') && session.user.role === 'staff') {
  return NextResponse.redirect(new URL('/pos', req.url));
}
if (pathname.startsWith('/admin/reports/pnl') && session.user.role !== 'owner') {
  return NextResponse.redirect(new URL('/dashboard', req.url));
}
```

---

## 6. PIN Override (Supervisor Approval) Flow

### 6.1 When Required

Staff triggers a 🔑 action. System requires Manager or Owner to provide their PIN **on the same device** to unlock the action.

### 6.2 Protected Actions

| Action | Permission Key | Valid Approvers |
|---|---|---|
| Void transaction | `pos.transaction.void` | Owner, Manager |
| Refund transaction | `pos.transaction.refund` | Owner, Manager |
| Apply order discount | `pos.discount.apply` | Owner, Manager |

### 6.3 Flow (Detailed)

1. Staff taps restricted action (e.g., "Void")
2. UI opens `ApproverOverrideModal`:
   - Title: "Butuh persetujuan Manager/Owner"
   - List of active approvers (roles `owner` or `manager`) as avatar tiles
3. Approver selects their name/tile
4. PIN pad appears
5. Approver inputs PIN on same device
6. Client calls `POST /api/v1/auth/verify-approver` with:
   ```json
   {
     "approverId": "uuid",
     "pin": "1234",
     "actionType": "pos.transaction.void",
     "targetEntityType": "transaction",
     "targetEntityId": "uuid"
   }
   ```
7. Server:
   - Looks up user, verifies role is approver-eligible
   - Compares PIN via bcrypt
   - If OK: issues **single-use approval token** (JWT, 5-min expiry) payload:
     ```json
     {
       "approverId": "uuid",
       "actionType": "pos.transaction.void",
       "targetEntityId": "uuid",
       "jti": "unique-token-id",
       "exp": 1234567890
     }
     ```
   - Records `jti` in server-side used-token blacklist (prevents re-use)
8. Client re-submits original action with `approverToken` in payload
9. Server validates token:
   - Signature valid
   - Not expired
   - `actionType` matches
   - `targetEntityId` matches (prevents using a void-token to discount a different transaction)
   - `jti` not in blacklist
   - Mark `jti` as consumed after use
10. Action executes; audit log records both `initiatorId` (Staff) and `approverId` (Manager/Owner)

### 6.4 Security Considerations

- Tokens are **narrow-scoped**: one token unlocks exactly one action on one entity
- Tokens **single-use**: consumed after first validation
- Tokens **short-lived**: 5 min so they can't be stored for later
- Audit log captures both parties so abuse is traceable

### 6.5 Same-Session Special Case

If an Owner or Manager is using the POS themselves (logged in directly), they skip the override modal — their session already has permission.

### 6.6 Implementation Reference

**Server: `/api/v1/auth/verify-approver/route.ts`**

```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logAudit } from '@/features/audit/logger';

const schema = z.object({
  approverId: z.string().uuid(),
  pin: z.string().min(4).max(6),
  actionType: z.enum(['pos.transaction.void', 'pos.transaction.refund', 'pos.discount.apply']),
  targetEntityId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ success: false, error: { code: 'VALIDATION' } }, { status: 400 });
  }

  const { approverId, pin, actionType, targetEntityId } = parsed.data;

  const [approver] = await db.select().from(users).where(
    and(eq(users.id, approverId), isNull(users.deletedAt))
  );

  if (!approver || approver.status !== 'active' || !approver.pinHash) {
    return Response.json({ success: false, error: { code: 'APPROVER_INVALID' } }, { status: 403 });
  }

  if (!['owner', 'manager'].includes(approver.role)) {
    return Response.json({ success: false, error: { code: 'APPROVER_NOT_AUTHORIZED' } }, { status: 403 });
  }

  const pinOk = await bcrypt.compare(pin, approver.pinHash);
  if (!pinOk) {
    await logAudit({
      eventType: 'auth.approver_verify.fail',
      userId: approverId,
      payload: { actionType },
    });
    return Response.json({ success: false, error: { code: 'APPROVER_INVALID_PIN' } }, { status: 403 });
  }

  const jti = crypto.randomUUID();
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
  const token = await new SignJWT({ approverId, actionType, targetEntityId, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')
    .setIssuedAt()
    .sign(secret);

  await logAudit({
    eventType: 'auth.approver_verify.success',
    userId: approverId,
    payload: { actionType, targetEntityId, jti },
  });

  return Response.json({ success: true, data: { token, expiresInSeconds: 300 } });
}
```

**Consumption in void action:**

```typescript
async function verifyApproverToken(token: string, expectedAction: string, expectedTargetId: string) {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
  const { payload } = await jwtVerify(token, secret);

  if (payload.actionType !== expectedAction) throw new Error('TOKEN_ACTION_MISMATCH');
  if (payload.targetEntityId !== expectedTargetId) throw new Error('TOKEN_TARGET_MISMATCH');

  const consumed = await isJtiConsumed(payload.jti as string);
  if (consumed) throw new Error('TOKEN_ALREADY_USED');
  await markJtiConsumed(payload.jti as string, payload.exp as number);

  return { approverId: payload.approverId as string };
}
```

**JTI blacklist:** Phase 1 can use an in-memory `Map<string, number>` (jti → exp) with periodic cleanup. Phase 2 upgrade to Redis/KV for multi-instance safety. Since Phase 1 is 1 outlet + low concurrent override, in-memory is acceptable.

---

## 7. Audit Log Events for RBAC

Every permission-sensitive action emits an audit log entry. Table `audit_logs` (see `03-TSD.md` section 4.3).

### 7.1 Auth Events

| Event Type | Payload |
|---|---|
| `user.login.success` | `{ role, method: 'password' \| 'pin' }` |
| `user.login.fail` | `{ reason, attemptCount }` |
| `user.logout` | `{}` |
| `auth.account_locked` | `{ lockedUntil }` |
| `auth.approver_verify.success` | `{ actionType, targetEntityId, jti }` |
| `auth.approver_verify.fail` | `{ actionType, targetEntityId }` |

### 7.2 User Management Events

| Event Type | Payload |
|---|---|
| `user.created` | `{ targetUserId, role }` |
| `user.updated` | `{ targetUserId, changedFields, before, after }` |
| `user.deactivated` | `{ targetUserId, reason? }` |
| `user.pin_reset` | `{ targetUserId }` |
| `user.password_reset` | `{ targetUserId }` |
| `user.role_changed` | `{ targetUserId, oldRole, newRole }` |

### 7.3 Transaction Events

| Event Type | Payload |
|---|---|
| `transaction.created` | `{ total, itemsCount, paymentMethod }` |
| `transaction.voided` | `{ reason, approverId?, totalRefunded }` |
| `transaction.refunded` | `{ reason, approverId?, amount, expenseId }` |
| `transaction.discounted` | `{ discountType, discountValue, discountAmount, reason, approverId? }` |

### 7.4 Menu Events

| Event Type | Payload |
|---|---|
| `menu.item.created` | `{ itemId, fields }` |
| `menu.item.updated` | `{ itemId, changedFields, before, after }` |
| `menu.item.deleted` | `{ itemId }` |
| `menu.item.price_changed` | `{ itemId, oldPrice, newPrice }` |
| `menu.item.sold_out_toggled` | `{ itemId, soldOut }` |
| `menu.category.created/updated/deleted` | similar |
| `menu.modifier.price_changed` | `{ slug, oldPrice, newPrice }` |

### 7.5 Expense & Income Events

| Event Type | Payload |
|---|---|
| `expense.created` | `{ expenseId, amount, categoryId }` |
| `expense.updated` | `{ expenseId, changedFields, before, after }` |
| `expense.deleted` | `{ expenseId }` |
| `income.created` | `{ incomeId, amount }` |
| `income.updated` | `{ incomeId, changedFields }` |

### 7.6 Shift Events

| Event Type | Payload |
|---|---|
| `shift.opened` | `{ shiftId, openingCash }` |
| `shift.closed` | `{ shiftId, actualCash, variance, note? }` |
| `shift.force_closed` | `{ shiftId, targetUserId }` |

### 7.7 Settings Events

| Event Type | Payload |
|---|---|
| `setting.business.updated` | `{ changedFields, before, after }` |
| `setting.printer.paired` | `{ deviceId, deviceName }` |
| `setting.feature_flag.toggled` | `{ flag, oldValue, newValue }` |

### 7.8 Audit Log Retention

- **Retention:** Immutable, never deleted in Phase 1
- **Queryable:** by user, by entity, by event type, by date range
- **Access:**
  - Owner sees all
  - Manager sees own actions + Staff actions only (not other Managers or Owner)
- **Export:** Owner only, CSV format

---

## 8. Edge Cases & Anti-Patterns

### 8.1 Last Owner Protection

- Cannot deactivate the last active Owner
- Cannot demote the last active Owner to a lower role
- Server-side check in `user.update` and `user.deactivate` handlers

```typescript
async function canDeactivateOwner(userId: string): Promise<boolean> {
  const activeOwners = await db.select({ count: count() }).from(users).where(
    and(eq(users.role, 'owner'), eq(users.status, 'active'), isNull(users.deletedAt))
  );
  return activeOwners[0].count > 1;  // only safe if more than 1 remains
}
```

### 8.2 Approver Cannot Approve Their Own Action

If Owner or Manager initiates void themselves (logged in as themselves), no override needed. But they cannot separately log in as a "different approver" to approve on their own behalf — the approver modal only shows when current user is Staff.

### 8.3 Staff Cannot See Manager/Owner Emails in User List

Staff doesn't access `/users` at all. But if Manager has restricted user list view (can see Staff only), the query must filter at DB level:

```typescript
const users = await db.select().from(users).where(
  session.user.role === 'owner'
    ? isNull(users.deletedAt)
    : and(eq(users.role, 'staff'), isNull(users.deletedAt))
);
```

### 8.4 Sold-Out Mark by Staff, Unmark by Manager

This asymmetry is intentional. Staff shouldn't be able to silently re-enable items they marked (avoids accidental re-enable under customer pressure). Manager reviews and un-sold-outs.

### 8.5 Role Change Flow

Owner can change user role via dedicated action (not inline edit). This is logged separately and triggers immediate session invalidation for affected user.

---

## 9. Test Cases for RBAC

These should be E2E tested (see `09-TESTING-STRATEGY.md`):

| Test ID | Scenario | Expected |
|---|---|---|
| RBAC-001 | Staff tries GET `/api/v1/reports/sales/daily` directly | 403 |
| RBAC-002 | Staff tries POST `/api/v1/transactions/:id/void` without approver token | 403 |
| RBAC-003 | Staff provides valid approver token for void | 200, audit log shows both |
| RBAC-004 | Staff provides expired approver token | 403 `APPROVER_TOKEN_EXPIRED` |
| RBAC-005 | Staff provides approver token for different transaction | 403 `TOKEN_TARGET_MISMATCH` |
| RBAC-006 | Staff reuses same approver token twice | Second call fails `TOKEN_ALREADY_USED` |
| RBAC-007 | Manager tries to access P&L report | 403, UI redirects |
| RBAC-008 | Manager tries to create Owner user | 403 |
| RBAC-009 | Owner tries to deactivate self when last active Owner | 403 `LAST_OWNER_PROTECTED` |
| RBAC-010 | Manager sees user list — Owner not present | UI/API filters hide Owners |
| RBAC-011 | Staff long-press item to mark sold-out | 200 |
| RBAC-012 | Staff long-press sold-out item to un-sold-out | UI hidden; direct API returns 403 |
| RBAC-013 | Expired session → call any protected endpoint | 401 |
| RBAC-014 | Session valid for Staff but role changed to disabled | 401 or 403 (force re-login) |

---

## 10. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial RBAC spec for Phase 1 |
