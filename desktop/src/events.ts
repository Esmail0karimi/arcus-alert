/* Scheduled events and news for a market, drawn on the chart as dashed lines with a dot on top.
   Best effort: every source can fail (CORS, rate limits); whatever works is shown. */
import { yfGet, yfSym } from "./exchanges";
import { findAsset } from "./assetinfo";
import { loadCompany, loadHosted } from "./newsdata";
import type { ReportReq } from "./report";

export type Ev = { id: string; t: number; kind: "earnings" | "news" | "dividend" | "split" | "macro"; report?: ReportReq; title: string; detail?: string; url?: string; source?: string; future: boolean };

export type EvResult = { list: Ev[]; failed: number; total: number; names: string[] };
const cache = new Map<string, { at: number; v: EvResult }>();
const dayStr = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const jget = async (url: string, signal?: AbortSignal) => {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 9000);
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

export async function fetchEvents(base: string, signal?: AbortSignal, name?: string): Promise<EvResult> {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.v;
  const sym = yfSym(base);
  const now = Date.now() / 1000;
  const out: Ev[] = [];
  const add = (e: Omit<Ev, "future" | "id">) => out.push({ ...e, id: e.kind + e.t + e.title.slice(0, 12), future: e.t > now });
  const jobs: Promise<void>[] = [];
  const jobNames: string[] = [];

  // 0) the same server data the News tab uses: earnings dates + history, SEC filings, headlines, big macro events
  jobNames.push("News data");
  let gotHosted = false;
  jobs.push(
    (async () => {
      const h = await loadHosted(signal);
      const nowMs = Date.now();
      const rep: ReportReq = { symbol: base };
      for (const e of h.events) {
        if (e.kind === "earnings" && e.symbol === base) {
          add({ t: Math.floor(e.t / 1000), kind: "earnings", title: e.t > nowMs ? "Earnings report" : "Earnings report (today/just now)", detail: [e.forecast ? "Analysts expect EPS " + e.forecast : "", e.extra || ""].filter(Boolean).join(" · "), source: e.source, report: rep });
          gotHosted = true;
        } else if (e.kind === "macro" && e.impact === "High" && e.scope === "all" && e.t > nowMs - 90 * 864e5) {
          add({ t: Math.floor(e.t / 1000), kind: "macro", title: e.title, detail: "Affects all markets" + (e.forecast ? " · forecast " + e.forecast : "") + (e.previous ? " · previous " + e.previous : ""), source: e.source, report: { evId: e.id } });
          gotHosted = true;
        }
      }
      const c = await loadCompany(base, signal);
      if (c) {
        for (const x of c.history || []) {
          if (!x.reported) continue;
          const t = Date.parse(x.reported + "T21:00:00Z") / 1000; // reports come around the US close
          const sur = x.surprisePct;
          add({ t, kind: "earnings", title: "Earnings report " + (x.period || ""), detail: "EPS " + x.epsActual + " vs estimate " + x.epsEst + (sur != null ? " (" + (sur >= 0 ? "+" : "") + sur + "% surprise)" : ""), source: "Nasdaq", report: rep });
        }
        for (const f of c.filings || []) {
          const t = Date.parse(f.date + "T14:00:00Z") / 1000;
          add({ t, kind: "news", title: "SEC filing " + f.form + (/2\.02/.test(f.items || "") ? " · results" : ""), detail: "Filed with the SEC on " + f.date, url: f.url, source: "SEC EDGAR" });
        }
        for (const n of c.news || []) add({ t: Math.floor(n.t / 1000), kind: "news", title: n.title, detail: n.source ? "Published by " + n.source : undefined, url: n.url, source: n.source || "Finviz" });
        gotHosted = true;
      }
    })(),
  );
  // 1) past earnings / dividends / splits that Yahoo keeps with the price history
  jobNames.push("past earnings/dividends");
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
  jobNames.push("news");
  jobs.push(
    (async () => {
      const j = await yfGet("https://query1.finance.yahoo.com/v1/finance/search?quotesCount=0&listsCount=0&newsCount=12&q=" + encodeURIComponent(sym), signal);
      for (const n of j?.news || []) {
        if (!n.providerPublishTime || !n.title) continue;
        add({ t: Number(n.providerPublishTime), kind: "news", title: String(n.title), detail: n.publisher ? "Published by " + n.publisher : undefined, url: n.link, source: n.publisher });
      }
    })(),
  );
  // 2b) news from GDELT (open, allows browser requests): searched by company name
  jobNames.push("news (GDELT)");
  jobs.push(
    (async () => {
      let name = "";
      try {
        const a = await findAsset(base, signal);
        name = (a?.who?.name || a?.title || "").replace(/\s*\(.*?\)\s*$/, "").trim();
      } catch {}
      const q = name ? '"' + name + '" sourcelang:english' : base + " stock sourcelang:english";
      const r = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=15&sort=datedesc&timespan=3months&query=" + encodeURIComponent(q), { signal });
      if (!r.ok) throw new Error("GDELT " + r.status);
      const j = await r.json();
      for (const a of j?.articles || []) {
        const m = String(a.seendate || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
        if (!m || !a.title) continue;
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
        add({ t, kind: "news", title: String(a.title), detail: a.domain ? "Published by " + a.domain : undefined, url: a.url, source: a.domain || "GDELT" });
      }
    })(),
  );
  // 3) upcoming earnings date (Nasdaq; stocks only)
  if (/^[A-Z]{1,5}$/.test(base)) {
    jobNames.push("upcoming earnings");
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
  if (name) {
    const q = name.replace(/\(.*?\)/g, "").trim();
    // 4) GDELT: worldwide news index (open, CORS-enabled)
    jobNames.push("GDELT news");
    jobs.push(
      (async () => {
        const j = await jget("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=15&sort=datedesc&timespan=3months&query=" + encodeURIComponent('"' + q + '" sourcelang:eng'), signal);
        for (const a of j?.articles || []) {
          const m = String(a.seendate || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
          if (!m || !a.title) continue;
          const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
          add({ t, kind: "news", title: String(a.title), detail: a.domain ? "Published by " + a.domain : undefined, url: a.url, source: "GDELT · " + (a.domain || "") });
        }
      })(),
    );
    // 5) Hacker News (Algolia): tech / business stories about the company
    jobNames.push("Hacker News");
    jobs.push(
      (async () => {
        const since = Math.floor(Date.now() / 1000) - 90 * 86400;
        const j = await jget("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=10&numericFilters=" + encodeURIComponent("created_at_i>" + since) + "&query=" + encodeURIComponent(q), signal);
        for (const h of j?.hits || []) {
          if (!h.title || !h.created_at_i || (h.points || 0) < 20) continue;
          add({ t: Number(h.created_at_i), kind: "news", title: String(h.title), detail: (h.points || 0) + " points on Hacker News", url: h.url || "https://news.ycombinator.com/item?id=" + h.objectID, source: "Hacker News" });
        }
      })(),
    );
  }
  const state: ("run" | "ok" | "fail")[] = jobs.map(() => "run");
  const all = Promise.all(jobs.map((j, i) => j.then(() => void (state[i] = "ok"), () => void (state[i] = "fail"))));
  // when the server data answered, do not wait more than 4 s for the browser-blocked sources
  const quick = jobs[0].then(
    () => new Promise<void>((r) => window.setTimeout(r, 4000)),
    () => all,
  );
  await Promise.race([all, quick]);
  const failed = state.filter((x) => x === "fail").length;
  const seen = new Set<string>();
  const list = out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => a.t - b.t);
  const res: EvResult = { list, failed, total: jobs.length, names: state.map((x, i) => (x === "fail" ? jobNames[i] : "")).filter(Boolean) };
  if (list.length) cache.set(base, { at: Date.now(), v: res });
  return res;
}
