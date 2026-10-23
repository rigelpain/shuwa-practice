import { describe, expect, it } from 'vitest';
import { dtw } from './dtw';
import { POSE_KEEP } from './features';
import { trimToHands } from './recorder';
import { compareClips } from './scoring';
import { FACE_KEYS, type Clip, type Frame } from './types';

const WIDTH = 1280;
const HEIGHT = 720;
const ASPECT = WIDTH / HEIGHT;

type Shape = number[][];

/** A hand pattern in metres: wrist at the origin, fingers pointing up. */
function handShape(curl: number): Shape {
  return Array.from({ length: 21 }, (_, k) => {
    if (k === 0) return [0, 0, 0];
    const finger = Math.floor((k - 1) / 4);
    const joint = ((k - 1) % 4) + 1;
    const reach = joint === 1 ? 1 : curl;
    return [(finger - 2) * 0.02, -(0.05 + 0.025 * (joint - 1)) * reach, 0];
  });
}

const OPEN = handShape(1);
const FIST = handShape(0.25);

function pose(): number[] {
  const p = new Array<number>(POSE_KEEP * 4).fill(0);
  const set = (i: number, x: number, y: number) => p.splice(i * 4, 4, x, y, 0, 1);
  set(0, 0.5, 0.4); // nose
  set(11, 0.6, 0.6); // signer's left shoulder (image right, unmirrored)
  set(12, 0.4, 0.6);
  return p;
}

interface ClipSpec {
  frames: number;
  durationMs: number;
  /** Wrist position in image coordinates for progress u in [0, 1]. */
  path: (u: number) => [number, number];
  shape?: (u: number) => Shape;
  side?: 'left' | 'right';
  /** Flip the hand horizontally (as a mirror image would). */
  flipX?: boolean;
  /** Blendshape scores per FACE_KEYS, or none. */
  face?: (u: number) => number[] | null;
  /** Nose position in image coordinates. */
  nose?: (u: number) => [number, number];
}

function makeClip({
  frames,
  durationMs,
  path,
  shape = () => OPEN,
  side = 'right',
  flipX = false,
  face = () => null,
  nose = () => [0.5, 0.4],
}: ClipSpec): Clip {
  const out: Frame[] = [];
  for (let n = 0; n < frames; n++) {
    const u = frames === 1 ? 0 : n / (frames - 1);
    const [wx, wy] = path(u);
    const pts = shape(u).map(([x, y, z]) => [flipX ? -x : x, y, z]);
    const world = pts.flat();
    const image = pts.flatMap(([x, y, z]) => [wx + (x * 0.5) / ASPECT, wy + y * 0.5, z * 0.5]);
    const p = pose();
    p.splice(0, 2, ...nose(u));
    out.push({
      t: u * durationMs,
      pose: p,
      left: side === 'left' ? image : null,
      right: side === 'right' ? image : null,
      leftWorld: side === 'left' ? world : null,
      rightWorld: side === 'right' ? world : null,
      face: face(u),
    });
  }
  return { id: 'c', wordId: 'w', signer: '', createdAt: 0, width: WIDTH, height: HEIGHT, durationMs, frames: out };
}

const arc = (u: number): [number, number] => [0.4 - 0.1 * Math.sin(Math.PI * u), 0.55 - 0.15 * u];
const vertical = (u: number): [number, number] => [0.4, 0.75 - 0.35 * u];
const opts = { mirror: false, useFace: false };

