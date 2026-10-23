/** Bytes received so far, and the file's full size when it is known. */
export type ProgressFn = (loaded: number, total: number | null) => void;

/**
 * Fetches a file while reporting how much has arrived. `expected` is the
 * file's real size. A server that compresses the response (GitHub Pages does)
 * sends a Content-Length for the compressed bytes, which does not match what
 * the body yields, so the header is only trusted for uncompressed responses.
 */
export async function download(
  url: string,
  expected: number | null,
  onProgress: ProgressFn,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} を取得できませんでした（HTTP ${res.status}）`);
  const length = res.headers.get('content-encoding') ? null : Number(res.headers.get('content-length')) || null;
  const total = expected ?? length;

  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    onProgress(whole.length, total ?? whole.length);
    return whole;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** File sizes recorded by `npm run setup`, keyed by file name. Empty if unavailable. */
export async function loadSizes(url: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}
