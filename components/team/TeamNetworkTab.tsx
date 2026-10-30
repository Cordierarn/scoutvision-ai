/**
 * ScoutVision - Analyse d'équipe, onglet « Réseau de passes »
 * Réseau de passes agrégé sur la saison (tables pass_network de PitchAPI : onze de départ de
 * chaque match jusqu'au premier remplacement). Chaque joueur est placé à sa position moyenne,
 * les traits relient les paires qui échangent le plus de passes par match de l'équipe. Les
 * filtres (présence du joueur, passes par match d'un lien) sont conservés au retour d'une fiche.
 * Un joueur choisi (clic, focus ou liste) met ses liens en avant et montre sa carte de chaleur.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Share2, Users } from 'lucide-react';
import { PlayerData } from '../../types';
import { TeamNetwork } from '../../services/dataLoader';
import {
  DEFAULT_NETWORK_FILTERS, NetworkFilters, NetworkPlayer, PER_MATCH_OPTIONS, SHARE_OPTIONS, filterNetwork, linkScale, networkView, playerLinks,
  playerScale, shortName,
} from '../../utils/passNetwork';
import { positionLabel } from '../../utils/labels';
import { EmptyState, InfoTip, LoadError, Panel, Skeleton } from '../ui';
import { PlayerAvatar } from '../Media';
import PlayerHeatmap from '../PlayerHeatmap';
import { PITCH_LENGTH, PITCH_WIDTH, Pitch, pitchPoint, useElementWidth } from '../Pitch';
import { teamMemory } from './teamMemory';

const PCT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const D1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const TeamNetworkTab: React.FC<{
  teamKey: string;
  network: TeamNetwork | null | undefined;     // undefined : chargement
  networkError: string | null;
  onRetry: () => void;
  players: PlayerData[];
  teamMatches: number | null;
  onSelectPlayer?: (p: PlayerData) => void;
}> = ({ teamKey, network, networkError, onRetry, players, teamMatches, onSelectPlayer }) => {
  const [filters, setFilters] = useState<NetworkFilters>(teamMemory.network);
  useEffect(() => { teamMemory.network = filters; }, [filters]);
  const update = (patch: Partial<NetworkFilters>) => setFilters(f => ({ ...f, ...patch }));
  // « Réinitialiser » disparaît une fois les filtres par défaut : le focus passe au premier filtre
  const shareRef = useRef<HTMLSelectElement>(null);
  const reset = () => { setFilters(DEFAULT_NETWORK_FILTERS); requestAnimationFrame(() => shareRef.current?.focus()); };
  const view = useMemo(() => networkView(network), [network]);
  const shown = useMemo(() => (view ? filterNetwork(view, filters) : null), [view, filters]);
  const byId = useMemo(() => new Map(players.map(p => [p['Player ID'], p])), [players]);

  // Joueur choisi (mémoire par équipe) : parmi les joueurs affichés, sinon le plus impliqué
  const [playerId, setPlayerId] = useState<string | undefined>(teamMemory.networkPlayer[teamKey]);
  const selected = shown?.players.find(p => p.id === playerId) ?? shown?.players[0];
  const choose = (id: string) => { teamMemory.networkPlayer[teamKey] = id; setPlayerId(id); };
  const partners = useMemo(() => (view && selected ? playerLinks(view, selected.id) : []), [view, selected]);
  const [pitchRef, width] = useElementWidth<HTMLDivElement>();
  const orientation = width >= 600 ? 'horizontal' : 'vertical';
  const compact = orientation === 'vertical' ? width < 420 : width < 760;

  if (networkError) return <div className="p-5"><LoadError message="Le réseau de passes n'a pas pu être chargé." onRetry={onRetry} /></div>;
  if (network === undefined) return <div className="p-5" role="status" aria-label="Chargement du réseau de passes"><Skeleton className="h-[480px]" /></div>;
  if (!view || !shown) {
    return <div className="p-5"><div className="sv-panel"><EmptyState icon={Share2} title="Aucun réseau de passes pour cette équipe dans cette compétition." /></div></div>;
  }

  const ls = linkScale(shown.links);
  const ps = playerScale(shown.players);
  const vb = orientation === 'vertical' ? { w: PITCH_WIDTH, h: PITCH_LENGTH } : { w: PITCH_LENGTH, h: PITCH_WIDTH };
  const at = (x: number, y: number) => { const p = pitchPoint(x, y, orientation); return { x: (p.left / 100) * vb.w, y: (p.top / 100) * vb.h }; };
  const pos = new Map(shown.players.map(p => [p.id, at(p.x, p.y)]));
  const linked = new Set(partners.map(l => l.partner.id));
  const filtered = filters.minShare !== DEFAULT_NETWORK_FILTERS.minShare || filters.minPerMatch !== DEFAULT_NETWORK_FILTERS.minPerMatch;
  const selectedData = selected ? byId.get(selected.id) : undefined;
  const nodeSize = (p: NetworkPlayer) => (compact ? 14 : 18) + Math.round((compact ? 12 : 18) * ps(p));

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <span>Joueurs présents</span>
          <select ref={shareRef} className="sv-select sv-select-sm" value={filters.minShare} onChange={e => update({ minShare: Number(e.target.value) })}>
            {SHARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <span>Liens</span>
          <select className="sv-select sv-select-sm" value={filters.minPerMatch} onChange={e => update({ minPerMatch: Number(e.target.value) })}>
            {PER_MATCH_OPTIONS.map(v => <option key={v} value={v}>{v === 0 ? 'Tous' : `≥ ${v} passe${v > 1 ? 's' : ''} / match`}</option>)}
          </select>
        </label>
        {filtered && <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={reset}>Réinitialiser</button>}
        <InfoTip className="ml-auto" align="end" text="Réseau de l'onze de départ de chaque match, jusqu'au premier remplacement, agrégé sur la saison. Position = moyenne des positions moyennes de match. Trait = passes échangées dans les deux sens, par match de l'équipe disposant d'un réseau. Taille du point = passes données et reçues par match." />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div ref={pitchRef} className="xl:col-span-8 min-w-0">
          {width > 0 && (
            <Pitch orientation={orientation} label="Réseau de passes" className={orientation === 'vertical' ? 'max-w-[520px] mx-auto' : ''}>
              <svg viewBox={`0 0 ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full" aria-hidden preserveAspectRatio="none">
                {shown.links.map(l => {
                  const a = pos.get(l.a)!, b = pos.get(l.b)!;
                  const mine = selected && (l.a === selected.id || l.b === selected.id);
                  const dim = selected && !mine;
                  return (
                    <line key={`${l.a}|${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor"
                      className={mine ? 'text-accent' : 'text-ink-3'} strokeLinecap="round"
                      strokeWidth={0.4 + 2.6 * ls(l)} strokeOpacity={dim ? 0.25 : mine ? 0.95 : 0.7} />
                  );
                })}
              </svg>
              {shown.links.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-ink-3 pointer-events-none">
                  Aucun lien au-dessus de ce seuil : abaissez « Liens ».
                </div>
              )}
              {shown.players.map(p => {
                const { left, top } = pitchPoint(p.x, p.y, orientation);
                const size = nodeSize(p);
                const isSel = p.id === selected?.id;
                const data = byId.get(p.id);
                const label = `${p.name}, ${D1.format(p.perMatch)} passes par match, présent dans ${PCT.format(p.share * 100)} % des matchs${data ? `, ${positionLabel(data.Position)}` : ''}${isSel ? ', sélectionné' : ''}`;
                return (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} onFocus={() => choose(p.id)} aria-pressed={isSel} aria-label={label} title={label}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center focus-within:z-20 hover:z-20 ${isSel ? 'z-10' : ''}`}
                    style={{ left: `${left}%`, top: `${top}%` }}>
                    <span className={`block rounded-full border-2 transition-colors ${isSel ? 'bg-accent border-accent' : linked.has(p.id) ? 'bg-surface border-accent' : 'bg-surface border-line-strong'}`}
                      style={{ width: size, height: size, opacity: selected && !isSel && !linked.has(p.id) ? 0.55 : 1 }} aria-hidden />
                    <span className={`block mt-0.5 px-1 rounded bg-canvas/80 text-ink leading-tight whitespace-nowrap ${compact ? 'text-[9px]' : 'text-[11px]'} ${isSel ? 'font-semibold' : ''}`} aria-hidden>
                      {compact ? shortName(p.name) : p.name}
                    </span>
                  </button>
                );
              })}
            </Pitch>
          )}
          <p className="text-2xs text-ink-3 mt-2 leading-relaxed">
            {view.matches} match{view.matches > 1 ? 's' : ''} avec réseau{teamMatches !== null && view.matches < teamMatches ? ` sur ${teamMatches} matchs de l'équipe` : ''} · {shown.players.length} joueur{shown.players.length > 1 ? 's' : ''} affiché{shown.players.length > 1 ? 's' : ''}
            {shown.hiddenPlayers > 0 && `, ${shown.hiddenPlayers} masqué${shown.hiddenPlayers > 1 ? 's' : ''} par le filtre de présence`}
            {shown.hiddenLinks > 0 && ` · ${shown.hiddenLinks} lien${shown.hiddenLinks > 1 ? 's' : ''} sous le seuil`}.
            {' '}Onze de départ jusqu'au premier remplacement : les entrants n'y figurent pas. Activer un point choisit le joueur.
          </p>
        </div>

        <div className="xl:col-span-4 space-y-4 min-w-0">
          <Panel title="Joueur" icon={Users}
            right={
              <label className="flex items-center gap-2 text-2xs text-ink-3">
                <span className="sr-only">Choisir un joueur</span>
                <select className="sv-select sv-select-sm max-w-[13rem]" value={selected?.id ?? ''} onChange={e => choose(e.target.value)}>
                  {shown.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            }>
            {selected ? (
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <PlayerAvatar player={selectedData} name={selected.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    {selectedData && onSelectPlayer
                      ? <button type="button" onClick={() => onSelectPlayer(selectedData)} className="block text-left text-[13px] text-ink hover:text-accent truncate max-w-full">{selected.name}</button>
                      : <span className="block text-[13px] text-ink-2 truncate">{selected.name}</span>}
                    <span className="block text-2xs text-ink-3">
                      {selectedData ? `${selectedData.Age ?? '–'} ans · ${positionLabel(selectedData.Position)}` : 'Sous le seuil de minutes : pas de statistiques détaillées'}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-ink-2 mb-2 num">
                  {D1.format(selected.perMatch)} passes par match ({selected.passes} données, {selected.received} reçues) · dans le onze de {selected.matches} match{selected.matches > 1 ? 's' : ''} sur {view.matches}
                </p>
                <p className="sv-label mb-1">Partenaires les plus fréquents</p>
                {partners.length === 0 ? <p className="text-2xs text-ink-3">Aucun lien enregistré pour ce joueur.</p> : (
                  <ol className="space-y-1">
                    {partners.slice(0, 6).map(({ link, partner, given, got }) => {
                      const p = byId.get(partner.id);
                      return (
                        <li key={partner.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1">
                            {p && onSelectPlayer
                              ? <button type="button" onClick={() => onSelectPlayer(p)} className="block text-left text-xs text-ink hover:text-accent truncate max-w-full">{partner.name}</button>
                              : <span className="block text-xs text-ink-2 truncate">{partner.name}</span>}
                            <span className="block text-2xs text-ink-3 num">{given} données · {got} reçues · {link.matches} match{link.matches > 1 ? 's' : ''}</span>
                          </span>
                          <span className="text-xs text-ink num shrink-0">{D1.format(link.perMatch)} / match</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ) : <p className="text-xs text-ink-3">Aucun joueur ne passe le filtre de présence.</p>}
          </Panel>
          {selectedData && <PlayerHeatmap player={selectedData} />}
        </div>
      </div>
    </div>
  );
};

export default TeamNetworkTab;
