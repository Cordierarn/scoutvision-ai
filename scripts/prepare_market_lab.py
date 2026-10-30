"""
ScoutVision AI - Préparation des données du Labo marché

Lance les expériences de scripts/lab_market.py (peut-on battre le marché avec ce que ScoutVision
possède déjà ?) sur les tables match par match de toutes les compétitions (cache PitchAPI de
prepare_data.py) et, quand football-data.co.uk est joignable, sur les cotes d'ouverture et de
clôture de toutes les saisons disponibles. Écrit :

  public/data/lab/market_lab.json   verdicts et chiffres de toutes les expériences

Usage : python scripts/prepare_market_lab.py        (après scripts/prepare_data.py)
        --no-odds : sans cotes (expériences hors marché seulement)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import lab_market as lm
import market
from prepare_data import CACHE_DIR, OUT_DIR, write_json
from prepare_lab import COLUMNS, plain, read_all

LAB_DIR = OUT_DIR / "lab"
BASE_START = pd.Timestamp("2023-07-01")      # premières prévisions hors échantillon (deux saisons d'historique avant)
ODDS_SEASONS = ["2122", "2223", "2324", "2425", "2526", "2627"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-odds", action="store_true", help="ne pas charger les cotes football-data")
    args = parser.parse_args()
    t0 = time.time()
    index = json.loads((OUT_DIR / "index.json").read_text(encoding="utf-8"))
    cups = {c["key"] for c in index["competitions"] if c.get("type", "league") != "league"}
    tiers = {c["key"]: int(c.get("tier", 2)) for c in index["competitions"]}
    current = max(s["id"] for s in index["seasons"])
    closed = sorted(s["id"] for s in index["seasons"] if s["id"] != current)
    test_season, previous = closed[-1], closed[-2]

    print("Lecture des tables match par match...", flush=True)
    COLUMNS["event"] |= {"is_cancelled"}
    T = read_all()
    mf = lm.match_frame(T["match"], T["team_match"], cups)
    team_league = lm.domestic_leagues(mf)
    print(f"  {len(mf)} matchs ({time.time() - t0:.0f}s)", flush=True)

    print("Modèle de base (réajusté chaque semaine)...", flush=True)
    base_df = lm.rolling_base(mf, team_league, BASE_START)
    d = mf.merge(base_df, on="match_id", how="left")
    base = d[["p_home", "p_draw", "p_away"]].to_numpy(float)
    rates = d[["lh", "la"]].to_numpy(float)
    out = d["outcome"].to_numpy()
    covered = ~np.isnan(base).any(axis=1)
    print(f"  {int(covered.sum())} matchs avec probabilités hors échantillon, log-loss "
          f"{lm.log_loss(base[covered], out[covered]).mean():.4f} ({time.time() - t0:.0f}s)", flush=True)

    experiments: dict = {}
    print("Calibration, coupes...", flush=True)
    experiments["calibration"] = {s: lm.calibration(d, base, s) for s in (previous, test_season)}
    experiments["cups"] = lm.cups_strength(d, base, tiers, team_league, cups)

    print("Compositions : absents, rupture de réseau, onze probable...", flush=True)
    feat_abs = lm.absence_features(T["lineup"], T["pass_network_edge"], d)
    experiments["absences"] = {s: lm.absences(d, base, feat_abs, s) for s in (previous, test_season)}

    print("Coups de pied arrêtés, cartons rouges, réaction au but...", flush=True)
    feat_sp = lm.set_piece_features(T["shot"], d)
    experiments["setPieces"] = {s: lm.set_piece_signal(d, base, feat_sp, s) for s in (previous, test_season)}
    feat_red = lm.red_card_features(d, T["event"])
    experiments["redCards"] = {s: lm.red_cards(d, rates, base, feat_red, s) for s in (previous, test_season)}
    experiments["goalReaction"] = lm.goal_reaction(d, T["event"], T["shot"])

    print("Enjeu de fin de saison (simulations)...", flush=True)
    feat_stakes = lm.stakes_features(d, base_df)
    experiments["stakes"] = {s: lm.stakes(d, base, feat_stakes, s) for s in (previous, test_season)}

    market_block: dict = {"available": False}
    if not args.no_odds:
        print("Cotes football-data (toutes saisons)...", flush=True)
        try:
            odds = lm.load_odds(CACHE_DIR / "football-data", ODDS_SEASONS, market.MAIN_LEAGUES, market.EXTRA_LEAGUES, market.fetch_csv)
        except Exception as e:                   # noqa: BLE001 - source externe
            print(f"  cotes indisponibles : {e}")
            odds = pd.DataFrame()
        if not odds.empty:
            mapping = market.map_teams(odds, d[["competition", "date", "home", "away", "goals_home", "goals_away"]])
            joined = lm.join_odds(d, odds, mapping)
            dd = d[["match_id"]].merge(joined, on="match_id", how="left")
            od = lm.odds_arrays(dd)
            has = ~np.isnan(od["close"]).any(axis=1)
            print(f"  {int(has.sum())} matchs avec cotes de clôture, {len(mapping)} équipes reconnues", flush=True)
            train, test = lm.split_seasons(d, test_season)
            feat_luck = lm.luck_features(d)
            feat_coach = lm.coach_change_features(T["lineup"], d)
            signals = {
                "missing": lm._side_signal(d, feat_abs, "missing"),
                "stakes": lm._side_signal(d, feat_stakes, "leverage"),
            }
            f = feat_luck.set_index(["match_id", "team_id"])["luck_to_date"]
            signals["luck"] = (pd.Series(list(zip(d["match_id"], d["home"]))).map(f).to_numpy(float)
                               - pd.Series(list(zip(d["match_id"], d["away"]))).map(f).to_numpy(float))
            market_block = {
                "available": True, "matches": int(has.sum()), "teamsMapped": len(mapping),
                "period": [str(dd.loc[has, "match_id"].map(d.set_index("match_id")["date"]).min().date()),
                           str(dd.loc[has, "match_id"].map(d.set_index("match_id")["date"]).max().date())],
                "closingTarget": lm.closing_target(d, base, od, out, train, test),
                "dispersion": lm.dispersion(d, base, od, out, train, test),
                "coherence": lm.market_coherence(dd, od, out, train, test),
                "luck": lm.luck_market(d, od, feat_luck, out, train, test),
                "coach": lm.coach_market(d, od, base, feat_coach, out, train, test),
                "efficiency": lm.efficiency_map(d, base, od, out, train, test),
                "stack": lm.stack(d, base, od, signals, out, train, test),
            }
    experiments["market"] = market_block

    write_json(LAB_DIR / "market_lab.json", {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "matches": int(len(d)), "covered": int(covered.sum()), "baseStart": str(BASE_START.date()),
        "current": current, "testSeason": test_season, "previousSeason": previous,
        "baseLogLoss": round(float(lm.log_loss(base[covered], out[covered]).mean()), 4),
        "experiments": plain(experiments),
    })
    for name, e in experiments.items():
        v = e.get("verdict") if isinstance(e, dict) and "verdict" in e else \
            {k: x.get("verdict") for k, x in e.items() if isinstance(x, dict) and "verdict" in x}
        print(f"  {name:14s} {v}")
    print(f"Écrit dans {LAB_DIR / 'market_lab.json'} ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
