import './style.css';
import { drawFigure, drawOverlay, drawTimeline, fitCanvas, fitView, type Backdrop, type FigureView } from './draw';
import { bodyFrame, type BodyFrame } from './features';
import { ACCEPT_SCORE, recognize, Segmenter, segmentClip, type Recognition, type Segment, type Template } from './reader';
import { parseSampleName } from './batch';
import { applyCaptions, cutsFromSegments, framesIn, mergeWithNext, nudge, type Cut } from './cuts';
import { describeOrigin, emptyOrigin, ownRecording } from './origin';
import { MotionPlayer, type MotionItem } from './player';
import { ClipRecorder, trimToHands } from './recorder';
import { compareClips, type CompareResult, type Hint } from './scoring';
import { toSigns, type Token } from './sentence';
import { parseSubtitles } from './subtitles';
import { Listener, speechSupported } from './speech';
import * as db from './storage';
import { Tracker, type FrameSource, type LoadEvent, type LoadStep } from './tracker';
import { STARTER_VOCABULARY } from './vocabulary';
import {
  clipKind,
  MAIN_VARIANT,
  referenceFor,
  referencesOf,
  setReference,
  variantOf,
  type Clip,
  type ClipKind,
  type Frame,
  type FrameData,
  type Origin,
  type Permission,
  type Word,
} from './types';

type Kind = ClipKind;
type Mode = 'record' | 'read' | 'speak';
/** 'reading' is a video file being captioned. */
type Phase = 'idle' | 'countdown' | 'recording' | 'saving' | 'reading';

/** Clips with fewer frames than this after trimming are not saved. */
const MIN_FRAMES = 8;
/** Frames per second read from imported video files. */
const SCAN_FPS = 30;
const SETTINGS_KEY = 'shuwa-practice:settings';

// ---------------------------------------------------------------- elements

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from index.html`);
  return node as T;
}

const ui = {
  status: $('status'),
  loadbar: $('loadbar'),
  loadbarFill: $('loadbarFill'),
  loadSteps: $('loadSteps'),
  viewport: $('viewport'),
  video: $<HTMLVideoElement>('video'),
  overlay: $<HTMLCanvasElement>('overlay'),
  viewportEmpty: $('viewportEmpty'),
  viewToggles: $('viewToggles'),
  toggleVideo: $<HTMLButtonElement>('toggleVideo'),
  toggleBones: $<HTMLButtonElement>('toggleBones'),
  toggleFace: $<HTMLButtonElement>('toggleFace'),
  fps: $('fps'),
  startCamera: $<HTMLButtonElement>('startCamera'),
  countdown: $('countdown'),
  recBadge: $('recBadge'),
  recLabel: $('recLabel'),
  modeRecord: $<HTMLButtonElement>('modeRecord'),
  modeRead: $<HTMLButtonElement>('modeRead'),
  modeSpeak: $<HTMLButtonElement>('modeSpeak'),
  speak: $('speak'),
  micToggle: $<HTMLButtonElement>('micToggle'),
  micNote: $('micNote'),
  sentenceForm: $<HTMLFormElement>('sentenceForm'),
  sentenceInput: $<HTMLInputElement>('sentenceInput'),
  speakLive: $('speakLive'),
  speakSentence: $('speakSentence'),
  motionReplay: $<HTMLButtonElement>('motionReplay'),
  motionSlow: $<HTMLInputElement>('motionSlow'),
  speakCamera: $<HTMLButtonElement>('speakCamera'),
  speakHistory: $('speakHistory'),
  speakVariant: $<HTMLSelectElement>('speakVariant'),
  speakVariantBox: $('speakVariantBox'),
  motion: $('motion'),
  motionCanvas: $<HTMLCanvasElement>('motionCanvas'),
  motionWord: $('motionWord'),
  modeNote: $('modeNote'),
  caption: $('caption'),
  readState: $('readState'),
  transcript: $('transcript'),
  transcriptList: $('transcriptList'),
  transcriptEmpty: $('transcriptEmpty'),
  copyTranscript: $<HTMLButtonElement>('copyTranscript'),
  clearTranscript: $<HTMLButtonElement>('clearTranscript'),
  exportPractice: $<HTMLInputElement>('exportPractice'),
  exportVideos: $<HTMLInputElement>('exportVideos'),
  recTime: $('recTime'),
  recordRef: $<HTMLButtonElement>('recordRef'),
  recordTry: $<HTMLButtonElement>('recordTry'),
  stopRec: $<HTMLButtonElement>('stopRec'),
  pickFile: $<HTMLButtonElement>('pickFile'),
  shareScreen: $<HTMLButtonElement>('shareScreen'),
  fileInput: $<HTMLInputElement>('fileInput'),
  controlsHint: $('controlsHint'),
  notice: $('notice'),
  setCountdown: $<HTMLSelectElement>('setCountdown'),
  setMaxSeconds: $<HTMLSelectElement>('setMaxSeconds'),
  setSigner: $<HTMLInputElement>('setSigner'),
  setRecordFace: $<HTMLInputElement>('setRecordFace'),
  setUseFace: $<HTMLInputElement>('setUseFace'),
  setMirrorCompare: $<HTMLInputElement>('setMirrorCompare'),
  setMirrorView: $<HTMLInputElement>('setMirrorView'),
  addWord: $<HTMLFormElement>('addWord'),
  wordInput: $<HTMLInputElement>('wordInput'),
  wordList: $('wordList'),
  wordLegend: $('wordLegend'),
  starter: $('starter'),
  addStarter: $<HTMLButtonElement>('addStarter'),
  bulk: $('bulk'),
  pickSamples: $<HTMLButtonElement>('pickSamples'),
  samplesInput: $<HTMLInputElement>('samplesInput'),
  pickCut: $<HTMLButtonElement>('pickCut'),
  pickScreenCut: $<HTMLButtonElement>('pickScreenCut'),
  cutInput: $<HTMLInputElement>('cutInput'),
  cutter: $('cutter'),
  cutterClose: $<HTMLButtonElement>('cutterClose'),
  cutterSource: $('cutterSource'),
  cutterVideo: $<HTMLVideoElement>('cutterVideo'),
  cutterVariant: $<HTMLInputElement>('cutterVariant'),
  cutterSigner: $<HTMLInputElement>('cutterSigner'),
  cutterKeepVideo: $<HTMLInputElement>('cutterKeepVideo'),
  cutterKeepBox: $('cutterKeepBox'),
  cutterOrigin: $('cutterOrigin'),
  cutterOriginEdit: $<HTMLButtonElement>('cutterOriginEdit'),
  originDialog: $<HTMLDialogElement>('originDialog'),
  originForm: $<HTMLFormElement>('originForm'),
  originPurpose: $('originPurpose'),
  exportUncleared: $<HTMLInputElement>('exportUncleared'),
  motionCredit: $('motionCredit'),
  cutterCaptions: $<HTMLButtonElement>('cutterCaptions'),
  captionInput: $<HTMLInputElement>('captionInput'),
  cutterList: $('cutterList'),
  cutterSave: $<HTMLButtonElement>('cutterSave'),
  wordNames: $('wordNames'),
  variantNames: $('variantNames'),
  setAutoNext: $<HTMLInputElement>('setAutoNext'),
  wordDetail: $('wordDetail'),
  exportData: $<HTMLButtonElement>('exportData'),
  importData: $<HTMLButtonElement>('importData'),
  importInput: $<HTMLInputElement>('importInput'),
  result: $('result'),
  resultOf: $('resultOf'),
  resultScore: $('resultScore'),
  resultAdvice: $('resultAdvice'),
  resultSpeed: $('resultSpeed'),
  resultRaw: $('resultRaw'),
  refCanvas: $<HTMLCanvasElement>('refCanvas'),
  tryCanvas: $<HTMLCanvasElement>('tryCanvas'),
  timeline: $<HTMLCanvasElement>('timeline'),
  scrub: $<HTMLInputElement>('scrub'),
  playDuet: $<HTMLButtonElement>('playDuet'),
  slowDuet: $<HTMLInputElement>('slowDuet'),
  ghostDuet: $<HTMLInputElement>('ghostDuet'),
  duetTime: $('duetTime'),
};

const partEls = {
  location: { bar: $('barLocation'), value: $('partLocation') },
  shape: { bar: $('barShape'), value: $('partShape') },
  face: { bar: $('barFace'), value: $('partFace') },
  head: { bar: $('barHead'), value: $('partHead') },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

const fmtDate = (t: number) =>
  new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}秒`;
