"""
Simulation du score d'un match (phase 2) à partir des buts attendus domicile et extérieur.

- 20 000 tirages par match, graine fixe ; buts par équipe, par mi-temps, équipe du premier et du dernier but.
- Variantes de la loi conjointe des buts : Poisson indépendant, correction de Dixon-Coles des scores faibles
  (paramètre rho), binomiale négative (surdispersion k), et « compoisson » : marginales de Conway-Maxwell-
  Poisson (nu > 1 : sous-dispersion, la variance des buts est inférieure à la moyenne) avec rétrécissement du
  total attendu vers la moyenne de la compétition à supériorité constante (shrink < 1) et Dixon-Coles. Les
  paramètres sont ajustés par maximum de vraisemblance sur une saison, la variante retenue est choisie une
  fois sur la saison suivante et figée (phase2.choose_variant → variant.json).
  Constat du 5 novembre 2026 (buts attendus figés 2024-25 → 2025-26) : les totaux observés sont SOUS-dispersés
  (variance / moyenne 0,85 à 0,98 selon la ligue) et les buts attendus trop étalés (pente buts ~ xG de 0,76 à
  0,84) ; la binomiale négative dégrade toutes les vraisemblances, la combinaison nu ≈ 1,15, shrink ≈ 0,8,
  rho ≈ −0,03 les améliore toutes (score exact, 1N2, plus/moins 1,5 à 4,5, BTTS, totaux par équipe).
- Les mi-temps : chaque but est en première mi-temps avec la probabilité `p_first_half` de la compétition
  (estimée sur les saisons antérieures) ; l'ordre des buts est une permutation uniforme, d'où le premier
  et le dernier buteur (équipe).

Aucun modèle de prévision n'est touché : les buts attendus viennent des prévisions figées de la recherche
(`.research/forecast/predictions/{saison}.parquet`) ou des prévisions du pipeline pour les matchs à venir.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats
from scipy.special import gammaln

N_SIMS = 20_000
SEED = 7
MAX_GOALS = 10
VARIANTS = ("poisson", "dixon_coles", "negbin", "compoisson")


@dataclass(frozen=True)
class Variant:
    name: str = "poisson"
    rho: float = 0.0          # Dixon-Coles
    dispersion: float = 0.0   # binomiale négative : variance = mu + mu² / k ; 0 = Poisson
    nu: float = 1.0           # Conway-Maxwell-Poisson : 1 = Poisson, > 1 sous-dispersion
    shrink: float = 1.0       # rétrécissement du total attendu vers `mean_total` (1 = aucun), supériorité conservée
    mean_total: float = 0.0   # total attendu moyen de la saison d'ajustement (référence du rétrécissement)

    def expected(self, xg_home: float, xg_away: float) -> tuple[float, float]:
        """Buts attendus après rétrécissement du total : T' = m + s · (T − m), différence domicile − extérieur inchangée."""
        if self.shrink == 1.0 or self.mean_total <= 0:
            return float(xg_home), float(xg_away)
        total, diff = xg_home + xg_away, xg_home - xg_away
        total = self.mean_total + self.shrink * (total - self.mean_total)
        return max(0.05, (total + diff) / 2), max(0.05, (total - diff) / 2)


@dataclass
class Simulated:
    """Tirages d'un match (entiers) : score final, score à la mi-temps, premier et dernier but (0 aucun, 1 domicile, 2 extérieur)."""

    ft_home: np.ndarray
    ft_away: np.ndarray
    ht_home: np.ndarray
    ht_away: np.ndarray
    first_goal: np.ndarray
    last_goal: np.ndarray

    @property
    def sh_home(self) -> np.ndarray:
        return self.ft_home - self.ht_home

    @property
    def sh_away(self) -> np.ndarray:
        return self.ft_away - self.ht_away

    def period(self, period: str) -> tuple[np.ndarray, np.ndarray]:
        if period == "fulltime":
            return self.ft_home, self.ft_away
        if period == "p1":
            return self.ht_home, self.ht_away
        if period == "p2":
            return self.sh_home, self.sh_away
        raise ValueError(period)


_COM_CACHE: dict[tuple[float, float, int], np.ndarray] = {}


def com_poisson_pmf(mu: float, nu: float, max_goals: int = MAX_GOALS) -> np.ndarray:
    """Conway-Maxwell-Poisson tronquée à max_goals, paramétrée par sa moyenne : p(k) ∝ λ^k / (k!)^nu, λ choisi par
    bissection pour que la moyenne vaille `mu` (nu = 1 : Poisson). Mise en cache par (mu arrondi, nu)."""
    key = (round(float(mu), 4), round(float(nu), 4), max_goals)
    hit = _COM_CACHE.get(key)
    if hit is not None:
        return hit
    k = np.arange(max_goals + 1)
    if abs(nu - 1.0) < 1e-12:                      # Poisson exact, masse au-delà de max_goals repliée sur la dernière case
        pmf = stats.poisson.pmf(k, mu)
        pmf[-1] += max(0.0, 1.0 - pmf.sum())
        return pmf
    log_fact = gammaln(k + 1)

    def pmf_of(lam: float) -> np.ndarray:
        logp = k * np.log(lam) - nu * log_fact
        logp -= logp.max()
        q = np.exp(logp)
        return q / q.sum()

    lo, hi = 1e-6, 80.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if float((pmf_of(mid) * k).sum()) < mu:
            lo = mid
        else:
            hi = mid
    pmf = pmf_of((lo + hi) / 2)
    if len(_COM_CACHE) > 200_000:
        _COM_CACHE.clear()
    _COM_CACHE[key] = pmf
    return pmf


