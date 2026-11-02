"""
Simulation du score d'un match (phase 2) à partir des buts attendus domicile et extérieur.

- 20 000 tirages par match, graine fixe ; buts par équipe, par mi-temps, équipe du premier et du dernier but.
- Variantes de la loi conjointe des buts : Poisson indépendant, correction de Dixon-Coles des scores faibles
  (paramètre rho), binomiale négative (surdispersion k). Les paramètres sont ajustés par maximum de
  vraisemblance sur une saison, la variante retenue est choisie une fois et figée (voir `variant.py`).
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

N_SIMS = 20_000
SEED = 7
MAX_GOALS = 10
VARIANTS = ("poisson", "dixon_coles", "negbin")


@dataclass(frozen=True)
class Variant:
    name: str = "poisson"
    rho: float = 0.0          # Dixon-Coles
    dispersion: float = 0.0   # binomiale négative : variance = mu + mu² / k ; 0 = Poisson


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


def _marginal(mu: float, variant: Variant, max_goals: int) -> np.ndarray:
    k = np.arange(max_goals + 1)
    if variant.name == "negbin" and variant.dispersion > 0:
        n = variant.dispersion
        p = n / (n + mu)
        pmf = stats.nbinom.pmf(k, n, p)
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
    ph, pa = _marginal(xg_home, variant, max_goals), _marginal(xg_away, variant, max_goals)
    m = np.outer(ph, pa)
    if variant.name == "dixon_coles" and variant.rho != 0.0:
        h, a = np.meshgrid(np.arange(max_goals + 1), np.arange(max_goals + 1), indexing="ij")
        m = m * _tau(h, a, xg_home, xg_away, variant.rho)
    return m / m.sum()


def log_likelihood(xg_home: np.ndarray, xg_away: np.ndarray, ft_home: np.ndarray, ft_away: np.ndarray, variant: Variant) -> float:
    """Log-vraisemblance des scores observés (bornés à MAX_GOALS) sous la variante."""
    ll = 0.0
    for mh, ma, h, a in zip(xg_home, xg_away, np.minimum(ft_home, MAX_GOALS), np.minimum(ft_away, MAX_GOALS)):
        ll += np.log(score_matrix(float(mh), float(ma), variant)[int(h), int(a)])
    return float(ll)


def fit_variant(name: str, xg_home: np.ndarray, xg_away: np.ndarray, ft_home: np.ndarray, ft_away: np.ndarray) -> Variant:
    """Ajuste rho (Dixon-Coles) ou k (binomiale négative) par maximum de vraisemblance sur une grille."""
    if name == "poisson":
        return Variant("poisson")
    if name == "dixon_coles":
        grid = [Variant("dixon_coles", rho=r) for r in np.round(np.arange(-0.20, 0.151, 0.01), 2)]
    elif name == "negbin":
        grid = [Variant("negbin", dispersion=k) for k in (2, 3, 5, 8, 12, 20, 35, 60, 100, 200, 500)]
    else:
        raise ValueError(name)
    return max(grid, key=lambda v: log_likelihood(xg_home, xg_away, ft_home, ft_away, v))


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
