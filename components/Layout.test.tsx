/** Navigation selon le rôle : le compte pro ne voit pas l'entrée Pronostics (comptes fictifs) */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Layout from './Layout';
import { AuthContext, Role } from '../services/authService';

const render = (role: Role) => renderToStaticMarkup(
  <AuthContext.Provider value={{ user: 'invite', open: false, role }}>
    <Layout onNavigate={() => {}} currentView="TEAM_ANALYSIS" hasData><div /></Layout>
  </AuthContext.Provider>,
);
const navTitles = (html: string) => [...html.matchAll(/<button[^>]*title="([^"]+)"/g)].map(m => m[1].replace(/&#x27;/g, '\''));

describe('Layout : entrées de navigation selon le rôle', () => {
  it('compte pro : pas de Pronostics, toutes les autres entrées, Laboratoire compris', () => {
    const html = render('pro');
    const titles = navTitles(html);
    expect(titles).not.toContain('Pronostics');
    for (const t of ['Base joueurs', 'Chasseur de pépites', 'Comparaison', 'Joueurs similaires', 'Liste de suivi', 'Analyse d\'équipe', 'Recrutement', 'Laboratoire', 'Rapports de scouting']) {
      expect(titles).toContain(t);
    }
    expect(html).not.toContain('Pronostics');
  });

  it('propriétaire : Pronostics présent, rendu identique pour le reste', () => {
    const owner = render('owner');
    expect(navTitles(owner)).toContain('Pronostics');
    const withoutForecast = navTitles(owner).filter(t => t !== 'Pronostics');
    expect(navTitles(render('pro'))).toEqual(withoutForecast);
  });
});
