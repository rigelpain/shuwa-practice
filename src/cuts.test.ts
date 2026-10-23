import { describe, expect, it } from 'vitest';
import { cutsFromSegments, framesIn, MIN_CUT_MS, mergeWithNext, nudge, type Cut } from './cuts';
import type { Candidate, Segment } from './reader';
import type { Frame, Word } from './types';

const word: Word = { id: 'w', label: 'ありがとう', referenceId: null, createdAt: 0 };
const cut = (startMs: number, endMs: number, extra: Partial<Cut> = {}): Cut => ({
  startMs,
  endMs,
  label: '',
  variant: null,
  include: false,
  suggestion: null,
  caption: null,
  guessedFrom: null,
  ...extra,
});
const frame = (t: number, hand: boolean): Frame => ({
  t,
  pose: null,
  left: null,
  right: hand ? [0, 0, 0] : null,
  leftWorld: null,
  rightWorld: null,
  face: null,
});

describe('cutsFromSegments', () => {
  it('names and ticks the cuts that look like a known word', () => {
    const segments = [
      { frames: [], startMs: 1000, endMs: 2000 },
      { frames: [], startMs: 3000, endMs: 4000 },
    ] as Segment[];
    const known: Candidate = { word, score: 80, variant: '' };
    const cuts = cutsFromSegments(segments, (s) => (s.startMs === 1000 ? known : null));
    expect(cuts[0]).toMatchObject({ startMs: 1000, endMs: 2000, label: 'ありがとう', include: true });
    expect(cuts[1]).toMatchObject({ label: '', include: false, suggestion: null });
  });
});

describe('nudge', () => {
  it('moves an edge but stays inside the video', () => {
    expect(nudge(cut(1000, 2000), 'start', -200, 5000).startMs).toBe(800);
    expect(nudge(cut(100, 2000), 'start', -200, 5000).startMs).toBe(0);
    expect(nudge(cut(1000, 4900), 'end', 200, 5000).endMs).toBe(5000);
  });

  it('never squeezes a cut below the shortest length', () => {
    expect(nudge(cut(1000, 1300), 'start', 200, 5000).startMs).toBe(1300 - MIN_CUT_MS);
    expect(nudge(cut(1000, 1300), 'end', -200, 5000).endMs).toBe(1000 + MIN_CUT_MS);
  });
});

describe('mergeWithNext', () => {
  it('joins two cuts and keeps whichever name was given', () => {
    const merged = mergeWithNext([cut(0, 500), cut(1000, 1500, { label: 'どうして', include: true }), cut(2000, 2500)], 0);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ startMs: 0, endMs: 1500, label: 'どうして', include: true });
    expect(merged[1].startMs).toBe(2000);
  });

  it('leaves the last cut alone', () => {
    const cuts = [cut(0, 500)];
    expect(mergeWithNext(cuts, 0)).toBe(cuts);
  });
});

describe('framesIn', () => {
  it('takes the frames inside the cut, trimmed to the hands and restarted at zero', () => {
    const frames = [0, 100, 200, 300, 400, 500, 600, 700].map((t) => frame(t, t >= 300 && t <= 500));
    const kept = framesIn(frames, { startMs: 100, endMs: 700 });
    expect(kept[0].t).toBe(0);
    expect(kept.filter((f) => f.right)).toHaveLength(3);
    // Two frames of margin are kept on each side of the hands, then time restarts at the cut's first frame.
    expect(kept).toHaveLength(7);
    expect(kept.at(-1)!.t).toBe(700 - 100);
  });
});
