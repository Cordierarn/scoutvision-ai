"""
Taxonomie des marchés Winamax (catalogue OddsPapi, 77 types de marché) en cinq grandes familles, et audit de
ce que l'archive contient réellement par marché. Sert de référence à la porte de validation universelle
(catégorie de validation par marché) et au coupe-circuit.

Grandes familles (`MACRO`) :
  resultats  Résultats & handicaps : 1N2, double chance, remboursé si nul, handicaps asiatiques / européens,
             écart de buts, vainqueur après avoir été mené, qualification ;
  buts       Buts & équipes : plus/moins (toutes lignes), plus/moins par équipe, les deux équipes marquent,
             clean sheet, gagne sans encaisser, score exact, nombre de buts, première / dernière équipe à marquer,
             pair / impair ;
  mi_temps   Mi-temps & périodes : tout marché de buts ou de résultat sur une période (p1, p2), mi-temps /
             fin de match, mi-temps la plus prolifique, marque dans les deux mi-temps, gagne les deux mi-temps ;
  stats      Statistiques d'équipe & discipline : corners et cartons (totaux, par équipe, handicaps, 1N2, pair /
             impair) ;
  joueurs    Marchés joueurs : buteur, premier / dernier buteur, passes, tirs, tirs cadrés, cartons, fautes,
             arrêts, tacles, hors-jeu (lignes « playertotals » et paliers « players »).

Catégorie de validation (`category`) :
  A  marché principal couvert par la référence sharp (1N2, plus/moins et handicap asiatique, temps réglementaire) ;
  B  marché fermé à deux ou trois issues, ou à ligne, sans référence sharp : la probabilité dé-viguée de Winamax
     lui-même (Shin) sert de référence dans la porte de validation ;
  C  marché à issues multiples ou unilatéral (score exact, mi-temps / fin de match, écart de buts, premier but,
     marchés joueurs) : validation sur l'historique point-in-time seulement.

État de l'archive au 5 novembre 2026 (audit réel) : 132 marchés Winamax distincts sur 969 rencontres 2026-27,
tous hors joueurs (l'option « player props » n'est pas dans le plan OddsPapi : `has_player_props` = false) ;
corners et cartons présents sur une seule rencontre. Les familles `stats` et `joueurs` n'ont donc pas de cotes
exploitables aujourd'hui, même si la feuille de match Winamax les propose.

  cd scripts && python3 -m betting.markets_catalog        # audit de l'archive → .research/betting/phase2/markets_audit.json
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass

import pandas as pd

from . import BOOKMAKER, COMPETITIONS, RESEARCH
from . import markets as mk

MACRO = {
    "resultats": "Résultats & handicaps",
    "buts": "Buts & équipes",
    "mi_temps": "Mi-temps & périodes",
    "stats": "Statistiques d'équipe & discipline",
    "joueurs": "Marchés joueurs",
}
SHAPES = {"ferme2": "deux issues", "ferme3": "trois issues", "ligne": "ligne plus/moins ou handicap", "multi": "issues multiples", "joueur": "par joueur"}
SHARP_COVERED = {("1x2", "fulltime"), ("totals", "fulltime"), ("spreads", "fulltime")}

# type de marché OddsPapi → (grande famille au temps réglementaire, forme, libellé)
TYPES: dict[str, tuple[str, str, str]] = {
    "1x2": ("resultats", "ferme3", "1N2"),
    "doublechance": ("resultats", "ferme3", "double chance"),
    "drawnobet": ("resultats", "ferme2", "remboursé si match nul"),
    "spreads": ("resultats", "ligne", "handicap asiatique"),
    "spreads-european": ("resultats", "ferme3", "handicap européen"),
    "winningmargin": ("resultats", "multi", "écart de buts"),
    "winfrombehind": ("resultats", "ferme2", "gagne après avoir été mené"),
    "toqualify": ("resultats", "ferme2", "qualification"),
    "nobet-team1": ("resultats", "ferme2", "remboursé si l'équipe à domicile gagne"),
    "nobet-team2": ("resultats", "ferme2", "remboursé si l'équipe à l'extérieur gagne"),
    "2up": ("resultats", "ferme3", "1N2 payé à deux buts d'avance"),
    "totals": ("buts", "ligne", "plus/moins"),
    "teamtotals-team1": ("buts", "ligne", "plus/moins équipe à domicile"),
    "teamtotals-team2": ("buts", "ligne", "plus/moins équipe à l'extérieur"),
    "bothteamsscore": ("buts", "ferme2", "les deux équipes marquent"),
    "cleansheet-team1": ("buts", "ferme2", "clean sheet domicile"),
    "cleansheet-team2": ("buts", "ferme2", "clean sheet extérieur"),
    "wintonil-team1": ("buts", "ferme2", "domicile gagne sans encaisser"),
    "wintonil-team2": ("buts", "ferme2", "extérieur gagne sans encaisser"),
    "toscore-team1": ("buts", "ferme2", "domicile marque"),
    "toscore-team2": ("buts", "ferme2", "extérieur marque"),
    "correctscore": ("buts", "multi", "score exact"),
    "exactscore": ("buts", "multi", "nombre de buts exact"),
    "exactscore-team1": ("buts", "multi", "nombre de buts exact domicile"),
    "exactscore-team2": ("buts", "multi", "nombre de buts exact extérieur"),
    "firstgoal": ("buts", "ferme3", "première équipe à marquer"),
    "lastgoal": ("buts", "ferme3", "dernière équipe à marquer"),
    "oddeven": ("buts", "ferme2", "pair / impair"),
    "oddeven-team1": ("buts", "ferme2", "pair / impair domicile"),
    "oddeven-team2": ("buts", "ferme2", "pair / impair extérieur"),
    "halftime-fulltime": ("mi_temps", "multi", "mi-temps / fin de match"),
    "highestscoringh": ("mi_temps", "ferme3", "mi-temps la plus prolifique"),
    "highestscoringh-team1": ("mi_temps", "ferme3", "mi-temps la plus prolifique domicile"),
    "highestscoringh-team2": ("mi_temps", "ferme3", "mi-temps la plus prolifique extérieur"),
    "toscoreinbh-team1": ("mi_temps", "ferme2", "domicile marque dans les deux mi-temps"),
    "toscoreinbh-team2": ("mi_temps", "ferme2", "extérieur marque dans les deux mi-temps"),
    "winbothh-team1": ("mi_temps", "ferme2", "domicile gagne les deux mi-temps"),
    "winbothh-team2": ("mi_temps", "ferme2", "extérieur gagne les deux mi-temps"),
    "wineitherh-team1": ("mi_temps", "ferme2", "domicile gagne une mi-temps"),
    "wineitherh-team2": ("mi_temps", "ferme2", "extérieur gagne une mi-temps"),
    "1x2-corners": ("stats", "ferme3", "1N2 corners"),
    "totals-corners": ("stats", "ligne", "plus/moins corners"),
    "spreads-corners": ("stats", "ligne", "handicap corners"),
    "teamtotals-corners-team1": ("stats", "ligne", "plus/moins corners domicile"),
    "teamtotals-corners-team2": ("stats", "ligne", "plus/moins corners extérieur"),
    "oddeven-corners": ("stats", "ferme2", "pair / impair corners"),
    "oddeven-corners-team1": ("stats", "ferme2", "pair / impair corners domicile"),
    "oddeven-corners-team2": ("stats", "ferme2", "pair / impair corners extérieur"),
    "1x2-bookings": ("stats", "ferme3", "1N2 cartons"),
    "totals-bookings": ("stats", "ligne", "plus/moins cartons"),
    "spreads-bookings": ("stats", "ligne", "handicap cartons"),
    "teamtotals-bookings-team1": ("stats", "ligne", "plus/moins cartons domicile"),
    "teamtotals-bookings-team2": ("stats", "ligne", "plus/moins cartons extérieur"),
    "oddeven-bookings": ("stats", "ferme2", "pair / impair cartons"),
    "oddeven-bookings-team1": ("stats", "ferme2", "pair / impair cartons domicile"),
    "oddeven-bookings-team2": ("stats", "ferme2", "pair / impair cartons extérieur"),
    "players-anytimegoalscorer": ("joueurs", "joueur", "buteur"),
    "players-firstgoalscorer": ("joueurs", "joueur", "premier buteur"),
    "players-lastgoalscorer": ("joueurs", "joueur", "dernier buteur"),
    "players-goals": ("joueurs", "joueur", "buts du joueur (paliers)"),
    "players-assists": ("joueurs", "joueur", "passes décisives du joueur (paliers)"),
    "players-shots": ("joueurs", "joueur", "tirs du joueur (paliers)"),
    "players-shotsongoal": ("joueurs", "joueur", "tirs cadrés du joueur (paliers)"),
    "players-cards": ("joueurs", "joueur", "carton du joueur"),
    "players-foulscommitted": ("joueurs", "joueur", "fautes du joueur (paliers)"),
    "players-offsides": ("joueurs", "joueur", "hors-jeu du joueur (paliers)"),
    "players-saves": ("joueurs", "joueur", "arrêts du gardien (paliers)"),
    "players-tackles": ("joueurs", "joueur", "tacles du joueur (paliers)"),
    "playertotals-goals": ("joueurs", "joueur", "plus/moins buts du joueur"),
    "playertotals-assists": ("joueurs", "joueur", "plus/moins passes décisives du joueur"),
    "playertotals-shots": ("joueurs", "joueur", "plus/moins tirs du joueur"),
    "playertotals-shotsongoal": ("joueurs", "joueur", "plus/moins tirs cadrés du joueur"),
    "playertotals-cards": ("joueurs", "joueur", "plus/moins cartons du joueur"),
    "playertotals-foulscommitted": ("joueurs", "joueur", "plus/moins fautes du joueur"),
    "playertotals-offsides": ("joueurs", "joueur", "plus/moins hors-jeu du joueur"),
    "playertotals-saves": ("joueurs", "joueur", "plus/moins arrêts du gardien"),
    "playertotals-tackles": ("joueurs", "joueur", "plus/moins tacles du joueur"),
}
PERIODS = {"fulltime": "temps réglementaire", "p1": "1re mi-temps", "p2": "2e mi-temps"}


@dataclass(frozen=True)
class Classification:
    macro: str          # clé de MACRO
    shape: str          # clé de SHAPES
    category: str       # A, B ou C
    label: str          # libellé français du type de marché
    modeled: bool       # le règlement et la probabilité sont implémentés (markets.FAMILIES)


def classify(market_type: str, period: str = "fulltime", player_prop: bool = False) -> Classification:
    """Grande famille, forme et catégorie de validation d'un type de marché OddsPapi. Un type inconnu est classé
    d'après son nom (joueur, corners / cartons, sinon résultats) sans jamais être modélisé."""
    macro, shape, label = TYPES.get(market_type, _guess(market_type, player_prop))
    if period != "fulltime" and macro in ("resultats", "buts"):
        macro = "mi_temps"
    if shape == "joueur" or player_prop:
        category = "C"
    elif (market_type, period) in SHARP_COVERED:
        category = "A"
    elif shape in ("ferme2", "ferme3", "ligne"):
        category = "B"
    else:
        category = "C"
    return Classification(macro, shape, category, label, market_type in mk.FAMILIES)


