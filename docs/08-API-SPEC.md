# 🔌 API SPECIFICATION — Mahakan Coffee & Space

**API Contract Reference**
**Version:** 1.0
**Depends on:** `02-FSD.md`, `03-TSD.md`, `05-ROLES-RBAC.md`
**Status:** ✅ APPROVED
**Base URL (local):** `http://localhost:3000`
**Base URL (production):** `https://mahakan-pos.vercel.app`

---

## 1. API Conventions

### 1.1 Versioning

All REST endpoints are prefixed with `/api/v1/`. Breaking changes → `/api/v2/`. Non-breaking additions can be made to existing endpoints.

### 1.2 Server Actions vs REST

Two interaction models exist:

**Server Actions (preferred for mutations from RSC):**
- Defined in `src/features/*/actions.ts` with `'use server'`
- Called directly from client components via function reference
- Handles auth + validation + mutation in one function
- Return type: `{ success: true, data: T } | { success: false, error: ApiError }`

**REST endpoints (for):**
- External integrations / webhooks
- Polling / SSE
- Offline queue sync (idempotent POST)
- Cases where explicit HTTP semantics matter

Both use the **same response envelope** and error codes.

### 1.3 Response Envelope

**Success:**
```json
{
  "success": true,
  "data": { /* endpoint-specific */ },
  "meta": {
    "timestamp": "2026-04-20T10:15:30.000Z",
    "requestId": "req_abc123"
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Nama harus diisi",
    "field": "name",
    "details": { /* optional debug context */ }
  },
  "meta": {
    "timestamp": "2026-04-20T10:15:30.000Z",
    "requestId": "req_abc123"
  }
}
```

### 1.4 HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Success (GET, PATCH, DELETE) |
| 201 | Created (POST that creates) |
| 204 | No Content (DELETE with no body) |
| 400 | Validation error, bad request |
| 401 | Unauthenticated (no session) |
| 403 | Unauthorized (insufficient role) |
| 404 | Resource not found |
| 409 | Conflict (duplicate, state conflict) |
| 422 | Business rule violation |
| 429 | Rate limited |
| 500 | Server error (unexpected) |
| 503 | Service unavailable (DB down) |

### 1.5 Global Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No active session |
| `FORBIDDEN` | 403 | Role insufficient |
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Resource already exists or state conflict |
| `BUSINESS_RULE_VIOLATION` | 422 | Operation not allowed by business rules |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | DB or dependency unavailable |

### 1.6 Authentication

Session is carried via `Set-Cookie` on login, included automatically by browser. Cookie properties: `httpOnly; secure; sameSite=lax; path=/`.

All endpoints (except public: `/api/health`, `/api/v1/auth/[...nextauth]`) require valid session. If session missing: return `401 AUTH_REQUIRED`.

RBAC check happens after auth: invalid role → `403 FORBIDDEN`.

### 1.7 Pagination

List endpoints support cursor-based pagination:

**Request:**
```
GET /api/v1/transactions?limit=50&cursor=<opaque>&order=desc
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "nextCursor": "eyJpZCI6...",
    "hasMore": true
  }
}
```

Defaults: `limit=50`, `order=desc` (newest first), `cursor=null` (start from newest).

### 1.8 Filtering

Common query params:
- `from=YYYY-MM-DD` — date range start (inclusive)
- `to=YYYY-MM-DD` — date range end (inclusive)
- `status=paid` — filter by status
- `search=americano` — free-text search

### 1.9 Idempotency

Mutating endpoints that may be retried (offline sync) accept `Idempotency-Key` header or `clientRefId` in body. Server deduplicates.

---

## 2. Auth Endpoints

### 2.1 `POST /api/v1/auth/[...nextauth]` (Auth.js Catch-all)

Handled by Auth.js. Supports:

- `POST /api/v1/auth/signin/email-password` → login
- `POST /api/v1/auth/signin/pin` → PIN login
- `POST /api/v1/auth/signout` → logout
- `GET /api/v1/auth/session` → current session info
- `GET /api/v1/auth/csrf` → CSRF token

