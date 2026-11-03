/**
 * Rendu statique (react-dom/server) du bloc Suggestions : profils, match sans cotes, bankroll invalide,
 * disposition téléphone (cote et mise dans le bloc empilé), cote ancienne.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SuggestionMatch, SuggestionsIndex } from '../../services/replayData';
import { SuggestionsBlock, SuggestionsControls } from './Suggestions';

const NOW = new Date('2026-11-07T14:00:00Z');
const match: SuggestionMatch = {
  matchId: 'm1', competition: 'ENG', date: '2026-11-07', home: 'Club A', away: 'Club B', status: 'ok', kickoff: '2026-11-07T15:00:00Z', oddsAt: '2026-11-07T13:40:00Z',
  profiles: {
    sur: { suggestions: [{ rank: 1, marketId: 101, outcomeId: 101, family: 'résultat', label: 'Club A gagne', odds: 1.62, oddsAt: '2026-11-07T13:40:00Z', p: 0.58, ev: -0.06, stakeFraction: 0.02, stakeMode: 'fixed', reasons: ['Forme : 4 V 1 N 0 D'] }], combo: null },
    equilibre: { suggestions: [{ rank: 1, marketId: 106, outcomeId: 106, family: 'plus/moins', label: 'Plus de 2,5 buts', odds: 1.95, oddsAt: '2026-11-07T11:30:00Z', p: 0.56, ev: 0.092, stakeFraction: 0.024, stakeMode: 'kelly', reasons: [] }],
      combo: { labels: ['Club A gagne', 'Plus de 2,5 buts'], marketIds: [101, 106], outcomeIds: [101, 106], jointP: 0.35, odds: 3.16, ev: 0.106, stakeFraction: 0.01, stakeMode: 'kelly' } },
    grosse_cote: { suggestions: [], combo: null },
  },
};
const index: SuggestionsIndex = {
  schemaVersion: '1.0.0', generatedAt: '2026-11-07T13:45:00Z', season: '2026-27', bookmaker: 'Winamax FR (OddsPapi)',
  profiles: [{ id: 'sur', label: 'Sûr' }, { id: 'equilibre', label: 'Équilibré' }, { id: 'grosse_cote', label: 'Grosse cote' }], defaultProfile: 'equilibre', defaultBankroll: 300,
  rules: { minOdds: 1.3, bigOdds: 3, maxAgeHours: 2, kellyFraction: 0.25, capPerBet: 0.05, capPerMatch: 0.15, fixedStake: 0.02 },
  matches: [match], bilan: null, journal: { published: 0, settled: 0, byProfile: {} },
};

describe('Suggestions (rendu statique)', () => {
  it('affiche les suggestions du profil choisi avec la mise en euros', () => {
    const html = renderToStaticMarkup(<SuggestionsBlock match={match} profile="equilibre" bankroll={300} open now={NOW} />);
    expect(html).toContain('Plus de 2,5 buts');
    expect(html).toContain('7,20'); // 300 × 0,024
    expect(html).toContain('+9'); // espérance +9 %
    expect(html).toContain('Combiné du match');
    expect(html).not.toContain('Club A gagne</span>'); // profil Sûr non rendu
    const sur = renderToStaticMarkup(<SuggestionsBlock match={match} profile="sur" bankroll={300} open={false} now={NOW} />);
    expect(sur).toContain('Club A gagne');
    expect(sur).toContain('fixe'); // espérance négative : mise fixe signalée
    expect(sur).toContain('6,00');
  });

  it('signale une bankroll invalide par N/D et le champ en erreur', () => {
    const html = renderToStaticMarkup(<SuggestionsBlock match={match} profile="equilibre" bankroll={null} open now={NOW} />);
    expect(html).toContain('N/D');
    const controls = renderToStaticMarkup(<SuggestionsControls index={index} profile="equilibre" onProfile={() => {}} bankrollInput="abc" bankroll={null} onBankroll={() => {}} />);
    expect(controls).toContain('aria-invalid="true"');
    expect(controls).toContain('Montant invalide');
    expect(controls).toContain('role="radiogroup"');
  });

  it('affiche les soirées suivies avec net et cumul', () => {
    const withEvenings = { ...index, evenings: [{ date: '2026-11-02', bets: 7, won: 6, stake: 61.37, profit: 25.25, cumulative: 25.25, settled: false }, { date: '2026-11-03', bets: 3, won: 0, stake: 15.75, profit: null, cumulative: 25.25, settled: false }] };
    const html = renderToStaticMarkup(<SuggestionsControls index={withEvenings} profile="equilibre" onProfile={() => {}} bankrollInput="300" bankroll={300} onBankroll={() => {}} />);
    expect(html).toContain('Soirées suivies');
    expect(html).toContain('+25,25');
    expect(html).toContain('en attente');
    expect(html).toContain('61,37');
  });

  it('indique un match sans cotes et un profil sans sélection admissible', () => {
    expect(renderToStaticMarkup(<SuggestionsBlock match={{ ...match, status: 'no_odds', profiles: undefined }} profile="sur" bankroll={300} open now={NOW} />)).toContain('Cotes Winamax non disponibles pour ce match.');
    expect(renderToStaticMarkup(<SuggestionsBlock match={undefined} profile="sur" bankroll={300} open now={NOW} />)).toContain('Cotes Winamax non disponibles');
    expect(renderToStaticMarkup(<SuggestionsBlock match={match} profile="grosse_cote" bankroll={300} open now={NOW} />)).toContain('Aucune sélection admissible');
  });

  it('garde cote et mise dans la disposition téléphone et marque une cote ancienne', () => {
    const html = renderToStaticMarkup(<SuggestionsBlock match={match} profile="equilibre" bankroll={300} open now={NOW} />);
    const mobile = html.split('class="sm:hidden')[1] ?? '';
    expect(mobile).toContain('cote 1,95');
    expect(mobile).toContain('mise 7,20');
    expect(html).toContain('ancienne'); // relevé 11:30 pour un « maintenant » à 14:00
  });
});