const fmtClockTenth = (ms: number) => {
  const sec = ms / 1000;
  return `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
};
const fmtClock = (ms: number) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------- settings

interface Settings {
  countdown: number;
  maxSeconds: number;
  signer: string;
  recordFace: boolean;
  useFace: boolean;
  /** Compare as if the learner's dominant hand were the other one. */
  mirrorCompare: boolean;
  mirrorView: boolean;
  /** Camera view: show the camera image, and the tracked bones over it. */
  showVideo: boolean;
  showBones: boolean;
  /** Draw the tracked face (outline, brows, eyes, lips) with the bones. */
  showFace: boolean;
  mode: Mode;
  /** The origin last entered, offered again for the next video. */
  lastOrigin: Origin;
  /** Version played in the speak mode when a word has it ('' for each word's main version). */
  speakVariant: string;
  /** After a word's first sample, move on to the next word that has none. */
  autoNext: boolean;
}

const settings: Settings = (() => {
  const defaults: Settings = {
    countdown: 3,
    maxSeconds: 4,
    signer: '',
    recordFace: true,
    useFace: true,
    mirrorCompare: false,
    mirrorView: true,
    showVideo: true,
    showBones: true,
    showFace: true,
    mode: 'record',
    lastOrigin: emptyOrigin(),
    speakVariant: '',
    autoNext: true,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
})();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private windows); settings then last for this visit only.
  }
}

// ---------------------------------------------------------------- state

let tracker: Tracker | null = null;
let stream: MediaStream | null = null;
let phase: Phase = 'idle';
let recorder: ClipRecorder | null = null;
let recordKind: Kind = 'practice';
let recordOrigin: Origin = ownRecording();
let autoStop = 0;
let cancelCountdown: (() => void) | null = null;
let importing: { file: File; url: string; cancelled: boolean } | null = null;

let words: Word[] = [];
let selectedId: string | null = null;
let clips: Clip[] = [];
const comparisons = new Map<string, CompareResult>();

interface Shown {
  ref: Clip;
  attempt: Clip;
  res: CompareResult;
  totals: number[];
  refBody: BodyFrame;
  tryBody: BodyFrame;
  view: FigureView;
}
let shown: Shown | null = null;
let duetPos = 0;
let duetPlaying = false;
let duetLast = 0;

const selectedWord = () => words.find((w) => w.id === selectedId) ?? null;

/** The version of the selected word being recorded and practised. */
let selectedVariant = MAIN_VARIANT;

const variantLabel = (variant: string) => variant || '基本';

/** "ありがとう" for the main version, "ありがとう（関西）" for another. */
const withVariant = (label: string, variant: string) => (variant ? `${label}（${variant}）` : label);

function referenceClip(): Clip | null {
  const word = selectedWord();
  const id = word ? referenceFor(word, selectedVariant) : null;
  return id ? (clips.find((c) => c.id === id) ?? null) : null;
}

/** The selected word's versions, main version first, including one just created and still empty. */
function variantsOfSelected(): string[] {
  const word = selectedWord();
  const names = new Set([...Object.keys(word ? referencesOf(word) : {}), ...clips.map(variantOf), selectedVariant]);
  return [...names].sort((a, b) => (a === MAIN_VARIANT ? -1 : b === MAIN_VARIANT ? 1 : a.localeCompare(b, 'ja')));
}

function comparison(ref: Clip, attempt: Clip): CompareResult {
  const key = `${ref.id}:${attempt.id}:${settings.mirrorCompare}:${settings.useFace}`;
  let res = comparisons.get(key);
  if (!res) {
    res = compareClips(ref, attempt, { mirror: settings.mirrorCompare, useFace: settings.useFace });
    comparisons.set(key, res);
  }
  return res;
}

function say(message: string, kind: 'info' | 'error' = 'info'): void {
  ui.notice.textContent = message;
  ui.notice.classList.toggle('error', kind === 'error');
}

function setStatus(message: string, error = false): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', error);
}

// ---------------------------------------------------------------- model loading

const LOAD_LABELS: Record<LoadStep, string> = {
  runtime: '実行環境',
  hands: '手のモデル',
  pose: '体のモデル',
  face: '表情のモデル',
};

interface StepState {
  loaded: number;
  total: number | null;
  done: boolean;
}

let loading: Map<LoadStep, StepState> | null = null;

function startLoading(steps: LoadStep[]): void {
  loading = new Map(steps.map((step) => [step, { loaded: 0, total: null, done: false }]));
  ui.loadbar.hidden = false;
  ui.loadSteps.hidden = false;
  renderLoading();
}

function onLoad(event: LoadEvent): void {
  const state = loading?.get(event.step);
  if (!state) return;
  state.loaded = event.loaded;
  state.total = event.total ?? state.total;
  state.done ||= event.done;
  renderLoading();
}

function finishLoading(): void {
  loading = null;
  ui.loadbar.hidden = true;
  ui.loadSteps.hidden = true;
}

const fraction = (s: StepState) => (s.done ? 1 : s.total ? Math.min(s.loaded / s.total, 0.99) : 0);

/** "45%" when the size is known, otherwise how much has arrived. */
function amount(s: StepState, step = 1): string {
  if (!s.total) return `${(s.loaded / 1e6).toFixed(1)}MB`;
  return `${Math.floor((fraction(s) * 100) / step) * step}%`;
}

function renderLoading(): void {
  if (!loading) return;
  const steps = [...loading];
  // Weigh steps by size once every size is known: the runtime alone is about as big as all models together.
  const sized = steps.every(([, s]) => s.total);
  const overall = sized
    ? steps.reduce((sum, [, s]) => sum + fraction(s) * s.total!, 0) / steps.reduce((sum, [, s]) => sum + s.total!, 0)
    : steps.reduce((sum, [, s]) => sum + fraction(s), 0) / steps.length;

  const current = steps.findIndex(([, s]) => !s.done);
  const preparing = (s: StepState) => s.total !== null && s.loaded >= s.total;
  let text = 'モデルの準備ができました';
  if (current >= 0) {
    const [step, s] = steps[current];
    const where = `${current + 1}/${steps.length}`;
    // The status line is announced to screen readers, so it moves in 10% steps.
    text = preparing(s)
      ? `${LOAD_LABELS[step]}を準備しています（${where}）`
      : `${LOAD_LABELS[step]}を読み込んでいます（${where}、${amount(s, 10)}）`;
  }
  setStatus(text);

  ui.loadbarFill.style.width = `${(overall * 100).toFixed(1)}%`;
  ui.loadbar.setAttribute('aria-valuenow', String(Math.round(overall * 100)));
  ui.loadbar.setAttribute('aria-valuetext', text);

  ui.loadSteps.replaceChildren(
    ...steps.map(([step, s], i) => {
      const state = s.done ? '済み' : i !== current ? '' : preparing(s) ? '準備中' : amount(s);
      const item = el(
        'li',
        { className: s.done ? 'is-done' : i === current ? 'is-current' : '' },
        el('span', { textContent: LOAD_LABELS[step] }),
        el('span', { className: 'state', textContent: state }),
      );
      if (i === current) item.setAttribute('aria-current', 'step');
      return item;
    }),
  );
}

// ---------------------------------------------------------------- camera and tracking

const overlayCtx = ui.overlay.getContext('2d')!;
let lastVideoTime = -1;
let trackingFailed = false;

/** Processed frames per second, smoothed, and when it was last shown. */
let fps = 0;
let lastFrameAt = 0;
let fpsShownAt = 0;

function cameraView(): { backdrop: Backdrop; bones: boolean; face: boolean } {
  const { showVideo, showBones, showFace } = settings;
  // With bones on, the tracked frame is drawn under them so they line up; with bones off the live video shows through.
  const backdrop: Backdrop = showBones ? (showVideo ? ui.video : 'dark') : showVideo ? null : 'dark';
  return { backdrop, bones: showBones, face: showFace };
}

function countFrame(now: number): void {
  if (lastFrameAt) fps = fps ? fps * 0.9 + (1000 / (now - lastFrameAt)) * 0.1 : 1000 / (now - lastFrameAt);
  lastFrameAt = now;
  if (now - fpsShownAt > 500) {
    fpsShownAt = now;
    ui.fps.textContent = `${Math.round(fps)} fps`;
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  const v = ui.video;
  // A shared screen read frame by frame is handled by readScreenFrames instead.
  if (screen?.frames) return;
  if (!tracker || v.readyState < 2 || v.paused || v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;
  liveFrame(v, v.videoWidth / v.videoHeight);
}

/** Tracks one live frame from the camera or a shared screen and passes it on. */
function liveFrame(source: FrameSource, aspect: number): void {
  if (!tracker) return;
  countFrame(performance.now());
  let data;
  try {
    data = tracker.detect(source);
  } catch (err) {
    if (!trackingFailed) {
      trackingFailed = true;
      console.error(err);
      say(`手の検出でエラーが起きました（${errorText(err)}）。ページを再読み込みしてください。`, 'error');
    }
    return;
  }
  const view = cameraView();
  // A frame taken from the stream is the very frame tracked, so it can sit under the bones.
  if (source instanceof VideoFrame && view.backdrop === ui.video) view.backdrop = source;
  drawOverlay(overlayCtx, data, view);

  if (phase === 'recording' && recorder) {
    recorder.push(data);
    ui.recTime.textContent = (recorder.elapsedMs / 1000).toFixed(1);
  }
  if (screen?.capture) {
    screen.capture.push(data);
    ui.recTime.textContent = (screen.capture.elapsedMs / 1000).toFixed(1);
  }
  if (settings.mode === 'read' && phase === 'idle' && !importing) {
    live ??= { segmenter: new Segmenter(aspect), startedAt: performance.now() };
    const sign = live.segmenter.push(data, performance.now() - live.startedAt);
    showPending(live.segmenter.active);
    if (sign) readSign(sign, screen ? '画面' : 'カメラ', screen ? screen.origin : ownRecording());
    renderReadState();
  }
}

// ---------------------------------------------------------------- shared screen

/** Chrome's way to read a video track frame by frame; it keeps going while the tab is hidden. */
interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
type TrackProcessorConstructor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => TrackProcessor;
const TrackProcessorClass = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorConstructor })
  .MediaStreamTrackProcessor;

const screenSupported = () => typeof navigator.mediaDevices?.getDisplayMedia === 'function';

interface Screen {
  stream: MediaStream;
  /** 'read' captions it live; 'cut' collects its frames to cut samples from. */
  purpose: 'read' | 'cut';
  /** Frames read straight from the track, when the browser can. */
  frames: ReadableStreamDefaultReader<VideoFrame> | null;
  capture: ClipRecorder | null;
  origin: Origin;
  width: number;
  height: number;
}

let screen: Screen | null = null;
let cameraStream: MediaStream | null = null;

/** Shares a screen, window or tab: to caption it, or to cut samples from what it plays. */
async function startScreen(purpose: Screen['purpose'], origin: Origin = emptyOrigin()): Promise<void> {
  if (!tracker || phase !== 'idle' || screen || !screenSupported()) return;
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    say(name === 'NotAllowedError' ? '画面共有をやめました。' : `画面を共有できませんでした（${errorText(err)}）。`);
    return;
  }
  const track = display.getVideoTracks()[0];
  const { width = 1280, height = 720 } = track.getSettings();
  const reader = TrackProcessorClass
    ? new TrackProcessorClass({ track: track.clone(), maxBufferSize: 1 }).readable.getReader()
    : null;
  screen = {
    stream: display,
    purpose,
    frames: reader,
    capture: purpose === 'cut' ? new ClipRecorder(display) : null,
    origin,
    width,
    height,
  };
  track.addEventListener('ended', () => void stopScreen());
  stream = display;
  attachCamera();
  if (purpose === 'cut') {
    closeCutter();
    hideResult();
    phase = 'reading';
    ui.recLabel.textContent = '画面を取り込み中';
    ui.recTime.textContent = '0.0';
    ui.recBadge.hidden = false;
  }
  updateControls();
  say(
    (purpose === 'cut'
      ? '共有した画面で動画を再生してください。終わったら「取り込みを終える」を押すか、ブラウザの「共有を停止」を押してください。'
      : '共有した画面の手話を読み取っています。') +
      (reader
        ? 'このアプリが裏に回っても読み取りは続きます。'
        : 'このブラウザでは、このアプリのウィンドウが見えている間だけ読み取れます。共有する画面と並べて置いてください。'),
  );
  if (reader) void readScreenFrames(screen, reader);
}

async function readScreenFrames(s: Screen, reader: ReadableStreamDefaultReader<VideoFrame>): Promise<void> {
  const aspect = s.width / s.height;
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done || screen !== s) {
      frame?.close();
      break;
    }
    try {
      liveFrame(frame, aspect);
    } finally {
      frame.close();
    }
  }
}

async function stopScreen(): Promise<void> {
  const s = screen;
  if (!s) return;
  screen = null;
  void s.frames?.cancel();
  const video = (await s.capture?.stop()) ?? null;
  for (const track of s.stream.getTracks()) track.stop();
  stream = cameraStream;
  attachCamera();
  if (s.capture) {
    ui.recBadge.hidden = true;
    phase = 'idle';
    const frames = s.capture.frames;
    const durationMs = frames.at(-1)?.t ?? 0;
    if (!video || frames.length < MIN_FRAMES) {
      say('取り込めた映像が短すぎました。共有した画面で手話の動画を再生してから「取り込みを終える」を押してください。', 'error');
    } else {
      presentCutter({
        name: `画面共有（${fmtDate(Date.now())}）`,
        video,
        frames,
        width: s.width,
        height: s.height,
        durationMs,
        origin: s.origin,
      });
    }
  } else {
    say('画面共有をやめました。');
  }
  updateControls();
}

function sizeOverlay(): void {
  const { videoWidth: w, videoHeight: h } = ui.video;
  if (!w || !h) return;
  ui.overlay.width = w;
  ui.overlay.height = h;
  ui.viewport.style.aspectRatio = `${w} / ${h}`;
}

async function startCamera(): Promise<void> {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // The models shrink every frame to 256px or less, so 540p loses nothing and keeps recordings and drawing light.
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    say(
      name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。アドレスバーの設定からカメラを許可して、もう一度押してください。'
        : name === 'NotFoundError'
          ? 'カメラが見つかりませんでした。カメラをつないでから、もう一度押してください。'
          : `カメラを開けませんでした（${errorText(err)}）。`,
      'error',
    );
    return;
  }
  say('');
  // A shared screen stays on view until it ends; the camera takes over then.
  if (!screen) {
    stream = cameraStream;
    attachCamera();
  }
  updateControls();
}

function attachCamera(): void {
  const v = ui.video;
  live = null;
  // A shared screen is not a selfie, so it is never shown mirrored.
  ui.viewport.classList.toggle('mirrored', settings.mirrorView && !screen);
  v.removeAttribute('src');
  v.srcObject = stream;
  v.playbackRate = 1;
  ui.viewportEmpty.hidden = stream !== null;
  ui.viewToggles.hidden = ui.fps.hidden = stream === null;
  fps = lastFrameAt = 0;
  overlayCtx.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  if (stream) void v.play();
  else v.load();
}

// ---------------------------------------------------------------- recording

function countdown(seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (seconds <= 0) {
      resolve(true);
      return;
    }
    let left = seconds;
    ui.countdown.textContent = String(left);
    ui.countdown.hidden = false;
    const timer = window.setInterval(() => {
      left -= 1;
      if (left > 0) ui.countdown.textContent = String(left);
      else done(true);
    }, 1000);
    const done = (go: boolean) => {
      clearInterval(timer);
      ui.countdown.hidden = true;
      cancelCountdown = null;
      resolve(go);
    };
    cancelCountdown = () => done(false);
  });
}

function beginRecording(kind: Kind, source: MediaStream | null, origin: Origin): void {
  recordKind = kind;
  recordOrigin = origin;
  ui.recLabel.textContent = '記録中';
  recorder = new ClipRecorder(source);
  phase = 'recording';
  ui.recTime.textContent = '0.0';
  ui.recBadge.hidden = false;
  updateControls();
}

async function record(kind: Kind): Promise<void> {
  if (phase !== 'idle' || !stream || !tracker || !selectedWord()) return;
  if (kind === 'practice' && !referenceClip()) return;
  say('');
  phase = 'countdown';
  updateControls();
  if (!(await countdown(settings.countdown))) {
    phase = 'idle';
    updateControls();
    return;
  }
  beginRecording(kind, stream, ownRecording());
  autoStop = window.setTimeout(() => void finish(true), settings.maxSeconds * 1000);
}

/** Stops the countdown or the recording; saves the clip when `save` is true. */
async function finish(save: boolean): Promise<void> {
  if (phase === 'countdown') {
    cancelCountdown?.();
    return;
  }
  if (phase !== 'recording' || !recorder) return;
  clearTimeout(autoStop);
  const rec = recorder;
  recorder = null;
  phase = 'saving';
  ui.recBadge.hidden = true;
  updateControls();

  try {
    const video = importing ? importing.file : await rec.stop();
    if (save) lastSaved = await saveClip(rec.frames, video, recordKind);
    else say('記録を取り消しました。');
  } catch (err) {
    console.error(err);
    say(`保存できませんでした（${errorText(err)}）。`, 'error');
  } finally {
    if (importing) endImport();
    phase = 'idle';
    updateControls();
  }
}

/** Saves a recording to the selected word; false when there was too little hand to keep. */
async function saveClip(frames: Frame[], video: Blob | null, kind: Kind): Promise<boolean> {
  const word = selectedWord();
  if (!word) return false;
  const kept = trimToHands(frames);
  if (kept.length < MIN_FRAMES) {
    if (!batch) say('手がほとんど映っていなかったので保存しませんでした。両手がカメラに入る位置で、もう一度撮ってください。', 'error');
    return false;
  }
  const clip: Clip = {
    id: crypto.randomUUID(),
    wordId: word.id,
    signer: settings.signer.trim(),
    createdAt: Date.now(),
    width: ui.video.videoWidth,
    height: ui.video.videoHeight,
    durationMs: kept[kept.length - 1].t,
    frames: kept,
    kind,
    variant: selectedVariant,
    origin: recordOrigin,
  };
  await db.putClip(clip);
  if (video && video.size > 0) await db.putVideo(clip.id, video);
  const becomesReference = kind === 'sample' && !referenceFor(word, selectedVariant);
  if (becomesReference) {
    setReference(word, selectedVariant, clip.id);
    await db.putWord(word);
  }
  const name = withVariant(word.label, selectedVariant);
  await loadClips();
  await loadTemplates();
  renderWords();
  renderDetail();
  if (kind === 'sample') {
    hideResult();
    const count = clips.filter((c) => variantOf(c) === selectedVariant && clipKind(c, word) === 'sample').length;
    if (batch) return true;
    const next = becomesReference && settings.autoNext ? nextWordWithoutSamples(word.id) : null;
    if (next) {
      await selectWord(next.id, true);
      say(`「${name}」の見本を保存しました。次は「${next.label}」です。`);
      return true;
    }
    say(
      becomesReference
        ? `「${name}」の見本を保存しました。これがお手本になります。見本をもう何回か撮ると、読み取りが安定します。`
        : `「${name}」の見本を保存しました（${count}件目）。読み取りモードで使われます。`,
    );
    await showVideo(clip);
  } else {
    say('練習を保存しました。');
    showResult(clip.id);
  }
  return true;
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    v.addEventListener('seeked', () => resolve(), { once: true });
    v.currentTime = t;
  });
}

async function knownDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration)) return v.duration;
  // Recorded WebM files often report no duration until their end has been seen.
  await seek(v, 1e7);
  return Number.isFinite(v.duration) ? v.duration : v.currentTime;
}

/** Points the video element at a file and waits until it can be read; returns its length in seconds. */
async function openVideoFile(file: File): Promise<number> {
  const v = ui.video;
  const url = URL.createObjectURL(file);
  importing = { file, url, cancelled: false };
  v.srcObject = null;
  v.preload = 'auto';
  v.src = url;
  ui.viewportEmpty.hidden = true;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('このブラウザでは再生できない動画です'));
  });
  return knownDuration(v);
}

/**
 * Tracks every frame of the open file in turn. Seeking instead of playing means
 * no frame is skipped, however slow the machine or hidden the tab.
 */
async function scanVideo(duration: number, onFrame: (data: FrameData, t: number) => void): Promise<void> {
  const v = ui.video;
  for (let t = 0; t <= duration && !importing?.cancelled; t += 1 / SCAN_FPS) {
    await seek(v, t);
    const data = tracker!.detect(v, true);
    drawOverlay(overlayCtx, data, cameraView());
    onFrame(data, t * 1000);
    ui.recTime.textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}`;
  }
}

