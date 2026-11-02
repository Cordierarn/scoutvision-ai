# Forecast research: point-in-time dataset (step 1)

Research pipeline, separate from the product: nothing here feeds the app, the Forecast page or the
data release. Step 1 builds the dataset every later step will read; **no model is trained and no
betting result is computed** in this step.

## Purpose

One row per finished match describing the world as it was **before kick-off**: identity, targets
(known after the match), pre-match features, odds separated by when they were observed, and quality
flags. Later steps will fit models on this table only, in chronological walk-forward windows, and
compare them to the betting market as the primary baseline. The protocol is designed to be able to
conclude "no robust edge detected".

## Sources

| Source | Tables / files | Used for |
|---|---|---|
| PitchAPI cache (`.cache/pitchapi/data-v2-*/tables-<COMP>-<season>.tar`) | `match` (date, `time_utc`, stage, round, score, status), `team_match` (xG for/against, `analytics_available`) | identity, targets, features |
| football-data.co.uk, local files only (`.cache/pitchapi/football-data` or `--odds-dir`) | main files `mmz4281/<season>/<DIV>.csv` (16 leagues), `new/<CODE>.csv` (11 leagues) | odds (Dataset B) |

Not read, by design: `shot`, `lineup`, `event`, `heatmap`, `pass_network_*`, `team_season`,
`player_season`, the current RAPM / finishing / Transfermarkt reports. Line-ups have no publication
timestamp and season aggregates include the future.

## Point-in-time rule and cutoff

`feature_cutoff = kickoff_utc`. A historical observation is usable for a match only if
`historical_kickoff_utc < current_kickoff_utc` (strict), so two matches with the same kick-off never
influence each other. No H−3 scenario exists yet. `kickoff_utc` comes from
`time_utc` (100 % coverage); if it were missing, the date at 00:00 UTC is used and `kickoff_missing`
is set.

Awarded matches are kept: they count for the standings (`usable_for_standings = true`) but never for
goal / xG windows, model training or scoring (`usable_for_model = false`).

Standings are rebuilt incrementally from the results before the kick-off, regular-season matches
only (`stage == regular_season`), with the V1 convention 3/1/0 and tie-breaks points, goal
difference, goals scored, then team id for determinism. Official rules (head-to-head, play-offs,
splits) are **not** encoded: `ranking_rules_approximate` is always true, and cup / play-off rows have
no standings (`standings_available = false`).

## Schema (`MatchReplayRow`)

- **Identity**: `match_id`, `competition`, `season`, `match_date`, `kickoff_utc`, `home_team_id`,
  `away_team_id`, `home_team_name`, `away_team_name`, `stage`, `round_name`.
- **Targets** (post-match, never features): `home_goals`, `away_goals`, `result_1x2` (H/D/A),
  `over_2_5`, `home_xg`, `away_xg`.
- **Features** (`f_home_*`, `f_away_*`, `f_rank_gap`), registry `replay.FEATURES` with window,
  min_periods, missing value, source and cutoff for each:
  points, goals for/against and xG for/against over the last 5 matches, xG over the last 10
  (same competition, all seasons; null + flag below min_periods), matches actually available in the
  window, rest days and matches in the last 8 days (all competitions in the data), rank, points,
  played, goal difference, points per match (standings), promoted (league regular-season rows only:
  absent from the previous regular season of the same league; null elsewhere, never "new entrant" of a
  cup), `advanced_analytics_available` (coverage only: no advanced value is imported). Form windows
  stay inside one competition and cross seasons; `home/away_season_boundary` says when the window
  crosses a season and `home/away_days_since_previous_match` gives the gap inside the competition.
- **Odds** (Dataset B): `odds_snapshot_1x2_{home,draw,away}`, `odds_closing_1x2_*`,
  `odds_snapshot_ou25_{over,under}`, `odds_closing_ou25_*`, the provider of each block, `odds_has_*`
  flags and `odds_semantics`.
- **Quality**: `feature_cutoff`, `kickoff_missing`, `ranking_rules_approximate`,
  `standings_available`, `missing_flags`, `data_quality_flags` (awarded, no_xg, no_standings, stage).

Missing history is stored as null with a flag, never as zero (except counts where zero is exact).

## Odds semantics

