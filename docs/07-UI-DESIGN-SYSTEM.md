# 🎨 UI DESIGN SYSTEM — Mahakan Coffee & Space

**Design System & Component Guidelines**
**Version:** 1.0
**Depends on:** `01-PRD.md`, `02-FSD.md`
**Status:** ✅ APPROVED
**Framework:** Tailwind CSS v4, React 19, lucide-react icons

---

## 1. Design Philosophy

### 1.1 Core Principles

1. **Tablet-first for POS.** Landscape orientation, big touch targets, minimal scrolling. Assume staff might be holding tablet in one hand.
2. **Desktop-first for Admin.** Dense, data-rich layouts. Keyboard shortcuts welcomed.
3. **Cozy, warm, grounded.** Mahakan is "a homely space". Not aseptic SaaS gray. Not neon cyberpunk. Think: soft greens, warm off-whites, unhurried typography.
4. **Clarity > cleverness.** Bahasa Indonesia copy must be natural and direct. No jargon. If a barista can't understand a button label, it's wrong.
5. **Consistent before custom.** Reuse components. Don't invent variations unless essential.

### 1.2 What This System Is NOT

- ❌ A pixel-perfect Figma-to-code replica. The system is loose enough for AI coding assistants to make reasonable choices.
- ❌ An exhaustive Storybook catalog. Phase 1 scope; extend organically.
- ❌ A branding guideline. Focused on functional UI.

---

## 2. Brand Identity

### 2.0 Logo Assets

Logo Mahakan tersedia dalam 3 variant:

| File | Warna | Use Case |
|---|---|---|
| `Logo_Mahakan_Hijau.png` | Sage green `#539371` | Primary, untuk light background (default header, login screen, receipt) |
| `Logo_Mahakan_Hitam.png` | Charcoal `~#1F1F1F` | Alternatif monochrome, untuk print B&W atau dokumen formal |
| `Logo_Mahakan_Putih.png` | White `#FFFFFF` | Untuk dark background (splash screen, footer hero) |

**File location di repo:** `public/assets/logo/`

**Penggunaan di code:**

```tsx
// Header / primary
<Image src="/assets/logo/Logo_Mahakan_Hijau.png" alt="Mahakan Coffee" width={160} height={226} priority />

// Struk thermal (binarize ke hitam-putih)
// Saat cetak ESC/POS: convert ke 1-bit bitmap 200x283px → GS v 0 command
```

**Design story:** Logo punya 3 bagian — (1) **archway** di atas (representasi "space" yang welcoming), (2) **leaf/sprout** di tengah (growth, organic, natural), (3) **3 kaki kaligrafi** di bawah (grounded, roots, multiple streams). Overall feeling: homely, natural, cozy — ini yang harus tercermin di seluruh UI.

### 2.1 Colors

**Primary palette — Mahakan Sage Green (derived from logo `#539371`):**

| Token | Hex | HSL | Usage |
|---|---|---|---|
| `mahakan-green-50` | `#F2F6F4` | H148 S20% L96% | Page backgrounds, very subtle tints |
| `mahakan-green-100` | `#E2EDE7` | H148 S25% L91% | Hover on white surfaces, soft highlights |
| `mahakan-green-200` | `#C4DDD0` | H148 S28% L82% | Disabled primary, dividers with tint |
| `mahakan-green-300` | `#9DC7B1` | H148 S28% L70% | Decorative, illustrations |
| `mahakan-green-400` | `#6FAE8C` | H148 S28% L56% | Secondary accents |
| `mahakan-green-500` | `#529270` | H148 S28% L45% | **Brand mid tone** — backgrounds only |
| `mahakan-green-600` | `#539371` | H148 S28% L45% | **LOGO COLOR** — use for brand accents, big buttons with bold/large text only (contrast 3.64:1 on white) |
| `mahakan-green-700` | `#3D7557` | H148 S31% L35% | **ACTION COLOR** — primary buttons, links, interactive text (contrast 5.41:1 ✅ WCAG AA) |
| `mahakan-green-800` | `#2E5B43` | H148 S33% L27% | Hover on primary button, emphasized text (contrast 7.80:1 ✅) |
| `mahakan-green-900` | `#1F422F` | H148 S36% L19% | Darkest brand, headings (contrast 11.18:1 ✅ WCAG AAA) |
| `mahakan-green-950` | `#142E20` | H148 S38% L13% | Ultra dark, rarely used |

