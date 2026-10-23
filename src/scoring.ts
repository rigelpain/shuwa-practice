import { dtw } from './dtw';
import { extractFeatures, type FrameFeature, type HandFeature } from './features';
import type { Clip } from './types';

/**
 * The raw difference that scores 50 points, per part. These are starting
 * values: record the same sign a few times and adjust until good attempts land
 * in the 80s. Raw values are shown under "計算の詳細" in the app.
 */
export const HALF_SCORE = {
  /** Wrist position, in shoulder widths. */
  location: 0.25,
  /** Mean joint offset, in hand lengths. */
  shape: 0.3,
  /** Blendshape RMS plus head movement (shoulder widths). */
  face: 0.2,
};

/** How much each part counts toward the total score. */
export const WEIGHTS = { location: 1, shape: 1.2, face: 0.6 };

/** Raw difference charged when a hand is visible in one clip but not the other. */
const MISSING = { location: 0.5, shape: 0.6 };

/** Warping band as a fraction of the longer clip. */
const BAND = 0.35;

/** A part scoring below this gets a hint about where it went wrong. */
const HINT_BELOW = 70;

export type Part = 'location' | 'shape' | 'face';

export interface CompareOptions {
  /** Mirror the attempt, for a signer whose dominant hand is opposite the reference's. */
  mirror: boolean;
  /** Include facial expression and head movement. */
  useFace: boolean;
}

export interface PairCost {
  location: number;
  shape: number;
  face: number;
  /** Per-hand cost on the same scale as `total`. */
  left: number;
  right: number;
  /** Weighted cost where 1 equals the 50-point level. */
  total: number;
}

export interface Hint {
  /** Time range in the reference clip. */
  startMs: number;
  endMs: number;
  /** The error runs through the whole clip rather than one stretch. */
  whole: boolean;
  part: Part;
  /** In the reference's terms; null when both hands are equally off. */
  hand: 'left' | 'right' | null;
}

export interface CompareResult {
  score: number;
  parts: Record<Part, number | null>;
  raw: Record<Part, number | null>;
  /** Attempt duration divided by reference duration. */
  speedRatio: number;
  path: Array<[number, number]>;
  costs: PairCost[];
  hint: Hint | null;
}

export function toScore(diff: number, half: number): number {
  return 100 / (1 + (diff / half) ** 2);
}

function handCost(a: HandFeature | null, b: HandFeature | null): [number, number] | null {
  if (!a && !b) return null;
  if (!a || !b) return [MISSING.location, MISSING.shape];
  const location = Math.hypot(a.loc[0] - b.loc[0], a.loc[1] - b.loc[1]);
  let shape = 0;
  for (let k = 0; k < 63; k += 3) {
    shape += Math.hypot(a.shape[k] - b.shape[k], a.shape[k + 1] - b.shape[k + 1], a.shape[k + 2] - b.shape[k + 2]);
  }
  return [location, shape / 21];
}

function faceCost(a: FrameFeature, b: FrameFeature): number {
  if (!a.face || !b.face) return 0;
  let sq = 0;
  for (let k = 0; k < a.face.length; k++) sq += (a.face[k] - b.face[k]) ** 2;
  const head = a.head && b.head ? Math.hypot(a.head[0] - b.head[0], a.head[1] - b.head[1]) : 0;
  return Math.sqrt(sq / a.face.length) + head;
}

const HAND_WEIGHT = WEIGHTS.location + WEIGHTS.shape;

function handTotal(location: number, shape: number): number {
  return (
    (WEIGHTS.location * location) / HALF_SCORE.location + (WEIGHTS.shape * shape) / HALF_SCORE.shape
  ) / HAND_WEIGHT;
}

