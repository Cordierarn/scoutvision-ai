"""
Référence sharp par The Odds API : cotes Pinnacle et Betfair Exchange (région EU) des rencontres à venir,
écrites dans l'archive du Labo au même schéma que les relevés Winamax, sous les bookmakers `pinnacle` et
`betfair-ex` (ceux que lit `sharp.market_reference`).

Pourquoi cette source : l'abonnement OddsPapi « normal » ne couvre que Winamax ; Pinnacle, Betfair et tous
les autres y sont refusés (RESTRICTED_ACCESS, mesuré le 5 novembre 2026). The Odds API sert Pinnacle sur
toutes les rencontres des compétitions du Labo et Betfair Exchange sur une partie, sur les trois marchés
principaux (1N2, plus/moins ligne principale, handicap asiatique ligne principale).

  cd scripts
  python3 -m betting.sharpfeed pull [--hours 24] [--daily [--not-before 09:00]] [--markets h2h,totals,spreads]
                                        relevé des sports qui ont une rencontre dans la fenêtre ; --daily : un seul
                                        passage par jour, le premier à partir de --not-before (UTC)
  python3 -m betting.sharpfeed status   crédits du mois et coût prévu du passage quotidien jusqu'à la fin du mois

Crédits : un appel coûte un crédit par marché demandé (3 par sport et par passage) ; le plan gratuit en donne
500 par mois, lus dans les en-têtes `x-requests-*`. Seuls les sports avec une rencontre dans la fenêtre sont
appelés, et une réserve de 25 crédits est gardée. Le cycle fait un passage par jour sur les rencontres des 24 h
suivantes (`daily_pull_due`, `credits_per_day`), de l'ordre de 300 crédits par mois sur le calendrier réel. Clé dans `THE_ODDS_API_KEY` (variable d'environnement ou
`.env.local`, jamais affichée). Les prix sont datés de l'heure de l'appel : attestés à cet instant, comme les
cotes courantes Winamax. Betfair : prix « back » bruts (les marchés `*_lay` sont ignorés), sans commission.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from . import RESEARCH, TOURNAMENTS
from . import archive
from .catalogue import load as load_catalogue
from .env import load_env_file
from .matching import similarity

KEY_NAME = "THE_ODDS_API_KEY"
BASE_URL = "https://api.the-odds-api.com/v4"
REGION = "eu"
BOOKMAKERS = {"pinnacle": "pinnacle", "betfair_ex_eu": "betfair-ex"}     # clé The Odds API → nom dans l'archive
MARKETS = ("h2h", "totals", "spreads")
SPORT_KEYS = {"ENG": "soccer_epl", "ESP": "soccer_spain_la_liga", "GER": "soccer_germany_bundesliga", "ITA": "soccer_italy_serie_a",
              "FRA": "soccer_france_ligue_one", "ENG2": "soccer_efl_champ", "POR": "soccer_portugal_primeira_liga", "NED": "soccer_netherlands_eredivisie",
              "UCL": "soccer_uefa_champs_league", "UEL": "soccer_uefa_europa_league", "UECL": "soccer_uefa_europa_conference_league"}
BUDGET = 500
RESERVE = 25
# Un passage par jour (audit du 6 novembre 2026 : trois passages sur 36 h coûtaient de l'ordre de 1 000 crédits par mois
# pour un plan de 500) : le premier passage du cycle à partir de DAILY_NOT_BEFORE, sur les rencontres des DAILY_HOURS
# suivantes. Environ 3 crédits par compétition et par jour de match : de l'ordre de 300 par mois sur le calendrier réel.
DAILY_HOURS = 24
DAILY_NOT_BEFORE = dt.time(9, 0)
NAME_THRESHOLD = 0.5
STRONG_THRESHOLD = 0.8       # un côté sûr suffit quand il désigne une seule rencontre du créneau : l'autre nom est appris
KICKOFF_TOLERANCE = dt.timedelta(hours=2)
CREDITS = RESEARCH / "quota_theoddsapi.json"
ALIASES = RESEARCH / "aliases_theoddsapi.json"     # nom The Odds API → nom OddsPapi, appris
SOURCE = "the-odds-api"


class SharpFeedError(RuntimeError):
    pass


def api_key() -> str:
    load_env_file()
    key = os.environ.get(KEY_NAME, "").strip()
    if not key:
        raise SharpFeedError(f"{KEY_NAME} absente : définir la variable d'environnement ou .env.local (jamais commité).")
    return key


@dataclass
class Credits:
    """Crédits du mois : compteur local aligné sur les en-têtes du serveur à chaque réponse."""

    path: Path | None
    month: str
    budget: int = BUDGET
    used: int = 0
    remaining: int | None = None
    log: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path | None = CREDITS, now: dt.datetime | None = None) -> "Credits":
        month = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m")
        c = cls(path=path, month=month)
        if path and path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            c.budget = int(data.get("budget", BUDGET))
            if data.get("month") == month:
                c.used, c.remaining, c.log = int(data.get("used", 0)), data.get("remaining"), list(data.get("log", []))
        return c

    def save(self) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({"month": self.month, "budget": self.budget, "used": self.used, "remaining": self.remaining, "log": self.log[-500:]},
                                            ensure_ascii=False, indent=1), encoding="utf-8")

    @property
    def available(self) -> int:
        return self.remaining if self.remaining is not None else self.budget - self.used

    def charge(self, sport: str, cost: int, headers: dict, at: str) -> None:
        used, remaining = headers.get("x-requests-used"), headers.get("x-requests-remaining")
        self.used = int(used) if used is not None else self.used + cost
        self.remaining = int(remaining) if remaining is not None else (None if self.remaining is None else self.remaining - cost)
        self.log.append({"at": at, "sport": sport, "cost": cost})
        self.save()


def _requests_http(url: str, params: dict) -> tuple[int, dict, bytes]:
    import requests
    r = requests.get(url, params=params, timeout=60)
    return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content


def _redact(text: str, key: str) -> str:
    return text.replace(key, "<clé>") if key else text


class TheOddsApiClient:
    def __init__(self, key: str | None = None, *, http=None, credits: Credits | None = None, now=None, base_url: str = BASE_URL):
        self._key = key if key is not None else api_key()
        self._http = http or _requests_http
        self.credits = credits if credits is not None else Credits.load()
        self._now = now or (lambda: dt.datetime.now(dt.timezone.utc))
        self.base_url = base_url.rstrip("/")

    def odds(self, sport: str, markets=MARKETS, bookmakers=tuple(BOOKMAKERS)) -> list[dict]:
        """Cotes courantes d'un sport pour les bookmakers demandés ; coûte len(markets) crédits."""
        cost = len(markets)
        if self.credits.available - cost < RESERVE:
            raise SharpFeedError(f"Crédits The Odds API insuffisants ({self.credits.available} disponibles, réserve {RESERVE}) : appel {sport} refusé.")
        params = {"regions": REGION, "markets": ",".join(markets), "bookmakers": ",".join(bookmakers), "oddsFormat": "decimal", "apiKey": self._key}
        status, headers, body = self._http(f"{self.base_url}/sports/{sport}/odds", params)
        at = self._now().isoformat(timespec="seconds")
        if status == 200:
            self.credits.charge(sport, cost, headers, at)
            return json.loads(body.decode("utf-8"))
        text = _redact(body.decode("utf-8", "replace")[:300], self._key)
        if status == 401:
            raise SharpFeedError(f"The Odds API refuse la clé (401) : {text}")
        if status == 429 or status == 422:
            self.credits.charge(sport, 0, headers, at)
            raise SharpFeedError(f"The Odds API : quota épuisé ou requête refusée ({status}) : {text}")
        raise SharpFeedError(f"The Odds API {sport} → {status} : {text}")


