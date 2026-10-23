import { describe, expect, it } from 'vitest';
import { clipKind, referenceFor, referencesOf, setReference, type Clip, type Word } from './types';

const word = (extra: Partial<Word> = {}): Word => ({ id: 'w', label: 'ありがとう', referenceId: null, createdAt: 0, ...extra });
const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id,
  wordId: 'w',
  signer: '',
  createdAt: 0,
  width: 1,
  height: 1,
  durationMs: 0,
  frames: [],
  ...extra,
});

describe('versions of a word', () => {
  it('reads an older word whose only reference is referenceId as the main version', () => {
    const old = word({ referenceId: 'a' });
    expect(referencesOf(old)).toEqual({ '': 'a' });
    expect(referenceFor(old, '')).toBe('a');
    expect(referenceFor(old, '関西')).toBeNull();
  });

  it('keeps a reference per version and referenceId on the first', () => {
    const w = word();
    setReference(w, '関西', 'k');
    expect(w.referenceId).toBe('k');
    setReference(w, '', 'm');
    expect(w.references).toEqual({ 関西: 'k', '': 'm' });
    expect(w.referenceId).toBe('m');
    setReference(w, '', null);
    expect(w.referenceId).toBe('k');
  });

  it('counts any version reference of an older clip as a sample', () => {
    const w = word();
    setReference(w, '関西', 'k');
    expect(clipKind(clip('k'), w)).toBe('sample');
    expect(clipKind(clip('x'), w)).toBe('practice');
    expect(clipKind(clip('x', { kind: 'sample' }), w)).toBe('sample');
  });
});
