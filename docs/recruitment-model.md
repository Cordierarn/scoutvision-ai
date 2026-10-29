# Recruitment model

The *Recruitment* page (opened from Team Analysis) turns a team's real starting eleven into needs, then
projects candidates into that team. The output is a **shortlist for video and scouting, not a
verdict**.

Code: `utils/recruitment.ts`, `utils/lineup.ts`, `utils/teamLineups.ts`, `components/RecruitmentPanel.tsx` and
`components/recruitment/` (app);
`scripts/models.py` (`transfer_model`, fitted by `scripts/prepare_data.py`, written to
`public/data/models/transfer.json`).

## Team needs

Real starting eleven (maximum-weight assignment of the lineup slots); each starter in his best
role, projected one season ahead and ranked among the league players eligible for that role;
contract end, expected decline and lack of cover are flagged.

- **Formation used for needs** (`recruitmentFormation`, `utils/teamLineups.ts`): the most used
  formation that gives an exploitable eleven (at least 11 placed slots: complete, or irregular
  after merging duplicated slots). Team Analysis still shows the most used formation as it is
  (e.g. *3-2-4-1 · 7 matchs · Incomplète*); when it has slots without coordinates, Recruitment
  falls back to the next one and says so (*Formation 3-2-4-1 insuffisamment renseignée. Analyse
  des besoins basée sur 4-1-4-1.*). Measured: one team-season per season at most (Crvena Zvezda
  2026-27, Radnički Niš 2024-25). In both cases the SRB player rows of that team all carry
  `Position = GK` (percentiles computed among goalkeepers): the needs of the outfield slots are
  shown as *à évaluer* with a data warning, never computed from goalkeeper percentiles.
- **Position searched**: the starter's registered position, except when he is manifestly out of
  position in the formation (`isManifestlyOutOfPosition`: two lines or more apart, or a
  goalkeeper on one side only, wing-backs excluded). The slot position read from the formation
  (`formationPositions`) then sets the position searched, and the need is *à évaluer*: his
  percentiles are computed among the players of his registered position, so his index is not
  comparable with the slot's role. Wing-backs are hybrid (full-back or winger depending on the
  system): winger ↔ wing-back gaps are consistent profiles, not position errors. Measured on
  2025-26: 48 slots two lines or more apart; 15 follow the formation (6 FB→W, 5 W→FB, 2 W→FB and
  1 CB→ST without a regular starter, 1 FB→ST), 33 involve a wing-back and are kept; no midfielder
  moves. A slot without any player data takes the formation position rather than its geometry.
- **One incumbent**: the need row, the decision chain, the metric comparison and the gain use the
  same projection of the starter (`incumbentForecast`): exactly the need's forecast in his best
  role, the same calculation in another chosen role, never with complementarity.
- **Market data by season**: `market.json` is a Transfermarkt snapshot of the current season
  (value, contract end, ScoutVision estimate at the scrape date). `seasonMarket` applies it only
  to a season whose player rows carry these fields (`seasonCapabilities`, as in the Gem hunter):
  2026-27 (and the 2026 calendar seasons it contains), never 2021-22 to 2025-26. A past season has
  no value, contract, estimate, value/performance frontier, *contrat ≤ 12 mois* or
  *marché < estimation* signal, in Recruitment and in Team Analysis (squad depth). Ages and
  percentiles are always those of the season analysed.

## Squad profile

Minutes-weighted mean of the players' role percentiles on 9 dimensions (finishing, creation,
progression, dribbling, ball security, ground duels, aerial play, recovery, goalkeeping), ranked
among the league's teams.

## Transfer projection

Percentile expected next season at the recruiting club:

```
projected percentile = age-curve projection
                     + λ_metric × (level of the league left − level of the league joined)
                     + τ_metric × change in field tilt
                     + adaptation cost (league change or club change)
```

