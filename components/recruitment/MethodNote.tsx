/**
 * ScoutVision - Recrutement : méthode et fiabilité (repliée par défaut)
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { TransferModel } from '../../services/dataLoader';
import { CONTEXT_EFFECT_NOTABLE, leagueLevel } from '../../utils/recruitment';
import { CompetitionBadge } from '../Media';
import { Delta } from '../ui';

const D1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const D2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MethodNote: React.FC<{ transfer: TransferModel | null | undefined; competition: string; tier: number; leagueName: string }> = ({ transfer, competition, tier, leagueName }) => {
  const [open, setOpen] = useState(false);
  const validation = transfer?.validation;
  return (
    <section className="sv-panel">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left" aria-expanded={open} aria-controls="recruitment-method">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-ink-3" aria-hidden /> Méthode et fiabilité</span>
        {open ? <ChevronDown className="w-4 h-4 text-ink-3" aria-hidden /> : <ChevronRight className="w-4 h-4 text-ink-3" aria-hidden />}
      </button>
      {open && (
        <div id="recruitment-method" className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs text-ink-3 leading-relaxed">
          <div className="space-y-3">
            <p>
              <span className="text-ink font-semibold">Projection.</span> Chaque percentile d'un candidat est projeté à la saison suivante
              (retour vers la moyenne et âge, courbes d'âge), puis traduit vers notre équipe : écart de niveau entre les championnats,
              domination territoriale de notre équipe par rapport à la sienne, coût moyen d'adaptation d'un changement de championnat ou
              de club. L'indice du rôle (rôles du Chasseur de pépites) est recalculé sur ces percentiles projetés et comparé à celui du
              titulaire, projeté de la même façon sans changement de club. La cascade est affichée au dixième (arrondi cumulé).
            </p>
            <p>
              <span className="text-ink font-semibold">Complémentarité indicative.</span> Points faibles actuels du partenaire de ligne et
              qualités projetées du candidat, en lecture séparée : rien n'est ajouté à la projection sportive ni au classement, et cette
              lecture n'est pas couverte par la validation historique du modèle de transfert. La préférence « complémentarité »
              réordonne seulement les meilleures projections.
            </p>
            <p>
              <span className="text-ink font-semibold">Contexte.</span> Sans domination territoriale connue pour l'une des deux équipes, le
              terme de contexte vaut 0 et le candidat est signalé. Un terme d'au moins {CONTEXT_EFFECT_NOTABLE} points d'indice (environ le
              95e centile des candidats évalués) est signalé « Effet de contexte important » ; il n'est pas plafonné. Les gardiens y sont
              les plus sensibles.
            </p>
            <p>
              <span className="text-ink font-semibold">Valeur.</span> Frontière valeur / performance : un candidat est efficient
              valeur-performance si aucun autre n'a une projection au moins égale pour une valeur de marché Transfermarkt au plus égale
              (et strictement meilleure sur l'une des deux). L'estimation statistique ScoutVision n'est pas un prix de transfert. Le relevé Transfermarkt ne décrit
              que la saison en cours : il n'est jamais appliqué à une saison passée.
            </p>
            {transfer && (
              <p>
                <span className="text-ink font-semibold">Calibrage.</span> {transfer.pairs.toLocaleString('fr-FR')} paires de saisons
                consécutives au même poste, dont {transfer.movers.toLocaleString('fr-FR')} changements de championnat et{' '}
                {transfer.clubChanges.toLocaleString('fr-FR')} changements de club dans un même championnat.
              </p>
            )}
            {validation?.index && (
              <p>
                <span className="text-ink font-semibold">Validation hors échantillon</span> (saison {validation.season}, absente de
                l'ajustement) : erreur absolue moyenne de l'indice {D2.format(validation.index.movers.model)} points sur {validation.movers}{' '}
                changements de championnat ({D2.format(validation.index.clubChanges.model)} sur {validation.clubChanges} changements de club),
                contre {D2.format(validation.index.movers.persistence)} en reprenant l'indice actuel ; corrélation de rang{' '}
                {D2.format(validation.index.rankMovers.model)} contre {D2.format(validation.index.rankMovers.persistence)} ; biais des montées
                de niveau {D1.format(validation.index.biasUp.model)} point. Erreur historique, pas un intervalle : le gain sur le titulaire
                est la différence de deux projections, chacune incertaine.
              </p>
            )}
            <p>
              <span className="text-ink font-semibold">Limites.</span> Un indice varie d'environ 12 points d'une saison à l'autre : la liste
              est un point de départ pour la vidéo et le scouting, pas un verdict. Les joueurs qui changent de club sont sélectionnés,
              les coéquipiers, le système et la santé ne sont pas modélisés.
            </p>
          </div>
          {transfer && (
            <div>
              <div className="text-ink font-semibold mb-1">Traduction vers {leagueName}</div>
              <p className="mb-3">
                Écart moyen de percentile attendu pour un joueur qui rejoint {leagueName} depuis chaque championnat. Les percentiles
                PitchAPI sont calculés par niveau : c'est une traduction, pas un classement de force.
              </p>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 max-h-72 overflow-y-auto pr-2">
                <span className="sv-label">Championnat</span>
                <span className="sv-label text-right">Écart</span>
                <span className="sv-label text-right">Transferts</span>
                {Object.entries(transfer.leagues).map(([key, l]) => (
                  <React.Fragment key={key}>
                    <span className={key === competition ? 'text-ink' : ''}><CompetitionBadge competition={key} /></span>
                    <span className="text-right num">{key === competition ? '—' : <Delta value={l.level - leagueLevel(transfer, competition, tier)} />}</span>
                    <span className="text-right num">{l.moves}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default MethodNote;