**⚠️ Accessibility Rule — IMPORTANT:**

Logo color `#539371` (green-600) has contrast 3.64:1 on white — BELOW WCAG AA (4.5:1 for normal text).

**Usage policy:**
- ✅ Use `green-600` (`#539371`) for: logo, brand accents, large decorative elements, buttons with text ≥ 18px bold
- ✅ Use `green-700` (`#3D7557`) for: primary CTAs, interactive text, icons, links — this is the "action color"
- ✅ Use `green-800` / `green-900` for: body text with brand color, headings
- ❌ Never use `green-600` for body text on white — always upgrade to `green-700`+

**Neutral palette — Warm:**

| Token | Hex | Usage |
|---|---|---|
| `neutral-50` | `#FAFAF7` | App background (warm off-white, matches Mahakan cozy vibe) |
| `neutral-100` | `#F2F1EC` | Card backgrounds, hover surfaces |
| `neutral-200` | `#E5E3DB` | Borders, dividers |
| `neutral-300` | `#CFCBBF` | Disabled borders |
| `neutral-500` | `#8A8578` | Muted text |
| `neutral-700` | `#514E45` | Secondary text |
| `neutral-900` | `#1F1D17` | Primary text |

**Semantic palette:**

| Token | Hex | Usage |
|---|---|---|
| `success-500` | `#16A34A` | Success toasts, paid status |
| `success-100` | `#DCFCE7` | Success background tint |
| `warning-500` | `#D97706` | Warning, variance flag |
| `warning-100` | `#FEF3C7` | Warning background |
| `danger-500` | `#DC2626` | Destructive, errors, void |
| `danger-100` | `#FEE2E2` | Danger background |
| `info-500` | `#2563EB` | Info, in-progress states |
| `info-100` | `#DBEAFE` | Info background |

**Status colors (POS specific):**

| Status | Background | Text/Border |
|---|---|---|
| Paid | `success-100` | `success-500` |
| Voided | `neutral-200` | `neutral-500` |
| Refunded | `warning-100` | `warning-500` |
| Sold Out (item) | `neutral-100` (grayscale) | `neutral-500` |
| Signature (♥) | `mahakan-green-100` | `mahakan-green-700` |
| Open Price | `info-100` | `info-500` |

### 2.2 Typography

**Font stack:**

- **Primary (UI):** `Inter` (system fallback: `-apple-system, system-ui, sans-serif`)
- **Display (headings, receipts):** `Inter` (bold weights)
- **Monospace (numbers, codes):** `JetBrains Mono` (fallback: `ui-monospace`)

Load via Next.js `next/font/google` for optimal performance.

**Type scale:**

| Token | Size / Line Height | Use |
|---|---|---|
| `text-xs` | 12px / 16px | Caption, metadata |
| `text-sm` | 14px / 20px | Secondary body |
| `text-base` | 16px / 24px | **Default body** |
| `text-lg` | 18px / 28px | Prominent body, section intros |
| `text-xl` | 20px / 28px | Small headings |
| `text-2xl` | 24px / 32px | Section headings |
| `text-3xl` | 30px / 36px | Page headings |
| `text-4xl` | 36px / 40px | POS total display, hero |
| `text-5xl` | 48px / 52px | Ultra-large (POS amount) |

**Font weight conventions:**

- `font-normal` (400) — body text
- `font-medium` (500) — buttons, emphasized inline text
- `font-semibold` (600) — section headings
- `font-bold` (700) — page headings, emphasized numbers

### 2.3 Spacing

Tailwind's default 4px-based scale. No customization needed.

Use consistent spacing for layouts:

