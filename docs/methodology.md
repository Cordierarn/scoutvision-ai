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

## Similar players

- Score between a reference and a candidate: for each metric of the position's fixed list
  (`SIMILARITY_METRICS`, 12 metrics), `delta = |P_ref − P_candidate|` on the pipeline percentiles;
  similarity = 100 − mean(delta) over the metrics available for both players. The "why similar"
  panel and the radar read exactly these components (`utils/similarity.ts`).
- A missing metric is ignored and the mean is renormalised; below 8 comparable metrics out of 12
  there is no score (measured on 2025-26 and 2026-27, coverage is 12, 11 or 9 for more than 99 %
  of outfield players; the exceptions are strikers at 7 and goalkeepers at 5-6).
- Dimensions (`SQUAD_DIMENSIONS`), role indices and team context are shown side by side as
  explanations; none of them enters the score. Components are declarative so that future metrics
  are added without changing the computation.
- Historical "statistical twins" are not part of the page: the laboratory experiment
  ([laboratory](laboratory.md), *Statistical twins*) is rated **partial** (on par with the age
  curves for under-23s, not better overall) and only its aggregate result is stored.

## Team analysis

- Team ranks: one function for the team page and Recruitment, `teamRank` (`utils/recruitment.ts`),
  read through the `TEAM_METRICS` registry (`utils/teamMetrics.ts`). Cohort = teams of the same
  competition and season. Mid-rank convention: share of the cohort below, ties counted for half,
  the team included; the leader of n teams is at 100 − 50/n (97.2 of 18), the last at 50/n. A
  missing value (`null`, `""`, `NaN`) has no rank, is shown "N/D" and stays out of the cohort.
- Header totals come from team_season (`Goals per 90 × Matches`), never from the sum of the players
  in the data, who are filtered by playing time (median 12 per team).
- Own goals: in the shot files an own goal belongs to the player who scores it, i.e. to the team
  that concedes. It is credited to the opponent, listed apart, and kept out of xG, shots on target,
  conversion and the shot map (`utils/teamShots.ts`). Le Havre 2025-26: 32 goals for (31 from shots,
  1 own goal), as in team_season; the former count was 34. Shots against = shots of the other team
  in the team's matches.
- Formations: most used first. A slot without coordinates (`x = y = 0` in the files) is not placed
  and marks the formation incomplete; when a formation has more than 11 slots, slots at exactly the
  same coordinates (two position_id grids) are merged (`utils/teamLineups.ts`). Position held = read
  from the formation string (lines by depth, then left to right): it differs from the player's
  registered position family in 8.8 % of starters in 2025-26 (2.7 % by line), against 20 % and 7 %
  with the slot geometry alone. "Out of position" is shown only two lines apart or more (34 of 6,625).
- Style reliability: measured on 1,286 complete league team-seasons (≥ 20 matches, match-level
  team data of the PitchAPI cache, existing centroids unchanged). Style of the first N matches = the
  final style in 30 % of cases after 1 match, 48 % after 3, 55 % after 5, 64 % after 8, 66 % after 10,
  74 % after 15, 80 % after 20 (most frequent style: 23.5 %). The style is not named below 5 matches,
  shown as a trend from 5 to 9 and as the observed style from 10. Between two complete seasons, 47 %
  of clubs change style. Style map: PC1 63.2 % and PC2 24.0 % of the variance (87 %), one point per
  team-season.
- Depth (`slotDepth`): starter, backup and third option of each slot of the formation, with the
  signals Recruitment already uses (no backup, rotation, contract ≤ 12 months, age decline, no
  regular player). No need level: that stays in `slotNeeds`, which now reads `slotDepth` (identical
  output on 1,356 teams and 14,905 slots of 2025-26 and 2026-27).

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
| **Forecasts** | Forecasts page | leagues: pipeline `forecast` model (xG attack/defence strengths, home advantage). European cups (UCL, UEL, UECL): pipeline `forecast` model as well (current data). Fallback when the pipeline does not cover the cups: joint all-competition Poisson model in `scripts/models.py` (league level + team deviation, linked through cup matches, Dixon-Coles) |
| **Season outlook & match leverage** | Forecasts page | 20,000 simulations of the remaining fixtures (pipeline 1-X-2 probabilities): P(title), P(top 4), P(bottom 3); leverage of a match = change in P(objective) between a win and a loss (Serie A study, 2026) |
| **Model vs market** | Forecasts page | odds from football-data.co.uk (27 competitions): pipeline backtest vs margin-free closing odds (power de-vig) — RPS, log-loss, model weight in a logarithmic pool, simulated value bets judged by closing line value. Oct. 2026: RPS 0.2102 vs 0.2034, weight 0.00, CLV −10.5 % on 1,702 bets: no edge |

### European cup fallback model

The joint cup model (`forecast_cups` in `scripts/prepare_data.py`) only forecasts cups missing
from the pipeline's forecasts. **Historical validation of this fallback model**, from a run in
which it was used: out-of-sample RPS 0.209 vs 0.236 for 1-X-2 frequencies on 286 past cup
matches.

The current data does not use it: the pipeline's forecasts already cover UCL, UEL and UECL
(data of Oct. 28, 2026: `forecast.json` has an empty `cupModel` and no match forecast by the
joint model). This result is therefore not a validation of the forecasts currently shown for
these matches.

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
- European cup fallback model: past cup matches left out (historical validation, see above).
- Laboratory: every forecast validated on matches or seasons left out of the fit
  ([laboratory.md](laboratory.md)).