/** Record mode: saves a video file as a sample (or as practice once the word has a reference). */
async function importFile(file: File): Promise<void> {
  if (!selectedWord() || !tracker || phase !== 'idle') return;
  const kind: Kind = referenceClip() ? 'practice' : 'sample';
  try {
    const duration = await openVideoFile(file);
    beginRecording(kind, null, pendingOrigin);
    ui.recLabel.textContent = '読み取り中';
    say(
      kind === 'sample'
        ? '動画を読み取っています。終わると見本として保存し、お手本にします。'
        : '動画を読み取っています。終わると練習として保存し、お手本と比べます。',
    );
    await scanVideo(duration, (data, t) => recorder?.push(data, t));
    await finish(!importing?.cancelled);
  } catch (err) {
    recorder = null;
    phase = 'idle';
    ui.recBadge.hidden = true;
    endImport();
    updateControls();
    say(`動画を読み込めませんでした（${errorText(err)}）。`, 'error');
  }
}

/** Read mode: captions every sign in a video file, with its time in the video. */
async function captionFile(file: File): Promise<void> {
  if (!tracker || phase !== 'idle' || !templates.length) return;
  let found = 0;
  try {
    const duration = await openVideoFile(file);
    phase = 'reading';
    ui.recLabel.textContent = '字幕を付けています';
    ui.recBadge.hidden = false;
    updateControls();
    say(`「${file.name}」の手話を読み取っています。`);
    const segmenter = new Segmenter(ui.video.videoWidth / ui.video.videoHeight);
    const read = (sign: Segment | null) => {
      if (!sign) return;
      found++;
      readSign(sign, file.name, emptyOrigin());
    };
    await scanVideo(duration, (data, t) => read(segmenter.push(data, t)));
    read(segmenter.flush());
    say(importing?.cancelled ? '字幕付けをやめました。' : `「${file.name}」から${found}語を読み取りました。`);
  } catch (err) {
    say(`動画を読み込めませんでした（${errorText(err)}）。`, 'error');
  } finally {
    ui.recBadge.hidden = true;
    endImport();
    phase = 'idle';
    updateControls();
  }
}

function endImport(): void {
  if (!importing) return;
  const v = ui.video;
  v.onloadeddata = v.onerror = null;
  URL.revokeObjectURL(importing.url);
  importing = null;
  attachCamera();
}

/** Progress of "動画をまとめて見本にする", while it runs. */
let batch: { done: number; total: number } | null = null;
/** Whether the last finished recording was kept. */
let lastSaved = false;

/**
 * Turns a set of video files into samples, one word per file name. Words
 * that are not in the list yet are added; existing words gain another sample.
 */
async function importSampleFiles(files: File[]): Promise<void> {
  if (!tracker || phase !== 'idle' || !files.length) return;
  batch = { done: 0, total: files.length };
  let saved = 0;
  let created = 0;
  const failed: string[] = [];
  let first: { id: string; variant: string } | null = null;

  for (const file of files) {
    const { label, variant } = parseSampleName(file.name);
    let word = words.find((w) => w.label === label);
    if (!word) {
      word = { id: crypto.randomUUID(), label, referenceId: null, createdAt: Date.now() };
      await db.putWord(word);
      words.push(word);
      created++;
    }
    selectedId = word.id;
    selectedVariant = variant;
    first ??= { id: word.id, variant };
    await loadClips();
    batch.done++;
    say(`${batch.done}/${batch.total}　「${withVariant(label, variant)}」を見本にしています。`);
    try {
      const duration = await openVideoFile(file);
      lastSaved = false;
      beginRecording('sample', null, pendingOrigin);
      ui.recLabel.textContent = `${batch.done}/${batch.total} 読み取り中`;
      await scanVideo(duration, (data, t) => recorder?.push(data, t));
      const cancelled = importing?.cancelled ?? false;
      await finish(!cancelled);
      if (cancelled) break;
      if (lastSaved) saved++;
      else failed.push(file.name);
    } catch {
      recorder = null;
      phase = 'idle';
      ui.recBadge.hidden = true;
      endImport();
      failed.push(file.name);
    }
  }

  const stopped = batch.done < batch.total;
  batch = null;
  await loadTemplates();
  if (first) {
    // Land on the first file's word and version, as if it had just been chosen.
    selectedId = null;
    await selectWord(first.id);
    await selectVariant(first.variant);
  }
  updateControls();
  const summary = `${saved}本を見本にしました${created ? `（新しい単語${created}語を追加）` : ''}。`;
  const note = failed.length ? `手が映っていない、または再生できなかった動画：${failed.join('、')}` : '';
  say((stopped ? '途中でやめました。' : '') + summary + note, failed.length ? 'error' : 'info');
}

// ---------------------------------------------------------------- cutting a long video

interface Cutter {
  /** File name, or a label for a shared screen. */
  name: string;
  /** The video it was cut from, kept in memory for previews and saved only when asked. */
  video: Blob;
  url: string;
  /** Every tracked frame of the video, timed from its start. */
  frames: Frame[];
  width: number;
  height: number;
  durationMs: number;
  cuts: Cut[];
  body: BodyFrame;
  view: FigureView;
  /** Where the video came from; every sample cut from it gets this. */
  origin: Origin;
}

let cutter: Cutter | null = null;
/** Where the preview of a cut stops. */
let previewUntil = Infinity;

/** How far the edge buttons move a cut. */
const NUDGE_MS = 200;

/** Reads a long video, finds the signs in it and lists them for naming. */
async function openCutter(file: File): Promise<void> {
  if (!tracker || phase !== 'idle') return;
  closeCutter();
  try {
    const duration = await openVideoFile(file);
    const width = ui.video.videoWidth;
    const height = ui.video.videoHeight;
    phase = 'reading';
    ui.recLabel.textContent = '区切りを探しています';
    ui.recBadge.hidden = false;
    updateControls();
    say(`「${file.name}」の手話の区切りを探しています。`);

    const frames: Frame[] = [];
    await scanVideo(duration, (data, t) => frames.push({ t, ...data }));
    if (importing?.cancelled) {
      say('切り出しをやめました。');
      return;
    }
    presentCutter({ name: file.name, video: file, frames, width, height, durationMs: duration * 1000, origin: pendingOrigin });
  } catch (err) {
    say(`動画を読み込めませんでした（${errorText(err)}）。`, 'error');
  } finally {
    ui.recBadge.hidden = true;
    endImport();
    phase = 'idle';
    updateControls();
  }
}

/** Finds the signs in tracked frames and lists them for naming. */
function presentCutter(input: Pick<Cutter, 'name' | 'video' | 'frames' | 'width' | 'height' | 'durationMs' | 'origin'>): void {
  const { frames, width, height } = input;
  const segments: Segment[] = [];
  const segmenter = new Segmenter(width / height);
  for (const frame of frames) {
    const sign = segmenter.push(frame, frame.t);
    if (sign) segments.push(sign);
  }
  const last = segmenter.flush();
  if (last) segments.push(last);

  const opts = { mirror: settings.mirrorCompare, useFace: settings.useFace };
  const suggest = (sign: Segment) => {
    if (!templates.length) return null;
    const rec = recognize(segmentClip(sign, width, height), templates, opts);
    return rec.word ? rec.candidates[0] : null;
  };
  const body = bodyFrame({ frames, width, height });
  closeCutter();
  cutter = {
    ...input,
    url: URL.createObjectURL(input.video),
    cuts: cutsFromSegments(segments, suggest),
    body,
    view: fitView([{ frames, body }]),
  };
  ui.cutterVideo.src = cutter.url;
  ui.cutterSigner.value = settings.signer;
  // Keeping a video needs the right to it, so each new video starts with bones only.
  ui.cutterKeepVideo.checked = false;
  hideResult();
  renderCutter();
  updateControls();
  const named = cutter.cuts.filter((c) => c.label).length;
  say(
    `${segments.length}個の区切りが見つかりました` +
      (named ? `。そのうち${named}個は、似ている見本から単語名を入れています` : '') +
      '。単語名を確かめて、見本にする区間にチェックを入れてください。',
  );
}

