/* EXPERIMENTAL: extra exchanges. Each adapter gives live prices and (optionally) candle history.
   Symbols are namespaced with the adapter prefix so they never collide with Arcus symbols. */
import { QFEX_PREFIX, startQfexFeed, fetchQfexCandles, type QCandle } from "./qfex";

export type Tick = { marketDisplayName: string; marketId: string; markPrice: number; timestamp: number; change24h?: number };
export type SymRow = { name: string; cat: string; change?: number };
export type Adapter = {
  id: string;
  label: string;
  prefix: string;
  /** category used when the exchange gives none */
  defaultCat: "Crypto" | "Stocks";
  start: (onPrices: (t: Tick[]) => void, onSymbols: (r: SymRow[]) => void, onStatus: (m: string) => void) => () => void;
  candles?: (symbol: string, tf: string, signal?: AbortSignal) => Promise<QCandle[]>;
  /** no usable 24h change / history from the exchange: derive them from prices this app saved itself */
  ownHistory?: boolean;
};

/* ---- own price samples (every ~10 min, kept 26 h) -> 24h change and coarse candles ---- */
const SKEY = "arcus.samples.v1", SAMPLE_MS = 10 * 60 * 1000, KEEP_MS = 26 * 3600 * 1000;
let store: Record<string, [number, number][]> = {};
try { store = JSON.parse(localStorage.getItem(SKEY) || "{}") || {}; } catch { store = {}; }
let dirty = false;
const saveStore = () => {
  if (!dirty) return;
  dirty = false;
  try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch {}
};
if (typeof window !== "undefined") {
  window.setInterval(saveStore, 60000);
  window.addEventListener("beforeunload", saveStore);
}
export function recordSample(name: string, price: number, now = Date.now()) {
  const arr = store[name] || (store[name] = []);
  const last = arr[arr.length - 1];
  if (last && now - last[0] < SAMPLE_MS) return;
  arr.push([now, price]);
  while (arr.length && arr[0][0] < now - KEEP_MS) arr.shift();
  dirty = true;
}
/** % change versus ~24 h ago; null until at least 22 h of own history exist */
export function ownChange24h(name: string, price: number, now = Date.now()): number | null {
  const arr = store[name];
  if (!arr || arr.length < 2 || arr[0][0] > now - 22 * 3600 * 1000) return null;
  let base = arr[0];
  for (const s of arr) if (Math.abs(s[0] - (now - 24 * 3600 * 1000)) < Math.abs(base[0] - (now - 24 * 3600 * 1000))) base = s;
  return base[1] > 0 ? (price / base[1] - 1) * 100 : null;
}
export function sampleCandles(name: string, tf: string): QCandle[] {
  const sp = SPAN[tf] || 900;
  const out: QCandle[] = [];
  for (const [t, p] of store[name] || []) {
    const b = Math.floor(t / 1000 / sp) * sp, last = out[out.length - 1];
    if (last && last.time === b) {
      last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.close = p;
    } else out.push({ time: b, open: p, high: p, low: p, close: p, volume: 0 });
  }
  return out;
}

const SPAN: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800,
};
const num = (v: any) => Number(v);
const cleanCandles = (rows: QCandle[]) =>
  rows
    .filter((c) => c.time > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time)
    .filter((c, i, a) => !i || c.time > a[i - 1].time);
const toSec = (v: any) => {
  const n = Number(v);
  return n > 1e14 ? n / 1e9 : n > 1e11 ? n / 1000 : n;
};
const netErr = (name: string, e: any) =>
  e instanceof TypeError ? name + " blocked by the browser (CORS/network)" : name + " error: " + (e?.message || "");

/** Generic live socket with reconnect. */
function socket(url: string, onOpen: (ws: WebSocket) => void, onMsg: (m: any) => void) {
  let stopped = false, ws: WebSocket | null = null, retry = 1000, timer: number | undefined;
  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
      ws.onopen = () => { retry = 1000; onOpen(ws!); };
      ws.onmessage = (e) => { try { onMsg(JSON.parse(String(e.data))); } catch {} };
      ws.onclose = () => { if (!stopped) { timer = window.setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } };
      ws.onerror = () => {};
    } catch {
      timer = window.setTimeout(connect, retry);
    }
  };
  connect();
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); }
  };
}

