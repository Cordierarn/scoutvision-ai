"""
Client OddsPapi (v4) pour le Labo paris.

- clé lue dans l'environnement, jamais dans les journaux, messages d'erreur ni fichiers écrits ;
- limitation de débit par endpoint, reprise sur 429 (délai annoncé par l'API) et 5xx (backoff
  exponentiel), 3 tentatives au plus ; après le troisième échec, erreur explicite et rien d'écrit ;
- compteur de requêtes mensuel persistant (`.research/betting/quota.json`) qui bloque l'appel qui
  dépasserait le quota ;
- cache disque des réponses (une réponse relue ne compte pas) ;
- fenêtre de fixtures découpée par 10 jours, bookmakers découpés par 3.

L'accès HTTP est injectable (`http=`) : les tests tournent sans réseau.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

from . import RESEARCH, SPORT_ID
from .env import api_key as default_api_key

BASE_URL = "https://api.oddspapi.io/v4"
FIXTURE_WINDOW_DAYS = 10
MAX_BOOKMAKERS_PER_CALL = 3
DEFAULT_BUDGET = 250
# Délai minimal entre deux appels d'un même endpoint (429 constaté à 0,9 s sur /fixtures ; 5 s annoncés sur /historical-odds)
MIN_INTERVAL = {"fixtures": 1.5, "historical-odds": 6.5, "odds-by-tournaments": 2.0, "odds": 1.0}
DEFAULT_INTERVAL = 1.0
CACHE_TTL = {"sports": 30 * 86400, "bookmakers": 30 * 86400, "markets": 30 * 86400, "historical-odds": 0,
             "fixtures": 6 * 3600, "odds-by-tournaments": 0, "odds": 0, "account": 0}

HttpResponse = tuple[int, dict, bytes]
Http = Callable[[str, dict], HttpResponse]


class OddsPapiError(RuntimeError):
    pass


class QuotaExceeded(OddsPapiError):
    pass


def _redact(text: str, key: str) -> str:
    return text.replace(key, "***") if key else text


def _requests_http(url: str, params: dict) -> HttpResponse:
    import requests  # dépendance déjà utilisée par le pipeline

    r = requests.get(url, params=params, timeout=120)
    return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content


@dataclass
class Quota:
    """Compteur mensuel persistant : `used` appels facturables depuis le début du mois (UTC)."""

    path: Path | None
    budget: int = DEFAULT_BUDGET
    month: str = ""
    used: int = 0
    log: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path | None, budget: int = DEFAULT_BUDGET, now: dt.datetime | None = None) -> "Quota":
        month = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m")
        q = cls(path=path, budget=budget, month=month)
        if path and path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("budget"):
                q.budget = int(data["budget"])
            if data.get("month") == month:
                q.used, q.log = int(data.get("used", 0)), list(data.get("log", []))
        return q

    def save(self) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({"month": self.month, "budget": self.budget, "used": self.used, "log": self.log[-2000:]},
                                            ensure_ascii=False, indent=1), encoding="utf-8")

    @property
    def remaining(self) -> int:
        return self.budget - self.used

    def charge(self, endpoint: str, status: int, at: str) -> None:
        self.used += 1
        self.log.append({"at": at, "endpoint": endpoint, "status": status})
        self.save()


class OddsPapiClient:
    def __init__(self, api_key: str | None = None, *, base_url: str = BASE_URL, cache_dir: Path | None = RESEARCH / "cache",
                 quota: Quota | None = None, http: Http | None = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, now: Callable[[], dt.datetime] | None = None,
                 max_attempts: int = 3, min_interval: dict[str, float] | None = None) -> None:
        self._key = api_key if api_key is not None else default_api_key()
        if not self._key:
            raise OddsPapiError("Clé OddsPapi vide.")
        self.base_url = base_url.rstrip("/")
        self.cache_dir = cache_dir
        self.quota = quota if quota is not None else Quota.load(RESEARCH / "quota.json")
        self._http = http or _requests_http
        self._sleep, self._clock = sleep, clock
        self._now = now or (lambda: dt.datetime.now(dt.timezone.utc))
        self.max_attempts = max_attempts
        self.min_interval = {**MIN_INTERVAL, **(min_interval or {})}
        self._last_call: dict[str, float] = {}
        self.calls = 0        # appels HTTP émis (tentatives comprises)
        self.cache_hits = 0

    # ----- utilitaires -----
    def redact(self, text: str) -> str:
        return _redact(text, self._key)

    def _cache_path(self, endpoint: str, params: dict) -> Path | None:
        if self.cache_dir is None:
            return None
        digest = hashlib.sha256(json.dumps([endpoint, sorted(params.items())], sort_keys=True, default=str).encode()).hexdigest()[:24]
        return self.cache_dir / endpoint / f"{digest}.json"

    def _throttle(self, endpoint: str) -> None:
        interval = self.min_interval.get(endpoint, DEFAULT_INTERVAL)
        last = self._last_call.get(endpoint)
        if last is not None:
            wait = interval - (self._clock() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_call[endpoint] = self._clock()

    # ----- appel générique -----
    def get(self, endpoint: str, *, use_cache: bool = True, **params) -> object:
        params = {k: v for k, v in params.items() if v is not None}
        cache = self._cache_path(endpoint, params)
        ttl = CACHE_TTL.get(endpoint, 0)
        if use_cache and cache and cache.exists() and ttl > 0:
            meta = json.loads(cache.read_text(encoding="utf-8"))
            fetched = dt.datetime.fromisoformat(meta["fetchedAt"])
            if (self._now() - fetched).total_seconds() <= ttl:
                self.cache_hits += 1
                return meta["body"]
        if self.quota.remaining < self.max_attempts:  # chaque tentative compte : garder la place des reprises
            raise QuotaExceeded(f"Quota OddsPapi atteint ({self.quota.used}/{self.quota.budget} pour {self.quota.month}) : appel {endpoint} refusé.")
        url = f"{self.base_url}/{endpoint}"
        query = {"apiKey": self._key, **params}
        last_error = "inconnue"
        for attempt in range(1, self.max_attempts + 1):
            self._throttle(endpoint)
            self.calls += 1
            try:
                status, headers, body = self._http(url, query)
            except Exception as exc:  # réseau : traité comme un 5xx
                status, headers, body = 599, {}, self.redact(str(exc)).encode()
            at = self._now().isoformat(timespec="seconds")
            self.quota.charge(endpoint, status, at)  # le serveur compte chaque appel, 429 et 5xx compris (mesuré)
            if status == 200:
                try:
                    data = json.loads(body.decode("utf-8"))
                except ValueError as exc:
                    raise OddsPapiError(f"Réponse {endpoint} illisible : {self.redact(str(exc))}") from exc
                if cache and ttl > 0:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(json.dumps({"endpoint": endpoint, "params": params, "fetchedAt": at, "body": data}, ensure_ascii=False), encoding="utf-8")
                return data
            text = self.redact(body.decode("utf-8", "replace")[:300])
            if status == 429:
                delay = self._retry_delay(body, attempt)
                self.min_interval[endpoint] = max(self.min_interval.get(endpoint, DEFAULT_INTERVAL), delay + 0.5)
                last_error = f"429 (attente {delay:.1f} s) : {text}"
            elif status >= 500:
                delay = float(2 ** attempt)
                last_error = f"{status} : {text}"
            elif status == 404:
                return None
            else:
                raise OddsPapiError(f"OddsPapi {endpoint} → {status} : {text}")
            if attempt < self.max_attempts:
                self._sleep(delay)
        raise OddsPapiError(f"OddsPapi {endpoint} : {self.max_attempts} échecs, dernier {last_error}. Rien n'a été écrit.")

    @staticmethod
    def _retry_delay(body: bytes, attempt: int) -> float:
        try:
            ms = json.loads(body.decode("utf-8")).get("error", {}).get("retryMs")
            if ms:
                return max(float(ms) / 1000.0, 0.1) + 1.0
        except (ValueError, AttributeError):
            pass
        return float(2 ** attempt)

    # ----- endpoints -----
    def sports(self) -> list[dict]:
        return self.get("sports")

    def bookmakers(self) -> list[dict]:
        return self.get("bookmakers")

    def markets(self, sport_id: int = SPORT_ID) -> list[dict]:
        return self.get("markets", sportId=sport_id)

    def account(self) -> dict:
        """Compte (facture un appel) ; la clé et l'e-mail sont retirés de la réponse renvoyée."""
        data = self.get("account", use_cache=False)
        data = dict(data)
        data.pop("api_key", None)
        data.pop("email", None)
        return data

    def fixtures(self, start: dt.datetime, end: dt.datetime, sport_id: int = SPORT_ID) -> list[dict]:
        """Rencontres entre `start` et `end` (UTC), par fenêtres de 10 jours maximum, sans doublon."""
        out: dict[str, dict] = {}
        cursor = start
        while cursor < end:
            stop = min(cursor + dt.timedelta(days=FIXTURE_WINDOW_DAYS), end)
            page = self.get("fixtures", sportId=sport_id, **{"from": _iso(cursor), "to": _iso(stop)}) or []
            for fx in page:
                out[fx["fixtureId"]] = fx
            cursor = stop
        return list(out.values())

    def historical_odds(self, fixture_id: str, bookmakers: list[str]) -> dict | None:
        """Historique complet d'un match pour les bookmakers demandés (3 par appel) ; None si absent (404)."""
        merged: dict | None = None
        for i in range(0, len(bookmakers), MAX_BOOKMAKERS_PER_CALL):
            chunk = bookmakers[i:i + MAX_BOOKMAKERS_PER_CALL]
            data = self.get("historical-odds", fixtureId=fixture_id, bookmakers=",".join(chunk))
            if not data:
                continue
            if merged is None:
                merged = {"fixtureId": data.get("fixtureId", fixture_id), "bookmakers": {}}
            merged["bookmakers"].update(data.get("bookmakers", {}))
        return merged

    def odds_by_tournaments(self, tournament_ids: list[int], bookmakers: list[str]) -> list[dict]:
        """Cotes courantes de toutes les rencontres à venir des tournois (un appel par tournoi, bookmakers par 3)."""
        out: dict[str, dict] = {}
        for tid in tournament_ids:
            for i in range(0, len(bookmakers), MAX_BOOKMAKERS_PER_CALL):
                chunk = bookmakers[i:i + MAX_BOOKMAKERS_PER_CALL]
                for fx in self.get("odds-by-tournaments", use_cache=False, tournamentIds=tid, bookmakers=",".join(chunk)) or []:
                    cur = out.setdefault(fx["fixtureId"], {**fx, "bookmakerOdds": {}})
                    cur["bookmakerOdds"].update(fx.get("bookmakerOdds", {}))
        return list(out.values())


def _iso(d: dt.datetime) -> str:
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def url_for(endpoint: str, params: dict) -> str:
    """URL sans clé, pour les journaux."""
    return f"{BASE_URL}/{endpoint}?{urlencode({k: v for k, v in params.items() if k != 'apiKey'})}"
