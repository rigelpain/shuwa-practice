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
import { download, loadSizes } from './download';
import { FACE_MESH_POINTS } from './face-mesh';
import { POSE, POSE_KEEP } from './features';
import { FACE_KEYS, type FrameData } from './types';

const ASSETS = `${import.meta.env.BASE_URL}mediapipe`;

type Delegate = 'GPU' | 'CPU';
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/** Size of the square the face crop is scaled to. */
const FACE_CROP = 256;

export type LoadStep = 'runtime' | 'hands' | 'pose' | 'face';

/** Progress of one loading step. `done` turns true once that part is ready to use. */
export interface LoadEvent {
  step: LoadStep;
  loaded: number;
  total: number | null;
  done: boolean;
}

export type LoadListener = (event: LoadEvent) => void;

type ModelStep = Exclude<LoadStep, 'runtime'>;

const MODEL_FILES: Record<ModelStep, string> = {
  hands: 'hand_landmarker.task',
  pose: 'pose_landmarker_lite.task',
  face: 'face_landmarker.task',
};

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

async function withFallback<T>(create: (delegate: Delegate) => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    return create('CPU');
  }
}

function fetchModel(step: ModelStep, sizes: Record<string, number>, report: LoadListener) {
  const name = MODEL_FILES[step];
  return download(`${ASSETS}/models/${name}`, sizes[name] ?? null, (loaded, total) =>
    report({ step, loaded, total, done: false }),
  );
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
  private faceModel: Uint8Array | null = null;
  private lastTimestamp = 0;
  private tick = 0;
  private lastPose: NormalizedLandmark[] | null = null;
  private lastFace: Pick<FrameData, 'face' | 'head' | 'faceMesh'> = { face: null, head: null, faceMesh: null };
  /** Where the last face crop sat in the frame, in pixels; null when the whole frame was used. */
  private lastCrop: { x: number; y: number; side: number; W: number; H: number } | null = null;

  private constructor(
    private readonly fileset: WasmFileset,
    private readonly hands: HandLandmarker,
    private readonly pose: PoseLandmarker,
    private readonly sizes: Record<string, number>,
  ) {}

  /** The steps `create` goes through, in order. */
  static steps(face: boolean): LoadStep[] {
    return face ? ['runtime', 'hands', 'pose', 'face'] : ['runtime', 'hands', 'pose'];
  }

  static async create(opts: { face: boolean; onProgress?: LoadListener }): Promise<Tracker> {
    const report = opts.onProgress ?? (() => {});
    const sizes = await loadSizes(`${ASSETS}/sizes.json`);
    const base = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
    const runtimeFile = fileName(base.wasmBinaryPath);

    // Announce every size up front so overall progress can be weighed by bytes.
    for (const step of Tracker.steps(opts.face)) {
      const total = sizes[step === 'runtime' ? runtimeFile : MODEL_FILES[step]] ?? null;
      report({ step, loaded: 0, total, done: false });
    }

    // Fetch the runtime ourselves so its progress can be shown; each task then starts it from memory.
    const wasm = await download(base.wasmBinaryPath, sizes[runtimeFile] ?? null, (loaded, total) =>
      report({ step: 'runtime', loaded, total, done: false }),
    );
    const fileset: WasmFileset = {
      ...base,
      wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    };
    report({ step: 'runtime', loaded: wasm.length, total: wasm.length, done: true });

    const handModel = await fetchModel('hands', sizes, report);
    const hands = await withFallback((delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: handModel, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        // Lower than the 0.5 defaults so a hand partly covered by the other is not dropped at once.
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      }),
    );
    report({ step: 'hands', loaded: handModel.length, total: handModel.length, done: true });

    const poseModel = await fetchModel('pose', sizes, report);
    const pose = await withFallback((delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: poseModel, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    );
    report({ step: 'pose', loaded: poseModel.length, total: poseModel.length, done: true });

    const tracker = new Tracker(fileset, hands, pose, sizes);
    if (opts.face) await tracker.setFace(true, report);
    return tracker;
  }

  get faceEnabled(): boolean {
    return this.face !== null;
  }

  async setFace(enabled: boolean, onProgress: LoadListener = () => {}): Promise<void> {
    if (enabled && !this.face) {
      this.faceModel ??= await fetchModel('face', this.sizes, onProgress);
      const model = this.faceModel;
      this.face = await withFallback((delegate) =>
        FaceLandmarker.createFromOptions(this.fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
      );
      onProgress({ step: 'face', loaded: model.length, total: model.length, done: true });
    } else if (!enabled && this.face) {
      this.face.close();
      this.face = null;
    }
  }

  /**
   * Tracks one frame. Live camera frames run the hand model every time but take
   * turns with the pose and face models, which change more slowly, so the frame
   * rate stays up; the other one's last reading is reused. Pass `full` to run
   * every model on every frame, as when reading a video file.
   */
  detect(source: HTMLVideoElement, full = false): FrameData {
    // MediaPipe needs strictly increasing timestamps, even across source changes.
    const timestamp = Math.max(performance.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    const odd = this.tick++ % 2 === 1;
    // The face crop is placed from the pose, so the pose also runs whenever there is none yet.
    const runFace = this.face !== null && (full || odd);
    const runPose = full || !runFace || !this.lastPose;

    if (runPose) this.lastPose = this.pose.detectForVideo(source, timestamp).landmarks[0] ?? null;
    const handResult = this.hands.detectForVideo(source, timestamp);
    if (runFace) {
      const result = this.face!.detectForVideo(this.faceCrop(source, this.lastPose), timestamp);
      this.lastFace = { face: faceScores(result), head: headAngles(result), faceMesh: this.faceMesh(result) };
    } else if (!this.face) {
      this.lastFace = { face: null, head: null, faceMesh: null };
    }

    const poseLandmarks = this.lastPose;
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
      ...this.lastFace,
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
    this.lastCrop = null;
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
    this.lastCrop = { x, y, side, W, H };
    return this.faceCanvas;
  }

  /** The kept face points, moved from the crop back into whole-frame coordinates. */
  private faceMesh(result: FaceLandmarkerResult): number[] | null {
    const points = result.faceLandmarks[0];
    if (!points) return null;
    const crop = this.lastCrop;
    return FACE_MESH_POINTS.flatMap((i) => {
      const p = points[i];
      return crop ? [(crop.x + p.x * crop.side) / crop.W, (crop.y + p.y * crop.side) / crop.H] : [p.x, p.y];
    });
  }

  private readonly faceCanvas = Object.assign(document.createElement('canvas'), {
    width: FACE_CROP,
    height: FACE_CROP,
  });
}

/**
 * Yaw, pitch and roll in degrees from the face's 4×4 transformation matrix,
 * which MediaPipe stores column by column.
 */
function headAngles(result: FaceLandmarkerResult | null): number[] | null {
  const m = result?.facialTransformationMatrixes[0]?.data;
  if (!m) return null;
  const deg = 180 / Math.PI;
  return [
    Math.asin(Math.max(-1, Math.min(1, -m[2]))) * deg,
    Math.atan2(m[6], m[10]) * deg,
    Math.atan2(m[1], m[0]) * deg,
  ];
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
