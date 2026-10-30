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
