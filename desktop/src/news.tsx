/* News tab: this week's market-moving events, colour-coded by importance, with who they affect. */
import React, { useEffect, useMemo, useState } from "react";
import { NewsEv, NewsResult, cachedNews, fetchNews } from "./newsdata";
import { openReport, rateFa } from "./report";
import { dloc, faText, setLang, useLang } from "./lang";

const COL: Record<string, string> = { High: "#f23645", Medium: "#ff9800", Low: "#f2c94c", Holiday: "#6f86a3" };
const IMP_FA: Record<string, string> = { High: "زیاد", Medium: "متوسط", Low: "کم", Holiday: "تعطیل" };
const SCOPE_ICON: Record<string, string> = { all: "🌍", currency: "💱", symbol: "📈" };

const rel = (t: number, now: number, fa = false) => {
  const m = Math.round((t - now) / 60000),
    a = Math.abs(m);
  const s = fa
    ? a >= 1440 ? Math.floor(a / 1440) + " روز و " + Math.floor((a % 1440) / 60) + " ساعت" : a >= 60 ? Math.floor(a / 60) + " ساعت و " + (a % 60) + " دقیقه" : a + " دقیقه"
    : a >= 1440 ? Math.floor(a / 1440) + "d " + Math.floor((a % 1440) / 60) + "h" : a >= 60 ? Math.floor(a / 60) + "h " + (a % 60) + "m" : a + "m";
  return fa ? (m >= 0 ? s + " دیگر" : s + " پیش") : m >= 0 ? "in " + s : s + " ago";
};

