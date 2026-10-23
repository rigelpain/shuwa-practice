/**
 * The word a video file is a sample of, read from its name: "おはよう.mp4",
 * "おはよう_2.mov" and "おはよう (3).webm" are all samples of おはよう.
 * macOS hands file names over decomposed (で as て + ゛), so they are recomposed first.
 */
export function labelFromFileName(name: string): string {
  const base = name.normalize('NFC').replace(/\.[^.]+$/, '');
  // A take number needs a separator or brackets, so "10.mp4" stays the word 10.
  return base.replace(/(?:[\s_-]+\d+|\s*[(（]\d+[)）])$/, '').trim() || base.trim();
}
