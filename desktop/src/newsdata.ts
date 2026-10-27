/* Market-moving events for the News tab: ForexFactory calendar (macro), Nasdaq earnings (single stocks), built-in Fed dates as a fallback. */
import { yfGet } from "./exchanges";

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
export type NewsResult = { list: NewsEv[]; status: { name: string; ok: boolean; note?: string }[]; at: number };

const CK = "arcus.news.v1";
const get = async (url: string, signal?: AbortSignal) => {
  try {
    const r = await fetch(url, { signal });
    if (r.ok) return await r.json();
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
  }
  return yfGet(url, signal); // direct failed (CORS / rate limit): try the public relays
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

export async function fetchNews(tracked: Set<string>, signal?: AbortSignal): Promise<NewsResult> {
  const list: NewsEv[] = [];
  const status: NewsResult["status"] = [];
  const now = Date.now();
  // 1) ForexFactory weekly calendar (this week + next week)
  const ffAll: any[] = [];
  let ffOk = false;
  for (const w of ["thisweek", "nextweek"]) {
    try {
      const j = await get("https://nfs.faireconomy.media/ff_calendar_" + w + ".json", signal);
      if (Array.isArray(j)) {
        ffAll.push(...j);
        ffOk = true;
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
    }
  }
  for (const e of ffAll) {
    const t = Date.parse(e.date);
    if (!t || !e.title) continue;
    const c = classify(e);
    list.push({ id: "ff" + t + e.title + e.country, t, title: String(e.title), impact: c.impact, kind: "macro", currency: e.country, scope: c.scope, scopeText: c.scopeText, forecast: e.forecast || undefined, previous: e.previous || undefined, source: "ForexFactory" });
  }
  status.push({ name: "ForexFactory", ok: ffOk, note: ffOk ? ffAll.length + " events" : "unreachable" });
  // 2) built-in Fed dates (always; skipped when ForexFactory already lists FOMC that day)
  for (const d of FOMC_2026) {
    const t = nyUtc(d, 14, 0);
    if (t < now - 864e5 || t > now + 21 * 864e5) continue;
    if (list.some((x) => /fomc|federal funds/i.test(x.title) && Math.abs(x.t - t) < 36e5 * 14)) continue;
    list.push({ id: "fomc" + d, t, title: "FOMC interest-rate decision & statement", impact: "High", kind: "macro", currency: "USD", scope: "all", scopeText: "All markets", extra: "Press conference follows at 14:30 New York time.", source: "Fed calendar (built-in)" });
  }
  status.push({ name: "Fed dates", ok: true, note: "built-in schedule" });
  // 3) earnings from Nasdaq for the next 10 days, only for symbols this app tracks
  let eOk = 0, eTry = 0;
  const days: string[] = [];
  for (let i = -1; i < 10; i++) days.push(new Date(now + i * 864e5).toISOString().slice(0, 10));
  await Promise.all(
    days.map(async (day) => {
      eTry++;
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
    }),
  );
  status.push({ name: "Earnings", ok: eOk > 0, note: eOk ? "" : "Nasdaq unreachable" });
  const seen = new Set<string>();
  const out = list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.t - b.t);
  const res = { list: out, status, at: now };
  if (out.length > 2) {
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