export function News(p: { trackedBases: Set<string>; onOpen: (base: string) => void }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const X = (s: string) => (fa ? faText(s) : s);
  const [res, setRes] = useState<NewsResult | null>(() => cachedNews());
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [imp, setImp] = useState<string>(() => localStorage.getItem("arcus.news.imp") || "High+Medium");
  const [sub, setSubState] = useState<"stocks" | "forex">(() => {
    try {
      return localStorage.getItem("arcus.news.sub") === "stocks" ? "stocks" : "forex";
    } catch {
      return "forex";
    }
  });
  const setSub = (v: "stocks" | "forex") => {
    setSubState(v);
    try {
      localStorage.setItem("arcus.news.sub", v);
    } catch {}
  };
  const [cur, setCur] = useState<string>("all");
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
  const inSub = (e: NewsEv) => (sub === "stocks" ? e.kind === "earnings" : e.kind !== "earnings");
  const shown = useMemo(() => {
    const okImp = (e: NewsEv) => (imp === "All" ? true : imp === "High" ? e.impact === "High" : imp === "High+Medium" ? e.impact === "High" || e.impact === "Medium" : true);
    return (res?.list || []).filter((e) => inSub(e) && okImp(e) && (sub === "stocks" || cur === "all" || e.currency === cur || (cur === "USD" && e.scope === "all")));
  }, [res, imp, sub, cur]);
  const counts = useMemo(() => ({ stocks: (res?.list || []).filter((e) => e.kind === "earnings").length, forex: (res?.list || []).filter((e) => e.kind !== "earnings").length }), [res]);
  const next = useMemo(() => (res?.list || []).find((e) => e.kind !== "earnings" && e.t > now && e.impact === "High"), [res, now]);
  const nextStock = useMemo(() => {
    const st = (res?.list || []).filter((e) => e.kind === "earnings");
    return st.find((e) => e.t > now) || st[st.length - 1];
  }, [res, now]);
  const byDay = useMemo(() => {
    const m = new Map<string, NewsEv[]>();
    for (const e of shown) {
      const k = new Date(e.t).toLocaleDateString(dloc(fa), { weekday: "long", month: "short", day: "numeric" });
      (m.get(k) || m.set(k, []).get(k)!).push(e);
    }
    return [...m.entries()];
  }, [shown, fa]);
  const todayKey = new Date(now).toLocaleDateString(dloc(fa), { weekday: "long", month: "short", day: "numeric" });
  const CURS = ["all", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];
  const dir = (e: NewsEv) => {
    const a = parseFloat(String(e.actual ?? "").replace(/[^0-9.\-]/g, "")),
      f = parseFloat(String(e.forecast ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(a) && Number.isFinite(f) ? (a > f ? "up" : a < f ? "dn" : "eq") : "";
  };
  return (
    <div className={"news-tab" + (fa ? " fa" : "")} dir={fa ? "rtl" : "ltr"}>
      <div className="heading">
        <div>
          <small>{T("CALENDAR", "تقویم")}</small>
          <h1>{T("News", "اخبار")}</h1>
        </div>
        <div className="news-head-btns">
          <button className="secondary" onClick={() => setLang(fa ? "en" : "fa")} title="English / فارسی">
            {fa ? "EN" : "فا"}
          </button>
          <button className="secondary" onClick={() => load(true)} disabled={busy}>
            {busy ? T("Loading…", "در حال بارگذاری…") : T("⟳ Refresh", "⟳ به‌روزرسانی")}
          </button>
        </div>
      </div>
      <div className="news-subtabs">
        <button className={sub === "forex" ? "on" : ""} onClick={() => setSub("forex")}>
          💱 {T("Currencies & economy", "ارزها و اقتصاد")} <small>ForexFactory</small> <i>{counts.forex}</i>
        </button>
        <button className={sub === "stocks" ? "on" : ""} onClick={() => setSub("stocks")}>
          📈 {T("Stocks", "سهام")} <small>{T("earnings", "گزارش سود")}</small> <i>{counts.stocks}</i>
        </button>
      </div>
      {sub === "forex" && next && (
        <div className="news-next" style={{ borderColor: COL.High }}>
          <b style={{ color: COL.High }}>{T("Next big event", "رویداد مهم بعدی")}</b> · {X(next.title)} <em>{rel(next.t, now, fa)}</em> · <span>{X(next.scopeText)}</span>
        </div>
      )}
      {sub === "forex" && res?.rates && (
        <div className="news-rates">
          <b>{T("Fed rate path (rough)", "مسیر نرخ بهره فدرال (تقریبی)")}</b> · {fa ? rateFa(res.rates).replace(/ برآورد تقریبی است.*$/, "") : res.rates.hintText.replace(/ Rough estimate, not CME FedWatch.*$/, "")}{" "}
          <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" target="_blank" rel="noreferrer">
            CME FedWatch ↗
          </a>
        </div>
      )}
      {sub === "stocks" && nextStock && (
        <div className="news-next stock" style={{ borderColor: COL[nextStock.impact] }}>
          <b style={{ color: COL[nextStock.impact] }}>{nextStock.t > now ? T("Next stock event", "رویداد بعدی سهام") : T("Latest stock event", "آخرین رویداد سهام")}</b> · {X(nextStock.title)} <em>{rel(nextStock.t, now, fa)}</em>
          {nextStock.symbol && <button onClick={() => openReport({ symbol: nextStock.symbol! })}>{T("Report table", "جدول گزارش")}</button>}
        </div>
      )}
      <div className="news-filters">
        <div className="news-chips">
          <span>{T("Importance", "اهمیت")}</span>
          {[["High", T("High", "زیاد")], ["High+Medium", T("High + Medium", "زیاد + متوسط")], ["All", T("All", "همه")]].map(([v, l]) => (
            <button key={v} className={imp === v ? "on" : ""} onClick={() => setImpact(v)}>
              {l}
            </button>
          ))}
        </div>
        {sub === "forex" && (
          <div className="news-chips">
            <span>{T("Currency", "ارز")}</span>
            {CURS.map((c) => (
              <button key={c} className={cur === c ? "on" : ""} onClick={() => setCur(c)}>
                {c === "all" ? T("All", "همه") : c}
              </button>
            ))}
          </div>
        )}
        <div className="news-legend">
          {["High", "Medium", "Low"].map((k) => (
            <span key={k}>
              <i style={{ background: COL[k] }} />
              {X(k)}
            </span>
          ))}
        </div>
      </div>
      {!res && busy && <div className="empty">{T("Loading the calendar…", "در حال بارگذاری تقویم…")}</div>}
      {res && !shown.length && <div className="empty">{sub === "stocks" && !p.trackedBases.size ? T("No stocks in your lists yet.", "هنوز سهمی در لیست‌های شما نیست.") : T("No events match these filters. Try “All” importance.", "رویدادی با این فیلترها پیدا نشد. اهمیت «همه» را امتحان کنید.")}</div>}
      <div className="news-table">
        {byDay.map(([day, evs]) => (
          <section key={day} className={"news-day" + (day === todayKey ? " today" : "")}>
            <h3>
              {day}
              {day === todayKey && <em>{T("today", "امروز")}</em>}
            </h3>
            <div className="nt-head">
              <span />
              <span>{sub === "stocks" ? T("Symbol", "نماد") : T("Currency", "ارز")}</span>
              <span>{T("Time", "ساعت")}</span>
              <span>{sub === "stocks" ? T("Report", "گزارش") : T("Event", "رویداد")}</span>
              <span>{T("Actual", "واقعی")}</span>
              <span>{T("Forecast", "پیش‌بینی")}</span>
              <span>{T("Previous", "قبلی")}</span>
            </div>
            {evs.map((e, i) => {
              const past = e.t < now;
              const c = COL[e.impact];
              const d = dir(e);
              return (
                <div key={e.id} className={"nt-row" + (past ? " past" : "") + (i % 2 ? " alt" : "")} onClick={() => (e.kind === "earnings" && e.symbol ? openReport({ symbol: e.symbol }) : openReport({ evId: e.id }))}>
                  <span className="nt-dot" title={fa ? IMP_FA[e.impact] : e.impact} style={{ background: c, boxShadow: "0 0 0 3px " + c + "26" }} />
                  <span className="nt-cur">{e.kind === "earnings" ? e.symbol : e.scope === "all" && e.currency === "USD" ? "USD" : e.currency || "—"}</span>
                  <span className="nt-time">
                    {new Date(e.t).toLocaleTimeString(dloc(fa) || [], { hour: "2-digit", minute: "2-digit" })}
                    <small>{rel(e.t, now, fa)}</small>
                  </span>
                  <span className="nt-title">
                    {X(e.title)}
                    {e.notes?.length ? <small className="nt-note">📝 {e.notes[0]}</small> : null}
                  </span>
                  <span className={"nt-num act " + d}>{e.actual ? (d === "up" ? "▲ " : d === "dn" ? "▼ " : "") + e.actual : past && e.kind === "macro" && e.impact !== "Holiday" ? "…" : ""}</span>
                  <span className="nt-num">{e.forecast || ""}</span>
                  <span className="nt-num dim">{e.previous || ""}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {res && (
        <details className="news-status">
          <summary>
            {T("Sources", "منبع‌ها")}: {res.status.filter((s) => s.ok && !s.pending).length}/{res.status.length} {T("working", "فعال")} · {T("updated", "به‌روز شده")} {new Date(res.at).toLocaleTimeString(dloc(fa))}
          </summary>
          <div>
            {res.status.map((s) => (
              <span key={s.name} className={s.pending ? "" : s.ok ? "ok" : "bad"}>
                {s.pending ? "◌" : s.ok ? "●" : "○"} {s.name}
                {s.note ? " · " + s.note : ""}
              </span>
            ))}
          </div>
        </details>
      )}
      <p className="news-foot news-src">
        {T("More sources:", "منابع بیشتر:")}{" "}
        {[["FRED calendar", "https://fred.stlouisfed.org/releases/calendar"], ["SEC EDGAR", "https://www.sec.gov/edgar/search/"], ["Investing.com", "https://www.investing.com/economic-calendar/"], ["CME FedWatch", "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"], ["StockAnalysis", "https://stockanalysis.com/stocks/screener/"], ["Macrotrends", "https://www.macrotrends.net/"]].map(([n, u]) => (
          <a key={n} href={u} target="_blank" rel="noreferrer">
            {n} ↗
          </a>
        ))}
      </p>
      <p className="news-foot">{T("Click any row for its report window. Importance colours are our own rules of thumb, not trading advice.", "روی هر ردیف کلیک کنید تا پنجره گزارش باز شود. رنگ اهمیت قاعدهٔ سرانگشتی خود ماست، نه توصیه معاملاتی.")}</p>
    </div>
  );
}
