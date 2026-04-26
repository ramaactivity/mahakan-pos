/**
 * Seed data for Mahakan POS Phase 1.
 *
 * Plain shapes consumed by `src/db/seed.ts` to populate a fresh Neon
 * instance. Source of truth for menu: `docs/04-MENU-DATA.md` (43 SKU
 * across 11 categories).
 */

export interface SeedOutlet {
  name: string;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  operationalHours: {
    [day in "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"]: {
      isOpen: boolean;
      openTime?: string;
      closeTime?: string;
    };
  };
  settings: {
    features: {
      loyaltyEnabled: boolean;
      recipeEnabled: boolean;
      multiOutletEnabled: boolean;
      showHppToStaff: boolean;
    };
    receipt: { footerText: string; showQrRating: boolean };
    thresholds: { shiftVarianceAlert: number };
  };
}

export interface SeedCategory {
  /** Slug only — DB assigns UUID. Used by seed.ts to map menuItem.categoryId. */
  slug: string;
  name: string;
  displayOrder: number;
}

export interface SeedMenuItem {
  /** Reference into seed.ts category map. */
  categorySlug: string;
  name: string;
  priceType: "fixed" | "variant" | "open";
  priceFixed: number | null;
  priceHot: number | null;
  priceIced: number | null;
  isSignature: boolean;
  displayOrder: number;
}

export interface SeedModifier {
  slug: string;
  label: string;
  type: "single_select" | "toggle";
  options: Array<{ value: string; label: string }> | null;
  price: number;
  /** Category slugs (mapped to UUIDs at insert time). null = applies globally. */
  appliesToCategorySlugs: string[] | null;
}

export interface SeedExpenseCategory {
  name: string;
  isSystem: boolean;
  displayOrder: number;
}

// --------------------------------------------------------------------------
// Outlet
// --------------------------------------------------------------------------

export const seedOutlet: SeedOutlet = {
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
};

// --------------------------------------------------------------------------
// Categories — 11 per 04-MENU-DATA.md
// --------------------------------------------------------------------------

export const CAT_RICEBOWL = "ricebowl";
export const CAT_BAKMIE = "bakmie";
export const CAT_SWEETS = "sweets";
export const CAT_BITES = "bites";
export const CAT_COFFEE = "coffee-based";
export const CAT_NON_COFFEE = "non-coffee";
export const CAT_TEA = "tea-based";
export const CAT_FRAPPE = "frappe";
export const CAT_MOCKTAIL = "mocktail";
export const CAT_MANUAL_BREW = "manual-brew";
export const CAT_ICE_CREAM = "ice-cream";

export const seedCategories: SeedCategory[] = [
  { slug: CAT_RICEBOWL, name: "Ricebowl", displayOrder: 1 },
  { slug: CAT_BAKMIE, name: "Bakmie", displayOrder: 2 },
  { slug: CAT_SWEETS, name: "Sweets", displayOrder: 3 },
  { slug: CAT_BITES, name: "Bites", displayOrder: 4 },
  { slug: CAT_COFFEE, name: "Coffee Based", displayOrder: 5 },
  { slug: CAT_NON_COFFEE, name: "Non-Coffee", displayOrder: 6 },
  { slug: CAT_TEA, name: "Tea Based", displayOrder: 7 },
  { slug: CAT_FRAPPE, name: "Frappe", displayOrder: 8 },
  { slug: CAT_MOCKTAIL, name: "Mocktail", displayOrder: 9 },
  { slug: CAT_MANUAL_BREW, name: "Manual Brew", displayOrder: 10 },
  { slug: CAT_ICE_CREAM, name: "Ice Cream", displayOrder: 11 },
];

// --------------------------------------------------------------------------
// Menu Items — 43 per 04-MENU-DATA.md
// --------------------------------------------------------------------------

function fixed(
  name: string,
  categorySlug: string,
  price: number,
  displayOrder: number,
  isSignature = false,
): SeedMenuItem {
  return {
    categorySlug,
    name,
    priceType: "fixed",
    priceFixed: price,
    priceHot: null,
    priceIced: null,
    isSignature,
    displayOrder,
  };
}

function variant(
  name: string,
  categorySlug: string,
  priceHot: number | null,
  priceIced: number | null,
  displayOrder: number,
  isSignature = false,
): SeedMenuItem {
  return {
    categorySlug,
    name,
    priceType: "variant",
    priceFixed: null,
    priceHot,
    priceIced,
    isSignature,
    displayOrder,
  };
}

function open(
  name: string,
  categorySlug: string,
  displayOrder: number,
): SeedMenuItem {
  return {
    categorySlug,
    name,
    priceType: "open",
    priceFixed: null,
    priceHot: null,
    priceIced: null,
    isSignature: false,
    displayOrder,
  };
}

