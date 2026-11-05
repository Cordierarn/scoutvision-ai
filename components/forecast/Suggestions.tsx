/**
 * Suggestions de paris (Labo paris) dans l'onglet Matchs à venir : profils, bankroll, bloc repliable par match
 * avec les sélections qui ont passé le coupe-circuit (référence Pinnacle / Betfair sans marge, espérance
 * minimale, Kelly rétréci), ou « pas de pari » avec le motif, et le bilan du type de suggestion sur la saison.
 * Les probabilités, espérances et fractions de mise viennent de l'artefact du pipeline ; seule la mise en
 * euros est calculée ici à partir de la bankroll saisie.
 */

import React, { useId } from 'react';
import type { BilanProfile, Suggestion, SuggestionMatch, SuggestionProfile, SuggestionsIndex } from '../../services/replayData';
import { InfoTip, Panel, Stat, StatStrip } from '../ui';
import { CIRCUIT_NOTE, PROFILE_HINTS, PROFILE_LABELS, PROFILE_ORDER, bilanLine, formatClv, formatEuros, formatEv, formatOdds, formatPct, formatSignedEuros, oddsAge, sharpLabel, stakeEuros, stakeLabel } from './suggestionsLogic';

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
    <Panel title="Suggestions de paris" subtitle={`Cotes ${index.bookmaker}, suggestions calculées le ${new Date(index.generatedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. ${index.reference ? CIRCUIT_NOTE + ' ' : ''}Mises indicatives sur votre bankroll ; rien n'est placé automatiquement.`}>
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
          {o.clvBets ? (
            <Stat label="CLV moyen" value={formatClv(o.meanClv) ?? 'N/D'} tone={(o.meanClv ?? 0) > 0 ? 'pos' : (o.meanClv ?? 0) < 0 ? 'neg' : 'default'}
              sub={`${o.clvBets} paris avec clôture sharp, ${o.clvBeatRate === null || o.clvBeatRate === undefined ? 'N/D' : formatPct(o.clvBeatRate)} la battent`} />
          ) : (
            <Stat label={`Bankroll ${formatEuros(index.bilan!.start)} rejouée`} value={formatEuros(o.finalBankroll)} sub={`pire creux ${formatPct(o.maxDrawdown)}`} />
          )}
        </StatStrip>
      ) : o ? (
        <p className="text-xs text-ink-4 mt-3">Rejeu {index.season} : aucune sélection validée par le coupe-circuit pour ce profil. La référence sharp (Pinnacle, Betfair) n'est archivée que depuis le 5 novembre 2026 : le rejeu compte un pari à partir des matchs qui en ont une.</p>
      ) : (
        <p className="text-xs text-ink-4 mt-3">Bilan de la saison indisponible pour ce profil.</p>
      )}
    </Panel>
  );
};

const GRID = 'grid-cols-[1.4rem_minmax(0,1fr)_7rem_4.5rem_4.5rem_5rem_6rem]';

const SuggestionRow: React.FC<{ s: Suggestion; bankroll: number | null; bilan?: BilanProfile; now: Date }> = ({ s, bankroll, bilan, now }) => {
  const age = oddsAge(s.oddsAt, now);
  const stake = stakeEuros(bankroll, s.stakeFraction);
  const line = bilanLine(bilan, s.family);
  const sharp = sharpLabel(s);
  const ev = s.evRef ?? s.ev;
  const warnings = s.warnings ?? [];
  return (
    <li className="py-2 border-t border-line/60 first:border-t-0">
      <div className={`hidden sm:grid ${GRID} items-baseline gap-3 text-sm`}>
        <span className="text-ink-4 num text-2xs">{s.rank}</span>
        <span className="text-ink min-w-0">{s.label}</span>
        <span className="num text-ink text-right" title={`Cote Winamax relevée à ${age.time}`}>{formatOdds(s.odds)} <span className="text-2xs text-ink-4">{age.time}{age.stale ? ' · ancienne' : ''}</span></span>
        <span className="num text-right text-ink-2" title="Probabilité de la simulation ScoutVision">{formatPct(s.p)}</span>
        <span className="num text-right text-ink-2" title={sharp ?? 'Pas de référence sharp'}>{s.pSharp === null || s.pSharp === undefined ? '–' : formatPct(s.pSharp)}</span>
        <span className={`num text-right ${evClass(ev)}`} title="Espérance pour 1 € misé, cote Winamax face à la probabilité de référence">{formatEv(ev)}</span>
        <span className="num text-right text-ink" title={stakeLabel(s.stakeMode)}>{bankroll === null ? 'N/D' : formatEuros(stake)}{s.stakeMode === 'fixed' && <span className="text-2xs text-ink-4"> fixe</span>}</span>
      </div>
      <div className="sm:hidden space-y-1 text-sm">
        <div className="text-ink"><span className="text-ink-4 num text-2xs mr-1">{s.rank}</span>{s.label}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 num text-xs">
          <span className="text-ink">cote {formatOdds(s.odds)} <span className="text-ink-4">{age.time}{age.stale ? ' · ancienne' : ''}</span></span>
          <span className="text-ink-2">moteur {formatPct(s.p)}</span>
          {s.pSharp !== null && s.pSharp !== undefined && <span className="text-ink-2">sharp {formatPct(s.pSharp)}</span>}
          <span className={evClass(ev)}>esp. {formatEv(ev)}</span>
          <span className="text-ink">mise {bankroll === null ? 'N/D' : formatEuros(stake)}{s.stakeMode === 'fixed' ? ' (fixe)' : ''}</span>
        </div>
      </div>
      {warnings.length > 0 && <div className="text-2xs text-warn mt-1">{warnings.map(w => WARNING_TEXT[w] ?? w).join(' · ')}</div>}
      {s.reasons.length > 0 && <div className="text-2xs text-ink-3 mt-1 leading-relaxed">{s.reasons.join(' · ')}</div>}
      {line && <div className="text-2xs text-ink-4 mt-0.5">{line}</div>}
    </li>
  );
};

