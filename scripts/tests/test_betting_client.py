"""
Tests du client OddsPapi (scripts/betting/client.py) sans réseau : HTTP simulé, horloge et sommeil injectés.

  python3 -m unittest tests.test_betting_client -v        # ou : npm run test:data
"""

from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from betting import client as cl

KEY = "cle-de-test-0000"


class FakeHttp:
    """File de réponses (status, body) ; enregistre les URL et paramètres reçus."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url, params):
        self.calls.append((url, dict(params)))
        status, body = self.responses.pop(0) if self.responses else (200, [])
        if callable(body):
            body = body(params)
        return status, {}, json.dumps(body).encode()


def make_client(responses, budget=250, used=0, cache_dir=None, now=None):
    quota = cl.Quota(path=None, budget=budget, used=used, month="2026-11")
    http = FakeHttp(responses)
    sleeps: list[float] = []
    clock = {"t": 1000.0}
    c = cl.OddsPapiClient(KEY, cache_dir=cache_dir, quota=quota, http=http, sleep=lambda s: sleeps.append(s) or clock.__setitem__("t", clock["t"] + s),
                          clock=lambda: clock["t"], now=now or (lambda: dt.datetime(2026, 11, 2, 12, tzinfo=dt.timezone.utc)))
    return c, http, sleeps


class ClientTests(unittest.TestCase):
    def test_key_from_environment_only_and_never_in_messages(self):
        import os
        os.environ.pop("ODDSPAPI_API_KEY", None)
        with self.assertRaises(RuntimeError):
            cl.OddsPapiClient(cache_dir=None, quota=cl.Quota(path=None))
        c, http, _ = make_client([(400, {"error": {"message": f"bad key {KEY}"}})])
        with self.assertRaises(cl.OddsPapiError) as ctx:
            c.get("sports")
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertEqual(http.calls[0][1]["apiKey"], KEY)  # la clé part bien en paramètre de requête
        self.assertNotIn(KEY, cl.url_for("sports", {"apiKey": KEY, "sportId": 10}))

    def test_429_then_200_resumes_after_announced_delay(self):
        c, http, sleeps = make_client([(429, {"error": {"code": "RATE_LIMITED", "retryMs": 904}}), (200, [{"sportId": 10}])])
        self.assertEqual(c.get("sports"), [{"sportId": 10}])
        self.assertEqual(len(http.calls), 2)
        self.assertTrue(any(abs(s - 1.904) < 1e-6 for s in sleeps))
        self.assertEqual(c.quota.used, 2)  # la tentative 429 est facturée par le serveur (mesuré en phase 1)

    def test_three_5xx_failures_raise_and_write_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, http, sleeps = make_client([(502, "x"), (503, "y"), (500, "z")], cache_dir=Path(tmp))
            with self.assertRaises(cl.OddsPapiError) as ctx:
                c.get("markets", sportId=10)
            self.assertIn("3 échecs", str(ctx.exception))
            self.assertEqual(len(http.calls), 3)
            self.assertEqual(sleeps[:2], [2.0, 4.0])  # backoff exponentiel entre tentatives
            self.assertEqual(list(Path(tmp).rglob("*.json")), [])
            self.assertEqual(c.quota.used, 3)  # trois appels émis, trois comptés

    def test_quota_blocks_the_call_that_would_exceed_it(self):
        c, http, _ = make_client([(200, [])], budget=10, used=10)
        with self.assertRaises(cl.QuotaExceeded):
            c.get("sports")
        self.assertEqual(http.calls, [])
        # il faut la place de trois tentatives : à 7/10 l'appel passe, à 8/10 il est refusé
        c2, http2, _ = make_client([(200, []), (200, [])], budget=10, used=7)
        c2.get("sports")
        with self.assertRaises(cl.QuotaExceeded):
            c2.get("sports", use_cache=False)
        self.assertEqual(len(http2.calls), 1)

    def test_fixture_window_over_ten_days_is_split(self):
        pages = [(200, lambda p: [{"fixtureId": f"id{p['from'][:10]}", "tournamentId": 17}]) for _ in range(4)]
        c, http, _ = make_client(pages)
        out = c.fixtures(dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc), dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc))
        froms = [p["from"] for _, p in http.calls]
        self.assertEqual(froms, ["2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z", "2026-10-21T00:00:00Z", "2026-10-31T00:00:00Z"])
        self.assertEqual(http.calls[-1][1]["to"], "2026-11-02T00:00:00Z")
        self.assertEqual(len(out), 4)

    def test_more_than_three_bookmakers_are_chunked(self):
        body = lambda p: {"fixtureId": "f1", "bookmakers": {b: {"markets": {}} for b in p["bookmakers"].split(",")}}
        c, http, _ = make_client([(200, body), (200, body)])
        out = c.historical_odds("f1", ["b1", "b2", "b3", "b4"])
        self.assertEqual([p["bookmakers"] for _, p in http.calls], ["b1,b2,b3", "b4"])
        self.assertEqual(sorted(out["bookmakers"]), ["b1", "b2", "b3", "b4"])

    def test_404_is_none_and_cache_avoids_a_second_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            c, http, _ = make_client([(404, {"error": {"code": "NOT_FOUND"}}), (200, {"fixtureId": "f2", "bookmakers": {}}), (200, [{"marketId": 101}])], cache_dir=Path(tmp))
            self.assertIsNone(c.historical_odds("f1", ["winamax.fr"]))
            self.assertEqual(c.historical_odds("f2", ["winamax.fr"])["fixtureId"], "f2")
            self.assertEqual(c.markets(), c.markets())  # catalogue relu du cache
            self.assertEqual(len(http.calls), 3)
            self.assertEqual(c.cache_hits, 1)
            self.assertEqual(c.quota.used, 3)
            self.assertEqual(c.quota.used, len(http.calls))
            cached = Path(tmp).rglob("*.json")
            self.assertTrue(all(KEY not in p.read_text() for p in cached))

    def test_throttle_respects_minimal_interval_per_endpoint(self):
        c, http, sleeps = make_client([(200, {"fixtureId": "a", "bookmakers": {}}), (200, {"fixtureId": "b", "bookmakers": {}})])
        c.historical_odds("a", ["w"])
        c.historical_odds("b", ["w"])
        self.assertTrue(any(abs(s - 6.5) < 1e-6 for s in sleeps))

    def test_429_raises_the_endpoint_interval(self):
        c, http, sleeps = make_client([(429, {"error": {"retryMs": 4000}}), (200, {"fixtureId": "a", "bookmakers": {}})])
        c.historical_odds("a", ["w"])
        self.assertGreaterEqual(c.min_interval["historical-odds"], 4.7)

    def test_account_strips_key_and_email(self):
        c, _, _ = make_client([(200, {"api_key": KEY, "email": "x@y.z", "subscriptions": [{"plan": "free", "request_limit": 250}]})])
        acc = c.account()
        self.assertNotIn("api_key", acc)
        self.assertNotIn("email", acc)
        self.assertEqual(acc["subscriptions"][0]["plan"], "free")

    def test_quota_persists_per_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "quota.json"
            q = cl.Quota.load(p, now=dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc))
            q.charge("sports", 200, "2026-11-02T00:00:00")
            again = cl.Quota.load(p, now=dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc))
            self.assertEqual(again.used, 1)
            next_month = cl.Quota.load(p, now=dt.datetime(2026, 12, 1, tzinfo=dt.timezone.utc))
            self.assertEqual(next_month.used, 0)
            q.budget = 5000; q.save()
            self.assertEqual(cl.Quota.load(p).budget, 5000)  # budget relu du fichier (plan payant)


if __name__ == "__main__":
    unittest.main()