- **Component internal padding:** `p-3` (12px) or `p-4` (16px)
- **Card padding:** `p-6` (24px) desktop, `p-4` mobile
- **Section gap:** `gap-6` (24px) between cards, `gap-4` between form fields
- **Page margins:** `px-6 md:px-8` for admin, `px-4` for POS

### 2.4 Border Radius

| Token | Use |
|---|---|
| `rounded-md` (6px) | Inputs, small buttons, badges |
| `rounded-lg` (8px) | Cards, modals, primary buttons |
| `rounded-xl` (12px) | Large cards, menu tiles, feature sections |
| `rounded-full` | Avatars, pill badges, toggle switches |

### 2.5 Shadow

| Token | Use |
|---|---|
| `shadow-sm` | Subtle card elevation |
| `shadow` | Default card |
| `shadow-md` | Modals, popovers |
| `shadow-lg` | Toasts, dropdowns |
| `shadow-xl` | Full-screen modals, dialogs |

Keep shadows soft and warm (default Tailwind shadows work). No neon glow.

### 2.6 Motion

**Duration:**

- **Instant:** `duration-75` (75ms) — dropdowns, tooltips
- **Fast:** `duration-150` (150ms) — hover states, button press
- **Default:** `duration-200` (200ms) — modal fade, accordion
- **Slow:** `duration-300` (300ms) — page transitions, success state animations

**Easing:**

- Default: `ease-out` (most UI)
- Exit: `ease-in` (closing modals)
- Bouncy (sparingly): `cubic-bezier(0.34, 1.56, 0.64, 1)` for delight moments (e.g., success checkmark)

**Reduced motion:**

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Respect user preferences.

---

## 3. Tailwind v4 Configuration

**File: `tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mahakan Sage Green — derived from logo #539371
        'mahakan-green': {
          50:  '#F2F6F4',
          100: '#E2EDE7',
          200: '#C4DDD0',
          300: '#9DC7B1',
          400: '#6FAE8C',
          500: '#529270',
          600: '#539371',  // LOGO color — brand accent, decorative only (3.64:1 on white)
          700: '#3D7557',  // ACTION color — buttons, links, text (5.41:1 ✅ AA)
          800: '#2E5B43',  // Hover on primary action (7.80:1 ✅)
          900: '#1F422F',  // Headings on brand (11.18:1 ✅ AAA)
          950: '#142E20',
        },
        neutral: {
          50: '#FAFAF7',
          100: '#F2F1EC',
          200: '#E5E3DB',
          300: '#CFCBBF',
          500: '#8A8578',
          700: '#514E45',
          900: '#1F1D17',
        },
        success: { 100: '#DCFCE7', 500: '#16A34A' },
        warning: { 100: '#FEF3C7', 500: '#D97706' },
        danger: { 100: '#FEE2E2', 500: '#DC2626' },
        info: { 100: '#DBEAFE', 500: '#2563EB' },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace'],
      },
    },
  },
} satisfies Config;
```

**File: `src/app/globals.css`** (Tailwind v4 pattern)

```css
@import 'tailwindcss';

@theme {
  --color-mahakan-green-600: #539371;  /* Logo color */
  --color-mahakan-green-700: #3D7557;  /* Action color — WCAG AA */
  /* ... or inline in Tailwind config */
}

:root {
  --radius-card: 12px;
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.04);
}

body {
  @apply bg-neutral-50 text-neutral-900 antialiased;
  font-family: var(--font-inter), system-ui, sans-serif;
}

/* Tap target minimum for touch devices */
@media (pointer: coarse) {
  button, a, [role="button"] {
    min-height: 44px;
  }
}
```

---

## 4. Component Library

Primitive components live in `src/components/ui/`. Use `clsx` + `tailwind-merge` via a `cn()` helper:

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### 4.1 Button

**Variants:** `primary`, `secondary`, `ghost`, `destructive`, `outline`
**Sizes:** `sm` (32px), `md` (40px), `lg` (48px), `xl` (60px for POS)

