/**
 * ScoutVision AI - Labo marché : cartes du carnet (une par question, avec verdict et chiffres)
 */

import { MarketLab, SignalGain, Verdict } from '../../services/labData';
import { frNumber } from '../../utils/lab';

export interface MarketCard {
  id: string;
  theme: string;
  question: string;
  verdict: Verdict;
  figure: string;
  caption: string;
  text: string;
  section?: string;
}

const ci = (c: [number, number], digits = 4) => `[${frNumber(c[0], digits, true)} ; ${frNumber(c[1], digits, true)}]`;
const gain = (g: SignalGain) => `${frNumber(g.gain, 4, true)}`;
const pct = (v: number, digits = 0) => `${(100 * v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;

/**
 * Lecture d'un test de signal : gain de log-loss par match sur la saison de test
 */
function readGain(g: SignalGain): string {
  if (Number.isNaN(g.gain)) return 'échantillon insuffisant';
  return `${gain(g)} de log-loss par match, IC 95 % ${ci(g.ci)} sur ${g.test.toLocaleString('fr-FR')} matchs`;
}

/**
 * Cartes dans l'ordre de lecture : d'abord le modèle de base, puis les signaux, puis le marché
 */
export function marketCards(lab: MarketLab): MarketCard[] {
  const e = lab.experiments;
  const s = lab.testSeason;
  const cal = e.calibration[s];
  const abs = e.absences[s];
  const st = e.stakes[s];
  const sp = e.setPieces[s];
  const rc = e.redCards[s];
  const cups = e.cups;
  // Saison de test (close) ; à défaut la dernière saison évaluée
  const lastCup = cups.seasons[s] ? s : Object.keys(cups.seasons).sort().at(-1);
  const cupRow = lastCup ? cups.seasons[lastCup] : undefined;
  const m = e.market;
  const cards: MarketCard[] = [
    {
      id: 'calibration', theme: 'Modèle de base', section: 'calibration', verdict: cal.verdict,
      question: 'Les probabilités du modèle ont-elles besoin d\'être recalibrées ?',
      figure: `T = ${frNumber(cal.temperature, 2)}`, caption: `température ajustée sur les saisons précédentes ; gain sur ${s} ${frNumber(cal.gain, 4, true)}, IC ${ci(cal.ci)}`,
      text: cal.verdict === 'validated'
        ? `Oui : une seule constante de température améliore la log-loss hors échantillon (écart de calibration ${frNumber(cal.ece, 3)}).`
        : `Non : la température optimale vaut ${frNumber(cal.temperature, 2)} et n'apporte rien de mesurable sur ${cal.matches.toLocaleString('fr-FR')} matchs (écart de calibration moyen ${frNumber(cal.ece, 3)}, `
          + `nuls prévus − observés ${frNumber(cal.drawBias, 3, true)}). Les probabilités affichées n'ont pas besoin de correction.`,
    },
    {
      id: 'cups', theme: 'Coupes d\'Europe', section: 'cups', verdict: cups.verdict,
      question: 'En coupe d\'Europe, le modèle conjoint bat-il les fréquences 1-N-2 ?',
      figure: cupRow ? `RPS ${frNumber(cupRow.rpsModel, 3)} contre ${frNumber(cupRow.rpsFrequencies, 3)}` : 'N/D',
      caption: cupRow ? `${lastCup}, ${cupRow.matches} matchs, gain ${frNumber(cupRow.gain, 4, true)}, IC ${ci(cupRow.ci)}` : 'aucune saison évaluée',
      text: `Oui, et chaque saison depuis que la validation est rejouée : relier les niveaux de championnat par les matchs de coupe donne au modèle une information que les fréquences n'ont pas, `
        + `surtout quand un club du premier niveau affronte un club d'une ligue mineure (${cups.tiers['1-2+'] ? `gain ${frNumber(cups.tiers['1-2+'].gain, 4, true)} sur ${cups.tiers['1-2+'].matches} matchs` : 'N/D'}). `
        + 'C\'est l\'avantage informationnel d\'un pipeline qui couvre 32 ligues.',
    },
    {
      id: 'absences', theme: 'Compositions', section: 'absences', verdict: abs.verdict,
      question: 'Les titulaires absents déplacent-ils la probabilité au-delà du modèle ?',
      figure: gain(abs.count), caption: `log-loss par match avec le nombre d'absents, IC ${ci(abs.count.ci)} (${s})`,
      text: `${abs.count.verdict === 'validated' ? 'Oui' : 'Pas nettement'} : le nombre de titulaires habituels absents du onze (connu à l'annonce des compositions) améliore la prévision ; `
        + `la part des passes qu'ils portaient (rupture de réseau) ${abs.share.verdict === 'validated' ? 'aussi' : 'n\'ajoute rien de net'} (${readGain(abs.share)}), `
        + `et les absents déjà absents au match précédent, connus avant l'annonce, ${abs.known.verdict === 'validated' ? 'également' : 'à peine'} (${readGain(abs.known)}).`,
    },
    {
      id: 'xi', theme: 'Compositions', section: 'absences', verdict: 'measured',
      question: 'Peut-on deviner le onze avant son annonce ?',
      figure: abs.xi[s] ? pct(abs.xi[s].lastEleven) : 'N/D',
      caption: abs.xi[s] ? `du onze retrouvé en reprenant le dernier onze (${s}) ; titularisations récentes pondérées : ${pct(abs.xi[s].predicted)}` : '',
      text: `En moyenne ${abs.xi[s] ? frNumber(abs.xi[s].missing, 1) : '–'} titulaires habituels manquent à chaque match. Reprendre le dernier onze fait aussi bien qu'une pondération des titularisations récentes : `
        + 'le onze probable se lit dans la composition précédente, pas dans un modèle.',
    },
    {
      id: 'stakes', theme: 'Enjeu', section: 'stakes', verdict: st.verdict,
      question: 'En fin de saison, l\'équipe qui a quelque chose à jouer fait-elle mieux que prévu ?',
      figure: gain(st.difference), caption: `log-loss par match avec l'enjeu simulé (domicile − extérieur), IC ${ci(st.difference.ci)} (${s})`,
      text: (() => {
        const ho = st.homeResidual.homeOnly, ao = st.homeResidual.awayOnly;
        const r = (x?: { residual: number; ci: [number, number]; matches: number }) => x ? `${frNumber(x.residual, 2, true)} pt (IC ${ci(x.ci, 2)}, ${x.matches} matchs)` : 'N/D';
        return `${st.verdict === 'validated' ? 'Oui' : 'Signal réel mais fragile'} : quand seule l'équipe à domicile a un enjeu (titre, Europe, relégation dans 2 000 saisons simulées), elle marque ${r(ho)} de plus que ne prévoit le modèle ; `
          + `quand seule l'équipe à l'extérieur en a un, l'équipe à domicile marque ${r(ao)}. Le modèle de base ignore la motivation ; le marché, lui, en tient probablement compte (à mesurer avec les cotes).`;
      })(),
    },
    {
      id: 'set-pieces', theme: 'Coups de pied arrêtés', verdict: sp.verdict,
      question: 'Le xG sur coups de pied arrêtés ajoute-t-il au modèle de force globale ?',
      figure: gain(sp), caption: `log-loss par match, IC ${ci(sp.ci)} (${s})`,
      text: `${sp.verdict === 'validated' ? 'Oui.' : 'Non'} : attaque sur phases arrêtées de l'une contre défense de l'autre (${frNumber(sp.meanExpected, 2)} xG attendu par match en moyenne), `
        + 'la prévision ne bouge pas. Le modèle de base absorbe déjà ce que les coups de pied arrêtés apportent.',
    },
    {
      id: 'red-cards', theme: 'Arbitres', verdict: rc.verdict,
      question: 'L\'arbitre et le profil de fautes annoncent-ils un rouge, et le rouge annoncé change-t-il les buts ?',
      figure: `AUC ${frNumber(rc.auc, 2)}`, caption: `prévision du carton rouge par équipe (arbitre seul : ${frNumber(rc.aucRefereeOnly, 2)}), ${rc.teamMatches.toLocaleString('fr-FR')} équipes-matchs (${s})`,
      text: `Un rouge est à peine prévisible (${pct(rc.redRate, 1)} des équipes-matchs), et sa probabilité n'ajoute ${rc.overUnder ? `${frNumber(rc.overUnder.gain, 4, true)} à la prévision du plus de 2,5 buts (IC ${ci(rc.overUnder.ci)})` : 'rien de mesurable'} `
        + `ni au 1-N-2 (${readGain(rc.outcome)}).`,
    },
    {
      id: 'goal-reaction', theme: 'Match', verdict: e.goalReaction.verdict,
      question: '« Réagir au but encaissé » est-il un trait d\'équipe ?',
      figure: `r = ${frNumber(e.goalReaction.r, 2)}`, caption: `fiabilité entre matchs pairs et impairs, IC ${ci(e.goalReaction.ci, 2)} (${e.goalReaction.teamSeasons.toLocaleString('fr-FR')} équipes-saisons)`,
      text: `Dans les dix minutes qui suivent un but encaissé, une équipe produit ${pct(e.goalReaction.meanReaction)} de son xG habituel ; mais cette réaction ne se retrouve pas d'une moitié de saison à l'autre. `
        + 'Ce n\'est pas un trait, c\'est du bruit.',
    },
  ];
  if (m.available && m.closingTarget && m.efficiency && m.dispersion && m.coherence && m.luck && m.coach && m.stack) {
    const ct = m.closingTarget;
    const bets = (b?: { bets: number; clv?: number; clvSe?: number }) => b && b.bets && b.clv !== undefined
      ? `${b.bets.toLocaleString('fr-FR')} paris, CLV ${pct(b.clv, 1)} ± ${pct(2 * (b.clvSe ?? 0), 1)}` : 'aucun pari';
    const hi = m.dispersion.groups?.high;
    const lo = m.dispersion.groups?.low;
    cards.push(
      {
        id: 'closing-target', theme: 'Marché', section: 'market', verdict: ct.verdict,
        question: 'Prédire la clôture plutôt que le résultat : le modèle explique-t-il le mouvement des cotes ?',
        figure: ct.movementExplained !== undefined ? pct(ct.movementExplained, 1) : 'N/D',
        caption: `du mouvement ouverture → clôture expliqué (${s}) ; modèle seul contre l'ouverture : ${bets(ct.betsBase)}`,
        text: `Le prédicteur de clôture (modèle + ouverture) donne ${bets(ct.betsPredicted)}. `
          + `Log-loss sur les résultats : ouverture ${frNumber(ct.llOpening ?? 0, 4)}, prédicteur ${frNumber(ct.llPredicted ?? 0, 4)}, clôture ${frNumber(ct.llClosing ?? 0, 4)}.`,
      },
      {
        id: 'efficiency', theme: 'Marché', section: 'market', verdict: m.efficiency.verdict,
        question: 'Où le modèle apporte-t-il quelque chose au marché d\'ouverture ?',
        figure: `${m.efficiency.validated} compétition${m.efficiency.validated > 1 ? 's' : ''}`,
        caption: `où le mélange modèle + ouverture bat l'ouverture seule hors échantillon (poids ajusté sur les saisons précédentes), sur ${Object.keys(m.efficiency.competitions).length} évaluées`,
        text: 'La carte d\'efficience : par compétition, poids du modèle, log-loss de l\'ouverture, de la clôture et du mélange, dispersion entre bookmakers et ampleur du mouvement des cotes. '
          + 'Là où le poids vaut zéro, le marché contient déjà toute l\'information du modèle.',
      },
      {
        id: 'dispersion', theme: 'Marché', section: 'market', verdict: m.dispersion.verdict,
        question: 'Quand les bookmakers sont en désaccord, le modèle vaut-il davantage ?',
        figure: hi && lo ? `${frNumber(hi.weight, 2)} contre ${frNumber(lo.weight, 2)}` : 'N/D',
        caption: 'poids du modèle dans le mélange avec l\'ouverture : tercile de forte dispersion contre tercile de faible dispersion',
        text: hi ? `Forte dispersion : ${bets(hi.bets)} ; log-loss ouverture ${frNumber(hi.llOpening, 4)}, mélange ${frNumber(hi.llPool, 4)}, clôture ${frNumber(hi.llClosing, 4)}.` : 'Échantillon insuffisant.',
      },
      {
        id: 'coherence', theme: 'Marché', section: 'market', verdict: m.coherence.verdict,
        question: 'Le 1-N-2 est-il cohérent avec le plus / moins 2,5 et le handicap asiatique du même moment ?',
        figure: m.coherence.movementR !== undefined ? `r = ${frNumber(m.coherence.movementR, 2)}` : 'N/D',
        caption: `écart implicite → mouvement vers la clôture, ${m.coherence.matches.toLocaleString('fr-FR')} matchs à ligne entière`,
        text: `1-N-2 implicite des deux autres marchés (buts attendus retrouvés par bissection) : poids ${m.coherence.weightImplied ?? 'N/D'} face au 1-N-2 coté, ${bets(m.coherence.bets)}. `
          + 'Sans aucun modèle de football.',
      },
      {
        id: 'luck-market', theme: 'Marché', section: 'market', verdict: m.luck.verdict,
        question: 'Le marché d\'ouverture regarde-t-il encore le classement plutôt que les xG ?',
        figure: gain(m.luck), caption: `log-loss par match contre l'ouverture avec la chance accumulée (points − points attendus), IC ${ci(m.luck.ci)}`,
        text: `${m.luck.verdict === 'validated' ? 'Oui' : 'Non'} : ${readGain(m.luck)} ; coefficient ${m.luck.coef ? frNumber(m.luck.coef[0], 3, true) : 'N/D'} sur la victoire à domicile ; ${bets(m.luck.bets)}.`,
      },
      {
        id: 'coach-market', theme: 'Marché', section: 'market', verdict: m.coach.verdict,
        question: 'Le marché croit-il encore au rebond du nouvel entraîneur ?',
        figure: m.coach.marketResidual ? frNumber(m.coach.marketResidual.mean, 3, true) : 'N/D',
        caption: m.coach.marketResidual ? `résultat − probabilité d'ouverture de l'équipe au nouvel entraîneur (5 premiers matchs), IC ${ci(m.coach.marketResidual.ci, 3)}, ${m.coach.marketResidual.matches} matchs` : '',
        text: `${m.coach.changes} changements. Parier contre l'équipe au nouvel entraîneur à l'ouverture : ${m.coach.fadeBets ? `CLV ${pct(m.coach.fadeBets.clv, 1)} ± ${pct(2 * m.coach.fadeBets.clvSe, 1)}` : 'N/D'} ; `
          + `contre le modèle de base, le signal vaut ${readGain(m.coach.vsBase)}.`,
      },
      {
        id: 'stack', theme: 'Marché', section: 'market', verdict: m.stack.verdict,
        question: 'Empiler tout ce qui a passé son test : bat-on l\'ouverture ?',
        figure: m.stack.gain !== undefined ? frNumber(m.stack.gain, 4, true) : 'N/D',
        caption: `log-loss par match contre l'ouverture recalibrée, IC ${m.stack.ci ? ci(m.stack.ci) : 'N/D'} ; signaux : ${(m.stack.signals ?? []).join(', ') || 'aucun'}`,
        text: `Ouverture ${frNumber(m.stack.llOpening ?? 0, 4)}, avec le modèle ${frNumber(m.stack.llWithBase ?? 0, 4)}, empilement ${frNumber(m.stack.llStack ?? 0, 4)}, clôture ${frNumber(m.stack.llClosing ?? 0, 4)} ; ${bets(m.stack.bets)}.`,
      },
    );
  }
  return cards;
}
