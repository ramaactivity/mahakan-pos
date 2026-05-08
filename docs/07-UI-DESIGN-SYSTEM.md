# 🎨 UI DESIGN SYSTEM — Mahakan Coffee & Space

**Design System & Component Guidelines**
**Version:** 1.2 (sesi AD-2 — impeccable + ui-ux-pro-max alignment)
**Depends on:** `01-PRD.md`, `02-FSD.md`
**Status:** ✅ APPROVED
**Framework:** Tailwind CSS v4, React 19, lucide-react icons

**Reference skills installed at `~/.claude/skills/`** — these inform every UI decision:

| Skill | Purpose | Path |
|---|---|---|
| `impeccable` | 7-domain design references + 23 commands + 27 deterministic anti-patterns | `~/.claude/skills/impeccable/` ([source](https://github.com/pbakaus/impeccable)) |
| `ui-ux-pro-max` | 161 product types, 99 UX guidelines, 50+ styles, priority rule categories | `~/.claude/skills/ui-ux-pro-max/` ([source](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)) |
| `ui-ux-design`, `ui-ux-styling`, `ui-ux-brand`, `ui-ux-banner-design` | Sub-skills for design exec + brand register | (symlinked from above repo) |
| `ui-skills` | Design Engineer skill catalog ([ui-skills.com](http://ui-skills.com)) | `~/.claude/skills/ui-skills/` |
| `aso-skills` | App Store Optimization (mobile marketing) — **not relevant for web POS UI**, kept for future loyalty/marketing app | `~/.claude/skills/aso-skills/` |

When designing a new surface, invoke `/impeccable shape` then `/impeccable craft`. For audit, `/impeccable audit` runs deterministic anti-pattern checks.

---

## 1. Design Philosophy

### 1.1 Core Principles

1. **Tablet-first for POS.** Landscape orientation, big touch targets, minimal scrolling. Assume staff might be holding tablet in one hand.
2. **Desktop-first for Admin.** Dense, data-rich layouts. Keyboard shortcuts welcomed.
3. **Cozy, warm, grounded.** Mahakan is "a homely space". Not aseptic SaaS gray. Not neon cyberpunk. Think: soft greens, warm off-whites, unhurried typography.
4. **Clarity > cleverness.** Bahasa Indonesia copy must be natural and direct. No jargon. If a barista can't understand a button label, it's wrong.
5. **Consistent before custom.** Reuse components. Don't invent variations unless essential.
6. **Match implementation to vision.** Maximalism needs elaborate code, minimalism needs precision. Don't reflexively reach for the "Restrained" palette on a brand surface or "Drenched" on a data dashboard. Pick the register first ([impeccable](https://github.com/pbakaus/impeccable) calls these *brand* vs *product*; Mahakan is **product** by default — design SERVES the workflow). Brand surfaces (landing, marketing pages) can elevate to *brand* register.
7. **Vary, don't converge.** Mahakan's UI shouldn't look like every other AI-generated SaaS template. Hue, font, spacing rhythm, motion curves — make project-specific choices.

### 1.2 What This System Is NOT

- ❌ A pixel-perfect Figma-to-code replica. The system is loose enough for AI coding assistants to make reasonable choices.
- ❌ An exhaustive Storybook catalog. Phase 1 scope; extend organically.
- ❌ A branding guideline. Focused on functional UI.

### 1.3 Anti-pattern Blacklist (impeccable hard bans)

**Match-and-refuse.** If you're about to write any of these, rewrite the element with different structure. Audit (`/impeccable audit`) flags these deterministically.

| Anti-pattern | What it is | Replace with |
|---|---|---|
| **Side-stripe borders** | `border-l-2/4` colored accent on cards/lists/alerts | Full borders, background tints, leading numbers/icons, or nothing |
| **Gradient text** | `bg-gradient-to-r ... bg-clip-text text-transparent` | Single solid color. Emphasis via weight or size |
| **Glassmorphism as default** | Decorative `backdrop-blur-*` everywhere | Reserve for floated overlays only (modal backdrop, dropdown). Never on resting cards |
| **Hero-metric template** | Big number + tiny uppercase label + supporting stats SaaS cliché | Information density via integration, not isolated tiles |
| **Identical card grids** | Same-sized cards `icon + heading + text` repeated in `grid-cols-3/4` | Vary card sizes, group by purpose, use a list when uniformity matters |
| **Modal as first thought** | Modal for simple inline action (single field edit, toggle) | Inline edit, popover, or progressive disclosure first; modal last |
| **`transition-all`** | Animates every property including layout (width/height/padding) — causes layout thrashing | `transition-colors`, `transition-shadow`, or `transition` (Tailwind shorthand for safe subset) |
| **Pure black or white** | `text-black`, `bg-black`, `#000`, `#fff`, `#ffffff` | `text-neutral-900`, `bg-white` (which we tint subtly via theme), or `bg-neutral-50` |
| **Raw hex in components** | `style={{ color: "#3D7557" }}` or `bg-[#3D7557]` | Use Tailwind utility from theme (`bg-mahakan-green-700`) so theme changes propagate |
| **Cards nested in cards** | `<Card>` inside `<Card>` | Use spacing + dividers + typography for hierarchy within a card |
| **Wrapping non-content in `max-w-*`** | Containers around already-constrained content | Only wrap free-flowing text/forms; let admin tables span their parent |

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

**Neutral palette — Warm (tinted, no pure gray):**

Per impeccable's rule: pure gray (`oklch(50% 0 0)`) feels lifeless next to a colored brand. Mahakan's neutrals all carry a faint warm tint (chroma ~0.005-0.01, hued toward the sage green). Subconscious cohesion between brand color and UI surfaces.

| Token | Hex | Contrast on `bg-neutral-50` | Usage |
|---|---|---|---|
| `neutral-50` | `#FAFAF7` | — | App background (warm off-white) |
| `neutral-100` | `#F2F1EC` | — | Card backgrounds, hover surfaces |
| `neutral-200` | `#E5E3DB` | 1.18:1 | Borders, dividers |
| `neutral-300` | `#CFCBBF` | 1.62:1 | Disabled borders, very-light decoration |
| `neutral-400` | `#A8A396` | 2.62:1 | Placeholder text only (intentional sub-AA) |
| `neutral-500` | `#8A8578` | **3.58:1** | ❌ NOT body text. ✅ Uppercase tracking labels, inactive tab labels at rest, decorative dividers (passes 3:1 large-text bar) |
| `neutral-600` | `#6D685C` | **4.87:1 ✅** | **Default secondary text** — list metadata, helper text, captions ≥12px |
| `neutral-700` | `#514E45` | 7.92:1 ✅ | Body text (primary, 14-16px) |
| `neutral-800` | `#34322D` | 12.05:1 ✅ | Emphasized body, secondary headings |
| `neutral-900` | `#1F1D17` | 16.21:1 ✅ AAA | Primary headings, max emphasis |

**⚠️ Accessibility — `neutral-500` is below WCAG AA for body text.**
- ❌ `<p className="text-xs text-neutral-500">{metadata}</p>` — 3.58:1 fails 4.5:1 normal text bar
- ✅ `<p className="text-xs text-neutral-600">{metadata}</p>` — 4.87:1 passes
- ✅ `<span className="text-xs uppercase tracking-wider text-neutral-500">{LABEL}</span>` — uppercase tracking-wider qualifies as decorative emphasis, 3.58:1 acceptable here per WCAG large-text rules
- ✅ `<button className="...text-neutral-500 hover:text-neutral-900">` — inactive tab states, hover lifts to compliant; 3.58:1 at rest is acceptable for non-essential UI text

**Migration note (sesi AD-2):** several `text-xs text-neutral-500` body text instances were upgraded to `-600` in PayrollSection, PurchaseRequestsSection, AuditLogSection. Repeat the pattern in new code.

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

**Easing (per impeccable):**

- Default: `ease-out` (exponential ease — UI feels lighter)
- Exit: `ease-in` (closing modals)
- ❌ **No bounce, no elastic.** Use exponential ease-out (`ease-out-quart`/`quint`/`expo`). Bouncy springs feel cheap on a POS surface.

**Property selection — never `transition-all`:**

`transition-all` animates EVERY property change including `width`, `height`, `padding`, `margin` — causes layout thrashing per frame. Pick specific properties:

| Tailwind class | Properties animated | Use case |
|---|---|---|
| `transition-colors` | color, bg, border, text-decoration, fill, stroke | Tab/chip toggle, hover state |
| `transition-shadow` | box-shadow | Card lift on hover |
| `transition-opacity` | opacity | Fade in/out |
| `transition-transform` | transform (translate, scale, rotate) | Press feedback `active:scale-95` |
| `transition` (Tailwind shorthand) | all of the above (NOT layout) | Multi-property safe default |
| ❌ `transition-all` | EVERYTHING incl. layout | Banned — causes layout recalc per frame |

**Reduced motion:**

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Already in `globals.css`. Respect user preferences automatically.

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
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  size?: "md" | "lg";  // md = 40px, lg = 48px (touch / POS payment)
}
```

Layout: label (if provided) → input → hint/error text.

- Height: `size="md"` (default, 40px), `size="lg"` (48px, POS payment / cash entry contexts)
- Border: `border-neutral-300`, focus `border-mahakan-green-500`
- Error: `border-danger-500` + error text below
- Rupiah input variant: numeric keypad on mobile (`inputMode="numeric"`), auto-format display with thousand separators

`<QuantityStepper>` exposes the same `size="md" | "lg"` API — `lg` (44px button + 44px value cell) is the POS cart default.

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

Custom primitive at [src/components/ui/Modal.tsx](../src/components/ui/Modal.tsx) — focus trap, body-scroll lock, sticky header/footer, backdrop click defaults to no-op (form-data safety on tablet POS).

**Sizing variants (`size` prop):**

| Size | Max width | Use case |
|---|---|---|
| `sm` | `max-w-sm` | Compact confirms, alerts |
| `md` | `max-w-md` (default) | Most form modals |
| `lg`–`3xl` | `max-w-lg` … `max-w-4xl` | Multi-section forms |
| `full` | `min(95vw, 80rem)` | Wide layouts (e.g. fixed-asset matrix) |
| `fullscreen` | Desktop centered `min(95vw, 72rem)`, **tablet edge-to-edge 100×100** | POS PaymentModal |

The `fullscreen` variant flips behavior on `(pointer: coarse)`:
- Desktop: centered modal with `max-h-[92vh]`, rounded corners
- Tablet (touch): full viewport (100vw × 100vh), no rounded corners, no margin

When using `fullscreen`, the body delegates scroll to its children (set `bodyPadding="none"` and use a 2-column grid with internal `overflow-y-auto`/`touch:overflow-hidden` per column). See [PaymentModal](../src/features/pos/components/PaymentModal.tsx) for reference.

- Backdrop: `bg-neutral-900/50 backdrop-blur-sm`
- Close: top-right ghost button with X icon
- ESC to close (unless `disableEscClose=true` or modal is mid-submit)

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

### 4.7 Table (Admin) — `<ResponsiveTable>`

Primitive at [src/components/ui/ResponsiveTable.tsx](../src/components/ui/ResponsiveTable.tsx) renders pair-of-views from one column config:

- **Desktop (`pointer:fine`):** native `<table>` with header row, hover state, optional `<tfoot>` summary
- **Tablet (`pointer:coarse`):** vertical stack of cards. The `primary` column promotes to the card header; other visible columns render as label/value pairs in a 2-col `<dl>`. No horizontal scroll on Galaxy A7 Lite (1340×800), even at 9 columns.

Both views call the same `column.render(row)` so per-column formatting (badges, money, dates) stays consistent.

```tsx
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui";

const columns: ResponsiveColumn<Employee>[] = [
  { key: "name", label: "Karyawan", primary: true, render: (e) => e.name },
  { key: "role", label: "Role", render: (e) => <Badge>{e.role}</Badge> },
  { key: "salary", label: "Gaji", align: "right", mono: true,
    render: (e) => formatRupiah(e.salary) },
  { key: "notes", label: "Notes", desktopOnly: true, render: (e) => e.notes },
];

<ResponsiveTable<Employee>
  rows={employees}
  rowKey={(e) => e.id}
  columns={columns}
  emptyState={<EmptyCard title="Belum ada karyawan" />}
  rowActions={(e) => <Button onClick={() => edit(e)}>Edit</Button>}
  footer={<div className="flex justify-between"><span>Total</span><span>{formatRupiah(total)}</span></div>}
/>
```

**Column flags:**
- `primary` — pin to card title row (use for the row's primary identifier)
- `desktopOnly` — hide on tablet card layout (long notes, redundant detail)
- `mono` — render value monospace (price, codes)
- `align: "left" | "right" | "center"`
- `width: "w-32"` — desktop column width hint

**Footer:** pass plain content (`<div>Total: …</div>`), NOT `<tr>`/`<td>`. ResponsiveTable wraps it with `<tfoot><tr><td colSpan={N}>` on desktop and a card-style `<div>` on tablet.

**Sortable headers:** existing `SortableHeader` + `useColumnSort` (sessionStorage-persisted) — pair manually if needed by setting column `label` to a `<SortableHeader />` element. Migration of sort-aware tables (HR, transactions) is a follow-up sesi.

Empty state: pass `<EmptyCard ... />` via `emptyState` prop.

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

Tailwind defaults stay in place:

- `sm: 640px` — phones landscape, small tablets
- `md: 768px` — tablets portrait
- `lg: 1024px` — tablets landscape, small laptops
- `xl: 1280px` — desktops
- `2xl: 1536px` — large monitors

Plus tablet-aware extensions added in sesi AD (`globals.css` `@theme` + `@custom-variant`):

| Variant | Media query | Use case |
|---|---|---|
| `touch:` | `@media (pointer: coarse)` | Any touch device — POS tablet, kiosk, mobile. Use for compact sizes, kiosk-only behavior, edge-to-edge modals. |
| `pointer:` | `@media (pointer: fine)` | Desktop with mouse / trackpad. Use for hover-based affordances. |
| `tablet-landscape:` | `@media (pointer: coarse) and (orientation: landscape)` | Galaxy A7 Lite operational mode (1340×800). Use for tablet-only column counts, side-panel widths. |

**POS primary device:** Samsung Galaxy A7 Lite — 8.7", 1340×800 landscape, DPR ~1.0, touch input.
**POS target:** `touch:` + `tablet-landscape:` variants govern layout; `lg+` width is incidental.
**Admin target:** `xl+` (desktops 1280+); responsive down to `md` via `ResponsiveTable` (collapses tables to vertical cards on touch).

#### Why width alone is not enough

A 1340px desktop is `xl` by Tailwind defaults — same as a Galaxy A7 Lite landscape. They need different layouts. Pair width with `pointer:`/`touch:` variants to differentiate:

```tsx
// Wrong: kicks in for a 1340px laptop too
<div className="xl:grid-cols-7">

// Right: only on touch devices in landscape
<div className="lg:grid-cols-5 tablet-landscape:grid-cols-5">
```

#### Page-level hardening (globals.css)

```css
html, body {
  overflow-x: clip;             /* page-level horizontal scroll always a bug */
  overscroll-behavior: contain; /* kill rubber-band wobble on left/right swipe */
}

[data-pos-kiosk],
[data-pos-kiosk] * {
  touch-action: manipulation;   /* no double-tap zoom, snappier taps */
  -webkit-tap-highlight-color: transparent;
}
```

Apply `data-pos-kiosk` to the POS shell wrapper and (optionally) auth pages.

#### Pinch zoom

Disabled globally via `viewport` export in `src/app/layout.tsx` (`maximumScale: 1, userScalable: false`). Trade-off: WCAG 1.4.4 violation (zoom up to 200% normally required). Justified for POS kiosk because:
- Touch targets are explicitly ≥44px (`@media (pointer: coarse)` rule sets `min-height: 44px` on buttons/links)
- POS is a fixed-purpose surface, not a content reader
- Accidental zoom previously broke payment flow during ops

If A7 Lite is ever used outside the kiosk role (e.g. management browsing reports), revisit this decision.

---

## 6. Accessibility

### 6.1 Contrast

- Text on light bg: minimum 4.5:1 (WCAG AA)
- Large text (≥18px or ≥14px bold): minimum 3:1
- Interactive elements: 3:1 contrast for borders
- Verify with tools like [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) or Chrome DevTools → Rendering → Emulate vision deficiencies

**Pre-computed for Mahakan tokens** (see §2.1 neutral palette table for full ratios):
- `text-neutral-900` on `bg-neutral-50` = 16.21:1 ✅ AAA
- `text-neutral-700` on `bg-neutral-50` = 7.92:1 ✅ AA body
- `text-neutral-600` on `bg-neutral-50` = 4.87:1 ✅ AA body — **default for secondary text/metadata**
- `text-neutral-500` on `bg-neutral-50` = 3.58:1 — large text only (uppercase labels, decorative)
- `text-neutral-400` on `bg-neutral-50` = 2.62:1 — placeholder only (intentional sub-AA)
- `text-mahakan-green-700` on `bg-white` = 5.41:1 ✅ AA — primary CTAs
- `text-mahakan-green-600` (LOGO) on white = 3.64:1 — large/bold text only (NOT body)

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

- Minimum 44×44px for touch (iOS HIG / Material / WCAG 2.5.5)
- 60×60px recommended for POS primary actions
- Spacing between targets: minimum 8px

**Component-level guarantees:**
- `<Button size="sm">`: 32px on desktop, **bumped to 44px on `(pointer: coarse)`** via `touch:h-11` (sesi AD-2 fix). Row-action icons in admin tables now hit floor on Galaxy A7 Lite.
- `<Button size="md/lg/xl">`: 40/48/60px — already compliant.
- Global rule via globals.css: `@media (pointer: coarse) { button, a, [role="button"] { min-height: 44px } }` enforces baseline even for ad-hoc buttons.

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
| 1.3 | 2026-05-08 | **Sesi AD-3:** Performance — TanStack Query infrastructure (already in package.json, never used until now). 7 admin sections converted from useEffect→setLoading→fetch pattern to useQuery (Staff, Employees, AuditLog, PurchaseRequests, Payroll, FixedAssets, Ingredients). Added §19 Data Fetching Pattern with migration playbook. localStorage cache layer (cache-store.ts) for static reference data (cleared on logout). 300ms search debounce via useDebouncedValue hook. |
| 1.2 | 2026-05-08 | **Sesi AD-2:** Aligned with `impeccable` + `ui-ux-pro-max` skills. Added §1.3 anti-pattern blacklist. Updated §2.1 neutrals with WCAG ratios per token. Updated §2.6 motion with `transition-all` ban + property-specific guidance. Updated §6.1 contrast with pre-computed Mahakan ratios. Updated §6.4 Button.sm `touch:h-11` for WCAG 2.5.5. Skill installs documented in header. |
| 1.1 | 2026-05-08 | **Sesi AD-1:** Tablet-aware breakpoints (`touch:`/`pointer:`/`tablet-landscape:`), Modal `fullscreen` variant, ResponsiveTable primitive, viewport hardening (overflow-x clip, overscroll-behavior contain, pinch-zoom disable). |
| 1.0 | 2026-04-20 | Initial design system |

---

## 18. Audit Backlog (sesi AD-2 findings)

Anti-pattern audit per `impeccable` rules ran 2026-05-08 (sesi AD-2). Codebase generally clean — most CRITICAL/HIGH already fixed. Remaining items deferred (low impact, no blocker).

### Already shipped (sesi AD-2)
- ✅ `<Button size="sm">` touch:h-11 for WCAG 2.5.5 (Button.tsx)
- ✅ `text-neutral-500` → `-600` body text in PayrollSection, PurchaseRequestsSection, AuditLogSection
- ✅ `transition-all` → `transition-colors` in EmployeesSection (filter chips), CategoryTabs, ItemModifierModal, AttendanceSection

### Backlog — low priority polish
- 🟢 **`transition-all` cleanup** — ~15 remaining instances in form modals (IncomeFormModal, ExpenseFormModal, MenuItemFormModal, UserFormModal, SplitPaymentModal, DiscountModal, PromoPickerModal, MenuListRow, MenuTile, HistoryPanel, PosLeftNav). Replace with `transition-colors` or `transition-shadow` per actual animated property. Bundle into next polish sesi.
- 🟢 **`text-neutral-500` audit pass 2** — 12+ remaining instances in admin sections. Spot-check each for body-text vs label semantics; upgrade body-text instances to `-600`.
- 🟢 **`backdrop-blur` decoration** — 1 instance in landing page (`page.tsx:78`) on resting card. Either keep as intentional landing-only decoration, or simplify to solid `bg-white`.
- 🟢 **Empty state standardization** — DashboardHome.tsx:306 uses generic `<p>` empty state instead of `<EmptyCard>` primitive. Migrate when revisiting dashboard.
- 🟢 **`max-w-prose` constraints** — long body paragraphs in dashboard cards lack max-width. Add `max-w-prose` or `max-w-2xl` for readable line lengths (65-75ch).
- 🟢 **OKLCH migration** — current palette uses hex. Per impeccable, OKLCH is perceptually uniform. Future rev: migrate `globals.css` to OKLCH `@theme` (`--color-mahakan-green-700: oklch(...)`). No functional change but more deterministic palette generation.

### Out of scope (separate sesi)
- Mobile portrait optimization (800×1340) for ad-hoc tablet rotation
- Dark mode (separate roadmap, large scope)
- Animation polish / delight micro-interactions (separate sesi UX-feel)
- Inline edit refactor (replace simple-action modals with inline editing) — UX research first

---

## 19. Data Fetching Pattern (sesi AD-3)

Sebelum sesi AD-3, every admin section pakai pattern naive: `useEffect` → `setLoading(true)` → `await listX()` → `setLoading(false)`. Akibatnya: pindah Karyawan → Akuntansi → Karyawan = full re-fetch tiap kali (component remount, state hilang). Skeleton spinner muncul setiap masuk halaman. Owner+staff lapor "loading lama".

Solusinya: TanStack Query (`@tanstack/react-query` ^5.100.1, sudah ke-install dari awal) wraps every fetch with memory cache + staleTime + automatic dedup. Combo dengan localStorage cache layer untuk static reference data yang survive page reload.

### 19.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Component A: useQuery(["employees"])                   │
│  Component B: useQuery(["employees"]) ← dedup, same key │
└────────────────────┬────────────────────────────────────┘
                     │
            ┌────────▼─────────┐
            │  TanStack Query  │  ← in-memory cache
            │  staleTime: 5min │     gcTime: 30min
            │  Provider per layout (admin / pos)
            └────────┬─────────┘
                     │ stale → background refetch
            ┌────────▼─────────┐
            │  Server Action   │  ← e.g. listEmployees()
            │  Drizzle / Neon  │
            └──────────────────┘

Static reference data (suppliers, COA, categories):
            ┌──────────────────────────┐
            │ cache-store.ts           │  ← localStorage layer
            │ TTL 24h, cleared on logout│
            └──────────────────────────┘
```

### 19.2 Files added (sesi AD-3)

| File | Purpose |
|---|---|
| [src/lib/query-client.ts](../src/lib/query-client.ts) | `createQueryClient()` factory with Mahakan-tuned defaults (5min stale, 30min gc, no refetch-on-focus) |
| [src/features/_shared/QueryProvider.tsx](../src/features/_shared/QueryProvider.tsx) | Client component wrapper around `QueryClientProvider` |
| [src/lib/cache-store.ts](../src/lib/cache-store.ts) | `setCache/getCache/clearCache` localStorage helpers + `CACHE_KEYS` constants |
| [src/lib/use-debounced-value.ts](../src/lib/use-debounced-value.ts) | `useDebouncedValue<T>(value, delayMs)` for search inputs |

Wired in admin layout ([src/app/(admin)/layout.tsx](../src/app/(admin)/layout.tsx)) and POS layout ([src/app/(pos)/layout.tsx](../src/app/(pos)/layout.tsx)) — every descendant section can use `useQuery`/`useMutation`/`useQueryClient` directly.

`clearCache()` invoked on logout in [SessionProvider.logout](../src/features/auth/SessionProvider.tsx).

### 19.3 Migration playbook (useEffect → useQuery)

**Before:**

```tsx
const [items, setItems] = useState<Employee[]>([]);
const [loading, setLoading] = useState(true);
const [refreshKey, setRefreshKey] = useState(0);

useEffect(() => {
  let cancelled = false;
  setLoading(true);
  void (async () => {
    const res = await listEmployees({ status: filter });
    if (cancelled) return;
    if (isOk(res)) setItems(res.data.items);
    setLoading(false);
  })();
  return () => { cancelled = true; };
}, [refreshKey, filter]);

// Trigger refresh after mutation:
setRefreshKey((k) => k + 1);
```

**After:**

```tsx
const queryClient = useQueryClient();
const {
  data: items = [],
  isLoading: loading,
} = useQuery({
  queryKey: ["admin", "employees", { filter }],
  queryFn: async () => {
    const res = await listEmployees({ status: filter });
    if (!isOk(res)) throw new Error(res.error.message);
    return res.data.items;
  },
});

const refresh = () =>
  queryClient.invalidateQueries({ queryKey: ["admin", "employees"] });

// After mutation:
void refresh();
```

**Key changes:**
1. **Drop `useState` + `useEffect`** for items/loading/refreshKey
2. **Query key** convention: `["admin"|"pos", <domain>, { ...params }]` — params object enables auto-refetch on filter change
3. **Throw on error** in queryFn — TanStack handles error state via `error` + `isError`
4. **`refresh()`** = `invalidateQueries` — TanStack triggers background refetch + updates all subscribers
5. **`enabled: <condition>`** for dependent queries (e.g. lines depend on selectedPeriodId)

### 19.4 Search input pattern

```tsx
const [search, setSearch] = useState("");
const debouncedSearch = useDebouncedValue(search.trim(), 300);

const { data } = useQuery({
  queryKey: ["admin", "employees", { search: debouncedSearch }],
  queryFn: () => listEmployees({ search: debouncedSearch }),
});

<Input value={search} onChange={(e) => setSearch(e.target.value)} />
```

User types "tunjangan" — `search` updates 9 times, but `debouncedSearch` only stabilizes once after 300ms idle → 1 fetch instead of 9.

### 19.5 Cache strategy by data type

| Data type | Strategy | Where |
|---|---|---|
| **Reference data** (COA, suppliers, categories, ingredients master) | TanStack `staleTime: 5min` + localStorage backup | TanStack handles in-memory; localStorage via `setCache(CACHE_KEYS.X)` survives reload |
| **Real-time / shift data** (current shift, open bills, transactions) | TanStack `staleTime: 0` or short (10-30s) | In-memory only, no localStorage |
| **List + search** (employees, audit log) | TanStack default `staleTime: 5min` + debounce | Same |
| **Mutations** (create/update/delete) | `useMutation` + `invalidateQueries` on success | Triggers refetch on related queries |

**❌ NEVER cache in localStorage:**
- Money / transaction values (sensitive + real-time)
- User PINs / auth tokens (security)
- Any data that changes minute-by-minute (shift, cart, payments)

**✅ SAFE to cache in localStorage:**
- Chart of Accounts (immutable per period)
- Supplier list (changes monthly, stale 24h OK)
- Categories / modifiers / ingredient names (changes weekly)
- User UI preferences (favorites, layout mode, sort)

### 19.6 QueryClient defaults (Mahakan tuned)

[src/lib/query-client.ts](../src/lib/query-client.ts):

```ts
{
  queries: {
    staleTime: 5 * 60 * 1000,        // 5min — most lists OK to be 5min stale
    gcTime: 30 * 60 * 1000,          // keep cache 30min after unmount
    refetchOnWindowFocus: false,      // POS staff alt-tab → POS — don't refetch
    refetchOnReconnect: true,         // network back → re-validate
    retry: 1,                         // 1 retry on network error
  },
  mutations: { retry: 0 },            // mutations never auto-retry (idempotency)
}
```

Per-query overrides allowed (e.g. AuditLogSection uses `staleTime: 30s` for fresh-log feel).

### 19.7 Sections converted in sesi AD-3

| Section | File | Notes |
|---|---|---|
| Staff | [StaffSection.tsx](../src/features/admin/sections/StaffSection.tsx) | Simple list, no filter |
| Employees | [EmployeesSection.tsx](../src/features/admin/sections/EmployeesSection.tsx) | Filter chips + debounced search |
| Audit Log | [AuditLogSection.tsx](../src/features/admin/sections/AuditLogSection.tsx) | Pagination + date range, `staleTime: 30s` (fresh-log feel) |
| Purchase Requests | [PurchaseRequestsSection.tsx](../src/features/admin/sections/PurchaseRequestsSection.tsx) | Filter tabs |
| Payroll | [PayrollSection.tsx](../src/features/admin/sections/PayrollSection.tsx) | 2 queries (periods + lines), dependent via `enabled` |
| Fixed Assets | [FixedAssetsView.tsx](../src/features/admin/sections/accounting/FixedAssetsView.tsx) | Sub-view of Akuntansi tab |
| Ingredients | [IngredientsList.tsx](../src/features/admin/sections/inventory/IngredientsList.tsx) | Filter + debounced search + parallel low-stock query |

**Remaining (deferred to AD-4 / future sesi):** CoaView, JournalView, PeriodsView, ReportsView (5 sub-tabs), MovementsList, PurchasesView, OpnameTab, RecipesList, MenuItemsView, CategoriesView, CashSection, FinanceSection (5 tabs), HrOperationsSection (4 inner tabs), Schedules, AttendanceSection, DashboardHome.

### 19.8 Expected impact

- **First visit per section**: same speed as before (still need to fetch)
- **Revisit within 5min**: instant — cached, no spinner
- **Filter/search change**: smaller payload (debounced) + cached for that param combo
- **Cross-section navigation**: 70-80% faster on revisit (data still in memory)
- **After mutation** (create/update): immediate UI feedback via optimistic + background refetch ensures consistency

### 19.9 Future enhancements

- **Optimistic updates**: pass `onMutate` in `useMutation` to update UI before server confirms (e.g. delete employee feels instant)
- **Suspense integration**: when Next.js streaming + RSC mature, wrap queries in `<Suspense>` for declarative loading
- **Persistent cache**: `@tanstack/query-async-storage-persister` to survive page reloads with full cache rehydration
- **Prefetch on hover**: `queryClient.prefetchQuery` triggered on sidebar item hover
- **Background sync**: `queryClient.refetchQueries` on `online` event for offline POS
