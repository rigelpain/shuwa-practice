export interface DtwResult {
  /** Mean local cost along the warping path. */
  cost: number;
  /** Matched index pairs [i, j], from the start of both sequences to their ends. */
  path: Array<[number, number]>;
}

/**
 * Dynamic time warping between sequences of length n and m.
 * `band` limits how far the path may stray from the diagonal (scaled to both
 * lengths), in frames, so one clip cannot "wait" indefinitely for the other.
 */
export function dtw(n: number, m: number, dist: (i: number, j: number) => number, band = Infinity): DtwResult {
  if (n === 0 || m === 0) return { cost: Infinity, path: [] };

  // The band must at least span one diagonal step, or rows stop connecting.
  const w = Math.max(band, Math.ceil(Math.max(n, m) / Math.min(n, m)) + 1);
  const cols = m + 1;
  const acc = new Float64Array((n + 1) * cols).fill(Infinity);
  acc[0] = 0;

  for (let i = 1; i <= n; i++) {
    const centre = (i * m) / n;
    const lo = Math.max(1, Math.floor(centre - w));
    const hi = Math.min(m, Math.ceil(centre + w));
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(acc[(i - 1) * cols + j], acc[i * cols + j - 1], acc[(i - 1) * cols + j - 1]);
      if (best !== Infinity) acc[i * cols + j] = best + dist(i - 1, j - 1);
    }
  }

  const path: Array<[number, number]> = [];
  let i = n;
  let j = m;
  for (;;) {
    path.push([i - 1, j - 1]);
    if (i === 1 && j === 1) break;
    const diag = acc[(i - 1) * cols + j - 1];
    const up = acc[(i - 1) * cols + j];
    const left = acc[i * cols + j - 1];
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();
  return { cost: acc[n * cols + m] / path.length, path };
}
