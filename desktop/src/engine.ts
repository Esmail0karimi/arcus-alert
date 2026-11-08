/* Multi-timeframe momentum engine (Dow theory + price action).
   Hierarchy: 1D = primary trend + major levels, 4H = intermediate trend / BOS / CHoCH / zones, 1H = trigger, 15M = entry confirmation.
   Strategies: breakout, false breakout, V-shaped reversal, momentum shift (countertrend allowed).
   Rules: only CLOSED candles confirm anything; indicators (volume / RSI / MACD) only add score, they never create an entry;
   a trade needs a structural stop, a real target, net R:R >= 2 (after costs) and a score >= 70 to be "ready"; everything else is watchlist or rejected. */
import { Bi, TF_SEC } from "./agent";
import type { QCandle } from "./qfex";

const b = (en: string, fa: string): Bi => ({ en, fa });
export type Trend = "up" | "down" | "range";
export type StratId = "brk" | "fbo" | "vsh" | "mom" | "fbk" | "pbw" | "prz" | "box" | "tca" | "tcb" | "tcf";
export type Status = "ready" | "watch";
export type TfKey = "1d" | "4h" | "1h" | "15m";
export type Candles = Partial<Record<TfKey, QCandle[]>>;
export const STRATS = {
  brk: { name: b("Breakout", "شکست سطح"), basis: b("A candle CLOSED beyond a key support/resistance zone (a wick is not enough); immediate or retest entry", "بسته‌شدن کندل بیرون از ناحیه‌ی مهم حمایت/مقاومت (سایه کافی نیست)؛ ورود فوری یا با ریتست") },
  fbo: { name: b("False breakout", "شکست کاذب"), basis: b("Price closed beyond a level, then closed back inside it and was rejected — trade the failure", "قیمت بیرون سطح بسته شد، بعد دوباره داخل برگشت و پس زده شد — معامله روی شکست ناموفق") },
  vsh: { name: b("V-shaped reversal", "بازگشت V شکل"), basis: b("A fast, deep move then a fast reversal back toward the origin of the move", "حرکت سریع و عمیق و بعد برگشت سریع به‌سمت مبدأ همان حرکت") },
  mom: { name: b("Momentum shift", "تغییر مومنتوم"), basis: b("Structure flips on the 1H (BOS/CHoCH) and the 15M confirms — can be against the 1D/4H trend", "ساختار ۱ساعته می‌چرخد (BOS/CHoCH) و ۱۵ دقیقه تأیید می‌کند — می‌تواند خلاف روند ۱D/۴H باشد") },
} as unknown as Record<StratId, { name: Bi; basis: Bi }>;
STRATS.fbk = { name: b("Fake break + 15M range break", "شکست کاذب + شکست رنج ۱۵ دقیقه"), basis: b("4H trend makes a new extreme by a CLOSE beyond the last swing, price closes back inside and ranges; a good 15M candle breaks the range in the direction of the failure", "روند ۴ساعته با بسته‌شدن بیرون از آخرین سقف/کف جدید می‌زند، قیمت برمی‌گردد و رنج می‌زند؛ کندل خوب ۱۵ دقیقه رنج را در جهت شکست‌خورده می‌شکند") };
STRATS.pbw = { name: b("Weak pullback (trend entry)", "پولبک ضعیف (ورود با روند)"), basis: b("In a 4H Dow trend the pullback cannot reach the previous swing; a 15M box or a high-volume reversal candle at the top of the pullback joins the trend early", "در روند داوی ۴ساعته پولبک به سقف/کف قبلی نمی‌رسد؛ باکس ۱۵ دقیقه یا کندل برگشتی پرحجم در انتهای پولبک، ورود زودهنگام با روند است") };
STRATS.prz = { name: b("Range at a major level (PRZ)", "رنج در سطح مهم (PRZ)"), basis: b("The trend runs into a major daily/weekly level or Fibonacci zone and starts to range; a strong 1H break up = LONG, a break down = trend continues (SHORT)", "روند به سطح مهم روزانه/هفتگی یا ناحیه‌ی فیبوناچی می‌رسد و رنج می‌زند؛ شکست قوی ۱ساعته به بالا = لانگ، به پایین = ادامه‌ی روند (شورت)") };
STRATS.box = { name: b("Box", "باکس"), basis: b("Box = at least 2 touches of the top and 2 of the bottom (1% tolerance). A candle CLOSE outside the box = signal, the main-trend direction is preferred", "باکس = حداقل ۲ برخورد به سقف و ۲ برخورد به کف (تلورانس ۱٪). بسته‌شدن کندل بیرون باکس = سیگنال، جهت روند اصلی اولویت دارد") };
STRATS.tca = { name: b("Tradecity · Level breakout", "تریدسیتی · شکست سطح"), basis: b("1D and 4H both HH+HL (long) / LH+LL (short); a 1H CLOSE beyond the last pivot with volume ≥ 1.5× its 20-bar average; stop behind the last pivot; target 4R or trail under each new higher low", "۱D و ۴H هر دو HH+HL (لانگ) / LH+LL (شورت)؛ کلوز ۱ساعته بیرون از آخرین پیوت با حجم ≥ ۱.۵ برابر میانگین ۲۰ کندل؛ حد ضرر پشت آخرین پیوت؛ هدف 4R یا تریلینگ زیر هر کف بالاتر") };
STRATS.tcb = { name: b("Tradecity · Momentum candle setup", "تریدسیتی · ستاپ کندل مومنتوم"), basis: b("Trend direction on 1D+4H, a pullback with falling volume, then an engulfing candle on 1H with returning volume and RSI on the trend side of 50", "جهت روند ۱D+۴H، پولبک با حجم کاهشی، سپس کندل انگالف ۱ساعته با بازگشت حجم و RSI سمت روند نسبت به ۵۰") };
STRATS.tcf = { name: b("Tradecity · Fake-out of a level", "تریدسیتی · فیک‌اوت سطح"), basis: b("In a 1D+4H trend a 1H pivot level is broken by a close, fails, and price returns with an engulfing / V candle — enter back in the trend direction", "در روند ۱D+۴H یک سطح پیوت ۱ساعته با کلوز شکسته می‌شود، شکست ناموفق است و قیمت با کندل انگالف / V برمی‌گردد — ورود در جهت روند") };
export type Cfg = { triggers: ("1h" | "4h")[]; costPct: number; minRR: number; minScore: number; on: Record<StratId, boolean> };
export const DEF_CFG: Cfg = { triggers: ["1h"], costPct: 0.1, minRR: 2, minScore: 70, on: { brk: false, fbo: false, vsh: false, mom: false, fbk: true, pbw: true, prz: true, box: true, tca: true, tcb: true, tcf: true } };
export type Sig2 = {
  id: string; symbol: string; base: string; market: string; ex: string;
  side: "long" | "short"; strat: StratId; status: Status; method: "immediate" | "retest" | "none"; tf: string;
  d1: Trend | null; h4: Trend | null; h1: Trend | null; m15: { ok: boolean | null; text: Bi };
  entry: number; stop: number; tp: number; tpNote: Bi; rr: number; rrGross: number;
  score: number; grade: "excellent" | "good" | "watchlist";
  parts: { structure: number; setup: number; pa: number; vol: number; rsi: number; macd: number; entryQ: number; rr: number };
  time: number; candleTime: number; price: number; why: Bi[]; wait?: Bi; trig?: number; missing: string[]; zone?: { lo: number; hi: number }; status2?: Bi; tag?: Bi;
};
export type SymInfo = { symbol: string; base: string; market: string; ex: string; d1: Trend | null; h4: Trend | null; h1: Trend | null; issues: string[]; stale: boolean; price: number | null; need15?: boolean };

/* ---------- small maths ---------- */
const emaArr = (v: number[], n: number) => {
  const k = 2 / (n + 1), o: number[] = [];
  let e = v[0];
  for (let i = 0; i < v.length; i++) { e = i === 0 ? v[0] : v[i] * k + e * (1 - k); o.push(e); }
  return o;
};
const rsiArr = (c: number[], n = 14) => {
  const o: number[] = new Array(c.length).fill(50);
  if (c.length <= n) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
};
const macdHist = (c: number[]) => {
  const f = emaArr(c, 12), s = emaArr(c, 26), m = f.map((x, i) => x - s[i]), sg = emaArr(m, 9);
  return m.map((x, i) => x - sg[i]);
};
const atrAt = (r: QCandle[], n = 14) => {
  if (r.length < n + 1) return 0;
  let s = 0;
  for (let i = r.length - n; i < r.length; i++) s += Math.max(r[i].high - r[i].low, Math.abs(r[i].high - r[i - 1].close), Math.abs(r[i].low - r[i - 1].close));
  return s / n;
};
export const closedRows = (rows: QCandle[] | undefined, tf: string, now: number) => {
  if (!rows || !rows.length) return [] as QCandle[];
  const sec = TF_SEC[tf] || 0, l = rows[rows.length - 1];
  return sec && (l.time + sec) * 1000 > now ? rows.slice(0, -1) : rows;
};

/* ---------- Dow structure ---------- */
type Sw = { i: number; p: number; t: "H" | "L" };
function swings(rows: QCandle[], k: number): Sw[] {
  const raw: Sw[] = [];
  for (let i = k; i < rows.length - k; i++) {
    let h = true, l = true;
    for (let j = 1; j <= k; j++) {
      if (rows[i].high <= rows[i - j].high || rows[i].high < rows[i + j].high) h = false;
      if (rows[i].low >= rows[i - j].low || rows[i].low > rows[i + j].low) l = false;
    }
    if (h) raw.push({ i, p: rows[i].high, t: "H" });
    if (l) raw.push({ i, p: rows[i].low, t: "L" });
  }
  raw.sort((a, c) => a.i - c.i);
  const out: Sw[] = [];
  for (const x of raw) {
    const t = out[out.length - 1];
    if (!t || t.t !== x.t) out.push(x);
    else if ((x.t === "H" && x.p > t.p) || (x.t === "L" && x.p < t.p)) out[out.length - 1] = x;
  }
  return out;
}
type Ev = { kind: "BOS" | "CHoCH"; dir: "up" | "down"; level: number; age: number };
type Struct = { trend: Trend; sw: Sw[]; lastH?: Sw; lastL?: Sw; prevH?: Sw; prevL?: Sw; ev?: Ev };
function structure(rows: QCandle[], k: number): Struct {
  const sw = swings(rows, k), H = sw.filter((x) => x.t === "H"), L = sw.filter((x) => x.t === "L");
  const lastH = H[H.length - 1], prevH = H[H.length - 2], lastL = L[L.length - 1], prevL = L[L.length - 2];
  let trend: Trend = "range";
  if (lastH && prevH && lastL && prevL) {
    if (lastH.p > prevH.p && lastL.p > prevL.p) trend = "up";
    else if (lastH.p < prevH.p && lastL.p < prevL.p) trend = "down";
  }
  let ev: Ev | undefined;
  const n = rows.length;
  for (let j = n - 1; j >= Math.max(1, n - 8) && !ev; j--) {
    if (lastH && j > lastH.i && rows[j].close > lastH.p && rows[j - 1].close <= lastH.p) ev = { kind: trend === "down" || trend === "range" ? "CHoCH" : "BOS", dir: "up", level: lastH.p, age: n - 1 - j };
    else if (lastL && j > lastL.i && rows[j].close < lastL.p && rows[j - 1].close >= lastL.p) ev = { kind: trend === "up" || trend === "range" ? "CHoCH" : "BOS", dir: "down", level: lastL.p, age: n - 1 - j };
  }
  if (ev && ev.kind === "CHoCH" && trend === "range") ev.kind = "BOS";
  return { trend, sw, lastH, lastL, prevH, prevL, ev };
}

