import type { Word } from './types';

/** A piece of a sentence: either a word from the vocabulary or plain text between words. */
export interface Token {
  /** The text as it appeared in the sentence. */
  text: string;
  word: Word | null;
}

/**
 * Folds katakana to hiragana and full-width ASCII to half-width, one UTF-16
 * unit at a time so positions in the result match positions in the input.
 */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch.length > 1) out += ch;
    else if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60);
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
    else out += ch;
  }
  return out;
}

const KANJI_NUMBERS: Record<string, string> = {
  '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
  '6': '六', '7': '七', '8': '八', '9': '九', '10': '十',
  '100': '百', '1000': '千',
};

/** Godan endings and the kana their stems take before ます, て and ない. */
const GODAN: Record<string, { i: string; te: string; a: string }> = {
  く: { i: 'き', te: 'い', a: 'か' },
  ぐ: { i: 'ぎ', te: 'い', a: 'が' },
  す: { i: 'し', te: 'し', a: 'さ' },
  つ: { i: 'ち', te: 'っ', a: 'た' },
  ぬ: { i: 'に', te: 'ん', a: 'な' },
  ぶ: { i: 'び', te: 'ん', a: 'ば' },
  む: { i: 'み', te: 'ん', a: 'ま' },
  う: { i: 'い', te: 'っ', a: 'わ' },
  る: { i: 'り', te: 'っ', a: 'ら' },
};

/** Kana before る that mark an ichidan verb (食べる, 起きる): its stem is the word minus る. */
const ICHIDAN_BEFORE_RU = new Set('えけせてねへめれげぜでべぺいきしちにひみりぎじぢびぴ');

const isKanji = (ch: string) => /\p{Script=Han}/u.test(ch);

/**
 * The forms a word may take in running speech: 食べる as 食べ(ます), 行く as
 * 行き / 行っ / 行か, うれしい as うれし(かった), 3 as 三. Matching a form
 * anywhere it starts a word is enough, since the ending that follows is not signed.
 */
export function forms(label: string): string[] {
  return formsOf(label).map((f) => f.form);
}

/**
 * Each form, and whether it is a stem: a stem is normally followed by an
 * ending (飲み|たい), so it need not end where a word ends; whole forms must.
 */
function formsOf(label: string): Array<{ form: string; stem: boolean }> {
  const base = fold(label.normalize('NFKC').replace(/\s+/g, ''));
  const whole = new Set([base]);
  const stems = new Set<string>();
  const kanji = KANJI_NUMBERS[base];
  if (kanji) whole.add(kanji);

  const last = base.at(-1) ?? '';
  const stem = base.slice(0, -1);
  if (base.length >= 2 && GODAN[last]) {
    const before = stem.at(-1) ?? '';
    if (last === 'る' && (ICHIDAN_BEFORE_RU.has(before) || isKanji(before))) stems.add(stem);
    const g = GODAN[last];
    stems.add(stem + g.i);
    stems.add(stem + (base === '行く' || base === 'いく' ? 'っ' : g.te));
    stems.add(stem + g.a);
  }
  // Adjectives (うれしい → うれし) and past forms (疲れた → 疲れ).
  if (base.length >= 3 && (last === 'い' || last === 'た')) stems.add(stem);

  return [
    ...[...whole].map((form) => ({ form, stem: false })),
    ...[...stems].filter((s) => !whole.has(s)).map((form) => ({ form, stem: true })),
  ].filter((f) => f.form.length > 0);
}

/**
 * Splits a sentence into vocabulary words and the text between them. A word
 * must start where a word starts (by the browser's Japanese word breaker, or
 * right after another match), so 見 is not found inside 意見, and must end
 * where one ends unless it is a stem, so the は of 今日は and the start of いい
 * do not make はい. The longest form wins.
 */
export function toSigns(text: string, words: Word[]): Token[] {
  const folded = fold(text);
  const starts = new Set<number>([0]);
  for (const s of new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)) starts.add(s.index);
  const isBoundary = (i: number) => i === text.length || starts.has(i);

  const entries = words
    .flatMap((word) => formsOf(word.label).map((f) => ({ ...f, word })))
    .sort((a, b) => b.form.length - a.form.length);

  const tokens: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain) tokens.push({ text: plain, word: null });
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    const hit = starts.has(i)
      ? entries.find((e) => folded.startsWith(e.form, i) && (e.stem || isBoundary(i + e.form.length)))
      : undefined;
    if (hit) {
      flush();
      tokens.push({ text: text.slice(i, i + hit.form.length), word: hit.word });
      i += hit.form.length;
      starts.add(i);
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return tokens;
}
