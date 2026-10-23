import { POSE } from './features';
import { trimToHands } from './recorder';
import { compareClips, type CompareOptions } from './scoring';
import type { Clip, Frame, FrameData, Word } from './types';

export interface SegmenterOptions {
  /** Wrist speed, in shoulder widths per second, that starts a sign. */
  startSpeed: number;
  /** Below this speed the hands count as still. */
  stillSpeed: number;
  /** A sign ends once the hands have been still this long… */
  stillMs: number;
  /** …or no hand has been seen this long… */
  goneMs: number;
  /** …or it has run this long. */
  maxMs: number;
  /** Shorter stretches are dropped as noise. */
  minMs: number;
  /** Frames kept from just before the movement started. */
  preroll: number;
}

export const SEGMENTER_DEFAULTS: SegmenterOptions = {
  startSpeed: 0.8,
  stillSpeed: 0.3,
  stillMs: 600,
  goneMs: 300,
  maxMs: 4000,
  minMs: 300,
  preroll: 3,
};

/** One sign cut out of a stream of frames. Frame times start at zero. */
export interface Segment {
  frames: Frame[];
  /** Where it sits in the stream. */
  startMs: number;
  endMs: number;
}

/** Shoulder width assumed when no pose is visible, in image heights. */
const DEFAULT_SHOULDER = 0.3;

/**
 * Cuts a live stream of tracked frames into single signs: a sign starts when
 * a hand moves, and ends when the hands hold still, leave the frame, or run too long.
 */
export class Segmenter {
  private recent: Frame[] = [];
  private current: Frame[] | null = null;
  private wrists: Record<'left' | 'right', [number, number] | null> = { left: null, right: null };
  private lastT = 0;
  private speed = 0;
  private stillSince: number | null = null;
  private goneSince: number | null = null;

  constructor(
    /** Image width divided by height. */
    private readonly aspect: number,
    private readonly opts: SegmenterOptions = SEGMENTER_DEFAULTS,
  ) {}

  /** True while a sign is being collected. */
  get active(): boolean {
    return this.current !== null;
  }

  /** Feeds one frame taken at time `t` (ms); returns a sign when one has just ended. */
  push(data: FrameData, t: number): Segment | null {
    const frame: Frame = { t, ...data };
    const speed = this.track(frame);
    const present = data.left !== null || data.right !== null;

    if (!this.current) {
      this.recent.push(frame);
      if (this.recent.length > this.opts.preroll + 1) this.recent.shift();
      if (present && speed >= this.opts.startSpeed) {
        this.current = [...this.recent];
        this.stillSince = this.goneSince = null;
      }
      return null;
    }

    this.current.push(frame);
    if (!present) this.goneSince ??= t;
    else {
      this.goneSince = null;
      if (speed < this.opts.stillSpeed) this.stillSince ??= t;
      else this.stillSince = null;
    }

    const { goneMs, stillMs, maxMs } = this.opts;
    if (this.goneSince !== null && t - this.goneSince >= goneMs) return this.close(this.goneSince);
    // Keep a little of the hold: many signs end on a held handshape.
    if (this.stillSince !== null && t - this.stillSince >= stillMs) return this.close(this.stillSince + 200);
    if (t - this.current[0].t >= maxMs) return this.close(t);
    return null;
  }

  /** Ends the sign in progress, as when a video file runs out. */
  flush(): Segment | null {
    return this.current ? this.close(Infinity) : null;
  }

  private close(until: number): Segment | null {
    const frames = this.current!.filter((f) => f.t <= until);
    this.current = null;
    this.recent = [];
    this.stillSince = this.goneSince = null;

    const first = frames.findIndex((f) => f.left !== null || f.right !== null);
    const kept = trimToHands(frames);
    if (first < 0 || kept.length === 0) return null;
    const startMs = frames[Math.max(0, first - 2)].t;
    const length = kept[kept.length - 1].t;
    if (length < this.opts.minMs) return null;
    return { frames: kept, startMs, endMs: startMs + length };
  }

  /** Smoothed fastest wrist speed, in shoulder widths per second. */
  private track(frame: Frame): number {
    const dt = (frame.t - this.lastT) / 1000;
    this.lastT = frame.t;
    const shoulder = shoulderWidth(frame.pose, this.aspect) ?? DEFAULT_SHOULDER;
    let fastest = 0;
    for (const side of ['left', 'right'] as const) {
      const wrist = wristOf(frame, side, this.aspect);
      const prev = this.wrists[side];
      if (wrist && prev && dt > 0) {
        fastest = Math.max(fastest, Math.hypot(wrist[0] - prev[0], wrist[1] - prev[1]) / shoulder / dt);
      }
      this.wrists[side] = wrist;
    }
    this.speed = this.speed * 0.5 + fastest * 0.5;
    return this.speed;
  }
}

function wristOf(frame: Frame, side: 'left' | 'right', aspect: number): [number, number] | null {
  const hand = frame[side];
  if (hand) return [hand[0] * aspect, hand[1]];
  const pose = frame.pose;
  const i = (side === 'left' ? POSE.leftWrist : POSE.rightWrist) * 4;
  return pose && pose[i + 3] > 0.5 ? [pose[i] * aspect, pose[i + 1]] : null;
}

function shoulderWidth(pose: number[] | null, aspect: number): number | null {
  if (!pose) return null;
  const l = POSE.leftShoulder * 4;
  const r = POSE.rightShoulder * 4;
  if (pose[l + 3] < 0.5 || pose[r + 3] < 0.5) return null;
  return Math.hypot((pose[l] - pose[r]) * aspect, pose[l + 1] - pose[r + 1]) || null;
}

/** A recorded sample of a word that live signing is compared with. */
export interface Template {
  word: Word;
  clip: Clip;
}

export interface Candidate {
  word: Word;
  score: number;
}

export interface Recognition {
  /** The best match, or null when nothing matched well enough. */
  word: Word | null;
  /** Up to three closest words, best first. */
  candidates: Candidate[];
}

/** Best score a sign needs before it is shown as that word. */
export const ACCEPT_SCORE = 50;

/** Names a sign by the word whose samples it is closest to. */
export function recognize(sign: Clip, templates: Template[], opts: CompareOptions): Recognition {
  const best = new Map<string, Candidate>();
  for (const { word, clip } of templates) {
    const score = compareClips(clip, sign, opts).score;
    if (score > (best.get(word.id)?.score ?? -Infinity)) best.set(word.id, { word, score });
  }
  const candidates = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  const top = candidates[0];
  return { word: top && top.score >= ACCEPT_SCORE ? top.word : null, candidates };
}

/** Wraps a segment as a clip so it can be scored like any recording. */
export function segmentClip(segment: Segment, width: number, height: number): Clip {
  return {
    id: `live-${segment.startMs}`,
    wordId: '',
    signer: '',
    createdAt: Date.now(),
    width,
    height,
    durationMs: segment.endMs - segment.startMs,
    frames: segment.frames,
  };
}
