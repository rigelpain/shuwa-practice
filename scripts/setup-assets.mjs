// Copies the MediaPipe WASM runtime and downloads the landmark models into
// public/mediapipe so the app runs without loading anything from a CDN.
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';

const MODELS = {
  'hand_landmarker.task': `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'pose_landmarker_lite.task': `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'face_landmarker.task': `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(join(out, 'models'), { recursive: true });
await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(out, 'wasm'), { recursive: true });

for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(out, 'models', name);
  if (await exists(dest)) continue;
  console.log(`Downloading ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}
