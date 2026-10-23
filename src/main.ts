import './style.css';
import { drawFigure, drawOverlay, drawTimeline, fitCanvas, fitView, type Backdrop, type FigureView } from './draw';
import { bodyFrame, type BodyFrame } from './features';
import { ACCEPT_SCORE, recognize, Segmenter, segmentClip, type Recognition, type Segment, type Template } from './reader';
import { ClipRecorder, trimToHands } from './recorder';
import { compareClips, type CompareResult, type Hint } from './scoring';
import * as db from './storage';
import { Tracker, type LoadEvent, type LoadStep } from './tracker';
import { STARTER_VOCABULARY } from './vocabulary';
import { clipKind, type Clip, type ClipKind, type Frame, type FrameData, type Word } from './types';

type Kind = ClipKind;
type Mode = 'record' | 'read';
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
  fps: $('fps'),
  startCamera: $<HTMLButtonElement>('startCamera'),
  countdown: $('countdown'),
  recBadge: $('recBadge'),
  recLabel: $('recLabel'),
  modeRecord: $<HTMLButtonElement>('modeRecord'),
  modeRead: $<HTMLButtonElement>('modeRead'),
  modeNote: $('modeNote'),
  caption: $('caption'),
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
  mode: Mode;
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
    mode: 'record',
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

