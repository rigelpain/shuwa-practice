import { describe, expect, it } from 'vitest';
import { fold, forms, toSigns } from './sentence';
import type { Word } from './types';
import { STARTER_VOCABULARY } from './vocabulary';

const vocabulary: Word[] = STARTER_VOCABULARY.flatMap((g) => g.words).map((label) => ({
  id: label,
  label,
  referenceId: null,
  createdAt: 0,
}));

/** The vocabulary words found in a sentence, in order. */
const signed = (text: string, words = vocabulary) =>
  toSigns(text, words).flatMap((t) => (t.word ? [t.word.label] : []));

describe('fold', () => {
  it('turns katakana into hiragana and full-width digits into ASCII without moving anything', () => {
    expect(fold('コーヒー１杯')).toBe('こーひー1杯');
    expect(fold('コーヒー１杯')).toHaveLength('コーヒー１杯'.length);
  });
});

describe('forms', () => {
  it('covers conjugated verbs and adjectives', () => {
    expect(forms('食べる')).toEqual(expect.arrayContaining(['食べる', '食べ']));
    expect(forms('行く')).toEqual(expect.arrayContaining(['行き', '行っ', '行か']));
    expect(forms('飲む')).toEqual(expect.arrayContaining(['飲み', '飲ん']));
    expect(forms('わかる')).toEqual(expect.arrayContaining(['わかり', 'わかっ', 'わから']));
    expect(forms('わかる')).not.toContain('わか');
    expect(forms('うれしい')).toContain('うれし');
    expect(forms('3')).toContain('三');
  });
});

describe('toSigns', () => {
  it('finds the vocabulary words in a spoken sentence', () => {
    expect(signed('おはようございます、今日はいい天気ですね')).toEqual(['おはよう', '今日', 'いい']);
    expect(signed('明日学校に行きます')).toEqual(['明日', '学校', '行く']);
    expect(signed('三時に駅で待っています')).toEqual(['3', '駅', '待つ']);
  });

  it('prefers a whole set phrase over the words inside it', () => {
    expect(signed('わかりました、ありがとうございます')).toEqual(['わかりました', 'ありがとう']);
    expect(signed('はじめまして、よろしくお願いします')).toEqual(['はじめまして', 'よろしくお願いします']);
  });

  it('does not find a word inside a longer one', () => {
    const see: Word[] = [{ id: '見る', label: '見る', referenceId: null, createdAt: 0 }];
    expect(signed('意見を見ます', see)).toEqual(['見る']);
  });

  it('keeps the text between words so the sentence can be shown whole', () => {
    const tokens = toSigns('水を飲みたいです', vocabulary);
    expect(tokens.map((t) => t.text).join('')).toBe('水を飲みたいです');
    expect(tokens.filter((t) => t.word).map((t) => t.word!.label)).toEqual(['水', '飲む']);
  });

  it('matches katakana in speech against hiragana labels', () => {
    const words: Word[] = [{ id: 'x', label: 'ありがとう', referenceId: null, createdAt: 0 }];
    expect(signed('アリガトウ', words)).toEqual(['ありがとう']);
  });
});
