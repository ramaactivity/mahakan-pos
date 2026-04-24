/**
 * Mock-layer types — mirror production DB schema (docs/03-TSD.md §4,
 * docs/06-DATABASE-SCHEMA.md §3).
 *
 * Rules:
 * - Money fields: integer rupiah (satuan). Never float.
 * - Timestamps: ISO 8601 strings (DB stores timestamptz; client receives ISO).
 * - Dates (date-only): YYYY-MM-DD strings.
 * - IDs: string (UUIDs in prod; prefixed slugs in mocks for readability).
 *
 * In Fase B these types will be re-derived from Drizzle schemas and these
 * mock types deleted. UI consumer code should NOT import from here once
 * the swap happens — import from `@/db/types` instead.
 */

// --------------------------------------------------------------------------
// Enums
// --------------------------------------------------------------------------

export type Role = "owner" | "manager" | "staff";
export type UserStatus = "active" | "inactive";

export type PriceType = "fixed" | "variant" | "open";
export type Variant = "hot" | "iced";

export type ModifierType = "single_select" | "toggle";

export type ShiftStatus = "open" | "closed";

export type OrderType = "dine_in" | "takeaway";
export type PaymentMethod = "cash" | "qris" | "card_bca";
export type TransactionStatus = "paid" | "voided" | "refunded";
export type DiscountType = "fixed" | "percent";

export type ExpensePaymentMethod = "cash" | "transfer" | "other";

// --------------------------------------------------------------------------
// Outlet
// --------------------------------------------------------------------------

export interface OperationalHoursDay {
  isOpen: boolean;
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
}

export interface OperationalHours {
  mon: OperationalHoursDay;
  tue: OperationalHoursDay;
  wed: OperationalHoursDay;
  thu: OperationalHoursDay;
  fri: OperationalHoursDay;
  sat: OperationalHoursDay;
  sun: OperationalHoursDay;
}

export interface OutletSettings {
  features: {
    loyaltyEnabled: boolean;
    recipeEnabled: boolean;
    multiOutletEnabled: boolean;
    showHppToStaff: boolean;
  };
  receipt: {
    footerText: string;
    showQrRating: boolean;
  };
  thresholds: {
    shiftVarianceAlert: number; // rupiah
  };
}

export interface Outlet {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  operationalHours: OperationalHours;
  settings: OutletSettings;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// --------------------------------------------------------------------------
// User
// --------------------------------------------------------------------------

export interface User {
  id: string;
  outletId: string;
  name: string;
  email: string | null;
  /** bcrypt hash — mocks carry plaintext for convenience; NEVER in prod */
  passwordHash: string | null;
  /** bcrypt hash — mocks carry plaintext; NEVER in prod */
  pinHash: string | null;
  role: Role;
  status: UserStatus;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

/** User shape safe to hand to client — no hashes. */
export type PublicUser = Omit<User, "passwordHash" | "pinHash"> & {
  hasPasswordSet: boolean;
  hasPinSet: boolean;
};

// --------------------------------------------------------------------------
// Menu
// --------------------------------------------------------------------------

export interface Category {
  id: string;
  outletId: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MenuItem {
  id: string;
  outletId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceType: PriceType;
  priceFixed: number | null;
  priceHot: number | null;
  priceIced: number | null;
  isSignature: boolean;
  isSoldOut: boolean;
  isActive: boolean;
  displayOrder: number;
  /** Phase 2 placeholders, nullable */
  costPrice: number | null;
  recipeId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ModifierOption {
  value: string;
  label: string;
}

export interface Modifier {
  /** slug = PK, not UUID (per docs/06-DATABASE-SCHEMA.md §3.5) */
  slug: string;
  label: string;
  type: ModifierType;
  /** populated for `single_select` */
  options: ModifierOption[] | null;
  /** rupiah price delta added per unit. Zero for single_select modifiers. */
  price: number;
  /** Category slugs this modifier applies to; null = applies to all drinks. */
  appliesToCategories: string[] | null;
  isActive: boolean;
  updatedAt: string;
}

// --------------------------------------------------------------------------
// Shift
// --------------------------------------------------------------------------

export interface Shift {
  id: string;
  outletId: string;
  userId: string;
  status: ShiftStatus;
  openingCash: number;
  actualCash: number | null;
  /** actualCash - expectedCash; computed at close */
  variance: number | null;
  notes: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --------------------------------------------------------------------------
// Transaction
// --------------------------------------------------------------------------

export interface TransactionItemModifier {
  id: string;
  transactionItemId: string;
  modifierSlug: string;
  selectedValue: string | null;
  priceDelta: number;
  createdAt: string;
}

export interface TransactionItem {
  id: string;
  transactionId: string;
  menuItemId: string;
  /** Snapshot at transaction time. */
  itemName: string;
  itemCategoryName: string;
  variant: Variant | null;
  unitPrice: number;
  quantity: number;
  /** Sum of modifier price deltas per unit. */
  modifiersPriceDelta: number;
  /** (unitPrice + modifiersPriceDelta) * quantity */
  subtotal: number;
  note: string | null;
  /** Manual Brew beans note */
  openPriceNote: string | null;
  modifiers: TransactionItemModifier[];
  createdAt: string;
}

export interface Transaction {
  id: string;
  outletId: string;
  shiftId: string;
  cashierId: string;
  /** Idempotency key for offline sync */
  clientRefId: string | null;
  /** Format: TRX-YYYYMMDD-NNNN */
  transactionNumber: string;
  pagerNumber: number;
  orderType: OrderType;
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
  cashChange: number | null;
  status: TransactionStatus;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedApprover: string | null;
  voidReason: string | null;
  refundedAt: string | null;
  refundedBy: string | null;
  refundedApprover: string | null;
  refundReason: string | null;
  discountApprover: string | null;
  servedAt: string | null;
  items: TransactionItem[];
  createdAt: string;
  updatedAt: string;
}

// --------------------------------------------------------------------------
// Expense / Income
// --------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string;
  outletId: string;
  name: string;
  isSystem: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Expense {
  id: string;
  outletId: string;
  expenseDate: string; // YYYY-MM-DD
  categoryId: string;
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  receiptImageUrl: string | null;
  refundedTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
  deletedBy: string | null;
}

export interface Income {
  id: string;
  outletId: string;
  incomeDate: string; // YYYY-MM-DD
  description: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdBy: string;
  updatedBy: string | null;
}

// --------------------------------------------------------------------------
// Audit Log
// --------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  eventType: string;
  userId: string | null;
  approverId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// --------------------------------------------------------------------------
// API envelope (per docs/08-API-SPEC.md §1.3)
// --------------------------------------------------------------------------

export interface ApiMeta {
  timestamp: string;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
  meta?: ApiMeta;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> {
  items: T[];
  total?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

// --------------------------------------------------------------------------
// Session
// --------------------------------------------------------------------------

export interface Session {
  user: PublicUser;
  expires: string;
}
