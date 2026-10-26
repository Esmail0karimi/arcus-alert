/* Scheduled events and news for a market, drawn on the chart as dashed lines with a dot on top.
   Best effort: every source can fail (CORS, rate limits); whatever works is shown. */
import { yfGet, yfSym } from "./exchanges";

export type Ev = { id: string; t: number; kind: "earnings" | "news" | "dividend" | "split"; title: string; detail?: string; url?: string; source?: string; future: boolean };

const cache = new Map<string, { at: number; v: Ev[] }>();
const dayStr = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export async function fetchEvents(base: string, signal?: AbortSignal): Promise<Ev[]> {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.v;
  const sym = yfSym(base);
  const now = Date.now() / 1000;
  const out: Ev[] = [];
  const add = (e: Omit<Ev, "future" | "id">) => out.push({ ...e, id: e.kind + e.t + e.title.slice(0, 12), future: e.t > now });
  const jobs: Promise<void>[] = [];

  // 1) past earnings / dividends / splits that Yahoo keeps with the price history
  jobs.push(
    (async () => {
      const j = await yfGet("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=1y&events=div%2Csplit%2Cearn", signal);
      const ev = j?.chart?.result?.[0]?.events || {};
      for (const e of Object.values<any>(ev.earnings || {})) {
        const t = Number(e.date);
        if (!t) continue;
        const a = e.epsActual ?? e.epsReported, f = e.epsEstimate;
        const sur = a != null && f ? ((a - f) / Math.abs(f)) * 100 : null;
        add({
          t,
          kind: "earnings",
          title: "Earnings report",
          detail: a != null ? "EPS " + a + (f != null ? " vs estimate " + f : "") + (sur != null ? " (" + (sur >= 0 ? "+" : "") + sur.toFixed(1) + "% surprise)" : "") : "Quarterly results published.",
          source: "Yahoo Finance",
        });
      }
      for (const e of Object.values<any>(ev.dividends || {})) {
        if (e.date) add({ t: Number(e.date), kind: "dividend", title: "Dividend " + e.amount, detail: "Ex-dividend date: the price usually drops by about the dividend on this day.", source: "Yahoo Finance" });
      }
      for (const e of Object.values<any>(ev.splits || {})) {
        if (e.date) add({ t: Number(e.date), kind: "split", title: "Stock split " + (e.splitRatio || ""), detail: "Share count and price are adjusted.", source: "Yahoo Finance" });
      }
    })(),
  );
  // 2) recent news
  jobs.push(
    (async () => {
      const j = await yfGet("https://query1.finance.yahoo.com/v1/finance/search?quotesCount=0&listsCount=0&newsCount=12&q=" + encodeURIComponent(sym), signal);
      for (const n of j?.news || []) {
        if (!n.providerPublishTime || !n.title) continue;
        add({ t: Number(n.providerPublishTime), kind: "news", title: String(n.title), detail: n.publisher ? "Published by " + n.publisher : undefined, url: n.link, source: n.publisher });
      }
    })(),
  );
  // 3) upcoming earnings date (Nasdaq; stocks only)
  if (/^[A-Z]{1,5}$/.test(base)) {
    jobs.push(
      (async () => {
        const j = await yfGet("https://api.nasdaq.com/api/analyst/" + encodeURIComponent(base) + "/earnings-date", signal);
        const txt = String(j?.data?.reportText || j?.data?.announcement || "");
        const m = txt.match(/([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/);
        const t = m ? Date.parse(m[1] + " 12:00:00 UTC") / 1000 : 0;
        if (t) add({ t, kind: "earnings", title: "Upcoming earnings report", detail: "Expected on " + dayStr(t) + ". The company publishes revenue and profit (EPS) against analyst estimates; price often moves sharply right after.", source: "Nasdaq" });
      })(),
    );
  }
  await Promise.allSettled(jobs);
  const seen = new Set<string>();
  const list = out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.t - b.t);
  cache.set(base, { at: Date.now(), v: list });
  return list;
}
