/**
 * ScoutVision - Recrutement : dossier du candidat choisi, en blocs séparés
 * A identité · B projection sportive · C pourquoi · D métriques · E complémentarité · F valeur ·
 * G signaux et limites. Aucun score global : chaque bloc se lit seul (CandidateView).
 */

import React, { useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ExternalLink, Scale, Star } from 'lucide-react';
import { PlayerData, getPlayerSeasonId } from '../../types';
import { TransferModel } from '../../services/dataLoader';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../../services/storageService';
import { RolePreset, presetWeights } from '../../utils/rolePresets';
import { Candidate, CandidateView, RoleForecast, displayIndex, leagueLevel, CONTRACT_MONTHS } from '../../utils/recruitment';
import { metricLabel, positionName } from '../../utils/labels';
import { PlayerAvatar, TeamLine } from '../Media';
import { Delta, InfoTip, Stat } from '../ui';
import { BRAND, CONTEXT, DIVERGING } from '../../theme/charts';
import {
  CANDIDATE_FLAGS, COMPLEMENT_TIP, EFFICIENT_TIP, FlagChip, GAIN_TIP, INTEGER, SCOUTVISION_ESTIMATE_TIP, UncertaintyNote, decimal, formatEuros,
  formatMonth, signedDecimal,
} from './shared';

const Section: React.FC<{ letter: string; title: string; help?: string; children: React.ReactNode }> = ({ letter, title, help, children }) => (
  <section className="px-4 py-3 border-t border-line first:border-t-0">
    <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-2 mb-2">
      <span className="w-4 h-4 rounded-sm flex items-center justify-center text-[9px] font-bold bg-overlay text-ink-2" aria-hidden>{letter}</span>
      {title}
      {help && <InfoTip text={help} />}
    </h3>
    {children}
  </section>
);

// ============================================
// C. POURQUOI : cascade au dixième
// ============================================

const CASCADE_LABELS: Record<string, [string, string]> = {
  regression: ['Retour vers la moyenne', 'Un percentile extrême redescend en partie la saison suivante, quel que soit l\'âge'],
  age: ['Âge', 'Progression ou déclin moyen à cet âge et à ce poste (courbes d\'âge)'],
  league: ['Niveau du championnat', 'Écart de niveau entre son championnat et le nôtre'],
  context: ['Contexte d\'équipe', 'Domination territoriale (field tilt) de notre équipe par rapport à la sienne'],
  adaptation: ['Adaptation', 'Coût moyen d\'un changement de championnat ou de club'],
  cap: ['Plafond de l\'indice', 'L\'indice est borné à 100'],
};

const Cascade: React.FC<{ view: CandidateView; noContext: boolean }> = ({ view, noContext }) => {
  const { cascade } = view.sport;
  let running = cascade.now;
  const Row: React.FC<{ label: string; title?: string; value: React.ReactNode; strong?: boolean; children: React.ReactNode }> = ({ label, title, value, strong, children }) => (
    <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] min-[360px]:grid-cols-[9.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 h-6 text-xs" title={title}>
      <span className={strong ? 'text-ink font-medium' : 'text-ink-2'}>{label}</span>
      <div className="relative h-3 bg-raised/60 rounded-sm hidden min-[360px]:block" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        {children}
      </div>
      <span className="text-right num">{value}</span>
    </div>
  );
  return (
    <div>
      <Row label="Indice actuel" value={<span className="text-ink-2">{decimal(cascade.now)}</span>}>
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${cascade.now}%`, backgroundColor: CONTEXT }} />
      </Row>
      {cascade.steps.map(step => {
        const from = running;
        running += step.shown;
        const [label, title] = CASCADE_LABELS[step.key];
        const off = step.key === 'context' && noContext;
        return (
          <Row key={step.key} label={off ? 'Contexte (non appliqué)' : label} title={off ? 'Domination territoriale inconnue pour son équipe ou la nôtre : le terme de contexte n\'a pas été appliqué' : title}
            value={<span className={`num font-medium ${off ? 'text-ink-4' : step.shown > 0 ? 'text-pos' : step.shown < 0 ? 'text-neg' : 'text-ink-3'}`}>{signedDecimal(step.shown)}</span>}>
            <div className="absolute inset-y-0.5 rounded-sm" style={{ left: `${Math.min(from, running)}%`, width: `${Math.max(Math.abs(running - from), 0.6)}%`, backgroundColor: step.shown >= 0 ? DIVERGING.above : DIVERGING.below }} />
          </Row>
        );
      })}
      <Row label="Projeté chez nous" strong value={<span className="text-ink font-semibold">{decimal(cascade.next)}</span>}>
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${cascade.next}%`, backgroundColor: BRAND }} />
      </Row>
      <p className="text-2xs text-ink-4 mt-1.5 num" aria-label="Somme de la cascade">
        {decimal(cascade.now)}{cascade.steps.map(st => ` ${signedDecimal(st.shown)}`).join('')} = {decimal(cascade.next)} → indice {cascade.rounded}
      </p>
    </div>
  );
};

