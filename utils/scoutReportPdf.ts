/**
 * ScoutVision - export PDF structuré d'un dossier de scouting (jsPDF, texte natif)
 *
 * Pages : 1 profil (identité, valeurs, rôles, radar vectoriel, principaux percentiles) ;
 * 2 analyse (impact et valeur, projection, tirs, contexte équipe) ; 3+ synthèse ScoutVision,
 * priorités d'observation, observations humaines, historique des versions. Le texte est écrit
 * comme texte (sélectionnable), les graphiques en vecteurs ; rien n'est rasterisé. Les blocs ne
 * sont pas coupés : un titre reste avec ses premières lignes, une ligne de stat ou une
 * observation courte tient sur une page. Pied de page avec métadonnées et « Page X / Y ».
 */

import { jsPDF } from 'jspdf';
import { ScoutReportRecord, GeneratedSummary } from '../types/scoutReport';
import { FactMetric, observationPriorities, orientedPercentile, roleMetrics, strengthsAndLimits, summarySections } from './scoutReportSnapshot';
import { formatEuro } from './format';

// ============================================
// TEXTE : polices standard (WinAnsi) → caractères hors Latin-1 translittérés
// ============================================

const SPECIAL: Record<string, string> = {
  '→': '->', '←': '<-', '−': '-', '–': '-', '—': '-', '’': '\'', '‘': '\'', '“': '"', '”': '"', '…': '...', '≥': '>=', '≤': '<=',
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'þ': 'th', 'ð': 'd', '•': '-', '·': '.',
  '\u202F': ' ', '\u2009': ' ', '\u2007': ' ', '\u2002': ' ', '\u2003': ' ',   // espaces fines (séparateurs de milliers fr-FR)
};

/** Texte imprimable par les polices standard de jsPDF : Latin-1 conservé, le reste translittéré */
export function pdfText(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xA0 && code <= 0xFF && !(ch in SPECIAL)) || ch === '€' || ch === 'œ' || ch === 'Œ') { out += ch; continue; }
    if (ch in SPECIAL) { out += SPECIAL[ch]; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base !== ch && base.codePointAt(0)! < 0x80 ? base : (code >= 0x300 && code <= 0x36f ? '' : '?');
  }
  return out;
}

