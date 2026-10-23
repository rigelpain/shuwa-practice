import { afterEach, describe, expect, it, vi } from 'vitest';
import { download, loadSizes } from './download';

function respond(chunks: number[][], init: ResponseInit = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, init)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('download', () => {
  it('reports each chunk and returns the bytes joined in order', async () => {
    respond([[1, 2], [3], [4, 5, 6]], { headers: { 'content-length': '6' } });
    const seen: Array<[number, number | null]> = [];
    const bytes = await download('/file', null, (loaded, total) => seen.push([loaded, total]));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen).toEqual([[0, 6], [2, 6], [3, 6], [6, 6]]);
  });

  it('ignores Content-Length of a compressed response in favour of the recorded size', async () => {
    respond([[1, 2, 3, 4]], { headers: { 'content-length': '2', 'content-encoding': 'gzip' } });
    const totals: Array<number | null> = [];
    await download('/file', 4, (_, total) => totals.push(total));
    expect(totals).toEqual([4, 4]);

    respond([[1, 2, 3, 4]], { headers: { 'content-length': '2', 'content-encoding': 'gzip' } });
    const unknown: Array<number | null> = [];
    await download('/file', null, (_, total) => unknown.push(total));
    expect(unknown.every((t) => t === null)).toBe(true);
  });

  it('fails with the address when the server says no', async () => {
    respond([], { status: 404 });
    await expect(download('/missing.task', null, () => {})).rejects.toThrow('/missing.task');
  });
});

describe('loadSizes', () => {
  it('falls back to no sizes when the file is missing', async () => {
    respond([], { status: 404 });
    expect(await loadSizes('/sizes.json')).toEqual({});
  });
});