function referenceClip(): Clip | null {
  const id = selectedWord()?.referenceId;
  return id ? (clips.find((c) => c.id === id) ?? null) : null;
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

function cameraView(): { backdrop: Backdrop; bones: boolean } {
  const { showVideo, showBones } = settings;
  // With bones on, the tracked frame is drawn under them so they line up; with bones off the live video shows through.
  const backdrop: Backdrop = showBones ? (showVideo ? ui.video : 'dark') : showVideo ? null : 'dark';
  return { backdrop, bones: showBones };
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
  if (!tracker || v.readyState < 2 || v.paused || v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;
  countFrame(performance.now());

  let data;
  try {
    data = tracker.detect(v);
  } catch (err) {
    if (!trackingFailed) {
      trackingFailed = true;
      console.error(err);
      say(`手の検出でエラーが起きました（${errorText(err)}）。ページを再読み込みしてください。`, 'error');
    }
    return;
  }
  drawOverlay(overlayCtx, data, cameraView());

  if (phase === 'recording' && recorder) {
    recorder.push(data);
    ui.recTime.textContent = (recorder.elapsedMs / 1000).toFixed(1);
  }
  if (settings.mode === 'read' && phase === 'idle' && !importing) {
    live ??= { segmenter: new Segmenter(v.videoWidth / v.videoHeight), startedAt: performance.now() };
    const sign = live.segmenter.push(data, performance.now() - live.startedAt);
    showPending(live.segmenter.active);
    if (sign) readSign(sign, `カメラ ${fmtClock(sign.startMs)}`);
  }
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
    stream = await navigator.mediaDevices.getUserMedia({
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
  attachCamera();
  updateControls();
}

function attachCamera(): void {
  const v = ui.video;
  live = null;
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

function beginRecording(kind: Kind, source: MediaStream | null): void {
  recordKind = kind;
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
  beginRecording(kind, stream);
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
    if (save) await saveClip(rec.frames, video, recordKind);
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

async function saveClip(frames: Frame[], video: Blob | null, kind: Kind): Promise<void> {
  const word = selectedWord();
  if (!word) return;
  const kept = trimToHands(frames);
  if (kept.length < MIN_FRAMES) {
    say('手がほとんど映っていなかったので保存しませんでした。両手がカメラに入る位置で、もう一度撮ってください。', 'error');
    return;
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
  };
  await db.putClip(clip);
  if (video && video.size > 0) await db.putVideo(clip.id, video);
  const becomesReference = kind === 'sample' && !word.referenceId;
  if (becomesReference) {
    word.referenceId = clip.id;
    await db.putWord(word);
  }
  await loadClips();
  await loadTemplates();
  renderWords();
  renderDetail();
  if (kind === 'sample') {
    hideResult();
    const count = clips.filter((c) => clipKind(c, word) === 'sample').length;
    const next = becomesReference && settings.autoNext ? nextWordWithoutSamples(word.id) : null;
    if (next) {
      await selectWord(next.id, true);
      say(`「${word.label}」の見本を保存しました。次は「${next.label}」です。`);
      return;
    }
    say(
      becomesReference
        ? `「${word.label}」の見本を保存しました。これがお手本になります。見本をもう何回か撮ると、読み取りが安定します。`
        : `「${word.label}」の見本を保存しました（${count}件目）。読み取りモードで使われます。`,
    );
    await showVideo(clip);
  } else {
    say('練習を保存しました。');
    showResult(clip.id);
  }
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
    beginRecording(kind, null);
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
      readSign(sign, `${file.name} ${fmtClock(sign.startMs)}`);
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

/** Stop button, Escape and Space all end up here. */
function stop(save: boolean): void {
  if (importing) importing.cancelled = true;
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
  if (word.referenceId === clip.id) {
    word.referenceId = null;
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
  word.referenceId = clip.id;
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
  const kind = clip.id === referenceClip()?.id ? 'お手本' : '練習';
  const blob = await db.getVideo(clip.id);
  playerBox.hidden = false;
  viewer.hidden = !blob;
  if (blob) {
    viewerUrl = URL.createObjectURL(blob);
    viewer.src = viewerUrl;
    viewerCaption.textContent = `${kind}の動画（${fmtDate(clip.createdAt)} 撮影）`;
  } else {
    viewerCaption.textContent = `この${kind}には動画がありません。JSONから読み込んだ記録は、手と体の動きだけを持っています。`;
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
  ];
  if (!ref) {
    parts.push(
      el('p', {
        className: 'empty-state',
        textContent: 'まだ見本がありません。カメラの前で手話をして「見本を撮る」を押すか、手話の動画ファイルを読み込んでください。最初の見本がお手本になります。',
      }),
    );
  }
  parts.push(playerBox);
  if (clips.length) parts.push(el('div', { className: 'clips-wrap' }, clipTable(ref)));
  ui.wordDetail.replaceChildren(...parts);
}

function clipTable(ref: Clip | null): HTMLTableElement {
  const head = el(
    'tr',
    {},
    el('th', { textContent: '撮影日時' }),
    el('th', { textContent: '長さ', className: 'num' }),
    el('th', { textContent: '種類・点数', className: 'num' }),
    el('th', {}, el('span', { className: 'visually-hidden', textContent: '操作' })),
  );
  const word = selectedWord();
  const rows = clips.map((clip) => {
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
      el('td', { title: clip.signer ? `撮影者: ${clip.signer}` : '' }, fmtDate(clip.createdAt)),
      el('td', { className: 'num', textContent: fmtSec(clip.durationMs) }),
      el('td', { className: 'num' }, scoreCell),
      el(
        'td',
        { className: 'actions' },
        !isSample && ref ? button('結果', () => showResult(clip.id)) : null,
        button('動画', () => void showVideo(clip)),
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
  const canShoot = tracker !== null && stream !== null && !importing && word !== null && idle;
  const busy = phase === 'countdown' || phase === 'recording' || phase === 'reading';

  ui.modeRecord.setAttribute('aria-pressed', String(!reading));
  ui.modeRead.setAttribute('aria-pressed', String(reading));
  ui.modeRecord.disabled = ui.modeRead.disabled = !idle;
  ui.modeNote.textContent = reading
    ? '手話をすると、登録した単語から一番近いものを字幕に出します。'
    : '単語ごとに見本を登録し、お手本と比べて練習します。';
  ui.transcript.hidden = !reading;
  ui.caption.hidden = !reading || !stream || Boolean(importing);

  ui.recordRef.disabled = !canShoot;
  ui.recordTry.disabled = !canShoot || !ref;
  ui.pickFile.textContent = reading ? '動画に字幕を付ける' : '動画ファイルから読み込む';
  ui.pickFile.disabled = !(tracker && idle && (reading ? templates.length : word));
  ui.stopRec.hidden = !busy;
  ui.recordRef.hidden = ui.recordTry.hidden = busy || reading;
  ui.stopRec.textContent = importing ? '読み込みをやめる' : phase === 'countdown' ? 'やめる' : '停止';

  if (reading) {
    const samples = templates.length;
    const vocabulary = new Set(templates.map((t) => t.word.id)).size;
    ui.controlsHint.textContent = !samples
      ? '読み取れる単語がまだありません。記録モードで単語の見本を撮ってください。'
      : !tracker
        ? 'モデルの読み込みが終わると読み取れます。'
        : !stream
          ? `登録した${vocabulary}語（見本${samples}件）から読み取ります。「カメラを使う」を押すか、動画に字幕を付けてください。`
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
  /** Where the sign came from: the camera or a file, and when. */
  where: string;
  rec: Recognition;
}

/** Every sample of every word: what signing is read against. */
let templates: Template[] = [];
let live: { segmenter: Segmenter; startedAt: number } | null = null;
let transcript: Caption[] = [];
let captionWords: string[] = [];
let captionTimer = 0;
let pending = false;

async function loadTemplates(): Promise<void> {
  const byId = new Map(words.map((w) => [w.id, w]));
  templates = (await db.listAllClips()).flatMap((clip) => {
    const word = byId.get(clip.wordId);
    return word && clipKind(clip, word) === 'sample' ? [{ word, clip }] : [];
  });
  renderWords();
  updateControls();
}

function setMode(mode: Mode): void {
  if (phase !== 'idle') return;
  settings.mode = mode;
  saveSettings();
  live = null;
  showPending(false);
  if (mode === 'read') hideResult();
  updateControls();
}

function readSign(sign: Segment, where: string): void {
  const clip = segmentClip(sign, ui.video.videoWidth, ui.video.videoHeight);
  const rec = recognize(clip, templates, { mirror: settings.mirrorCompare, useFace: settings.useFace });
  transcript.push({ where, rec });
  renderTranscript();
  showCaption(rec);
}

function showCaption(rec: Recognition): void {
  captionWords = [...captionWords, rec.word ? rec.word.label : '？'].slice(-CAPTION_WORDS);
  renderCaption();
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => {
    captionWords = [];
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
  const spans = captionWords.map((w, i) =>
    el('span', { className: i === captionWords.length - 1 ? 'latest' : '', textContent: w }),
  );
  if (pending) spans.push(el('span', { className: 'pending', textContent: '…' }));
  ui.caption.replaceChildren(...spans);
  ui.caption.classList.toggle('is-empty', !captionWords.length && !pending);
}

function candidatesText(rec: Recognition): string {
  const [top, ...rest] = rec.candidates;
  if (!top) return '';
  const list = (cs: typeof rec.candidates) => cs.map((c) => `${c.word.label} ${Math.round(c.score)}点`).join('、');
  if (!rec.word) return `いちばん近いのは${list([top])}でした（${ACCEPT_SCORE}点未満）`;
  return rest.length ? `${Math.round(top.score)}点　ほかの候補は${list(rest)}` : `${Math.round(top.score)}点`;
}

function renderTranscript(): void {
  ui.transcriptEmpty.hidden = transcript.length > 0;
  ui.transcriptList.replaceChildren(
    ...transcript.map(({ where, rec }) =>
      el(
        'li',
        { className: rec.word ? '' : 'is-unknown' },
        el('span', { className: 'said', textContent: rec.word ? rec.word.label : '読み取れませんでした' }),
        el('span', { className: 'why', textContent: candidatesText(rec) }),
        el('span', { className: 'when', textContent: where }),
      ),
    ),
  );
  ui.transcriptList.scrollTop = ui.transcriptList.scrollHeight;
}

function clearTranscript(): void {
  transcript = [];
  captionWords = [];
  renderTranscript();
  renderCaption();
}

async function copyTranscript(): Promise<void> {
  const text = transcript.flatMap(({ rec }) => (rec.word ? [rec.word.label] : [])).join(' ');
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
  const opts = { practice: ui.exportPractice.checked, videos: ui.exportVideos.checked };
  const data = await db.exportData(opts);
  if (!data.clips.length) {
    say('書き出す見本がまだありません。');
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
      (opts.videos ? '（動画つき）。' : '（動画なし）。'),
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
    saveSettings();
    ui.viewport.classList.toggle('mirrored', settings.mirrorView);
    drawDuet();
  };
  ui.viewport.classList.toggle('mirrored', settings.mirrorView);

  const bindToggle = (button: HTMLButtonElement, key: 'showVideo' | 'showBones') => {
    button.setAttribute('aria-pressed', String(settings[key]));
    button.onclick = () => {
      settings[key] = !settings[key];
      button.setAttribute('aria-pressed', String(settings[key]));
      saveSettings();
    };
  };
  bindToggle(ui.toggleVideo, 'showVideo');
  bindToggle(ui.toggleBones, 'showBones');
}

function bindEvents(): void {
  ui.video.addEventListener('loadedmetadata', sizeOverlay);
  ui.video.addEventListener('resize', sizeOverlay);
  ui.startCamera.onclick = () => void startCamera();
  ui.recordRef.onclick = () => void record('sample');
  ui.recordTry.onclick = () => void record('practice');
  ui.stopRec.onclick = () => stop(true);
  ui.pickFile.onclick = () => ui.fileInput.click();
  ui.fileInput.onchange = () => {
    const file = ui.fileInput.files?.[0];
    ui.fileInput.value = '';
    if (file) void (settings.mode === 'read' ? captionFile(file) : importFile(file));
  };
  ui.modeRecord.onclick = () => setMode('record');
  ui.modeRead.onclick = () => setMode('read');
  ui.clearTranscript.onclick = clearTranscript;
  ui.copyTranscript.onclick = () => void copyTranscript();

  ui.addStarter.onclick = () => void addStarterVocabulary();
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
  window.addEventListener('resize', drawDuet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && phase !== 'idle') {
      stop(false);
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
