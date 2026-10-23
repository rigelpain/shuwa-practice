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
}

export type FrameData = Omit<Frame, 't'>;

export interface Clip {
  id: string;
  wordId: string;
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
  /** The clip practice attempts are compared against. */
  referenceId: string | null;
  createdAt: number;
}
