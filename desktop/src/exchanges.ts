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
const hlAt: Record<string, string> = {}; // "@107" -> "HYPE/USDC"
let hlDexes: string[] = [];
const hlComm = /GOLD|SILVER|XAU|XAG|OIL|BRENT|WTI|COPPER|PLATINUM|PALLADIUM|GAS|WHEAT|CORN|COFFEE|SUGAR/i;
const hyperliquid: Adapter = {
  id: "hl", label: "Hyperliquid", prefix: HL_P, defaultCat: "Crypto",
  start(onPrices, onSymbols, onStatus) {
    let lastWs = 0, known = 0;
    const tick = (name: string, px: number, ch?: number): Tick => ({ marketDisplayName: HL_P + name.toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000, change24h: ch });
    const catOf = (name: string) => (name.includes(":") ? (hlComm.test(name) ? "commodity" : "equity") : "");
    const poll = async () => {
      try {
        const rows: SymRow[] = [], list: Tick[] = [];
        // perpetuals of the main dex + HIP-3 dexes (stocks / commodities such as "xyz:AAPL")
        if (!hlDexes.length) {
          try {
            const d = await hlPost({ type: "perpDexs" });
            hlDexes = (Array.isArray(d) ? d : []).filter(Boolean).map((x: any) => String(x.name)).filter(Boolean);
          } catch {}
        }
        for (const dex of ["", ...hlDexes]) {
          try {
            const [meta, ctxs] = await hlPost(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" });
            (meta.universe || []).forEach((u: any, i: number) => {
              if (u.isDelisted) return;
              const name = String(u.name), key = name.toUpperCase();
              const px = num(ctxs[i]?.markPx), prev = num(ctxs[i]?.prevDayPx);
              hlCoin[key] = name;
              const ch = px > 0 && prev > 0 ? ((px - prev) / prev) * 100 : undefined;
              if (ch != null && !dex) hlChange[key] = ch;
              rows.push({ name: HL_P + key, cat: catOf(name) });
              if (px > 0) list.push(tick(name, px, ch));
            });
          } catch {}
        }
        // spot pairs: "@107" -> "HYPE/USDC"
        try {
          const [sm, sctx] = await hlPost({ type: "spotMetaAndAssetCtxs" });
          const tokens: any[] = sm?.tokens || [];
          (sm?.universe || []).forEach((u: any, i: number) => {
            const base = tokens[u.tokens?.[0]]?.name, quote = tokens[u.tokens?.[1]]?.name;
            const disp = base && quote ? base + "/" + quote : String(u.name);
            const key = disp.toUpperCase();
            hlAt[String(u.name)] = disp;
            hlCoin[key] = String(u.name);
            const px = num(sctx?.[i]?.markPx ?? sctx?.[i]?.midPx), prev = num(sctx?.[i]?.prevDayPx);
            rows.push({ name: HL_P + key, cat: "" });
            if (px > 0) list.push(tick(disp, px, prev > 0 ? ((px - prev) / prev) * 100 : undefined));
          });
        } catch {}
        known = rows.length;
        hlKnown = known > 0;
        onSymbols(rows);
        if (list.length && Date.now() - lastWs > 20000) onPrices(list);
        onStatus(known ? "Hyperliquid · " + known + " markets (live)" : "Hyperliquid error: no markets returned");
      } catch (e: any) { onStatus(netErr("Hyperliquid", e)); }
    };
    void poll();
    const t = window.setInterval(poll, 20000);
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
    const subDex = (ws: WebSocket) => {
      for (const dex of hlDexes) ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids", dex } }));
    };
    const stop = socket("wss://api.hyperliquid.xyz/ws",
      (ws) => {
        wsNow = ws;
        ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } }));
        window.setTimeout(() => { void poll().then(() => wsNow && subDex(wsNow)); }, 300);
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
          if (k.startsWith("#")) continue; // outcome markets have no public names
          const name = k.startsWith("@") ? hlAt[k] : k;
          if (!name) continue;
          if (hlKnown && !hlCoin[name.toUpperCase()]) continue;
          const px = num(mids[k]);
          if (px > 0) list.push(tick(name, px));
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
/* Stocks, indices, FX and commodities: Yahoo Finance's public chart API (what most free chart sites use). */
const YF_MAP: Record<string, string> = {
  XAU: "GC=F", GOLD: "GC=F", XAG: "SI=F", SILVER: "SI=F", XPT: "PL=F", XPD: "PA=F", XCU: "HG=F", COPPER: "HG=F",
  WTI: "CL=F", CL: "CL=F", USOIL: "CL=F", OIL: "CL=F", BRENT: "BZ=F", UKOIL: "BZ=F", NG: "NG=F", GAS: "NG=F",
  SPX: "^GSPC", SP500: "^GSPC", US500: "^GSPC", NDX: "^NDX", NAS100: "^NDX", US100: "^NDX", DJI: "^DJI", US30: "^DJI", RUT: "^RUT",
  DAX: "^GDAXI", GER40: "^GDAXI", FTSE: "^FTSE", UK100: "^FTSE", NIKKEI: "^N225", JP225: "^N225", HSI: "^HSI", VIX: "^VIX", DXY: "DX-Y.NYB",
  EUR: "EURUSD=X", GBP: "GBPUSD=X", AUD: "AUDUSD=X", NZD: "NZDUSD=X", JPY: "JPY=X", CHF: "CHF=X", CAD: "CAD=X", CNH: "CNH=X", CNY: "CNY=X", TRY: "TRY=X", MXN: "MXN=X", KRW: "KRW=X", INR: "INR=X",
};
export const yfSym = (b: string) => YF_MAP[b] || (/^[A-Z0-9]+$/.test(b) && b.length === 6 && /USD$|^USD/.test(b) ? b + "=X" : b.replace(/\./g, "-"));
const aggregate = (rows: QCandle[], step: number) => {
  const out: QCandle[] = [];
  for (const c of rows) {
    const t = Math.floor(c.time / step) * step,
      l = out[out.length - 1];
    if (l && l.time === t) {
      l.high = Math.max(l.high, c.high);
      l.low = Math.min(l.low, c.low);
      l.close = c.close;
      l.volume += c.volume;
    } else out.push({ ...c, time: t });
  }
  return out;
};
/* Yahoo does not allow browser (CORS) requests from every site: try it directly first, then through public CORS relays. The first method that works is remembered. */
const YF_WRAP: ((u: string) => string)[] = [
  (u) => u,
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
  (u) => "https://corsproxy.org/?" + encodeURIComponent(u),
  (u) => "https://thingproxy.freeboard.io/fetch/" + u,
  (u) => "https://yacdn.org/proxy/" + u,
];
let yfMode = 0;
export async function yfGet(url: string, signal?: AbortSignal): Promise<any> {
  let last: any = new Error("Yahoo unreachable");
  for (let k = 0; k < YF_WRAP.length; k++) {
    const m = (yfMode + k) % YF_WRAP.length;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 7000);
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const r = await fetch(YF_WRAP[m](url), { signal: ctl.signal });
      if (r.status === 404 && m === 0) throw Object.assign(new Error("Yahoo: unknown symbol"), { stop: true });
      if (!r.ok) throw new Error("Yahoo HTTP " + r.status);
      const j = await r.json();
      yfMode = m;
      return j;
    } catch (e: any) {
      if (signal?.aborted || e?.stop) throw e;
      last = e;
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw last;
}
/* 24h change for stocks: Yahoo "spark" answers for up to 20 symbols per call. */
const yfChange: Record<string, number> = {},
  yfAt: Record<string, number> = {},
  yfPending = new Set<string>();
let yfTimer = 0;
const yfQueue = (base: string) => {
  if (yfPending.has(base) || Date.now() - (yfAt[base] || 0) < 300000) return;
  yfPending.add(base);
  if (yfTimer) return;
  yfTimer = window.setInterval(async () => {
    const batch = Array.from(yfPending).slice(0, 20);
    if (!batch.length) {
      window.clearInterval(yfTimer);
      yfTimer = 0;
      return;
    }
    batch.forEach((b) => (yfPending.delete(b), (yfAt[b] = Date.now() - 180000))); // failed ones retry in ~2 min
    try {
      const map: Record<string, string> = {};
      batch.forEach((b) => (map[yfSym(b)] = b));
      const j = await yfGet("https://query1.finance.yahoo.com/v8/finance/spark?range=1d&interval=1d&symbols=" + Object.keys(map).map(encodeURIComponent).join(","));
      const list: any[] = j?.spark?.result || Object.keys(j || {}).filter((k) => j[k] && typeof j[k] === "object" && "symbol" in j[k]).map((k) => j[k]);
      for (const it of list) {
        const m = it.response?.[0]?.meta || it,
          sym = it.symbol || m.symbol,
          closes: number[] = it.close || it.response?.[0]?.indicators?.quote?.[0]?.close || [];
        const price = num(m.regularMarketPrice ?? closes[closes.length - 1]),
          prev = num(m.chartPreviousClose ?? m.previousClose);
        if (map[sym] && price > 0 && prev > 0) {
          yfChange[map[sym]] = (price / prev - 1) * 100;
          yfAt[map[sym]] = Date.now();
        }
      }
    } catch {}
  }, 1500);
};
async function yahooCandles(base: string, tf: string, signal: AbortSignal | undefined): Promise<QCandle[]> {
  const plan: Record<string, [string, string, number]> = {
    "1m": ["1m", "7d", 1], "3m": ["1m", "7d", 3], "5m": ["5m", "60d", 1], "15m": ["15m", "60d", 1], "30m": ["30m", "60d", 1],
    "1h": ["60m", "730d", 1], "2h": ["60m", "730d", 2], "4h": ["60m", "730d", 4], "1d": ["1d", "5y", 1], "1w": ["1wk", "10y", 1],
  };
  const p = plan[tf];
  if (!p) throw new Error("timeframe");
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(yfSym(base)) + "?interval=" + p[0] + "&range=" + p[1] + "&includePrePost=false";
  const j = await yfGet(url, signal);
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp || [],
    q = r?.indicators?.quote?.[0] || {};
  const rows: QCandle[] = [];
  ts.forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].every((v) => typeof v === "number" && Number.isFinite(v))) rows.push({ time: t, open: o, high: h, low: l, close: c, volume: num(q.volume?.[i] || 0) });
  });
  return cleanCandles(p[2] > 1 ? aggregate(rows, SPAN[tf]) : rows);
}
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
  {
    name: "Binance spot",
    fn: async (base, tf, signal) => {
      if (!SPAN[tf]) throw new Error("timeframe");
      const rows = await jget("https://data-api.binance.vision/api/v3/klines?symbol=" + base + "USDT&interval=" + tf + "&limit=1000", signal);
      return cleanCandles((Array.isArray(rows) ? rows : []).map((k: any) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })));
    },
  },
  {
    name: "Gate",
    fn: async (base, tf, signal) => {
      const iv = ({ "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "7d" } as Record<string, string>)[tf];
      if (!iv) throw new Error("timeframe");
      const rows = await jget("https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=" + base + "_USDT&interval=" + iv + "&limit=1000", signal);
      return cleanCandles((Array.isArray(rows) ? rows : []).map((k: any) => ({ time: num(k.t), open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), volume: num(k.v) })));
    },
  },
  {
    name: "Bybit (mirror)",
    fn: async (base, tf, signal) => {
      if (!BYBIT_IV[tf]) throw new Error("timeframe");
      const j = await jget("https://api.bytick.com/v5/market/kline?category=linear&symbol=" + base + "USDT&interval=" + BYBIT_IV[tf] + "&limit=1000", signal);
      return cleanCandles((j?.result?.list || []).map((k: any) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })));
    },
  },
  {
    name: "BingX",
    fn: async (base, tf, signal) => {
      if (!SPAN[tf]) throw new Error("timeframe");
      const j = await jget("https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=" + base + "-USDT&interval=" + tf + "&limit=1000", signal);
      return cleanCandles((j?.data || []).map((k: any) => ({ time: Math.floor(num(k.time) / 1000), open: num(k.open), high: num(k.high), low: num(k.low), close: num(k.close), volume: num(k.volume) })));
    },
  },
  { name: "Yahoo", fn: (base, tf, signal) => yahooCandles(base, tf, signal) },
];
const baseOf = (ad: Adapter, symbol: string) => symbol.slice(ad.prefix.length).split("-")[0].toUpperCase();
const baseVariants = (b: string) => {
  const s = /^K[A-Z]{3,}$/.test(b) ? b.slice(1) : b;
  return Array.from(new Set([b, s, "1000" + s]));
};
export const candleSrc: Record<string, string> = {};
const deadUntil: Record<string, number> = {};
const netFails: Record<string, number> = {};
/** Ask every public exchange at the same time (priority order decides the winner), so one slow or blocked host cannot stall or disable the rest. */
export async function externalCandles(base: string, tf: string, signal?: AbortSignal, tradfi = false): Promise<{ rows: QCandle[]; source: string }> {
  const run = async (src: Src): Promise<{ rows: QCandle[]; source: string } | null> => {
    if ((deadUntil[src.name] || 0) > Date.now()) return null;
    for (const v of baseVariants(base)) {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 8000);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort);
      try {
        const rows = await src.fn(v, tf, ctl.signal);
        netFails[src.name] = 0;
        if (rows.length > 1) return { rows, source: src.name + " " + v };
      } catch (e: any) {
        if (signal?.aborted) return null;
        if (e instanceof TypeError || e?.name === "AbortError") {
          // network / CORS / timeout: only park the host after three failures in a row, and only for a minute
          netFails[src.name] = (netFails[src.name] || 0) + 1;
          if (netFails[src.name] >= 3) deadUntil[src.name] = Date.now() + 60 * 1000;
          return null;
        }
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    return null;
  };
  // stocks / indices / FX / commodities: sources that carry them go first
  const TRADFI = ["Yahoo", "BingX", "Hyperliquid", "Gate"];
  const order = tradfi ? [...TRADFI.map((n) => SOURCES.find((x) => x.name === n)!).filter(Boolean), ...SOURCES.filter((x) => !TRADFI.includes(x.name))] : SOURCES;
  const jobs = order.map((src) => run(src));
  for (const j of jobs) {
    const r = await j;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (r) return r;
  }
  return { rows: [], source: "" };
}
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
  const ext = await externalCandles(base, tf, signal, ad.defaultCat === "Stocks");
  if (ext.rows.length) {
    candleSrc[symbol] = ext.source;
    candleNote[symbol] = ad.label + " has no usable candle API here: history from " + ext.source + ", live bars from " + ad.label;
    return { rows: ext.rows, source: ext.source, err: errs.join(" · ") };
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
  return yfChange[b] ?? null;
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
        const b = baseOf(ad, t.marketDisplayName);
        const x = extChangeFor(b);
        if (ad.defaultCat === "Stocks") yfQueue(b); // stocks: ask Yahoo (also refreshes the value every 5 min)
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

/* ---- profile + trend for the "what is this market" window ---- */
export type AssetStats = {
  exchange?: string; country?: string; currency?: string; type?: string; name?: string; tz?: string;
  hi52?: number; lo52?: number; price?: number; source: string;
  d1?: number; d7?: number; d30?: number; trend?: string; sma20?: number; sma50?: number;
};
const TZ_COUNTRY: Record<string, string> = {
  "America/New_York": "United States", "America/Chicago": "United States", "America/Los_Angeles": "United States", "America/Denver": "United States",
  "America/Toronto": "Canada", "America/Vancouver": "Canada", "America/Sao_Paulo": "Brazil", "America/Mexico_City": "Mexico",
  "Europe/London": "United Kingdom", "Europe/Berlin": "Germany", "Europe/Paris": "France", "Europe/Amsterdam": "Netherlands", "Europe/Zurich": "Switzerland",
  "Europe/Madrid": "Spain", "Europe/Rome": "Italy", "Europe/Stockholm": "Sweden", "Europe/Oslo": "Norway", "Europe/Copenhagen": "Denmark", "Europe/Helsinki": "Finland",
  "Europe/Istanbul": "Türkiye", "Europe/Moscow": "Russia", "Asia/Tokyo": "Japan", "Asia/Hong_Kong": "Hong Kong", "Asia/Shanghai": "China", "Asia/Seoul": "South Korea",
  "Asia/Taipei": "Taiwan", "Asia/Singapore": "Singapore", "Asia/Kolkata": "India", "Asia/Dubai": "United Arab Emirates", "Asia/Riyadh": "Saudi Arabia", "Asia/Jerusalem": "Israel",
  "Australia/Sydney": "Australia", "Pacific/Auckland": "New Zealand", "Africa/Johannesburg": "South Africa",
};
const pctOf = (a: number, b: number) => (b ? (a / b - 1) * 100 : undefined);
const trendOf = (closes: number[]) => {
  const avg = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((x, y) => x + y, 0) / n : undefined);
  const last = closes[closes.length - 1],
    s20 = avg(20),
    s50 = avg(50);
  let trend = "Not enough history";
  if (s20 && s50) trend = last > s20 && s20 > s50 ? "Uptrend" : last < s20 && s20 < s50 ? "Downtrend" : "Sideways / mixed";
  else if (s20) trend = last > s20 ? "Above 20-day average" : "Below 20-day average";
  return { s20, s50, trend };
};
export async function assetStats(base: string, crypto: boolean, signal?: AbortSignal): Promise<AssetStats | null> {
  let meta: any = null,
    rows: QCandle[] = [],
    source = "";
  if (!crypto) {
    try {
      const j = await yfGet("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(yfSym(base)) + "?interval=1d&range=1y&includePrePost=false", signal);
      const r = j?.chart?.result?.[0];
      if (r) {
        meta = r.meta || {};
        const q = r.indicators?.quote?.[0] || {};
        (r.timestamp || []).forEach((t: number, i: number) => {
          const c = q.close?.[i];
          if (typeof c === "number") rows.push({ time: t, open: q.open?.[i] ?? c, high: q.high?.[i] ?? c, low: q.low?.[i] ?? c, close: c, volume: num(q.volume?.[i] || 0) });
        });
        source = "Yahoo Finance";
      }
    } catch (e: any) {
      if (signal?.aborted) throw e;
    }
  }
  if (rows.length < 3) {
    const ext = await externalCandles(base, "1d", signal, !crypto);
    rows = ext.rows;
    source = ext.source;
  }
  if (rows.length < 3 && !meta) return null;
  const closes = rows.map((c) => c.close),
    last = closes[closes.length - 1];
  const tr = closes.length ? trendOf(closes) : { s20: undefined, s50: undefined, trend: "" };
  const hi = rows.length ? Math.max(...rows.slice(-365).map((c) => c.high)) : undefined,
    lo = rows.length ? Math.min(...rows.slice(-365).map((c) => c.low)) : undefined;
  return {
    source,
    exchange: meta?.fullExchangeName || meta?.exchangeName,
    country: meta?.exchangeTimezoneName ? TZ_COUNTRY[meta.exchangeTimezoneName] || meta.exchangeTimezoneName : undefined,
    tz: meta?.exchangeTimezoneName,
    currency: meta?.currency,
    type: meta?.instrumentType,
    name: meta?.longName || meta?.shortName,
    hi52: meta?.fiftyTwoWeekHigh ?? hi,
    lo52: meta?.fiftyTwoWeekLow ?? lo,
    price: meta?.regularMarketPrice ?? last,
    d1: closes.length > 1 ? pctOf(last, closes[closes.length - 2]) : undefined,
    d7: closes.length > 5 ? pctOf(last, closes[Math.max(0, closes.length - 6)]) : undefined,
    d30: closes.length > 21 ? pctOf(last, closes[Math.max(0, closes.length - 22)]) : undefined,
    sma20: tr.s20,
    sma50: tr.s50,
    trend: tr.trend,
  };
}

/** Full company / asset name for a ticker (e.g. LMT → Lockheed Martin Corporation) through Yahoo search. */
export type YfName = { name: string; exchange?: string; type?: string; sector?: string; industry?: string };
export async function companyName(base: string, crypto: boolean, signal?: AbortSignal): Promise<YfName | null> {
  const want = (crypto ? base + "-USD" : yfSym(base)).toUpperCase();
  const j = await yfGet("https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&newsCount=0&listsCount=0&q=" + encodeURIComponent(want), signal);
  const qs: any[] = j?.quotes || [];
  const q = qs.find((x) => String(x.symbol || "").toUpperCase() === want) || (crypto ? null : qs.find((x) => String(x.symbol || "").toUpperCase().split(".")[0] === want && x.quoteType === "EQUITY"));
  const name = q && (q.longname || q.shortname);
  if (!name) return null;
  return { name: String(name), exchange: q.exchDisp || q.exchange, type: q.typeDisp || q.quoteType, sector: q.sectorDisp || q.sector, industry: q.industryDisp || q.industry };
}
