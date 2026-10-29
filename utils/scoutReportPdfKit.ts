/**
 * ScoutVision - kit de primitives PDF (jsPDF, texte natif, vecteurs)
 *
 * Grille, thème et composants réutilisés par utils/scoutReportPdf.ts pour composer le dossier :
 * en-tête et pied de page, titres, bloc d'identité, tuiles KPI, lignes de métrique avec barre de
 * percentile, badges de rôle, radar vectoriel, blocs de texte paginés, observations, note de
 * méthodologie. Chaque primitive dessine à partir de la position courante (ou d'une position
 * donnée) et renvoie la nouvelle position Y. Le canevas trace aussi ce que les tests vérifient :
 * taille minimale de police utilisée, texte hors marges, sections sans contenu.
 *
 * Polices : Helvetica standard (WinAnsi), donc texte extractible et PDF léger ; les caractères
 * hors Latin-1 sont translittérés (pdfText). Une police Unicode embarquée (Inter, Noto Sans)
 * pèserait 300 à 600 Ko par style sans sous-ensemble : écartée, voir docs/ai-reports.md.
 */

import { jsPDF } from 'jspdf';

// ============================================
// TEXTE : polices standard (WinAnsi) → caractères hors Latin-1 translittérés
// ============================================

// Ponctuation WinAnsi rendue telle quelle par les polices standard (puce, points de suspension, tirets, guillemets, €, œ)
const WINANSI = new Set(['•', '…', '–', '—', '’', '‘', '“', '”', '€', 'œ', 'Œ', '‹', '›', '‚', '„', '†', '‡', '‰', '™', 'Š', 'š', 'Ž', 'ž', 'Ÿ', 'ƒ', 'ˆ', '˜']);
const SPECIAL: Record<string, string> = {
  '→': '->', '←': '<-', '−': '-', '≥': '>=', '≤': '<=', '≈': '~',
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'þ': 'th', 'ð': 'd',
  '\u202F': ' ', '\u2009': ' ', '\u2007': ' ', '\u2002': ' ', '\u2003': ' ', '\u00A0': ' ',   // espaces fines et insécables
};

/** Texte imprimable par les polices standard de jsPDF : Latin-1 et ponctuation WinAnsi conservés, le reste translittéré */
export function pdfText(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (ch in SPECIAL) { out += SPECIAL[ch]; continue; }
    if (code < 0x80 || (code >= 0xA0 && code <= 0xFF) || WINANSI.has(ch)) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base !== ch && base.codePointAt(0)! < 0x80 ? base : (code >= 0x300 && code <= 0x36f ? '' : '?');
  }
  return out;
}

// ============================================
// THÈME ET GRILLE
// ============================================

export type Rgb = readonly [number, number, number];

/** Identité ScoutVision sur fond blanc : navy pour les bandeaux et titres, cyan pour les accents */
export const THEME = {
  navy: [11, 17, 26] as Rgb,          // #0B111A
  cyan: [0, 229, 255] as Rgb,         // #00E5FF : barres, accents (jamais pour du texte sur blanc)
  cyanInk: [0, 122, 140] as Rgb,      // cyan assombri pour un texte lisible sur blanc (contraste ≥ 4,5)
  ink: [17, 24, 39] as Rgb,           // #111827
  ink2: [75, 85, 99] as Rgb,
  ink3: [107, 114, 128] as Rgb,       // notes (contraste 4,6 sur blanc)
  orange: [180, 83, 9] as Rgb,        // projection négative, avertissement
  red: [185, 28, 28] as Rgb,          // limite forte uniquement
  rule: [209, 213, 219] as Rgb,
  fill: [243, 244, 246] as Rgb,
  fillNavy: [232, 236, 242] as Rgb,
  white: [255, 255, 255] as Rgb,
};

export const PAGE_W = 210, PAGE_H = 297;
export const MARGIN = 15;                       // marges latérales et verticales
export const HEADER_H = 14;                     // zone haute réservée (bandeau ou rappel)
export const FOOTER_H = 9;                      // pied de page sur une ligne
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const CONTENT_TOP = MARGIN + HEADER_H;
export const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H;

/** Espacements de la grille (mm) */
export const SP = { xs: 4, sm: 6, md: 8, lg: 12 } as const;

/** Grille conceptuelle à 12 colonnes, gouttière 4 mm */
export const GRID = { cols: 12, gutter: 4 } as const;
const COL_W = (CONTENT_W - (GRID.cols - 1) * GRID.gutter) / GRID.cols;
export const colX = (i: number) => MARGIN + i * (COL_W + GRID.gutter);
export const span = (n: number) => n * COL_W + (n - 1) * GRID.gutter;