describe('dtw', () => {
  it('matches identical sequences along the diagonal', () => {
    const s = [0, 1, 2, 3, 4];
    const { cost, path } = dtw(5, 5, (i, j) => Math.abs(s[i] - s[j]));
    expect(cost).toBe(0);
    expect(path).toEqual(s.map((i) => [i, i]));
  });

  it('absorbs a uniform slowdown', () => {
    const a = [0, 1, 2, 3];
    const b = [0, 0, 1, 1, 2, 2, 3, 3];
    const { cost, path } = dtw(a.length, b.length, (i, j) => Math.abs(a[i] - b[j]));
    expect(cost).toBe(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([3, 7]);
  });

  it('keeps the path inside the band', () => {
    const { path } = dtw(40, 40, () => 1, 3);
    for (const [i, j] of path) expect(Math.abs(i - j)).toBeLessThanOrEqual(4);
  });
});

describe('compareClips', () => {
  const ref = makeClip({ frames: 60, durationMs: 2000, path: arc });

  it('gives an identical attempt full marks', () => {
    const res = compareClips(ref, makeClip({ frames: 60, durationMs: 2000, path: arc }), opts);
    expect(res.score).toBeCloseTo(100, 5);
    expect(res.hint).toBeNull();
  });

  it('barely penalises signing the same thing more slowly', () => {
    const slow = makeClip({ frames: 110, durationMs: 3600, path: arc });
    const res = compareClips(ref, slow, opts);
    expect(res.score).toBeGreaterThan(95);
    expect(res.speedRatio).toBeCloseTo(1.8, 5);
  });

  it('scores a different movement low, mostly on location', () => {
    const res = compareClips(ref, makeClip({ frames: 60, durationMs: 2000, path: vertical }), opts);
    expect(res.score).toBeLessThan(70);
    expect(res.parts.location!).toBeLessThan(res.parts.shape!);
  });

  it('scores a different handshape low, mostly on shape', () => {
    const fist = makeClip({ frames: 60, durationMs: 2000, path: arc, shape: () => FIST });
    const res = compareClips(ref, fist, opts);
    expect(res.score).toBeLessThan(80);
    expect(res.parts.shape!).toBeLessThan(res.parts.location!);
    expect(res.hint).toMatchObject({ whole: true, part: 'shape', hand: 'right' });
  });

  it('penalises using the other hand unless mirroring is on', () => {
    const lefty = makeClip({
      frames: 60,
      durationMs: 2000,
      path: (u) => {
        const [x, y] = arc(u);
        return [1 - x, y];
      },
      side: 'left',
      flipX: true,
    });
    expect(compareClips(ref, lefty, opts).score).toBeLessThan(60);
    expect(compareClips(ref, lefty, { ...opts, mirror: true }).score).toBeGreaterThan(95);
  });

  it('points at the stretch where the handshape went wrong', () => {
    const late = makeClip({ frames: 60, durationMs: 2000, path: arc, shape: (u) => (u > 0.6 ? FIST : OPEN) });
    const res = compareClips(ref, late, opts);
    expect(res.hint).not.toBeNull();
    expect(res.hint!.part).toBe('shape');
    expect(res.hint!.hand).toBe('right');
    expect(res.hint!.whole).toBe(false);
    expect(res.hint!.startMs).toBeGreaterThan(1000);
  });
});

describe('compareClips with the face', () => {
  const neutral = () => FACE_KEYS.map(() => 0.05);
  const raised = () => FACE_KEYS.map((k) => (k.startsWith('browInnerUp') || k.startsWith('browOuterUp') ? 0.7 : 0.05));
  const withFace = { mirror: false, useFace: true };

  it('ignores where the head sits and only compares how it moves', () => {
    const ref = makeClip({ frames: 60, durationMs: 2000, path: arc, face: neutral });
    const leaning = makeClip({ frames: 60, durationMs: 2000, path: arc, face: neutral, nose: () => [0.55, 0.42] });
    expect(compareClips(ref, leaning, withFace).parts.face).toBeCloseTo(100, 5);

    const nodding = makeClip({
      frames: 60,
      durationMs: 2000,
      path: arc,
      face: neutral,
      nose: (u) => [0.5, 0.4 + 0.06 * Math.sin(4 * Math.PI * u)],
    });
    expect(compareClips(ref, nodding, withFace).parts.face!).toBeLessThan(90);
  });

  it('marks down missing raised brows and points at the face', () => {
    const ref = makeClip({ frames: 60, durationMs: 2000, path: arc, face: raised });
    const flat = makeClip({ frames: 60, durationMs: 2000, path: arc, face: neutral });
    const res = compareClips(ref, flat, withFace);
    expect(res.parts.face!).toBeLessThan(60);
    expect(res.parts.location).toBeCloseTo(100, 5);
    expect(res.hint?.part).toBe('face');
    expect(compareClips(ref, flat, opts).parts.face).toBeNull();
  });
});

describe('trimToHands', () => {
  it('drops handless frames at both ends and restarts time', () => {
    const clip = makeClip({ frames: 10, durationMs: 900, path: arc });
    const frames = clip.frames.map((f, n) => (n < 3 || n > 7 ? { ...f, right: null, rightWorld: null } : f));
    const trimmed = trimToHands(frames, 1);
    expect(trimmed).toHaveLength(7);
    expect(trimmed[0].t).toBe(0);
    expect(trimmed[1].right).not.toBeNull();
    expect(trimToHands(frames.map((f) => ({ ...f, right: null })))).toEqual([]);
  });
});
