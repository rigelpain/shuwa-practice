import { describe, expect, it } from 'vitest';
import { applyCaptions, type Cut } from './cuts';
import { parseSubtitles } from './subtitles';
import type { Word } from './types';

describe('parseSubtitles', () => {
  it('reads SubRip captions', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nおはようございます\r\n\r\n2\r\n00:00:04,200 --> 00:00:06,000\r\n今日は\r\nいい天気です\r\n';
    expect(parseSubtitles(srt)).toEqual([
      { startMs: 1000, endMs: 3500, text: 'おはようございます' },
      { startMs: 4200, endMs: 6000, text: '今日は いい天気です' },
    ]);
  });

  it('reads WebVTT captions, dropping headers, notes, settings and tags', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE 手話講座 第1回',
      '',
      'intro',
      '00:01.500 --> 00:02.250 align:center',
      '<v 先生>ありがとう</v>',
      '',
      '01:00:00.000 --> 01:00:01.000',
      '<c.yellow>どうして</c>？',
    ].join('\n');
    expect(parseSubtitles(vtt)).toEqual([
      { startMs: 1500, endMs: 2250, text: 'ありがとう' },
      { startMs: 3_600_000, endMs: 3_601_000, text: 'どうして？' },
    ]);
  });
});

describe('applyCaptions', () => {
  const words: Word[] = ['おはよう', '今日', 'いい', 'ありがとう'].map((label) => ({ id: label, label, referenceId: null, createdAt: 0 }));
  const cut = (startMs: number, endMs: number, extra: Partial<Cut> = {}): Cut => ({
    startMs,
    endMs,
    label: '',
    variant: null,
    include: false,
    suggestion: null,
    caption: null,
    guessedFrom: null,
    ...extra,
  });

  it('names the cuts under a caption after its words, in order', () => {
    const cues = [{ startMs: 0, endMs: 3000, text: '今日はいい天気ですね' }];
    const out = applyCaptions([cut(200, 1200), cut(1500, 2600), cut(5000, 6000)], cues, words);
    expect(out.map((c) => c.label)).toEqual(['今日', 'いい', '']);
    expect(out[0]).toMatchObject({ caption: '今日はいい天気ですね', include: true, guessedFrom: 'caption' });
    expect(out[2].caption).toBeNull();
  });

  it('keeps a name already given by a matching sample', () => {
    const known = cut(200, 1200, { label: 'ありがとう', include: true, guessedFrom: 'motion' });
    const out = applyCaptions([known], [{ startMs: 0, endMs: 2000, text: 'おはよう' }], words);
    expect(out[0]).toMatchObject({ label: 'ありがとう', guessedFrom: 'motion', caption: 'おはよう' });
  });
});