function closeCutter(): void {
  if (cutter) URL.revokeObjectURL(cutter.url);
  cutter = null;
  ui.cutterVideo.removeAttribute('src');
  ui.cutterList.replaceChildren();
  updateControls();
}

function previewCut(cut: Cut): void {
  const v = ui.cutterVideo;
  previewUntil = cut.endMs / 1000;
  v.currentTime = cut.startMs / 1000;
  void v.play();
}

function renderCutter(): void {
  if (!cutter) return;
  const c = cutter;
  const chosen = c.cuts.filter((cut) => cut.include && cut.label.trim()).length;
  ui.cutterSource.textContent = `${c.name}（${fmtClock(c.durationMs)}、区切り${c.cuts.length}個）`;
  ui.cutterOrigin.textContent = `出典：${describeOrigin(c.origin)}`;
  // Keeping someone's video needs a recorded reason it may be used.
  const cleared = c.origin.permission !== 'unknown';
  ui.cutterKeepVideo.disabled = !cleared;
  if (!cleared) ui.cutterKeepVideo.checked = false;
  ui.cutterKeepBox.classList.toggle('is-locked', !cleared);
  ui.cutterKeepBox.title = cleared ? '' : '出典で使ってよい根拠を記録すると選べます';
  ui.cutterSave.textContent = `チェックした区間を見本にする（${chosen}件）`;
  ui.cutterSave.disabled = chosen === 0;

  const variants = new Set(templates.map((t) => variantOf(t.clip)).filter(Boolean));
  ui.wordNames.replaceChildren(...words.map((w) => el('option', { value: w.label })));
  ui.variantNames.replaceChildren(...[...variants].map((v) => el('option', { value: v })));

  const update = (i: number, next: Cut) => {
    c.cuts[i] = next;
    renderCutter();
  };
  ui.cutterList.replaceChildren(
    ...c.cuts.map((cut, i) => {
      const thumb = el('canvas', { width: 144, height: 144 });
      const frames = framesIn(c.frames, cut);
      const middle = frames[Math.floor(frames.length / 2)];
      if (middle) drawFigure(thumb.getContext('2d')!, middle, c.body, c.view, { flip: settings.mirrorView });

      const include = el('input', {
        type: 'checkbox',
        checked: cut.include,
        title: '見本にする',
        onchange: () => update(i, { ...cut, include: include.checked }),
      });
      const label = el('input', {
        type: 'text',
        value: cut.label,
        placeholder: '単語名',
        onchange: () => update(i, { ...cut, label: label.value.trim(), include: label.value.trim() ? true : cut.include }),
      });
      label.setAttribute('list', 'wordNames');
      label.setAttribute('autocomplete', 'off');
      label.setAttribute('aria-label', '単語名');
      const variant = el('input', {
        type: 'text',
        value: cut.variant ?? '',
        placeholder: ui.cutterVariant.value.trim() || '基本',
        onchange: () => update(i, { ...cut, variant: variant.value.trim() || null }),
      });
      variant.setAttribute('list', 'variantNames');
      variant.setAttribute('autocomplete', 'off');
      variant.setAttribute('aria-label', '版');

      const why = [
        cut.caption ? `字幕：「${cut.caption}」` : '',
        cut.guessedFrom === 'caption' ? '単語名は字幕から推測しました' : '',
        cut.suggestion
          ? `似ている見本：${withVariant(cut.suggestion.word.label, cut.suggestion.variant)} ${Math.round(cut.suggestion.score)}点`
          : '',
      ].filter(Boolean);

      const button = (text: string, onclick: () => void, title = '') =>
        el('button', { type: 'button', className: 'quiet', textContent: text, title, onclick });
      return el(
        'li',
        { className: cut.include ? 'cut is-on' : 'cut' },
        include,
        thumb,
        el(
          'div',
          {},
          el('div', {
            className: 'cut-time',
            textContent: `${fmtClockTenth(cut.startMs)}〜${fmtClockTenth(cut.endMs)}（${fmtSec(cut.endMs - cut.startMs)}）`,
          }),
          el('div', { className: 'cut-fields' }, label, variant),
          why.length ? el('p', { className: 'cut-why', textContent: why.join('　') }) : null,
          el(
            'div',
            { className: 'cut-actions' },
            button('見る', () => previewCut(cut)),
            button('始め −0.2', () => update(i, nudge(cut, 'start', -NUDGE_MS, c.durationMs)), '始めを0.2秒早くする'),
            button('始め +0.2', () => update(i, nudge(cut, 'start', NUDGE_MS, c.durationMs)), '始めを0.2秒遅くする'),
            button('終わり −0.2', () => update(i, nudge(cut, 'end', -NUDGE_MS, c.durationMs)), '終わりを0.2秒早くする'),
            button('終わり +0.2', () => update(i, nudge(cut, 'end', NUDGE_MS, c.durationMs)), '終わりを0.2秒遅くする'),
            i + 1 < c.cuts.length
              ? button('次とつなげる', () => {
                  c.cuts = mergeWithNext(c.cuts, i);
                  renderCutter();
                })
              : null,
            button('外す', () => {
              c.cuts.splice(i, 1);
              renderCutter();
            }),
          ),
        ),
      );
    }),
  );
}

async function loadCaptions(file: File): Promise<void> {
  if (!cutter) return;
  const cues = parseSubtitles(await file.text());
  if (!cues.length) {
    say('字幕を読み取れませんでした。SRT か WebVTT 形式のファイルを選んでください。', 'error');
    return;
  }
  const before = cutter.cuts.filter((c) => c.label).length;
  cutter.cuts = applyCaptions(cutter.cuts, cues, words);
  const after = cutter.cuts.filter((c) => c.label).length;
  renderCutter();
  say(`字幕${cues.length}件を読み込み、${after - before}個の区間に字幕から単語名の候補を入れました。語順が手話と違うことがあるので、見て確かめてください。`);
}

/** Saves the ticked, named cuts as samples; by default only their bones. */
async function saveCuts(): Promise<void> {
  if (!cutter || phase !== 'idle') return;
  const c = cutter;
  const chosen = c.cuts.filter((cut) => cut.include && cut.label.trim());
  const defaultVariant = ui.cutterVariant.value.trim();
  const signer = ui.cutterSigner.value.trim();
  const videoId = ui.cutterKeepVideo.checked ? `source-${crypto.randomUUID()}` : null;
  const saved = new Set<Cut>();
  const tooShort: string[] = [];
  let created = 0;

  for (const cut of chosen) {
    const frames = framesIn(c.frames, cut);
    const label = cut.label.trim();
    if (frames.filter((f) => f.left || f.right).length < MIN_FRAMES) {
      tooShort.push(label);
      continue;
    }
    let word = words.find((w) => w.label === label);
    if (!word) {
      word = { id: crypto.randomUUID(), label, referenceId: null, createdAt: Date.now() };
      words.push(word);
      created++;
    }
    const variant = cut.variant ?? defaultVariant;
    const clip: Clip = {
      id: crypto.randomUUID(),
      wordId: word.id,
      kind: 'sample',
      variant,
      signer,
      origin: c.origin,
      createdAt: Date.now(),
      width: c.width,
      height: c.height,
      durationMs: frames[frames.length - 1].t,
      frames,
      ...(videoId ? { source: { videoId, startMs: cut.startMs, endMs: cut.endMs } } : {}),
    };
    await db.putClip(clip);
    if (!referenceFor(word, variant)) setReference(word, variant, clip.id);
    await db.putWord(word);
    saved.add(cut);
  }
  if (videoId && saved.size) await db.putVideo(videoId, c.video);

  c.cuts = c.cuts.filter((cut) => !saved.has(cut));
  await loadClips();
  await loadTemplates();
  renderDetail();
  renderCutter();
  say(
    `${saved.size}件を見本にしました${created ? `（新しい単語${created}語を追加）` : ''}。` +
      (videoId ? '元の動画も保存しました。' : '保存したのはボーン（手・体・表情の座標）だけです。') +
      (tooShort.length ? `手がほとんど映っていない区間は保存しませんでした：${tooShort.join('、')}` : ''),
    tooShort.length ? 'error' : 'info',
  );
}

// ---------------------------------------------------------------- origins

/** The origin given for the video files about to be read. */
let pendingOrigin: Origin = emptyOrigin();

/** Shows the origin form filled with `initial`; resolves to what was entered, or null if cancelled. */
function askOrigin(initial: Origin, purpose: string): Promise<Origin | null> {
  const form = ui.originForm;
  const field = (name: keyof Origin) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  for (const key of ['title', 'url', 'rightsHolder', 'license', 'note'] as const) field(key).value = initial[key];
  const radio = form.querySelector<HTMLInputElement>(`input[name="permission"][value="${initial.permission}"]`);
  if (radio) radio.checked = true;
  ui.originPurpose.textContent = purpose;
  ui.originDialog.showModal();
  return new Promise((resolve) => {
    // Answer on submit rather than on close: it happens within the click, so a
    // file picker opened next still counts as user-initiated.
    form.onsubmit = (e) => {
      const submitter = e.submitter as HTMLButtonElement | null;
      if (submitter?.value !== 'ok') {
        resolve(null);
        return;
      }
      const checked = form.querySelector<HTMLInputElement>('input[name="permission"]:checked');
      resolve({
        title: field('title').value.trim(),
        url: field('url').value.trim(),
        rightsHolder: field('rightsHolder').value.trim(),
        permission: (checked?.value ?? 'unknown') as Permission,
        license: field('license').value.trim(),
        note: field('note').value.trim(),
      });
    };
    // Escape closes the dialog without submitting.
    ui.originDialog.oncancel = () => resolve(null);
  });
}

/** Asks where the coming video files are from, then opens the file picker. */
async function pickVideosFrom(input: HTMLInputElement, purpose: string): Promise<void> {
  const origin = await askOrigin(settings.lastOrigin, purpose);
  if (!origin) return;
  pendingOrigin = origin;
  settings.lastOrigin = origin;
  saveSettings();
  input.click();
}

async function editOrigin(clip: Clip): Promise<void> {
  const origin = await askOrigin(clip.origin ?? emptyOrigin(), `この記録（${fmtDate(clip.createdAt)} 撮影）の出典`);
  if (!origin) return;
  clip.origin = origin;
  await db.putClip(clip);
  await loadClips();
  await loadTemplates();
  renderDetail();
  if (viewerClipId === clip.id) await showVideo(clip);
  say('出典を保存しました。');
}

/** Who signed a sample and where it came from, for showing next to it. */
function creditLine(clip: Clip): string {
  const origin = clip.origin && clip.origin.permission !== 'own' ? describeOrigin(clip.origin) : '';
  return [clip.signer ? `手話：${clip.signer}` : '', origin ? `出典：${origin}` : ''].filter(Boolean).join('　');
}

/** Stop button, Escape and Space all end up here. */
function stop(save: boolean): void {
  if (screen?.capture) void stopScreen();
  else if (importing) importing.cancelled = true;
  else void finish(save);
}

// ---------------------------------------------------------------- words and clips

async function loadClips(): Promise<void> {
  clips = selectedId ? await db.listClips(selectedId) : [];
}

async function addWord(label: string): Promise<void> {
  const word: Word = { id: crypto.randomUUID(), label, referenceId: null, createdAt: Date.now() };
  await db.putWord(word);
  words.push(word);
  await selectWord(word.id);
}

/** `whileSaving` lets the app itself move on to the next word as a recording is saved. */
async function selectWord(id: string, whileSaving = false): Promise<void> {
  if (phase !== 'idle' && !(whileSaving && phase === 'saving')) return;
  if (id !== selectedId) {
    const word = words.find((w) => w.id === id);
    const first = word ? Object.keys(referencesOf(word)) : [];
    selectedVariant = first.includes(MAIN_VARIANT) ? MAIN_VARIANT : (first[0] ?? MAIN_VARIANT);
  }
  selectedId = id;
  await loadClips();
  hideResult();
  renderWords();
  renderDetail();
  updateControls();
  await showVideo(referenceClip());
}

async function removeWord(word: Word): Promise<void> {
  if (!confirm(`「${word.label}」と、その記録をすべて削除します。元に戻せません。`)) return;
  await db.deleteWord(word.id);
  words = words.filter((w) => w.id !== word.id);
  await loadTemplates();
  selectedId = null;
  clips = [];
  hideResult();
  await showVideo(null);
  if (words[0]) {
    await selectWord(words[0].id);
  } else {
    renderWords();
    renderDetail();
    updateControls();
  }
}