football-data.co.uk prices carry no timestamp. The documentation describes a collection "on Friday
afternoons for weekend games, Tuesday for midweek" and defines closing as the last price before
kick-off. Until the official files and notes confirm this, non-closing prices are called
**available odds snapshot** (`snapshot_type = available_snapshot`), never "opening", and no H−24 or
H−6 scenario is derived from them. Columns suffixed `C` are `closing`. Provider priority: market
average, Pinnacle, Bet365 for the snapshot; Pinnacle closing, market average closing, Betfair
Exchange closing (raw price, before commission) for closing. Every imported field is documented in
the manifest (`oddsFields`: source column, provider, snapshot type). Team names are matched through
common matches (competition, date ± 1 day, same score; majority vote, at least 2 votes); the
mapping and every unmatched football-data row are written next to the dataset. No de-vig, edge,
bet, ROI or CLV is computed in this step (a pure power de-vig helper exists for quality checks).

Both-teams-to-score is not provided by football-data; over/under 2.5 exists in the main files only.
Eight ScoutVision competitions have no odds (CRO, CZE, KOR, KSA, SRB, UCL, UEL, UECL).

## Anti-leakage tests (`scripts/test_backtest.py`, run by `npm run test:data`)

1. current match excluded (changing or removing a match never changes its own features);
2. future masked (removing all matches after a cutoff changes nothing before it);
3. closing odds physically absent from the `available_snapshot` feature view, access raises;
4. fit metadata: `fit_end >= prediction_start` raises;
5. incremental standings equal an independent brute-force rebuild at several dates;
6. simultaneous matches do not interact;
7. input row order does not change the canonical output;
8. identity: homonymous teams of different competitions are never merged.

Plus quality invariants (unique ids, different teams, valid kick-off, cutoff before kick-off,
targets consistent with the score, no infinity, serialisable, targets and odds outside the feature
block, no `team_season` / `player_season` / RAPM / Transfermarkt / line-up source).

## Windows

- **W1**: train 2021-22 → 2023-24, validation 2024-25, retrospective evaluation 2025-26. 2025-26 is
  **not** a pristine test season: its results were already observed indirectly through ScoutVision.
- **W2**: training up to 2025-26, predictions for 2026-27 frozen as the season goes, read only when
  it closes. W2 is the main prospective confirmation.
- Weekly refit, expanding window (decided for the later steps; nothing is fitted here).

## Build and reproduction

```bash
npm run research:replay                      # Dataset A from the PitchAPI cache; Dataset B if odds files are present
cd scripts && python3 -m backtest.build --odds-dir /path/to/football-data   # odds read from a local directory
cd scripts && python3 -m backtest.build --download-odds                      # explicit download (CI or a machine with network)
```

Outputs go to `.research/forecast/` (ignored by Git): `replay_pitchapi.parquet`, `replay_with_odds.parquet`
(when odds were joined), their `.meta.json` (schema version, generation time, input hash, logical
hash), `manifest.json`, `odds_unmatched.csv`, `odds_team_mapping.csv`. The input hash covers the
archives (name, size, content), the odds files, the code of `scripts/backtest` and the build
parameters; the logical hash covers the dataset content in canonical order. Two builds from the same
inputs give the same rows, values and hashes. No real parquet, CSV or cache is ever committed; the
tests use fictional teams, matches and odds.

## Limits

No odds timestamps (no "opening", no H−24 / H−6); no line-up timestamps; advanced analytics cover
~30 % of matches before 2024-25 and > 93 % after, so only their availability is stored; domestic
cups are absent from the data, so rest days are overestimated; ESP2, FRA2, ITA2 and POL have two
seasons only; the current ScoutVision forecasts exist for eight months only (Feb.–Oct. 2026) and are
not part of this dataset. No model result is documented here because none was trained.

## Step 2A: sports baselines, walk-forward engine, predictive scoring

`scripts/forecast_models/` (interface `Model.fit(train_rows, context)` / `predict(fixtures)`; every
model returns `p_home`, `p_draw`, `p_away` summing to one, expected goals when it has them, and a
reason when it cannot predict; `uses_odds` is always false) and `scripts/backtest/walk_forward.py`
(weekly refit, training on kick-offs strictly before the week, expanding window; targets never
reach `predict`), `predictions.py` (immutable parquet per season under
`.research/forecast/predictions/`, logical hash without the creation timestamp), `registry.py`
(`forecast_registry.json`, statuses baseline / challenger / incomplete / rejected, no champion),
`scoring.py` (log-loss, RPS, multiclass Brier, raw ECE on 10 bins, accuracy as an annex; over/under
2.5 for goal models; decompositions by season, competition, season third, max-probability bucket and
favourite side; paired block bootstrap date × competition, 2 000 draws, 90 % intervals). Run:
`cd scripts && python3 -m backtest.run_models --phase all`.