/** Tailles de police (pt) ; MIN est la plus petite autorisée sur le document */
export const FONT = { title: 20, name: 18, h2: 11, h3: 9.5, body: 9, small: 8, note: 7.5, kpi: 13 } as const;
export const MIN_FONT = FONT.note;
/** Interligne (mm) pour une taille en points */
export const lineHeight = (size: number) => size * 0.3528 * 1.3;

export const fmtDate = (iso: string | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
};
export const fr = (v: number, digits = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fr(Math.abs(v), digits)}`;

// ============================================
// CANEVAS
// ============================================

export interface PdfImage { dataUrl: string; format: 'JPEG' | 'PNG'; width: number; height: number }

export interface PdfAudit {
  minFont: number;                 // plus petite taille de police effectivement utilisée
  outOfBounds: string[];           // textes dessinés hors des marges (vide attendu)
  emptySections: string[];         // sections ouvertes sans contenu (vide attendu)
  pages: number;
}

export interface FooterInfo { player: string; season: string; status: string; reportDate: string }

export interface TextOpts {
  size?: number; color?: Rgb; style?: 'normal' | 'bold'; x?: number; width?: number;
  align?: 'left' | 'right' | 'center'; indent?: number; bullet?: string; keep?: number;  // keep : lignes gardées avec la première
}

export class PdfCanvas {
  readonly doc: jsPDF;
  y = CONTENT_TOP;
  private minFont = Infinity;
  private outOfBounds: string[] = [];
  private emptySections: string[] = [];
  private sectionStack: { title: string; items: number }[] = [];
  private readonly pageHeader: (c: PdfCanvas, page: number) => void;

  constructor(pageHeader: (c: PdfCanvas, page: number) => void) {
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    this.doc.setLineHeightFactor(1.3);
    this.pageHeader = pageHeader;
    this.pageHeader(this, 1);
  }

  get page() { return this.doc.getNumberOfPages(); }
  get remaining() { return CONTENT_BOTTOM - this.y; }

  // ----- police et texte instrumentés -----

  font(size: number, color: Rgb = THEME.ink, style: 'normal' | 'bold' = 'normal') {
    const s = Math.max(size, MIN_FONT);
    this.minFont = Math.min(this.minFont, s);
    this.doc.setFont('helvetica', style); this.doc.setFontSize(s); this.doc.setTextColor(color[0], color[1], color[2]);
    return s;
  }

  /** Texte brut (une ligne ou un tableau de lignes) avec contrôle des marges ; `zone` autorise l'en-tête ou le pied */
  text(value: string | string[], x: number, y: number, opts: { align?: 'left' | 'right' | 'center'; zone?: 'header' | 'footer'; maxWidth?: number } = {}) {
    const lines = (Array.isArray(value) ? value : [value]).map(pdfText);
    const widest = Math.max(0, ...lines.map(l => this.doc.getTextWidth(l)));
    const left = opts.align === 'right' ? x - widest : opts.align === 'center' ? x - widest / 2 : x;
    const minY = opts.zone === 'header' ? 0 : opts.zone === 'footer' ? CONTENT_BOTTOM : CONTENT_TOP - 1;
    const maxY = opts.zone === 'footer' ? PAGE_H : opts.zone === 'header' ? CONTENT_TOP : CONTENT_BOTTOM + 1;
    const bottom = y + (lines.length - 1) * lineHeight(this.doc.getFontSize());
    if (left < MARGIN - 0.5 || left + widest > PAGE_W - MARGIN + 0.5 || y < minY || bottom > maxY) {
      this.outOfBounds.push(`p${this.page} « ${lines[0].slice(0, 30)} » x=${left.toFixed(1)} w=${widest.toFixed(1)} y=${y.toFixed(1)}`);
    }
    this.doc.text(lines, x, y, { align: opts.align, maxWidth: opts.maxWidth });
    this.count();
  }

  wrap(value: string, width: number): string[] { return this.doc.splitTextToSize(pdfText(value), width) as string[]; }

  /** Texte tronqué (« ... ») pour tenir dans la largeur donnée, avec la police courante */
  fit(value: string, width: number): string {
    const t0 = pdfText(value);
    if (this.doc.getTextWidth(t0) <= width) return t0;
    let t = t0;
    while (t.length > 1 && this.doc.getTextWidth(t + '...') > width) t = t.slice(0, -1);
    return t.trimEnd() + '...';
  }

  // ----- pagination -----

  ensureSpace(height: number): boolean {
    if (this.y + height > CONTENT_BOTTOM) { this.addPage(); return true; }
    return false;
  }

  addPage() {
    this.doc.addPage();
    this.y = CONTENT_TOP;
    this.pageHeader(this, this.page);
  }

  space(h: number) { this.y = Math.min(this.y + h, CONTENT_BOTTOM); }

  // ----- sections (suivi des sections vides) -----

  openSection(title: string) { this.sectionStack.push({ title, items: 0 }); }
  closeSection() {
    const s = this.sectionStack.pop();
    if (s && s.items === 0) this.emptySections.push(s.title);
    else if (s && this.sectionStack.length) this.sectionStack[this.sectionStack.length - 1].items += s.items;
  }
  private count() { const s = this.sectionStack[this.sectionStack.length - 1]; if (s) s.items++; }

  // ----- formes -----

  rect(x: number, y: number, w: number, h: number, fill: Rgb, stroke?: Rgb, radius = 0) {
    this.doc.setFillColor(fill[0], fill[1], fill[2]);
    if (stroke) { this.doc.setDrawColor(stroke[0], stroke[1], stroke[2]); this.doc.setLineWidth(0.25); }
    if (radius > 0) this.doc.roundedRect(x, y, w, h, radius, radius, stroke ? 'FD' : 'F');
    else this.doc.rect(x, y, w, h, stroke ? 'FD' : 'F');
  }

  rule(y: number, x = MARGIN, w = CONTENT_W, color: Rgb = THEME.rule, width = 0.25) {
    this.doc.setDrawColor(color[0], color[1], color[2]); this.doc.setLineWidth(width); this.doc.line(x, y, x + w, y);
  }

  audit(): PdfAudit {
    return { minFont: this.minFont === Infinity ? MIN_FONT : this.minFont, outOfBounds: [...this.outOfBounds], emptySections: [...this.emptySections], pages: this.page };
  }
}

// ============================================
// PRIMITIVES DE PAGE
// ============================================

/** En-tête : bandeau navy sur la première page, rappel discret ensuite */
export function drawPageHeader(c: PdfCanvas, page: number, info: { status: string; date: string; player: string; season: string }) {
  if (page === 1) {
    c.rect(MARGIN, MARGIN, CONTENT_W, HEADER_H - 3, THEME.navy, undefined, 1.2);
    c.font(8, THEME.cyan, 'bold'); c.text('SCOUTVISION', MARGIN + 5, MARGIN + 4.6, { zone: 'header' });
    c.font(12, THEME.white, 'bold'); c.text('Rapport de scouting', MARGIN + 5, MARGIN + 9.2, { zone: 'header' });
    c.font(8, THEME.white); c.text(`${info.status}  ·  ${info.date}`, PAGE_W - MARGIN - 5, MARGIN + 7.4, { align: 'right', zone: 'header' });
  } else {
    c.font(7.5, THEME.cyanInk, 'bold'); c.text('SCOUTVISION', MARGIN, MARGIN + 5, { zone: 'header' });
    c.font(7.5, THEME.ink3); c.text('Rapport de scouting', MARGIN + 22, MARGIN + 5, { zone: 'header' });
    c.font(7.5, THEME.ink2, 'bold'); c.text(c.fit(`${info.player}  ·  ${info.season}`, CONTENT_W / 2), PAGE_W - MARGIN, MARGIN + 5, { align: 'right', zone: 'header' });
    c.rule(MARGIN + 7.5, MARGIN, CONTENT_W, THEME.rule, 0.3);
  }
}

/** Pied de page sur une ligne : mention, joueur · saison · statut · date, numéro de page */
export function drawPageFooter(c: PdfCanvas, page: number, total: number, info: FooterInfo) {
  c.doc.setPage(page);
  const y = PAGE_H - MARGIN - 3;
  c.rule(y - 4, MARGIN, CONTENT_W, THEME.rule, 0.3);
  c.font(FONT.note, THEME.ink3); c.text('ScoutVision · Rapport de scouting', MARGIN, y, { zone: 'footer' });
  c.font(FONT.note, THEME.ink2); c.text(c.fit(`${info.player}  ·  ${info.season}  ·  ${info.status}  ·  rapport du ${info.reportDate}`, CONTENT_W - 92), PAGE_W / 2, y, { align: 'center', zone: 'footer' });
  c.font(FONT.note, THEME.ink3); c.text(`Page ${page} / ${total}`, PAGE_W - MARGIN, y, { align: 'right', zone: 'footer' });
}

/** Titre de chapitre (niveau 1, navy, barre cyan) ou de sous-section (niveau 2) ; gardé avec deux lignes de corps */
export function drawSectionTitle(c: PdfCanvas, title: string, opts: { level?: 1 | 2; tag?: string; x?: number; width?: number } = {}): number {
  const level = opts.level ?? 1, x = opts.x ?? MARGIN, width = opts.width ?? CONTENT_W;
  const h = level === 1 ? 9 : 6.5;
  c.ensureSpace(h + 2 * lineHeight(FONT.body));
  if (level === 1) {
    c.rect(x, c.y + 0.5, 1.6, 6, THEME.cyan);
    c.font(FONT.h2, THEME.navy, 'bold'); c.text(title.toUpperCase(), x + 4.5, c.y + 5);
    if (opts.tag) {
      c.font(FONT.note, THEME.ink3);
      const tw = c.doc.getTextWidth(pdfText(opts.tag)) + 4;
      c.rect(x + width - tw, c.y + 1.2, tw, 4.4, THEME.fill, undefined, 1);
      c.text(opts.tag, x + width - tw + 2, c.y + 4.3);
    }
    c.rule(c.y + 8, x, width, THEME.rule, 0.3);
  } else {
    c.font(FONT.h3, THEME.ink, 'bold'); c.text(title, x, c.y + 4);
    if (opts.tag) { c.font(FONT.note, THEME.ink3); c.text(opts.tag, x + width, c.y + 4, { align: 'right' }); }
  }
  c.y += h;
  return c.y;
}

/** Bloc de texte paginé : paragraphes, puces, retrait ; les `keep` premières lignes restent ensemble */
export function drawTextBlock(c: PdfCanvas, value: string, opts: TextOpts = {}): number {
  const size = opts.size ?? FONT.body, x = (opts.x ?? MARGIN) + (opts.indent ?? 0);
  const width = (opts.width ?? CONTENT_W) - (opts.indent ?? 0) - (opts.bullet ? 4 : 0);
  const lh = lineHeight(size);
  c.font(size, opts.color ?? THEME.ink, opts.style ?? 'normal');
  const lines = c.wrap(value, width);
  const keep = Math.min(lines.length, opts.keep ?? 2);
  c.ensureSpace(lh * keep);
  lines.forEach((line, i) => {
    if (c.y + lh > CONTENT_BOTTOM) { c.addPage(); c.font(size, opts.color ?? THEME.ink, opts.style ?? 'normal'); }
    if (i === 0 && opts.bullet) { c.font(size, THEME.cyanInk, 'bold'); c.text(opts.bullet, x, c.y + lh * 0.75); c.font(size, opts.color ?? THEME.ink, opts.style ?? 'normal'); }
    c.text(line, x + (opts.bullet ? 4 : 0), c.y + lh * 0.75, { align: opts.align });
    c.y += lh;
  });
  return c.y;
}

/** Tuile KPI : libellé, valeur, sous-texte ; hauteur fixe pour aligner une rangée */
export const KPI_H = 23;
export function drawKpi(c: PdfCanvas, x: number, y: number, w: number, kpi: { label: string; value: string; sub?: string; tone?: Rgb }, h = KPI_H): number {
  const inner = w - 6.5;
  c.rect(x, y, w, h, THEME.fill, undefined, 1);
  c.rect(x, y, 1, h, kpi.tone ?? THEME.cyan);
  // Libellé sur deux lignes au plus ; valeur réduite jusqu'à 9 pt, puis sur deux lignes, puis tronquée
  c.font(FONT.note, THEME.ink3, 'bold');
  const label = c.wrap(kpi.label.toUpperCase(), inner).slice(0, 2);
  label.forEach((l, i) => c.text(l, x + 3.5, y + 3.8 + i * 3));
  let size = FONT.kpi;
  c.font(size, THEME.ink, 'bold');
  while (size > 9 && c.doc.getTextWidth(pdfText(kpi.value)) > inner) { size -= 0.5; c.font(size, THEME.ink, 'bold'); }
  const valueLines = c.doc.getTextWidth(pdfText(kpi.value)) > inner ? c.wrap(kpi.value, inner).slice(0, 2) : [pdfText(kpi.value)];
  valueLines.forEach((l, i) => c.text(i === valueLines.length - 1 ? c.fit(l, inner) : l, x + 3.5, y + 12 + i * lineHeight(size)));
  if (kpi.sub) { c.font(FONT.note, THEME.ink2); c.text(c.fit(kpi.sub, inner), x + 3.5, y + h - 2.6); }
  return y + h;
}

/** Rangée de tuiles KPI sur la grille (12 colonnes réparties) */
export function drawKpiRow(c: PdfCanvas, kpis: { label: string; value: string; sub?: string; tone?: Rgb }[], h = KPI_H): number {
  if (!kpis.length) return c.y;
  c.ensureSpace(h + 2);
  const n = kpis.length, gap = GRID.gutter, w = (CONTENT_W - (n - 1) * gap) / n;
  kpis.forEach((k, i) => drawKpi(c, MARGIN + i * (w + gap), c.y, w, k, h));
  c.y += h + 2;
  return c.y;
}

/** Barre de percentile (0-100) ; teinte selon le sens de lecture */
export function drawPercentileBar(c: PdfCanvas, x: number, y: number, w: number, pct: number, oriented: number) {
  const col = oriented >= 75 ? THEME.cyanInk : oriented <= 25 ? THEME.red : THEME.ink3;
  c.rect(x, y, w, 2.2, THEME.fill, undefined, 0.6);
  c.rect(x, y, Math.max(0.6, (w * Math.max(0, Math.min(100, pct))) / 100), 2.2, col, undefined, 0.6);
  c.doc.setDrawColor(THEME.rule[0], THEME.rule[1], THEME.rule[2]); c.doc.setLineWidth(0.2); c.doc.line(x + w / 2, y - 0.4, x + w / 2, y + 2.6);
}

export interface MetricRowData { label: string; value: string; percentile: number; oriented: number; note?: string }

/** Ligne de métrique : libellé, valeur brute, barre, Pxx ; jamais coupée entre deux pages */
export function drawMetricRow(c: PdfCanvas, x: number, y: number, w: number, m: MetricRowData, size = FONT.body): number {
  const lh = lineHeight(size) + 1.4;
  const pctX = x + w, barW = Math.min(34, w * 0.3), barX = pctX - 10 - barW;
  c.font(size, THEME.ink, 'bold'); const pctText = `P${m.percentile}`; c.text(pctText, pctX, y + lh * 0.7, { align: 'right' });
  drawPercentileBar(c, barX, y + lh * 0.7 - 2.2, barW, m.percentile, m.oriented);
  c.font(size, THEME.ink2); const vw = c.doc.getTextWidth(pdfText(m.value)); c.text(m.value, barX - 3, y + lh * 0.7, { align: 'right' });
  c.font(size, THEME.ink); c.text(c.fit(m.label + (m.note ? ` ${m.note}` : ''), barX - 3 - vw - 3 - x), x, y + lh * 0.7);
  return y + lh;
}

/** Largeur d'un badge de rôle, pour décider s'il tient sur la ligne */
export function roleBadgeWidth(c: PdfCanvas, role: { role: string; index: number }, primary = false): number {
  c.font(primary ? FONT.body : FONT.small, THEME.ink, 'bold');
  return c.doc.getTextWidth(pdfText(role.role)) + c.doc.getTextWidth(` ${role.index}`) + 8;
}

/** Badge de rôle : nom et indice ; le rôle principal est en navy */
export function drawRoleBadge(c: PdfCanvas, x: number, y: number, role: { role: string; index: number }, primary = false): number {
  const w = roleBadgeWidth(c, role, primary);
  c.font(primary ? FONT.body : FONT.small, primary ? THEME.white : THEME.ink, 'bold');
  const label = pdfText(role.role);
  c.rect(x, y, w, primary ? 7.2 : 6.2, primary ? THEME.navy : THEME.fillNavy, undefined, 1.2);
  c.text(label, x + 3, y + (primary ? 4.9 : 4.3));
  c.font(primary ? FONT.body : FONT.small, primary ? THEME.cyan : THEME.cyanInk, 'bold');
  c.text(String(role.index), x + w - 3, y + (primary ? 4.9 : 4.3), { align: 'right' });
  return w;
}

export interface RadarAxis { label: string; value: number }

/** Radar vectoriel : polygone, grille à 4 niveaux, libellés sur deux lignes à l'extérieur. `size` = largeur totale (mm) */
export function drawRadar(c: PdfCanvas, x: number, y: number, size: number, axes: RadarAxis[], labelSize = FONT.small): number {
  const n = axes.length;
  const labelW = 24;
  const r = Math.max(14, size / 2 - labelW - 2);
  // Hauteur du bloc : rayon, écart et deux lignes de libellé plus le percentile, en haut et en bas
  const height = 2 * (r + 3.5 + 2 * lineHeight(labelSize) + lineHeight(FONT.note)) + 2;
  const cx = x + size / 2, cy = y + height / 2;
  if (n < 3) return y;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const doc = c.doc;
  doc.setDrawColor(THEME.rule[0], THEME.rule[1], THEME.rule[2]); doc.setLineWidth(0.2);
  [0.25, 0.5, 0.75, 1].forEach(k => {
    const pts = axes.map((_, i) => [cx + r * k * Math.cos(angle(i)), cy + r * k * Math.sin(angle(i))]);
    pts.forEach((p, i) => { const q = pts[(i + 1) % n]; doc.line(p[0], p[1], q[0], q[1]); });
  });
  axes.forEach((_, i) => doc.line(cx, cy, cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))));
  const poly = axes.map((a, i) => [cx + (r * Math.max(0, Math.min(100, a.value))) / 100 * Math.cos(angle(i)), cy + (r * Math.max(0, Math.min(100, a.value))) / 100 * Math.sin(angle(i))]);
  const rel = poly.slice(1).map((p, i) => [p[0] - poly[i][0], p[1] - poly[i][1]]).concat([[poly[0][0] - poly[n - 1][0], poly[0][1] - poly[n - 1][1]]]);
  doc.setFillColor(THEME.cyan[0], THEME.cyan[1], THEME.cyan[2]); doc.setGState(doc.GState({ opacity: 0.22 }));
  doc.lines(rel, poly[0][0], poly[0][1], [1, 1], 'F', true);
  doc.setGState(doc.GState({ opacity: 1 }));
  doc.setDrawColor(THEME.cyanInk[0], THEME.cyanInk[1], THEME.cyanInk[2]); doc.setLineWidth(0.6);
  doc.lines(rel, poly[0][0], poly[0][1], [1, 1], 'S', true);
  doc.setFillColor(THEME.cyanInk[0], THEME.cyanInk[1], THEME.cyanInk[2]);
  poly.forEach(p => doc.circle(p[0], p[1], 0.9, 'F'));
  // Libellés : à l'extérieur, alignés selon le quadrant, deux lignes au plus, avec le percentile
  c.font(labelSize, THEME.ink2);
  axes.forEach((a, i) => {
    const ang = angle(i), cos = Math.cos(ang), sin = Math.sin(ang);
    const lx = cx + (r + 3.5) * cos, ly = cy + (r + 3.5) * sin;
    const align = cos > 0.3 ? 'left' : cos < -0.3 ? 'right' : 'center';
    const lines = c.wrap(a.label, labelW).slice(0, 2);
    const lh = lineHeight(labelSize);
    const block = lines.length * lh;
    const top = sin < -0.3 ? ly - block + lh * 0.8 : sin > 0.3 ? ly + lh * 0.8 : ly - block / 2 + lh * 0.8;
    c.font(labelSize, THEME.ink2);
    lines.forEach((line, k) => c.text(line, lx, top + k * lh, { align }));
    c.font(FONT.note, THEME.cyanInk, 'bold');
    c.text(`P${a.value}`, lx, top + lines.length * lh, { align });
  });
  return y + height;
}

/** Bloc d'identité : photo (ou initiales), nom, club · compétition · saison, puces d'identité */
export function drawIdentityBlock(c: PdfCanvas, id: {
  name: string; team: string; competition: string; season: string; chips: string[]; photo?: PdfImage; flag?: PdfImage; nationality?: string;
}): number {
  const photoW = 24, top = c.y;
  const textX = MARGIN + photoW + SP.sm;
  const textW = CONTENT_W - photoW - SP.sm;
  if (id.photo) {
    const ratio = id.photo.height / id.photo.width;
    c.rect(MARGIN, top, photoW, photoW, THEME.fill, THEME.rule, 1.5);
    c.doc.addImage(id.photo.dataUrl, id.photo.format, MARGIN + 0.5, top + 0.5, photoW - 1, (photoW - 1) * Math.min(1, ratio), undefined, 'FAST');
  } else {
    c.rect(MARGIN, top, photoW, photoW, THEME.fillNavy, THEME.rule, 1.5);
    const initials = id.name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]!.toUpperCase()).join('');
    c.font(14, THEME.navy, 'bold'); c.text(initials || '?', MARGIN + photoW / 2, top + photoW / 2 + 2, { align: 'center' });
  }
  c.font(FONT.name, THEME.ink, 'bold');
  const nameLines = c.wrap(id.name, textW).slice(0, 2);
  nameLines.forEach((l, i) => c.text(l, textX, top + 6.5 + i * lineHeight(FONT.name)));
  let y = top + 6.5 + (nameLines.length - 1) * lineHeight(FONT.name) + 6;
  c.font(FONT.body + 1, THEME.ink2);
  c.text(c.fit([id.team, id.competition, `saison ${id.season}`].filter(Boolean).join('  ·  '), textW), textX, y);
  y += 6.5;
  // Puces : poste, âge, pied, taille, nationalité
  let x = textX;
  const chips = [...id.chips];
  if (id.flag) {
    const fh = 4.2, fw = fh * (id.flag.width / id.flag.height);
    c.doc.addImage(id.flag.dataUrl, id.flag.format, x, y - 3.4, fw, fh, undefined, 'FAST');
    x += fw + 1.5;
    if (id.nationality) chips.unshift(id.nationality);
  } else if (id.nationality) chips.unshift(id.nationality);
  c.font(FONT.small, THEME.ink2);
  chips.forEach(chip => {
    const t = pdfText(chip); const w = c.doc.getTextWidth(t) + 4;
    if (x + w > MARGIN + CONTENT_W) { x = textX; y += 6; }
    c.rect(x, y - 3.6, w, 5, THEME.fill, undefined, 1);
    c.text(t, x + 2, y);
    x += w + 2;
  });
  c.y = Math.max(y + 3, top + photoW + 1);
  return c.y;
}

/** Encadré : titre, paires libellé / valeur (deux par ligne au besoin) ou lignes de texte */
export function drawCallout(c: PdfCanvas, x: number, y: number, w: number, title: string, rows: { label: string; value: string; sub?: string }[], tone: Rgb = THEME.navy): number {
  const lh = lineHeight(FONT.body);
  const h = 8 + rows.reduce((s, r) => s + lh + 3.2 + (r.sub ? lineHeight(FONT.note) : 0), 0) + 1;
  c.rect(x, y, w, h, THEME.white, THEME.rule, 1.2);
  c.rect(x, y, w, 1.2, tone);
  c.font(FONT.note, THEME.ink3, 'bold'); c.text(title.toUpperCase(), x + 3.5, y + 5.4);
  let yy = y + 8;
  rows.forEach(r => {
    c.font(FONT.note, THEME.ink3); c.text(c.fit(r.label, w - 7), x + 3.5, yy + 2.6);
    yy += 3.2;
    c.font(FONT.body + 1.5, THEME.ink, 'bold'); c.text(c.fit(r.value, w - 7), x + 3.5, yy + lh * 0.75);
    yy += lh;
    if (r.sub) { c.font(FONT.note, THEME.ink2); c.text(c.fit(r.sub, w - 7), x + 3.5, yy + 1.8); yy += lineHeight(FONT.note); }
  });
  return y + h;
}

/** Indicateur de modèle : valeur principale, interprétation, contexte, limite (page Impact) */
export function drawIndicator(c: PdfCanvas, x: number, w: number, ind: { title: string; value: string; interpretation?: string; context?: string; limit?: string; tone?: Rgb }): number {
  const lines = [ind.interpretation, ind.context].filter((s): s is string => !!s).flatMap(s => c.wrap(s, w - 4));
  c.font(FONT.note);
  const limitLines = ind.limit ? c.wrap(`Limite : ${ind.limit}`, w - 4) : [];
  const h = 4 + 4 + 7 + lines.length * lineHeight(FONT.small) + (limitLines.length ? limitLines.length * lineHeight(FONT.note) + 1 : 0) + 2;
  c.ensureSpace(h);
  const top = c.y;
  c.rect(x, top, 1, h - 2, ind.tone ?? THEME.cyan);
  c.font(FONT.note, THEME.ink3, 'bold'); c.text(ind.title.toUpperCase(), x + 4, top + 3.6);
  c.font(FONT.kpi, THEME.ink, 'bold'); c.text(c.fit(ind.value, w - 4), x + 4, top + 9.4);
  let yy = top + 12.5;
  c.font(FONT.small, THEME.ink2);
  lines.forEach(l => { c.text(l, x + 4, yy + lineHeight(FONT.small) * 0.75); yy += lineHeight(FONT.small); });
  if (limitLines.length) {
    yy += 0.8;
    c.font(FONT.note, THEME.orange);
    limitLines.forEach(l => { c.text(l, x + 4, yy + lineHeight(FONT.note) * 0.75); yy += lineHeight(FONT.note); });
  }
  c.y = top + h;
  return c.y;
}

/** Observation du scout : carte à bord navy, type et date, texte, forces / à revoir / conclusion */
export function drawObservation(c: PdfCanvas, obs: { type: string; date: string; text: string; strengths?: string; toReview?: string; conclusion?: string }): number {
  const w = CONTENT_W, inner = w - 8;
  c.font(FONT.body);
  const body = c.wrap(obs.text, inner);
  const extras: { label: string; lines: string[]; color: Rgb; style: 'normal' | 'bold' }[] = [];
  const push = (label: string, v: string | undefined, color: Rgb, style: 'normal' | 'bold' = 'normal') => { if (v) { c.font(FONT.small, color, style); extras.push({ label, lines: c.wrap(v, inner - 26), color, style }); } };
  push('Forces', obs.strengths, THEME.ink2);
  push('À revoir', obs.toReview, THEME.ink2);
  push('Conclusion', obs.conclusion, THEME.ink, 'bold');
  const lh = lineHeight(FONT.body), lhs = lineHeight(FONT.small);
  const h = 8 + body.length * lh + extras.reduce((s, e) => s + e.lines.length * lhs + 1, 0) + 3;
  // Carte entière si elle tient dans une page, sinon le texte se pagine ligne à ligne
  if (h <= CONTENT_BOTTOM - CONTENT_TOP) c.ensureSpace(h); else c.ensureSpace(8 + 2 * lh);
  const top = c.y;
  const cardH = Math.min(h, CONTENT_BOTTOM - top);
  c.rect(MARGIN, top, w, cardH, THEME.white, THEME.rule, 1.2);
  c.rect(MARGIN, top, 1.4, cardH, THEME.navy);
  c.font(FONT.note, THEME.navy, 'bold'); c.text('OBSERVATION DU SCOUT', MARGIN + 5, top + 4.4);
  c.font(FONT.note, THEME.ink3); c.text(`${obs.type}  ·  ${obs.date}`, MARGIN + w - 3, top + 4.4, { align: 'right' });
  c.y = top + 7.5;
  c.font(FONT.body, THEME.ink);
  body.forEach(line => {
    if (c.y + lh > CONTENT_BOTTOM) { c.addPage(); c.rect(MARGIN, c.y, 1.4, 1, THEME.navy); c.font(FONT.body, THEME.ink); }
    c.text(line, MARGIN + 5, c.y + lh * 0.75); c.y += lh;
  });
  extras.forEach(e => {
    c.y += 1;
    e.lines.forEach((line, i) => {
      if (c.y + lhs > CONTENT_BOTTOM) { c.addPage(); }
      if (i === 0) { c.font(FONT.note, THEME.ink3, 'bold'); c.text(e.label.toUpperCase(), MARGIN + 5, c.y + lhs * 0.75); }
      c.font(FONT.small, e.color, e.style); c.text(line, MARGIN + 5 + 24, c.y + lhs * 0.75); c.y += lhs;
    });
  });
  c.y = Math.max(c.y + 3, top + cardH) + SP.xs;
  return c.y;
}

/** Note de méthodologie (dernière page) : encadré gris, lignes courtes */
export function drawMethodologyNote(c: PdfCanvas, title: string, lines: string[]): number {
  c.font(FONT.note);
  const wrapped = lines.flatMap(l => c.wrap(`•  ${l}`, CONTENT_W - 8));
  const lh = lineHeight(FONT.note);
  const h = 8 + wrapped.length * lh + 3;
  // Encadré entier sur une page (nouvelle page s'il ne tient plus), scindé seulement s'il dépasse une page
  c.ensureSpace(Math.min(h, CONTENT_BOTTOM - CONTENT_TOP));
  const top = c.y;
  const fits = top + h <= CONTENT_BOTTOM;
  c.rect(MARGIN, top, CONTENT_W, fits ? h : CONTENT_BOTTOM - top, THEME.fill, undefined, 1.2);
  c.font(FONT.small, THEME.navy, 'bold'); c.text(title.toUpperCase(), MARGIN + 4, top + 5.2);
  c.y = top + 8;
  c.font(FONT.note, THEME.ink2);
  wrapped.forEach(line => {
    if (c.y + lh > CONTENT_BOTTOM) { c.addPage(); c.rect(MARGIN, c.y, CONTENT_W, 1, THEME.fill); c.font(FONT.note, THEME.ink2); }
    c.text(line, MARGIN + 4, c.y + lh * 0.75); c.y += lh;
  });
  c.y += 4;
  return c.y;
}