export const seedMenuItems: SeedMenuItem[] = [
  // Ricebowl (4)
  fixed("Ayam Asam Manis", CAT_RICEBOWL, 23_000, 1),
  fixed("Ayam Sambal Matah", CAT_RICEBOWL, 23_000, 2, true),
  fixed("Scramble / Dadar Matah", CAT_RICEBOWL, 20_000, 3),
  fixed("Anak Kost (Telur & Sosis)", CAT_RICEBOWL, 20_000, 4),

  // Bakmie (3)
  fixed("Ayam Original", CAT_BAKMIE, 24_000, 1),
  fixed("Ayam Chilli Oil", CAT_BAKMIE, 25_000, 2, true),
  fixed("Ayam Sambal Matah", CAT_BAKMIE, 26_000, 3),

  // Sweets (3)
  fixed("Churros Choco Dip", CAT_SWEETS, 21_000, 1),
  fixed("Croffle Ice Cream", CAT_SWEETS, 21_000, 2, true),
  fixed("Roti Bakar Keju", CAT_SWEETS, 21_000, 3),

  // Bites (5)
  fixed("Mixed Platter", CAT_BITES, 25_000, 1, true),
  fixed("French Fries", CAT_BITES, 19_000, 2),
  fixed("Dimsum", CAT_BITES, 19_000, 3),
  fixed("Samosa Kare", CAT_BITES, 19_000, 4),
  fixed("Tahu Walik", CAT_BITES, 19_000, 5),

  // Coffee Based (7)
  variant("Americano", CAT_COFFEE, 17_000, 16_000, 1),
  variant("Pablo Eskopi", CAT_COFFEE, null, 23_000, 2, true),
  variant("Butterscotch Latte", CAT_COFFEE, null, 23_000, 3),
  variant("Caramel Macchiato", CAT_COFFEE, 23_000, 24_000, 4),
  variant("Cappuccino", CAT_COFFEE, 21_000, 20_000, 5),
  variant("Latte", CAT_COFFEE, 21_000, 20_000, 6),
  variant("Vanilla Latte", CAT_COFFEE, 24_000, 23_000, 7),

  // Non-Coffee (8)
  variant("Maroon Velvet", CAT_NON_COFFEE, 20_000, 19_000, 1),
  variant("Ariana Green Tea", CAT_NON_COFFEE, 20_000, 19_000, 2, true),
  variant("Chocolate", CAT_NON_COFFEE, 20_000, 19_000, 3),
  variant("Lychee Yakult", CAT_NON_COFFEE, null, 24_000, 4),
  variant("Manggo Yakult", CAT_NON_COFFEE, null, 22_000, 5),
  variant("Oreo Milkshake", CAT_NON_COFFEE, null, 16_000, 6),
  variant("Regal Milkshake", CAT_NON_COFFEE, null, 16_000, 7),
  variant("Mineral Water", CAT_NON_COFFEE, 5_000, 5_000, 8),

  // Tea Based (2)
  variant("Lemon Tea", CAT_TEA, 16_000, 15_000, 1),
  variant("Lychee Tea", CAT_TEA, null, 19_000, 2),

  // Frappe (2)
  fixed("Matcha & The Bear", CAT_FRAPPE, 24_000, 1, true),
  fixed("Misty Oreo", CAT_FRAPPE, 22_000, 2),

  // Mocktail (4)
  fixed("Mont Blanc", CAT_MOCKTAIL, 24_000, 1, true),
  fixed("Cardi Breeze", CAT_MOCKTAIL, 23_000, 2),
  fixed("The Paps", CAT_MOCKTAIL, 22_000, 3),
  fixed("Limericano", CAT_MOCKTAIL, 21_000, 4),

  // Manual Brew (2) — open price
  open("V60", CAT_MANUAL_BREW, 1),
  open("Japanese", CAT_MANUAL_BREW, 2),

  // Ice Cream (3)
  fixed("Affogato", CAT_ICE_CREAM, 19_000, 1),
  fixed("Matchagatto", CAT_ICE_CREAM, 20_000, 2),
  fixed("Oreo Ice Cream", CAT_ICE_CREAM, 17_000, 3),
];

// --------------------------------------------------------------------------
// Modifiers — 4 per 04-MENU-DATA.md
// --------------------------------------------------------------------------

const DRINK_CATEGORIES_FOR_MODIFIER = [
  CAT_COFFEE,
  CAT_NON_COFFEE,
  CAT_TEA,
  CAT_FRAPPE,
  CAT_MOCKTAIL,
];

export const seedModifiers: SeedModifier[] = [
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
    appliesToCategorySlugs: DRINK_CATEGORIES_FOR_MODIFIER,
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
    appliesToCategorySlugs: DRINK_CATEGORIES_FOR_MODIFIER,
  },
  {
    slug: "extra_shot",
    label: "Extra Shot",
    type: "toggle",
    options: null,
    price: 8_000,
    appliesToCategorySlugs: [CAT_COFFEE],
  },
  {
    slug: "extra_topping_ayam",
    label: "Extra Topping Ayam",
    type: "toggle",
    options: null,
    price: 10_000,
    appliesToCategorySlugs: [CAT_BAKMIE],
  },
];

// --------------------------------------------------------------------------
// Expense Categories — 8 user + 1 system "Refund"
// --------------------------------------------------------------------------

export const seedExpenseCategories: SeedExpenseCategory[] = [
  { name: "Belanja Bahan Baku", isSystem: false, displayOrder: 1 },
  { name: "Listrik & Air", isSystem: false, displayOrder: 2 },
  { name: "Gaji Harian", isSystem: false, displayOrder: 3 },
  { name: "Sewa", isSystem: false, displayOrder: 4 },
  { name: "Perawatan Alat", isSystem: false, displayOrder: 5 },
  { name: "Kemasan", isSystem: false, displayOrder: 6 },
  { name: "Marketing", isSystem: false, displayOrder: 7 },
  { name: "Lain-lain", isSystem: false, displayOrder: 8 },
  { name: "Refund", isSystem: true, displayOrder: 99 },
];
