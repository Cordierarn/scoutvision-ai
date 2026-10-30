/**
 * ScoutVision - export PDF d'un dossier de scouting (jsPDF, texte natif, pagination déterministe)
 *
 * Construit uniquement à partir du ScoutReportRecord (snapshot figé) : jamais depuis la fiche, les
 * données de la saison chargée ou le DOM. Document de base en quatre pages :
 *   1. Synthèse joueur : identité, KPI, valeur, rôles, radar, forces et limites ;
 *   2. Impact et développement : indicateurs des modèles, projection, contexte d'équipe ;
 *   3. Tirs et métriques par famille (sélection utile, annexe complète en mode « complet ») ;
 *   4. Scouting : synthèse ScoutVision (dernière version), priorités d'observation, observations
 *      du scout, conclusion du scout, puis note de méthodologie.
 * Mode « complet » : annexe avec l'historique des synthèses et toutes les métriques.
 * Primitives et grille : utils/scoutReportPdfKit.ts.
 */

import { jsPDF } from 'jspdf';
import { ScoutReportRecord, GeneratedSummary, ReportFacts } from '../types/scoutReport';
import { FactMetric, observationPriorities, orientedPercentile, roleMetrics, strengthsAndLimits, summarySections } from './scoutReportSnapshot';
import { METRIC_CATEGORIES } from './metricCategories';
import { metricLabel } from './labels';
import { getFlagUrl } from './flags';
import { formatEuro } from './format';
import { RATING_LABELS, UNMEASURED_DIMENSIONS, gridGaps, gridTemplate, isBlindHidden } from './observationGrid';
import {
  CONTENT_W, FONT, MARGIN, PdfAudit, PdfCanvas, PdfImage, SP, THEME, colX, drawCallout, drawIdentityBlock, drawIndicator,
  drawBlankGrid, drawKpiRow, drawMethodologyNote, drawMetricRow, drawObservation, drawPageFooter, drawPageHeader, drawRadar, drawRoleBadge, drawSectionTitle, roleBadgeWidth,
  drawTextBlock, fmtDate, fr, lineHeight, pdfText, signed, span,
} from './scoutReportPdfKit';

export { pdfText };
export type { PdfAudit, PdfImage };

// ============================================
// OPTIONS, NOM DE FICHIER
// ============================================

export type PdfMode = 'synthese' | 'complet';

export interface PdfOptions {
  mode?: PdfMode;                // synthèse (4 pages, dernière synthèse) par défaut ; complet = annexe
  summaryId?: string;            // version de synthèse à imprimer (la dernière par défaut)
  now?: Date;
  dataGeneratedAt?: string;      // date des données affichée si le snapshot ne l'a pas
  photo?: PdfImage;              // photo du joueur déjà chargée (navigateur), facultative
  flag?: PdfImage;               // drapeau déjà chargé, facultatif
  statusLabel?: (s: ScoutReportRecord['status']) => string;
  typeLabel?: (t: ScoutReportRecord['observations'][number]['type']) => string;
}

const STATUS_FR: Record<ScoutReportRecord['status'], string> = { draft: 'Brouillon', to_observe: 'À observer', finalized: 'Finalisé', archived: 'Archivé' };
const TYPE_FR: Record<ScoutReportRecord['observations'][number]['type'], string> = { video: 'Vidéo', live: 'Live', general: 'Général' };

