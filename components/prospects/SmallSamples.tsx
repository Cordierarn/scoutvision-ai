/**
 * Chasseur de pépites › Petits temps de jeu : joueurs absents de la base (moins de 40 % des minutes de
 * leur équipe, seuil de PitchAPI), à partir de 4 matchs et 180 minutes. Valeurs par 90 ramenées vers la
 * moyenne du poste selon les minutes, fiabilité, percentile parmi les joueurs de la base du même poste et
 * du même niveau, avec son intervalle à 90 %. Tout est calculé par le pipeline (small_samples/{saison}.json).
 */

import React, { useMemo, useState } from 'react';
import { dataLoader } from '../../services/dataLoader';
import { useAsyncData } from '../../hooks/useAsyncData';
import { metricLabel, positionName } from '../../utils/labels';
import { SmallSamplePlayer, SmallSampleSort, expandSmallSamples, filterSmallSamples } from '../../utils/reliability';
import { EMPTY_PROFILE, ProfileFilters, profileChips } from '../../utils/profileFilters';
import { ProfileFiltersPanel, useProfileOptions } from '../filters/ProfileFiltersPanel';
import { ChevronDown } from 'lucide-react';
import { CompetitionBadge } from '../Media';
import { EmptyState, InfoTip, LoadError, PercentileValue, Skeleton } from '../ui';

const ROLES = ['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'];
const SORTS: { id: SmallSampleSort; label: string; tip: string }[] = [
  { id: 'pct', label: 'Percentile estimé', tip: 'Percentile de la valeur ramenée vers la moyenne du poste.' },
  { id: 'low', label: 'Prudent', tip: 'Borne basse de l\'intervalle à 90 % : le niveau que le joueur atteint très probablement.' },
  { id: 'reliability', label: 'Fiabilité', tip: 'Part de signal de la valeur, selon les minutes jouées.' },
];
const PAGE = 50;
const NO_MISSING = { nation: 0, foot: 0, height: 0 };
const num = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Percentile et son intervalle à 90 % sur une barre 0-100 */
export const PercentileRange: React.FC<{ pct: number | null; low: number | null; high: number | null }> = ({ pct, low, high }) => {
  if (pct === null) return <span className="text-ink-4">–</span>;
  const lo = low ?? pct, hi = high ?? pct;
  return (
    <span className="inline-flex items-center gap-2" title={`Percentile estimé ${pct}, intervalle à 90 % : ${lo} – ${hi}`}>
      <span className="relative block w-20 h-1.5 rounded-sm bg-raised" aria-hidden>
        <span className="absolute inset-y-0 rounded-sm bg-accent/30" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-0.5 bg-accent" style={{ left: `calc(${pct}% - 1px)` }} />
      </span>
      <PercentileValue value={pct} className="text-xs" />
      <span className="text-2xs text-ink-4 num whitespace-nowrap">{lo}–{hi}</span>
    </span>
  );
};

