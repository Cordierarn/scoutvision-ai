/**
 * ScoutVision AI - Labo marché
 * Peut-on battre le marché avec ce que ScoutVision possède déjà ? Le carnet des expériences de
 * scripts/lab_market.py (prepare_market_lab.py) : chaque idée, son verdict hors échantillon et
 * ses chiffres ; les tableaux de détail (calibration, coupes, compositions, enjeu, carte d'efficience).
 */

import React, { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { EfficiencyRow, MarketLab, Verdict, marketLabData } from '../../services/labData';
import { frNumber, frPercent } from '../../utils/lab';
import { CompetitionBadge } from '../Media';
import { PageHeader, Stat, StatStrip } from '../ui';
import { Loading, Panel, VERDICT_ORDER, VerdictBadge, useLab, verdictInfo } from './common';
import { MarketCard, marketCards } from './marketCards';

const SECTIONS: { key: string; label: string }[] = [
  { key: 'calibration', label: 'Calibration' },
  { key: 'cups', label: 'Coupes d\'Europe' },
  { key: 'absences', label: 'Compositions' },
  { key: 'stakes', label: 'Enjeu' },
  { key: 'market', label: 'Marché' },
];

const ci = (c: [number, number], digits = 4) => `[${frNumber(c[0], digits, true)} ; ${frNumber(c[1], digits, true)}]`;

const Missing: React.FC = () => (
  <div className="sv-panel border-dashed px-4 py-3 text-xs text-ink-3">
    Données du Labo marché absentes : lancez <code className="text-ink-2">scripts/prepare_market_lab.py</code> après <code className="text-ink-2">scripts/prepare_data.py</code>.
  </div>
);

/**
 * Cartes du carnet, filtrables par verdict (même lecture que le Laboratoire)
 */
const Cards: React.FC<{ cards: MarketCard[]; matches: number; onOpen: (section: string) => void }> = ({ cards, matches, onOpen }) => {
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const count = (v: Verdict) => cards.filter(c => c.verdict === v).length;
  const shown = filter === 'all' ? cards : cards.filter(c => c.verdict === filter);
  return (
    <div className="space-y-4">
      <div className="sv-panel grid grid-cols-2 md:grid-cols-5 divide-x divide-line">
        <button onClick={() => setFilter('all')} aria-pressed={filter === 'all'}
          className={`text-left px-4 py-3 transition-colors ${filter === 'all' ? 'bg-raised' : 'hover:bg-raised/50'}`}>
          <div className="sv-label">Idées testées</div>
          <div className="text-xl font-semibold text-ink num mt-0.5">{cards.length}</div>
          <div className="text-2xs text-ink-3">{matches.toLocaleString('fr-FR')} matchs prévus hors échantillon</div>
        </button>
        {VERDICT_ORDER.map(v => {
          const info = verdictInfo(v);
          return (
            <button key={v} onClick={() => setFilter(filter === v ? 'all' : v)} aria-pressed={filter === v} title={info.help}
              className={`relative text-left px-4 py-3 transition-colors ${filter === v ? 'bg-raised' : 'hover:bg-raised/50'}`}>
              <span className="absolute left-0 right-0 top-0 h-0.5" style={{ backgroundColor: info.color }} aria-hidden />
              <VerdictBadge verdict={v} />
              <div className="text-xl font-semibold text-ink num mt-1">{count(v)}</div>
              <div className="text-2xs text-ink-3 truncate">{info.help}</div>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {shown.map(c => {
          const info = verdictInfo(c.verdict);
          return (
            <article key={c.id} className="sv-panel relative overflow-hidden p-4 flex flex-col">
              <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: info.color }} aria-hidden />
              <div className="flex items-center justify-between gap-3">
                <span className="sv-label">{c.theme}</span>
                <VerdictBadge verdict={c.verdict} size="md" />
              </div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink leading-snug">{c.question}</h3>
              <div className="mt-3 text-xl font-semibold text-ink num break-words">{c.figure}</div>
              <div className="text-2xs text-ink-3 mt-0.5 leading-snug">{c.caption}</div>
              <p className="mt-2.5 text-[13px] text-ink-2 leading-relaxed flex-1">{c.text}</p>
              {c.section && (
                <button onClick={() => onOpen(c.section!)} className="mt-3 self-start sv-btn sv-btn-ghost sv-btn-sm -ml-2 !text-accent">
                  Voir le détail
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

const Th: React.FC<{ children: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th scope="col" className={right ? 'text-right' : ''}>{children}</th>
);
const Td: React.FC<{ children: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className = '' }) => (
  <td className={`${right ? 'text-right num whitespace-nowrap' : ''} ${className}`}>{children}</td>
);

const CalibrationPanel: React.FC<{ lab: MarketLab }> = ({ lab }) => {
  const cal = lab.experiments.calibration[lab.testSeason];
  const draws = Object.entries(cal.draws).sort((a, b) => Math.abs(b[1].predicted - b[1].observed) - Math.abs(a[1].predicted - a[1].observed));
  return (
    <Panel title="Modèle de base et calibration" right={<VerdictBadge verdict={cal.verdict} />}
      subtitle={`Modèle conjoint toutes compétitions (buts et xG, niveaux de championnat liés par les coupes), réajusté chaque semaine sur les seuls matchs antérieurs depuis ${new Date(lab.baseStart).toLocaleDateString('fr-FR')} : log-loss ${frNumber(lab.baseLogLoss, 4)} sur ${lab.covered.toLocaleString('fr-FR')} matchs. Saison de test ${lab.testSeason} : température ${frNumber(cal.temperature, 2)}, écart de calibration ${frNumber(cal.ece, 3)}.`}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="overflow-x-auto">
          <table className="sv-table">
            <caption className="text-left text-2xs text-ink-3 pb-2">Fiabilité de P(victoire à domicile), {lab.testSeason}</caption>
            <thead><tr><Th>Probabilité prévue</Th><Th right>Matchs</Th><Th right>Prévu</Th><Th right>Observé</Th><Th right>Écart</Th></tr></thead>
            <tbody>
              {cal.reliability.map(b => (
                <tr key={b.lo}>
                  <Td>{frPercent(b.lo)} – {frPercent(b.hi)}</Td><Td right>{b.n.toLocaleString('fr-FR')}</Td>
                  <Td right>{frPercent(b.predicted, 1)}</Td><Td right>{frPercent(b.observed, 1)}</Td>
                  <Td right>{frNumber(100 * (b.observed - b.predicted), 1, true)} pt</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table className="sv-table">
            <caption className="text-left text-2xs text-ink-3 pb-2">Nuls prévus et observés par compétition (écarts les plus grands en premier)</caption>
            <thead><tr><Th>Compétition</Th><Th right>Matchs</Th><Th right>Nuls prévus</Th><Th right>Observés</Th></tr></thead>
            <tbody>
              {draws.slice(0, 12).map(([c, d]) => (
                <tr key={c}>
                  <Td><CompetitionBadge competition={c} showName={false} /></Td><Td right>{d.matches}</Td>
                  <Td right>{frPercent(d.predicted, 1)}</Td><Td right>{frPercent(d.observed, 1)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
};

const CupsPanel: React.FC<{ lab: MarketLab }> = ({ lab }) => {
  const c = lab.experiments.cups;
  const tierLabel: Record<string, string> = { '1-1': 'Deux clubs du premier niveau', '1-2+': 'Premier niveau contre ligue mineure', '2+-2+': 'Deux clubs de ligues mineures' };
  const rows = (obj: Record<string, { matches: number; rpsModel: number; rpsFrequencies: number; gain: number; ci: [number, number] }>, label: (k: string) => string) =>
    Object.entries(obj).map(([k, r]) => (
      <tr key={k}>
        <Td>{label(k)}</Td><Td right>{r.matches}</Td><Td right>{frNumber(r.rpsModel, 4)}</Td><Td right>{frNumber(r.rpsFrequencies, 4)}</Td>
        <Td right>{frNumber(r.gain, 4, true)}</Td><Td right className="text-ink-3">{ci(r.ci)}</Td>
      </tr>
    ));
  return (
    <Panel title="Coupes d'Europe" right={<VerdictBadge verdict={c.verdict} />}
      subtitle={`RPS (plus bas = mieux) du modèle conjoint contre les fréquences 1-N-2 des matchs de coupe antérieurs, ${c.matches.toLocaleString('fr-FR')} matchs hors échantillon.`}>
      <div className="overflow-x-auto">
        <table className="sv-table">
          <thead><tr><Th>Saison ou niveau des clubs</Th><Th right>Matchs</Th><Th right>RPS modèle</Th><Th right>RPS fréquences</Th><Th right>Gain</Th><Th right>IC 95 %</Th></tr></thead>
          <tbody>
            {rows(c.seasons, k => k)}
            {rows(c.tiers, k => tierLabel[k] ?? k)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

const AbsencesPanel: React.FC<{ lab: MarketLab }> = ({ lab }) => {
  const a = lab.experiments.absences[lab.testSeason];
  const prev = lab.experiments.absences[lab.previousSeason];
  const gains = (label: string, g: { gain: number; ci: [number, number]; test: number; verdict: Verdict }, g2?: { gain: number; ci: [number, number] }) => (
    <tr key={label}>
      <Td>{label}</Td><Td right>{frNumber(g.gain, 4, true)}</Td><Td right className="text-ink-3">{ci(g.ci)}</Td>
      <Td right>{g2 ? frNumber(g2.gain, 4, true) : '–'}</Td><Td right className="text-ink-3">{g2 ? ci(g2.ci) : '–'}</Td><Td><VerdictBadge verdict={g.verdict} /></Td>
    </tr>
  );
  return (
    <Panel title="Compositions : absents, rupture de réseau, onze probable" right={<VerdictBadge verdict={a.verdict} />}
      subtitle={`Titulaire habituel : a débuté 60 % des matchs précédents de la saison (au moins 5). Gain de log-loss par match du signal (domicile − extérieur) au-delà du modèle de base, saison de test ${lab.testSeason} et réplication ${lab.previousSeason}. ${a.teamMatches.toLocaleString('fr-FR')} équipes-matchs.`}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="overflow-x-auto">
          <table className="sv-table">
            <thead><tr><Th>Signal</Th><Th right>Gain {lab.testSeason}</Th><Th right>IC 95 %</Th><Th right>Gain {lab.previousSeason}</Th><Th right>IC 95 %</Th><Th>Verdict</Th></tr></thead>
            <tbody>
              {gains('Titulaires habituels absents (connu à l\'annonce)', a.count, prev?.count)}
              {gains('Part des passes portée par les absents', a.share, prev?.share)}
              {gains('Absents déjà absents au match précédent (connu avant)', a.known, prev?.known)}
              {a.shareBeyondCount && (
                <tr><Td>Rupture de réseau au-delà du nombre d'absents</Td><Td right>{frNumber(a.shareBeyondCount.gain, 4, true)}</Td>
                  <Td right className="text-ink-3">{ci(a.shareBeyondCount.ci)}</Td>
                  <Td right>{prev?.shareBeyondCount ? frNumber(prev.shareBeyondCount.gain, 4, true) : '–'}</Td>
                  <Td right className="text-ink-3">{prev?.shareBeyondCount ? ci(prev.shareBeyondCount.ci) : '–'}</Td><Td>–</Td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table className="sv-table">
            <caption className="text-left text-2xs text-ink-3 pb-2">Onze probable avant l'annonce : part du onze retrouvée</caption>
            <thead><tr><Th>Saison</Th><Th right>Dernier onze</Th><Th right>Titularisations pondérées</Th><Th right>Absents par match</Th><Th right>Part des passes</Th></tr></thead>
            <tbody>
              {Object.entries(a.xi).sort((x, y) => y[0].localeCompare(x[0])).map(([s, r]) => (
                <tr key={s}><Td>{s}</Td><Td right>{frPercent(r.lastEleven, 1)}</Td><Td right>{frPercent(r.predicted, 1)}</Td>
                  <Td right>{frNumber(r.missing, 2)}</Td><Td right>{frPercent(r.missingShare, 1)}</Td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
};

const StakesPanel: React.FC<{ lab: MarketLab }> = ({ lab }) => {
  const labels: Record<string, string> = { homeOnly: 'Seule l\'équipe à domicile a un enjeu', awayOnly: 'Seule l\'équipe à l\'extérieur a un enjeu', both: 'Les deux', none: 'Aucune des deux' };
  return (
    <Panel title="Enjeu de fin de saison" right={<VerdictBadge verdict={lab.experiments.stakes[lab.testSeason].verdict} />}
      subtitle="Enjeu d'une équipe = variation de la probabilité d'un objectif (titre, top 4, relégation) entre une victoire et une défaite, dans 2 000 saisons simulées à partir du classement du jour et des probabilités de base ; dernier tiers de chaque saison. Résidu = points de l'équipe à domicile moins points attendus par le modèle de base.">
      <div className="overflow-x-auto">
        <table className="sv-table">
          <thead><tr><Th>Situation</Th>{[lab.testSeason, lab.previousSeason].map(s => <React.Fragment key={s}><Th right>Matchs {s}</Th><Th right>Résidu</Th><Th right>IC 95 %</Th></React.Fragment>)}</tr></thead>
          <tbody>
            {(['homeOnly', 'awayOnly', 'both', 'none'] as const).map(k => (
              <tr key={k}>
                <Td>{labels[k]}</Td>
                {[lab.testSeason, lab.previousSeason].map(s => {
                  const r = lab.experiments.stakes[s]?.homeResidual[k];
                  return <React.Fragment key={s}><Td right>{r ? r.matches : '–'}</Td><Td right>{r ? `${frNumber(r.residual, 2, true)} pt` : '–'}</Td><Td right className="text-ink-3">{r ? ci(r.ci, 2) : '–'}</Td></React.Fragment>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

const MarketPanel: React.FC<{ lab: MarketLab }> = ({ lab }) => {
  const m = lab.experiments.market;
  const [order, setOrder] = useState<'weight' | 'gain' | 'matches'>('weight');
  const rows = useMemo(() => Object.entries(m.efficiency?.competitions ?? {}).sort((a, b) =>
    order === 'weight' ? b[1].weight - a[1].weight : order === 'gain' ? b[1].poolGain - a[1].poolGain : b[1].matches - a[1].matches), [m, order]);
  if (!m.available) {
    return (
      <Panel title="Marché" subtitle="Les expériences avec cotes (cible = clôture, dispersion entre bookmakers, cohérence inter-marchés, chance accumulée, nouvel entraîneur, carte d'efficience, empilement) ont besoin des cotes de football-data.co.uk.">
        <p className="text-xs text-ink-3">Cotes non chargées lors de cette préparation des données : la section apparaîtra au prochain passage du pipeline avec accès à football-data.co.uk.</p>
      </Panel>
    );
  }
  const ct = m.closingTarget;
  const bets = (b?: { bets: number; clv?: number; clvSe?: number; roi?: number }) => b && b.bets && b.clv !== undefined
    ? `${b.bets.toLocaleString('fr-FR')} paris · CLV ${frPercent(b.clv, 1)} ± ${frPercent(2 * (b.clvSe ?? 0), 1)}${b.roi !== undefined ? ` · rendement ${frPercent(b.roi, 1)}` : ''}` : 'aucun pari';
  return (
    <Panel title="Carte d'efficience du marché" right={m.efficiency && <VerdictBadge verdict={m.efficiency.verdict} />}
      subtitle={`${(m.matches ?? 0).toLocaleString('fr-FR')} matchs avec cotes de clôture (${m.period?.[0]} → ${m.period?.[1]}), ${m.teamsMapped} équipes reconnues. Poids du modèle dans le mélange avec l'ouverture ajusté sur les saisons précédentes, log-loss sur ${lab.testSeason} ; paris du modèle contre l'ouverture jugés à la clôture.`}>
      {ct && (
        <StatStrip className="mb-4">
          <Stat label="Mouvement expliqué" value={ct.movementExplained !== undefined ? frPercent(ct.movementExplained, 1) : 'N/D'} sub="ouverture → clôture, par le modèle" />
          <Stat label="Log-loss ouverture" value={frNumber(ct.llOpening ?? 0, 4)} />
          <Stat label="Log-loss prédicteur" value={frNumber(ct.llPredicted ?? 0, 4)} />
          <Stat label="Log-loss clôture" value={frNumber(ct.llClosing ?? 0, 4)} />
          <Stat label="Paris du prédicteur" value={bets(ct.betsPredicted)} />
        </StatStrip>
      )}
      <div className="flex items-center gap-3 mb-3">
        <label className="text-2xs text-ink-3">Ordre
          <select value={order} onChange={e => setOrder(e.target.value as typeof order)} className="block mt-1 bg-raised border border-line-strong rounded px-2 py-1 text-xs text-ink">
            <option value="weight">Poids du modèle</option>
            <option value="gain">Gain du mélange</option>
            <option value="matches">Matchs</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="sv-table">
          <thead><tr><Th>Compétition</Th><Th right>Matchs</Th><Th right>Poids</Th><Th right>Ouverture</Th><Th right>Mélange</Th><Th right>Clôture</Th><Th right>Gain</Th><Th right>Dispersion</Th><Th right>Mouvement</Th><Th>Paris du modèle</Th><Th>Verdict</Th></tr></thead>
          <tbody>
            {rows.map(([c, r]: [string, EfficiencyRow]) => (
              <tr key={c}>
                <Td><CompetitionBadge competition={c} showName={false} /></Td><Td right>{r.matches}</Td><Td right>{frNumber(r.weight, 2)}</Td>
                <Td right>{frNumber(r.llOpening, 4)}</Td><Td right>{frNumber(r.llPool, 4)}</Td><Td right>{frNumber(r.llClosing, 4)}</Td>
                <Td right>{frNumber(r.poolGain, 4, true)}</Td><Td right>{r.dispersion !== null ? frNumber(r.dispersion, 3) : 'N/D'}</Td><Td right>{frNumber(r.movement, 3)}</Td>
                <Td className="text-xs text-ink-3">{bets(r.bets)}</Td><Td><VerdictBadge verdict={r.verdict} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

// Section ouverte au retour sur la page
let lastSection = 'cards';

const MarketLabPage: React.FC = () => {
  const lab = useLab(marketLabData.experiments);
  const [section, setSection] = useState<string>(lastSection);
  const open = (s: string) => { lastSection = s; setSection(s); };
  const cards = useMemo(() => (lab ? marketCards(lab) : []), [lab]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-4 max-w-[96rem] mx-auto">
        <PageHeader
          title="Labo marché"
          icon={Scale}
          description="Peut-on battre le marché avec ce que ScoutVision possède déjà ? Le marché de clôture est la meilleure prévision publique qui existe : on ne le bat pas avec un meilleur modèle de buts, mais peut-être là où il est lent (compositions), mince (ligues peu couvertes, coupes) ou aveugle (ce que personne ne modélise). Chaque idée est validée sur des saisons que le modèle n'a pas vues ; les idées démenties restent affichées."
          meta={lab ? `Calculé le ${new Date(lab.generatedAt).toLocaleDateString('fr-FR')} · saison de test ${lab.testSeason}` : undefined}
        />
        <div className="sv-tabs" role="tablist" aria-label="Sections du Labo marché">
          {[{ key: 'cards', label: 'Carnet' }, ...SECTIONS].map(t => (
            <button key={t.key} role="tab" aria-selected={section === t.key} onClick={() => open(t.key)}
              className={`sv-tab ${section === t.key ? 'sv-tab-on' : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
        {lab === undefined ? <Loading /> : !lab ? <Missing /> : (
          <>
            {section === 'cards' && <Cards cards={cards} matches={lab.covered} onOpen={open} />}
            {section === 'calibration' && <CalibrationPanel lab={lab} />}
            {section === 'cups' && <CupsPanel lab={lab} />}
            {section === 'absences' && <AbsencesPanel lab={lab} />}
            {section === 'stakes' && <StakesPanel lab={lab} />}
            {section === 'market' && <MarketPanel lab={lab} />}
          </>
        )}
      </div>
    </div>
  );
};

export default MarketLabPage;
