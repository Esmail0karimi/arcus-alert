/* Multi-timeframe signal engine. Uses classic, widely taught technical-analysis principles (trend by moving averages and swing
   structure, support/resistance breaks confirmed by a close and by volume, candle patterns, RSI, and ATR-sized risk).
   It is rule-based maths, not a copy of any book, and not advice. */
import { atrOf, rsiOf, TF_SEC, type Bi } from "./agent";
import type { QCandle } from "./qfex";

const b = (en: string, fa: string): Bi => ({ en, fa });
export type Trend = "up" | "down" | "flat";
export type Sig = {
  symbol: string;
  base: string;
  tf: string;
  at: number;
  side: "long" | "short";
  grade: "A" | "B" | "C";
  score: number;
  price: number;
  htf: { tf: string; trend: Trend } | null;
  trend: Trend;
  level: { kind: "support" | "resistance"; price: number; state: "broken" | "retest" | "near" } | null;
  candle: { name: Bi; dir: "bull" | "bear" | "neutral" };
  vol: { ratio: number; label: Bi };
  rsi: number;
  sma: { v20: number; v50: number; above20: boolean; above50: boolean };
  why: Bi[];
  strat: { id: string; name: Bi; basis: Bi };
  sma7: number;
  entry: number;
  stop: number;
  t: [number, number, number];
  riskPct: number;
  forming: boolean;
  bars: number[][];
};

const sma = (v: number[], n: number) => (v.length < n ? NaN : v.slice(-n).reduce((a, x) => a + x, 0) / n);
const smaAt = (v: number[], n: number, end: number) => (end < n ? NaN : v.slice(end - n, end).reduce((a, x) => a + x, 0) / n);

/** Only finished candles. */
export const closedOnly = (rows: QCandle[], tf: string, nowMs = Date.now()) => {
  const sec = TF_SEC[tf] || 0;
  const last = rows[rows.length - 1];
  return last && sec && (last.time + sec) * 1000 > nowMs ? rows.slice(0, -1) : rows;
};

export function trendOf(rows: QCandle[]): Trend {
  const c = rows.map((r) => r.close);
  if (c.length < 55) return "flat";
  const s20 = sma(c, 20), s50 = sma(c, 50), s50b = smaAt(c, 50, c.length - 10);
  const px = c[c.length - 1];
  const rising = s50 > s50b * 1.002, falling = s50 < s50b * 0.998;
  if (px > s50 && s20 > s50 && rising) return "up";
  if (px < s50 && s20 < s50 && falling) return "down";
  return "flat";
}

function pivots(rows: QCandle[], k = 3) {
  const hi: { i: number; p: number }[] = [], lo: { i: number; p: number }[] = [];
  for (let i = k; i < rows.length - k; i++) {
    let h = true, l = true;
    for (let j = 1; j <= k; j++) {
      if (rows[i].high < rows[i - j].high || rows[i].high <= rows[i + j].high) h = false;
      if (rows[i].low > rows[i - j].low || rows[i].low >= rows[i + j].low) l = false;
    }
    if (h) hi.push({ i, p: rows[i].high });
    if (l) lo.push({ i, p: rows[i].low });
  }
  return { hi, lo };
}

function candleRead(rows: QCandle[], atr: number): Sig["candle"] {
  const c = rows[rows.length - 1], p = rows[rows.length - 2];
  const rng = Math.max(c.high - c.low, 1e-12), body = Math.abs(c.close - c.open);
  const up = c.high - Math.max(c.open, c.close), lo = Math.min(c.open, c.close) - c.low;
  const green = c.close >= c.open;
  const pBody = Math.abs(p.close - p.open);
  if (body / rng < 0.1) return { name: b("Doji (indecision)", "دوجی (بلاتکلیفی)"), dir: "neutral" };
  if (green && p.close < p.open && c.close >= p.open && c.open <= p.close && body > pBody) return { name: b("Bullish engulfing", "اینگالفینگ صعودی"), dir: "bull" };
  if (!green && p.close > p.open && c.close <= p.open && c.open >= p.close && body > pBody) return { name: b("Bearish engulfing", "اینگالفینگ نزولی"), dir: "bear" };
  if (lo > body * 2 && up < body && lo > rng * 0.55) return { name: b("Hammer (buyers rejected lower prices)", "چکش (خریداران قیمت پایین را رد کردند)"), dir: "bull" };
  if (up > body * 2 && lo < body && up > rng * 0.55) return { name: b("Shooting star (sellers rejected higher prices)", "ستاره‌ی دنباله‌دار (فروشندگان قیمت بالا را رد کردند)"), dir: "bear" };
  if (body / rng > 0.8 && rng > atr * 0.9) return green ? { name: b("Strong green candle (marubozu)", "کندل سبز قوی (ماروبوزو)"), dir: "bull" } : { name: b("Strong red candle (marubozu)", "کندل قرمز قوی (ماروبوزو)"), dir: "bear" };
  return green ? { name: b("Ordinary green candle", "کندل سبز معمولی"), dir: "bull" } : { name: b("Ordinary red candle", "کندل قرمز معمولی"), dir: "bear" };
}