```typescript
// src/components/ui/Button.tsx
import { cn } from '@/lib/utils';
import { forwardRef, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, loading, disabled, children, ...rest }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mahakan-green-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

    const variants = {
      primary: 'bg-mahakan-green-700 text-white hover:bg-mahakan-green-800 active:bg-mahakan-green-900',
      secondary: 'bg-mahakan-green-100 text-mahakan-green-900 hover:bg-mahakan-green-200',
      ghost: 'text-neutral-700 hover:bg-neutral-100',
      destructive: 'bg-danger-500 text-white hover:bg-red-700',
      outline: 'border border-neutral-300 text-neutral-900 hover:bg-neutral-100',
    };

    const sizes = {
      sm: 'text-sm px-3 py-1.5 rounded-md',
      md: 'text-base px-4 py-2 rounded-md',
      lg: 'text-base px-5 py-2.5 rounded-lg',
      xl: 'text-lg px-6 py-4 rounded-lg min-h-[60px]',  // for POS main actions
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...rest}
      >
        {loading && <Spinner className="mr-2 size-4" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
```

**Usage patterns:**

- `primary` for main action per screen (e.g., "Bayar", "Simpan", "Tambah ke Order")
- `destructive` ONLY for delete/void/refund
- `outline` or `secondary` for secondary actions
- `ghost` for tertiary (close, cancel, navigation)
- `xl` size reserved for POS key actions (tablet touch)

### 4.2 Input

```typescript
// src/components/ui/Input.tsx
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
}
```

Layout: label (if provided) → input → hint/error text.

- Height: `h-10` default (40px), `h-12` for touch contexts
- Border: `border-neutral-300`, focus `border-mahakan-green-500`
- Error: `border-danger-500` + error text below
- Rupiah input variant: numeric keypad on mobile (`inputMode="numeric"`), auto-format display with thousand separators

### 4.3 Card

```typescript
// Basic card
<div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
  {children}
</div>
```

Variants:
- `card-interactive` (adds hover: `hover:shadow-md` + cursor-pointer)
- `card-flat` (no shadow, for nested)
- `card-emphasis` (bg tint, for featured content)

### 4.4 Modal / Dialog

- Use headless pattern (Radix UI-style) or build custom with `<dialog>` element
- Center on desktop, slide-up on mobile
- Backdrop: `bg-neutral-900/50 backdrop-blur-sm`
- Content: `bg-white rounded-xl shadow-xl max-w-md w-full p-6`
- Close: top-right `ghost` button with X icon
- Focus trap inside modal
- ESC to close (unless destructive with confirmation state)

### 4.5 Toast / Notification

Position: top-right (desktop), top-center (mobile). Stack max 3.

```typescript
toast.success('Struk tercetak', { duration: 2000 });
toast.error('Printer gagal terhubung', {
  duration: 5000,
  action: { label: 'Coba Lagi', onClick: () => retry() },
});
```

Library: `sonner` (lightweight, Next.js-compatible) or custom.

### 4.6 Badge

For status labels inline.

```typescript
<Badge variant="paid">Lunas</Badge>
<Badge variant="voided">Dibatalkan</Badge>
<Badge variant="sold-out">Habis</Badge>
<Badge variant="signature">♥ Signature</Badge>
```

Styles:
- Small, rounded-full, px-2.5 py-0.5, text-xs, font-medium
- Paid: `bg-success-100 text-success-500`
- Voided: `bg-neutral-200 text-neutral-500`
- Refunded: `bg-warning-100 text-warning-500`

### 4.7 Table (Admin)

Use `@tanstack/react-table` for functionality (sort, filter, paginate).

Visual:
- Header: `bg-neutral-100 text-neutral-700 font-medium text-sm`
- Row: hover `bg-neutral-50`, active row `bg-mahakan-green-50`
- Cell: `px-4 py-3`, first/last cell pad extra
- Row dividers: `divide-y divide-neutral-200`
- Sticky header on long lists

Empty state: centered illustration + message + CTA.

### 4.8 Form Field Group

Consistent label + input + hint/error pattern:

