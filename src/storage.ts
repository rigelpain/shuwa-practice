import { clipKind, type Clip, type Word } from './types';

const DB_NAME = 'shuwa-practice';

export interface ExportFile {
  format: 'shuwa-practice';
  /** 1: no clip kinds or videos. 2: clips carry their kind; videos are optional. */
  version: 1 | 2;
  exportedAt: string;
  words: Word[];
  clips: Clip[];
  /** Recorded videos as data URLs, when they were included. */
  videos?: Array<{ clipId: string; dataUrl: string }>;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('words', { keyPath: 'id' });
      db.createObjectStore('clips', { keyPath: 'id' }).createIndex('wordId', 'wordId');
      // Video blobs live apart from clips so listing clips stays cheap.
      db.createObjectStore('videos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function store(name: 'words' | 'clips' | 'videos', mode: IDBTransactionMode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function listWords(): Promise<Word[]> {
  const words: Word[] = await request((await store('words')).getAll());
  return words.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putWord(word: Word): Promise<void> {
  await request((await store('words', 'readwrite')).put(word));
}

export async function putWords(words: Word[]): Promise<void> {
  const tx = (await open()).transaction('words', 'readwrite');
  for (const word of words) tx.objectStore('words').put(word);
  await committed(tx);
}

export async function deleteWord(id: string): Promise<void> {
  const clips = await listClips(id);
  const tx = (await open()).transaction(['words', 'clips', 'videos'], 'readwrite');
  tx.objectStore('words').delete(id);
  for (const clip of clips) {
    tx.objectStore('clips').delete(clip.id);
    tx.objectStore('videos').delete(clip.id);
  }
  await committed(tx);
}

/** Newest first. */
export async function listClips(wordId: string): Promise<Clip[]> {
  const clips: Clip[] = await request((await store('clips')).index('wordId').getAll(wordId));
  return clips.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putClip(clip: Clip): Promise<void> {
  await request((await store('clips', 'readwrite')).put(clip));
}

export async function deleteClip(id: string): Promise<void> {
  const tx = (await open()).transaction(['clips', 'videos'], 'readwrite');
  tx.objectStore('clips').delete(id);
  tx.objectStore('videos').delete(id);
  await committed(tx);
}

export async function putVideo(clipId: string, video: Blob): Promise<void> {
  await request((await store('videos', 'readwrite')).put(video, clipId));
}

export async function getVideo(clipId: string): Promise<Blob | undefined> {
  return request((await store('videos')).get(clipId));
}

export async function listAllClips(): Promise<Clip[]> {
  return request((await store('clips')).getAll());
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * A vocabulary book: words with their samples, and optionally the practice
 * attempts and the videos. Landmarks alone are enough to recognise and to
 * practise against; videos make the file much larger.
 */
export async function exportData(opts: { practice: boolean; videos: boolean }): Promise<ExportFile> {
  const words = await listWords();
  const byId = new Map(words.map((w) => [w.id, w]));
  const clips = (await listAllClips()).filter(
    (c) => byId.has(c.wordId) && (opts.practice || clipKind(c, byId.get(c.wordId)!) === 'sample'),
  );
  // Write the kind out so the file does not depend on which clip was the reference.
  const withKind = clips.map((c) => ({ ...c, kind: clipKind(c, byId.get(c.wordId)!) }));
  const videos: NonNullable<ExportFile['videos']> = [];
  if (opts.videos) {
    for (const c of clips) {
      const blob = await getVideo(c.id);
      if (blob) videos.push({ clipId: c.id, dataUrl: await toDataUrl(blob) });
    }
  }
  return {
    format: 'shuwa-practice',
    version: 2,
    exportedAt: new Date().toISOString(),
    words,
    clips: withKind,
    ...(opts.videos ? { videos } : {}),
  };
}

/**
 * Adds a vocabulary book to what is stored. A word whose label already exists
 * is merged into it, so a learner's own "ありがとう" and a signer's end up as one.
 */
export async function importData(data: ExportFile): Promise<{ words: number; clips: number }> {
  const existing = new Map((await listWords()).map((w) => [w.label, w]));
  const wordIds = new Map<string, string>();
  const words: Word[] = [];
  for (const word of data.words) {
    const same = existing.get(word.label);
    if (same) {
      wordIds.set(word.id, same.id);
      if (!same.referenceId && word.referenceId) words.push({ ...same, referenceId: word.referenceId });
    } else {
      wordIds.set(word.id, word.id);
      words.push(word);
      existing.set(word.label, word);
    }
  }
  const imported = new Map(data.words.map((w) => [w.id, w]));
  const clips = data.clips
    .filter((c) => wordIds.has(c.wordId))
    .map((c) => ({ ...c, wordId: wordIds.get(c.wordId)!, kind: clipKind(c, imported.get(c.wordId) ?? null) }));

  const videos = await Promise.all(
    (data.videos ?? []).map(async (v) => [v.clipId, await (await fetch(v.dataUrl)).blob()] as const),
  );

  const tx = (await open()).transaction(['words', 'clips', 'videos'], 'readwrite');
  for (const word of words) tx.objectStore('words').put(word);
  for (const clip of clips) tx.objectStore('clips').put(clip);
  for (const [clipId, blob] of videos) tx.objectStore('videos').put(blob, clipId);
  await committed(tx);
  return { words: data.words.length, clips: clips.length };
}