# ----- conversion des événements en relevés de l'archive -----

def catalogue_index(cat) -> dict:
    """(type, ligne) → marché OddsPapi à temps réglementaire, pour 1N2, plus/moins et handicap."""
    idx: dict[tuple, object] = {}
    for m in cat.values():
        if m.player_prop or m.period != "fulltime" or m.market_type not in ("1x2", "totals", "spreads"):
            continue
        key = (m.market_type, 0.0 if m.market_type == "1x2" else float(m.handicap))
        idx.setdefault(key, m)
    return idx


def _outcome_id(market, name: str) -> int | None:
    for oid, n in market.outcomes.items():
        if n == name:
            return int(oid)
    return None


def load_aliases(path: Path = ALIASES) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_aliases(aliases: dict[str, str], path: Path = ALIASES) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(sorted(aliases.items())), ensure_ascii=False, indent=1), encoding="utf-8")


def _side_score(name: str, candidate: str, aliases: dict[str, str]) -> float:
    return 1.0 if aliases.get(name) == candidate else similarity(name, candidate)


def match_fixture(event: dict, fixtures: pd.DataFrame, competition: str, aliases: dict[str, str] | None = None) -> pd.Series | None:
    """Rencontre OddsPapi de la même compétition, coup d'envoi à ± 2 h : les deux noms similaires (seuil 0,5,
    ou alias appris), sinon un seul côté sûr (≥ 0,8) qui ne désigne qu'une rencontre du créneau ; l'autre nom
    est alors appris dans `aliases` (« Club Delta FC » → le nom OddsPapi). None sans candidat net."""
    aliases = aliases if aliases is not None else {}
    start = pd.Timestamp(event["commence_time"])
    f = fixtures[(fixtures["competition"] == competition) & ((fixtures["start_time"] - start).abs() <= KICKOFF_TOLERANCE)]
    scored = [(r, _side_score(event["home_team"], r.home_name, aliases), _side_score(event["away_team"], r.away_name, aliases)) for r in f.itertuples(index=False)]
    both = sorted([(h + a, r) for r, h, a in scored if h >= NAME_THRESHOLD and a >= NAME_THRESHOLD], key=lambda x: -x[0])
    if both and (len(both) == 1 or both[0][0] - both[1][0] >= 0.2):
        return both[0][1]
    if both:
        return None
    one_side = [(r, h, a) for r, h, a in scored if max(h, a) >= STRONG_THRESHOLD]
    if len(one_side) != 1:
        return None
    r, h, a = one_side[0]
    if h >= STRONG_THRESHOLD and a < NAME_THRESHOLD:
        aliases[event["away_team"]] = r.away_name
    elif a >= STRONG_THRESHOLD and h < NAME_THRESHOLD:
        aliases[event["home_team"]] = r.home_name
    return r


