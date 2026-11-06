/**
 * Onglet « Mon test » (Pronostics, Labo paris) : la bankroll personnelle de l'utilisateur, partie de 20 €, et les paris
 * qu'il a réellement placés à partir du plan de l'assistant IA (bouton « Suivre » dans Matchs à venir). Règlement
 * automatique sur l'historique publié par le pipeline, réglage manuel en secours. Données gardées dans ce navigateur.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import type { BetStatus, SuggestionsIndex } from '../../services/replayData';
import { EmptyState, LoadError, Panel, Skeleton, Stat, StatStrip } from '../ui';
import { MyTest as MyTestData, SettledBet, byEvening, emptyTest, parseAmount, parseMyTest, removeBet, saveMyTest, settle, summarise, updateBet } from './myTestLogic';
import { useMyTest } from './useMyTest';
import { PROFILE_LABELS, STATUS_LABELS, formatEuros, formatOdds, formatSignedEuros, statusClass } from './suggestionsLogic';
import { RESPONSIBLE_GAMBLING } from './assistantLogic';

const signedTone = (v: number): 'pos' | 'neg' | 'default' => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'default');
const signedClass = (v: number | null) => (v === null ? 'text-ink-3' : v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-ink-2');
const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const eveningLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const MANUAL: BetStatus[] = ['won', 'lost', 'void', 'half_won', 'half_lost'];

/** Champ de montant validé à la sortie du champ (virgule acceptée). */
const AmountInput: React.FC<{ value: number; label: string; min?: number; onCommit: (v: number) => void }> = ({ value, label, min = 0, onCommit }) => {
  const [raw, setRaw] = useState<string | null>(null);
  const commit = () => {
    const v = raw === null ? null : parseAmount(raw);
    if (v !== null && v > min && v !== value) onCommit(v);
    setRaw(null);
  };
  return (
    <input type="text" inputMode="decimal" aria-label={label} className="sv-input sv-input-sm w-16 text-right num"
      value={raw ?? value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      onChange={e => setRaw(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
};

const BetRow: React.FC<{ bet: SettledBet; test: MyTestData }> = ({ bet, test }) => {
  const pending = bet.status === 'pending' && !bet.manualStatus;
  return (
    <li className="py-2 border-t border-line/60 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm text-ink"><span className="text-ink-4 num text-2xs mr-2">{time(bet.kickoff)}</span>{bet.match}</div>
          <div className="text-xs text-ink-2">{bet.label} <span className="text-ink-4">· {PROFILE_LABELS[bet.profile as keyof typeof PROFILE_LABELS] ?? bet.profile}</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <label className="flex items-center gap-1 text-ink-3">cote
            {pending ? <AmountInput value={bet.odds} label={`Cote prise pour ${bet.label}`} min={1} onCommit={odds => saveMyTest(updateBet(test, bet.id, { odds }))} />
              : <span className="num text-ink">{formatOdds(bet.odds)}</span>}
          </label>
          <label className="flex items-center gap-1 text-ink-3">mise
            {pending ? <AmountInput value={bet.stake} label={`Mise sur ${bet.label}`} onCommit={stake => saveMyTest(updateBet(test, bet.id, { stake }))} />
              : <span className="num text-ink">{formatEuros(bet.stake)}</span>}
          </label>
          <span className={`font-medium ${statusClass(bet.status)}`}>{STATUS_LABELS[bet.status]}{bet.status !== 'pending' && <span className="text-ink-4 font-normal">{bet.auto ? ' · auto' : ' · manuel'}</span>}</span>
          <span className={`num w-20 text-right ${signedClass(bet.net)}`}>{bet.net === null ? '–' : formatSignedEuros(bet.net)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <label className="flex items-center gap-1 text-2xs text-ink-3">
          Régler à la main
          <select className="sv-select sv-select-sm" value={bet.manualStatus ?? ''} aria-label={`Règlement manuel de ${bet.label}`}
            onChange={e => saveMyTest(updateBet(test, bet.id, { manualStatus: (e.target.value || undefined) as BetStatus | undefined }))}>
            <option value="">{bet.auto ? 'Automatique' : 'Non réglé'}</option>
            {MANUAL.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => saveMyTest(removeBet(test, bet.id))}>Retirer</button>
      </div>
    </li>
  );
};

export const MyTestView: React.FC<{ index: SuggestionsIndex | null | undefined; failed?: boolean; onRetry?: () => void }> = ({ index, failed = false, onRetry }) => {
  const test = useMyTest();
  const history = index?.history ?? [];
  const settled = useMemo(() => settle(test, history), [test, history]);
  const summary = summarise(test, settled);
  const evenings = byEvening(settled);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(test, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mon-test-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseMyTest(await file.text());
    if (!parsed) { setImportError('Fichier illisible : choisissez un export de « Mon test ».'); return; }
    setImportError(null);
    saveMyTest(parsed);
  };
  const reset = () => {
    if (window.confirm(`Effacer les ${test.bets.length} paris suivis et repartir de ${formatEuros(test.start)} ?`)) saveMyTest(emptyTest());
  };

  return (
    <div className="space-y-4">
      <Panel title="Mon test" icon={Wallet}
        subtitle="Votre bankroll personnelle et les paris que vous placez vraiment, ajoutés depuis le plan de l'assistant IA (Matchs à venir, bouton « Suivre »). La mise proposée applique la fraction du moteur à votre bankroll disponible ; cote et mise restent modifiables tant que le pari n'est pas réglé.">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <label className="text-xs text-ink-2">
            <span className="sv-label block mb-1">Bankroll de départ</span>
            <span className="flex items-center gap-1"><AmountInput value={test.start} label="Bankroll de départ en euros" onCommit={start => saveMyTest({ ...test, start })} /> €</span>
          </label>
          <span className="text-2xs text-ink-4">Test commencé le {new Date(test.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
        <StatStrip className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-3">
          <Stat label="Bankroll" value={formatEuros(summary.bankroll)} sub={`départ ${formatEuros(test.start)}`} />
          <Stat label="Disponible" value={formatEuros(summary.available)} sub={summary.pending > 0 ? `${formatEuros(summary.pending)} en jeu` : 'rien en jeu'} />
          <Stat label="Gain net" value={formatSignedEuros(summary.net)} tone={signedTone(summary.net)} />
          <Stat label="Rendement" value={summary.roi === null ? '–' : `${summary.roi > 0 ? '+' : summary.roi < 0 ? '−' : ''}${pctFmt.format(Math.abs(summary.roi) * 100)} %`}
            sub={summary.staked > 0 ? `sur ${formatEuros(summary.staked)} misés` : 'aucun pari réglé'} />
          <Stat label="Réglés" value={`${summary.settled} / ${summary.bets}`} sub={`${summary.won} gagné${summary.won > 1 ? 's' : ''}`} />
          <Stat label="Soirées" value={evenings.length} />
        </StatStrip>
      </Panel>

      {failed && <LoadError message="Historique des paris indisponible : le règlement automatique attendra son retour." onRetry={onRetry} />}
      {index === undefined && !failed && test.bets.length > 0 && <div role="status" aria-label="Chargement de l'historique"><Skeleton className="h-24" /></div>}

      {test.bets.length === 0 ? (
        <Panel>
          <EmptyState icon={Wallet} title="Aucun pari suivi pour l'instant.">
            Dans Matchs à venir, choisissez vos matchs, lancez l'assistant IA, puis cliquez « Suivre » sur chaque pari que vous placez : il apparaît ici avec sa mise, puis se règle tout seul après le match.
          </EmptyState>
        </Panel>
      ) : (
        evenings.map(e => (
          <Panel key={e.date} title={eveningLabel(e.date)}
            right={<span className={`num text-sm ${signedClass(e.net)}`}>{e.net === null ? 'en cours' : formatSignedEuros(e.net)}</span>}>
            <ul className="list-none m-0 p-0">{e.bets.map(b => <BetRow key={b.id} bet={b} test={test} />)}</ul>
          </Panel>
        ))
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={exportJson} disabled={!test.bets.length}>Exporter (JSON)</button>
        <button type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={() => fileRef.current?.click()}>Importer</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Fichier d'export de Mon test"
          onChange={e => { void importJson(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={reset} disabled={!test.bets.length}>Réinitialiser</button>
        {importError && <span role="alert" className="text-2xs text-neg">{importError}</span>}
      </div>
      <p className="text-2xs text-ink-4 leading-relaxed">
        Vos paris restent dans ce navigateur, nulle part ailleurs : exportez-les pour les garder ou les reprendre sur un autre appareil. Un pari se règle automatiquement quand la même sélection
        (match, marché, issue) est réglée dans le Suivi des paris ; sinon, réglez-le à la main. Gain net calculé sur la cote que vous avez saisie.
      </p>
      <p className="text-2xs text-ink-4">{RESPONSIBLE_GAMBLING}</p>
    </div>
  );
};

export default MyTestView;