**Email/Password login:**

Request:
```json
POST /api/v1/auth/signin/email-password
{
  "email": "owner@mahakan.id",
  "password": "secret123"
}
```

Success (200) — session cookie set:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Owner Name",
      "email": "owner@mahakan.id",
      "role": "owner",
      "outletId": "uuid"
    }
  }
}
```

Error cases:
- `401 AUTH_INVALID_CREDENTIALS` — email/password wrong
- `403 AUTH_ACCOUNT_DISABLED` — account inactive
- `429 AUTH_ACCOUNT_LOCKED` — locked due to failed attempts

**PIN login:**

Request:
```json
POST /api/v1/auth/signin/pin
{
  "userId": "uuid",
  "pin": "1234"
}
```

Response: same shape as email login; session duration 12h (staff) or 2h (owner/manager).

### 2.2 `POST /api/v1/auth/verify-approver`

Generates single-use approval token for restricted actions.

**Permission:** Session required; only approvers (owner/manager) can succeed.

**Request:**
```json
{
  "approverId": "uuid",
  "pin": "1234",
  "actionType": "pos.transaction.void",
  "targetEntityId": "uuid"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI...",
    "expiresInSeconds": 300
  }
}
```

**Errors:**
- `403 APPROVER_INVALID` — user doesn't exist or inactive
- `403 APPROVER_NOT_AUTHORIZED` — user not an approver role
- `403 APPROVER_INVALID_PIN` — wrong PIN
- `400 VALIDATION_ERROR` — missing fields

### 2.3 `GET /api/v1/auth/session`

Returns current session info.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Rina",
      "role": "staff",
      "outletId": "uuid"
    },
    "expires": "2026-04-20T22:15:30.000Z"
  }
}
```

---

## 3. Menu Endpoints

### 3.1 `GET /api/v1/menu/items`

List menu items.

**Permission:** Any authenticated role.

**Query params:**
- `active` — boolean, default `true`
- `categoryId` — filter by category
- `search` — free-text on name
- `soldOut` — `true` | `false` | omit (all)
- `modifiedSince` — ISO timestamp, for incremental sync

**Response (200):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Americano",
        "description": null,
        "category": {
          "id": "uuid",
          "name": "Coffee Based",
          "displayOrder": 5
        },
        "priceType": "variant",
        "priceFixed": null,
        "priceHot": 17000,
        "priceIced": 16000,
        "isSignature": false,
        "isSoldOut": false,
        "isActive": true,
        "displayOrder": 1,
        "applicableModifiers": ["sugar_level", "ice_level", "extra_shot"],
        "updatedAt": "2026-04-20T10:00:00.000Z"
      }
    ],
    "total": 45
  }
}
```

### 3.2 `POST /api/v1/menu/items`

Create menu item.

**Permission:** `menu.item.create` (owner, manager)

**Request:**
```json
{
  "name": "Matcha Latte",
  "description": "Creamy matcha with milk",
  "categoryId": "uuid",
  "priceType": "variant",
  "priceHot": 24000,
  "priceIced": 23000,
  "isSignature": false,
  "displayOrder": 8
}
```

**Response (201):**
```json
{
  "success": true,
  "data": { "id": "uuid", "...": "..." }
}
```

**Errors:**
- `409 MENU_NAME_DUPLICATE` — name exists in category
- `400 MENU_NO_PRICE` — variant type but no prices
- `400 MENU_INVALID_PRICE` — price out of range
- `404 CATEGORY_NOT_FOUND` — invalid categoryId

### 3.3 `GET /api/v1/menu/items/:id`

Get single item.

### 3.4 `PATCH /api/v1/menu/items/:id`

Update menu item.

**Permission:** `menu.item.update`

**Request (partial):**
```json
{
  "priceIced": 17000
}
```

**Response (200):** Updated item.

**Audit log:** `menu.item.updated` with before/after diff.

### 3.5 `DELETE /api/v1/menu/items/:id`

Soft delete.

**Permission:** `menu.item.delete`

**Response (204):** No content.

### 3.6 `PATCH /api/v1/menu/items/:id/sold-out`

Toggle sold-out. Special endpoint for Staff who only has this permission.

**Permission:**
- Staff: can set `isSoldOut: true`
- Owner/Manager: can set `true` or `false`

**Request:**
```json
{ "isSoldOut": true }
```

**Response (200):** Updated item.

**Side effect:** Broadcast via SSE to all connected POS devices.

### 3.7 `GET /api/v1/menu/categories`

List categories.

**Permission:** Any authenticated role.

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Ricebowl",
        "displayOrder": 1,
        "isActive": true,
        "itemCount": 4
      }
    ]
  }
}
```

