/* Market-moving events for the News tab: ForexFactory calendar (macro), Nasdaq earnings (single stocks), built-in Fed dates as a fallback. */
import { YF_WRAP } from "./exchanges";

export type Impact = "High" | "Medium" | "Low" | "Holiday";
export type NewsEv = {
  id: string;
  t: number; // ms
  title: string;
  impact: Impact;
  kind: "macro" | "earnings";
  currency?: string;
  symbol?: string; // base ticker for earnings
  scope: "all" | "currency" | "symbol";
  scopeText: string;
  forecast?: string;
  previous?: string;
  extra?: string;
  source: string;
};
export type NewsResult = { list: NewsEv[]; status: { name: string; ok: boolean; note?: string; pending?: boolean }[]; at: number; rates?: Rates; hosted?: boolean };
export type Rates = { yields: Record<string, number>; date: string; policy: number; hint: "cuts" | "hikes" | "hold"; hintText: string };

const CK = "arcus.news.v1";
const withTimeout = async (url: string, ms: number, signal?: AbortSignal) => {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};
let relayOk = -1; // index of the relay that worked last time
/** Direct first (4 s); if blocked, ask every public relay at once and take the first answer. */
const get = async (url: string, signal?: AbortSignal): Promise<any> => {
  if (relayOk < 0) {
    try {
      return await withTimeout(url, 4000, signal);
    } catch (e: any) {
      if (signal?.aborted) throw e;
    }
  }
  const wraps = YF_WRAP.map((w, i) => ({ w, i })).filter((x) => x.i > 0);
  const order = relayOk > 0 ? [wraps.find((x) => x.i === relayOk)!, ...wraps.filter((x) => x.i !== relayOk)] : wraps;
  return Promise.any(order.map((x) => withTimeout(x.w(url), 6500, signal).then((j) => ((relayOk = x.i), j)))).catch((e) => {
    relayOk = -1;
    throw e;
  });
};

/** FOMC decision days (second day of each meeting), 14:00 New York time. */
const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];
const nyUtc = (day: string, hh: number, mm: number) => {
  // New York is UTC-4 until the first Sunday of November, UTC-5 after (good enough for a fallback)
  const d = new Date(day + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const nov1 = new Date(Date.UTC(y, 10, 1));
  const dstEnd = Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7), 6);
  const mar1 = new Date(Date.UTC(y, 2, 1));
  const dstStart = Date.UTC(y, 2, 1 + ((7 - mar1.getUTCDay()) % 7) + 7, 7);
  const off = d.getTime() >= dstStart && d.getTime() < dstEnd ? 4 : 5;
  return Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), hh + off, mm);
};

const CUR_TEXT: Record<string, string> = {
  USD: "USD pairs, gold, US indices & crypto", EUR: "EUR pairs & European indices", GBP: "GBP pairs & UK indices", JPY: "JPY pairs & Nikkei",
  AUD: "AUD pairs", NZD: "NZD pairs", CAD: "CAD pairs & oil", CHF: "CHF pairs", CNY: "CNY, commodities & Asian markets",
};
const BIG = /fomc|federal funds|fed chair|powell|non-?farm|nfp|\bcpi\b|\bpce\b|interest rate|rate decision|ecb press|boj|boe/i;

const classify = (ev: { title: string; country: string; impact: string }): { impact: Impact; scope: NewsEv["scope"]; scopeText: string } => {
  let impact = (ev.impact as Impact) || "Low";
  if (!["High", "Medium", "Low", "Holiday"].includes(impact)) impact = "Low";
  const cur = ev.country;
  if (cur === "USD" && (impact === "High" || BIG.test(ev.title))) return { impact: BIG.test(ev.title) ? "High" : impact, scope: "all", scopeText: "All markets" };
  if (impact === "High" && /^(EUR|GBP|JPY|CNY)$/.test(cur) && BIG.test(ev.title)) return { impact, scope: "all", scopeText: "Global · " + cur + " focus" };
  return { impact, scope: "currency", scopeText: CUR_TEXT[cur] || cur + " markets" };
};

const parseCap = (s: string) => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;

