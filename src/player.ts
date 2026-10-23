import { drawFigure, fitCanvas, fitView, type FigureView } from './draw';
import { bodyFrame, type BodyFrame } from './features';
import type { Clip, Frame, Word } from './types';

export interface MotionItem {
  word: Word;
  clip: Clip;
}

/** Pause between words, during which the last pose stays faintly on screen. */
const GAP_MS = 350;

/** The frame showing at time t (ms) into a clip. */
function frameAt(clip: Clip, t: number): Frame {
  const frames = clip.frames;
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
  return frames[i];
}

/**
 * Plays word samples one after another as a moving figure. Timing follows
 * the clock, not the frame rate, so a slow or throttled page still plays at
 * the right speed.
 */
export class MotionPlayer {
  private items: Array<MotionItem & { body: BodyFrame }> = [];
  private view: FigureView | null = null;
  private index = 0;
  private startedAt = 0;
  private raf = 0;
  /** 1 is the recorded speed. */
  speed = 1;
  flip = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Called with the word now playing, or null once the sequence has finished. */
    private readonly onWord: (index: number | null) => void,
  ) {}

  get playing(): boolean {
    return this.raf !== 0;
  }

  get length(): number {
    return this.items.length;
  }

  load(items: MotionItem[]): void {
    this.stop();
    this.items = items.map((item) => ({ ...item, body: bodyFrame(item.clip) }));
    // One view for the whole sentence, so the figure does not jump in size between words.
    this.view = this.items.length ? fitView(this.items.map((i) => ({ frames: i.clip.frames, body: i.body }))) : null;
    this.index = 0;
    this.redraw();
  }

  play(from = 0): void {
    if (!this.items.length) return;
    this.stop();
    this.index = Math.min(from, this.items.length - 1);
    this.startedAt = performance.now();
    this.onWord(this.index);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Draws the first pose of the current word, or clears the canvas when there is nothing to show. */
  redraw(): void {
    const ctx = fitCanvas(this.canvas);
    const item = this.items[this.index];
    if (!item || !this.view) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    drawFigure(ctx, item.clip.frames[0], item.body, this.view, { flip: this.flip });
  }

  private readonly tick = (now: number): void => {
    const item = this.items[this.index];
    const ctx = fitCanvas(this.canvas);
    const real = Math.max(0, now - this.startedAt);
    const playMs = item.clip.durationMs / this.speed;

    if (real <= playMs) {
      drawFigure(ctx, frameAt(item.clip, real * this.speed), item.body, this.view!, { flip: this.flip });
    } else if (real <= playMs + GAP_MS) {
      drawFigure(ctx, item.clip.frames.at(-1)!, item.body, this.view!, { flip: this.flip, alpha: 0.35 });
    } else if (this.index + 1 < this.items.length) {
      this.index++;
      this.startedAt = now;
      this.onWord(this.index);
    } else {
      this.raf = 0;
      this.index = 0;
      this.onWord(null);
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
