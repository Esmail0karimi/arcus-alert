/* News tab: this week's market-moving events, colour-coded by importance, with who they affect. */
import React, { useEffect, useMemo, useState } from "react";
import { NewsEv, NewsResult, cachedNews, fetchNews } from "./newsdata";
import { openReport } from "./report";

const COL: Record<string, string> = { High: "#f23645", Medium: "#ff9800", Low: "#f2c94c", Holiday: "#6f86a3" };
const SCOPE_ICON: Record<string, string> = { all: "🌍", currency: "💱", symbol: "📈" };

const rel = (t: number, now: number) => {
  const m = Math.round((t - now) / 60000),
    a = Math.abs(m);
  const s = a >= 1440 ? Math.floor(a / 1440) + "d " + Math.floor((a % 1440) / 60) + "h" : a >= 60 ? Math.floor(a / 60) + "h " + (a % 60) + "m" : a + "m";
  return m >= 0 ? "in " + s : s + " ago";
};

export function News(p: { trackedBases: Set<string>; onOpen: (base: string) => void }) {
  const [res, setRes] = useState<NewsResult | null>(() => cachedNews());
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [imp, setImp] = useState<string>(() => localStorage.getItem("arcus.news.imp") || "High+Medium");
  const [scope, setScope] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const load = (force = false) => {
    setBusy(true);
    fetchNews(p.trackedBases, undefined, (r) => setRes((prev) => (!prev || r.list.some((e) => e.source !== "Fed calendar (built-in)") ? r : { ...prev, status: r.status })), force)
      .then((r) => setRes(r))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (!res || Date.now() - res.at > 3 * 60e3 || !res.hosted) load();
  }, []);
  useEffect(() => {
    if (res?.hosted) load();
  }, [p.trackedBases]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const setImpact = (v: string) => {
    setImp(v);
    try {
      localStorage.setItem("arcus.news.imp", v);
    } catch {}
  };
  const shown = useMemo(() => {
    const okImp = (e: NewsEv) => (imp === "All" ? true : imp === "High" ? e.impact === "High" : imp === "High+Medium" ? e.impact === "High" || e.impact === "Medium" : true);
    return (res?.list || []).filter((e) => okImp(e) && (scope === "all" || (scope === "global" ? e.scope === "all" : scope === "stock" ? e.scope === "symbol" : e.scope === "currency")));
  }, [res, imp, scope]);
  const next = useMemo(() => (res?.list || []).find((e) => e.t > now && e.impact === "High"), [res, now]);
  const nextStock = useMemo(() => {
    const st = (res?.list || []).filter((e) => e.kind === "earnings");
    return st.find((e) => e.t > now) || st[st.length - 1];
  }, [res, now]);
  const byDay = useMemo(() => {
    const m = new Map<string, NewsEv[]>();
    for (const e of shown) {
      const k = new Date(e.t).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      (m.get(k) || m.set(k, []).get(k)!).push(e);
    }
    return [...m.entries()];
  }, [shown]);
  const todayKey = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <div className="news-tab">
      <div className="heading">
        <div>
          <small>CALENDAR</small>
          <h1>News</h1>
          <p>Scheduled events that move markets: central banks, economic data and earnings. Times are in your local time.</p>
        </div>
        <button className="secondary" onClick={() => load(true)} disabled={busy}>
          {busy ? "Loading…" : "⟳ Refresh"}
        </button>
      </div>
      {next && (
        <div className="news-next" style={{ borderColor: COL.High }}>
          <b style={{ color: COL.High }}>Next big event</b> · {next.title} <em>{rel(next.t, now)}</em> · <span>{SCOPE_ICON[next.scope]} {next.scopeText}</span>
        </div>
      )}
      {nextStock && (
        <div className="news-next stock" style={{ borderColor: COL[nextStock.impact] }}>
          <b style={{ color: COL[nextStock.impact] }}>{nextStock.t > now ? "Next stock event" : "Latest stock event"}</b> · {nextStock.title} <em>{rel(nextStock.t, now)}</em> ·{" "}
          <span>{new Date(nextStock.t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
          {nextStock.symbol && (
            <>
              <button onClick={() => openReport({ symbol: nextStock.symbol! })}>Report table</button>
              <button onClick={() => p.onOpen(nextStock.symbol!)}>Open {nextStock.symbol} →</button>
            </>
          )}
        </div>
      )}
      <div className="news-filters">
        <div className="news-chips">
          <span>Importance</span>
          {[["High", "High"], ["High+Medium", "High + Medium"], ["All", "All"]].map(([v, l]) => (
            <button key={v} className={imp === v ? "on" : ""} onClick={() => setImpact(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="news-chips">
          <span>Affects</span>
          {[["all", "Everything"], ["global", "🌍 All markets"], ["currency", "💱 One currency"], ["stock", "📈 One stock"]].map(([v, l]) => (
            <button key={v} className={scope === v ? "on" : ""} onClick={() => setScope(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="news-legend">
          {["High", "Medium", "Low"].map((k) => (
            <span key={k}>
              <i style={{ background: COL[k] }} />
              {k}
            </span>
          ))}
        </div>
      </div>
      {res && (
        <div className="news-status">
          {res.status.map((s) => (
            <span key={s.name} className={(s as any).pending ? "" : s.ok ? "ok" : "bad"}>
              {(s as any).pending ? "◌" : s.ok ? "●" : "○"} {s.name}
              {s.note ? " · " + s.note : ""}
            </span>
          ))}
          <span>updated {new Date(res.at).toLocaleTimeString()}</span>
        </div>
      )}
      {res?.rates && (
        <div className="news-rates">
          <b>Fed rate path (rough)</b> · {res.rates.hintText.replace(/ Rough estimate, not CME FedWatch.*$/, "")}{" "}
          <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" target="_blank" rel="noreferrer">
            CME FedWatch ↗
          </a>
        </div>
      )}
      {!res && busy && <div className="empty">Loading the calendar…</div>}
      {res && !shown.length && <div className="empty">No events match these filters. Try “All” importance.</div>}
      {byDay.map(([day, evs]) => (
        <section key={day} className={"news-day" + (day === todayKey ? " today" : "")}>
          <h3>
            {day}
            {day === todayKey && <em>today</em>}
          </h3>
          {evs.map((e) => {
            const past = e.t < now;
            const c = COL[e.impact];
            return (
              <div key={e.id} className={"news-row" + (past ? " past" : "")} style={{ borderLeftColor: c }} onClick={() => (e.kind === "earnings" && e.symbol ? openReport({ symbol: e.symbol }) : res?.hosted ? openReport({ evId: e.id }) : setOpen(open === e.id ? null : e.id))}>
                <div className="news-time">
                  {new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  <small>{rel(e.t, now)}</small>
                </div>
                <div className="news-main">
                  <b>
                    {e.currency && <u className="news-cur">{e.currency}</u>}
                    {e.title}
                  </b>
                  {(e.forecast || e.previous) && (
                    <small>
                      {e.forecast ? "Forecast " + e.forecast : ""}
                      {e.forecast && e.previous ? " · " : ""}
                      {e.previous ? "Previous " + e.previous : ""}
                    </small>
                  )}
                  {open === e.id && (
                    <small className="news-more">
                      {e.extra && <>{e.extra}<br /></>}
                      Source: {e.source}
                      {e.scope === "symbol" && e.symbol && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            p.onOpen(e.symbol!);
                          }}
                        >
                          Open {e.symbol} chart →
                        </button>
                      )}
                    </small>
                  )}
                </div>
                <div className="news-side">
                  <span className="news-imp" style={{ color: c, borderColor: c }}>
                    {e.impact}
                  </span>
                  <span className={"news-scope " + e.scope}>
                    {SCOPE_ICON[e.scope]} {e.scopeText}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      <p className="news-foot news-src">
        More sources:{" "}
        {[["FRED calendar", "https://fred.stlouisfed.org/releases/calendar"], ["SEC EDGAR", "https://www.sec.gov/edgar/search/"], ["Investing.com", "https://www.investing.com/economic-calendar/"], ["CME FedWatch", "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"], ["StockAnalysis", "https://stockanalysis.com/stocks/screener/"], ["Macrotrends", "https://www.macrotrends.net/"]].map(([n, u]) => (
          <a key={n} href={u} target="_blank" rel="noreferrer">
            {n} ↗
          </a>
        ))}
      </p>
      <p className="news-foot">Tip: click any row for its report window (previous / forecast / actual and what could happen). Importance and “who it affects” are our own rules of thumb, not trading advice. A central-bank decision usually moves everything; a company report mostly moves that stock.</p>
    </div>
  );
}
