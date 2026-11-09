/**
 * ScoutVision - nationalités (code FIFA de `Passport country`) en français
 *
 * Nom tiré de l'ISO 3166 (table FIFA → ISO des drapeaux) par Intl.DisplayNames, sans dépendance ;
 * les subdivisions britanniques et quelques noms d'usage dans le football sont fixés à la main.
 * Code inconnu : affiché tel quel, jamais remplacé par un pays deviné.
 */

import { FIFA_TO_ISO } from './flags';

const FIXED: Record<string, string> = {
  ENG: 'Angleterre', SCO: 'Écosse', WAL: 'Pays de Galles', NIR: 'Irlande du Nord',
  COD: 'RD Congo', CGO: 'Congo',
};

let display: Intl.DisplayNames | null | undefined;
const regionNames = (): Intl.DisplayNames | null => {
  if (display === undefined) {
    try { display = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { display = null; }
  }
  return display;
};
const cache = new Map<string, string>();

/** Nom français d'une nationalité (code FIFA) ; le code lui-même si inconnu */
export function nationName(code: string): string {
  const key = code.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;
  let name = FIXED[key];
  if (!name) {
    const iso = FIFA_TO_ISO[key];
    if (iso && !iso.includes('-')) {
      try { name = regionNames()?.of(iso.toUpperCase()) ?? ''; } catch { name = ''; }
      if (name.toUpperCase() === iso.toUpperCase()) name = '';
    }
  }
  const out = name || key;
  cache.set(key, out);
  return out;
}

const EU_27 = ['AUT', 'BEL', 'BUL', 'CRO', 'CYP', 'CZE', 'DEN', 'EST', 'FIN', 'FRA', 'GER', 'GRE', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU',
  'LUX', 'MLT', 'NED', 'POL', 'POR', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'];

/**
 * Raccourcis de sélection : ils cochent des pays un par un (puces visibles) et ne disent rien du statut
 * d'un joueur. Le statut « communautaire » dépend du championnat (accords particuliers, exemptions)
 * et des doubles nationalités, absentes des données.
 */
export const NATION_GROUPS: { id: 'eu' | 'eea'; label: string; codes: string[] }[] = [
  { id: 'eu', label: 'UE (27)', codes: EU_27 },
  { id: 'eea', label: 'UE + EEE + Suisse', codes: [...EU_27, 'ISL', 'LIE', 'NOR', 'SUI'] },
];

export const NATION_GROUPS_NOTE = 'Raccourcis géographiques : une seule nationalité connue par joueur ; doubles nationalités et accords particuliers (statut communautaire selon le championnat) non pris en compte.';
