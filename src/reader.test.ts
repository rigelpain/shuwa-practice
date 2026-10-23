import { describe, expect, it } from 'vitest';
import { POSE_KEEP } from './features';
import { recognize, Segmenter, segmentClip, type Segment, type Template } from './reader';
import type { Clip, FrameData, Word } from './types';

const WIDTH = 1280;
const HEIGHT = 720;
const ASPECT = WIDTH / HEIGHT;
const STEP = 1000 / 30;

/** Hand joints in metres, wrist at the origin; curl < 1 bends the fingers. */
function shape(curl: number): number[][] {
  return Array.from({ length: 21 }, (_, k) => {
    if (k === 0) return [0, 0, 0];
    const finger = Math.floor((k - 1) / 4);
    const joint = ((k - 1) % 4) + 1;
    return [(finger - 2) * 0.02, -(0.05 + 0.025 * (joint - 1)) * (joint === 1 ? 1 : curl), 0];
  });
}

function pose(): number[] {
  const p = new Array<number>(POSE_KEEP * 4).fill(0);
  p.splice(11 * 4, 4, 0.6, 0.6, 0, 1);
  p.splice(12 * 4, 4, 0.4, 0.6, 0, 1);
  return p;
}

/** A frame with the signer's right hand at (x, y), or no hand at all. */
function frame(at: [number, number] | null, curl = 1): FrameData {
  if (!at) return { pose: pose(), left: null, right: null, leftWorld: null, rightWorld: null, face: null };
  const pts = shape(curl);
  return {
    pose: pose(),
    left: null,
    right: pts.flatMap(([x, y, z]) => [at[0] + (x * 0.5) / ASPECT, at[1] + y * 0.5, z * 0.5]),
    leftWorld: null,
    rightWorld: pts.flat(),
    face: null,
  };
}

const arc = (u: number): [number, number] => [0.4 - 0.1 * Math.sin(Math.PI * u), 0.55 - 0.15 * u];
const vertical = (u: number): [number, number] => [0.4, 0.75 - 0.35 * u];
const sweep = (u: number): [number, number] => [0.25 + 0.3 * u, 0.3];

/** Runs frames through a segmenter at 30 fps and collects the signs it cuts out. */
function run(frames: FrameData[], segmenter = new Segmenter(ASPECT)): Segment[] {
  const out: Segment[] = [];
  frames.forEach((f, n) => {
    const seg = segmenter.push(f, n * STEP);
    if (seg) out.push(seg);
  });
  const rest = segmenter.flush();
  if (rest) out.push(rest);
  return out;
}

const idle = (n: number) => Array.from({ length: n }, () => frame(null));
const move = (n: number, path: (u: number) => [number, number], curl = 1) =>
  Array.from({ length: n }, (_, k) => frame(path(k / (n - 1)), curl));
const hold = (n: number, at: [number, number]) => Array.from({ length: n }, () => frame(at));

describe('Segmenter', () => {
  it('cuts a sign that ends with the hand held still', () => {
    const signs = run([...idle(10), ...move(30, arc), ...hold(30, arc(1)), ...idle(5)]);
    expect(signs).toHaveLength(1);
    const [sign] = signs;
    // About a second of movement plus a short piece of the hold.
    expect(sign.endMs - sign.startMs).toBeGreaterThan(900);
    expect(sign.endMs - sign.startMs).toBeLessThan(1600);
    expect(sign.frames[0].t).toBe(0);
  });

  it('cuts a sign when the hands drop out of view', () => {
    const signs = run([...idle(5), ...move(30, arc), ...idle(15), ...move(30, vertical), ...idle(15)]);
    expect(signs).toHaveLength(2);
    expect(signs[1].startMs).toBeGreaterThan(signs[0].endMs);
  });

  it('tells when the sign being collected started', () => {
    const segmenter = new Segmenter(ASPECT);
    const frames = [...idle(5), ...move(10, arc)];
    frames.forEach((f, n) => segmenter.push(f, n * STEP));
    expect(segmenter.active).toBe(true);
    // The pre-roll frames before the movement count as its start.
    expect(segmenter.startedAt).toBeLessThan(6 * STEP);
    expect(new Segmenter(ASPECT).startedAt).toBeNull();
  });

  it('ignores a hand that flicks through for a moment', () => {
    expect(run([...idle(5), ...move(4, sweep), ...idle(20)])).toHaveLength(0);
  });

  it('cuts a stretch that runs past the longest sign', () => {
    const wave = (u: number): [number, number] => [0.4 + 0.1 * Math.sin(20 * u), 0.5];
    const signs = run(move(200, wave));
    expect(signs.length).toBeGreaterThan(1);
    // The cut falls on the frame that reaches the limit.
    for (const s of signs) expect(s.endMs - s.startMs).toBeLessThanOrEqual(4000 + STEP);
  });
});

describe('recognize', () => {
  const word = (label: string): Word => ({ id: label, label, referenceId: null, createdAt: 0 });
  const thanks = word('ありがとう');
  const why = word('どうして');
  const clipOf = (frames: FrameData[]): Clip => {
    const [seg] = run([...idle(3), ...frames, ...idle(15)]);
    return segmentClip(seg, WIDTH, HEIGHT);
  };
  const templates: Template[] = [
    { word: thanks, clip: clipOf(move(30, arc)) },
    { word: thanks, clip: clipOf(move(36, arc)) },
    { word: why, clip: clipOf(move(30, vertical)) },
  ];
  const opts = { mirror: false, useFace: false };

  it('names the word whose samples are closest', () => {
    const res = recognize(clipOf(move(45, arc)), templates, opts);
    expect(res.word?.label).toBe('ありがとう');
    expect(res.candidates.map((c) => c.word.label)).toEqual(['ありがとう', 'どうして']);

    expect(recognize(clipOf(move(24, vertical)), templates, opts).word?.label).toBe('どうして');
  });

  it('tells which version of a word matched', () => {
    const regional = { ...templates[2], clip: { ...templates[2].clip, variant: '関西' } };
    const res = recognize(clipOf(move(30, vertical)), [templates[0], regional], opts);
    expect(res.word?.label).toBe('どうして');
    expect(res.candidates[0].variant).toBe('関西');
    expect(recognize(clipOf(move(30, arc)), templates, opts).candidates[0].variant).toBe('');
  });

  it('shows nothing for a sign unlike any sample', () => {
    const res = recognize(clipOf(move(30, sweep, 0.25)), templates, opts);
    expect(res.word).toBeNull();
    expect(res.candidates.length).toBe(2);
  });
});
