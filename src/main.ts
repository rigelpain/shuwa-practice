import './style.css';
import { drawFigure, drawOverlay, drawTimeline, fitCanvas, fitView, type FigureView } from './draw';
import { bodyFrame, type BodyFrame } from './features';
import { ClipRecorder, trimToHands } from './recorder';
import { compareClips, type CompareResult } from './scoring';
import * as db from './storage';
import { Tracker } from './tracker';
import type { Clip, Frame, Word } from './types';

type Kind = 'reference' | 'practice';
type Phase = 'idle' | 'countdown' | 'recording' | 'saving';

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
  viewport: $('viewport'),
  video: $<HTMLVideoElement>('video'),
  overlay: $<HTMLCanvasElement>('overlay'),
  viewportEmpty: $('viewportEmpty'),
  startCamera: $<HTMLButtonElement>('startCamera'),
  countdown: $('countdown'),
  recBadge: $('recBadge'),
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
}

const settings: Settings = (() => {
  const defaults: Settings = {
    countdown: 3,
    maxSeconds: 4,
    signer: '',
    recordFace: true,
    useFace: false,
    mirrorCompare: false,
    mirrorView: true,
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

// ---------------------------------------------------------------- camera and tracking

const overlayCtx = ui.overlay.getContext('2d')!;
let lastVideoTime = -1;
let trackingFailed = false;

function loop(): void {
  requestAnimationFrame(loop);
  const v = ui.video;
  if (!tracker || v.readyState < 2 || v.paused || v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;

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
  drawOverlay(overlayCtx, data);

  if (phase === 'recording' && recorder) {
    recorder.push(data);
    ui.recTime.textContent = (recorder.elapsedMs / 1000).toFixed(1);
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
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
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
  v.removeAttribute('src');
  v.srcObject = stream;
  v.playbackRate = 1;
  ui.viewportEmpty.hidden = stream !== null;
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
  };
  await db.putClip(clip);
  if (video && video.size > 0) await db.putVideo(clip.id, video);
  if (kind === 'reference') {
    word.referenceId = clip.id;
    await db.putWord(word);
  }
  await loadClips();
  renderWords();
  renderDetail();
  if (kind === 'reference') {
    hideResult();
    say(`「${word.label}」のお手本を保存しました。「練習する」で比べられます。`);
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

/**
 * Reads a video file frame by frame. Seeking instead of playing means every
 * frame is tracked no matter how fast the machine is or whether the tab is visible.
 */
async function importFile(file: File): Promise<void> {
  if (!selectedWord() || !tracker || phase !== 'idle') return;
  // A word without a reference takes the video as its reference.
  const kind: Kind = referenceClip() ? 'practice' : 'reference';
  const v = ui.video;
  const url = URL.createObjectURL(file);
  importing = { file, url, cancelled: false };
  v.srcObject = null;
  v.preload = 'auto';
  v.src = url;
  ui.viewportEmpty.hidden = true;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error('このブラウザでは再生できない動画です'));
    });
    const duration = await knownDuration(v);
    beginRecording(kind, null);
    say(
      kind === 'reference'
        ? '動画を読み取っています。終わるとお手本として保存します。'
        : '動画を読み取っています。終わると練習として保存し、お手本と比べます。',
    );
    for (let t = 0; t <= duration && !importing.cancelled; t += 1 / SCAN_FPS) {
      await seek(v, t);
      const data = tracker.detect(v);
      drawOverlay(overlayCtx, data);
      recorder?.push(data, t * 1000);
      ui.recTime.textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}`;
    }
    await finish(!importing.cancelled);
  } catch (err) {
    recorder = null;
    phase = 'idle';
    ui.recBadge.hidden = true;
    endImport();
    updateControls();
    say(`動画を読み込めませんでした（${errorText(err)}）。`, 'error');
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

async function selectWord(id: string): Promise<void> {
  if (phase !== 'idle') return;
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
  if (shown && (shown.attempt.id === clip.id || shown.ref.id === clip.id)) hideResult();
  await loadClips();
  renderWords();
  renderDetail();
  updateControls();
  if (viewerClipId === clip.id) await showVideo(referenceClip());
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
  say('お手本を差し替えました。ほかの記録の点数は、このお手本と比べた値に変わります。');
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

function renderWords(): void {
  if (!words.length) {
    ui.wordList.replaceChildren(
      el('li', { className: 'empty', textContent: 'まだ単語がありません。上の欄に入力して追加してください。' }),
    );
    return;
  }
  ui.wordList.replaceChildren(
    ...words.map((w) => {
      const button = el(
        'button',
        { type: 'button', className: 'word', onclick: () => void selectWord(w.id) },
        w.label,
        w.referenceId ? null : el('small', { textContent: 'お手本なし' }),
      );
      button.setAttribute('aria-pressed', String(w.id === selectedId));
      return el('li', {}, button);
    }),
  );
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
        textContent: 'まだお手本がありません。カメラの前で手話をして「お手本を撮る」を押すか、手話の動画ファイルを読み込んでください。',
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
    el('th', { textContent: '点数', className: 'num' }),
    el('th', {}, el('span', { className: 'visually-hidden', textContent: '操作' })),
  );
  const rows = clips.map((clip) => {
    const isRef = clip.id === ref?.id;
    const scoreCell = isRef
      ? el('span', { className: 'tag', textContent: 'お手本' })
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
        !isRef && ref ? button('結果', () => showResult(clip.id)) : null,
        button('動画', () => void showVideo(clip)),
        isRef ? null : button('お手本にする', () => void makeReference(clip)),
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
  const canShoot = tracker !== null && stream !== null && !importing && word !== null && idle;
  const busy = phase === 'countdown' || phase === 'recording';

  ui.recordRef.disabled = !canShoot;
  ui.recordTry.disabled = !canShoot || !ref;
  ui.pickFile.disabled = !(tracker && word && idle);
  ui.stopRec.hidden = !busy;
  ui.recordRef.hidden = ui.recordTry.hidden = busy;
  ui.stopRec.textContent = importing ? '読み込みをやめる' : phase === 'countdown' ? 'やめる' : '停止';

  ui.controlsHint.textContent = !word
    ? '右の欄で単語を選ぶか、新しく追加してください。'
    : !tracker
      ? 'モデルの読み込みが終わると撮影できます。'
      : !stream
        ? '「カメラを使う」を押すと撮影できます。手話の動画ファイルからも読み込めます。'
        : !ref
          ? `まず「${word.label}」のお手本を撮ってください。`
          : '手を下ろした状態から始めて、終わったら手を下ろしてください。スペースキーでも練習を始められます。';
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
  // Hints name hands in the reference's terms; when mirrored, the learner used the other hand.
  const hand = settings.mirrorCompare && hint.hand ? (hint.hand === 'left' ? 'right' : 'left') : hint.hand;
  const who = hint.part === 'face' ? '' : hand === 'left' ? '左手の' : hand === 'right' ? '右手の' : '両手の';
  const what = { location: '位置', shape: '形', face: '表情や頭の動き' }[hint.part];
  const when = hint.whole
    ? '全体を通して'
    : `お手本の${(hint.startMs / 1000).toFixed(1)}〜${(hint.endMs / 1000).toFixed(1)}秒あたりで`;
  return `${when}、${who}${what}がいちばんずれています。`;
}

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
  for (const part of ['location', 'shape', 'face'] as const) {
    const score = res.parts[part];
    const { bar, value } = partEls[part];
    bar.style.width = `${score ?? 0}%`;
    value.textContent = score === null ? '—' : String(Math.round(score));
    bar.closest('.part')?.classList.toggle('is-off', score === null);
  }
  ui.resultAdvice.textContent = adviceText(res);
  ui.resultSpeed.textContent = speedText(res.speedRatio);

  const faceNote = !settings.useFace
    ? '比べていません（設定でオン）'
    : res.raw.face === null
      ? '表情の記録がないため比べていません'
      : res.raw.face.toFixed(3);
  const rows: Array<[string, string]> = [
    ['手首の位置のずれ', `${res.raw.location!.toFixed(3)}（肩幅を1とする）`],
    ['関節の位置のずれ', `${res.raw.shape!.toFixed(3)}（手の長さを1とする）`],
    ['表情のずれ', faceNote],
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
  const data = await db.exportData();
  if (!data.clips.length) {
    say('書き出す記録がまだありません。');
    return;
  }
  // Four decimals keep landmark precision while roughly halving the file.
  const json = JSON.stringify(data, (_key, v: unknown) =>
    typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v,
  );
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  el('a', { href: url, download: `shuwa-practice-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`${data.words.length}語、${data.clips.length}件の記録を書き出しました。動画は含まれません。`);
}

async function importAll(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as db.ExportFile;
    if (data.format !== 'shuwa-practice' || !Array.isArray(data.words) || !Array.isArray(data.clips)) {
      throw new Error('このツールで書き出したファイルではありません');
    }
    await db.importData(data);
    words = await db.listWords();
    comparisons.clear();
    selectedId ??= words[0]?.id ?? null;
    await loadClips();
    renderWords();
    renderDetail();
    updateControls();
    say(`${data.words.length}語、${data.clips.length}件の記録を読み込みました。`);
  } catch (err) {
    say(`読み込めませんでした（${errorText(err)}）。このツールで書き出したJSONファイルを選んでください。`, 'error');
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
    try {
      await tracker?.setFace(settings.recordFace);
    } catch (err) {
      say(`表情のモデルを読み込めませんでした（${errorText(err)}）。`, 'error');
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
}

function bindEvents(): void {
  ui.video.addEventListener('loadedmetadata', sizeOverlay);
  ui.video.addEventListener('resize', sizeOverlay);
  ui.startCamera.onclick = () => void startCamera();
  ui.recordRef.onclick = () => void record('reference');
  ui.recordTry.onclick = () => void record('practice');
  ui.stopRec.onclick = () => stop(true);
  ui.pickFile.onclick = () => ui.fileInput.click();
  ui.fileInput.onchange = () => {
    const file = ui.fileInput.files?.[0];
    ui.fileInput.value = '';
    if (file) void importFile(file);
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
  window.addEventListener('resize', drawDuet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && phase !== 'idle') {
      stop(false);
      return;
    }
    if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, select, textarea, button, summary, video')) return;
    e.preventDefault();
    if (phase === 'idle') void record('practice');
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
  updateControls();

  try {
    tracker = await Tracker.create();
    if (settings.recordFace) await tracker.setFace(true);
    setStatus('準備ができました');
  } catch (err) {
    console.error(err);
    setStatus(`手の検出モデルを読み込めませんでした。ページを再読み込みしてください（${errorText(err)}）`, true);
  }
  updateControls();
}

void init();
