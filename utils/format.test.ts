import { describe, expect, it } from 'vitest';
import { formatEuro } from './format';

const nb = (s: string) => s.replace(/ /g, ' ');

describe('formatEuro', () => {
  it('millions : une décimale au plus, virgule française', () => {
    expect(nb(formatEuro(11_000_000))).toBe('11 M€');
    expect(nb(formatEuro(1_800_000))).toBe('1,8 M€');
    expect(nb(formatEuro(1_250_000))).toBe('1,3 M€');
  });

  it('milliers arrondis, passage aux millions sans « 1 000 k€ »', () => {
    expect(nb(formatEuro(850_000))).toBe('850 k€');
    expect(nb(formatEuro(999_600))).toBe('1 M€');
  });

  it('espace insécable entre le nombre et l\'unité', () => {
    expect(formatEuro(500_000)).toBe('500 k€');
  });

  it('valeur non finie : tiret', () => {
    expect(formatEuro(Number.NaN)).toBe('–');
  });
});
