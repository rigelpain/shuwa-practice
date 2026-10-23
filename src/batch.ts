/**
 * The word, and version of it, that a video file is a sample of, read from
 * its name: "おはよう.mp4", "おはよう_2.mov" and "おはよう (3).webm" are all
 * samples of おはよう; "ありがとう（関西）.mp4" and "ありがとう(関西)_2.mp4" are
 * samples of ありがとう's 関西 version. macOS hands file names over decomposed
 * (で as て + ゛), so they are recomposed first.
 */
export function parseSampleName(name: string): { label: string; variant: string } {
  const base = name.normalize('NFC').replace(/\.[^.]+$/, '');
  // A take number needs a separator or brackets, so "10.mp4" stays the word 10.
  const untaken = base.replace(/(?:[\s_-]+\d+|\s*[(（]\d+[)）])$/, '').trim() || base.trim();
  const versioned = /^(.+?)\s*[(（]([^()（）]+)[)）]$/.exec(untaken);
  return versioned ? { label: versioned[1].trim(), variant: versioned[2].trim() } : { label: untaken, variant: '' };
}
