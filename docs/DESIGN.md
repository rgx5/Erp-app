# Design language — "OneSyncERP"

OneSyncERP's look is **independent of the billing app it grew from**. The reference product is a dense desktop/web till;
this is a phone-first app for owners and counter staff, so it is calmer, larger and more tactile.

## Principles

1. **Numbers are the hero.** An ERP is read for its figures, so figures get the display face (Manrope, tabular
   figures so columns line up) and the biggest sizes. Labels stay small and quiet.
2. **One confident colour.** Cobalt (`#2B59FF`) is the only primary. Saffron (`#FF8A1F`) is used sparingly for what
   needs a look (price missing, birthday, discount). Green/amber/red are reserved for status, never decoration.
3. **Warm paper, not clinical white.** Light mode sits on `#F4F3EF` with white cards; dark mode is a deep ink
   (`#0A0D14`) where borders, not shadows, create depth.
4. **Thumb-first.** The primary action lives at the bottom (pinned footers, the raised **Sell** button in the tab bar),
   touch targets are generous (icon buttons carry extra hit-slop), sheets rise from the bottom, and selection uses haptic ticks.
5. **Say what happened, in words.** Every error is a sentence a shopkeeper understands ("Stock cannot go below zero").
   Empty states explain the next step. Nothing fails silently.
6. **Never rely on colour alone.** Chart series also have labels/legends; status badges carry text.

## Tokens (`src/ui/theme.tsx`)

| Token | Light | Dark |
| --- | --- | --- |
| `bg` / `surface` / `sunken` | `#F4F3EF` / `#FFFFFF` / `#EEECE6` | `#0A0D14` / `#131824` / `#0E121B` |
| `ink` / `inkSoft` / `inkMute` | `#0E1220` / `#4A5266` / `#858CA0` | `#F1F3F9` / `#B4BBCC` / `#7B849A` |
| `primary` | `#2B59FF` | `#6E92FF` |
| `accent` | `#FF8A1F` | `#FFA14D` |
| `success` / `warning` / `danger` | `#0E9F6E` / `#B86E00` / `#E03E44` | `#34D399` / `#F5B544` / `#FF6B70` |

* **Type:** Manrope 600/700/800 for headings and numerals, Inter 400/500/600 for body. Variants: `display`, `h1`,
  `h2`, `title`, `body`, `bodyStrong`, `caption`, `micro`, `label`, `num`, `numLg`. Text respects the system font
  scale (a few fixed-size glyphs such as avatars opt out with `fixed`).
* **Radius:** 10 / 14 / 20 / 26 / pill. Cards 20, inputs 14, sheets 26, buttons pill-ish (`height / 2.6`).
* **Elevation:** three soft shadow levels in light mode; in dark mode shadows are dropped and hairline borders are used.
* **Spacing:** 4 · 8 · 12 · 16 · 20 · 24 · 32; screen gutters are 20.

## Components (`src/ui`)

`Screen` (safe areas, header, pull-to-refresh, pinned footer) · `Card`, `Group`, `ListRow`, `Section`, `StatTile`, `KV`,
`Notice`, `EmptyState`, `Badge`, `Chip`, `Avatar`, `IconWell`, `ProgressBar`, `Skeleton` · `Button`, `IconButton` ·
`Field`, `MoneyField`, `NumberField`, `SearchBar`, `Segmented`, `SwitchRow`, `Select`, `Stepper`, `TagInput` ·
`Sheet` (bottom sheet), `toast`, `ask`/`tell` dialogs · `AreaChart` (with a touch scrubber), `BarChart`, `Donut`,
`HBars`, `Sparkline`, `BarcodeView` (all hand-drawn SVG; no chart library).

Icons are imported **one file at a time** (`lucide-react-native/icons/<name>`) and re-exported from
`src/ui/icons.ts`; a test guards that every export resolves, so a typo can't ship as a blank icon.

## Signature moments

* **Welcome** — a deep-cobalt hero with the three honest doors: connect a business, explore a demo, start fresh.
* **Home** — greeting, day's sales as a hero card with an interactive area chart, then the things that need a look
  (low stock, items to price, held bills) as tappable notices.
* **Sell** — search/scan first, a live cart sheet with line editing, parked bills, and a one-tap **Charge** bar.
* **Tab bar** — five destinations with a raised centre **Sell** button; role-aware (cashiers don't see Reports).
* **Checkout** — a big amount, quick-cash suggestions, split payments, and a receipt that can be printed, saved as
  PDF or sent over WhatsApp.

## Accessibility

Labels on icon-only buttons, `accessibilityRole="button"` on every `Tap`, system font scaling, primary text in
high-contrast ink on both palettes (muted ink is used only for secondary captions), haptics can be turned off, and the app follows the system dark/light setting (or a manual
override in *Settings → Appearance*).
