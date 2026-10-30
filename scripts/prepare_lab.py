"""
ScoutVision AI - Préparation des données du Laboratoire

Lance les expériences de scripts/lab.py sur les tables match par match de toutes les
compétitions (archives PitchAPI, déjà en cache après prepare_data.py) et sur les fichiers
écrits par prepare_data.py (joueurs, courbes d'âge, modèle de transfert), puis écrit :

  public/data/lab/experiments.json   verdicts et chiffres de toutes les expériences
  public/data/lab/coaches.json       périodes d'entraîneur et style, empreinte des entraîneurs
  public/data/lab/elevator.json      probabilité de jouer dans un championnat plus fort
  public/data/lab/goals.json         valeur des buts en points, par joueur et par saison
  public/data/lab/duos.json          affinités de passe des duos, par équipe et par saison
  public/data/lab/referees.json      sévérité des arbitres
  public/data/lab/teams.json         vieillissement des effectifs, coups de pied arrêtés

Usage : python scripts/prepare_lab.py        (après scripts/prepare_data.py)
"""

from __future__ import annotations

import io
import json
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

import lab
import models
from prepare_data import (OUT_DIR, ROLE_PRESETS, app_season, columnar, download, list_table_assets,
                          write_json)

LAB_DIR = OUT_DIR / "lab"

# Colonnes lues par table (le reste des archives n'est pas chargé)
COLUMNS = {
    "match": {"match_id", "match_status", "date", "home_team_id", "home_team_name", "away_team_id", "away_team_name",
              "score_home", "score_away", "referee"},
    "team_match": {"match_id", "date", "team_id", "team_name", "opponent_id", "is_home", "goals_for", "goals_against",
                   "xg_for", "xg_against"} | {c for c, _ in lab.STYLE.values()},
    "event": {"match_id", "event_type", "team_id", "player_id", "player_name", "minute", "minute_added", "period", "seq",
              "credited_side", "is_cancelled", "is_penalty"},
    "lineup": {"match_id", "team_id", "coach_name", "player_id", "role", "pitch_y"},
    "momentum": {"match_id", "minute", "value"},
    "shot": {"match_id", "team_id", "minute", "period", "expected_goals", "situation", "event_type"},
    "player_match": {"match_id", "team_id", "player_id", "player_name", "position_role"},
    "pass_network_edge": {"match_id", "team_id", "from_player_id", "to_player_id", "passes"},
}


def cached_table_assets() -> dict[tuple[str, str], tuple[str, str, int | None]]:
    """Archives déjà présentes dans le cache (sans GitHub) : une saison close prime sur data-v2-current."""
    from prepare_data import CACHE_DIR, TABLES_ASSET
    assets: dict[tuple[str, str], tuple[str, str, int | None]] = {}
    tags = sorted((d.name for d in CACHE_DIR.iterdir() if d.is_dir() and d.name.startswith("data-v2-")), key=lambda t: t == "data-v2-current")
    for tag in tags:
        for path in sorted((CACHE_DIR / tag).glob("tables-*.tar")):
            m = TABLES_ASSET.match(path.name)
            if not m or m.group("comp") == "ALL":
                continue
            assets.setdefault((m.group("comp"), m.group("season")), (tag, path.name, None))
    return assets


def read_all() -> dict[str, pd.DataFrame]:
    """Tables de toutes les archives compétition x saison, colonnes utiles seulement.
    Sans accès GitHub, les archives déjà en cache sont lues telles quelles."""
    frames: dict[str, list[pd.DataFrame]] = {t: [] for t in COLUMNS}
    try:
        assets = list_table_assets()
    except Exception as error:   # noqa: BLE001 - gh absent, hors ligne ou jeton invalide
        assets = cached_table_assets()
        print(f"  GitHub inaccessible ({type(error).__name__}) : {len(assets)} archives lues depuis le cache", flush=True)
    for (comp, raw_season), (tag, name, size) in sorted(assets.items()):
        with tarfile.open(download(tag, name, size)) as tar:
            for member in tar.getmembers():
                table = member.name.split("/", 1)[0]
                if table not in COLUMNS or not member.name.endswith(".parquet"):
                    continue
                pf = pq.ParquetFile(io.BytesIO(tar.extractfile(member).read()))
                cols = [c for c in pf.schema_arrow.names if c in COLUMNS[table]]
                df = pf.read(columns=cols).to_pandas()
                df.insert(0, "comp", comp)
                df.insert(1, "app_season", app_season(raw_season))
                frames[table].append(df)
    return {t: pd.concat(f, ignore_index=True) for t, f in frames.items() if f}


