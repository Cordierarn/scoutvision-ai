"""
ScoutVision AI - Préparation des données PitchAPI

Télécharge les tables Parquet publiées dans les releases de
Cordierarn/PitchApi-big-5 et écrit des fichiers JSON compacts dans
public/data/, chargés à la demande par l'application :

  public/data/index.json                    saisons, compétitions, date de génération
  public/data/players/<saison>.json         joueurs (player_season), toutes compétitions
  public/data/teams/<saison>.json           équipes (team_season)
  public/data/shots/<saison>/<COMP>.json    tirs d'une compétition
  public/data/heatmaps/<saison>/<COMP>.json cartes de chaleur des joueurs d'une compétition
  public/data/lineups/<saison>/<COMP>.json  compositions réelles : formations et titulaires par case
  public/data/networks/<saison>/<COMP>.json réseaux de passes agrégés par équipe (positions moyennes, liens)
  public/data/models/age_curves.json        courbes d'âge (évolution des percentiles par rôle)
  public/data/models/transfer.json          modèle de transfert : niveaux de championnat, contexte, validation
  public/data/market.json                   valeur Transfermarkt et contrat actuels de chaque joueur
  public/data/forecast.json                 pronostics des prochains matchs (pipeline PitchAPI)

Une saison d'application vaut une saison européenne ("2024-25") ; une saison
en année civile (Brésil, MLS, Japon...) est rangée dans la saison qui commence
la même année ("2024" -> "2024-25").

Usage :
  python scripts/prepare_data.py                       # tout
  python scripts/prepare_data.py --seasons 2024-25,2025-26
  python scripts/prepare_data.py --competitions ENG,FRA,UCL
  python scripts/prepare_data.py --market-values chemin/market_value.parquet
  python scripts/prepare_data.py --no-market-values

Par défaut, market_value.parquet (sortie de `market-values` du pipeline) est lu dans
la release privée scoutvision-data du dépôt de données.

Il faut la CLI `gh` authentifiée avec un accès en lecture au dépôt de données.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import math
import os
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import market
import models

DATA_REPO = "Cordierarn/PitchApi-big-5"
MARKET_RELEASE = "scoutvision-data"
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
CACHE_DIR = ROOT / ".cache" / "pitchapi"
ROLE_PRESETS = ROOT / "utils" / "rolePresets.json"       # rôles de l'app (validation du modèle de transfert)

TABLES_ASSET = re.compile(r"^tables-(?P<comp>[A-Z0-9]+)-(?P<season>\d{4}(?:-\d{2})?)\.tar$")

# ============================================
# MÉTRIQUES JOUEURS
# ============================================
# (libellé dans l'app, colonne source, type)
#   p90   : per-90 shrinké (repli sur le per-90 brut), percentile <col>_p90_pct_role
#   rate  : taux déjà calculé (0-100), percentile <col>_pct_role
#   total : total de la saison, sans percentile

PLAYER_METRICS: list[tuple[str, str, str]] = [
    # Totaux
    ("Goals", "bs_goals", "total"),
    ("Assists", "bs_assists", "total"),
    ("xG", "bs_expected_goals", "total"),
    ("xA", "bs_expected_assists", "total"),
    ("Errors leading to goal", "bs_errors_led_to_goal", "total"),

    # Finition
    ("Goals per 90", "bs_goals", "p90"),
    ("xG per 90", "bs_expected_goals", "p90"),
    ("npxG per 90", "bs_expected_goals_non_penalty", "p90"),
    ("xGOT per 90", "bs_expected_goals_on_target_variant", "p90"),
    ("Shots per 90", "bs_total_shots", "p90"),
    ("Shots on target per 90", "bs_shots_on_target", "p90"),
    ("Shots on target, %", "bs_shot_accuracy_pct", "rate"),
    ("Big chances missed per 90", "bs_big_chance_missed_title", "p90"),
    ("Touches in box per 90", "bs_touches_opp_box", "p90"),

    # Création
    ("Assists per 90", "bs_assists", "p90"),
    ("xA per 90", "bs_expected_assists", "p90"),
    ("xAG per 90", "adv_creation__xag", "p90"),
    ("Key passes per 90", "bs_chances_created", "p90"),
    ("Big chances created per 90", "bs_big_chance_created_team_title", "p90"),
    ("Shot-creating actions per 90", "adv_creation__sca", "p90"),
    ("Goal-creating actions per 90", "adv_creation__gca", "p90"),
    ("Second assists per 90", "adv_creation__second_assists", "p90"),
    ("xG chain per 90", "adv_creation__xg_chain", "p90"),
    ("xG buildup per 90", "adv_creation__xg_buildup", "p90"),

    # Passe
    ("Passes per 90", "bs_accurate_passes_total", "p90"),
    ("Accurate passes, %", "bs_accurate_passes_pct", "rate"),
    ("Progressive passes per 90", "adv_passing__progressive_passes", "p90"),
    ("Progressive pass distance per 90", "adv_passing__progressive_pass_distance", "p90"),
    ("Passes to final third per 90", "bs_passes_into_final_third", "p90"),
    ("Passes to penalty area per 90", "adv_passing__passes_into_box", "p90"),
    ("Through passes per 90", "adv_passing__through_balls", "p90"),
    ("Switches per 90", "adv_passing__switches", "p90"),
    ("Crosses per 90", "bs_accurate_crosses_total", "p90"),
    ("Accurate crosses, %", "bs_accurate_crosses_pct", "rate"),
    ("Long passes per 90", "bs_long_balls_accurate_total", "p90"),
    ("Accurate long passes, %", "bs_long_balls_accurate_pct", "rate"),

    # Conduite et dribble
    ("Dribbles per 90", "bs_dribbles_succeeded_total", "p90"),
    ("Successful dribbles, %", "bs_dribbles_succeeded_pct", "rate"),
    ("Progressive runs per 90", "adv_carrying__progressive_carries", "p90"),
    ("Progressive carry distance per 90", "adv_carrying__progressive_carry_distance", "p90"),
    ("Carries into final third per 90", "adv_carrying__carries_into_final_third", "p90"),
    ("Carries into box per 90", "adv_carrying__carries_into_box", "p90"),
    ("Touches per 90", "bs_touches", "p90"),
    ("Dispossessed per 90", "bs_dispossessed", "p90"),
    ("Miscontrols per 90", "adv_carrying__miscontrols", "p90"),
    ("Fouls suffered per 90", "bs_was_fouled", "p90"),

    # Défense
    ("Successful defensive actions per 90", "bs_defensive_actions", "p90"),
    ("Tackles per 90", "bs_tackles", "p90"),
    ("Interceptions per 90", "bs_interceptions", "p90"),
    ("PAdj Tackles", "bs_tackles_per1000_opp_touches", "rate"),
    ("PAdj Interceptions", "bs_interceptions_per1000_opp_touches", "rate"),
    ("PAdj Recoveries", "bs_recoveries_per1000_opp_touches", "rate"),
    ("Recoveries per 90", "bs_recoveries", "p90"),
    ("Clearances per 90", "bs_clearances", "p90"),
    ("Shots blocked per 90", "bs_shot_blocks", "p90"),
    ("Dribbled past per 90", "bs_dribbled_past", "p90"),
    ("Fouls per 90", "bs_fouls", "p90"),
    ("Duels won per 90", "bs_duel_won", "p90"),
    ("Ground duels won, %", "bs_ground_duels_won_pct", "rate"),
    ("Aerial duels per 90", "adv_defending__aerials", "p90"),
    ("Aerial duels won per 90", "bs_aerials_won", "p90"),
    ("Aerial duels won, %", "bs_aerials_won_pct", "rate"),

    # Valeur de possession
    ("xT per 90", "adv_possession_value__xt_total", "p90"),
    ("VAEP per 90", "adv_possession_value__vaep_total", "p90"),
    ("VAEP offensive per 90", "adv_possession_value__vaep_offensive", "p90"),
    ("VAEP defensive per 90", "adv_possession_value__vaep_defensive", "p90"),

    # Gardien
    ("Saves per 90", "bs_saves", "p90"),
    ("Prevented goals per 90", "bs_goals_prevented", "p90"),
    ("Conceded goals per 90", "bs_goals_conceded", "p90"),
    ("xGOT against per 90", "bs_expected_goals_on_target_faced", "p90"),
    ("Exits per 90", "bs_keeper_sweeper", "p90"),
    ("High claims per 90", "bs_keeper_high_claim", "p90"),
    ("Punches per 90", "bs_punches", "p90"),
    ("Claim rate, %", "adv_goalkeeping__claim_rate", "rate"),
    ("Launch rate, %", "adv_goalkeeping__launch_pct", "rate"),
    ("Distribution accuracy, %", "adv_goalkeeping__distribution_accuracy", "rate"),

    # Note globale
    ("Rating", "bs_rating_title", "rate"),
]

# Métriques calculées ici (percentile calculé ici, par rôle et par niveau)
COMPUTED_RATES = ["Duels won, %", "Save rate, %", "Pass share, %", "Network betweenness"]

# Réseau de passes : un joueur doit y figurer sur assez de matchs pour être noté
MIN_NETWORK_MATCHES = 5
# RAPM : minutes minimales sur le terrain pour un percentile
MIN_RAPM_MINUTES = 600

# Colonnes d'identité et de contexte : (libellé, colonne source)
PLAYER_INFO: list[tuple[str, str]] = [
    ("Player ID", "player_id"),
    ("Player", "player_name"),
    ("Team ID", "team_id"),
    ("Team", "team_name"),
    ("Competition", "league_key"),
    ("League tier", "league_tier"),
    ("Position", "position_role"),
    ("Position group", "position_group"),
    ("Position slot", "position_slot"),
    ("Midfield profile", "midfield_profile"),
    ("Age", "age_season_start"),
    ("Birth date", "birth_date"),
    ("Matches played", "matches"),
    ("Starts", "starts"),
    ("Minutes played", "minutes"),
    ("Minutes share", "minutes_share"),
    ("Analytics coverage", "analytics_minutes_share"),
    ("Team possession, %", "team_possession_pct"),
    ("Team PPDA", "team_ppda"),
    ("Team field tilt", "team_field_tilt"),
]

# ============================================
# MÉTRIQUES ÉQUIPES (team_season)
# ============================================

TEAM_METRICS: list[tuple[str, str]] = [
    ("Matches", "matches"),
    ("xG per 90", "xg_for_p90"),
    ("xGA per 90", "xg_against_p90"),
    ("npxG per 90", "npxg_for_p90"),
    ("npxGA per 90", "npxg_against_p90"),
    ("Shots per 90", "shots_for_p90"),
    ("Shots against per 90", "shots_against_p90"),
    ("Goals per 90", "goals_for_p90"),
    ("Goals against per 90", "goals_against_p90"),
    ("Possession, %", "adv_territory__possession_pct"),
    ("Field tilt", "adv_territory__field_tilt"),
    ("Average action height", "adv_territory__avg_action_x"),
    ("Defensive line height", "adv_defending__avg_defensive_action_x"),
    ("PPDA", "adv_defending__ppda"),
    ("Ball recovery time", "adv_defending__ball_recovery_time"),
    ("Passes per sequence", "adv_tempo__passes_per_sequence"),
    ("Direct speed", "adv_tempo__direct_speed"),
    ("Pass accuracy, %", "adv_passing__pass_accuracy"),
]

SHOT_RESULT = {"Goal": "Goal", "AttemptSaved": "SavedShot", "Miss": "MissedShots", "Post": "ShotOnPost"}
SHOT_TYPE = {"RightFoot": "RightFoot", "LeftFoot": "LeftFoot", "Header": "Head", "OtherBodyParts": "OtherBodyPart"}
SHOT_SITUATION = {
    "RegularPlay": "OpenPlay", "FastBreak": "OpenPlay", "IndividualPlay": "OpenPlay",
    "FromCorner": "FromCorner", "SetPiece": "SetPiece", "ThrowInSetPiece": "SetPiece",
    "FreeKick": "DirectFreekick", "Penalty": "Penalty",
}
PITCH_LENGTH, PITCH_WIDTH = 105.0, 68.0
# Grille des heatmaps PitchAPI : cell_x 0 (propre but) -> 15 (but adverse), cell_y 0-11
HEAT_COLS, HEAT_ROWS = 16, 12

# ============================================
# SAISONS
# ============================================


def app_season(raw: str) -> str:
    """'2024/2025', '2024-2025', '2024-25' -> '2024-25' ; '2024' -> '2024-25'."""
    m = re.match(r"^(\d{4})(?:[/-](\d{2,4}))?$", str(raw).strip())
    if not m:
        raise ValueError(f"saison inconnue : {raw!r}")
    start = int(m.group(1))
    return f"{start}-{str(start + 1)[2:]}"


def display_season(raw: str) -> str:
    """Libellé réel de la saison d'une compétition : '2024-25' ou '2024'."""
    m = re.match(r"^(\d{4})(?:[/-](\d{2,4}))?$", str(raw).strip())
    if m and m.group(2):
        return f"{m.group(1)}-{m.group(2)[-2:]}"
    return str(raw).strip()


