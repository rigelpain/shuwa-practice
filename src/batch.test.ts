import { describe, expect, it } from 'vitest';
import { labelFromFileName } from './batch';

describe('labelFromFileName', () => {
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

  it('recomposes decomposed kana from macOS file names', () => {
    const decomposed = 'どうして.mp4'.normalize('NFD');
    expect(decomposed).not.toBe('どうして.mp4');
    expect(labelFromFileName(decomposed)).toBe('どうして');
  });
});
