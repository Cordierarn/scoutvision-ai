import { describe, expect, it } from 'vitest';
import type { HistoryDay } from '../../services/replayData';
import { addBet, betId, byEvening, emptyTest, netPerUnit, parseAmount, parseMyTest, proposedStake, publishedStatus, recordAuto, removeBet, settle, summarise, updateBet } from './myTestLogic';

const bet = (over: Partial<import('./myTestLogic').MyBet>) => ({ id: 'm1:101:101', addedAt: '2026-11-06T10:00:00Z', kickoff: '2026-11-06T19:00:00Z', matchId: 'm1', match: 'A – B', label: 'A gagne',
  marketId: 101, outcomeId: 101, odds: 2.0, stake: 1, profile: 'equilibre', ...over });
const history: HistoryDay[] = [{ date: '2026-11-06', matches: [{ matchId: 'm1', competition: 'ENG', kickoff: '2026-11-06T19:00:00Z', home: 'A', away: 'B', score: [2, 0],
  profiles: { equilibre: [{ label: 'A gagne', family: 'résultat', odds: 1.9, p: 0.5, ev: 0, stakeFraction: 0.005, stakeMode: 'fixed', status: 'won', realised: 0.9, marketId: 101, outcomeId: 101 }] } }] }];

describe('myTestLogic', () => {
  it('règle automatiquement un pari suivi par la même sélection de l\'historique, avec la cote et la mise de l\'utilisateur', () => {
    expect(publishedStatus(history).get('m1:101:101')).toBe('won');
    const s = settle({ start: 20, startedAt: '', bets: [bet({}), bet({ id: 'm2:1:1', matchId: 'm2', marketId: 1, outcomeId: 1, stake: 2 })] }, history);
    expect(s[0]).toMatchObject({ status: 'won', net: 1, auto: true });          // 1 € à 2,00
    expect(s[1]).toMatchObject({ status: 'pending', net: null, auto: false });
    const manual = settle({ start: 20, startedAt: '', bets: [bet({ manualStatus: 'lost' })] }, history);
    expect(manual[0]).toMatchObject({ status: 'lost', net: -1, auto: false });  // le règlement manuel l'emporte
  });

  it('calcule bankroll, disponible, rendement et soirées', () => {
    const test = { start: 20, startedAt: '', bets: [bet({}), bet({ id: 'x', matchId: 'm2', marketId: 1, outcomeId: 1, stake: 2 }), bet({ id: 'y', manualStatus: 'void', stake: 3 })] };
    const sum = summarise(test, settle(test, history));
    expect(sum).toMatchObject({ bankroll: 21, available: 19, pending: 2, staked: 1, net: 1, bets: 3, settled: 2, won: 1, roi: 1 });
    const ev = byEvening(settle(test, history));
    expect(ev).toHaveLength(1); expect(ev[0].net).toBeNull();                   // un pari encore en attente
  });

  it('règles de gain, mise proposée, identifiant et lecture d\'un export', () => {
    expect([netPerUnit('won', 2), netPerUnit('half_won', 2), netPerUnit('void', 2), netPerUnit('half_lost', 2), netPerUnit('lost', 2), netPerUnit('pending', 2)]).toEqual([1, 0.5, 0, -0.5, -1, null]);
    expect(proposedStake(0.005, 20)).toBe(0.1);                                 // 0,10 € minimum
    expect(proposedStake(0.025, 20)).toBe(0.5);
    expect(proposedStake(1, 0.35)).toBe(0.3);                                   // jamais plus que le disponible
    expect(betId('m1', 101, 102, 'x')).toBe('m1:101:102'); expect(betId('m1', null, null, 'Nul')).toBe('m1:Nul');
    expect(parseMyTest(JSON.stringify({ start: 20, startedAt: 'a', bets: [bet({}), { id: 'bad' }] }))?.bets).toHaveLength(1);
    expect(parseMyTest('pas du json')).toBeNull(); expect(parseMyTest(JSON.stringify({ start: -1, bets: [] }))).toBeNull();
    expect(emptyTest().start).toBe(20);
  });

  it('mémorise le règlement automatique, qui survit à la sortie de l\'historique (14 jours)', () => {
    const test = { start: 20, startedAt: '', bets: [bet({}), bet({ id: 'm2:1:1', matchId: 'm2', marketId: 1, outcomeId: 1 })] };
    const updated = recordAuto(test, history);
    expect(updated?.bets.map(b => b.autoStatus)).toEqual(['won', undefined]);
    expect(recordAuto(updated!, history)).toBeNull();                           // rien de neuf : pas de sauvegarde
    expect(settle(updated!, [])[0]).toMatchObject({ status: 'won', net: 1, auto: true });
  });

  it('oublie un règlement mémorisé quand la sélection publiée repasse en attente (score corrigé, mi-temps inconnue)', () => {
    const memorised = { start: 20, startedAt: '', bets: [bet({ autoStatus: 'won' })] };
    const pending: HistoryDay[] = [{ ...history[0], matches: [{ ...history[0].matches[0], profiles: { equilibre: [{ ...history[0].matches[0].profiles.equilibre![0], status: 'pending', realised: null }] } }] }];
    expect(settle(memorised, pending)[0]).toMatchObject({ status: 'pending', net: null, auto: false });
    const cleared = recordAuto(memorised, pending);
    expect(cleared?.bets[0].autoStatus).toBeUndefined();
    expect(recordAuto(cleared!, pending)).toBeNull();
    expect(settle(memorised, [])[0]).toMatchObject({ status: 'won' });          // absente de l'historique (14 jours) : le mémorisé reste
  });

  it('garde le règlement mémorisé d\'un pari déjà enregistré sous un profil retiré, absent de l\'historique publié', () => {
    const stored = { start: 20, startedAt: '', bets: [bet({ profile: 'exploratoire', autoStatus: 'won' })] };
    expect(settle(stored, [])[0]).toMatchObject({ status: 'won', net: 1, auto: true });
    expect(recordAuto(stored, [])).toBeNull();                                   // rien d'effacé
  });

  it('refuse un pari hors des profils validés', () => {
    for (const profile of ['exploratoire', 'ancien', 'inconnu']) expect(addBet(emptyTest(), bet({ profile })).bets).toHaveLength(0);
    for (const profile of ['sur', 'equilibre', 'grosse_cote']) expect(addBet(emptyTest(), bet({ profile })).bets).toHaveLength(1);
  });

  it('ajoute sans doublon, modifie, retire, et lit les montants à la française', () => {
    const t1 = addBet(emptyTest(), bet({}));
    expect(addBet(t1, bet({ stake: 5 })).bets).toHaveLength(1);
    expect(updateBet(t1, 'm1:101:101', { stake: 0.4, odds: 2.1 }).bets[0]).toMatchObject({ stake: 0.4, odds: 2.1 });
    expect(removeBet(t1, 'm1:101:101').bets).toHaveLength(0);
    expect([parseAmount('0,35'), parseAmount(' 2.5 '), parseAmount('0'), parseAmount('abc'), parseAmount('1,234')]).toEqual([0.35, 2.5, null, null, 1.23]);
  });
});