def read_players() -> pd.DataFrame:
    """Joueurs écrits par prepare_data.py : une ligne par joueur et par saison (championnat le plus joué)."""
    index = json.loads((OUT_DIR / "index.json").read_text(encoding="utf-8"))
    frames = []
    for s in index["seasons"]:
        d = json.loads((OUT_DIR / "players" / f"{s['id']}.json").read_text(encoding="utf-8"))
        frames.append(pd.DataFrame(d["rows"], columns=d["columns"]).assign(_app_season=s["id"]))
    p = pd.concat(frames, ignore_index=True)
    cups = {c["key"] for c in index["competitions"] if c.get("type", "league") != "league"}
    p = p[~p["Competition"].isin(cups)]
    return p.sort_values("Minutes played", ascending=False).drop_duplicates(["Player ID", "_app_season"])


def plain(value):
    """Objet JSON strict : scalaires numpy convertis, NaN et infinis remplacés par None."""
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def main() -> int:
    t0 = time.time()
    index = json.loads((OUT_DIR / "index.json").read_text(encoding="utf-8"))
    cups = {c["key"] for c in index["competitions"] if c.get("type", "league") != "league"}
    current = max(s["id"] for s in index["seasons"])
    transfer = json.loads((OUT_DIR / "models" / "transfer.json").read_text(encoding="utf-8"))
    curves = json.loads((OUT_DIR / "models" / "age_curves.json").read_text(encoding="utf-8"))["curves"]
    presets = json.loads(ROLE_PRESETS.read_text(encoding="utf-8"))

    print("Lecture des tables match par match...", flush=True)
    T = read_all()
    print(f"  {len(T['match'])} matchs, {len(T['event'])} événements, {len(T['lineup'])} lignes de compositions "
          f"({time.time() - t0:.0f}s)", flush=True)
    print("Duos...", flush=True)
    pm = T.pop("player_match")
    side = T["lineup"][T["lineup"]["role"] == "starter"][["match_id", "player_id", "pitch_y"]].drop_duplicates(["match_id", "player_id"])
    pos = pm.merge(side, on=["match_id", "player_id"], how="left")
    pos["zone"] = pos["position_role"].fillna("?") + np.where(pos["pitch_y"] < 0.4, "G", np.where(pos["pitch_y"] > 0.6, "D", "C"))
    edges = T.pop("pass_network_edge")
    duos = lab.pass_duos(edges[~edges["comp"].isin(cups)], pos[["match_id", "player_id", "zone"]])
    pname = pm.drop_duplicates("player_id").set_index("player_id")["player_name"]
    del pm, pos, edges, side
    tm = lab.team_matches(T["team_match"], cups)
    coaches = lab.coach_by_match(T["lineup"])
    league_matches = T["match"][~T["match"]["comp"].isin(cups)]
    experiments: dict = {}

    print("Entraîneurs...", flush=True)
    change = lab.coach_change(tm, coaches)
    dna = lab.coach_dna(tm, coaches)
    results = lab.coach_results(tm, coaches)
    experiments["coachChange"] = change
    experiments["coachDna"] = {k: v for k, v in dna.items() if k != "spells"}
    experiments["coachResults"] = results
    spells = dna["spells"]
    write_json(LAB_DIR / "coaches.json", {
        "dimensions": list(lab.STYLE),
        "imprint": dna["imprint"], "arrivals": dna["arrivals"], "coaches": dna["coaches"],
        "spells": columnar(spells.assign(start=spells["start"].dt.strftime("%Y-%m-%d"), end=spells["end"].dt.strftime("%Y-%m-%d"))
                           [["coach", "team_id", "team", "comp", "start", "end", "n", "perf", *lab.STYLE]]),
    })

    print("Arbitres...", flush=True)
    refs = lab.referees(league_matches, T["event"])
    experiments["referees"] = {k: v for k, v in refs.items() if k != "table"}
    write_json(LAB_DIR / "referees.json", {
        "reliability": refs["reliability"],
        "table": columnar(refs["table"][["referee", "comp", "matches", "first", "last", "cards", "cards_rel", "cards_shrunk",
                                         "pens", "pens_shrunk"]].sort_values("matches", ascending=False)),
    })

    print("Valeur des buts...", flush=True)
    gv = lab.goal_values(tm, league_matches, T["event"])
    experiments["goalValue"] = {k: v for k, v in gv.items() if k not in ("players", "timeline", "wp", "rates")}
    names = T["team_match"].drop_duplicates("team_id").set_index("team_id")["team_name"]
    gp = gv["players"].assign(team=lambda d: d["team_id"].map(names))
    write_json(LAB_DIR / "goals.json", columnar(gp[gp["goals"] >= 3][
        ["player_id", "name", "team_id", "team", "comp", "app_season", "goals", "points", "decisive", "late", "padding"]]
        .sort_values(["app_season", "points"], ascending=[True, False])))

    print("Momentum...", flush=True)
    closed = sorted(s["id"] for s in index["seasons"] if s["id"] != current)
    experiments["momentum"] = lab.momentum_test(gv["timeline"], gv["rates"], T.pop("momentum"), T["shot"], closed[-1])

    print("Joueurs : ascenseur, jumeaux...", flush=True)
    players = lab.best_role_index(read_players(), presets, models.role_index)
    levels = {k: v["level"] for k, v in transfer["leagues"].items()}
    tier_levels = {int(k): v for k, v in transfer["tierLevels"].items()}
    team_xgd = (tm[tm["league"]].groupby(["comp", "app_season", "team_id"])["xgd"].mean().rename("team_xgd").reset_index()
                .rename(columns={"comp": "Competition", "app_season": "_app_season", "team_id": "Team ID"}))
    ev = lab.elevator(players, levels, tier_levels, team_xgd, current)
    experiments["elevator"] = {k: ev[k] for k in ("validation", "verify", "verdict", "stepUp")}
    cols = ["Player ID", "Player", "Team", "Team ID", "Competition", "Position", "Age", "best_role", "best_index",
            "Minutes share", "p"]

    def rows(d: pd.DataFrame | None, extra: list[str]) -> dict | None:
        if d is None or d.empty:
            return None
        d = d.sort_values("p", ascending=False).head(3000)
        return {"season": d["_app_season"].iloc[0], **columnar(d[cols + extra])}

    write_json(LAB_DIR / "elevator.json", {
        "stepUp": lab.STEP_UP, "levels": levels, "validation": ev["validation"], "verify": ev["verify"],
        "check": rows(ev["check"], ["observed", "next_comp"]), "provisional": rows(ev["provisional"], []),
    })
    experiments["twins"] = lab.twins(players, presets, curves, models.role_index, models._development_pct,
                                     ev["validation"]["base"])
    print("Friction de style (transferts)...", flush=True)
    tiers = {c["key"]: int(c.get("tier", 2)) for c in index["competitions"]}
    experiments["styleFriction"] = lab.style_friction(read_players(), presets, cups, tiers, models)

    experiments["duos"] = {k: v for k, v in duos.items() if k != "duos"}
    d = duos["duos"]
    d = d.assign(from_name=d["from_player_id"].map(pname), to_name=d["to_player_id"].map(pname), team=d["team_id"].map(names))
    # par équipe-saison : les 8 duos les plus liés et les 3 moins liés (au-delà du placement)
    d = d.sort_values("affinity", ascending=False)
    keep = pd.concat([d.groupby(["comp", "app_season", "team_id"]).head(8), d.groupby(["comp", "app_season", "team_id"]).tail(3)])
    write_json(LAB_DIR / "duos.json", {
        "reliability": duos["reliability"],
        **columnar(keep.drop_duplicates()[["comp", "app_season", "team_id", "team", "from_player_id", "from_name",
                                           "to_player_id", "to_name", "passes", "expected", "affinity"]]),
    })

    print("Horloge, coups de pied arrêtés, chance, disponibilité...", flush=True)
    clock = lab.squad_clock(players, curves, tm)
    experiments["clock"] = {k: v for k, v in clock.items() if k != "teams"}
    league_shots = T["shot"][~T["shot"]["comp"].isin(cups)]
    sp = lab.set_pieces(league_shots, current)
    experiments["setPieces"] = {k: v for k, v in sp.items() if k != "teams"}
    experiments["setPieceEfficiency"] = lab.set_piece_efficiency(league_shots, current)
    key = ["Competition", "_app_season", "Team ID"]
    teams = clock["teams"].merge(sp["teams"].rename(columns={"comp": "Competition", "app_season": "_app_season",
                                                             "team_id": "Team ID", "share": "set_pieces"}), on=key, how="outer")
    teams["team"] = teams["team"].fillna(teams["Team ID"].map(names))
    write_json(LAB_DIR / "teams.json", {
        "coef": clock["coef"], "ci": clock["ci"],
        **columnar(teams[teams["_app_season"] >= closed[-1]][key + ["team", "clock", "age", "set_pieces"]]),
    })
    experiments["luck"] = lab.luck(tm, current)
    av = lab.availability(T["lineup"], T["match"], cups, current)
    experiments["availability"] = {k: v for k, v in av.items() if k != "players"}
    experiments["redCards"] = lab.red_cards(T["event"], league_shots, gv["rates"])
    experiments["gameState"] = lab.game_state(tm, gv["timeline"], gv["rates"], league_shots, current)

    print("Fatigue, confrontations de styles...", flush=True)
    experiments["fatigue"] = lab.fatigue(tm)
    experiments["styleMatchups"] = lab.style_matchups(tm, current)

    write_json(LAB_DIR / "experiments.json", {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "matches": int(len(T["match"])), "leagueMatches": int(len(league_matches)),
        "teamMatches": int(len(tm)), "events": int(len(T["event"])), "current": current,
        "experiments": plain(experiments),
    })
    for name, e in experiments.items():
        print(f"  {name:14s} {e.get('verdict', '')}")
    print(f"Écrit dans {LAB_DIR} ({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
