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
        { headers: { Accept: "application/json" }, signal },
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

type Tick = { marketDisplayName: string; marketId: string; markPrice: number; timestamp: number };

/** Starts the QFEX price feed. Returns a stop function. `onCategory` receives the symbol -> kind hint. */
export function startQfexFeed(
  onPrices: (items: Tick[]) => void,
  onSymbols: (rows: { name: string; cat: string }[]) => void,
  onStatus: (msg: string) => void,
): () => void {
  let stopped = false, ws: WebSocket | null = null, retry = 1000, retryTimer: number | undefined;
  let lastWs = 0;
  const emit = (symbol: string, price: number, time: number) => {
    if (!symbol || !Number.isFinite(price) || price <= 0) return;
    onPrices([{ marketDisplayName: QFEX_PREFIX + symbol.toUpperCase(), marketId: "QFEX", markPrice: price, timestamp: Number.isFinite(time) ? time : Date.now() / 1000 }]);
  };
  const getJson = async (path: string) => {
    const r = await fetch(REST + path, { headers: { Accept: "application/json" }, cache: "no-store" });
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
      onStatus(e instanceof TypeError ? "QFEX blocked by the browser (CORS/network)" : "QFEX error: " + (e?.message || ""));
    }
  };
  const handle = (m: any) => {
    if (!m || typeof m !== "object") return;
    if (Array.isArray(m)) return m.forEach(handle);
    if (m.contents) return handle(m.contents);
    if (m.type === "mark_price" && m.symbol) {
      lastWs = Date.now();
      emit(String(m.symbol), Number(m.price), toSec(m.time));
    }
  };
  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(WS);
      ws.onopen = () => {
        retry = 1000;
        ws?.send(JSON.stringify({ type: "subscribe", channels: ["mark_price"], symbols: ["*"] }));
      };
      ws.onmessage = (e) => { try { handle(JSON.parse(String(e.data))); } catch {} };
      ws.onclose = () => { if (!stopped) { retryTimer = window.setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } };
      ws.onerror = () => {};
    } catch {
      retryTimer = window.setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    }
  };
  void poll();
  const pollTimer = window.setInterval(poll, 30000);
  connect();
  return () => {
    stopped = true;
    window.clearInterval(pollTimer);
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    if (ws) { ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.close(); }
  };
}
