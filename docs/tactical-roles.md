# Tactical roles

ScoutVision describes players through **27 tactical roles** in 9 categories. The same role
definitions drive the player profile (best roles, header), the Gem Hunter, squad depth,
recruitment, the AI report and the validation of the transfer model.

- Source of truth: [`utils/rolePresets.json`](../utils/rolePresets.json), read by the app
  ([`utils/rolePresets.ts`](../utils/rolePresets.ts)) and by
  [`scripts/models.py`](../scripts/models.py), which validates the role index of the transfer model.
- The former `ROLE_DEFINITIONS` (`utils/scoringUtils.ts`) are deprecated and no longer displayed.

## Categories

| Category | Roles |
|----------|-------|
| Goalkeeper | Gardien sur sa ligne, Gardien libéro, Gardien relanceur |
| Centre back | Défenseur relanceur, Stoppeur, Défenseur d'anticipation, Défenseur porteur |
| Full back / wing back | Latéral offensif, Latéral défensif, Latéral intérieur |
| Defensive midfield | Sentinelle, Regista, Milieu récupérateur |
| Central midfield | Milieu box-to-box, Milieu percuteur, Mezzala |
| Attacking midfield | Numéro 10, Neuf et demi |
| Winger | Ailier de débordement, Attaquant intérieur, Créateur excentré |
| Striker | Renard des surfaces, Pivot, Faux neuf, Attaquant de profondeur, Attaquant presseur |
| Specialist | Créateur sur coups de pied arrêtés |

## How a role is defined

Each role has two levels:

- **Eliminatory criteria** (`metrics`): a minimum role percentile, among players of the same
  role (GK, CB, FB, WB, DM, CM, AM, W, ST) and the same competition level. A player below one
  threshold is not eligible for the role.
- **Ranking criteria** (`weights`): weighted in the role index. A negative weight counts
  "lower is better" (100 − percentile).
- **Positions** (`positions`): the PitchAPI positions eligible for the role.
- **Midfield profiles** (`midfieldProfiles`, 5 roles): midfield profiles learnt by the pipeline
  (k-means on actions); a player with a matching profile gains a bonus.

Eliminatory criteria count with weight **1.5** in the index (`coreWeight`), unless they carry
their own weight. A low "floor" criterion (e.g. *Neuf et demi*: key passes ≥ P40) is eliminatory
but carries its own small ranking weight (0.5), so it does not count 1.5 like a defining criterion.

## Role index

`roleIndex` (`utils/rolePresets.ts`) returns a composite index from 0 to 100:

1. weighted mean of the player's percentiles (same role, same level, same season) over the
   criteria of the role: eliminatory criteria at weight 1.5 (unless they have their own weight),
   ranking criteria at their weight, "lower is better" counted as 100 − percentile;
2. missing percentiles are ignored and the weights are recomputed;
3. +5 if the midfield profile matches (`midfieldProfileBonus`);
4. rounded and capped at 100.

It is a **composite index, not a percentile rank**. The calculation is identical in the player
profile, the Gem Hunter and recruitment.

`roleIndexBreakdown` returns the same total, term by term (metric, percentile, weight, share,
contribution, eliminatory or ranking criterion, bonus). It powers the "why this player?" panel of
the Gem Hunter. `rankPresets` ranks the official roles compatible with a player's position, as
shown in the player profile.

## Gem Hunter

`filterProspects` (`utils/prospects.ts`) applies three conjunctive steps, counted in the
selection funnel:

1. position compatible with the role;
2. constraints: age, Transfermarkt value, contract, estimated value vs market
   (estimate ≥ 1.5 × market value), minutes, competition;
3. eliminatory criteria of the role: percentile ≥ effective threshold
   (base threshold × strictness, capped at 99).

Eligible players are then ranked by decreasing role index.

Missing data is never read as zero: a missing percentile on an eliminatory criterion makes the
player ineligible and is counted apart ("insufficient data"), never as P0; a missing market value
is never read as €0. Constraints that the season cannot evaluate (no value, contract or estimate
in the data) do not apply and are disabled in the interface.

Custom roles can be created in the Gem Hunter. They are stored in the browser (versioned local
storage, validated on load) and can never replace an official role.

## The 27 roles

Generated from `utils/rolePresets.json` (Oct. 2026 calibration). Metric names are the data keys
of `public/data/players/<season>.json`. "Own weight" marks an eliminatory criterion that does not
count 1.5. The JSON file remains the source of truth.

