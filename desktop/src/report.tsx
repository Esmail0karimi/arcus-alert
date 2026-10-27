/* Report window: opens from the News tab or from a chart event marker.
   Company reports: the two previous quarters next to the coming one (company forecast, analyst forecast, actual left empty),
   plus a rule-based "if lower / in line / higher" read. Macro releases: previous / forecast / actual and the usual market reaction. */
import React, { useEffect, useMemo, useState } from "react";
import { Company, Hosted, NewsEv, Rates, loadCompany, loadHosted } from "./newsdata";

export type ReportReq = { symbol?: string; evId?: string };
export const openReport = (r: ReportReq) => window.dispatchEvent(new CustomEvent<ReportReq>("arcus:report", { detail: r }));

const usd = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(d));
const money = (m: number | null | undefined) => (m == null || !isFinite(m) ? "—" : Math.abs(m) >= 1000 ? "$" + (m / 1000).toFixed(m >= 100000 ? 1 : 2) + "B" : "$" + m.toFixed(0) + "M");
const pct = (v: number | null | undefined, sign = true) => (v == null || !isFinite(v) ? "—" : (sign && v > 0 ? "+" : "") + v.toFixed(1) + "%");
const num = (v: any): number | null => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return isFinite(x) ? x : null;
};
const day = (s?: string | null) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

