/**
 * Assistant IA du jour (onglet Matchs à venir, Labo paris) : pour les matchs choisis, l'IA cherche
 * l'actualité d'avant-match sur le web (absences, compositions, rotation), puis confronte chaque
 * suggestion du moteur à cette actualité et propose un plan court. Elle ne calcule ni probabilité, ni
 * cote, ni mise : les chiffres sont ceux du moteur, la mise en euros vient de la bankroll saisie.
 */

import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { SuggestionProfile, SuggestionsIndex } from '../../services/replayData';
import { BettingPlan, MatchNews, fetchBettingPlan, fetchMatchNews } from '../../services/bettingAiService';
import { LoadError, Panel } from '../ui';
import {
  AssistantVerdict, MAX_ASSISTANT_MATCHES, NEWS_CONCURRENCY, RESPONSIBLE_GAMBLING, VERDICT_LABELS, candidateMatches, defaultSelection, googleSearchUrl,
  mapLimited, planStake, verdictClass,
} from './assistantLogic';
import { PROFILE_LABELS, formatEuros, formatOdds, formatPct, stakeEuros } from './suggestionsLogic';

type Phase = 'idle' | 'news' | 'plan' | 'done' | 'error';
export interface NewsFailure { match: string; message: string }
interface AssistantState { phase: Phase; done: number; total: number; plan: BettingPlan | null; newsErrors: NewsFailure[]; error: string | null; key: string }

// Résultat conservé au changement d'onglet (même logique que l'onglet retenu de la page)
let lastState: AssistantState | null = null;
let lastSelection: string[] | null = null;

const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const VerdictTag: React.FC<{ v: AssistantVerdict }> = ({ v }) => <span className={`text-xs font-medium whitespace-nowrap ${verdictClass(v)}`}>{VERDICT_LABELS[v]}</span>;

const NewsBlock: React.FC<{ news: MatchNews | BettingPlan['matches'][number]['news'] }> = ({ news }) => {
  if (!news) return <p className="text-2xs text-ink-4">Actualité non recherchée pour ce match.</p>;
  return (
    <div className="space-y-1.5">
      <ul className="list-none m-0 p-0 space-y-0.5 text-xs text-ink-2">
        {news.text.split('\n').map((l, i) => <li key={i}>{l.replace(/^-\s*/, '• ')}</li>)}
      </ul>
      {news.sources.length > 0 && (
        <div className="text-2xs text-ink-3">
          Sources :{' '}
          {news.sources.map((s, i) => (
            <React.Fragment key={s.uri}>
              {i > 0 && ', '}
              <a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{s.title}</a>
            </React.Fragment>
          ))}
        </div>
      )}
      {news.queries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs" aria-label="Recherches Google utilisées">
          <span className="text-ink-4">{news.method === 'news-feed' ? 'Recherche :' : 'Recherches Google :'}</span>
          {news.queries.map(q => (
            <a key={q} href={googleSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-2 py-0.5 text-ink-2 hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{q}</a>
          ))}
        </div>
      )}
      {news.method === 'news-feed' && (
        <div className="text-2xs text-warn" title={news.fallbackReason}>
          Recherche Google de Gemini indisponible : actualité tirée {news.articlesRead ? `de ${news.articlesRead} article${news.articlesRead > 1 ? 's' : ''} lu${news.articlesRead > 1 ? 's' : ''} et ` : ''}des titres Google News et Bing News des 4 derniers jours.
        </div>
      )}
      <div className="text-2xs text-ink-4">Recherche du {dateTime(news.fetchedAt)}</div>
    </div>
  );
};

