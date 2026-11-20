/* Analysis tab — data + maths (pure, no React). Ports of five skills: Momentum Burst screener, Market Pro, Correlation, Analysis Pro, Analysis.
   Data = Yahoo Finance daily candles only (the browser cannot reach Yahoo's fundamentals / analyst / earnings endpoints). */
import { yfGet } from "./exchanges";

export type Bar = { t: number; d: string; o: number; h: number; l: number; c: number; v: number };
export type Meta = { name?: string; currency?: string; exchange?: string; price?: number; prev?: number; hi52?: number; lo52?: number; dayHi?: number; dayLo?: number; vol?: number };
export type Daily = { bars: Bar[]; meta: Meta };

/* ---------------- data ---------------- */
const NY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const nyDate = (ms: number) => NY_FMT.format(new Date(ms));
const nyHour = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(ms)));
export const ySym = (s: string) => {
  let x = String(s || "").toUpperCase().trim();
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(x)) x = x.replace(".", "-"); // BRK.B -> BRK-B (exchange suffixes like .KS / .HK stay)
  return x;
};
const cache = new Map<string, { at: number; v: Daily }>();
export async function daily(sym: string, range = "2y", signal?: AbortSignal): Promise<Daily> {
  const key = ySym(sym) + "|" + range;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  const j = await yfGet("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ySym(sym)) + "?interval=1d&range=" + range + "&includePrePost=false", signal);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("No data for " + ySym(sym));
  const ts: number[] = r.timestamp || [], q = r.indicators?.quote?.[0] || {};
  const bars: Bar[] = [];
  ts.forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if ([o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x))) bars.push({ t, d: nyDate(t * 1000), o, h, l, c, v: Number(v) || 0 });
  });
  // one bar per date (Yahoo sometimes repeats the live bar)
  const out = bars.filter((b, i) => i === bars.length - 1 || bars[i + 1].d !== b.d);
  if (out.length < 2) throw new Error("No price history for " + ySym(sym));
  const m = r.meta || {};
  const v: Daily = { bars: out, meta: { name: m.longName || m.shortName, currency: m.currency, exchange: m.fullExchangeName || m.exchangeName, price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose, hi52: m.fiftyTwoWeekHigh, lo52: m.fiftyTwoWeekLow, dayHi: m.regularMarketDayHigh, dayLo: m.regularMarketDayLow, vol: m.regularMarketVolume } };
  cache.set(key, { at: Date.now(), v });
  return v;
}
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>, onDone?: (done: number) => void, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && !signal?.aborted) {
        const k = i++;
        out[k] = await fn(items[k]);
        onDone?.(++done);
      }
    }),
  );
  return out;
}

/* ---------------- indicators ---------------- */
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);
export const std = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
export const sma = (a: number[], n: number): number[] => a.map((_, i) => (i + 1 < n ? NaN : mean(a.slice(i + 1 - n, i + 1))));
export const ema = (a: number[], n: number): number[] => {
  const k = 2 / (n + 1), out: number[] = [];
  a.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1] * (1 - k)));
  return out;
};
export const rsi = (c: number[], n = 14): number | null => {
  if (c.length <= n) return null;
  const d = c.slice(1).map((x, i) => x - c[i]);
  const up = mean(d.slice(-n).map((x) => Math.max(0, x))), dn = mean(d.slice(-n).map((x) => Math.max(0, -x)));
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
};
export const macd = (c: number[]) => {
  const e12 = ema(c, 12), e26 = ema(c, 26), line = e12.map((x, i) => x - e26[i]), sig = ema(line, 9);
  return { line: line[line.length - 1], sig: sig[sig.length - 1], hist: line[line.length - 1] - sig[sig.length - 1], prevHist: line.length > 1 ? line[line.length - 2] - sig[sig.length - 2] : NaN };
};
export const atr = (b: Bar[], n = 14) => {
  const tr = b.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - b[i].c), Math.abs(x.l - b[i].c)));
  return mean(tr.slice(-n));
};
export const ret = (c: number[], n: number) => (c.length > n ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);
export const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const closes = (b: Bar[]) => b.map((x) => x.c);

