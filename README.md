<div align="center">

# ⚽ ScoutVision AI

**Professional Football Scouting Platform**

A modern, data-driven scouting application for football analytics with AI-powered player analysis.

![React](https://img.shields.io/badge/React-19.2-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-cyan?logo=tailwindcss)

</div>

## ✨ Features

- 📊 **Player Database** - 35 competitions, seasons 2021-22 → today (PitchAPI), with advanced filtering
- 🔍 **Player Comparison** - Compare up to 4 players side-by-side with radar charts
- 🎯 **Similarity Finder** - Find statistically similar players using advanced algorithms
- 💎 **Gem Hunter (Prospects)** - Scout prospects with 22 percentile-based role presets
- ⚽ **Team Analysis** - Squad depth, tactical profiles, and shot maps
- 📝 **AI Scout Reports** - Generate AI-powered scouting reports with Gemini
- 🌙 **Modern Dark UI** - Glassmorphism design with premium aesthetics
- 📈 **Impact & value** - RAPM (regularized plus-minus), finishing skill, pass-network role, performance-based value vs Transfermarkt
- 🌱 **Development** - Age curves by role and one-year percentile projection (regression to the mean separated from age)
- 🧭 **Playing styles** - Team styles (PCA + k-means) and style map per competition
- 🗓️ **Forecasts** - Win / draw / loss probabilities of upcoming matches

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Gemini API Key (for AI reports)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/scoutvision-ai.git
   cd scoutvision-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Get the data** (PitchAPI, 2021-22 → current season)

   The data comes from the private repo
   [`Cordierarn/PitchApi-big-5`](https://github.com/Cordierarn/PitchApi-big-5)
   (35 competitions, updated twice a week). The `gh` CLI must be logged in with
   read access to that repo (`gh auth login`).

   ```bash
   npm run data:pull        # download the data prepared by CI (~35 MB), no Python needed
   ```

   Or build it yourself from the PitchAPI releases:

   ```bash
   pip install -r scripts/requirements.txt
   npm run data:prepare                                     # all seasons and competitions
   python3 scripts/prepare_data.py --seasons 2026-27        # current season only
   python3 scripts/prepare_data.py --no-market-values               # without Transfermarkt
   ```

   Archives are cached in `.cache/pitchapi/`; the output goes to `public/data/`
   (both are git-ignored: the source data is private).

5. **Run the development server**
   ```bash
   npm run dev
   ```

## 📁 Data Format

`scripts/prepare_data.py` writes compact column/row JSON files, loaded on demand:

| File | Content |
|---|---|
| `public/data/index.json` | available seasons and competitions |
| `public/data/players/<season>.json` | one row per player × team × competition (PitchAPI `player_season`) |
| `public/data/teams/<season>.json` | team metrics (`team_season`): xG, PPDA, possession, field tilt… |
| `public/data/shots/<season>/<COMP>.json` | shots of one competition (`shot`), loaded when a team or player is opened |
| `public/data/heatmaps/<season>/<COMP>.json` | per-player season heatmaps (`heatmap`, 16 × 12 grid of actions), loaded when a player is opened |
| `public/data/models/age_curves.json` | per role and metric: regression-to-the-mean coefficient and age effect (percentile points per season) |
| `public/data/forecast.json` | upcoming matches with 1-N-2 probabilities and expected xG (PitchAPI `forecast` report) |

- An app season is a European season (`2024-25`). Calendar-year competitions
  (Norway, Sweden…) are filed under the season that starts the same year (`2024` → `2024-25`).
- Per-90 metrics are PitchAPI's **shrunk** per-90 values. Each metric `X` has a
  percentile `X pct` (0-100) among players of the same role (GK, CB, FB, WB, DM,
  CM, AM, W, ST) and the same competition level. Role scores, the Gem Hunter
  thresholds and the radars all use these percentiles.
- Only players with at least 40% of their team's minutes are included
  (PitchAPI `player_season` threshold).
- Transfermarkt (`market_value.parquet`, read from the `scoutvision-data` release):
  birth date, height and foot are used for every season (missing Wikidata ages are
  computed at season start: 1 July, or 1 January for calendar-year seasons);
  market value and contract end are a current snapshot, shown for the current
  season only. `--no-market-values` skips it.

## 🔬 Advanced indicators (from the research synthesis)

Built by `scripts/prepare_data.py` (models in `scripts/models.py`, numpy only) or taken
from the PitchApi-big-5 analyses in `global.tar/reports/`:

| Indicator | Where | Method |
|---|---|---|
| **RAPM** (attack, defence, net) | player card, report | regularized plus-minus in xG/90 from the pipeline (two-season window, European leagues); percentile within the league; league reliability shown, defence is often unreliable |
| **Finishing skill** | player card, report | pipeline player effect, shrunk: goals above xG per 100 shots over the career (not raw goals − xG, too noisy) |
| **Pass share / relay role** | player card | pass network until the first substitution: share of the team's passes, mean betweenness; percentiles by role and level |
| **Team playing style** | tactics tab, player card | k-means (6 styles) on possession, territory, PPDA, line height, directness, build-up, fitted on all team-seasons; map on the first two PCA axes (87% of variance) |
| **Development** | player card, report | one-season change of role percentiles: regression to the mean (β ≈ −0.5) separated from the age effect; one-year projection |
| **Estimated value** | player card, Gem Hunter | ridge on log10(Transfermarkt value), out-of-fold predictions (R² ≈ 0.70, typical error ×1.7); current season only |
| **Forecasts** | Forecasts page | leagues: pipeline `forecast` model (xG attack/defence strengths, home advantage). European cups (UCL, UEL, UECL): joint all-competition Poisson model in `scripts/models.py` (league level + team deviation, linked through cup matches, Dixon-Coles); out-of-sample RPS 0.209 vs 0.236 for 1-X-2 frequencies on 286 past cup matches |
| **Season outlook & match leverage** | Forecasts page | 20,000 simulations of the remaining fixtures (pipeline 1-X-2 probabilities): P(title), P(top 4), P(bottom 3); leverage of a match = change in P(objective) between a win and a loss (Serie A study, 2026) |
| **Model vs market** | Forecasts page | odds from football-data.co.uk (27 competitions): pipeline backtest vs margin-free closing odds (power de-vig) — RPS, log-loss, model weight in a logarithmic pool, simulated value bets judged by closing line value. Oct. 2026: RPS 0.2102 vs 0.2034, weight 0.00, CLV −10.5 % on 1,702 bets: no edge |

Not shown on purpose: substitution and coach rankings. The pipeline's own study
(`docs/analyses/remplacements.md`) finds them not reproducible (split-half correlation ≈ 0).

RAPM, finishing and forecasts come from `python -m pitchapi_big5 rapm`, `finishing`
and `forecast`, which the weekly PitchAPI workflow does not run: run them (or add
them to that workflow, before `publish-data`) to keep these indicators current.

Models are fitted on the seasons being prepared: run `prepare_data.py` without
`--seasons` for the full fit (age curves and styles use every season).

## 🔄 Automatic data updates

`.github/workflows/update-data.yml` runs every Monday and Friday at 10:30 UTC
(after the PitchApi-big-5 update at 08:00) and on demand (*Actions* > *Run workflow*).
It runs `scripts/prepare_data.py` and uploads `scoutvision-data.tar.gz` to the
**private** release `scoutvision-data` of PitchApi-big-5. Nothing is committed
to this public repo, and no artifact or cache holds the data.

**One-time setup**

1. Create a fine-grained personal access token: repository access *only*
   `Cordierarn/PitchApi-big-5`, permission *Contents: Read and write*.
2. Add it to this repo: *Settings* > *Secrets and variables* > *Actions* >
   *New repository secret*, name `PITCHAPI_DATA_TOKEN`.
3. Market values: `market_value.parquet` (output of
   `python -m pitchapi_big5 market-values`) lives in the `scoutvision-data`
   release; `prepare_data.py` reads it automatically. To refresh it:
   `gh release upload scoutvision-data data/external/transfermarkt/market_value.parquet --clobber`
   (from PitchApi-big-5).

**Optional: trigger right after the PitchAPI update.** Add this last step to
the PitchApi-big-5 workflow (with a secret `SCOUTVISION_DISPATCH_TOKEN`: a
fine-grained PAT on `Cordierarn/scoutvision-ai` with *Contents: Read and write*):

```yaml
      - name: Notify ScoutVision
        run: gh api repos/Cordierarn/scoutvision-ai/dispatches -f event_type=pitchapi-data-updated
        env:
          GH_TOKEN: ${{ secrets.SCOUTVISION_DISPATCH_TOKEN }}
```

## 🖼️ Images

Player photos and club logos come from the PitchAPI CDN, flags from
[flagcdn](https://flagcdn.com). The CDN does not send CORS headers, so images
are served through the `/cdn` proxy of the Vite server (`vite.config.ts`),
which lets the PDF export include them. A production host must apply the same
rewrite: `/cdn/*` → `https://cdn.pitchapi.dev/*`.

## 🎯 Tactical Roles (Gem Hunter)

The Gem Hunter includes 22 role presets across 9 categories (thresholds are role percentiles):

| Category | Roles |
|----------|-------|
| 🧤 Goalkeeper | Shot Stopper, Sweeper Keeper |
| 🛡️ Centre Back | Ball Playing, No-Nonsense, Cover Defender |
| 🏃 Full Back | Wing Back, Defensive, Inverted |
| ⚔️ CDM | Anchor Man, Regista |
| 🔄 CM | Box-to-Box, Ball Carrier |
| 🎯 CAM | Number 10, Shadow Striker |
| ⚡ Winger | Classic, Inside Forward, Wide Playmaker |
| ⚽ Striker | Poacher, Target Man, False Nine, Advanced Forward |
| 🎲 Specialist | Set Piece Creator |

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **AI**: Google Gemini API
- **PDF Export**: jsPDF, html2canvas
- **Data pipeline**: Python (pandas, pyarrow), GitHub Actions

## 📄 License

MIT License - feel free to use this project for your own scouting needs!

## 🙏 Acknowledgments

- Data from [PitchAPI](https://pitchapi.dev), collected by `Cordierarn/PitchApi-big-5`
- Inspired by professional football analytics platforms

---

<div align="center">
Made with ❤️ for football scouts and analysts
</div>