Models: league frequencies (hierarchical fallback competition → tier → global), constant home
advantage (global frequencies), ridge multinomial on form features and on standings only
(`lab_market.multinomial_fit` reused), dynamic Elo (pre-registered grid: K 15/25, home advantage
50/80, season regression 0/0.25, margin on/off; logistic link refitted weekly), independent Poisson,
Dixon-Coles (rho by maximum likelihood on the training window), Dixon-Coles with time decay
(half-life grid 90/180/365 days), rolling xG attack/defence (window grid 5/10/20), ScoutVision
reproduced (`models.fit_joint`, 730-day window as in production) and ScoutVision stored
(`reports/forecast_backtest.csv`, read as published). Grid parameters are selected on the 2024-25
validation only; 2025-26 is the "évaluation rétrospective hors ajustement du modèle"; 2026-27
predictions are frozen and not evaluated. Results: `.research/forecast/backtests.json` (no ROI, no
edge, no bet). No post-hoc calibration in this step.

## Step 2B: real market benchmark on the frozen predictions

Nothing from step 2A is re-run or re-tuned: the benchmark reads the frozen prediction parquets. Odds
come from the real football-data.co.uk CSVs, downloaded by the CI workflow `research-odds.yml` (the
runner reaches the domain) and published as `football-data-raw.tar.gz` in the private release
`research-odds` of the data repository; locally they live in `.research/forecast/odds_raw/`
(ignored by Git, never committed). `scripts/backtest/odds.py` audits every file before the join
(`odds_ingestion_manifest.json`: encoding, columns, rows, dates, `Time`, providers per market and
per type, coverage of the retained columns) and classifies every ScoutVision match as
`matched_exact` (same date), `matched_mapped` (date ± 1 day, time-zone shifts), `ambiguous` or
`unmatched` (`join_quality.json`, with the team-name votes and the unmatched football-data rows).

Semantics stay as in step 1: non-closing prices are **available odds snapshot**, suffix `C` is
**closing**. Three 1X2 benchmarks: `market_snapshot_avg`, `market_snapshot_pinnacle` and the
reference `market_closing_pinnacle` with an explicit per-row fallback to the market-average closing
when Pinnacle is missing (`mkt_closing_source`). De-vig: power (main), proportional (sensitivity);
every row keeps the raw implied probabilities, the overround, the de-vig probabilities and the
method (`replay_market.parquet`). The "new" files (ARG, AUT, BRA, DEN, JPN, MEX, NOR, POL, SWE, SUI,
USA) carry closing 1X2 only: no snapshot, no over/under.

`scripts/backtest/market_benchmark.py` compares, on the common population (frozen predictions of
ScoutVision reproduced, Dixon-Coles decay, Elo and xG-20 + market reference + result), log-loss,
RPS, Brier and ECE with the paired block bootstrap of step 2A (date × competition, 2 000 draws),
globally and for Big 5 / other main leagues / "new"-file leagues / each competition; the
logarithmic pool `p ∝ p_model^w · p_market^(1−w)` with `w` chosen on the 2024-25 validation over the
pre-registered grid 0, 0.1, …, 1 and applied unchanged to 2025-26 (`w = 0`: no measurable extra
information on the validation; `0 < w ≤ 0.2`: marginal; `w > 0.2`: measurable complementary
information — descriptive labels, not profitability); divergence buckets |p_model − p_market|
(0–2, 2–5, 5–10, 10–15, 15+ points: counts, mean probabilities, observed frequency, log-loss
differential); the direction of the move from the available snapshot to the closing when the model
sits above or below the snapshot (descriptive, no stake); the over/under 2.5 benchmark for the goal
models against the closing over/under where it exists. Results: `backtests.json`, block
`marketBenchmark`; registry entries `market_*` with `uses_odds = true`. No ROI, no edge, no bet, no
post-hoc calibration.
