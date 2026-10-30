# Laboratory

The Laboratory tests football ideas on match-by-match data and keeps every verdict, including the
negative ones: an idea that does not survive out-of-sample validation is reported as **debunked**,
not removed.

## How it runs

`scripts/prepare_lab.py` (run after `prepare_data.py`, or `npm run data:lab`) reads the match-by-match
tables of every competition (events, lineups with the coach, momentum, pass networks, shots) and runs
the experiments of `scripts/lab.py`. Each one answers a question with a verdict (validated, partial,
debunked, measured); forecasts are always validated on matches or seasons left out of the fit. Results
go to `public/data/lab/` and to the *Laboratoire* page; every number is recomputed at each run.

`npm run test:data` checks each experiment on simulated data: it must find a simulated effect, or
its absence.

## Experiments

| Experiment | Method | Result (Oct. 2026) |
|---|---|---|
| **New-coach bounce** | 10 league matches before / after a mid-season change; post = a + b·pre + c·older level + effect·change; controls = windows without any change (regression to the mean); event study with matched controls | debunked: +0.21 pt/match after a change, but regression to the mean predicts it; own effect −0.004 xGD/match, 95% CI [−0.05; +0.05], 325 changes (an assistant on the bench during a suspension is not a change) |
| **Coach DNA** | style of a coach's new club = a + b·club's previous style + c·coach's style at his previous club, 6 dimensions (possession, field tilt, pressing, build-up, directness, height) | validated: c = 0.21 to 0.34, all CIs above 0, 336 arrivals of 235 coaches; app: coach explorer and arrival simulator |
| **Do results follow the coach?** | performance beyond the team's previous level, correlation between two successive clubs | debunked: r = 0.12, CI [−0.01; 0.24] |
| **Style matchups** | 36 style × style interactions added to a team-strength model of log xG, 5-fold cross-validation by match | debunked: out-of-sample error slightly worse |
| **Fatigue** | xGD beyond strengths and venue with ≤ 3 rest days against an opponent with 6+ | debunked: −0.035, CI [−0.08; +0.01] (domestic cups missing) |
| **Momentum** | does minute-by-minute pressure predict the next goal beyond score, strengths and the last 5 minutes' xG? logistic, validated on the last closed season | validated (modest): better than recent xG; 12 % → 15 % chance of a home goal within 10 min from the weakest to the strongest momentum, without any shot |
| **Goal value** | in-game win probability (Poisson on the remaining share of goals, real goal-time distribution), value = expected points gained | a goal giving the lead is worth 0.93 pt, a 3rd goal when 2 up 0.05; points per goal r = 0.31 season to season; app: leaderboard |
| **The elevator** | players outside the Big 5: transfer to a clearly stronger league next season (logistic: role index, age, minutes, origin league, club strength) | validated: AUC 0.77 out of sample, 36 moves among the top 100 vs 8.7 % on average; app: ranking and live check |
| **Statistical twins** | PECOTA-style: next-season index from the 25 most similar players at the same age | partial: on par with the age curves for under-23s, not better overall |
| **Pass chemistry** | passes of a duo vs volume × positional expectation; odd vs even matches | validated: reliability r = 0.53 over 65,000 duos; app: duos per team |
| **Referees** | cards vs league average, odd vs even matches; penalties; home bias | cards validated (r = 0.58); penalties and home bias debunked; app: shrunk strictness table |
| **Squad clock** | minutes-weighted age effect of the squad vs next-season xGD | validated: +0.042 xGD/match per point, 95% CI [0.012; 0.073] |
| **Set pieces** | share of xG from set pieces, season to season | validated: r = 0.42 |
| **Game management, late strength** | xG share when leading / trailing, xGD after 75', season to season | debunked: r ≤ 0.16 |
| **Luck** | points − xPts between season halves | measured: r = 0.16; first-half xGD predicts second-half points better than points (0.65 vs 0.60) |
| **Red cards** | xG per 90 before / after the first red card | measured: the opponent's xG doubles (1.29 → 2.59) |
| **Availability** | share of the team's matchday squads, season to season | partial: r = 0.19 |
| **Style friction** (exp. 20) | squad profiles on the 9 recruitment dimensions (`utils/recruitment.ts`, league ranks in the departure season) for the club left and the club joined; friction = mean absolute rank gap; coefficient fitted on the training transfers of the transfer model, applied to the league changes of the last closed season (same pairs and same model as the recruitment validation) | partial: friction correlates with the model's absolute error (r = 0.09, 95% CI [0.04; 0.14]) but correcting the projection with it changes nothing: MAE 12.45 → 12.45 (gain 0.00, CI [−0.03; +0.03]) on the 248 of 405 movers whose both clubs have a profile in the departure season; the transfer model stays as it is |
| **Set-piece efficiency** (exp. 22) | goals above xG per set-piece shot (corners, free kicks, long throws, penalties excluded), set-piece xG produced and conceded per match; season to season | partial: finishing above xG on set pieces does not repeat (r = 0.04, 1,382 pairs), the volumes produced (r = 0.42) and conceded (r = 0.43) do |

