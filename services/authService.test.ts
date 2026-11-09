/** Rôle de session côté navigateur : lecture de /api/auth/session et vues proposées (comptes fictifs) */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSession, resolveView, viewAllowed } from './authService';

const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));

describe('checkSession : rôle', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lit le rôle pro renvoyé par le serveur', async () => {
    vi.stubGlobal('fetch', reply({ authenticated: true, user: 'invite', role: 'pro' }));
    expect(await checkSession()).toEqual({ status: 'authenticated', session: { user: 'invite', open: false, role: 'pro' } });
  });

  it('compte propriétaire, mode ouvert sans rôle et valeur inconnue : propriétaire', async () => {
    for (const body of [
      { authenticated: true, user: 'proprio', role: 'owner' },
      { authenticated: true, user: null, open: true },
      { authenticated: true, user: 'proprio', role: 'admin' },
    ]) {
      vi.stubGlobal('fetch', reply(body));
      const r = await checkSession();
      expect(r.status === 'authenticated' && r.session.role).toBe('owner');
    }
  });

  it('sans session : anonyme', async () => {
    vi.stubGlobal('fetch', reply({ authenticated: false }));
    expect(await checkSession()).toEqual({ status: 'anonymous' });
  });
});

describe('vues proposées selon le rôle', () => {
  const views = ['TEAM_ANALYSIS', 'RECRUITMENT', 'DASHBOARD', 'PROSPECTS', 'COMPARISON', 'SIMILARITY', 'WATCHLIST', 'LAB', 'SCOUT_REPORT', 'PLAYER_DETAIL'];

  it('le compte pro voit tout sauf Pronostics', () => {
    expect(viewAllowed('pro', 'FORECAST')).toBe(false);
    for (const v of views) expect(viewAllowed('pro', v)).toBe(true);
  });

  it('le propriétaire voit tout, Pronostics compris', () => {
    for (const v of [...views, 'FORECAST']) expect(viewAllowed('owner', v)).toBe(true);
  });

  it('une demande de Pronostics mène le compte pro à la vue d\'accueil', () => {
    expect(resolveView('pro', 'FORECAST', 'TEAM_ANALYSIS')).toBe('TEAM_ANALYSIS');
    expect(resolveView('pro', 'LAB', 'TEAM_ANALYSIS')).toBe('LAB');
    expect(resolveView('owner', 'FORECAST', 'TEAM_ANALYSIS')).toBe('FORECAST');
  });
});
