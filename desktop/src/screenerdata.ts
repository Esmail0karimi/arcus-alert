/* Market stats for the Screener tab: Binance futures (24h volume, change, range, 1h volume spike) + Hyperliquid (funding, open interest). */
export type StatRow = {
  base: string;
  price?: number;
  chg24?: number; // %
  chg1h?: number;
  chg4h?: number;
  vol24?: number; // USD
  spike?: number; // last full hour volume / average of the previous 24 hours
  hi?: number;
  lo?: number;
  range?: number; // (hi-lo)/lo %
  pos?: number; // 0..100 where the price sits inside the 24h range
  funding?: number; // % per 8h
  oi?: number; // USD
  src: string[];
};
export type StatResult = { rows: Record<string, StatRow>; status: { name: string; ok: boolean; note?: string }[]; at: number };

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const jget = async (url: string, signal?: AbortSignal, init?: RequestInit) => {
  const r = await fetch(url, { signal, ...init });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
const baseOfBinance = (sym: string) => (sym.endsWith("USDT") ? sym.slice(0, -4).replace(/^1000+(?=[A-Z])/, "") : "");

export async function fetchStats(bases: string[], signal?: AbortSignal): Promise<StatResult> {
  const rows: Record<string, StatRow> = {};
  const status: StatResult["status"] = [];
  const row = (b: string) => (rows[b] = rows[b] || { base: b, src: [] });
  const want = new Set(bases);
  const [bin, hl] = await Promise.allSettled([
    jget("https://fapi.binance.com/fapi/v1/ticker/24hr", signal),
    jget("https://api.hyperliquid.xyz/info", signal, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) }),
  ]);
  if (bin.status === "fulfilled" && Array.isArray(bin.value)) {
    for (const t of bin.value) {
      const b = baseOfBinance(String(t.symbol));
      if (!b || !want.has(b)) continue;
      const r = row(b);
      const mult = /^1000/.test(String(t.symbol)) ? 1 / 1000 : 1;
      r.price = (num(t.lastPrice) ?? 0) * mult || r.price;
      r.chg24 = num(t.priceChangePercent);
      r.vol24 = num(t.quoteVolume);
      r.hi = (num(t.highPrice) ?? 0) * mult;
      r.lo = (num(t.lowPrice) ?? 0) * mult;
      if (r.hi && r.lo && r.price) {
        r.range = ((r.hi - r.lo) / r.lo) * 100;
        r.pos = r.hi > r.lo ? ((r.price - r.lo) / (r.hi - r.lo)) * 100 : 50;
      }
      r.src.push("Binance");
      (r as any)._bs = String(t.symbol);
    }
    status.push({ name: "Binance", ok: true });
  } else status.push({ name: "Binance", ok: false, note: "unreachable" });
  if (hl.status === "fulfilled" && Array.isArray(hl.value) && hl.value.length === 2) {
    const uni: any[] = hl.value[0]?.universe || [],
      ctx: any[] = hl.value[1] || [];
    uni.forEach((u, i) => {
      const b = String(u.name).replace(/^k(?=[A-Z])/, "");
      if (!want.has(b)) return;
      const c = ctx[i] || {};
      const r = row(b);
      const mark = num(c.markPx) ?? 0;
      if (r.vol24 == null) r.vol24 = num(c.dayNtlVlm);
      if (r.price == null) r.price = mark || undefined;
      if (r.chg24 == null && num(c.prevDayPx) && mark) r.chg24 = (mark / Number(c.prevDayPx) - 1) * 100;
      const f = num(c.funding);
      if (f != null) r.funding = f * 8 * 100;
      const oi = num(c.openInterest);
      if (oi != null && mark) r.oi = oi * mark;
      r.src.push("Hyperliquid");
    });
    status.push({ name: "Hyperliquid", ok: true });
  } else status.push({ name: "Hyperliquid", ok: false, note: "unreachable" });
  // hourly candles for the 40 most traded Binance symbols: sudden volume + short-term momentum
  const top = Object.values(rows)
    .filter((r: any) => r._bs && r.vol24)
    .sort((a, b) => (b.vol24 || 0) - (a.vol24 || 0))
    .slice(0, 40) as any[];
  let ok = 0;
  const queue = [...top];
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const k: any[] = await jget("https://fapi.binance.com/fapi/v1/klines?symbol=" + r._bs + "&interval=1h&limit=27", signal);
        if (k.length < 12) continue;
        const qv = (x: any[]) => Number(x[7]);
        const n = k.length;
        const last = k[n - 2]; // last completed hour
        const prev = k.slice(0, n - 2).slice(-24);
        const avg = prev.reduce((s, x) => s + qv(x), 0) / (prev.length || 1);
        if (avg > 0) r.spike = qv(last) / avg;
        r.chg1h = (Number(k[n - 1][4]) / Number(k[n - 1][1]) - 1) * 100;
        if (n >= 5) r.chg4h = (Number(k[n - 1][4]) / Number(k[n - 4][1]) - 1) * 100;
        ok++;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  status.push({ name: "Hourly volume", ok: ok > 0, note: ok ? "top " + ok + " by volume" : "unavailable" });
  return { rows, status, at: Date.now() };
}
