/**
 * ScoutVision - Analyse d'équipe, onglet « Effectif & profondeur »
 * Profondeur par poste (slotDepth : titulaire, doublure, 3e option, signaux déjà utilisés par
 * le Recrutement, sans niveau de besoin), profil de l'effectif (squadProfile) et effectif triable.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, ChevronsUpDown, CircleAlert, FileClock, Repeat, Star, TrendingDown, Users } from 'lucide-react';
import { PlayerData, getPlayerSeasonId } from '../../types';
import { TeamLineups, dataLoader } from '../../services/dataLoader';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../../services/storageService';
import { placeEleven } from '../../utils/lineup';
import { formationPositions } from '../../utils/teamLineups';
import { CONTRACT_MONTHS, DimensionScore, Models, NeedFlag, isDeclining, slotDepth } from '../../utils/recruitment';
import { useAsyncData } from '../../hooks/useAsyncData';
import { positionLabel, positionName } from '../../utils/labels';
import { formatEuro } from '../../utils/format';
import { isRowActivation } from '../../utils/rowKeys';
import { EmptyState, LoadError, Panel, PercentileValue, Skeleton } from '../ui';
import { PlayerAvatar } from '../Media';
import { SquadProfilePanel } from '../SquadProfile';
import { FormationPicker, useFormation } from './TeamLineupTab';
import { SquadSortKey, teamMemory } from './teamMemory';

const SIGNALS: Record<NeedFlag, { label: string; icon: React.ElementType; title: string }> = {
  noStarter: { label: 'Aucun joueur régulier', icon: CircleAlert, title: 'Aucun joueur de ce poste n\'a assez de minutes pour figurer dans les données' },
  depth: { label: 'Pas de doublure', icon: Users, title: 'Aucun autre joueur n\'a débuté 15 % des matchs de la formation à ce poste' },
  rotation: { label: 'Poste en rotation', icon: Repeat, title: 'Le titulaire le plus fréquent est sous le seuil de minutes : la référence est le joueur le plus utilisé à ce poste' },
  contract: { label: `Contrat ≤ ${CONTRACT_MONTHS} mois`, icon: FileClock, title: 'Fin de contrat proche (Transfermarkt)' },
  decline: { label: 'Déclin lié à l\'âge', icon: TrendingDown, title: 'L\'âge seul (hors retour vers la moyenne) fait baisser l\'indice projeté du meilleur rôle d\'au moins 2 points' },
};

const INT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const D2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMonth = (date: unknown) => { const m = typeof date === 'string' ? date.match(/^(\d{4})-(\d{2})/) : null; return m ? `${m[2]}/${m[1]}` : '–'; };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const COLUMNS: { key: SquadSortKey; label: string; numeric: boolean; title?: string; hideBelow?: 'sm' | 'md' | 'lg' }[] = [
  { key: 'Player', label: 'Joueur', numeric: false },
  { key: 'Age', label: 'Âge', numeric: true },
  { key: 'Position', label: 'Poste', numeric: false },
  { key: 'Minutes played', label: 'Min', numeric: true, title: 'Minutes jouées dans la compétition' },
  { key: 'Goals', label: 'Buts', numeric: true, hideBelow: 'sm' },
  { key: 'xG', label: 'xG', numeric: true, hideBelow: 'md' },
  { key: 'xA', label: 'xA', numeric: true, hideBelow: 'md' },
  { key: 'Rating pct', label: 'Note', numeric: true, title: 'Percentile de la note du match (pipeline : rôle × niveau × saison)', hideBelow: 'sm' },
  { key: 'Market value', label: 'Valeur', numeric: true, title: 'Valeur Transfermarkt', hideBelow: 'lg' },
  { key: 'Contract expires', label: 'Contrat', numeric: false, title: 'Fin de contrat (Transfermarkt)', hideBelow: 'lg' },
];
const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

const TeamSquadTab: React.FC<{
  teamKey: string;
  lineups: TeamLineups | null | undefined;
  lineupsError: string | null;
  onRetryLineups: () => void;
  players: PlayerData[];
  teamMatches: number | null;
  profile: DimensionScore[] | null;
  profileLeague?: string;
  profileNote?: React.ReactNode;
  onSelectPlayer?: (p: PlayerData) => void;
  onCompare?: (p: PlayerData) => void;
}> = ({ teamKey, lineups, lineupsError, onRetryLineups, players, teamMatches, profile, profileLeague, profileNote, onSelectPlayer, onCompare }) => {
  const [formations, formation, chooseFormation] = useFormation(teamKey, lineups);
  const eleven = useMemo(() => (formation ? placeEleven(formation.slots) : []), [formation]);
  const positions = useMemo(() => (formation ? formationPositions(formation) : null), [formation]);

  // Signaux de contrat et de déclin : mêmes sources que le Recrutement (Transfermarkt, courbes d'âge)
  const market = useAsyncData(() => dataLoader.loadMarketValues(), []);
  const curves = useAsyncData(() => dataLoader.loadAgeCurves(), []);
  const ready = market.status !== 'loading' && curves.status !== 'loading';
  const depth = useMemo(() => {
    if (!ready) return null;
    const models: Models | null = curves.data ? { curves: curves.data, transfer: null } : null;
    const m = market.data ?? null;
    return slotDepth(eleven, players, {
      contractOf: m ? p => m.players.get(p['Player ID'] ?? '')?.contract : undefined,
      asOf: m?.scrapedAt ? new Date(m.scrapedAt) : new Date(),
      declining: models ? p => isDeclining(p, models) : undefined,
    });
  }, [ready, eleven, players, market.data, curves.data]);

  const [sort, setSort] = useState(teamMemory.squadSort);
  useEffect(() => { teamMemory.squadSort = sort; }, [sort]);
  const rows = useMemo(() => {
    const value = (p: PlayerData) => {
      const v = p[sort.key];
      return sort.key === 'Player' || sort.key === 'Position' || sort.key === 'Contract expires' ? (typeof v === 'string' ? v : null) : num(v);
    };
    return [...players].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;                       // valeurs absentes toujours en bas
      if (vb === null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'fr') : (va as number) - (vb as number);
      return sort.dir === 'asc' ? c : -c;
    });
  }, [players, sort]);

  const [watched, setWatched] = useState<Set<string>>(() => new Set(getWatchlist().map(w => getPlayerSeasonId(w.player))));
  const toggleWatch = (p: PlayerData) => {
    const id = getPlayerSeasonId(p);
    if (watched.has(id)) removeFromWatchlist(p); else addToWatchlist(p);
    setWatched(new Set(getWatchlist().map(w => getPlayerSeasonId(w.player))));
  };

  const byId = useMemo(() => new Map(players.map(p => [p['Player ID'], p])), [players]);
  const nameCell = (o: { lineup: { id: string; name: string; starts: number }; player?: PlayerData } | null) => {
    if (!o) return <span className="text-ink-4">—</span>;
    const p = o.player ?? byId.get(o.lineup.id);
    return (
      <span className="flex items-center gap-2 min-w-0">
        <PlayerAvatar player={p} name={o.lineup.name} size="xs" />
        <span className="min-w-0">
          {p && onSelectPlayer
            ? <button type="button" onClick={() => onSelectPlayer(p)} className="block text-left text-[13px] text-ink hover:text-accent truncate max-w-full">{o.lineup.name}</button>
            : <span className="block text-[13px] text-ink-2 truncate" title="Sous le seuil de minutes : pas de statistiques détaillées">{o.lineup.name}</span>}
          <span className="block text-2xs text-ink-3 num">{o.lineup.starts} tit.{p?.Age !== undefined ? ` · ${p.Age} ans` : ''}</span>
        </span>
      </span>
    );
  };

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <Panel title="Profondeur par poste" icon={Users} flush
        subtitle="Titulaire, doublure et 3e option : joueurs qui ont débuté à ce poste dans la formation, par titularisations. Signaux du Recrutement, sans niveau de besoin.">
        {lineupsError ? <div className="p-4"><LoadError message="Les compositions n'ont pas pu être chargées." onRetry={onRetryLineups} /></div>
          : lineups === undefined ? <div className="p-4" role="status" aria-label="Chargement des compositions"><Skeleton className="h-48" /></div>
            : !lineups || formations.length === 0 ? <EmptyState title="Aucune composition disponible : profondeur non mesurable." />
              : (
                <>
                  <div className="px-4 pt-3 pb-2"><FormationPicker formations={formations} current={formation} onChoose={chooseFormation} lineups={lineups} teamMatches={teamMatches} /></div>
                  {(market.status === 'error' || curves.status === 'error') && (
                    <p className="px-4 pb-2 text-2xs text-warn">
                      {market.status === 'error' ? 'Contrats indisponibles : signal de fin de contrat absent. ' : ''}
                      {curves.status === 'error' ? 'Courbes d\'âge indisponibles : signal de déclin absent.' : ''}
                    </p>
                  )}
                  {!depth ? <div className="p-4" role="status" aria-label="Chargement des signaux"><Skeleton className="h-48" /></div> : (
                    <div className="overflow-x-auto">
                      <table className="sv-table">
                        <caption className="sr-only">Profondeur par poste en {formation?.formation}</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="pl-4">Poste</th>
                            <th scope="col">Titulaire</th>
                            <th scope="col">Doublure</th>
                            <th scope="col" className="hidden md:table-cell">3e option</th>
                            <th scope="col" className="text-right hidden sm:table-cell" title="Part des titularisations à ce poste prises par d'autres que le titulaire">Rotation</th>
                            <th scope="col" className="pr-4">Signaux</th>
                          </tr>
                        </thead>
                        <tbody>
                          {depth.map(d => {
                            const slotPos = positions?.get(d.placed.slot.slot);
                            return (
                              <tr key={d.placed.slot.slot}>
                                <th scope="row" className="pl-4 text-left font-normal">
                                  <span className="sv-tag" title={slotPos ? positionName(slotPos) : positionName(d.position)}>{positionLabel(slotPos ?? d.position)}</span>
                                </th>
                                <td className="max-w-[12rem]">{nameCell(d.options[0] ?? null)}</td>
                                <td className="max-w-[12rem]">{d.backup ? nameCell(d.backup) : <span className="text-2xs text-ink-3">Aucune</span>}</td>
                                <td className="max-w-[12rem] hidden md:table-cell">{d.thirdOption ? nameCell(d.thirdOption) : <span className="text-2xs text-ink-3">Aucune</span>}</td>
                                <td className="text-right text-ink-2 num hidden sm:table-cell">{d.slotMatches > 0 ? `${INT.format(d.coverage * 100)} %` : '–'}</td>
                                <td className="pr-4">
                                  <span className="flex flex-wrap gap-1">
                                    {d.signals.length === 0 && <span className="text-2xs text-ink-4">—</span>}
                                    {d.signals.map(s => {
                                      const S = SIGNALS[s];
                                      return (
                                        <span key={s} title={S.title} className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-line-strong text-2xs text-ink-2 whitespace-nowrap">
                                          <S.icon className="w-3 h-3" aria-hidden />{S.label}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
      </Panel>

      {profile !== null && <SquadProfilePanel profile={profile} leagueName={profileLeague ?? ''} note={profileNote} />}

      <Panel title="Effectif" flush
        subtitle={`${players.length} joueurs au-dessus du seuil de minutes du pipeline dans cette compétition : pas l'effectif complet. Ligne activable (Entrée) : fiche du joueur.`}>
        <div className="overflow-x-auto">
          <table className="sv-table">
            <caption className="sr-only">Effectif de l'équipe, trié par {COLUMNS.find(c => c.key === sort.key)?.label}</caption>
            <thead>
              <tr>
                {COLUMNS.map((c, i) => {
                  const active = sort.key === c.key;
                  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`${c.numeric ? 'text-right' : ''} ${i === 0 ? 'pl-4' : ''} ${c.hideBelow ? HIDE[c.hideBelow] : ''} ${active ? '!text-ink' : ''}`} title={c.title}>
                      <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : c.numeric ? 'desc' : 'asc' }))}
                        className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink ${c.numeric ? 'flex-row-reverse' : ''}`}>
                        {c.label}<Icon className={`w-3 h-3 ${active ? 'text-accent' : 'opacity-40'}`} aria-hidden />
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="pr-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const id = getPlayerSeasonId(p);
                const isWatched = watched.has(id);
                const value = num(p['Market value']);
                return (
                  <tr key={id} tabIndex={onSelectPlayer ? 0 : undefined} className={`group ${onSelectPlayer ? 'cursor-pointer' : ''}`}
                    aria-label={onSelectPlayer ? `${p.Player} : ouvrir la fiche` : undefined}
                    onClick={() => onSelectPlayer?.(p)}
                    onKeyDown={e => { if (onSelectPlayer && isRowActivation(e)) { e.preventDefault(); onSelectPlayer(p); } }}>
                    <td className="pl-4">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <PlayerAvatar player={p} size="sm" />
                        <span className="text-[13px] font-medium text-ink truncate group-hover:text-accent transition-colors">{p.Player || 'Inconnu'}</span>
                      </span>
                    </td>
                    <td className="text-right text-ink-2 num">{num(p.Age) ?? '–'}</td>
                    <td><span className="sv-tag">{positionLabel(p.Position)}</span></td>
                    <td className="text-right text-ink-2 num">{num(p['Minutes played']) !== null ? INT.format(num(p['Minutes played'])!) : '–'}</td>
                    <td className={`text-right text-ink num ${HIDE.sm}`}>{num(p.Goals) ?? '–'}</td>
                    <td className={`text-right text-ink-2 num ${HIDE.md}`}>{num(p.xG) !== null ? D2.format(num(p.xG)!) : '–'}</td>
                    <td className={`text-right text-ink-2 num ${HIDE.md}`}>{num(p.xA) !== null ? D2.format(num(p.xA)!) : '–'}</td>
                    <td className={`text-right ${HIDE.sm}`}>{num(p['Rating pct']) !== null ? <PercentileValue value={num(p['Rating pct'])!} className="text-xs" /> : <span className="text-ink-4">–</span>}</td>
                    <td className={`text-right text-ink num ${HIDE.lg}`}>{value !== null && value > 0 ? formatEuro(value) : '–'}</td>
                    <td className={`text-ink-2 num ${HIDE.lg}`}>{formatMonth(p['Contract expires'])}</td>
                    <td className="pr-4">
                      <span className="flex items-center justify-end gap-0.5">
                        {onCompare && (
                          <button type="button" className="sv-icon-btn" onClick={e => { e.stopPropagation(); onCompare(p); }}
                            aria-label={`Comparer ${p.Player}`} data-tip="Comparer" data-tip-pos="left">
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button type="button" className={`sv-icon-btn ${isWatched ? '!text-accent' : ''}`} aria-pressed={isWatched}
                          onClick={e => { e.stopPropagation(); toggleWatch(p); }}
                          aria-label={isWatched ? `Retirer ${p.Player} de la liste de suivi` : `Ajouter ${p.Player} à la liste de suivi`}
                          data-tip={isWatched ? 'Retirer du suivi' : 'Suivre'} data-tip-pos="left">
                          <Star className={`w-3.5 h-3.5 ${isWatched ? 'fill-accent' : ''}`} />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};

export default TeamSquadTab;
