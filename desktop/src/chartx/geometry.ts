/* Time <-> bar-index mapping so drawings can sit in the empty space right of the last candle. */
import type { Candle } from "./math";

/** Fractional bar index for a timestamp (extrapolated outside the data with `span`). */
export const timeToIndex = (c: Candle[], span: number, t: number): number => {
  const n = c.length;
  if (!n) return 0;
  if (t <= c[0].time) return (t - c[0].time) / span;
  if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / span;
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = c[lo].time,
    b = c[hi].time;
  return lo + (b === a ? 0 : (t - a) / (b - a));
};

export const indexToTime = (c: Candle[], span: number, i: number): number => {
  const n = c.length;
  if (!n) return 0;
  if (i <= 0) return c[0].time + i * span;
  if (i >= n - 1) return c[n - 1].time + (i - (n - 1)) * span;
  const lo = Math.floor(i),
    f = i - lo;
  return c[lo].time + f * (c[lo + 1].time - c[lo].time);
};

/** Extend the segment a->b to the right edge `xMax` (for the ray tool). */
export const extendRay = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  xMax: number,
): { x: number; y: number } => {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return b;
  const dir = dx > 0 ? xMax : -xMax;
  const k = (b.y - a.y) / dx;
  return { x: dir, y: a.y + (dir - a.x) * k };
};

export const measure = (
  a: { index: number; price: number },
  b: { index: number; price: number },
) => ({
  dPrice: b.price - a.price,
  pct: a.price ? ((b.price - a.price) / a.price) * 100 : 0,
  bars: Math.round(b.index - a.index),
});
