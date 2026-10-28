# Design system

ScoutVision uses a compact dark analyst interface built from the logo: background `#0B111A`,
ink `#F8FAFC`, accent cyan `#00E5FF`, short angular radii. Tables, percentiles and charts share
one set of tokens and primitives.

## Where things live

| Where | What |
|---|---|
| `styles/index.css` | colour tokens (CSS variables), base styles and primitives: `sv-panel`, `sv-label`, `sv-input`, `sv-select`, `sv-btn-*`, `sv-icon-btn`, `sv-chip`, `sv-tag`, `sv-seg`, `sv-tabs`, `sv-table`, `sv-toolbar`, `sv-tooltip`, `sv-menu` |
| `tailwind.config.js` | token names for Tailwind: `canvas`, `surface`, `raised`, `overlay`, `line`, `ink`/`ink-2..4`, `accent`, `pos`, `neg`, `warn` |
| `components/ui` | `PageHeader`, `Panel`, `Stat`, `StatStrip`, `PercentileBar`, `PercentileRow`, `PercentileValue`, `PercentileLegend`, `IndexBar`, `LegendItem`, `Delta`, `InfoTip`, `EmptyState`, `Skeleton`, `SkeletonBlock`, `LoadError`, `PolarTick` |
| `theme/charts.ts` | chart identity: series order, context grey, diverging pair, cyan sequential ramp, reserved status colours, Recharts axis/grid/tooltip props |
| `theme/percentile.ts` | percentile tiers |

## Colour tokens

Defined as RGB triplets in `styles/index.css` (so that Tailwind opacity modifiers such as
`bg-accent/10` keep working):

| Token | Value | Use |
|---|---|---|
| `canvas` | `#0B111A` | application background (logo) |
| `surface` | `#101721` | panels |
| `raised` | `#17202C` | inputs, hovered rows, inner tiles |
| `overlay` | `#1E2938` | menus, tooltips, active state |
| `line` / `line-strong` | `#222D3B` / `#303E50` | separators and panel borders / control borders |
| `ink`, `ink-2`, `ink-3`, `ink-4` | `#F8FAFC`, `#C4CDD8`, `#8996A7`, `#5E6B7C` | main text, secondary text, labels, faint text |
| `accent`, `accent-deep` | `#00E5FF`, `#0096AD` | brand cyan, muted accent borders and fills |
| `pos`, `neg`, `warn` | `#3DD68C`, `#F0605D`, `#F2B33D` | positive, negative, warning |

## Percentile tiers

| Tier | Range | Colour |
|---|---|---|
| Elite | ≥ 90 | `#00E5FF` |
| Above | 70-89 | `#0096AD` |
| Average | 31-69 | `#4A586B` |
| Below | 11-30 | `#A8504D` |
| Weak | ≤ 10 | `#E66767` |

A diverging scale around the median: above in cyan, average in grey, below in red.

## Chart palette

- **Series** (player 1, 2, 3, 4, fixed order, never reassigned by rank): `#00E5FF`, `#d95926`,
  `#9085e9`, `#e8d44d`. Checked for colour blindness on the panel surface `#101721`, all pairs
  (overlaid radars, scatter plots): smallest CVD difference 18.8 (OKLab ×100, target ≥ 8), normal
  vision ≥ 24. The brand cyan is deliberately brighter: series 1 is the reference player.
- **Context** `#6B7788`: anything used as a comparison (average, other candidates, controls).
- **Diverging**: `#00C8E0` above, `#E66767` below, `#303E50` middle.
- **Sequential**: a single cyan ramp from dark to light, for heatmaps.
- **Status** (verdicts, need levels): good `#0ca30c`, warning `#fab219`, serious `#ec835a`,
  critical `#d03b3b`, neutral `#94a3b8`, always with an icon and a label.

## Accessibility

Colour never carries meaning alone: percentiles show their value (P92), verdicts and needs keep
their icon and label. Tables keep a visible hover and keyboard focus state on rows.
