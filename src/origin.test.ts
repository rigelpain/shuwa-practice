import { describe, expect, it } from 'vitest';
import { credits, describeOrigin, emptyOrigin, isCleared, ownRecording } from './origin';
import type { Clip, Origin } from './types';

const clip = (origin?: Origin): Clip => ({
  id: Math.random().toString(),
  wordId: 'w',
  signer: '',
  createdAt: 0,
  width: 1,
  height: 1,
  durationMs: 0,
  frames: [],
  ...(origin ? { origin } : {}),
});
const course: Origin = {
  ...emptyOrigin(),
  title: '手話講座 第1回',
  url: 'https://example.com/lesson1',
  rightsHolder: '〇〇チャンネル',
  permission: 'license',
  license: 'CC BY 4.0',
};

describe('describeOrigin', () => {
  it('names the source, its rights holder and why it may be used', () => {
    expect(describeOrigin(course)).toBe('手話講座 第1回（〇〇チャンネル、CC BY 4.0）');
    expect(describeOrigin({ ...emptyOrigin(), rightsHolder: '△△ろう協会', permission: 'granted' })).toBe(
      '△△ろう協会（権利者の許可あり）',
    );
    expect(describeOrigin(ownRecording())).toBe('本人が撮影');
    expect(describeOrigin(undefined)).toBe('出典は未記入');
  });
});

describe('isCleared', () => {
  it('treats samples without a recorded reason as not cleared', () => {
    expect(isCleared(clip(ownRecording()))).toBe(true);
    expect(isCleared(clip(course))).toBe(true);
    expect(isCleared(clip(emptyOrigin()))).toBe(false);
    expect(isCleared(clip())).toBe(false);
  });
});

describe('credits', () => {
  it('lists each source once with its number of samples, most used first', () => {
    const other: Origin = { ...emptyOrigin(), rightsHolder: '△△ろう協会', permission: 'granted' };
    const list = credits([clip(course), clip(other), clip(course), clip(ownRecording()), clip()]);
    expect(list.map((c) => [c.title || c.rightsHolder, c.samples])).toEqual([
      ['手話講座 第1回', 2],
      ['△△ろう協会', 1],
    ]);
  });
});
