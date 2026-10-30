/**
 * ScoutVision - Chasseur de pépites : traduction d'une demande en langage naturel vers une configuration
 *
 * Le scout décrit le profil recherché ; le serveur (/api/ai/hunter) renvoie une configuration
 * validée contre le catalogue (poste, rôle, contraintes, critères supplémentaires) et les points
 * qu'il n'a pas pu traduire. Rien n'est appliqué sans un clic : les filtres proposés sont affichés
 * et restent modifiables dans les contrôles habituels du Chasseur. Le modèle ne calcule aucun score.
 */

import React, { useId, useRef, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { AiHunterResult, HunterCatalogue, HunterConfig, aiHunter } from '../../services/groundedAiService';
import { ScoutReportError } from '../../services/scoutReportService';
import { metricLabel, positionLabel } from '../../utils/labels';
import { formatEuro } from '../../utils/format';
import { InfoTip, LoadError } from '../ui';
import { metaLine } from './GroundedAiPanel';

const MAX_QUERY = 500;

/** Filtres proposés, en clair, pour que le scout voie ce qui sera appliqué */
export function describeConfig(config: HunterConfig, catalogue: HunterCatalogue): string[] {
  const out: string[] = [];
  if (config.role) out.push(`Rôle : ${config.role}`);
  else if (config.position) out.push(`Poste : ${positionLabel(config.position)}`);
  if (config.ageMax !== undefined) out.push(`Âge ≤ ${config.ageMax} ans`);
  if (config.minutesMin !== undefined) out.push(`Minutes ≥ ${config.minutesMin.toLocaleString('fr-FR')}`);
  if (config.valueMax !== undefined) out.push(config.valueMax === null ? 'Valeur : sans limite' : `Valeur ≤ ${formatEuro(config.valueMax)}`);
  if (config.contractMonths !== undefined) out.push(config.contractMonths === 0 ? 'Contrat : indifférent' : `Contrat ≤ ${config.contractMonths} mois`);
  if (config.estimateAboveMarket) out.push('Estimation statistique au-dessus de la valeur de marché');
  if (config.competition) out.push(`Compétition : ${catalogue.competitions.find(c => c.key === config.competition)?.name ?? config.competition}`);
  config.extraCriteria.forEach(c => out.push(`${metricLabel(c.metric)} ≥ P${c.minPercentile}`));
  return out;
}

export const HunterAssistant: React.FC<{
  catalogue: HunterCatalogue;
  onApply: (config: HunterConfig) => void;
}> = ({ catalogue, onApply }) => {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiHunterResult | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);

  const run = async () => {
    const q = query.trim();
    if (!q) { setError('Décrivez le profil recherché en une ou deux phrases.'); return; }
    setLoading(true); setError(null);
    try { setResult(await aiHunter(q, catalogue)); requestAnimationFrame(() => applyRef.current?.focus()); }
    catch (e) { setError(e instanceof ScoutReportError ? e.message : 'La traduction a échoué. Réessayez.'); }
    finally { setLoading(false); requestAnimationFrame(() => { if (document.activeElement === document.body) buttonRef.current?.focus(); }); }
  };

  if (!open) {
    return (
      <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm w-full justify-start" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${uid}-assistant`}>
        <Wand2 className="w-3.5 h-3.5" aria-hidden /> Décrire le profil recherché (IA)
      </button>
    );
  }
  const lines = result ? describeConfig(result.config, catalogue) : [];
  return (
    <div id={`${uid}-assistant`} className="rounded-md border border-line bg-raised/40 p-2.5 space-y-2">
      <label htmlFor={`${uid}-query`} className="sv-label flex items-center gap-1">
        Profil recherché, en langage naturel
        <InfoTip text="Gemini traduit votre phrase en filtres du Chasseur (rôle, âge, minutes, valeur, contrat, compétition, critères) et ne calcule aucun score : les candidats sont toujours classés par ScoutVision. Les filtres proposés s'affichent avant d'être appliqués et restent modifiables." />
      </label>
      <textarea id={`${uid}-query`} value={query} onChange={e => setQuery(e.target.value.slice(0, MAX_QUERY))} rows={2} maxLength={MAX_QUERY}
        className="sv-input !h-auto py-1.5 resize-y normal-case tracking-normal font-normal block w-full"
        placeholder="ex. un latéral gauche de moins de 24 ans, bon dans les duels, à moins de 10 M€, contrat qui se termine bientôt" />
      <div className="flex flex-wrap items-center gap-2">
        <button ref={buttonRef} type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={run} disabled={loading}>
          {loading ? <span className="w-3 h-3 border-2 border-ink-4 border-t-ink rounded-full animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />}
          {loading ? 'Traduction…' : 'Traduire en filtres'}
        </button>
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => { setOpen(false); setResult(null); setError(null); }}>Fermer</button>
        <span className="text-2xs text-ink-4 num ml-auto">{query.length} / {MAX_QUERY}</span>
      </div>
      {loading && <p role="status" className="text-xs text-ink-3">Traduction en cours…</p>}
      {error && <LoadError message={error} onRetry={run} />}
      {result && !loading && (
        <div className="rounded-md border border-line bg-raised p-2.5 space-y-1.5" aria-live="polite">
          <p className="sv-label">Filtres proposés</p>
          {lines.length ? (
            <ul className="flex flex-wrap gap-1.5">{lines.map(l => <li key={l} className="sv-tag !font-normal normal-case tracking-normal">{l}</li>)}</ul>
          ) : <p className="text-xs text-ink-3">Aucun filtre traduisible dans cette demande.</p>}
          {result.config.explanation && <p className="text-xs text-ink-2">{result.config.explanation}</p>}
          {result.warnings.length > 0 && (
            <p className="text-2xs text-warn">Non traduit : {result.warnings.join(' ; ')}.</p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button ref={applyRef} type="button" className="sv-btn sv-btn-primary sv-btn-sm" onClick={() => onApply(result.config)} disabled={lines.length === 0}>Appliquer ces filtres</button>
            <span className="text-2xs text-ink-4">Puis ajustez-les dans les contrôles ci-dessous.</span>
          </div>
          <p className="text-2xs text-ink-4 num">{metaLine(result.meta, result.promptVersion)}</p>
        </div>
      )}
    </div>
  );
};

export default HunterAssistant;
