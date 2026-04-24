/**
 * Mock seed data — Mahakan POS prototype.
 *
 * Source of truth for menu: docs/04-MENU-DATA.md (43 items across 11 categories).
 *   NOTE: PRD/README mention "45 SKU" but the detailed menu data doc lists 43.
 *   Using 43 as the accurate count; flag for owner during M8 DB seed.
 *
 * Timestamps use a fixed reference date 2026-04-24 so the mock state is
 * deterministic across sessions. In Fase B these will be real now()s from Postgres.
 *
 * Passwords/PINs stored as plaintext here for dev convenience. In real DB
 * everything is bcrypt-hashed (M8+).
 */

import type {
  Category,
  Expense,
  ExpenseCategory,
  Income,
  MenuItem,
  Modifier,
  Outlet,
  Shift,
  Transaction,
  User,
} from "./types";

// --------------------------------------------------------------------------
// Reference timestamps
// --------------------------------------------------------------------------

const REF_DATE = "2026-04-24T07:00:00.000Z"; // Fri 14:00 WIB — opening time

export const MOCK_REF_DATE = REF_DATE;

// --------------------------------------------------------------------------
// Outlet
// --------------------------------------------------------------------------

export const OUTLET_ID = "outlet-mahakan-cisarua";

export const mockOutlet: Outlet = {
  id: OUTLET_ID,
  name: "Mahakan Coffee & Space",
  address: "Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750",
  phone: "0838-1977-5665",
  logoUrl: "/assets/logo/Logo_Mahakan_Hijau.png",
  operationalHours: {
    mon: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
    tue: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
    wed: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
    thu: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
    fri: { isOpen: true, openTime: "14:00", closeTime: "22:00" },
    sat: { isOpen: true, openTime: "09:00", closeTime: "23:00" },
    sun: { isOpen: true, openTime: "09:00", closeTime: "23:00" },
  },
  settings: {
    features: {
      loyaltyEnabled: false,
      recipeEnabled: false,
      multiOutletEnabled: false,
      showHppToStaff: false,
    },
    receipt: {
      footerText: "Terima kasih, sampai jumpa!",
      showQrRating: false,
    },
    thresholds: {
      shiftVarianceAlert: 10_000,
    },
  },
  isActive: true,
  createdAt: REF_DATE,
  updatedAt: REF_DATE,
  deletedAt: null,
};

// --------------------------------------------------------------------------
// Users — 1 owner, 1 manager, 2 staff
// --------------------------------------------------------------------------

export const USER_OWNER_ID = "user-owner-rama";
export const USER_MANAGER_ID = "user-manager-siti";
export const USER_STAFF_RINA_ID = "user-staff-rina";
export const USER_STAFF_BUDI_ID = "user-staff-budi";

export const mockUsers: User[] = [
  {
    id: USER_OWNER_ID,
    outletId: OUTLET_ID,
    name: "Rama Saputra",
    email: "rama.activity98@gmail.com",
    passwordHash: "Owner1234!", // plaintext in mocks only
    pinHash: "1234",
    role: "owner",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
  },
  {
    id: USER_MANAGER_ID,
    outletId: OUTLET_ID,
    name: "Siti",
    email: "siti@mahakan.id",
    passwordHash: "Manager1234!",
    pinHash: "2345",
    role: "manager",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
  },
  {
    id: USER_STAFF_RINA_ID,
    outletId: OUTLET_ID,
    name: "Rina",
    email: null,
    passwordHash: null,
    pinHash: "5678",
    role: "staff",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
  },
  {
    id: USER_STAFF_BUDI_ID,
    outletId: OUTLET_ID,
    name: "Budi",
    email: null,
    passwordHash: null,
    pinHash: "5679",
    role: "staff",
    status: "active",
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
  },
];

// --------------------------------------------------------------------------
// Categories — 11 per 04-MENU-DATA.md
// --------------------------------------------------------------------------