/* ---------- zones: swing levels + supply/demand bases, merged ---------- */
type Zone = { lo: number; hi: number; w: number; touches: number; src: string };
function zonesFrom(rows: QCandle[], k: number, w: number, src: string): Zone[] {
  if (rows.length < 40) return [];
  const atr = atrAt(rows), z: Zone[] = [];
  const base = rows.slice(-200);
  for (const s of swings(base, k)) z.push({ lo: s.p - atr * 0.15, hi: s.p + atr * 0.15, w, touches: 1, src });
  for (let i = 1; i < base.length - 1; i++) {
    const c = base[i], body = Math.abs(c.close - c.open);
    if (body >= atr * 1.6) {
      const p = base[i - 1];
      const bz = c.close > c.open ? { lo: p.low, hi: Math.max(p.high, p.open, p.close) } : { lo: Math.min(p.low, p.open, p.close), hi: p.high };
      if (bz.hi - bz.lo <= atr * 1.6) z.push({ lo: bz.lo, hi: bz.hi, w: w * 0.8, touches: 1, src: src + " S/D" });
    }
  }
  return z;
}
function mergeZones(zs: Zone[], tol: number, maxH: number): Zone[] {
  const s = zs.slice().sort((a, c) => a.lo - c.lo), out: Zone[] = [];
  for (const z of s) {
    const t = out[out.length - 1];
    if (t && z.lo <= t.hi + tol && Math.max(t.hi, z.hi) - Math.min(t.lo, z.lo) <= Math.max(maxH, t.hi - t.lo, z.hi - z.lo)) { t.hi = Math.max(t.hi, z.hi); t.lo = Math.min(t.lo, z.lo); t.w += z.w; t.touches += z.touches; if (!t.src.includes(z.src)) t.src += "+" + z.src; }
    else out.push({ ...z });
  }
  return out;
}

/* ---------- scoring helpers ---------- */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function paScore(rows: QCandle[], side: "long" | "short", rej = false) {
  const n = rows.length, c = rows[n - 1], rng = Math.max(c.high - c.low, 1e-12), body = Math.abs(c.close - c.open);
  const L = side === "long", ok = L ? c.close > c.open : c.close < c.open;
  const notes: Bi[] = [];
  let pts = 0;
  if (ok) {
    pts += Math.min(8, (body / rng) * 8);
    const closePos = L ? (c.close - c.low) / rng : (c.high - c.close) / rng;
    if (closePos >= 0.7) { pts += 4; notes.push(b(`Closed in the ${L ? "top" : "bottom"} ${((1 - closePos) * 100).toFixed(0)}% of its range — ${L ? "buyers" : "sellers"} in control`, `در ${((1 - closePos) * 100).toFixed(0)}٪ ${L ? "بالای" : "پایین"} دامنه بسته شد — ${L ? "خریداران" : "فروشندگان"} مسلط`)); }
    const opp = L ? c.high - Math.max(c.open, c.close) : Math.min(c.open, c.close) - c.low;
    if (opp / rng <= 0.2) pts += 3;
    const same = (r: QCandle) => (L ? r.close > r.open : r.close < r.open);
    if (same(rows[n - 2]) && same(rows[n - 3])) { pts += 3; notes.push(b("3 consecutive candles in the same direction", "۳ کندل پشت‌سرهم هم‌جهت")); }
    else if (same(rows[n - 2])) pts += 1;
    if (body > Math.abs(rows[n - 2].close - rows[n - 2].open) * 1.2) { pts += 2; notes.push(b("Momentum accelerating (body larger than the previous candle)", "مومنتوم شتاب می‌گیرد (بدنه از کندل قبل بزرگ‌تر)")); }
  }
  if (rej) {
    const wick = L ? Math.min(c.open, c.close) - c.low : c.high - Math.max(c.open, c.close);
    if (wick / rng >= 0.4) { pts += 6; notes.push(b("Long rejection wick at the level", "سایه‌ی بلند پس‌زدن در سطح")); }
  }
  return { pts: clamp(pts, 0, 20), notes };
}
function volScore(rows: QCandle[]) {
  const n = rows.length;
  const avg = rows.slice(-21, -1).reduce((a, r) => a + r.volume, 0) / 20;
  const ratio = avg > 0 ? rows[n - 1].volume / avg : 1;
  const pts = ratio >= 1.5 ? 10 : ratio >= 1.2 ? 7 : ratio >= 1 ? 4 : ratio >= 0.7 ? 1 : 0;
  return { ratio, pts, note: b(`Volume ${ratio.toFixed(1)}× the 20-candle average${ratio < 0.7 ? " — weak participation" : ratio >= 1.2 ? " — expanding" : ""}`, `حجم ${ratio.toFixed(1)} برابر میانگین ۲۰ کندل${ratio < 0.7 ? " — مشارکت ضعیف" : ratio >= 1.2 ? " — در حال افزایش" : ""}`) };
}
function rsiScore(rows: QCandle[], side: "long" | "short") {
  const c = rows.map((r) => r.close), r = rsiArr(c), v = r[r.length - 1], L = side === "long";
  let pts = L ? (v > 55 && v < 72 ? 7 : v >= 45 && v <= 55 ? 4 : v < 45 ? 2 : 0) : v < 45 && v > 28 ? 7 : v >= 45 && v <= 55 ? 4 : v > 55 ? 2 : 0;
  // divergence between the last two swing points
  const sw = swings(rows, 2).filter((x) => x.t === (L ? "L" : "H")).slice(-2);
  let div = false;
  if (sw.length === 2) div = L ? sw[1].p < sw[0].p && r[sw[1].i] > r[sw[0].i] + 2 : sw[1].p > sw[0].p && r[sw[1].i] < r[sw[0].i] - 2;
  if (div) pts = Math.min(7, pts + 3);
  return { v, pts, div, note: b(`RSI ${v.toFixed(0)}${div ? ` — ${L ? "bullish" : "bearish"} divergence` : ""}`, `RSI ${v.toFixed(0)}${div ? ` — واگرایی ${L ? "صعودی" : "نزولی"}` : ""}`) };
}
function macdScore(rows: QCandle[], side: "long" | "short") {
  const h = macdHist(rows.map((r) => r.close)), n = h.length, L = side === "long";
  const imp = L ? h[n - 1] > h[n - 2] : h[n - 1] < h[n - 2];
  const cross = L ? h.slice(-4, -1).some((x) => x <= 0) && h[n - 1] > 0 : h.slice(-4, -1).some((x) => x >= 0) && h[n - 1] < 0;
  const dirOk = L ? h[n - 1] > 0 : h[n - 1] < 0;
  const pts = dirOk && imp ? 7 : cross ? 6 : imp ? 4 : 0;
  return { pts, note: b(`MACD histogram ${imp ? "improving" : "fading"} for ${L ? "buyers" : "sellers"}${cross ? " (fresh crossover)" : ""}`, `هیستوگرام MACD برای ${L ? "خریداران" : "فروشندگان"} ${imp ? "رو به بهبود" : "رو به ضعف"} است${cross ? " (کراس تازه)" : ""}`) };
}
const trendTxt = (t: Trend | null): Bi => (t === "up" ? b("Up (HH + HL)", "صعودی (HH + HL)") : t === "down" ? b("Down (LH + LL)", "نزولی (LH + LL)") : t === "range" ? b("Range / transition", "رنج / گذار") : b("n/a", "نامشخص"));
export { trendTxt };

/* ---------- boxes ---------- */
const goodCandle = (r: QCandle, side: "long" | "short") => {
  const rng = Math.max(r.high - r.low, 1e-12), L = side === "long";
  return (L ? r.close > r.open : r.close < r.open) && Math.abs(r.close - r.open) / rng >= 0.5 && (L ? (r.close - r.low) / rng : (r.high - r.close) / rng) >= 0.7;
};
/** Tight sideways window that ENDS at the candle before the last one (so the last candle can be tested as a breakout). */
function tightBox(rows: QCandle[], atr: number, minW: number, maxW: number, maxH: number, since = 0) {
  const n = rows.length;
  let best: { lo: number; hi: number; w: number } | null = null;
  if (!(atr > 0)) return best;
  for (let w = minW; w <= maxW; w++) {
    if (n - 1 - w < 0) break;
    const seg = rows.slice(n - 1 - w, n - 1);
    if (seg[0].time < since) break;
    const hi = Math.max(...seg.map((r) => r.high)), lo = Math.min(...seg.map((r) => r.low));
    if (hi - lo <= maxH * atr) best = { lo, hi, w };
    else break;
  }
  return best;
}
/** User definition: >=2 touches of the top and >=2 of the bottom, 1% tolerance. Window ends before the last candle. */
function touchBox(rows: QCandle[], tol = 0.01) {
  const n = rows.length;
  for (const W of [70, 48, 36, 24, 16]) {
    if (n - 1 - W < 0) continue;
    const seg = rows.slice(n - 1 - W, n - 1);
    const hi = Math.max(...seg.map((r) => r.high)), lo = Math.min(...seg.map((r) => r.low)), mid = (hi + lo) / 2, h = hi - lo;
    if (h / mid < 0.025 || h / mid > 0.3) continue;
    let tops = 0, bots = 0, lt = -9, lb = -9;
    seg.forEach((r, i) => {
      if (r.high >= hi * (1 - tol)) { if (i - lt >= 3) tops++; lt = i; }
      if (r.low <= lo * (1 + tol)) { if (i - lb >= 3) bots++; lb = i; }
    });
    if (tops >= 2 && bots >= 2 && Math.abs(seg[W - 1].close - seg[0].close) <= h * 0.7) return { lo, hi, w: W, tops, bots };
  }
  return null;
}

/* ---------- target + R:R (net of costs) ---------- */
function target(side: "long" | "short", entry: number, risk: number, zones: Zone[], atr: number) {
  const L = side === "long";
  const ahead = zones.filter((z) => (L ? z.lo > entry + risk * 0.3 : z.hi < entry - risk * 0.3)).sort((a, c) => (L ? a.lo - c.lo : c.hi - a.hi))[0];
  if (ahead) return { tp: L ? ahead.lo - atr * 0.05 : ahead.hi + atr * 0.05, note: b(`Next ${L ? "resistance" : "support"} zone ${ahead.lo.toPrecision(5)}–${ahead.hi.toPrecision(5)}`, `ناحیه‌ی ${L ? "مقاومت" : "حمایت"} بعدی ${ahead.lo.toPrecision(5)}–${ahead.hi.toPrecision(5)}`), measured: false };
  return { tp: L ? entry + risk * 3 : entry - risk * 3, note: b("No level ahead — projected 3R (measured)", "سطحی جلوی قیمت نیست — هدف 3R (اندازه‌گیری‌شده)"), measured: true };
}
const netRR = (entry: number, stop: number, tp: number, costPct: number) => {
  const risk = Math.abs(entry - stop), reward = Math.abs(tp - entry), cost = (entry * costPct) / 100;
  return { gross: reward / risk, net: (reward - cost) / (risk + cost) };
};

