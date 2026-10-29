import { describe, expect, it } from 'vitest';
import { buildReportPdf, pdfFileName, pdfPageTexts, pdfText } from './scoutReportPdf';
import { MIN_FONT } from './scoutReportPdfKit';
import { buildSnapshot, playerRef } from './scoutReportSnapshot';
import { ScoutReportRecord } from '../types/scoutReport';
import { GOALKEEPER, STRIKER } from './scoutReportFixtures';

const NOW = new Date('2026-10-29T12:00:00.000Z');

// Synthèse longue (fixture) : 5 sections, ~600 mots, pour vérifier que rien n'est tronqué
const LONG_SUMMARY = (() => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `- Point ${i + 1} : phrase de test suffisamment longue pour occuper une ligne entière du PDF et forcer la pagination du rapport.`).join('\n');
  return ['### 1. Contexte et profil', para(8), '### 2. Analyse de la performance', para(14), '### 3. Forces et limites statistiques', para(12),
    '### 4. Projection et contexte', para(10), '### 5. Priorités d\'observation', '- Vérifier en vidéo la qualité des occasions.', '- DERNIÈRE PRIORITÉ : observer en live les duels aériens.'].join('\n');
})();
const OLD_SUMMARY = '### 1. Contexte\n- ANCIENNE VERSION UNIQUEMENT EN ANNEXE';

function record(over: Partial<ScoutReportRecord> = {}): ScoutReportRecord {
  return {
    id: 'r1', schemaVersion: 2, player: playerRef(STRIKER), createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z', status: 'to_observe',
    role: 'Renard des surfaces', tags: ['prêt'], dataSnapshot: buildSnapshot(STRIKER, { dataIndex: { generatedAt: '2026-10-20T00:00:00.000Z' } as never, shotStats: { total: 20, goals: 6, xG: 5.1, xGDiff: 0.9, onTarget: 9, blocked: 2, conversion: 30, avgXG: 0.26 } }),
    generatedSummaries: [], observations: [], ...over,
  };
}
const full = () => record({
  generatedSummaries: [
    { id: 's1', model: 'gemini-fixture-1', promptVersion: 'scout-report-v2', generatedAt: '2026-10-28T10:00:00.000Z', content: OLD_SUMMARY },
    { id: 's2', model: 'gemini-fixture-2', promptVersion: 'scout-report-v2', generatedAt: '2026-10-29T10:00:00.000Z', content: LONG_SUMMARY },
  ],
  observations: [
    { id: 'o1', date: '2026-10-27', type: 'live', text: 'Observation humaine au stade.', strengths: 'Appels', toReview: 'Replacement', conclusion: 'À suivre', createdAt: '2026-10-27T22:00:00.000Z' },
    { id: 'o2', date: '2026-10-29', type: 'video', text: 'Deuxième observation (vidéo).', createdAt: '2026-10-29T10:00:00.000Z' },
  ],
});

describe('pdfText / pdfFileName', () => {
  it('garde Latin-1 et la ponctuation WinAnsi, translittère le reste, ne produit jamais un nom vide', () => {
    expect(pdfText('Mbappé — « élite » → 2 ≥ 1 Łukasz Đorđe • …')).toBe('Mbappé — « élite » -> 2 >= 1 Lukasz Dorde • …');
    expect(pdfText((1692).toLocaleString('fr-FR') + ' min')).toBe('1 692 min');   // espace fine insécable → espace
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: 'Kylian Mbappé' } }), NOW)).toBe('ScoutVision_Kylian-Mbappe_2026-27_2026-10-29.pdf');
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: 'Đorđe Đurić-Ñ' } }), NOW)).toBe('ScoutVision_Dorde-Duric-N_2026-27_2026-10-29.pdf');
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: '!!!', season: '' } }), NOW)).toBe('ScoutVision_joueur_saison_2026-10-29.pdf');
  });
});

