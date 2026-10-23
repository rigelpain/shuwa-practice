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
  /** Head [yaw, pitch, roll] in degrees, or none. */
  head?: (u: number) => [number, number, number] | null;
  /** When true, the hand model misses the hand; the pose model still sees its wrist. */
  hidden?: (u: number) => boolean;
}

function makeClip({
  frames,
  durationMs,
  path,
  shape = () => OPEN,
  side = 'right',
  flipX = false,
  face = () => null,
  head = () => null,
  hidden = () => false,
}: ClipSpec): Clip {
  const out: Frame[] = [];
  for (let n = 0; n < frames; n++) {
    const u = frames === 1 ? 0 : n / (frames - 1);
    const [wx, wy] = path(u);
    const pts = shape(u).map(([x, y, z]) => [flipX ? -x : x, y, z]);
    const world = pts.flat();
    const image = pts.flatMap(([x, y, z]) => [wx + (x * 0.5) / ASPECT, wy + y * 0.5, z * 0.5]);
    const p = pose();
    p.splice((side === 'left' ? 15 : 16) * 4, 4, wx, wy, 0, 1);
    const seen = !hidden(u);
    out.push({
      t: u * durationMs,
      pose: p,
      left: seen && side === 'left' ? image : null,
      right: seen && side === 'right' ? image : null,
      leftWorld: seen && side === 'left' ? world : null,
      rightWorld: seen && side === 'right' ? world : null,
      face: face(u),
      head: head(u),
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

describe('compareClips with the face and head', () => {
  const neutral = () => FACE_KEYS.map(() => 0.05);
  const raised = () => FACE_KEYS.map((k) => (k.startsWith('browInnerUp') || k.startsWith('browOuterUp') ? 0.7 : 0.05));
  const still = (): [number, number, number] => [0, 0, 0];
  const withFace = { mirror: false, useFace: true };
  const clip = (spec: Partial<ClipSpec>) =>
    makeClip({ frames: 60, durationMs: 2000, path: arc, face: neutral, head: still, ...spec });
  /** Holds still for the first fifth (the resting pose), then moves. */
  const after = (u: number, move: number) => (u < 0.2 ? 0 : move);

  it('ignores a camera that sees the head turned the same way throughout', () => {
    const ref = clip({});
    const offAxis = clip({ head: () => [12, -6, 4] });
    expect(compareClips(ref, offAxis, withFace).parts.head).toBeCloseTo(100, 5);
  });

  it('names a missing head shake', () => {
    const ref = clip({ head: (u) => [after(u, 20 * Math.sin(6 * Math.PI * u)), 0, 0] });
    const res = compareClips(ref, clip({}), withFace);
    expect(res.parts.head!).toBeLessThan(60);
    expect(res.hint).toMatchObject({ part: 'head', detail: 'yaw', direction: 'less' });
  });

  it('names a tilt held through a question', () => {
    const ref = clip({ head: (u) => [0, 0, after(u, 15)] });
    const res = compareClips(ref, clip({}), withFace);
    expect(res.hint).toMatchObject({ part: 'head', detail: 'roll', direction: 'less' });
  });

  it('flips the direction of a turn when mirroring', () => {
    const ref = clip({ head: (u) => [after(u, 15), 0, after(u, 10)] });
    const mirrored = clip({ head: (u) => [after(u, -15), 0, after(u, -10)] });
    expect(compareClips(ref, mirrored, withFace).parts.head!).toBeLessThan(40);
    expect(compareClips(ref, mirrored, { ...withFace, mirror: true }).parts.head).toBeCloseTo(100, 5);
  });

  it('names missing raised brows', () => {
    const res = compareClips(clip({ face: raised }), clip({}), withFace);
    expect(res.parts.face!).toBeLessThan(60);
    expect(res.parts.location).toBeCloseTo(100, 5);
    expect(res.hint).toMatchObject({ part: 'face', detail: 'brows', direction: 'less' });
  });

  it('leaves the face and head out when asked to', () => {
    const res = compareClips(clip({ face: raised }), clip({}), opts);
    expect(res.parts.face).toBeNull();
    expect(res.parts.head).toBeNull();
  });
});

describe('a hand hidden behind the other', () => {
  it('is still compared by where the pose model puts its wrist', () => {
    const ref = makeClip({ frames: 60, durationMs: 2000, path: arc });
    const covered = makeClip({ frames: 60, durationMs: 2000, path: arc, hidden: (u) => u > 0.3 && u < 0.7 });
    // The same clip if the pose model had not seen the wrist either.
    const unseen = {
      ...covered,
      frames: covered.frames.map((f) => (f.right ? f : { ...f, pose: f.pose!.map((v, k) => (k === 16 * 4 + 3 ? 0 : v)) })),
    };

    const res = compareClips(ref, covered, opts);
    expect(res.parts.location!).toBeGreaterThan(95);
    expect(res.parts.location!).toBeGreaterThan(compareClips(ref, unseen, opts).parts.location! + 20);
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