async function fetchNewsBrowser(tracked: Set<string>, signal?: AbortSignal, onPartial?: (r: NewsResult) => void): Promise<NewsResult> {
  const list: NewsEv[] = [];
  const st = new Map<string, { name: string; ok: boolean; note?: string; pending?: boolean }>();
  const now = Date.now();
  const build = (): NewsResult => {
    const seen = new Set<string>();
    const out = list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.t - b.t);
    return { list: out, status: [...st.values()], at: now };
  };
  const emit = () => onPartial?.(build());
  const setSt = (name: string, ok: boolean, note?: string, pending = false) => st.set(name, { name, ok, note, pending });
  setSt("ForexFactory", true, "loading…", true);
  setSt("Fed dates", true, "built-in schedule");
  setSt("Earnings", true, "loading…", true);
  // built-in Fed dates first: they show up instantly
  const addFomc = () => {
    for (const d of FOMC_2026) {
      const t = nyUtc(d, 14, 0);
      if (t < now - 864e5 || t > now + 21 * 864e5) continue;
      if (list.some((x) => x.source !== "Fed calendar (built-in)" && /fomc|federal funds/i.test(x.title) && Math.abs(x.t - t) < 36e5 * 14)) continue;
      if (list.some((x) => x.id === "fomc" + d)) continue;
      list.push({ id: "fomc" + d, t, title: "FOMC interest-rate decision & statement", impact: "High", kind: "macro", currency: "USD", scope: "all", scopeText: "All markets", extra: "Press conference follows at 14:30 New York time.", source: "Fed calendar (built-in)" });
    }
  };
  addFomc();
  emit();

  const ff = async () => {
    const got = await Promise.allSettled(["thisweek", "nextweek"].map((w) => get("https://nfs.faireconomy.media/ff_calendar_" + w + ".json", signal)));
    let n = 0;
    for (const g of got) {
      if (g.status !== "fulfilled" || !Array.isArray(g.value)) continue;
      for (const e of g.value) {
        const t = Date.parse(e.date);
        if (!t || !e.title) continue;
        const c = classify(e);
        list.push({ id: "ff" + t + e.title + e.country, t, title: String(e.title), impact: c.impact, kind: "macro", currency: e.country, scope: c.scope, scopeText: c.scopeText, forecast: e.forecast || undefined, previous: e.previous || undefined, source: "ForexFactory" });
        n++;
      }
    }
    // drop the built-in Fed entries that ForexFactory already lists
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x.source === "Fed calendar (built-in)" && list.some((y) => y.source === "ForexFactory" && /fomc|federal funds/i.test(y.title) && Math.abs(y.t - x.t) < 36e5 * 14)) list.splice(i, 1);
    }
    setSt("ForexFactory", n > 0, n ? n + " events" : "unreachable");
    emit();
  };

  const earn = async () => {
    let eOk = 0;
    const dayStr = (i: number) => new Date(now + i * 864e5).toISOString().slice(0, 10);
    const scanDay = async (day: string) => {
      try {
        const j = await get("https://api.nasdaq.com/api/calendar/earnings?date=" + day, signal);
        const rows: any[] = j?.data?.rows || [];
        eOk++;
        for (const r of rows) {
          const sym = String(r.symbol || "").toUpperCase();
          if (!sym || !tracked.has(sym)) continue;
          const cap = parseCap(r.marketCap);
          const hh = /after/i.test(r.time || "") ? 16 : /pre|before/i.test(r.time || "") ? 8 : 12;
          const t = nyUtc(day, hh, hh === 12 ? 0 : 5);
          list.push({
            id: "er" + sym + day, t, title: (r.name ? r.name + " " : sym + " ") + "earnings report", impact: cap >= 2e11 ? "High" : "Medium", kind: "earnings", symbol: sym,
            scope: "symbol", scopeText: "Only " + sym, forecast: r.epsForecast || undefined, previous: r.lastYearEPS || undefined,
            extra: (/after/i.test(r.time || "") ? "After market close" : /pre|before/i.test(r.time || "") ? "Before market open" : "Time not announced") + (r.fiscalQuarterEnding ? " · quarter " + r.fiscalQuarterEnding : ""), source: "Nasdaq",
          });
        }
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
      }
    };
    const hasStock = () => list.some((x) => x.kind === "earnings" && x.t > now);
    const weekdays = (from: number, to: number) => {
      const out: number[] = [];
      for (let i = from; i < to; i++) if (new Date(now + i * 864e5).getUTCDay() % 6 !== 0) out.push(i);
      return out;
    };
    // all 10 near days at once, then 20 days further at once, and so on until a tracked stock is found
    for (let start = -1; start < 100; start += start < 0 ? 11 : 20) {
      const end = start < 0 ? 10 : start + 20;
      await Promise.all(weekdays(start, end).map((i) => scanDay(dayStr(i))));
      setSt("Earnings", eOk > 0, eOk ? "scanned to +" + end + " days" : "loading…", eOk === 0 && start < 0);
      emit();
      if (eOk === 0 || hasStock()) break;
    }
    let note = eOk ? (hasStock() ? "" : "no upcoming report found") : "Nasdaq unreachable";
    if (!hasStock()) {
      let n = 0;
      const syms = [...tracked].slice(0, 8);
      await Promise.all(
        syms.map(async (b) => {
          try {
            const j = await get("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(b) + "?interval=1d&range=6mo&events=earn", signal);
            const ev = j?.chart?.result?.[0]?.events?.earnings || {};
            for (const e of Object.values<any>(ev)) {
              const t = Number(e.date) * 1000;
              if (!t) continue;
              list.push({ id: "pe" + b + t, t, title: b + " earnings report (past)", impact: "Medium", kind: "earnings", symbol: b, scope: "symbol", scopeText: "Only " + b, forecast: e.epsEstimate != null ? String(e.epsEstimate) : undefined, extra: e.epsActual != null ? "Reported EPS " + e.epsActual + (e.epsEstimate != null ? " vs estimate " + e.epsEstimate : "") : "Already reported", source: "Yahoo Finance" });
              n++;
            }
          } catch (e: any) {
            if (e?.name === "AbortError") throw e;
          }
        }),
      );
      note += (note ? " · " : "") + (n ? "showing " + n + " recent reports (Yahoo)" : tracked.size ? "no stock data" : "no stocks in your lists");
      setSt("Earnings", eOk > 0 || n > 0, note);
    } else setSt("Earnings", true, note);
    emit();
  };

  await Promise.allSettled([ff(), earn()]);
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  addFomc();
  const res = build();
  if (res.list.length > 2) {
    try {
      localStorage.setItem(CK, JSON.stringify(res));
    } catch {}
  }
  return res;
}
export const cachedNews = (): NewsResult | null => {
  try {
    const v = JSON.parse(localStorage.getItem(CK) || "null");
    return v && Array.isArray(v.list) ? v : null;
  } catch {
    return null;
  }
};


