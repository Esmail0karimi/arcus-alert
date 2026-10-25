/* EXPERIMENTAL: QFEX market data (equities / commodities). Public endpoints, no API key.
   Symbols are namespaced "QFEX:AAPL-USD" so they never collide with Arcus symbols. */
export const QFEX_PREFIX = "QFEX:";
export const isQfexSymbol = (s: string) => String(s).startsWith(QFEX_PREFIX);
const REST = "https://api.qfex.com";
const WS = "wss://mds.qfex.com";
const raw = (s: string) => String(s).replace(QFEX_PREFIX, "");

const RES: Record<string, string[]> = {
  "1m": ["1MIN", "1m", "1"],
  "5m": ["5MINS", "5m", "5"],
  "15m": ["15MINS", "15m", "15"],
  "30m": ["30MINS", "30m", "30"],
  "1h": ["1HOUR", "1h", "60"],
  "4h": ["4HOURS", "4h", "240"],
  "1d": ["1DAY", "1d", "1D"],
};
const SPAN: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400,
};

const toSec = (v: any): number => {
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    return n > 1e14 ? n / 1e9 : n > 1e11 ? n / 1000 : n;
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t / 1000 : NaN;
};

export type QCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export async function fetchQfexCandles(symbol: string, tf: string, signal?: AbortSignal): Promise<QCandle[]> {
  const variants = RES[tf];
  if (!variants) throw new Error("QFEX does not offer timeframe " + tf + " (use 1m, 5m, 15m, 30m, 1h, 4h, 1d)");
  const now = Date.now(),
    from = new Date(now - SPAN[tf] * 1500 * 1000).toISOString(),
    to = new Date(now).toISOString();
  let lastErr = "no candles";
  for (const res of variants) {
    try {
      const r = await fetch(
        REST + "/candles/" + encodeURIComponent(raw(symbol)) + "?resolution=" + encodeURIComponent(res) +
          "&fromISO=" + encodeURIComponent(from) + "&toISO=" + encodeURIComponent(to),
        { signal },
      );
      if (!r.ok) { lastErr = "QFEX HTTP " + r.status; continue; }
      const body = await r.json();
      const out = (Array.isArray(body?.candles) ? body.candles : [])
        .map((c: any) => ({
          time: Math.floor(toSec(c.startedAt)),
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
          volume: Number(c.baseTokenVolume ?? 0),
        }))
        .filter((c: QCandle) => c.time > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite))
        .sort((a: QCandle, b: QCandle) => a.time - b.time)
        .filter((c: QCandle, i: number, a: QCandle[]) => !i || c.time > a[i - 1].time);
      if (out.length) return out;
      lastErr = "QFEX returned no candles for resolution " + res;
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      lastErr = e instanceof TypeError ? "QFEX request blocked by the browser (CORS/network)" : e?.message || "QFEX error";
    }
  }
  throw new Error(lastErr);
}

type Tick = { marketDisplayName: string; marketId: string; markPrice: number; timestamp: number; change24h?: number };