/* ---------------- Hyperliquid ---------------- */
const HL = "https://api.hyperliquid.xyz/info";
const HL_P = "HL:";
const hlCoin: Record<string, string> = {}; // upper-case key -> exact coin name (e.g. kPEPE)
let hlKnown = false;
const hlChange: Record<string, number> = {}; // upper-case coin -> 24h % (also used as a proxy for Variational)
let hlWsPost: ((payload: any) => Promise<any>) | null = null;
const hlPostRest = async (body: any, signal?: AbortSignal) => {
  const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error("Hyperliquid HTTP " + r.status);
  return r.json();
};
/** Info request: over the already-open WebSocket first (works where the REST host is blocked), REST second. */
const hlPost = async (body: any, signal?: AbortSignal) => {
  if (hlWsPost) {
    try {
      return await hlWsPost(body);
    } catch {}
  }
  return hlPostRest(body, signal);
};
const hyperliquid: Adapter = {
  id: "hl", label: "Hyperliquid", prefix: HL_P, defaultCat: "Crypto",
  start(onPrices, onSymbols, onStatus) {
    let lastWs = 0, known = 0;
    const out = (coin: string, px: number) =>
      onPrices([{ marketDisplayName: HL_P + coin.toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000 }]);
    const poll = async () => {
      try {
        const [meta, ctxs] = await hlPost({ type: "metaAndAssetCtxs" });
        const list: Tick[] = [], rows: SymRow[] = [];
        (meta.universe || []).forEach((u: any, i: number) => {
          if (u.isDelisted) return;
          const px = num(ctxs[i]?.markPx);
          const prev = num(ctxs[i]?.prevDayPx);
          hlCoin[String(u.name).toUpperCase()] = String(u.name);
          if (px > 0 && prev > 0) hlChange[String(u.name).toUpperCase()] = ((px - prev) / prev) * 100;
          rows.push({
            name: HL_P + String(u.name).toUpperCase(),
            cat: "",
            change: px > 0 && prev > 0 ? ((px - prev) / prev) * 100 : undefined,
          });
          if (px > 0)
            list.push({
              marketDisplayName: HL_P + String(u.name).toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000,
              change24h: prev > 0 ? (px / prev - 1) * 100 : undefined,
            });
        });
        known = rows.length;
        hlKnown = known > 0;
        onSymbols(rows);
        if (list.length && Date.now() - lastWs > 20000) onPrices(list);
        onStatus("Hyperliquid · " + known + " markets (live)");
      } catch (e: any) { onStatus(netErr("Hyperliquid", e)); }
    };
    void poll();
    const t = window.setInterval(poll, 30000);
    let wsNow: WebSocket | null = null, reqId = 1;
    const pending: Record<number, (v: any) => void> = {};
    hlWsPost = (payload: any) =>
      new Promise((resolve, reject) => {
        if (!wsNow || wsNow.readyState !== 1) return reject(new Error("socket not open"));
        const id = reqId++;
        const timer = window.setTimeout(() => { delete pending[id]; reject(new Error("timeout")); }, 12000);
        pending[id] = (v) => { window.clearTimeout(timer); resolve(v); };
        wsNow.send(JSON.stringify({ method: "post", id, request: { type: "info", payload } }));
      });
    const stop = socket("wss://api.hyperliquid.xyz/ws",
      (ws) => {
        wsNow = ws;
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } }));
        window.setTimeout(poll, 300);
      },
      (m) => {
        if (m?.channel === "post" && m?.data?.id != null) {
          const pl = m.data.response?.payload;
          pending[m.data.id]?.(pl && pl.data !== undefined ? pl.data : pl);
          delete pending[m.data.id];
          return;
        }
        const mids = m?.channel === "allMids" ? m?.data?.mids : null;
        if (!mids) return;
        lastWs = Date.now();
        const list: Tick[] = [];
        for (const k of Object.keys(mids)) {
          // spot pairs ("@107", "PURR/USDC") and prediction/outcome markets ("#114911") are not perpetuals
          if (k.startsWith("@") || k.startsWith("#") || k.includes("/") || k.includes(":")) continue;
          if (hlKnown && !hlCoin[k.toUpperCase()]) continue;
          const px = num(mids[k]);
          if (px > 0) list.push({ marketDisplayName: HL_P + k.toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000 });
        }
        if (list.length) onPrices(list);
      });
    return () => { window.clearInterval(t); hlWsPost = null; stop(); };
  },
  candles: (symbol, tf, signal) => hlCandles(symbol.slice(HL_P.length), tf, signal),
};
/** Map another exchange's base name to a Hyperliquid coin (kPEPE, 1000PEPE, ...). */
const hlMatch = (base: string): string | null => {
  const b = base.toUpperCase();
  const tries = [b, "K" + b, b.replace(/^1000/, "K"), b.replace(/^K(?=[A-Z])/, ""), b.replace(/^1M/, "K")];
  for (const t of tries) if (hlCoin[t]) return t;
  return null;
};
async function hlCandles(coinKey: string, tf: string, signal?: AbortSignal): Promise<QCandle[]> {
  {
    const interval = SPAN[tf] ? tf : "15m";
    const end = Date.now();
    const rows = await hlPost({ type: "candleSnapshot", req: { coin: hlCoin[coinKey.toUpperCase()] || coinKey, interval, startTime: end - SPAN[interval] * 1000 * 1500, endTime: end } }, signal);
    return cleanCandles((Array.isArray(rows) ? rows : []).map((c: any) => ({ time: Math.floor(num(c.t) / 1000), open: num(c.o), high: num(c.h), low: num(c.l), close: num(c.c), volume: num(c.v) })));
  }
}