def events_to_snapshots(events: list[dict], fixtures: pd.DataFrame, cat, competition: str, observed_at: dt.datetime,
                        aliases: dict[str, str] | None = None) -> tuple[pd.DataFrame, dict]:
    """Relevés (schéma de l'archive) des bookmakers de référence ; `report` : rencontres appariées ou non,
    marchés sans équivalent au catalogue. `aliases` est enrichi des noms appris."""
    idx = catalogue_index(cat)
    rows, report = [], {"events": len(events), "matched": 0, "unmatched": [], "unknownMarkets": 0, "prices": 0}
    at = observed_at.isoformat()
    for ev in events:
        fx = match_fixture(ev, fixtures, competition, aliases)
        if fx is None:
            report["unmatched"].append(f"{ev.get('home_team')} – {ev.get('away_team')} ({ev.get('commence_time')})")
            continue
        report["matched"] += 1
        home, away = ev["home_team"], ev["away_team"]
        for bk in ev.get("bookmakers", []):
            name = BOOKMAKERS.get(bk.get("key"))
            if name is None:
                continue
            for mk in bk.get("markets", []):
                key = mk.get("key")
                if key not in MARKETS:            # marchés « lay » de l'exchange et autres : ignorés
                    continue
                outs = mk.get("outcomes", [])
                if key == "h2h":
                    market = idx.get(("1x2", 0.0))
                    mapping = {home: "1", away: "2", "Draw": "X"}
                    pairs = [(mapping.get(o.get("name")), o.get("price")) for o in outs]
                elif key == "totals":
                    points = {o.get("point") for o in outs if o.get("point") is not None}
                    if len(points) != 1:
                        report["unknownMarkets"] += 1
                        continue
                    market = idx.get(("totals", float(points.pop())))
                    pairs = [(o.get("name") if o.get("name") in ("Over", "Under") else None, o.get("price")) for o in outs]
                else:
                    home_point = next((o.get("point") for o in outs if o.get("name") == home), None)
                    if home_point is None:
                        report["unknownMarkets"] += 1
                        continue
                    market = idx.get(("spreads", float(home_point)))
                    pairs = [("1" if o.get("name") == home else "2" if o.get("name") == away else None, o.get("price")) for o in outs]
                if market is None or any(n is None for n, _ in pairs):
                    report["unknownMarkets"] += 1
                    continue
                for n, price in pairs:
                    oid = _outcome_id(market, n)
                    if oid is None or not isinstance(price, (int, float)) or price <= 1.0:
                        continue
                    rows.append((fx.fixture_id, name, int(market.market_id), oid, None, at, float(price), None, True, SOURCE))
                    report["prices"] += 1
    df = pd.DataFrame(rows, columns=archive.SNAPSHOT_COLUMNS)
    if not df.empty:
        df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
        df["limit"] = pd.to_numeric(df["limit"], errors="coerce")
        df = df.sort_values(archive.SNAPSHOT_KEY).reset_index(drop=True)
    return df, report