```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium text-neutral-900">
    {label}
    {required && <span className="text-danger-500 ml-0.5">*</span>}
  </label>
  <input ... />
  {error ? (
    <p className="text-sm text-danger-500">{error}</p>
  ) : hint ? (
    <p className="text-sm text-neutral-500">{hint}</p>
  ) : null}
</div>
```

### 4.9 Numeric Keypad (POS)

For PIN, pager, cash input. Big tap targets (80×80px min).

```
┌───┬───┬───┐
│ 1 │ 2 │ 3 │
├───┼───┼───┤
│ 4 │ 5 │ 6 │
├───┼───┼───┤
│ 7 │ 8 │ 9 │
├───┼───┼───┤
│ C │ 0 │ ⌫ │
└───┴───┴───┘
```

- Button: `h-20 w-20` or fit grid
- Active press state: scale down 0.95, bg change
- Haptic feedback where supported (`navigator.vibrate(10)`)

### 4.10 Menu Tile (POS)

Key component for POS. Grid layout, tappable.

```tsx
<button
  disabled={item.isSoldOut}
  className={cn(
    "flex flex-col p-3 bg-white rounded-xl border border-neutral-200 text-left transition",
    "active:scale-95 hover:shadow-md hover:border-mahakan-green-700",
    item.isSoldOut && "opacity-50 grayscale cursor-not-allowed"
  )}
>
  {item.isSignature && (
    <Badge variant="signature" className="self-start mb-1">♥ Signature</Badge>
  )}
  <span className="font-medium text-base text-neutral-900 line-clamp-2">{item.name}</span>
  <span className="mt-auto font-mono text-sm text-neutral-700">{priceLabel}</span>
  {item.isSoldOut && <Badge variant="sold-out" className="self-start mt-1">Habis</Badge>}
  {item.isOpenPrice && <Badge variant="open-price" className="self-start mt-1">Harga Manual</Badge>}
</button>
```

### 4.11 Cart Line Item

```tsx
<div className="flex gap-3 p-3 border-b border-neutral-200">
  <div className="flex-1 min-w-0">
    <p className="font-medium text-neutral-900 truncate">{item.name}</p>
    <p className="text-sm text-neutral-500">{item.variant} · {modifierSummary}</p>
    {item.note && <p className="text-sm text-neutral-500 italic">"{item.note}"</p>}
  </div>
  <div className="flex flex-col items-end gap-1">
    <QuantityStepper value={item.quantity} onChange={...} />
    <span className="font-mono text-sm text-neutral-900">Rp {formatAmount(item.subtotal)}</span>
  </div>
</div>
```

### 4.12 Chart

Use `recharts`. Brand colors:

- Bar/Line default color: `#3D7557` (mahakan-green-700 — good contrast for labels)
- Secondary: `#6FAE8C` (mahakan-green-400)
- Accent: `#539371` (mahakan-green-600, logo color — for highlights)
- Grid: `#E5E3DB` (neutral-200)
- Axis: `#514E45` (neutral-700)
- Tooltip: white bg, shadow, 12px padding

---

## 5. Layout Patterns

### 5.1 POS Layout (Tablet, Landscape)

```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR                                                     │
│ [Mahakan] [Shift Rina 08:00] [🟢 Online] [Draft:2] [Logout]│
├─────────────────────────────────────────┬───────────────────┤
│                                         │                   │
│  CATEGORY TABS (horizontal scroll)      │                   │
│  [Ricebowl] [Bakmie] [Coffee]...        │  ORDER AKTIF      │
│                                         │  Pager 5 · Take   │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐│  ─────────────── │
│  │Americ │ │Pablo  │ │Latte  │ │Vanlat ││  1x Americano    │
│  │ 16rb  │ │ 23rb  │ │ 20rb  │ │ 23rb  ││     Iced, Less   │
│  └───────┘ └───────┘ └───────┘ └───────┘│     Rp 16.000  ⋮ │
│                                         │                   │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐│  Subtotal 37.000  │
│  │Capp   │ │Matcha │ │Arian  │ │Chocola││  [Diskon]         │
│  │ 20rb  │ │Bear 24│ │Green  │ │te 20rb││  TOTAL  37.000    │
│  └───────┘ └───────┘ └───────┘ └───────┘│                   │
│                                         │  ┌───────────────┐│
│                                         │  │   BAYAR       ││
│                                         │  │   (Rp 37.000) ││
│                                         │  └───────────────┘│
└─────────────────────────────────────────┴───────────────────┘
```

