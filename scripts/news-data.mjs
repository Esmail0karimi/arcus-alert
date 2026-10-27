// Server-side news/earnings collector. Runs on a GitHub runner (no CORS, normal browser-like requests)
// and writes plain JSON files that the web app reads from raw.githubusercontent.com (CORS: *).
//
//   out/news.json            calendar: macro events (ForexFactory, Fed), earnings, rates snapshot, source status
//   out/earn/<TICKER>.json   per-company report data: history, analyst forecast, guidance, filings, headlines
//
// Sources that answer from a server: Nasdaq, SEC EDGAR, StockAnalysis, Finviz, ForexFactory, federalreserve.gov, Treasury.
// Sources that block bots (investing.com, Macrotrends, CME FedWatch, Yahoo) are not used here.
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT_DIR || "out";
const PREV = process.env.PREV_DIR || ""; // checkout of the news-data branch (to keep slow-changing details between runs)
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SEC_UA = "ArcusAlert research contact karimiesmail37@gmail.com";
const NQ = { "User-Agent": UA, Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" };
const MAX_DETAIL = Number(process.env.MAX_DETAIL || 110);
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(0).padStart(4) + "s", ...a);

fs.mkdirSync(path.join(OUT, "earn"), { recursive: true });

async function fetchText(url, headers = {}, { tries = 3, timeout = 20000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctl.signal });
      const txt = await r.text();
      clearTimeout(to);
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return txt;
    } catch (e) {
      clearTimeout(to);
      last = e;
      await sleep(800 * (i + 1));
    }
  }
  throw last;
}
const fetchJson = async (url, headers, opt) => JSON.parse(await fetchText(url, headers, opt));
const nq = (p) => fetchJson("https://api.nasdaq.com/api/" + p, NQ);

/** Run async jobs with limited concurrency. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = await fn(items[k], k);
        } catch (e) {
          out[k] = undefined;
        }
      }
    }),
  );
  return out;
}

// ---------- time helpers (US Eastern -> UTC) ----------
const etOffsetMin = (utcMs) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(utcMs));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const m = tz.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) * 60 + (m[1].startsWith("-") ? -1 : 1) * Number(m[2] || 0) : -300;
};
const etToUtc = (y, mo, d, hh, mm) => {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const first = guess - etOffsetMin(guess) * 60000;
  return guess - etOffsetMin(first) * 60000;
};
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- status bookkeeping ----------
const status = new Map();
const setStatus = (name, ok, note, n) => status.set(name, { name, ok, note, n });

// ---------- 1) ForexFactory ----------
const CUR_TEXT = {
  USD: "USD pairs, gold, US indices & crypto", EUR: "EUR pairs & European indices", GBP: "GBP pairs & UK indices", JPY: "JPY pairs & Nikkei",
  AUD: "AUD pairs", NZD: "NZD pairs", CAD: "CAD pairs & oil", CHF: "CHF pairs", CNY: "CNY, commodities & Asian markets",
};
const BIG = /fomc|federal funds|fed chair|powell|non-?farm|nfp|\bcpi\b|\bpce\b|interest rate|rate decision|ecb press|boj|boe/i;
function classifyMacro(ev) {
  let impact = ["High", "Medium", "Low", "Holiday"].includes(ev.impact) ? ev.impact : "Low";
  const cur = ev.country;
  if (cur === "USD" && (impact === "High" || BIG.test(ev.title))) return { impact: BIG.test(ev.title) ? "High" : impact, scope: "all", scopeText: "All markets" };
  if (impact === "High" && /^(EUR|GBP|JPY|CNY)$/.test(cur) && BIG.test(ev.title)) return { impact, scope: "all", scopeText: "Global · " + cur + " focus" };
  return { impact, scope: "currency", scopeText: CUR_TEXT[cur] || cur + " markets" };
}
const events = [];
let policyRate = null;
async function forexFactory() {
  let n = 0;
  for (const w of ["thisweek", "nextweek"]) {
    try {
      const arr = await fetchJson("https://nfs.faireconomy.media/ff_calendar_" + w + ".json", {}, { tries: 2 });
      for (const e of arr) {
        const t = Date.parse(e.date);
        if (!t || !e.title) continue;
        const c = classifyMacro(e);
        events.push({ id: "ff" + t + e.title + e.country, t, title: String(e.title), impact: c.impact, kind: "macro", currency: e.country, scope: c.scope, scopeText: c.scopeText, forecast: e.forecast || undefined, previous: e.previous || undefined, source: "ForexFactory" });
        if (/federal funds rate/i.test(e.title) && e.previous) policyRate = e.previous;
        n++;
      }
    } catch (e) {
      log("ForexFactory", w, String(e.message || e));
    }
  }
  setStatus("ForexFactory", n > 0, n ? n + " events (2 weeks)" : "unreachable", n);
}

// ---------- 2) Fed meeting dates (official page) ----------
async function fedDates() {
  try {
    const html = await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let n = 0;
    const re = /(\d{4}) FOMC Meetings<\/a>([\s\S]*?)(?=<h4>|$)/g;
    let m;
    while ((m = re.exec(html))) {
      const year = Number(m[1]);
      const rows = m[2].split('fomc-meeting"').slice(1);
      for (const row of rows) {
        const mon = row.match(/fomc-meeting__month[^>]*><strong>([A-Za-z/]+)<\/strong>/);
        const dt = row.match(/fomc-meeting__date[^>]*>([^<]+)</);
        if (!mon || !dt) continue;
        const months = mon[1].toLowerCase().split("/").map((x) => MONTHS.indexOf(x.trim()));
        const days = (dt[1].match(/\d+/g) || []).map(Number);
        if (!days.length || months[0] < 0) continue;
        const mo = (months.length > 1 ? months[1] : months[0]) + 1;
        const day = days[days.length - 1];
        const unscheduled = /\*/.test(dt[1]);
        const t = etToUtc(year, mo, day, 14, 0);
        if (t < Date.now() - 2 * 864e5 || t > Date.now() + 400 * 864e5) continue;
        events.push({ id: "fomc" + dayStr(t), t, title: "FOMC interest-rate decision & statement" + (unscheduled ? " (unscheduled)" : ""), impact: "High", kind: "macro", currency: "USD", scope: "all", scopeText: "All markets", extra: "Official Federal Reserve schedule. Press conference follows at 14:30 New York time.", source: "federalreserve.gov", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" });
        n++;
      }
    }
    setStatus("Fed calendar", n > 0, n ? n + " meetings (official)" : "no dates parsed", n);
  } catch (e) {
    setStatus("Fed calendar", false, String(e.message || e).slice(0, 60));
  }
}