# ============================================
# TÉLÉCHARGEMENT
# ============================================


_GH_TOKEN_FORMAT = re.compile(r"(github_pat_|gh[pousr]_)[A-Za-z0-9_]+")
_warned_token = False


def gh_env() -> dict[str, str]:
    """Environnement de `gh`. Un GH_TOKEN qui n'a pas la forme d'un jeton GitHub (secret mal
    collé) est écarté avec un avertissement. Dans un Codespace, le GITHUB_TOKEN injecté ne voit
    que ce dépôt : on l'écarte pour utiliser la connexion `gh auth login`."""
    global _warned_token
    env = os.environ.copy()
    token = env.get("GH_TOKEN", "").strip()
    if token and not _GH_TOKEN_FORMAT.fullmatch(token):
        if not _warned_token:
            print("Avertissement : GH_TOKEN n'est pas un jeton GitHub valide, il est ignoré.", file=sys.stderr)
            _warned_token = True
        env.pop("GH_TOKEN")
    elif token:
        env["GH_TOKEN"] = token
    if env.get("CODESPACES") and not env.get("GH_TOKEN"):
        env.pop("GITHUB_TOKEN", None)
    return env


def gh_json(*args: str):
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True, env=gh_env()).stdout
    return json.loads(out)


# Releases et leurs archives, lues une fois par exécution via l'API REST (`gh api`) :
# `gh release list/view/download` passent par GraphQL, indisponible dans certains environnements.
_releases: dict[str, dict[str, dict]] | None = None