The table reflects the run of Oct. 2026 (experiments 20 and 22 added on 30 Oct. 2026; the MAE of experiment 20 differs from the 12.18 of the recruitment validation because it is measured on the movers with two squad profiles and on every metric with a percentile); the app always shows the numbers of the latest data
build (`public/data/lab/experiments.json`).

Substitution and coach rankings are deliberately not shown: see
[methodology.md](methodology.md#not-shown-on-purpose).

## Market lab (*Labo marché* page)

`scripts/prepare_market_lab.py` (run after `prepare_data.py`, or `npm run data:lab:market`) runs the
experiments of `scripts/lab_market.py`: can the market be beaten with what ScoutVision already has?
The closing market is the best public forecast there is (pipeline model: pool weight 0, CLV −10.5 %,
[methodology](methodology.md#forecasting)); the lab looks for where it is slow (line-ups), thin
(minor leagues, cups) or blind (what nobody models). Results go to `public/data/lab/market_lab.json`.

Base model: the joint all-competition model (`models.fit_joint`, goals and xG, league levels linked
through cup matches) refitted every week on the matches before that week only, from July 2023: an
out-of-sample 1-X-2 probability for every match (30,448 matches, log-loss 1.005, Oct. 2026). Standard
test of a signal: a multinomial regression (home and away against draw) on the base logits, with and
without the signal, fitted on the earlier seasons and judged on the last closed season (log-loss gain
per match, bootstrap interval by match). With odds: value bets against the opening price judged at the
closing price (CLV), as in `market.py`.

| Experiment | Method | Result (Oct. 2026, test season 2025-26) |
|---|---|---|
| **Calibration** | one temperature constant fitted on the earlier seasons; reliability diagram; draws predicted vs observed by competition | debunked: T = 0.91, gain +0.0003 (CI [−0.0003; +0.0010]), ECE 0.014: the probabilities need no correction |
| **European cups** | joint model vs the 1-X-2 frequencies of earlier cup matches, by season and by tier pair | validated every season: RPS 0.209 vs 0.235 (523 matches); largest gain when a top-tier club meets a minor-league club (+0.050, 637 matches) |
| **Absent starters** | regulars (started 60 % of the season's earlier matches) missing from the eleven; share of the team's passes they carried (network disruption); absentees already absent at the previous match | validated: +0.0008 log-loss per match (CI [+0.0002; +0.0016]), replicated in 2024-25 (+0.0007); the pass share adds nothing beyond the count; absences known before the announcement: +0.0002 (partial) |
| **Probable eleven** | eleven predicted before the announcement: last eleven vs recency-weighted starts | measured: 77 % of the eleven found by the last eleven, 76 % by the weighting; 2.4 regulars missing per match |
| **End-of-season stakes** | leverage of each match (change in P(title / top 4 / relegation) between a win and a loss, 2,000 simulated seasons from the standings of the day, last third of each season), home minus away | validated: +0.0041 (CI [+0.0023; +0.0061]); when only the home team has something to play for it scores +0.21 pt above the base model, when only the away team has, −0.13 pt; 2024-25: +0.0013, partial |
| **Set pieces** | expected set-piece xG (attack of one vs defence of the other, shrunk, earlier matches only) | debunked: +0.0001 (CI [−0.0005; +0.0006]) |
| **Referee × fouls** | logistic red-card model (referee's red rate, teams' cards), AUC; its probability added to the Poisson for over 2.5 and to the 1-X-2 | debunked: AUC 0.59 (referee alone 0.57), over/under +0.0003 (CI [0; +0.0006]), 1-X-2 −0.0003 |
| **Reaction to a conceded goal** | xG in the 10 minutes after conceding vs the team's usual rate; odd vs even matches | debunked: r = 0.00, CI [−0.04; +0.05] (2,453 team-seasons) |
| **Closing as the target** (odds) | regression of the closing logits on the base and opening logits; movement explained, CLV of the closing predictor against the opening | needs football-data.co.uk at build time: not yet run |
| **Bookmaker dispersion** (odds) | model weight and CLV by tercile of disagreement between bookmakers | not yet run |
| **Cross-market coherence** (odds) | expected goals implied by over/under 2.5 and the Asian handicap → implicit 1-X-2 vs the quoted 1-X-2; does the gap predict the move to closing? | not yet run |
| **Accumulated luck** (odds) | points − expected points to date vs the opening market; fade-the-lucky CLV | not yet run |
| **New coach** (odds) | market residual over the new coach's first 5 matches; fade CLV | not yet run |
| **Efficiency map** (odds) | per competition: model weight, log-loss of opening / closing / pool, dispersion, movement, CLV | not yet run |
| **Stack** (odds) | multinomial on base + opening + validated signals (absences, stakes, luck), judged against the recalibrated opening; CLV | not yet run |

The odds experiments are coded and unit-tested on simulated odds (`scripts/test_lab_market.py`); they
run in the data workflow, which can reach football-data.co.uk, and appear on the page once the data
build includes them. Every verdict is recomputed at each data build; the page shows the figures of
the latest `market_lab.json`.
