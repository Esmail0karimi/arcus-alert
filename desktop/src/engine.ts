/* Multi-timeframe momentum engine (Dow theory + price action).
   Hierarchy: 1D = primary trend + major levels, 4H = intermediate trend / BOS / CHoCH / zones, 1H = trigger, 15M = entry confirmation.
   Strategies: breakout, false breakout, V-shaped reversal, momentum shift (countertrend allowed).
   Rules: only CLOSED candles confirm anything; indicators (volume / RSI / MACD) only add score, they never create an entry;
   a trade needs a structural stop, a real target, net R:R >= 2 (after costs) and a score >= 70 to be "ready"; everything else is watchlist or rejected. */
import { Bi, TF_SEC } from "./agent";
import type { QCandle } from "./qfex";

const b = (en: string, fa: string): Bi => ({ en, fa });
export type Trend = "up" | "down" | "range";
export type StratId = "brk" | "fbo" | "vsh" | "mom";
export type Status = "ready" | "watch";
export type TfKey = "1d" | "4h" | "1h" | "15m";
export type Candles = Partial<Record<TfKey, QCandle[]>>;
export const STRATS: Record<StratId, { name: Bi; basis: Bi }> = {
  brk: { name: b("Breakout", "شکست سطح"), basis: b("A candle CLOSED beyond a key support/resistance zone (a wick is not enough); immediate or retest entry", "بسته‌شدن کندل بیرون از ناحیه‌ی مهم حمایت/مقاومت (سایه کافی نیست)؛ ورود فوری یا با ریتست") },
  fbo: { name: b("False breakout", "شکست کاذب"), basis: b("Price closed beyond a level, then closed back inside it and was rejected — trade the failure", "قیمت بیرون سطح بسته شد، بعد دوباره داخل برگشت و پس زده شد — معامله روی شکست ناموفق") },
  vsh: { name: b("V-shaped reversal", "بازگشت V شکل"), basis: b("A fast, deep move then a fast reversal back toward the origin of the move", "حرکت سریع و عمیق و بعد برگشت سریع به‌سمت مبدأ همان حرکت") },
  mom: { name: b("Momentum shift", "تغییر مومنتوم"), basis: b("Structure flips on the 1H (BOS/CHoCH) and the 15M confirms — can be against the 1D/4H trend", "ساختار ۱ساعته می‌چرخد (BOS/CHoCH) و ۱۵ دقیقه تأیید می‌کند — می‌تواند خلاف روند ۱D/۴H باشد") },
};
export type Cfg = { triggers: ("1h" | "4h")[]; costPct: number; minRR: number; minScore: number; on: Record<StratId, boolean> };
export const DEF_CFG: Cfg = { triggers: ["1h"], costPct: 0.1, minRR: 2, minScore: 70, on: { brk: true, fbo: true, vsh: true, mom: true } };
export type Sig2 = {
  id: string; symbol: string; base: string; market: string; ex: string;
  side: "long" | "short"; strat: StratId; status: Status; method: "immediate" | "retest" | "none"; tf: string;
  d1: Trend | null; h4: Trend | null; h1: Trend | null; m15: { ok: boolean | null; text: Bi };
  entry: number; stop: number; tp: number; tpNote: Bi; rr: number; rrGross: number;
  score: number; grade: "excellent" | "good" | "watchlist";
  parts: { structure: number; setup: number; pa: number; vol: number; rsi: number; macd: number; entryQ: number; rr: number };
  time: number; candleTime: number; price: number; why: Bi[]; wait?: Bi; trig?: number; missing: string[]; zone?: { lo: number; hi: number }; status2?: Bi;
};
export type SymInfo = { symbol: string; base: string; market: string; ex: string; d1: Trend | null; h4: Trend | null; h1: Trend | null; issues: string[]; stale: boolean; price: number | null };

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

  // keep the best signal per (symbol, strategy, side, status); ready beats watch
  const best = new Map<string, Sig2>();
  for (const s of sigs) {
    const k = s.strat + s.side + s.tf + (s.status2 ? "c" : "");
    const o = best.get(k);
    if (!o || (s.status === "ready" && o.status !== "ready") || (s.status === o.status && s.score > o.score)) best.set(k, s);
  }
  return { sigs: Array.from(best.values()), info };
}