def _guess(market_type: str, player_prop: bool) -> tuple[str, str, str]:
    if player_prop or market_type.startswith(("players-", "playertotals-")):
        return ("joueurs", "joueur", market_type)
    if "corners" in market_type or "bookings" in market_type:
        return ("stats", "multi", market_type)
    return ("resultats", "multi", market_type)


def audit(snaps: pd.DataFrame, cat, bookmaker: str = BOOKMAKER) -> pd.DataFrame:
    """Une ligne par marché relevé chez `bookmaker` : classification, couverture (rencontres, relevés, issues),
    dernier relevé. `cat` : catalogue analysé (catalogue.parse)."""
    s = snaps[snaps["bookmaker"] == bookmaker]
    g = s.groupby("market_id").agg(fixtures=("fixture_id", "nunique"), rows=("outcome_id", "size"), outcomes=("outcome_id", "nunique"),
                                   players=("player_id", lambda x: int(x.notna().sum())), last_seen=("created_at", "max")).reset_index()
    rows = []
    for r in g.itertuples(index=False):
        m = cat.get(int(r.market_id))
        if m is None:
            rows.append({"marketId": int(r.market_id), "type": None, "period": None, "handicap": None, "macro": None, "shape": None, "category": None,
                         "label": "hors catalogue", "modeled": False, "fixtures": int(r.fixtures), "rows": int(r.rows), "outcomes": int(r.outcomes),
                         "playerRows": int(r.players), "lastSeen": pd.Timestamp(r.last_seen).isoformat()})
            continue
        c = classify(m.market_type, m.period, m.player_prop)
        rows.append({"marketId": int(r.market_id), "type": m.market_type, "period": m.period, "handicap": m.handicap, "macro": c.macro, "shape": c.shape,
                     "category": c.category, "label": c.label, "modeled": c.modeled, "fixtures": int(r.fixtures), "rows": int(r.rows), "outcomes": int(r.outcomes),
                     "playerRows": int(r.players), "lastSeen": pd.Timestamp(r.last_seen).isoformat()})
    return pd.DataFrame(rows).sort_values(["macro", "type", "period", "handicap"], na_position="last").reset_index(drop=True)