**Grid ratio:** 70% menu area, 30% cart sidebar (desktop/tablet landscape). On portrait tablet/phone, cart becomes bottom drawer.

### 5.2 Admin Layout (Desktop)

```
┌─────────────────────────────────────────────────────────────┐
│ TOP BAR                                                     │
│ [Mahakan Logo] [Search] [🔔 Notif] [User: Owner] [Logout]  │
├─────────────┬───────────────────────────────────────────────┤
│             │                                               │
│ SIDEBAR     │  PAGE CONTENT                                 │
│             │                                               │
│ Dashboard   │  ┌─────────────────────────────────────────┐ │
│ ▼ Menu      │  │ Page Title                              │ │
│   Items     │  │ Description / breadcrumb                │ │
│   Cats      │  └─────────────────────────────────────────┘ │
│   Modifr    │                                               │
│ Staff       │  ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│ ▼ Reports   │  │  Stat Card │ │  Stat Card │ │ Stat Crd │ │
│   Sales     │  └────────────┘ └────────────┘ └──────────┘ │
│   Items     │                                               │
│   P&L       │  ┌─────────────────────────────────────────┐ │
│ Shifts      │  │                                         │ │
│ Expenses    │  │  Chart / Table                          │ │
│ Settings    │  │                                         │ │
│             │  └─────────────────────────────────────────┘ │
│             │                                               │
└─────────────┴───────────────────────────────────────────────┘
```

Sidebar: collapsible, 240px wide. Active item: `bg-mahakan-green-100 text-mahakan-green-800`. Nested groups expand on click.

### 5.3 Responsive Breakpoints

Tailwind defaults are fine:

- `sm: 640px` — phones landscape, small tablets
- `md: 768px` — tablets portrait
- `lg: 1024px` — tablets landscape, small laptops
- `xl: 1280px` — desktops
- `2xl: 1536px` — large monitors

**POS target:** `lg+` (tablet landscape 1024+)
**Admin target:** `xl+` (laptops 1280+); usable down to `md`

---

## 6. Accessibility

### 6.1 Contrast

- Text on light bg: minimum 4.5:1 (WCAG AA)
- Large text (≥18px): minimum 3:1
- Interactive elements: 3:1 contrast for borders
- Verify with tools like Contrast Finder or Stark plugin

### 6.2 Keyboard Navigation

- All interactive elements focusable with Tab
- Focus visible: 2px outline, `mahakan-green-700` color, 2px offset
- Skip links for admin nav ("Skip to main content")
- Modals trap focus internally
- ESC closes modals (non-destructive)
- Forms: Enter submits, Tab/Shift+Tab navigates fields

### 6.3 Screen Reader

- Semantic HTML: `<button>`, `<nav>`, `<main>`, `<article>`
- `aria-label` for icon-only buttons ("Hapus item", not just 🗑️)
- `role="alert"` for error messages, toasts
- `aria-live="polite"` for dynamic updates (cart total)
- Form labels always associated with `<label htmlFor>` or `aria-labelledby`

### 6.4 Touch Targets

- Minimum 44×44px for touch (iOS HIG / Material)
- 60×60px recommended for POS primary actions
- Spacing between targets: minimum 8px

### 6.5 Language

- `<html lang="id">` (Bahasa Indonesia primary)
- Date formats: DD/MM/YYYY (Indonesian convention)
- Number formatting: `1.250.000` (period as thousand separator)

---

## 7. POS-Specific Guidelines

### 7.1 The 3-Second Rule

From tap to feedback < 3 seconds for common actions. If longer, show progress.

### 7.2 One-Handed Operation

Staff may hold tablet in one hand. Primary actions on thumb-reachable zones:

