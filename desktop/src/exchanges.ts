/* EXPERIMENTAL: extra exchanges. Each adapter gives live prices and (optionally) candle history.
   Symbols are namespaced with the adapter prefix so they never collide with Arcus symbols. */
import { QFEX_PREFIX, startQfexFeed, fetchQfexCandles, type QCandle } from "./qfex";

export type Tick = { marketDisplayName: string; marketId: string; markPrice: number; timestamp: number };
export type SymRow = { name: string; cat: string };
export type Adapter = {
  id: string;
  label: string;
  prefix: string;
  /** category used when the exchange gives none */
  defaultCat: "Crypto" | "Stocks";
  start: (onPrices: (t: Tick[]) => void, onSymbols: (r: SymRow[]) => void, onStatus: (m: string) => void) => () => void;
  candles?: (symbol: string, tf: string, signal?: AbortSignal) => Promise<QCandle[]>;
};

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
const hlPost = async (body: any, signal?: AbortSignal) => {
  const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error("Hyperliquid HTTP " + r.status);
  return r.json();
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
          rows.push({ name: HL_P + String(u.name).toUpperCase(), cat: "" });
          if (px > 0) list.push({ marketDisplayName: HL_P + String(u.name).toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000 });
        });
        known = rows.length;
        onSymbols(rows);
        if (list.length && Date.now() - lastWs > 20000) onPrices(list);
        onStatus("Hyperliquid · " + known + " markets (live)");
      } catch (e: any) { onStatus(netErr("Hyperliquid", e)); }
    };
    void poll();
    const t = window.setInterval(poll, 30000);
    const stop = socket("wss://api.hyperliquid.xyz/ws",
      (ws) => ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "allMids" } })),
      (m) => {
        const mids = m?.channel === "allMids" ? m?.data?.mids : null;
        if (!mids) return;
        lastWs = Date.now();
        const list: Tick[] = [];
        for (const k of Object.keys(mids)) {
          if (k.startsWith("@")) continue; // spot pairs
          const px = num(mids[k]);
          if (px > 0) list.push({ marketDisplayName: HL_P + k.toUpperCase(), marketId: "HL", markPrice: px, timestamp: Date.now() / 1000 });
        }
        if (list.length) onPrices(list);
      });
    return () => { window.clearInterval(t); stop(); };
  },
  async candles(symbol, tf, signal) {
    const interval = SPAN[tf] ? tf : "15m";
    const end = Date.now();
    const rows = await hlPost({ type: "candleSnapshot", req: { coin: symbol.slice(HL_P.length), interval, startTime: end - SPAN[interval] * 1000 * 1500, endTime: end } }, signal);
    return cleanCandles((Array.isArray(rows) ? rows : []).map((c: any) => ({ time: Math.floor(num(c.t) / 1000), open: num(c.o), high: num(c.h), low: num(c.l), close: num(c.c), volume: num(c.v) })));
  },
};

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
        if (px > 0) { lastMsg = Date.now(); onPrices([{ marketDisplayName: name, marketId: "LT", markPrice: px, timestamp: Date.now() / 1000 }]); }
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
  id: "vr", label: "Variational", prefix: VR_P, defaultCat: "Crypto",
  start(onPrices, onSymbols, onStatus) {
    const poll = async () => {
      try {
        const r = await fetch("https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/v2/stats");
        if (!r.ok) throw new Error("Variational HTTP " + r.status);
        const body = await r.json();
        const list: Tick[] = [], rows: SymRow[] = [];
        for (const l of body?.listings || []) {
          const name = VR_P + String(l.ticker).toUpperCase();
          rows.push({ name, cat: "" });
          const px = num(l.mark_price);
          if (px > 0) list.push({ marketDisplayName: name, marketId: "VR", markPrice: px, timestamp: Date.now() / 1000 });
        }
        onSymbols(rows);
        onPrices(list);
        onStatus("Variational · " + rows.length + " markets (live, no history)");
      } catch (e: any) { onStatus(netErr("Variational", e)); }
    };
    void poll();
    const t = window.setInterval(poll, 15000);
    return () => window.clearInterval(t);
  },
};

/* ---------------- QFEX ---------------- */
const qfex: Adapter = {
  id: "qfex", label: "QFEX", prefix: QFEX_PREFIX, defaultCat: "Stocks",
  start: (p, s, st) => startQfexFeed(p as any, s, st),
  candles: fetchQfexCandles,
};

export const ADAPTERS: Adapter[] = [qfex, hyperliquid, lighter, variational];
export const adapterOf = (symbol: string) => ADAPTERS.find((a) => String(symbol).startsWith(a.prefix));
export const displayName = (symbol: string) => {
  const a = adapterOf(symbol);
  return a ? symbol.slice(a.prefix.length) : symbol;
};
