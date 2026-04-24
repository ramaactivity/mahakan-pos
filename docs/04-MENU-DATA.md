# 🍽️ MENU DATA — Mahakan Coffee & Space

**Document:** Seed data for 45 SKU menu
**Version:** 1.0
**Source:** Menu photo MENU_FIX_MAHAKAN_2026.png
**Last Updated:** April 2026

---

## Purpose

This document is the **single source of truth** for seed menu data. Used by:

1. `src/db/seed.ts` to bootstrap initial database
2. Developers reference during implementation
3. QA reference during test case creation

All prices are in **integer rupiah** (satuan). `23` in source menu means Rp 23.000.

---

## Categories

| Display Order | Name | Notes |
|---|---|---|
| 1 | Ricebowl | Hidangan nasi |
| 2 | Bakmie | Mie dengan topping ayam |
| 3 | Sweets | Dessert manis |
| 4 | Bites | Camilan savory |
| 5 | Coffee Based | Kopi dengan variant Hot/Iced |
| 6 | Non-Coffee | Minuman non-kopi dengan variant Hot/Iced |
| 7 | Tea Based | Minuman teh |
| 8 | Frappe | Minuman blended dingin |
| 9 | Mocktail | Minuman non-alcoholic fancy |
| 10 | Manual Brew | V60, Japanese — open-price |
| 11 | Ice Cream | Dessert es krim |

---

## Menu Items — Full Seed Data

### Category 1: Ricebowl

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 1 | Ayam Asam Manis | fixed | 23.000 | No | |
| 2 | Ayam Sambal Matah | fixed | 23.000 | **Yes** ♥ | Signature |
| 3 | Scramble / Dadar Matah | fixed | 20.000 | No | |
| 4 | Anak Kost (Telur & Sosis) | fixed | 20.000 | No | |

### Category 2: Bakmie

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 5 | Ayam Original | fixed | 24.000 | No | |
| 6 | Ayam Chilli Oil | fixed | 25.000 | **Yes** ♥ | Signature |
| 7 | Ayam Sambal Matah | fixed | 26.000 | No | |

**Modifier applicable:**
- Extra Topping Ayam (+Rp 10.000)

### Category 3: Sweets

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 8 | Churros Choco Dip | fixed | 21.000 | No | |
| 9 | Croffle Ice Cream | fixed | 21.000 | **Yes** ♥ | Signature |
| 10 | Roti Bakar Keju | fixed | 21.000 | No | |

### Category 4: Bites

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 11 | Mixed Platter | fixed | 25.000 | **Yes** ♥ | Signature |
| 12 | French Fries | fixed | 19.000 | No | |
| 13 | Dimsum | fixed | 19.000 | No | |
| 14 | Samosa Kare | fixed | 19.000 | No | |
| 15 | Tahu Walik | fixed | 19.000 | No | |

### Category 5: Coffee Based (Hot/Iced Variants)

| # | Name | Price Type | Hot Price | Iced Price | Signature | Notes |
|---|---|---|---|---|---|---|
| 16 | Americano | variant | 17.000 | 16.000 | No | Both variants available |
| 17 | Pablo Eskopi | variant | *null* | 23.000 | **Yes** ♥ | **Iced-only** |
| 18 | Butterscotch Latte | variant | *null* | 23.000 | No | **Iced-only** |
| 19 | Caramel Macchiato | variant | 23.000 | 24.000 | No | |
| 20 | Cappuccino | variant | 21.000 | 20.000 | No | |
| 21 | Latte | variant | 21.000 | 20.000 | No | |
| 22 | Vanilla Latte | variant | 24.000 | 23.000 | No | |

**Modifiers applicable:**
- Sugar level (Normal/Less/None) — free
- Ice level (Normal/Less/None) — free, Iced variant only
- Extra Shot (+Rp 8.000)

### Category 6: Non-Coffee (Hot/Iced Variants where applicable)