def _marginal(mu: float, variant: Variant, max_goals: int) -> np.ndarray:
    k = np.arange(max_goals + 1)
    if variant.name == "negbin" and variant.dispersion > 0:
        n = variant.dispersion
        p = n / (n + mu)
        pmf = stats.nbinom.pmf(k, n, p)
    elif variant.nu != 1.0:
        return com_poisson_pmf(mu, variant.nu, max_goals)
    else:
        pmf = stats.poisson.pmf(k, mu)
    pmf[-1] += max(0.0, 1.0 - pmf.sum())  # masse au-delà de max_goals repliée sur la dernière case
    return pmf


def _tau(h: np.ndarray, a: np.ndarray, mu_h: float, mu_a: float, rho: float) -> np.ndarray:
    t = np.ones_like(h, dtype=float)
    t[(h == 0) & (a == 0)] = 1 - mu_h * mu_a * rho
    t[(h == 0) & (a == 1)] = 1 + mu_h * rho
    t[(h == 1) & (a == 0)] = 1 + mu_a * rho
    t[(h == 1) & (a == 1)] = 1 - rho
    return np.clip(t, 1e-9, None)


def score_matrix(xg_home: float, xg_away: float, variant: Variant = Variant(), max_goals: int = MAX_GOALS) -> np.ndarray:
    """Loi conjointe du score final, lignes = buts domicile, colonnes = buts extérieur ; somme 1."""
    xg_home, xg_away = variant.expected(xg_home, xg_away)
    ph, pa = _marginal(xg_home, variant, max_goals), _marginal(xg_away, variant, max_goals)
    m = np.outer(ph, pa)
    if variant.rho != 0.0:
        h, a = np.meshgrid(np.arange(max_goals + 1), np.arange(max_goals + 1), indexing="ij")
        m = m * _tau(h, a, xg_home, xg_away, variant.rho)
    return m / m.sum()


def log_likelihood(xg_home: np.ndarray, xg_away: np.ndarray, ft_home: np.ndarray, ft_away: np.ndarray, variant: Variant) -> float:
    """Log-vraisemblance des scores observés (bornés à MAX_GOALS) sous la variante."""
    ll = 0.0
    for mh, ma, h, a in zip(xg_home, xg_away, np.minimum(ft_home, MAX_GOALS), np.minimum(ft_away, MAX_GOALS)):
        ll += np.log(score_matrix(float(mh), float(ma), variant)[int(h), int(a)])
    return float(ll)


SHRINK_GRID = tuple(np.round(np.arange(0.60, 1.001, 0.05), 2))
NU_GRID = tuple(np.round(np.arange(1.00, 1.351, 0.05), 2))
RHO_GRID = tuple(np.round(np.arange(-0.08, 0.001, 0.01), 2))


def fit_variant(name: str, xg_home: np.ndarray, xg_away: np.ndarray, ft_home: np.ndarray, ft_away: np.ndarray) -> Variant:
    """Ajuste rho (Dixon-Coles), k (binomiale négative) ou (shrink, nu, rho) (compoisson, recherche par coordonnées :
    shrink × nu à rho = −0,03 puis rho) par maximum de vraisemblance du score exact sur une grille."""
    if name == "poisson":
        return Variant("poisson")
    ll = lambda v: log_likelihood(xg_home, xg_away, ft_home, ft_away, v)
    if name == "dixon_coles":
        return max((Variant("dixon_coles", rho=r) for r in np.round(np.arange(-0.20, 0.151, 0.01), 2)), key=ll)
    if name == "negbin":
        return max((Variant("negbin", dispersion=k) for k in (2, 3, 5, 8, 12, 20, 35, 60, 100, 200, 500)), key=ll)
    if name == "compoisson":
        mean_total = float(np.mean(np.asarray(xg_home, dtype=float) + np.asarray(xg_away, dtype=float)))
        best = max((Variant("compoisson", rho=-0.03, nu=float(nu), shrink=float(s), mean_total=mean_total) for s in SHRINK_GRID for nu in NU_GRID), key=ll)
        return max((Variant("compoisson", rho=float(r), nu=best.nu, shrink=best.shrink, mean_total=mean_total) for r in RHO_GRID), key=ll)
    raise ValueError(name)


def simulate(xg_home: float, xg_away: float, p_first_half: float, variant: Variant = Variant(), n: int = N_SIMS,
             seed: int = SEED, max_goals: int = MAX_GOALS) -> Simulated:
    rng = np.random.default_rng(seed)
    m = score_matrix(xg_home, xg_away, variant, max_goals)
    flat = rng.choice(m.size, size=n, p=m.ravel())
    ft_h, ft_a = (flat // (max_goals + 1)).astype(np.int16), (flat % (max_goals + 1)).astype(np.int16)
    ht_h = rng.binomial(ft_h, p_first_half).astype(np.int16)
    ht_a = rng.binomial(ft_a, p_first_half).astype(np.int16)
    total = ft_h + ft_a
    # ordre des buts : permutation uniforme des étiquettes → premier but domicile avec probabilité n_h / N
    u1, u2 = rng.random(n), rng.random(n)
    first = np.where(total == 0, 0, np.where(u1 * np.maximum(total, 1) < ft_h, 1, 2)).astype(np.int8)
    rem_h = ft_h - (first == 1)
    rem_total = np.maximum(total - 1, 1)
    last = np.where(total == 0, 0, np.where(total == 1, first, np.where(u2 * rem_total < rem_h, 1, 2))).astype(np.int8)
    return Simulated(ft_h, ft_a, ht_h, ht_a, first, last)
