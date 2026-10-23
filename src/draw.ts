import { FACE_MESH_LINKS } from './face-mesh';
import { POSE, POSE_HAND, type BodyFrame } from './features';
import { FACE_KEYS, type FaceKey, type FrameData } from './types';

const HAND_LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const ARM_LINKS: ReadonlyArray<readonly [number, number]> = [
  [POSE.leftShoulder, POSE.rightShoulder],
  [POSE.leftShoulder, POSE.leftElbow],
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightShoulder, POSE.rightElbow],
  [POSE.rightElbow, POSE.rightWrist],
];

interface Palette {
  stage: string;
  ink: string;
  soft: string;
  line: string;
  surface: string;
  left: string;
  right: string;
  heatLow: string;
  heatHigh: string;
}

let cached: Palette | null = null;
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  cached = null;
});

function palette(): Palette {
  if (!cached) {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    cached = {
      stage: v('--stage'),
      ink: v('--ink'),
      soft: v('--ink-soft'),
      line: v('--line'),
      surface: v('--surface'),
      left: v('--left'),
      right: v('--right'),
      heatLow: v('--heat-low'),
      heatHigh: v('--heat-high'),
    };
  }
  return cached;
}

/** Resizes a canvas's backing store to its displayed size. */
export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ratio = devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * ratio);
  const h = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return canvas.getContext('2d')!;
}

type Project = (x: number, y: number) => [number, number];

function strokeLinks(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  stride: number,
  links: ReadonlyArray<readonly [number, number]>,
  project: Project,
  visible: (i: number) => boolean = () => true,
): void {
  ctx.beginPath();
  for (const [a, b] of links) {
    if (!visible(a) || !visible(b)) continue;
    ctx.moveTo(...project(pts[a * stride], pts[a * stride + 1]));
    ctx.lineTo(...project(pts[b * stride], pts[b * stride + 1]));
  }
  ctx.stroke();
}

/** Wrist to pinky, index and thumb, and across the knuckles, in POSE_HAND order. */
const ROUGH_HAND_LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [0, 3], [1, 2],
];

