/**
 * ScoutVision AI - Carnet d'expériences : chaque idée testée, son verdict et ses chiffres
 */

import React, { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { LabExperiments, Verdict } from '../../services/labData';
import { frNumber, frPercent } from '../../utils/lab';
import { VERDICT_ORDER, VerdictBadge, verdictInfo } from './common';

export type LabTab = 'notebook' | 'coaches' | 'elevator' | 'goals' | 'duos' | 'referees' | 'squads';

interface Card {
  id: string;
  theme: string;
  question: string;
  verdict: Verdict;
  figure: string;
  caption: string;
  text: string;
  tab?: LabTab;
}

const ci = (c: [number, number], digits = 2) => `[${frNumber(c[0], digits, true)} ; ${frNumber(c[1], digits, true)}]`;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

/**
 * Cartes du carnet, dans l'ordre de lecture : d'abord les idées reçues sur les entraîneurs
 */
export function cards(lab: LabExperiments): Card[] {
  const e = lab.experiments;
  const cc = e.coachChange;
  const dna = e.coachDna;
  const dnaMean = mean(Object.values(dna.imprint).map(v => v.coach));
  const ev = e.elevator.validation;
  const gs = e.gameState;
  const sm = e.styleMatchups;
  const mo = e.momentum;
  const tw = e.twins;
  return [
    {
      id: 'coach-change', theme: 'Entraîneurs', tab: 'coaches', verdict: cc.verdict,
      question: 'Changer d\'entraîneur en cours de saison provoque-t-il un électrochoc ?',
      figure: `${frNumber(cc.effect, 2, true)} xG/match`, caption: `effet propre du changement, IC 95 % ${ci(cc.effectCi)}`,
      text: `Les clubs qui changent d'entraîneur remontent bien (${frNumber(cc.naivePoints, 2, true)} point par match sur les 10 matchs suivants), `
        + `mais des clubs comparables qui gardent le leur remontent autant : c'est le retour à la moyenne après une mauvaise passe. `
        + `Sur ${cc.changes} changements, le changement lui-même n'apporte rien de mesurable.`,
    },
    {
      id: 'coach-dna', theme: 'Entraîneurs', tab: 'coaches', verdict: dna.verdict,
      question: 'Un entraîneur emporte-t-il son style dans son nouveau club ?',
      figure: frNumber(dnaMean, 2), caption: 'poids du style de son ancien club dans celui du nouveau (moyenne des 6 dimensions)',
      text: `Sur ${dna.arrivals} arrivées de ${dna.coaches} entraîneurs dans un nouveau club, le style du club se rapproche de celui que l'entraîneur avait dans son club précédent, `
        + 'sur les six dimensions (possession, domination, pressing, construction, verticalité, hauteur du bloc), intervalles de confiance tous au-dessus de zéro.',
    },
    {
      id: 'coach-results', theme: 'Entraîneurs', tab: 'coaches', verdict: e.coachResults.verdict,
      question: 'Un entraîneur qui a réussi ailleurs réussira-t-il chez nous ?',
      figure: `r = ${frNumber(e.coachResults.r, 2)}`, caption: `résultats d'un même entraîneur dans deux clubs successifs, IC 95 % ${ci(e.coachResults.ci)}`,
      text: `Mesurés au-delà du niveau qu'avait l'équipe avant son arrivée, ses résultats ne se transportent pas de façon mesurable (${e.coachResults.pairs} passages d'un club à l'autre) : `
        + 'on recrute un style de jeu, pas des résultats.',
    },
    {
      id: 'style-matchups', theme: 'Tactique', verdict: sm.verdict,
      question: 'Certains styles de jeu en battent-ils d\'autres (la « bête noire » tactique) ?',
      figure: `${frNumber(-100 * sm.gain / sm.baseMse, 2, true)} %`, caption: 'erreur de prévision des xG sur des matchs non vus, en ajoutant 36 interactions style contre style',
      text: `Une fois connues les forces des deux équipes, le style de l'adversaire n'explique rien de plus : la prévision se dégrade légèrement (${sm.rows.toLocaleString('fr-FR')} lignes équipe-match, validation croisée). `
        + 'Les « confrontations de styles » relèvent du récit, pas des données.',
    },
    {
      id: 'fatigue', theme: 'Calendrier', verdict: e.fatigue.verdict,
      question: 'Jouer trois jours après son dernier match pénalise-t-il ?',
      figure: `${frNumber(e.fatigue.effect, 3, true)} xG/match`, caption: `contre un adversaire reposé (6 jours ou plus), IC 95 % ${ci(e.fatigue.ci, 3)}`,
      text: `Sur ${e.fatigue.matches.toLocaleString('fr-FR')} matchs, l'effet est minuscule et non significatif. Réserve : les coupes nationales manquent dans les données, `
        + 'certains repos sont donc surestimés.',
    },
    {
      id: 'momentum', theme: 'Match', verdict: mo.verdict,
      question: 'Le momentum (la domination minute par minute) annonce-t-il le prochain but ?',
      figure: `${frPercent(mo.quiet.home[0])} → ${frPercent(mo.quiet.home[mo.quiet.home.length - 1])}`,
      caption: 'chance que l\'équipe à domicile marque dans les 10 min, du momentum le plus faible au plus fort (score nul, aucun tir dans les 5 dernières min)',
      text: `Oui, modestement : il prévoit mieux le prochain but que les xG des cinq dernières minutes (validation sur la saison ${mo.season}). `
        + 'La pression sans tir annonce donc quelque chose.',
    },
    {
      id: 'referees', theme: 'Arbitres', tab: 'referees', verdict: e.referees.verdicts.cards,
      question: 'Certains arbitres sortent-ils plus de cartons ?',
      figure: `r = ${frNumber(e.referees.reliability.cards.r, 2)}`, caption: `fiabilité de la sévérité (matchs pairs contre impairs, ${e.referees.reliability.cards.referees} arbitres)`,
      text: `Oui, la sévérité est un trait stable. En revanche ni le nombre de penalties (r = ${frNumber(e.referees.reliability.pens.r, 2)}) `
        + `ni un favoritisme pour l'équipe à domicile (r = ${frNumber(e.referees.reliability.bias.r, 2)}) ne se retrouvent d'un match à l'autre.`,
    },
    {
      id: 'elevator', theme: 'Recrutement', tab: 'elevator', verdict: e.elevator.verdict,
      question: 'Peut-on repérer les joueurs qu\'un championnat plus fort va recruter ?',
      figure: `AUC ${frNumber(ev.auc, 2)}`,
      caption: `hors échantillon (saison ${ev.base} → suivante) : ${ev.top.hits} transferts vers le haut parmi les ${ev.top.n} premiers, contre ${frPercent(ev.rate, 1)} en moyenne`,
      text: 'Pour les joueurs hors Big 5, l\'indice de rôle, l\'âge, le temps de jeu, le championnat d\'origine et la force du club annoncent un transfert vers un championnat nettement plus fort la saison suivante.',
    },
    {
      id: 'twins', theme: 'Joueurs', verdict: tw.verdict,
      question: 'Les « jumeaux statistiques » d\'un jeune prédisent-ils sa progression ?',
      figure: `${frNumber(tw.young.twins, 1)} contre ${frNumber(tw.young.development, 1)}`,
      caption: `erreur sur l'indice de la saison suivante des moins de 23 ans : jumeaux contre courbes d'âge (${tw.youngPlayers} joueurs)`,
      text: `Ce que sont devenus les joueurs au profil le plus proche au même âge (méthode PECOTA du baseball) fait jeu égal avec les courbes d'âge chez les jeunes, `
        + `mais pas mieux sur l'ensemble (${frNumber(tw.all.twins, 1)} contre ${frNumber(tw.all.development, 1)}).`,
    },
    {
      id: 'goal-value', theme: 'Match', tab: 'goals', verdict: e.goalValue.verdict,
      question: 'Que vaut vraiment un but ?',
      figure: `${frNumber(e.goalValue.byState['0'], 2)} pt contre ${frNumber(e.goalValue.byState['2'], 2)}`,
      caption: 'points attendus gagnés par un but qui fait passer de l\'égalité à l\'avance, contre un but quand on mène déjà de deux',
      text: `Probabilité de victoire minute par minute sur ${e.goalValue.matches.toLocaleString('fr-FR')} matchs : chaque but vaut les points qu'il rapporte. `
        + `Être « décisif » est en partie un trait du joueur (r = ${frNumber(e.goalValue.perGoalReliability.r, 2)} d'une saison à l'autre).`,
    },
    {
      id: 'duos', theme: 'Jeu de passes', tab: 'duos', verdict: e.duos.verdict,
      question: 'Certains joueurs se cherchent-ils plus que leur placement ne l\'explique ?',
      figure: `r = ${frNumber(e.duos.reliability, 2)}`, caption: `fiabilité des affinités de passe (${e.duos.pairs.toLocaleString('fr-FR')} duos, matchs pairs contre impairs)`,
      text: `Oui : au-delà du volume de passes et du placement, ${frPercent(e.duos.strong, 1)} des duos se font au moins 30 % de passes de plus qu'attendu, et ces affinités sont stables.`,
    },
    {
      id: 'clock', theme: 'Équipes', tab: 'squads', verdict: e.clock.verdict,
      question: 'Un effectif vieillissant annonce-t-il un déclin ?',
      figure: `${frNumber(e.clock.coef, 3, true)} xGD`, caption: `par match la saison suivante, par point d'effet d'âge moyen de l'effectif, IC 95 % ${ci(e.clock.ci, 3)}`,
      text: `À niveau égal, une équipe dont les joueurs sont à l'âge où l'on progresse s'améliore, une équipe vieillissante décline (${e.clock.pairs} équipes-saisons).`,
    },
    {
      id: 'set-pieces', theme: 'Équipes', tab: 'squads', verdict: e.setPieces.verdict,
      question: 'La dépendance aux coups de pied arrêtés est-elle un trait d\'équipe ?',
      figure: `r = ${frNumber(e.setPieces.r, 2)}`, caption: `persistance d'une saison à l'autre ; ${frPercent(e.setPieces.mean)} de l'xG en moyenne vient des phases arrêtées`,
      text: 'Oui : la part de l\'xG obtenue sur corners, coups francs et touches longues se retrouve d\'une saison à l\'autre.',
    },
    {
      id: 'game-state', theme: 'Match', verdict: gs.verdict,
      question: '« Savoir gérer un score » ou « finir fort » : des traits d\'équipe ?',
      figure: `r = ${frNumber(Math.max(gs.protect.r, gs.chase.r, gs.late.r), 2)} au mieux`,
      caption: 'persistance d\'une saison à l\'autre : quand on mène, quand on est mené, après la 75e',
      text: 'Non : la façon dont une équipe change de visage selon le score, ou sa domination en fin de match, ne se retrouve pas d\'une saison à l\'autre.',
    },
    {
      id: 'luck', theme: 'Équipes', verdict: e.luck.verdict,
      question: 'Pour prévoir la fin de saison, faut-il regarder les points ou les xG ?',
      figure: `${frNumber(e.luck.xgdR, 2)} contre ${frNumber(e.luck.pointsR, 2)}`,
      caption: 'corrélation avec les points de la seconde moitié de saison : xGD contre points de la première',
      text: `L'écart entre points et points attendus ne persiste presque pas (r = ${frNumber(e.luck.luckR, 2)}) : une équipe chanceuse ou malchanceuse revient vers ses xG.`,
    },
    {
      id: 'red-cards', theme: 'Match', verdict: e.redCards.verdict,
      question: 'Que coûte un carton rouge ?',
      figure: `×${frNumber(e.redCards.opponent[1] / e.redCards.opponent[0], 1)}`,
      caption: `xG de l'adversaire par 90 min (${frNumber(e.redCards.opponent[0], 2)} → ${frNumber(e.redCards.opponent[1], 2)})`,
      text: `Sur ${e.redCards.matches.toLocaleString('fr-FR')} matchs, l'équipe réduite à dix perd ${frPercent(1 - e.redCards.reduced[1] / e.redCards.reduced[0])} de son xG et son adversaire double le sien.`,
    },
    {
      id: 'availability', theme: 'Joueurs', verdict: e.availability.verdict,
      question: 'Un joueur souvent absent des feuilles de match le restera-t-il ?',
      figure: `r = ${frNumber(e.availability.r, 2)}`, caption: `persistance d'une saison à l'autre (${e.availability.pairs.toLocaleString('fr-FR')} joueurs réguliers)`,
      text: 'Un peu : la présence sur les feuilles de match (blessures, suspensions, choix) se retrouve faiblement d\'une saison à l\'autre ; sur plusieurs saisons, le signal devient utile.',
    },
  ];
}

const Notebook: React.FC<{ lab: LabExperiments; onOpen: (tab: LabTab) => void }> = ({ lab, onOpen }) => {
  const list = cards(lab);
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const count = (v: Verdict) => list.filter(c => c.verdict === v).length;
  const shown = filter === 'all' ? list : list.filter(c => c.verdict === filter);
  return (
    <div className="space-y-4">
      {/* Bilan des verdicts : chaque catégorie a le même poids visuel */}
      <div className="sv-panel grid grid-cols-2 md:grid-cols-5 divide-x divide-line">
        <button onClick={() => setFilter('all')} aria-pressed={filter === 'all'}
          className={`text-left px-4 py-3 transition-colors ${filter === 'all' ? 'bg-raised' : 'hover:bg-raised/50'}`}>
          <div className="sv-label">Idées testées</div>
          <div className="text-xl font-semibold text-ink num mt-0.5">{list.length}</div>
          <div className="text-2xs text-ink-3">{lab.matches.toLocaleString('fr-FR')} matchs, 35 compétitions</div>
        </button>
        {VERDICT_ORDER.map(v => {
          const info = verdictInfo(v);
          return (
            <button key={v} onClick={() => setFilter(filter === v ? 'all' : v)} aria-pressed={filter === v} title={info.help}
              className={`relative text-left px-4 py-3 transition-colors ${filter === v ? 'bg-raised' : 'hover:bg-raised/50'}`}>
              <span className="absolute left-0 right-0 top-0 h-0.5" style={{ backgroundColor: info.color }} aria-hidden />
              <VerdictBadge verdict={v} />
              <div className="text-xl font-semibold text-ink num mt-1">{count(v)}</div>
              <div className="text-2xs text-ink-3 truncate">{info.help}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-3 leading-relaxed max-w-5xl">
        Chaque test est refait à chaque mise à jour des données ; quand il s'agit de prévoir, la validation se fait sur des matchs ou des saisons
        que le modèle n'a pas vus. Un verdict résume l'état de la preuve sur ces données, pas une loi : intervalles et tailles d'échantillon sont donnés pour juger.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {shown.map(c => {
          const info = verdictInfo(c.verdict);
          return (
            <article key={c.id} className="sv-panel relative overflow-hidden p-4 flex flex-col">
              <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: info.color }} aria-hidden />
              <div className="flex items-center justify-between gap-3">
                <span className="sv-label">{c.theme}</span>
                <VerdictBadge verdict={c.verdict} size="md" />
              </div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink leading-snug">{c.question}</h3>
              <div className="mt-3 flex items-baseline gap-3">
                <div className="text-xl font-semibold text-ink num whitespace-nowrap">{c.figure}</div>
              </div>
              <div className="text-2xs text-ink-3 mt-0.5 leading-snug">{c.caption}</div>
              <p className="mt-2.5 text-[13px] text-ink-2 leading-relaxed flex-1">{c.text}</p>
              {c.tab && (
                <button onClick={() => onOpen(c.tab!)} className="mt-3 self-start sv-btn sv-btn-ghost sv-btn-sm -ml-2 !text-accent">
                  Explorer <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default Notebook;