### 3.8 `POST /api/v1/menu/categories`
### 3.9 `PATCH /api/v1/menu/categories/:id`
### 3.10 `DELETE /api/v1/menu/categories/:id`

CRUD for categories. Permission: `menu.category.crud`. Delete only if `itemCount = 0`.

### 3.11 `GET /api/v1/menu/modifiers`

List modifier configurations.

**Permission:** Any authenticated role.

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "slug": "extra_shot",
        "label": "Extra Shot",
        "type": "toggle",
        "price": 8000,
        "appliesToCategories": ["coffee_based"],
        "isActive": true
      },
      {
        "slug": "sugar_level",
        "label": "Tingkat Gula",
        "type": "single_select",
        "options": [
          { "value": "normal", "label": "Normal" },
          { "value": "less", "label": "Less" },
          { "value": "none", "label": "No Sugar" }
        ],
        "price": 0,
        "appliesToCategories": null,
        "isActive": true
      }
    ]
  }
}
```

### 3.12 `PATCH /api/v1/menu/modifiers/:slug`

Update modifier price (only for `extra_shot` and `extra_topping_ayam`).

**Permission:** `menu.modifier.update`

**Request:**
```json
{ "price": 9000 }
```

**Response (200):** Updated modifier.

**Errors:**
- `400 VALIDATION_ERROR` — trying to edit locked fields (options of single_select)
- `403 FORBIDDEN`

### 3.13 `POST /api/v1/menu/items/bulk`

Bulk operations.

**Permission:** `menu.item.bulk_update`

**Request:**
```json
{
  "action": "adjust_price_percent",
  "itemIds": ["uuid1", "uuid2"],
  "params": { "percent": 10 }
}
```

Available actions: `mark_sold_out`, `mark_available`, `adjust_price_percent`, `adjust_price_fixed`.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "affected": 15,
    "failed": []
  }
}
```

---

## 4. Transaction Endpoints

### 4.1 `POST /api/v1/transactions`

Create a transaction. **The most important endpoint.**

**Permission:** `pos.transaction.create`

