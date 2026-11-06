/**
 * Rendu statique de l'onglet « Mon test » : sans pari suivi (rendu serveur, stockage vide), il explique comment suivre un pari
 * du plan de l'IA, part de 20 € et rappelle que les données restent dans le navigateur.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MyTestView } from './MyTest';

describe('MyTestView (rendu statique)', () => {
  it('affiche la bankroll de départ de 20 €, l\'état vide et la mention de stockage local', () => {
    const html = renderToStaticMarkup(<MyTestView index={undefined} />);
    expect(html).toContain('Mon test');
    expect(html).toContain('20,00');
    expect(html).toContain('Aucun pari suivi');
    expect(html).toContain('restent dans ce navigateur');
    expect(html).toContain('09 74 75 13 13');
  });

  it('signale un historique indisponible avec un bouton Réessayer', () => {
    const html = renderToStaticMarkup(<MyTestView index={null} failed onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Réessayer');
  });
});
