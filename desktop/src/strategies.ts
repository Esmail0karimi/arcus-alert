/* Momentum strategies for the Agent tab. Each one is a plain checklist run on a coin's candles; a coin "matches" when every
   condition is true right now. Entry/stop/targets are sized from ATR so the risk is always stated. */
import { Bi, TF_SEC, atrOf, ema } from "./agent";
import type { QCandle } from "./qfex";

export type Side = "long" | "short";
export type Match = { sid: string; side: Side; q: number; why: Bi[]; entry: number; stop: number; t: [number, number, number]; riskPct: number };
export type Strategy = { id: string; name: Bi; blurb: Bi; works: Bi; fails: Bi; cross?: boolean };
export type Hit = { base: string; price: number; matches: Match[] };

const b = (en: string, fa: string): Bi => ({ en, fa });
export const STRATEGIES: Strategy[] = [
  { id: "brk", name: b("Momentum breakout", "شکست مومنتومی"), blurb: b("Price pushes above the 20-candle high (or below the low) with trend, MACD, RSI and volume all agreeing.", "قیمت سقف ۲۰ کندل اخیر را (یا کف را) می‌شکند و روند، MACD، RSI و حجم همگی موافق‌اند."), works: b("Works best when the market is trending and volume expands on the break.", "وقتی بازار روند دارد و حجم همراه شکست زیاد می‌شود بهتر جواب می‌دهد."), fails: b("Fails in choppy ranges: price falls back inside the range (false breakout).", "در بازار رنج و پرنوسان شکست‌ها فیک می‌شوند و قیمت به داخل رنج برمی‌گردد.") },
  { id: "pull", name: b("Trend pullback", "پولبک در روند"), blurb: b("A healthy trend dips back to the 20 EMA, RSI cools down, and the candle turns back in the trend's direction.", "روندی سالم به EMA20 برمی‌گردد، RSI خنک می‌شود و کندل دوباره در جهت روند برمی‌گردد."), works: b("Gives a tighter stop than chasing breakouts, and a better risk-to-reward.", "نسبت به دنبال‌کردن شکست، حدضرر کوتاه‌تر و نسبت ریسک به سود بهتری می‌دهد."), fails: b("Fails when the pullback is really the start of a trend reversal (price closes under the 50 EMA).", "وقتی پولبک در واقع شروع برگشت روند باشد (بسته‌شدن زیر EMA50) جواب نمی‌دهد.") },
  { id: "sqz", name: b("Volatility squeeze breakout", "شکست فشردگی نوسان"), blurb: b("Bollinger Bands were unusually tight, then price breaks out of them with volume.", "باندهای بولینگر به‌طور غیرعادی فشرده بوده‌اند و حالا قیمت با حجم از آن‌ها خارج می‌شود."), works: b("Quiet markets tend to be followed by fast moves; early entries get big R multiples.", "بعد از آرامش معمولاً حرکت سریع می‌آید؛ ورود زودهنگام نسبت سود به ریسک بالایی می‌دهد."), fails: b("Direction of the first break can be a fake-out; wait for the close.", "جهت اولین شکست می‌تواند فریب باشد؛ منتظر بسته‌شدن کندل بمان.") },
  { id: "ign", name: b("Momentum ignition", "جرقه‌ی مومنتوم"), blurb: b("MACD histogram has just flipped, RSI is crossing 55 (or 45), and price is on the right side of the 20 EMA.", "هیستوگرام MACD تازه جهت عوض کرده، RSI از ۵۵ (یا ۴۵) رد می‌شود و قیمت سمت درست EMA20 است."), works: b("Catches a move early, before it becomes obvious.", "حرکت را زود، پیش از آنکه آشکار شود می‌گیرد."), fails: b("Many early signals fade; it needs the stop to be respected.", "بسیاری از سیگنال‌های زودهنگام محو می‌شوند؛ باید به حدضرر پایبند بود.") },
  { id: "thr", name: b("Volume thrust candle", "کندل انفجاری با حجم"), blurb: b("One big candle (1.5× ATR or more), closing near its extreme, on at least twice the normal volume.", "یک کندل بزرگ (۱.۵ برابر ATR یا بیشتر) که نزدیک اکسترمم خود بسته می‌شود و حجمش حداقل دو برابر معمول است."), works: b("Shows real money stepping in; good for news-driven or fresh-trend moves.", "ورود پول واقعی را نشان می‌دهد؛ برای حرکت‌های خبری یا شروع روند خوب است."), fails: b("A late entry after a huge candle has a poor risk-to-reward; wait for a small pullback if possible.", "ورود دیرهنگام بعد از کندل خیلی بزرگ نسبت ریسک به سود ضعیفی دارد؛ در صورت امکان منتظر پولبک کوچک بمان.") },
  { id: "rs", name: b("Relative-strength leaders", "رهبران قدرت نسبی"), cross: true, blurb: b("Among all scanned coins, the strongest 20-candle gainers that are also in a clean uptrend (and the weakest ones in a downtrend for shorts).", "در میان همه‌ی ارزهای اسکن‌شده، قوی‌ترین رشد ۲۰ کندل اخیر که روند صعودی تمیز هم دارند (و ضعیف‌ترین‌ها در روند نزولی برای فروش)."), works: b("Momentum traders favour what is already outperforming; leaders tend to keep leading.", "تریدرهای مومنتوم سراغ چیزی می‌روند که از قبل بهتر از بازار عمل می‌کند؛ رهبران معمولاً رهبر می‌مانند."), fails: b("In a broad market sell-off even leaders drop; check Bitcoin first.", "در ریزش کلی بازار حتی رهبران هم می‌ریزند؛ اول بیت‌کوین را ببین.") },
];

