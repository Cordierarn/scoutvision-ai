"""
Registre typé des règles de compétition (V1 : championnats dont le format est reproductible).

Chaque règle encode explicitement points, effectif, journées, critères de classement et zones
pertinentes ; rien n'est généralisé depuis le pays. Ce que les données ne permettent pas de
reproduire est documenté dans `approximations` et signale un classement « avec départage approximatif ».
Les barrages (promotion, relégation, titre) ne sont pas simulés : la zone de barrage est rapportée
comme position, pas comme issue.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Critères de départage reconnus
POINTS, GOAL_DIFFERENCE, GOALS_FOR, HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, HEAD_TO_HEAD_AWAY_GOALS, PLAYOFF, DRAW_LOTS = (
    "points", "goal_difference", "goals_for", "head_to_head_points", "head_to_head_goal_difference", "head_to_head_away_goals", "playoff", "draw_lots")
REPRODUCIBLE = {POINTS, GOAL_DIFFERENCE, GOALS_FOR, HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD}


@dataclass(frozen=True)
class CompetitionRules:
    key: str
    name: str
    teams: int
    rounds: int
    points_win: int = 3
    points_draw: int = 1
    points_loss: int = 0
    tiebreaks: tuple[str, ...] = (POINTS, GOAL_DIFFERENCE, GOALS_FOR)
    title_positions: int = 1
    continental_positions: int = 4        # places européennes directes (objectif « top k »), convention de la règle, pas du coefficient annuel
    continental_label: str = "Ligue des champions"
    promotion_positions: int = 0          # montée directe (divisions inférieures)
    promotion_playoff: tuple[int, int] | None = None
    relegation_direct: int = 3
    relegation_playoff: tuple[int, int] | None = None   # positions de barrage de relégation (inclusives)
    approximations: tuple[str, ...] = ()
    season_format: str = "double round robin"

    @property
    def matches(self) -> int:
        return self.teams * (self.teams - 1)

    def objectives(self) -> dict[str, dict]:
        """Objectifs réellement définis par la règle : nom -> positions (1-based, inclusives)."""
        obj = {"title": {"label": "Titre", "positions": [1, self.title_positions]}}
        if self.promotion_positions:
            obj["promotion"] = {"label": "Montée directe", "positions": [1, self.promotion_positions]}
            if self.promotion_playoff:
                obj["promotion_playoff"] = {"label": "Barrage de montée", "positions": list(self.promotion_playoff)}
        else:
            obj["continental"] = {"label": f"{self.continental_label} ({self.continental_positions})", "positions": [1, self.continental_positions]}
        if self.relegation_direct:
            obj["relegation"] = {"label": "Relégation directe", "positions": [self.teams - self.relegation_direct + 1, self.teams]}
        if self.relegation_playoff:
            obj["relegation_playoff"] = {"label": "Barrage de relégation", "positions": list(self.relegation_playoff)}
        return obj

    @property
    def exact(self) -> bool:
        return all(t in REPRODUCIBLE for t in self.tiebreaks) and not self.approximations


H2H_FIRST = (POINTS, HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, GOAL_DIFFERENCE, GOALS_FOR)
GD_FIRST = (POINTS, GOAL_DIFFERENCE, GOALS_FOR)

RULES: dict[str, CompetitionRules] = {
    "ENG": CompetitionRules("ENG", "Premier League", 20, 38, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_AWAY_GOALS, PLAYOFF),
                            relegation_direct=3, continental_positions=4,
                            approximations=("buts à l'extérieur en confrontation directe et match d'appui non reproduits (égalité résiduelle : ordre déterministe)",
                                            "places européennes : 4 par la règle, la 5e place UEFA par coefficient n'est pas modélisée")),
    "ENG2": CompetitionRules("ENG2", "Championship", 24, 46, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, PLAYOFF), promotion_positions=2, promotion_playoff=(3, 6),
                             relegation_direct=3, continental_positions=0, continental_label="",
                             approximations=("barrages de montée non simulés (positions 3-6 rapportées)",)),
    "GER": CompetitionRules("GER", "Bundesliga", 18, 34, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, HEAD_TO_HEAD_AWAY_GOALS),
                            relegation_direct=2, relegation_playoff=(16, 16), continental_positions=4,
                            approximations=("buts à l'extérieur en confrontation directe non reproduits", "barrage de relégation (16e) non simulé")),
    "GER2": CompetitionRules("GER2", "2. Bundesliga", 18, 34, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD), promotion_positions=2, promotion_playoff=(3, 3),
                             relegation_direct=2, relegation_playoff=(16, 16), continental_positions=0, continental_label="",
                             approximations=("barrages de montée (3e) et de relégation (16e) non simulés",)),
    "FRA": CompetitionRules("FRA", "Ligue 1", 18, 34, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD),
                            relegation_direct=2, relegation_playoff=(16, 16), continental_positions=4,
                            approximations=("barrage de relégation (16e) non simulé", "places européennes : 4 par la règle (3 directes + 1 tour préliminaire)")),
    "ESP": CompetitionRules("ESP", "LaLiga", 20, 38, tiebreaks=H2H_FIRST, relegation_direct=3, continental_positions=4,
                            approximations=("confrontation directe appliquée aux égalités à deux équipes ; groupes de trois ou plus : différence de buts (approximatif)",
                                            "places européennes : 4 par la règle, la 5e place par coefficient n'est pas modélisée")),
    "ESP2": CompetitionRules("ESP2", "LaLiga 2", 22, 42, tiebreaks=H2H_FIRST, promotion_positions=2, promotion_playoff=(3, 6), relegation_direct=4,
                             continental_positions=0, continental_label="",
                             approximations=("confrontation directe à deux équipes seulement", "barrages de montée non simulés")),
    "ITA": CompetitionRules("ITA", "Serie A", 20, 38, tiebreaks=(POINTS, PLAYOFF, HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, GOAL_DIFFERENCE, GOALS_FOR),
                            relegation_direct=3, continental_positions=4,
                            approximations=("match d'appui pour le titre, l'Europe ou la relégation non simulé : confrontation directe puis différence de buts",
                                            "confrontation directe à deux équipes seulement", "5e place par coefficient non modélisée")),
    "ITA2": CompetitionRules("ITA2", "Serie B", 20, 38, tiebreaks=(POINTS, PLAYOFF, HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, GOAL_DIFFERENCE, GOALS_FOR),
                             promotion_positions=2, promotion_playoff=(3, 8), relegation_direct=3, relegation_playoff=(16, 17),
                             continental_positions=0, continental_label="",
                             approximations=("match d'appui non simulé", "barrages de montée (3-8) et de maintien (16-17) non simulés", "confrontation directe à deux équipes seulement")),
    "POR": CompetitionRules("POR", "Liga Portugal", 18, 34, tiebreaks=H2H_FIRST, relegation_direct=2, relegation_playoff=(16, 16), continental_positions=3,
                            continental_label="Ligue des champions",
                            approximations=("confrontation directe à deux équipes seulement", "barrage de relégation (16e) non simulé")),
    "NED": CompetitionRules("NED", "Eredivisie", 18, 34, tiebreaks=GD_FIRST + (HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GD, HEAD_TO_HEAD_AWAY_GOALS, PLAYOFF),
                            relegation_direct=1, relegation_playoff=(16, 17), continental_positions=2,
                            approximations=("buts à l'extérieur et match d'appui non reproduits", "barrages européens et de relégation non simulés")),
}

UNSUPPORTED = {"USA": "conférences et play-offs", "ARG": "zones et deux tournois", "MEX": "Apertura / Clausura, liguilla, relégation au coefficient",
               "SCO": "scission", "AUT": "scission", "SUI": "scission", "DEN": "scission", "KOR": "scission", "CRO": "scission", "SRB": "scission",
               "BEL": "play-offs", "GRE": "play-offs", "TUR": "format non vérifié", "POL": "format non vérifié", "CZE": "scission", "JPN": "format non vérifié",
               "KSA": "format non vérifié", "NOR": "année civile, barrage non vérifié", "SWE": "année civile, barrage non vérifié", "BRA": "format non vérifié",
               "UCL": "coupe", "UEL": "coupe", "UECL": "coupe"}


def supported() -> list[str]:
    return sorted(RULES)


def uses_head_to_head_first(rules: CompetitionRules) -> bool:
    return rules.tiebreaks[1] == HEAD_TO_HEAD_POINTS