function drawHands(ctx: CanvasRenderingContext2D, frame: FrameData, project: Project, size: number): void {
  const p = palette();
  for (const side of ['left', 'right'] as const) {
    const pts = frame[side];
    ctx.strokeStyle = ctx.fillStyle = p[side];
    if (!pts) {
      drawRoughHand(ctx, frame.pose, side, project, size);
      continue;
    }
    ctx.lineWidth = size;
    strokeLinks(ctx, pts, 3, HAND_LINKS, project);
    for (let k = 0; k < 21; k++) {
      const [x, y] = project(pts[k * 3], pts[k * 3 + 1]);
      ctx.beginPath();
      ctx.arc(x, y, size * (k === 0 ? 1.6 : 1.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * A dashed outline from the pose model's hand points, shown while the hand
 * model has lost the hand (usually because it is behind the other one).
 */
function drawRoughHand(
  ctx: CanvasRenderingContext2D,
  pose: number[] | null,
  side: 'left' | 'right',
  project: Project,
  size: number,
): void {
  const ids = POSE_HAND[side];
  if (!pose || pose.length < (ids[3] + 1) * 4 || pose[ids[0] * 4 + 3] < 0.5) return;
  const pts = ids.flatMap((i) => [pose[i * 4], pose[i * 4 + 1], 0]);
  ctx.save();
  ctx.lineWidth = size;
  ctx.setLineDash([size * 2.5, size * 2]);
  ctx.globalAlpha *= 0.8;
  strokeLinks(ctx, pts, 3, ROUGH_HAND_LINKS, project);
  ctx.restore();
}

/** What sits behind the bones: the frame they were tracked on, a dark fill, or nothing (the live video). */
export type Backdrop = CanvasImageSource | 'dark' | null;

/**
 * Draws the camera view in video pixel coordinates. Drawing the tracked frame
 * itself under the bones keeps the two in step; laying bones over the live
 * video makes them trail behind fast hands.
 */
/**
 * The tracked face: outline, brows, eyes and lips as lines, irises as small
 * rings. The outline is drawn lighter so the features stand out.
 */
function drawFaceMesh(ctx: CanvasRenderingContext2D, mesh: number[], project: Project, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.globalAlpha *= 0.5;
  strokeLinks(ctx, mesh, 2, FACE_MESH_LINKS.oval, project);
  ctx.globalAlpha /= 0.5;
  for (const part of ['brows', 'eyes', 'lips', 'irises'] as const) strokeLinks(ctx, mesh, 2, FACE_MESH_LINKS[part], project);
  ctx.restore();
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: FrameData,
  view: { backdrop: Backdrop; bones: boolean; face: boolean },
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (view.backdrop === 'dark') {
    ctx.fillStyle = palette().stage;
    ctx.fillRect(0, 0, w, h);
  } else if (view.backdrop) {
    ctx.drawImage(view.backdrop, 0, 0, w, h);
  }
  if (!view.bones) return;
  const project: Project = (x, y) => [x * w, y * h];
  const size = Math.max(2, w / 400);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (view.face && frame.faceMesh) drawFaceMesh(ctx, frame.faceMesh, project, size * 0.6, 'rgba(255, 255, 255, 0.85)');
  if (frame.pose) {
    const pose = frame.pose;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = size * 1.5;
    strokeLinks(ctx, pose, 4, ARM_LINKS, project, (i) => pose[i * 4 + 3] > 0.5);
  }
  drawHands(ctx, frame, project, size);
}

const faceIndex = (key: FaceKey) => FACE_KEYS.indexOf(key);

/** Scale and vertical placement for figures, as fractions of the canvas size. */
export interface FigureView {
  /** One shoulder width, as a fraction of the canvas width. */
  unit: number;
  /** Shoulder line, as a fraction of the canvas height. */
  originY: number;
}

/**
 * Picks one view that fits every frame of the given clips, so the figures
 * keep the same scale side by side and nothing is cut off at the edges.
 */
export function fitView(clips: Array<{ frames: FrameData[]; body: BodyFrame }>): FigureView {
  // Start from a typical upper body: arms' reach to the sides, head above, chest below.
  let maxU = 1.3;
  let minV = -1.5;
  let maxV = 1.1;
  for (const { frames, body } of clips) {
    const visit = (x: number, y: number) => {
      maxU = Math.max(maxU, Math.abs((x * body.aspect - body.cx) / body.scale));
      const v = (y - body.cy) / body.scale;
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    };
    for (const f of frames) {
      for (const pts of [f.left, f.right]) {
        if (pts) for (let k = 0; k < pts.length; k += 3) visit(pts[k], pts[k + 1]);
      }
      if (f.pose) {
        for (let k = 0; k < f.pose.length; k += 4) if (f.pose[k + 3] > 0.5) visit(f.pose[k], f.pose[k + 1]);
      }
    }
  }
  // Keep a stray detection from shrinking everything to a dot.
  maxU = Math.min(maxU, 3);
  minV = Math.max(minV, -3.5);
  maxV = Math.min(maxV, 3);
  const pad = 1.1;
  const unit = Math.min(1 / 3.6, 0.5 / (maxU * pad), 1 / ((maxV - minV) * pad));
  return { unit, originY: 0.5 - ((minV + maxV) / 2) * unit };
}

/**
 * Draws a frame as a figure normalised to the signer's shoulders, so clips
 * filmed at different distances appear at the same size.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  frame: FrameData,
  body: BodyFrame,
  view: FigureView,
  opts: { flip: boolean; alpha?: number; clear?: boolean },
): void {
  const { width: W, height: H } = ctx.canvas;
  if (opts.clear !== false) ctx.clearRect(0, 0, W, H);
  const p = palette();
  const unit = view.unit * W;
  const project: Project = (x, y) => {
    const u = (x * body.aspect - body.cx) / body.scale;
    const v = (y - body.cy) / body.scale;
    return [W / 2 + (opts.flip ? -u : u) * unit, view.originY * H + v * unit];
  };
  const size = Math.max(1.5, W / 220);

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const pose = frame.pose;
  if (pose) {
    const vis = (i: number) => pose[i * 4 + 3] > 0.5;
    ctx.strokeStyle = p.soft;
    ctx.lineWidth = size * 2.2;
    strokeLinks(ctx, pose, 4, ARM_LINKS, project, vis);
    // A recorded face is drawn as it was; older clips get the simple glyph.
    if (!frame.faceMesh) drawHead(ctx, pose, frame.face, project, vis, size);
  }
  if (frame.faceMesh) drawFaceMesh(ctx, frame.faceMesh, project, size * 0.8, p.ink);
  drawHands(ctx, frame, project, size);
  ctx.restore();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  pose: number[],
  face: number[] | null,
  project: Project,
  vis: (i: number) => boolean,
  size: number,
): void {
  const p = palette();
  const at = (i: number) => project(pose[i * 4], pose[i * 4 + 1]);
  let cx: number, cy: number, r: number;
  // Tilt follows the line between the ears; turning shows as the nose sliding sideways.
  let tilt = 0;
  let turn = 0;
  if (vis(POSE.leftEar) && vis(POSE.rightEar)) {
    const [ax, ay] = at(POSE.leftEar);
    const [bx, by] = at(POSE.rightEar);
    cx = (ax + bx) / 2;
    cy = (ay + by) / 2;
    const span = Math.hypot(ax - bx, ay - by);
    r = (span / 2) * 1.3;
    tilt = Math.atan2(ay - by, ax - bx);
    if (tilt > Math.PI / 2) tilt -= Math.PI;
    if (tilt < -Math.PI / 2) tilt += Math.PI;
    if (vis(POSE.nose) && span > 0) {
      const [nx, ny] = at(POSE.nose);
      const along = ((nx - cx) * Math.cos(tilt) + (ny - cy) * Math.sin(tilt)) / (span / 2);
      turn = Math.max(-1, Math.min(1, along));
    }
  } else if (vis(POSE.nose)) {
    [cx, cy] = at(POSE.nose);
    r = size * 14;
  } else {
    return;
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.strokeStyle = p.soft;
  ctx.lineWidth = size * 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  const dx = turn * r * 0.45;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = size * 1.4;
  ctx.beginPath();
  ctx.moveTo(dx, -r * 0.08);
  ctx.lineTo(dx, r * 0.16);
  ctx.stroke();

  if (face) {
    // Brows rise with browInnerUp / browOuterUp; the mouth opens with jawOpen.
    const s = (key: FaceKey) => face[faceIndex(key)];
    const lift = s('browInnerUp') * 0.6 + (s('browOuterUpLeft') + s('browOuterUpRight')) * 0.2;
    const lower = (s('browDownLeft') + s('browDownRight')) * 0.25;
    const browY = -r * (0.28 + 0.3 * lift - 0.2 * lower);
    ctx.beginPath();
    ctx.moveTo(dx - r * 0.55, browY);
    ctx.lineTo(dx - r * 0.18, browY - r * 0.05);
    ctx.moveTo(dx + r * 0.18, browY - r * 0.05);
    ctx.lineTo(dx + r * 0.55, browY);
    ctx.stroke();
    const open = s('jawOpen');
    const wide = 0.32 + (0.12 * (s('mouthSmileLeft') + s('mouthSmileRight'))) / 2 - 0.15 * s('mouthPucker');
    ctx.beginPath();
    ctx.ellipse(dx, r * 0.42, r * wide, r * (0.04 + 0.3 * open), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A strip of how far apart the two clips were at each aligned step. */
export function drawTimeline(ctx: CanvasRenderingContext2D, costs: number[], cursor: number): void {
  const { width: W, height: H } = ctx.canvas;
  const p = palette();
  const low = hexToRgb(p.heatLow);
  const high = hexToRgb(p.heatHigh);
  ctx.clearRect(0, 0, W, H);
  const step = W / costs.length;
  costs.forEach((c, k) => {
    // Full colour at 1.5× the 50-point level.
    const t = Math.min(1, c / 1.5);
    const mix = low.map((v, i) => Math.round(v + (high[i] - v) * t));
    ctx.fillStyle = `rgb(${mix.join(' ')})`;
    ctx.fillRect(Math.floor(k * step), 0, Math.ceil(step) + 1, H);
  });
  const x = (cursor + 0.5) * step;
  ctx.fillStyle = p.ink;
  ctx.fillRect(Math.round(x) - 1, 0, 2 * (devicePixelRatio || 1), H);
}
