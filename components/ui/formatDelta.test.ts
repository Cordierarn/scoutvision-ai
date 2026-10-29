import { describe, expect, it } from 'vitest';
import { formatDelta } from './index';

describe('formatDelta', () => {
  it('écart signé au format français (virgule décimale, vrai signe moins)', () => {
    expect(formatDelta(0.34, 2)).toBe('+0,34');
    expect(formatDelta(-2)).toBe('−2');
    expect(formatDelta(-1.25, 1, ' %')).toBe('−1,3 %');
  });

  it('un écart arrondi à zéro n\'a pas de signe', () => {
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(-0.004, 2)).toBe('0');
  });
});