**Request:**
```json
{
  "clientRefId": "uuid-generated-by-client",
  "pagerNumber": 5,
  "orderType": "takeaway",
  "items": [
    {
      "menuItemId": "uuid",
      "variant": "iced",
      "quantity": 1,
      "unitPrice": 16000,
      "modifiers": [
        { "slug": "sugar_level", "selectedValue": "less", "priceDelta": 0 },
        { "slug": "ice_level", "selectedValue": "normal", "priceDelta": 0 }
      ],
      "modifiersPriceDelta": 0,
      "subtotal": 16000,
      "note": "extra hot please"
    },
    {
      "menuItemId": "uuid-manual-brew",
      "variant": null,
      "quantity": 2,
      "unitPrice": 35000,
      "modifiers": [],
      "modifiersPriceDelta": 0,
      "subtotal": 70000,
      "note": null,
      "openPriceNote": "Ethiopia Yirgacheffe"
    }
  ],
  "subtotal": 86000,
  "discount": {
    "type": "percent",
    "value": 10,
    "reason": "Promo Staff"
  },
  "discountAmount": 8600,
  "total": 77400,
  "paymentMethod": "cash",
  "cashReceived": 100000,
  "cashChange": 22600,
  "discountApproverToken": null
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "transactionNumber": "TRX-20260420-0012",
    "clientRefId": "...",
    "pagerNumber": 5,
    "orderType": "takeaway",
    "cashierId": "uuid",
    "cashierName": "Rina",
    "shiftId": "uuid",
    "subtotal": 86000,
    "discountType": "percent",
    "discountValue": 10,
    "discountAmount": 8600,
    "discountReason": "Promo Staff",
    "total": 77400,
    "paymentMethod": "cash",
    "cashReceived": 100000,
    "cashChange": 22600,
    "status": "paid",
    "items": [ /* full items */ ],
    "createdAt": "2026-04-20T10:15:30.000Z",
    "receiptPayload": {
      /* pre-computed data for printer */
      "business": { "name": "Mahakan Coffee", "address": "...", "phone": "..." },
      "cashierName": "Rina",
      /* etc. */
    }
  }
}
```

**Server-side validation (critical):**

1. Session is active, role allows POS transaction creation
2. Shift is open for the cashier
3. `clientRefId` not already used (dedup for offline sync)
4. Each `menuItemId` exists, is active, not deleted, not sold-out
5. Each item's `unitPrice` matches current server price for that item + variant (tolerance: 0 — exact match required)
6. Each item's `modifiersPriceDelta` matches computed from server modifier prices
7. Each item's `subtotal` = `(unitPrice + modifiersPriceDelta) * quantity`
8. Overall `subtotal` = sum of item subtotals
9. If discount: `discountAmount` correctly computed from `type/value`
10. `total` = `subtotal - discountAmount`
11. If `paymentMethod=cash`: `cashReceived >= total`, `cashChange = cashReceived - total`
12. If discount and cashier role is staff: `discountApproverToken` is valid

**Errors:**
- `403 FORBIDDEN` — no role permission
- `422 NO_ACTIVE_SHIFT` — shift not open
- `409 DUPLICATE_CLIENT_REF` — already processed (return existing transaction)
- `404 MENU_ITEM_NOT_FOUND` — item doesn't exist
- `422 MENU_ITEM_SOLD_OUT` — item sold-out (client may retry with fresh data)
- `422 PRICE_MISMATCH` — client sent wrong price
- `422 TOTAL_MISMATCH` — client's total doesn't match server recomputation
- `422 INSUFFICIENT_CASH` — cash < total
- `403 APPROVER_TOKEN_INVALID` — staff discount without valid token

### 4.2 `GET /api/v1/transactions/:id`

Get transaction detail.

**Permission:** `pos.transaction.view`

**Response (200):** Full transaction with items and modifiers.

### 4.3 `GET /api/v1/transactions`

List transactions.

**Permission:** `pos.transaction.view` (staff see own shift only; owner/manager see all in outlet)

**Query:**
- `shiftId` — filter by shift
- `status` — `paid`, `voided`, `refunded`
- `paymentMethod` — `cash`, `qris`, `card_bca`
- `from`, `to` — date range
- `search` — transaction number or pager
- `limit`, `cursor`

**Response (200):** Paginated list.

### 4.4 `POST /api/v1/transactions/:id/void`

Void a transaction.

**Permission:** `pos.transaction.void` OR valid approver token.

**Request:**
```json
{
  "reason": "Customer batal",
  "detailReason": "Changed mind after receiving order",
  "approverToken": "eyJhbGci...  (if staff)"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "voided",
    "voidedAt": "...",
    "voidedBy": "uuid",
    "voidedApprover": "uuid",
    "voidReason": "Customer batal"
  }
}
```

**Errors:**
- `404 NOT_FOUND`
- `422 VOID_NOT_ALLOWED_DIFFERENT_SHIFT` — transaction from other shift
- `422 ALREADY_VOIDED` — already voided
- `403 APPROVER_REQUIRED` — staff without approver token
- `403 APPROVER_TOKEN_INVALID`

