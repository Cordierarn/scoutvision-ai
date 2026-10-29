/**
 * ScoutVision - panneau partagé d'une fonction d'IA ancrée (texte)
 *
 * Un bouton lance la demande au serveur (/api/ai/*), le texte contrôlé s'affiche avec le modèle
 * réellement utilisé, la version du prompt et la date. Le résultat n'est pas enregistré : il est
 * recalculé à la demande et reste un texte à relire, jamais une évaluation. Sans clé Gemini, le
 * serveur répond 503 et le message s'affiche à la place du texte.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles } from 'lucide-react';
import { ScoutReportError, ScoutReportMeta } from '../../services/scoutReportService';
import { AiTextResult } from '../../services/groundedAiService';
import { InfoTip, LoadError, Panel } from '../ui';

type MdProps = { node?: unknown; children?: React.ReactNode };
const MD = {
  h1: ({ node: _n, ...props }: MdProps) => <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent mt-3 mb-1.5" {...props} />,
  h2: ({ node: _n, ...props }: MdProps) => <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent mt-3 mb-1.5" {...props} />,
  h3: ({ node: _n, ...props }: MdProps) => <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-accent mt-3 mb-1.5" {...props} />,
  strong: ({ node: _n, ...props }: MdProps) => <strong className="text-ink font-semibold" {...props} />,
  ul: ({ node: _n, ...props }: MdProps) => <ul className="space-y-1 my-1.5 pl-4 list-disc marker:text-ink-4" {...props} />,
  li: ({ node: _n, ...props }: MdProps) => <li className="text-ink-2 leading-relaxed" {...props} />,
  p: ({ node: _n, ...props }: MdProps) => <p className="leading-relaxed text-ink-2 mb-2" {...props} />,
};

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
export const metaLine = (meta: ScoutReportMeta | null, promptVersion: string | null) =>
  `Généré par ${meta?.model ?? 'IA'}${meta?.requestedModel && meta.requestedModel !== meta.model ? ` (demandé : ${meta.requestedModel})` : ''} · prompt ${promptVersion ?? 'inconnu'} · ${meta?.generatedAt ? DATE_TIME.format(new Date(meta.generatedAt)) : '—'}`;

export const GroundedAiPanel: React.FC<{
  title: string;
  help: string;
  description: string;         // ce que le texte couvre, en une phrase
  buttonLabel?: string;
  request: () => Promise<AiTextResult>;
  disabled?: boolean;
  disabledReason?: string;
  resetKey?: string;           // changer de sujet efface le résultat précédent
  className?: string;
}> = ({ title, help, description, buttonLabel = 'Générer', request, disabled, disabledReason, resetKey, className }) => {
  const uid = useId();
  const [result, setResult] = useState<AiTextResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setResult(null); setError(null); }, [resetKey]);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await request()); }
    catch (e) { setError(e instanceof ScoutReportError ? e.message : 'La génération a échoué. Réessayez.'); }
    finally {
      setLoading(false);
      // Le bouton était désactivé pendant la demande : le focus lui revient au lieu de retomber sur le document
      requestAnimationFrame(() => { if (document.activeElement === document.body) buttonRef.current?.focus(); });
    }
  };

  return (
    <Panel className={className} icon={Sparkles} title={<>{title} <InfoTip text={help} /></>} subtitle={description}
      right={(
        <button ref={buttonRef} type="button" className="sv-btn sv-btn-secondary sv-btn-sm" onClick={run} disabled={loading || disabled} title={disabled ? disabledReason : undefined} aria-describedby={`${uid}-note`}>
          {loading ? <span className="w-3 h-3 border-2 border-ink-4 border-t-ink rounded-full animate-spin" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />}
          {loading ? 'Rédaction…' : result ? 'Regénérer' : buttonLabel}
        </button>
      )}>
      {loading && <p role="status" className="text-xs text-ink-3 mb-2">Rédaction en cours (10 à 60 s)…</p>}
      {error && <LoadError message={error} onRetry={run} />}
      {result && !loading && (
        <div className="text-[13px]">
          <ReactMarkdown components={MD as never}>{result.content}</ReactMarkdown>
          <p className="text-2xs text-ink-4 mt-2 pt-2 border-t border-line num">{metaLine(result.meta, result.promptVersion)} · texte contrôlé : nombres et sujets limités aux faits transmis.</p>
        </div>
      )}
      {!result && !loading && !error && (
        <p id={`${uid}-note`} className="text-xs text-ink-4">{disabled && disabledReason ? disabledReason : 'Texte rédigé par Gemini à partir des seuls faits ScoutVision affichés sur cette page, contrôlé par le serveur. À relire : il décrit, il ne décide pas.'}</p>
      )}
    </Panel>
  );
};

export default GroundedAiPanel;