async function removeClip(clip: Clip): Promise<void> {
  const word = selectedWord();
  if (!word || !confirm('この記録を削除します。元に戻せません。')) return;
  await db.deleteClip(clip.id);
  if (referenceFor(word, variantOf(clip)) === clip.id) {
    setReference(word, variantOf(clip), null);
    await db.putWord(word);
  }
  await loadTemplates();
  if (shown && (shown.attempt.id === clip.id || shown.ref.id === clip.id)) hideResult();
  await loadClips();
  renderWords();
  renderDetail();
  updateControls();
  if (viewerClipId === clip.id) await showVideo(referenceClip());
}

async function makeSample(clip: Clip): Promise<void> {
  const word = selectedWord();
  if (!word) return;
  clip.kind = 'sample';
  await db.putClip(clip);
  if (shown?.attempt.id === clip.id) hideResult();
  await loadTemplates();
  renderDetail();
  say('見本にしました。読み取りモードで使われます。');
}

async function makeReference(clip: Clip): Promise<void> {
  const word = selectedWord();
  if (!word) return;
  setReference(word, variantOf(clip), clip.id);
  await db.putWord(word);
  hideResult();
  renderWords();
  renderDetail();
  updateControls();
  await showVideo(clip);
  say('お手本を差し替えました。練習の点数は、このお手本と比べた値に変わります。');
}

// ---------------------------------------------------------------- rendering

const viewer = el('video', { controls: true, playsInline: true, muted: true });
const viewerCaption = el('p');
const playerBox = el('div', { className: 'player', hidden: true }, viewer, viewerCaption);
let viewerUrl: string | null = null;
let viewerClipId: string | null = null;

async function showVideo(clip: Clip | null): Promise<void> {
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
  viewerClipId = clip?.id ?? null;
  viewer.removeAttribute('src');
  if (!clip) {
    playerBox.hidden = true;
    return;
  }
  const word = selectedWord();
  const kind = clip.id === referenceClip()?.id ? 'お手本' : clipKind(clip, word) === 'sample' ? '見本' : '練習';
  const source = clip.source;
  const blob = await db.getVideo(source?.videoId ?? clip.id);
  playerBox.hidden = false;
  viewer.hidden = !blob;
  viewer.onplay = viewer.ontimeupdate = null;
  const credit = creditLine(clip);
  if (blob) {
    viewerUrl = URL.createObjectURL(blob);
    viewer.src = viewerUrl;
    viewerCaption.textContent = `${kind}の動画（${fmtDate(clip.createdAt)} 撮影）${credit ? `　${credit}` : ''}`;
    if (source) {
      // Play only this clip's stretch of the longer video it was cut from.
      const [from, to] = [source.startMs / 1000, source.endMs / 1000];
      viewer.onloadedmetadata = () => {
        viewer.currentTime = from;
      };
      viewer.onplay = () => {
        if (viewer.currentTime < from || viewer.currentTime >= to) viewer.currentTime = from;
      };
      viewer.ontimeupdate = () => {
        if (viewer.currentTime >= to) {
          viewer.pause();
          viewer.currentTime = from;
        }
      };
      viewerCaption.textContent =
        `${kind}の動画（元の動画の ${fmtClockTenth(source.startMs)}〜${fmtClockTenth(source.endMs)}）` +
        (credit ? `　${credit}` : '');
    }
  } else {
    viewerCaption.textContent =
      `この${kind}には動画がありません。手と体と表情の動き（ボーン）だけを持っています。` + (credit ? `　${credit}` : '');
  }
}

const OWN_WORDS = '自分で追加した単語';

/** Words grouped as the list shows them: your own first, then the starter categories in order. */
function groupedWords(): Array<[string, Word[]]> {
  const order = [OWN_WORDS, ...STARTER_VOCABULARY.map((g) => g.category)];
  const groups = new Map<string, Word[]>();
  for (const w of words) {
    const key = w.category ?? OWN_WORDS;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups].sort(([a], [b]) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1));
}

const hasSamples = (word: Word) => templates.some((t) => t.word.id === word.id);

function renderWords(): void {
  const missingStarter = STARTER_VOCABULARY.some((g) => g.words.some((label) => !words.some((w) => w.label === label)));
  ui.starter.hidden = !missingStarter;
  ui.wordLegend.hidden = !words.some((w) => !hasSamples(w));
  if (!words.length) {
    ui.wordList.replaceChildren(
      el('p', { className: 'empty', textContent: 'まだ単語がありません。上の欄に入力するか、基本の単語を追加してください。' }),
    );
    return;
  }
  const groups = groupedWords();
  ui.wordList.replaceChildren(
    ...groups.map(([name, list]) =>
      el(
        'section',
        { className: 'word-group' },
        groups.length > 1 ? el('h3', { textContent: name }) : null,
        el(
          'ul',
          { className: 'word-chips' },
          ...list.map((w) => {
            const button = el(
              'button',
              {
                type: 'button',
                className: hasSamples(w) ? 'word' : 'word is-empty',
                title: hasSamples(w) ? '' : 'まだ見本がありません',
                onclick: () => void selectWord(w.id),
              },
              w.label,
            );
            button.setAttribute('aria-pressed', String(w.id === selectedId));
            return el('li', {}, button);
          }),
        ),
      ),
    ),
  );
}

async function addStarterVocabulary(): Promise<void> {
  const have = new Set(words.map((w) => w.label));
  const now = Date.now();
  const added: Word[] = STARTER_VOCABULARY.flatMap((g) =>
    g.words.filter((label) => !have.has(label)).map((label) => ({ label, category: g.category })),
  ).map((w, i) => ({ id: crypto.randomUUID(), referenceId: null, createdAt: now + i, ...w }));
  if (!added.length) return;
  await db.putWords(added);
  words = await db.listWords();
  await loadTemplates();
  const first = selectedId ? null : added[0].id;
  if (first) await selectWord(first);
  else renderWords();
  say(`基本の単語と言い回しを${added.length}個追加しました。見本はまだ入っていないので、手話者が順に撮ると読み取れるようになります。`);
}

/** The next word in list order, after the given one, that has no sample yet. */
function nextWordWithoutSamples(after: string): Word | null {
  const ordered = groupedWords().flatMap(([, list]) => list);
  const at = ordered.findIndex((w) => w.id === after);
  const rest = [...ordered.slice(at + 1), ...ordered.slice(0, Math.max(at, 0))];
  return rest.find((w) => !hasSamples(w)) ?? null;
}

function renderDetail(): void {
  const word = selectedWord();
  if (!word) {
    ui.wordDetail.replaceChildren();
    return;
  }
  const ref = referenceClip();
  const parts: Node[] = [
    el(
      'div',
      { className: 'detail-head' },
      el('h2', { textContent: word.label }),
      el('button', { type: 'button', className: 'quiet danger', textContent: '単語を削除', onclick: () => void removeWord(word) }),
    ),
    variantBar(word),
  ];
  if (!ref) {
    parts.push(
      el('p', {
        className: 'empty-state',
        textContent: selectedVariant
          ? `「${selectedVariant}」の版にはまだ見本がありません。「見本を撮る」か動画ファイルで登録してください。この版の最初の見本が、この版のお手本になります。`
          : 'まだ見本がありません。カメラの前で手話をして「見本を撮る」を押すか、手話の動画ファイルを読み込んでください。最初の見本がお手本になります。',
      }),
    );
  }
  parts.push(playerBox);
  const own = clips.filter((c) => variantOf(c) === selectedVariant);
  if (own.length) parts.push(el('div', { className: 'clips-wrap' }, clipTable(ref, own)));
  ui.wordDetail.replaceChildren(...parts);
}

/** Buttons for the word's versions, with their sample counts, and a way to add one. */
function variantBar(word: Word): HTMLElement {
  const buttons = variantsOfSelected().map((variant) => {
    const samples = clips.filter((c) => variantOf(c) === variant && clipKind(c, word) === 'sample').length;
    const button = el(
      'button',
      { type: 'button', className: 'variant', onclick: () => void selectVariant(variant) },
      variantLabel(variant),
      el('small', { textContent: String(samples) }),
    );
    button.setAttribute('aria-pressed', String(variant === selectedVariant));
    button.title = `見本${samples}件`;
    return button;
  });

  const input = el('input', { type: 'text', placeholder: '版の名前（例：関西、〇〇さん、家族）', required: true });
  const form = el(
    'form',
    {
      className: 'variant-form',
      hidden: true,
      onsubmit: (e: SubmitEvent) => {
        e.preventDefault();
        const name = input.value.trim();
        if (name) void addVariant(word, name);
      },
    },
    input,
    el('button', { type: 'submit', textContent: '作る' }),
  );
  const add = el('button', {
    type: 'button',
    className: 'quiet',
    textContent: '＋ 版を追加',
    onclick: () => {
      form.hidden = false;
      input.focus();
    },
  });
  const hasOwnClips = clips.some((c) => variantOf(c) === selectedVariant);
  const remove =
    hasOwnClips && variantsOfSelected().length > 1
      ? el('button', {
          type: 'button',
          className: 'quiet danger',
          textContent: 'この版を削除',
          onclick: () => void removeVariant(word, selectedVariant),
        })
      : null;

  return el(
    'div',
    { className: 'variants' },
    el('div', { className: 'variant-buttons', role: 'group', ariaLabel: '版' }, ...buttons, add, remove),
    form,
  );
}

async function selectVariant(variant: string): Promise<void> {
  if (phase !== 'idle') return;
  selectedVariant = variant;
  hideResult();
  renderDetail();
  updateControls();
  await showVideo(referenceClip());
}

async function addVariant(word: Word, name: string): Promise<void> {
  await selectVariant(name);
  const exists = clips.some((c) => variantOf(c) === name) || referenceFor(word, name);
  if (!exists) say(`「${word.label}」に「${name}」の版を作りました。見本を撮って登録してください。`);
}

async function removeVariant(word: Word, variant: string): Promise<void> {
  const own = clips.filter((c) => variantOf(c) === variant);
  if (!confirm(`「${withVariant(word.label, variant)}」の記録${own.length}件を削除します。元に戻せません。`)) return;
  for (const clip of own) await db.deleteClip(clip.id);
  setReference(word, variant, null);
  await db.putWord(word);
  selectedVariant = MAIN_VARIANT;
  await loadClips();
  selectedVariant = variantsOfSelected().find((v) => clips.some((c) => variantOf(c) === v)) ?? MAIN_VARIANT;
  await loadTemplates();
  await selectVariant(selectedVariant);
  say(`「${withVariant(word.label, variant)}」を削除しました。`);
}

function clipTable(ref: Clip | null, list: Clip[]): HTMLTableElement {
  const head = el(
    'tr',
    {},
    el('th', { textContent: '撮影日時' }),
    el('th', { textContent: '長さ', className: 'num' }),
    el('th', { textContent: '種類・点数', className: 'num' }),
    el('th', {}, el('span', { className: 'visually-hidden', textContent: '操作' })),
  );
  const word = selectedWord();
  const rows = list.map((clip) => {
    const isRef = clip.id === ref?.id;
    const isSample = clipKind(clip, word) === 'sample';
    const scoreCell = isRef
      ? el('span', { className: 'tag', textContent: 'お手本' })
      : isSample
        ? el('span', { className: 'tag quiet-tag', textContent: '見本' })
        : ref
          ? String(Math.round(comparison(ref, clip).score))
          : '—';
    const button = (label: string, onclick: () => void, extra = '') =>
      el('button', { type: 'button', className: `quiet ${extra}`.trim(), textContent: label, onclick });
    return el(
      'tr',
      { className: [isRef ? 'is-ref' : '', shown?.attempt.id === clip.id ? 'is-open' : ''].join(' ').trim() },
      el(
        'td',
        { title: clip.signer ? `撮影者: ${clip.signer}` : '' },
        fmtDate(clip.createdAt),
        el('small', {
          className: clip.origin && clip.origin.permission !== 'unknown' ? 'origin-line' : 'origin-line is-unknown',
          textContent: describeOrigin(clip.origin),
        }),
      ),
      el('td', { className: 'num', textContent: fmtSec(clip.durationMs) }),
      el('td', { className: 'num' }, scoreCell),
      el(
        'td',
        { className: 'actions' },
        !isSample && ref ? button('結果', () => showResult(clip.id)) : null,
        button('動画', () => void showVideo(clip)),
        button('出典', () => void editOrigin(clip)),
        isSample ? null : button('見本にする', () => void makeSample(clip)),
        isSample && !isRef ? button('お手本にする', () => void makeReference(clip)) : null,
        button('削除', () => void removeClip(clip), 'danger'),
      ),
    );
  });
  return el('table', { className: 'clips' }, el('thead', {}, head), el('tbody', {}, ...rows));
}