/* ---------- per-symbol analysis ---------- */
export type SymMeta = { symbol: string; base: string; ex: string; market: string };
export function analyzeSymbol(m: SymMeta, d: Candles, now: number, cfg: Cfg): { sigs: Sig2[]; info: SymInfo } {
  const issues: string[] = [];
  const c1d = closedRows(d["1d"], "1d", now), c4h = closedRows(d["4h"], "4h", now), c1h = closedRows(d["1h"], "1h", now), c15 = closedRows(d["15m"], "15m", now);
  if (c1d.length < 40) issues.push("1D");
  if (c4h.length < 60) issues.push("4H");
  if (c1h.length < 60) issues.push("1H");
  const live = d["1h"]?.length ? d["1h"]![d["1h"]!.length - 1].close : d["4h"]?.length ? d["4h"]![d["4h"]!.length - 1].close : null;
  const s1d = c1d.length >= 40 ? structure(c1d, 3) : null;
  const s4h = c4h.length >= 60 ? structure(c4h, 3) : null;
  const s1h = c1h.length >= 60 ? structure(c1h, 2) : null;
  const info: SymInfo = { symbol: m.symbol, base: m.base, market: m.market, ex: m.ex, d1: s1d?.trend ?? null, h4: s4h?.trend ?? null, h1: s1h?.trend ?? null, issues, stale: false, price: live };
  const sigs: Sig2[] = [];
  if (!s4h || !s1h || !s1d) return { sigs, info };
  const lastT = c1h[c1h.length - 1];
  if ((lastT.time + 1 * 3600 * 3) * 1000 < now) { info.stale = true; issues.push("stale"); return { sigs, info }; }
  const atr1h = atrAt(c1h);
  const zones = mergeZones([...zonesFrom(c1d, 3, 3, "1D"), ...zonesFrom(c4h, 3, 2, "4H"), ...zonesFrom(c1h, 2, 1, "1H")], atr1h * 0.4, atr1h * 1.5);
  const s15 = c15.length >= 40 ? structure(c15, 2) : null;
  if (!s15) issues.push("15M");

  const mk = (trig: "1h" | "4h") => {
    const rows = trig === "1h" ? c1h : c4h, st = trig === "1h" ? s1h : s4h;
    const conf = trig === "1h" ? s15 : structure(c1h, 2);
    const confRows = trig === "1h" ? c15 : c1h;
    const sec = TF_SEC[trig];
    const n = rows.length, last = rows[n - 1], prev = rows[n - 2];
    const atr = atrAt(rows);
    if (!(atr > 0)) return;
    const candleTime = last.time, tms = (last.time + sec) * 1000;
    const price = live ?? last.close;
    const vol = volScore(rows);

    const confirm15 = (side: "long" | "short"): { ok: boolean | null; text: Bi } => {
      if (!conf || confRows.length < 40) return { ok: null, text: b(`${trig === "1h" ? "15M" : "1H"} data unavailable`, `داده‌ی ${trig === "1h" ? "۱۵ دقیقه" : "۱ ساعته"} موجود نیست`) };
      const L = side === "long", cl = confRows[confRows.length - 1];
      const evOk = conf.ev && conf.ev.dir === (L ? "up" : "down") && conf.ev.age <= 4;
      const trOk = conf.trend === (L ? "up" : "down");
      const candleOk = L ? cl.close > cl.open : cl.close < cl.open;
      const ok = (evOk || trOk) && candleOk;
      return { ok, text: ok ? b(`${trig === "1h" ? "15M" : "1H"} confirms: ${evOk ? conf.ev!.kind + " " + conf.ev!.dir : "structure " + conf.trend}, last candle ${L ? "green" : "red"}`, `${trig === "1h" ? "۱۵ دقیقه" : "۱ ساعته"} تأیید می‌کند: ${evOk ? conf.ev!.kind + " " + conf.ev!.dir : "ساختار " + conf.trend}، کندل آخر ${L ? "سبز" : "قرمز"}`) : b(`${trig === "1h" ? "15M" : "1H"} has not confirmed yet`, `${trig === "1h" ? "۱۵ دقیقه" : "۱ ساعته"} هنوز تأیید نکرده`) };
    };
    const align = (side: "long" | "short") => {
      const want: Trend = side === "long" ? "up" : "down";
      return (st!.trend === want ? 8 : st!.trend === "range" ? 3 : 0) + (s4h!.trend === want ? 6 : s4h!.trend === "range" ? 2 : 0) + (s1d!.trend === want ? 6 : s1d!.trend === "range" ? 2 : 0);
    };

    const finish = (o: { side: "long" | "short"; strat: StratId; method: "immediate" | "retest" | "none"; entry: number; stop: number; confirmed: boolean; structure: number; setup: number; rej?: boolean; why: Bi[]; wait?: Bi; trigLvl?: number; zone?: Zone; tpOverride?: { tp: number; note: Bi } }) => {
      if (!cfg.on[o.strat]) return;
      const L = o.side === "long", risk = Math.abs(o.entry - o.stop);
      const D = (globalThis as any).__ARCUS_DBG as ((x: string) => void) | undefined;
      if (!(risk > 0) || risk > atr * 4.5) { D?.(`${o.strat} ${o.side} rejected: stop distance ${(risk / atr).toFixed(1)} ATR (zone ${o.zone ? o.zone.lo.toFixed(1) + "-" + o.zone.hi.toFixed(1) : "-"} method ${o.method} last ${last.low.toFixed(1)}/${last.close.toFixed(1)} atr ${atr.toFixed(2)} entry ${o.entry.toFixed(2)} stop ${o.stop.toFixed(2)})`); return; } // stop must be structural but not absurdly wide
      const tg = o.tpOverride ? { ...o.tpOverride, measured: false } : target(o.side, o.entry, risk, zones, atr);
      if (L ? tg.tp <= o.entry : tg.tp >= o.entry) { D?.(`${o.strat} ${o.side} rejected: target behind entry`); return; }
      const rr = netRR(o.entry, o.stop, tg.tp, cfg.costPct);
      if (rr.net < cfg.minRR) { D?.(`${o.strat} ${o.side} rejected: net R:R ${rr.net.toFixed(2)} (${tg.note.en})`); return; } // reject: achievable R:R below the minimum
      const pa = paScore(rows, o.side, o.rej), rs = rsiScore(rows, o.side), mc = macdScore(rows, o.side);
      const c15r = confirm15(o.side);
      const entryQ = o.method === "retest" ? 8 : Math.abs(price - o.entry) <= atr * 0.5 ? 8 : Math.abs(price - o.entry) <= atr ? 5 : 2;
      const rrPts = rr.net >= 4 ? 8 : rr.net >= 3 ? 6 : 4;
      const parts = { structure: clamp(o.structure, 0, 20), setup: clamp(o.setup, 0, 20), pa: pa.pts, vol: vol.pts, rsi: rs.pts, macd: mc.pts, entryQ, rr: rrPts };
      let score = Object.values(parts).reduce((a, v) => a + v, 0) - (c15r.ok === null ? 5 : 0);
      score = Math.round(clamp(score, 0, 100));
      const ready = o.confirmed && score >= cfg.minScore && (c15r.ok === true || c15r.ok === null);
      const id = [m.symbol, o.strat, o.side, trig, candleTime, ready ? "r" : "w"].join("|");
      sigs.push({
        id, symbol: m.symbol, base: m.base, market: m.market, ex: m.ex, side: o.side, strat: o.strat, status: ready ? "ready" : "watch", method: o.method, tf: trig,
        d1: s1d.trend, h4: s4h.trend, h1: s1h.trend, m15: c15r,
        entry: o.entry, stop: o.stop, tp: tg.tp, tpNote: tg.note, rr: rr.net, rrGross: rr.gross,
        score, grade: score >= 85 ? "excellent" : score >= 70 ? "good" : "watchlist", parts,
        time: tms, candleTime, price, missing: issues.slice(), zone: o.zone ? { lo: o.zone.lo, hi: o.zone.hi } : undefined, trig: o.trigLvl,
        why: [...o.why, ...pa.notes, vol.note, rs.note, mc.note, c15r.text, tg.note],
        wait: !ready ? (o.wait || (o.confirmed ? b(`Confirmed setup but quality ${score}/100 is below ${cfg.minScore} — watch only`, `ستاپ تأییدشده ولی کیفیت ${score} از ۱۰۰ زیر ${cfg.minScore} است — فقط مراقبت`) : b("Waiting for the confirming candle close", "منتظر بسته‌شدن کندل تأییدکننده"))) : undefined,
      });
    };

    // ---- A. breakout / retest (closed-candle only) ----
    for (const z of zones) {
      const mid = (z.lo + z.hi) / 2;
      if (Math.abs(mid - last.close) > atr * 4) continue;
      const imp = Math.min(10, z.w * 2 + z.touches);
      // bullish
      {
        const brkNow = prev.close <= z.hi && last.close > z.hi + atr * 0.1 && last.close > last.open;
        let j = -1;
        for (let q = n - 8; q <= n - 2; q++) if (q >= 1 && rows[q].close > z.hi + atr * 0.1 && rows[q - 1].close <= z.hi) { j = q; break; }
        const heldSince = j >= 0 && rows.slice(j, n).every((r) => r.close > z.hi);
        if (brkNow) {
          const over = last.close - z.hi > atr * 1.2;
          const stop = Math.min(last.low, z.hi - Math.min(z.hi - z.lo, atr * 1.2)) - atr * 0.15;
          if (!over) finish({ side: "long", strat: "brk", method: "immediate", entry: last.close, stop, confirmed: true, structure: align("long"), setup: imp + 6, zone: z, why: [b(`Closed above resistance zone ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} (${z.src}, ${z.touches} reactions)`, `بسته‌شدن بالای ناحیه‌ی مقاومت ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} (${z.src}، ${z.touches} واکنش)`), b("Immediate entry: the breakout candle closed close to the level", "ورود فوری: کندل شکست نزدیک سطح بسته شد")] });
          else finish({ side: "long", strat: "brk", method: "retest", entry: z.hi, stop, confirmed: false, structure: align("long"), setup: imp + 4, zone: z, trigLvl: z.hi, why: [b(`Closed above ${z.hi.toPrecision(5)} but is extended (${((last.close - z.hi) / atr).toFixed(1)} ATR)`, `بالای ${z.hi.toPrecision(5)} بسته شد ولی کشیده است (${((last.close - z.hi) / atr).toFixed(1)} ATR)`)], wait: b(`Wait for a retest of ${z.hi.toPrecision(5)} that holds, then a bullish confirmation`, `منتظر ریتست ${z.hi.toPrecision(5)} باش که نگه دارد، بعد تأیید صعودی`) });
        } else if (j >= 0 && heldSince && last.low <= z.hi + atr * 0.25 && last.close > z.hi && last.close > last.open) {
          const low = Math.min(...rows.slice(j).map((r) => r.low));
          finish({ side: "long", strat: "brk", method: "retest", entry: last.close, stop: Math.min(low, z.hi - Math.min(z.hi - z.lo, atr * 1.2)) - atr * 0.15, confirmed: true, structure: align("long"), setup: imp + 7, rej: true, zone: z, why: [b(`Broke above ${z.hi.toPrecision(5)} earlier; price retested it and the level HELD (successful retest)`, `قبلاً بالای ${z.hi.toPrecision(5)} شکست خورد؛ قیمت ریتست کرد و سطح نگه داشت (ریتست موفق)`)] });
        } else if (last.close <= z.hi && z.hi - last.close <= atr * 0.6 && n >= 4 && rows[n - 1].close > rows[n - 3].close && z.w >= 2) {
          const sl = st!.lastL ? st!.lastL.p - atr * 0.15 : NaN;
          if (Number.isFinite(sl)) finish({ side: "long", strat: "brk", method: "none", entry: z.hi + atr * 0.1, stop: sl, confirmed: false, structure: align("long"), setup: imp, zone: z, trigLvl: z.hi, why: [b(`Approaching resistance ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} with rising closes`, `نزدیک مقاومت ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} با بسته‌شدن‌های رو به بالا`)], wait: b(`Wait for a candle CLOSE above ${z.hi.toPrecision(5)} (a wick is not a breakout)`, `منتظر بسته‌شدن کندل بالای ${z.hi.toPrecision(5)} باش (سایه شکست نیست)`) });
        }
      }
      // bearish
      {
        const brkNow = prev.close >= z.lo && last.close < z.lo - atr * 0.1 && last.close < last.open;
        let j = -1;
        for (let q = n - 8; q <= n - 2; q++) if (q >= 1 && rows[q].close < z.lo - atr * 0.1 && rows[q - 1].close >= z.lo) { j = q; break; }
        const heldSince = j >= 0 && rows.slice(j, n).every((r) => r.close < z.lo);
        if (brkNow) {
          const over = z.lo - last.close > atr * 1.2;
          const stop = Math.max(last.high, z.lo + Math.min(z.hi - z.lo, atr * 1.2)) + atr * 0.15;
          if (!over) finish({ side: "short", strat: "brk", method: "immediate", entry: last.close, stop, confirmed: true, structure: align("short"), setup: imp + 6, zone: z, why: [b(`Closed below support zone ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} (${z.src}, ${z.touches} reactions)`, `بسته‌شدن زیر ناحیه‌ی حمایت ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} (${z.src}، ${z.touches} واکنش)`), b("Immediate entry: the breakdown candle closed close to the level", "ورود فوری: کندل شکست نزدیک سطح بسته شد")] });
          else finish({ side: "short", strat: "brk", method: "retest", entry: z.lo, stop, confirmed: false, structure: align("short"), setup: imp + 4, zone: z, trigLvl: z.lo, why: [b(`Closed below ${z.lo.toPrecision(5)} but is extended (${((z.lo - last.close) / atr).toFixed(1)} ATR)`, `زیر ${z.lo.toPrecision(5)} بسته شد ولی کشیده است (${((z.lo - last.close) / atr).toFixed(1)} ATR)`)], wait: b(`Wait for a retest of ${z.lo.toPrecision(5)} that fails, then a bearish confirmation`, `منتظر ریتست ${z.lo.toPrecision(5)} باش که شکست بخورد، بعد تأیید نزولی`) });
        } else if (j >= 0 && heldSince && last.high >= z.lo - atr * 0.25 && last.close < z.lo && last.close < last.open) {
          const high = Math.max(...rows.slice(j).map((r) => r.high));
          finish({ side: "short", strat: "brk", method: "retest", entry: last.close, stop: Math.max(high, z.lo + Math.min(z.hi - z.lo, atr * 1.2)) + atr * 0.15, confirmed: true, structure: align("short"), setup: imp + 7, rej: true, zone: z, why: [b(`Broke below ${z.lo.toPrecision(5)} earlier; price retested it and the level HELD as resistance (successful retest)`, `قبلاً زیر ${z.lo.toPrecision(5)} شکست خورد؛ قیمت ریتست کرد و سطح به‌عنوان مقاومت نگه داشت (ریتست موفق)`)] });
        } else if (last.close >= z.lo && last.close - z.lo <= atr * 0.6 && n >= 4 && rows[n - 1].close < rows[n - 3].close && z.w >= 2) {
          const sl = st!.lastH ? st!.lastH.p + atr * 0.15 : NaN;
          if (Number.isFinite(sl)) finish({ side: "short", strat: "brk", method: "none", entry: z.lo - atr * 0.1, stop: sl, confirmed: false, structure: align("short"), setup: imp, zone: z, trigLvl: z.lo, why: [b(`Approaching support ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} with falling closes`, `نزدیک حمایت ${z.lo.toPrecision(5)}–${z.hi.toPrecision(5)} با بسته‌شدن‌های رو به پایین`)], wait: b(`Wait for a candle CLOSE below ${z.lo.toPrecision(5)} (a wick is not a breakdown)`, `منتظر بسته‌شدن کندل زیر ${z.lo.toPrecision(5)} باش (سایه شکست نیست)`) });
        }
      }

      // ---- B. false breakout ----
      {
        // resistance failure -> SHORT
        let jb = -1;
        for (let q = n - 7; q <= n - 2; q++) if (q >= 1 && rows[q].close > z.hi + atr * 0.1) { jb = q; break; }
        if (jb >= 0 && last.close < z.hi && last.close < last.open && (last.high - Math.max(last.open, last.close)) / Math.max(1e-12, last.high - last.low) >= 0.15) {
          const hi = Math.max(...rows.slice(jb).map((r) => r.high));
          finish({ side: "short", strat: "fbo", method: "immediate", entry: last.close, stop: hi + atr * 0.15, confirmed: true, structure: align("short") + (st!.trend === "up" ? 0 : 0), setup: imp + 6, rej: true, zone: z, why: [b(`Closed above resistance ${z.hi.toPrecision(5)}, then closed back below it with bearish rejection — failed breakout`, `بالای مقاومت ${z.hi.toPrecision(5)} بسته شد، بعد دوباره زیرش بسته شد با پس‌زدن نزولی — شکست ناموفق`), b("Not a retest: the level was lost, not held", "ریتست نیست: سطح از دست رفت، نگه داشته نشد")] });
        }
        // support failure -> LONG
        let js = -1;
        for (let q = n - 7; q <= n - 2; q++) if (q >= 1 && rows[q].close < z.lo - atr * 0.1) { js = q; break; }
        if (js >= 0 && last.close > z.lo && last.close > last.open && (Math.min(last.open, last.close) - last.low) / Math.max(1e-12, last.high - last.low) >= 0.15) {
          const lo = Math.min(...rows.slice(js).map((r) => r.low));
          finish({ side: "long", strat: "fbo", method: "immediate", entry: last.close, stop: lo - atr * 0.15, confirmed: true, structure: align("long"), setup: imp + 6, rej: true, zone: z, why: [b(`Closed below support ${z.lo.toPrecision(5)}, then closed back above it with bullish rejection — failed breakdown`, `زیر حمایت ${z.lo.toPrecision(5)} بسته شد، بعد دوباره بالایش بسته شد با پس‌زدن صعودی — شکست ناموفق`), b("Not a retest: the level was reclaimed", "ریتست نیست: سطح پس گرفته شد")] });
        }
      }
    }

    // ---- C. V-shaped reversal ----
    const Vs: ("long" | "short")[] = ["long", "short"];
    for (const side of Vs) {
      const L = side === "long";
      const piv = st!.sw.filter((x) => x.t === (L ? "L" : "H") && x.i >= n - 40 && n - 1 - x.i >= 2).pop();
      if (!piv) continue;
      const lo0 = Math.max(0, piv.i - 15);
      const seg = rows.slice(lo0, piv.i + 1);
      const oIdx = L ? seg.reduce((bi, r, i) => (r.high > seg[bi].high ? i : bi), 0) : seg.reduce((bi, r, i) => (r.low < seg[bi].low ? i : bi), 0);
      const origin = L ? seg[oIdx].high : seg[oIdx].low, bars = seg.length - 1 - oIdx;
      const move = Math.abs(origin - piv.p);
      if (bars < 2 || bars > 15 || move < atr * 3 || move / bars < atr * 0.5) continue;
      const progress = L ? (last.close - piv.p) / move : (piv.p - last.close) / move;
      const sinceHi = Math.max(...rows.slice(Math.max(piv.i + 1, n - 6), n - 1).map((r) => (L ? r.high : -r.low)));
      const newExtreme = L ? last.close > sinceHi : -last.close > sinceHi;
      const dirCandle = L ? last.close > last.open : last.close < last.open;
      const why0 = b(`${L ? "Sharp drop" : "Sharp rally"} of ${(move / atr).toFixed(1)} ATR in ${bars} candles from ${origin.toPrecision(5)} to ${piv.p.toPrecision(5)}, then a ${L ? "rebound" : "pullback"}: ${(progress * 100).toFixed(0)}% of the way back to the origin`, `${L ? "افت تند" : "صعود تند"} ${(move / atr).toFixed(1)} ATR در ${bars} کندل از ${origin.toPrecision(5)} تا ${piv.p.toPrecision(5)}، بعد ${L ? "برگشت" : "پس‌روی"}: ${(progress * 100).toFixed(0)}٪ مسیر به‌سمت مبدأ برگشته`);
      if (progress >= 0.9) {
        if (!cfg.on.vsh) continue;
        // complete V: informational, no entry
        sigs.push({ id: [m.symbol, "vsh", side, trig, candleTime, "c"].join("|"), symbol: m.symbol, base: m.base, market: m.market, ex: m.ex, side, strat: "vsh", status: "watch", method: "none", tf: trig, d1: s1d.trend, h4: s4h.trend, h1: s1h.trend, m15: confirm15(side), entry: last.close, stop: piv.p, tp: origin, tpNote: b("Recovery reached the origin of the move", "برگشت به مبدأ حرکت رسید"), rr: 0, rrGross: 0, score: 0, grade: "watchlist", parts: { structure: 0, setup: 0, pa: 0, vol: 0, rsi: 0, macd: 0, entryQ: 0, rr: 0 }, time: tms, candleTime, price, missing: issues.slice(), why: [why0], wait: b("V-shape is COMPLETE (recovered to the origin) — not an entry, the move is spent", "بازگشت V کامل شده (به مبدأ رسیده) — ورود نیست، حرکت تمام شده"), status2: b("Complete V", "V کامل") });
        continue;
      }
      if (progress < 0.2) {
        if (dirCandle && cfg.on.vsh) finish({ side, strat: "vsh", method: "none", entry: last.close, stop: piv.p + (L ? -1 : 1) * atr * 0.2, confirmed: false, structure: 8, setup: 8, why: [why0], wait: b("Reversal just starting — wait for the recovery to make a new local high/low on a closed candle", "برگشت تازه شروع شده — منتظر ساخت سقف/کف محلی جدید با کندل بسته‌شده باش"), tpOverride: { tp: origin, note: b("Origin of the move (V completion area)", "مبدأ حرکت (ناحیه‌ی تکمیل V)") } });
        continue;
      }
      const confirmed = newExtreme && dirCandle && progress < 0.8;
      finish({ side, strat: "vsh", method: "immediate", entry: last.close, stop: piv.p + (L ? -1 : 1) * atr * 0.2, confirmed, structure: 10 + (st!.trend === (L ? "up" : "down") ? 4 : 0) + (s4h!.trend === (L ? "up" : "down") ? 2 : 0) + (progress >= 0.3 ? 2 : 0), setup: 10 + Math.min(10, (move / atr) * 1.5), why: [why0, b("Recovery is incomplete — room is left toward the origin", "برگشت ناقص است — تا مبدأ هنوز جا هست")], wait: confirmed ? undefined : b("Wait for a closed candle that makes a new recovery high/low", "منتظر کندل بسته‌شده با سقف/کف جدید در برگشت باش"), tpOverride: { tp: L ? piv.p + move * 0.95 : piv.p - move * 0.95, note: b(`Origin of the move ${origin.toPrecision(5)} (V completion area)`, `مبدأ حرکت ${origin.toPrecision(5)} (ناحیه‌ی تکمیل V)`) } });
    }

    // ---- D. momentum shift / countertrend ----
    for (const side of Vs) {
      const L = side === "long", want: "up" | "down" = L ? "up" : "down";
      const ev = st!.ev;
      const against = (s4h!.trend !== want && s4h!.trend !== "range") || (s1d!.trend !== want && s1d!.trend !== "range");
      const rs = rsiScore(rows, side);
      if (ev && ev.dir === want && ev.age <= 3) {
        const sl = L ? (st!.lastL ? st!.lastL.p - atr * 0.15 : NaN) : st!.lastH ? st!.lastH.p + atr * 0.15 : NaN;
        if (!Number.isFinite(sl)) continue;
        const c15r = confirm15(side);
        const mom = (L ? last.close > last.open : last.close < last.open) && (macdScore(rows, side).pts >= 4 || rs.pts >= 4);
        const confirmed = c15r.ok !== false && mom;
        finish({ side, strat: "mom", method: "immediate", entry: last.close, stop: sl, confirmed, structure: 8 + (c15r.ok ? 6 : 0) + (rs.div ? 4 : 0) + (ev.kind === "CHoCH" ? 2 : 0), setup: 12 + (ev.age === 0 ? 4 : 2), rej: false, why: [b(`${trig === "1h" ? "1H" : "4H"} ${ev.kind} ${want}: closed beyond ${ev.level.toPrecision(5)}${against ? " — COUNTERTREND vs the 1D/4H trend" : ""}`, `${trig === "1h" ? "۱ ساعته" : "۴ ساعته"} ${ev.kind} ${want === "up" ? "صعودی" : "نزولی"}: بسته‌شدن بیرون ${ev.level.toPrecision(5)}${against ? " — خلاف روند ۱D/۴H" : ""}`)], wait: confirmed ? undefined : b(`Shift seen on ${trig === "1h" ? "1H" : "4H"}; wait for ${trig === "1h" ? "15M" : "1H"} confirmation and a ${L ? "bullish" : "bearish"} momentum candle`, `تغییر روی ${trig === "1h" ? "۱ ساعته" : "۴ ساعته"} دیده شد؛ منتظر تأیید ${trig === "1h" ? "۱۵ دقیقه" : "۱ ساعته"} و کندل مومنتوم ${L ? "صعودی" : "نزولی"} باش`) });
      } else if (against && rs.div && st!.trend === (L ? "down" : "up")) {
        const sl = L ? (st!.lastL ? st!.lastL.p - atr * 0.15 : NaN) : st!.lastH ? st!.lastH.p + atr * 0.15 : NaN;
        if (!Number.isFinite(sl)) continue;
        const lvl = L ? st!.lastH?.p : st!.lastL?.p;
        if (lvl == null) continue;
        finish({ side, strat: "mom", method: "none", entry: lvl + (L ? 1 : -1) * atr * 0.1, stop: sl, confirmed: false, structure: 8, setup: 8, why: [b(`${L ? "Selling" : "Buying"} pressure weakening: ${L ? "bullish" : "bearish"} RSI divergence on the ${trig === "1h" ? "1H" : "4H"} inside a ${st!.trend} trend`, `فشار ${L ? "فروش" : "خرید"} ضعیف می‌شود: واگرایی ${L ? "صعودی" : "نزولی"} RSI روی ${trig === "1h" ? "۱ ساعته" : "۴ ساعته"} در روند ${st!.trend}`)], trigLvl: lvl, wait: b(`Wait for a closed break of ${lvl.toPrecision(5)} (structure shift)`, `منتظر شکست با کندل بسته‌شده‌ی ${lvl.toPrecision(5)} باش (تغییر ساختار)`) });
      }
    }
  };
  for (const t of cfg.triggers) mk(t);

  // ================= user-defined setups: fake break, weak pullback, range at a major level, box =================
  const n15 = c15.length, atr4 = atrAt(c4h), atr1d = atrAt(c1d), atr15 = n15 > 20 ? atrAt(c15) : 0;
  let need15 = false;
  const pxNow = live ?? c1h[c1h.length - 1].close;
  const conf15 = (side: "long" | "short"): { ok: boolean | null; text: Bi } => {
    if (!s15 || n15 < 40) return { ok: null, text: b("15M data unavailable", "داده‌ی ۱۵ دقیقه موجود نیست") };
    const L = side === "long", cl = c15[n15 - 1];
    const evOk = s15.ev && s15.ev.dir === (L ? "up" : "down") && s15.ev.age <= 4, trOk = s15.trend === (L ? "up" : "down"), candleOk = L ? cl.close > cl.open : cl.close < cl.open;
    const ok = (evOk || trOk) && candleOk;
    return { ok, text: ok ? b(`15M confirms: ${evOk ? s15.ev!.kind + " " + s15.ev!.dir : "structure " + s15.trend}, last candle ${L ? "green" : "red"}`, `۱۵ دقیقه تأیید می‌کند: ${evOk ? s15.ev!.kind + " " + s15.ev!.dir : "ساختار " + s15.trend}، کندل آخر ${L ? "سبز" : "قرمز"}`) : b("15M has not confirmed yet", "۱۵ دقیقه هنوز تأیید نکرده") };
  };
  const alignG = (side: "long" | "short") => {
    const want: Trend = side === "long" ? "up" : "down";
    return (s1h.trend === want ? 8 : s1h.trend === "range" ? 3 : 0) + (s4h.trend === want ? 6 : s4h.trend === "range" ? 2 : 0) + (s1d.trend === want ? 6 : s1d.trend === "range" ? 2 : 0);
  };
  type E2 = { side: "long" | "short"; strat: StratId; tf: "15m" | "1h" | "4h"; rows: QCandle[]; method: "immediate" | "retest" | "none"; entry: number; stop: number; confirmed: boolean; structure: number; setup: number; rej?: boolean; why: Bi[]; wait?: Bi; trigLvl?: number; zone?: { lo: number; hi: number }; tag?: Bi; lenient?: boolean; no15?: boolean; lvl?: number; tc?: boolean; c15?: { ok: boolean | null; text: Bi } };
  /** Hard rule: nothing is READY until a 1H level has been broken by a CLOSE with a good candle and above-average volume. */
  const break1h = (side: "long" | "short", extra?: number): { ok: boolean; text: Bi } => {
    const L = side === "long", n = c1h.length;
    const lv: { p: number; i: number }[] = swings(c1h, 2).filter((x) => x.t === (L ? "H" : "L")).slice(-8).map((x) => ({ p: x.p, i: x.i }));
    if (extra != null) lv.push({ p: extra, i: -1 });
    for (let j = n - 1; j >= n - 2 && j >= 22; j--) {
      const cj = c1h[j], pj = c1h[j - 1];
      const hit = lv.filter((x) => x.i < j - 1 && (L ? cj.close > x.p && pj.close <= x.p : cj.close < x.p && pj.close >= x.p)).sort((a, c) => (L ? c.p - a.p : a.p - c.p))[0];
      if (!hit) continue;
      const avg = c1h.slice(j - 20, j).reduce((a, r) => a + r.volume, 0) / 20, vr = avg > 0 ? cj.volume / avg : 0;
      if (!goodCandle(cj, side)) continue;
      if (vr < 1.3) return { ok: false, text: b(`1H closed ${L ? "above" : "below"} ${hit.p.toPrecision(5)} but volume is only ${vr.toFixed(1)}× average (need ≥ 1.3×)`, `۱ساعته ${L ? "بالای" : "پایین"} ${hit.p.toPrecision(5)} بسته شد ولی حجم فقط ${vr.toFixed(1)} برابر میانگین است (حداقل ۱.۳ لازم است)`) };
      return { ok: true, text: b(`1H BREAK: a strong candle CLOSED ${L ? "above" : "below"} ${hit.p.toPrecision(5)} with ${vr.toFixed(1)}× average volume`, `شکست ۱ساعته: کندل قوی ${L ? "بالای" : "پایین"} ${hit.p.toPrecision(5)} بسته شد با حجم ${vr.toFixed(1)} برابر میانگین`) };
    }
    return { ok: false, text: b(`No 1H level has been broken yet — wait for a strong 1H candle CLOSE ${L ? "above the last 1H high" : "below the last 1H low"} with ≥ 1.3× volume`, `هنوز هیچ سطح ۱ساعته شکسته نشده — منتظر کلوز کندل قوی ۱ساعته ${L ? "بالای آخرین سقف" : "پایین آخرین کف"} با حجم ≥ ۱.۳ برابر باش`) };
  };
  const emit2 = (o: E2) => {
    if (!cfg.on[o.strat]) return;
    const L = o.side === "long", rows = o.rows, last = rows[rows.length - 1];
    let stop = o.stop;
    const minRisk = atr1h * 0.25;
    if (Math.abs(o.entry - stop) < minRisk) stop = L ? o.entry - minRisk : o.entry + minRisk;
    const risk = Math.abs(o.entry - stop);
    const D2 = (globalThis as any).__ARCUS_DBG as ((x: string) => void) | undefined;
    if (!(risk > 0) || risk > Math.max(atr1h * 7, atr4 * 3)) { D2?.(`${o.strat} ${o.side} rejected: risk ${(risk / atr1h).toFixed(1)} ATR1h`); return; } // structural stop but never absurdly wide
    // target = the NEAREST opposing level (price must cross it first); if that pays less than 1:2 net the setup is rejected
    let tg: { tp: number; note: Bi } = target(o.side, o.entry, risk, zones, atr1h);
    if (L ? tg.tp <= o.entry : tg.tp >= o.entry) {
      if (!o.lenient) return;
      tg = { tp: L ? o.entry + risk * 3 : o.entry - risk * 3, note: b("No level ahead — projected 3R (measured)", "سطحی جلوی قیمت نیست — هدف 3R (اندازه‌گیری‌شده)") };
    }
    if (o.tc && tg.note.en.startsWith("No level")) tg = { tp: L ? o.entry + risk * 4 : o.entry - risk * 4, note: b("Open space ahead — 4R target (or trail the stop under each new higher low / above each lower high)", "فضای باز جلوی قیمت — هدف 4R (یا تریلینگ زیر هر کف بالاتر / بالای هر سقف پایین‌تر)") };
    const rr = netRR(o.entry, stop, tg.tp, cfg.costPct);
    if (rr.net < cfg.minRR && !o.lenient) { D2?.(`${o.strat} ${o.side} rejected: net R:R ${rr.net.toFixed(2)} (${tg.note.en})`); return; }
    const pa = paScore(rows, o.side, o.rej), rs = rsiScore(rows, o.side), mc = macdScore(rows, o.side), vol = volScore(rows);
    const c = o.c15 ?? conf15(o.side);
    const entryQ = o.method === "retest" ? 8 : Math.abs(pxNow - o.entry) <= atr1h * 0.5 ? 8 : Math.abs(pxNow - o.entry) <= atr1h ? 5 : 2;
    const parts = { structure: clamp(o.structure, 0, 20), setup: clamp(o.setup, 0, 20), pa: pa.pts, vol: vol.pts, rsi: rs.pts, macd: mc.pts, entryQ, rr: rr.net >= 4 ? 8 : rr.net >= 3 ? 6 : rr.net >= cfg.minRR ? 4 : 0 };
    const score = Math.round(clamp(Object.values(parts).reduce((a, v) => a + v, 0) - (c.ok === null && !o.no15 ? 5 : 0), 0, 100));
    const bk = break1h(o.side, o.lvl);
    const ready = o.confirmed && bk.ok && rr.net >= cfg.minRR && score >= cfg.minScore && (o.no15 || c.ok !== false);
    const sec = TF_SEC[o.tf], candleTime = last.time;
    sigs.push({
      id: [m.symbol, o.strat, o.side, o.tf, candleTime, ready ? "r" : "w"].join("|"), symbol: m.symbol, base: m.base, market: m.market, ex: m.ex, side: o.side, strat: o.strat, status: ready ? "ready" : "watch", method: o.method, tf: o.tf,
      d1: s1d.trend, h4: s4h.trend, h1: s1h.trend, m15: c, entry: o.entry, stop, tp: tg.tp, tpNote: tg.note, rr: rr.net, rrGross: rr.gross, score, grade: score >= 85 ? "excellent" : score >= 70 ? "good" : "watchlist", parts,
      time: (candleTime + sec) * 1000, candleTime, price: pxNow, missing: issues.slice(), zone: o.zone, trig: o.trigLvl, tag: o.tag,
      why: [bk.text, ...o.why, ...pa.notes, vol.note, rs.note, mc.note, c.text, tg.note],
      wait: !ready ? (o.confirmed && !bk.ok ? bk.text : o.wait) || (o.confirmed ? b(`Setup confirmed but ${rr.net < cfg.minRR ? `net R:R ${rr.net.toFixed(1)} is below ${cfg.minRR}` : `quality ${score}/100 is below ${cfg.minScore}`} — watch only`, `ستاپ تأیید شده ولی ${rr.net < cfg.minRR ? `R:R خالص ${rr.net.toFixed(1)} زیر ${cfg.minRR} است` : `کیفیت ${score} از ۱۰۰ زیر ${cfg.minScore} است`} — فقط مراقبت`) : b("Waiting for the confirming candle close", "منتظر بسته‌شدن کندل تأییدکننده")) : undefined,
    });
  };
  const SIDES = ["long", "short"] as const;

  // ---- 1. fake break of the last swing in a 4H trend, then a 15M range break back in the trend-reversing direction ----
  if (cfg.on.fbk && c4h.length >= 60) {
    for (const side of SIDES) {
      const L = side === "long", faked: Trend = L ? "down" : "up", want: Trend = L ? "up" : "down";
      if (s4h.trend !== faked) continue;
      const n4 = c4h.length;
      let R = NaN, jb = -1, stillBeyond = false;
      for (const sw of s4h.sw.filter((x) => x.t === (L ? "L" : "H")).slice(-4).reverse()) {
        let j = -1;
        for (let q = sw.i + 1; q < n4; q++) if (L ? c4h[q].close < sw.p : c4h[q].close > sw.p) { j = q; break; }
        if (j >= 0 && j >= n4 - 18) { R = sw.p; jb = j; stillBeyond = L ? c4h[n4 - 1].close < sw.p : c4h[n4 - 1].close > sw.p; break; }
      }
      if (jb < 0 || stillBeyond) continue;
      const seg4 = c4h.slice(jb), E = L ? Math.min(...seg4.map((r) => r.low)) : Math.max(...seg4.map((r) => r.high));
      need15 = true;
      const depth = Math.abs(R - E) / (atr4 || 1), reclaim = Math.abs(c4h[n4 - 1].close - R) / (atr4 || 1);
      const base0: Bi[] = [b(`4H trend is ${faked === "down" ? "DOWN (LH + LL)" : "UP (HH + HL)"}; the last swing ${L ? "low" : "high"} ${R.toPrecision(5)} was broken by a 4H CLOSE and price then closed back ${L ? "above" : "below"} it — a failed break (${E.toPrecision(5)} is the fake ${L ? "low" : "high"})`, `روند ۴ساعته ${faked === "down" ? "نزولی (LH + LL)" : "صعودی (HH + HL)"} است؛ آخرین ${L ? "کف" : "سقف"} ${R.toPrecision(5)} با کلوز ۴ساعته شکسته شد و قیمت دوباره ${L ? "بالای" : "پایین"} آن بسته شد — شکست کاذب (${E.toPrecision(5)} ${L ? "کف" : "سقف"}ِ فیک است)`)];
      const sSetup = 12 + (depth >= 0.3 ? 2 : 0) + (reclaim >= 0.3 ? 3 : 0) + (reclaim >= 0.8 ? 2 : 0);
      const sStruct = 8 + (s1h.trend === want ? 5 : s1h.trend === "range" ? 2 : 0) + (s1d.trend === want ? 5 : s1d.trend === "range" ? 2 : 0);
      const l15 = n15 >= 40 ? c15[n15 - 1] : null, p15 = n15 >= 40 ? c15[n15 - 2] : null;
      const box = l15 ? tightBox(c15, atr15, 6, 40, 4, c4h[jb].time) : null;
      const stop0 = L ? Math.min(E, box ? box.lo : E) - atr1h * 0.2 : Math.max(E, box ? box.hi : E) + atr1h * 0.2;
      const brk = !!(box && l15 && p15 && (L ? l15.close > box.hi && p15.close <= box.hi : l15.close < box.lo && p15.close >= box.lo) && goodCandle(l15, side));
      if (brk && l15 && box) {
        emit2({ side, strat: "fbk", tf: "15m", rows: c15, method: "immediate", entry: l15.close, stop: stop0, confirmed: true, structure: sStruct, setup: sSetup, rej: true, zone: { lo: box.lo, hi: box.hi }, c15: { ok: true, text: b(`15M range ${box.lo.toPrecision(5)}–${box.hi.toPrecision(5)} (${box.w} candles) broken by a CLOSE ${L ? "up" : "down"} with a strong candle`, `رنج ۱۵ دقیقه ${box.lo.toPrecision(5)}–${box.hi.toPrecision(5)} (${box.w} کندل) با کلوز و کندل قوی به ${L ? "بالا" : "پایین"} شکست`) }, why: base0 });
      } else if (n15 >= 40 || true) {
        emit2({ side, strat: "fbk", tf: n15 >= 40 ? "15m" : "1h", rows: n15 >= 40 ? c15 : c1h, method: "none", entry: box ? (L ? box.hi : box.lo) : pxNow, stop: stop0, confirmed: false, structure: sStruct, setup: sSetup, rej: true, lenient: true, zone: box ? { lo: box.lo, hi: box.hi } : undefined, trigLvl: box ? (L ? box.hi : box.lo) : undefined, why: base0,
          wait: box ? b(`Price is ranging ${box.lo.toPrecision(5)}–${box.hi.toPrecision(5)} on 15M — wait for a strong candle CLOSE ${L ? "above" : "below"} ${(L ? box.hi : box.lo).toPrecision(5)}`, `قیمت در ۱۵ دقیقه رنج ${box.lo.toPrecision(5)}–${box.hi.toPrecision(5)} می‌زند — منتظر کلوز قوی ${L ? "بالای" : "پایین"} ${(L ? box.hi : box.lo).toPrecision(5)} باش`) : b(`Failed break confirmed on 4H — wait for a 15M range to form and then break ${L ? "up" : "down"}`, `شکست کاذب روی ۴ساعته تأیید شد — منتظر رنج ۱۵ دقیقه و شکست آن به ${L ? "بالا" : "پایین"} باش`) });
      }
    }
  }

  // ---- 2. weak pullback inside a 4H Dow trend: join the trend early on a 15M box or a high-volume reversal candle ----
  if (cfg.on.pbw && s4h.sw.length >= 4 && c4h.length >= 60) {
    for (const side of ["short", "long"] as const) {
      const S = side === "short", need: Trend = S ? "down" : "up";
      if (s4h.trend !== need) continue;
      const sw = s4h.sw, ls = sw[sw.length - 1], pbT = S ? "H" : "L", legT = S ? "L" : "H";
      let ext: number, leg: number, ref: number;
      if (ls.t === legT) {
        const prev = sw[sw.length - 2];
        if (!prev || prev.t !== pbT) continue;
        leg = ls.p; ref = prev.p;
        const after = c4h.slice(ls.i + 1);
        if (!after.length) continue;
        ext = S ? Math.max(...after.map((r) => r.high)) : Math.min(...after.map((r) => r.low));
      } else {
        const l2 = sw[sw.length - 2], r2 = sw[sw.length - 3];
        if (!l2 || !r2 || l2.t !== legT || r2.t !== pbT) continue;
        ext = ls.p; leg = l2.p; ref = r2.p;
      }
      const fails = S ? ext < ref - 0.1 * atr4 : ext > ref + 0.1 * atr4;
      const retr = S ? (ext - leg) / (ref - leg) : (leg - ext) / (leg - ref);
      if (!fails || !(retr >= 0.15 && retr <= 0.98)) continue;
      const pos = S ? (pxNow - leg) / (ext - leg) : (leg - pxNow) / (leg - ext);
      if (!(pos >= 0.6 && pos <= 1.15)) continue;
      need15 = true;
      const why0 = b(`4H Dow trend is ${S ? "DOWN (LH + LL)" : "UP (HH + HL)"}; the pullback reached only ${(retr * 100).toFixed(0)}% of the last leg and failed to reach the previous ${S ? "high" : "low"} ${ref.toPrecision(5)} (pullback ${S ? "high" : "low"} ${ext.toPrecision(5)}) — the ${S ? "buyers" : "sellers"} are weak`, `روند داوی ۴ساعته ${S ? "نزولی (LH + LL)" : "صعودی (HH + HL)"} است؛ پولبک فقط ${(retr * 100).toFixed(0)}٪ ساق قبلی را برگشته و به ${S ? "سقف" : "کف"} قبلی ${ref.toPrecision(5)} نرسیده (${S ? "سقف" : "کف"} پولبک ${ext.toPrecision(5)}) — ${S ? "خریداران" : "فروشندگان"} ضعیف‌اند`);
      const sStruct = 10 + (s1d.trend === need ? 6 : s1d.trend === "range" ? 2 : 0) + (s1h.trend === need ? 4 : 0), sSetup = 10 + (retr <= 0.8 ? 3 : 0) + (pos >= 0.8 ? 3 : 0) + 2;
      let trig: { text: Bi; stop: number } | null = null;
      if (n15 >= 40) {
        const l = c15[n15 - 1], p = c15[n15 - 2], rng = Math.max(l.high - l.low, 1e-12);
        const wick = S ? (l.high - Math.max(l.open, l.close)) / rng : (Math.min(l.open, l.close) - l.low) / rng;
        const dirOk = S ? l.close < l.open : l.close > l.open;
        const engulf = S ? l.close < p.open && l.open >= p.close && p.close > p.open : l.close > p.open && l.open <= p.close && p.close < p.open;
        const vr = volScore(c15).ratio;
        const hiZone = S ? l.high >= leg + 0.6 * (ext - leg) : l.low <= leg - 0.6 * (leg - ext);
        const loc = S ? Math.max(...c15.slice(-6).map((r) => r.high)) : Math.min(...c15.slice(-6).map((r) => r.low));
        if (dirOk && (wick >= 0.4 || engulf) && vr >= 1.5 && hiZone) trig = { stop: loc + (S ? 1 : -1) * atr1h * 0.2, text: b(`15M reversal candle (${engulf ? "engulfing" : "long rejection wick"}) with ${vr.toFixed(1)}× volume at the top of the pullback`, `کندل برگشتی ۱۵ دقیقه (${engulf ? "انگالف" : "سایه‌ی بلند"}) با حجم ${vr.toFixed(1)} برابر در انتهای پولبک`) };
        if (!trig) {
          const bx = tightBox(c15, atr15, 6, 30, 3.5);
          if (bx && (S ? l.close < bx.lo && p.close >= bx.lo && bx.hi >= leg + 0.5 * (ext - leg) : l.close > bx.hi && p.close <= bx.hi && bx.lo <= leg - 0.5 * (leg - ext)) && goodCandle(l, side))
            trig = { stop: (S ? bx.hi : bx.lo) + (S ? 1 : -1) * atr1h * 0.2, text: b(`15M box ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} formed at the top of the pullback and broke ${S ? "down" : "up"} with a strong candle`, `باکس ۱۵ دقیقه ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} در انتهای پولبک ساخته شد و با کندل قوی به ${S ? "پایین" : "بالا"} شکست`) };
        }
        if (trig) {
          emit2({ side, strat: "pbw", tf: "15m", rows: c15, method: "immediate", entry: l.close, stop: trig.stop, confirmed: true, structure: sStruct, setup: sSetup, rej: true, c15: { ok: true, text: trig.text }, why: [why0] });
          continue;
        }
      }
      emit2({ side, strat: "pbw", tf: n15 >= 40 ? "15m" : "1h", rows: n15 >= 40 ? c15 : c1h, method: "none", entry: pxNow, stop: ext + (S ? 1 : -1) * atr1h * 0.2, confirmed: false, structure: sStruct, setup: sSetup, lenient: true, why: [why0],
        wait: b(`Price is in the ${S ? "upper" : "lower"} part of the weak pullback — wait for a 15M box break ${S ? "down" : "up"} or a high-volume reversal candle`, `قیمت در ${S ? "بالای" : "پایین"} پولبک ضعیف است — منتظر شکست باکس ۱۵ دقیقه به ${S ? "پایین" : "بالا"} یا کندل برگشتی پرحجم باش`) });
    }
  }

  // ---- 3. trend runs into a major daily level / Fibonacci zone, starts to range, then a strong 1H break decides ----
  if (cfg.on.prz && c1d.length >= 60 && c1h.length >= 60 && atr1d > 0) {
    const sw1d = swings(c1d, 5), n1 = c1h.length;
    for (const sup of [true, false]) {
      const need: Trend = sup ? "down" : "up";
      if (s4h.trend !== need && s1d.trend !== need) continue;
      const lv: { p: number; src: string; srcFa: string }[] = [];
      sw1d.filter((x) => x.t === (sup ? "L" : "H")).slice(-6).forEach((x) => lv.push({ p: x.p, src: `major daily swing ${sup ? "low" : "high"}`, srcFa: `${sup ? "کف" : "سقف"} مهم روزانه` }));
      const lastX = sw1d[sw1d.length - 1], prevX = sw1d[sw1d.length - 2];
      for (let q = sw1d.length - 1; q >= 1; q--) {
        const a = sw1d[q], bb = sw1d[q - 1];
        if (sup && a.t === "H" && bb.t === "L" && a.p - bb.p >= atr1d * 3 && pxNow < a.p) { [0.618, 0.786].forEach((r) => lv.push({ p: a.p - r * (a.p - bb.p), src: `Fibonacci ${r}`, srcFa: `فیبوناچی ${r}` })); break; }
        if (!sup && a.t === "L" && bb.t === "H" && bb.p - a.p >= atr1d * 3 && pxNow > a.p) { [0.618, 0.786].forEach((r) => lv.push({ p: a.p + r * (bb.p - a.p), src: `Fibonacci ${r}`, srcFa: `فیبوناچی ${r}` })); break; }
      }
      void lastX; void prevX;
      const hw = atr1d * 0.5, e1h = sup ? Math.min(...c1h.slice(-36).map((r) => r.low)) : Math.max(...c1h.slice(-36).map((r) => r.high));
      const hit = lv.filter((x) => Math.abs(e1h - x.p) <= hw * 1.6 && (sup ? pxNow >= x.p - hw * 1.6 : pxNow <= x.p + hw * 1.6)).sort((a, c) => Math.abs(e1h - a.p) - Math.abs(e1h - c.p));
      if (!hit.length) continue;
      need15 = true;
      const lvl = hit[0], conf = hit.filter((x) => Math.abs(x.p - lvl.p) <= hw * 1.6).length;
      const bx = tightBox(c1h, atr1h, 6, 36, 3.5);
      const near = !!bx && Math.abs((sup ? bx.lo : bx.hi) - lvl.p) <= hw * 3;
      const why0 = b(`${sup ? "Downtrend" : "Uptrend"} reached a major ${sup ? "support" : "resistance"} (PRZ) near ${lvl.p.toPrecision(5)} — ${lvl.src}${conf > 1 ? ` + ${conf - 1} more level(s) in the same area` : ""}; momentum is fading`, `${sup ? "روند نزولی" : "روند صعودی"} به ${sup ? "حمایت" : "مقاومت"} مهم (PRZ) نزدیک ${lvl.p.toPrecision(5)} رسید — ${lvl.srcFa}${conf > 1 ? ` + ${conf - 1} سطح دیگر در همین محدوده` : ""}؛ مومنتوم در حال افت است`);
      const l1 = c1h[n1 - 1], p1 = c1h[n1 - 2];
      const tag = b("PRZ", "PRZ");
      if (bx && near) {
        const up = l1.close > bx.hi && p1.close <= bx.hi && goodCandle(l1, "long"), dn = l1.close < bx.lo && p1.close >= bx.lo && goodCandle(l1, "short");
        const mkSide = (side: "long" | "short") => {
          const L = side === "long", reversal = L === sup, want: Trend = L ? "up" : "down";
          const struct = reversal ? 8 + (conf > 1 ? 4 : 0) + (s1h.trend === want ? 4 : 0) : 8 + (s4h.trend === want ? 5 : 0) + (s1d.trend === want ? 5 : 0);
          const stop = L ? bx.lo - atr1h * 0.2 : bx.hi + atr1h * 0.2;
          const fired = L ? up : dn;
          const nm: Bi = reversal ? b(`Range at the ${sup ? "support" : "resistance"} broke ${L ? "UP" : "DOWN"} with a strong candle — ${sup ? "buyers" : "sellers"} took over (reversal)`, `رنج در ${sup ? "حمایت" : "مقاومت"} با کندل قوی به ${L ? "بالا" : "پایین"} شکست — ${sup ? "خریداران" : "فروشندگان"} قدرت گرفتند (برگشت)`) : b(`Range at the ${sup ? "support" : "resistance"} broke ${L ? "UP" : "DOWN"} — the ${sup ? "sellers" : "buyers"} regained control, the trend continues`, `رنج در ${sup ? "حمایت" : "مقاومت"} به ${L ? "بالا" : "پایین"} شکست — ${sup ? "فروشندگان" : "خریداران"} دوباره غالب شدند، روند ادامه دارد`);
          emit2({ side, strat: "prz", tf: "1h", rows: c1h, method: fired ? "immediate" : "none", entry: fired ? l1.close : L ? bx.hi : bx.lo, stop, confirmed: fired, structure: struct, setup: 12 + (conf > 1 ? 3 : 0) + (bx.w >= 12 ? 3 : 0), rej: reversal, zone: { lo: bx.lo, hi: bx.hi }, lvl: L ? bx.hi : bx.lo, trigLvl: fired ? undefined : L ? bx.hi : bx.lo, tag, lenient: !fired, why: fired ? [why0, nm] : [why0],
            wait: fired ? undefined : b(`Ranging ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} on 1H at the level — a strong CLOSE ${L ? "above" : "below"} ${(L ? bx.hi : bx.lo).toPrecision(5)} = ${L ? "LONG" : "SHORT"}`, `رنج ۱ساعته ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} در سطح — کلوز قوی ${L ? "بالای" : "پایین"} ${(L ? bx.hi : bx.lo).toPrecision(5)} = ${L ? "لانگ" : "شورت"}`) });
        };
        mkSide("long");
        mkSide("short");
      }
    }
  }

  // ---- 4. boxes: >=2 touches of the top and >=2 of the bottom (1% tolerance); a CLOSE outside = signal, main-trend direction preferred ----
  if (cfg.on.box) {
    for (const trig of cfg.triggers) {
      const rows = trig === "1h" ? c1h : c4h, atrT = atrAt(rows);
      if (rows.length < 40 || !(atrT > 0)) continue;
      const bx = touchBox(rows);
      if (!bx) continue;
      const n = rows.length, last = rows[n - 1], prev = rows[n - 2], h = bx.hi - bx.lo, mid = bx.lo + h * 0.5;
      const bias: Trend = s1d.trend !== "range" ? s1d.trend : s4h.trend;
      const label = b(`Box ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} on ${trig.toUpperCase()}: ${bx.tops} touches of the top, ${bx.bots} of the bottom (1% tolerance), ${bx.w} candles`, `باکس ${bx.lo.toPrecision(5)}–${bx.hi.toPrecision(5)} در ${trig.toUpperCase()}: ${bx.tops} برخورد به سقف، ${bx.bots} به کف (تلورانس ۱٪)، ${bx.w} کندل`);
      const tag = b("Box", "باکس");
      const recent = rows.slice(-4, -1);
      const failedUp = recent.some((r) => r.close > bx.hi) && prev.close <= bx.hi && last.close <= bx.hi, failedDn = recent.some((r) => r.close < bx.lo) && prev.close >= bx.lo && last.close >= bx.lo;
      const fire = (side: "long" | "short") => {
        const L = side === "long", out = L ? last.close > bx.hi && prev.close <= bx.hi : last.close < bx.lo && prev.close >= bx.lo;
        if (!out) return false;
        if (L ? failedUp : failedDn) return false;
        const want: Trend = L ? "up" : "down", withTrend = bias === want, against = bias !== "range" && !withTrend;
        const over = Math.abs(last.close - (L ? bx.hi : bx.lo)) > atrT * 1.2;
        const c = conf15(side);
        const stop = L ? mid - atrT * 0.2 : mid + atrT * 0.2;
        const trendWhy = withTrend ? b(`With the main trend (${want === "up" ? "1D/4H up" : "1D/4H down"}) — higher reliability`, `هم‌جهت با روند اصلی (${want === "up" ? "۱D/۴H صعودی" : "۱D/۴H نزولی"}) — اعتبار بیشتر`) : against ? b("AGAINST the main trend — needs the 15M to confirm", "خلاف روند اصلی — نیاز به تأیید ۱۵ دقیقه") : b("Main trend is a range", "روند اصلی رنج است");
        const ok = !over && goodCandle(last, side) && (!against || c.ok === true);
        emit2({ side, strat: "box", tf: trig, rows, method: over ? "retest" : "immediate", entry: over ? (L ? bx.hi : bx.lo) : last.close, stop, confirmed: ok, structure: alignG(side) + (withTrend ? 2 : 0), setup: 10 + Math.min(6, bx.tops + bx.bots) + (bx.w >= 36 ? 2 : 0), zone: { lo: bx.lo, hi: bx.hi }, lvl: L ? bx.hi : bx.lo, trigLvl: over ? (L ? bx.hi : bx.lo) : undefined, tag, lenient: !ok, no15: !against, why: [label, b(`A ${trig.toUpperCase()} candle CLOSED ${L ? "above the top" : "below the bottom"} of the box`, `کندل ${trig.toUpperCase()} ${L ? "بالای سقف" : "پایین کف"} باکس بسته شد`), trendWhy],
          wait: over ? b(`Broke out but already extended — wait for a retest of ${(L ? bx.hi : bx.lo).toPrecision(5)} that holds`, `شکست انجام شد ولی کشیده است — منتظر ریتست ${(L ? bx.hi : bx.lo).toPrecision(5)} باش که نگه دارد`) : against && c.ok !== true ? b("Against the main trend — waiting for the 15M to confirm", "خلاف روند اصلی — منتظر تأیید ۱۵ دقیقه") : undefined });
        return true;
      };
      if (fire("long") || fire("short")) continue;
      if (last.close <= bx.hi && last.close >= bx.lo) {
        const pos = (last.close - bx.lo) / (h || 1);
        const side: "long" | "short" = bias === "up" ? "long" : bias === "down" ? "short" : pos >= 0.5 ? "long" : "short", L = side === "long";
        need15 = need15 || pos > 0.8 || pos < 0.2;
        emit2({ side, strat: "box", tf: trig, rows, method: "none", entry: L ? bx.hi : bx.lo, stop: L ? mid - atrT * 0.2 : mid + atrT * 0.2, confirmed: false, structure: alignG(side), setup: 10 + Math.min(6, bx.tops + bx.bots), lenient: true, zone: { lo: bx.lo, hi: bx.hi }, trigLvl: L ? bx.hi : bx.lo, tag,
          why: [label, b(`Price is inside the box (${(pos * 100).toFixed(0)}% from the bottom); main trend: ${bias === "up" ? "up" : bias === "down" ? "down" : "range"}`, `قیمت داخل باکس است (${(pos * 100).toFixed(0)}٪ از کف)؛ روند اصلی: ${bias === "up" ? "صعودی" : bias === "down" ? "نزولی" : "رنج"}`)],
          wait: b(`Waiting for a candle CLOSE ${L ? "above" : "below"} ${(L ? bx.hi : bx.lo).toPrecision(5)} (the main-trend side is preferred; a close ${L ? "below" : "above"} ${(L ? bx.lo : bx.hi).toPrecision(5)} gives the opposite signal)`, `منتظر کلوز کندل ${L ? "بالای" : "پایین"} ${(L ? bx.hi : bx.lo).toPrecision(5)} (سمت روند اصلی اولویت دارد؛ کلوز ${L ? "پایین" : "بالای"} ${(L ? bx.lo : bx.hi).toPrecision(5)} سیگنال مخالف می‌دهد)`) });
      }
    }
  }
  // ---- Tradecity swing price-action skill (codable subset): level breakout, momentum candle setup, fake-out ----
  if ((cfg.on.tca || cfg.on.tcb || cfg.on.tcf) && c1h.length >= 60) {
    const tcTag = b("Tradecity", "تریدسیتی"), n = c1h.length, last = c1h[n - 1], prev = c1h[n - 2];
    const pv = swings(c1h, 5);
    const avg20 = c1h.slice(n - 21, n - 1).reduce((a, r) => a + r.volume, 0) / 20, vr = avg20 > 0 ? last.volume / avg20 : 0;
    for (const side of SIDES) {
      const L = side === "long", want: Trend = L ? "up" : "down";
      if (s1d.trend !== want || s4h.trend !== want) continue; // strict: never trade against the 1D + 4H trend
      const sgn = L ? 1 : -1;
      const trendWhy = b(`1D and 4H are both ${L ? "HH + HL (uptrend)" : "LH + LL (downtrend)"} — only ${L ? "longs" : "shorts"} are allowed`, `۱D و ۴H هر دو ${L ? "HH + HL (صعودی)" : "LH + LL (نزولی)"} هستند — فقط ${L ? "لانگ" : "شورت"} مجاز است`);
      const lastPivStop = pv.filter((x) => x.t === (L ? "L" : "H") && (L ? x.p < last.close : x.p > last.close)).slice(-1)[0];
      // A. breakout of the last pivot with volume
      const lvA = pv.filter((x) => x.t === (L ? "H" : "L")).slice(-1)[0];
      if (cfg.on.tca && lvA && lastPivStop) {
        const brk = L ? last.close > lvA.p && prev.close <= lvA.p : last.close < lvA.p && prev.close >= lvA.p;
        const over = Math.abs(last.close - lvA.p) > atr1h * 1.2, near = Math.abs(last.close - lvA.p) <= atr1h * 1.0 && (L ? last.close <= lvA.p : last.close >= lvA.p);
        const stop = lastPivStop.p - sgn * atr1h * 0.2;
        if (brk) emit2({ side, strat: "tca", tf: "1h", rows: c1h, method: over ? "retest" : "immediate", entry: over ? lvA.p : last.close, stop, confirmed: vr >= 1.5 && !over, structure: 16 + 2, setup: 12 + (vr >= 2 ? 4 : 0) + (vr >= 3 ? 2 : 0), tag: tcTag, tc: true, lvl: lvA.p, lenient: vr < 1.5 || over, trigLvl: over ? lvA.p : undefined, why: [trendWhy, b(`1H CLOSE ${L ? "above" : "below"} the last pivot ${lvA.p.toPrecision(5)} with ${vr.toFixed(1)}× its 20-bar average volume (needs ≥ 1.5×)`, `کلوز ۱ساعته ${L ? "بالای" : "پایین"} آخرین پیوت ${lvA.p.toPrecision(5)} با حجم ${vr.toFixed(1)} برابر میانگین ۲۰ کندل (حداقل ۱.۵ لازم است)`)], wait: over ? b(`Broke out but extended — wait for a retest of ${lvA.p.toPrecision(5)} that holds`, `شکست انجام شد ولی کشیده است — منتظر ریتست ${lvA.p.toPrecision(5)} باش که نگه دارد`) : b(`Closed beyond the pivot but volume is only ${vr.toFixed(1)}× (need ≥ 1.5×)`, `بیرون پیوت بسته شد ولی حجم فقط ${vr.toFixed(1)} برابر است (حداقل ۱.۵)`) });
        else if (near) emit2({ side, strat: "tca", tf: "1h", rows: c1h, method: "none", entry: lvA.p, stop, confirmed: false, structure: 16, setup: 10, tag: tcTag, tc: true, lvl: lvA.p, lenient: true, trigLvl: lvA.p, why: [trendWhy, b(`Price is within 1 ATR of the last 1H pivot ${lvA.p.toPrecision(5)}`, `قیمت کمتر از ۱ ATR تا آخرین پیوت ۱ساعته ${lvA.p.toPrecision(5)} فاصله دارد`)], wait: b(`Wait for a 1H CLOSE ${L ? "above" : "below"} ${lvA.p.toPrecision(5)} with volume ≥ 1.5× average`, `منتظر کلوز ۱ساعته ${L ? "بالای" : "پایین"} ${lvA.p.toPrecision(5)} با حجم ≥ ۱.۵ برابر میانگین باش`) });
      }
      // B. momentum candle setup: pullback on falling volume, then an engulfing candle with returning volume, RSI on the trend side of 50
      if (cfg.on.tcb && lastPivStop) {
        const eng = L ? last.close > prev.open && last.open <= prev.close && prev.close < prev.open && last.close > last.open : last.close < prev.open && last.open >= prev.close && prev.close > prev.open && last.close < last.open;
        const pb = L ? c1h[n - 2].close < c1h[n - 7].close : c1h[n - 2].close > c1h[n - 7].close;
        const v1 = c1h.slice(n - 4, n - 1).reduce((a, r) => a + r.volume, 0) / 3, v0 = c1h.slice(n - 7, n - 4).reduce((a, r) => a + r.volume, 0) / 3;
        const rsiV = rsiArr(c1h.map((r) => r.close)).slice(-1)[0], rsiOk = L ? rsiV > 50 : rsiV < 50;
        if (eng && pb && v1 < v0 && vr >= 1 && rsiOk) {
          const stop = Math.min(L ? last.low : Infinity, L ? prev.low : Infinity, ...(L ? [lastPivStop.p] : [])) - (L ? atr1h * 0.2 : 0);
          const stopS = L ? stop : Math.max(last.high, prev.high) + atr1h * 0.2;
          emit2({ side, strat: "tcb", tf: "1h", rows: c1h, method: "immediate", entry: last.close, stop: L ? stop : stopS, confirmed: true, structure: 18, setup: 12 + (vr >= 1.5 ? 3 : 0) + (Math.abs(last.close - last.open) >= atr1h * 0.8 ? 3 : 0), tag: tcTag, tc: true, why: [trendWhy, b(`Pullback on falling volume (${v1.toFixed(0)} vs ${v0.toFixed(0)}), then a 1H ${L ? "bullish" : "bearish"} engulfing candle with ${vr.toFixed(1)}× volume; RSI ${rsiV.toFixed(0)} is on the trend side of 50`, `پولبک با حجم کاهشی (${v1.toFixed(0)} در برابر ${v0.toFixed(0)})، سپس کندل انگالف ${L ? "صعودی" : "نزولی"} ۱ساعته با حجم ${vr.toFixed(1)} برابر؛ RSI ${rsiV.toFixed(0)} سمت روند نسبت به ۵۰ است`)] });
        }
      }
      // C. fake-out of a pivot level, entering back in the trend direction
      if (cfg.on.tcf) {
        for (const lv of pv.filter((x) => x.t === (L ? "L" : "H")).slice(-6).reverse()) {
          let jb = -1;
          for (let q = Math.max(lv.i + 1, n - 9); q < n - 1; q++) if (L ? c1h[q].close < lv.p : c1h[q].close > lv.p) { jb = q; break; }
          if (jb < 0) continue;
          const back = L ? last.close > lv.p : last.close < lv.p;
          const engF = L ? last.close > prev.open && last.close > last.open : last.close < prev.open && last.close < last.open;
          if (!back || !engF || !goodCandle(last, side)) continue;
          const seg = c1h.slice(jb), ext = L ? Math.min(...seg.map((r) => r.low)) : Math.max(...seg.map((r) => r.high));
          const rsiV = rsiArr(c1h.map((r) => r.close)).slice(-1)[0];
          emit2({ side, strat: "tcf", tf: "1h", rows: c1h, method: "immediate", entry: last.close, stop: ext - sgn * atr1h * 0.2, confirmed: true, structure: 18, setup: 12 + (vr >= 1.3 ? 3 : 0) + ((L ? rsiV > 45 : rsiV < 55) ? 3 : 0), rej: true, tag: tcTag, tc: true, lvl: lv.p, why: [trendWhy, b(`Fake-out: a 1H close broke the pivot ${lv.p.toPrecision(5)} (extreme ${ext.toPrecision(5)}), failed, and a strong ${L ? "bullish" : "bearish"} candle brought price back ${L ? "above" : "below"} it — RSI ${rsiV.toFixed(0)}`, `فیک‌اوت: کلوز ۱ساعته پیوت ${lv.p.toPrecision(5)} را شکست (انتها ${ext.toPrecision(5)})، ناموفق بود و کندل قوی ${L ? "صعودی" : "نزولی"} قیمت را ${L ? "بالای" : "پایین"} آن برگرداند — RSI ${rsiV.toFixed(0)}`)] });
          break;
        }
      }
    }
  }
  info.need15 = need15;

  // keep the best signal per (symbol, strategy, side, status); ready beats watch
  const best = new Map<string, Sig2>();
  for (const s of sigs) {
    const k = s.strat + s.side + s.tf + (s.status2 ? "c" : "");
    const o = best.get(k);
    if (!o || (s.status === "ready" && o.status !== "ready") || (s.status === o.status && s.score > o.score)) best.set(k, s);
  }
  return { sigs: Array.from(best.values()), info };
}