/* ---------------- 1. Stockbee Momentum Burst ---------------- */
export type Gate = "allow" | "block" | "unknown";
export type Burst = {
  symbol: string; state: "ACTIONABLE_DAY1" | "MANUAL_REVIEW" | "WATCHLIST" | "WATCH_ONLY" | "REJECTED"; rating: string; score: number;
  triggers: string[]; gain: number; dollar: number; volRatio: number; loc: number; baseRatio: number; entry: number; stop: number; risk: number;
  comp: Record<string, number>; rejects: string[]; tags: string[]; date: string; age: number; price: number;
};
const rate = (s: number) => (s >= 85 ? "A" : s >= 78 ? "A-" : s >= 65 ? "B" : s >= 50 ? "C" : "D");
const isWeekday = (d: string) => {
  const x = new Date(d + "T12:00:00Z").getUTCDay();
  return x !== 0 && x !== 6;
};
const addDays = (d: string, n: number) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
/** last completed NYSE session by the clock (holidays are handled by comparing with SPY's latest bar) */
export function expectedSession(now = Date.now()): string {
  let d = nyDate(now);
  if (isWeekday(d) && nyHour(now) < 16) d = addDays(d, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}
const sessionsAfter = (from: string, to: string) => {
  let n = 0, d = from;
  while (d < to) {
    d = addDays(d, 1);
    if (isWeekday(d)) n++;
  }
  return n;
};
export function burst(sym: string, all: Bar[], cutoff: string, gate: Gate, minVol: number): Burst {
  const blank = (r: string, extra: Partial<Burst> = {}): Burst => ({ symbol: sym, state: "REJECTED", rating: "-", score: 0, triggers: [], gain: 0, dollar: 0, volRatio: 0, loc: 0, baseRatio: 0, entry: 0, stop: 0, risk: 0, comp: {}, rejects: [r], tags: [], date: "", age: 0, price: 0, ...extra });
  const bars = all.filter((b) => b.d <= cutoff);
  if (!bars.length) return blank("no_completed_price_data");
  const age = sessionsAfter(bars[bars.length - 1].d, cutoff);
  if (age > 0) return blank("stale_price_data", { date: bars[bars.length - 1].d, age });
  if (bars.length < 25) return blank("insufficient_history", { date: bars[bars.length - 1].d });
  const n = bars.length, t = bars[n - 1], p = bars[n - 2], pp = bars[n - 3];
  const rng = (b: Bar) => b.h - b.l;
  const gain = t.c / p.c - 1, dollar = t.c - t.o;
  const avg20 = mean(bars.slice(n - 21, n - 1).map((b) => b.v));
  const volRatio = avg20 ? t.v / avg20 : 0, loc = rng(t) > 0 ? (t.c - t.l) / rng(t) : 0;
  const triggers: string[] = [];
  let strength = 0;
  if (gain >= 0.04 && t.v > p.v && t.v >= minVol) {
    triggers.push("4% breakout");
    strength = Math.max(strength, 10 + clamp((gain - 0.04) / 0.06, 0, 1) * 10);
  }
  if (dollar >= 0.9 && t.v >= minVol) {
    triggers.push("dollar breakout");
    strength = Math.max(strength, 10 + clamp((dollar - 0.9) / 2, 0, 1) * 10);
  }
  if (rng(t) > Math.max(...bars.slice(n - 4, n - 1).map(rng)) && p.c / pp.c - 1 < 0.04 && t.v >= minVol) {
    triggers.push("range expansion");
    strength = Math.max(strength, 10);
  }
  const base: Burst = { ...blank("no_trigger"), date: t.d, age, triggers, gain: gain * 100, dollar, volRatio, loc: loc * 100, price: t.c };
  if (!triggers.length) return base;
  const r5 = mean(bars.slice(n - 6, n - 1).map(rng)), r20 = mean(bars.slice(n - 26, n - 6).map(rng));
  const baseRatio = r20 ? r5 / r20 : 1, entry = t.h, stop = t.l, risk = entry ? ((entry - stop) / entry) * 100 : 0;
  const comp = {
    trigger: +strength.toFixed(1),
    volume: +(clamp((volRatio - 0.5) / 1.5, 0, 1) * 20).toFixed(1),
    base: +(clamp((1.2 - baseRatio) / 0.6, 0, 1) * 20).toFixed(1),
    close: +(clamp((loc - 0.5) / 0.4, 0, 1) * 20).toFixed(1),
    risk: +(clamp((10 - risk) / 7, 0, 1) * 20).toFixed(1),
  };
  const score = +sum(Object.values(comp)).toFixed(1);
  const rejects: string[] = [];
  if (bars[n - 2].c / bars[n - 5].c - 1 >= 0.1) rejects.push("prior_3day_runup");
  for (let i = n - 6; i < n - 1; i++) if (bars[i].c / bars[i - 1].c - 1 <= -0.04) { rejects.push("recent_4pct_breakdown"); break; }
  const rating = rate(score), tags: string[] = [];
  let state: Burst["state"] = rejects.length ? "REJECTED" : rating === "A" || rating === "A-" ? "ACTIONABLE_DAY1" : rating === "B" ? "WATCHLIST" : "WATCH_ONLY";
  if (state !== "REJECTED" && gate !== "allow") {
    state = "MANUAL_REVIEW";
    tags.push("market_gate_not_allowed");
  }
  return { ...base, state, rating, score, comp, baseRatio, entry, stop, risk, rejects, tags };
}

/* ---------------- 3. correlation ---------------- */
export const logRet = (c: number[]) => c.slice(1).map((x, i) => Math.log(x / c[i]));
export const corr = (a: number[], b: number[]) => {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
};
/** daily log returns of several symbols aligned on common dates */
export function alignReturns(data: Record<string, Bar[]>): { dates: string[]; ret: Record<string, number[]>; dropped: string[] } {
  const syms = Object.keys(data).filter((s) => data[s].length > 30);
  const dropped = Object.keys(data).filter((s) => !syms.includes(s));
  if (!syms.length) return { dates: [], ret: {}, dropped };
  let common = new Set(data[syms[0]].map((b) => b.d));
  for (const s of syms.slice(1)) {
    const ds = new Set(data[s].map((b) => b.d));
    common = new Set(Array.from(common).filter((d) => ds.has(d)));
  }
  const dates = Array.from(common).sort();
  const out: Record<string, number[]> = {};
  for (const s of syms) {
    const m = new Map(data[s].map((b) => [b.d, b.c]));
    out[s] = logRet(dates.map((d) => m.get(d) as number));
  }
  return { dates: dates.slice(1), ret: out, dropped };
}
export const rolling = (a: number[], b: number[], w: number) => a.map((_, i) => (i + 1 < w ? NaN : corr(a.slice(i + 1 - w, i + 1), b.slice(i + 1 - w, i + 1)))).filter((x) => Number.isFinite(x));
export function pairStats(a: number[], b: number[], ca: number[], cb: number[]) {
  const c = corr(a, b), ma = mean(a), mb = mean(b);
  let cov = 0, va = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
  }
  const beta = va ? cov / va : NaN, r60 = rolling(a, b, 60);
  const n = Math.min(ca.length, cb.length), spread = Array.from({ length: n }, (_, i) => Math.log(ca[ca.length - n + i] / cb[cb.length - n + i]));
  const sd = std(spread);
  return { corr: c, beta, r2: c * c, r60mean: mean(r60), r60std: std(r60), r60min: r60.length ? Math.min(...r60) : NaN, r60max: r60.length ? Math.max(...r60) : NaN, spreadZ: sd ? (spread[spread.length - 1] - mean(spread)) / sd : NaN, n: a.length };
}
export function realized(a: number[], b: number[], condition: number[] = a) {
  const wins = [20, 60, 120].map((w) => {
    const r = rolling(a, b, w);
    return { w, now: r[r.length - 1], mean: mean(r), min: r.length ? Math.min(...r) : NaN, max: r.length ? Math.max(...r) : NaN, std: std(r) };
  });
  const absq = (p: number) => {
    const s = condition.map(Math.abs).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const q75 = absq(0.75), q25 = absq(0.25);
  const regs: [string, (x: number) => boolean][] = [
    ["All days", () => true], ["Up days", (x) => x > 0], ["Down days", (x) => x < 0],
    ["High vol (top 25%)", (x) => Math.abs(x) > q75], ["Low vol (bottom 25%)", (x) => Math.abs(x) < q25], ["Large drawdown (< -2%)", (x) => x < -0.02],
  ];
  const regimes = regs.map(([name, f]) => {
    const idx = condition.map((x, i) => (f(x) ? i : -1)).filter((i) => i >= 0);
    return { name, days: idx.length, corr: idx.length >= 20 ? corr(idx.map((i) => a[i]), idx.map((i) => b[i])) : NaN };
  });
  return { wins, regimes };
}
export function cluster(syms: string[], R: Record<string, number[]>, thr = 0.6) {
  const m: Record<string, Record<string, number>> = {};
  for (const x of syms) {
    m[x] = {};
    for (const y of syms) m[x][y] = x === y ? 1 : corr(R[x], R[y]);
  }
  // average-linkage agglomeration while the best average correlation >= thr
  let groups: string[][] = syms.map((s) => [s]);
  for (;;) {
    let best = -2, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const v = mean(groups[i].flatMap((x) => groups[j].map((y) => m[x][y])));
        if (v > best) { best = v; bi = i; bj = j; }
      }
    if (best < thr || bi < 0) break;
    groups = groups.filter((_, k) => k !== bi && k !== bj).concat([groups[bi].concat(groups[bj])]);
  }
  groups.sort((a, b) => b.length - a.length);
  const order = groups.flat();
  const pairs: { a: string; b: string; c: number }[] = [];
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) pairs.push({ a: syms[i], b: syms[j], c: m[syms[i]][syms[j]] });
  pairs.sort((x, y) => y.c - x.c);
  return { m, order, groups: groups.map((g) => ({ members: g, avg: g.length > 1 ? mean(g.flatMap((x, i) => g.slice(i + 1).map((y) => m[x][y]))) : NaN })), top: pairs.slice(0, 5), bottom: pairs.slice(-5).reverse() };
}