def release_assets(tag: str) -> dict[str, dict] | None:
    """Archives d'une release : nom -> {"id", "size"} ; None si la release n'existe pas."""
    global _releases
    if _releases is None:
        _releases = {}
        page = 1
        while True:
            releases = gh_json("api", f"repos/{DATA_REPO}/releases?per_page=100&page={page}")
            for r in releases:
                _releases[r["tag_name"]] = {a["name"]: {"id": a["id"], "size": a["size"]} for a in r["assets"]}
            if len(releases) < 100:
                break
            page += 1
    return _releases.get(tag)


def list_table_assets() -> dict[tuple[str, str], tuple[str, str, int]]:
    """(compétition, saison) -> (release, asset, taille). Une saison close prime sur data-v2-current."""
    release_assets("data-v2-current")
    tags = [t for t in (_releases or {}) if t.startswith("data-v2-")]
    # data-v2-current en dernier : une saison close publiée ailleurs n'est pas écrasée
    tags.sort(key=lambda t: t == "data-v2-current")

    assets: dict[tuple[str, str], tuple[str, str, int]] = {}
    for tag in tags:
        for name, a in (_releases or {})[tag].items():
            m = TABLES_ASSET.match(name)
            if not m or m.group("comp") == "ALL":
                continue
            key = (m.group("comp"), m.group("season"))
            if key not in assets:
                assets[key] = (tag, name, a["size"])
    return assets