const rsiSeries = (c: number[], n = 14) => {
  const out: number[] = Array(c.length).fill(50);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    d >= 0 ? (g += d) : (l -= d);
  }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type Ctx = ReturnType<typeof ctxOf>;
export function ctxOf(rows: QCandle[], tf: string, nowMs = Date.now()) {
  const span = TF_SEC[tf];
  if (!span || rows.length < 60) return null;
  const last = rows[rows.length - 1];
  const forming = (last.time + span) * 1000 > nowMs && last.time * 1000 <= nowMs;
  const cs = forming ? rows.slice(0, -1) : rows;
  const cur = forming ? last : cs[cs.length - 1];
  const cl = cs.map((x) => x.close);
  const e20 = ema(cl, 20), e50 = ema(cl, 50), e12 = ema(cl, 12), e26 = ema(cl, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const sg = ema(macd, 9);
  const hist = macd.map((v, i) => v - sg[i]);
  const rsiS = rsiSeries(cl);
  const atr = atrOf(cs) || cur.close * 0.005;
  const n = cl.length;
  const sma20 = cl.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const sd = Math.sqrt(cl.slice(-20).reduce((s, v) => s + (v - sma20) ** 2, 0) / 20);
  const widths: number[] = [];
  for (let i = Math.max(20, n - 100); i <= n; i++) {
    const w = cl.slice(i - 20, i);
    const m = w.reduce((s, v) => s + v, 0) / 20;
    const d = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / 20);
    widths.push((4 * d) / (m || 1));
  }
  const rank = (v: number) => widths.filter((w) => w <= v).length / widths.length;
  const avgVol = cs.slice(-20).reduce((s, x) => s + (x.volume || 0), 0) / 20;
  const frac = forming ? clamp((nowMs / 1000 - cur.time) / span, 0.08, 1) : 1;
  const volPace = avgVol > 0 && cur.volume ? cur.volume / frac / avgVol : 1;
  const range = Math.max(cur.high - cur.low, 1e-12);
  return {
    cs, cur, forming, price: cur.close, atr, n,
    e20: e20[n - 1], e50: e50[n - 1], e50b: e50[Math.max(0, n - 6)],
    hist: hist[n - 1], histP: hist.slice(-4, -1), rsi: rsiS[n - 1], rsiP: rsiS.slice(-5, -1),
    hh20: Math.max(...cs.slice(-20).map((x) => x.high)), ll20: Math.min(...cs.slice(-20).map((x) => x.low)),
    sma20, up: sma20 + 2 * sd, dn: sma20 - 2 * sd, wRank: Math.min(...widths.slice(-7, -1).map(rank)),
    volPace, rangeAtr: range / atr, body: Math.abs(cur.close - cur.open) / range, closePos: (cur.close - cur.low) / range,
    roc20: cl[n - 1] / (cl[Math.max(0, n - 21)] || cl[n - 1]) - 1,
    lowLast5: Math.min(cur.low, ...cs.slice(-4).map((x) => x.low)), highLast5: Math.max(cur.high, ...cs.slice(-4).map((x) => x.high)),
  };
}

