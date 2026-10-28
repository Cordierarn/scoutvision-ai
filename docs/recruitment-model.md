# Recruitment model

The *Recruitment* tab of Team Analysis turns a team's real starting eleven into needs, then
projects candidates into that team. The output is a **shortlist for video and scouting, not a
verdict**.

Code: `utils/recruitment.ts`, `utils/lineup.ts`, `components/RecruitmentPanel.tsx` (app);
`scripts/models.py` (`transfer_model`, fitted by `scripts/prepare_data.py`, written to
`public/data/models/transfer.json`).

## Team needs

Real starting eleven of the most used formation (maximum-weight assignment of the lineup slots);
each starter in his best role, projected one season ahead and ranked among the league players
eligible for that role; contract end, expected decline and lack of cover are flagged.

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
  club joined.
- **Adaptation**: a cost per metric for a league change or a club change.
- **Fit**: consecutive seasons at the same role, weighted by minutes.

## Suggestions

Role index recomputed on projected percentiles, compared with the starter projected in the same
role.

- **Complementarity**: the line partner's weak metrics (below the 35th percentile) count in the
  index.
- **Filters**: age, Transfermarkt value, minutes, contract, leagues.
- **Value for money**: frontier of candidates such that no other candidate is both better and
  cheaper.

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
  for the current season only (see [data-format.md](data-format.md#transfermarkt)).
- Models are fitted on the seasons being prepared: run `prepare_data.py` without `--seasons` for
  the full fit.