// ---------- 3) Treasury yields + rough rate-path hint ----------
const rates = {};
async function treasury() {
  try {
    const d = new Date();
    let xml = "";
    for (const back of [0, 1]) {
      const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
      const ym = dd.getUTCFullYear() + String(dd.getUTCMonth() + 1).padStart(2, "0");
      xml = await fetchText("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=" + ym);
      if (xml.includes("<m:properties>")) break;
    }
    const entries = xml.split("<m:properties>").slice(1);
    const last = entries[entries.length - 1] || "";
    const get = (k) => {
      const m = last.match(new RegExp("<d:" + k + "[^>]*>([^<]+)<"));
      return m ? Number(m[1]) : null;
    };
    const date = (last.match(/<d:NEW_DATE[^>]*>([^<T]+)/) || [])[1];
    const y = { "1M": get("BC_1MONTH"), "3M": get("BC_3MONTH"), "6M": get("BC_6MONTH"), "1Y": get("BC_1YEAR"), "2Y": get("BC_2YEAR"), "10Y": get("BC_10YEAR"), "30Y": get("BC_30YEAR") };
    rates.yields = y;
    rates.date = date;
    setStatus("Treasury yields", y["3M"] != null, date ? "curve of " + date : "no data");
  } catch (e) {
    setStatus("Treasury yields", false, String(e.message || e).slice(0, 60));
  }
}
function rateHint() {
  const y = rates.yields;
  if (!y || y["6M"] == null || !policyRate) return;
  // ForexFactory shows the policy rate as the upper bound of the target range (e.g. "4.50%")
  const hi = parseFloat(policyRate);
  if (!isFinite(hi)) return;
  const mid = hi - 0.125;
  const gap = y["6M"] - mid;
  rates.policy = hi;
  rates.hint = gap < -0.15 ? "cuts" : gap > 0.15 ? "hikes" : "hold";
  rates.hintText = `6-month Treasury bill yields ${y["6M"].toFixed(2)}% vs policy rate about ${mid.toFixed(2)}% → the bond market looks to be pricing ${rates.hint === "hold" ? "no big change" : rates.hint}. Rough estimate, not CME FedWatch (CME blocks automated access).`;
}