const mk = (sid: string, side: Side, c: Ctx & {}, risk: number, q: number, why: Bi[]): Match => {
  const r = clamp(risk, 0.8 * c.atr, 2.6 * c.atr);
  const s = side === "long" ? 1 : -1;
  return { sid, side, q: Math.round(clamp(q, 1, 99)), why, entry: c.price, stop: c.price - s * r, t: [c.price + s * r, c.price + s * 2 * r, c.price + s * 3 * r], riskPct: (r / c.price) * 100 };
};

export function matchesFor(rows: QCandle[], tf: string, nowMs = Date.now()): Match[] {
  const c = ctxOf(rows, tf, nowMs);
  if (!c) return [];
  const out: Match[] = [];
  const upTrend = c.e20 > c.e50 && c.price > c.e50, dnTrend = c.e20 < c.e50 && c.price < c.e50;
  const volOk = c.volPace >= 1.1;
  // 1. breakout
  if (c.price > c.hh20 && upTrend && c.hist > 0 && c.rsi >= 52 && c.rsi <= 82 && volOk)
    out.push(mk("brk", "long", c, c.price - (c.hh20 - 0.5 * c.atr), 55 + Math.min(25, (c.volPace - 1) * 20) + Math.min(15, (c.rsi - 55) * 0.6), [b("price broke above the 20-candle high (" + c.hh20.toPrecision(5) + ")", "قیمت سقف ۲۰ کندل (" + c.hh20.toPrecision(5) + ") را شکسته"), b("trend is up (EMA20 above EMA50) and MACD is positive", "روند صعودی است (EMA20 بالای EMA50) و MACD مثبت است"), b("RSI " + c.rsi.toFixed(0) + ", volume " + c.volPace.toFixed(1) + "x normal", "RSI برابر " + c.rsi.toFixed(0) + " و حجم " + c.volPace.toFixed(1) + " برابر معمول")]));
  if (c.price < c.ll20 && dnTrend && c.hist < 0 && c.rsi <= 48 && c.rsi >= 18 && volOk)
    out.push(mk("brk", "short", c, c.ll20 + 0.5 * c.atr - c.price, 55 + Math.min(25, (c.volPace - 1) * 20) + Math.min(15, (45 - c.rsi) * 0.6), [b("price broke below the 20-candle low (" + c.ll20.toPrecision(5) + ")", "قیمت کف ۲۰ کندل (" + c.ll20.toPrecision(5) + ") را شکسته"), b("trend is down (EMA20 below EMA50) and MACD is negative", "روند نزولی است (EMA20 زیر EMA50) و MACD منفی است"), b("RSI " + c.rsi.toFixed(0) + ", volume " + c.volPace.toFixed(1) + "x normal", "RSI برابر " + c.rsi.toFixed(0) + " و حجم " + c.volPace.toFixed(1) + " برابر معمول")]));
  // 2. pullback
  const slopeUp = c.e50 > c.e50b, slopeDn = c.e50 < c.e50b;
  if (upTrend && slopeUp && c.lowLast5 <= c.e20 + 0.35 * c.atr && c.price >= c.e20 && c.rsi >= 42 && c.rsi <= 60 && c.rsi > (c.rsiP[c.rsiP.length - 1] ?? 0) && c.closePos > 0.5)
    out.push(mk("pull", "long", c, c.price - (Math.min(c.lowLast5, c.e50) - 0.2 * c.atr), 58 + Math.min(15, ((c.e20 - c.e50) / c.atr) * 6) + (c.rsi < 52 ? 6 : 0), [b("uptrend dipped back to the 20 EMA and is holding it", "روند صعودی تا EMA20 برگشته و آن را نگه داشته"), b("RSI cooled to " + c.rsi.toFixed(0) + " and is turning up", "RSI تا " + c.rsi.toFixed(0) + " خنک شده و دوباره بالا می‌رود"), b("candle is closing in its upper half", "کندل در نیمه‌ی بالایی خود بسته می‌شود")]));
  if (dnTrend && slopeDn && c.highLast5 >= c.e20 - 0.35 * c.atr && c.price <= c.e20 && c.rsi <= 58 && c.rsi >= 40 && c.rsi < (c.rsiP[c.rsiP.length - 1] ?? 100) && c.closePos < 0.5)
    out.push(mk("pull", "short", c, Math.max(c.highLast5, c.e50) + 0.2 * c.atr - c.price, 58 + Math.min(15, ((c.e50 - c.e20) / c.atr) * 6) + (c.rsi > 48 ? 6 : 0), [b("downtrend bounced up to the 20 EMA and is rejected", "روند نزولی تا EMA20 بالا آمده و رد شده"), b("RSI rose to " + c.rsi.toFixed(0) + " and is turning down", "RSI تا " + c.rsi.toFixed(0) + " بالا آمده و دوباره پایین می‌رود"), b("candle is closing in its lower half", "کندل در نیمه‌ی پایینی خود بسته می‌شود")]));
  // 3. squeeze
  if (c.wRank <= 0.2) {
    if (c.price > c.up && c.hist > 0 && c.volPace >= 1.2) out.push(mk("sqz", "long", c, c.price - c.sma20, 60 + Math.min(20, (c.volPace - 1) * 15) + (0.2 - c.wRank) * 50, [b("Bollinger Bands were in their tightest 20% and price just closed above the upper band", "باندهای بولینگر در فشرده‌ترین ۲۰٪ بوده و قیمت بالای باند بالا رفته"), b("MACD is positive, volume " + c.volPace.toFixed(1) + "x", "MACD مثبت و حجم " + c.volPace.toFixed(1) + " برابر است")]));
    if (c.price < c.dn && c.hist < 0 && c.volPace >= 1.2) out.push(mk("sqz", "short", c, c.sma20 - c.price, 60 + Math.min(20, (c.volPace - 1) * 15) + (0.2 - c.wRank) * 50, [b("Bollinger Bands were in their tightest 20% and price just closed below the lower band", "باندهای بولینگر در فشرده‌ترین ۲۰٪ بوده و قیمت زیر باند پایین رفته"), b("MACD is negative, volume " + c.volPace.toFixed(1) + "x", "MACD منفی و حجم " + c.volPace.toFixed(1) + " برابر است")]));
  }
  // 4. ignition
  const hp = c.histP, rp = c.rsiP;
  if (c.hist > 0 && Math.min(...hp.slice(-2)) <= 0 && c.rsi > 55 && Math.min(...rp.slice(-3)) < 55 && c.price > c.e20 && c.volPace >= 1)
    out.push(mk("ign", "long", c, 1.5 * c.atr, 52 + Math.min(20, (c.volPace - 1) * 15) + (c.price > c.e50 ? 8 : 0), [b("MACD histogram just turned positive", "هیستوگرام MACD تازه مثبت شده"), b("RSI crossed above 55 (now " + c.rsi.toFixed(0) + ")", "RSI از ۵۵ بالا رفته (اکنون " + c.rsi.toFixed(0) + ")"), b("price is above the 20 EMA", "قیمت بالای EMA20 است")]));
  if (c.hist < 0 && Math.max(...hp.slice(-2)) >= 0 && c.rsi < 45 && Math.max(...rp.slice(-3)) > 45 && c.price < c.e20 && c.volPace >= 1)
    out.push(mk("ign", "short", c, 1.5 * c.atr, 52 + Math.min(20, (c.volPace - 1) * 15) + (c.price < c.e50 ? 8 : 0), [b("MACD histogram just turned negative", "هیستوگرام MACD تازه منفی شده"), b("RSI crossed below 45 (now " + c.rsi.toFixed(0) + ")", "RSI از ۴۵ پایین آمده (اکنون " + c.rsi.toFixed(0) + ")"), b("price is below the 20 EMA", "قیمت زیر EMA20 است")]));
  // 5. thrust
  if (c.rangeAtr >= 1.5 && c.body >= 0.6 && c.volPace >= 2 && c.cur.close > c.cur.open && c.closePos >= 0.8 && c.price > c.e20)
    out.push(mk("thr", "long", c, 1.4 * c.atr, 55 + Math.min(25, (c.volPace - 2) * 8) + Math.min(10, (c.rangeAtr - 1.5) * 8), [b("big green candle: " + c.rangeAtr.toFixed(1) + "x ATR, closing near its high", "کندل سبز بزرگ: " + c.rangeAtr.toFixed(1) + " برابر ATR و بسته‌شدن نزدیک سقف"), b("volume " + c.volPace.toFixed(1) + "x normal", "حجم " + c.volPace.toFixed(1) + " برابر معمول")]));
  if (c.rangeAtr >= 1.5 && c.body >= 0.6 && c.volPace >= 2 && c.cur.close < c.cur.open && c.closePos <= 0.2 && c.price < c.e20)
    out.push(mk("thr", "short", c, 1.4 * c.atr, 55 + Math.min(25, (c.volPace - 2) * 8) + Math.min(10, (c.rangeAtr - 1.5) * 8), [b("big red candle: " + c.rangeAtr.toFixed(1) + "x ATR, closing near its low", "کندل قرمز بزرگ: " + c.rangeAtr.toFixed(1) + " برابر ATR و بسته‌شدن نزدیک کف"), b("volume " + c.volPace.toFixed(1) + "x normal", "حجم " + c.volPace.toFixed(1) + " برابر معمول")]));
  return out.sort((x, y) => y.q - x.q);
}