### 4.5 `POST /api/v1/transactions/:id/refund`

Refund a cash transaction.

**Permission:** `pos.transaction.refund` OR valid approver token.

**Request:**
```json
{
  "reason": "Barang kualitas kurang baik",
  "approverToken": "..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "refunded",
    "refundedAt": "...",
    "autoGeneratedExpenseId": "uuid"
  }
}
```

**Errors:**
- `422 REFUND_NOT_ALLOWED_NON_CASH` — only cash refundable Phase 1
- `422 REFUND_NOT_ALLOWED_PAST_DAY` — not same-day

### 4.6 `PATCH /api/v1/transactions/:id/serve`

Mark as served (cleared from active orders list).

**Permission:** Any staff+.

**Request:** (empty body)

**Response (200):**
```json
{
  "success": true,
  "data": { "id": "uuid", "servedAt": "..." }
}
```

---

## 5. Shift Endpoints

### 5.1 `POST /api/v1/shifts`

Open shift.

**Permission:** `shift.open_own`

**Request:**
```json
{
  "openingCash": 100000,
  "note": null
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "outletId": "uuid",
    "status": "open",
    "openingCash": 100000,
    "openedAt": "2026-04-20T01:00:00.000Z"
  }
}
```

**Errors:**
- `409 SHIFT_ALREADY_OPEN` — user has active shift

### 5.2 `POST /api/v1/shifts/:id/close`

Close shift.

**Permission:** `shift.close_own` (own shift only)

**Request:**
```json
{
  "actualCash": 1248000,
  "note": "Kemungkinan kembalian kurang pas"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "closed",
    "openingCash": 100000,
    "actualCash": 1248000,
    "expectedCash": 1250000,
    "variance": -2000,
    "closedAt": "...",
    "summary": {
      "transactionCount": 67,
      "paid": { "count": 67, "cash": 1150000, "qris": 1200000, "cardBca": 500000 },
      "voided": { "count": 2, "totalAmount": 50000 },
      "refunded": { "count": 1, "totalAmount": 25000 }
    }
  }
}
```

**Errors:**
- `404 NOT_FOUND`
- `422 NOT_OWNER_OF_SHIFT` — trying to close someone else's
- `422 ALREADY_CLOSED`

### 5.3 `GET /api/v1/shifts`

List shifts.

**Permission:**
- `shift.view_all` for owner/manager (all shifts in outlet)
- `shift.view_own` for staff (own shifts only)

**Query:** `userId`, `from`, `to`, `status`, `limit`, `cursor`

**Response:** Paginated list.

### 5.4 `GET /api/v1/shifts/:id`

Shift detail with full summary and transaction list.

### 5.5 `GET /api/v1/shifts/active`

Convenience endpoint: get active shift for current user (if any).

**Response:**
```json
{
  "success": true,
  "data": {
    "shift": { ... } | null
  }
}
```

---

## 6. Expense & Income Endpoints

### 6.1 `POST /api/v1/expenses`

**Permission:** `expense.create`

**Request (multipart/form-data):**
```
expenseDate: 2026-04-20
categoryId: uuid
description: Beli susu dan gula
amount: 450000
paymentMethod: cash
receipt: [binary file, optional]
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "expenseDate": "2026-04-20",
    "category": { "id": "uuid", "name": "Belanja Bahan Baku" },
    "description": "Beli susu dan gula",
    "amount": 450000,
    "paymentMethod": "cash",
    "receiptImageUrl": "https://blob.vercel.com/...",
    "createdBy": "uuid",
    "createdAt": "..."
  }
}
```

**Errors:**
- `400 FILE_TOO_LARGE` — > 2MB
- `400 INVALID_FILE_TYPE` — not image
- `404 CATEGORY_NOT_FOUND`
- `422 DATE_TOO_OLD` — > 30 days past (manager only; owner no limit)