/* ---------------- 4. Analysis Pro (price-based components only) ---------------- */
export type Comp = { score: number; weight: number; detail: string };
export type Pro = { ticker: string; crypto: boolean; name?: string; price: number; asof: string; lean: "FAVORABLE" | "NEUTRAL" | "CAUTIOUS"; confidence: number; score: number; coverage: number; comps: Record<string, Comp>; missing: string[]; caveats: string[] };
export type Ctx = { spy: Bar[]; qqq: Bar[]; vix: Bar[]; vix3m: Bar[] | null; gld: Bar[] | null; tlt: Bar[] | null; uup: Bar[] | null; btc: Bar[] | null };
export async function loadCtx(signal?: AbortSignal): Promise<Ctx> {
  const g = async (s: string, need = false) => {
    try {
      return (await daily(s, "1y", signal)).bars;
    } catch (e) {
      if (need) throw e;
      return null;
    }
  };
  const [spy, qqq, vix, vix3m, gld, tlt, uup, btc] = await Promise.all([g("SPY", true), g("QQQ", true), g("^VIX", true), g("^VIX3M"), g("GLD"), g("TLT"), g("UUP"), g("BTC-USD")]);
  return { spy: spy!, qqq: qqq!, vix: vix!, vix3m, gld, tlt, uup, btc };
}
const lastC = (b: Bar[]) => b[b.length - 1].c;
const above50 = (b: Bar[]) => lastC(b) > mean(closes(b).slice(-50));
export function marketCtx(x: Ctx) {
  const v = lastC(x.vix);
  let s = (above50(x.spy) ? 0.4 : -0.4) + (above50(x.qqq) ? 0.3 : -0.3) + (v < 15 ? 0.3 : v >= 20 ? -0.2 : 0);
  if (v > 30) s -= 0.4;
  const th = { gld: 0.02, tlt: 0.01, uup: 0.01 } as const;
  const moves = (["gld", "tlt", "uup"] as const).map((k) => (x[k] ? ret(closes(x[k]!), 5) : null));
  const riskOff = moves.every((m, i) => m != null && m >= th[(["gld", "tlt", "uup"] as const)[i]]);
  return { vix: v, spy50: above50(x.spy), qqq50: above50(x.qqq), score: clamp(s), regime: v > 30 ? "stress" : v >= 20 ? "volatile" : "calm", riskOff };
}
const CRYPTO_CAT: Record<string, [string, number]> = {
  "BTC-USD": ["Store of Value", 0.2], "ETH-USD": ["Smart Contract L1", 0], "BNB-USD": ["Exchange / L1", 0], "SOL-USD": ["Smart Contract L1", 0], "XRP-USD": ["Payment", 0], "ADA-USD": ["Smart Contract L1", 0],
  "DOGE-USD": ["Meme", -0.4], "AVAX-USD": ["Smart Contract L1", 0], "DOT-USD": ["Interoperability", -0.05], "MATIC-USD": ["L2 / Scaling", -0.1], "LINK-USD": ["Oracle", 0], "ATOM-USD": ["Interoperability", -0.05],
  "UNI-USD": ["DeFi", -0.1], "LTC-USD": ["Payment", 0], "BCH-USD": ["Payment", 0], "XLM-USD": ["Payment", 0], "ALGO-USD": ["Smart Contract L1", 0], "VET-USD": ["Supply Chain", -0.1], "FIL-USD": ["Storage", -0.1], "NEAR-USD": ["Smart Contract L1", 0],
};
export function pro(sym: string, d: Daily, x: Ctx): Pro {
  const T = ySym(sym), crypto = /-USD$/.test(T), b = d.bars, c = closes(b), price = c[c.length - 1];
  const m = marketCtx(x), comps: Record<string, Comp> = {}, miss: string[] = [], cav: string[] = [];
  const r = rsi(c);
  const hi = Math.max(...b.slice(-252).map((z) => z.h)), lo = Math.min(...b.slice(-252).map((z) => z.l)), pos = hi > lo ? (price - lo) / (hi - lo) : 0.5;
  if (crypto) {
    const cat = CRYPTO_CAT[T] || ["Other", -0.1];
    comps.category = { score: cat[1], weight: 10, detail: cat[0] };
    if (x.btc && T !== "BTC-USD") {
      const a = logRet(c).slice(-30), bb = logRet(closes(x.btc)).slice(-30), cc = corr(a, bb);
      if (Number.isFinite(cc)) comps.btc_correlation = { score: 0, weight: 10, detail: `30d correlation with BTC ${cc.toFixed(2)}` };
    }
    let ms = r == null ? 0 : r > 70 ? -0.5 : r < 30 ? 0.3 : r >= 45 && r <= 65 ? 0.3 : 0;
    const r30 = ret(c, 30) ?? 0;
    ms += clamp(r30 / 0.3) * 0.5;
    comps.momentum = { score: clamp(ms), weight: 40, detail: `RSI ${r == null ? "n/a" : r.toFixed(0)}, ${(pos * 100).toFixed(0)}% of 52w range, 30d ${(r30 * 100).toFixed(1)}%` };
    comps.market_context = { score: m.score, weight: 20, detail: `VIX ${m.vix.toFixed(1)} (${m.regime}), SPY>50dma ${m.spy50}` };
    miss.push("market_cap");
    cav.push("Crypto is highly volatile and trades 24/7; scores are short-horizon heuristics.");
  } else {
    const parts: number[] = [], det: string[] = [];
    if (r != null) { parts.push(r > 70 ? -0.5 : r < 30 ? 0.3 : r >= 45 && r <= 65 ? 0.3 : 0); det.push(`RSI ${r.toFixed(0)}`); }
    parts.push(pos >= 0.4 && pos <= 0.9 ? 0.2 : pos > 0.97 ? -0.2 : 0);
    det.push(`${(pos * 100).toFixed(0)}% of 52w range`);
    const rs = ret(c, 63), rm = ret(closes(x.spy), 63);
    if (rs != null && rm != null) { parts.push(clamp((rs - rm) / 0.1)); det.push(`3m vs SPY ${((rs - rm) * 100).toFixed(1)}pp`); }
    const v5 = mean(b.slice(-5).map((z) => z.v)), v20 = mean(b.slice(-20).map((z) => z.v));
    if (v20 > 0) det.push(`5d/20d volume ${(v5 / v20).toFixed(2)}x`);
    comps.momentum = { score: clamp(mean(parts)), weight: 15, detail: det.join(", ") };
    comps.market = { score: m.score, weight: 10, detail: `VIX ${m.vix.toFixed(1)} (${m.regime}), SPY>50dma ${m.spy50}, QQQ>50dma ${m.qqq50}` };
    if (x.vix3m) {
      const ratio = m.vix / lastC(x.vix3m);
      comps.sentiment = { score: ratio < 0.9 ? 0.3 : ratio > 1 ? -0.5 : 0, weight: 10, detail: `VIX/VIX3M ${ratio.toFixed(2)} (${ratio < 1 ? "contango" : "backwardation"})` };
    }
    miss.push("earnings", "fundamentals", "analyst", "historical", "sector", "sentiment: Fear&Greed/short interest/put-call");
  }
  const all = crypto ? { market_cap: 20, category: 10, btc_correlation: 10, momentum: 40, market_context: 20 } : { earnings: 30, fundamentals: 20, analyst: 20, historical: 10, market: 10, sector: 15, momentum: 15, sentiment: 10 };
  const tw = sum(Object.values(comps).map((z) => z.weight)), full = sum(Object.values(all));
  const score = tw ? sum(Object.values(comps).map((z) => z.score * z.weight)) / tw : 0;
  const lean = score >= 0.25 ? "FAVORABLE" : score <= -0.25 ? "CAUTIOUS" : "NEUTRAL";
  let conf = lean === "NEUTRAL" ? 50 : Math.min(100, Math.abs(score) * 150);
  const coverage = tw / full;
  if (r != null && r > 70 && price >= 0.95 * hi) { cav.push(`Overbought (RSI ${r.toFixed(0)}) near the 52-week high: higher-risk entry (confidence -20%).`); conf *= 0.8; }
  if (m.vix > 30) { cav.push(`High VIX (${m.vix.toFixed(1)}): market stress (confidence -20%).`); conf *= 0.8; }
  if (m.riskOff) { cav.push("Risk-off signal: gold, treasuries and USD are all rising together (confidence -30%)."); conf *= 0.7; }
  conf *= 0.5 + 0.5 * coverage;
  cav.push(`Only ${(coverage * 100).toFixed(0)}% of the model's weight could be computed from price data (confidence scaled down). Not available in the browser: ${miss.join(", ")}.`);
  return { ticker: T, crypto, name: d.meta.name, price, asof: b[b.length - 1].d, lean, confidence: Math.round(conf), score: +score.toFixed(3), coverage, comps, missing: miss, caveats: cav };
}