/** Scan many coins. `rowsOf` returns the candles you already have for a coin. Cross-coin ranking (relative strength) is added here. */
export function scan(coins: string[], tf: string, rowsOf: (b: string) => QCandle[] | undefined, nowMs = Date.now()): Hit[] {
  const hits: Hit[] = [];
  const rocs: { base: string; roc: number; c: NonNullable<Ctx> }[] = [];
  for (const base of coins) {
    const rows = rowsOf(base);
    if (!rows) continue;
    const c = ctxOf(rows, tf, nowMs);
    if (!c) continue;
    hits.push({ base, price: c.price, matches: matchesFor(rows, tf, nowMs) });
    rocs.push({ base, roc: c.roc20, c });
  }
  if (rocs.length >= 6) {
    const sorted = [...rocs].sort((x, y) => y.roc - x.roc);
    const k = Math.max(1, Math.floor(sorted.length * 0.2));
    const add = (x: (typeof rocs)[number], side: Side, rankPct: number) => {
      const h = hits.find((v) => v.base === x.base)!;
      const why: Bi[] = [b((side === "long" ? "top " : "bottom ") + Math.round(rankPct) + "% of scanned coins by 20-candle move (" + (x.roc * 100).toFixed(1) + "%)", (side === "long" ? "جزو " : "جزو ") + Math.round(rankPct) + "٪ " + (side === "long" ? "قوی‌ترین" : "ضعیف‌ترین") + " ارزهای اسکن‌شده در ۲۰ کندل اخیر (" + (x.roc * 100).toFixed(1) + "٪)"), b(side === "long" ? "clean uptrend: price above EMA20 and EMA50, MACD positive" : "clean downtrend: price below EMA20 and EMA50, MACD negative", side === "long" ? "روند صعودی تمیز: قیمت بالای EMA20 و EMA50 و MACD مثبت" : "روند نزولی تمیز: قیمت زیر EMA20 و EMA50 و MACD منفی")];
      h.matches.push(mk("rs", side, x.c, 1.6 * x.c.atr, 60 + (1 - rankPct / 100) * 30, why));
    };
    sorted.slice(0, k).forEach((x, i) => x.c.price > x.c.e50 && x.c.e20 > x.c.e50 && x.c.hist > 0 && add(x, "long", ((i + 1) / sorted.length) * 100));
    sorted.slice(-k).forEach((x, i) => x.c.price < x.c.e50 && x.c.e20 < x.c.e50 && x.c.hist < 0 && add(x, "short", ((k - i) / sorted.length) * 100));
  }
  for (const h of hits) h.matches.sort((x, y) => y.q - x.q);
  return hits;
}
