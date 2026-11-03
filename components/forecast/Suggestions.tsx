/**
 * Suggestions de paris (Labo paris) dans l'onglet Matchs à venir : profils, bankroll, bloc repliable par match
 * avec les 3 à 5 meilleurs paris, le combiné du match et le bilan du type de suggestion sur la saison.
 * Les probabilités, espérances et fractions de mise viennent de l'artefact du pipeline ; seule la mise en
 * euros est calculée ici à partir de la bankroll saisie.
 */

import React, { useId } from 'react';
import type { BilanProfile, Suggestion, SuggestionMatch, SuggestionProfile, SuggestionsIndex } from '../../services/replayData';
import { InfoTip, Panel, Stat, StatStrip } from '../ui';
import { PROFILE_HINTS, PROFILE_LABELS, PROFILE_ORDER, bilanLine, formatEuros, formatEv, formatOdds, formatPct, formatSignedEuros, oddsAge, stakeEuros, stakeLabel } from './suggestionsLogic';

const evClass = (ev: number) => (ev > 0 ? 'text-pos' : 'text-ink-2');

/** Profil de suggestions et bankroll, partagés par les onglets Matchs à venir et Suivi des paris. */
export const ProfileBankroll: React.FC<{
  profile: SuggestionProfile; onProfile: (p: SuggestionProfile) => void;
  bankrollInput: string; bankroll: number | null; onBankroll: (raw: string) => void;
}> = ({ profile, onProfile, bankrollInput, bankroll, onBankroll }) => {
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <div className="sv-label mb-1 flex items-center gap-1">Profil <InfoTip text={PROFILE_ORDER.map(p => `${PROFILE_LABELS[p]} : ${PROFILE_HINTS[p]}`).join(' ')} align="start" /></div>
        <div className="sv-seg" role="radiogroup" aria-label="Profil de suggestions">
          {PROFILE_ORDER.map(p => (
            <button key={p} type="button" role="radio" aria-checked={profile === p} onClick={() => onProfile(p)} className={`sv-seg-btn ${profile === p ? 'sv-seg-on' : ''}`}>{PROFILE_LABELS[p]}</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-bankroll`} className="sv-label mb-1 block">Bankroll (€)</label>
        <input id={`${id}-bankroll`} type="text" inputMode="decimal" value={bankrollInput} onChange={e => onBankroll(e.target.value)}
          aria-invalid={bankroll === null} aria-describedby={`${id}-bankroll-help`}
          className={`h-8 w-32 rounded border bg-raised px-2 text-sm text-ink num ${bankroll === null ? 'border-warn' : 'border-line'}`} />
        <div id={`${id}-bankroll-help`} className="text-2xs text-ink-4 mt-1">{bankroll === null ? 'Montant invalide : entre 1 et 1 000 000 €.' : 'Mémorisée dans ce navigateur.'}</div>
      </div>
    </div>
  );
};

export const SuggestionsControls: React.FC<{
  index: SuggestionsIndex; profile: SuggestionProfile; onProfile: (p: SuggestionProfile) => void;
  bankrollInput: string; bankroll: number | null; onBankroll: (raw: string) => void; onShowHistory?: () => void;
}> = ({ index, profile, onProfile, bankrollInput, bankroll, onBankroll, onShowHistory }) => {
  const bilan = index.bilan?.profiles?.[profile];
  const o = bilan?.overall;
  const journal = index.journal?.byProfile?.[profile];
  const evenings = index.evenings ?? [];
  const last = evenings[evenings.length - 1];
  return (
    <Panel title="Suggestions de paris" subtitle={`Cotes ${index.bookmaker}, suggestions calculées le ${new Date(index.generatedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Mises indicatives sur votre bankroll ; rien n'est placé automatiquement.`}>
      <ProfileBankroll profile={profile} onProfile={onProfile} bankrollInput={bankrollInput} bankroll={bankroll} onBankroll={onBankroll} />
      {onShowHistory && (
        <p className="text-xs text-ink-3 mt-3">
          {last ? <>Soirées suivies : {evenings.length}, cumul <span className={`num ${last.cumulative > 0 ? 'text-pos' : last.cumulative < 0 ? 'text-neg' : 'text-ink'}`}>{formatSignedEuros(last.cumulative)}</span>. </> : 'Résultats des suggestions passées : '}
          <button type="button" onClick={onShowHistory} className="text-accent underline underline-offset-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Voir le suivi des paris</button>
        </p>
      )}
      {o && o.bets > 0 ? (
        <StatStrip className="mt-4 grid-cols-2 lg:grid-cols-4">
          <Stat label={`Bilan ${index.season} · ${PROFILE_LABELS[profile]}`} value={`${o.bets} paris`} sub="rejeu sur les matchs joués, cotes du dernier relevé avant coup d'envoi" />
          <Stat label="Réussite" value={o.hitRate === null ? 'N/D' : formatPct(o.hitRate)} sub="paris gagnés (demi-gains comptés)" />
          <Stat label="Rendement à mise fixe" value={o.returnFlat === null ? 'N/D' : formatEv(o.returnFlat)} sub={journal && journal.bets ? `journal réel : ${journal.bets} réglés, ${formatEv(journal.returnFlat ?? 0)}` : 'journal réel : aucun pari réglé'} />
          <Stat label={`Bankroll ${formatEuros(index.bilan!.start)} rejouée`} value={formatEuros(o.finalBankroll)} sub={`pire creux ${formatPct(o.maxDrawdown)}`} />
        </StatStrip>
      ) : (
        <p className="text-xs text-ink-4 mt-3">Bilan de la saison indisponible pour ce profil.</p>
      )}
    </Panel>
  );
};

const SuggestionRow: React.FC<{ s: Suggestion; bankroll: number | null; bilan?: BilanProfile; now: Date }> = ({ s, bankroll, bilan, now }) => {
  const age = oddsAge(s.oddsAt, now);
  const stake = stakeEuros(bankroll, s.stakeFraction);
  const line = bilanLine(bilan, s.family);
  return (
    <li className="py-2 border-t border-line/60 first:border-t-0">
      <div className="hidden sm:grid grid-cols-[1.4rem_minmax(0,1fr)_7rem_5rem_5rem_6rem] items-baseline gap-3 text-sm">
        <span className="text-ink-4 num text-2xs">{s.rank}</span>
        <span className="text-ink min-w-0">{s.label}</span>
        <span className="num text-ink text-right" title={`Cote Winamax relevée à ${age.time}`}>{formatOdds(s.odds)} <span className="text-2xs text-ink-4">{age.time}{age.stale ? ' · ancienne' : ''}</span></span>
        <span className="num text-right text-ink-2" title="Notre probabilité (simulation)">{formatPct(s.p)}</span>
        <span className={`num text-right ${evClass(s.ev)}`} title="Espérance de gain pour 1 € misé">{formatEv(s.ev)}</span>
        <span className="num text-right text-ink" title={stakeLabel(s.stakeMode)}>{bankroll === null ? 'N/D' : formatEuros(stake)}{s.stakeMode === 'fixed' && <span className="text-2xs text-ink-4"> fixe</span>}</span>
      </div>
      <div className="sm:hidden space-y-1 text-sm">
        <div className="text-ink"><span className="text-ink-4 num text-2xs mr-1">{s.rank}</span>{s.label}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 num text-xs">
          <span className="text-ink">cote {formatOdds(s.odds)} <span className="text-ink-4">{age.time}{age.stale ? ' · ancienne' : ''}</span></span>
          <span className="text-ink-2">proba {formatPct(s.p)}</span>
          <span className={evClass(s.ev)}>esp. {formatEv(s.ev)}</span>
          <span className="text-ink">mise {bankroll === null ? 'N/D' : formatEuros(stake)}{s.stakeMode === 'fixed' ? ' (fixe)' : ''}</span>
        </div>
      </div>
      {s.reasons.length > 0 && <div className="text-2xs text-ink-3 mt-1 leading-relaxed">{s.reasons.join(' · ')}</div>}
      {line && <div className="text-2xs text-ink-4 mt-0.5">{line}</div>}
    </li>
  );
};

export const SuggestionsBlock: React.FC<{ match: SuggestionMatch | undefined; profile: SuggestionProfile; bankroll: number | null; bilan?: BilanProfile; open: boolean; now: Date }> =
  ({ match, profile, bankroll, bilan, open, now }) => {
    if (!match || match.status !== 'ok' || !match.profiles) {
      return <div className="px-4 pb-2 text-2xs text-ink-4">Cotes Winamax non disponibles pour ce match.</div>;
    }
    const block = match.profiles[profile];
    const list = block?.suggestions ?? [];
    const combo = block?.combo ?? null;
    const comboStake = combo ? stakeEuros(bankroll, combo.stakeFraction) : 0;
    const comboBilan = bilan?.combos;
    return (
      <details className="px-4 pb-2 group" open={open}>
        <summary className="cursor-pointer text-xs text-ink-2 py-1 select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Suggestions de paris <span className="text-ink-4">· {list.length} {PROFILE_LABELS[profile].toLowerCase()}{match.oddsStale ? ' · cotes anciennes, non suggérées' : ''}</span>
        </summary>
        {list.length === 0 ? (
          <p className="text-2xs text-ink-4 py-1">Aucune sélection admissible pour ce profil (cotes trop basses, anciennes ou famille mal calibrée).</p>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-[1.4rem_minmax(0,1fr)_7rem_5rem_5rem_6rem] gap-3 sv-label text-right mt-1"><span /><span className="text-left">Sélection</span><span>Cote · relevé</span><span>Proba</span><span>Espérance</span><span>Mise</span></div>
            <ul className="list-none m-0 p-0">
              {list.map(s => <SuggestionRow key={`${s.marketId}-${s.outcomeId}`} s={s} bankroll={bankroll} bilan={bilan} now={now} />)}
            </ul>
          </>
        )}
        {combo && (
          <div className="mt-2 rounded border border-line bg-raised/40 px-3 py-2 text-sm">
            <div className="text-ink">Combiné du match : {combo.labels.join(' + ')}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 num text-xs mt-0.5">
              <span className="text-ink">cote {formatOdds(combo.odds)}</span>
              <span className="text-ink-2">proba jointe {formatPct(combo.jointP)}</span>
              <span className={evClass(combo.ev)}>esp. {formatEv(combo.ev)}</span>
              <span className="text-ink">mise {bankroll === null ? 'N/D' : formatEuros(comboStake)}{combo.stakeMode === 'fixed' ? ' (fixe)' : ''}</span>
              {comboBilan && comboBilan.bets > 0 && comboBilan.hitRate !== null && comboBilan.returnFlat !== null && (
                <span className="text-ink-4">combinés cette saison : {comboBilan.bets}, {formatPct(comboBilan.hitRate)} réussis, {formatEv(comboBilan.returnFlat)}</span>
              )}
            </div>
          </div>
        )}
      </details>
    );
  };
