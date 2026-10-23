import { dtw } from './dtw';
import { extractFeatures, type FrameFeature, type HandFeature } from './features';
import { FACE_KEYS, type Clip, type FaceKey } from './types';

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
  /** Blendshape RMS, 0–1. */
  face: 0.2,
  /** Head orientation (shake, nod, tilt together), in degrees. */
  head: 10,
};

/** How much each part counts toward the total score. */
export const WEIGHTS = { location: 1, shape: 1.2, face: 0.5, head: 0.5 };

/** Raw difference charged when a hand is visible in one clip but not the other. */
const MISSING = { location: 0.5, shape: 0.6 };

/**
 * Shape difference assumed when one clip only knows where the wrist is, as
 * happens while that hand is hidden behind the other: neither a match nor a miss.
 */
const UNKNOWN_SHAPE = 0.15;

/** Warping band as a fraction of the longer clip. */
const BAND = 0.35;

/** A part scoring below this gets a hint about where it went wrong. */
const HINT_BELOW = 70;

export type Part = 'location' | 'shape' | 'face' | 'head';
export type HeadAxis = 'yaw' | 'pitch' | 'roll';
export type FaceGroup = 'brows' | 'eyes' | 'mouth';

const HEAD_AXES: HeadAxis[] = ['yaw', 'pitch', 'roll'];

const keysWhere = (test: (key: FaceKey) => boolean) => FACE_KEYS.flatMap((key, i) => (test(key) ? [i] : []));

const FACE_GROUPS: Record<FaceGroup, number[]> = {
  brows: keysWhere((k) => k.startsWith('brow')),
  eyes: keysWhere((k) => k.startsWith('eye')),
  mouth: keysWhere((k) => k.startsWith('jaw') || k.startsWith('mouth') || k.startsWith('cheek')),
};

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
  head: number;
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
  /** Which head movement or which part of the face went wrong. */
  detail: HeadAxis | FaceGroup | null;
  /** Whether the attempt did less or more of it than the reference. */
  direction: 'less' | 'more' | null;
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
  if (!a.shape || !b.shape) return [location, UNKNOWN_SHAPE];
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
  return Math.sqrt(sq / a.face.length);
}

function headCost(a: FrameFeature, b: FrameFeature): number {
  if (!a.head || !b.head) return 0;
  return Math.hypot(a.head[0] - b.head[0], a.head[1] - b.head[1], a.head[2] - b.head[2]);
}

const HAND_WEIGHT = WEIGHTS.location + WEIGHTS.shape;

function handTotal(location: number, shape: number): number {
  return (
    (WEIGHTS.location * location) / HALF_SCORE.location + (WEIGHTS.shape * shape) / HALF_SCORE.shape
  ) / HAND_WEIGHT;
}

interface Uses {
  face: boolean;
  head: boolean;
}

export function pairCost(a: FrameFeature, b: FrameFeature, use: Uses): PairCost {
  const left = handCost(a.left, b.left);
  const right = handCost(a.right, b.right);
  const hands = [left, right].filter((h): h is [number, number] => h !== null);
  const location = hands.length ? hands.reduce((s, h) => s + h[0], 0) / hands.length : 0;
  const shape = hands.length ? hands.reduce((s, h) => s + h[1], 0) / hands.length : 0;
  const face = use.face ? faceCost(a, b) : 0;
  const head = use.head ? headCost(a, b) : 0;

  let sum = handTotal(location, shape) * HAND_WEIGHT;
  let weight = HAND_WEIGHT;
  if (use.face) {
    sum += (WEIGHTS.face * face) / HALF_SCORE.face;
    weight += WEIGHTS.face;
  }
  if (use.head) {
    sum += (WEIGHTS.head * head) / HALF_SCORE.head;
    weight += WEIGHTS.head;
  }
  return {
    location,
    shape,
    face,
    head,
    left: left ? handTotal(...left) : 0,
    right: right ? handTotal(...right) : 0,
    total: sum / weight,
  };
}

/** True when at least half the frames carry the given reading. */
function mostlyHas(features: FrameFeature[], key: 'face' | 'head'): boolean {
  return features.filter((f) => f[key]).length >= features.length / 2;
}

