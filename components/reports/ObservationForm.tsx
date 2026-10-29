/**
 * ScoutVision - Rapports : saisie d'une observation humaine (vidéo, live, général)
 * Champs exclusivement humains : rien n'est prérempli par un modèle.
 */

import React, { useId, useState } from 'react';
import { OBSERVATION_TYPES, ObservationType } from '../../types/scoutReport';
import { ObservationInput } from '../../services/scoutReportStore';
import { TYPE_LABELS, today } from './shared';

export const ObservationForm: React.FC<{
  initial?: ObservationInput;
  onSubmit: (obs: ObservationInput) => void;
  onCancel: () => void;
  submitLabel?: string;
}> = ({ initial, onSubmit, onCancel, submitLabel = 'Enregistrer l\'observation' }) => {
  const uid = useId();
  const [type, setType] = useState<ObservationType>(initial?.type ?? 'video');
  const [date, setDate] = useState(initial?.date ?? today());
  const [text, setText] = useState(initial?.text ?? '');
  const [strengths, setStrengths] = useState(initial?.strengths ?? '');
  const [toReview, setToReview] = useState(initial?.toReview ?? '');
  const [conclusion, setConclusion] = useState(initial?.conclusion ?? '');
  const [more, setMore] = useState(!!(initial?.strengths || initial?.toReview || initial?.conclusion));
  const [error, setError] = useState<string | null>(null);
  const field = 'sv-input !h-auto py-1.5 resize-y normal-case tracking-normal font-normal block w-full mt-1';

  return (
    <form className="rounded-md border border-line bg-raised/40 p-3 space-y-2.5" aria-labelledby={`${uid}-title`}
      onSubmit={e => {
        e.preventDefault();
        if (!text.trim()) { setError('Le texte de l\'observation est obligatoire.'); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Date invalide.'); return; }
        setError(null);
        onSubmit({ type, date, text, strengths, toReview, conclusion, refs: initial?.refs });
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
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="sv-btn sv-btn-primary sv-btn-sm">{submitLabel}</button>
        <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
};

export default ObservationForm;
