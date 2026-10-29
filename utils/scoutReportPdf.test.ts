import { describe, expect, it } from 'vitest';
import { buildReportPdf, pdfFileName, pdfPageTexts, pdfText } from './scoutReportPdf';
import { buildSnapshot, playerRef } from './scoutReportSnapshot';
import { ScoutReportRecord } from '../types/scoutReport';
import { STRIKER } from './scoutReportFixtures';

const NOW = new Date('2026-10-29T12:00:00.000Z');

// Synthèse longue (fixture) : 5 sections, ~600 mots, pour vérifier que rien n'est tronqué
const LONG_SUMMARY = (() => {
  const para = (n: number) => Array.from({ length: n }, (_, i) => `- Point ${i + 1} : phrase de test suffisamment longue pour occuper une ligne entière du PDF et forcer la pagination du rapport.`).join('\n');
  return ['### 1. Contexte et profil', para(8), '### 2. Analyse de la performance', para(14), '### 3. Forces et limites statistiques', para(12),
    '### 4. Projection et contexte', para(10), '### 5. Priorités d\'observation', '- Vérifier en vidéo la qualité des occasions.', '- DERNIÈRE PRIORITÉ : observer en live les duels aériens.'].join('\n');
})();

function record(over: Partial<ScoutReportRecord> = {}): ScoutReportRecord {
  return {
    id: 'r1', schemaVersion: 1, player: playerRef(STRIKER), createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z', status: 'to_observe',
    role: 'Renard des surfaces', tags: ['prêt'], dataSnapshot: buildSnapshot(STRIKER, { dataIndex: { generatedAt: '2026-10-20T00:00:00.000Z' } as never }),
    generatedSummaries: [], observations: [], ...over,
  };
}

describe('pdfText / pdfFileName', () => {
  it('garde les accents Latin-1, translittère le reste, ne produit jamais un nom vide', () => {
    expect(pdfText('Mbappé — « élite » → 2 ≥ 1 Łukasz Đorđe')).toBe('Mbappé - « élite » -> 2 >= 1 Lukasz Dorde');
    expect(pdfText((1692).toLocaleString('fr-FR') + ' min')).toBe('1 692 min');   // espace fine insécable → espace
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: 'Kylian Mbappé' } }), NOW)).toBe('ScoutVision_Kylian-Mbappe_2026-27_2026-10-29.pdf');
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: 'Đorđe Đurić-Ñ' } }), NOW)).toBe('ScoutVision_Dorde-Duric-N_2026-27_2026-10-29.pdf');
    expect(pdfFileName(record({ player: { ...playerRef(STRIKER), name: '!!!', season: '' } }), NOW)).toBe('ScoutVision_joueur_saison_2026-10-29.pdf');
  });
});

describe('buildReportPdf', () => {
  it('dossier sans synthèse IA : profil + analyse, métadonnées en pied de page, texte extractible', () => {
    const { doc, pages } = buildReportPdf(record(), { now: NOW });
    const texts = pdfPageTexts(doc);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(texts[0]).toContain('Attaquant Fixture');
    expect(texts[0]).toContain('Renard des surfaces');
    expect(texts[0]).toMatch(/Page 1 \/ \d+/);
    expect(texts[0]).toContain('Rapport : sans synthèse IA');
    expect(texts[0]).toContain('Données : 20/10/2026');
    expect(texts[texts.length - 1]).toContain(`Page ${pages} / ${pages}`);
    expect(doc.output('arraybuffer').byteLength).toBeLessThan(200_000);
  });

  it('rapport long : complet jusqu\'aux priorités d\'observation, blocs paginés, observations humaines à part', () => {
    const r = record({
      generatedSummaries: [
        { id: 's1', model: 'gemini-fixture-1', promptVersion: 'scout-report-v2', generatedAt: '2026-10-28T10:00:00.000Z', content: '### 1. Contexte\n- ancienne version' },
        { id: 's2', model: 'gemini-fixture-2', promptVersion: 'scout-report-v2', generatedAt: '2026-10-29T10:00:00.000Z', content: LONG_SUMMARY },
      ],
      observations: [{ id: 'o1', date: '2026-10-27', type: 'live', text: 'Observation humaine au stade.', strengths: 'Appels', conclusion: 'À suivre', createdAt: '2026-10-27T22:00:00.000Z' }],
    });
    const { doc, pages, summary } = buildReportPdf(r, { now: NOW });
    const texts = pdfPageTexts(doc);
    const all = texts.join('\n');
    expect(summary?.id).toBe('s2');                       // dernière version par défaut
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(all).toContain('Point 10 : phrase de test');   // section 2 entière (coupée à la section 3 avant la refonte)
    expect(all).toContain('Point 12 : phrase de test');
    expect(all).toContain('DERNIÈRE PRIORITÉ');
    expect(all).toContain('Observation humaine au stade.');
    expect(all).toContain('Historique des versions');
    expect(all).toContain('gemini-fixture-1');
    expect(texts[0]).toContain('Modèle : gemini-fixture-2');
    expect(texts[0]).toContain('Version : scout-report-v2');
    expect(texts[0]).toContain('Rapport : 29/10/2026');
    // Chaque page porte son numéro ; aucune image pleine page (pas de XObject image)
    texts.forEach((t, i) => expect(t).toContain(`Page ${i + 1} / ${pages}`));
    expect(doc.output('arraybuffer').byteLength).toBeLessThan(300_000);
    expect(buildReportPdf(r, { now: NOW, summaryId: 's1' }).summary?.id).toBe('s1');
  });
});
