/**
 * ScoutVision - réseau de passes agrégé d'une équipe (fonctions pures)
 *
 * Source : networks/<saison>/<COMP>.json, agrégat par équipe des réseaux de match PitchAPI
 * (onze de départ, jusqu'au premier remplacement). Les liens sont rendus non orientés (passes
 * dans les deux sens additionnées) et toutes les valeurs « par match » sont rapportées aux matchs
 * de l'équipe disposant d'un réseau, pour que deux équipes se comparent sur la même base.
 */

import type { TeamNetwork } from '../services/dataLoader';

export interface NetworkPlayer {
  id: string;
  name: string;
  x: number;              // profondeur moyenne, 0 = propre but, 1 = but adverse
  y: number;              // largeur moyenne, 0 = gauche, 1 = droite
  matches: number;        // matchs dans le réseau (onze de départ)
  passes: number;         // passes données, cumul
  received: number;       // passes reçues, cumul
  share: number;          // part des matchs de l'équipe où le joueur est dans le réseau, 0-1
  perMatch: number;       // passes données + reçues par match de l'équipe
}

export interface NetworkLink {
  a: string;              // identifiants, a < b
  b: string;
  passes: number;         // cumul dans les deux sens
  ab: number;             // passes de a vers b
  ba: number;             // passes de b vers a
  matches: number;        // matchs où le lien apparaît (au moins un sens)
  perMatch: number;       // passes par match de l'équipe
}

export interface NetworkView {
  matches: number;
  players: NetworkPlayer[];       // triés par implication décroissante
  links: NetworkLink[];           // triés par passes décroissantes
}

export interface NetworkFilters {
  minShare: number;       // part minimale des matchs où le joueur est dans le réseau (0 = tous)
  minPerMatch: number;    // passes par match minimales d'un lien (0 = tous)
}

export const DEFAULT_NETWORK_FILTERS: NetworkFilters = { minShare: 0.5, minPerMatch: 2 };
export const SHARE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Tous les joueurs' },
  { value: 0.25, label: '≥ 25 % des matchs' },
  { value: 0.5, label: '≥ 50 % des matchs' },
  { value: 0.75, label: '≥ 75 % des matchs' },
];
export const PER_MATCH_OPTIONS: number[] = [0, 1, 2, 3, 5];

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Lecture du fichier : joueurs et liens non orientés avec leurs valeurs par match de l'équipe */
export function networkView(raw: TeamNetwork | null | undefined): NetworkView | null {
  if (!raw || raw.matches <= 0) return null;
  const m = raw.matches;
  const players: NetworkPlayer[] = Object.entries(raw.players)
    .map(([id, [name, x, y, matches, passes, received]]) => ({
      id, name, x, y, matches, passes, received, share: round(matches / m, 3), perMatch: round((passes + received) / m, 1),
    }))
    .sort((p, q) => q.perMatch - p.perMatch || p.name.localeCompare(q.name, 'fr'));
  const ids = new Set(players.map(p => p.id));
  const byPair = new Map<string, NetworkLink>();
  raw.edges.forEach(([from, to, passes, matches]) => {
    if (from === to || !ids.has(from) || !ids.has(to)) return;
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = `${a}|${b}`;
    const link = byPair.get(key) ?? { a, b, passes: 0, ab: 0, ba: 0, matches: 0, perMatch: 0 };
    link.passes += passes;
    if (from === a) link.ab += passes; else link.ba += passes;
    link.matches = Math.max(link.matches, matches);
    byPair.set(key, link);
  });
  const links = [...byPair.values()].map(l => ({ ...l, perMatch: round(l.passes / m, 1) })).sort((l, k) => k.passes - l.passes);
  return { matches: m, players, links };
}

export interface FilteredNetwork {
  players: NetworkPlayer[];
  links: NetworkLink[];
  hiddenPlayers: number;
  hiddenLinks: number;    // liens entre joueurs affichés, sous le seuil de passes
}

/** Joueurs assez présents et liens assez fréquents ; un lien n'est gardé que si ses deux joueurs le sont */
export function filterNetwork(view: NetworkView, filters: NetworkFilters): FilteredNetwork {
  const players = view.players.filter(p => p.share >= filters.minShare);
  const kept = new Set(players.map(p => p.id));
  const between = view.links.filter(l => kept.has(l.a) && kept.has(l.b));
  const links = between.filter(l => l.perMatch >= filters.minPerMatch);
  return { players, links, hiddenPlayers: view.players.length - players.length, hiddenLinks: between.length - links.length };
}

/** Liens d'un joueur, les plus fréquents d'abord, avec le partenaire */
export function playerLinks(view: NetworkView, id: string): { link: NetworkLink; partner: NetworkPlayer; given: number; got: number }[] {
  const byId = new Map(view.players.map(p => [p.id, p]));
  return view.links
    .filter(l => l.a === id || l.b === id)
    .map(l => {
      const partnerId = l.a === id ? l.b : l.a;
      return { link: l, partner: byId.get(partnerId)!, given: l.a === id ? l.ab : l.ba, got: l.a === id ? l.ba : l.ab };
    })
    .filter(x => x.partner);
}

/** Échelle d'un lien (0-1) sur les liens affichés, pour l'épaisseur du trait */
export function linkScale(links: NetworkLink[]): (l: NetworkLink) => number {
  const max = Math.max(0, ...links.map(l => l.perMatch));
  return l => (max > 0 ? l.perMatch / max : 0);
}

/** Échelle d'un joueur (0-1) sur les joueurs affichés, pour la taille du point */
export function playerScale(players: NetworkPlayer[]): (p: NetworkPlayer) => number {
  const max = Math.max(0, ...players.map(p => p.perMatch));
  return p => (max > 0 ? Math.sqrt(p.perMatch / max) : 0);
}

/** Nom court : dernier mot du nom (ou le nom entier s'il n'en a qu'un) */
export const shortName = (name: string): string => name.trim().split(/\s+/).slice(-1)[0] ?? name;