- **Age-curve projection**: one-season change of role percentiles, regression to the mean
  separated from the age effect (see [methodology.md](methodology.md#development)).
- **League levels**: one level per league shared by all metrics (alternating least squares,
  shrunk towards the PitchAPI tier mean). PitchAPI percentiles are computed per tier, so a level
  is a translation, not a strength ranking.
- **Team context**: τ<sub>metric</sub> × change in field tilt between the club left and the
  club joined. When either field tilt is unknown (absent or `null` in the data), the term is 0
  and the candidate is flagged *Contexte équipe indisponible* (all of 2021-22 for most leagues,
  J1 League and K League 1 in 2024 and 2025). Before Oct. 2026 a `null` field tilt of the
  recruiting team was read as 0, which shifted projections by up to about 20 points (2021-22).
  The term is not capped: a term of at least 12 index points (`CONTEXT_EFFECT_NOTABLE`, about the
  95th percentile of |context| over 115,812 candidate evaluations, 12 teams, 2025-26 and 2026-27;
  4.8 % flagged) is shown as *Effet de contexte important*. Goalkeepers are the most sensitive
  (median 3.6 points, 95th percentile 22.8, 20 % at 12 or more, against 0.9 % for forwards): the
  goalkeeping metrics depend on how many shots the team concedes.
- **Adaptation**: a cost per metric for a league change or a club change.
- **Fit**: consecutive seasons at the same role, weighted by minutes.

## Suggestions

Role index recomputed on projected percentiles (the role weights only), compared with the
starter projected in the same role. Candidates are ranked by this sports projection.

- **Complementarity** (separate reading): the line partner's weak metrics (below the 35th
  percentile, up to 3) and, for each candidate, his projected percentile on each of them. Nothing
  is added to the projection or to the ranking; sorting by complementarity only reorders the best
  projections. Before Oct. 2026 these metrics were added to the index: on 67 slots of 8
  team-seasons, the top 10 shared on average 5.8 players with today's ranking (minimum 1), and
  the first candidate was the same in 25 cases.
- **Filters** (hard constraints, counted as a funnel): position, minutes, age, leagues, budget,
  contract; players excluded only for a missing age, value or contract, for insufficient data or
  for a filter that needs the transfer model are counted apart.
- **Value / performance frontier** (Pareto): A dominates B when A's projection is at least as
  high for a Transfermarkt value at most as high, and strictly better on one of the two. Efficient
  candidates are those no one dominates; two identical candidates are both efficient. A reading,
  not a commercial verdict.
- **Uncertainty**: the historical mean absolute error of the index projection (out-of-sample
  validation: 12.18 points on 405 league changes, 11.78 on 278 club changes within a league),
  shown next to the projection, never as an interval. The gain over the starter is a difference
  of two projections; no error propagation is computed.
- **Display**: the projection cascade (current index, regression, age, league, context,
  adaptation, projected index) is shown to one decimal with cumulative rounding, so the displayed
  steps add up exactly to the displayed projection; the calculation is unchanged.

## Page

Need → candidates → projection → explanation → complementarity → value → uncertainty.

- **Layout**: from 1,280 px, master / detail: needs, constraints and the candidate list on the left,
  the selected candidate's file on the right (sticky). Below, three steps at full width (needs,
  candidates, file); choosing a candidate opens the file and moves the focus to it.
- **Need**: position searched, formation, starter, role, then his measures (current index,
  projection, league rank) apart from his signals (contract, rotation, age, cover).
- **Funnel** (`CandidateFunnel`): real counts at each hard constraint (league players, position,
  minutes, age, leagues, budget, contract, projectable), exclusions for a missing age, value or
  contract, insufficient data or missing model counted apart. Nothing is estimated.
- **Constraints** (age, minutes, leagues, budget, contract) filter; **preferences** (order,
  complementarity, off by default) only reorder the best projections, and the page says so.
- **List**: 20 candidates, 20 more on demand (100 kept); rows open the file with Enter or Space.
  The value / performance scatter is an alternative view of the same list, mounted once its
  width is measured; the list carries all its information.
- **Candidate file** (`CandidateView`): A identity and actions (player card, compare with the
  starter, watchlist), B sports projection with the historical error always shown, C cascade,
  D projected metrics against the starter, E complementarity, F value (current season only),
  G signals and limits. No overall score. Risk (injuries), finance (total cost, amortisation)
  and regulation (UEFA, squad rules) are planned as separate blocks and are not implemented:
  no validated data or model.
- **Performance** (CPU ×4, median of 3, real data): choosing a candidate 780 → 372 ms, a scatter
  point 784 → 272 ms, a position 1,427 → 952 ms, a team 2,236 → 1,094 ms. Choosing a candidate
  recomputes nothing: needs, constraints and the scatter are memoised components with stable
  callbacks; only the list selection and the file render.

## Out-of-sample validation

Recomputed by every `prepare_data.py` run (`models/transfer.json`, shown in the app under
*Méthode et fiabilité*). Validation on the last closed season, left out of the fit (age curves
included).

**Recruitment validation** (Oct. 2026, test season 2025-26, absent from the fit, 405 league
changes, role presets of the Oct. 2026 calibration):

| Role index | Transfer model | Age curves alone | Current index kept |
|---|---|---|---|
| Mean absolute error (points) | 12.18 | 13.88 | 16.79 |
| Rank correlation with the index actually reached | 0.525 | 0.359 | 0.347 |
| Bias of players moving up a level | +1.33 | +6.91 | +9.81 |
| Bias of players moving down a level | −0.18 | −5.35 | −6.99 |

- **Per metric** (does not depend on the presets): 21.7 vs 26.1 percentile points, bias moving
  up +0.0 vs +6.7.
- **With the previous presets**: 12.25 / 13.96 / 16.88, rank 0.529, bias +1.38 / −0.27.
- **Per role** the error is uneven (about 8 to 16 points on 37 to 111 movers per role, so
  differences under about 1 point are noise); it rose for *Créateur excentré* (15.2 → 16.2) and
  *Faux neuf* (12.9 → 13.5), now evaluated on wingers and strikers only (52 and 54 movers instead
  of 82 and 84), and for *Gardien libéro* (11.7 → 12.3, 42 goalkeepers); it fell for
  *Gardien relanceur* (15.9 → 14.6) and *Neuf et demi* (15.5 → 14.6).

## Limitations

- A role index still moves by about 12 points from one season to the next: suggestions are a
  shortlist for video and scouting, not a verdict.
- League levels are translations between PitchAPI tiers, not a strength ranking of leagues.
- The validation computes the role index without the eliminatory thresholds and the midfield
  profile bonus (see [tactical-roles.md](tactical-roles.md#limitations)).
- Transfermarkt market value and contract end are a current snapshot; the estimated value exists
  for the current season only (see [data-format.md](data-format.md#transfermarkt)). The
  ScoutVision estimate is a statistical value estimate, not a transfer price.
- Models are fitted on the seasons being prepared: run `prepare_data.py` without `--seasons` for
  the full fit.