def sports_to_pull(fixtures: pd.DataFrame, now: pd.Timestamp, hours: float) -> list[str]:
    """Compétitions du Labo avec une rencontre à venir dans la fenêtre, dans l'ordre des coups d'envoi."""
    f = fixtures[(fixtures["status_id"] == 0) & (fixtures["start_time"] >= now) & (fixtures["start_time"] <= now + pd.Timedelta(hours=hours))
                 & fixtures["competition"].isin(SPORT_KEYS)]
    return list(f.sort_values("start_time")["competition"].drop_duplicates())


def daily_pull_due(credits: "Credits", now: dt.datetime, not_before: dt.time = DAILY_NOT_BEFORE) -> tuple[bool, str]:
    """Le passage sharp du jour est-il à faire ? Non avant `not_before` (UTC), non si des crédits ont déjà été dépensés
    aujourd'hui ; un appel refusé (coût 0) ne compte pas comme un relevé fait."""
    if now.time() < not_before:
        return False, f"passage sharp du jour à partir de {not_before:%H:%M} UTC"
    today = now.date().isoformat()
    if any(str(e.get("at", ""))[:10] == today and int(e.get("cost", 0)) > 0 for e in credits.log):
        return False, "passage sharp du jour déjà fait"
    return True, "passage sharp du jour"


def credits_per_day(fixtures: pd.DataFrame, start: dt.date, end: dt.date, hours: float = DAILY_HOURS, at: dt.time = dt.time(9, 13),
                    markets: int = len(MARKETS)) -> dict[dt.date, int]:
    """Coût estimé d'un passage quotidien à l'heure `at` : `markets` crédits par compétition couverte par The Odds API ayant
    une rencontre dans les `hours` heures suivantes (calendrier de l'archive)."""
    f = fixtures[fixtures["competition"].isin(SPORT_KEYS)]
    start_times = pd.to_datetime(f["start_time"], utc=True)
    out, day = {}, start
    while day <= end:
        t0 = pd.Timestamp(dt.datetime.combine(day, at), tz="UTC")
        window = f[(start_times >= t0) & (start_times < t0 + pd.Timedelta(hours=hours))]
        out[day] = markets * int(window["competition"].nunique())
        day += dt.timedelta(days=1)
    return out