- Landscape: bottom-right area for RTL flow (receipt print, payment)
- Portrait: bottom half for primary actions

### 7.3 Glove-Friendly

Barista might have slightly damp/coffee-stained hands. Large tap targets, wide input fields, forgiving tap zones.

### 7.4 Glare & Visibility

Tablet in café may face window glare. Use:

- High contrast text
- Avoid pale grays for critical info
- Bold amounts (font-bold)

### 7.5 Error Recovery

Never strand staff mid-transaction. Every error has a clear next step:

- Printer fail → "Coba Lagi" button
- Offline → automatic queue + banner
- Server error → retry with exponential backoff

---

## 8. Admin-Specific Guidelines

### 8.1 Data Density

Owner/Manager review lots of data. Tables > cards for lists > 5 items.

### 8.2 Scannable Tables

- Column alignment: text left, numbers right (font-mono for amounts), dates center
- Totals row: bold, top border
- Sticky header for long tables

### 8.3 Quick Filters

Most list pages: inline filters for date range + status + search. Persisted in URL query params for shareability.

### 8.4 Keyboard Shortcuts

- `Cmd/Ctrl+K` → command palette / quick search
- `N` → new (context-dependent)
- `E` → edit selected
- `/` → focus search
- `Esc` → close / cancel

Show shortcut hints in tooltips.

---

## 9. Empty States

Every list, table, or feature that can be empty gets a proper empty state.

**Pattern:**

```tsx
<div className="text-center py-12">
  <Icon className="size-12 mx-auto text-neutral-300" />
  <h3 className="mt-4 text-lg font-semibold text-neutral-900">Belum ada pengeluaran</h3>
  <p className="mt-1 text-sm text-neutral-500">Catat pengeluaran harian untuk lacak arus kas kafe</p>
  <Button className="mt-4">Tambah Pengeluaran</Button>
</div>
```

Always provide: icon + title + description + primary CTA.

---

## 10. Loading States

### 10.1 Inline

- Spinner (16px, mahakan-green-600) next to button text on submit
- Disabled button during loading

### 10.2 Skeleton

For data fetching: skeleton shimmer shapes matching the final layout.

```tsx
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-neutral-200 rounded w-3/4"></div>
  <div className="h-4 bg-neutral-200 rounded w-1/2"></div>
</div>
```

### 10.3 Full-page

Route transitions: Next.js `loading.tsx` with skeleton layout.

---

## 11. Receipt Design (Printed)

Not pure UI but related. See `03-TSD.md` section 8.1 for ESC/POS layout.

Key rules for on-screen receipt preview (before print):

- Monospaced font (JetBrains Mono)
- 32-char wide container
- Dividers with `-----` pattern
- Align: totals right, labels left

---

## 12. Icons

Library: `lucide-react` (consistent, open source, React-first).

Common icons:

| Context | Icon |
|---|---|
| Add | `<Plus />` |
| Remove | `<Minus />` |
| Delete | `<Trash2 />` |
| Edit | `<Pencil />` |
| Search | `<Search />` |
| Filter | `<Filter />` |
| Sort | `<ArrowUpDown />` |
| Close | `<X />` |
| Back | `<ChevronLeft />` |
| Forward | `<ChevronRight />` |
| Menu | `<Menu />` |
| Settings | `<Settings />` |
| User | `<User />` |
| Cash | `<Banknote />` |
| QRIS | `<QrCode />` |
| Card | `<CreditCard />` |
| Printer | `<Printer />` |
| Receipt | `<ReceiptText />` |
| Success | `<CheckCircle2 />` |
| Warning | `<AlertTriangle />` |
| Error | `<CircleX />` |
| Info | `<Info />` |
| Offline | `<WifiOff />` |
| Online | `<Wifi />` |
| Signature ♥ | `<Heart />` |

Sizes: `size-4` (16px) inline, `size-5` (20px) default, `size-6` (24px) prominent, `size-8+` for empty states.

---

## 13. POS Screen Inventory

Pages and their key components:

