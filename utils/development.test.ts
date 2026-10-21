import { describe, expect, it } from 'vitest';
import { AgeCurve } from '../services/dataLoader';
import { expectedPercentile, projectPercentile } from './development';

const curve: AgeCurve = { beta: -0.4, ages: { '22': [3, 100], '33': [-4, 50] } };

describe('projection à un an', () => {
  it('applique le retour vers la moyenne et l\'effet de l\'âge', () => {
    expect(expectedPercentile(80, curve, 22)).toBeCloseTo(80 - 0.4 * 30 + 3, 10);
    expect(expectedPercentile(20, curve, 33)).toBeCloseTo(20 + 0.4 * 30 - 4, 10);
  });

  it('n\'ajoute aucun effet d\'âge hors de la courbe ou sans âge', () => {
    expect(expectedPercentile(60, curve, 27)).toBeCloseTo(56, 10);
    expect(expectedPercentile(60, curve, NaN)).toBeCloseTo(56, 10);
  });

  it('borne à 0-100 et arrondit pour l\'affichage', () => {
    expect(expectedPercentile(100, { beta: 0, ages: { '22': [5, 1] } }, 22)).toBe(100);
    expect(expectedPercentile(0, { beta: 0, ages: { '22': [-5, 1] } }, 22)).toBe(0);
    expect(projectPercentile(80, curve, 22)).toBe(71);
  });
});