/* ---------------- Lighter ---------------- */
const LT = "https://mainnet.zklighter.elliot.ai";
const LT_P = "LT:";
const ltIds: Record<string, number> = {};
const lighter: Adapter = {
  id: "lt", label: "Lighter", prefix: LT_P, defaultCat: "Crypto",
  start(onPrices, onSymbols, onStatus) {
    const seen = new Set<string>();
    let lastMsg = 0;
    const handleStat = (s: any) => {
      if (!s || typeof s !== "object") return;
      if (s.symbol != null && (s.mark_price != null || s.last_trade_price != null || s.index_price != null)) {
        const name = LT_P + String(s.symbol).toUpperCase();
        const px = num(s.mark_price ?? s.last_trade_price ?? s.index_price);
        if (s.market_id != null) ltIds[name] = Number(s.market_id);
        if (!seen.has(name)) { seen.add(name); onSymbols([{ name, cat: "" }]); }
        if (px > 0) {
          lastMsg = Date.now();
          const ch = Number(s.daily_price_change ?? s.price_change_24h);
          onPrices([{ marketDisplayName: name, marketId: "LT", markPrice: px, timestamp: Date.now() / 1000, change24h: Number.isFinite(ch) ? ch : undefined }]);
        }
      } else for (const v of Object.values(s)) if (v && typeof v === "object") handleStat(v);
    };
    const stop = socket(LT.replace("https", "wss") + "/stream?readonly=true",
      (ws) => ws.send(JSON.stringify({ type: "subscribe", channel: "market_stats/all" })),
      (m) => { if (m?.market_stats) handleStat(m.market_stats); });
    const t = window.setInterval(() => {
      onStatus(Date.now() - lastMsg < 20000 && seen.size ? "Lighter · " + seen.size + " markets (live)" : "Lighter error: no data from the WebSocket yet");
    }, 4000);
    onStatus("Lighter · connecting…");
    return () => { window.clearInterval(t); stop(); };
  },
  async candles(symbol, tf, signal) {
    const res = ["1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d"].includes(tf) ? tf : "";
    if (!res) throw new Error("Lighter does not offer timeframe " + tf);
    const id = ltIds[symbol];
    if (id == null) throw new Error("Lighter market id not known yet for " + symbol);
    const end = Date.now(), want = 500;
    const r = await fetch(LT + "/api/v1/candles?market_id=" + id + "&resolution=" + res + "&start_timestamp=" + (end - SPAN[tf] * 1000 * want) + "&end_timestamp=" + end + "&count_back=" + want, { signal });
    if (!r.ok) throw new Error("Lighter HTTP " + r.status);
    const body = await r.json();
    const arr = body?.candlesticks || body?.candles || body?.c || [];
    return cleanCandles(arr.map((c: any) => ({
      time: Math.floor(toSec(c.timestamp ?? c.t ?? c.time)),
      open: num(c.open ?? c.o), high: num(c.high ?? c.h), low: num(c.low ?? c.l), close: num(c.close ?? c.c),
      volume: num(c.volume0 ?? c.volume ?? c.v ?? 0),
    })));
  },
};

