/**
 * ScoutVision AI - Drapeaux
 * PitchAPI code les pays en FIFA (ALG, GER, KVX...) ; flagcdn attend l'ISO 3166-1 alpha-2
 * ou une subdivision (gb-eng pour l'Angleterre).
 */

const FIFA_TO_ISO: Record<string, string> = {
  AFG: 'af', ALB: 'al', ALG: 'dz', AND: 'ad', ANG: 'ao', ARG: 'ar', ARM: 'am', ARU: 'aw',
  ATG: 'ag', AUS: 'au', AUT: 'at', AZE: 'az', BAH: 'bs', BAN: 'bd', BDI: 'bi', BEL: 'be',
  BEN: 'bj', BER: 'bm', BFA: 'bf', BHR: 'bh', BIH: 'ba', BLR: 'by', BOL: 'bo', BOT: 'bw',
  BRA: 'br', BRB: 'bb', BUL: 'bg', CAM: 'kh', CAN: 'ca', CAY: 'ky', CGO: 'cg', CHA: 'td',
  CHI: 'cl', CHN: 'cn', CIV: 'ci', CMR: 'cm', COD: 'cd', COL: 'co', COM: 'km', CPV: 'cv',
  CRC: 'cr', CRO: 'hr', CTA: 'cf', CUB: 'cu', CUW: 'cw', CYP: 'cy', CZE: 'cz', DEN: 'dk',
  DJI: 'dj', DMA: 'dm', DOM: 'do', ECU: 'ec', EGY: 'eg', ENG: 'gb-eng', EQG: 'gq', ERI: 'er',
  ESP: 'es', EST: 'ee', ETH: 'et', FGU: 'gf', FIJ: 'fj', FIN: 'fi', FRA: 'fr', FRO: 'fo',
  GAB: 'ga', GAM: 'gm', GEO: 'ge', GER: 'de', GHA: 'gh', GIB: 'gi', GLP: 'gp', GNB: 'gw',
  GRE: 'gr', GRL: 'gl', GRN: 'gd', GUA: 'gt', GUI: 'gn', GUY: 'gy', HAI: 'ht', HKG: 'hk',
  HON: 'hn', HUN: 'hu', IDN: 'id', IND: 'in', IRL: 'ie', IRN: 'ir', IRQ: 'iq', ISL: 'is',
  ISR: 'il', ITA: 'it', JAM: 'jm', JOR: 'jo', JPN: 'jp', KAZ: 'kz', KEN: 'ke', KGZ: 'kg',
  KOR: 'kr', KSA: 'sa', KUW: 'kw', KVX: 'xk', LBR: 'lr', LBY: 'ly', LCA: 'lc', LES: 'ls',
  LIB: 'lb', LIE: 'li', LTU: 'lt', LUX: 'lu', LVA: 'lv', MAD: 'mg', MAR: 'ma', MAS: 'my',
  MDA: 'md', MEX: 'mx', MKD: 'mk', MLI: 'ml', MLT: 'mt', MNE: 'me', MOZ: 'mz', MRI: 'mu',
  MTN: 'mr', MTQ: 'mq', MWI: 'mw', NAM: 'na', NCA: 'ni', NCL: 'nc', NED: 'nl', NGA: 'ng',
  NIG: 'ne', NIR: 'gb-nir', NOR: 'no', NZL: 'nz', OMA: 'om', PAK: 'pk', PAN: 'pa', PAR: 'py',
  PER: 'pe', PHI: 'ph', PLE: 'ps', PNG: 'pg', POL: 'pl', POR: 'pt', PRK: 'kp', PUR: 'pr',
  QAT: 'qa', ROU: 'ro', RSA: 'za', RUS: 'ru', RWA: 'rw', SCO: 'gb-sct', SEN: 'sn', SEY: 'sc',
  SIN: 'sg', SKN: 'kn', SLE: 'sl', SLV: 'sv', SMA: 'mf', SMR: 'sm', SOM: 'so', SRB: 'rs',
  SSD: 'ss', STP: 'st', SUD: 'sd', SUI: 'ch', SUR: 'sr', SVK: 'sk', SVN: 'si', SWE: 'se',
  SWZ: 'sz', SYR: 'sy', TAN: 'tz', THA: 'th', TJK: 'tj', TKM: 'tm', TOG: 'tg', TPE: 'tw',
  TRI: 'tt', TUN: 'tn', TUR: 'tr', UAE: 'ae', UGA: 'ug', UKR: 'ua', URU: 'uy', USA: 'us',
  UZB: 'uz', VEN: 've', VIE: 'vn', WAL: 'gb-wls', YEM: 'ye', ZAM: 'zm', ZIM: 'zw',
};

/**
 * URL du drapeau d'un pays (code FIFA), ou null si le code est inconnu
 */
export function getFlagUrl(fifaCode: string | undefined): string | null {
  if (!fifaCode) return null;
  const iso = FIFA_TO_ISO[fifaCode.toUpperCase()];
  return iso ? `https://flagcdn.com/${iso}.svg` : null;
}