### 6.2 `GET /api/v1/expenses`

**Permission:** `report.operational`

**Query:** `from`, `to`, `categoryId`, `paymentMethod`, `limit`, `cursor`

**Response:** Paginated list.

### 6.3 `PATCH /api/v1/expenses/:id`

**Permission:**
- `expense.update_within_24h` for manager (within 24h of creation)
- `expense.update_anytime` for owner

### 6.4 `DELETE /api/v1/expenses/:id`

**Permission:** `expense.delete` (owner only)

Soft delete.

### 6.5 Expense Categories

- `GET /api/v1/expenses/categories` — list
- `POST /api/v1/expenses/categories` — create (owner, manager)
- `PATCH /api/v1/expenses/categories/:id` — edit (owner only; cannot edit `isSystem=true`)
- `DELETE /api/v1/expenses/categories/:id` — delete (owner only; cannot delete if referenced or isSystem)

### 6.6 Incomes (Manual, Non-POS)

Same pattern as expenses:
- `POST /api/v1/incomes`
- `GET /api/v1/incomes`
- `PATCH /api/v1/incomes/:id`
- `DELETE /api/v1/incomes/:id`

No categories (simple free-form).

### 6.7 `GET /api/v1/cash/daily-summary`

Daily cash summary.

**Permission:** `cash.daily_summary.view`

**Query:** `date=YYYY-MM-DD` (default today)

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-04-20",
    "income": {
      "pos": { "cash": 1150000, "qris": 1200000, "cardBca": 500000, "total": 2850000 },
      "manual": { "total": 200000, "count": 1 },
      "total": 3050000
    },
    "expenses": {
      "byCategory": [
        { "categoryId": "uuid", "name": "Belanja Bahan Baku", "total": 450000, "count": 3 }
      ],
      "total": 450000
    },
    "refunds": { "count": 1, "total": 25000 },
    "netCashFlow": 2575000
  }
}
```

---

## 7. Report Endpoints

### 7.1 `GET /api/v1/reports/sales/daily`

**Permission:** `report.sales.view`

**Query:** `date=YYYY-MM-DD`, `compareTo=YYYY-MM-DD` (optional)

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-04-20",
    "metrics": {
      "revenue": 2850000,
      "transactionCount": 67,
      "averageTicket": 42537,
      "voidedCount": 2,
      "voidedAmount": 50000,
      "refundedCount": 1,
      "refundedAmount": 25000
    },
    "byPaymentMethod": [
      { "method": "cash", "count": 23, "amount": 1150000 },
      { "method": "qris", "count": 32, "amount": 1200000 },
      { "method": "card_bca", "count": 12, "amount": 500000 }
    ],
    "byCategory": [
      { "categoryId": "uuid", "name": "Coffee Based", "count": 25, "revenue": 500000 }
    ],
    "topItems": [
      { "menuItemId": "uuid", "name": "Ayam Sambal Matah Bakmie", "quantity": 12, "revenue": 312000 }
    ],
    "hourlyDistribution": [
      { "hour": 8, "count": 5, "revenue": 150000 }
    ],
    "comparison": {
      "prev": { "revenue": 2700000, "transactionCount": 63 },
      "delta": { "revenuePercent": 5.6, "countPercent": 6.3 }
    }
  }
}
```

### 7.2 `GET /api/v1/reports/sales/range`

Weekly/monthly/custom range.

**Query:** `from`, `to`, `groupBy=day|week|month`

**Response:** Similar to daily but with time-series array.

### 7.3 `GET /api/v1/reports/items`

Item performance.

**Permission:** `report.items.view`

**Query:** `from`, `to`, `categoryId`, `sort=qty|revenue|avg`, `limit`

**Response:** Array of items with metrics.

### 7.4 `GET /api/v1/reports/pnl`

Simple P&L.

**Permission:** `report.pnl.view` (owner only)

**Query:** `from`, `to`