| # | Name | Price Type | Hot Price | Iced Price | Signature | Notes |
|---|---|---|---|---|---|---|
| 23 | Maroon Velvet | variant | 20.000 | 19.000 | No | |
| 24 | Ariana Green Tea | variant | 20.000 | 19.000 | **Yes** ♥ | Signature |
| 25 | Chocolate | variant | 20.000 | 19.000 | No | |
| 26 | Lychee Yakult | variant | *null* | 24.000 | No | **Iced-only** |
| 27 | Manggo Yakult | variant | *null* | 22.000 | No | **Iced-only** |
| 28 | Oreo Milkshake | variant | *null* | 16.000 | No | **Iced-only** |
| 29 | Regal Milkshake | variant | *null* | 16.000 | No | **Iced-only** |
| 30 | Mineral Water | variant | 5.000 | 5.000 | No | Same price Hot/Iced (room temp/cold) |

**Modifiers applicable:**
- Sugar level — free (for applicable items)
- Ice level — free, Iced variant only

### Category 7: Tea Based

| # | Name | Price Type | Hot Price | Iced Price | Signature | Notes |
|---|---|---|---|---|---|---|
| 31 | Lemon Tea | variant | 16.000 | 15.000 | No | |
| 32 | Lychee Tea | variant | *null* | 19.000 | No | **Iced-only** |

**Modifiers applicable:**
- Sugar level — free
- Ice level — free, Iced variant only

### Category 8: Frappe (Iced by nature, single price)

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 33 | Matcha & The Bear | fixed | 24.000 | **Yes** ♥ | Signature, Iced by nature |
| 34 | Misty Oreo | fixed | 22.000 | No | Iced by nature |

**Modifiers applicable:**
- Sugar level — free
- Ice level — free

### Category 9: Mocktail

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 35 | Mont Blanc | fixed | 24.000 | **Yes** ♥ | Signature |
| 36 | Cardi Breeze | fixed | 23.000 | No | |
| 37 | The Paps | fixed | 22.000 | No | |
| 38 | Limericano | fixed | 21.000 | No | |

**Modifiers applicable:**
- Sugar level — free
- Ice level — free (mocktails served iced)

### Category 10: Manual Brew (Open Price)

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 39 | V60 | **open** | *manual input* | No | Barista sets price based on beans |
| 40 | Japanese | **open** | *manual input* | No | Barista sets price based on beans |

**Behavior:**
- On POS, tap → modal appears requesting price + free-text note for beans (e.g., "Ethiopia Yirgacheffe")
- Minimum price Rp 1.000; maximum Rp 999.999.999
- Note appears on receipt: `1x V60 - Ethiopia Yirgacheffe - 35.000`

**Modifiers:**
- None (no sugar/ice/shot config)
- Item-level note still available

### Category 11: Ice Cream

| # | Name | Price Type | Price | Signature | Notes |
|---|---|---|---|---|---|
| 41 | Affogato | fixed | 19.000 | No | |
| 42 | Matchagatto | fixed | 20.000 | No | |
| 43 | Oreo Ice Cream | fixed | 17.000 | No | |

---

## Modifiers Seed Data

| Slug | Label | Type | Options / Price | Applies To | Notes |
|---|---|---|---|---|---|
| `sugar_level` | Tingkat Gula | single_select | `['normal', 'less', 'none']` — free | All drinks | Default: `normal` |
| `ice_level` | Tingkat Es | single_select | `['normal', 'less', 'none']` — free | All Iced drinks | Default: `normal` |
| `extra_shot` | Extra Shot | toggle | +Rp 8.000 | Coffee Based | Default: off |
| `extra_topping_ayam` | Extra Topping Ayam | toggle | +Rp 10.000 | Bakmie | Default: off |

---

## Expense Categories Seed Data

Default expense categories created during seed:

| # | Name | Is System | Display Order |
|---|---|---|---|
| 1 | Belanja Bahan Baku | No | 1 |
| 2 | Listrik & Air | No | 2 |
| 3 | Gaji Harian | No | 3 |
| 4 | Sewa | No | 4 |
| 5 | Perawatan Alat | No | 5 |
| 6 | Kemasan | No | 6 |
| 7 | Marketing | No | 7 |
| 8 | Lain-lain | No | 8 |
| 9 | Refund | **Yes** | 99 |

**System categories (`is_system = true`):** Cannot be deleted or renamed. Used for auto-generated entries from refund flow.

---

## Default Outlet Data

