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

/** Evaluate one symbol. `rows` = candles of the chosen timeframe, `htf` = daily (or higher) candles for context. Returns a signal or null. */
export function evaluate(symbol: string, base: string, tf: string, rowsIn: QCandle[], htfIn: QCandle[] | null, htfTf: string | null, nowMs = Date.now(), forming = false): Sig | null {
  const rows = forming ? rowsIn : closedOnly(rowsIn, tf, nowMs);
  if (rows.length < 60) return null;
  const n = rows.length, last = rows[n - 1], prev = rows[n - 2];
  const atr = atrOf(rows, 14);
  if (!(atr > 0)) return null;
  const closes = rows.map((r) => r.close);
  const rsi = rsiOf(closes, 14);
  const s20 = sma(closes, 20), s50 = sma(closes, 50);
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
  // support / resistance: swing pivots in the last 80 candles, excluding the last one
  const look = rows.slice(-81, -1);
  const pv = pivots(look, 3);
  const resList = pv.hi.map((x) => x.p), supList = pv.lo.map((x) => x.p);
  let level: Sig["level"] = null;
  let breakUp = false, breakDn = false;
  const bufU = atr * 0.15;
  const brokenR = resList.filter((r) => prev.close <= r + bufU && last.close > r + bufU).sort((a, c) => c - a)[0];
  const brokenS = supList.filter((s) => prev.close >= s - bufU && last.close < s - bufU).sort((a, c) => a - c)[0];
  if (brokenR != null) { breakUp = true; level = { kind: "resistance", price: brokenR, state: "broken" }; }
  else if (brokenS != null) { breakDn = true; level = { kind: "support", price: brokenS, state: "broken" }; }
  else {
    // retest: broke a level in the last 6 candles and price is back touching it
    const rec = rows.slice(-7, -1);
    const rr = resList.find((r) => rec.some((x) => x.close > r + bufU) && last.low <= r + atr * 0.3 && last.close > r);
    const ss = supList.find((s) => rec.some((x) => x.close < s - bufU) && last.high >= s - atr * 0.3 && last.close < s);
    if (rr != null) { level = { kind: "resistance", price: rr, state: "retest" }; breakUp = true; }
    else if (ss != null) { level = { kind: "support", price: ss, state: "retest" }; breakDn = true; }
  }
  const above20 = last.close > s20, above50 = last.close > s50;

  const score = (side: "long" | "short") => {
    const L = side === "long";
    let sc = 0;
    const why: Bi[] = [];
    const want: Trend = L ? "up" : "down", opp: Trend = L ? "down" : "up";
    if (htf) {
      if (htf.trend === want) { sc += 2; why.push(b(`${htf.tf} trend is ${L ? "up" : "down"} — trading with the bigger trend`, `روند ${htf.tf} ${L ? "صعودی" : "نزولی"} است — هم‌جهت با روند بزرگ‌تر`)); }
      else if (htf.trend === opp) { sc -= 2; why.push(b(`${htf.tf} trend is against this trade`, `روند ${htf.tf} خلاف این معامله است`)); }
    }
    if (trend === want) { sc += 2; why.push(b(`${tf} trend is ${L ? "up" : "down"} (price and SMA20 vs SMA50, SMA50 slope)`, `روند ${tf} ${L ? "صعودی" : "نزولی"} است (قیمت و SMA20 نسبت به SMA50، شیب SMA50)`)); }
    else if (trend === opp) sc -= 1;
    const brk = L ? breakUp : breakDn;
    if (brk && level) {
      sc += 2;
      why.push(level.state === "broken"
        ? b(`${L ? "Resistance" : "Support"} at ${level.price.toPrecision(5)} broken by a candle close`, `${L ? "مقاومت" : "حمایت"} ${level.price.toPrecision(5)} با بسته‌شدن کندل شکسته شد`)
        : b(`Retest of the broken ${L ? "resistance" : "support"} at ${level.price.toPrecision(5)} — it now acts the other way`, `برگشت به ${L ? "مقاومت" : "حمایت"} شکسته‌شده ${level.price.toPrecision(5)} — حالا نقش برعکس دارد`));
      if (level.state === "broken") {
        if (ratio >= 1.3) { sc += 1; why.push(b("The break came with heavy volume (confirmed)", "شکست با حجم بالا همراه بود (تأیید)")); }
        else why.push(b("The break has weak volume — less reliable", "شکست با حجم ضعیف بود — اعتبار کمتر"));
      }
    }
    if (candle.dir === (L ? "bull" : "bear")) { sc += 1; why.push(b(`Candle: ${candle.name.en}`, `کندل: ${candle.name.fa}`)); }
    else if (candle.dir === (L ? "bear" : "bull")) sc -= 1;
    if (L ? rsi >= 48 && rsi <= 72 : rsi <= 52 && rsi >= 28) { sc += 1; why.push(b(`RSI ${rsi.toFixed(0)} supports it with room left`, `RSI برابر ${rsi.toFixed(0)} است و جا برای ادامه دارد`)); }
    else if (L ? rsi > 78 : rsi < 22) { sc -= 1; why.push(b(`RSI ${rsi.toFixed(0)} is stretched — chasing is risky`, `RSI برابر ${rsi.toFixed(0)} و کشیده است — دنبال‌کردن ریسک دارد`)); }
    if (L ? above20 && above50 : !above20 && !above50) { sc += 1; why.push(b(`Price ${L ? "above" : "below"} SMA20 and SMA50`, `قیمت ${L ? "بالای" : "پایین"} SMA20 و SMA50 است`)); }
    return { sc, why, trig: brk || (candle.dir === (L ? "bull" : "bear") && !candle.name.en.startsWith("Ordinary")) };
  };
  const lg = score("long"), sh = score("short");
  const side: "long" | "short" = lg.sc >= sh.sc ? "long" : "short";
  const pick = side === "long" ? lg : sh;
  if (!pick.trig || pick.sc < 5) return null;
  const L = side === "long";
  const entry = last.close;
  const swing = L ? Math.min(...rows.slice(-6).map((r) => r.low)) : Math.max(...rows.slice(-6).map((r) => r.high));
  let stop = L ? Math.min(swing - atr * 0.2, entry - atr * 0.8) : Math.max(swing + atr * 0.2, entry + atr * 0.8);
  if (Math.abs(entry - stop) > atr * 3) stop = L ? entry - atr * 3 : entry + atr * 3;
  const R = Math.abs(entry - stop);
  const t: [number, number, number] = [1, 2, 3].map((k) => (L ? entry + R * k : entry - R * k)) as [number, number, number];
  return {
    symbol, base, tf, at: nowMs, side, score: pick.sc,
    grade: pick.sc >= 8 ? "A" : pick.sc >= 6 ? "B" : "C",
    price: last.close, htf, trend, level,
    candle, vol, rsi, sma: { v20: s20, v50: s50, above20, above50 },
    why: pick.why, entry, stop, t, riskPct: (R / entry) * 100,
    forming, bars: rows.slice(-32).map((r) => [r.open, r.high, r.low, r.close]),
  };
}