/** « ScoutVision_<nom>_<saison>_<date>.pdf », accents translittérés, jamais vide */
export function pdfFileName(record: ScoutReportRecord, now = new Date()): string {
  const slug = (s: string) => pdfText(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = slug(record.player.name) || 'joueur';
  const season = slug(record.player.season) || 'saison';
  return `ScoutVision_${name}_${season}_${now.toISOString().slice(0, 10)}.pdf`;
}

// ============================================
// LECTURES DU SNAPSHOT
// ============================================

const LABEL_TO_FAMILY = new Map<string, string>(METRIC_CATEGORIES.flatMap(c => c.keys.map(k => [metricLabel(k), c.id] as [string, string])));
const FAMILY_LABEL = new Map(METRIC_CATEGORIES.map(c => [c.id, c.label]));
const FAMILY_ORDER = ['finishing', 'creation', 'progression', 'possession', 'circulation', 'defending', 'duels', 'goalkeeping', 'models', 'rating'];

const fmtValue = (v: number): string => {
  const abs = Math.abs(v);
  const digits = Number.isInteger(v) ? 0 : abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
};

/** Statistique par clé de colonne, dans les métriques puis dans les totaux sans percentile */
function stat(facts: ReportFacts, key: string): number | undefined {
  const label = metricLabel(key);
  return facts.metrics.find(m => m.metric === label)?.value ?? facts.otherStats.find(s => s.stat === label)?.value;
}

const rowOf = (m: FactMetric) => ({ label: m.metric, value: fmtValue(m.value), percentile: m.percentile, oriented: orientedPercentile(m), note: m.lessIsPreferable ? '(inv.)' : undefined });

/** Métriques par famille : sélection (les plus marquées, `perFamily` au plus, note globale exclue) ou toutes */
function metricFamilies(facts: ReportFacts, all: boolean, perFamily = 4): { id: string; label: string; metrics: FactMetric[] }[] {
  const by = new Map<string, FactMetric[]>();
  facts.metrics.forEach(m => { const f = LABEL_TO_FAMILY.get(m.metric) ?? 'other'; by.set(f, [...(by.get(f) ?? []), m]); });
  return [...FAMILY_ORDER, 'other'].flatMap(id => {
    const list = by.get(id);
    if (!list || list.length === 0 || (!all && id === 'rating')) return [];
    const picked = all ? list : [...list].sort((a, b) => Math.abs(b.percentile - 50) - Math.abs(a.percentile - 50)).slice(0, perFamily);
    if (!all && picked.length < 2) return [];
    return [{ id, label: id === 'other' ? 'Autres' : FAMILY_LABEL.get(id) ?? id, metrics: picked }];
  });
}

const reliabilityLabel = (r: number) => (r >= 0.6 ? 'bonne' : r >= 0.3 ? 'modérée' : 'faible');

// ============================================
// PAGES
// ============================================

interface Ctx {
  c: PdfCanvas; record: ScoutReportRecord; facts: ReportFacts; summary: GeneratedSummary | undefined; options: PdfOptions;
  mode: PdfMode; statusLabel: (s: ScoutReportRecord['status']) => string; typeLabel: (t: ScoutReportRecord['observations'][number]['type']) => string;
}

function page1Synthesis({ c, record, facts, options }: Ctx) {
  const p = record.player, snap = record.dataSnapshot;
  const role = record.role ?? snap.bestRoles[0]?.role;
  const roleIndex = snap.bestRoles.find(b => b.role === role)?.index ?? facts.scoutVisionRoleIndices.find(r => r.role === role)?.index;

  // Identité
  c.openSection('Identité');
  const chips: string[] = [];
  const position = facts.player.position ?? p.position;
  if (position) chips.push(String(position));
  const age = p.age ?? facts.player.age;
  if (age !== undefined) chips.push(`${age} ans`);
  if (facts.player.preferredFoot) chips.push(`pied ${String(facts.player.preferredFoot).toLowerCase()}`);
  if (facts.player.heightCm !== undefined) chips.push(`${facts.player.heightCm} cm`);
  if (facts.sample.minutes !== undefined) chips.push(`${Number(facts.sample.minutes).toLocaleString('fr-FR')} min`);
  if (facts.sample.matches !== undefined) chips.push(`${facts.sample.matches} matchs${facts.sample.starts !== undefined ? ` (${facts.sample.starts} titul.)` : ''}`);
  drawIdentityBlock(c, {
    name: p.name, team: p.team, competition: p.competitionName ?? p.competition, season: p.seasonLabel ?? p.season, chips,
    photo: options.photo, flag: options.flag, nationality: facts.player.nationalityCode ? String(facts.player.nationalityCode) : undefined,
  });
  c.closeSection();
  c.space(SP.xs);

  // KPI : six au plus
  c.openSection('KPI');
  const kpis: { label: string; value: string; sub?: string }[] = [];
  if (facts.sample.minutes !== undefined) kpis.push({ label: 'Minutes', value: Number(facts.sample.minutes).toLocaleString('fr-FR'), sub: facts.sample.shareOfTeamMinutesPct !== undefined ? `part ${facts.sample.shareOfTeamMinutesPct} %` : facts.sample.matches !== undefined ? `${facts.sample.matches} matchs` : undefined });
  const rating = facts.metrics.find(m => m.metric === metricLabel('Rating'));
  if (rating) kpis.push({ label: 'Note', value: fr(rating.value, 2), sub: `P${rating.percentile} · notes de match` });
  const goalkeeper = /gardien/i.test(String(position ?? ''));
  if (goalkeeper) {
    // Gardien : arrêts et buts évités plutôt que buts et passes décisives
    const saveRate = facts.metrics.find(m => m.metric === metricLabel('Save rate, %'));
    if (saveRate) kpis.push({ label: 'Arrêts', value: `${fmtValue(saveRate.value)} %`, sub: `P${saveRate.percentile}` });
    const prevented = facts.metrics.find(m => m.metric === metricLabel('Prevented goals per 90'));
    if (prevented) kpis.push({ label: 'Buts évités /90', value: fmtValue(prevented.value), sub: `P${prevented.percentile}` });
  } else {
    const goals = stat(facts, 'Goals'), xg = stat(facts, 'xG');
    if (goals !== undefined || xg !== undefined) kpis.push({ label: 'Buts · xG', value: `${goals !== undefined ? fmtValue(goals) : '—'} · ${xg !== undefined ? fr(xg, 1) : '—'}`, sub: 'saison' });
    const assists = stat(facts, 'Assists'), xa = stat(facts, 'xA');
    if (assists !== undefined || xa !== undefined) kpis.push({ label: 'Passes déc. · xA', value: `${assists !== undefined ? fmtValue(assists) : '—'} · ${xa !== undefined ? fr(xa, 1) : '—'}`, sub: 'saison' });
  }
  if (role) kpis.push({ label: 'Rôle principal', value: role, sub: roleIndex !== undefined ? `indice ${roleIndex} / 100` : undefined });
  if (facts.values.marketValueTransfermarkt) kpis.push({ label: 'Valeur marché', value: facts.values.marketValueTransfermarkt, sub: 'Transfermarkt' });
  else if (facts.values.estimatedValueScoutVision) kpis.push({ label: 'Estimation ScoutVision', value: facts.values.estimatedValueScoutVision, sub: 'statistique, pas un prix' });
  drawKpiRow(c, kpis.slice(0, 6));
  c.closeSection();
  c.space(SP.xs);

  // Radar (gauche) · valeur et rôles (droite)
  c.openSection('Profil');
  const top = c.y;
  const leftW = span(7), rightX = colX(7), rightW = span(5);
  const axes = roleMetrics(facts, role, 8).map(m => ({ label: m.metric.replace(/ par 90$/, ' /90') + (m.lessIsPreferable ? ' (inv.)' : ''), value: orientedPercentile(m) }));
  c.font(FONT.note, THEME.ink3, 'bold'); c.text(`RADAR DU RÔLE${role ? ` · ${pdfText(role).toUpperCase()}` : ''}`, MARGIN, top + 3);
  let leftY = top + 5;
  if (axes.length >= 3) {
    leftY = drawRadar(c, MARGIN, leftY, leftW, axes);
    c.font(FONT.note, THEME.ink3);
    c.wrap('Percentiles du rôle (anneaux 25, 50, 75, 100), sens « plus c\'est haut, mieux c\'est » ; métriques « inv. » retournées.', leftW).forEach(l => { c.text(l, MARGIN, leftY + 2.5); leftY += lineHeight(FONT.note); });
  } else {
    c.y = top + 6;
    leftY = drawTextBlock(c, 'Radar non disponible : moins de trois métriques du rôle dans les faits du dossier.', { size: FONT.small, color: THEME.ink3, width: leftW, x: MARGIN });
  }

  const valueRows: { label: string; value: string; sub?: string }[] = [
    { label: 'Valeur de marché Transfermarkt', value: facts.values.marketValueTransfermarkt ?? 'Non disponible' },
    { label: 'Estimation statistique ScoutVision', value: facts.values.estimatedValueScoutVision ?? 'Non disponible', sub: facts.values.estimatedValueScoutVision ? `erreur typique ${facts.values.estimatedValueTypicalError ?? '—'} · estimation statistique, pas un prix` : undefined },
    { label: 'Contrat', value: facts.contractUntil ? `jusqu'au ${fmtDate(facts.contractUntil)}` : 'Non renseigné' },
  ];
  let rightY = drawCallout(c, rightX, top, rightW, 'Valeur', valueRows);
  rightY += SP.xs;

  const roles = snap.bestRoles.length ? snap.bestRoles : facts.scoutVisionRoleIndices;
  const primary = roles.find(r => r.role === role) ?? roles[0];
  const secondaries = roles.filter(r => r !== primary).slice(0, 3);
  // Rôles secondaires sur une ou deux lignes selon la largeur des badges
  const badgeLines: { role: string; index: number }[][] = [[]];
  let lineW = 0;
  secondaries.forEach(r => {
    const w = roleBadgeWidth(c, r);
    if (lineW > 0 && lineW + w > rightW - 7) { badgeLines.push([]); lineW = 0; }
    badgeLines[badgeLines.length - 1].push(r); lineW += w + 2;
  });
  const secondaryRows = secondaries.length ? badgeLines.length : 0;
  const rolesH = 8 + (primary ? 9 : 0) + secondaryRows * 8 + (primary ? 0 : 6) + 6;
  c.rect(rightX, rightY, rightW, rolesH, THEME.white, THEME.rule, 1.2); c.rect(rightX, rightY, rightW, 1.2, THEME.navy);
  c.font(FONT.note, THEME.ink3, 'bold'); c.text('RÔLES SCOUTVISION', rightX + 3.5, rightY + 5.4);
  let ry = rightY + 8;
  if (primary) { drawRoleBadge(c, rightX + 3.5, ry, primary, true); ry += 9; }
  if (secondaries.length) {
    badgeLines.forEach(line => {
      let bx = rightX + 3.5;
      line.forEach(r => { const w = drawRoleBadge(c, bx, ry, r); bx += w + 2; });
      ry += 8;
    });
  }
  if (!primary) { c.font(FONT.small, THEME.ink3); c.text('Aucun rôle calculé pour ce poste.', rightX + 3.5, ry + 3); ry += 6; }
  c.font(FONT.note, THEME.ink3); c.text('Indice composite 0–100, et non percentile.', rightX + 3.5, rightY + rolesH - 2.2);
  rightY += rolesH;
  c.y = Math.max(leftY, rightY) + SP.sm;
  c.closeSection();

  // Forces et limites
  c.openSection('Forces et limites');
  drawSectionTitle(c, 'Synthèse du profil statistique', { level: 2, tag: 'libellé · valeur brute · percentile' });
  const { strengths, limits } = strengthsAndLimits(facts, 5);
  const half = span(6);
  const colTop = c.y;
  c.font(FONT.note, THEME.cyanInk, 'bold'); c.text('FORCES', MARGIN, colTop + 3);
  c.font(FONT.note, THEME.red, 'bold'); c.text('LIMITES', colX(6), colTop + 3);
  let yl = colTop + 5, yr = colTop + 5;
  if (strengths.length) strengths.forEach(m => { yl = drawMetricRow(c, MARGIN, yl, half, rowOf(m)); });
  else { c.font(FONT.small, THEME.ink3); c.text('Aucune métrique au 75e percentile ou plus.', MARGIN, yl + 3.5); yl += 6; }
  if (limits.length) limits.forEach(m => { yr = drawMetricRow(c, colX(6), yr, half, rowOf(m)); });
  else { c.font(FONT.small, THEME.ink3); c.text('Aucune métrique au 25e percentile ou moins.', colX(6), yr + 3.5); yr += 6; }
  c.y = Math.max(yl, yr) + 1.5;
  drawTextBlock(c, 'Percentiles du pipeline ScoutVision : rang parmi les joueurs du même groupe de poste, du même niveau de compétition et de la même saison. Ils classent un volume, pas une qualité ; « inv. » : moins c\'est mieux.', { size: FONT.note, color: THEME.ink3 });
  c.closeSection();
}

function page2Impact({ c, record, facts }: Ctx) {
  const snap = record.dataSnapshot, ind = snap.indicators ?? {};
  c.addPage();
  drawSectionTitle(c, 'Impact et développement', { tag: 'Données ScoutVision' });
  const leftW = span(6), rightX = colX(6), rightW = span(6);
  const top = c.y;
  const pageBefore = c.page;

  // Colonne 1 : impact
  c.openSection('Impact');
  drawSectionTitle(c, 'Impact', { level: 2, x: MARGIN, width: leftW });
  let items = 0;
  if (ind.rapm) {
    const r = ind.rapm;
    drawIndicator(c, MARGIN, leftW, {
      title: 'RAPM net', value: `${signed(r.net, 3)} xG / 90`,
      interpretation: `${r.off !== undefined ? `Offensif ${signed(r.off, 3)}` : ''}${r.off !== undefined && r.def !== undefined ? ' · ' : ''}${r.def !== undefined ? `défensif ${signed(r.def, 3)}` : ''}${r.pct !== undefined ? ` · P${r.pct} dans la ligue` : ''}`.trim() || undefined,
      context: `Plus-minus régularisé sur deux saisons${r.minutes !== undefined ? `, ${Math.round(r.minutes).toLocaleString('fr-FR')} min prises en compte` : ''}.`,
      limit: r.reliability ? `fiabilité ${reliabilityLabel(r.reliability.net)} dans cette ligue (nette ${fr(r.reliability.net, 2)}, défense ${fr(r.reliability.def, 2)} ; 1 = parfaitement fiable).` : 'fiabilité de la ligue inconnue.',
      tone: r.net < 0 ? THEME.orange : THEME.cyan,
    }); items++;
  }
  if (ind.finishing) {
    const f = ind.finishing;
    drawIndicator(c, MARGIN, leftW, {
      title: 'Talent de finition', value: `${signed(f.skill, 1)} but / 100 tirs`,
      interpretation: f.skill > 0 ? 'Marque plus que son xG ne le prévoit.' : f.skill < 0 ? 'Marque moins que son xG ne le prévoit.' : 'Conforme à son xG.',
      context: `${f.shots} tirs en carrière, estimation resserrée vers la moyenne.`,
      limit: f.shots < 50 ? 'petit échantillon (moins de 50 tirs).' : 'la finition est l\'une des qualités les moins stables d\'une saison à l\'autre.',
      tone: f.skill < 0 ? THEME.orange : THEME.cyan,
    }); items++;
  }
  if (ind.passShare) {
    const s = ind.passShare;
    drawIndicator(c, MARGIN, leftW, {
      title: 'Part des passes de l\'équipe', value: `${fr(s.value, 1)} %`,
      interpretation: s.pct !== undefined ? `P${s.pct} pour le rôle.` : undefined,
      context: `Réseau de passes de l'équipe${s.matches !== undefined ? ` sur ${s.matches} matchs` : ''}.`,
      limit: s.matches !== undefined && s.matches < 5 ? 'moins de cinq matchs de réseau.' : undefined,
    }); items++;
  }
  const relay = facts.metrics.find(m => m.metric === metricLabel('Network betweenness'));
  if (relay) {
    drawIndicator(c, MARGIN, leftW, { title: 'Rôle de relais', value: `${fmtValue(relay.value)} · P${relay.percentile}`, interpretation: 'Centralité dans le réseau de passes : part des circuits qui passent par le joueur.', context: 'Décrit une fonction dans le jeu de l\'équipe, pas une qualité.' }); items++;
  }
  if (ind.valuation?.market || ind.valuation?.estimate) {
    const v = ind.valuation;
    const ratio = v.market && v.estimate ? Math.round((v.estimate / v.market) * 100) : undefined;
    drawIndicator(c, MARGIN, leftW, {
      title: 'Valeur et performance', value: v.estimate ? `${formatEuro(v.estimate)} estimés` : `${formatEuro(v.market!)} de valeur de marché`,
      interpretation: ratio !== undefined ? `Estimation statistique = ${ratio} % de la valeur de marché Transfermarkt (${formatEuro(v.market!)}).` : v.estimate ? 'Valeur de marché Transfermarkt non disponible.' : 'Estimation statistique non disponible.',
      context: 'Modèle de valeur ScoutVision à partir de la performance.',
      limit: v.estimate ? `erreur typique ${facts.values.estimatedValueTypicalError ?? '×1,7'} ; une estimation statistique, pas un prix.` : undefined,
    }); items++;
  }
  if (!items) drawTextBlock(c, 'Aucun indicateur de modèle disponible pour cette ligne joueur-saison.', { size: FONT.small, color: THEME.ink3, width: leftW });
  c.closeSection();
  const leftEnd = c.y;

  // Colonne 2 : développement (sous la colonne 1 si celle-ci a débordé sur une autre page)
  const twoColumns = c.page === pageBefore;
  c.y = twoColumns ? top : leftEnd + SP.sm;
  const x = twoColumns ? rightX : MARGIN, w = twoColumns ? rightW : CONTENT_W;
  c.openSection('Développement');
  drawSectionTitle(c, 'Développement', { level: 2, x, width: w });
  const age = record.player.age ?? facts.player.age;
  if (snap.projection && snap.projection.length) {
    drawTextBlock(c, `Projection statistique ScoutVision : percentile actuel → percentile attendu la saison prochaine, d'après les courbes d'âge du rôle${age !== undefined ? ` (${age} ans)` : ''}. Effet de l'âge et retour vers la moyenne inclus. Une tendance, pas un verdict.`, { size: FONT.small, color: THEME.ink2, x, width: w });
    c.space(2);
    c.font(FONT.note, THEME.ink3, 'bold');
    c.text('MÉTRIQUE', x, c.y + 3); c.text('ACTUEL → PROJETÉ', x + w - 16, c.y + 3, { align: 'right' }); c.text('ÉCART', x + w, c.y + 3, { align: 'right' });
    c.y += 5;
    const lh = lineHeight(FONT.body) + 1.2;
    snap.projection.forEach(pr => {
      c.ensureSpace(lh);
      const d = pr.projected - pr.current;
      c.font(FONT.body, THEME.ink); c.text(c.fit(pr.label, w - 44), x, c.y + lh * 0.7);
      c.font(FONT.body, THEME.ink, 'bold'); c.text(`P${pr.current} → P${pr.projected}`, x + w - 16, c.y + lh * 0.7, { align: 'right' });
      c.font(FONT.body, d > 0 ? THEME.cyanInk : d < 0 ? THEME.orange : THEME.ink3, 'bold'); c.text(signed(d, 0), x + w, c.y + lh * 0.7, { align: 'right' });
      c.rule(c.y + lh, x, w, THEME.fill, 0.2);
      c.y += lh;
    });
    c.space(2);
    const up = snap.projection.filter(q => q.projected > q.current).length, down = snap.projection.filter(q => q.projected < q.current).length, flat = snap.projection.length - up - down;
    drawTextBlock(c, `Évolution attendue sur un an : ${up} métrique${up > 1 ? 's' : ''} en hausse, ${down} en baisse, ${flat} stable${flat > 1 ? 's' : ''}. Les percentiles extrêmes reviennent vers la moyenne ; l'effet de l'âge dépend du rôle.`, { size: FONT.small, color: THEME.ink2, x, width: w });
  } else {
    drawTextBlock(c, 'Projection statistique ScoutVision indisponible : courbes d\'âge absentes pour ce rôle ou âge inconnu.', { size: FONT.small, color: THEME.ink3, x, width: w });
  }
  if (snap.seasonInProgress || facts.sample.seasonInProgress === true) {
    c.space(2);
    drawTextBlock(c, 'Saison en cours au moment du snapshot : échantillon partiel, les percentiles et la projection peuvent encore bouger.', { size: FONT.small, color: THEME.orange, x, width: w });
  }
  // Métriques du rôle : percentile actuel, point de départ de la projection
  const roleRows = roleMetrics(facts, record.role ?? snap.bestRoles[0]?.role, 8);
  if (roleRows.length) {
    c.space(SP.xs);
    c.ensureSpace(12);
    c.font(FONT.note, THEME.ink3, 'bold'); c.text('MÉTRIQUES DU RÔLE · PERCENTILE ACTUEL', x, c.y + 3); c.y += 5;
    roleRows.forEach(m => { c.ensureSpace(6); c.y = drawMetricRow(c, x, c.y, w, rowOf(m)); });
  }
  c.closeSection();
  c.y = (twoColumns ? Math.max(c.y, leftEnd) : c.y) + SP.md;

  // Contexte d'équipe
  c.openSection('Contexte d\'équipe');
  drawSectionTitle(c, 'Contexte d\'équipe', { level: 2, tag: 'décrit l\'équipe, pas le joueur' });
  const team = facts.teamContext;
  const kpis: { label: string; value: string; sub?: string }[] = [];
  if (team.style !== undefined) kpis.push({ label: 'Style observé', value: String(team.style) });
  if (team.possessionPct !== undefined) kpis.push({ label: 'Possession', value: `${fr(Number(team.possessionPct), 1)} %` });
  if (team.ppda !== undefined) kpis.push({ label: 'PPDA', value: fr(Number(team.ppda), 1), sub: 'plus bas = pressing plus haut' });
  if (team.fieldTiltPct !== undefined) kpis.push({ label: 'Domination territoriale', value: `${fr(Number(team.fieldTiltPct), 1)} %`, sub: 'field tilt' });
  if (facts.sample.shareOfTeamMinutesPct !== undefined) kpis.push({ label: 'Part des minutes', value: `${facts.sample.shareOfTeamMinutesPct} %`, sub: 'du joueur dans l\'équipe' });
  if (kpis.length) drawKpiRow(c, kpis);
  else drawTextBlock(c, 'Contexte d\'équipe non disponible dans le snapshot.', { size: FONT.small, color: THEME.ink3 });
  drawTextBlock(c, 'Les chiffres du joueur sont produits dans ce contexte collectif : un pressing haut ou une possession élevée modifient les volumes par 90 minutes.', { size: FONT.note, color: THEME.ink3 });
  c.closeSection();
}

function page3Metrics({ c, facts, mode }: Ctx) {
  c.addPage();
  drawSectionTitle(c, 'Tirs et métriques', { tag: 'Données ScoutVision' });

  if (facts.shots) {
    c.openSection('Tirs');
    drawSectionTitle(c, 'Tirs de la saison', { level: 2 });
    const s = facts.shots;
    const kpis = [
      { label: 'Tirs', value: String(s.shots) }, { label: 'Buts', value: String(s.goals) },
      { label: 'xG', value: fr(s.xG, 2), sub: s.shots > 0 ? `${fr(s.xG / s.shots, 2)} xG par tir` : undefined },
      { label: 'Buts − xG', value: signed(s.goals - s.xG, 2) }, { label: 'Conversion', value: `${fr(s.conversionPct, 1)} %` },
    ];
    const npxg = facts.metrics.find(m => m.metric === metricLabel('npxG per 90'));
    if (npxg) kpis.push({ label: 'npxG / 90', value: fmtValue(npxg.value), sub: `P${npxg.percentile}` });
    const onTarget = facts.metrics.find(m => m.metric === metricLabel('Shots on target, %'));
    if (onTarget && kpis.length < 6) kpis.push({ label: 'Tirs cadrés', value: `${fmtValue(onTarget.value)} %`, sub: `P${onTarget.percentile}` });
    drawKpiRow(c, kpis.slice(0, 6));
    drawTextBlock(c, 'Carte des tirs et carte de chaleur : non incluses dans le snapshot du dossier (consultables dans la fiche joueur).', { size: FONT.note, color: THEME.ink3 });
    c.closeSection();
    c.space(SP.sm);
  }

  c.openSection('Métriques par famille');
  drawSectionTitle(c, mode === 'complet' ? 'Toutes les métriques, par famille' : 'Principales métriques, par famille', { level: 2, tag: mode === 'complet' ? 'annexe complète' : 'les métriques les plus marquées de chaque famille' });
  const half = span(6), lh = lineHeight(FONT.body) + 1.4;
  // Sélection : le nombre de métriques par famille est choisi pour que la page suffise (2 par ligne, en-tête de 10,5 mm)
  let families = metricFamilies(facts, mode === 'complet', 6);
  if (mode !== 'complet') {
    const budget = c.remaining - 2;
    for (const per of [6, 4, 2]) {
      families = metricFamilies(facts, false, per);
      const needed = families.reduce((sum, f) => sum + 10.5 + Math.ceil(f.metrics.length / 2) * lh, 0);
      if (needed <= budget) break;
    }
  }
  if (!families.length) drawTextBlock(c, 'Aucune métrique avec percentile dans les faits du dossier.', { size: FONT.small, color: THEME.ink3 });
  families.forEach(fam => {
    const rows = Math.ceil(fam.metrics.length / 2);
    c.ensureSpace(Math.min(7 + rows * lh, 40));
    c.font(FONT.small, THEME.navy, 'bold'); c.text(fam.label.toUpperCase(), MARGIN, c.y + 3.2);
    c.rule(c.y + 4.6, MARGIN, CONTENT_W, THEME.rule, 0.2);
    c.y += 6.5;
    for (let i = 0; i < fam.metrics.length; i += 2) {
      c.ensureSpace(lh);
      const y = c.y;
      drawMetricRow(c, MARGIN, y, half, rowOf(fam.metrics[i]));
      if (fam.metrics[i + 1]) drawMetricRow(c, colX(6), y, half, rowOf(fam.metrics[i + 1]));
      c.y = y + lh;
    }
    c.space(SP.xs);
  });
  if (mode === 'complet' && facts.otherStats.length) {
    c.ensureSpace(14);
    c.font(FONT.small, THEME.navy, 'bold'); c.text('TOTAUX DE SAISON SANS PERCENTILE', MARGIN, c.y + 3.2);
    c.rule(c.y + 4.6, MARGIN, CONTENT_W, THEME.rule, 0.2); c.y += 6.5;
    drawTextBlock(c, facts.otherStats.map(s => `${s.stat} ${fmtValue(s.value)}`).join('  ·  '), { size: FONT.small, color: THEME.ink2 });
  }
  c.closeSection();
}

const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').trim();

/** Synthèse Markdown : sous-titres « ### n. Titre » et puces ; la section des priorités est écartée (section B) */
function drawSummary(c: PdfCanvas, content: string, skipPriorities: boolean) {
  summarySections(content).forEach(section => {
    if (skipPriorities && /priorit/i.test(section.title)) return;
    if (section.title) drawSectionTitle(c, stripMd(section.title), { level: 2 });
    let blank = false;
    section.lines.forEach(line => {
      const t = line.trim();
      if (!t) { blank = true; return; }
      if (blank) { c.space(1.5); blank = false; }
      const bullet = t.match(/^[-*•]\s+(.*)$/);
      if (bullet) drawTextBlock(c, stripMd(bullet[1]), { bullet: '•', indent: 1, size: FONT.body + 0.5 });
      else drawTextBlock(c, stripMd(t), { size: FONT.body + 0.5 });
    });
    c.space(2);
  });
}

/** Lignes de la grille d'une observation : note globale, critères du rôle avec l'écart (données révélées), dimensions non mesurées */
function gridLines(grid: NonNullable<ScoutReportRecord['observations'][number]['grid']>, record: ScoutReportRecord, blindHidden: boolean): string[] {
  const lines: string[] = [];
  lines.push(`Rôle ${grid.role}${grid.overall !== undefined ? ` · note globale du scout ${grid.overall}/5 (${RATING_LABELS[grid.overall].toLowerCase()})` : ' · sans note globale'}`);
  if (blindHidden) {
    grid.criteria.filter(c => c.rating !== undefined || c.note).forEach(c => lines.push(`${c.label} : ${c.rating !== undefined ? `${c.rating}/5` : 'non notée'}${c.note ? ` (${c.note})` : ''}`));
    return lines;
  }
  const gaps = gridGaps(grid, record.dataSnapshot.facts);
  if (gaps.items.length) {
    lines.push(`Écart data / observation : ${gaps.above} au-dessus de la donnée, ${gaps.below} en dessous, ${gaps.aligned} dans la même bande${gaps.unmatched ? `, ${gaps.unmatched} sans percentile` : ''}.`);
    gaps.items.forEach(i => lines.push(`${i.label} : scout ${i.rating}/5${i.percentile !== undefined ? ` · donnée ${i.dataRating}/5 (P${i.percentile}) · écart ${i.gap! > 0 ? '+' : ''}${i.gap}` : ' · pas de percentile'}`));
  }
  grid.criteria.filter(c => c.kind === 'unmeasured' && (c.rating !== undefined || c.note)).forEach(c => lines.push(`${c.label} (non mesuré) : ${c.rating !== undefined ? `${c.rating}/5` : 'non notée'}${c.note ? ` (${c.note})` : ''}`));
  return lines;
}

/** Fiche d'observation en aveugle : identité sans donnée chiffrée, grille vierge du rôle, observations déjà saisies */
function blindSheet({ c, record, typeLabel }: Ctx) {
  const p = record.player;
  const role = record.role ?? record.dataSnapshot.bestRoles[0]?.role;
  c.openSection('Identité');
  const chips: string[] = [];
  if (p.position) chips.push(String(record.dataSnapshot.facts.player.position ?? p.position));
  if (p.age !== undefined) chips.push(`${p.age} ans`);
  if (record.dataSnapshot.facts.player.preferredFoot) chips.push(`pied ${String(record.dataSnapshot.facts.player.preferredFoot).toLowerCase()}`);
  if (record.dataSnapshot.facts.player.heightCm !== undefined) chips.push(`${record.dataSnapshot.facts.player.heightCm} cm`);
  drawIdentityBlock(c, { name: p.name, team: p.team, competition: p.competitionName ?? p.competition, season: p.seasonLabel ?? p.season, chips, nationality: record.dataSnapshot.facts.player.nationalityCode ? String(record.dataSnapshot.facts.player.nationalityCode) : undefined });
  c.closeSection();
  c.space(SP.xs);
  drawSectionTitle(c, 'Fiche d\'observation en aveugle', { tag: 'percentiles, indices et valeurs masqués' });
  drawTextBlock(c, `Ce dossier est en évaluation en aveugle : les percentiles, les indices de rôle, les valeurs, la synthèse générée et les priorités restent masqués jusqu'à la première note globale saisie dans une observation. Notez de 1 (très en dessous du niveau attendu) à 5 (très au-dessus)${role ? ` les critères du rôle ${role}` : ''} et les dimensions que les données ne mesurent pas ; l'écart data / observation sera calculé après la saisie.`, { size: FONT.body, color: THEME.ink2 });
  c.space(SP.sm);
  const template = gridTemplate(role ?? '');
  drawBlankGrid(c, `Note globale du scout`, [{ label: 'Niveau général observé pour le rôle visé' }]);
  drawBlankGrid(c, role ? `Critères du rôle · ${role}` : 'Critères du rôle', template.criteria.filter(x => x.kind === 'role_metric').map(x => ({ label: x.label })));
  drawBlankGrid(c, 'Dimensions non mesurées par les données', UNMEASURED_DIMENSIONS.map(d => ({ label: d.label, hint: d.hint })));
  c.space(SP.sm);
  c.openSection('Observations du scout');
  drawSectionTitle(c, 'Observations déjà saisies', { level: 2, tag: 'saisie humaine · ni générée ni complétée par un modèle' });
  const observations = [...record.observations].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (observations.length === 0) drawTextBlock(c, 'Aucune observation saisie pour ce dossier.', { size: FONT.body, color: THEME.ink2 });
  observations.forEach(o => drawObservation(c, { type: typeLabel(o.type), date: fmtDate(o.date), text: o.text, strengths: o.strengths, toReview: o.toReview, conclusion: o.conclusion, grid: o.grid ? gridLines(o.grid, record, true) : undefined }));
  c.closeSection();
}

function page4Scouting({ c, record, summary, typeLabel }: Ctx) {
  const blindHidden = isBlindHidden(record.evaluation);
  c.addPage();
  drawSectionTitle(c, 'Scouting', { tag: 'trois couches : synthèse générée · priorités · observations du scout' });

  // A. Synthèse ScoutVision
  c.openSection('Synthèse ScoutVision');
  drawSectionTitle(c, 'A · Synthèse ScoutVision', { level: 2, tag: summary ? `texte généré · ${summary.model} · prompt ${summary.promptVersion} · ${fmtDate(summary.generatedAt)}` : 'aucune synthèse générée' });
  if (summary) {
    drawTextBlock(c, 'Synthèse rédigée par le modèle à partir des seuls faits du snapshot (grounding ScoutVision). À relire : elle résume les chiffres, elle n\'évalue pas le joueur.', { size: FONT.note, color: THEME.ink3 });
    c.space(1.5);
    drawSummary(c, summary.content, true);
  } else {
    drawTextBlock(c, 'Aucune synthèse ScoutVision dans ce dossier : les données des pages précédentes et les observations ci-dessous constituent le rapport.', { size: FONT.body, color: THEME.ink2 });
    c.space(SP.xs);
  }
  c.closeSection();

  // B. Priorités d'observation
  const priorities = summary ? observationPriorities(summary.content) : [];
  if (priorities.length) {
    c.openSection('Priorités d\'observation');
    c.space(SP.xs);
    drawSectionTitle(c, 'B · Priorités d\'observation', { level: 2, tag: 'issues de la synthèse · à vérifier en vidéo ou en live' });
    priorities.forEach((pr, i) => {
      const lh = lineHeight(FONT.body + 0.5);
      c.font(FONT.body + 0.5);
      const lines = c.wrap(pr, CONTENT_W - 12);
      c.ensureSpace(lines.length * lh + 2);
      c.rect(MARGIN, c.y + 0.6, 6, 6, THEME.fillNavy, undefined, 1);
      c.font(FONT.small, THEME.navy, 'bold'); c.text(String(i + 1), MARGIN + 3, c.y + 4.9, { align: 'center' });
      c.font(FONT.body + 0.5, THEME.ink);
      lines.forEach(l => { c.text(l, MARGIN + 9, c.y + lh * 0.75); c.y += lh; });
      c.y += 1.6;
    });
    c.closeSection();
  }

  // C. Observations du scout
  c.openSection('Observations du scout');
  c.space(SP.xs);
  c.ensureSpace(34);   // le titre reste avec la première carte d'observation
  drawSectionTitle(c, 'C · Observations du scout', { level: 2, tag: 'saisie humaine · ni générée ni complétée par un modèle' });
  const observations = [...record.observations].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (observations.length === 0) drawTextBlock(c, 'Aucune observation saisie pour ce dossier.', { size: FONT.body, color: THEME.ink2 });
  observations.forEach(o => drawObservation(c, { type: typeLabel(o.type), date: fmtDate(o.date), text: o.text, strengths: o.strengths, toReview: o.toReview, conclusion: o.conclusion, grid: o.grid ? gridLines(o.grid, record, blindHidden) : undefined }));
  c.closeSection();

  // D. Conclusion du scout : uniquement les champs saisis par l'observateur, jamais générée
  const withStrengths = observations.filter(o => o.strengths), withReview = observations.filter(o => o.toReview), withConclusion = observations.filter(o => o.conclusion);
  if (withStrengths.length || withReview.length || withConclusion.length) {
    c.openSection('Conclusion du scout');
    c.space(SP.xs);
    drawSectionTitle(c, 'D · Conclusion du scout', { level: 2, tag: 'reprise des champs saisis par le scout' });
    const list = (title: string, items: typeof observations, pick: (o: typeof observations[number]) => string | undefined, bold = false) => {
      if (!items.length) return;
      c.ensureSpace(10);
      c.font(FONT.note, THEME.ink3, 'bold'); c.text(title.toUpperCase(), MARGIN, c.y + 3); c.y += 4.5;
      items.forEach(o => drawTextBlock(c, `${pick(o)}  (${typeLabel(o.type)}, ${fmtDate(o.date)})`, { bullet: '•', indent: 1, size: FONT.body, style: bold ? 'bold' : 'normal' }));
      c.space(2);
    };
    list('Points forts confirmés', withStrengths, o => o.strengths);
    list('Points à surveiller', withReview, o => o.toReview);
    list('Conclusion', withConclusion, o => o.conclusion, true);
    c.closeSection();
  }
}

function annexes({ c, record, summary }: Ctx) {
  const older = record.generatedSummaries.filter(s => s.id !== summary?.id);
  if (!older.length) return;
  c.addPage();
  c.openSection('Annexe · Historique des synthèses');
  drawSectionTitle(c, 'Annexe · Historique des synthèses', { tag: `${older.length} version${older.length > 1 ? 's' : ''} antérieure${older.length > 1 ? 's' : ''}` });
  older.forEach((s, i) => {
    drawSectionTitle(c, `Version ${record.generatedSummaries.indexOf(s) + 1} · ${fmtDate(s.generatedAt)} · ${s.model} · prompt ${s.promptVersion}`, { level: 2 });
    drawSummary(c, s.content, false);
    if (i < older.length - 1) c.space(SP.md);
  });
  c.closeSection();
}

function methodology({ c, record, facts, summary, options, statusLabel }: Ctx) {
  const snap = record.dataSnapshot;
  const dataDate = snap.dataUpdatedAt ?? options.dataGeneratedAt;
  const lines = [
    `Dossier ${statusLabel(record.status).toLowerCase()} créé le ${fmtDate(record.createdAt)}, modifié le ${fmtDate(record.updatedAt)} ; données ScoutVision du ${dataDate ? fmtDate(dataDate) : 'date non renseignée'} figées dans le dossier (snapshot) ; export du ${fmtDate((options.now ?? new Date()).toISOString())}.`,
    `Ligne joueur-saison ${record.player.playerSeasonId} : ${record.player.team}, ${record.player.competitionName ?? record.player.competition}, saison ${record.player.season}. Un joueur a un dossier par club et par compétition.`,
    'Percentiles : rang (0-100) parmi les joueurs du même groupe de poste, du même niveau de compétition et de la même saison ; ils classent un volume, pas une qualité. Métriques « inv. » : moins c\'est mieux.',
    'Indice de rôle ScoutVision : composite pondéré de percentiles (0-100), le même que celui du Chasseur de pépites ; ce n\'est ni un percentile ni une note globale.',
    'RAPM : plus-minus régularisé sur deux saisons (xG par 90, net = offensif + défensif) avec la fiabilité de la ligue ; finition : buts au-delà de l\'xG par 100 tirs, resserrée vers la moyenne ; part des passes : réseau de passes de l\'équipe.',
    `Valeur : valeur de marché Transfermarkt et estimation statistique ScoutVision (erreur typique ${facts.values.estimatedValueTypicalError ?? '×1,7'}) ; une estimation, jamais un prix de transfert.`,
    'Projection statistique ScoutVision : courbes d\'âge du rôle, effet de l\'âge et retour vers la moyenne ; une tendance, pas une prévision de niveau.',
    summary ? `Synthèse : générée par ${summary.model}${summary.requestedModel && summary.requestedModel !== summary.model ? ` (modèle demandé ${summary.requestedModel})` : ''}, prompt ${summary.promptVersion}, le ${fmtDate(summary.generatedAt)} ; ${record.generatedSummaries.length} version${record.generatedSummaries.length > 1 ? 's' : ''} dans le dossier.` : 'Synthèse : aucune version générée dans ce dossier.',
    'Observations du scout : saisies par l\'observateur (vidéo, live, général) ; elles ne sont ni générées ni complétées par un modèle et ne modifient aucun chiffre.',
    'Polices standard du PDF : caractères hors Latin-1 translittérés (ł → l, Đ → D).',
  ];
  if (record.evaluation?.blind) lines.push(isBlindHidden(record.evaluation)
    ? 'Évaluation en aveugle : ce document ne contient aucun percentile, indice, valeur ni synthèse ; ils seront visibles après la première note globale du scout.'
    : `Évaluation en aveugle : données révélées le ${fmtDate(record.evaluation.revealedAt)} ; l'écart data / observation juxtapose la note du scout (1 à 5) et la bande de percentile du snapshot (1 = P0-19 … 5 = P80-100), sans les fusionner.`);
  if (record.tags.length) lines.push(`Tags : ${record.tags.join(', ')}.`);
  c.space(SP.md);
  drawMethodologyNote(c, 'Méthodologie et sources', lines);
}

// ============================================
// DOCUMENT
// ============================================

export interface BuiltPdf { doc: jsPDF; pages: number; summary: GeneratedSummary | undefined; audit: PdfAudit }

/**
 * Document PDF d'un dossier. Renvoie le document, le nombre de pages, la synthèse imprimée et
 * l'audit de mise en page (police minimale, textes hors marges, sections vides) ; `pdfFileName` donne le nom.
 */
export function buildReportPdf(record: ScoutReportRecord, options: PdfOptions = {}): BuiltPdf {
  const now = options.now ?? new Date();
  const mode: PdfMode = options.mode ?? 'synthese';
  const statusLabel = options.statusLabel ?? (s => STATUS_FR[s]);
  const typeLabel = options.typeLabel ?? (t => TYPE_FR[t]);
  const summaries = record.generatedSummaries;
  const summary = (options.summaryId ? summaries.find(s => s.id === options.summaryId) : undefined) ?? summaries[summaries.length - 1];
  const p = record.player;
  const headerInfo = { status: statusLabel(record.status), date: `exporté le ${fmtDate(now.toISOString())}`, player: p.name, season: p.seasonLabel ?? p.season };
  const c = new PdfCanvas((canvas, page) => drawPageHeader(canvas, page, headerInfo));
  const ctx: Ctx = { c, record, facts: record.dataSnapshot.facts, summary, options: { ...options, now }, mode, statusLabel, typeLabel };

  if (isBlindHidden(record.evaluation)) {
    // Dossier en aveugle non révélé : fiche d'observation sans aucune donnée chiffrée, quel que soit le mode
    blindSheet(ctx);
  } else {
    page1Synthesis(ctx);
    page2Impact(ctx);
    page3Metrics(ctx);
    page4Scouting(ctx);
    if (mode === 'complet') annexes(ctx);
  }
  methodology(ctx);

  const total = c.page;
  const footer = { player: p.name, season: p.seasonLabel ?? p.season, status: statusLabel(record.status), reportDate: fmtDate(record.updatedAt) };
  for (let i = 1; i <= total; i++) drawPageFooter(c, i, total, footer);
  return { doc: c.doc, pages: total, summary, audit: c.audit() };
}

// ============================================
// IMAGES (navigateur) ET TÉLÉCHARGEMENT
// ============================================

/** URL d'image servie en même origine via le proxy /cdn (même règle que components/Media) */
const sameOrigin = (url: string) => url.replace(/^https:\/\/cdn\.pitchapi\.dev\//, '/cdn/');

/**
 * Charge une image dans le navigateur et la réduit (JPEG pour une photo, PNG pour un drapeau) ;
 * undefined hors navigateur, à l'échec ou après `timeoutMs`. Ne lève jamais.
 */
export function loadPdfImage(url: string | undefined | null, opts: { maxPx?: number; format?: 'JPEG' | 'PNG'; timeoutMs?: number } = {}): Promise<PdfImage | undefined> {
  if (!url || typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(undefined);
  const { maxPx = 240, format = 'JPEG', timeoutMs = 2500 } = opts;
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.naturalWidth || maxPx) * scale)); canvas.height = Math.max(1, Math.round((img.naturalHeight || maxPx) * scale));
        const g = canvas.getContext('2d');
        if (!g) { resolve(undefined); return; }
        if (format === 'JPEG') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height); }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL(format === 'JPEG' ? 'image/jpeg' : 'image/png', 0.82), format, width: canvas.width, height: canvas.height });
      } catch { resolve(undefined); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(undefined); };
    img.src = sameOrigin(url);
  });
}

/** Télécharge le PDF du dossier (photo et drapeau chargés si possible) ; renvoie le nom, le nombre de pages et l'audit */
export async function downloadReportPdf(record: ScoutReportRecord, options: PdfOptions = {}): Promise<{ fileName: string; pages: number; audit: PdfAudit }> {
  const code = record.dataSnapshot.facts.player.nationalityCode;
  const [photo, flag] = await Promise.all([
    options.photo ?? loadPdfImage(record.player.image, { maxPx: 240, format: 'JPEG' }),
    options.flag ?? loadPdfImage(getFlagUrl(code ? String(code) : undefined), { maxPx: 64, format: 'PNG' }),
  ]);
  const { doc, pages, audit } = buildReportPdf(record, { ...options, photo, flag });
  const fileName = pdfFileName(record, options.now);
  doc.save(fileName);
  return { fileName, pages, audit };
}

/** Texte des pages (flux de contenu), pour les tests : le texte est écrit tel quel par les polices standard */
export function pdfPageTexts(doc: jsPDF): string[] {
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return pages.slice(1).map(p => (Array.isArray(p) ? p.join('\n') : String(p)));
}