# ----- ligne de commande -----

def cmd_pull(args) -> int:
    from .fetch import SnapshotBuffer, _odds_path, archive_lock, load_fixtures
    fixtures = load_fixtures()
    if fixtures.empty:
        print("Aucune rencontre OddsPapi en archive : lancer `betting.fetch fixtures` d'abord.")
        return 2
    now = pd.Timestamp.now(tz="UTC")
    if args.daily:
        due, why = daily_pull_due(Credits.load(), now.to_pydatetime(), dt.time.fromisoformat(args.not_before))
        print(f"{why} : {'relevé' if due else 'rien à faire'}")
        if not due:
            return 0
    comps = sports_to_pull(fixtures, now, args.hours)
    markets = tuple(args.markets.split(","))
    client = TheOddsApiClient()
    print(f"{len(comps)} compétition(s) avec une rencontre sous {args.hours:g} h : {', '.join(comps) or 'aucune'} ; "
          f"{len(markets)} crédit(s) par compétition, {client.credits.available} disponibles", flush=True)
    cat = load_catalogue()
    aliases = load_aliases()
    known = len(aliases)
    buffer, totals = SnapshotBuffer(every=10_000), {"matched": 0, "events": 0, "prices": 0, "unmatched": []}
    with archive_lock():
        for comp in comps:
            try:
                events = client.odds(SPORT_KEYS[comp], markets)
            except SharpFeedError as exc:
                print(str(exc))
                break
            observed = dt.datetime.now(dt.timezone.utc)
            snaps, report = events_to_snapshots(events, fixtures, cat, comp, observed, aliases)
            for key in ("matched", "events", "prices"):
                totals[key] += report[key]
            totals["unmatched"] += [f"{comp} : {u}" for u in report["unmatched"]]
            for season, part in snaps.groupby(snaps["fixture_id"].map(fixtures.set_index("fixture_id")["season"])):
                buffer.add(part, _odds_path(comp, str(season)))
            print(f"  {comp:5s} {report['matched']}/{report['events']} rencontres appariées, {report['prices']} prix, {report['unknownMarkets']} marché(s) sans équivalent", flush=True)
        added = buffer.flush()
    if len(aliases) > known:
        save_aliases(aliases)
        print(f"{len(aliases) - known} alias de nom appris ({ALIASES.name})")
    if totals["unmatched"]:
        print("Non appariées : " + " ; ".join(totals["unmatched"][:10]) + (" …" if len(totals["unmatched"]) > 10 else ""))
    print(f"{totals['matched']}/{totals['events']} rencontres, {totals['prices']} prix, {added} relevés ajoutés ; crédits {client.credits.used} utilisés, {client.credits.available} disponibles")
    return 0


def cmd_status(args) -> int:
    from .fetch import load_fixtures
    c = Credits.load()
    print(f"The Odds API {c.month} : {c.used} crédits utilisés, {c.available} disponibles (budget {c.budget}, réserve {RESERVE})")
    today = dt.datetime.now(dt.timezone.utc).date()
    month_end = (today.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    planned = credits_per_day(load_fixtures(), today, month_end)
    known = sum(planned.values())
    print(f"Passage quotidien d'ici la fin du mois : {known} crédits sur les rencontres connues de l'archive "
          f"({sum(1 for v in planned.values() if v)} jours de match connus) ; solde prévu en fin de mois : {c.available - known} crédits "
          f"(réserve de {RESERVE} comprise)")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pull"); p.add_argument("--hours", type=float, default=DAILY_HOURS); p.add_argument("--markets", default=",".join(MARKETS))
    p.add_argument("--daily", action="store_true", help="un seul passage par jour, à partir de --not-before (UTC)")
    p.add_argument("--not-before", default=DAILY_NOT_BEFORE.strftime("%H:%M")); p.set_defaults(fn=cmd_pull)
    p = sub.add_parser("status"); p.set_defaults(fn=cmd_status)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
