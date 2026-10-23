import type { Clip, Word } from './types';

const DB_NAME = 'shuwa-practice';

export interface ExportFile {
  format: 'shuwa-practice';
  version: 1;
  exportedAt: string;
  words: Word[];
  clips: Clip[];
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

/** Words and landmark clips, without videos. This is the training-data format. */
export async function exportData(): Promise<ExportFile> {
  const [words, clips] = await Promise.all([listWords(), (async () => request((await store('clips')).getAll()))()]);
  return { format: 'shuwa-practice', version: 1, exportedAt: new Date().toISOString(), words, clips };
}

export async function importData(data: ExportFile): Promise<void> {
  const tx = (await open()).transaction(['words', 'clips'], 'readwrite');
  for (const word of data.words) tx.objectStore('words').put(word);
  for (const clip of data.clips) tx.objectStore('clips').put(clip);
  await committed(tx);
}
