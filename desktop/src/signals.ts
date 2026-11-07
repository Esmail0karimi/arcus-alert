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
  tgt: { price: number; rr: number } | null;
  alt: { entry: number; rr: number } | null;
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
  vsg: { id: "vsg", name: b("Volume surge", "افزایش ناگهانی حجم"), basis: b("Volume jumps to 2.5× its average or more while price moves with it — someone big is active", "حجم ناگهان به ۲.۵ برابر میانگین یا بیشتر می‌رسد و قیمت هم همراهش حرکت می‌کند — بازیگر بزرگی وارد شده"), },
  rct: { id: "rct", name: b("Reaction at a level", "ری‌اکشن در سطح"), basis: b("Price returns to a level that held before (2+ touches) and reacts with a rejection candle", "قیمت به سطحی که قبلاً چند بار نگه داشته برمی‌گردد و با کندل پس‌زده‌شدن واکنش نشان می‌دهد") },
  pa: { id: "pa", name: b("Price action", "پرایس اکشن"), basis: b("Pure price patterns: inside-bar breakout, double bottom / double top with a neckline break", "الگوهای خالص قیمت: شکست اینساید بار، دوقلوی کف / سقف با شکست خط گردن") },
  ell: { id: "ell", name: b("Elliott wave (simplified)", "الیوت (ساده‌شده)"), basis: b("Wave 4 correction ends after a 5-wave-style impulse (wave 2 holds, wave 3 beyond wave 1, no overlap) — start of wave 5. Elliott is subjective; treat as a lead", "پایان موج ۴ بعد از ساختار پنج‌موجی (موج ۲ نگه داشته، موج ۳ فراتر از موج ۱، بدون همپوشانی) — شروع موج ۵. الیوت ذهنی است؛ فقط سرنخ"), },
  mtf: { id: "mtf", name: b("Higher-timeframe level break", "شکست سطح تایم‌فریم بالاتر"), basis: b("A 15m / 1h candle closes beyond a level from the 4h or daily chart (tested 2+ times there) — the small chart triggers, the big chart gives the level", "کندل ۱۵ دقیقه یا ۱ ساعته بیرون سطحی از چارت ۴ ساعته یا روزانه (که آنجا دست‌کم ۲ بار تست شده) بسته می‌شود — چارت کوچک ماشه را می‌کشد و چارت بزرگ سطح را می‌دهد") },
  prs: { id: "prs", name: b("Pressure on a higher-timeframe level", "فشار روی سطح تایم‌فریم بالاتر"), basis: b("Before the break: price squeezes against a 4h / daily level with higher lows (or lower highs) and rising volume — the level may give way soon", "پیش از شکست: قیمت با کف‌های بالاتر (یا سقف‌های پایین‌تر) و حجم رو‌به‌رشد به سطح ۴ ساعته / روزانه فشار می‌آورد — سطح ممکن است به‌زودی بشکند") },
  mom: { id: "mom", name: b("Momentum candle", "کندل مومنتوم"), basis: b("Engulfing / marubozu in the trend direction on above-average volume", "اینگالفینگ یا کندل بلند در جهت روند با حجم بالای میانگین") },
};
export const STRAT_LIST = Object.values(STRATS);

