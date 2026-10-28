import { describe, expect, it } from 'vitest';
import { METRIC_CATEGORIES, groupMetrics } from './metricCategories';

describe('groupMetrics', () => {
  it('range chaque métrique dans une seule catégorie', () => {
    const all = METRIC_CATEGORIES.flatMap(c => c.keys);
    expect(new Set(all).size).toBe(all.length);
  });

  it('ne perd aucune métrique : les inconnues vont dans « Autres »', () => {
    const keys = ['xG', 'Tackles per 90', 'Nouvelle métrique', 'Rating'];
    const groups = groupMetrics(keys);
    expect(groups.flatMap(g => g.keys).sort()).toEqual([...keys].sort());
    expect(groups[groups.length - 1].category.id).toBe('other');
    expect(groups[groups.length - 1].keys).toEqual(['Nouvelle métrique']);
  });

  it('omet les catégories vides et garde l\'ordre de la table', () => {
    const groups = groupMetrics(['Rating', 'Goals']);
    expect(groups.map(g => g.category.id)).toEqual(['finishing', 'rating']);
  });
});