/** « ScoutVision_<nom>_<saison>_<date>.pdf », accents translittérés, jamais vide */
export function pdfFileName(record: ScoutReportRecord, now = new Date()): string {
  const slug = (s: string) => pdfText(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = slug(record.player.name) || 'joueur';
  const season = slug(record.player.season) || 'saison';
  return `ScoutVision_${name}_${season}_${now.toISOString().slice(0, 10)}.pdf`;
}

// ============================================
// MISE EN PAGE
// ============================================

const PAGE_W = 210, PAGE_H = 297, MARGIN = 15, FOOTER_H = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BOTTOM = PAGE_H - MARGIN - FOOTER_H;
const LINE = 4.6;                      // hauteur d'une ligne de corps (10 pt)
const INK = [20, 28, 38] as const, INK2 = [70, 80, 95] as const, INK3 = [120, 130, 145] as const;
const ACCENT = [0, 150, 170] as const, RULE = [205, 212, 222] as const, FILL = [240, 243, 247] as const;

export interface PdfOptions {
  summaryId?: string;            // version de synthèse à imprimer (la dernière par défaut)
  now?: Date;
  dataGeneratedAt?: string;      // date des données affichée si le snapshot ne l'a pas
  statusLabel?: (s: ScoutReportRecord['status']) => string;
  typeLabel?: (t: ScoutReportRecord['observations'][number]['type']) => string;
}

const STATUS_FR: Record<ScoutReportRecord['status'], string> = { draft: 'Brouillon', to_observe: 'À observer', finalized: 'Finalisé', archived: 'Archivé' };
const TYPE_FR: Record<ScoutReportRecord['observations'][number]['type'], string> = { video: 'Vidéo', live: 'Live', general: 'Général' };

const fmtDate = (iso: string | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
};
const fr = (v: number, digits = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fr(Math.abs(v), digits)}`;

class Writer {
  doc: jsPDF;
  y = MARGIN;
  private readonly footerMeta: string;

  constructor(footerMeta: string) {
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    this.footerMeta = footerMeta;
    this.doc.setLineHeightFactor(1.25);
  }

  get remaining() { return BOTTOM - this.y; }

  /** Nouvelle page si `height` ne tient plus */
  ensure(height: number) { if (this.y + height > BOTTOM) this.newPage(); }

  newPage() { this.doc.addPage(); this.y = MARGIN; }

  text(size: number, color: readonly [number, number, number], style: 'normal' | 'bold' = 'normal') {
    this.doc.setFont('helvetica', style); this.doc.setFontSize(size); this.doc.setTextColor(color[0], color[1], color[2]);
  }

  /** Titre de section, gardé avec au moins deux lignes de corps */
  heading(title: string, level: 1 | 2 = 1) {
    const h = level === 1 ? 9 : 7;
    this.ensure(h + 2 * LINE);
    if (level === 1) {
      this.doc.setDrawColor(...ACCENT); this.doc.setLineWidth(0.6); this.doc.line(MARGIN, this.y + 1.5, MARGIN + 6, this.y + 1.5);
      this.text(11.5, INK, 'bold'); this.doc.text(pdfText(title.toUpperCase()), MARGIN + 9, this.y + 3);
      this.y += h;
    } else {
      this.text(9.5, INK2, 'bold'); this.doc.text(pdfText(title), MARGIN, this.y + 3);
      this.y += h;
    }
  }

  /** Paragraphe à la largeur donnée ; les lignes se paginent, les 2 premières restent ensemble */
  paragraph(textValue: string, opts: { size?: number; color?: readonly [number, number, number]; x?: number; width?: number; style?: 'normal' | 'bold'; indent?: number; bullet?: string } = {}) {
    const size = opts.size ?? 10, x = (opts.x ?? MARGIN) + (opts.indent ?? 0), width = (opts.width ?? CONTENT_W) - (opts.indent ?? 0) - (opts.bullet ? 4 : 0);
    const lineH = LINE * (size / 10);
    this.text(size, opts.color ?? INK, opts.style ?? 'normal');
    const lines: string[] = this.doc.splitTextToSize(pdfText(textValue), width);
    this.ensure(Math.min(lines.length, 2) * lineH);
    lines.forEach((line, i) => {
      if (this.y + lineH > BOTTOM) { this.newPage(); this.text(size, opts.color ?? INK, opts.style ?? 'normal'); }
      if (i === 0 && opts.bullet) this.doc.text(opts.bullet, x, this.y + lineH * 0.78);
      this.doc.text(line, x + (opts.bullet ? 4 : 0), this.y + lineH * 0.78);
      this.y += lineH;
    });
  }

  space(h = 3) { this.y += h; }

  /** Lignes libellé / valeur sur `columns` colonnes ; chaque ligne reste entière */
  keyValues(rows: [string, string][], columns = 3) {
    const colW = CONTENT_W / columns;
    for (let i = 0; i < rows.length; i += columns) {
      this.ensure(10);
      rows.slice(i, i + columns).forEach(([k, v], j) => {
        const x = MARGIN + j * colW;
        this.text(7, INK3, 'bold'); this.doc.text(pdfText(k.toUpperCase()), x, this.y + 3);
        this.text(10.5, INK, 'bold'); this.doc.text(this.doc.splitTextToSize(pdfText(v), colW - 4)[0] ?? '', x, this.y + 8);
      });
      this.y += 11;
    }
  }

  /** Texte tronqué (avec « ... ») pour tenir dans la largeur donnée, avec la police courante */
  fit(text: string, width: number): string {
    if (this.doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t.length > 1 && this.doc.getTextWidth(t + '...') > width) t = t.slice(0, -1);
    return t.trimEnd() + '...';
  }

  /** Ligne de percentile : libellé, valeur, barre, percentile ; jamais coupée */
  percentileRow(m: FactMetric, width = CONTENT_W, x = MARGIN) {
    this.ensure(LINE + 1);
    const barX = x + width * 0.52, barW = width * 0.3, pctX = x + width;
    const value = pdfText(String(m.value).replace('.', ','));
    this.text(9, INK3); const valueW = this.doc.getTextWidth(value); this.doc.text(value, barX - 2, this.y + 3.3, { align: 'right' });
    // Libellé tronqué avec « … » avant la colonne des valeurs : jamais de chevauchement
    this.text(9, INK2); this.doc.text(this.fit(pdfText(m.metric + (m.lessIsPreferable ? ' (inv.)' : '')), barX - 2 - valueW - 2 - x), x, this.y + 3.3);
    this.doc.setFillColor(...FILL); this.doc.rect(barX, this.y + 1.2, barW, 2.2, 'F');
    const o = orientedPercentile(m);
    const col = o >= 75 ? ACCENT : o <= 25 ? ([200, 80, 70] as const) : INK3;
    this.doc.setFillColor(col[0], col[1], col[2]); this.doc.rect(barX, this.y + 1.2, (barW * m.percentile) / 100, 2.2, 'F');
    this.text(9, INK, 'bold'); this.doc.text(`P${m.percentile}`, pctX, this.y + 3.3, { align: 'right' });
    this.y += LINE + 0.6;
  }

  /** Radar vectoriel des percentiles (polygone, grille, libellés) ; la hauteur est réservée d'un bloc */
  radar(metrics: FactMetric[], cx: number, cy: number, r: number) {
    const n = metrics.length;
    if (n < 3) return;
    const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
    this.doc.setDrawColor(...RULE); this.doc.setLineWidth(0.2);
    [0.25, 0.5, 0.75, 1].forEach(k => {
      const pts = metrics.map((_, i) => [cx + r * k * Math.cos(angle(i)), cy + r * k * Math.sin(angle(i))]);
      pts.forEach((p, i) => { const q = pts[(i + 1) % n]; this.doc.line(p[0], p[1], q[0], q[1]); });
    });
    metrics.forEach((_, i) => this.doc.line(cx, cy, cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))));
    const poly = metrics.map((m, i) => [cx + (r * orientedPercentile(m)) / 100 * Math.cos(angle(i)), cy + (r * orientedPercentile(m)) / 100 * Math.sin(angle(i))]);
    this.doc.setDrawColor(...ACCENT); this.doc.setLineWidth(0.5); this.doc.setFillColor(0, 150, 170);
    this.doc.setGState(this.doc.GState({ opacity: 0.18 }));
    this.doc.lines(poly.slice(1).map((p, i) => [p[0] - poly[i][0], p[1] - poly[i][1]]).concat([[poly[0][0] - poly[n - 1][0], poly[0][1] - poly[n - 1][1]]]), poly[0][0], poly[0][1], [1, 1], 'F', true);
    this.doc.setGState(this.doc.GState({ opacity: 1 }));
    this.doc.lines(poly.slice(1).map((p, i) => [p[0] - poly[i][0], p[1] - poly[i][1]]).concat([[poly[0][0] - poly[n - 1][0], poly[0][1] - poly[n - 1][1]]]), poly[0][0], poly[0][1], [1, 1], 'S', true);
    poly.forEach(p => { this.doc.setFillColor(0, 150, 170); this.doc.circle(p[0], p[1], 0.8, 'F'); });
    this.text(7, INK2);
    metrics.forEach((m, i) => {
      const a = angle(i), lx = cx + (r + 4) * Math.cos(a), ly = cy + (r + 4) * Math.sin(a);
      const align = Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center';
      const label = this.doc.splitTextToSize(pdfText(m.metric), 26).slice(0, 2) as string[];
      this.doc.text(label, lx, ly + (Math.sin(a) > 0.3 ? 2.5 : Math.sin(a) < -0.3 ? -0.5 : 1), { align, baseline: 'middle' });
    });
  }

  /** Pied de page sur toutes les pages, avec le total */
  finish(): jsPDF {
    const total = this.doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      this.doc.setPage(p);
      this.doc.setDrawColor(...RULE); this.doc.setLineWidth(0.2); this.doc.line(MARGIN, PAGE_H - MARGIN - 8, PAGE_W - MARGIN, PAGE_H - MARGIN - 8);
      this.text(7.5, INK3); this.doc.text('ScoutVision · Rapport de scouting', MARGIN, PAGE_H - MARGIN - 4);
      this.doc.text(`Page ${p} / ${total}`, PAGE_W - MARGIN, PAGE_H - MARGIN - 4, { align: 'right' });
      this.text(7, INK3); this.doc.text(pdfText(this.footerMeta), PAGE_W / 2, PAGE_H - MARGIN - 0.5, { align: 'center', maxWidth: CONTENT_W - 10 });
    }
    return this.doc;
  }
}

// ============================================
// CONTENU
// ============================================

const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').trim();

function writeMarkdown(w: Writer, content: string, opts: { skipPriorities?: boolean } = {}) {
  const sections = summarySections(content);
  sections.forEach(section => {
    if (opts.skipPriorities && /priorit/i.test(section.title)) return;
    if (section.title) w.heading(stripMd(section.title), 2);
    let blank = false;
    section.lines.forEach(line => {
      const t = line.trim();
      if (!t) { blank = true; return; }
      if (blank) { w.space(1.5); blank = false; }
      const bullet = t.match(/^[-*•]\s+(.*)$/);
      if (bullet) w.paragraph(stripMd(bullet[1]), { bullet: '•', indent: 1 });
      else w.paragraph(stripMd(t));
    });
    w.space(2.5);
  });
}

/**
 * Document PDF d'un dossier. Renvoie le document et le nombre de pages ; `pdfFileName` donne le nom.
 */
export function buildReportPdf(record: ScoutReportRecord, options: PdfOptions = {}): { doc: jsPDF; pages: number; summary: GeneratedSummary | undefined } {
  const now = options.now ?? new Date();
  const statusLabel = options.statusLabel ?? (s => STATUS_FR[s]);
  const typeLabel = options.typeLabel ?? (t => TYPE_FR[t]);
  const summaries = record.generatedSummaries;
  const summary = (options.summaryId ? summaries.find(s => s.id === options.summaryId) : undefined) ?? summaries[summaries.length - 1];
  const snap = record.dataSnapshot;
  const facts = snap.facts;
  const p = record.player;
  const dataDate = snap.dataUpdatedAt ?? options.dataGeneratedAt;
  const footerMeta = [
    `Données : ${dataDate ? fmtDate(dataDate) : 'date non renseignée'}`, `Saison : ${p.season}`,
    `Rapport : ${summary ? fmtDate(summary.generatedAt) : 'sans synthèse IA'}`, `Modèle : ${summary?.model ?? '—'}`, `Version : ${summary?.promptVersion ?? '—'}`,
    `Export : ${fmtDate(now.toISOString())}`,
  ].join('  ·  ');
  const w = new Writer(footerMeta);
  const doc = w.doc;

  // ----- PAGE 1 : PROFIL -----
  w.text(8, ACCENT, 'bold'); doc.text('SCOUTVISION', MARGIN, w.y + 3);
  w.text(16, INK, 'bold'); doc.text('Rapport de scouting', MARGIN, w.y + 10);
  w.text(8, INK3); doc.text(pdfText(`${statusLabel(record.status)} · créé le ${fmtDate(record.createdAt)} · modifié le ${fmtDate(record.updatedAt)}`), PAGE_W - MARGIN, w.y + 10, { align: 'right' });
  w.y += 15;
  doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(MARGIN, w.y, PAGE_W - MARGIN, w.y); w.y += 5;

  w.text(20, INK, 'bold'); doc.text(pdfText(p.name), MARGIN, w.y + 6); w.y += 9;
  w.text(10, INK2); doc.text(pdfText([p.team, p.competitionName ?? p.competition, `saison ${p.seasonLabel ?? p.season}`].join('  ·  ')), MARGIN, w.y + 3); w.y += 7;
  const identity: [string, string][] = [
    ['Poste', String(facts.player.position ?? p.position ?? '—')], ['Âge', p.age !== undefined ? `${p.age} ans` : facts.player.age !== undefined ? `${facts.player.age} ans` : '—'],
    ['Minutes', facts.sample.minutes !== undefined ? `${Number(facts.sample.minutes).toLocaleString('fr-FR')} min` : '—'],
    ['Matchs', facts.sample.matches !== undefined ? `${facts.sample.matches}${facts.sample.starts !== undefined ? ` (${facts.sample.starts} titul.)` : ''}` : '—'],
    ['Pied', String(facts.player.preferredFoot ?? '—')], ['Taille', facts.player.heightCm !== undefined ? `${facts.player.heightCm} cm` : '—'],
  ];
  w.keyValues(identity, 3);
  w.space(2);
  w.keyValues([
    ['Valeur de marché Transfermarkt', facts.values.marketValueTransfermarkt ?? 'N/D'],
    ['Estimation statistique ScoutVision', facts.values.estimatedValueScoutVision ? `${facts.values.estimatedValueScoutVision} (erreur typique ${facts.values.estimatedValueTypicalError ?? '—'})` : 'N/D'],
    ['Contrat', facts.contractUntil ? fmtDate(facts.contractUntil) : 'N/D'],
  ], 3);
  if (snap.seasonInProgress) w.paragraph('Saison en cours au moment du rapport : échantillon partiel, incertitude plus élevée.', { size: 8.5, color: INK3 });
  w.space(3);

  w.heading('Rôles principaux');
  if (snap.bestRoles.length) {
    w.paragraph(snap.bestRoles.map(r => `${r.role} · indice ${r.index}`).join('     '), { size: 10 });
    w.paragraph('Indice du rôle (0-100) : composite pondéré de percentiles, le même que le Chasseur de pépites. Ce n\'est ni un percentile ni une note globale.', { size: 8, color: INK3 });
  } else w.paragraph('Aucun rôle évaluable pour ce poste.', { size: 9, color: INK3 });
  w.space(3);

  const radarMetrics = roleMetrics(facts, record.role ?? snap.bestRoles[0]?.role, 8);
  const { strengths, limits } = strengthsAndLimits(facts);
  w.heading('Profil statistique');
  const hasRadar = radarMetrics.length >= 3;
  const radarH = hasRadar ? 74 : 0;
  w.ensure(radarH + 4);
  const top = w.y;
  if (hasRadar) {
    w.radar(radarMetrics, MARGIN + 44, top + radarH / 2 - 2, 22);
    w.text(7.5, INK3); doc.text(pdfText(`Percentiles du rôle ${record.role ?? snap.bestRoles[0]?.role ?? ''} (sens « plus c'est haut, mieux c'est »)`), MARGIN + 44, top + radarH - 1, { align: 'center', maxWidth: 84 });
  }
  // Sans radar (moins de trois métriques du rôle dans les faits), la colonne des percentiles prend toute la largeur
  const colX = hasRadar ? MARGIN + 92 : MARGIN, colW = hasRadar ? CONTENT_W - 92 : CONTENT_W;
  w.y = top;
  w.text(8, INK3, 'bold'); doc.text('PRINCIPAUX PERCENTILES', colX, w.y + 3); w.y += 6;
  if (radarMetrics.length) radarMetrics.slice(0, 8).forEach(m => w.percentileRow(m, colW, colX));
  else w.paragraph('Aucune métrique de rôle dans les faits du rapport.', { size: 8.5, color: INK3, x: colX, width: colW });
  w.y = Math.max(w.y, top + radarH) + 3;

  w.heading('Forces et limites statistiques', 2);
  const half = CONTENT_W / 2 - 3;
  const startY = w.y;
  w.text(8, ACCENT, 'bold'); doc.text('FORCES', MARGIN, w.y + 3); w.y += 5;
  if (strengths.length) strengths.forEach(m => w.percentileRow(m, half, MARGIN)); else w.paragraph('Aucune métrique au 75e percentile ou plus.', { size: 8.5, color: INK3, width: half });
  const endLeft = w.y;
  w.y = startY;
  w.text(8, [200, 80, 70], 'bold'); doc.text('LIMITES', MARGIN + half + 6, w.y + 3); w.y += 5;
  if (limits.length) limits.forEach(m => w.percentileRow(m, half, MARGIN + half + 6)); else w.paragraph('Aucune métrique au 25e percentile ou moins.', { size: 8.5, color: INK3, x: MARGIN + half + 6, width: half });
  w.y = Math.max(w.y, endLeft);
  w.paragraph('Percentiles du pipeline ScoutVision : rang parmi les joueurs du même groupe de poste, du même niveau de compétition et de la même saison. « inv. » : moins c\'est mieux.', { size: 8, color: INK3 });

  // ----- PAGE 2 : ANALYSE -----
  w.newPage();
  w.heading('Impact et valeur');
  const ind = snap.indicators ?? {};
  const rows: [string, string][] = [];
  if (ind.rapm) rows.push(['Impact sur le terrain (RAPM)', `${signed(ind.rapm.net, 3)} xG/90${ind.rapm.pct !== undefined ? ` · P${ind.rapm.pct} dans la ligue` : ''}`]);
  if (ind.finishing) rows.push(['Talent de finition', `${signed(ind.finishing.skill, 1)} but / 100 tirs vs xG (${ind.finishing.shots} tirs en carrière${ind.finishing.shots < 50 ? ', petit échantillon' : ''})`]);
  if (ind.passShare) rows.push(['Circulation du ballon', `${fr(ind.passShare.value, 1)} % des passes de l'équipe${ind.passShare.pct !== undefined ? ` · P${ind.passShare.pct} pour le rôle` : ''}`]);
  if (ind.valuation?.market || ind.valuation?.estimate) {
    rows.push(['Valeur et performance', ind.valuation.market && ind.valuation.estimate
      ? `estimation ${formatEuro(ind.valuation.estimate)} = ${Math.round((ind.valuation.estimate / ind.valuation.market) * 100)} % de la valeur de marché (${formatEuro(ind.valuation.market)})`
      : ind.valuation.estimate ? `estimation ${formatEuro(ind.valuation.estimate)}` : `valeur de marché ${formatEuro(ind.valuation.market!)}`]);
  }
  if (rows.length) {
    rows.forEach(([k, v]) => { w.ensure(LINE * 2); w.paragraph(k, { size: 8, color: INK3, style: 'bold' }); w.paragraph(v, { size: 10 }); w.space(1.5); });
    if (ind.rapm?.reliability) w.paragraph(`Fiabilité du RAPM dans cette ligue : nette ${fr(ind.rapm.reliability.net, 2)}, défense ${fr(ind.rapm.reliability.def, 2)} (1 = parfaitement fiable).`, { size: 8, color: INK3 });
    w.paragraph('Modèles du pipeline : plus-minus régularisé sur deux saisons, finition au-delà de l\'xG resserrée vers la moyenne, part des passes du réseau d\'équipe, valeur estimée par la performance (une estimation statistique, pas un prix).', { size: 8, color: INK3 });
  } else w.paragraph('Aucun indicateur de modèle disponible pour cette ligne.', { size: 9, color: INK3 });
  w.space(3);

  w.heading('Projection de développement');
  if (snap.projection && snap.projection.length) {
    w.paragraph('Percentile actuel → percentile attendu la saison prochaine (courbes d\'âge du rôle : effet de l\'âge et retour vers la moyenne). Une tendance statistique, pas un verdict sur le joueur.', { size: 8.5, color: INK2 });
    snap.projection.forEach(pr => {
      w.ensure(LINE);
      w.text(9, INK2); doc.text(pdfText(pr.label), MARGIN, w.y + 3.3);
      w.text(9, INK, 'bold'); doc.text(pdfText(`P${pr.current} → P${pr.projected}`), MARGIN + CONTENT_W * 0.55, w.y + 3.3);
      const d = pr.projected - pr.current;
      w.text(9, d > 0 ? ACCENT : d < 0 ? [200, 80, 70] : INK3); doc.text(pdfText(signed(d, 0)), MARGIN + CONTENT_W, w.y + 3.3, { align: 'right' });
      w.y += LINE + 0.4;
    });
  } else w.paragraph('Projection indisponible (courbes d\'âge absentes pour ce rôle ou âge inconnu).', { size: 9, color: INK3 });
  w.space(3);

  if (facts.shots) {
    w.heading('Tirs de la saison');
    w.keyValues([['Tirs', String(facts.shots.shots)], ['Buts', String(facts.shots.goals)], ['xG', fr(facts.shots.xG, 2)], ['Conversion', `${fr(facts.shots.conversionPct, 1)} %`]], 4);
    w.paragraph('Carte des tirs et carte de chaleur : consultables dans la fiche joueur, non reproduites dans ce PDF.', { size: 8, color: INK3 });
    w.space(3);
  }

  w.heading('Contexte d\'équipe');
  const team = facts.teamContext;
  const teamRows: [string, string][] = [];
  if (team.style !== undefined) teamRows.push(['Style de jeu', String(team.style)]);
  if (team.possessionPct !== undefined) teamRows.push(['Possession', `${team.possessionPct} %`]);
  if (team.ppda !== undefined) teamRows.push(['PPDA', String(team.ppda)]);
  if (team.fieldTiltPct !== undefined) teamRows.push(['Domination territoriale', `${team.fieldTiltPct} %`]);
  if (facts.sample.shareOfTeamMinutesPct !== undefined) teamRows.push(['Part des minutes', `${facts.sample.shareOfTeamMinutesPct} %`]);
  if (teamRows.length) w.keyValues(teamRows, 3); else w.paragraph('Contexte d\'équipe non disponible.', { size: 9, color: INK3 });
  w.paragraph('Le contexte décrit l\'équipe, pas le joueur : ses chiffres sont produits dans ce cadre.', { size: 8, color: INK3 });

  // ----- PAGE 3+ : RAPPORT -----
  w.newPage();
  w.heading('Synthèse ScoutVision');
  if (summary) {
    w.paragraph(pdfText(`Rédigée par ${summary.model} le ${fmtDate(summary.generatedAt)} (prompt ${summary.promptVersion}) à partir des seuls faits du snapshot. Une synthèse à relire, pas une évaluation.`), { size: 8.5, color: INK3 });
    w.space(2);
    writeMarkdown(w, summary.content, { skipPriorities: true });
    const priorities = observationPriorities(summary.content);
    w.heading('Priorités d\'observation');
    if (priorities.length) priorities.forEach(pr => w.paragraph(pr, { bullet: '•', indent: 1 }));
    else w.paragraph('La synthèse ne contient pas de section de priorités.', { size: 9, color: INK3 });
  } else {
    w.paragraph('Aucune synthèse IA dans ce dossier : les données ci-dessus et les observations ci-dessous constituent le rapport.', { size: 9.5, color: INK2 });
    w.heading('Priorités d\'observation');
    w.paragraph('À définir à partir des forces et limites statistiques (page 1).', { size: 9, color: INK3 });
  }
  w.space(4);

  w.heading('Observations humaines');
  if (record.observations.length === 0) w.paragraph('Aucune observation saisie.', { size: 9, color: INK3 });
  record.observations.forEach(o => {
    w.ensure(LINE * 4);
    w.paragraph(`${typeLabel(o.type)} · ${fmtDate(o.date)}`, { size: 8.5, color: ACCENT, style: 'bold' });
    w.paragraph(o.text, { size: 10 });
    if (o.strengths) w.paragraph(`Forces observées : ${o.strengths}`, { size: 9.5, color: INK2, indent: 2 });
    if (o.toReview) w.paragraph(`À revoir : ${o.toReview}`, { size: 9.5, color: INK2, indent: 2 });
    if (o.conclusion) w.paragraph(`Conclusion : ${o.conclusion}`, { size: 9.5, color: INK, indent: 2, style: 'bold' });
    w.space(2.5);
  });
  w.paragraph('Observations saisies par l\'observateur. Elles ne sont ni générées ni complétées par un modèle et ne modifient aucun chiffre du dossier.', { size: 8, color: INK3 });

  if (summaries.length > 1) {
    w.space(3);
    w.heading('Historique des versions', 2);
    summaries.forEach((s, i) => w.paragraph(`v${i + 1} · ${fmtDate(s.generatedAt)} · ${s.model} · ${s.promptVersion}${s.id === summary?.id ? ' · version imprimée' : ''}`, { size: 8.5, color: INK2 }));
  }
  if (record.tags.length) { w.space(2); w.paragraph(`Tags : ${record.tags.join(', ')}`, { size: 8.5, color: INK3 }); }

  const finished = w.finish();
  return { doc: finished, pages: finished.getNumberOfPages(), summary };
}

/** Télécharge le PDF du dossier ; renvoie le nom et le nombre de pages */
export function downloadReportPdf(record: ScoutReportRecord, options: PdfOptions = {}): { fileName: string; pages: number } {
  const { doc, pages } = buildReportPdf(record, options);
  const fileName = pdfFileName(record, options.now);
  doc.save(fileName);
  return { fileName, pages };
}

/** Texte des pages (flux de contenu), pour les tests : le texte est écrit tel quel par les polices standard */
export function pdfPageTexts(doc: jsPDF): string[] {
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return pages.slice(1).map(p => (Array.isArray(p) ? p.join('\n') : String(p)));
}