/* ---------------- Variational (prices only, no candle history is published) ---------------- */
const VR_P = "VR:";
const variational: Adapter = {
  id: "vr", label: "Variational", prefix: VR_P, defaultCat: "Crypto", ownHistory: true,
  start(onPrices, onSymbols, onStatus) {
    let nextAt = 0;
    const poll = async () => {
      if (Date.now() < nextAt) return;
      try {
        const r = await fetch("https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/v2/stats");
        if (r.status === 429) { nextAt = Date.now() + 10000; return; }
        if (!r.ok) throw new Error("Variational HTTP " + r.status);
        const body = await r.json();
        const list: Tick[] = [], rows: SymRow[] = [];
        for (const l of body?.listings || []) {
          const name = VR_P + String(l.ticker).toUpperCase();
          rows.push({ name, cat: "" });
          const px = num(l.mark_price);
          const hk = hlMatch(String(l.ticker).split("-")[0]);
          const ch = hk ? hlChange[hk] : undefined;
          if (px > 0) list.push({ marketDisplayName: name, marketId: "VR", markPrice: px, timestamp: Date.now() / 1000, change24h: ch });
        }
        onSymbols(rows);
        onPrices(list);
        onStatus("Variational · " + rows.length + " markets");
      } catch (e: any) { onStatus(netErr("Variational", e)); }
    };
    void poll();
    const t = window.setInterval(poll, 2000);
    return () => window.clearInterval(t);
  },
};

/* ---------------- QFEX ---------------- */
/* QFEX's own candle API sits behind an anti-bot challenge a web page cannot pass. Stocks/commodities are also traded
   on Hyperliquid's HIP-3 "xyz" dex, so its candles of the same asset are used as history (live bars stay QFEX). */
export const candleNote: Record<string, string> = {};
let xyzMap: Record<string, string> | null = null, xyzLoading: Promise<void> | null = null;
const XYZ_ALIAS: Record<string, string[]> = { XAU: ["GOLD", "XAU"], XAG: ["SILVER", "XAG"], XPT: ["PLATINUM"], XPD: ["PALLADIUM"], WTI: ["CL", "OIL", "WTI"], BRENT: ["BRENTOIL", "BRENT"], NG: ["NATGAS", "NG"] };
const loadXyz = () =>
  (xyzLoading ||= (async () => {
    try {
      const meta = await hlPost({ type: "meta", dex: "xyz" });
      const map: Record<string, string> = {};
      for (const u of meta?.universe || []) {
        const name = String(u.name);
        const base = (name.includes(":") ? name.split(":")[1] : name).toUpperCase();
        map[base] = name;
        hlCoin[name.toUpperCase()] = name;
      }
      xyzMap = map;
    } catch {
      xyzLoading = null; // retry next time
    }
  })());
