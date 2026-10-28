# Methodology

Indicators are built by `scripts/prepare_data.py` (models in `scripts/models.py`, NumPy only) or
taken from the PitchApi-big-5 analyses in `global.tar/reports/`. Recruitment and the transfer
projection have their own page: [recruitment-model.md](recruitment-model.md). Tactical roles:
[tactical-roles.md](tactical-roles.md).

Every index and projection below is a scouting aid. None of them is a verdict on a player.

## Shrunk per-90 metrics and percentiles

- Per-90 metrics are PitchAPI's **shrunk** per-90 values (pulled towards the role average when
  minutes are low).
- Each metric `X` has a percentile `X pct` (0-100) among players of the same role (GK, CB, FB,
  WB, DM, CM, AM, W, ST) and the same competition level. Role scores, the Gem Hunter thresholds
  and the radars all use these percentiles.
- A percentile ranks the value, not its quality: for metrics where less is better (losses of
  possession, fouls…) the role indices count 100 − percentile.
- Only players with at least 40% of their team's minutes are included (PitchAPI `player_season`
  threshold).

## Indicators

| Indicator | Where | Method |
|---|---|---|
| **RAPM** (attack, defence, net) | player card, report | regularized plus-minus in xG/90 from the pipeline (two-season window, European leagues); percentile within the league; league reliability shown, defence is often unreliable |
| **Finishing skill** | player card, report | pipeline player effect, shrunk: goals above xG per 100 shots over the career (not raw goals − xG, too noisy) |
| **Pass share / relay role** | player card | pass network until the first substitution: share of the team's passes, mean betweenness; percentiles by role and level |
| **Team playing style** | tactics tab, player card | k-means (6 styles) on possession, territory, PPDA, line height, directness, build-up, fitted on all team-seasons; map on the first two PCA axes (87% of variance) |
| **Development** | player card, report | one-season change of role percentiles: regression to the mean (β ≈ −0.5) separated from the age effect; one-year projection |
| **Estimated value** | player card, Gem Hunter | ridge on log10(Transfermarkt value), out-of-fold predictions (R² ≈ 0.70, typical error ×1.7); current season only |

### Development

Age curves per role and metric (`public/data/models/age_curves.json`): regression-to-the-mean
coefficient and age effect, in percentile points per season. The one-year projection applies
both; the two effects are estimated separately so that a young player's expected progression is
not confused with a return to the average after an unusual season.

### Reliability shown in the app

The player card states the reliability of each indicator independently of the season: pass
network from 5 matches, RAPM percentile from 600 minutes over two seasons, finishing measured over
the career (estimate pulled towards the average under 50 shots).

## Forecasting

| Indicator | Where | Method |
|---|---|---|
| **Forecasts** | Forecasts page | leagues: pipeline `forecast` model (xG attack/defence strengths, home advantage). European cups (UCL, UEL, UECL): pipeline forecasts when available; otherwise joint all-competition Poisson model in `scripts/models.py` (league level + team deviation, linked through cup matches, Dixon-Coles), out-of-sample RPS 0.209 vs 0.236 for 1-X-2 frequencies on 286 past cup matches when it was last used |
| **Season outlook & match leverage** | Forecasts page | 20,000 simulations of the remaining fixtures (pipeline 1-X-2 probabilities): P(title), P(top 4), P(bottom 3); leverage of a match = change in P(objective) between a win and a loss (Serie A study, 2026) |
| **Model vs market** | Forecasts page | odds from football-data.co.uk (27 competitions): pipeline backtest vs margin-free closing odds (power de-vig) — RPS, log-loss, model weight in a logarithmic pool, simulated value bets judged by closing line value. Oct. 2026: RPS 0.2102 vs 0.2034, weight 0.00, CLV −10.5 % on 1,702 bets: no edge |

The joint cup model is a fallback (`forecast_cups` in `scripts/prepare_data.py`): it only
forecasts cups missing from the pipeline's forecasts. In the data of Oct. 28, 2026 the pipeline
covered UCL, UEL and UECL, so `forecast.json` has an empty `cupModel` and no match forecast by
the joint model.

## Not shown on purpose

Substitution and coach rankings. The pipeline's own study (`docs/analyses/remplacements.md` in
PitchApi-big-5) finds them not reproducible (split-half correlation ≈ 0).

## Where the inputs come from

RAPM, finishing and forecasts come from `python -m pitchapi_big5 rapm`, `finishing` and
`forecast`, which the weekly PitchAPI workflow does not run: run them (or add them to that
workflow, before `publish-data`) to keep these indicators current.

Models are fitted on the seasons being prepared: run `prepare_data.py` without `--seasons` for
the full fit (age curves and styles use every season).

## Validation

- Transfer projection: last closed season left out of the fit
  ([recruitment-model.md](recruitment-model.md#out-of-sample-validation)).
- Estimated value: out-of-fold predictions (5 folds).
- Cup forecasts: past cup matches left out.
- Laboratory: every forecast validated on matches or seasons left out of the fit
  ([laboratory.md](laboratory.md)).