const CAT_RICEBOWL = "cat-ricebowl";
const CAT_BAKMIE = "cat-bakmie";
const CAT_SWEETS = "cat-sweets";
const CAT_BITES = "cat-bites";
const CAT_COFFEE = "cat-coffee-based";
const CAT_NON_COFFEE = "cat-non-coffee";
const CAT_TEA = "cat-tea-based";
const CAT_FRAPPE = "cat-frappe";
const CAT_MOCKTAIL = "cat-mocktail";
const CAT_MANUAL_BREW = "cat-manual-brew";
const CAT_ICE_CREAM = "cat-ice-cream";

export const mockCategories: Category[] = [
  { id: CAT_RICEBOWL, outletId: OUTLET_ID, name: "Ricebowl", displayOrder: 1, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_BAKMIE, outletId: OUTLET_ID, name: "Bakmie", displayOrder: 2, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_SWEETS, outletId: OUTLET_ID, name: "Sweets", displayOrder: 3, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_BITES, outletId: OUTLET_ID, name: "Bites", displayOrder: 4, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_COFFEE, outletId: OUTLET_ID, name: "Coffee Based", displayOrder: 5, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_NON_COFFEE, outletId: OUTLET_ID, name: "Non-Coffee", displayOrder: 6, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_TEA, outletId: OUTLET_ID, name: "Tea Based", displayOrder: 7, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_FRAPPE, outletId: OUTLET_ID, name: "Frappe", displayOrder: 8, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_MOCKTAIL, outletId: OUTLET_ID, name: "Mocktail", displayOrder: 9, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_MANUAL_BREW, outletId: OUTLET_ID, name: "Manual Brew", displayOrder: 10, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: CAT_ICE_CREAM, outletId: OUTLET_ID, name: "Ice Cream", displayOrder: 11, isActive: true, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
];

// --------------------------------------------------------------------------
// Menu Items — 43 items per docs/04-MENU-DATA.md §Menu Items
// --------------------------------------------------------------------------

function mkFixed(
  id: string,
  name: string,
  categoryId: string,
  price: number,
  displayOrder: number,
  isSignature = false,
): MenuItem {
  return {
    id,
    outletId: OUTLET_ID,
    categoryId,
    name,
    description: null,
    priceType: "fixed",
    priceFixed: price,
    priceHot: null,
    priceIced: null,
    isSignature,
    isSoldOut: false,
    isActive: true,
    displayOrder,
    costPrice: null,
    recipeId: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
  };
}

function mkVariant(
  id: string,
  name: string,
  categoryId: string,
  priceHot: number | null,
  priceIced: number | null,
  displayOrder: number,
  isSignature = false,
): MenuItem {
  return {
    id,
    outletId: OUTLET_ID,
    categoryId,
    name,
    description: null,
    priceType: "variant",
    priceFixed: null,
    priceHot,
    priceIced,
    isSignature,
    isSoldOut: false,
    isActive: true,
    displayOrder,
    costPrice: null,
    recipeId: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
  };
}

function mkOpen(
  id: string,
  name: string,
  categoryId: string,
  displayOrder: number,
): MenuItem {
  return {
    id,
    outletId: OUTLET_ID,
    categoryId,
    name,
    description: null,
    priceType: "open",
    priceFixed: null,
    priceHot: null,
    priceIced: null,
    isSignature: false,
    isSoldOut: false,
    isActive: true,
    displayOrder,
    costPrice: null,
    recipeId: null,
    createdAt: REF_DATE,
    updatedAt: REF_DATE,
    deletedAt: null,
  };
}

export const mockMenuItems: MenuItem[] = [
  // Ricebowl (4)
  mkFixed("item-rb-1", "Ayam Asam Manis", CAT_RICEBOWL, 23_000, 1),
  mkFixed("item-rb-2", "Ayam Sambal Matah", CAT_RICEBOWL, 23_000, 2, true),
  mkFixed("item-rb-3", "Scramble / Dadar Matah", CAT_RICEBOWL, 20_000, 3),
  mkFixed("item-rb-4", "Anak Kost (Telur & Sosis)", CAT_RICEBOWL, 20_000, 4),

  // Bakmie (3)
  mkFixed("item-bk-1", "Ayam Original", CAT_BAKMIE, 24_000, 1),
  mkFixed("item-bk-2", "Ayam Chilli Oil", CAT_BAKMIE, 25_000, 2, true),
  mkFixed("item-bk-3", "Ayam Sambal Matah", CAT_BAKMIE, 26_000, 3),

  // Sweets (3)
  mkFixed("item-sw-1", "Churros Choco Dip", CAT_SWEETS, 21_000, 1),
  mkFixed("item-sw-2", "Croffle Ice Cream", CAT_SWEETS, 21_000, 2, true),
  mkFixed("item-sw-3", "Roti Bakar Keju", CAT_SWEETS, 21_000, 3),

  // Bites (5)
  mkFixed("item-bt-1", "Mixed Platter", CAT_BITES, 25_000, 1, true),
  mkFixed("item-bt-2", "French Fries", CAT_BITES, 19_000, 2),
  mkFixed("item-bt-3", "Dimsum", CAT_BITES, 19_000, 3),
  mkFixed("item-bt-4", "Samosa Kare", CAT_BITES, 19_000, 4),
  mkFixed("item-bt-5", "Tahu Walik", CAT_BITES, 19_000, 5),

  // Coffee Based (7)
  mkVariant("item-cf-1", "Americano", CAT_COFFEE, 17_000, 16_000, 1),
  mkVariant("item-cf-2", "Pablo Eskopi", CAT_COFFEE, null, 23_000, 2, true),
  mkVariant("item-cf-3", "Butterscotch Latte", CAT_COFFEE, null, 23_000, 3),
  mkVariant("item-cf-4", "Caramel Macchiato", CAT_COFFEE, 23_000, 24_000, 4),
  mkVariant("item-cf-5", "Cappuccino", CAT_COFFEE, 21_000, 20_000, 5),
  mkVariant("item-cf-6", "Latte", CAT_COFFEE, 21_000, 20_000, 6),
  mkVariant("item-cf-7", "Vanilla Latte", CAT_COFFEE, 24_000, 23_000, 7),

  // Non-Coffee (8)
  mkVariant("item-nc-1", "Maroon Velvet", CAT_NON_COFFEE, 20_000, 19_000, 1),
  mkVariant("item-nc-2", "Ariana Green Tea", CAT_NON_COFFEE, 20_000, 19_000, 2, true),
  mkVariant("item-nc-3", "Chocolate", CAT_NON_COFFEE, 20_000, 19_000, 3),
  mkVariant("item-nc-4", "Lychee Yakult", CAT_NON_COFFEE, null, 24_000, 4),
  mkVariant("item-nc-5", "Manggo Yakult", CAT_NON_COFFEE, null, 22_000, 5),
  mkVariant("item-nc-6", "Oreo Milkshake", CAT_NON_COFFEE, null, 16_000, 6),
  mkVariant("item-nc-7", "Regal Milkshake", CAT_NON_COFFEE, null, 16_000, 7),
  mkVariant("item-nc-8", "Mineral Water", CAT_NON_COFFEE, 5_000, 5_000, 8),

  // Tea Based (2)
  mkVariant("item-tb-1", "Lemon Tea", CAT_TEA, 16_000, 15_000, 1),
  mkVariant("item-tb-2", "Lychee Tea", CAT_TEA, null, 19_000, 2),

  // Frappe (2)
  mkFixed("item-fr-1", "Matcha & The Bear", CAT_FRAPPE, 24_000, 1, true),
  mkFixed("item-fr-2", "Misty Oreo", CAT_FRAPPE, 22_000, 2),

  // Mocktail (4)
  mkFixed("item-mc-1", "Mont Blanc", CAT_MOCKTAIL, 24_000, 1, true),
  mkFixed("item-mc-2", "Cardi Breeze", CAT_MOCKTAIL, 23_000, 2),
  mkFixed("item-mc-3", "The Paps", CAT_MOCKTAIL, 22_000, 3),
  mkFixed("item-mc-4", "Limericano", CAT_MOCKTAIL, 21_000, 4),

  // Manual Brew (2) — open price
  mkOpen("item-mb-1", "V60", CAT_MANUAL_BREW, 1),
  mkOpen("item-mb-2", "Japanese", CAT_MANUAL_BREW, 2),

  // Ice Cream (3)
  mkFixed("item-ic-1", "Affogato", CAT_ICE_CREAM, 19_000, 1),
  mkFixed("item-ic-2", "Matchagatto", CAT_ICE_CREAM, 20_000, 2),
  mkFixed("item-ic-3", "Oreo Ice Cream", CAT_ICE_CREAM, 17_000, 3),
];

// --------------------------------------------------------------------------
// Modifiers — 4 per docs/04-MENU-DATA.md §Modifiers
// --------------------------------------------------------------------------

export const mockModifiers: Modifier[] = [
  {
    slug: "sugar_level",
    label: "Tingkat Gula",
    type: "single_select",
    options: [
      { value: "normal", label: "Normal" },
      { value: "less", label: "Less Sugar" },
      { value: "none", label: "No Sugar" },
    ],
    price: 0,
    appliesToCategories: null, // all drinks
    isActive: true,
    updatedAt: REF_DATE,
  },
  {
    slug: "ice_level",
    label: "Tingkat Es",
    type: "single_select",
    options: [
      { value: "normal", label: "Normal" },
      { value: "less", label: "Less Ice" },
      { value: "none", label: "No Ice" },
    ],
    price: 0,
    appliesToCategories: null, // all iced drinks
    isActive: true,
    updatedAt: REF_DATE,
  },
  {
    slug: "extra_shot",
    label: "Extra Shot",
    type: "toggle",
    options: null,
    price: 8_000,
    appliesToCategories: [CAT_COFFEE],
    isActive: true,
    updatedAt: REF_DATE,
  },
  {
    slug: "extra_topping_ayam",
    label: "Extra Topping Ayam",
    type: "toggle",
    options: null,
    price: 10_000,
    appliesToCategories: [CAT_BAKMIE],
    isActive: true,
    updatedAt: REF_DATE,
  },
];

// --------------------------------------------------------------------------
// Expense Categories — 8 regular + 1 system per docs/04-MENU-DATA.md
// --------------------------------------------------------------------------

export const EXPENSE_CAT_REFUND_ID = "expcat-refund";

export const mockExpenseCategories: ExpenseCategory[] = [
  { id: "expcat-bahan-baku", outletId: OUTLET_ID, name: "Belanja Bahan Baku", isSystem: false, displayOrder: 1, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-listrik-air", outletId: OUTLET_ID, name: "Listrik & Air", isSystem: false, displayOrder: 2, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-gaji-harian", outletId: OUTLET_ID, name: "Gaji Harian", isSystem: false, displayOrder: 3, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-sewa", outletId: OUTLET_ID, name: "Sewa", isSystem: false, displayOrder: 4, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-perawatan", outletId: OUTLET_ID, name: "Perawatan Alat", isSystem: false, displayOrder: 5, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-kemasan", outletId: OUTLET_ID, name: "Kemasan", isSystem: false, displayOrder: 6, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-marketing", outletId: OUTLET_ID, name: "Marketing", isSystem: false, displayOrder: 7, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: "expcat-lain", outletId: OUTLET_ID, name: "Lain-lain", isSystem: false, displayOrder: 8, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
  { id: EXPENSE_CAT_REFUND_ID, outletId: OUTLET_ID, name: "Refund", isSystem: true, displayOrder: 99, createdAt: REF_DATE, updatedAt: REF_DATE, deletedAt: null },
];

// --------------------------------------------------------------------------
// Sample Shifts (1 open, 2 closed)
// --------------------------------------------------------------------------

export const SHIFT_ACTIVE_ID = "shift-active-today";
const SHIFT_CLOSED_YESTERDAY = "shift-closed-yesterday";
const SHIFT_CLOSED_2DAYS_AGO = "shift-closed-2d";

export const mockShifts: Shift[] = [
  {
    id: SHIFT_ACTIVE_ID,
    outletId: OUTLET_ID,
    userId: USER_STAFF_RINA_ID,
    status: "open",
    openingCash: 100_000,
    actualCash: null,
    variance: null,
    notes: null,
    openedAt: "2026-04-24T07:00:00.000Z", // Fri 14:00 WIB
    closedAt: null,
    createdAt: "2026-04-24T07:00:00.000Z",
    updatedAt: "2026-04-24T07:00:00.000Z",
  },
  {
    id: SHIFT_CLOSED_YESTERDAY,
    outletId: OUTLET_ID,
    userId: USER_STAFF_RINA_ID,
    status: "closed",
    openingCash: 100_000,
    actualCash: 1_248_000,
    variance: -2_000, // minus 2rb
    notes: "Kemungkinan kembalian kurang pas",
    openedAt: "2026-04-23T07:00:00.000Z",
    closedAt: "2026-04-23T15:00:00.000Z",
    createdAt: "2026-04-23T07:00:00.000Z",
    updatedAt: "2026-04-23T15:00:00.000Z",
  },
  {
    id: SHIFT_CLOSED_2DAYS_AGO,
    outletId: OUTLET_ID,
    userId: USER_STAFF_BUDI_ID,
    status: "closed",
    openingCash: 100_000,
    actualCash: 1_450_000,
    variance: 0,
    notes: null,
    openedAt: "2026-04-22T07:00:00.000Z",
    closedAt: "2026-04-22T15:00:00.000Z",
    createdAt: "2026-04-22T07:00:00.000Z",
    updatedAt: "2026-04-22T15:00:00.000Z",
  },
];

// --------------------------------------------------------------------------
// Sample Transactions (5: paid cash, paid qris, paid card, voided, refunded)
// --------------------------------------------------------------------------

export const mockTransactions: Transaction[] = [
  // 1. Paid cash — active shift
  {
    id: "trx-001",
    outletId: OUTLET_ID,
    shiftId: SHIFT_ACTIVE_ID,
    cashierId: USER_STAFF_RINA_ID,
    clientRefId: "client-ref-001",
    transactionNumber: "TRX-20260424-0001",
    pagerNumber: 5,
    orderType: "takeaway",
    subtotal: 37_000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    total: 37_000,
    paymentMethod: "cash",
    cashReceived: 50_000,
    cashChange: 13_000,
    status: "paid",
    voidedAt: null,
    voidedBy: null,
    voidedApprover: null,
    voidReason: null,
    refundedAt: null,
    refundedBy: null,
    refundedApprover: null,
    refundReason: null,
    discountApprover: null,
    servedAt: "2026-04-24T07:12:00.000Z",
    createdAt: "2026-04-24T07:10:00.000Z",
    updatedAt: "2026-04-24T07:12:00.000Z",
    items: [
      {
        id: "trxitem-001-1",
        transactionId: "trx-001",
        menuItemId: "item-cf-1",
        itemName: "Americano",
        itemCategoryName: "Coffee Based",
        variant: "iced",
        unitPrice: 16_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 16_000,
        note: null,
        openPriceNote: null,
        modifiers: [
          {
            id: "trxmod-001-1-sugar",
            transactionItemId: "trxitem-001-1",
            modifierSlug: "sugar_level",
            selectedValue: "less",
            priceDelta: 0,
            createdAt: "2026-04-24T07:10:00.000Z",
          },
        ],
        createdAt: "2026-04-24T07:10:00.000Z",
      },
      {
        id: "trxitem-001-2",
        transactionId: "trx-001",
        menuItemId: "item-sw-2",
        itemName: "Croffle Ice Cream",
        itemCategoryName: "Sweets",
        variant: null,
        unitPrice: 21_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 21_000,
        note: null,
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-24T07:10:00.000Z",
      },
    ],
  },

  // 2. Paid QRIS
  {
    id: "trx-002",
    outletId: OUTLET_ID,
    shiftId: SHIFT_ACTIVE_ID,
    cashierId: USER_STAFF_RINA_ID,
    clientRefId: "client-ref-002",
    transactionNumber: "TRX-20260424-0002",
    pagerNumber: 7,
    orderType: "dine_in",
    subtotal: 49_000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    total: 49_000,
    paymentMethod: "qris",
    cashReceived: null,
    cashChange: null,
    status: "paid",
    voidedAt: null,
    voidedBy: null,
    voidedApprover: null,
    voidReason: null,
    refundedAt: null,
    refundedBy: null,
    refundedApprover: null,
    refundReason: null,
    discountApprover: null,
    servedAt: null,
    createdAt: "2026-04-24T07:45:00.000Z",
    updatedAt: "2026-04-24T07:45:00.000Z",
    items: [
      {
        id: "trxitem-002-1",
        transactionId: "trx-002",
        menuItemId: "item-bk-2",
        itemName: "Ayam Chilli Oil",
        itemCategoryName: "Bakmie",
        variant: null,
        unitPrice: 25_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 25_000,
        note: "tolong gak terlalu pedes",
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-24T07:45:00.000Z",
      },
      {
        id: "trxitem-002-2",
        transactionId: "trx-002",
        menuItemId: "item-mb-1",
        itemName: "V60",
        itemCategoryName: "Manual Brew",
        variant: null,
        unitPrice: 24_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 24_000,
        note: null,
        openPriceNote: "Ethiopia Yirgacheffe",
        modifiers: [],
        createdAt: "2026-04-24T07:45:00.000Z",
      },
    ],
  },

  // 3. Paid card BCA with 10% discount
  {
    id: "trx-003",
    outletId: OUTLET_ID,
    shiftId: SHIFT_ACTIVE_ID,
    cashierId: USER_STAFF_RINA_ID,
    clientRefId: "client-ref-003",
    transactionNumber: "TRX-20260424-0003",
    pagerNumber: 12,
    orderType: "takeaway",
    subtotal: 61_000,
    discountType: "percent",
    discountValue: 10,
    discountAmount: 6_100,
    discountReason: "Promo Staff",
    total: 54_900,
    paymentMethod: "card_bca",
    cashReceived: null,
    cashChange: null,
    status: "paid",
    voidedAt: null,
    voidedBy: null,
    voidedApprover: null,
    voidReason: null,
    refundedAt: null,
    refundedBy: null,
    refundedApprover: null,
    refundReason: null,
    discountApprover: USER_OWNER_ID,
    servedAt: "2026-04-24T08:15:00.000Z",
    createdAt: "2026-04-24T08:10:00.000Z",
    updatedAt: "2026-04-24T08:15:00.000Z",
    items: [
      {
        id: "trxitem-003-1",
        transactionId: "trx-003",
        menuItemId: "item-cf-5",
        itemName: "Cappuccino",
        itemCategoryName: "Coffee Based",
        variant: "hot",
        unitPrice: 21_000,
        quantity: 2,
        modifiersPriceDelta: 0,
        subtotal: 42_000,
        note: null,
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-24T08:10:00.000Z",
      },
      {
        id: "trxitem-003-2",
        transactionId: "trx-003",
        menuItemId: "item-bt-3",
        itemName: "Dimsum",
        itemCategoryName: "Bites",
        variant: null,
        unitPrice: 19_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 19_000,
        note: null,
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-24T08:10:00.000Z",
      },
    ],
  },

  // 4. Voided
  {
    id: "trx-004",
    outletId: OUTLET_ID,
    shiftId: SHIFT_CLOSED_YESTERDAY,
    cashierId: USER_STAFF_RINA_ID,
    clientRefId: "client-ref-004",
    transactionNumber: "TRX-20260423-0015",
    pagerNumber: 3,
    orderType: "dine_in",
    subtotal: 21_000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    total: 21_000,
    paymentMethod: "cash",
    cashReceived: 25_000,
    cashChange: 4_000,
    status: "voided",
    voidedAt: "2026-04-23T08:45:00.000Z",
    voidedBy: USER_STAFF_RINA_ID,
    voidedApprover: USER_OWNER_ID,
    voidReason: "Customer batal",
    refundedAt: null,
    refundedBy: null,
    refundedApprover: null,
    refundReason: null,
    discountApprover: null,
    servedAt: null,
    createdAt: "2026-04-23T08:30:00.000Z",
    updatedAt: "2026-04-23T08:45:00.000Z",
    items: [
      {
        id: "trxitem-004-1",
        transactionId: "trx-004",
        menuItemId: "item-sw-2",
        itemName: "Croffle Ice Cream",
        itemCategoryName: "Sweets",
        variant: null,
        unitPrice: 21_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 21_000,
        note: null,
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-23T08:30:00.000Z",
      },
    ],
  },

  // 5. Refunded (auto-generated expense entry exists in mockExpenses)
  {
    id: "trx-005",
    outletId: OUTLET_ID,
    shiftId: SHIFT_CLOSED_YESTERDAY,
    cashierId: USER_STAFF_RINA_ID,
    clientRefId: "client-ref-005",
    transactionNumber: "TRX-20260423-0018",
    pagerNumber: 9,
    orderType: "takeaway",
    subtotal: 25_000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    discountReason: null,
    total: 25_000,
    paymentMethod: "cash",
    cashReceived: 25_000,
    cashChange: 0,
    status: "refunded",
    voidedAt: null,
    voidedBy: null,
    voidedApprover: null,
    voidReason: null,
    refundedAt: "2026-04-23T11:20:00.000Z",
    refundedBy: USER_STAFF_RINA_ID,
    refundedApprover: USER_OWNER_ID,
    refundReason: "Barang kualitas kurang baik",
    discountApprover: null,
    servedAt: "2026-04-23T10:30:00.000Z",
    createdAt: "2026-04-23T10:25:00.000Z",
    updatedAt: "2026-04-23T11:20:00.000Z",
    items: [
      {
        id: "trxitem-005-1",
        transactionId: "trx-005",
        menuItemId: "item-bt-1",
        itemName: "Mixed Platter",
        itemCategoryName: "Bites",
        variant: null,
        unitPrice: 25_000,
        quantity: 1,
        modifiersPriceDelta: 0,
        subtotal: 25_000,
        note: null,
        openPriceNote: null,
        modifiers: [],
        createdAt: "2026-04-23T10:25:00.000Z",
      },
    ],
  },
];

// --------------------------------------------------------------------------
// Sample Expenses & Incomes
// --------------------------------------------------------------------------

export const mockExpenses: Expense[] = [
  {
    id: "exp-001",
    outletId: OUTLET_ID,
    expenseDate: "2026-04-24",
    categoryId: "expcat-bahan-baku",
    description: "Beli susu, gula aren, sirup",
    amount: 380_000,
    paymentMethod: "cash",
    receiptImageUrl: null,
    refundedTransactionId: null,
    createdAt: "2026-04-24T03:30:00.000Z",
    updatedAt: "2026-04-24T03:30:00.000Z",
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
    deletedBy: null,
  },
  {
    id: "exp-002",
    outletId: OUTLET_ID,
    expenseDate: "2026-04-24",
    categoryId: "expcat-kemasan",
    description: "Cup takeaway + sedotan",
    amount: 70_000,
    paymentMethod: "cash",
    receiptImageUrl: null,
    refundedTransactionId: null,
    createdAt: "2026-04-24T03:45:00.000Z",
    updatedAt: "2026-04-24T03:45:00.000Z",
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
    deletedBy: null,
  },
  // Auto-generated from refunded trx-005
  {
    id: "exp-003",
    outletId: OUTLET_ID,
    expenseDate: "2026-04-23",
    categoryId: EXPENSE_CAT_REFUND_ID,
    description: "Refund TRX-20260423-0018: Barang kualitas kurang baik",
    amount: 25_000,
    paymentMethod: "cash",
    receiptImageUrl: null,
    refundedTransactionId: "trx-005",
    createdAt: "2026-04-23T11:20:00.000Z",
    updatedAt: "2026-04-23T11:20:00.000Z",
    deletedAt: null,
    createdBy: USER_STAFF_RINA_ID,
    updatedBy: null,
    deletedBy: null,
  },
];

export const mockIncomes: Income[] = [
  {
    id: "inc-001",
    outletId: OUTLET_ID,
    incomeDate: "2026-04-22",
    description: "Sewa ruang event acara komunitas fotografi",
    amount: 500_000,
    paymentMethod: "transfer",
    createdAt: "2026-04-22T12:00:00.000Z",
    updatedAt: "2026-04-22T12:00:00.000Z",
    deletedAt: null,
    createdBy: USER_OWNER_ID,
    updatedBy: null,
  },
];