const xyzFor = async (base: string) => {
  await loadXyz();
  if (!xyzMap) return null;
  for (const t of [base, ...(XYZ_ALIAS[base] || [])]) if (xyzMap[t]) return xyzMap[t];
  return null;
};
/* Binance USDⓈ-M futures (public, CORS-enabled): gold/silver and some stock perps exist as <BASE>USDT. */
async function binanceCandles(base: string, tf: string, signal?: AbortSignal): Promise<QCandle[]> {
  const interval = SPAN[tf] ? tf : "15m";
  const sym = base.toUpperCase() + "USDT";
  const r = await fetch("https://fapi.binance.com/fapi/v1/klines?symbol=" + sym + "&interval=" + interval + "&limit=1500", { signal });
  if (!r.ok) throw new Error("Binance " + sym + " HTTP " + r.status);
  const rows = await r.json();
  return cleanCandles((Array.isArray(rows) ? rows : []).map((k: any) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })));
}
const qfex: Adapter = {
  id: "qfex", label: "QFEX", prefix: QFEX_PREFIX, defaultCat: "Stocks", ownHistory: true,
  start: (p, s, st) => startQfexFeed(p as any, s, st),
  candles: fetchQfexCandles,
};

/* ---- other public exchanges used as fallback history / 24h change ---- */
const jget = async (url: string, signal?: AbortSignal) => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
const BYBIT_IV: Record<string, string> = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "D", "1w": "W" };
const OKX_IV: Record<string, string> = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "1d": "1D", "1w": "1W" };
const CB_IV: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
type Src = { name: string; fn: (base: string, tf: string, signal?: AbortSignal) => Promise<QCandle[]> };
const SOURCES: Src[] = [
  { name: "Binance", fn: (base, tf, signal) => binanceCandles(base, tf, signal) },
  {
    name: "Hyperliquid",
    fn: async (base, tf, signal) => {
      const k = hlMatch(base) || (await xyzFor(base));
      if (!k) throw new Error("no market");
      return hlCandles(k, tf, signal);
    },
  },
  {
    name: "Bybit",
    fn: async (base, tf, signal) => {
      if (!BYBIT_IV[tf]) throw new Error("timeframe");
      const j = await jget("https://api.bybit.com/v5/market/kline?category=linear&symbol=" + base + "USDT&interval=" + BYBIT_IV[tf] + "&limit=1000", signal);
      return cleanCandles((j?.result?.list || []).map((k: any) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })));
    },
  },
  {
    name: "OKX",
    fn: async (base, tf, signal) => {
      if (!OKX_IV[tf]) throw new Error("timeframe");
      const j = await jget("https://www.okx.com/api/v5/market/candles?instId=" + base + "-USDT-SWAP&bar=" + OKX_IV[tf] + "&limit=300", signal);
      return cleanCandles((j?.data || []).map((k: any) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })));
    },
  },
  {
    name: "Coinbase",
    fn: async (base, tf, signal) => {
      if (!CB_IV[tf]) throw new Error("timeframe");
      const k = await jget("https://api.exchange.coinbase.com/products/" + base + "-USD/candles?granularity=" + CB_IV[tf], signal);
      return cleanCandles((Array.isArray(k) ? k : []).map((c: any) => ({ time: num(c[0]), low: num(c[1]), high: num(c[2]), open: num(c[3]), close: num(c[4]), volume: num(c[5]) })));
    },
  },
];
const baseOf = (ad: Adapter, symbol: string) => symbol.slice(ad.prefix.length).split("-")[0].toUpperCase();
const baseVariants = (b: string) => {
  const s = /^K[A-Z]{3,}$/.test(b) ? b.slice(1) : b;
  return Array.from(new Set([b, s, "1000" + s]));
};
export const candleSrc: Record<string, string> = {};
const deadUntil: Record<string, number> = {};
/** Candles for a symbol: the exchange's own API first, then other public exchanges that list the same asset. */
export async function getCandles(ad: Adapter, symbol: string, tf: string, signal?: AbortSignal) {
  const errs: string[] = [];
  delete candleNote[symbol];
  delete candleSrc[symbol];
  if (ad.candles) {
    try {
      const rows = await ad.candles(symbol, tf, signal);
      if (rows.length) return { rows, source: ad.label, err: "" };
      errs.push(ad.label + ": no candles");
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      errs.push(ad.label + ": " + (e?.message || "failed"));
    }
  } else errs.push(ad.label + " has no candle history");
  const base = baseOf(ad, symbol);
  for (const src of SOURCES) {
    if ((deadUntil[src.name] || 0) > Date.now()) continue;
    for (const v of baseVariants(base)) {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 7000);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const rows = await src.fn(v, tf, ctl.signal);
        if (rows.length) {
          candleSrc[symbol] = src.name + " " + v;
          candleNote[symbol] = ad.label + " has no usable candle API here: history from " + src.name + " " + v + ", live bars from " + ad.label;
          return { rows, source: src.name + " " + v, err: errs.join(" · ") };
        }
      } catch (e: any) {
        if (signal?.aborted) throw e;
        // unreachable host (blocked / timeout): skip this exchange for a while instead of waiting every time
        if (e instanceof TypeError || e?.name === "AbortError") {
          deadUntil[src.name] = Date.now() + 10 * 60 * 1000;
          break;
        }
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  }
  return { rows: [] as QCandle[], source: "", err: errs.join(" · ") + " · no other exchange lists " + base };
}

