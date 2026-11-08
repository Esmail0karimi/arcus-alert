/* Accumulation / distribution / compression-box detector (closed candles only).
   Heuristic, price-and-volume based (Wyckoff-style reading) — it flags candidates to look at, it does not prove anything. */
import type { QCandle } from "./qfex";

export type ZoneKind = "acc" | "dist" | "box";
export type ZoneHit = {
  symbol: string; base: string; ex: string; market: string; tf: string;
  kinds: ZoneKind[]; lo: number; hi: number; bars: number; pos: number; /* 0..1 position of price inside the box */
  price: number; prior: number; /* % move before the range (signed) */
  tilt: number; /* volume on up candles / volume on down candles inside the range */
  squeeze: number; /* recent ATR / earlier ATR (lower = tighter) */
  score: number; lastTime: number;
};

const tr = (r: QCandle[], i: number) => Math.max(r[i].high - r[i].low, i ? Math.abs(r[i].high - r[i - 1].close) : 0, i ? Math.abs(r[i].low - r[i - 1].close) : 0);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function detectZone(rows: QCandle[]): Omit<ZoneHit, "symbol" | "base" | "ex" | "market" | "tf" | "lastTime"> | null {
  const n = rows.length;
  if (n < 90) return null;
  const trs = rows.map((_, i) => tr(rows, i));
  const atr = mean(trs.slice(-50));
  if (!(atr > 0)) return null;
  const last = rows[n - 1];
  // longest recent window that behaves like a sideways box
  let best: { w: number; lo: number; hi: number } | null = null;
  for (const w of [20, 30, 40, 60]) {
    const seg = rows.slice(n - w);
    const hi = Math.max(...seg.map((r) => r.high)), lo = Math.min(...seg.map((r) => r.low)), h = hi - lo;
    const drift = Math.abs(seg[w - 1].close - seg[0].close);
    if (h <= atr * 6 && drift <= h * 0.4 && last.close >= lo && last.close <= hi) best = { w, lo, hi };
  }
  if (!best) return null;
  const { w, lo, hi } = best, h = hi - lo, seg = rows.slice(n - w);
  const pos = (last.close - lo) / (h || 1);
  const before = rows.slice(Math.max(0, n - w - 50), n - w);
  const pHi = Math.max(...before.map((r) => r.high)), pLo = Math.min(...before.map((r) => r.low));
  const startC = seg[0].open;
  const down = (pHi - startC) / pHi, up = (startC - pLo) / (pLo || 1);
  const prior = up > down ? up * 100 : -down * 100; // + = came from an advance, − = came from a decline
  let vUp = 0, vDn = 0;
  seg.forEach((r) => (r.close >= r.open ? (vUp += r.volume) : (vDn += r.volume)));
  const tilt = vDn > 0 ? vUp / vDn : vUp > 0 ? 9 : 1;
  const half = Math.floor(w / 2), a = seg.slice(0, half), b = seg.slice(half);
  const lowsUp = Math.min(...b.map((r) => r.low)) >= Math.min(...a.map((r) => r.low)) - h * 0.08;
  const highsFlat = Math.max(...b.map((r) => r.high)) <= Math.max(...a.map((r) => r.high)) + h * 0.08;
  const squeeze = mean(trs.slice(-10)) / (mean(trs.slice(-60, -10)) || 1);
  const kinds: ZoneKind[] = [];
  let score = 0;
  if (down >= 0.12 && down > up && pos <= 0.65 && tilt >= 1.0 && lowsUp) { kinds.push("acc"); score = 40 + Math.min(25, down * 100 * 0.6) + Math.min(20, (tilt - 1) * 25) + (pos <= 0.4 ? 10 : 0); }
  if (up >= 0.12 && up > down && pos >= 0.35 && tilt <= 1.0 && highsFlat) { kinds.push("dist"); score = Math.max(score, 40 + Math.min(25, up * 100 * 0.6) + Math.min(20, (1 / Math.max(tilt, 0.1) - 1) * 25) + (pos >= 0.6 ? 10 : 0)); }
  if (squeeze <= 0.7 && h <= atr * 4.5) { kinds.push("box"); score = Math.max(score, 35 + Math.min(40, (1 - squeeze) * 80) + (w >= 30 ? 10 : 0)); }
  if (!kinds.length) return null;
  return { kinds, lo, hi, bars: w, pos, price: last.close, prior, tilt, squeeze, score: Math.round(Math.min(100, score)) };
}