/** Plan du jour et avis par match (présentation seule) */
export const PlanView: React.FC<{ plan: BettingPlan; bankroll: number | null; newsErrors?: NewsFailure[]; stale?: boolean }> = ({ plan, bankroll, newsErrors = [], stale = false }) => (
    <div className="mt-4 space-y-4">
      {stale && <p className="text-2xs text-warn">Sélection ou profil modifiés depuis cette analyse : relancez-la pour les prendre en compte.</p>}
      {(newsErrors.length > 0 || plan.warnings.length > 0) && (
        <ul className="list-none m-0 p-0 text-2xs text-warn space-y-0.5">
          {newsErrors.map(e => <li key={e.match}>Actualité indisponible pour {e.match} : {e.message}</li>)}
          {plan.warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {plan.summary && <p className="text-sm text-ink leading-relaxed">{plan.summary}</p>}

      <section aria-label="Plan du jour">
        <h4 className="sv-label mb-1">Plan du jour · {PROFILE_LABELS[plan.profile as SuggestionProfile] ?? plan.profile}</h4>
        {plan.picks.length === 0 ? (
          <p className="text-xs text-ink-3">Aucune sélection retenue : l'IA conseille de passer son tour sur ces matchs.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="sv-table">
                <thead><tr><th scope="col">Match</th><th scope="col">Sélection</th><th scope="col" className="text-right">Cote</th><th scope="col" className="text-right">Proba</th><th scope="col" className="text-right">Mise</th><th scope="col">Avis</th><th scope="col">Pourquoi</th></tr></thead>
                <tbody>
                  {plan.picks.map(p => (
                    <tr key={p.ref}>
                      <td className="text-ink whitespace-nowrap">{p.match}</td>
                      <td className="text-ink">{p.label}</td>
                      <td className="text-right num text-ink">{formatOdds(p.odds)}</td>
                      <td className="text-right num text-ink-2">{formatPct(p.probability)}</td>
                      <td className="text-right num text-ink">{bankroll === null ? 'N/D' : formatEuros(stakeEuros(bankroll, p.stakeFraction))}</td>
                      <td><VerdictTag v={p.verdict} /></td>
                      <td className="text-ink-2 text-xs">{p.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden list-none m-0 p-0">
              {plan.picks.map(p => (
                <li key={p.ref} className="py-2 border-t border-line/60 first:border-t-0 text-sm">
                  <div className="text-ink">{p.match}</div>
                  <div className="text-ink-2 text-xs">{p.label}</div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 num text-xs mt-0.5">
                    <span className="text-ink">cote {formatOdds(p.odds)}</span>
                    <span className="text-ink-2">proba {formatPct(p.probability)}</span>
                    <span className="text-ink">mise {bankroll === null ? 'N/D' : formatEuros(stakeEuros(bankroll, p.stakeFraction))}</span>
                    <VerdictTag v={p.verdict} />
                  </div>
                  {p.why && <div className="text-2xs text-ink-3 mt-0.5">{p.why}</div>}
                </li>
              ))}
            </ul>
            <p className="text-2xs text-ink-3 mt-1 num">Total misé : {bankroll === null ? 'N/D' : formatEuros(planStake(plan.picks, bankroll))} (mises du moteur sur votre bankroll).</p>
          </>
        )}
        {plan.combo && <p className="text-xs text-ink-2 mt-2"><span className="text-ink">Combiné : </span>{plan.combo.labels.join(' + ')}{plan.combo.why ? ` · ${plan.combo.why}` : ''}</p>}
        {plan.avoid.length > 0 && (
          <div className="text-xs mt-2">
            <span className="text-ink">À éviter : </span>
            {plan.avoid.map((a, i) => <span key={a.matchId} className="text-ink-2">{i > 0 && ' · '}{a.match}{a.why ? ` (${a.why})` : ''}</span>)}
          </div>
        )}
        {plan.discipline && <p className="text-2xs text-ink-3 mt-2">{plan.discipline}</p>}
      </section>

      <section aria-label="Avis par match" className="space-y-2">
        {plan.matches.map(m => (
          <details key={m.matchId} className="rounded border border-line">
            <summary className="cursor-pointer select-none px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span className="text-ink-4 num text-2xs">{time(m.kickoff)}</span>
              <span className="text-ink">{m.match}</span>
              <span className="text-2xs text-ink-3">{m.verdicts.map(v => VERDICT_LABELS[v.verdict]).join(' · ')}</span>
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <ul className="list-none m-0 p-0 space-y-1">
                {m.verdicts.map(v => (
                  <li key={v.ref} className="text-sm">
                    <span className="text-ink">{v.label}</span> <VerdictTag v={v.verdict} />
                    {v.reason && <div className="text-2xs text-ink-3">{v.reason}</div>}
                  </li>
                ))}
              </ul>
              <div>
                <div className="sv-label mb-1">Actualité d'avant-match</div>
                <NewsBlock news={m.news} />
              </div>
            </div>
          </details>
        ))}
      </section>

      <p className="text-2xs text-ink-4">
        Avis généré le {dateTime(plan.meta.generatedAt)} par {plan.meta.model}, sur les suggestions du moteur du {dateTime(plan.meta.suggestionsAt)}. L'IA peut se tromper ou manquer une information : vérifiez les compositions officielles avant le coup d'envoi.
      </p>
    </div>
);

export const BettingAssistant: React.FC<{ index: SuggestionsIndex; profile: SuggestionProfile; bankroll: number | null; now: Date }> = ({ index, profile, bankroll, now }) => {
  const candidates = useMemo(() => candidateMatches(index.matches, now).slice(0, 16), [index, now]);
  const [selected, setSelectedState] = useState<string[]>(() => (lastSelection ?? defaultSelection(index.matches, now)).filter(id => candidates.some(c => c.matchId === id)));
  const setSelected = (ids: string[]) => { lastSelection = ids; setSelectedState(ids); };
  const [refresh, setRefresh] = useState(false);
  const [state, setStateRaw] = useState<AssistantState>(() => lastState ?? { phase: 'idle', done: 0, total: 0, plan: null, newsErrors: [], error: null, key: '' });
  const setState = (s: AssistantState) => { lastState = s; setStateRaw(s); };
  const running = state.phase === 'news' || state.phase === 'plan';

  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : selected.length >= MAX_ASSISTANT_MATCHES ? selected : [...selected, id]);

  const run = async () => {
    const ids = [...selected];
    const key = `${ids.join(',')}|${profile}`;
    let s: AssistantState = { phase: 'news', done: 0, total: ids.length, plan: null, newsErrors: [], error: null, key };
    setState(s);
    const results = await mapLimited(ids, NEWS_CONCURRENCY, id => fetchMatchNews(id, refresh), done => { s = { ...s, done }; setState(s); });
    const names = new Map(candidates.map(m => [m.matchId, `${m.home} – ${m.away}`]));
    const newsErrors = results.flatMap((r, i) => (r.status === 'rejected'
      ? [{ match: names.get(ids[i]) ?? ids[i], message: r.reason instanceof Error ? r.reason.message : 'erreur inconnue' }] : []));
    s = { ...s, phase: 'plan', newsErrors };
    setState(s);
    try {
      const plan = await fetchBettingPlan(ids, profile);
      setState({ ...s, phase: 'done', plan });
    } catch (error) {
      setState({ ...s, phase: 'error', error: error instanceof Error ? error.message : 'La génération a échoué.' });
    }
  };

  const plan = state.plan;
  const stale = plan && state.key !== `${selected.join(',')}|${profile}`;

  return (
    <Panel title="Assistant IA du jour" icon={Sparkles}
      subtitle="L'IA cherche l'actualité d'avant-match sur le web (absences, compositions, rotation), que le moteur ne voit pas, et dit pour chaque suggestion s'il faut la garder, la prendre avec prudence ou l'éviter. Elle ne calcule ni probabilité, ni cote, ni mise.">
      {candidates.length === 0 ? (
        <p className="text-xs text-ink-3">Aucun match à venir avec des cotes : rien à analyser pour l'instant.</p>
      ) : (
        <fieldset disabled={running}>
          <legend className="sv-label mb-1">Matchs à analyser ({selected.length}/{MAX_ASSISTANT_MATCHES} au plus) · profil {PROFILE_LABELS[profile]}</legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map(m => (
              <label key={m.matchId} className="flex items-baseline gap-2 text-sm min-w-0 cursor-pointer">
                <input type="checkbox" className="accent-accent shrink-0" checked={selected.includes(m.matchId)} onChange={() => toggle(m.matchId)}
                  disabled={!selected.includes(m.matchId) && selected.length >= MAX_ASSISTANT_MATCHES} />
                <span className="text-ink-4 num text-2xs shrink-0">{m.kickoff ? dateTime(m.kickoff) : m.date}</span>
                <span className="text-ink min-w-0 sm:truncate" title={`${m.home} – ${m.away}`}>{m.home} – {m.away}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button type="button" onClick={() => { void run(); }} disabled={!selected.length || running}
              className="sv-btn sv-btn-primary">
              {plan ? 'Relancer l\'analyse' : `Analyser ${selected.length} match${selected.length > 1 ? 's' : ''}`}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
              <input type="checkbox" className="accent-accent" checked={refresh} onChange={e => setRefresh(e.target.checked)} />
              Forcer une nouvelle recherche d'actualité (compositions publiées environ 1 h avant le match)
            </label>
          </div>
          <p className="text-2xs text-ink-4 mt-1">Environ 20 s à 1 min 30 : une recherche Google par match, puis le plan. L'actualité reste en cache 90 min sur le serveur.</p>
        </fieldset>
      )}

      {running && (
        <p role="status" className="text-xs text-ink-2 mt-3">
          {state.phase === 'news' ? `Recherche de l'actualité : ${state.done}/${state.total} match${state.total > 1 ? 's' : ''}…` : 'Construction du plan du jour…'}
        </p>
      )}
      {state.phase === 'error' && <LoadError className="mt-3" message={state.error ?? 'La génération a échoué.'} onRetry={() => { void run(); }} />}

      {plan && !running && <PlanView plan={plan} bankroll={bankroll} newsErrors={state.newsErrors} stale={!!stale} />}
      <p className="text-2xs text-ink-4 mt-3 border-t border-line pt-2">{RESPONSIBLE_GAMBLING}</p>
    </Panel>
  );
};

export default BettingAssistant;