**Response:**
```json
{
  "success": true,
  "data": {
    "period": { "from": "2026-04-01", "to": "2026-04-30" },
    "income": {
      "posRevenue": 85000000,
      "manualIncome": 2000000,
      "total": 87000000
    },
    "expenses": {
      "byCategory": [
        { "name": "Belanja Bahan Baku", "amount": 25000000 },
        { "name": "Gaji Harian", "amount": 15000000 }
      ],
      "total": 57250000
    },
    "grossProfit": 29750000,
    "disclaimer": "Ini bukan laporan akuntansi resmi. Laporan ini hanya summary arus kas sederhana."
  }
}
```

### 7.5 `GET /api/v1/reports/shifts`

Shift report with variance flags.

**Permission:** `report.shift.view_all`

**Query:** `from`, `to`, `userId`, `hasVariance=true`

### 7.6 `GET /api/v1/reports/:reportType/export`

Export PDF.

**Permission:** `report.export.operational` or `report.export.financial` depending on report type.

**Query:** Same as the data endpoint.

**Response:** `application/pdf` binary.

---

## 8. User Management Endpoints

### 8.1 `GET /api/v1/users`

List users.

**Permission:**
- Owner sees all
- Manager sees staff only

**Query:** `role`, `status`, `search`

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "Rina",
        "email": null,
        "role": "staff",
        "status": "active",
        "hasPinSet": true,
        "createdAt": "..."
      }
    ]
  }
}
```

Note: `email` only returned if session role allows; `passwordHash`, `pinHash` never returned.

### 8.2 `POST /api/v1/users`

Create user.

**Permission:** `user.create.staff` (manager+), `user.create.manager` or `user.create.owner` (owner only)

**Request (staff):**
```json
{
  "name": "Budi",
  "role": "staff",
  "pin": "5678"
}
```

**Request (manager/owner):**
```json
{
  "name": "Siti",
  "email": "siti@mahakan.id",
  "role": "manager",
  "password": "TempPass123"
}
```

**Response (201):** Created user (without hash).

**Errors:**
- `409 EMAIL_DUPLICATE`
- `403 ROLE_NOT_ALLOWED`

### 8.3 `PATCH /api/v1/users/:id`

Update user.

**Permission:** Varies by target role.

**Request:** Partial update.

### 8.4 `PATCH /api/v1/users/:id/pin`

Reset PIN.

**Permission:** `user.reset_pin.staff` or owner for manager pins.

**Request:**
```json
{ "pin": "9999" }
```

### 8.5 `PATCH /api/v1/users/:id/status`

Activate/deactivate.

**Request:**
```json
{ "status": "inactive", "reason": "Resign" }
```

**Errors:**
- `422 LAST_OWNER_PROTECTED` — trying to deactivate last active owner

---

## 9. Settings Endpoints

### 9.1 `GET /api/v1/settings/outlet`

Current outlet settings (business info, features, receipt config).

**Permission:** Any authenticated role.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Mahakan Coffee & Space",
    "address": "...",
    "phone": "...",
    "logoUrl": "...",
    "operationalHours": { /* ... */ },
    "settings": { /* ... */ }
  }
}
```

### 9.2 `PATCH /api/v1/settings/outlet`

Update outlet info.

**Permission:** `settings.business.update` (owner only)

**Request (partial):**
```json
{
  "name": "Mahakan Coffee & Space",
  "address": "Jl. Example 123",
  "phone": "081234567890"
}
```

### 9.3 `POST /api/v1/settings/outlet/logo`

Upload logo.

**Permission:** `settings.business.update`

**Request:** multipart/form-data with `logo` file (max 1MB, jpeg/png)

**Response:**
```json
{
  "success": true,
  "data": { "logoUrl": "https://blob.vercel.com/..." }
}
```

### 9.4 `GET/PATCH /api/v1/settings/features`

Toggle feature flags (owner only).

### 9.5 `GET/PATCH /api/v1/settings/thresholds`