/* ---------- server-collected data ----------
   A scheduled GitHub job reads ForexFactory, Nasdaq, SEC EDGAR, the Fed, Treasury, StockAnalysis and Finviz
   (sources that block browsers) and publishes plain JSON on the `news-data` branch. raw.githubusercontent.com allows browser reads. */
const HOSTS = ["https://raw.githubusercontent.com/Esmail0karimi/arcus-alert/news-data/", "https://cdn.jsdelivr.net/gh/Esmail0karimi/arcus-alert@news-data/"];
export type Hosted = { at: number; events: NewsEv[]; rates?: Rates; sources: { name: string; ok: boolean; note?: string; n?: number }[]; details: string[] };
export type Company = any;
const HK = "arcus.newsdata.v1";
const hget = async (path: string, signal?: AbortSignal): Promise<any> => {
  const bust = "?v=" + Math.floor(Date.now() / 120000);
  const one = async (base: string) => {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 9000);
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const r = await fetch(base + path + (base.includes("raw.") ? bust : ""), { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return Promise.any(HOSTS.map(one));
};
let hMem: { at: number; v: Hosted } | null = null;
let hBusy: Promise<Hosted> | null = null;
export const cachedHosted = (): Hosted | null => {
  if (hMem) return hMem.v;
  try {
    const v = JSON.parse(localStorage.getItem(HK) || "null");
    if (v && Array.isArray(v.events)) return v;
  } catch {}
  return null;
};
export async function loadHosted(signal?: AbortSignal, force = false): Promise<Hosted> {
  if (!force && hMem && Date.now() - hMem.at < 3 * 60e3) return hMem.v;
  if (hBusy) return hBusy;
  hBusy = (async () => {
    const v: Hosted = await hget("news.json", signal);
    if (!v || !Array.isArray(v.events)) throw new Error("bad data");
    hMem = { at: Date.now(), v };
    try {
      localStorage.setItem(HK, JSON.stringify(v));
    } catch {}
    return v;
  })().finally(() => (hBusy = null));
  return hBusy;
}
const cMem = new Map<string, { at: number; v: Company | null }>();
export async function loadCompany(sym: string, signal?: AbortSignal): Promise<Company | null> {
  const k = sym.toUpperCase();
  const hit = cMem.get(k);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.v;
  try {
    const v = await hget("earn/" + encodeURIComponent(k) + ".json", signal);
    cMem.set(k, { at: Date.now(), v });
    return v;
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    cMem.set(k, { at: Date.now(), v: null });
    return null;
  }
}
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
};
export function hostedToResult(h: Hosted, tracked: Set<string>): NewsResult {
  const from = Date.now() - 3 * 864e5;
  const list = h.events.filter((e) => e.t >= from && (e.kind !== "earnings" || (e.symbol && tracked.has(e.symbol))));
  const status = [
    ...h.sources.map((s) => ({ name: s.name, ok: s.ok, note: s.note })),
    { name: "Server data", ok: true, note: "collected " + ago(h.at) },
  ];
  return { list, status, at: Date.now(), rates: h.rates, hosted: true };
}

/** Calendar + server data first (fast, no browser blocks); if the server data cannot be read, fall back to asking the sites directly. */
export async function fetchNews(tracked: Set<string>, signal?: AbortSignal, onPartial?: (r: NewsResult) => void, force = false): Promise<NewsResult> {
  try {
    const h = await loadHosted(signal, force);
    const res = hostedToResult(h, tracked);
    try {
      localStorage.setItem(CK, JSON.stringify(res));
    } catch {}
    return res;
  } catch (e: any) {
    if (signal?.aborted) throw e;
    const res = await fetchNewsBrowser(tracked, signal, onPartial);
    res.status.unshift({ name: "Server data", ok: false, note: "unreachable, asking the sites directly" });
    return res;
  }
}