function updateControls(): void {
  const word = selectedWord();
  const ref = referenceClip();
  const idle = phase === 'idle';
  const reading = settings.mode === 'read';
  const speaking = settings.mode === 'speak';
  const canShoot = tracker !== null && stream !== null && !importing && word !== null && idle;
  const busy = phase === 'countdown' || phase === 'recording' || phase === 'reading';

  for (const [button, mode] of [[ui.modeRecord, 'record'], [ui.modeRead, 'read'], [ui.modeSpeak, 'speak']] as const) {
    button.setAttribute('aria-pressed', String(settings.mode === mode));
    button.disabled = !idle;
  }
  ui.modeNote.textContent = {
    record: '単語ごとに見本を登録し、お手本と比べて練習します。',
    read: '手話をすると、登録した単語から一番近いものを字幕に出します。',
    speak: '話した言葉を字幕にして、単語帳にある言葉の見本を手話モーションで順に見せます。',
  }[settings.mode];
  ui.transcript.hidden = !reading;
  ui.caption.hidden = !reading || !stream || Boolean(importing);
  renderReadState();
  ui.speak.hidden = ui.motion.hidden = !speaking;
  ui.bulk.hidden = settings.mode !== 'record';
  ui.pickSamples.disabled = ui.pickCut.disabled = !(tracker && idle) || Boolean(screen);
  ui.cutter.hidden = !cutter || settings.mode !== 'record';
  ui.viewport.classList.toggle('speaking', speaking);
  ui.viewport.classList.toggle('with-camera', stream !== null);
  ui.speakCamera.hidden = stream !== null;

  ui.recordRef.disabled = !canShoot;
  ui.recordTry.disabled = !canShoot || !ref;
  ui.pickFile.textContent = reading ? '動画に字幕を付ける' : '動画ファイルから読み込む';
  ui.pickFile.disabled = !(tracker && idle && (reading ? templates.length : word));
  ui.pickFile.hidden = speaking;
  ui.stopRec.hidden = !busy;
  ui.recordRef.hidden = ui.recordTry.hidden = busy || reading || speaking;
  ui.stopRec.textContent = screen?.capture
    ? '取り込みを終える'
    : importing
      ? '読み込みをやめる'
      : phase === 'countdown'
        ? 'やめる'
        : '停止';
  const sharing = screen?.purpose === 'read';
  ui.shareScreen.hidden = !reading || !screenSupported();
  ui.shareScreen.textContent = sharing ? '画面共有をやめる' : '画面共有を読み取る';
  ui.shareScreen.disabled = !tracker || (!sharing && (!idle || !templates.length));
  ui.pickScreenCut.hidden = !screenSupported();
  ui.pickScreenCut.disabled = !(tracker && idle) || Boolean(screen);

  if (speaking) {
    const vocabulary = new Set(templates.map((t) => t.word.id)).size;
    ui.micToggle.disabled = !speechSupported();
    ui.controlsHint.textContent = !vocabulary
      ? '手話モーションにできる単語がまだありません。記録モードで見本を撮るか、単語帳を読み込んでください。'
      : !speechSupported()
        ? `見本のある${vocabulary}語を手話モーションにできます。このブラウザは音声認識に対応していないので、文を入力してください（Chrome か Safari なら話せます）。`
        : `見本のある${vocabulary}語を手話モーションにできます。「話す」を押して話すか、文を入力してください。`;
    return;
  }

  if (reading) {
    const samples = templates.length;
    const vocabulary = new Set(templates.map((t) => t.word.id)).size;
    ui.controlsHint.textContent = !samples
      ? '読み取れる単語がまだありません。記録モードで単語の見本を撮ってください。'
      : !tracker
        ? 'モデルの読み込みが終わると読み取れます。'
        : sharing
          ? `登録した${vocabulary}語（見本${samples}件）から、共有した画面の手話を読み取っています。`
          : !stream
            ? `登録した${vocabulary}語（見本${samples}件）から読み取ります。「カメラを使う」か「画面共有を読み取る」を押すか、動画に字幕を付けてください。`
            : `登録した${vocabulary}語（見本${samples}件）から読み取ります。1語ずつ手話をして、手を止めるか下ろすと字幕になります。`;
    return;
  }

  ui.controlsHint.textContent = !word
    ? '右の欄で単語を選ぶか、新しく追加してください。'
    : !tracker
      ? 'モデルの読み込みが終わると撮影できます。'
      : !stream
        ? '「カメラを使う」を押すと撮影できます。手話の動画ファイルからも読み込めます。'
        : !ref
          ? `まず「${word.label}」の見本を撮ってください（スペースキーでも撮れます）。最初の見本がお手本になります。`
          : '手を下ろした状態から始めて、終わったら手を下ろしてください。スペースキーでも練習を始められます。';
}

// ---------------------------------------------------------------- read mode

/** How many recent words the caption line keeps, and how long it stays after the last one. */
const CAPTION_WORDS = 4;
const CAPTION_CLEAR_MS = 8000;

interface Caption {
  /** Where the sign came from: the camera, a shared screen or a file. */
  source: string;
  /** The sign's place in that source, so each caption can be told apart and said again. */
  startMs: number;
  endMs: number;
  /** The sign itself, to replay or keep as a sample. */
  clip: Clip;
  rec: Recognition;
  /** The word shown: the best match, or one picked from the candidates. */
  word: Word | null;
  variant: string;
  corrected: boolean;
  /** The origin a sample kept from this sign gets. */
  origin: Origin;
  /** Waiting to be replaced by the next sign. */
  redo: boolean;
  saved: boolean;
}

/** Every sample of every word: what signing is read against. */
let templates: Template[] = [];
let live: { segmenter: Segmenter; startedAt: number } | null = null;
let transcript: Caption[] = [];
/** Captions before this one have faded from the caption line. */
let captionFrom = 0;
let captionTimer = 0;
let pending = false;
/** What was just read, shown for a moment in the reader's state. */
let lastDecision: { text: string; at: number } | null = null;
/** The transcript thumbnail currently replaying its sign. */
let replaying: MotionPlayer | null = null;

/** How long the state shows what was just read before going back to waiting. */
const DECISION_MS = 1500;
const NO_WORD: Word = { id: '', label: '', referenceId: null, createdAt: 0 };

async function loadTemplates(): Promise<void> {
  const byId = new Map(words.map((w) => [w.id, w]));
  templates = (await db.listAllClips()).flatMap((clip) => {
    const word = byId.get(clip.wordId);
    return word && clipKind(clip, word) === 'sample' ? [{ word, clip }] : [];
  });
  renderSpeakVariants();
  renderWords();
  updateControls();
}

function setMode(mode: Mode): void {
  if (phase !== 'idle') return;
  settings.mode = mode;
  saveSettings();
  live = null;
  showPending(false);
  renderReadState();
  if (mode !== 'record') hideResult();
  if (mode !== 'speak') {
    listener.stop();
    player.stop();
  }
  updateControls();
  if (mode === 'speak') player.redraw();
}

// ---------------------------------------------------------------- speak mode

interface Spoken {
  text: string;
  tokens: Token[];
  items: MotionItem[];
}

let spoken: Spoken | null = null;
/** Sentences spoken or typed so far, newest first. */
const spokenHistory: string[] = [];

const player = new MotionPlayer(ui.motionCanvas, (index) => {
  const item = index === null ? null : spoken?.items[index];
  ui.motionWord.textContent = item ? withVariant(item.word.label, variantOf(item.clip)) : '';
  ui.motionCredit.textContent = item ? creditLine(item.clip) : '';
  renderSentence(index);
});
player.flip = settings.mirrorView;

const listener = new Listener({
  interim: (text) => {
    ui.speakLive.textContent = text;
  },
  final: (text) => {
    ui.speakLive.textContent = '';
    speakSentence(text);
  },
  error: (code) => {
    const reason: Record<string, string> = {
      'not-allowed': 'マイクの使用が許可されていません。アドレスバーの設定からマイクを許可してください。',
      'service-not-allowed': 'このブラウザでは音声認識を使えません。文を入力してください。',
      'audio-capture': 'マイクが見つかりませんでした。マイクをつないでから、もう一度押してください。',
      network: '音声認識のサーバーにつながりませんでした。ネットワークを確かめてください。',
    };
    say(reason[code] ?? `音声認識が止まりました（${code}）。`, 'error');
  },
  listening: (on) => {
    ui.micToggle.setAttribute('aria-pressed', String(on));
    ui.micToggle.textContent = on ? '聞くのをやめる' : '話す';
    ui.speakLive.textContent = on ? '聞いています…' : '';
  },
});

/**
 * The sample shown for a word: the chosen version's reference (or any sample
 * of it) when the word has that version, otherwise its main version's.
 */
function sampleFor(word: Word): Clip | null {
  const own = templates.filter((t) => t.word.id === word.id);
  const of = (variant: string) =>
    own.find((t) => t.clip.id === referenceFor(word, variant)) ?? own.find((t) => variantOf(t.clip) === variant);
  return (of(settings.speakVariant) ?? of(MAIN_VARIANT) ?? own.find((t) => t.clip.id === word.referenceId) ?? own[0])?.clip ?? null;
}

/** Fills the version choice with every version found in the vocabulary. */
function renderSpeakVariants(): void {
  const names = [...new Set(templates.map((t) => variantOf(t.clip)).filter((v) => v !== MAIN_VARIANT))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );
  if (settings.speakVariant && !names.includes(settings.speakVariant)) names.unshift(settings.speakVariant);
  ui.speakVariant.replaceChildren(
    el('option', { value: MAIN_VARIANT, textContent: '基本' }),
    ...names.map((name) => el('option', { value: name, textContent: name })),
  );
  ui.speakVariant.value = settings.speakVariant;
  ui.speakVariantBox.hidden = names.length === 0;
}

function speakSentence(text: string): void {
  const tokens = toSigns(text, words);
  const items = tokens.flatMap((t) => {
    const clip = t.word ? sampleFor(t.word) : null;
    return t.word && clip ? [{ word: t.word, clip }] : [];
  });
  spoken = { text, tokens, items };
  if (spokenHistory[0] !== text) spokenHistory.unshift(text);
  spokenHistory.splice(20);
  renderHistory();
  player.load(items);
  ui.motionReplay.disabled = !items.length;
  renderSentence(null);
  if (items.length) player.play();
  else say('この文には、見本のある単語が見つかりませんでした。記録モードで単語と見本を足してください。');
}

/** The sentence as a caption: signed words are buttons that replay from there, the rest is plain text. */
function renderSentence(current: number | null): void {
  if (!spoken) {
    ui.speakSentence.replaceChildren();
    return;
  }
  let n = 0;
  ui.speakSentence.replaceChildren(
    ...spoken.tokens.map((t) => {
      if (!t.word) return document.createTextNode(t.text);
      if (!sampleFor(t.word)) return el('span', { className: 'no-sample', title: 'まだ見本がありません', textContent: t.text });
      const index = n++;
      return el('button', {
        type: 'button',
        className: index === current ? 'sign is-current' : 'sign',
        title: `${t.word.label}をここから再生`,
        textContent: t.text,
        onclick: () => player.play(index),
      });
    }),
  );
}

function renderHistory(): void {
  ui.speakHistory.replaceChildren(
    ...spokenHistory.map((text) =>
      el('li', {}, el('button', { type: 'button', textContent: text, onclick: () => speakSentence(text) })),
    ),
  );
}

function readSign(sign: Segment, source: string, origin: Origin): void {
  const clip = segmentClip(sign, ui.video.videoWidth, ui.video.videoHeight);
  const rec = recognize(clip, templates, { mirror: settings.mirrorCompare, useFace: settings.useFace });
  const caption: Caption = {
    source,
    startMs: sign.startMs,
    endMs: sign.endMs,
    clip,
    rec,
    word: rec.word,
    variant: rec.word ? rec.candidates[0].variant : MAIN_VARIANT,
    corrected: false,
    origin,
    redo: false,
    saved: false,
  };
  // Saying a sign again replaces the caption waiting for it; otherwise it is added.
  const redoAt = transcript.findIndex((c) => c.redo);
  if (redoAt >= 0) transcript[redoAt] = caption;
  else transcript.push(caption);
  lastDecision = { text: caption.word ? `→ ${captionLabel(caption)}` : '→ ？（読み取れませんでした）', at: performance.now() };
  renderTranscript();
  refreshCaption();
  renderReadState();
}

