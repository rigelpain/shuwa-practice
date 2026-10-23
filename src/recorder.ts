import type { Frame, FrameData } from './types';

const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

function pickVideoType(): string | undefined {
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Collects tracked frames and, for a camera stream, the video itself. */
export class ClipRecorder {
  readonly frames: Frame[] = [];
  private readonly startedAt = performance.now();
  private readonly media: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];

  constructor(stream: MediaStream | null) {
    if (!stream || typeof MediaRecorder === 'undefined') return;
    const mimeType = pickVideoType();
    this.media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.media.start();
  }

  get elapsedMs(): number {
    return performance.now() - this.startedAt;
  }

  /** `t` defaults to time since recording started; pass the media time for video files. */
  push(data: FrameData, t = this.elapsedMs): void {
    this.frames.push({ t, ...data });
  }

  /** Stops the video recording and returns it, or null when there was no stream. */
  stop(): Promise<Blob | null> {
    const media = this.media;
    if (!media || media.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      media.onstop = () => resolve(new Blob(this.chunks, { type: media.mimeType }));
      media.stop();
    });
  }
}

/**
 * Drops the frames before the hands first appear and after they last leave,
 * keeping a small margin, and restarts time at zero.
 */
export function trimToHands(frames: Frame[], margin = 2): Frame[] {
  const hasHand = (f: Frame) => f.left !== null || f.right !== null;
  const first = frames.findIndex(hasHand);
  if (first < 0) return [];
  let last = frames.length - 1;
  while (!hasHand(frames[last])) last--;
  const kept = frames.slice(Math.max(0, first - margin), Math.min(frames.length, last + margin + 1));
  const t0 = kept[0].t;
  return kept.map((f) => ({ ...f, t: f.t - t0 }));
}
