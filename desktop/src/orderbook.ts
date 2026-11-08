/* Order book data from several exchanges, normalised to [price, size in base coin] levels.
   Everything is a plain public REST call from the browser; an exchange that cannot be reached simply reports an error. */

export type Level = [number, number];
export type Book = { id: string; label: string; color: string; bids: Level[]; asks: Level[]; at: number };
export type ExState = { id: string; label: string; color: string; ok: boolean; msg: string; book?: Book };

export const EXCHANGES: { id: string; label: string; color: string }[] = [
  { id: "binance", label: "Binance", color: "#f0b90b" },
  { id: "binanceperp", label: "Binance Perp", color: "#d49a06" },
  { id: "coinbase", label: "Coinbase", color: "#3b82f6" },
  { id: "hl", label: "Hyperliquid", color: "#3ddc97" },
  { id: "lighter", label: "Lighter", color: "#b388ff" },
  { id: "arcus", label: "Arcus", color: "#00dcd2" },
];

const num = (v: any) => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const getJson = async (url: string, signal?: AbortSignal, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
const pairs = (rows: any[]): Level[] =>
  (rows || [])
    .map((x: any): Level => (Array.isArray(x) ? [num(x[0]), num(x[1])] : [num(x.price ?? x.px ?? x.p), num(x.size ?? x.sz ?? x.s ?? x.remaining_base_amount ?? x.quantity)]))
    .filter((l) => l[0] > 0 && l[1] > 0);

async function binance(base: string, signal?: AbortSignal): Promise<{ bids: Level[]; asks: Level[] }> {
  const j = await getJson("https://data-api.binance.vision/api/v3/depth?symbol=" + base + "USDT&limit=1000", signal);
  return { bids: pairs(j.bids), asks: pairs(j.asks) };
}
async function binancePerp(base: string, signal?: AbortSignal) {
  const j = await getJson("https://fapi.binance.com/fapi/v1/depth?symbol=" + base + "USDT&limit=1000", signal);
  return { bids: pairs(j.bids), asks: pairs(j.asks) };
}
async function coinbase(base: string, signal?: AbortSignal) {
  const j = await getJson("https://api.exchange.coinbase.com/products/" + base + "-USD/book?level=2", signal);
  return { bids: pairs(j.bids), asks: pairs(j.asks) };
}
/** Hyperliquid gives only ~20 levels per call, but nSigFigs widens the price step, so the wider the range the coarser the call. */
async function hyperliquid(base: string, rangePct: number, signal?: AbortSignal) {
  const call = async (coin: string, sig?: number) => {
    const body: any = { type: "l2Book", coin };
    if (sig) body.nSigFigs = sig;
    const j = await getJson("https://api.hyperliquid.xyz/info", signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const lv = j?.levels;
    if (!lv || lv.length < 2 || !lv[0].length) throw new Error("no book");
    return { bids: pairs(lv[0]), asks: pairs(lv[1]) } as { bids: Level[]; asks: Level[] };
  };
  const coin = async (sig?: number) => {
    try {
      return await call(base, sig);
    } catch {
      return await call("k" + base, sig);
    }
  };
  const span = (b: { bids: Level[]; asks: Level[] }) => {
    const hi = b.asks.length ? b.asks[b.asks.length - 1][0] : 0, lo = b.bids.length ? b.bids[b.bids.length - 1][0] : 0, mid = (b.asks[0]?.[0] + b.bids[0]?.[0]) / 2;
    return hi && lo && mid ? Math.min(hi / mid - 1, 1 - lo / mid) * 100 : 0;
  };
  let best = await coin();
  for (const sig of [4, 3, 2]) {
    if (span(best) >= rangePct * 0.9) break;
    try {
      const b = await coin(sig);
      if (span(b) > span(best)) best = b;
    } catch {}
  }
  return best;
}
let ltMarkets: Record<string, number> | null = null;
async function lighter(base: string, signal?: AbortSignal) {
  const LT = "https://mainnet.zklighter.elliot.ai";
  if (!ltMarkets) {
    const j = await getJson(LT + "/api/v1/orderBooks", signal);
    const m: Record<string, number> = {};
    for (const o of j?.order_books || j?.orderBooks || []) if (o?.symbol != null && o?.market_id != null) m[String(o.symbol).toUpperCase()] = Number(o.market_id);
    ltMarkets = m;
  }
  const id = ltMarkets[base.toUpperCase()];
  if (id == null) throw new Error("not listed");
  const j = await getJson(LT + "/api/v1/orderBookOrders?market_id=" + id + "&limit=250", signal);
  return { bids: pairs(j.bids), asks: pairs(j.asks) };
}
/** Arcus: its public order book path is not documented anywhere this app could confirm, so a few likely paths are tried. */
async function arcus(base: string, signal?: AbortSignal) {
  const m = encodeURIComponent(base + "-USD");
  let last: any;
  for (const u of ["https://api.arcus.xyz/v1/orderbook?market=" + m, "https://api.arcus.xyz/v1/book?market=" + m, "https://api.arcus.xyz/v1/depth?market=" + m]) {
    try {
      const j = await getJson(u, signal);
      const d = j?.data || j?.book || j;
      const b = { bids: pairs(d.bids || d.buys), asks: pairs(d.asks || d.sells) };
      if (b.bids.length || b.asks.length) return b;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(last?.message?.includes("HTTP 404") ? "no public order book endpoint" : "not reachable");
}

/** Loads every exchange on its own: each one has a timeout and reports as soon as it answers, so one slow exchange never blocks the rest. */
export function loadBooks(base: string, rangePct: number, ids: string[], onState: (s: ExState) => void, signal?: AbortSignal, timeoutMs = 8000): Promise<void> {
  const run = async (ex: (typeof EXCHANGES)[number]) => {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
    try {
      let b: { bids: Level[]; asks: Level[] };
      if (ex.id === "binance") b = await binance(base, ctl.signal);
      else if (ex.id === "binanceperp") b = await binancePerp(base, ctl.signal);
      else if (ex.id === "coinbase") b = await coinbase(base, ctl.signal);
      else if (ex.id === "hl") b = await hyperliquid(base, rangePct, ctl.signal);
      else if (ex.id === "lighter") b = await lighter(base, ctl.signal);
      else b = await arcus(base, ctl.signal);
      if (!b.bids.length && !b.asks.length) throw new Error("empty");
      b.bids.sort((x, y) => y[0] - x[0]);
      b.asks.sort((x, y) => x[0] - y[0]);
      if (!signal?.aborted) onState({ id: ex.id, label: ex.label, color: ex.color, ok: true, msg: "", book: { id: ex.id, label: ex.label, color: ex.color, ...b, at: Date.now() } });
    } catch (e: any) {
      if (signal?.aborted) return;
      const m = String(e?.message || e);
      onState({ id: ex.id, label: ex.label, color: ex.color, ok: false, msg: timedOut ? "no answer (blocked?)" : /HTTP (4(00|04|51)|500)/.test(m) && ex.id !== "arcus" ? "not listed here" : /Failed to fetch|NetworkError|Load failed/i.test(m) ? "blocked / unreachable" : m.slice(0, 40) });
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return Promise.all(EXCHANGES.filter((x) => ids.includes(x.id)).map(run)).then(() => undefined);
}

export type Bucket = { lo: number; hi: number; mid: number; by: Record<string, number>; total: number };
export type Ladder = { mid: number; bids: Bucket[]; asks: Bucket[]; maxTotal: number; coverage: Record<string, number>; bidSum: number; askSum: number };

/** Sum every exchange's resting size (in USD) into price buckets above and below the mid price. */
export function buildLadder(books: Book[], rangePct: number, n = 30): Ladder | null {
  const mids = books.filter((b) => b.bids.length && b.asks.length).map((b) => (b.bids[0][0] + b.asks[0][0]) / 2).sort((a, b) => a - b);
  if (!mids.length) return null;
  const mid = mids[Math.floor(mids.length / 2)];
  const w = (mid * rangePct) / 100, step = w / n;
  const mk = (sign: 1 | -1): Bucket[] =>
    Array.from({ length: n }, (_, i) => {
      const a = mid + sign * i * step, b = mid + sign * (i + 1) * step;
      return { lo: Math.min(a, b), hi: Math.max(a, b), mid: (a + b) / 2, by: {}, total: 0 };
    });
  const bids = mk(-1), asks = mk(1);
  const coverage: Record<string, number> = {};
  for (const bk of books) {
    const bTail = bk.bids.length ? bk.bids[bk.bids.length - 1][0] : mid, aTail = bk.asks.length ? bk.asks[bk.asks.length - 1][0] : mid;
    coverage[bk.id] = Math.max(0, Math.min((1 - bTail / mid) * 100, (aTail / mid - 1) * 100));
    for (const [p, s] of bk.bids) {
      const i = Math.floor((mid - p) / step);
      if (i >= 0 && i < n) { const v = p * s; bids[i].by[bk.id] = (bids[i].by[bk.id] || 0) + v; bids[i].total += v; }
    }
    for (const [p, s] of bk.asks) {
      const i = Math.floor((p - mid) / step);
      if (i >= 0 && i < n) { const v = p * s; asks[i].by[bk.id] = (asks[i].by[bk.id] || 0) + v; asks[i].total += v; }
    }
  }
  const maxTotal = Math.max(1, ...bids.map((b) => b.total), ...asks.map((b) => b.total));
  return { mid, bids, asks, maxTotal, coverage, bidSum: bids.reduce((s, b) => s + b.total, 0), askSum: asks.reduce((s, b) => s + b.total, 0) };
}

/** Every coin the exchanges list, most-traded first (Binance volume order, then Hyperliquid and Lighter extras). */
export async function loadSymbols(signal?: AbortSignal): Promise<string[]> {
  const t = (p: Promise<string[]>) => Promise.race([p.catch(() => [] as string[]), new Promise<string[]>((r) => window.setTimeout(() => r([]), 8000))]);
  const [bn, hl, lt] = await Promise.all([
    t(getJson("https://fapi.binance.com/fapi/v1/ticker/24hr", signal).then((j: any[]) =>
      j.filter((x) => /USDT$/.test(x.symbol)).sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume)).map((x) => String(x.symbol).replace(/USDT$/, "")),
    )),
    t(getJson("https://api.hyperliquid.xyz/info", signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "meta" }) }).then((j: any) =>
      (j?.universe || []).map((u: any) => String(u.name).replace(/^k/, "")),
    )),
    t(getJson("https://mainnet.zklighter.elliot.ai/api/v1/orderBooks", signal).then((j: any) => (j?.order_books || j?.orderBooks || []).map((o: any) => String(o.symbol).toUpperCase()))),
  ]);
  const seen = new Set<string>(), out: string[] = [];
  for (const s of [...bn, ...hl, ...lt]) {
    const v = s.toUpperCase().replace(/^1000(000)?/, "");
    if (/^[A-Z0-9]{2,12}$/.test(v) && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}
