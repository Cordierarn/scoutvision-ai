/**
 * Rendu statique (react-dom/server) de l'onglet Suivi des paris, sur des données fictives : soirées suivies
 * avec le détail des paris, suggestions réglées du profil choisi, états chargement, absent, erreur et vide.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HistoryBet, SuggestionsIndex } from '../../services/replayData';
import { BetHistory } from './BetHistory';

const bet = (label: string, status: HistoryBet['status'], realised: number | null, clv: number | null = null): HistoryBet =>
  ({ label, family: 'résultat', odds: 2, p: 0.55, ev: 0.1, stakeFraction: 0.02, stakeMode: 'shrink_kelly', status, realised, pSharp: 0.52, evRef: 0.04, clv });

const index: SuggestionsIndex = {
  schemaVersion: '1.0.0', generatedAt: '2026-11-08T07:00:00Z', season: '2026-27', bookmaker: 'Winamax FR (OddsPapi)',
  profiles: [{ id: 'sur', label: 'Sûr' }, { id: 'equilibre', label: 'Équilibré' }, { id: 'grosse_cote', label: 'Grosse cote' }], defaultProfile: 'equilibre', defaultBankroll: 300,
  rules: { minOdds: 1.3, bigOdds: 3, maxAgeHours: 2, kellyFraction: 0.25, capPerBet: 0.05, capPerMatch: 0.15, fixedStake: 0.02 },
  matches: [], bilan: null, journal: { published: 0, settled: 0, byProfile: {} },
  evenings: [{ date: '2026-11-07', bets: 2, won: 1, stake: 20, profit: 4, cumulative: 4, settled: false, details: [
    { match: 'Club A – Club B', label: 'Club A gagne', legs: 0, odds: 2.4, stake: 10, status: 'won', profit: 14 },
    { match: 'Combiné', label: 'Club A gagne + Moins de 3,5 buts', legs: 2, odds: 3.1, stake: 10, status: 'pending', profit: null },
  ] }],
  history: [{ date: '2026-11-07', matches: [
    { matchId: 'm1', competition: 'ENG', kickoff: '2026-11-07T15:00:00Z', home: 'Club A', away: 'Club B', score: [2, 1],
      profiles: { equilibre: [bet('Club A gagne', 'won', 1, 0.05), bet('Moins de 1,5 but', 'lost', -1, -0.03)], sur: [bet('Club A ou nul', 'won', 0.3)] } },
    { matchId: 'm2', competition: 'ENG', kickoff: '2026-11-07T20:00:00Z', home: 'Club C', away: 'Club D', score: null,
      profiles: { equilibre: [bet('Club C gagne', 'pending', null)] } },
  ] }],
};
const props = { profile: 'equilibre' as const, onProfile: () => {}, bankrollInput: '300', bankroll: 300, onBankroll: () => {} };

describe('BetHistory (rendu statique)', () => {
  it('détaille chaque soirée suivie : sélection, résultat, net et cumul', () => {
    const html = renderToStaticMarkup(<BetHistory index={index} {...props} />);
    expect(html).toContain('Soirées suivies');
    expect(html).toContain('Club A – Club B');
    expect(html).toContain('Combiné 2 sélections');
    expect(html).toContain('Gagné');
    expect(html).toContain('En attente');
    expect(html).toContain('+14,00');
    expect(html).toContain('cumul +4,00');
    expect(html).toContain('1 gagnés · 1 en attente');   // compté pari par pari, combiné en attente
  });

  it('règle les suggestions du profil choisi sur la bankroll saisie', () => {
    const html = renderToStaticMarkup(<BetHistory index={index} {...props} />);
    expect(html).toContain('Club C – Club D');
    expect(html).toContain('2-1');
    expect(html).toContain('score à venir');
    expect(html).toContain('Perdu');
    expect(html).toContain('+6,00');   // 300 × 2 % × (2 − 1)
    expect(html).toContain('−6,00');
    expect(html).toContain('50 %');    // 1 gagné sur 2 réglés
    expect(html).toContain('CLV moyen +1 %');   // (+5 % − 3 %) / 2, sur les deux paris avec clôture connue
    expect(html).toContain('52 %');    // probabilité sharp affichée à la place de celle du moteur
    expect(html).not.toContain('Club A ou nul');   // profil Sûr non affiché
    const sur = renderToStaticMarkup(<BetHistory index={index} {...props} profile="sur" />);
    expect(sur).toContain('Club A ou nul');
    expect(sur).not.toContain('Club C – Club D');  // aucun pari Sûr sur ce match
  });

  it('ne montre ni les profils retirés ni leurs combinés, même encore présents dans l\'historique publié', () => {
    const day = index.history![0];
    const old = { ...index, history: [{ ...day, matches: day.matches.map(m => ({ ...m, profiles: { ...m.profiles, exploratoire: [bet('Sélection retirée', 'won', 1)], ancien: [bet('Sélection retirée', 'lost', -1)] } })) }],
      comboHistory: [{ date: '2026-11-07', legs: [{ matchId: 'a', match: 'Club A – Club B', label: 'Club A gagne', odds: 1.8 }, { matchId: 'b', match: 'Club C – Club D', label: 'Nul', odds: 3.4 }],
        odds: 6.12, jointP: 0.12, ev: -0.2, stakeFraction: 0.005, status: 'won', realised: 5.12 }] } as unknown as SuggestionsIndex;
    for (const profile of ['sur', 'equilibre', 'grosse_cote'] as const) {
      const html = renderToStaticMarkup(<BetHistory index={old} {...props} profile={profile} />);
      expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
      expect(html).not.toContain('Sélection retirée'); expect(html).not.toContain('Combinés du jour'); expect(html).not.toContain('Exploratoire');
    }
  });

  it('affiche le message de jeu responsable dans tous les états de l\'onglet', () => {
    const states = [
      <BetHistory index={index} {...props} />,
      <BetHistory index={{ ...index, evenings: [], history: [] }} {...props} />,
      <BetHistory index={undefined} {...props} />,
      <BetHistory index={null} {...props} />,
      <BetHistory index={undefined} failed onRetry={() => {}} {...props} />,
    ];
    for (const el of states) {
      const html = renderToStaticMarkup(el);
      expect(html).toContain('Interdit aux moins de 18 ans');
      expect(html).toContain('09 74 75 13 13');
    }
  });

  it('explique un historique vide et gère chargement, absence et erreur', () => {
    expect(renderToStaticMarkup(<BetHistory index={{ ...index, evenings: [], history: [] }} {...props} />)).toContain('Le suivi commence avec les suggestions publiées depuis le coupe-circuit (5 novembre 2026)');
    expect(renderToStaticMarkup(<BetHistory index={undefined} {...props} />)).toContain('Chargement du suivi des paris');
    expect(renderToStaticMarkup(<BetHistory index={null} {...props} />)).toContain('Suivi des paris indisponible.');
    const failed = renderToStaticMarkup(<BetHistory index={null} failed onRetry={() => {}} {...props} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Réessayer');
  });
});
