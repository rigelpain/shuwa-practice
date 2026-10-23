import type { Candidate, Segment } from './reader';
import { trimToHands } from './recorder';
import { toSigns } from './sentence';
import type { Cue } from './subtitles';
import type { Frame, Word } from './types';

/** One stretch of a long video, on its way to becoming a sample. */
export interface Cut {
  /** Where it sits in the video. */
  startMs: number;
  endMs: number;
  /** The word it shows; empty until named. */
  label: string;
  /** Its version, or null to use the default chosen for the whole video. */
  variant: string | null;
  include: boolean;
  /** The closest known word, offered as its name. */
  suggestion: Candidate | null;
  /** The caption shown while it was signed, when captions were loaded. */
  caption: string | null;
  /** What filled in the name: a sample it resembles, or the caption's words. */
  guessedFrom: 'motion' | 'caption' | null;
}

/** Shortest a cut may be squeezed to by moving its edges. */
export const MIN_CUT_MS = 200;

export function cutsFromSegments(segments: Segment[], suggest: (s: Segment) => Candidate | null): Cut[] {
  return segments.map((segment) => {
    const suggestion = suggest(segment);
    return {
      startMs: segment.startMs,
      endMs: segment.endMs,
      label: suggestion?.word.label ?? '',
      variant: null,
      include: suggestion !== null,
      suggestion,
      caption: null,
      guessedFrom: suggestion ? 'motion' : null,
    };
  });
}

/** Moves one edge of a cut, keeping it inside the video and at least MIN_CUT_MS long. */
export function nudge(cut: Cut, edge: 'start' | 'end', deltaMs: number, durationMs: number): Cut {
  if (edge === 'start') {
    const startMs = Math.min(Math.max(0, cut.startMs + deltaMs), cut.endMs - MIN_CUT_MS);
    return { ...cut, startMs };
  }
  const endMs = Math.max(Math.min(durationMs, cut.endMs + deltaMs), cut.startMs + MIN_CUT_MS);
  return { ...cut, endMs };
}

/** Joins a cut with the one after it, for a sign the detector split in two. */
export function mergeWithNext(cuts: Cut[], index: number): Cut[] {
  const a = cuts[index];
  const b = cuts[index + 1];
  if (!a || !b) return cuts;
  const joined: Cut = {
    ...a,
    endMs: b.endMs,
    label: a.label || b.label,
    variant: a.variant ?? b.variant,
    include: a.include || b.include,
    suggestion: a.suggestion ?? b.suggestion,
  };
  return [...cuts.slice(0, index), joined, ...cuts.slice(index + 2)];
}

/** The frames of a cut, trimmed to where hands show and restarted at zero. */
export function framesIn(frames: Frame[], cut: Pick<Cut, 'startMs' | 'endMs'>): Frame[] {
  return trimToHands(frames.filter((f) => f.t >= cut.startMs && f.t <= cut.endMs));
}

/** How far a cut's middle may fall outside a caption and still belong to it. */
const CAPTION_SLACK_MS = 400;

/**
 * Attaches each caption to the cuts signed while it was showing, and names
 * cuts that resemble no known sample after the caption's vocabulary words, in
 * order. Japanese Sign Language does not always follow Japanese word order, so
 * these are only guesses for a person to check.
 */
export function applyCaptions(cuts: Cut[], cues: Cue[], words: Word[]): Cut[] {
  const out = cuts.map((c) => ({ ...c }));
  for (const cue of cues) {
    const inside = out.filter((c) => {
      const mid = (c.startMs + c.endMs) / 2;
      return mid >= cue.startMs - CAPTION_SLACK_MS && mid <= cue.endMs + CAPTION_SLACK_MS && c.caption === null;
    });
    const said = toSigns(cue.text, words).flatMap((t) => (t.word ? [t.word] : []));
    inside.forEach((c, i) => {
      c.caption = cue.text;
      const guess = said[i];
      if (guess && c.guessedFrom !== 'motion') {
        c.label = guess.label;
        c.include = true;
        c.guessedFrom = 'caption';
      }
    });
  }
  return out;
}