export function pairCost(a: FrameFeature, b: FrameFeature, useFace: boolean): PairCost {
  const left = handCost(a.left, b.left);
  const right = handCost(a.right, b.right);
  const hands = [left, right].filter((h): h is [number, number] => h !== null);
  const location = hands.length ? hands.reduce((s, h) => s + h[0], 0) / hands.length : 0;
  const shape = hands.length ? hands.reduce((s, h) => s + h[1], 0) / hands.length : 0;
  const face = useFace ? faceCost(a, b) : 0;
  const handsOnly = handTotal(location, shape);
  const total = useFace
    ? (handsOnly * HAND_WEIGHT + (WEIGHTS.face * face) / HALF_SCORE.face) / (HAND_WEIGHT + WEIGHTS.face)
    : handsOnly;
  return {
    location,
    shape,
    face,
    left: left ? handTotal(...left) : 0,
    right: right ? handTotal(...right) : 0,
    total,
  };
}

function hasFace(features: FrameFeature[]): boolean {
  return features.filter((f) => f.face).length >= features.length / 2;
}

/** Compares a practice attempt with the reference clip of the same word. */
export function compareClips(ref: Clip, attempt: Clip, opts: CompareOptions): CompareResult {
  const a = extractFeatures(ref);
  const b = extractFeatures(attempt, opts.mirror);
  const useFace = opts.useFace && hasFace(a) && hasFace(b);

  const band = Math.ceil(BAND * Math.max(a.length, b.length));
  const { path } = dtw(a.length, b.length, (i, j) => pairCost(a[i], b[j], useFace).total, band);
  const costs = path.map(([i, j]) => pairCost(a[i], b[j], useFace));
  const mean = (key: keyof PairCost) => costs.reduce((s, c) => s + c[key], 0) / costs.length;

  const raw: Record<Part, number | null> = {
    location: mean('location'),
    shape: mean('shape'),
    face: useFace ? mean('face') : null,
  };
  const parts: Record<Part, number | null> = {
    location: toScore(raw.location!, HALF_SCORE.location),
    shape: toScore(raw.shape!, HALF_SCORE.shape),
    face: raw.face === null ? null : toScore(raw.face, HALF_SCORE.face),
  };

  let weighted = 0;
  let weightSum = 0;
  for (const part of ['location', 'shape', 'face'] as const) {
    const s = parts[part];
    if (s === null) continue;
    weighted += s * WEIGHTS[part];
    weightSum += WEIGHTS[part];
  }

  return {
    score: weighted / weightSum,
    parts,
    raw,
    speedRatio: ref.durationMs > 0 ? attempt.durationMs / ref.durationMs : 1,
    path,
    costs,
    hint: findHint(costs, path, ref, parts),
  };
}

/**
 * Explains the lowest-scoring part: where in the reference it went most wrong,
 * and with which hand.
 */
function findHint(
  costs: PairCost[],
  path: Array<[number, number]>,
  ref: Clip,
  parts: Record<Part, number | null>,
): Hint | null {
  const scored = (Object.keys(parts) as Part[]).filter((p) => parts[p] !== null);
  const part = scored.reduce((p, q) => (parts[q]! < parts[p]! ? q : p));
  if (parts[part]! >= HINT_BELOW) return null;

  const w = Math.max(3, Math.round(costs.length * 0.15));
  if (costs.length < w) return null;
  const cost = (c: PairCost) => c[part];

  let sum = 0;
  let best = -Infinity;
  let start = 0;
  for (let k = 0; k < costs.length; k++) {
    sum += cost(costs[k]);
    if (k >= w) sum -= cost(costs[k - w]);
    if (k >= w - 1 && sum > best) {
      best = sum;
      start = k - w + 1;
    }
  }

  // When the error is spread evenly, name the whole clip instead of an arbitrary window.
  const overall = costs.reduce((s, c) => s + cost(c), 0) / costs.length;
  let end = start + w - 1;
  if (best / w < 1.25 * overall) {
    start = 0;
    end = costs.length - 1;
  }

  const segment = costs.slice(start, end + 1);
  const left = segment.reduce((s, c) => s + c.left, 0);
  const right = segment.reduce((s, c) => s + c.right, 0);
  const hand =
    part === 'face' || Math.abs(left - right) < 0.15 * Math.max(left, right) ? null : left > right ? 'left' : 'right';

  return {
    startMs: ref.frames[path[start][0]].t,
    endMs: ref.frames[path[end][0]].t,
    whole: start === 0 && end === costs.length - 1,
    part,
    hand,
  };
}
