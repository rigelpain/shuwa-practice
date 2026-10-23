/**
 * Face blendshapes kept for each frame, in this order. They cover the
 * non-manual signals that carry grammar in sign language: brows, eyes, mouth.
 */
export const FACE_KEYS = [
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'eyeWideLeft',
  'eyeWideRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'jawOpen',
  'mouthPucker',
  'mouthFunnel',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthPressLeft',
  'mouthPressRight',
  'cheekPuff',
] as const;

export type FaceKey = (typeof FACE_KEYS)[number];

/**
 * One tracked video frame. Landmarks are flat arrays to keep stored clips small.
 * "left" and "right" are the signer's own hands, not sides of the image.
 */
export interface Frame {
  /** Milliseconds from the start of the clip. */
  t: number;
  /** Pose points 0–16 (head, shoulders, elbows, wrists) as [x, y, z, visibility], image-normalized. */
  pose: number[] | null;
  /** 21 hand joints as [x, y, z], image-normalized. */
  left: number[] | null;
  right: number[] | null;
  /** The same joints in MediaPipe world coordinates (metres, hand-centred). */
  leftWorld: number[] | null;
  rightWorld: number[] | null;
  /** FACE_KEYS scores, 0–1. */
  face: number[] | null;
  /**
   * Head orientation as [yaw, pitch, roll] in degrees: shaking, nodding and
   * tilting. Missing in clips recorded before head tracking was added.
   */
  head?: number[] | null;
}

export type FrameData = Omit<Frame, 't'>;

/**
 * A sample is a signer showing the word: samples are what live signing is
 * read against, and the word's reference is one of them. A practice is a
 * learner's attempt, scored against the reference but never read against.
 */
export type ClipKind = 'sample' | 'practice';

export interface Clip {
  id: string;
  wordId: string;
  /** Missing in clips recorded before kinds existed; see clipKind(). */
  kind?: ClipKind;
  /**
   * Which version of the sign this is, for words signed differently by region,
   * family or community: '' is the word's main version. Missing in older clips.
   */
  variant?: string;
  /**
   * For a clip cut from a longer video whose file was kept: that video's id in
   * the video store and where the clip sits in it. Clips with only bones have none.
   */
  source?: { videoId: string; startMs: number; endMs: number };
  /** Who signed it. Kept so training data can later be split by person. */
  signer: string;
  createdAt: number;
  /** Source video size, needed to undo the image aspect ratio. */
  width: number;
  height: number;
  durationMs: number;
  frames: Frame[];
}

export interface Word {
  id: string;
  label: string;
  /**
   * The reference of the word's first version, kept for older code and files.
   * Use referenceFor() to get the reference of a particular version.
   */
  referenceId: string | null;
  /** Reference clip of each version, keyed by version name. Missing in older words. */
  references?: Record<string, string>;
  createdAt: number;
  /** Group in the word list; words added by hand have none. */
  category?: string;
}

/** The main version of a word, shown as 基本. */
export const MAIN_VARIANT = '';

export const variantOf = (clip: Clip): string => clip.variant ?? MAIN_VARIANT;

/** Each version's reference clip id, including what older words kept in referenceId. */
export function referencesOf(word: Word): Record<string, string> {
  return word.references ?? (word.referenceId ? { [MAIN_VARIANT]: word.referenceId } : {});
}

export function referenceFor(word: Word, variant: string): string | null {
  return referencesOf(word)[variant] ?? null;
}

/** Sets (or with null, clears) a version's reference, keeping referenceId pointing at the first one. */
export function setReference(word: Word, variant: string, clipId: string | null): void {
  const refs = { ...referencesOf(word) };
  if (clipId) refs[variant] = clipId;
  else delete refs[variant];
  word.references = refs;
  word.referenceId = refs[MAIN_VARIANT] ?? Object.values(refs)[0] ?? null;
}

/** Older clips have no kind: a reference counts as a sample, anything else as practice. */
export function clipKind(clip: Clip, word: Word | null): ClipKind {
  return clip.kind ?? (word && Object.values(referencesOf(word)).includes(clip.id) ? 'sample' : 'practice');
}