def summary(table: pd.DataFrame) -> list[dict]:
    """Par grande famille : marchés, rencontres couvertes au mieux, part des relevés, marchés modélisés."""
    total = float(table["rows"].sum()) or 1.0
    out = []
    for key, label in MACRO.items():
        t = table[table["macro"] == key]
        out.append({"macro": key, "label": label, "markets": int(len(t)), "modeled": int(t["modeled"].sum()), "maxFixtures": int(t["fixtures"].max()) if len(t) else 0,
                    "rowsShare": round(float(t["rows"].sum()) / total, 4),
                    "categories": {c: int((t["category"] == c).sum()) for c in ("A", "B", "C")}})
    return out


def main(argv=None) -> int:
    from .catalogue import parse
    from .fetch import load_snapshots
    raw = json.loads((RESEARCH / "markets_catalogue.json").read_text(encoding="utf-8"))
    cat = parse(raw if isinstance(raw, list) else raw.get("markets", raw))
    table = audit(load_snapshots(COMPETITIONS), cat)
    out = RESEARCH / "phase2" / "markets_audit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"bookmaker": BOOKMAKER, "markets": table.to_dict(orient="records"), "summary": summary(table)}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(table)} marchés {BOOKMAKER} dans l'archive → {out}")
    for s in summary(table):
        print(f"  {s['label']:36s} {s['markets']:3d} marchés ({s['modeled']} modélisés), jusqu'à {s['maxFixtures']} rencontres, {s['rowsShare']:.1%} des relevés, "
              f"A/B/C = {s['categories']['A']}/{s['categories']['B']}/{s['categories']['C']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