export const SmallSamples: React.FC = () => {
  const seasons = useMemo(() => (dataLoader.getCachedIndex()?.seasons.map(s => s.id) ?? []).slice().sort().reverse().slice(0, 2), []);
  const [season, setSeason] = useState(seasons[0] ?? '');
  const request = useAsyncData(season ? () => dataLoader.loadSmallSamples(season) : null, [season]);
  const players = useMemo(() => (request.data ? expandSmallSamples(request.data) : []), [request.data]);

  const [role, setRole] = useState('W');
  const metrics = useMemo(() => {
    const keys = new Set<string>();
    players.forEach(p => { if (p.Position === role) Object.keys(p.metrics).forEach(k => keys.add(k)); });
    return [...keys].sort((a, b) => metricLabel(a).localeCompare(metricLabel(b), 'fr'));
  }, [players, role]);
  const [metricChoice, setMetric] = useState('xG per 90');
  const metric = metrics.includes(metricChoice) ? metricChoice : metrics[0] ?? '';
  const [profile, setProfileState] = useState<ProfileFilters>(EMPTY_PROFILE);
  const [profileOpen, setProfileOpen] = useState(false);
  const setProfile = (v: ProfileFilters) => { setProfileState(v); setShown(PAGE); };
  const profileOptions = useProfileOptions(players);
  const profileCount = profileChips(profile, { competition: profileOptions.competitionName, team: profileOptions.teamName }).length;
  // Champs que le fichier de la saison ne renseigne pour aucun joueur : signalés sous le panneau
  const absentFields = useMemo(() => players.length === 0 ? [] : ([
    ['nationalité', (p: SmallSamplePlayer) => typeof p['Passport country'] === 'string' && p['Passport country'] !== ''],
    ['pied', (p: SmallSamplePlayer) => typeof p.Foot === 'string' && p.Foot !== ''],
    ['taille', (p: SmallSamplePlayer) => typeof p.Height === 'number'],
  ] as const).filter(([, has]) => !players.some(has)).map(([label]) => label), [players]);
  const [maxAgeInput, setMaxAge] = useState('23');
  const [minMatchesInput, setMinMatches] = useState('4');
  const [sort, setSort] = useState<SmallSampleSort>('low');
  const [shown, setShown] = useState(PAGE);

  const maxAge = /^\d+$/.test(maxAgeInput.trim()) ? Number(maxAgeInput) : null;
  const minMatches = /^\d+$/.test(minMatchesInput.trim()) ? Number(minMatchesInput) : 4;
  const { rows, missing } = useMemo(() => (metric ? filterSmallSamples(players, { role, profile, maxAge, minMatches, metric, sort }) : { rows: [], missing: NO_MISSING }),
    [players, role, profile, maxAge, minMatches, metric, sort]);

  const field = 'h-8 rounded border border-line bg-raised px-2 text-sm text-ink';
  const label = 'sv-label mb-1 block';

  return (
    <div className="p-4 sm:px-5 space-y-4">
      <p className="text-xs text-ink-3 leading-relaxed max-w-3xl">
        Joueurs absents de la base parce qu'ils ont joué moins de 40 % des minutes de leur équipe, à partir de 4 matchs et 180 minutes.
        Chaque valeur par 90 est ramenée vers la moyenne du poste selon les minutes jouées, puis classée parmi les joueurs de la base du même
        poste et du même niveau. L'intervalle à 90 % dit où le vrai niveau se trouve très probablement : large quand l'échantillon est petit.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {seasons.length > 1 && (
          <div><label htmlFor="ss-season" className={label}>Saison</label>
            <select id="ss-season" className={field} value={season} onChange={e => { setSeason(e.target.value); setShown(PAGE); }}>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        )}
        <div><label htmlFor="ss-role" className={label}>Poste</label>
          <select id="ss-role" className={field} value={role} onChange={e => { setRole(e.target.value); setShown(PAGE); }}>
            {ROLES.map(r => <option key={r} value={r}>{positionName(r)}</option>)}
          </select></div>
        <div className="min-w-0"><label htmlFor="ss-metric" className={label}>Métrique</label>
          <select id="ss-metric" className={`${field} max-w-[16rem]`} value={metric} onChange={e => { setMetric(e.target.value); setShown(PAGE); }}>
            {metrics.map(m => <option key={m} value={m}>{metricLabel(m)}</option>)}
          </select></div>
        <div className="min-w-0"><span className={label} id="ss-profile-label">Profil</span>
          <button type="button" onClick={() => setProfileOpen(o => !o)} aria-expanded={profileOpen} aria-controls="ss-profile" aria-describedby="ss-profile-label"
            className={`sv-btn sv-btn-secondary h-8 ${profileCount > 0 ? '!border-accent/60 !text-accent' : ''}`}>
            Compétition, club, pied, taille{profileCount > 0 && <span className="num"> ({profileCount})</span>}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${profileOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button></div>
        <div><label htmlFor="ss-age" className={label}>Âge max.</label>
          <input id="ss-age" className={`${field} w-20 num`} inputMode="numeric" value={maxAgeInput} placeholder="tous" onChange={e => { setMaxAge(e.target.value); setShown(PAGE); }} /></div>
        <div><label htmlFor="ss-matches" className={label}>Matchs min.</label>
          <input id="ss-matches" className={`${field} w-20 num`} inputMode="numeric" value={minMatchesInput} onChange={e => { setMinMatches(e.target.value); setShown(PAGE); }} /></div>
        <div>
          <div className={`${label} flex items-center gap-1`}>Tri <InfoTip text={SORTS.map(s => `${s.label} : ${s.tip}`).join('\n')} align="start" /></div>
          <div className="sv-seg" role="radiogroup" aria-label="Tri des joueurs">
            {SORTS.map(s => (
              <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)} className={`sv-seg-btn ${sort === s.id ? 'sv-seg-on' : ''}`}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {profileOpen && (
        <div id="ss-profile" className="pt-3 border-t border-line">
          <div className="flex items-center justify-between mb-2">
            <span className="sv-label">Profil</span>
            {profileCount > 0 && <button type="button" onClick={() => setProfile(EMPTY_PROFILE)} className="sv-btn sv-btn-ghost sv-btn-sm !h-6">Effacer le profil</button>}
          </div>
          <ProfileFiltersPanel value={profile} onChange={setProfile} options={profileOptions} missing={missing} />
          {absentFields.length > 0 && (
            <p className="mt-2 text-2xs text-ink-4">Le fichier de cette saison ne renseigne pas : {absentFields.join(', ')}. Un filtre sur ce champ écarte tous les joueurs (comptés sous le filtre), sauf si vous les incluez.</p>
          )}
        </div>
      )}

      {request.status === 'loading' && <div role="status" aria-label="Chargement des joueurs à faible temps de jeu"><Skeleton className="h-64" /></div>}
      {request.status === 'error' && <LoadError message={`Joueurs à faible temps de jeu indisponibles : ${request.error}`} onRetry={request.retry} />}
      {request.status === 'success' && request.data === null && (
        <EmptyState title="Pas encore de données pour cette saison.">Le fichier des petits temps de jeu est produit par la mise à jour des données.</EmptyState>
      )}
      {request.status === 'success' && request.data && rows.length === 0 && (
        <EmptyState title="Aucun joueur ne correspond.">Élargissez l'âge, baissez le nombre de matchs minimum ou élargissez le profil.</EmptyState>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-2xs text-ink-4 num">{rows.length.toLocaleString('fr-FR')} joueur{rows.length > 1 ? 's' : ''} · {positionName(role)} · {metricLabel(metric)}</p>
          <div className="hidden md:block overflow-x-auto">
            <table className="sv-table">
              <thead>
                <tr>
                  <th scope="col">Joueur</th><th scope="col" className="text-right">Âge</th><th scope="col" className="text-right">Matchs (tit.)</th>
                  <th scope="col" className="text-right">Minutes</th><th scope="col" className="text-right">Valeur estimée (brute)</th>
                  <th scope="col">Percentile · intervalle à 90 %</th><th scope="col" className="text-right">Fiabilité</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map(p => {
                  const m = p.metrics[metric];
                  return (
                    <tr key={`${p['Player ID']}-${p.Competition}`}>
                      <td className="min-w-0">
                        <div className="text-ink">{p.Player}</div>
                        <div className="text-2xs text-ink-3 flex items-center gap-1.5"><CompetitionBadge competition={p.Competition} /> <span className="truncate">{p.Team}</span></div>
                      </td>
                      <td className="text-right num text-ink-2">{typeof p.Age === 'number' ? p.Age : '–'}</td>
                      <td className="text-right num text-ink-2">{p['Matches played']}{typeof p.Starts === 'number' ? ` (${p.Starts})` : ''}</td>
                      <td className="text-right num text-ink-2">{p['Minutes played'].toLocaleString('fr-FR')}{typeof p['Minutes share'] === 'number' ? <span className="text-ink-4"> · {Math.round(p['Minutes share'] * 100)} %</span> : null}</td>
                      <td className="text-right num"><span className="text-ink">{num.format(m.value)}</span>{m.raw !== null && <span className="text-2xs text-ink-4"> ({num.format(m.raw)})</span>}</td>
                      <td><PercentileRange pct={m.pct} low={m.pctLow} high={m.pctHigh} /></td>
                      <td className={`text-right num ${m.reliability !== null && m.reliability < 40 ? 'text-warn' : 'text-ink-2'}`}>{m.reliability === null ? '–' : `${m.reliability} %`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden list-none m-0 p-0">
            {rows.slice(0, shown).map(p => {
              const m = p.metrics[metric];
              return (
                <li key={`${p['Player ID']}-${p.Competition}`} className="py-2 border-t border-line/60 first:border-t-0 text-sm">
                  <div className="text-ink">{p.Player}{typeof p.Age === 'number' && <span className="text-ink-3 num"> · {p.Age} ans</span>}</div>
                  <div className="text-2xs text-ink-3 flex items-center gap-1.5"><CompetitionBadge competition={p.Competition} /> <span className="truncate">{p.Team}</span></div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-1 num">
                    <PercentileRange pct={m.pct} low={m.pctLow} high={m.pctHigh} />
                    <span className="text-ink-2">valeur {num.format(m.value)}</span>
                    <span className={m.reliability !== null && m.reliability < 40 ? 'text-warn' : 'text-ink-2'}>fiabilité {m.reliability ?? '–'} %</span>
                    <span className="text-ink-3">{p['Matches played']} matchs, {p['Minutes played'].toLocaleString('fr-FR')} min</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.length > shown && (
            <button type="button" className="sv-btn sv-btn-secondary" onClick={() => setShown(s => s + PAGE)}>Afficher {Math.min(PAGE, rows.length - shown)} de plus</button>
          )}
        </>
      )}
    </div>
  );
};

export default SmallSamples;
