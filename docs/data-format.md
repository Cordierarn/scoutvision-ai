# Data format

`scripts/prepare_data.py` writes compact column/row JSON files (`{ "columns": [...], "rows": [[...]] }`
for the tables), loaded on demand by season and competition. `public/data/` is git-ignored: the
source data is private (see [data-pipeline.md](data-pipeline.md)).

## Files

| File | Content |
|---|---|
| `public/data/index.json` | available seasons and competitions |
| `public/data/players/<season>.json` | one row per player × team × competition (PitchAPI `player_season`) |
| `public/data/teams/<season>.json` | team metrics (`team_season`): xG, PPDA, possession, field tilt… |
| `public/data/shots/<season>/<COMP>.json` | shots of one competition (`shot`), loaded when a team or player is opened |
| `public/data/heatmaps/<season>/<COMP>.json` | per-player season heatmaps (`heatmap`, 16 × 12 grid of actions), loaded when a player is opened |
| `public/data/lineups/<season>/<COMP>.json` | formations actually used and, per slot, the players who started there most (`lineup`) |
| `public/data/networks/<season>/<COMP>.json` | per-team season pass network (`pass_network_node`, `pass_network_edge`): per player the mean position (x towards the opponent goal, y from left to right, 0–1), matches in the network, passes given and received; per directed link the summed passes and the matches where it appears; loaded when the "Réseau de passes" tab is opened |
| `public/data/models/age_curves.json` | per role and metric: regression-to-the-mean coefficient and age effect (percentile points per season) |
| `public/data/models/transfer.json` | transfer model: league levels, per-metric coefficients (league gap, team context, adaptation cost), out-of-sample validation |
| `public/data/market.json` | current Transfermarkt value, contract end and estimated value of every player, used by recruitment whatever the season analysed |
| `public/data/forecast.json` | upcoming matches with 1-N-2 probabilities and expected xG (PitchAPI `forecast` report) |
| `public/data/lab/` | Laboratory results, written by `scripts/prepare_lab.py` (see [laboratory.md](laboratory.md)) |

## Seasons

- An app season is a European season (`2024-25`). Calendar-year competitions
  (Norway, Sweden…) are filed under the season that starts the same year (`2024` → `2024-25`).
- A season is "in progress" until 30 June for a European season, 31 December for a calendar-year
  competition (`utils/sampleContext.ts`); the player card then flags the partial sample.

## Players and metrics

- Per-90 metrics are PitchAPI's **shrunk** per-90 values. Each metric `X` has a
  percentile `X pct` (0-100) among players of the same role (GK, CB, FB, WB, DM,
  CM, AM, W, ST) and the same competition level. Role scores, the Gem Hunter
  thresholds and the radars all use these percentiles.
- Only players with at least 40% of their team's minutes are included
  (PitchAPI `player_season` threshold).

## Transfermarkt

Transfermarkt (`market_value.parquet`, read from the `scoutvision-data` release):
birth date, height and foot are used for every season (missing Wikidata ages are
computed at season start: 1 July, or 1 January for calendar-year seasons);
market value and contract end are a current snapshot, shown for the current
season only. `--no-market-values` skips it.

## Images

Player photos and club logos come from the PitchAPI CDN, flags from
[flagcdn](https://flagcdn.com). The CDN does not send CORS headers, so images
are served through the `/cdn` proxy of the Vite server (`vite.config.ts`),
which lets the PDF export include them. A production host must apply the same
rewrite: `/cdn/*` → `https://cdn.pitchapi.dev/*`.
