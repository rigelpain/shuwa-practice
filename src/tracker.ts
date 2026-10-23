import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type Landmark,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { POSE, POSE_KEEP } from './features';
import { FACE_KEYS, type FrameData } from './types';

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`;

type Delegate = 'GPU' | 'CPU';
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Size of the square the face crop is scaled to. */
const FACE_CROP = 256;

async function withFallback<T>(create: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    return create('CPU');
  }
}

function flat(points: (NormalizedLandmark | Landmark)[]): number[] {
  const out = new Array<number>(points.length * 3);
  points.forEach((p, i) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  });
  return out;
}

/** Runs the hand, pose and (optionally) face landmarkers on video frames. */
export class Tracker {
  private face: FaceLandmarker | null = null;
  private lastTimestamp = 0;

  private constructor(
    private readonly fileset: WasmFileset,
    private readonly hands: HandLandmarker,
    private readonly pose: PoseLandmarker,
  ) {}

  static async create(): Promise<Tracker> {
    const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
    const hands = await withFallback((delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${ASSETS}/models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
    );
    const pose = await withFallback((delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${ASSETS}/models/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    );
    return new Tracker(fileset, hands, pose);
  }

  get faceEnabled(): boolean {
    return this.face !== null;
  }

  async setFace(enabled: boolean): Promise<void> {
    if (enabled && !this.face) {
      this.face = await withFallback((delegate) =>
        FaceLandmarker.createFromOptions(this.fileset, {
          baseOptions: { modelAssetPath: `${ASSETS}/models/face_landmarker.task`, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        }),
      );
    } else if (!enabled && this.face) {
      this.face.close();
      this.face = null;
    }
  }

  detect(source: HTMLVideoElement): FrameData {
    // MediaPipe needs strictly increasing timestamps, even across source changes.
    const timestamp = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    const poseLandmarks = this.pose.detectForVideo(source, timestamp).landmarks[0] ?? null;
    const handResult = this.hands.detectForVideo(source, timestamp);
    const faceResult = this.face?.detectForVideo(this.faceCrop(source, poseLandmarks), timestamp) ?? null;

    const pose = poseLandmarks
      ? poseLandmarks.slice(0, POSE_KEEP).flatMap((p) => [p.x, p.y, p.z, p.visibility ?? 0])
      : null;
    const { left, right } = assignHands(handResult, poseLandmarks);

    return {
      pose,
      left: left === null ? null : flat(handResult.landmarks[left]),
      right: right === null ? null : flat(handResult.landmarks[right]),
      leftWorld: left === null ? null : flat(handResult.worldLandmarks[left]),
      rightWorld: right === null ? null : flat(handResult.worldLandmarks[right]),
      face: faceScores(faceResult),
    };
  }

  /**
   * The face detector only finds faces that fill a fair part of the image, and
   * a signer filmed from the waist up is too small. When the pose shows where
   * the head is, hand the face model a square crop around it instead.
   */
  private faceCrop(source: HTMLVideoElement, pose: NormalizedLandmark[] | null): HTMLVideoElement | HTMLCanvasElement {
    const W = source.videoWidth;
    const H = source.videoHeight;
    const nose = pose?.[POSE.nose];
    if (!pose || !nose || (nose.visibility ?? 0) < 0.5 || !W || !H) return source;

    const px = (i: number): [number, number] => [pose[i].x * W, pose[i].y * H];
    const dist = (a: number, b: number) => Math.hypot(px(a)[0] - px(b)[0], px(a)[1] - px(b)[1]);
    const side = Math.min(
      Math.max(1.3 * dist(POSE.leftShoulder, POSE.rightShoulder), 3.2 * dist(POSE.leftEar, POSE.rightEar), 96),
      W,
      H,
    );
    const [nx, ny] = px(POSE.nose);
    const x = Math.min(Math.max(nx - side / 2, 0), W - side);
    const y = Math.min(Math.max(ny - side / 2, 0), H - side);

    this.faceCanvas.getContext('2d')!.drawImage(source, x, y, side, side, 0, 0, FACE_CROP, FACE_CROP);
    return this.faceCanvas;
  }

  private readonly faceCanvas = Object.assign(document.createElement('canvas'), {
    width: FACE_CROP,
    height: FACE_CROP,
  });
}

function faceScores(result: FaceLandmarkerResult | null): number[] | null {
  const categories = result?.faceBlendshapes[0]?.categories;
  if (!categories) return null;
  const byName = new Map(categories.map((c) => [c.categoryName, c.score]));
  return FACE_KEYS.map((key) => byName.get(key) ?? 0);
}

/**
 * Decides which detected hand is the signer's left and right. The pose wrists
 * are the most reliable cue; MediaPipe's handedness label is the fallback.
 */
function assignHands(
  result: HandLandmarkerResult,
  pose: NormalizedLandmark[] | null,
): { left: number | null; right: number | null } {
  const count = result.landmarks.length;
  if (count === 0) return { left: null, right: null };

  const leftWrist = pose?.[POSE.leftWrist];
  const rightWrist = pose?.[POSE.rightWrist];
  const usable = (p: NormalizedLandmark | undefined): p is NormalizedLandmark => !!p && (p.visibility ?? 0) > 0.3;

  if (usable(leftWrist) && usable(rightWrist)) {
    const dist = (hand: number, wrist: NormalizedLandmark) => {
      const w = result.landmarks[hand][0];
      return Math.hypot(w.x - wrist.x, w.y - wrist.y);
    };
    if (count === 1) {
      return dist(0, leftWrist) <= dist(0, rightWrist) ? { left: 0, right: null } : { left: null, right: 0 };
    }
    const straight = dist(0, leftWrist) + dist(1, rightWrist);
    const crossed = dist(0, rightWrist) + dist(1, leftWrist);
    return straight <= crossed ? { left: 0, right: 1 } : { left: 1, right: 0 };
  }

  // Handedness assumes a mirrored selfie image. Frames here are not mirrored,
  // so a hand labelled "Left" is the signer's right hand.
  const sides = { left: null as number | null, right: null as number | null };
  for (let i = 0; i < count; i++) {
    const label = result.handedness[i]?.[0]?.categoryName;
    const side = label === 'Left' ? 'right' : 'left';
    if (sides[side] === null) sides[side] = i;
  }
  return sides;
}
