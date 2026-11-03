/**
 * Rendu statique de l'assistant IA du jour, sur des données fictives : sélection par défaut, plan
 * (mises du moteur sur la bankroll, avis, combiné, matchs à éviter), actualité sourcée, jeu responsable.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SuggestionsIndex } from '../../services/replayData';
import type { BettingPlan } from '../../services/bettingAiService';
import { BettingAssistant, PlanView } from './BettingAssistant';

const NOW = new Date('2026-11-07T12:00:00Z');
const index = {
  schemaVersion: '1.0.0', generatedAt: '2026-11-07T11:45:00Z', season: '2026-27', bookmaker: 'Bookmaker test',
  profiles: [], defaultProfile: 'equilibre', defaultBankroll: 300, rules: {} as SuggestionsIndex['rules'], bilan: null, journal: { published: 0, settled: 0, byProfile: {} },
  matches: [
    { matchId: 'm1', competition: 'AAA', date: '2026-11-07', home: 'Club A', away: 'Club B', status: 'ok', kickoff: '2026-11-07T19:00:00Z' },
    { matchId: 'm2', competition: 'AAA', date: '2026-11-07', home: 'Club C', away: 'Club D', status: 'no_odds' },
  ],
} as SuggestionsIndex;

const plan: BettingPlan = {
  profile: 'equilibre', promptVersion: 'ai-betting-plan-v1', summary: 'Une absence importante côté Club B.',
  meta: { model: 'modele-test', requestedModel: 'modele-test', generatedAt: '2026-11-07T12:05:00Z', suggestionsAt: '2026-11-07T11:45:00Z' },
  matches: [{ matchId: 'm1', match: 'Club A – Club B', kickoff: '2026-11-07T19:00:00Z',
    news: { matchId: 'm1', text: '- Club B : attaquant suspendu.', sources: [{ title: 'source.test', uri: 'https://example.test/a' }], queries: ['Club A Club B absents'], fetchedAt: '2026-11-07T12:01:00Z', model: 'modele-test' },
    verdicts: [{ ref: 'm1#1', label: 'Club A gagne', verdict: 'garder', reason: 'Attaquant adverse suspendu.' }, { ref: 'm1#2', label: 'Plus de 2,5 buts', verdict: 'eviter', reason: 'Moins de puissance offensive.' }] }],
  picks: [{ ref: 'm1#1', matchId: 'm1', match: 'Club A – Club B', label: 'Club A gagne', family: 'résultat', odds: 1.85, probability: 0.6, expectedValue: 0.11, stakeFraction: 0.03, stakeMode: 'kelly', verdict: 'garder', why: 'Absence adverse.' }],
  combo: null, avoid: [{ matchId: 'm9', match: 'Club E – Club F', why: 'Compositions inconnues.' }], discipline: 'Mises du moteur, sans rattrapage.', warnings: ['1 match(s) sans actualité recherchée.'],
};

describe('BettingAssistant (rendu statique)', () => {
  it('propose les matchs avec cotes à venir, cochés par défaut, et le message de jeu responsable', () => {
    const html = renderToStaticMarkup(<BettingAssistant index={index} profile="equilibre" bankroll={300} now={NOW} />);
    expect(html).toContain('Assistant IA du jour');
    expect(html).toContain('Club A – Club B');
    expect(html).not.toContain('Club C – Club D');      // sans cotes
    expect(html).toContain('checked=""');
    expect(html).toContain('Analyser 1 match');
    expect(html).toContain('09 74 75 13 13');
  });

  it('affiche le plan : mise du moteur sur la bankroll, avis, actualité sourcée, avertissements', () => {
    const html = renderToStaticMarkup(<PlanView plan={plan} bankroll={300} failedNews={1} />);
    expect(html).toContain('9,00');                     // 300 × 3 %
    expect(html).toContain('À garder');
    expect(html).toContain('À éviter');
    expect(html).toContain('Club E – Club F');
    expect(html).toContain('href="https://example.test/a"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('https://www.google.com/search?q=Club%20A%20Club%20B%20absents');
    expect(html).toContain('Actualité indisponible pour 1 match.');
    expect(html).toContain('modele-test');
    expect(renderToStaticMarkup(<PlanView plan={{ ...plan, picks: [] }} bankroll={null} />)).toContain('passer son tour');
  });
});
