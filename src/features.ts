import { FACE_KEYS, type Clip, type FaceKey } from './types';

/** MediaPipe pose indices used here. Points 0–16 are stored with each frame. */
export const POSE = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;
export const POSE_KEEP = 17;

/** Where the signer's body sits in the image, so clips filmed differently line up. */
export interface BodyFrame {
  /** Shoulder centre, in aspect-corrected image units (x scaled by width / height). */
  cx: number;
  cy: number;
  /** Shoulder width in the same units. */
  scale: number;
  aspect: number;
}

export interface HandFeature {
  /** Wrist position relative to the shoulder centre, in shoulder widths. */
  loc: [number, number];
  /** 21 joints as [x, y, z] relative to the wrist, in hand lengths (wrist to middle-finger base). */
  shape: Float32Array;
}

export interface FrameFeature {
  left: HandFeature | null;
  right: HandFeature | null;
  /** FACE_KEYS scores, smoothed over neighbouring frames. */
  face: Float32Array | null;
  /**
   * Nose offset from where it usually sits in this clip, in shoulder widths.
   * Nods and head shakes show up here; posture and camera angle do not.
   */
  head: [number, number] | null;
}

/** Hand dropouts up to this many frames are filled by interpolation. */
const MAX_GAP = 5;
/** Blendshapes jitter from frame to frame, so they are averaged over ±this many frames. */
const FACE_SMOOTH = 2;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function bodyFrame(clip: Pick<Clip, 'frames' | 'width' | 'height'>): BodyFrame {
  const aspect = clip.width / clip.height;
  const xs: number[] = [];
  const ys: number[] = [];
  const widths: number[] = [];
  const l = POSE.leftShoulder * 4;
  const r = POSE.rightShoulder * 4;
  for (const { pose: p } of clip.frames) {
    if (!p || p[l + 3] < 0.5 || p[r + 3] < 0.5) continue;
    const lx = p[l] * aspect;
    const rx = p[r] * aspect;
    xs.push((lx + rx) / 2);
    ys.push((p[l + 1] + p[r + 1]) / 2);
    widths.push(Math.hypot(lx - rx, p[l + 1] - p[r + 1]));
  }
  // Without a visible body, assume a signer centred in a typical webcam shot.
  if (widths.length === 0) return { cx: aspect / 2, cy: 0.6, scale: 0.3, aspect };
  return { cx: median(xs), cy: median(ys), scale: Math.max(median(widths), 1e-3), aspect };
}

function handFeature(image: number[], world: number[] | null, body: BodyFrame, sx: number): HandFeature {
  const loc: [number, number] = [
    (sx * (image[0] * body.aspect - body.cx)) / body.scale,
    (image[1] - body.cy) / body.scale,
  ];
  const src = world ?? image.map((v, k) => (k % 3 === 0 ? v * body.aspect : v));
  const [ox, oy, oz] = src;
  const size = Math.hypot(src[27] - ox, src[28] - oy, src[29] - oz) || 1;
  const shape = new Float32Array(63);
  for (let k = 0; k < 63; k += 3) {
    shape[k] = (sx * (src[k] - ox)) / size;
    shape[k + 1] = (src[k + 1] - oy) / size;
    shape[k + 2] = (src[k + 2] - oz) / size;
  }
  return { loc, shape };
}

function blend(hands: HandFeature[], weights: number[]): HandFeature {
  const loc: [number, number] = [0, 0];
  const shape = new Float32Array(63);
  let total = 0;
  hands.forEach((h, n) => {
    const w = weights[n];
    total += w;
    loc[0] += h.loc[0] * w;
    loc[1] += h.loc[1] * w;
    for (let k = 0; k < 63; k++) shape[k] += h.shape[k] * w;
  });
  loc[0] /= total;
  loc[1] /= total;
  for (let k = 0; k < 63; k++) shape[k] /= total;
  return { loc, shape };
}

function fillGaps(seq: (HandFeature | null)[]): void {
  let prev = -1;
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i];
    if (!cur) continue;
    const gap = i - prev - 1;
    if (prev >= 0 && gap > 0 && gap <= MAX_GAP) {
      const a = seq[prev]!;
      for (let k = prev + 1; k < i; k++) {
        const r = (k - prev) / (i - prev);
        seq[k] = blend([a, cur], [1 - r, r]);
      }
    }
    prev = i;
  }
}

/** 1-2-1 smoothing over the neighbours that are present. */
function smooth(seq: (HandFeature | null)[]): (HandFeature | null)[] {
  return seq.map((h, i) => {
    if (!h) return null;
    const hands = [h];
    const weights = [2];
    for (const n of [seq[i - 1], seq[i + 1]]) {
      if (n) {
        hands.push(n);
        weights.push(1);
      }
    }
    return blend(hands, weights);
  });
}

const MIRRORED_FACE = FACE_KEYS.map((key) => {
  const swapped = key.endsWith('Left') ? key.replace(/Left$/, 'Right') : key.replace(/Right$/, 'Left');
  return FACE_KEYS.indexOf(swapped as FaceKey);
});

/**
 * Turns a clip into body-relative features. With `mirror`, left and right are
 * swapped and flipped, so a left-handed signer can be compared to a right-handed one.
 */
export function extractFeatures(clip: Clip, mirror = false): FrameFeature[] {
  const body = bodyFrame(clip);
  const sx = mirror ? -1 : 1;
  const hand = (image: number[] | null, world: number[] | null) =>
    image ? handFeature(image, world, body, sx) : null;

  const features: FrameFeature[] = clip.frames.map((f) => {
    const left = hand(f.left, f.leftWorld);
    const right = hand(f.right, f.rightWorld);
    const face = f.face;
    const nose = f.pose && f.pose[POSE.nose * 4 + 3] > 0.5 ? f.pose : null;
    return {
      left: mirror ? right : left,
      right: mirror ? left : right,
      face: face ? Float32Array.from(mirror ? MIRRORED_FACE.map((i) => face[i]) : face) : null,
      head: nose
        ? [(sx * (nose[0] * body.aspect - body.cx)) / body.scale, (nose[1] - body.cy) / body.scale]
        : null,
    };
  });

  for (const side of ['left', 'right'] as const) {
    const seq = features.map((f) => f[side]);
    fillGaps(seq);
    smooth(seq).forEach((h, i) => {
      features[i][side] = h;
    });
  }

  const faces = features.map((f) => f.face);
  faces.forEach((face, i) => {
    if (!face) return;
    const near = faces.slice(Math.max(0, i - FACE_SMOOTH), i + FACE_SMOOTH + 1).filter((f) => f !== null);
    const mean = new Float32Array(face.length);
    for (const f of near) for (let k = 0; k < f.length; k++) mean[k] += f[k] / near.length;
    features[i].face = mean;
  });

  const heads = features.flatMap((f) => (f.head ? [f.head] : []));
  if (heads.length) {
    const hx = median(heads.map((h) => h[0]));
    const hy = median(heads.map((h) => h[1]));
    for (const f of features) if (f.head) f.head = [f.head[0] - hx, f.head[1] - hy];
  }
  return features;
}
