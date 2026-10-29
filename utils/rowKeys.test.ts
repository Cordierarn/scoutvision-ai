import { describe, expect, it } from 'vitest';
import { isRowActivation } from './rowKeys';

const row = {} as EventTarget;
const star = {} as EventTarget;

describe('isRowActivation', () => {
  it('Entrée ou Espace sur la ligne elle-même ouvrent la fiche', () => {
    expect(isRowActivation({ key: 'Enter', target: row, currentTarget: row })).toBe(true);
    expect(isRowActivation({ key: ' ', target: row, currentTarget: row })).toBe(true);
  });

  it('une touche pressée sur un bouton de la ligne (étoile) ne l\'ouvre pas', () => {
    expect(isRowActivation({ key: 'Enter', target: star, currentTarget: row })).toBe(false);
    expect(isRowActivation({ key: ' ', target: star, currentTarget: row })).toBe(false);
  });

  it('les autres touches sont ignorées', () => {
    expect(isRowActivation({ key: 'Tab', target: row, currentTarget: row })).toBe(false);
    expect(isRowActivation({ key: 'a', target: row, currentTarget: row })).toBe(false);
  });
});