### Goalkeeper

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Gardien sur sa ligne** | GK | Prevented goals per 90 ≥ P65; Save rate, % ≥ P60 | Saves per 90 +0.5; High claims per 90 +0.5; Claim rate, % +0.5; Punches per 90 +0.3 |
| **Gardien libéro** | GK | Exits per 90 ≥ P60; Accurate long passes, % ≥ P55; Prevented goals per 90 ≥ P45 (own weight 0.5) | Passes per 90 +1; Accurate passes, % +1; High claims per 90 +0.5; Launch rate, % −0.5 |
| **Gardien relanceur** | GK | Accurate passes, % ≥ P65; Passes per 90 ≥ P70 | Launch rate, % −1; xG buildup per 90 +1; Prevented goals per 90 +0.5 |

### Centre back

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Défenseur relanceur** | CB | Progressive passes per 90 ≥ P70; Accurate passes, % ≥ P60; Passes to final third per 90 ≥ P60 | Accurate long passes, % +1; Switches per 90 +0.5; xG buildup per 90 +1; Pass share, % +1; Ground duels won, % +0.5 |
| **Stoppeur** | CB | Aerial duels won, % ≥ P65; Ground duels won, % ≥ P60; Clearances per 90 ≥ P55 | Shots blocked per 90 +1; PAdj Tackles +1; Aerial duels per 90 +1; Dribbled past per 90 −1; Fouls per 90 −0.5 |
| **Défenseur d'anticipation** | CB | PAdj Interceptions ≥ P70; PAdj Recoveries ≥ P60 | Ground duels won, % +1; Accurate passes, % +0.5; Progressive passes per 90 +0.5; Dribbled past per 90 −1 |
| **Défenseur porteur** | CB | Progressive runs per 90 ≥ P70; Progressive carry distance per 90 ≥ P65; Ground duels won, % ≥ P30 (own weight 0.5) | Carries into final third per 90 +1; Progressive passes per 90 +1; Dispossessed per 90 −0.5 |

### Full back / wing back

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Latéral offensif** | FB, WB | Progressive runs per 90 ≥ P65; Crosses per 90 ≥ P60; xA per 90 ≥ P60 | Carries into final third per 90 +1; Key passes per 90 +1; Touches in box per 90 +0.5; Dribbles per 90 +0.5; Ground duels won, % +0.5 |
| **Latéral défensif** | FB, WB | Ground duels won, % ≥ P65; PAdj Tackles ≥ P60; PAdj Interceptions ≥ P55 | Aerial duels won, % +1; Dribbled past per 90 −1.5; Accurate passes, % +0.5; Fouls per 90 −0.5 |
| **Latéral intérieur** | FB, WB | Passes per 90 ≥ P65; Accurate passes, % ≥ P65; Progressive passes per 90 ≥ P60 | Pass share, % +1; xG buildup per 90 +1; Passes to final third per 90 +1; PAdj Interceptions +0.5 |

### Defensive midfield

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Sentinelle** | DM, CM | PAdj Interceptions ≥ P65; PAdj Tackles ≥ P60; Ground duels won, % ≥ P60 | Accurate passes, % +1; Aerial duels won, % +0.5; Dispossessed per 90 −1; Fouls per 90 −0.5; midfield profile bonus: sentinelle |
| **Regista** | DM, CM | Progressive passes per 90 ≥ P70; Passes per 90 ≥ P65; Accurate passes, % ≥ P65 | Accurate long passes, % +1; Switches per 90 +1; xG buildup per 90 +1.5; Pass share, % +1; midfield profile bonus: organisateur |
| **Milieu récupérateur** | DM, CM | PAdj Recoveries ≥ P65; Duels won per 90 ≥ P65; PAdj Tackles ≥ P60 | Ground duels won, % +1; VAEP defensive per 90 +1; Fouls per 90 −0.5; midfield profile bonus: sentinelle, box-to-box |

### Central midfield

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Milieu box-to-box** | CM, DM | Progressive runs per 90 ≥ P60; Successful defensive actions per 90 ≥ P60; Touches in box per 90 ≥ P55 | xG per 90 +1; Shot-creating actions per 90 +1; Duels won per 90 +1; Carries into final third per 90 +0.5; midfield profile bonus: box-to-box |
| **Milieu percuteur** | CM, AM | Dribbles per 90 ≥ P70; Progressive runs per 90 ≥ P70; Successful dribbles, % ≥ P45 | Carries into final third per 90 +1; Fouls suffered per 90 +1; xT per 90 +1; Dispossessed per 90 −0.5 |
| **Mezzala** | CM, AM | Touches in box per 90 ≥ P60; Key passes per 90 ≥ P60; Progressive runs per 90 ≥ P60 | xG per 90 +1; xA per 90 +1; Shot-creating actions per 90 +1; Carries into box per 90 +0.5 |