Shift variance threshold (owner only).

### 9.6 `GET/PATCH /api/v1/settings/receipt`

Receipt footer text, QR toggle (owner only).

### 9.7 `GET/PATCH /api/v1/settings/operational-hours`

Operational hours (owner only).

---

## 10. Stream Endpoints (Server-Sent Events)

### 10.1 `GET /api/v1/stream/menu-updates`

Real-time menu sold-out status updates.

**Headers:** `Accept: text/event-stream`

**Response:** SSE stream

Event format:
```
data: {"type":"sold_out_changed","itemId":"uuid","isSoldOut":true,"updatedBy":"uuid"}

data: {"type":"price_changed","itemId":"uuid","newPriceHot":20000,"newPriceIced":19000}

data: {"type":"item_created","itemId":"uuid",...}

: heartbeat
```

**Heartbeat:** every 30 seconds (`: heartbeat\n\n`) to keep connection alive.

**Client reconnect:** exponential backoff (1s, 2s, 4s, 8s, max 30s).

**Note:** Vercel free tier timeout is 60s for serverless functions. Real-world SSE on Vercel requires Edge runtime or periodic reconnects. Phase 1 fallback: polling `/api/v1/menu/items?modifiedSince=X` every 30s if SSE unreliable.

---

## 11. Health Endpoint

### 11.1 `GET /api/health`

**Public.** Used by client to detect network/server availability.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-04-20T10:15:30.000Z",
    "version": "0.1.0",
    "db": "connected"
  }
}
```

Check DB connection with a trivial query (`SELECT 1`). If DB fails: return 503.

---

## 12. Rate Limiting

Applied per IP and per user:

| Endpoint group | Limit |
|---|---|
| `/api/v1/auth/*` | 10 req / 15 min per IP (cross-account) + 5 failed logins / 15 min per account |
| `/api/v1/transactions` POST | 60 req / min per user |
| `/api/v1/reports/*` | 30 req / min per user |
| Other | 120 req / min per user |

Exceeded: `429 RATE_LIMITED` with `Retry-After` header.

Implementation: Phase 1 uses in-memory counter per Vercel function instance (acceptable for single-outlet low traffic). Phase 2 upgrade to Upstash Ratelimit or Redis for correctness.

---

## 13. Webhook / Integration Notes (Phase 2+)

Reserved namespace: `/api/v1/webhooks/*`. Not used in Phase 1 but kept reserved.

Future webhooks may include:
- Midtrans QRIS callback
- WhatsApp message notification
- External accounting export push

---

## 14. Examples — Full Flows

### 14.1 Example: Staff creates transaction while online

```
1. GET /api/v1/menu/items (cached)
2. GET /api/v1/shifts/active → returns active shift
3. POST /api/v1/transactions (with items payload)
   → 201 with transaction + receiptPayload
4. Client calls Web Bluetooth printer with receiptPayload
5. UI shows success
```

### 14.2 Example: Staff offline transaction then sync

```
1. Client detects offline (health ping fail)
2. User completes transaction; client stores to IndexedDB with clientRefId
3. Web Bluetooth print still works
4. Navigator goes online → client runs syncPendingTransactions()
5. For each pending: POST /api/v1/transactions with clientRefId
   → If server has already processed this clientRefId: returns 409 with existing tx → mark local as synced
   → Otherwise: 201 with new tx data
6. Toast: "3 transaksi ter-sync"
```

### 14.3 Example: Staff voids with approver override

```
1. Staff taps "Void" in transaction detail
2. UI shows ApproverOverrideModal
3. Owner taps own tile, enters PIN
4. POST /api/v1/auth/verify-approver
   → 200 with token (300s expiry)
5. POST /api/v1/transactions/:id/void with { reason, approverToken }
6. Server verifies token signature, action type, target ID, single-use
7. → 200 with voided transaction
8. Audit log: transaction.voided with both staff ID and approver ID
```

---

## 15. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial API spec for Phase 1 |
