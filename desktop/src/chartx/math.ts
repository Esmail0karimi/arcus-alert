/* Pure chart math for the analysis tools. No DOM, no chart library: easy to test. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};
export type Pt = { time: number; value: number };

const mk = (candles: Candle[], values: (number | undefined)[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v !== undefined && Number.isFinite(v))
      out.push({ time: candles[i].time, value: v });
  }
  return out;
};

export const smaRaw = (
  src: number[],
  period: number,
): (number | undefined)[] => {
  const out: (number | undefined)[] = new Array(src.length).fill(undefined);
  if (period < 1 || src.length < period) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= period) sum -= src[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
};

/** EMA seeded with the SMA of the first `period` values (same as TradingView). */
export const emaRaw = (
  src: (number | undefined)[],
  period: number,
): (number | undefined)[] => {
  const out: (number | undefined)[] = new Array(src.length).fill(undefined);
  const k = 2 / (period + 1);
  let start = src.findIndex((v) => v !== undefined);
  if (start < 0 || src.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) seed += src[i] as number;
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < src.length; i++) {
    prev = (src[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

export const sma = (c: Candle[], period: number): Pt[] =>
  mk(
    c,
    smaRaw(
      c.map((x) => x.close),
      period,
    ),
  );
export const ema = (c: Candle[], period: number): Pt[] =>
  mk(
    c,
    emaRaw(
      c.map((x) => x.close),
      period,
    ),
  );

export const bollinger = (c: Candle[], period = 20, mult = 2) => {
  const closes = c.map((x) => x.close);
  const mid = smaRaw(closes, period);
  const up: (number | undefined)[] = [];
  const lo: (number | undefined)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = mid[i];
    if (m === undefined) {
      up.push(undefined);
      lo.push(undefined);
      continue;
    }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - m) ** 2;
    const sd = Math.sqrt(s / period); // population stddev, as TradingView
    up.push(m + mult * sd);
    lo.push(m - mult * sd);
  }
  return { upper: mk(c, up), middle: mk(c, mid), lower: mk(c, lo) };
};

/** Wilder RSI. */
export const rsi = (c: Candle[], period = 14): Pt[] => {
  const out: (number | undefined)[] = new Array(c.length).fill(undefined);
  if (c.length <= period) return mk(c, out);
  let g = 0,
    l = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i].close - c[i - 1].close;
    if (d >= 0) g += d;
    else l -= d;
  }
  g /= period;
  l /= period;
  const calc = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[period] = calc();
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i].close - c[i - 1].close;
    g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
    l = (l * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = calc();
  }
  return mk(c, out);
};

export const macd = (c: Candle[], fast = 12, slow = 26, signal = 9) => {
  const closes = c.map((x) => x.close);
  const f = emaRaw(closes, fast),
    s = emaRaw(closes, slow);
  const line = closes.map((_, i) =>
    f[i] !== undefined && s[i] !== undefined
      ? (f[i] as number) - (s[i] as number)
      : undefined,
  );
  const sig = emaRaw(line, signal);
  const hist = line.map((v, i) =>
    v !== undefined && sig[i] !== undefined
      ? v - (sig[i] as number)
      : undefined,
  );
  return { macd: mk(c, line), signal: mk(c, sig), hist: mk(c, hist) };
};

/** Heikin Ashi candles (same timestamps as the source). */
export const heikinAshi = (c: Candle[]): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    const close = (x.open + x.high + x.low + x.close) / 4;
    const open =
      i === 0
        ? (x.open + x.close) / 2
        : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({
      time: x.time,
      open,
      close,
      high: Math.max(x.high, open, close),
      low: Math.min(x.low, open, close),
      volume: x.volume,
    });
  }
  return out;
};

export const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Candle interval in seconds (most common positive gap). */
export const barSpan = (c: Candle[], fallback = 900): number => {
  if (c.length < 2) return fallback;
  const counts = new Map<number, number>();
  for (let i = Math.max(1, c.length - 50); i < c.length; i++) {
    const d = c[i].time - c[i - 1].time;
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = fallback,
    n = 0;
  counts.forEach((v, k) => {
    if (v > n) {
      n = v;
      best = k;
    }
  });
  return best;
};

export const fmtPrice = (p: number): string => {
  const a = Math.abs(p);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return p.toLocaleString(undefined, { maximumFractionDigits: d });
};
export const fmtVol = (v: number): string =>
  v >= 1e9
    ? (v / 1e9).toFixed(2) + "B"
    : v >= 1e6
      ? (v / 1e6).toFixed(2) + "M"
      : v >= 1e3
        ? (v / 1e3).toFixed(2) + "K"
        : v.toFixed(2);
export const fmtCountdown = (sec: number): string => {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400),
    h = Math.floor((sec % 86400) / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return d
    ? `${d}d ${p(h)}:${p(m)}:${p(s)}`
    : h
      ? `${p(h)}:${p(m)}:${p(s)}`
      : `${p(m)}:${p(s)}`;
};