/* ---- 24h change from other exchanges, when the exchange itself gives none ---- */
const extChange: Record<string, number> = {};
let extStarted = false;
const putExt = (sym: string, pct: number) => {
  if (!Number.isFinite(pct)) return;
  let b = sym.replace(/USDT$|-USDT-SWAP$/, "").toUpperCase().replace(/^1000(?=[A-Z])/, "");
  if (b && extChange[b] == null) extChange[b] = pct;
};
const startExtChange = () => {
  if (extStarted) return;
  extStarted = true;
  const run = async () => {
    const [bn, by, ok] = await Promise.allSettled([
      jget("https://fapi.binance.com/fapi/v1/ticker/24hr"),
      jget("https://api.bybit.com/v5/market/tickers?category=linear"),
      jget("https://www.okx.com/api/v5/market/tickers?instType=SWAP"),
    ]);
    const fresh: Record<string, number> = {};
    const keep = { ...extChange };
    for (const k of Object.keys(extChange)) delete extChange[k];
    if (bn.status === "fulfilled" && Array.isArray(bn.value)) for (const t of bn.value) if (/USDT$/.test(t.symbol)) putExt(t.symbol, num(t.priceChangePercent));
    if (by.status === "fulfilled") for (const t of by.value?.result?.list || []) if (/USDT$/.test(t.symbol)) putExt(t.symbol, num(t.price24hPcnt) * 100);
    if (ok.status === "fulfilled") for (const t of ok.value?.data || []) if (/-USDT-SWAP$/.test(t.instId) && num(t.open24h) > 0) putExt(t.instId, (num(t.last) / num(t.open24h) - 1) * 100);
    if (!Object.keys(extChange).length) Object.assign(extChange, keep, fresh);
  };
  void run();
  window.setInterval(run, 60000);
};
export const extChangeFor = (base: string): number | null => {
  const b = base.toUpperCase();
  for (const v of baseVariants(b)) {
    const x = extChange[v.replace(/^1000/, "")];
    if (x != null) return x;
  }
  return null;
};

export const ADAPTERS: Adapter[] = [qfex, hyperliquid, lighter, variational];
export const adapterOf = (symbol: string) => ADAPTERS.find((a) => String(symbol).startsWith(a.prefix));
export const displayName = (symbol: string) => {
  const a = adapterOf(symbol);
  return a ? symbol.slice(a.prefix.length) : symbol;
};

/** Starts an adapter. A missing 24h change comes from other exchanges, then from prices saved by this app. */
export function startAdapter(ad: Adapter, onPrices: (t: Tick[]) => void, onSymbols: (r: SymRow[]) => void, onStatus: (m: string) => void) {
  startExtChange();
  const wrapped = (items: Tick[]) => {
    for (const t of items) {
      if (ad.ownHistory) recordSample(t.marketDisplayName, t.markPrice);
      if (t.change24h == null) {
        const x = extChangeFor(baseOf(ad, t.marketDisplayName));
        if (x != null) t.change24h = x;
        else if (ad.ownHistory) {
          const c = ownChange24h(t.marketDisplayName, t.markPrice);
          if (c != null) t.change24h = c;
        }
      }
    }
    onPrices(items);
  };
  return ad.start(wrapped, onSymbols, onStatus);
}