const WARNING_TEXT: Record<string, string> = {
  dependance_joueur_cle: 'Composition inconnue et équipe dépendante d\'un joueur clé : plafond de mise réduit de moitié.',
  limite_inconnue: 'Limite de mise du bookmaker de référence inconnue : le mouvement sharp n\'est lu que sur les prix.',
};

/** Match sans sélection : la meilleure idée du moteur et pourquoi le coupe-circuit l'a refusée. */
const NoBetNote: React.FC<{ match: SuggestionMatch }> = ({ match }) => {
  const nb = match.noBet;
  if (!nb) return <p className="text-2xs text-ink-4 py-1">Aucune sélection admissible pour ce profil (cotes trop basses, anciennes ou famille mal calibrée).</p>;
  const sharp = nb.pSharp === null ? 'sans référence sharp' : `marché sharp ${formatPct(nb.pSharp)}`;
  const ev = nb.evRef === null ? '' : `, espérance ${formatEv(nb.evRef)}`;
  return (
    <div className="text-2xs py-1 space-y-0.5">
      <div className="text-ink-2"><span className="text-ink font-medium">Pas de pari.</span> Meilleure idée du moteur : {nb.label} à {formatOdds(nb.odds)} (moteur {formatPct(nb.p)}, {sharp}{ev}).</div>
      <div className="text-ink-3">Refusée : {nb.reasons.join(' ; ')}.</div>
    </div>
  );
};

export const SuggestionsBlock: React.FC<{ match: SuggestionMatch | undefined; profile: SuggestionProfile; bankroll: number | null; bilan?: BilanProfile; open: boolean; now: Date }> =
  ({ match, profile, bankroll, bilan, open, now }) => {
    if (!match || match.status !== 'ok' || !match.profiles) {
      // cotes relevées mais non rafraîchies depuis plus de 2 h : le moteur n'évalue rien (une cote périmée n'est pas une cote)
      const stale = match?.oddsStale && match.oddsAt ? `Cotes Winamax non rafraîchies depuis le ${new Date(match.oddsAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} : match non évalué.` : null;
      return <div className="px-4 pb-2 text-2xs text-ink-4">{stale ?? 'Cotes Winamax non disponibles pour ce match.'}</div>;
    }
    const block = match.profiles[profile];
    const list = block?.suggestions ?? [];
    const combo = block?.combo ?? null;
    const comboStake = combo ? stakeEuros(bankroll, combo.stakeFraction) : 0;
    const comboBilan = bilan?.combos;
    return (
      <details className="px-4 pb-2 group" open={open}>
        <summary className="cursor-pointer text-xs text-ink-2 py-1 select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Suggestions de paris <span className="text-ink-4">· {list.length ? `${list.length} ${PROFILE_LABELS[profile].toLowerCase()}` : 'pas de pari'}{match.oddsStale ? ' · cotes anciennes, non suggérées' : ''}{match.sharpCoverage !== undefined && match.sharpCoverage !== null && match.sharpCoverage < 1 ? ` · référence sharp sur ${formatPct(match.sharpCoverage)} des marchés` : ''}</span>
        </summary>
        {list.length === 0 ? (
          <NoBetNote match={match} />
        ) : (
          <>
            <div className={`hidden sm:grid ${GRID} gap-3 sv-label text-right mt-1`}><span /><span className="text-left">Sélection</span><span>Cote · relevé</span><span>Moteur</span><span>Sharp</span><span>Espérance</span><span>Mise</span></div>
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