describe('buildReportPdf : structure en quatre pages', () => {
  it('page 1 = identité, rôles, synthèse du profil ; pages 2 à 4 = impact, métriques, scouting ; pied de page partout', () => {
    const { doc, pages, audit } = buildReportPdf(full(), { now: NOW });
    const texts = pdfPageTexts(doc);
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(texts[0]).toContain('Attaquant Fixture');
    expect(texts[0]).toContain('RÔLES SCOUTVISION');
    expect(texts[0]).toContain('Renard des surfaces');
    expect(texts[0]).toContain('et non percentile.');   // le tiret demi-cadratin est encodé en WinAnsi dans le flux
    expect(texts[0]).toContain('Synthèse du profil statistique');
    expect(texts[0]).toContain('Valeur de marché Transfermarkt');
    expect(texts[0]).toContain('Estimation statistique ScoutVision');
    expect(texts[0]).not.toMatch(/prix estimé/i);
    expect(texts[1]).toContain('IMPACT ET DÉVELOPPEMENT');
    expect(texts[1]).toContain('Projection statistique ScoutVision');
    expect(texts[1]).toContain('Contexte d\'équipe');
    expect(texts[2]).toContain('TIRS ET MÉTRIQUES');
    expect(texts[2]).toContain('Tirs de la saison');
    expect(texts[3]).toContain('SCOUTING');
    expect(texts[3]).toContain('A · Synthèse ScoutVision');
    expect(texts[3]).toContain('gemini-fixture-2');
    texts.forEach((t, i) => { expect(t).toContain(`Page ${i + 1} / ${pages}`); expect(t).toContain('ScoutVision · Rapport de scouting'); expect(t).toContain('Attaquant Fixture'); });
    expect(audit.minFont).toBeGreaterThanOrEqual(MIN_FONT);
    expect(audit.outOfBounds).toEqual([]);
    expect(audit.emptySections).toEqual([]);
    expect(doc.output('arraybuffer').byteLength).toBeLessThan(500_000);
  });

  it('rapport long : complet jusqu\'aux priorités, observations labellisées, dernière synthèse seulement en mode synthèse', () => {
    const t0 = performance.now();
    const { doc, summary } = buildReportPdf(full(), { now: NOW });
    expect(performance.now() - t0).toBeLessThan(1000);
    const all = pdfPageTexts(doc).join('\n');
    expect(summary?.id).toBe('s2');
    expect(all).toContain('Point 14 : phrase de test');
    expect(all).toContain('DERNIÈRE PRIORITÉ');
    expect(all).toContain('B · Priorités d\'observation');
    expect(all).toContain('OBSERVATION DU SCOUT');
    expect(all).toContain('C · Observations du scout');
    expect(all).toContain('Observation humaine au stade.');
    expect(all).toContain('D · Conclusion du scout');
    expect(all).not.toContain('ANCIENNE VERSION UNIQUEMENT EN ANNEXE');
    expect(all).toContain('MÉTHODOLOGIE ET SOURCES');
  });

  it('mode complet : annexe avec l\'historique des synthèses et toutes les métriques', () => {
    const synth = buildReportPdf(full(), { now: NOW });
    const complet = buildReportPdf(full(), { now: NOW, mode: 'complet' });
    const all = pdfPageTexts(complet.doc).join('\n');
    expect(all).toContain('ANCIENNE VERSION UNIQUEMENT EN ANNEXE');
    expect(all).toContain('HISTORIQUE DES SYNTHÈSES');
    expect(all).toContain('Toutes les métriques, par famille');
    expect(complet.pages).toBeGreaterThanOrEqual(synth.pages);
    expect(complet.audit.outOfBounds).toEqual([]);
    expect(buildReportPdf(full(), { now: NOW, summaryId: 's1' }).summary?.id).toBe('s1');
  });
});

describe('buildReportPdf : cas limites', () => {
  it('sans synthèse, sans observation, sans tirs, sans valeur ni contrat : exportable, aucune section vide', () => {
    const r = record({ status: 'draft', tags: [] });
    r.dataSnapshot = { ...r.dataSnapshot, facts: { ...r.dataSnapshot.facts, shots: null, contractUntil: null, values: { marketValueTransfermarkt: null, estimatedValueScoutVision: null, estimatedValueTypicalError: null } } };
    const { doc, pages, audit } = buildReportPdf(r, { now: NOW });
    const all = pdfPageTexts(doc).join('\n');
    expect(pages).toBe(4);
    expect(all).toContain('Aucune synthèse ScoutVision dans ce dossier');
    expect(all).toContain('Aucune observation saisie');
    expect(all).not.toContain('Tirs de la saison');
    expect(all).not.toContain('B · Priorités');
    expect(all).not.toContain('D · Conclusion');
    expect(all).toContain('Non disponible');
    expect(all).toContain('Non renseigné');
    expect(audit.emptySections).toEqual([]);
    expect(audit.outOfBounds).toEqual([]);
  });

  it('gardien : KPI gardien, famille « Gardien », pas de bloc de tirs', () => {
    const snap = buildSnapshot(GOALKEEPER, { dataIndex: { generatedAt: '2026-10-20T00:00:00.000Z' } as never });
    const r = record({ player: playerRef(GOALKEEPER), role: snap.bestRoles[0]?.role, dataSnapshot: snap });
    const { doc, audit } = buildReportPdf(r, { now: NOW });
    const all = pdfPageTexts(doc).join('\n');
    expect(all).toContain('Gardien Fixture');
    expect(all).toContain('ARRÊTS');
    expect(all).toContain('GARDIEN');
    expect(all).not.toContain('Tirs de la saison');
    expect(all).not.toContain('BUTS · XG');
    expect(audit.outOfBounds).toEqual([]);
  });

  it('nom très long et caractères hors Latin-1 : rien hors des marges, texte translittéré', () => {
    const name = 'Đorđe Łukasz Petrović-Konstantinopoulos Çağlar Søren Müller-Østergaard';
    const r = record({ player: { ...playerRef(STRIKER), name } });
    const { doc, audit } = buildReportPdf(r, { now: NOW });
    expect(pdfPageTexts(doc)[0]).toContain('Dorde Lukasz');
    expect(audit.outOfBounds).toEqual([]);
    expect(audit.minFont).toBeGreaterThanOrEqual(MIN_FONT);
  });

  it('saison historique sans données marché ni projection : page 1 complète, projection indisponible signalée', () => {
    const r = record({ player: { ...playerRef(STRIKER), season: '2024-25', seasonLabel: '24-25' } });
    r.dataSnapshot = { ...r.dataSnapshot, projection: [], indicators: {}, facts: { ...r.dataSnapshot.facts, values: { marketValueTransfermarkt: null, estimatedValueScoutVision: null, estimatedValueTypicalError: null } } };
    const { doc, audit } = buildReportPdf(r, { now: NOW });
    const all = pdfPageTexts(doc).join('\n');
    expect(all).toContain('Projection statistique ScoutVision indisponible');
    expect(all).toContain('Aucun indicateur de modèle disponible');
    expect(all).toContain('24-25');
    expect(audit.emptySections).toEqual([]);
  });
});