### Attacking midfield

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Numéro 10** | AM, CM | Key passes per 90 ≥ P70; xA per 90 ≥ P70; xT per 90 ≥ P60 | Through passes per 90 +1; Passes to penalty area per 90 +1; Big chances created per 90 +1; Shot-creating actions per 90 +1; midfield profile bonus: meneur offensif |
| **Neuf et demi** | AM, ST | xG per 90 ≥ P70; Touches in box per 90 ≥ P65; Shots per 90 ≥ P60; Key passes per 90 ≥ P40 (own weight 0.5) | Goals per 90 +1; npxG per 90 +1; Carries into box per 90 +0.5; xA per 90 +0.5 |

### Winger

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Ailier de débordement** | W, WB | Dribbles per 90 ≥ P70; Crosses per 90 ≥ P60; Progressive runs per 90 ≥ P65 | Successful dribbles, % +1; Accurate crosses, % +1; Carries into final third per 90 +1; xA per 90 +1 |
| **Attaquant intérieur** | W | npxG per 90 ≥ P70; Shots per 90 ≥ P65; Touches in box per 90 ≥ P65 | Dribbles per 90 +1; Carries into box per 90 +1; Goals per 90 +1; xGOT per 90 +0.5 |
| **Créateur excentré** | W | Key passes per 90 ≥ P70; xA per 90 ≥ P70; Passes to penalty area per 90 ≥ P60 | Shot-creating actions per 90 +1; xT per 90 +1.5; Through passes per 90 +0.5; Big chances created per 90 +1 |

### Striker

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Renard des surfaces** | ST | npxG per 90 ≥ P75; Touches in box per 90 ≥ P70; Goals per 90 ≥ P65 | xGOT per 90 +1; Shots on target per 90 +1; Big chances missed per 90 −0.5 |
| **Pivot** | ST | Aerial duels per 90 ≥ P70; Aerial duels won, % ≥ P60; Fouls suffered per 90 ≥ P55 | Duels won per 90 +1; xA per 90 +0.5; Key passes per 90 +0.5; Touches in box per 90 +0.5 |
| **Faux neuf** | ST | Key passes per 90 ≥ P65; Shot-creating actions per 90 ≥ P65; Passes per 90 ≥ P70 | xA per 90 +1; Progressive passes per 90 +1; xT per 90 +1; xG per 90 +0.5 |
| **Attaquant de profondeur** | ST | Progressive runs per 90 ≥ P70; Carries into box per 90 ≥ P65; xG per 90 ≥ P60 | Dribbles per 90 +1; Touches in box per 90 +1; Goals per 90 +0.5 |
| **Attaquant presseur** | ST, W | PAdj Recoveries ≥ P60; Successful defensive actions per 90 ≥ P60; xG per 90 ≥ P45 | Duels won per 90 +1; VAEP defensive per 90 +1; Fouls suffered per 90 +0.5 |

### Specialist

| Role | Positions | Eliminatory criteria (minimum percentile) | Ranking criteria (weight) |
|---|---|---|---|
| **Créateur sur coups de pied arrêtés** | AM, CM, W, ST, FB, WB | Big chances created per 90 ≥ P70; Key passes per 90 ≥ P65; Accurate crosses, % ≥ P60 | Shot-creating actions per 90 +1; xA per 90 +1; Crosses per 90 +0.5 |

## Calibration of Oct. 2026

Audit of the 27 roles on 2025-26 and 2026-27: *Gardien libéro*, *Gardien relanceur*,
*Défenseur porteur*, *Milieu percuteur*, *Numéro 10*, *Neuf et demi*, *Créateur excentré*
(wingers only), *Faux neuf* (strikers only) and *Attaquant presseur* were recalibrated;
*Attaquant de profondeur* and *Créateur sur coups de pied arrêtés* only changed description
(off-ball runs and set pieces are not in the data).

Revalidated with the full pipeline (Oct. 28): the transfer model's coefficients do not depend on
the presets and the recruitment validation barely moves (index error 12.25 → 12.18, rank
0.529 → 0.525). The published `scoutvision-data` archive was rebuilt by the data workflow with
these presets; its validation is identical to the local run. Per-role results are in
[recruitment-model.md](recruitment-model.md#out-of-sample-validation).

## Limitations

- Percentiles are computed per role and per competition level (PitchAPI tiers), not per
  competition: a percentile compares a player with his group, not with every player.
- The role index is a composite of percentiles, not a rating of overall ability.
- Off-ball runs and set pieces are not isolated in the data: *Attaquant de profondeur* and
  *Créateur sur coups de pied arrêtés* describe what the data can measure (carries towards the
  box, chances created from crosses).
- The validation of the transfer model (`scripts/models.py`, `role_index`) uses the same weights
  but neither the eliminatory thresholds nor the midfield profile bonus, and does not round.
- Per-role validation samples are small (37 to 111 movers per role): differences under about
  1 point of error are noise.
