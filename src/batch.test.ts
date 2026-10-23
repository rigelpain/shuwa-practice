import { describe, expect, it } from 'vitest';
import { parseSampleName } from './batch';

const labelFromFileName = (name: string) => parseSampleName(name).label;

describe('parseSampleName', () => {
  it('drops the extension and a take number', () => {
    expect(labelFromFileName('おはよう.mp4')).toBe('おはよう');
    expect(labelFromFileName('おはよう_2.mov')).toBe('おはよう');
    expect(labelFromFileName('おはよう-10.webm')).toBe('おはよう');
    expect(labelFromFileName('おはよう (3).mp4')).toBe('おはよう');
    expect(labelFromFileName('おはよう（3）.mp4')).toBe('おはよう');
    expect(labelFromFileName('よろしくお願いします.MOV')).toBe('よろしくお願いします');
  });

  it('keeps words that are numbers themselves', () => {
    expect(labelFromFileName('10.mp4')).toBe('10');
    expect(labelFromFileName('100_2.mp4')).toBe('100');
  });

  it('reads a version name in brackets', () => {
    expect(parseSampleName('ありがとう（関西）.mp4')).toEqual({ label: 'ありがとう', variant: '関西' });
    expect(parseSampleName('ありがとう(山田家)_2.mov')).toEqual({ label: 'ありがとう', variant: '山田家' });
    expect(parseSampleName('ありがとう (3).mp4')).toEqual({ label: 'ありがとう', variant: '' });
    expect(parseSampleName('おはよう.mp4')).toEqual({ label: 'おはよう', variant: '' });
  });

  it('recomposes decomposed kana from macOS file names', () => {
    const decomposed = 'どうして.mp4'.normalize('NFD');
    expect(decomposed).not.toBe('どうして.mp4');
    expect(labelFromFileName(decomposed)).toBe('どうして');
  });
});
