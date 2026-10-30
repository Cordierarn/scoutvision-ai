<div align="center">

<img src="logo.svg" width="160" alt="ScoutVision logo"/>

# SCOUTVISION

**Football scouting, measured.**

ScoutVision is a football scouting and recruitment analytics platform that turns player, team and
match data into explainable profiles, shortlists and projections. It combines role-adjusted
percentiles, tactical role profiles, player similarity, team context and transfer projections
with models validated out of sample.

![React](https://img.shields.io/badge/React-19.2-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)
![Python](https://img.shields.io/badge/Python-3.11-yellow?logo=python)

</div>

## Screenshots

Taken from the app with real data (season 2026-27). The PitchAPI data is private: player and
club names, photos, logos, market values, contracts and birth dates are blurred.

**Player database** — dense sortable table, configurable stat columns, percentiles

![Player database](docs/screenshots/base-joueurs.png)

**Player profile** — key figures, radar linked to percentiles, best roles, impact and value
models, development projection, shot map and heatmap

![Player profile](docs/screenshots/fiche-joueur.png)

**Gem Hunter** — role profile and criteria, constraints, selection funnel, role index and its
breakdown ("why this player?")

![Gem Hunter](docs/screenshots/chasseur-de-pepites.png)

## Data first

ScoutVision does not replace a scout. It narrows the field and makes each step explicit:

```
measure → compare → filter → understand → project → shortlist → verify through video and live scouting
```

Role indices, projections and estimates are scouting aids with stated limits. None of them is a
verdict on a player.

## Core workflow

| Step | In ScoutVision |
|---|---|
| **Explore** | Search and filter players across 35 competitions and six seasons. |
| **Profile** | Read a player through role-adjusted percentiles, role indices and impact indicators (RAPM, finishing, pass network). |
| **Compare** | Put up to four players side by side, or find statistically similar alternatives. |
| **Shortlist** | Use tactical role profiles and constraints (age, minutes, value, contract, competition) to reduce the pool to relevant candidates. |
| **Project** | Estimate how a player's percentiles may translate to a new league and team next season. |
| **Recruit** | Compare projected candidates with the current starter, the team's needs, complementarity with the line partner and cost. |

## Features

### Player scouting
- **Player database**: every player of the loaded seasons, sortable and configurable stat
  columns, combined stat filters, CSV export.
- **Player profile**: percentiles by role and competition level, radar, best roles, RAPM,
  finishing skill, pass-network role, estimated value vs Transfermarkt, development projection,
  shot map, heatmap, PDF export.
- **Comparison** of up to four players with overlaid radars.
- **Similar players**: explainable similarity score on the pipeline percentiles, with the
  components that drive it ("why similar"), optionally restricted to the same position.
- **Watchlist** with notes, stored in the browser, CSV export.
- **Saved filters and share links** on the player database, the Gem Hunter and Similar players:
  settings saved in the browser under a name, and a link (`#partage=…`, settings only, no data)
  that reopens the page with them.

### Tactical profiles
- 27 tactical roles in 9 categories, from goalkeepers to set-piece specialists.
- Eliminatory criteria (minimum percentile) and weighted ranking criteria per role.
- A role index from 0 to 100, identical in the player profile, the Gem Hunter and recruitment,
  with a term-by-term breakdown.
- **Gem Hunter**: selection funnel (position, constraints, role criteria), adjustable strictness,
  custom roles. During a season in progress the default minutes threshold follows the share of
  the season already played (see [methodology](docs/methodology.md#minutes-threshold-during-a-season-in-progress)).

### Team & recruitment
- Squad analysis: starting eleven of the most used formation, playing style map, shot map, squad.
- Team needs by position: each starter projected one season ahead and ranked in his league;
  contract end, expected decline and lack of cover flagged.
- Squad profile on 9 dimensions, ranked among the league's teams.
- Suggestions projected into the team (league level, team context, adaptation), complementarity
  with the line partner, value-for-money frontier.

### Player development
- Age curves by role and metric.
- Regression to the mean separated from the age effect.
- One-year percentile projection.

### Forecasting
- Win / draw / loss probabilities and expected xG of upcoming matches.
- Season simulations: probabilities of title, top 4 and bottom 3; leverage of each match.
- Model vs market comparison against closing odds (no edge found, and shown as such).

### Research lab
- 17 experiments on match-by-match data: coaches, momentum, goal value, pass chemistry,
  referees, transfers, squad age, luck…
- Each ends with a verdict: validated, partial, debunked or measured. Negative results stay in
  the lab.

### AI scout reports (optional)
- Optional grounded scouting summaries written from ScoutVision's structured analyses.
- Gemini writes the text only; it does not compute any ScoutVision model.
- Same guard for the comparative synthesis (Comparison, Recruitment), the opposition briefing
  (Team analysis) and the natural-language assistant of the Gem Hunter, which only proposes
  filters validated against the catalogue.

## Key numbers

- **35** competitions, **6** seasons (2021-22 → 2026-27)
- **27** tactical roles
- **405** league changes in the held-out transfer validation (test season 2025-26)
- Role-index error of the transfer projection: **12.18** points, vs 13.88 with age curves alone
  and 16.79 when the current index is kept unchanged

Details: [recruitment model](docs/recruitment-model.md#out-of-sample-validation),
[laboratory](docs/laboratory.md).

## Methodology

- **Shrunk per-90 metrics**: PitchAPI per-90 values, pulled towards the role average at low minutes.
- **Percentiles** by role (GK, CB, FB, WB, DM, CM, AM, W, ST) and competition level.
- **Tactical role indices**: weighted means of percentiles, eliminatory thresholds, explainable.
- **RAPM**: regularized plus-minus in xG/90 over two seasons, with league reliability.
- **Finishing skill**: shrunk goals above xG per 100 shots over the career.
- **Pass-network indicators**: share of the team's passes and relay role.
- **Age curves**: regression to the mean separated from the age effect.
- **Transfer projection**: league levels, change of team context, adaptation cost.
- **Out-of-sample validation**: last closed season left out of the fit; laboratory forecasts on
  matches or seasons left out.

See the methodology documentation for details, assumptions and limitations:
[methodology](docs/methodology.md), [tactical roles](docs/tactical-roles.md),
[recruitment model](docs/recruitment-model.md).

## Getting started

### Requirements

**Required**
- Node.js 18+ (Vite 6: 18, 20 or 22+)
- npm

**Data access**
- [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`) with read access to
  `Cordierarn/PitchApi-big-5`

**Optional**
- Python 3 (3.11 in CI), to rebuild the datasets
- A Gemini API key, to generate the AI scouting summaries

### Installation

```bash
git clone https://github.com/Cordierarn/scoutvision-ai.git
cd scoutvision-ai
npm install
npm run data:pull        # private data prepared by CI (~60 MB), no Python needed
npm run dev               # http://localhost:3000
```

The app runs without Gemini; only the report generation then answers "unavailable". To enable
it, create a git-ignored `.env.local`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
# GEMINI_MODEL=gemini-3.5-flash   # optional, this is the default
```

Production build: `npm run build && npm run preview` (serves the app, the `/cdn` image proxy and
the report endpoint). To rebuild the data with Python, see [data pipeline](docs/data-pipeline.md).

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS |
| Charts | Recharts |
| Data preparation | Python, pandas, pyarrow |
| Statistical models | NumPy and custom modelling code (`scripts/models.py`, `scripts/lab.py`) |
| AI summaries | Gemini through a server-side endpoint (`server/`) |
| Exports | jsPDF (texte natif, radar vectoriel), JSON des dossiers |
| Automation | GitHub Actions |

## Data & privacy

- PitchAPI source data remains private.
- `public/data/` is git-ignored: datasets are never committed to this public repository.
- The prepared data is published to `scoutvision-data`, a **private** release of
  `Cordierarn/PitchApi-big-5`, and fetched with `npm run data:pull`.
- The screenshots of this README are anonymised (names, photos, logos, values, contracts and
  birth dates blurred).
- Real player data should not be added to public artifacts (issues, pull requests, screenshots).

## Data format and updates

Prepared datasets are stored as compact JSON and loaded on demand by season and competition:
players, teams, shots, heatmaps, lineups and models (age curves, transfer model), plus market
values, forecasts and laboratory results. See [data format](docs/data-format.md).

Data is refreshed twice a week through GitHub Actions and published to a private release
consumed by `npm run data:pull`. See [data pipeline](docs/data-pipeline.md).

## AI scout reports

ScoutVision can optionally generate a textual scouting summary from its structured analyses.

- Gemini is called on the server only (`POST /api/scout-report`); the API key never reaches the
  browser.
- The model receives structured ScoutVision facts (percentiles with their comparison group,
  role indices, Transfermarkt value and ScoutVision estimate kept separate, indicators with their
  limits), not the raw data.
- Deterministic post-generation checks remove unsupported topics, numbers and verdicts.
- The AI summarises; it does not calculate the statistical models.

See [AI reports](docs/ai-reports.md).

## Design system

ScoutVision uses a compact dark analyst interface with a shared design system for tables,
percentiles and charts. See [design system](docs/design-system.md).

## Tests

```bash
npm test               # Vitest
npm run test:data      # Python (unittest)
```

Vitest covers role scoring and the Gem Hunter, recruitment and lineups, development projections,
laboratory views and the grounded scout-report endpoint. Python tests cover the statistical
models and data steps: the transfer model recovers simulated parameters, the role index matches
the app, lineups, market evaluation, season simulation, and each laboratory experiment must find
a simulated effect, or its absence.

## Documentation

| Document | Content |
|---|---|
| [Methodology](docs/methodology.md) | shrunk per-90, percentiles, RAPM, finishing, pass network, styles, development, estimated value, forecasting |
| [Tactical roles](docs/tactical-roles.md) | the 27 roles, criteria and weights, role index and breakdown, Gem Hunter, Oct. 2026 calibration |
| [Recruitment model](docs/recruitment-model.md) | team needs, squad profile, transfer projection, suggestions, out-of-sample validation |
| [Laboratory](docs/laboratory.md) | every experiment with its method and verdict |
| [Data format](docs/data-format.md) | prepared files, seasons, Transfermarkt, images |
| [Data pipeline](docs/data-pipeline.md) | CI workflow, private release, tokens, manual updates |
| [AI reports](docs/ai-reports.md) | endpoint, facts, grounding rules, checks, retry, deployment |
| [Design system](docs/design-system.md) | tokens, primitives, percentile tiers, chart palette, accessibility |

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- Data from [PitchAPI](https://pitchapi.dev), collected by `Cordierarn/PitchApi-big-5`
- Market values from Transfermarkt, betting odds from [football-data.co.uk](https://www.football-data.co.uk), flags from [flagcdn](https://flagcdn.com)