| Screen | Primary Components |
|---|---|
| `/pos/login` | Staff avatar grid, PIN pad, error shake |
| `/pos` (dashboard) | Shift status card, "Order Baru" button, active orders list, draft orders |
| `/pos/order/new` | Menu grid, cart sidebar, category tabs, modifier modal |
| `/pos/payment` | Order summary, payment method buttons (xl size), cash input, success screen |
| `/pos/history` | Transaction list (today), filters, detail drawer |
| `/pos/history/:id` | Transaction detail, void/refund buttons |
| `/pos/shift/close` | Shift summary, actual cash input, variance display |
| `/pos/my-shifts` | Shift history list (staff's own) |

## 14. Admin Screen Inventory

| Screen | Primary Components |
|---|---|
| `/login` | Email/password form |
| `/dashboard` | Stat cards, recent trx, charts |
| `/menu/items` | Data table, filters, bulk actions |
| `/menu/items/new` & `/:id/edit` | Form with price type discriminator |
| `/menu/categories` | Drag-reorder list |
| `/menu/modifiers` | Config cards with price inputs |
| `/users` | Data table |
| `/users/new` & `/:id/edit` | Form, role selector, PIN reset |
| `/expenses` | Data table, quick filter, detail drawer |
| `/expenses/new` | Form with category dropdown, image upload |
| `/incomes` | Similar to expenses |
| `/shifts` | Data table with variance flags |
| `/shifts/:id` | Detail with all transactions list |
| `/reports/sales` | Date picker, metric cards, charts |
| `/reports/items` | Sortable table |
| `/reports/pnl` | Formatted P&L layout (owner only) |
| `/reports/daily-cash` | Breakdown by source |
| `/settings/business` | Form (name, address, logo upload) |
| `/settings/printer` | Pairing status, test print |
| `/settings/operational-hours` | Per-day time pickers |

---

## 15. Design Tokens Reference (Copy-Paste)

For AI coding assistants, quick reference:

```typescript
// Colors (Tailwind classes)
primary:      'bg-mahakan-green-700 text-white'    // ACTION — buttons, CTAs
primary-hover:'hover:bg-mahakan-green-800'
brand-logo:   'bg-mahakan-green-600 text-white'    // LOGO color — large decorative only
secondary:    'bg-mahakan-green-100 text-mahakan-green-900'
bg-app:       'bg-neutral-50'
bg-card:      'bg-white'
border-default:'border-neutral-200'
text-primary: 'text-neutral-900'
text-secondary:'text-neutral-700'
text-muted:   'text-neutral-500'
text-brand:   'text-mahakan-green-700'   // for brand-colored text — WCAG AA ✅

// Spacing
card-pad:     'p-6'
section-gap:  'gap-6'
field-gap:    'space-y-4'

// Radius
card:         'rounded-xl'
input:        'rounded-md'
button:       'rounded-md'

// Shadow
card-shadow:  'shadow-sm'
modal-shadow: 'shadow-xl'

// Typography
heading-1:    'text-3xl font-bold text-neutral-900'
heading-2:    'text-2xl font-semibold text-neutral-900'
heading-3:    'text-xl font-semibold text-neutral-900'
body:         'text-base text-neutral-900'
body-sm:      'text-sm text-neutral-700'
caption:      'text-xs text-neutral-500'
amount:       'font-mono font-semibold'
```

---

## 16. Do's and Don'ts

### ✅ DO

- Use Tailwind utility classes directly for most styling
- Extract components only when used 3+ times
- Prefer composition over props explosion
- Use semantic HTML (`<button>`, `<form>`, `<nav>`)
- Test on actual tablet before declaring POS feature done
- Respect reduced motion preference
- Keep copy short and natural in Indonesian

### ❌ DON'T

- Invent new color values outside the palette
- Use `!important` in CSS
- Nest components deeper than 3 levels for simple UI
- Use `div` where a button belongs (accessibility!)
- Add animation for the sake of animation
- Use English UI copy (except technical jargon with no Indonesian equivalent)
- Add icons that aren't in lucide-react
- Create bespoke modals — use the shared Modal component

---

## 17. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-04-20 | Initial design system |
