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
    equilibre: { suggestions: [{ rank: 1, marketId: 106, outcomeId: 106, family: 'plus/moins', label: 'Plus de 2,5 buts', odds: 1.95, oddsAt: '2026-11-07T11:30:00Z', p: 0.56, ev: 0.092, stakeFraction: 0.024, stakeMode: 'shrink_kelly', reasons: [],
      pSharp: 0.54, pRef: 0.54, evRef: 0.053, poolW: 0, sharpBookmaker: 'pinnacle', warnings: ['dependance_joueur_cle'], verdict: 'bet' }],
      combo: { labels: ['Club A gagne', 'Plus de 2,5 buts'], marketIds: [101, 106], outcomeIds: [101, 106], jointP: 0.35, odds: 3.16, ev: 0.106, stakeFraction: 0.01, stakeMode: 'kelly' } },
    grosse_cote: { suggestions: [], combo: null },
  },
  noBet: { label: 'Club B gagne', family: 'résultat', odds: 4.2, p: 0.3, pSharp: 0.22, evRef: -0.076, reasons: ['espérance insuffisante face au marché sharp'], codes: ['ev_insuffisant'] },
  sharpCoverage: 0.8,
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
    expect(html).toContain('+5'); // espérance face au marché sharp : +5 %
    expect(html).toContain('54 %'); // probabilité sharp
    expect(html).toContain('plafond de mise réduit de moitié');
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

  it('résume les soirées suivies et renvoie vers le suivi des paris', () => {
    const withEvenings = { ...index, evenings: [{ date: '2026-11-07', bets: 4, won: 3, stake: 40, profit: 12.5, cumulative: 12.5, settled: true }, { date: '2026-11-08', bets: 2, won: 0, stake: 10, profit: null, cumulative: 12.5, settled: false }] };
    const html = renderToStaticMarkup(<SuggestionsControls index={withEvenings} profile="equilibre" onProfile={() => {}} bankrollInput="300" bankroll={300} onBankroll={() => {}} onShowHistory={() => {}} />);
    expect(html).toContain('Soirées suivies : 2');
    expect(html).toContain('+12,50');
    expect(html).toContain('Voir le suivi des paris');
    expect(renderToStaticMarkup(<SuggestionsControls index={index} profile="equilibre" onProfile={() => {}} bankrollInput="300" bankroll={300} onBankroll={() => {}} />)).not.toContain('Voir le suivi');
  });

  it('indique un match sans cotes et un profil sans sélection admissible', () => {
    expect(renderToStaticMarkup(<SuggestionsBlock match={{ ...match, status: 'no_odds', profiles: undefined }} profile="sur" bankroll={300} open now={NOW} />)).toContain('Cotes Winamax non disponibles pour ce match.');
    expect(renderToStaticMarkup(<SuggestionsBlock match={undefined} profile="sur" bankroll={300} open now={NOW} />)).toContain('Cotes Winamax non disponibles');
    const noBet = renderToStaticMarkup(<SuggestionsBlock match={match} profile="grosse_cote" bankroll={300} open now={NOW} />);
    expect(noBet).toContain('Pas de pari.');
    expect(noBet).toContain('Club B gagne');
    expect(noBet).toContain('espérance insuffisante face au marché sharp');
    expect(noBet).toContain('référence sharp sur 80 % des marchés');
    expect(renderToStaticMarkup(<SuggestionsBlock match={{ ...match, noBet: null }} profile="grosse_cote" bankroll={300} open now={NOW} />)).toContain('Aucune sélection admissible');
  });

  it('garde cote et mise dans la disposition téléphone et marque une cote ancienne', () => {
    const html = renderToStaticMarkup(<SuggestionsBlock match={match} profile="equilibre" bankroll={300} open now={NOW} />);
    const mobile = html.split('class="sm:hidden')[1] ?? '';
    expect(mobile).toContain('cote 1,95');
    expect(mobile).toContain('mise 7,20');
    expect(html).toContain('ancienne'); // relevé 11:30 pour un « maintenant » à 14:00
  });
});