const STRATS = {
  brk: { id: "brk", name: b("Level break", "شکست سطح"), basis: b("Momentum trading: a level tested several times finally breaks on a close", "مومنتوم‌تریدینگ: سطحی که چند بار تست شده و حالا با بسته‌شدن کندل شکسته") },
  hmr: { id: "hmr", name: b("Hammer at SMA7", "چکش کنار SMA7"), basis: b("Candle pattern in the trend direction, right at the 7-period average", "الگوی کندلی هم‌جهت با روند، کنار میانگین ۷ کندلی") },
  dow: { id: "dow", name: b("Dow theory", "تئوری داو"), basis: b("Higher highs and higher lows (or lower/lower); after the new swing price nears the last extreme while volume grows", "سقف و کف بالاتر (یا پایین‌تر)؛ بعد از کف/سقف جدید، قیمت به آخرین نقطه‌ی حدی نزدیک می‌شود و حجم زیاد می‌شود") },
  pul: { id: "pul", name: b("Pullback", "پولبک"), basis: b("Trend continuation: price dips to the SMA20/SMA50 zone and turns back with the trend", "ادامه‌ی روند: قیمت تا ناحیه‌ی SMA20/SMA50 برمی‌گردد و دوباره هم‌جهت روند می‌شود") },
  mom: { id: "mom", name: b("Momentum candle", "کندل مومنتوم"), basis: b("Engulfing / marubozu in the trend direction on above-average volume", "اینگالفینگ یا کندل بلند در جهت روند با حجم بالای میانگین") },
};
export const STRAT_LIST = Object.values(STRATS);