/** Evaluate one symbol; returns one signal per strategy that fires. `rows` = chosen timeframe, `htf` = higher timeframe for context. */
export function evaluate(symbol: string, base: string, tf: string, rowsIn: QCandle[], htfIn: QCandle[] | null, htfTf: string | null, nowMs = Date.now(), forming = false, lvlIn: { tf: string; rows: QCandle[] }[] = []): Sig[] {
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

  // 7) reaction at a level that held before
  const near = atr * 0.5;
  const rctS = supL.filter((x) => x.touches >= 2 && last.low <= x.p + atr * 0.2 && last.low >= x.p - near && last.close > x.p && last.close > last.open).sort((a, c) => c.touches - a.touches)[0];
  const rctR = resL.filter((x) => x.touches >= 2 && last.high >= x.p - atr * 0.2 && last.high <= x.p + near && last.close < x.p && last.close < last.open).sort((a, c) => c.touches - a.touches)[0];
  const wickLo = Math.min(last.open, last.close) - last.low, wickUp = last.high - Math.max(last.open, last.close), bodyL = Math.abs(last.close - last.open);
  if (rctS && wickLo >= bodyL * 0.7)
    hits.push({ side: "long", id: "rct", bonus: 3, level: { kind: "support", price: rctS.p, state: "retest" }, why: [b(`Price touched support ${fmtp(rctS.p)} (held ${rctS.touches} times before) and bounced with a rejection candle`, `قیمت به حمایت ${fmtp(rctS.p)} (قبلاً ${rctS.touches} بار نگه داشته) رسید و با کندل پس‌زده‌شدن برگشت`)] });
  if (rctR && wickUp >= bodyL * 0.7)
    hits.push({ side: "short", id: "rct", bonus: 3, level: { kind: "resistance", price: rctR.p, state: "retest" }, why: [b(`Price touched resistance ${fmtp(rctR.p)} (held ${rctR.touches} times before) and was rejected`, `قیمت به مقاومت ${fmtp(rctR.p)} (قبلاً ${rctR.touches} بار نگه داشته) رسید و پس زده شد`)] });

  // 8) price action: inside-bar breakout, double bottom / top
  const pp = rows[n - 3];
  if (pp && prev.high <= pp.high && prev.low >= pp.low) {
    if (last.close > pp.high) hits.push({ side: "long", id: "pa", bonus: 2, level: null, why: [b("Inside bar (compression) broke upward on a close", "اینساید بار (فشردگی) با بسته‌شدن کندل رو به بالا شکست")] });
    if (last.close < pp.low) hits.push({ side: "short", id: "pa", bonus: 2, level: null, why: [b("Inside bar (compression) broke downward on a close", "اینساید بار (فشردگی) با بسته‌شدن کندل رو به پایین شکست")] });
  }
  if (pr.lo.length >= 2) {
    const [a1, a2] = pr.lo.slice(-2);
    const neck = Math.max(...rec.slice(a1.i, a2.i + 1).map((r) => r.high));
    if (Math.abs(a1.p - a2.p) <= atr * 0.4 && a2.i - a1.i >= 5 && prev.close <= neck && last.close > neck)
      hits.push({ side: "long", id: "pa", bonus: 3, level: { kind: "resistance", price: neck, state: "broken" }, why: [b(`Double bottom (${fmtp(a1.p)} / ${fmtp(a2.p)}) — neckline ${fmtp(neck)} broken up`, `کف دوقلو (${fmtp(a1.p)} / ${fmtp(a2.p)}) — خط گردن ${fmtp(neck)} به بالا شکست`)] });
  }
  if (pr.hi.length >= 2) {
    const [a1, a2] = pr.hi.slice(-2);
    const neck = Math.min(...rec.slice(a1.i, a2.i + 1).map((r) => r.low));
    if (Math.abs(a1.p - a2.p) <= atr * 0.4 && a2.i - a1.i >= 5 && prev.close >= neck && last.close < neck)
      hits.push({ side: "short", id: "pa", bonus: 3, level: { kind: "support", price: neck, state: "broken" }, why: [b(`Double top (${fmtp(a1.p)} / ${fmtp(a2.p)}) — neckline ${fmtp(neck)} broken down`, `سقف دوقلو (${fmtp(a1.p)} / ${fmtp(a2.p)}) — خط گردن ${fmtp(neck)} به پایین شکست`)] });
  }

  // 9) simplified Elliott: wave-4 correction finished, wave 5 starting
  {
    type P = { i: number; p: number; k: "h" | "l" };
    const pts: P[] = [...pr.hi.map((x): P => ({ ...x, k: "h" })), ...pr.lo.map((x): P => ({ ...x, k: "l" }))].sort((a, c) => a.i - c.i);
    const alt: P[] = [];
    for (const x of pts) {
      const t = alt[alt.length - 1];
      if (!t || t.k !== x.k) alt.push(x);
      else if ((x.k === "h" && x.p > t.p) || (x.k === "l" && x.p < t.p)) alt[alt.length - 1] = x;
    }
    const q = alt.slice(-5);
    if (q.length === 5) {
      const [p0, p1, p2, p3, p4] = q;
      if (p0.k === "l" && p1.k === "h" && p2.p > p0.p && p3.p > p1.p && p3.p - p2.p >= (p1.p - p0.p) * 0.9 && p4.p > p1.p) {
        const ret = (p3.p - p4.p) / (p3.p - p2.p);
        if (ret >= 0.2 && ret <= 0.6 && last.close > last.open && last.close > prev.high && last.low >= p4.p - atr * 0.3)
          hits.push({ side: "long", id: "ell", bonus: 3, level: null, why: [b(`Impulse up (wave 3 ${fmtp(p3.p)} beyond wave 1 ${fmtp(p1.p)}); wave 4 pulled back ${(ret * 100).toFixed(0)}% to ${fmtp(p4.p)} without overlapping wave 1; price turning up = wave 5 start`, `ایمپالس صعودی (موج ۳ ${fmtp(p3.p)} فراتر از موج ۱ ${fmtp(p1.p)})؛ موج ۴ ${(ret * 100).toFixed(0)}٪ تا ${fmtp(p4.p)} اصلاح شد بدون همپوشانی با موج ۱؛ برگشت قیمت = شروع موج ۵`)] });
      }
      if (p0.k === "h" && p1.k === "l" && p2.p < p0.p && p3.p < p1.p && p2.p - p3.p >= (p0.p - p1.p) * 0.9 && p4.p < p1.p) {
        const ret = (p4.p - p3.p) / (p2.p - p3.p);
        if (ret >= 0.2 && ret <= 0.6 && last.close < last.open && last.close < prev.low && last.high <= p4.p + atr * 0.3)
          hits.push({ side: "short", id: "ell", bonus: 3, level: null, why: [b(`Impulse down (wave 3 ${fmtp(p3.p)} beyond wave 1 ${fmtp(p1.p)}); wave 4 bounced ${(ret * 100).toFixed(0)}% to ${fmtp(p4.p)} without overlap; price turning down = wave 5 start`, `ایمپالس نزولی (موج ۳ ${fmtp(p3.p)} فراتر از موج ۱ ${fmtp(p1.p)})؛ موج ۴ ${(ret * 100).toFixed(0)}٪ تا ${fmtp(p4.p)} برگشت بدون همپوشانی؛ برگشت قیمت = شروع موج ۵`)] });
      }
    }
  }

  // 6) sudden volume surge with a real price move
  const bodyMove = Math.abs(last.close - last.open);
  if (ratio >= 2.5 && bodyMove >= atr * 0.5) {
    const L = last.close > last.open;
    hits.push({ side: L ? "long" : "short", id: "vsg", bonus: 3, level: null, why: [b(`Volume is ${ratio.toFixed(1)}× its 20-candle average and price moved ${(bodyMove / atr).toFixed(1)} ATR ${L ? "up" : "down"} with it`, `حجم ${ratio.toFixed(1)} برابر میانگین ۲۰ کندل است و قیمت هم ${(bodyMove / atr).toFixed(1)} ATR ${L ? "بالا" : "پایین"} رفته`)] });
  }

  // 10) levels from the 4h / daily charts, triggered on the 15m / 1h chart
  type HL = { p: number; touches: number; tf: string };
  const htfRes: HL[] = [], htfSup: HL[] = [];
  for (const lv of lvlIn) {
    const cr = closedOnly(lv.rows, lv.tf, nowMs);
    if (cr.length < 40) continue;
    const aH = atrOf(cr, 14);
    if (!(aH > 0)) continue;
    const pvH = pivots(cr.slice(-121), 3);
    const cl2 = (arr: { p: number }[]) => arr.map((h) => { const nr = arr.filter((x) => Math.abs(x.p - h.p) <= aH * 0.3); return { p: nr.reduce((a, x) => a + x.p, 0) / nr.length, touches: nr.length, tf: lv.tf }; }).filter((x) => x.touches >= 2);
    htfRes.push(...cl2(pvH.hi));
    htfSup.push(...cl2(pvH.lo));
  }
  if ((tf === "15m" || tf === "1h") && (htfRes.length || htfSup.length)) {
    const pref = (a: HL, c: HL) => (a.tf === "1d" ? 0 : 1) - (c.tf === "1d" ? 0 : 1) || c.touches - a.touches;
    const brR = htfRes.filter((x) => prev.close <= x.p + buf && last.close > x.p + buf).sort(pref)[0];
    const brS = htfSup.filter((x) => prev.close >= x.p - buf && last.close < x.p - buf).sort(pref)[0];
    for (const [lv, L] of [[brR, true], [brS, false]] as const) {
      if (!lv) continue;
      const why: Bi[] = [b(`${tf} candle closed ${L ? "above" : "below"} the ${lv.tf} ${L ? "resistance" : "support"} ${fmtp(lv.p)} (tested ${lv.touches} times on the ${lv.tf} chart)`, `کندل ${tf} ${L ? "بالای" : "پایین"} ${L ? "مقاومت" : "حمایت"} ${lv.tf} یعنی ${fmtp(lv.p)} بسته شد (روی چارت ${lv.tf} ${lv.touches} بار تست شده)`)];
      let bonus = lv.tf === "1d" ? 4 : 3;
      if (ratio >= 1.3) { bonus += 1; why.push(b("Trigger candle has strong volume", "کندل ماشه حجم قوی دارد")); }
      hits.push({ side: L ? "long" : "short", id: "mtf", bonus, why, level: { kind: L ? "resistance" : "support", price: lv.p, state: "broken" } });
    }
    // pressure before the break
    const last6 = rows.slice(-6);
    let ups = 0, downs = 0;
    for (let i = 1; i < last6.length; i++) { if (last6[i].low > last6[i - 1].low) ups++; if (last6[i].high < last6[i - 1].high) downs++; }
    const vRecent = rows.slice(-3).reduce((a, r) => a + r.volume, 0) / 3, vPrior = rows.slice(-13, -3).reduce((a, r) => a + r.volume, 0) / 10;
    const volUp = vPrior > 0 && vRecent > vPrior * 1.1;
    const prR = htfRes.filter((x) => x.p > last.close && x.p - last.close <= atr * 1.2).sort(pref)[0];
    const prS = htfSup.filter((x) => x.p < last.close && last.close - x.p <= atr * 1.2).sort(pref)[0];
    if (prR && ups >= 3 && volUp && !brR)
      hits.push({ side: "long", id: "prs", bonus: 3, level: { kind: "resistance", price: prR.p, state: "near" }, why: [b(`Price is pressing on the ${prR.tf} resistance ${fmtp(prR.p)} (tested ${prR.touches} times) with higher lows and rising volume — a break may be near`, `قیمت با کف‌های بالاتر و حجم رو‌به‌رشد به مقاومت ${prR.tf} یعنی ${fmtp(prR.p)} (${prR.touches} بار تست‌شده) فشار می‌آورد — شکست ممکن است نزدیک باشد`)] });
    if (prS && downs >= 3 && volUp && !brS)
      hits.push({ side: "short", id: "prs", bonus: 3, level: { kind: "support", price: prS.p, state: "near" }, why: [b(`Price is pressing on the ${prS.tf} support ${fmtp(prS.p)} (tested ${prS.touches} times) with lower highs and rising volume — a break may be near`, `قیمت با سقف‌های پایین‌تر و حجم رو‌به‌رشد به حمایت ${prS.tf} یعنی ${fmtp(prS.p)} (${prS.touches} بار تست‌شده) فشار می‌آورد — شکست ممکن است نزدیک باشد`)] });
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
    else if (ratio < 0.7 && h.id !== "vsg") { sc -= 1; why.push(b("Volume is thin — moves are less reliable", "حجم کم است — اعتماد به حرکت کمتر است")); }
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
    // real target: the next level in the trade direction; alternative entry: wait for a retest of the broken level
    const beyond = (L ? resL.concat(htfRes).filter((x) => x.p > entry + R * 0.3) : supL.concat(htfSup).filter((x) => x.p < entry - R * 0.3)).map((x) => x.p).sort((a, c) => (L ? a - c : c - a))[0];
    const tgt = beyond != null ? { price: beyond, rr: Math.abs(beyond - entry) / R } : null;
    let alt: Sig["alt"] = null;
    if (h.level && h.level.state === "broken" && (L ? h.level.price < entry : h.level.price > entry) && Math.abs(entry - h.level.price) <= atr * 1.5) {
      const e2 = h.level.price, R2 = Math.abs(e2 - stop);
      if (R2 > 0) alt = { entry: e2, rr: Math.abs((tgt ? tgt.price : t[1]) - e2) / R2 };
    }
    out.push({
      tgt, alt, symbol, base, tf, at: nowMs, side: h.side, score: sc, grade: sc >= 8 ? "A" : sc >= 6 ? "B" : "C",
      price: last.close, htf, trend, level: h.level, candle, vol, rsi, sma: { v20: s20, v50: s50, above20, above50 }, sma7: s7,
      why, strat: STRATS[h.id], entry, stop, t, riskPct: (R / entry) * 100,
      forming, bars: rows.slice(-32).map((r) => [r.open, r.high, r.low, r.close]),
    });
  }
  return out;
}