const LINKS = (sym: string) => [
  ["SEC EDGAR", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K&dateb=&owner=include&count=40&CIK=" + sym],
  ["Nasdaq", "https://www.nasdaq.com/market-activity/stocks/" + sym.toLowerCase() + "/earnings"],
  ["StockAnalysis", "https://stockanalysis.com/stocks/" + sym.toLowerCase() + "/forecast/"],
  ["Macrotrends", "https://www.macrotrends.net/stocks/charts/" + sym + "/" + sym.toLowerCase() + "/revenue"],
  ["Finviz", "https://finviz.com/quote.ashx?t=" + sym],
  ["Investing.com", "https://www.investing.com/search/?q=" + sym],
];

type Scen = { key: "low" | "inline" | "high"; title: string; cond: string; lines: string[] };

/** Rule-based reading from the numbers we have. Not a prediction. */
function scenarios(c: Company, mega: boolean): { facts: string[]; scen: Scen[]; eps: { cons: number | null; lo: number | null; hi: number | null; typical: number | null }; rev: { lo: number | null; hi: number | null } } {
  const hist: any[] = c?.history || [];
  const nx = c?.next || {};
  const cons = num(nx.epsForecast);
  const lo = num(nx.epsLow);
  const hi = num(nx.epsHigh);
  const sur = hist.slice(0, 4).map((h) => num(h.surprisePct)).filter((x): x is number => x != null);
  const beats = sur.filter((x) => x > 0).length;
  const avg = sur.length ? sur.reduce((a, b) => a + b, 0) / sur.length : null;
  const typical = cons != null && avg != null ? cons * (1 + avg / 100) : null;
  const g = c?.guidance?.revenueRange;
  const rlo = g ? num(g.lo) : null;
  const rhi = g ? num(g.hi) : null;
  const facts: string[] = [];
  if (cons != null) facts.push(`Analysts expect EPS ${usd(cons)}` + (lo != null && hi != null ? ` (range ${usd(lo)}–${usd(hi)}` + (nx.nEstimates ? `, ${nx.nEstimates} analysts)` : ")") : "") + (num(nx.lastYearEps) ? `, versus ${usd(num(nx.lastYearEps))} a year ago (${pct(((cons - num(nx.lastYearEps)!) / Math.abs(num(nx.lastYearEps)!)) * 100)}).` : "."));
  if (rlo != null && rhi != null) facts.push(`The company itself guided revenue of ${money(rlo)}–${money(rhi)} (SEC press release of ${day(c.guidance.filed)}).`);
  if (sur.length) facts.push(`It beat the EPS estimate in ${beats} of the last ${sur.length} reports, on average by ${pct(avg)}.` + (typical != null && beats >= 3 ? ` So the market is probably already counting on about ${usd(typical)}, not just ${usd(cons)}.` : ""));
  const m = c?.forecast?.momentum;
  if (m && (num(m.up) != null || num(m.down) != null)) facts.push(`In the last 30 days ${num(m.up) ?? 0} analyst estimate(s) went up and ${num(m.down) ?? 0} went down.`);
  const t = c?.targets;
  if (t?.avg) facts.push(`Average analyst price target ${usd(num(t.avg), 0)}` + (t.buy != null ? ` · ${t.buy} buy / ${t.hold ?? 0} hold / ${t.sell ?? 0} sell.` : "."));
  const last = hist[0];
  if (last?.revenueYoY != null) facts.push(`Last quarter revenue grew ${pct(num(last.revenueYoY))} year on year.`);
  const hot = beats >= 3;
  const scen: Scen[] = [
    {
      key: "low",
      title: "If the result is LOWER than expected",
      cond: lo != null ? `EPS below ${usd(lo)}` + (rlo != null ? ` or revenue below ${money(rlo)}` : "") : "EPS or revenue under the estimates",
      lines: [
        "Price usually gaps down at the open after the report; the bigger the miss, the bigger the gap.",
        hot ? "This company usually beats, so a miss is a real surprise and tends to be punished harder than for a company that often disappoints." : "A miss confirms a worry; the reaction depends on how much was already priced in.",
        "A weak outlook for the next quarter hurts more than the quarter itself: watch the guidance and margin comments.",
        mega ? "A company this large can pull Nasdaq/S&P futures and risk assets (crypto often follows tech) down with it for the day." : "Peers in the same sector often move in sympathy, but the main move stays in this stock.",
      ],
    },
    {
      key: "inline",
      title: "If the result is IN LINE",
      cond: cons != null ? `EPS close to ${usd(cons)}` + (typical != null && hot ? ` (but below the usual beat of ~${usd(typical)})` : "") : "close to the estimates",
      lines: [
        "Often a small move; attention shifts to guidance and what management says on the call.",
        hot ? "For a company that normally beats, “in line” can still read as a disappointment and the price can slip." : "In-line results with firm guidance are usually taken as a relief.",
        "Volatility normally falls right after the report once the uncertainty is gone.",
      ],
    },
    {
      key: "high",
      title: "If the result is HIGHER than expected",
      cond: hi != null ? `EPS above ${usd(hi)}` + (rhi != null ? ` or revenue above ${money(rhi)}` : "") : "EPS or revenue above the estimates",
      lines: [
        "Price usually gaps up; a beat plus a raised outlook (“beat and raise”) gives the strongest moves.",
        hot ? "Beats are expected here, so only a clearly larger beat than usual, or a better outlook, tends to lift the price much." : "A clean beat can start a re-rating, especially if revenue growth speeds up.",
        "Check the quality: a beat from taxes or one-off items is weaker than one from sales and margins. If the stock already ran up into the report, “sell the news” is common.",
        mega ? "A strong report from a heavyweight can lift the whole index and related suppliers/peers." : "Suppliers and competitors can move in sympathy.",
      ],
    },
  ];
  return { facts, scen, eps: { cons, lo, hi, typical }, rev: { lo: rlo, hi: rhi } };
}

function Modal(p: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="rp-back" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="rp-win" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>{p.title}</h2>
            {p.sub && <small>{p.sub}</small>}
          </div>
          <button className="rp-x" onClick={p.onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="rp-body">{p.children}</div>
      </div>
    </div>
  );
}

function CompanyReport(p: { sym: string; ev?: NewsEv; onClose: () => void; onOpenChart: (b: string) => void }) {
  const [c, setC] = useState<Company | null | undefined>(undefined);
  const [actEps, setActEps] = useState("");
  const [actRev, setActRev] = useState("");
  useEffect(() => {
    const ctl = new AbortController();
    loadCompany(p.sym, ctl.signal).then(setC).catch(() => {});
    return () => ctl.abort();
  }, [p.sym]);
  const nx = c?.next || {};
  const t = p.ev?.t ?? nx.t ?? null;
  const mega = (num(nx.marketCap) || 0) >= 2e11 || p.ev?.impact === "High";
  const hist: any[] = c?.history || [];
  const S = useMemo(() => (c ? scenarios(c, mega) : null), [c, mega]);
  const [h1, h0] = [hist[1], hist[0]];
  const q = nx.fiscalQuarter || c?.forecast?.quarterly?.[0]?.period || "next quarter";
  // verdict once the user types the real numbers
  const aE = num(actEps), aR = num(actRev);
  const verdict = (() => {
    if (!S) return null;
    const out: { key: "low" | "inline" | "high"; text: string }[] = [];
    if (aE != null && S.eps.cons != null) {
      const sp = ((aE - S.eps.cons) / Math.abs(S.eps.cons)) * 100;
      out.push({ key: sp > 1 ? "high" : sp < -1 ? "low" : "inline", text: `EPS ${usd(aE)} vs analysts ${usd(S.eps.cons)} → ${pct(sp)} ${sp > 1 ? "beat" : sp < -1 ? "miss" : "in line"}` });
    }
    if (aR != null && S.rev.lo != null && S.rev.hi != null) {
      const m = aR * 1000;
      out.push({ key: m > S.rev.hi ? "high" : m < S.rev.lo ? "low" : "inline", text: `Revenue ${money(m)} vs company guide ${money(S.rev.lo)}–${money(S.rev.hi)} → ${m > S.rev.hi ? "above" : m < S.rev.lo ? "below" : "inside"} the range` });
    }
    return out;
  })();
  const hl = verdict && verdict.length ? (verdict.some((v) => v.key === "low") ? "low" : verdict.every((v) => v.key === "high") ? "high" : verdict.some((v) => v.key === "high") ? "high" : "inline") : null;
  const name = c?.name ? c.name.replace(/\b(\w)(\w*)/g, (_: string, a: string, b: string) => a + b.toLowerCase()) : p.ev?.title.replace(/ earnings report$/, "") || p.sym;
  const when = t ? new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "date not known";
  const cell = (v: React.ReactNode, cls = "") => <td className={cls}>{v}</td>;
  const quarters = [
    { label: h1?.period || "2 quarters ago", d: h1 },
    { label: h0?.period || "last quarter", d: h0 },
  ];
  return (
    <Modal
      onClose={p.onClose}
      title={
        <>
          {name} <u>{p.sym}</u> · earnings report
        </>
      }
      sub={
        <>
          {when}
          {t && t > Date.now() ? " · in " + Math.max(0, Math.round((t - Date.now()) / 864e5)) + " day(s)" : ""}
          {nx.when === "amc" ? " · after market close" : nx.when === "bmo" ? " · before market open" : ""}
        </>
      }
    >
      {c === undefined && <div className="rp-note">Loading the report data…</div>}
      {c === null && (
        <div className="rp-note warn">
          No detailed data for {p.sym} yet. The server job refreshes the biggest and soonest companies first, so it usually appears within a few runs. {p.ev?.forecast ? "Analyst EPS estimate from the calendar: " + p.ev.forecast + "." : ""}
          <div className="rp-links">
            {LINKS(p.sym).map(([n, u]) => (
              <a key={n} href={u} target="_blank" rel="noreferrer">
                {n} ↗
              </a>
            ))}
          </div>
        </div>
      )}
      {c && S && (
        <>
          <table className="rp-tab">
            <thead>
              <tr>
                <th />
                {quarters.map((x, i) => (
                  <th key={i}>
                    {x.label}
                    <small>{x.d?.reported ? "reported " + day(x.d.reported) : ""}</small>
                  </th>
                ))}
                <th className="now">
                  {q}
                  <small>this report</small>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="sec">
                <td colSpan={4}>Revenue</td>
              </tr>
              <tr>
                <th>Company forecast</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell(S.rev.lo != null ? money(S.rev.lo) + " – " + money(S.rev.hi) : "not given in the press release", S.rev.lo != null ? "co" : "dim")}
              </tr>
              <tr>
                <th>Investors / analysts forecast</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell(nx.revenueEstimate != null ? "≈ " + money(nx.revenueEstimate) : c.revenueAnnual ? "FY" + c.revenueAnnual.year + " total ≈ $" + c.revenueAnnual.avg : "—", nx.revenueEstimate != null ? "an" : "dim")}
              </tr>
              <tr>
                <th>Actual</th>
                {quarters.map((x, i) => cell(x.d?.revenue != null ? <>{money(x.d.revenue)}<small>{pct(num(x.d.revenueYoY))} YoY</small></> : "—", "act"))}
                <td className="empty">
                  <input inputMode="decimal" placeholder="$ billions" value={actRev} onChange={(e) => setActRev(e.target.value)} />
                </td>
              </tr>
              <tr className="sec">
                <td colSpan={4}>Earnings per share (EPS)</td>
              </tr>
              <tr>
                <th>Company forecast</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell("companies rarely guide EPS", "dim")}
              </tr>
              <tr>
                <th>Investors / analysts forecast</th>
                {quarters.map((x, i) => cell(x.d ? usd(num(x.d.epsEst)) : "—", "an"))}
                {cell(
                  nx.epsForecast != null ? (
                    <>
                      {usd(num(nx.epsForecast))}
                      <small>
                        {nx.epsLow != null ? usd(num(nx.epsLow)) + "–" + usd(num(nx.epsHigh)) : ""} {nx.nEstimates ? "· " + nx.nEstimates + " analysts" : ""}
                      </small>
                    </>
                  ) : (
                    "—"
                  ),
                  "an",
                )}
              </tr>
              <tr>
                <th>Actual</th>
                {quarters.map((x, i) => cell(x.d ? usd(num(x.d.epsActual)) : "—", "act"))}
                <td className="empty">
                  <input inputMode="decimal" placeholder="$ per share" value={actEps} onChange={(e) => setActEps(e.target.value)} />
                </td>
              </tr>
              <tr>
                <th>Surprise vs analysts</th>
                {quarters.map((x, i) => cell(x.d ? <b className={num(x.d.surprisePct)! >= 0 ? "up" : "dn"}>{pct(num(x.d.surprisePct))}</b> : "—"))}
                {cell(verdict && verdict[0] ? verdict[0].text : "after the report", "dim")}
              </tr>
            </tbody>
          </table>
          <p className="rp-hint">The “Actual” boxes in the last column are empty on purpose. After the company reports, type the real numbers and the matching scenario below lights up. Revenue guidance comes from the company’s own latest results press release (SEC); “—” means that figure is not published by our sources.</p>

          {verdict && verdict.length > 0 && (
            <div className="rp-verdict">
              {verdict.map((v, i) => (
                <span key={i} className={v.key}>
                  {v.text}
                </span>
              ))}
            </div>
          )}

          <h3>What the numbers say</h3>
          <ul className="rp-facts">
            {S.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>

          <h3>What could happen</h3>
          <div className="rp-scen">
            {S.scen.map((s) => (
              <div key={s.key} className={"rp-sc " + s.key + (hl === s.key ? " on" : "")}>
                <b>{s.title}</b>
                <em>{s.cond}</em>
                <ul>
                  {s.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {c.news?.length > 0 && (
            <>
              <h3>Latest headlines</h3>
              <ul className="rp-list">
                {c.news.slice(0, 8).map((n: any, i: number) => (
                  <li key={i}>
                    <span>{new Date(n.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <a href={n.url} target="_blank" rel="noreferrer">
                      {n.title}
                    </a>
                    <small>{n.source}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.filings?.length > 0 && (
            <>
              <h3>Recent SEC filings</h3>
              <ul className="rp-list">
                {c.filings.slice(0, 5).map((f: any, i: number) => (
                  <li key={i}>
                    <span>{day(f.date)}</span>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.form}
                      {/2\.02/.test(f.items) ? " · results press release" : f.items ? " · items " + f.items : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.guidance?.quotes?.length > 0 && (
            <>
              <h3>What the company said about the outlook</h3>
              {c.guidance.quotes.map((x: string, i: number) => (
                <blockquote key={i}>{x}</blockquote>
              ))}
              <a className="rp-src" href={c.guidance.url} target="_blank" rel="noreferrer">
                Open the press release ↗
              </a>
            </>
          )}
          <div className="rp-links">
            {LINKS(p.sym).map(([n, u]) => (
              <a key={n} href={u} target="_blank" rel="noreferrer">
                {n} ↗
              </a>
            ))}
          </div>
          <p className="rp-foot">
            Sources: {(c.sources || []).join(", ") || "—"} · data collected {c.at ? new Date(c.at).toLocaleString() : ""}. The scenario text is a rule-of-thumb reading of these numbers, not a forecast and not trading advice.
          </p>
        </>
      )}
      <div className="rp-actions">
        <button
          className="primary"
          onClick={() => {
            p.onClose();
            p.onOpenChart(p.sym);
          }}
        >
          Open {p.sym} chart →
        </button>
      </div>
    </Modal>
  );
}

type Kind = { re: RegExp; label: string; up: string; down: string };
const KINDS: Kind[] = [
  { re: /cpi|inflation|pce|ppi|price index|deflator/i, label: "Inflation", up: "Hotter inflation than expected: rate-cut hopes fade, the dollar and yields tend to rise, stocks, gold and crypto tend to fall.", down: "Cooler inflation than expected: rate-cut hopes grow, the dollar and yields tend to fall, stocks, gold and crypto tend to rise." },
  { re: /non-?farm|nfp|payroll|employment change|adp/i, label: "Jobs", up: "More jobs than expected: strong economy, the dollar and yields usually rise; stocks can go either way (good growth vs. fewer rate cuts).", down: "Fewer jobs than expected: growth worries and more rate-cut bets; the dollar tends to fall, gold rises, stocks can wobble on recession fear." },
  { re: /unemployment|jobless claims/i, label: "Unemployment", up: "Higher than expected is a weaker labour market: dollar tends to fall, rate-cut bets rise.", down: "Lower than expected is a tighter labour market: dollar and yields tend to rise." },
  { re: /rate decision|interest rate|fomc|federal funds|bank rate|policy rate|cash rate/i, label: "Central-bank decision", up: "More hawkish than expected (higher rate or tougher tone): currency up, stocks, gold and crypto down.", down: "More dovish than expected (cut or softer tone): currency down, stocks, gold and crypto up." },
  { re: /gdp|retail sales|pmi|ism|consumer confidence|sentiment|durable|industrial production/i, label: "Growth", up: "Stronger than expected: supports the currency and risk assets; can lift yields.", down: "Weaker than expected: pressures the currency and cyclical stocks; raises rate-cut bets." },
];
function MacroReport(p: { ev: NewsEv; rates?: Rates; onClose: () => void }) {
  const [act, setAct] = useState("");
  const e = p.ev;
  const k = KINDS.find((x) => x.re.test(e.title));
  const f = num(e.forecast), a = num(act);
  const diff = a != null && f != null ? a - f : null;
  const fomc = /fomc|federal funds|interest rate/i.test(e.title) && e.currency === "USD";
  return (
    <Modal onClose={p.onClose} title={e.title} sub={new Date(e.t).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (e.currency ? " · " + e.currency : "")}>
      <table className="rp-tab small">
        <thead>
          <tr>
            <th />
            <th>Previous</th>
            <th>Forecast</th>
            <th className="now">Actual</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Value</th>
            <td className="act">{e.previous || "—"}</td>
            <td className="an">{e.forecast || "—"}</td>
            <td className="empty">
              <input value={act} placeholder="type when released" onChange={(x) => setAct(x.target.value)} />
            </td>
          </tr>
        </tbody>
      </table>
      {diff != null && <div className="rp-verdict"><span className={diff > 0 ? "high" : diff < 0 ? "low" : "inline"}>Actual {act} vs forecast {e.forecast} → {diff > 0 ? "higher" : diff < 0 ? "lower" : "in line"}</span></div>}
      <h3>How the market usually reacts {k ? "· " + k.label : ""}</h3>
      {k ? (
        <div className="rp-scen two">
          <div className={"rp-sc low" + (diff != null && diff < 0 ? " on" : "")}>
            <b>If LOWER than forecast</b>
            <ul>
              <li>{k.down}</li>
            </ul>
          </div>
          <div className={"rp-sc high" + (diff != null && diff > 0 ? " on" : "")}>
            <b>If HIGHER than forecast</b>
            <ul>
              <li>{k.up}</li>
            </ul>
          </div>
        </div>
      ) : (
        <p className="rp-hint">No ready-made reading for this release. In general a surprise away from the forecast moves the currency first, then rate expectations, then stocks.</p>
      )}
      {fomc && p.rates && (
        <>
          <h3>Rate-path hint</h3>
          <p className="rp-hint">{p.rates.hintText}</p>
          <ul className="rp-list">
            {Object.entries(p.rates.yields).map(([k2, v]) => (
              <li key={k2}>
                <span>{k2}</span>
                <b>{v.toFixed(2)}%</b>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="rp-links">
        {[
          ["CME FedWatch", "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"],
          ["FRED calendar", "https://fred.stlouisfed.org/releases/calendar"],
          ["Investing.com calendar", "https://www.investing.com/economic-calendar/"],
          ["ForexFactory", "https://www.forexfactory.com/calendar"],
        ].map(([n, u]) => (
          <a key={n} href={u} target="_blank" rel="noreferrer">
            {n} ↗
          </a>
        ))}
      </div>
      <p className="rp-foot">Source: {e.source}. Typical reactions are general rules of thumb, not forecasts and not trading advice.</p>
    </Modal>
  );
}

/** Mount once: listens for openReport() calls. */
export function ReportHost(p: { onOpenChart: (base: string) => void }) {
  const [req, setReq] = useState<ReportReq | null>(null);
  const [h, setH] = useState<Hosted | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ReportReq>).detail;
      setReq(d);
      loadHosted().then(setH).catch(() => {});
    };
    window.addEventListener("arcus:report", on);
    return () => window.removeEventListener("arcus:report", on);
  }, []);
  if (!req) return null;
  const close = () => setReq(null);
  if (req.symbol) {
    const ev = h?.events.filter((e) => e.kind === "earnings" && e.symbol === req.symbol).sort((a, b) => Math.abs(a.t - Date.now()) - Math.abs(b.t - Date.now()))[0];
    return <CompanyReport sym={req.symbol} ev={ev} onClose={close} onOpenChart={p.onOpenChart} />;
  }
  const ev = h?.events.find((e) => e.id === req.evId);
  if (!ev) return <Modal title="Loading…" onClose={close}>{h ? "Event not found in the latest data." : "Loading…"}</Modal>;
  return <MacroReport ev={ev} rates={h?.rates} onClose={close} />;
}