/** Starts the QFEX price feed. Returns a stop function. `onCategory` receives the symbol -> kind hint. */
export function startQfexFeed(
  onPrices: (items: Tick[]) => void,
  onSymbols: (rows: { name: string; cat: string }[]) => void,
  onStatus: (msg: string) => void,
): () => void {
  let stopped = false, ws: WebSocket | null = null, retry = 1000, retryTimer: number | undefined;
  let lastWs = 0, wsOpen = false, cacheAt = 0;
  const CK = "arcus.qfex.last.v1";
  const cache: Record<string, [number, number]> = (() => {
    try {
      return JSON.parse(localStorage.getItem(CK) || "{}") || {};
    } catch {
      return {};
    }
  })();
  const seen = new Set<string>();
  const dayOpen: Record<string, number> = {};
  const emit = (symbol: string, price: number, time: number) => {
    if (!symbol || !Number.isFinite(price) || price <= 0) return;
    cache[symbol.toUpperCase()] = [price, Math.floor(Date.now() / 1000)];
    if (Date.now() - cacheAt > 15000) {
      cacheAt = Date.now();
      try {
        localStorage.setItem(CK, JSON.stringify(cache));
      } catch {}
    }
    if (!seen.has(symbol)) {
      seen.add(symbol);
      onSymbols([{ name: QFEX_PREFIX + symbol.toUpperCase(), cat: "" }]);
    }
    onPrices([{ marketDisplayName: QFEX_PREFIX + symbol.toUpperCase(), marketId: "QFEX", markPrice: price, timestamp: Number.isFinite(time) ? time : Date.now() / 1000, change24h: dayOpen[symbol.toUpperCase()] > 0 ? (price / dayOpen[symbol.toUpperCase()] - 1) * 100 : undefined }]);
  };
  const getJson = async (path: string) => {
    // Plain GET without extra headers or cache options (those trigger a CORS preflight, and "no-cache" made the
    // server answer 202 with an empty body).
    let r = await fetch(REST + path);
    if (r.status === 202) {
      await new Promise((res) => setTimeout(res, 1500));
      r = await fetch(REST + path);
    }
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("QFEX " + path + " HTTP " + r.status + " non-JSON: " + text.slice(0, 50).replace(/\s+/g, " "));
    }
  };
  const poll = async () => {
    try {
      let rows: { sym: string; price: number; cat: string }[] = [];
      let err = "";
      try {
        const body = await getJson("/refdata");
        rows = (Array.isArray(body?.data) ? body.data : []).map((c: any) => ({
          sym: String(c.symbol),
          price: Number(c.underlier_price),
          cat: String(c.product_category || ""),
        }));
      } catch (e: any) {
        if (e instanceof TypeError) throw e;
        err = e?.message || "";
      }
      if (!rows.length) {
        try {
          const body = await getJson("/md/contracts");
          rows = (Array.isArray(body?.data) ? body.data : []).map((c: any) => ({
            sym: String(c.ticker_id),
            price: Number(c.last_price ?? c.index_price),
            cat: String(c.product_type || ""),
          }));
        } catch (e: any) {
          if (e instanceof TypeError) throw e;
          throw new Error((err ? err + " | " : "") + (e?.message || ""));
        }
        if (!rows.length) throw new Error((err ? err + " | " : "") + "QFEX returned an empty market list");
      }
      onSymbols(rows.map((c) => ({ name: QFEX_PREFIX + c.sym.toUpperCase(), cat: c.cat })));
      const stale = Date.now() - lastWs > 20000; // WebSocket silent: use the REST prices
      const items = rows
        .map((c) => ({ marketDisplayName: QFEX_PREFIX + c.sym.toUpperCase(), marketId: "QFEX", markPrice: c.price, timestamp: Date.now() / 1000 }))
        .filter((c) => Number.isFinite(c.markPrice) && c.markPrice > 0);
      if (items.length && (stale || !lastWs)) onPrices(items);
      onStatus("QFEX · " + rows.length + " markets" + (stale ? " (REST)" : " (live)"));
    } catch (e: any) {
      // REST can be answered with an anti-bot challenge (HTTP 202); the WebSocket still works then.
      if (Date.now() - lastWs < 20000) {
        onStatus("QFEX · " + seen.size + " markets (live, WebSocket)");
        return;
      }
      if (wsOpen) {
        // REST is behind an anti-bot challenge; the WebSocket is connected but silent (e.g. stock market closed)
        onStatus("QFEX · WebSocket connected, waiting for prices (market closed?)");
        return;
      }
      const known = seen.size || Object.keys(cache).length;
      if (known && !(e instanceof TypeError)) {
        // REST is behind an anti-bot challenge (HTTP 202) and the live feed is not connected right now: keep the last prices, keep retrying
        onStatus("QFEX · " + known + " markets (last known prices, reconnecting live feed…)");
        return;
      }
      onStatus(e instanceof TypeError ? "QFEX blocked by the browser (CORS/network)" : "QFEX: REST is protected (HTTP 202), waiting for the live WebSocket…");
    }
  };
  const handle = (m: any) => {
    if (!m || typeof m !== "object") return;
    if (Array.isArray(m)) return m.forEach(handle);
    if (m.contents) return handle(m.contents);
    if (m.type === "candle" && m.symbol && /1DAY/i.test(String(m.resolution || ""))) {
      const o = Number(m.open);
      if (o > 0) dayOpen[String(m.symbol).toUpperCase()] = o; // change since the daily open
      return;
    }
    if (m.type === "mark_price" && m.symbol) {
      lastWs = Date.now();
      emit(String(m.symbol), Number(m.price), toSec(m.time));
      if (seen.size && !(seen.size % 5)) onStatus("QFEX · " + seen.size + " markets (live, WebSocket)");
    }
  };
  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(WS);
      ws.onopen = () => {
        retry = 1000;
        wsOpen = true;
        ws?.send(JSON.stringify({ type: "subscribe", channels: ["mark_price"], symbols: ["*"] }));
        ws?.send(JSON.stringify({ type: "subscribe", channels: ["candle"], symbols: ["*"], intervals: ["1DAY"] }));
      };
      ws.onmessage = (e) => { try { handle(JSON.parse(String(e.data))); } catch {} };
      ws.onclose = () => { wsOpen = false; if (!stopped) { retryTimer = window.setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } };
      ws.onerror = () => {};
    } catch {
      retryTimer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    }
  };
  // Last known prices (shown until the live feed answers, so the list is not empty while the stock market is closed)
  {
    const old = Object.keys(cache);
    if (old.length) {
      onSymbols(old.map((k) => ({ name: QFEX_PREFIX + k, cat: "" })));
      onPrices(old.map((k) => ({ marketDisplayName: QFEX_PREFIX + k, marketId: "QFEX", markPrice: cache[k][0], timestamp: cache[k][1] })));
      onStatus("QFEX · " + old.length + " markets (last known prices, waiting for live)");
    }
  }
  void poll();
  const wsOk = window.setInterval(() => {
    if (Date.now() - lastWs < 20000 && seen.size) onStatus("QFEX · " + seen.size + " markets (live, WebSocket)");
  }, 5000);
  const pollTimer = window.setInterval(poll, 30000);
  connect();
  return () => {
    stopped = true;
    window.clearInterval(pollTimer);
    window.clearInterval(wsOk);
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); }
  };
}