const captionLabel = (c: Caption) => (c.word ? withVariant(c.word.label, c.variant) : '？');

/** Shows the latest captions on the caption line, fading them after a pause. */
function refreshCaption(): void {
  renderCaption();
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => {
    captionFrom = transcript.length;
    renderCaption();
  }, CAPTION_CLEAR_MS);
}

/** Shows "…" on the caption line while a sign is being collected. */
function showPending(on: boolean): void {
  if (on === pending) return;
  pending = on;
  renderCaption();
}

function renderCaption(): void {
  const recent = transcript.slice(Math.max(captionFrom, transcript.length - CAPTION_WORDS));
  const spans = recent.map((c, i) =>
    el('span', { className: i === recent.length - 1 ? 'latest' : '', textContent: captionLabel(c) }),
  );
  if (pending) spans.push(el('span', { className: 'pending', textContent: '…' }));
  ui.caption.replaceChildren(...spans);
  ui.caption.classList.toggle('is-empty', !spans.length);
}

/** Says, on the camera view, whether a sign is being read right now. */
function renderReadState(): void {
  const reading = settings.mode === 'read' && stream !== null && phase === 'idle' && !importing;
  const segmenter = live?.segmenter;
  const capturing = reading && segmenter?.active === true;
  ui.readState.hidden = !reading;
  ui.viewport.classList.toggle('is-capturing', capturing);
  if (!reading) return;
  const now = performance.now();
  let state: string;
  let text: string;
  if (capturing && live && segmenter?.startedAt != null) {
    state = 'capturing';
    text = `読み取り中 ${((now - live.startedAt - segmenter.startedAt) / 1000).toFixed(1)}秒　手を止めるか下ろすと確定します`;
  } else if (lastDecision && now - lastDecision.at < DECISION_MS) {
    state = 'decided';
    text = lastDecision.text;
  } else if (transcript.some((c) => c.redo)) {
    state = 'redo';
    text = '言い直し待ち：もう一度手話してください';
  } else {
    state = 'idle';
    text = '待機中：手を動かすと読み取ります';
  }
  ui.readState.dataset.state = state;
  ui.readState.textContent = text;
}

function drawSignThumb(canvas: HTMLCanvasElement, clip: Clip): void {
  const body = bodyFrame(clip);
  const middle = clip.frames[Math.floor(clip.frames.length / 2)];
  if (middle) drawFigure(canvas.getContext('2d')!, middle, body, fitView([{ frames: clip.frames, body }]), { flip: settings.mirrorView });
}

function replaySign(canvas: HTMLCanvasElement, clip: Clip): void {
  replaying?.stop();
  replaying = new MotionPlayer(canvas, () => {});
  replaying.flip = settings.mirrorView;
  replaying.load([{ word: NO_WORD, clip }]);
  replaying.play();
}

function renderTranscript(): void {
  replaying?.stop();
  replaying = null;
  ui.transcriptEmpty.hidden = transcript.length > 0;
  const button = (text: string, onclick: () => void, title = '') =>
    el('button', { type: 'button', className: 'quiet', textContent: text, title, onclick });
  ui.transcriptList.replaceChildren(
    ...transcript.map((c, i) => {
      const thumb = el('canvas', { width: 112, height: 112, title: '読み取った動き' });
      drawSignThumb(thumb, c.clip);
      const top = c.rec.candidates[0];
      const note = c.corrected
        ? '手で直しました'
        : c.word
          ? `${Math.round(top.score)}点`
          : top
            ? `${ACCEPT_SCORE}点に届きませんでした`
            : '比べる見本がありません';
      const others = c.rec.candidates.filter((cand) => cand.word.id !== c.word?.id || cand.variant !== c.variant);
      return el(
        'li',
        { className: [c.word ? '' : 'is-unknown', c.redo ? 'is-redo' : ''].join(' ').trim() },
        thumb,
        el(
          'div',
          {},
          el('div', { className: 'said' }, c.word ? captionLabel(c) : '読み取れませんでした', el('small', { textContent: note })),
          el('div', {
            className: 'when',
            textContent: `${c.source}　${fmtClockTenth(c.startMs)}〜${fmtClockTenth(c.endMs)}（${fmtSec(c.endMs - c.startMs)}）`,
          }),
          others.length
            ? el(
                'div',
                { className: 'why' },
                c.word ? 'ほかの候補：' : '近い候補：',
                ...others.map((cand) =>
                  button(
                    `${withVariant(cand.word.label, cand.variant)} ${Math.round(cand.score)}点`,
                    () => {
                      c.word = cand.word;
                      c.variant = cand.variant;
                      c.corrected = true;
                      c.saved = false;
                      renderTranscript();
                      refreshCaption();
                    },
                    'この単語に直す',
                  ),
                ),
              )
            : null,
          el(
            'div',
            { className: 'said-actions' },
            button('動きを見る', () => replaySign(thumb, c.clip)),
            button(c.redo ? '言い直しをやめる' : '言い直す', () => {
              for (const other of transcript) other.redo = other === c ? !c.redo : false;
              renderTranscript();
              renderReadState();
            }),
            button('取り消す', () => {
              transcript.splice(i, 1);
              captionFrom = Math.min(captionFrom, transcript.length);
              renderTranscript();
              refreshCaption();
              renderReadState();
            }),
            c.word
              ? el('button', {
                  type: 'button',
                  className: 'quiet',
                  textContent: c.saved ? '見本にしました' : '見本に加える',
                  title: 'この動きを、この単語の見本として登録します',
                  disabled: c.saved,
                  onclick: () => void keepAsSample(c),
                })
              : null,
          ),
        ),
      );
    }),
  );
  ui.transcriptList.scrollTop = ui.transcriptList.scrollHeight;
}

/** Keeps a read sign as a sample of the word it shows, so later signing is read against it too. */
async function keepAsSample(c: Caption): Promise<void> {
  if (!c.word || c.saved) return;
  const clip: Clip = {
    ...c.clip,
    id: crypto.randomUUID(),
    wordId: c.word.id,
    kind: 'sample',
    variant: c.variant,
    signer: settings.signer.trim(),
    origin: c.origin,
    createdAt: Date.now(),
  };
  await db.putClip(clip);
  if (!referenceFor(c.word, c.variant)) {
    setReference(c.word, c.variant, clip.id);
    await db.putWord(c.word);
  }
  c.saved = true;
  await loadTemplates();
  if (selectedId === c.word.id) {
    await loadClips();
    renderDetail();
  }
  renderTranscript();
  say(`「${captionLabel(c)}」の見本に加えました。次からはこの動きも読み取りの比較に使います。`);
}

function clearTranscript(): void {
  transcript = [];
  captionFrom = 0;
  renderTranscript();
  renderCaption();
  renderReadState();
}

async function copyTranscript(): Promise<void> {
  const text = transcript.flatMap((c) => (c.word ? [c.word.label] : [])).join(' ');
  if (!text) {
    say('コピーできる字幕がまだありません。');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    say('字幕をコピーしました。');
  } catch {
    say('字幕をコピーできませんでした。ブラウザがクリップボードへの書き込みを許可していません。', 'error');
  }
}

// ---------------------------------------------------------------- result

function hideResult(): void {
  stopDuet();
  shown = null;
  ui.result.hidden = true;
}

function adviceText(res: CompareResult): string {
  const hint = res.hint;
  if (!hint) {
    return res.score >= 80
      ? 'お手本とよく合っています。'
      : '全体に少しずつずれています。並べて再生して見比べてください。';
  }
  const when = hint.whole
    ? '全体を通して'
    : `お手本の${(hint.startMs / 1000).toFixed(1)}〜${(hint.endMs / 1000).toFixed(1)}秒あたりで`;

  if (hint.detail && hint.direction) {
    const what = HINT_DETAILS[hint.detail];
    return `${when}、${what}が${hint.direction === 'less' ? '小さめ' : '大きめ'}です。`;
  }
  // Hints name hands in the reference's terms; when mirrored, the learner used the other hand.
  const hand = settings.mirrorCompare && hint.hand ? (hint.hand === 'left' ? 'right' : 'left') : hint.hand;
  const who = hand === 'left' ? '左手の' : hand === 'right' ? '右手の' : '両手の';
  const what = { location: '位置', shape: '形', face: '表情', head: '頭の動き' }[hint.part];
  return `${when}、${who}${what}がいちばんずれています。`;
}

const HINT_DETAILS: Record<NonNullable<Hint['detail']>, string> = {
  yaw: '首を横に振る動き',
  pitch: 'うなずき（首の縦の動き）',
  roll: '首のかしげ',
  brows: '眉の動き',
  eyes: '目の開き方',
  mouth: '口の動き',
};

function speedText(ratio: number): string {
  if (ratio > 1.15) return `お手本より${ratio.toFixed(1)}倍ゆっくりでした。`;
  if (ratio < 0.87) return `お手本より${(1 / ratio).toFixed(1)}倍速く動いていました。`;
  return 'お手本とほぼ同じ速さでした。';
}

function showResult(clipId: string, scroll = true): void {
  const ref = referenceClip();
  const attempt = clips.find((c) => c.id === clipId);
  if (!ref || !attempt) return;
  const res = comparison(ref, attempt);
  const refBody = bodyFrame(ref);
  const tryBody = bodyFrame(attempt);
  shown = {
    ref,
    attempt,
    res,
    totals: res.costs.map((c) => c.total),
    refBody,
    tryBody,
    view: fitView([
      { frames: ref.frames, body: refBody },
      { frames: attempt.frames, body: tryBody },
    ]),
  };
  stopDuet();
  duetPos = 0;
  ui.result.hidden = false;

  ui.resultOf.textContent = `「${selectedWord()?.label ?? ''}」の練習（${fmtDate(attempt.createdAt)}）`;
  ui.resultScore.textContent = String(Math.round(res.score));
  for (const part of ['location', 'shape', 'face', 'head'] as const) {
    const score = res.parts[part];
    const { bar, value } = partEls[part];
    bar.style.width = `${score ?? 0}%`;
    value.textContent = score === null ? '—' : String(Math.round(score));
    bar.closest('.part')?.classList.toggle('is-off', score === null);
  }
  ui.resultAdvice.textContent = adviceText(res);
  ui.resultSpeed.textContent = speedText(res.speedRatio);

  const faceNote = (value: number | null, format: (v: number) => string) =>
    !settings.useFace ? '比べていません（設定でオン）' : value === null ? '記録がないため比べていません' : format(value);
  const rows: Array<[string, string]> = [
    ['手首の位置のずれ', `${res.raw.location!.toFixed(3)}（肩幅を1とする）`],
    ['関節の位置のずれ', `${res.raw.shape!.toFixed(3)}（手の長さを1とする）`],
    ['表情のずれ', faceNote(res.raw.face, (v) => v.toFixed(3))],
    ['頭の向きのずれ', faceNote(res.raw.head, (v) => `${v.toFixed(1)}°`)],
    ['フレーム数', `お手本 ${ref.frames.length}、練習 ${attempt.frames.length}`],
    ['対応づけたステップ数', String(res.path.length)],
  ];
  ui.resultRaw.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  ui.scrub.max = String(res.path.length - 1);

  renderDetail();
  drawDuet();
  if (scroll) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ui.result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}

function drawDuet(): void {
  if (!shown || ui.result.hidden) return;
  const { ref, attempt, res, totals, refBody, tryBody, view } = shown;
  const k = Math.min(res.path.length - 1, Math.max(0, Math.floor(duetPos)));
  const [i, j] = res.path[k];
  const flip = settings.mirrorView;

  drawFigure(fitCanvas(ui.refCanvas), ref.frames[i], refBody, view, { flip });
  const tryCtx = fitCanvas(ui.tryCanvas);
  tryCtx.clearRect(0, 0, tryCtx.canvas.width, tryCtx.canvas.height);
  if (ui.ghostDuet.checked) {
    // With mirrored comparison the reference ghost is flipped to match the learner's hands.
    drawFigure(tryCtx, ref.frames[i], refBody, view, { flip: flip !== settings.mirrorCompare, alpha: 0.25, clear: false });
  }
  drawFigure(tryCtx, attempt.frames[j], tryBody, view, { flip, clear: false });
  drawTimeline(fitCanvas(ui.timeline), totals, k);

  ui.scrub.value = String(k);
  ui.duetTime.textContent = `お手本 ${fmtSec(ref.frames[i].t)}／練習 ${fmtSec(attempt.frames[j].t)}`;
}

