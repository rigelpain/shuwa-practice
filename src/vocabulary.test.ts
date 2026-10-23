import { describe, expect, it } from 'vitest';
import { STARTER_VOCABULARY } from './vocabulary';

describe('STARTER_VOCABULARY', () => {
  it('lists every word once, since words are matched by label', () => {
    const labels = STARTER_VOCABULARY.flatMap((g) => g.words);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.trim() === l && l.length > 0)).toBe(true);
  });

  it('has distinct categories', () => {
    const names = STARTER_VOCABULARY.map((g) => g.category);
    expect(new Set(names).size).toBe(names.length);
  });
});
