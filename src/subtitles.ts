/** One caption shown from startMs to endMs. */
export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toMs(stamp: string): number | null {
  const m = TIME.exec(stamp);
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(frac.padEnd(3, '0'));
}

/**
 * Reads SubRip (.srt) or WebVTT (.vtt) captions. Cue numbers, VTT headers,
 * NOTE blocks, cue settings and inline tags such as <c> or <v Name> are dropped.
 */
export function parseSubtitles(source: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at].split('-->');
    const startMs = toMs(from);
    const endMs = toMs(to);
    const text = lines
      .slice(at + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (startMs !== null && endMs !== null && text) cues.push({ startMs, endMs, text });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}
