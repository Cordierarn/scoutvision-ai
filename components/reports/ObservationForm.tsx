/**
 * ScoutVision - Rapports : saisie d'une observation humaine (vidéo, live, général)
 * Champs exclusivement humains : rien n'est prérempli par un modèle. La grille d'observation
 * (critères du rôle visé et dimensions non mesurées) est facultative ; ses notes sont celles du
 * scout, la donnée n'y apparaît pas pendant la saisie.
 */

import React, { useId, useState } from 'react';
import { CRITERION_RATINGS, CriterionRating, OBSERVATION_TYPES, ObservationGrid, ObservationType } from '../../types/scoutReport';
import { ObservationInput } from '../../services/scoutReportStore';
import { RATING_LABELS, UNMEASURED_DIMENSIONS, gridTemplate } from '../../utils/observationGrid';
import { InfoTip } from '../ui';
import { TYPE_LABELS, today } from './shared';

/** Cinq boutons radio 1 à 5, avec « non notée » implicite quand aucun n'est coché */
const RatingInput: React.FC<{ name: string; value?: CriterionRating; onChange: (v: CriterionRating | undefined) => void; label: string }> = ({ name, value, onChange, label }) => (
  <span className="sv-seg" role="radiogroup" aria-label={`${label} : note`}>
    {CRITERION_RATINGS.map(n => (
      <label key={n} className={`sv-seg-btn !px-2 cursor-pointer ${value === n ? 'sv-seg-on' : ''}`} title={RATING_LABELS[n]}>
        <input type="radio" name={name} value={n} checked={value === n} className="sr-only" onChange={() => onChange(n)} onClick={() => { if (value === n) onChange(undefined); }} />
        {n}
      </label>
    ))}
  </span>
);

export const ObservationForm: React.FC<{
  initial?: ObservationInput;
  role?: string;                // rôle visé du dossier : propose la grille de ce rôle
  onSubmit: (obs: ObservationInput) => void;
  onCancel: () => void;
  submitLabel?: string;
}> = ({ initial, role, onSubmit, onCancel, submitLabel = 'Enregistrer l\'observation' }) => {
  const uid = useId();
  const [type, setType] = useState<ObservationType>(initial?.type ?? 'video');
  const [date, setDate] = useState(initial?.date ?? today());
  const [text, setText] = useState(initial?.text ?? '');
  const [strengths, setStrengths] = useState(initial?.strengths ?? '');
  const [toReview, setToReview] = useState(initial?.toReview ?? '');
  const [conclusion, setConclusion] = useState(initial?.conclusion ?? '');
  const [more, setMore] = useState(!!(initial?.strengths || initial?.toReview || initial?.conclusion));
  const [withGrid, setWithGrid] = useState(!!initial?.grid);
  const [grid, setGrid] = useState<ObservationGrid>(() => initial?.grid ?? gridTemplate(role ?? ''));
  const [error, setError] = useState<string | null>(null);
  const field = 'sv-input !h-auto py-1.5 resize-y normal-case tracking-normal font-normal block w-full mt-1';
  const setCriterion = (key: string, patch: { rating?: CriterionRating; note?: string }) =>
    setGrid(g => ({ ...g, criteria: g.criteria.map(c => (c.key === key ? { ...c, ...patch } : c)) }));
  const canGrid = !!role || !!initial?.grid;

  return (
    <form className="rounded-md border border-line bg-raised/40 p-3 space-y-2.5" aria-labelledby={`${uid}-title`}
      onSubmit={e => {
        e.preventDefault();
        if (!text.trim()) { setError('Le texte de l\'observation est obligatoire.'); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Date invalide.'); return; }
        setError(null);
        onSubmit({ type, date, text, strengths, toReview, conclusion, refs: initial?.refs, ...(withGrid ? { grid } : {}) });
      }}>
      <p id={`${uid}-title`} className="sv-label">{initial ? 'Modifier l\'observation' : 'Nouvelle observation'} <span className="normal-case tracking-normal font-normal text-ink-4">· saisie humaine, jamais générée</span></p>
      <div className="flex flex-wrap gap-3">
        <label className="sv-label">
          Type
          <select autoFocus value={type} onChange={e => setType(e.target.value as ObservationType)} className="sv-select sv-select-sm block mt-1 normal-case tracking-normal font-normal">
            {OBSERVATION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="sv-label">
          Date
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="sv-input sv-input-sm block mt-1 normal-case tracking-normal font-normal" />
        </label>
      </div>
      <label className="sv-label block">
        Observation
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} required className={field}
          placeholder="Ce que vous avez vu : prise d'information, comportement sans ballon, décisions, qualité technique, contexte du match…" />
      </label>
      {!more ? (
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setMore(true)}>Forces, points à revoir, conclusion</button>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="sv-label block">Forces observées<textarea value={strengths} onChange={e => setStrengths(e.target.value)} rows={3} className={field} /></label>
          <label className="sv-label block">À revoir<textarea value={toReview} onChange={e => setToReview(e.target.value)} rows={3} className={field} /></label>
          <label className="sv-label block">Conclusion<textarea value={conclusion} onChange={e => setConclusion(e.target.value)} rows={3} className={field} /></label>
        </div>
      )}

      {canGrid && (
        <div className="border-t border-line pt-2.5">
          <label className="inline-flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={withGrid} onChange={e => setWithGrid(e.target.checked)} />
            Grille d'observation{grid.role ? ` · ${grid.role}` : ''}
            <InfoTip text="Notez de 1 (très en dessous du niveau attendu) à 5 (très au-dessus) ce que vous avez observé sur les critères du rôle et sur des dimensions que les données ne mesurent pas. Les percentiles ne sont pas affichés ici ; l'écart avec la donnée est calculé après l'enregistrement." />
          </label>
          {withGrid && (
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-raised px-2.5 py-1.5">
                <span className="text-xs font-semibold text-ink">Note globale du scout</span>
                <RatingInput name={`${uid}-overall`} value={grid.overall} onChange={v => setGrid(g => { const { overall: _o, ...rest } = g; return v ? { ...rest, overall: v } : rest; })} label="Note globale" />
              </div>
              {(['role_metric', 'unmeasured'] as const).map(kind => {
                const list = grid.criteria.filter(c => c.kind === kind);
                if (!list.length) return null;
                return (
                  <div key={kind}>
                    <p className="sv-label mt-1.5 mb-1">{kind === 'role_metric' ? 'Critères du rôle' : 'Dimensions non mesurées par les données'}</p>
                    <ul className="space-y-1">
                      {list.map(c => (
                        <li key={c.key} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                          <span className="text-xs text-ink-2 min-w-0">
                            {c.label}
                            {kind === 'unmeasured' && <InfoTip text={UNMEASURED_DIMENSIONS.find(d => d.key === c.key)?.hint ?? ''} />}
                            <input value={c.note ?? ''} onChange={e => setCriterion(c.key, { note: e.target.value })} placeholder="note facultative" aria-label={`${c.label} : remarque`}
                              className="sv-input sv-input-sm !h-6 ml-2 !w-40 inline-block normal-case tracking-normal font-normal" />
                          </span>
                          <RatingInput name={`${uid}-${c.key}`} value={c.rating} onChange={v => setCriterion(c.key, { rating: v })} label={c.label} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="sv-btn sv-btn-primary sv-btn-sm">{submitLabel}</button>
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
};

export default ObservationForm;