/* ---------------- 5. Analysis (technical review + manual fundamentals) ---------------- */
export type Level = { price: number; touches: number };
export function levels(b: Bar[], k = 5): { sup: Level[]; res: Level[] } {
  const piv: { p: number; hi: boolean }[] = [];
  const s = b.slice(-260);
  for (let i = k; i < s.length - k; i++) {
    const w = s.slice(i - k, i + k + 1);
    if (s[i].h === Math.max(...w.map((z) => z.h))) piv.push({ p: s[i].h, hi: true });
    if (s[i].l === Math.min(...w.map((z) => z.l))) piv.push({ p: s[i].l, hi: false });
  }
  const price = b[b.length - 1].c, groups: Level[] = [];
  for (const q of piv.map((x) => x.p).sort((a, c) => a - c)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(q - g.price) / g.price < 0.015) {
      g.price = (g.price * g.touches + q) / (g.touches + 1);
      g.touches++;
    } else groups.push({ price: q, touches: 1 });
  }
  return { sup: groups.filter((g) => g.price < price).sort((a, c) => c.price - a.price).slice(0, 3), res: groups.filter((g) => g.price > price).sort((a, c) => a.price - c.price).slice(0, 3) };
}
export type Tech = {
  price: number; asof: string; sma50: number | null; sma200: number | null; trend: string; cross: string | null; rsi: number | null; macd: ReturnType<typeof macd>; hi52: number; lo52: number; pos: number;
  sup: Level[]; res: Level[]; patterns: string[]; atrPct: number; vol: number; maxDD: number; r1m: number | null; r3m: number | null; r1y: number | null; assessment: "Favorable" | "Mixed" | "Cautious"; risk: "Low" | "Medium" | "High"; bull: string[]; bear: string[]; risks: string[];
};
export function tech(b: Bar[]): Tech {
  const c = closes(b), price = c[c.length - 1];
  const s50a = sma(c, 50), s200a = sma(c, 200), s50 = Number.isFinite(s50a[s50a.length - 1]) ? s50a[s50a.length - 1] : null, s200 = Number.isFinite(s200a[s200a.length - 1]) ? s200a[s200a.length - 1] : null;
  let cross: string | null = null;
  for (let i = c.length - 1; i > Math.max(1, c.length - 31); i--) {
    if (!Number.isFinite(s200a[i]) || !Number.isFinite(s200a[i - 1])) break;
    if (s50a[i - 1] <= s200a[i - 1] && s50a[i] > s200a[i]) { cross = "golden cross (50DMA over 200DMA) in the last 30 sessions"; break; }
    if (s50a[i - 1] >= s200a[i - 1] && s50a[i] < s200a[i]) { cross = "death cross (50DMA under 200DMA) in the last 30 sessions"; break; }
  }
  const trend = s50 != null && s200 != null ? (price > s50 && s50 > s200 ? "Uptrend (price > 50DMA > 200DMA)" : price < s50 && s50 < s200 ? "Downtrend (price < 50DMA < 200DMA)" : "Mixed / transitioning") : s50 != null ? (price > s50 ? "Above 50DMA" : "Below 50DMA") : "Not enough history";
  const y = b.slice(-252), hi52 = Math.max(...y.map((z) => z.h)), lo52 = Math.min(...y.map((z) => z.l)), pos = hi52 > lo52 ? (price - lo52) / (hi52 - lo52) : 0.5;
  const lv = levels(b), r = rsi(c), mc = macd(c), a = atr(b), lr = logRet(c.slice(-253)), vol = std(lr) * Math.sqrt(252);
  let peak = -Infinity, maxDD = 0;
  for (const z of y) { peak = Math.max(peak, z.c); maxDD = Math.min(maxDD, z.c / peak - 1); }
  const patterns: string[] = [], hh = Math.max(...b.slice(-21, -1).map((z) => z.h)), v20 = mean(b.slice(-21, -1).map((z) => z.v)), last = b[b.length - 1];
  if (last.c > hh) patterns.push(last.v >= 1.5 * v20 ? "Breakout above the 20-day high on strong volume (≥1.5×)" : "Close above the 20-day high but volume is not strong (unconfirmed)");
  if (pos > 0.95) patterns.push("Trading within 5% of the 52-week high");
  if (pos < 0.05) patterns.push("Trading within 5% of the 52-week low");
  const pv = (hi: boolean) => {
    const k = 5, s = b.slice(-160), o: number[] = [];
    for (let i = k; i < s.length - k; i++) {
      const w = s.slice(i - k, i + k + 1).map((z) => (hi ? z.h : z.l));
      if ((hi ? s[i].h : s[i].l) === (hi ? Math.max(...w) : Math.min(...w))) o.push(hi ? s[i].h : s[i].l);
    }
    return o.slice(-2);
  };
  const ph = pv(true), pl = pv(false);
  if (ph.length === 2 && Math.abs(ph[1] - ph[0]) / ph[0] < 0.02 && price < Math.min(...ph)) patterns.push("Possible double top (two similar highs, price now below them) — needs a break of the middle low to confirm");
  if (pl.length === 2 && Math.abs(pl[1] - pl[0]) / pl[0] < 0.02 && price > Math.max(...pl)) patterns.push("Possible double bottom (two similar lows, price now above them) — needs a break of the middle high to confirm");
  if (!patterns.length) patterns.push("No clear classic pattern detected");
  // scoring for the assessment line (describes how the numbers look, not a recommendation)
  let pts = 0;
  if (s50 != null) pts += price > s50 ? 1 : -1;
  if (s200 != null) pts += price > s200 ? 1 : -1;
  if (s50 != null && s200 != null) pts += s50 > s200 ? 1 : -1;
  if (r != null) pts += r > 70 ? -1 : r < 30 ? 0 : r >= 45 ? 1 : 0;
  pts += mc.hist > 0 ? 1 : -1;
  const assessment = pts >= 3 ? "Favorable" : pts <= -2 ? "Cautious" : "Mixed";
  const risk = vol > 0.6 || maxDD < -0.4 ? "High" : vol > 0.3 || maxDD < -0.2 ? "Medium" : "Low";
  const bull: string[] = [], bear: string[] = [], risks: string[] = [];
  if (s50 != null && price > s50) bull.push("Price holds above the 50-day average.");
  if (s200 != null && price > s200) bull.push("Price is above the 200-day average (long-term trend up).");
  if (mc.hist > 0) bull.push("MACD histogram is positive (momentum improving).");
  if (lv.res[0]) bull.push(`A close above resistance near ${lv.res[0].price.toFixed(2)} (volume-confirmed) would open room higher.`);
  if (s50 != null && price < s50) bear.push("Price is below the 50-day average.");
  if (s200 != null && price < s200) bear.push("Price is below the 200-day average (long-term trend down).");
  if (mc.hist < 0) bear.push("MACD histogram is negative (momentum fading).");
  if (lv.sup[0]) bear.push(`A close below support near ${lv.sup[0].price.toFixed(2)} would weaken the structure.`);
  if (r != null && r > 70) risks.push(`Overbought: RSI ${r.toFixed(0)}.`);
  if (r != null && r < 30) risks.push(`Oversold: RSI ${r.toFixed(0)} (can stay oversold in downtrends).`);
  risks.push(`Volatility ${(vol * 100).toFixed(0)}% annualised; worst peak-to-trough in the last year ${(maxDD * 100).toFixed(0)}%.`);
  risks.push(`Average daily range (ATR14) is ${((a / price) * 100).toFixed(1)}% of price — size positions for that.`);
  if (!bull.length) bull.push("No strong technical support for the upside case right now.");
  if (!bear.length) bear.push("No strong technical sign of weakness right now.");
  return { price, asof: b[b.length - 1].d, sma50: s50, sma200: s200, trend, cross, rsi: r, macd: mc, hi52, lo52, pos, sup: lv.sup, res: lv.res, patterns, atrPct: (a / price) * 100, vol: vol * 100, maxDD: maxDD * 100, r1m: ret(c, 21), r3m: ret(c, 63), r1y: ret(c, 252), assessment, risk, bull, bear, risks };
}
export type Fund = { pe?: number; pb?: number; roe?: number; growth?: number; margin?: number; de?: number; indPe?: number };
export function fundRows(f: Fund): { k: string; v: string; a: string; tone: "g" | "w" | "r" | "" }[] {
  const o: { k: string; v: string; a: string; tone: "g" | "w" | "r" | "" }[] = [];
  if (f.pe != null) o.push({ k: "P/E", v: f.pe.toFixed(1) + (f.indPe ? ` (industry ${f.indPe})` : ""), a: f.indPe ? (f.pe < f.indPe * 0.85 ? "Cheaper than industry" : f.pe > f.indPe * 1.15 ? "Pricier than industry" : "In line with industry") : f.pe < 15 ? "Cheap-ish" : f.pe > 25 ? "Expensive-ish" : "Fair", tone: f.pe > 25 ? "w" : f.pe < 15 ? "g" : "" });
  if (f.pb != null) o.push({ k: "P/B", v: f.pb.toFixed(2), a: f.pb < 1 ? "Potential value" : f.pb > 3 ? "Growth priced in" : "Fair", tone: f.pb < 1 ? "g" : f.pb > 3 ? "w" : "" });
  if (f.roe != null) o.push({ k: "ROE", v: f.roe + "%", a: f.roe > 15 ? "Good" : f.roe < 8 ? "Weak" : "Average", tone: f.roe > 15 ? "g" : f.roe < 8 ? "r" : "" });
  if (f.growth != null) o.push({ k: "Revenue growth", v: f.growth + "%", a: f.growth > 10 ? "Strong demand" : f.growth < 0 ? "Shrinking" : "Moderate", tone: f.growth > 10 ? "g" : f.growth < 0 ? "r" : "" });
  if (f.margin != null) o.push({ k: "Net margin", v: f.margin + "%", a: f.margin > 10 ? "Healthy" : f.margin < 3 ? "Thin" : "Average", tone: f.margin > 10 ? "g" : f.margin < 3 ? "r" : "" });
  if (f.de != null) o.push({ k: "Debt/Equity", v: f.de.toFixed(2), a: f.de < 1 ? "Conservative" : f.de > 2 ? "Heavily levered" : "Moderate", tone: f.de < 1 ? "g" : f.de > 2 ? "r" : "w" });
  return o;
}