/** Evaluate one symbol; returns one signal per strategy that fires. `rows` = chosen timeframe, `htf` = higher timeframe for context. */
export function evaluate(symbol: string, base: string, tf: string, rowsIn: QCandle[], htfIn: QCandle[] | null, htfTf: string | null, nowMs = Date.now(), forming = false): Sig[] {
  const rows = forming ? rowsIn : closedOnly(rowsIn, tf, nowMs);
  if (rows.length < 60) return [];
  const n = rows.length, last = rows[n - 1], prev = rows[n - 2];
  const atr = atrOf(rows, 14);
  if (!(atr > 0)) return [];
  const closes = rows.map((r) => r.close);
  const rsi = rsiOf(closes, 14);
  const s7 = sma(closes, 7), s20 = sma(closes, 20), s50 = sma(closes, 50);
  const trend = trendOf(rows);
  const hrows = htfIn && htfTf ? closedOnly(htfIn, htfTf, nowMs) : null;
  const htf = hrows && hrows.length >= 55 && htfTf ? { tf: htfTf, trend: trendOf(hrows) } : null;
  const candle = candleRead(rows, atr);
  const vAvg = rows.slice(-21, -1).reduce((a, r) => a + r.volume, 0) / 20;
  const ratio = vAvg > 0 ? last.volume / vAvg : 1;
  const vol: Sig["vol"] = {
    ratio,
    label: ratio >= 1.5 ? b("Heavy volume", "حجم سنگین") : ratio >= 1.1 ? b("Above-average volume", "حجم بالاتر از میانگین") : ratio >= 0.7 ? b("Normal volume", "حجم معمولی") : b("Thin volume", "حجم کم"),
  };
  const above20 = last.close > s20, above50 = last.close > s50;
  const look = rows.slice(-101, -1);
  const pv = pivots(look, 3);
  const buf = atr * 0.15;
  const fmtp = (v: number) => v.toPrecision(5);

  // levels with their number of touches (pivots clustered within 0.3 ATR)
  const cluster = (arr: { p: number }[]) =>
    arr.map((h) => {
      const near = arr.filter((x) => Math.abs(x.p - h.p) <= atr * 0.3);
      return { p: near.reduce((a, x) => a + x.p, 0) / near.length, touches: near.length };
    });
  const resL = cluster(pv.hi), supL = cluster(pv.lo);

  type Hit = { side: "long" | "short"; id: keyof typeof STRATS; bonus: number; why: Bi[]; level: Sig["level"] };
  const hits: Hit[] = [];

  // 1) level tested several times, now broken by a close
  const brkR = resL.filter((r) => r.touches >= 2 && prev.close <= r.p + buf && last.close > r.p + buf).sort((a, c) => c.touches - a.touches)[0];
  const brkS = supL.filter((r) => r.touches >= 2 && prev.close >= r.p - buf && last.close < r.p - buf).sort((a, c) => c.touches - a.touches)[0];
  for (const [lv, L] of [[brkR, true], [brkS, false]] as const) {
    if (!lv) continue;
    const why: Bi[] = [b(`${L ? "Resistance" : "Support"} ${fmtp(lv.p)} was tested ${lv.touches} times and has now broken on a close`, `${L ? "مقاومت" : "حمایت"} ${fmtp(lv.p)} ${lv.touches} بار تست شده بود و حالا با بسته‌شدن کندل شکسته شد`)];
    let bonus = 3;
    if (ratio >= 1.3) { bonus += 1; why.push(b("The break came with heavy volume (confirmed)", "شکست با حجم بالا همراه بود (تأیید)")); }
    else why.push(b("Volume on the break is weak — less reliable", "حجم شکست ضعیف است — اعتبار کمتر"));
    hits.push({ side: L ? "long" : "short", id: "brk", bonus, why, level: { kind: L ? "resistance" : "support", price: lv.p, state: "broken" } });
  }

  // 2) hammer / shooting star in the trend direction, near SMA7
  const nearS7 = Math.abs(last.close - s7) <= atr * 0.8 || (last.low <= s7 + atr * 0.3 && last.high >= s7 - atr * 0.3);
  if (candle.name.en.startsWith("Hammer") && trend === "up" && nearS7)
    hits.push({ side: "long", id: "hmr", bonus: 2, level: null, why: [b("Hammer in an uptrend, touching the 7-period average — buyers defended it", "چکش در روند صعودی و کنار میانگین ۷ کندلی — خریداران از آن دفاع کردند")] });
  if (candle.name.en.startsWith("Shooting") && trend === "down" && nearS7)
    hits.push({ side: "short", id: "hmr", bonus: 2, level: null, why: [b("Shooting star in a downtrend at the 7-period average — sellers defended it", "ستاره‌ی دنباله‌دار در روند نزولی کنار میانگین ۷ کندلی — فروشندگان از آن دفاع کردند")] });

  // 3) Dow theory: HH+HL (or LH+LL); the new swing is formed, price is near the last extreme and volume is rising
  const rec = rows.slice(-121, -1), pr = pivots(rec, 3);
  if (pr.hi.length >= 2 && pr.lo.length >= 2) {
    const [h1, h2] = pr.hi.slice(-2), [l1, l2] = pr.lo.slice(-2);
    const vNew = rows.slice(-3).reduce((a, r) => a + r.volume, 0) / 3, vOld = rows.slice(-13, -3).reduce((a, r) => a + r.volume, 0) / 10;
    const volUp = vOld > 0 && vNew >= vOld * 1.1;
    if (h2.p > h1.p && l2.p > l1.p && l2.i > h2.i && last.close < h2.p && h2.p - last.close <= atr * 1.5 && last.close > l2.p && volUp)
      hits.push({ side: "long", id: "dow", bonus: 3, level: { kind: "resistance", price: h2.p, state: "near" }, why: [b(`Uptrend: higher highs (${fmtp(h1.p)}→${fmtp(h2.p)}) and higher lows (${fmtp(l1.p)}→${fmtp(l2.p)}). The higher low is in; price is nearing the high ${fmtp(h2.p)} with growing volume`, `روند صعودی: سقف بالاتر (${fmtp(h1.p)}←${fmtp(h2.p)}) و کف بالاتر (${fmtp(l1.p)}←${fmtp(l2.p)}). کف بالاتر ساخته شده؛ قیمت با حجم رو‌به‌رشد به سقف ${fmtp(h2.p)} نزدیک می‌شود`)] });
    if (h2.p < h1.p && l2.p < l1.p && h2.i > l2.i && last.close > l2.p && last.close - l2.p <= atr * 1.5 && last.close < h2.p && volUp)
      hits.push({ side: "short", id: "dow", bonus: 3, level: { kind: "support", price: l2.p, state: "near" }, why: [b(`Downtrend: lower highs and lower lows. The lower high is in; price is nearing the low ${fmtp(l2.p)} with growing volume`, `روند نزولی: سقف و کف پایین‌تر. سقف پایین‌تر ساخته شده؛ قیمت با حجم رو‌به‌رشد به کف ${fmtp(l2.p)} نزدیک می‌شود`)] });
  }

  // 4) pullback to SMA20/SMA50 in a trend
  const r6 = rows.slice(-6);
  const dipLow = Math.min(...r6.map((r) => r.low)), popHigh = Math.max(...r6.map((r) => r.high));
  if (trend === "up" && dipLow <= s20 + atr * 0.3 && last.close > s20 && last.close >= last.open && Math.max(...rows.slice(-14).map((r) => r.high)) > s20 + atr * 1.5 && rsi >= 38 && rsi <= 62)
    hits.push({ side: "long", id: "pul", bonus: 2, level: null, why: [b(`Pulled back to SMA20 (${fmtp(s20)}) inside an uptrend and turned up (RSI ${rsi.toFixed(0)})`, `در روند صعودی تا SMA20 (${fmtp(s20)}) برگشت و دوباره بالا آمد (RSI برابر ${rsi.toFixed(0)})`)] });
  if (trend === "down" && popHigh >= s20 - atr * 0.3 && last.close < s20 && last.close <= last.open && Math.min(...rows.slice(-14).map((r) => r.low)) < s20 - atr * 1.5 && rsi >= 38 && rsi <= 62)
    hits.push({ side: "short", id: "pul", bonus: 2, level: null, why: [b(`Bounced up to SMA20 (${fmtp(s20)}) inside a downtrend and turned down (RSI ${rsi.toFixed(0)})`, `در روند نزولی تا SMA20 (${fmtp(s20)}) بالا آمد و دوباره پایین رفت (RSI برابر ${rsi.toFixed(0)})`)] });

  // 5) momentum candle in the trend direction with volume
  if (ratio >= 1.3 && !candle.name.en.startsWith("Ordinary") && !candle.name.en.startsWith("Doji") && !candle.name.en.startsWith("Hammer") && !candle.name.en.startsWith("Shooting")) {
    if (candle.dir === "bull" && trend !== "down") hits.push({ side: "long", id: "mom", bonus: 2, level: null, why: [b(`${candle.name.en} on ${ratio.toFixed(1)}× volume`, `${candle.name.fa} با حجم ${ratio.toFixed(1)} برابر`)] });
    if (candle.dir === "bear" && trend !== "up") hits.push({ side: "short", id: "mom", bonus: 2, level: null, why: [b(`${candle.name.en} on ${ratio.toFixed(1)}× volume`, `${candle.name.fa} با حجم ${ratio.toFixed(1)} برابر`)] });
  }

  const out: Sig[] = [];
  for (const h of hits) {
    const L = h.side === "long";
    let sc = h.bonus;
    const why: Bi[] = [...h.why];
    const want: Trend = L ? "up" : "down", opp: Trend = L ? "down" : "up";
    if (htf) {
      if (htf.trend === want) { sc += 2; why.push(b(`${htf.tf} trend is ${L ? "up" : "down"} — with the bigger trend`, `روند ${htf.tf} ${L ? "صعودی" : "نزولی"} است — هم‌جهت با روند بزرگ‌تر`)); }
      else if (htf.trend === opp) { sc -= 2; why.push(b(`${htf.tf} trend is against this trade`, `روند ${htf.tf} خلاف این معامله است`)); }
    }
    if (trend === want) { sc += 2; why.push(b(`${tf} trend is ${L ? "up" : "down"}`, `روند ${tf} ${L ? "صعودی" : "نزولی"} است`)); } else if (trend === opp && h.id !== "brk") sc -= 1;
    if (ratio >= 1.3) sc += 1;
    if (L ? rsi >= 48 && rsi <= 72 : rsi <= 52 && rsi >= 28) { sc += 1; why.push(b(`RSI ${rsi.toFixed(0)} has room left`, `RSI برابر ${rsi.toFixed(0)} و جا برای ادامه دارد`)); }
    else if (L ? rsi > 78 : rsi < 22) { sc -= 1; why.push(b(`RSI ${rsi.toFixed(0)} is stretched — chasing is risky`, `RSI برابر ${rsi.toFixed(0)} و کشیده است — دنبال‌کردن ریسک دارد`)); }
    if (L ? above20 && above50 : !above20 && !above50) sc += 1;
    if (sc < 5) continue;
    const entry = last.close;
    const swing = L ? Math.min(...rows.slice(-6).map((r) => r.low)) : Math.max(...rows.slice(-6).map((r) => r.high));
    let stop = L ? Math.min(swing - atr * 0.2, entry - atr * 0.8) : Math.max(swing + atr * 0.2, entry + atr * 0.8);
    if (Math.abs(entry - stop) > atr * 3) stop = L ? entry - atr * 3 : entry + atr * 3;
    const R = Math.abs(entry - stop);
    const t = [1, 2, 3].map((k) => (L ? entry + R * k : entry - R * k)) as [number, number, number];
    out.push({
      symbol, base, tf, at: nowMs, side: h.side, score: sc, grade: sc >= 8 ? "A" : sc >= 6 ? "B" : "C",
      price: last.close, htf, trend, level: h.level, candle, vol, rsi, sma: { v20: s20, v50: s50, above20, above50 }, sma7: s7,
      why, strat: STRATS[h.id], entry, stop, t, riskPct: (R / entry) * 100,
      forming, bars: rows.slice(-32).map((r) => [r.open, r.high, r.low, r.close]),
    });
  }
  return out;
}