// ---------- 4) Nasdaq earnings calendar (all companies, day by day) ----------
const coreTickers = (() => {
  try {
    const src = fs.readFileSync("desktop/src/category.ts", "utf8");
    const i = src.indexOf("const STOCKS = new Set(");
    const j = src.indexOf(".split", i);
    return [...new Set([...src.slice(i, j).matchAll(/"([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((x) => /^[A-Z]{1,5}$/.test(x)))];
  } catch {
    return [];
  }
})();
const MEGA = new Set("AAPL MSFT GOOGL GOOG AMZN META NVDA TSLA NFLX AVGO ORCL AMD".split(" "));
const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\s+(Inc|Corp|Co|Ltd|Plc)\.?$/i, "");
const parseCap = (s) => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const calRows = []; // {sym, day, t, time, cap, ...}
async function earningsCalendar() {
  const days = [];
  for (let i = -3; i <= 75; i++) {
    const t = Date.now() + i * 864e5;
    if (new Date(t).getUTCDay() % 6 !== 0) days.push(dayStr(t));
  }
  let ok = 0;
  await pool(days, 6, async (day) => {
    const j = await nq("calendar/earnings?date=" + day);
    const rows = j?.data?.rows || [];
    ok++;
    for (const r of rows) {
      const sym = String(r.symbol || "").toUpperCase();
      if (!sym) continue;
      const cap = parseCap(r.marketCap);
      if (cap < 1e10 && !coreTickers.includes(sym)) continue;
      const [y, mo, d] = day.split("-").map(Number);
      const tm = String(r.time || "");
      const hh = /after/i.test(tm) ? 16 : /pre|before/i.test(tm) ? 8 : 12;
      const t = etToUtc(y, mo, d, hh, hh === 12 ? 0 : 5);
      calRows.push({ sym, day, t, tm: /after/i.test(tm) ? "amc" : /pre|before/i.test(tm) ? "bmo" : "", cap, name: r.name, fq: r.fiscalQuarterEnding, eps: r.epsForecast, n: r.noOfEsts, lyEps: r.lastYearEPS, lyDate: r.lastYearRptDt });
    }
  });
  // tracked stocks the day scan did not find (date not confirmed in the calendar, or further than 75 days): ask Nasdaq for the expected date directly
  const nowMs = Date.now();
  const missing = coreTickers.filter((s) => !calRows.some((r) => r.sym === s && r.t > nowMs - 36e5 * 30));
  let fb = 0;
  const dbg = [];
  // Finviz omits the year and may show the LAST report: take the year that puts the date closest to today
  const guessYear = (mo, d) => {
    const y = new Date().getUTCFullYear();
    return [y - 1, y, y + 1].map((yy) => [yy, Math.abs(Date.UTC(yy, mo - 1, d, 12) - nowMs)]).sort((a, b) => a[1] - b[1])[0][0];
  };
  const fromNasdaq = async (sym) => {
    const j = await nq(`analyst/${sym}/earnings-date`);
    if (dbg.length < 3) dbg.push(sym + " nasdaq: " + JSON.stringify(j).slice(0, 300));
    const m = JSON.stringify(j?.data || {}).match(/([A-Z][a-z]{2,8})\.? (\d{1,2}), (\d{4})/);
    return m && { mo: MON[m[1].slice(0, 3).toLowerCase()], d: Number(m[2]), y: Number(m[3]), tm: "", src: "Nasdaq" };
  };
  const fromFinviz = async (sym) => {
    const html = await fetchText(`https://finviz.com/quote.ashx?t=${sym}`, {}, { tries: 2 });
    const i = html.search(/>Earnings</);
    const seg = i < 0 ? "" : stripHtml(html.slice(i, i + 400)).replace(/\s+/g, " ");
    if (dbg.length < 6) dbg.push(sym + " finviz: " + seg.slice(0, 120));
    const m = seg.match(/Earnings\s*\*?\s*([A-Z][a-z]{2}) (\d{1,2})(?:,? (\d{4}))?\s*(AMC|BMO)?/);
    return m && { mo: MON[m[1].toLowerCase()], d: Number(m[2]), y: m[3] ? Number(m[3]) : guessYear(MON[m[1].toLowerCase()], Number(m[2])), tm: m[4] === "AMC" ? "amc" : m[4] === "BMO" ? "bmo" : "", src: "Finviz" };
  };
  const fromSA = async (sym) => {
    const html = await fetchText(`https://stockanalysis.com/stocks/${sym.toLowerCase()}/`, {}, { tries: 2 });
    const txt = stripHtml(html).replace(/\s+/g, " ");
    const m = txt.match(/Earnings Date\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
    if (dbg.length < 9) dbg.push(sym + " stockanalysis: " + (m ? m[0] : txt.slice(txt.indexOf("Earnings"), txt.indexOf("Earnings") + 80)));
    return m && { mo: MON[m[1].toLowerCase()], d: Number(m[2]), y: Number(m[3]), tm: "", src: "StockAnalysis" };
  };
  await pool(missing, 4, async (sym) => {
    let r = null;
    for (const f of [fromNasdaq, fromFinviz, fromSA]) {
      try {
        r = await f(sym);
      } catch (e) {
        if (dbg.length < 12) dbg.push(sym + " " + f.name + " error: " + String(e.message || e).slice(0, 80));
      }
      if (r && r.mo) break;
    }
    if (!r || !r.mo) return;
    const day = `${r.y}-${String(r.mo).padStart(2, "0")}-${String(r.d).padStart(2, "0")}`;
    const hh = r.tm === "amc" ? 16 : r.tm === "bmo" ? 8 : 12;
    const t = etToUtc(r.y, r.mo, r.d, hh, hh === 12 ? 0 : 5);
    if (t < nowMs - 14 * 864e5) return; // a report from the last two weeks still shows (as already reported)
    calRows.push({ sym, day, t, tm: r.tm, cap: MEGA.has(sym) ? 3e11 : 5e10, name: secMap.get(sym)?.name ? titleCase(secMap.get(sym).name) : sym, fq: "", eps: "", n: 0, lyEps: "", lyDate: "", estimated: r.src });
    fb++;
  });
  dbg.forEach((x) => log("  fallback probe:", x));
  if (missing.length) log(`earnings-date fallback: ${fb}/${missing.length} tracked stocks found`);
  for (const r of calRows) {
    events.push({
      id: "er" + r.sym + r.day, t: r.t, title: (r.name ? r.name.replace(/\s+(Inc\.?|Corporation|Corp\.?|Company|Ltd\.?|Limited|Class [A-C].*)$/i, "") : r.sym) + " earnings report",
      impact: r.cap >= 2e11 ? "High" : r.cap >= 3e10 ? "Medium" : "Low", kind: "earnings", symbol: r.sym, scope: "symbol", scopeText: "Only " + r.sym,
      forecast: r.eps || undefined, previous: r.lyEps || undefined,
      extra: (r.tm === "amc" ? "After market close" : r.tm === "bmo" ? "Before market open" : "Time not announced") + (r.fq ? " · quarter " + r.fq : "") + (r.n ? " · " + r.n + " analysts" : "") + (r.estimated ? " · expected date (" + r.estimated + "), not yet confirmed by the company" : ""),
      source: "Nasdaq",
    });
  }
  setStatus("Nasdaq earnings", ok > 0, ok ? `${calRows.length} reports in ${days.length} days` : "unreachable", calRows.length);
}

// ---------- 5) per-company details ----------
const secMap = new Map();
async function loadSecTickers() {
  try {
    const j = await fetchJson("https://www.sec.gov/files/company_tickers.json", { "User-Agent": SEC_UA });
    for (const v of Object.values(j)) secMap.set(String(v.ticker).toUpperCase(), { cik: String(v.cik_str).padStart(10, "0"), name: v.title });
    setStatus("SEC EDGAR", secMap.size > 0, secMap.size + " companies");
  } catch (e) {
    setStatus("SEC EDGAR", false, String(e.message || e).slice(0, 60));
  }
}

const stripHtml = (h) =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&#?\w+;/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");

function htmlTables(html) {
  const out = [];
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [];
    for (const r of m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = [...r[0].matchAll(/<t[hd][\s\S]*?<\/t[hd]>/g)].map((c) => stripHtml(c[0]).replace(/\s+/g, " ").trim());
      if (cells.length) rows.push(cells);
    }
    out.push(rows);
  }
  return out;
}
const num = (s) => {
  const v = parseFloat(String(s ?? "").replace(/[,$%\s]/g, ""));
  return isFinite(v) ? v : null;
};
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

async function nasdaqDetail(sym, d) {
  const [sur, fc, mom, tgt] = await Promise.allSettled([nq(`company/${sym}/earnings-surprise`), nq(`analyst/${sym}/earnings-forecast`), nq(`analyst/${sym}/estimate-momentum`), nq(`analyst/${sym}/targetprice`)]);
  d.history = d.history || [];
  if (sur.status === "fulfilled") {
    for (const r of sur.value?.data?.earningsSurpriseTable?.rows || []) {
      const [mm, dd, yy] = String(r.dateReported).split("/").map(Number);
      d.history.push({ period: r.fiscalQtrEnd, reported: yy ? `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null, epsActual: num(r.eps), epsEst: num(r.consensusForecast), surprisePct: num(r.percentageSurprise) });
    }
    d.sources.push("Nasdaq earnings surprise");
  }
  if (fc.status === "fulfilled") {
    const q = fc.value?.data?.quarterlyForecast?.rows || [];
    d.forecast = d.forecast || {};
    d.forecast.quarterly = q.map((r) => ({ period: r.fiscalEnd, eps: r.consensusEPSForecast, high: r.highEPSForecast, low: r.lowEPSForecast, n: r.noOfEstimates, up: r.up, down: r.down }));
    d.forecast.yearly = (fc.value?.data?.yearlyForecast?.rows || []).map((r) => ({ period: r.fiscalEnd, eps: r.consensusEPSForecast, high: r.highEPSForecast, low: r.lowEPSForecast, n: r.noOfEstimates, up: r.up, down: r.down }));
    d.sources.push("Nasdaq analyst forecasts");
  }
  if (mom.status === "fulfilled") {
    const m = mom.value?.data;
    d.forecast = d.forecast || {};
    d.forecast.momentum = { week: m?.changeInConsensus?.weekData?.qtrMean, month: m?.changeInConsensus?.monthData?.qtrMean, now: m?.changeInConsensus?.currentData?.qtrMean, up: m?.estimatesChanged?.quarterDataUp?.changeValue, down: m?.estimatesChanged?.quarterDataDown?.changeValue };
  }
  if (tgt.status === "fulfilled") {
    const c = tgt.value?.data?.consensusOverview;
    if (c) d.targets = { low: c.lowPriceTarget, high: c.highPriceTarget, avg: c.priceTarget, buy: c.buy, hold: c.hold, sell: c.sell };
  }
}

async function stockAnalysisDetail(sym, d) {
  const slug = sym.toLowerCase().replace(/\./g, "-");
  const [fin, fc] = await Promise.allSettled([
    fetchText(`https://stockanalysis.com/stocks/${slug}/financials/?p=quarterly`, {}, { tries: 2 }),
    fetchText(`https://stockanalysis.com/stocks/${slug}/forecast/`, {}, { tries: 2 }),
  ]);
  if (fin.status === "fulfilled") {
    const t = htmlTables(fin.value).find((r) => /^Fiscal Quarter/i.test(r[0]?.[0] || "") && r.some((x) => /^Revenue/i.test(x[0] || "")));
    if (t) {
      const per = t.find((r) => /^Period Ending/i.test(r[0]));
      const rev = t.find((r) => /^Revenue(?!\s*Growth)/i.test(r[0]));
      const gr = t.find((r) => /^Revenue Growth/i.test(r[0]));
      d.revenue = [];
      for (let i = 1; i < (per?.length || 0); i++) {
        const m = String(per[i]).match(/([A-Z][a-z]{2}) '(\d\d)/);
        if (!m) continue;
        d.revenue.push({ period: m[1] + " 20" + m[2], q: t[0][i], revenue: num(rev?.[i]), yoy: num(gr?.[i]) }); // revenue in millions
      }
      d.sources.push("StockAnalysis financials");
    }
  }
  if (fc.status === "fulfilled") {
    const tabs = htmlTables(fc.value);
    const rv = tabs.find((r) => /^Revenue$/i.test(r[0]?.[0] || "") && /^High$/i.test(r[1]?.[0] || ""));
    if (rv) {
      const head = rv[0];
      const g = (i) => rv.map((r) => r[i]);
      d.revenueAnnual = { year: head[1], high: g(1)[1], avg: g(1)[2], low: g(1)[3] }; // strings such as "256.7B"
      d.sources.push("StockAnalysis forecast");
    }
    const rec = tabs.find((r) => /^Target$/i.test(r[0]?.[0] || ""));
    if (rec) d.targets = { ...(d.targets || {}), saAvg: rec[1]?.[2], saLow: rec[1]?.[1], saHigh: rec[1]?.[4] };
  }
}

function moneyToMillions(v, unit) {
  const x = parseFloat(String(v).replace(/,/g, ""));
  if (!isFinite(x)) return null;
  return /b/i.test(unit) ? x * 1000 : x;
}
async function secDetail(sym, d) {
  const c = secMap.get(sym);
  if (!c) return;
  const sub = await fetchJson(`https://data.sec.gov/submissions/CIK${c.cik}.json`, { "User-Agent": SEC_UA });
  d.name = sub.name || c.name;
  const r = sub.filings?.recent;
  if (!r) return;
  const list = [];
  for (let i = 0; i < r.form.length && list.length < 14; i++) {
    if (!/^(8-K|10-Q|10-K|6-K|20-F)$/.test(r.form[i])) continue;
    list.push({ form: r.form[i], date: r.filingDate[i], items: r.items?.[i] || "", acc: r.accessionNumber[i], doc: r.primaryDocument[i] });
  }
  d.filings = list.slice(0, 8).map((f) => ({ form: f.form, date: f.date, items: f.items, url: `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${f.acc.replace(/-/g, "")}/${f.doc}` }));
  d.sources.push("SEC EDGAR filings");
  // guidance: the latest results press release (8-K item 2.02, exhibit 99.1)
  const er = list.find((f) => f.form === "8-K" && /2\.02/.test(f.items));
  if (!er) return;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${er.acc.replace(/-/g, "")}/`;
  const idx = await fetchJson(base + "index.json", { "User-Agent": SEC_UA });
  const names = (idx?.directory?.item || []).map((x) => x.name).filter((n) => /\.(htm|html)$/i.test(n));
  const ex = names.find((n) => /ex-?99/i.test(n) && !/ex-?99[.-]?2/i.test(n)) || names.find((n) => /ex/i.test(n) && !/ex-?(10|31|32|21|23)/i.test(n)) || names.find((n) => n !== er.doc);
  if (!ex) return;
  const text = stripHtml(await fetchText(base + ex, { "User-Agent": SEC_UA }, { tries: 2, timeout: 30000 }));
  const sentences = text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/);
  const hits = sentences
    .filter((s) => s.length > 40 && s.length < 600 && /\b(expect|expects|anticipate|anticipates|outlook|guidance|forecast)/i.test(s) && /\$\s?\d/.test(s) && /(range|between|approximately|to be|from \$)/i.test(s))
    .filter((s) => /(revenue|sales|earnings|eps|income|margin|expense|capital)/i.test(s))
    .slice(0, 4);
  if (hits.length) {
    d.guidance = { filed: er.date, url: base + ex, quotes: hits.map((s) => s.trim()) };
    const rg = hits.map((s) => s.match(/\$\s?([\d.,]+)\s*(billion|million|B|M)?\s*(?:to|and|-|–)\s*\$?\s?([\d.,]+)\s*(billion|million|B|M)/i)).find((m) => m && /revenue|sales/i.test(m.input));
    if (rg) d.guidance.revenueRange = { lo: moneyToMillions(rg[1], rg[2] || rg[4]), hi: moneyToMillions(rg[3], rg[4]), unit: "USD millions" };
    d.sources.push("SEC press release (guidance)");
  }
}

async function finvizDetail(sym, d) {
  const html = await fetchText(`https://finviz.com/quote.ashx?t=${sym}`, {}, { tries: 2 });
  const tab = html.match(/id="news-table"[\s\S]*?<\/table>/);
  if (!tab) return;
  const out = [];
  let curDate = null;
  const now = new Date();
  for (const row of tab[0].split("<tr").slice(1)) {
    const ts = (row.match(/<td[^>]*width="130"[^>]*>\s*([^<]+?)\s*<\/td>/) || [])[1];
    const a = row.match(/<a class="tab-link-news" href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    if (!ts || !a) continue;
    const src = (row.match(/<span>\(([^)]*)\)/) || [])[1] || "";
    let m = ts.match(/^(?:(Today|Yesterday)|([A-Z][a-z]{2})-(\d{1,2})-(\d{2}))?\s*(\d{1,2}):(\d{2})(AM|PM)$/);
    if (!m) continue;
    if (m[1] || m[2]) {
      if (m[1]) {
        const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        if (m[1] === "Yesterday") ny.setDate(ny.getDate() - 1);
        curDate = [ny.getFullYear(), ny.getMonth() + 1, ny.getDate()];
      } else curDate = [2000 + Number(m[4]), MON[m[2].toLowerCase()], Number(m[3])];
    }
    if (!curDate) continue;
    let hh = Number(m[5]) % 12 + (m[7] === "PM" ? 12 : 0);
    out.push({ t: etToUtc(curDate[0], curDate[1], curDate[2], hh, Number(m[6])), title: stripHtml(a[2]).replace(/\s+/g, " ").trim(), url: a[1], source: src });
    if (out.length >= 25) break;
  }
  if (out.length) {
    d.news = out;
    d.sources.push("Finviz headlines");
  }
  const rate = html.match(/>Recom<\/td>\s*<td[^>]*>(?:<b>)?\s*(?:<span[^>]*>)?\s*([\d.]+)/);
  if (rate) d.recom = Number(rate[1]); // 1 = strong buy ... 5 = strong sell
}

function buildNext(d, cal) {
  const q = d.forecast?.quarterly?.[0];
  d.next = {
    t: cal?.t ?? null,
    when: cal?.tm || "",
    fiscalQuarter: cal?.fq || q?.period || null,
    epsForecast: num(cal?.eps) ?? q?.eps ?? null,
    nEstimates: num(cal?.n) ?? q?.n ?? null,
    epsHigh: q?.high ?? null,
    epsLow: q?.low ?? null,
    lastYearEps: num(cal?.lyEps),
    lastYearDate: cal?.lyDate || null,
    marketCap: cal?.cap || null,
  };
  // revenue the analysts expect, only derivable when the next quarter closes the fiscal year: yearly consensus - three reported quarters
  const ra = d.revenueAnnual, rv = d.revenue;
  if (ra && rv && rv.length >= 3 && /^(Dec)/.test(String(cal?.fq || "").replace(/\/.*$/, "")) ) {
    const yr = Number(String(cal?.fq).split("/")[1]);
    const ytd = rv.filter((x) => x.period.endsWith(String(yr)) && /^(Mar|Jun|Sep)/.test(x.period)).map((x) => x.revenue);
    const avg = String(ra.avg || "").match(/([\d.]+)\s*([BM])/);
    if (ytd.length === 3 && ytd.every((x) => x != null) && avg) {
      const annual = Number(avg[1]) * (avg[2] === "B" ? 1000 : 1);
      d.next.revenueEstimate = Math.round(annual - ytd.reduce((a, b) => a + b, 0));
      d.next.revenueEstimateNote = "Derived: full-year analyst consensus minus the three reported quarters";
    }
  }
}

const prevDetail = (sym) => {
  if (!PREV) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(PREV, "earn", sym + ".json"), "utf8"));
  } catch {
    return null;
  }
};

async function details() {
  // choose companies: everything with a report soon, plus the core list; refresh the stalest / most imminent first
  const bySym = new Map();
  for (const r of calRows) {
    const cur = bySym.get(r.sym);
    if (!cur || (r.t > Date.now() - 36e5 * 30 && (cur.t < Date.now() - 36e5 * 30 || r.t < cur.t))) bySym.set(r.sym, r);
  }
  const syms = [...new Set([...bySym.keys(), ...coreTickers.filter((s) => secMap.has(s))])].filter((s) => secMap.has(s) || bySym.has(s));
  const score = (s) => {
    const p = prevDetail(s);
    const age = p ? (Date.now() - p.at) / 36e5 : 999;
    const cal = bySym.get(s);
    const days = cal ? (cal.t - Date.now()) / 864e5 : 99;
    const hot = days > -2 && days < 3; // reporting around now: refresh every run
    const need = hot ? age > 0.9 : age > 20;
    const capBonus = cal ? Math.log10(Math.max(cal.cap, 1e9)) * 40 : 330; // big companies first
    const core = coreTickers.includes(s) ? 250 : 0; // the stocks people actually track come first
    return need ? (hot ? 1000 : 0) + core + Math.min(age, 100) + capBonus - Math.max(days, 0) : -1;
  };
  const todo = syms.map((s) => [s, score(s)]).filter((x) => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_DETAIL).map((x) => x[0]);
  log(`details: ${syms.length} companies, refreshing ${todo.length}`);
  let ok = 0, fail = 0;
  const st = { nq: 0, sa: 0, sec: 0, fv: 0 };
  await pool(todo, 3, async (sym) => {
    const d = { symbol: sym, at: Date.now(), sources: [], name: bySym.get(sym)?.name || secMap.get(sym)?.name || sym };
    const res = await Promise.allSettled([nasdaqDetail(sym, d), stockAnalysisDetail(sym, d), secDetail(sym, d), finvizDetail(sym, d)]);
    res.forEach((r, i) => {
      if (r.status === "fulfilled") st[["nq", "sa", "sec", "fv"][i]]++;
      else log("  detail fail", sym, ["nasdaq", "stockanalysis", "sec", "finviz"][i], String(r.reason?.message || r.reason).slice(0, 80));
    });
    d.history.sort((a, b) => String(b.reported).localeCompare(String(a.reported)));
    // attach revenue to the matching quarter (same period-end month + year)
    for (const h of d.history) {
      const m = String(h.period).match(/^([A-Za-z]{3}) (\d{4})/);
      const rv = m && d.revenue?.find((x) => x.period === m[1] + " " + m[2]);
      if (rv) {
        h.revenue = rv.revenue;
        h.revenueYoY = rv.yoy;
      }
    }
    buildNext(d, bySym.get(sym));
    if (d.history.length || d.forecast || d.news?.length) {
      fs.writeFileSync(path.join(OUT, "earn", sym + ".json"), JSON.stringify(d));
      ok++;
    } else fail++;
    await sleep(250);
  });
  setStatus("Nasdaq analysts", st.nq > 0, `${st.nq}/${todo.length} companies`, st.nq);
  setStatus("StockAnalysis", st.sa > 0, `${st.sa}/${todo.length} companies`, st.sa);
  setStatus("SEC press releases", st.sec > 0, `${st.sec}/${todo.length} companies`, st.sec);
  setStatus("Finviz headlines", st.fv > 0, `${st.fv}/${todo.length} companies`, st.fv);
  log(`details written ${ok}, empty ${fail}`);
}

// ---------- run ----------
await Promise.allSettled([forexFactory(), fedDates(), treasury(), loadSecTickers()]);
rateHint();
await earningsCalendar().catch((e) => setStatus("Nasdaq earnings", false, String(e.message || e).slice(0, 60)));
await details().catch((e) => log("details error", e));

// carry over per-company files from the previous run that were not refreshed now
if (PREV && fs.existsSync(path.join(PREV, "earn"))) {
  for (const f of fs.readdirSync(path.join(PREV, "earn"))) {
    const dst = path.join(OUT, "earn", f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(PREV, "earn", f), dst);
  }
}
// older than 10 days = remove
for (const f of fs.readdirSync(path.join(OUT, "earn"))) {
  const p = path.join(OUT, "earn", f);
  try {
    if (Date.now() - JSON.parse(fs.readFileSync(p, "utf8")).at > 10 * 864e5) fs.unlinkSync(p);
  } catch {}
}
// drop duplicates (the Fed page entry wins over built-in/ForexFactory ones on the same day)
const seen = new Set();
const uniq = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
for (let i = uniq.length - 1; i >= 0; i--) {
  const x = uniq[i];
  if (x.source === "federalreserve.gov" && uniq.some((y) => y.source === "ForexFactory" && /fomc|federal funds/i.test(y.title) && Math.abs(y.t - x.t) < 36e5 * 14)) uniq.splice(i, 1);
}
uniq.sort((a, b) => a.t - b.t);
const detailList = fs.readdirSync(path.join(OUT, "earn")).map((f) => f.replace(/\.json$/, ""));
fs.writeFileSync(path.join(OUT, "news.json"), JSON.stringify({ at: Date.now(), events: uniq, rates, sources: [...status.values()], details: detailList }));
log(`news.json: ${uniq.length} events, ${detailList.length} company files`);
console.log(JSON.stringify([...status.values()], null, 1));