def download(tag: str, name: str, size: int | None = None) -> Path:
    """Télécharge un asset dans le cache ; réutilisé tant que la taille ne change pas."""
    dest = CACHE_DIR / tag / name
    if dest.exists() and (size is None or dest.stat().st_size == size):
        return dest
    asset = (release_assets(tag) or {}).get(name)
    if asset is None:
        raise FileNotFoundError(f"{tag}/{name} introuvable dans les releases de {DATA_REPO}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  ↓ {tag}/{name}", flush=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with open(tmp, "wb") as fh:
        subprocess.run(["gh", "api", "-H", "Accept: application/octet-stream",
                        f"repos/{DATA_REPO}/releases/assets/{asset['id']}"], check=True, stdout=fh, env=gh_env())
    if tmp.stat().st_size != asset["size"]:
        tmp.unlink()
        raise OSError(f"{tag}/{name} : téléchargement incomplet ({tmp.stat().st_size if tmp.exists() else 0} / {asset['size']} octets)")
    tmp.replace(dest)
    return dest


def read_tables(tar_path: Path, tables: set[str]) -> dict[str, pd.DataFrame]:
    """Lit les partitions Parquet voulues d'une archive tables-*.tar."""
    out: dict[str, pd.DataFrame] = {}
    with tarfile.open(tar_path) as tar:
        for member in tar.getmembers():
            table = member.name.split("/", 1)[0]
            if table in tables and member.name.endswith(".parquet"):
                out[table] = pd.read_parquet(io.BytesIO(tar.extractfile(member).read()))
    return out


def read_global_refs() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Référentiels de global.tar : joueurs et équipes (nationalité, photos, logos), compétitions."""
    size = (release_assets("data-v2-current") or {})["global.tar"]["size"]
    path = download("data-v2-current", "global.tar", size)
    refs = read_tables(path, {"player", "team"})
    with tarfile.open(path) as tar:
        leagues = json.load(tar.extractfile("leagues.json"))
    return refs.get("player", pd.DataFrame()), refs.get("team", pd.DataFrame()), leagues


def read_reports() -> dict[str, pd.DataFrame]:
    """Analyses du pipeline publiées dans global.tar (reports/*.csv) ; absentes = vides."""
    path = CACHE_DIR / "data-v2-current" / "global.tar"
    wanted = {"rapm": "reports/rapm.csv", "rapm_summary": "reports/rapm_summary.csv",
              "finishing": "reports/finishing.csv", "forecast": "reports/forecast_upcoming.csv",
              "forecast_table": "reports/forecast_table.csv",
              "forecast_backtest": "reports/forecast_backtest.csv"}
    out = {k: pd.DataFrame() for k in wanted}
    with tarfile.open(path) as tar:
        names = set(tar.getnames())
        for key, name in wanted.items():
            if name in names:
                out[key] = pd.read_csv(tar.extractfile(name))
    return out


# ============================================
# CONSTRUCTION
# ============================================


def clean(value):
    """Valeur JSON compacte : NaN -> None, flottants arrondis."""
    if value is None or value is pd.NA:
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 3)
    if hasattr(value, "item"):  # numpy scalaire
        return clean(value.item())
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.strftime("%Y-%m-%d")
    return value


def columnar(df: pd.DataFrame) -> dict:
    return {
        "columns": list(df.columns),
        "rows": [[clean(v) for v in row] for row in df.itertuples(index=False, name=None)],
    }


def first_existing(df: pd.DataFrame, *cols: str) -> pd.Series | None:
    for c in cols:
        if c in df.columns:
            return df[c]
    return None


def build_players(ps: pd.DataFrame, comp: str, players_ref: pd.DataFrame, teams_ref: pd.DataFrame,
                  market: pd.DataFrame | None) -> pd.DataFrame:
    ps = ps.copy()
    ps["league_key"] = comp
    season_label = display_season(ps["season"].iloc[0])

    cols: dict[str, pd.Series | object] = {}
    for label, col in PLAYER_INFO:
        cols[label] = ps[col] if col in ps.columns else None
    cols["League"] = ps["league_name"] + " " + season_label
    cols["Season"] = season_label

    for label, col, kind in PLAYER_METRICS:
        if kind == "p90":
            value = first_existing(ps, f"{col}_p90_shrunk", f"{col}_p90")
            pct = first_existing(ps, f"{col}_p90_pct_role")
        elif kind == "rate":
            value = first_existing(ps, col)
            pct = first_existing(ps, f"{col}_pct_role")
        else:
            value, pct = first_existing(ps, col), None
        cols[label] = value
        if kind != "total":
            cols[f"{label} pct"] = pct.round().astype("Int64") if pct is not None else None

    # Taux recalculés depuis les totaux
    won, lost = ps.get("bs_duel_won"), ps.get("bs_duel_lost")
    if won is not None and lost is not None:
        cols["Duels won, %"] = (100 * won / (won + lost)).where((won + lost) > 0)
    saves, conceded = ps.get("bs_saves"), ps.get("bs_goals_conceded")
    if saves is not None and conceded is not None:
        cols["Save rate, %"] = (100 * saves / (saves + conceded)).where((saves + conceded) > 0)

    # Référentiel : nationalité et photo
    if not players_ref.empty:
        ref = players_ref.set_index("id")
        cols["Passport country"] = ps["player_id"].map(ref["country_code"])
        cols["Image"] = ps["player_id"].map(ref["image_url"])
    if not teams_ref.empty:
        cols["Team logo"] = ps["team_id"].map(teams_ref.set_index("id")["image_url"])

    out = pd.DataFrame(cols, index=ps.index)

    # Transfermarkt (market-values du pipeline, optionnel)
    if market is not None and not market.empty:
        bio = market.drop_duplicates("player_id").set_index("player_id")

        # Profil, valable pour toutes les saisons : âge manquant (Wikidata), taille, pied
        birth = ps["player_id"].map(bio["birth_date"])
        out["Birth date"] = out["Birth date"].fillna(birth)
        out["Age"] = out["Age"].fillna(age_at_season_start(birth, ps["season"].iloc[0]))
        out["Height"] = (ps["player_id"].map(bio["height_m"]) * 100).round()
        out["Foot"] = ps["player_id"].map(bio["foot"]).str.capitalize()

        # Valeur et contrat : instantané actuel, seulement pour la saison collectée
        current = market[market["_season"] == app_season(ps["season"].iloc[0])]
        if not current.empty:
            m = current.drop_duplicates("player_id").set_index("player_id")
            out["Market value"] = ps["player_id"].map(m["market_value_eur"])
            out["Contract expires"] = ps["player_id"].map(m["contract_until"])

    return out.reset_index(drop=True)


def build_teams(ts: pd.DataFrame, comp: str, league_name: str, season_label: str,
                teams_ref: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame({
        "team_id": ts["team_id"],
        "team": ts["team_name"],
        "competition": comp,
        "league": f"{league_name} {season_label}",
        "season": season_label,
    })
    for label, col in TEAM_METRICS:
        out[label] = ts[col] if col in ts.columns else None
    if not teams_ref.empty:
        out["image"] = ts["team_id"].map(teams_ref.set_index("id")["image_url"])
    return out.reset_index(drop=True)


def build_shots(shots: pd.DataFrame, matches: pd.DataFrame, teams: pd.DataFrame,
                season_label: str) -> pd.DataFrame:
    team_names = dict(zip(teams["team_id"], teams["team_name"])) if not teams.empty else {}
    home = dict(zip(matches["match_id"], matches["home_team_id"])) if not matches.empty else {}
    for side in ("home", "away"):
        if not matches.empty:
            team_names.update(zip(matches[f"{side}_team_id"], matches[f"{side}_team_name"]))

    result = shots["event_type"].map(SHOT_RESULT).fillna("MissedShots")
    result = result.where(~(shots["is_blocked"].fillna(False) & (result != "Goal")), "BlockedShot")

    return pd.DataFrame({
        "id": shots["match_id"] + "_" + shots["shot_id"].astype(str),
        "match_id": shots["match_id"],
        "minute": shots["minute"],
        "result": result,
        "X": (shots["x"] / PITCH_LENGTH).round(4),
        "Y": (shots["y"] / PITCH_WIDTH).round(4),
        "xG": shots["expected_goals"],
        "xGOT": shots["expected_goals_on_target"],
        "player": shots["player_name"],
        "player_id": shots["player_id"],
        "team": shots["team_id"].map(team_names),
        "h_a": [("h" if home.get(m) == t else "a") for m, t in zip(shots["match_id"], shots["team_id"])],
        "situation": shots["situation"].map(SHOT_SITUATION).fillna("OpenPlay"),
        "shotType": shots["shot_type"].map(SHOT_TYPE).fillna("OtherBodyPart"),
        "isOwnGoal": shots["is_own_goal"],
        "season": season_label,
    })


def build_heatmaps(heat: pd.DataFrame) -> dict:
    """Cumul des actions par case sur la saison, par joueur et par équipe.

    Repère `acting_ltr` : l'équipe du joueur attaque vers cell_x = 15 ; cell_y = 0 est
    le couloir droit de l'attaquant (constaté : ailiers droits vers 0, latéraux gauches vers 11).
    Grille dense, index = cell_y * 16 + cell_x.
    """
    heat = heat[heat["player_id"].notna()]
    players: dict[str, dict] = {}
    for (player_id, team_id), g in heat.groupby(["player_id", "team_id"]):
        cells = g.groupby(["cell_y", "cell_x"])["actions"].sum()
        grid = [0] * (HEAT_COLS * HEAT_ROWS)
        for (y, x), actions in cells.items():
            grid[int(y) * HEAT_COLS + int(x)] = int(actions)
        players[f"{player_id}_{team_id}"] = {"matches": int(g["match_id"].nunique()), "grid": grid}
    return {"cols": HEAT_COLS, "rows": HEAT_ROWS, "players": players}


def build_network(nodes: pd.DataFrame) -> pd.DataFrame:
    """Place dans le réseau de passes (titulaires, jusqu'au premier remplacement), par joueur et équipe.

    - Pass share : part des passes données et reçues de l'équipe qui passent par le joueur
    - Network betweenness : centralité d'intermédiarité moyenne (joueur relais)
    """
    nodes = nodes[nodes["player_id"].notna()].copy()
    nodes["_inv"] = nodes["passes"].fillna(0) + nodes["passes_received"].fillna(0)
    team_total = nodes.groupby(["match_id", "team_id"])["_inv"].transform("sum")
    nodes["_share"] = 100 * nodes["_inv"] / team_total.where(team_total > 0)
    g = nodes.groupby(["player_id", "team_id"])
    out = pd.DataFrame({
        "Network matches": g["match_id"].nunique(),
        "Pass share, %": g["_share"].mean(),
        "Network betweenness": g["betweenness"].mean(),
    }).reset_index()
    few = out["Network matches"] < MIN_NETWORK_MATCHES
    out.loc[few, ["Pass share, %", "Network betweenness"]] = None
    return out.rename(columns={"player_id": "Player ID", "team_id": "Team ID"})


def build_networks(nodes: pd.DataFrame, edges: pd.DataFrame, min_matches: int = 1) -> dict:
    """Réseau de passes agrégé sur la saison, par équipe (tables pass_network_node / _edge).

    Chaque match fournit un réseau sur la fenêtre jusqu'au premier remplacement (onze de
    départ) : position moyenne de chaque joueur et passes entre joueurs. L'agrégat garde, par
    équipe, le nombre de matchs avec réseau, puis par joueur sa position moyenne (moyenne des
    positions de match), ses matchs dans le réseau, ses passes données et reçues, et par lien
    orienté le total de passes et le nombre de matchs où il apparaît. Les valeurs « par match »
    se calculent dans l'application.

    Repère : avg_x en mètres depuis le propre but (0-105) ; avg_y en mètres depuis le couloir
    droit de l'attaquant (0-68, même convention que la table heatmap). Sortie normalisée dans le
    repère des compositions : x 0-1 vers le but adverse, y 0-1 de gauche à droite.
    """
    # Un nœud sans position moyenne (joueur sans passe dans la fenêtre) ne compte pas
    nodes = nodes[nodes["player_id"].notna() & nodes["avg_x"].notna() & nodes["avg_y"].notna()].copy()
    nodes[["passes", "passes_received"]] = nodes[["passes", "passes_received"]].fillna(0)
    edges = edges[edges["from_player_id"].notna() & edges["to_player_id"].notna() & edges["passes"].notna()]
    names = nodes.groupby("player_id")["player_name"].agg(lambda s: s.dropna().value_counts().index[0] if s.notna().any() else "")
    teams: dict[str, dict] = {}
    for team_id, g in nodes.groupby("team_id"):
        per_player = g.groupby("player_id").agg(matches=("match_id", "nunique"), x=("avg_x", "mean"), y=("avg_y", "mean"),
                                                passes=("passes", "sum"), received=("passes_received", "sum"))
        per_player = per_player[per_player["matches"] >= min_matches]
        players = {
            pid: [str(names.get(pid, "")), round(float(r.x) / PITCH_LENGTH, 3), round(1 - float(r.y) / PITCH_WIDTH, 3),
                  int(r.matches), int(r.passes), int(r.received)]
            for pid, r in per_player.iterrows()
        }
        te = edges[(edges["team_id"] == team_id) & edges["from_player_id"].isin(players) & edges["to_player_id"].isin(players)]
        links = te.groupby(["from_player_id", "to_player_id"]).agg(passes=("passes", "sum"), matches=("match_id", "nunique"))
        teams[str(team_id)] = {
            "matches": int(g["match_id"].nunique()),
            "players": players,
            "edges": [[a, b, int(r.passes), int(r.matches)] for (a, b), r in links.sort_values("passes", ascending=False).iterrows()],
        }
    return teams


def attach_rapm(players: pd.DataFrame, rapm: pd.DataFrame) -> pd.DataFrame:
    """RAPM du pipeline (plus-minus régularisé en xG/90, par championnat, fenêtre de deux saisons).

    Chaque ligne du RAPM couvre ses saisons (« 2025/2026,2026/2027 ») ; le percentile
    se calcule dans le même championnat, entre joueurs d'au moins MIN_RAPM_MINUTES.
    """
    if rapm.empty:
        return players
    r = rapm.assign(_app_season=rapm["seasons"].str.split(",")).explode("_app_season", ignore_index=True)
    r["_app_season"] = r["_app_season"].map(app_season)
    r = r.rename(columns={"player_id": "Player ID", "league_key": "Competition",
                          "o_rapm": "RAPM off", "d_rapm": "RAPM def", "net_rapm": "RAPM net",
                          "minutes_on": "RAPM minutes"})
    r = r[["Player ID", "Competition", "_app_season", "RAPM off", "RAPM def", "RAPM net", "RAPM minutes"]]
    r = r.drop_duplicates(["Player ID", "Competition", "_app_season"]).reset_index(drop=True)
    reliable = r["RAPM minutes"] >= MIN_RAPM_MINUTES
    for col in ("RAPM off", "RAPM def", "RAPM net"):
        pct = r[reliable].groupby(["Competition", "_app_season"])[col].rank(pct=True) * 100
        r[f"{col} pct"] = pct.round().astype("Int64")
    return players.merge(r, on=["Player ID", "Competition", "_app_season"], how="left")


def attach_finishing(players: pd.DataFrame, finishing: pd.DataFrame) -> pd.DataFrame:
    """Talent de finition sur la carrière (pipeline : effet joueur shrinké, en buts au-dessus
    de l'xG pour 100 tirs), plutôt que « buts − xG », trop bruité sur peu de tirs."""
    if finishing.empty:
        return players
    f = finishing.rename(columns={"player_id": "Player ID", "goals_above_xg_per_100": "Finishing skill",
                                  "shots": "Career shots", "goals_minus_xg": "Career goals - xG"})
    return players.merge(f[["Player ID", "Finishing skill", "Career shots", "Career goals - xG"]],
                         on="Player ID", how="left")


def build_lineups(lineup: pd.DataFrame, max_formations: int = 4, per_slot: int = 6) -> dict:
    """Compositions réellement alignées, par équipe : formations et titulaires par case.

    Une case = position_id de la grille PitchAPI pour une formation donnée ; sa position
    affichée est la moyenne des pitch_x (profondeur, 0 = propre but) et pitch_y
    (largeur, 0 = côté gauche). Pour chaque case, les joueurs qui y ont le plus débuté.
    """
    st = lineup[(lineup["role"] == "starter") & lineup["formation"].notna() & lineup["position_id"].notna()]
    # Un joueur peut avoir plusieurs graphies (« Inigo Cordoba », « Iñigo Córdoba ») : on
    # compte par identifiant et on garde sa graphie la plus fréquente
    names = st.groupby("player_id")["player_name"].agg(lambda s: s.value_counts().index[0])
    teams: dict[str, dict] = {}
    for team_id, g in st.groupby("team_id"):
        matches = g.groupby("formation")["match_id"].nunique().sort_values(ascending=False)
        formations = []
        for formation, n in matches.head(max_formations).items():
            f = g[g["formation"] == formation]
            slots = []
            for slot, sg in f.groupby("position_id"):
                starts = sg.groupby("player_id")["match_id"].nunique().sort_values(ascending=False, kind="stable")
                slots.append({
                    "slot": int(slot),
                    "x": round(float(sg["pitch_x"].mean()), 3),
                    "y": round(float(sg["pitch_y"].mean()), 3),
                    "players": [[pid, names[pid], int(c)] for pid, c in starts.head(per_slot).items()],
                })
            formations.append({"formation": formation, "matches": int(n),
                               "slots": sorted(slots, key=lambda z: (z["x"], z["y"]))})
        # Une formation sans ses 11 cases (position_id manquante) passe après les complètes
        formations.sort(key=lambda f: len(f["slots"]) != 11)
        teams[team_id] = {"matches": int(g["match_id"].nunique()), "formations": formations}
    return teams


def build_results(match: pd.DataFrame | None, team_match: pd.DataFrame | None, comp: str) -> pd.DataFrame:
    """Matchs joués d'une compétition-saison : score et xG de chaque équipe."""
    if match is None or match.empty:
        return pd.DataFrame()
    m = match[match["match_status"] == "finished"].dropna(subset=["score_home", "score_away"])
    xg = (team_match.set_index(["match_id", "team_id"])["xg_for"]
          if team_match is not None and not team_match.empty else pd.Series(dtype=float))
    xg = xg[~xg.index.duplicated()]
    return pd.DataFrame({
        "match_id": m["match_id"],
        "date": pd.to_datetime(m["date"]),
        "competition": comp,
        "home": m["home_team_id"], "away": m["away_team_id"],
        "goals_home": m["score_home"].astype(int), "goals_away": m["score_away"].astype(int),
        "xg_home": pd.MultiIndex.from_arrays([m["match_id"], m["home_team_id"]]).map(xg),
        "xg_away": pd.MultiIndex.from_arrays([m["match_id"], m["away_team_id"]]).map(xg),
    })


def read_fixtures(comp: str, raw_season: str) -> list[dict]:
    """Calendrier d'une compétition (raw/<saison>/<COMP>/fixtures.json.gz de data-v2-current)."""
    name = f"raw-{comp}-{raw_season}.tar"
    asset = (release_assets("data-v2-current") or {}).get(name)
    if asset is None:
        return []
    with tarfile.open(download("data-v2-current", name, asset["size"])) as tar:
        member = next((m for m in tar.getmembers() if m.name.endswith(f"/{comp}/fixtures.json.gz")), None)
        if member is None:
            return []
        return json.loads(gzip.decompress(tar.extractfile(member).read())).get("matches") or []


def domestic_leagues(results: pd.DataFrame, competitions: dict) -> dict[str, str]:
    """Championnat national de chaque équipe : celui où elle a le plus joué sur la dernière année
    (les coupes d'Europe sont écartées)."""
    cups = {k for k, c in competitions.items() if c.get("type", "league") != "league"}
    games = results[~results["competition"].isin(cups)]
    long = pd.concat([games[["home", "competition", "date"]].rename(columns={"home": "team"}),
                      games[["away", "competition", "date"]].rename(columns={"away": "team"})])
    recent = long[long["date"] >= long["date"].max() - pd.Timedelta(days=365)]
    return recent.groupby("team")["competition"].agg(lambda s: s.value_counts().index[0]).to_dict()


def forecast_cups(results: pd.DataFrame, competitions: dict, leagues: dict, covered: set[str],
                  days: int = 14) -> tuple[list[dict], dict]:
    """Pronostics des coupes d'Europe par le modèle joint toutes compétitions (models.fit_joint),
    seulement pour les coupes absentes des pronostics du pipeline (`covered`) : secours si
    `python -m pitchapi_big5 forecast` ne les a pas produites.
    """
    # Type PitchAPI « continental_cup » : tout ce qui n'est pas un championnat
    cups = [k for k, c in competitions.items() if c.get("type", "league") != "league" and k not in covered]
    if results.empty or not cups:
        return [], {}
    window = results[results["date"] >= results["date"].max() - pd.Timedelta(days=730)]
    team_league = domestic_leagues(window, competitions)

    check = models.backtest_joint(window, team_league, set(cups))
    if check:
        print(f"Pronostics coupes (modèle joint) : RPS {check['rps_model']} contre {check['rps_baseline']} "
              f"pour les fréquences 1-N-2, sur {check['matches']} matchs passés")
    today = pd.Timestamp.today().normalize()
    model = models.fit_joint(window, team_league, today + pd.Timedelta(days=1))

    rows = []
    for comp in cups:
        current = leagues.get(comp, {}).get("current_season") or leagues.get(comp, {}).get("season")
        if not current:
            continue
        for f in read_fixtures(comp, display_season(current)):
            if f.get("status") != "not_started" or not f.get("date"):
                continue
            date = pd.Timestamp(f["date"])
            if not (today <= date <= today + pd.Timedelta(days=days)):
                continue
            h, a = f.get("home_team") or {}, f.get("away_team") or {}
            probs, rates = model.probabilities(h.get("id"), a.get("id")), model.rates(h.get("id"), a.get("id"))
            if probs is None:
                continue
            rows.append({
                "competition": comp, "date": f["date"], "match_id": f.get("id"),
                "home": h.get("name"), "away": a.get("name"),
                "homeLogo": h.get("image_url"), "awayLogo": a.get("image_url"),
                "pHome": round(probs[0], 3), "pDraw": round(probs[1], 3), "pAway": round(probs[2], 3),
                "xgHome": round(rates[0], 2), "xgAway": round(rates[1], 2), "model": "joint",
            })
    return rows, check


def build_forecast(forecast: pd.DataFrame, teams_ref: pd.DataFrame) -> dict:
    """Pronostics 1-N-2 des matchs à venir du pipeline (toutes compétitions, jusqu'à la fin
    de saison), avec les logos des équipes retrouvés par identifiant."""
    if forecast.empty:
        return {"matches": []}
    logos = teams_ref.set_index("id")["image_url"].to_dict() if not teams_ref.empty else {}
    rows = []
    for _, m in forecast.sort_values(["date", "league_key"]).iterrows():
        rows.append({
            "competition": m["league_key"], "date": m["date"], "match_id": m["match_id"],
            "home": m["home"], "away": m["away"],
            "homeLogo": logos.get(m.get("home_id")), "awayLogo": logos.get(m.get("away_id")),
            "pHome": round(float(m["p_home"]), 3), "pDraw": round(float(m["p_draw"]), 3),
            "pAway": round(float(m["p_away"]), 3),
            "xgHome": round(float(m["xg_home_attendu"]), 2), "xgAway": round(float(m["xg_away_attendu"]), 2),
        })
    return {"matches": rows}


def build_tables(table: pd.DataFrame, teams_ref: pd.DataFrame) -> dict:
    """Classements projetés du pipeline : points actuels + points attendus sur les matchs restants."""
    if table.empty:
        return {}
    logos = teams_ref.set_index("id")["image_url"].to_dict() if not teams_ref.empty else {}
    out: dict[str, list[dict]] = {}
    for comp, g in table.groupby("league_key"):
        out[comp] = [{
            "rank": int(r["rang"]), "team": r["team"], "logo": logos.get(r["team_id"]),
            "played": int(r["joues"]), "points": int(r["points"]), "goalDiff": int(r["diff"]),
            "remaining": int(r["restants"]), "expectedPoints": round(float(r["points_attendus"]), 1),
            "projectedPoints": round(float(r["points_projetes"]), 1),
        } for _, r in g.sort_values("rang").iterrows()]
    return out


def add_season_simulation(forecast: dict, table: pd.DataFrame, upcoming: pd.DataFrame) -> None:
    """Probabilités de fin de saison (titre, top 4, 3 derniers) dans les classements projetés,
    et enjeu des matchs des 14 prochains jours dans les pronostics (models.simulate_season)."""
    if table.empty or upcoming.empty:
        return
    until = pd.Timestamp.today().normalize() + pd.Timedelta(days=14)
    leverage: dict = {}
    for comp, t in table.groupby("league_key"):
        fx = upcoming[upcoming["league_key"] == comp]
        if fx.empty or comp not in forecast["tables"]:
            continue
        rows, lev = models.simulate_season(t.sort_values("rang").reset_index(drop=True), fx, leverage_until=until)
        by_team = {r["team"]: r for r in rows}
        for row in forecast["tables"][comp]:
            sim = by_team.get(row["team"], {})
            row.update({k: sim[k] for k in ("pTitle", "pTop4", "pBottom3", "expectedRank") if k in sim})
        leverage.update(lev)
    for m in forecast["matches"]:
        if m["match_id"] in leverage:
            m["leverage"] = leverage[m["match_id"]]


def compare_with_market(forecast: dict, reports: dict, results: pd.DataFrame, competitions: dict) -> dict:
    """Cotes football-data : évaluation du modèle contre la clôture (backtest du pipeline) et
    cotes des matchs à venir ajoutées aux pronostics. Vide si les cotes sont indisponibles."""
    cache = CACHE_DIR / "football-data"
    today = pd.Timestamp.today().normalize()
    try:
        history = market.load_history(cache, today)
    except Exception as e:                       # source externe : l'app reste utilisable sans
        print(f"Cotes indisponibles : {e}")
        return {}
    if history.empty:
        return {}
    mapping = market.map_teams(history, results)
    evaluation = market.evaluate(reports["forecast_backtest"], results, history, mapping) \
        if not reports["forecast_backtest"].empty else {}
    upcoming = reports["forecast"]
    team_ids = dict(zip(upcoming["match_id"], zip(upcoming["home_id"], upcoming["away_id"]))) \
        if not upcoming.empty else {}
    covered = market.attach_odds(forecast["matches"], market.load_fixtures(cache), mapping, team_ids)

    # Plus / moins de 2,5 buts : prédictions hors échantillon du modèle joint, sur la même période
    start = pd.Timestamp(evaluation["period"][0]) if evaluation.get("period") else today - pd.Timedelta(days=250)
    over_under = market.evaluate_over_under(results, history, mapping, domestic_leagues(results, competitions),
                                            models.fit_joint, start)
    ou = over_under.get("overall", {})
    if ou:
        print(f"Plus/moins de 2,5 : Brier {ou['brierModel']} contre {ou['brierMarket']}, poids du modèle "
              f"{ou['poolWeight']}, {ou.get('bets', 0)} paris, CLV {ou.get('clv')} ({ou['matches']} matchs)")
    overall = evaluation.get("overall", {})
    if overall:
        print(f"Modèle contre marché : RPS {overall['rpsModel']} contre {overall['rpsMarket']} "
              f"(clôture sans marge), poids du modèle {overall['poolWeight']}, {overall['matches']} matchs ; "
              f"{covered} matchs à venir avec cotes")
    return {**evaluation, "overUnder": over_under, "upcomingWithOdds": covered, "source": "football-data.co.uk",
            "teamsMapped": len(mapping)}


def age_at_season_start(birth: pd.Series, raw_season: str) -> pd.Series:
    """Âge entier au début de la saison, convention PitchAPI (age_season_start) :
    1er juillet pour une saison européenne, 1er janvier pour une année civile."""
    start = int(str(raw_season)[:4])
    ref = pd.Timestamp(f"{start}-07-01" if re.search(r"[/-]", str(raw_season)) else f"{start}-01-01")
    born = pd.to_datetime(birth, errors="coerce")
    years = ref.year - born.dt.year - ((born.dt.month > ref.month) | ((born.dt.month == ref.month) & (born.dt.day > ref.day)))
    return years.astype("Float64")


def fetch_market() -> Path | None:
    """market_value.parquet de la release privée scoutvision-data ; None si absent."""
    assets = release_assets(MARKET_RELEASE)
    if assets is None:
        print(f"Release {MARKET_RELEASE} introuvable : pas de valeurs Transfermarkt.")
        return None
    asset = assets.get("market_value.parquet")
    if asset is None:
        print(f"Pas de market_value.parquet dans {MARKET_RELEASE} : pas de valeurs Transfermarkt.")
        return None
    return download(MARKET_RELEASE, "market_value.parquet", asset["size"])


def read_market(path: Path | None) -> pd.DataFrame | None:
    if path is None:
        return None
    market = pd.read_parquet(path)
    market = market.dropna(subset=["player_id"])
    market["_season"] = market["season"].map(app_season)
    print(f"Valeurs Transfermarkt : {len(market)} lignes ({path})")
    return market


def build_market_values(snapshot: pd.DataFrame, players: pd.DataFrame) -> dict:
    """Valeur Transfermarkt et contrat actuels de chaque joueur, quelle que soit la saison
    analysée (recrutement) ; valeur estimée de sa ligne la plus jouée de la saison actuelle."""
    snap = snapshot.drop_duplicates("player_id")
    snap = snap[snap["market_value_eur"].notna() | snap["contract_until"].notna()]
    estimated = pd.Series(dtype=float)
    if "Estimated value" in players:
        estimated = (players.dropna(subset=["Estimated value"]).sort_values("Minutes played", ascending=False)
                     .drop_duplicates("Player ID").set_index("Player ID")["Estimated value"])
    df = pd.DataFrame({
        "Player ID": snap["player_id"],
        "Market value": snap["market_value_eur"],
        "Contract expires": snap["contract_until"],
        "Estimated value": snap["player_id"].map(estimated),
    })
    return {"scrapedAt": str(snapshot["scraped_at"].max())[:10] if "scraped_at" in snapshot else None,
            **columnar(df.reset_index(drop=True))}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # allow_nan=False : un NaN échoue ici au lieu de produire un JSON illisible par le navigateur
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")


# ============================================
# MAIN
# ============================================


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", help="saisons de l'app, ex. 2024-25,2025-26 (défaut : toutes)")
    parser.add_argument("--competitions", help="clés de compétition, ex. ENG,FRA,UCL (défaut : toutes)")
    parser.add_argument("--market-values", type=Path,
                        help="market_value.parquet local (défaut : celui de la release scoutvision-data)")
    parser.add_argument("--no-market-values", action="store_true", help="ignorer les valeurs Transfermarkt")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="dossier de sortie (défaut : public/data)")
    args = parser.parse_args(argv)

    want_seasons = {app_season(s) for s in args.seasons.split(",")} if args.seasons else None
    want_comps = set(args.competitions.upper().split(",")) if args.competitions else None

    print(f"Releases de {DATA_REPO}...")
    assets = list_table_assets()
    selected = {
        k: v for k, v in assets.items()
        if (want_comps is None or k[0] in want_comps)
        and (want_seasons is None or app_season(k[1]) in want_seasons)
    }
    if not selected:
        print("Aucune archive ne correspond aux filtres.", file=sys.stderr)
        return 1
    print(f"{len(selected)} archives compétition × saison")

    players_ref, teams_ref, leagues = read_global_refs()
    market = None if args.no_market_values else read_market(args.market_values or fetch_market())

    by_season: dict[str, dict[str, list[pd.DataFrame]]] = {}
    results: list[pd.DataFrame] = []
    competitions: dict[str, dict] = {}

    for (comp, raw_season), (tag, name, size) in sorted(selected.items()):
        season = app_season(raw_season)
        tables = read_tables(download(tag, name, size),
                             {"player_season", "team_season", "team_match", "shot", "match", "heatmap",
                              "pass_network_node", "pass_network_edge", "lineup"})
        ps = tables.get("player_season")
        if ps is None or ps.empty:
            print(f"  ! {comp} {raw_season} : pas de player_season, ignoré")
            continue

        label = display_season(ps["season"].iloc[0])
        league_name = str(ps["league_name"].iloc[0])
        bucket = by_season.setdefault(season, {"players": [], "teams": []})
        players = build_players(ps, comp, players_ref, teams_ref, market)
        nodes = tables.get("pass_network_node")
        if nodes is not None and not nodes.empty:
            players = players.merge(build_network(nodes), on=["Player ID", "Team ID"], how="left")
            edges = tables.get("pass_network_edge")
            if edges is not None and not edges.empty:
                write_json(args.out / "networks" / season / f"{comp}.json", build_networks(nodes, edges))
        bucket["players"].append(players.assign(_app_season=season))

        ts = tables.get("team_season")
        if ts is not None and not ts.empty:
            bucket["teams"].append(build_teams(ts, comp, league_name, label, teams_ref).assign(_app_season=season))

        shots = tables.get("shot")
        if shots is not None and not shots.empty:
            shot_df = build_shots(shots, tables.get("match", pd.DataFrame()),
                                  ts if ts is not None else pd.DataFrame(), label)
            write_json(args.out / "shots" / season / f"{comp}.json", columnar(shot_df))

        results.append(build_results(tables.get("match"), tables.get("team_match"), comp))
        lineup = tables.get("lineup")
        if lineup is not None and not lineup.empty:
            write_json(args.out / "lineups" / season / f"{comp}.json", build_lineups(lineup))

        league = leagues.get(comp, {})
        heat = tables.get("heatmap")
        if heat is not None and not heat.empty:
            write_json(args.out / "heatmaps" / season / f"{comp}.json", build_heatmaps(heat))

        info = competitions.setdefault(comp, {
            "key": comp, "name": league_name, "tier": int(ps["league_tier"].iloc[0]),
            # code pays FIFA de la compétition ; "INT" pour une coupe d'Europe
            "country": "INT" if str(league.get("country_code", "")).startswith("INT") else league.get("country_code"),
            "type": league.get("type", "league"),
            "seasons": [],
        })
        info["seasons"].append(season)

    # Un run filtré ne remplace que ses saisons dans l'index existant
    index_path = args.out / "index.json"
    previous = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    seasons_index = [s for s in previous.get("seasons", []) if s["id"] not in by_season]
    for comp in previous.get("competitions", []):
        merged = competitions.setdefault(comp["key"], {**comp, "seasons": []})
        merged["seasons"] = sorted(set(merged["seasons"]) | {s for s in comp["seasons"] if s not in by_season})

    # Toutes les saisons réunies : les modèles s'ajustent sur l'ensemble
    all_players = pd.concat([pd.concat(b["players"], ignore_index=True) for b in by_season.values()],
                            ignore_index=True)
    all_teams = pd.concat([pd.concat(b["teams"], ignore_index=True) for b in by_season.values() if b["teams"]],
                          ignore_index=True)

    # Percentiles des métriques calculées ici : même saison, même rôle, même niveau
    for col in COMPUTED_RATES:
        if col in all_players.columns:
            pct = all_players.groupby(["_app_season", "League tier", "Position"])[col].rank(pct=True) * 100
            all_players[f"{col} pct"] = pct.round().astype("Int64")

    reports = read_reports()
    all_players = attach_rapm(all_players, reports["rapm"])
    all_players = attach_finishing(all_players, reports["finishing"])

    # Styles de jeu des équipes (ACP + k-means), reportés sur les joueurs
    styles_meta: list[dict] = []
    if not all_teams.empty:
        team_style, styles_meta = models.team_styles(all_teams)
        all_teams = pd.concat([all_teams, team_style], axis=1)
        style_map = all_teams.set_index(["team_id", "competition", "_app_season"])["Style"]
        style_map = style_map[~style_map.index.duplicated()]
        all_players["Team style"] = pd.MultiIndex.from_frame(
            all_players[["Team ID", "Competition", "_app_season"]]).map(style_map)

    # Valeur estimée : saison de l'instantané Transfermarkt seulement
    metric_labels = [label for label, _, kind in PLAYER_METRICS if kind != "total"]
    valuation_meta: dict = {}
    if "Market value" in all_players:
        est, valuation_meta = models.estimated_value(all_players, metric_labels)
        all_players["Estimated value"] = est
        if valuation_meta:
            print(f"Valeur estimée : R² hors échantillon {valuation_meta['r2_cv']}, "
                  f"erreur médiane x{valuation_meta['median_error_factor']} ({valuation_meta['players']} joueurs)")

    # Courbes d'âge, modèle de transfert (recrutement) et pronostics
    curve_metrics = list(dict.fromkeys(metric_labels + ["Rating"] + COMPUTED_RATES))
    curves = models.age_curves(all_players, curve_metrics)
    write_json(args.out / "models" / "age_curves.json", curves)
    cups = {k for k, c in competitions.items() if c.get("type", "league") != "league"}
    presets = json.loads(ROLE_PRESETS.read_text(encoding="utf-8")) if ROLE_PRESETS.exists() else None
    transfer = models.transfer_model(all_players, curve_metrics, curves["curves"], cups,
                                     {k: c["tier"] for k, c in competitions.items()}, presets)
    if transfer:
        write_json(args.out / "models" / "transfer.json", transfer)
        v = transfer["validation"]
        if v:
            what, mae = ("de l'indice", v["index"]["movers"]) if "index" in v else ("par métrique", v["metric"]["movers"])
            print(f"Modèle de transfert : {transfer['movers']} changements de championnat ; validation "
                  f"{v['season']} ({v['movers']} transferts) : erreur {what} {mae['model']} "
                  f"(inchangé {mae['persistence']}, âge seul {mae['development']})")
    else:
        print("Modèle de transfert : trop peu de transferts dans les saisons préparées, non mis à jour")
    if market is not None:
        write_json(args.out / "market.json", build_market_values(market, all_players))
    forecast = build_forecast(reports["forecast"], teams_ref)
    covered = set(reports["forecast"]["league_key"]) if not reports["forecast"].empty else set()
    cup_forecast, cup_meta = forecast_cups(pd.concat(results, ignore_index=True), competitions, leagues, covered)
    forecast["matches"] = sorted(forecast["matches"] + cup_forecast, key=lambda m: (m["date"], m["competition"]))
    forecast["cupModel"] = cup_meta
    forecast["tables"] = build_tables(reports["forecast_table"], teams_ref)
    add_season_simulation(forecast, reports["forecast_table"], reports["forecast"])
    all_results = pd.concat(results, ignore_index=True)
    forecast["market"] = compare_with_market(forecast, reports, all_results, competitions)
    write_json(args.out / "forecast.json", forecast)

    for season in sorted(by_season):
        players = all_players[all_players["_app_season"] == season].drop(columns="_app_season")
        teams = (all_teams[all_teams["_app_season"] == season].drop(columns="_app_season")
                 if not all_teams.empty else pd.DataFrame())
        write_json(args.out / "players" / f"{season}.json", columnar(players.reset_index(drop=True)))
        write_json(args.out / "teams" / f"{season}.json", columnar(teams.reset_index(drop=True)))
        comps = sorted(players["Competition"].unique())
        seasons_index.append({"id": season, "players": len(players), "teams": len(teams), "competitions": comps})
        print(f"{season} : {len(players)} joueurs, {len(teams)} équipes, {len(comps)} compétitions")

    # Fiabilité du RAPM par championnat (corrélation entre moitiés de saison, pipeline)
    for _, r in reports["rapm_summary"].iterrows():
        if r["league_key"] in competitions:
            competitions[r["league_key"]]["rapmReliability"] = {
                "off": round(float(r["fiabilite_o"]), 2), "def": round(float(r["fiabilite_d"]), 2),
                "net": round(float(r["fiabilite_net"]), 2)}

    for comp in competitions.values():
        comp["seasons"] = sorted(set(comp["seasons"]))

    write_json(index_path, {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": DATA_REPO,
        "hasMarketValues": market is not None or previous.get("hasMarketValues", False),
        "seasons": sorted(seasons_index, key=lambda s: s["id"]),
        "competitions": sorted(competitions.values(), key=lambda c: (c["tier"], c["key"])),
        "models": {
            "valuation": valuation_meta,
            "styles": styles_meta,
            "ageCurvePairs": curves["pairs"],
        },
    })
    print(f"Écrit dans {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