```json
{
  "name": "Mahakan Coffee & Space",
  "address": "Puncak Rd No.KM 22, Cisarua, Bogor Regency, West Java 16750",
  "phone": "0838-1977-5665",
  "logoUrl": "/assets/logo/Logo_Mahakan_Hijau.png",
  "operationalHours": {
    "mon": { "isOpen": true, "openTime": "14:00", "closeTime": "22:00" },
    "tue": { "isOpen": true, "openTime": "14:00", "closeTime": "22:00" },
    "wed": { "isOpen": true, "openTime": "14:00", "closeTime": "22:00" },
    "thu": { "isOpen": true, "openTime": "14:00", "closeTime": "22:00" },
    "fri": { "isOpen": true, "openTime": "14:00", "closeTime": "22:00" },
    "sat": { "isOpen": true, "openTime": "09:00", "closeTime": "23:00" },
    "sun": { "isOpen": true, "openTime": "09:00", "closeTime": "23:00" }
  },
  "settings": {
    "features": {
      "loyaltyEnabled": false,
      "recipeEnabled": false,
      "multiOutletEnabled": false,
      "showHppToStaff": false
    },
    "receipt": {
      "footerText": "Terima kasih, sampai jumpa!",
      "showQrRating": false
    },
    "thresholds": {
      "shiftVarianceAlert": 10000
    }
  }
}
```

**Note:** Semua nilai ini sudah final dan di-confirm Owner per 2026-04-20. Tidak ada lagi `[TBD-OWNER]`. Owner tetap bisa ubah lewat UI settings setelah first login jika ada perubahan.

---

## Default Owner User Bootstrap

First owner user created from environment variables on initial seed:

```
SEED_OWNER_NAME=<full name>
SEED_OWNER_EMAIL=<email>
SEED_OWNER_PASSWORD=<strong password>
```

After first login, owner can create additional Manager and Staff users via UI.

---

## Seed Script Outline

**File: `src/db/seed.ts`**

```typescript
import { db } from './index';
import { outlets, users, categories, menuItems, modifiers, expenseCategories } from './schema';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';

async function seed() {
  console.log('🌱 Seeding Mahakan database...');

  // 1. Create default outlet
  const [outlet] = await db.insert(outlets).values({
    name: 'Mahakan Coffee & Space',
    operationalHours: { /* ... */ },
    settings: { /* ... */ },
  }).returning();

  // 2. Create default owner
  const passwordHash = await bcrypt.hash(process.env.SEED_OWNER_PASSWORD!, 12);
  const [owner] = await db.insert(users).values({
    outletId: outlet.id,
    name: process.env.SEED_OWNER_NAME!,
    email: process.env.SEED_OWNER_EMAIL!.toLowerCase(),
    passwordHash,
    role: 'owner',
    status: 'active',
  }).returning();

  // 3. Seed categories
  const categoryData = [
    { name: 'Ricebowl', displayOrder: 1 },
    { name: 'Bakmie', displayOrder: 2 },
    // ... all 11 categories
  ];
  const insertedCategories = await db.insert(categories).values(
    categoryData.map(c => ({ ...c, outletId: outlet.id, createdBy: owner.id }))
  ).returning();

  // 4. Seed menu items (45 items)
  // ... see menu_items_seed.ts file for full data

  // 5. Seed modifiers (4 rows)
  await db.insert(modifiers).values([
    {
      slug: 'sugar_level',
      label: 'Tingkat Gula',
      type: 'single_select',
      optionsJson: [
        { value: 'normal', label: 'Normal' },
        { value: 'less', label: 'Less Sugar' },
        { value: 'none', label: 'No Sugar' },
      ],
      price: 0,
      appliesToCategories: null,  // all drinks
    },
    { /* ice_level */ },
    { /* extra_shot, price: 8000 */ },
    { /* extra_topping_ayam, price: 10000 */ },
  ]);

  // 6. Seed expense categories
  await db.insert(expenseCategories).values([
    { outletId: outlet.id, name: 'Belanja Bahan Baku', displayOrder: 1 },
    // ... 8 regular + 1 system (Refund)
  ]);

  console.log('✅ Seed complete');
}

seed().catch(console.error);
```

---

## Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial seed data from menu photo |