function stopDuet(): void {
  duetPlaying = false;
  ui.playDuet.textContent = '並べて再生';
}

function toggleDuet(): void {
  if (!shown) return;
  if (duetPlaying) {
    stopDuet();
    return;
  }
  if (duetPos >= shown.res.path.length - 1) duetPos = 0;
  duetPlaying = true;
  duetLast = performance.now();
  ui.playDuet.textContent = '一時停止';
  requestAnimationFrame(tickDuet);
}

function tickDuet(now: number): void {
  if (!duetPlaying || !shown) return;
  const { ref, res } = shown;
  // Play through the aligned steps in the reference's own duration.
  const msPerStep = Math.max(ref.durationMs, 500) / res.path.length / (ui.slowDuet.checked ? 0.4 : 1);
  duetPos += (now - duetLast) / msPerStep;
  duetLast = now;
  if (duetPos >= res.path.length - 1) {
    duetPos = res.path.length - 1;
    stopDuet();
  }
  drawDuet();
  if (duetPlaying) requestAnimationFrame(tickDuet);
}

// ---------------------------------------------------------------- data files

async function exportAll(): Promise<void> {
  const opts = {
    practice: ui.exportPractice.checked,
    videos: ui.exportVideos.checked,
    uncleared: ui.exportUncleared.checked,
  };
  const { data, withheld } = await db.exportData(opts);
  const unclearedNote = withheld
    ? `許可が未確認の見本${withheld}件は入れていません。各記録の「出典」で記入するか、「許可を確認していない見本も含める」を選んでください。`
    : '';
  if (!data.clips.length) {
    say(`書き出せる見本がありません。${unclearedNote}`, withheld ? 'error' : 'info');
    return;
  }
  // Four decimals keep landmark precision while roughly halving the file.
  const json = JSON.stringify(data, (_key, v: unknown) =>
    typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v,
  );
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  el('a', { href: url, download: `shuwa-practice-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const samples = data.clips.filter((c) => c.kind === 'sample').length;
  const practice = data.clips.length - samples;
  say(
    `${data.words.length}語、見本${samples}件${opts.practice ? `、練習${practice}件` : ''}を書き出しました` +
      (opts.videos ? '（動画つき）。' : '（動画なし）。') +
      (data.credits?.length ? `出典${data.credits.length}件のクレジットも入っています。` : '') +
      unclearedNote,
  );
}

async function importAll(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as db.ExportFile;
    if (data.format !== 'shuwa-practice' || !Array.isArray(data.words) || !Array.isArray(data.clips)) {
      throw new Error('このツールで書き出したファイルではありません');
    }
    const added = await db.importData(data);
    words = await db.listWords();
    comparisons.clear();
    selectedId ??= words[0]?.id ?? null;
    await loadClips();
    await loadTemplates();
    renderWords();
    renderDetail();
    updateControls();
    say(`${added.words}語、${added.clips}件の記録を読み込みました。同じ名前の単語は1つにまとめています。`);
  } catch (err) {
    say(`読み込めませんでした（${errorText(err)}）。このツールで書き出した単語帳（JSON）を選んでください。`, 'error');
  }
}

// ---------------------------------------------------------------- wiring

function bindSettings(): void {
  ui.setCountdown.value = String(settings.countdown);
  ui.setMaxSeconds.value = String(settings.maxSeconds);
  ui.setSigner.value = settings.signer;
  ui.setRecordFace.checked = settings.recordFace;
  ui.setUseFace.checked = settings.useFace;
  ui.setMirrorCompare.checked = settings.mirrorCompare;
  ui.setMirrorView.checked = settings.mirrorView;
  ui.setAutoNext.checked = settings.autoNext;
  ui.setAutoNext.onchange = () => {
    settings.autoNext = ui.setAutoNext.checked;
    saveSettings();
  };

  const rescore = () => {
    comparisons.clear();
    renderDetail();
    if (shown) showResult(shown.attempt.id, false);
  };

  ui.setCountdown.onchange = () => {
    settings.countdown = Number(ui.setCountdown.value);
    saveSettings();
  };
  ui.setMaxSeconds.onchange = () => {
    settings.maxSeconds = Number(ui.setMaxSeconds.value);
    saveSettings();
  };
  ui.setSigner.oninput = () => {
    settings.signer = ui.setSigner.value;
    saveSettings();
  };
  ui.setRecordFace.onchange = async () => {
    settings.recordFace = ui.setRecordFace.checked;
    saveSettings();
    if (!tracker) return;
    const loadsModel = settings.recordFace && !tracker.faceEnabled;
    if (loadsModel) startLoading(['face']);
    try {
      await tracker.setFace(settings.recordFace, onLoad);
      if (loadsModel) setStatus('準備ができました');
    } catch (err) {
      setStatus('準備ができました');
      say(`表情のモデルを読み込めませんでした（${errorText(err)}）。`, 'error');
    } finally {
      if (loadsModel) finishLoading();
    }
  };
  ui.setUseFace.onchange = () => {
    settings.useFace = ui.setUseFace.checked;
    saveSettings();
    rescore();
  };
  ui.setMirrorCompare.onchange = () => {
    settings.mirrorCompare = ui.setMirrorCompare.checked;
    saveSettings();
    rescore();
  };
  ui.setMirrorView.onchange = () => {
    settings.mirrorView = ui.setMirrorView.checked;
    player.flip = settings.mirrorView;
    if (!player.playing) player.redraw();
    saveSettings();
    ui.viewport.classList.toggle('mirrored', settings.mirrorView && !screen);
    drawDuet();
  };
  ui.viewport.classList.toggle('mirrored', settings.mirrorView);

  const bindToggle = (button: HTMLButtonElement, key: 'showVideo' | 'showBones' | 'showFace') => {
    button.setAttribute('aria-pressed', String(settings[key]));
    button.onclick = () => {
      settings[key] = !settings[key];
      button.setAttribute('aria-pressed', String(settings[key]));
      saveSettings();
    };
  };
  bindToggle(ui.toggleVideo, 'showVideo');
  bindToggle(ui.toggleBones, 'showBones');
  bindToggle(ui.toggleFace, 'showFace');
}

function bindEvents(): void {
  ui.video.addEventListener('loadedmetadata', sizeOverlay);
  ui.video.addEventListener('resize', sizeOverlay);
  ui.startCamera.onclick = () => void startCamera();
  ui.recordRef.onclick = () => void record('sample');
  ui.recordTry.onclick = () => void record('practice');
  ui.stopRec.onclick = () => stop(true);
  ui.pickFile.onclick = () =>
    settings.mode === 'record' ? void pickVideosFrom(ui.fileInput, '読み込む動画の出典') : ui.fileInput.click();
  ui.fileInput.onchange = () => {
    const file = ui.fileInput.files?.[0];
    ui.fileInput.value = '';
    if (file) void (settings.mode === 'read' ? captionFile(file) : importFile(file));
  };
  ui.modeRecord.onclick = () => setMode('record');
  ui.modeRead.onclick = () => setMode('read');
  ui.modeSpeak.onclick = () => setMode('speak');
  ui.micToggle.onclick = () => (listener.listening ? listener.stop() : listener.start());
  ui.sentenceForm.onsubmit = (e) => {
    e.preventDefault();
    const text = ui.sentenceInput.value.trim();
    if (text) speakSentence(text);
  };
  ui.motionReplay.onclick = () => player.play();
  ui.speakVariant.onchange = () => {
    settings.speakVariant = ui.speakVariant.value;
    saveSettings();
    // Replay the current sentence in the chosen version.
    if (spoken) speakSentence(spoken.text);
  };
  ui.motionSlow.onchange = () => {
    player.speed = ui.motionSlow.checked ? 0.5 : 1;
  };
  ui.speakCamera.onclick = () => void startCamera();
  ui.clearTranscript.onclick = clearTranscript;
  ui.copyTranscript.onclick = () => void copyTranscript();

  ui.addStarter.onclick = () => void addStarterVocabulary();
  ui.pickSamples.onclick = () => void pickVideosFrom(ui.samplesInput, 'まとめて読み込む動画の出典（すべての動画に付きます）');
  ui.pickCut.onclick = () => void pickVideosFrom(ui.cutInput, '切り出す動画の出典');
  ui.pickScreenCut.onclick = async () => {
    const origin = await askOrigin(settings.lastOrigin, '共有して取り込む動画の出典');
    if (!origin) return;
    settings.lastOrigin = origin;
    saveSettings();
    await startScreen('cut', origin);
  };
  ui.shareScreen.onclick = () => void (screen ? stopScreen() : startScreen('read'));
  ui.cutterOriginEdit.onclick = async () => {
    if (!cutter) return;
    const origin = await askOrigin(cutter.origin, '切り出す動画の出典');
    if (!origin || !cutter) return;
    cutter.origin = origin;
    settings.lastOrigin = origin;
    saveSettings();
    renderCutter();
  };
  ui.cutInput.onchange = () => {
    const file = ui.cutInput.files?.[0];
    ui.cutInput.value = '';
    if (file) void openCutter(file);
  };
  ui.cutterClose.onclick = closeCutter;
  ui.cutterSave.onclick = () => void saveCuts();
  ui.cutterCaptions.onclick = () => ui.captionInput.click();
  ui.captionInput.onchange = () => {
    const file = ui.captionInput.files?.[0];
    ui.captionInput.value = '';
    if (file) void loadCaptions(file);
  };
  ui.cutterVariant.oninput = renderCutter;
  ui.cutterVideo.ontimeupdate = () => {
    if (ui.cutterVideo.currentTime >= previewUntil) {
      ui.cutterVideo.pause();
      previewUntil = Infinity;
    }
  };
  ui.samplesInput.onchange = () => {
    const files = [...(ui.samplesInput.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    ui.samplesInput.value = '';
    void importSampleFiles(files);
  };
  ui.addWord.onsubmit = (e) => {
    e.preventDefault();
    const label = ui.wordInput.value.trim();
    if (!label || phase !== 'idle') return;
    ui.wordInput.value = '';
    void addWord(label);
  };

  ui.exportData.onclick = () => void exportAll();
  ui.importData.onclick = () => ui.importInput.click();
  ui.importInput.onchange = () => {
    const file = ui.importInput.files?.[0];
    ui.importInput.value = '';
    if (file) void importAll(file);
  };

  ui.playDuet.onclick = toggleDuet;
  ui.ghostDuet.onchange = drawDuet;
  ui.scrub.oninput = () => {
    stopDuet();
    duetPos = Number(ui.scrub.value);
    drawDuet();
  };
  ui.timeline.onclick = (e) => {
    if (!shown) return;
    stopDuet();
    const box = ui.timeline.getBoundingClientRect();
    duetPos = ((e.clientX - box.left) / box.width) * shown.res.path.length;
    drawDuet();
  };
  window.addEventListener('resize', () => {
    drawDuet();
    if (settings.mode === 'speak' && !player.playing) player.redraw();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && phase !== 'idle') {
      stop(false);
      return;
    }
    // Backspace takes back the last caption while reading.
    if (e.key === 'Backspace' && settings.mode === 'read' && transcript.length) {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      e.preventDefault();
      transcript.pop();
      captionFrom = Math.min(captionFrom, transcript.length);
      renderTranscript();
      refreshCaption();
      renderReadState();
      return;
    }
    if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, select, textarea, button, summary, video')) return;
    if (settings.mode === 'read') return;
    e.preventDefault();
    if (phase === 'idle') void record(referenceClip() ? 'practice' : 'sample');
    else stop(true);
  });
}

async function init(): Promise<void> {
  bindSettings();
  bindEvents();
  requestAnimationFrame(loop);

  try {
    words = await db.listWords();
  } catch (err) {
    say(`記録の保存場所を開けませんでした（${errorText(err)}）。プライベートウィンドウでは使えないことがあります。`, 'error');
  }
  if (words[0]) await selectWord(words[0].id);
  else renderWords();
  await loadTemplates();
  setMode(settings.mode);

  startLoading(Tracker.steps(settings.recordFace));
  try {
    tracker = await Tracker.create({ face: settings.recordFace, onProgress: onLoad });
    setStatus('準備ができました');
  } catch (err) {
    console.error(err);
    setStatus(`手の検出モデルを読み込めませんでした。ページを再読み込みしてください（${errorText(err)}）`, true);
  } finally {
    finishLoading();
  }
  updateControls();
}

void init();