/** Compares a practice attempt with the reference clip of the same word. */
export function compareClips(ref: Clip, attempt: Clip, opts: CompareOptions): CompareResult {
  const a = extractFeatures(ref);
  const b = extractFeatures(attempt, opts.mirror);
  const use: Uses = {
    face: opts.useFace && mostlyHas(a, 'face') && mostlyHas(b, 'face'),
    head: opts.useFace && mostlyHas(a, 'head') && mostlyHas(b, 'head'),
  };

  const band = Math.ceil(BAND * Math.max(a.length, b.length));
  const { path } = dtw(a.length, b.length, (i, j) => pairCost(a[i], b[j], use).total, band);
  const costs = path.map(([i, j]) => pairCost(a[i], b[j], use));
  const mean = (key: keyof PairCost) => costs.reduce((s, c) => s + c[key], 0) / costs.length;

  const raw: Record<Part, number | null> = {
    location: mean('location'),
    shape: mean('shape'),
    face: use.face ? mean('face') : null,
    head: use.head ? mean('head') : null,
  };
  const parts = {} as Record<Part, number | null>;
  let weighted = 0;
  let weightSum = 0;
  for (const part of ['location', 'shape', 'face', 'head'] as const) {
    const r = raw[part];
    parts[part] = r === null ? null : toScore(r, HALF_SCORE[part]);
    if (parts[part] === null) continue;
    weighted += parts[part] * WEIGHTS[part];
    weightSum += WEIGHTS[part];
  }

  return {
    score: weighted / weightSum,
    parts,
    raw,
    speedRatio: ref.durationMs > 0 ? attempt.durationMs / ref.durationMs : 1,
    path,
    costs,
    hint: findHint({ costs, path, ref, parts, a, b }),
  };
}

interface HintInput {
  costs: PairCost[];
  path: Array<[number, number]>;
  ref: Clip;
  parts: Record<Part, number | null>;
  a: FrameFeature[];
  b: FrameFeature[];
}

/**
 * Explains the lowest-scoring part: where in the reference it went most wrong,
 * with which hand, and for the face and head, what exactly.
 */
function findHint({ costs, path, ref, parts, a, b }: HintInput): Hint | null {
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
  const pairs = path.slice(start, end + 1).map(([i, j]) => [a[i], b[j]] as const);
  const left = segment.reduce((s, c) => s + c.left, 0);
  const right = segment.reduce((s, c) => s + c.right, 0);
  const handsPart = part === 'location' || part === 'shape';
  const hand =
    !handsPart || Math.abs(left - right) < 0.15 * Math.max(left, right) ? null : left > right ? 'left' : 'right';

  let detail: Hint['detail'] = null;
  let direction: Hint['direction'] = null;
  if (part === 'head') [detail, direction] = headDetail(pairs);
  if (part === 'face') [detail, direction] = faceDetail(pairs);

  return {
    startMs: ref.frames[path[start][0]].t,
    endMs: ref.frames[path[end][0]].t,
    whole: start === 0 && end === costs.length - 1,
    part,
    hand,
    detail,
    direction,
  };
}

type Pairs = ReadonlyArray<readonly [FrameFeature, FrameFeature]>;

/** The head movement that differed most, and whether the attempt moved less. */
function headDetail(pairs: Pairs): [HeadAxis, 'less' | 'more'] {
  const both = pairs.filter(([x, y]) => x.head && y.head);
  const off = HEAD_AXES.map((_, k) => both.reduce((s, [x, y]) => s + Math.abs(x.head![k] - y.head![k]), 0));
  const k = off.indexOf(Math.max(...off));
  const refMove = both.reduce((s, [x]) => s + Math.abs(x.head![k]), 0);
  const tryMove = both.reduce((s, [, y]) => s + Math.abs(y.head![k]), 0);
  return [HEAD_AXES[k], tryMove < refMove ? 'less' : 'more'];
}

/** The part of the face that differed most, and whether the attempt showed less of it. */
function faceDetail(pairs: Pairs): [FaceGroup, 'less' | 'more'] {
  const both = pairs.filter(([x, y]) => x.face && y.face);
  const groups = Object.keys(FACE_GROUPS) as FaceGroup[];
  const rms = (keys: number[]) =>
    both.reduce((s, [x, y]) => s + Math.sqrt(keys.reduce((q, k) => q + (x.face![k] - y.face![k]) ** 2, 0) / keys.length), 0);
  const off = groups.map((g) => rms(FACE_GROUPS[g]));
  const group = groups[off.indexOf(Math.max(...off))];
  const keys = FACE_GROUPS[group];
  const refShow = both.reduce((s, [x]) => s + keys.reduce((q, k) => q + x.face![k], 0), 0);
  const tryShow = both.reduce((s, [, y]) => s + keys.reduce((q, k) => q + y.face![k], 0), 0);
  return [group, tryShow < refShow ? 'less' : 'more'];
}