// ============================================
// D. MÉTRIQUES : haltères candidat / titulaire
// ============================================

const Dumbbells: React.FC<{ candidate: Candidate; preset: RolePreset; incumbent?: RoleForecast; incumbentName?: string }> = ({ candidate, preset, incumbent, incumbentName }) => {
  const rows = Object.entries(presetWeights(preset)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const good = (v: number | undefined, w: number) => (v === undefined ? undefined : w < 0 ? 100 - v : v);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND }} aria-hidden /> {candidate.player.Player}, chez nous</span>
        {incumbent && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CONTEXT }} aria-hidden /> {incumbentName}, titulaire</span>}
      </div>
      <ul className="space-y-1.5">
        {rows.map(([metric, w]) => {
          const c = good(candidate.forecast.metrics[metric]?.next, w);
          const i = good(incumbent?.metrics[metric]?.next, w);
          return (
            <li key={metric} className="grid grid-cols-[minmax(0,1fr)_3.75rem] min-[360px]:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_3.75rem] items-center gap-2 text-[11px]">
              <span className="text-ink-2 truncate" title={metricLabel(metric)}>{metricLabel(metric)}{w < 0 && <span className="text-ink-3"> (inv.)</span>}</span>
              <div className="relative h-3 hidden min-[360px]:block" aria-hidden>
                <div className="absolute top-1/2 inset-x-0 h-px bg-line-strong" /><div className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
                {c !== undefined && i !== undefined && <div className="absolute top-1/2 h-px bg-ink-4" style={{ left: `${Math.min(c, i)}%`, width: `${Math.abs(c - i)}%` }} />}
                {i !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${i}%`, backgroundColor: CONTEXT }} />}
                {c !== undefined && <span className="absolute top-1/2 w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface" style={{ left: `${c}%`, backgroundColor: BRAND }} />}
              </div>
              <span className="text-right text-ink-3 num">{c === undefined ? '–' : Math.round(c)}{incumbent && <> / {i === undefined ? '–' : Math.round(i)}</>}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-ink-4 mt-2">Percentiles projetés la saison prochaine (0-100, à droite = mieux). « Inv. » : moins c'est mieux, échelle retournée.</p>
    </div>
  );
};

// ============================================
// DOSSIER
// ============================================

export interface CandidateDossierProps {
  candidate: Candidate;
  view: CandidateView;
  preset: RolePreset;
  roleName: string;
  incumbent?: RoleForecast;
  incumbentPlayer?: PlayerData;
  partner?: PlayerData;
  partnerPosition?: string;
  leagueName: string;
  targetCompetition: string;
  targetTier: number;
  transfer: TransferModel | null | undefined;
  fewMinutes: number;
  onOpenPlayer?: (p: PlayerData) => void;
  onCompare?: (players: PlayerData[]) => void;
  onBack?: () => void;                    // retour à la liste (étapes, sous 1 280 px)
  headingRef?: React.Ref<HTMLHeadingElement>;
}

const CandidateDossier: React.FC<CandidateDossierProps> = ({
  candidate: c, view, preset, roleName, incumbent, incumbentPlayer, partner, partnerPosition, leagueName, targetCompetition, targetTier,
  transfer, fewMinutes, onOpenPlayer, onCompare, onBack, headingRef,
}) => {
  const p = c.player;
  const id = getPlayerSeasonId(p);
  const [watched, setWatched] = useState(() => getWatchlist().some(w => getPlayerSeasonId(w.player) === id));
  const toggleWatch = () => {
    if (watched) removeFromWatchlist(p); else addToWatchlist(p);
    setWatched(getWatchlist().some(w => getPlayerSeasonId(w.player) === id));
  };
  const { sport, value, complementarity } = view;
  const levelGap = transfer && p.Competition !== targetCompetition
    ? leagueLevel(transfer, p.Competition, p['League tier']) - leagueLevel(transfer, targetCompetition, targetTier) : undefined;
  const signals = view.signals;

  return (
    <article className="sv-panel min-w-0" aria-labelledby="recruitment-dossier-title">
      {onBack && (
        <div className="xl:hidden px-4 pt-3">
          <button type="button" onClick={onBack} className="sv-btn sv-btn-ghost sv-btn-sm"><ArrowLeft className="w-3.5 h-3.5" aria-hidden /> Liste des candidats</button>
        </div>
      )}
      {/* A. Identité */}
      <Section letter="A" title="Identité">
        <div className="flex items-start gap-3">
          <PlayerAvatar player={p} name={p.Player} size="md" />
          <div className="min-w-0 flex-1">
            <h2 id="recruitment-dossier-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink leading-tight focus:outline-none">{p.Player}</h2>
            <TeamLine player={p} className="text-xs text-ink-3 max-w-full" />
            <p className="text-2xs text-ink-3 mt-1 num">
              {p.Age ?? '?'} ans · {positionName(p.Position)} · rôle évalué : {roleName} · {INTEGER.format(Number(p['Minutes played']) || 0)} min ({p['Matches played'] ?? '–'} matchs)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {onOpenPlayer && <button type="button" className="sv-btn sv-btn-primary sv-btn-sm" onClick={() => onOpenPlayer(p)}>Fiche <ExternalLink className="w-3 h-3" aria-hidden /></button>}
          {onCompare && (
            <button type="button" className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => onCompare(incumbentPlayer ? [incumbentPlayer, p] : [p])}>
              <ArrowLeftRight className="w-3 h-3" aria-hidden /> {incumbentPlayer ? 'Comparer au titulaire' : 'Comparer'}
            </button>
          )}
          <button type="button" className={`sv-btn sv-btn-ghost sv-btn-sm ${watched ? '!text-accent' : ''}`} aria-pressed={watched} onClick={toggleWatch}>
            <Star className={`w-3 h-3 ${watched ? 'fill-accent' : ''}`} aria-hidden /> {watched ? 'Suivi' : 'Suivre'}
          </button>
        </div>
      </Section>

      {/* B. Projection sportive */}
      <Section letter="B" title="Projection sportive" help="Indice du rôle projeté la saison prochaine chez nous (projection centrale), comparé au titulaire projeté dans le même rôle sans changer de club.">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Actuel" value={displayIndex(sport.now)} sub="indice du rôle" wrapSub />
          <Stat label="Projection centrale" value={displayIndex(sport.next)} tone="accent" sub="chez nous" wrapSub />
          <Stat label="Titulaire projeté" value={sport.incumbentNext !== undefined ? displayIndex(sport.incumbentNext) : '–'}
            sub={incumbentPlayer && sport.incumbentNext !== undefined ? incumbentPlayer.Player : 'pas de référence'} wrapSub />
          <Stat label={<span className="inline-flex items-center gap-1">Gain central <InfoTip text={GAIN_TIP} align="end" /></span>}
            value={sport.incumbentNext !== undefined ? <Delta value={displayIndex(sport.next) - displayIndex(sport.incumbentNext)} /> : '–'}
            sub="vs titulaire" wrapSub />
        </div>
        <UncertaintyNote error={view.uncertainty} className="mt-2" />
        {sport.incumbentNext !== undefined && <p className="text-2xs text-ink-4 mt-1">{GAIN_TIP}</p>}
      </Section>

      {/* C. Pourquoi */}
      <Section letter="C" title="Pourquoi cette projection" help="De l'indice actuel à l'indice projeté, étape par étape, au dixième (arrondi cumulé : la somme affichée tombe juste, le calcul ne change pas).">
        <Cascade view={view} noContext={c.flags.includes('noContext')} />
        {levelGap !== undefined && (
          <p className="text-2xs text-ink-3 mt-1.5">
            Écart de niveau vers {leagueName} : <Delta value={levelGap} digits={1} /> point{Math.abs(levelGap) >= 2 ? 's' : ''} ({transfer!.leagues[p.Competition ?? '']?.moves ?? 0} transferts observés depuis ou vers son championnat).
          </p>
        )}
      </Section>

      {/* D. Métriques */}
      <Section letter="D" title="Métriques du rôle">
        <Dumbbells candidate={c} preset={preset} incumbent={incumbent} incumbentName={incumbentPlayer?.Player} />
      </Section>

      {/* E. Complémentarité */}
      <Section letter="E" title="Complémentarité indicative" help={`${COMPLEMENT_TIP} Points faibles : métriques des rôles du poste sous le 35e percentile du partenaire ; réponse : percentile projeté du candidat chez nous.`}>
        {complementarity && partner ? (
          <>
            <p className="text-xs text-ink-3 mb-1.5">Partenaire : <span className="text-ink-2">{partner.Player}</span>{partnerPosition ? ` (${positionName(partnerPosition).toLowerCase()})` : ''}</p>
            <table className="w-full text-xs">
              <thead><tr className="text-2xs text-ink-4 text-left">
                <th className="font-normal py-0.5">Point faible du partenaire</th><th className="font-normal text-right">Partenaire</th><th className="font-normal text-right">Candidat</th>
              </tr></thead>
              <tbody>
                {complementarity.metrics.map(m => (
                  <tr key={m.metric}>
                    <td className="py-0.5 text-ink-2">{metricLabel(m.metric)}{m.inverted && <span className="text-ink-4"> (inv.)</span>}</td>
                    <td className="text-right num text-ink-3">{Math.round(m.partner)} pct</td>
                    <td className="text-right num text-ink">{m.candidate === undefined ? '–' : `${Math.round(m.candidate)} pct`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-2xs text-ink-4 mt-1.5">Lecture indicative : n'entre ni dans la projection sportive ni dans le classement, et n'est pas couverte par la validation historique.</p>
          </>
        ) : <p className="text-xs text-ink-4">{partner ? `Pas de point faible marqué de ${partner.Player} sur les métriques du poste.` : 'Pas de partenaire de ligne de référence.'}</p>}
      </Section>

      {/* F. Valeur */}
      <Section letter="F" title="Valeur">
        {value ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Valeur de marché Transfermarkt" value={formatEuros(value.market)} sub="au relevé" wrapSub />
              <Stat label={<span className="inline-flex items-center gap-1">Estimation statistique ScoutVision <InfoTip text={SCOUTVISION_ESTIMATE_TIP} align="end" /></span>}
                value={formatEuros(value.estimate)} sub="pas un prix" wrapSub />
              <Stat label="Contrat" value={formatMonth(value.contract)} tone={value.contractMonths !== undefined && value.contractMonths <= CONTRACT_MONTHS ? 'warn' : 'default'}
                sub={value.contractMonths !== undefined ? (value.contractMonths < 0 ? 'échu' : `dans ${Math.round(value.contractMonths)} mois`) : 'inconnu'} wrapSub />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {value.efficient
                ? <FlagChip label="Efficient valeur-performance" icon={Scale} tone="pos" title={EFFICIENT_TIP} />
                : value.market !== undefined && <span className="text-2xs text-ink-3">Hors frontière : un autre candidat a une projection au moins égale pour une valeur au plus égale.</span>}
              {value.belowEstimate && <FlagChip {...CANDIDATE_FLAGS.belowEstimate} />}
              {value.contractMonths !== undefined && value.contractMonths <= CONTRACT_MONTHS && <FlagChip {...CANDIDATE_FLAGS.contract} tone="warn" />}
            </div>
          </>
        ) : <p className="text-xs text-ink-4">Saison passée : pas de valeur Transfermarkt, de contrat ni d'estimation. Le relevé ne décrit que la saison en cours.</p>}
      </Section>

      {/* G. Signaux et limites */}
      <Section letter="G" title="Signaux et limites">
        {signals.length > 0 ? (
          <ul className="space-y-1">
            {signals.map(f => {
              const { icon: Icon, label, title } = CANDIDATE_FLAGS[f];
              return (
                <li key={f} className="flex items-start gap-2 text-xs">
                  <Icon className="w-3.5 h-3.5 mt-px text-ink-3 shrink-0" aria-hidden />
                  <span><span className="text-ink-2 font-medium">{label}.</span> <span className="text-ink-3">{f === 'fewMinutes' ? `Moins de ${fewMinutes.toLocaleString('fr-FR')} minutes cette saison : percentiles plus instables.` : `${title}.`}</span></span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-ink-4">Aucun signal : temps de jeu suffisant, championnat observé, saut de niveau et effet de contexte modérés.</p>}
      </Section>
    </article>
  );
};

export default CandidateDossier;
