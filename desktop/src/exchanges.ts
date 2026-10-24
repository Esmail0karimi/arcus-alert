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
  // Variational publishes no candles: use Hyperliquid's candles of the same coin as history (live bars come from Variational).
  candles: async (symbol, tf, signal) => {
    const hk = hlMatch(symbol.slice(VR_P.length).split("-")[0]);
    if (!hk) throw new Error("no Hyperliquid market with the same name to borrow history from");
    const rows = await hlCandles(hk, tf, signal);
    candleNote[symbol] = "Variational: history from Hyperliquid " + hk + " (Variational publishes no candles), live bars from Variational";
    return rows;
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
const qfex: Adapter = {
  id: "qfex", label: "QFEX", prefix: QFEX_PREFIX, defaultCat: "Stocks", ownHistory: true,
  start: (p, s, st) => startQfexFeed(p as any, s, st),
  candles: async (symbol, tf, signal) => {
    try {
      return await fetchQfexCandles(symbol, tf, signal);
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      const base = symbol.slice(QFEX_PREFIX.length).split("-")[0].toUpperCase();
      const k = await xyzFor(base);
      if (!k) throw new Error((err?.message || "QFEX candles unavailable") + " · and no Hyperliquid (xyz) market named " + base);
      const rows = await hlCandles(k, tf, signal);
      candleNote[symbol] = "QFEX: history from Hyperliquid " + k + " (QFEX candle API is blocked for web pages), live bars from QFEX";
      return rows;
    }
  },
};

export const ADAPTERS: Adapter[] = [qfex, hyperliquid, lighter, variational];
export const adapterOf = (symbol: string) => ADAPTERS.find((a) => String(symbol).startsWith(a.prefix));
export const displayName = (symbol: string) => {
  const a = adapterOf(symbol);
  return a ? symbol.slice(a.prefix.length) : symbol;
};

/** Starts an adapter; adapters without own 24h data get it from saved samples. */
export function startAdapter(ad: Adapter, onPrices: (t: Tick[]) => void, onSymbols: (r: SymRow[]) => void, onStatus: (m: string) => void) {
  const wrapped = ad.ownHistory
    ? (items: Tick[]) => {
        for (const t of items) {
          recordSample(t.marketDisplayName, t.markPrice);
          const c = ownChange24h(t.marketDisplayName, t.markPrice);
          if (c != null && t.change24h == null) t.change24h = c;
        }
        onPrices(items);
      }
    : onPrices;
  return ad.start(wrapped, onSymbols, onStatus);
}
