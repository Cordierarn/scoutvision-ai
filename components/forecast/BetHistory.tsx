/**
 * Onglet « Suivi des paris » de Pronostics (Labo paris) : ce qui a été suggéré avant chaque match et ce que
 * cela a donné. Deux lectures, toutes deux calculées par le pipeline :
 * - les soirées suivies (profil Équilibré, mises du moteur sur 300 €), pari par pari avec le net et le cumul ;
 * - les suggestions publiées des 14 derniers jours pour le profil choisi : dernière publication avant le coup
 *   d'envoi, réglée sur le score réel. Seule la mise en euros vient ici de la bankroll saisie.
 */

import React from 'react';
import type { BetStatus, EveningBet, EveningSummary, HistoryBet, HistoryMatch, SuggestionProfile, SuggestionsIndex } from '../../services/replayData';
import { CompetitionBadge } from '../Media';
import { EmptyState, LoadError, Panel, Skeleton, Stat, StatStrip } from '../ui';
import { ProfileBankroll } from './Suggestions';
import { RESPONSIBLE_GAMBLING } from './assistantLogic';
import {
  CIRCUIT_NOTE, PROFILE_LABELS, STATUS_LABELS, betNet, formatClv, formatEuros, formatEv, formatOdds, formatPct, formatSignedEuros, historySummary, sharpLabel, stakeEuros, statusClass,
} from './suggestionsLogic';

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const kickTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const signedClass = (v: number | null) => (v === null ? 'text-ink-3' : v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-ink-2');

const StatusTag: React.FC<{ status: BetStatus }> = ({ status }) => (
  <span className={`text-xs font-medium whitespace-nowrap ${statusClass(status)}`}>{STATUS_LABELS[status]}</span>
);

// ----- Soirées suivies -----

const EveningRows: React.FC<{ bets: EveningBet[] }> = ({ bets }) => (
  <>
    <div className="hidden md:block overflow-x-auto">
      <table className="sv-table">
        <thead><tr><th scope="col">Match</th><th scope="col">Sélection</th><th scope="col" className="text-right">Cote</th><th scope="col" className="text-right">Mise</th><th scope="col">Résultat</th><th scope="col" className="text-right">Net</th></tr></thead>
        <tbody>
          {bets.map((b, i) => (
            <tr key={`${b.match}-${b.label}-${i}`}>
              <td className="text-ink">{b.legs > 0 ? `Combiné ${b.legs} sélections` : b.match}</td>
              <td className="text-ink-2">{b.label}</td>
              <td className="text-right num text-ink">{formatOdds(b.odds)}</td>
              <td className="text-right num text-ink-2">{formatEuros(b.stake)}</td>
              <td><StatusTag status={b.status} /></td>
              <td className={`text-right num ${signedClass(b.profit)}`}>{b.profit === null ? '–' : formatSignedEuros(b.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <ul className="md:hidden list-none m-0 p-0">
      {bets.map((b, i) => (
        <li key={`${b.match}-${b.label}-${i}`} className="py-2 border-t border-line/60 first:border-t-0 text-sm">
          <div className="text-ink">{b.legs > 0 ? `Combiné ${b.legs} sélections` : b.match}</div>
          <div className="text-ink-2 text-xs">{b.label}</div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 num text-xs mt-0.5">
            <span className="text-ink">cote {formatOdds(b.odds)}</span>
            <span className="text-ink-2">mise {formatEuros(b.stake)}</span>
            <StatusTag status={b.status} />
            <span className={signedClass(b.profit)}>{b.profit === null ? '' : formatSignedEuros(b.profit)}</span>
          </div>
        </li>
      ))}
    </ul>
  </>
);

/** Paris gagnés et en attente d'une soirée : lus pari par pari quand le détail est publié. */
function eveningCounts(e: EveningSummary): { won: number; pending: number } {
  if (!e.details) return { won: e.won, pending: e.settled ? 0 : e.bets };
  return {
    won: e.details.filter(b => b.status === 'won' || b.status === 'half_won').length,
    pending: e.details.filter(b => b.status === 'pending').length,
  };
}

const Evenings: React.FC<{ evenings: EveningSummary[] }> = ({ evenings }) => {
  const latestFirst = [...evenings].reverse();
  const last = evenings[evenings.length - 1];
  const counts = evenings.map(eveningCounts);
  const won = counts.reduce((n, c) => n + c.won, 0);
  const pending = counts.reduce((n, c) => n + c.pending, 0);
  return (
    <Panel title="Soirées suivies" subtitle="Profil Équilibré, mises du moteur sur une bankroll de 300 € : chaque soir, la dernière suggestion publiée avant chaque coup d'envoi, réglée sur le score réel au passage du matin.">
      <StatStrip className="grid-cols-2 lg:grid-cols-4 gap-y-3 max-lg:[&>*:nth-child(3)]:pl-0 max-lg:[&>*:nth-child(3)]:!border-l-0 mb-4">
        <Stat label="Soirées" value={String(evenings.length)} sub={`${evenings.filter(e => e.settled).length} entièrement réglées`} />
        <Stat label="Paris" value={String(evenings.reduce((n, e) => n + e.bets, 0))} sub={`${won} gagnés, ${pending} en attente`} />
        <Stat label="Misé" value={formatEuros(evenings.reduce((n, e) => n + e.stake, 0))} />
        <Stat label="Cumul net" value={formatSignedEuros(last.cumulative)} tone={last.cumulative > 0 ? 'pos' : last.cumulative < 0 ? 'neg' : 'default'} />
      </StatStrip>
      <div className="space-y-2">
        {latestFirst.map((e, i) => {
          const c = eveningCounts(e);
          return (
          <details key={e.date} className="rounded border border-line" open={i === 0}>
            <summary className="cursor-pointer select-none px-3 py-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span className="text-ink first-letter:uppercase">{dayLabel(e.date)}</span>
              <span className="text-ink-3 text-xs num">{e.bets} paris · {c.won} gagnés{c.pending ? ` · ${c.pending} en attente` : ''} · misé {formatEuros(e.stake)}</span>
              <span className={`num text-xs ${signedClass(e.profit)}`}>net {e.profit === null ? '–' : formatSignedEuros(e.profit)}</span>
              <span className="num text-xs text-ink-3">cumul {formatSignedEuros(e.cumulative)}</span>
            </summary>
            <div className="px-3 pb-2">
              {e.details && e.details.length > 0
                ? <EveningRows bets={e.details} />
                : <p className="text-2xs text-ink-4 py-1">Détail des paris non publié pour cette soirée.</p>}
            </div>
          </details>
          );
        })}
      </div>
    </Panel>
  );
};

// ----- Suggestions publiées et réglées, par profil -----

const HISTORY_GRID = 'grid-cols-[minmax(0,1fr)_4rem_4.5rem_4.5rem_5.5rem_7rem_5.5rem]';

const HistoryBetRow: React.FC<{ b: HistoryBet; bankroll: number | null }> = ({ b, bankroll }) => {
  const net = betNet(bankroll, b);
  const clv = formatClv(b.clv);
  return (
    <li className="py-1.5 border-t border-line/60 first:border-t-0">
      <div className={`hidden sm:grid ${HISTORY_GRID} items-baseline gap-3 text-sm`}>
        <span className="text-ink min-w-0">{b.label}</span>
        <span className="num text-right text-ink">{formatOdds(b.odds)}</span>
        <span className="num text-right text-ink-2" title={sharpLabel(b) ?? 'Probabilité de la simulation au moment de la suggestion'}>{formatPct(b.pSharp ?? b.p)}</span>
        <span className={`num text-right ${clv === null ? 'text-ink-4' : signedClass(b.clv ?? null)}`} title="CLV : cote prise face à la cote juste de clôture (Pinnacle ou Betfair sans marge)">{clv ?? '–'}</span>
        <span className="num text-right text-ink-2">{bankroll === null ? 'N/D' : formatEuros(stakeEuros(bankroll, b.stakeFraction))}</span>
        <span><StatusTag status={b.status} /></span>
        <span className={`num text-right ${signedClass(net)}`}>{net === null ? '–' : formatSignedEuros(net)}</span>
      </div>
      <div className="sm:hidden text-sm">
        <div className="text-ink">{b.label}</div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 num text-xs mt-0.5">
          <span className="text-ink">cote {formatOdds(b.odds)}</span>
          {clv !== null && <span className={signedClass(b.clv ?? null)}>CLV {clv}</span>}
          <span className="text-ink-2">mise {bankroll === null ? 'N/D' : formatEuros(stakeEuros(bankroll, b.stakeFraction))}</span>
          <StatusTag status={b.status} />
          {net !== null && <span className={signedClass(net)}>{formatSignedEuros(net)}</span>}
        </div>
      </div>
    </li>
  );
};

const HistoryMatchBlock: React.FC<{ m: HistoryMatch; bets: HistoryBet[]; bankroll: number | null }> = ({ m, bets, bankroll }) => (
  <div className="px-4 py-2 border-t border-line first:border-t-0">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="text-ink-4 num text-2xs">{kickTime(m.kickoff)}</span>
      <span className="text-ink font-medium">{m.home ?? '?'} – {m.away ?? '?'}</span>
      <span className={`num ${m.score ? 'text-ink' : 'text-ink-4 text-xs'}`}>{m.score ? `${m.score[0]}-${m.score[1]}` : 'score à venir'}</span>
      <span className="text-2xs text-ink-3"><CompetitionBadge competition={m.competition} /></span>
    </div>
    <ul className="list-none m-0 p-0 mt-1">
      {bets.map((b, i) => <HistoryBetRow key={`${b.label}-${i}`} b={b} bankroll={bankroll} />)}
    </ul>
  </div>
);

type BetHistoryProps = {
  index: SuggestionsIndex | null | undefined; failed?: boolean; onRetry?: () => void;
  profile: SuggestionProfile; onProfile: (p: SuggestionProfile) => void;
  bankrollInput: string; bankroll: number | null; onBankroll: (raw: string) => void;
};

/** Onglet Suivi des paris : le message de jeu responsable reste visible sous chaque état (chargement, absence, erreur, contenu). */
export const BetHistory: React.FC<BetHistoryProps> = props => (
  <div className="space-y-4">
    <BetHistoryContent {...props} />
    <p className="text-2xs text-ink-4 border-t border-line pt-2">{RESPONSIBLE_GAMBLING}</p>
  </div>
);

const BetHistoryContent: React.FC<BetHistoryProps> = ({ index, failed = false, onRetry, profile, onProfile, bankrollInput, bankroll, onBankroll }) => {
  if (failed) return <LoadError message="Suivi des paris indisponible : chargement impossible." onRetry={onRetry} />;
  if (index === undefined) return <div role="status" aria-label="Chargement du suivi des paris"><Skeleton className="h-64" /></div>;
  if (index === null) {
    return <EmptyState title="Suivi des paris indisponible.">Les suggestions de paris ne sont pas publiées sur ce serveur.</EmptyState>;
  }
  const evenings = index.evenings ?? [];
  const days = (index.history ?? []).map(d => ({ ...d, matches: d.matches.filter(m => (m.profiles[profile] ?? []).length > 0) })).filter(d => d.matches.length > 0);
  const summary = historySummary(index.history ?? [], profile, bankroll);
  return (
    <div className="space-y-4">
      {evenings.length > 0 && <Evenings evenings={evenings} />}

      <Panel title="Suggestions publiées et résultats" subtitle={`14 derniers jours : pour chaque match commencé, la dernière suggestion publiée avant le coup d'envoi, réglée sur le score réel (passage du matin). Mises calculées sur votre bankroll.`}>
        <ProfileBankroll profile={profile} onProfile={onProfile} bankrollInput={bankrollInput} bankroll={bankroll} onBankroll={onBankroll} />
        {summary.bets > 0 && (
          <StatStrip className="mt-4 grid-cols-2 lg:grid-cols-4 gap-y-3 max-lg:[&>*:nth-child(3)]:pl-0 max-lg:[&>*:nth-child(3)]:!border-l-0">
            <Stat label={`Paris · ${PROFILE_LABELS[profile]}`} value={String(summary.bets)} sub={`${summary.settled} réglés, ${summary.bets - summary.settled} en attente`} />
            <Stat label="Réussite" value={summary.hitRate === null ? 'N/D' : formatPct(summary.hitRate)} sub="hors remboursements, demi-gains comptés" />
            <Stat label="Misé (réglés)" value={bankroll === null ? 'N/D' : formatEuros(summary.staked)} />
            <Stat label="Net (réglés)" value={bankroll === null ? 'N/D' : formatSignedEuros(summary.net)} tone={summary.net > 0 ? 'pos' : summary.net < 0 ? 'neg' : 'default'}
              sub={bankroll !== null && summary.staked > 0 ? `rendement ${formatEv(summary.net / summary.staked)}` : undefined} />
          </StatStrip>
        )}
        {(() => {
          const j = index.journal?.byProfile?.[profile];
          return j && j.closeBets ? (
            <p className="text-xs text-ink-2 mt-3">
              <span className="text-ink">Cote du matin face à la clôture Winamax : {formatEv(j.earlyEdge ?? 0)}</span> en moyenne sur {j.closeBets} pari{j.closeBets > 1 ? 's' : ''} ; la cote a baissé ensuite dans {formatPct(j.oddsDroppedRate ?? 0)} des cas.
              {' '}Positif : parier au moment de la publication rapportait plus que d'attendre le coup d'envoi.
            </p>
          ) : null;
        })()}
        {summary.clvBets > 0 && (
          <p className="text-xs text-ink-2 mt-3">
            <span className="text-ink">CLV moyen {formatClv(summary.meanClv)}</span> sur {summary.clvBets} pari{summary.clvBets > 1 ? 's' : ''} avec clôture sharp connue, {formatPct(summary.clvBeatRate ?? 0)} la battent.
            {' '}Le CLV (cote prise face à la cote juste de clôture) juge la sélection plus vite que le résultat, qui dépend surtout du hasard sur quelques dizaines de paris.
          </p>
        )}
      </Panel>

      {days.length === 0 ? (
        <EmptyState title={`Aucune suggestion ${PROFILE_LABELS[profile]} sur un match commencé ces 14 derniers jours.`}>
          Le suivi commence avec les suggestions publiées depuis le 3 novembre 2026 ; un match apparaît ici dès son coup d'envoi, et son résultat après le passage du matin.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {days.map(d => (
            <section key={d.date} className="sv-panel overflow-hidden" aria-label={dayLabel(d.date)}>
              <div className="px-4 h-8 flex items-center border-b border-line sv-label !text-ink-2 first-letter:uppercase">{dayLabel(d.date)}</div>
              <div className={`hidden sm:grid ${HISTORY_GRID} gap-3 sv-label text-right px-4 pt-2`}>
                <span className="text-left">Sélection</span><span>Cote</span><span>Proba</span><span>CLV</span><span>Mise</span><span className="text-left">Résultat</span><span>Net</span>
              </div>
              {d.matches.map(m => <HistoryMatchBlock key={m.matchId} m={m} bets={m.profiles[profile] ?? []} bankroll={bankroll} />)}
            </section>
          ))}
        </div>
      )}
      <p className="text-2xs text-ink-4">Cotes {index.bookmaker}. {index.reference ? `${CIRCUIT_NOTE} ` : ''}Les combinés des soirées suivies figurent en haut de page. Mises indicatives : rien n'est placé automatiquement.</p>
    </div>
  );
};

export default BetHistory;
