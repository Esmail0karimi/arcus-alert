/* Report window: opens from the News tab or from a chart event marker.
   Company reports: the two previous quarters next to the coming one (company forecast, analyst forecast, actual left empty),
   plus a rule-based "if lower / in line / higher" read. Macro releases: previous / forecast / actual and the usual market reaction. */
import React, { useEffect, useMemo, useState } from "react";
import { Company, Hosted, NewsEv, Rates, loadCompany, loadHosted } from "./newsdata";
import { dloc, faText, setLang, useLang } from "./lang";

export type ReportReq = { symbol?: string; evId?: string };
export const openReport = (r: ReportReq) => window.dispatchEvent(new CustomEvent<ReportReq>("arcus:report", { detail: r }));

const usd = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(d));
const money = (m: number | null | undefined) => (m == null || !isFinite(m) ? "—" : Math.abs(m) >= 1000 ? "$" + (m / 1000).toFixed(m >= 100000 ? 1 : 2) + "B" : "$" + m.toFixed(0) + "M");
const pct = (v: number | null | undefined, sign = true) => (v == null || !isFinite(v) ? "—" : "\u200E" + (sign && v > 0 ? "+" : "") + v.toFixed(1) + "%\u200E");
const num = (v: any): number | null => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return isFinite(x) ? x : null;
};
let FA = false; // set by the window on each render so the helpers below follow the language
const day = (s?: string | null) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString(dloc(FA), { month: "short", day: "numeric", year: "numeric" }) : "—");

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
function scenarios(c: Company, mega: boolean, fa: boolean): { facts: string[]; scen: Scen[]; eps: { cons: number | null; lo: number | null; hi: number | null; typical: number | null }; rev: { lo: number | null; hi: number | null } } {
  const T = (en: string, f: string) => (fa ? f : en);
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
  const ly = num(nx.lastYearEps);
  if (cons != null) {
    const range = lo != null && hi != null ? T(` (range ${usd(lo)}–${usd(hi)}`, ` (بازه ${usd(lo)} تا ${usd(hi)}`) + (nx.nEstimates ? T(`, ${nx.nEstimates} analysts)`, `، ${nx.nEstimates} تحلیلگر)`) : ")") : "";
    const yoy = ly ? T(`, versus ${usd(ly)} a year ago (${pct(((cons - ly) / Math.abs(ly)) * 100)}).`, `، در برابر ${usd(ly)} یک سال قبل (${pct(((cons - ly) / Math.abs(ly)) * 100)}).`) : ".";
    facts.push(T(`Analysts ${c?.__reported ? "expected" : "expect"} EPS ${usd(cons)}`, `تحلیلگران سود هر سهم (EPS) را ${usd(cons)} ${c?.__reported ? "پیش‌بینی کرده بودند" : "پیش‌بینی می‌کنند"}`) + range + yoy);
  }
  if (rlo != null && rhi != null) facts.push(T(`The company itself guided revenue of ${money(rlo)}–${money(rhi)} (SEC press release of ${day(c.guidance.filed)}).`, `خود شرکت درآمد را بین ${money(rlo)} تا ${money(rhi)} پیش‌بینی کرده است (بیانیه SEC در ${day(c.guidance.filed)}).`));
  if (sur.length) facts.push(T(`It beat the EPS estimate in ${beats} of the last ${sur.length} reports, on average by ${pct(avg)}.` + (typical != null && beats >= 3 ? ` So the market is probably already counting on about ${usd(typical)}, not just ${usd(cons)}.` : ""), `در ${beats} گزارش از ${sur.length} گزارش آخر، سود بهتر از پیش‌بینی بوده، به‌طور میانگین ${pct(avg)}.` + (typical != null && beats >= 3 ? ` پس بازار احتمالاً از قبل روی حدود ${usd(typical)} حساب کرده، نه فقط ${usd(cons)}.` : "")));
  const m = c?.forecast?.momentum;
  if (m && (num(m.up) != null || num(m.down) != null)) facts.push(T(`In the last 30 days ${num(m.up) ?? 0} analyst estimate(s) went up and ${num(m.down) ?? 0} went down.`, `در ۳۰ روز گذشته ${num(m.up) ?? 0} پیش‌بینی تحلیلگران بالا رفته و ${num(m.down) ?? 0} پایین آمده است.`));
  const t = c?.targets;
  if (t?.avg) facts.push(T(`Average analyst price target ${usd(num(t.avg), 0)}` + (t.buy != null ? ` · ${t.buy} buy / ${t.hold ?? 0} hold / ${t.sell ?? 0} sell.` : "."), `میانگین قیمت هدف تحلیلگران ${usd(num(t.avg), 0)}` + (t.buy != null ? ` · ${t.buy} خرید / ${t.hold ?? 0} نگه‌دار / ${t.sell ?? 0} فروش.` : ".")));
  const last = hist[0];
  if (last?.revenueYoY != null) facts.push(T(`Last quarter revenue grew ${pct(num(last.revenueYoY))} year on year.`, `درآمد فصل قبل نسبت به سال قبل ${pct(num(last.revenueYoY))} تغییر کرده است.`));
  const hot = beats >= 3;
  const nq = c?.forecast?.quarterly?.[0];
  if (c?.__reported && nq?.eps != null) facts.push(T(`Next quarter (${nq.period}): analysts expect EPS ${usd(num(nq.eps))}` + (nq.n ? ` from ${nq.n} analysts` : "") + ". The next report date is not scheduled yet.", `فصل بعد (${nq.period}): تحلیلگران EPS را ${usd(num(nq.eps))} پیش‌بینی می‌کنند` + (nq.n ? ` (${nq.n} تحلیلگر)` : "") + ". تاریخ گزارش بعدی هنوز اعلام نشده."));
  const scen: Scen[] = [
    {
      key: "low",
      title: T("If the result is LOWER than expected", "اگر نتیجه از انتظار کمتر باشد"),
      cond: lo != null ? T(`EPS below ${usd(lo)}` + (rlo != null ? ` or revenue below ${money(rlo)}` : ""), `EPS کمتر از ${usd(lo)}` + (rlo != null ? ` یا درآمد کمتر از ${money(rlo)}` : "")) : T("EPS or revenue under the estimates", "EPS یا درآمد زیر پیش‌بینی‌ها"),
      lines: [
        T("Price usually gaps down at the open after the report; the bigger the miss, the bigger the gap.", "معمولاً قیمت بعد از گزارش با گپ نزولی باز می‌شود؛ هرچه ضعف بیشتر، گپ بزرگ‌تر."),
        hot ? T("This company usually beats, so a miss is a real surprise and tends to be punished harder than for a company that often disappoints.", "این شرکت معمولاً بهتر از انتظار گزارش می‌دهد، پس ضعف یک شوک واقعی است و شدیدتر از شرکتی که اغلب ناامیدکننده است جریمه می‌شود.") : T("A miss confirms a worry; the reaction depends on how much was already priced in.", "ضعف یک نگرانی را تأیید می‌کند؛ واکنش به این بستگی دارد که چقدر از قبل در قیمت لحاظ شده بود."),
        T("A weak outlook for the next quarter hurts more than the quarter itself: watch the guidance and margin comments.", "چشم‌انداز ضعیف برای فصل بعد از خود فصل مهم‌تر است: به پیش‌بینی شرکت (guidance) و حاشیه سود دقت کنید."),
        mega ? T("A company this large can pull Nasdaq/S&P futures and risk assets (crypto often follows tech) down with it for the day.", "شرکتی به این بزرگی می‌تواند فیوچرز ناسداک/S&P و دارایی‌های ریسکی (کریپتو اغلب دنبال تکنولوژی است) را همان روز پایین بکشد.") : T("Peers in the same sector often move in sympathy, but the main move stays in this stock.", "شرکت‌های هم‌گروه اغلب هم‌جهت حرکت می‌کنند، اما حرکت اصلی در همین سهم می‌ماند."),
      ],
    },
    {
      key: "inline",
      title: T("If the result is IN LINE", "اگر نتیجه مطابق انتظار باشد"),
      cond: cons != null ? T(`EPS close to ${usd(cons)}` + (typical != null && hot ? ` (but below the usual beat of ~${usd(typical)})` : ""), `EPS نزدیک ${usd(cons)}` + (typical != null && hot ? ` (اما کمتر از بهترِ معمول، حدود ${usd(typical)})` : "")) : T("close to the estimates", "نزدیک پیش‌بینی‌ها"),
      lines: [
        T("Often a small move; attention shifts to guidance and what management says on the call.", "معمولاً حرکت کوچک است؛ توجه به guidance و صحبت مدیران در کنفرانس کال می‌رود."),
        hot ? T("For a company that normally beats, “in line” can still read as a disappointment and the price can slip.", "برای شرکتی که معمولاً بهتر از انتظار می‌دهد، «مطابق انتظار» هم می‌تواند ناامیدکننده تلقی شود و قیمت کمی افت کند.") : T("In-line results with firm guidance are usually taken as a relief.", "نتیجه مطابق انتظار با guidance محکم معمولاً آرامش‌بخش است."),
        T("Volatility normally falls right after the report once the uncertainty is gone.", "نوسان معمولاً بعد از گزارش و رفع ابهام کم می‌شود."),
      ],
    },
    {
      key: "high",
      title: T("If the result is HIGHER than expected", "اگر نتیجه از انتظار بیشتر باشد"),
      cond: hi != null ? T(`EPS above ${usd(hi)}` + (rhi != null ? ` or revenue above ${money(rhi)}` : ""), `EPS بالاتر از ${usd(hi)}` + (rhi != null ? ` یا درآمد بالاتر از ${money(rhi)}` : "")) : T("EPS or revenue above the estimates", "EPS یا درآمد بالای پیش‌بینی‌ها"),
      lines: [
        T("Price usually gaps up; a beat plus a raised outlook (“beat and raise”) gives the strongest moves.", "معمولاً قیمت با گپ صعودی باز می‌شود؛ نتیجه خوب به‌همراه چشم‌انداز بالاتر («beat and raise») قوی‌ترین حرکت را می‌دهد."),
        hot ? T("Beats are expected here, so only a clearly larger beat than usual, or a better outlook, tends to lift the price much.", "اینجا بهتر از انتظار بودن عادی است، پس فقط نتیجه‌ای بسیار بهتر از معمول یا چشم‌انداز بهتر قیمت را زیاد بالا می‌برد.") : T("A clean beat can start a re-rating, especially if revenue growth speeds up.", "یک نتیجه خوب و تمیز می‌تواند ارزش‌گذاری مجدد را شروع کند، به‌ویژه اگر رشد درآمد سریع‌تر شود."),
        T("Check the quality: a beat from taxes or one-off items is weaker than one from sales and margins. If the stock already ran up into the report, “sell the news” is common.", "کیفیت را بررسی کنید: سود ناشی از مالیات یا اقلام یک‌باره ضعیف‌تر از سود ناشی از فروش و حاشیه است. اگر سهم پیش از گزارش بالا رفته باشد، «فروش بعد از خبر» رایج است."),
        mega ? T("A strong report from a heavyweight can lift the whole index and related suppliers/peers.", "گزارش قوی از یک غول می‌تواند کل شاخص و تأمین‌کنندگان/هم‌گروه‌ها را بالا ببرد.") : T("Suppliers and competitors can move in sympathy.", "تأمین‌کنندگان و رقبا می‌توانند هم‌جهت حرکت کنند."),
      ],
    },
  ];
  return { facts, scen, eps: { cons, lo, hi, typical }, rev: { lo: rlo, hi: rhi } };
}

function Modal(p: { title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const fa = useLang() === "fa";
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="rp-back" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={"rp-win" + (fa ? " fa" : "")} role="dialog" aria-modal="true" dir={fa ? "rtl" : "ltr"}>
        <header>
          <div>
            <h2>{p.title}</h2>
            {p.sub && <small>{p.sub}</small>}
          </div>
          <button className="rp-lang" onClick={() => setLang(fa ? "en" : "fa")} title="English / فارسی">
            {fa ? "EN" : "فا"}
          </button>
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
  const fa = useLang() === "fa";
  FA = fa;
  const T = (en: string, f: string) => (fa ? f : en);
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
  // a report from the last days: its real numbers are already in the history
  const rep0 = hist[0];
  const reportedNow = !!(rep0 && t && t < Date.now() && rep0.reported && Math.abs(Date.parse(rep0.reported + "T21:00:00Z") - t) < 4 * 864e5);
  // numbers the collector already found for this report (used when the history file lags behind)
  const evEps = !reportedNow && p.ev?.actual ? num(p.ev.actual) : null;
  const evRevM = !reportedNow ? (p.ev?.notes || []).join(" ").match(/Revenue \$([\d.,]+)\s*([BMK])/i) : null;
  const evRev = evRevM ? parseFloat(evRevM[1].replace(/,/g, "")) * ({ B: 1, M: 1e-3, K: 1e-6 } as any)[evRevM[2].toUpperCase()] : null;
  const S = useMemo(() => {
    if (!c) return null;
    if (!reportedNow) return scenarios(c, mega, fa);
    // judge the finished report against what was expected for it
    const c2 = { ...c, __reported: true, next: { ...c.next, epsForecast: rep0.epsEst, epsLow: null, epsHigh: null, nEstimates: null, lastYearEps: null }, guidance: null, forecast: { ...c.forecast, momentum: null } };
    return scenarios(c2, mega, fa);
  }, [c, mega, reportedNow, fa]);
  const [h1, h0] = reportedNow ? [hist[2], hist[1]] : [hist[1], hist[0]];
  const q = reportedNow ? rep0.period : nx.fiscalQuarter || c?.forecast?.quarterly?.[0]?.period || T("next quarter", "فصل بعد");
  // verdict once the user types the real numbers
  const aE = reportedNow ? num(rep0.epsActual) : evEps ?? num(actEps), aR = reportedNow ? (rep0.revenue != null ? rep0.revenue / 1000 : null) : evRev ?? num(actRev);
  const verdict = (() => {
    if (!S) return null;
    const out: { key: "low" | "inline" | "high"; text: string }[] = [];
    if (aE != null && S.eps.cons != null) {
      const sp = ((aE - S.eps.cons) / Math.abs(S.eps.cons)) * 100;
      out.push({ key: sp > 1 ? "high" : sp < -1 ? "low" : "inline", text: T(`EPS ${usd(aE)} vs analysts ${usd(S.eps.cons)} → ${pct(sp)} ${sp > 1 ? "beat" : sp < -1 ? "miss" : "in line"}`, `EPS ${usd(aE)} در برابر پیش‌بینی ${usd(S.eps.cons)} → ${pct(sp)} ${sp > 1 ? "بهتر از انتظار" : sp < -1 ? "ضعیف‌تر از انتظار" : "مطابق انتظار"}`) });
    }
    if (aR != null && S.rev.lo != null && S.rev.hi != null) {
      const m = aR * 1000;
      out.push({ key: m > S.rev.hi ? "high" : m < S.rev.lo ? "low" : "inline", text: T(`Revenue ${money(m)} vs company guide ${money(S.rev.lo)}–${money(S.rev.hi)} → ${m > S.rev.hi ? "above" : m < S.rev.lo ? "below" : "inside"} the range`, `درآمد ${money(m)} در برابر پیش‌بینی شرکت ${money(S.rev.lo)} تا ${money(S.rev.hi)} → ${m > S.rev.hi ? "بالاتر از" : m < S.rev.lo ? "پایین‌تر از" : "داخل"} بازه`) });
    }
    return out;
  })();
  const hl = verdict && verdict.length ? (verdict.some((v) => v.key === "low") ? "low" : verdict.every((v) => v.key === "high") ? "high" : verdict.some((v) => v.key === "high") ? "high" : "inline") : null;
  const name = c?.name ? c.name.replace(/\b(\w)(\w*)/g, (_: string, a: string, b: string) => a + b.toLowerCase()) : p.ev?.title.replace(/ earnings report$/, "") || p.sym;
  const when = t ? new Date(t).toLocaleString(dloc(fa) || [], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : T("date not known", "تاریخ نامشخص");
  const cell = (v: React.ReactNode, cls = "") => <td className={cls}>{v}</td>;
  const quarters = [
    { label: h1?.period || T("2 quarters ago", "دو فصل قبل"), d: h1 },
    { label: h0?.period || T("last quarter", "فصل قبل"), d: h0 },
  ];
  return (
    <Modal
      onClose={p.onClose}
      title={
        <>
          {name} <u>{p.sym}</u> · {T("earnings report", "گزارش سود")}
        </>
      }
      sub={
        <>
          {when}
          {t && t > Date.now() ? T(" · in " + Math.max(0, Math.round((t - Date.now()) / 864e5)) + " day(s)", " · " + Math.max(0, Math.round((t - Date.now()) / 864e5)) + " روز دیگر") : ""}
          {nx.when === "amc" ? T(" · after market close", " · بعد از بسته شدن بازار") : nx.when === "bmo" ? T(" · before market open", " · قبل از باز شدن بازار") : ""}
        </>
      }
    >
      {c === undefined && <div className="rp-note">{T("Loading the report data…", "در حال بارگذاری داده‌های گزارش…")}</div>}
      {c === null && (
        <div className="rp-note warn">
          {T("No detailed data for " + p.sym + " yet. The server job refreshes the biggest and soonest companies first, so it usually appears within a few runs. ", "هنوز داده تفصیلی برای " + p.sym + " نیست. کار سرور ابتدا شرکت‌های بزرگ‌تر و نزدیک‌تر را به‌روز می‌کند، پس معمولاً بعد از چند نوبت پیدا می‌شود. ")}{p.ev?.forecast ? T("Analyst EPS estimate from the calendar: ", "پیش‌بینی EPS تحلیلگران از تقویم: ") + p.ev.forecast + "." : ""}
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
                    <small>{x.d?.reported ? T("reported ", "گزارش: ") + day(x.d.reported) : ""}</small>
                  </th>
                ))}
                <th className="now">
                  {q}
                  <small>{reportedNow ? T("reported ", "گزارش: ") + day(rep0.reported) : T("this report", "این گزارش")}</small>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="sec">
                <td colSpan={4}>{T("Revenue", "درآمد")}</td>
              </tr>
              <tr>
                <th>{T("Company forecast", "پیش‌بینی خود شرکت")}</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell(reportedNow ? "—" : S.rev.lo != null ? money(S.rev.lo) + " – " + money(S.rev.hi) : T("not given in the press release", "در بیانیه اعلام نشده"), !reportedNow && S.rev.lo != null ? "co" : "dim")}
              </tr>
              <tr>
                <th>{T("Investors / analysts forecast", "پیش‌بینی سرمایه‌گذاران / تحلیلگران")}</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell(reportedNow ? "—" : nx.revenueEstimate != null ? "≈ " + money(nx.revenueEstimate) : c.revenueAnnual ? T("FY" + c.revenueAnnual.year + " total ≈ $" + c.revenueAnnual.avg, "کل سال مالی " + c.revenueAnnual.year + " ≈ $" + c.revenueAnnual.avg) : "—", !reportedNow && nx.revenueEstimate != null ? "an" : "dim")}
              </tr>
              <tr>
                <th>{T("Actual", "عدد واقعی")}</th>
                {quarters.map((x, i) => cell(x.d?.revenue != null ? <>{money(x.d.revenue)}<small>{pct(num(x.d.revenueYoY))} {T("YoY", "سالانه")}</small></> : "—", "act"))}
                {reportedNow ? (
                  cell(rep0.revenue != null ? <>{money(rep0.revenue)}<small>{pct(num(rep0.revenueYoY))} {T("YoY", "سالانه")}</small></> : "—", "act")
                ) : evRev != null ? (
                  cell(money(evRev * 1000), "act")
                ) : (
                  <td className="empty">
                    <input inputMode="decimal" placeholder={T("$ billions", "میلیارد دلار")} value={actRev} onChange={(e) => setActRev(e.target.value)} />
                  </td>
                )}
              </tr>
              <tr className="sec">
                <td colSpan={4}>{T("Earnings per share (EPS)", "سود هر سهم (EPS)")}</td>
              </tr>
              <tr>
                <th>{T("Company forecast", "پیش‌بینی خود شرکت")}</th>
                {cell("—", "dim")}
                {cell("—", "dim")}
                {cell(T("companies rarely guide EPS", "شرکت‌ها معمولاً EPS را پیش‌بینی نمی‌کنند"), "dim")}
              </tr>
              <tr>
                <th>{T("Investors / analysts forecast", "پیش‌بینی سرمایه‌گذاران / تحلیلگران")}</th>
                {quarters.map((x, i) => cell(x.d ? usd(num(x.d.epsEst)) : "—", "an"))}
                {cell(
                  reportedNow ? usd(num(rep0.epsEst)) : nx.epsForecast != null ? (
                    <>
                      {usd(num(nx.epsForecast))}
                      <small>
                        {nx.epsLow != null ? usd(num(nx.epsLow)) + "–" + usd(num(nx.epsHigh)) : ""} {nx.nEstimates ? "· " + nx.nEstimates + T(" analysts", " تحلیلگر") : ""}
                      </small>
                    </>
                  ) : (
                    "—"
                  ),
                  "an",
                )}
              </tr>
              <tr>
                <th>{T("Actual", "عدد واقعی")}</th>
                {quarters.map((x, i) => cell(x.d ? usd(num(x.d.epsActual)) : "—", "act"))}
                {reportedNow ? (
                  cell(usd(num(rep0.epsActual)), "act")
                ) : evEps != null ? (
                  cell(usd(evEps), "act")
                ) : (
                  <td className="empty">
                    <input inputMode="decimal" placeholder={T("$ per share", "دلار به‌ازای سهم")} value={actEps} onChange={(e) => setActEps(e.target.value)} />
                  </td>
                )}
              </tr>
              <tr>
                <th>{T("Surprise vs analysts", "اختلاف با پیش‌بینی")}</th>
                {quarters.map((x, i) => cell(x.d ? <b className={num(x.d.surprisePct)! >= 0 ? "up" : "dn"}>{pct(num(x.d.surprisePct))}</b> : "—"))}
                {reportedNow ? cell(<b className={num(rep0.surprisePct)! >= 0 ? "up" : "dn"}>{pct(num(rep0.surprisePct))}</b>) : cell(verdict && verdict[0] ? verdict[0].text : T("after the report", "بعد از گزارش"), "dim")}
              </tr>
            </tbody>
          </table>
          <p className="rp-hint">
            {reportedNow ? T("This company has already reported, so the last column shows the real result next to what was expected. ", "این شرکت قبلاً گزارش داده؛ ستون آخر نتیجه واقعی را کنار انتظار نشان می‌دهد. ") : ""}
            {T("The “Actual” boxes in the last column are empty on purpose when the report is still ahead. After the company reports, type the real numbers and the matching scenario below lights up. Revenue guidance comes from the company’s own latest results press release (SEC); “—” means that figure is not published by our sources.", "وقتی گزارش هنوز نیامده، خانه‌های «عدد واقعی» ستون آخر عمداً خالی است. بعد از انتشار گزارش، اعداد واقعی را بنویسید تا سناریوی مربوط پایین روشن شود. پیش‌بینی درآمد شرکت از بیانیه نتایج خودش (SEC) می‌آید؛ «—» یعنی منابع ما آن عدد را منتشر نکرده‌اند.")}
          </p>

          {verdict && verdict.length > 0 && (
            <div className="rp-verdict">
              {verdict.map((v, i) => (
                <span key={i} className={v.key}>
                  {v.text}
                </span>
              ))}
            </div>
          )}

          <KeyPoints ev={p.ev} fa={fa} />
          <h3>{T("What the numbers say", "اعداد چه می‌گویند")}</h3>
          <ul className="rp-facts">
            {S.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>

          <h3>{reportedNow ? T("How it compares (the matching case is highlighted)", "مقایسه با انتظار (حالت مربوط پررنگ است)") : T("What could happen", "چه اتفاقی ممکن است بیفتد")}</h3>
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
              <h3>{T("Latest headlines", "آخرین خبرها")}</h3>
              <ul className="rp-list">
                {c.news.slice(0, 8).map((n: any, i: number) => (
                  <li key={i}>
                    <span>{new Date(n.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <a href={n.url} target="_blank" rel="noreferrer">
                      {n.title}
                    </a>
                    <small>{n.source}</small>
                    {fa && (
                      <a className="rp-tr" href={"https://translate.google.com/?sl=en&tl=fa&op=translate&text=" + encodeURIComponent(n.title)} target="_blank" rel="noreferrer">
                        ترجمه
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.filings?.length > 0 && (
            <>
              <h3>{T("Recent SEC filings", "گزارش‌های اخیر ثبت‌شده در SEC")}</h3>
              <ul className="rp-list">
                {c.filings.slice(0, 5).map((f: any, i: number) => (
                  <li key={i}>
                    <span>{day(f.date)}</span>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.form}
                      {/2\.02/.test(f.items) ? T(" · results press release", " · بیانیه نتایج مالی") : f.items ? T(" · items ", " · بند ") + f.items : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.guidance?.quotes?.length > 0 && (
            <>
              <h3>{T("What the company said about the outlook", "شرکت درباره چشم‌انداز چه گفته")}</h3>
              {c.guidance.quotes.map((x: string, i: number) => (
                <blockquote key={i}>
                  {x}
                  {fa && (
                    <>
                      {" "}
                      <a className="rp-tr" href={"https://translate.google.com/?sl=en&tl=fa&op=translate&text=" + encodeURIComponent(x)} target="_blank" rel="noreferrer">
                        ترجمه
                      </a>
                    </>
                  )}
                </blockquote>
              ))}
              <a className="rp-src" href={c.guidance.url} target="_blank" rel="noreferrer">
                {T("Open the press release", "باز کردن بیانیه")} ↗
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
            {T("Sources: ", "منابع: ")}
            {(c.sources || []).join(", ") || "—"} · {T("data collected ", "زمان جمع‌آوری داده: ")}
            {c.at ? new Date(c.at).toLocaleString(dloc(fa)) : ""}.{" "}
            {T("The scenario text is a rule-of-thumb reading of these numbers, not a forecast and not trading advice.", "متن سناریوها خوانشی قاعده‌محور از همین اعداد است؛ نه پیش‌بینی است و نه توصیه معاملاتی.")}
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
          {T("Open " + p.sym + " chart →", "باز کردن چارت " + p.sym + " ←")}
        </button>
      </div>
    </Modal>
  );
}

type Kind = { re: RegExp; label: string; up: string; down: string; fl: string; fup: string; fdown: string };
const KINDS: Kind[] = [
  { re: /cpi|inflation|pce|ppi|price index|deflator/i, label: "Inflation", up: "Hotter inflation than expected: rate-cut hopes fade, the dollar and yields tend to rise, stocks, gold and crypto tend to fall.", down: "Cooler inflation than expected: rate-cut hopes grow, the dollar and yields tend to fall, stocks, gold and crypto tend to rise.", fl: "تورم", fup: "تورم بالاتر از انتظار: امید به کاهش نرخ بهره کم می‌شود؛ دلار و بازدهی اوراق معمولاً بالا می‌روند و سهام، طلا و کریپتو معمولاً پایین می‌آیند.", fdown: "تورم پایین‌تر از انتظار: امید به کاهش نرخ بهره زیاد می‌شود؛ دلار و بازدهی معمولاً پایین می‌آیند و سهام، طلا و کریپتو معمولاً بالا می‌روند." },
  { re: /non-?farm|nfp|payroll|employment change|adp/i, label: "Jobs", up: "More jobs than expected: strong economy, the dollar and yields usually rise; stocks can go either way (good growth vs. fewer rate cuts).", down: "Fewer jobs than expected: growth worries and more rate-cut bets; the dollar tends to fall, gold rises, stocks can wobble on recession fear.", fl: "اشتغال", fup: "شغل بیشتر از انتظار: اقتصاد قوی؛ دلار و بازدهی معمولاً بالا می‌روند و سهام می‌تواند هر دو طرف برود (رشد خوب در برابر کاهش کمتر نرخ بهره).", fdown: "شغل کمتر از انتظار: نگرانی رشد و شرط‌بندی بیشتر روی کاهش نرخ بهره؛ دلار معمولاً پایین می‌آید، طلا بالا می‌رود و سهام از ترس رکود می‌لرزد." },
  { re: /unemployment|jobless claims/i, label: "Unemployment", up: "Higher than expected is a weaker labour market: dollar tends to fall, rate-cut bets rise.", down: "Lower than expected is a tighter labour market: dollar and yields tend to rise.", fl: "بیکاری", fup: "بالاتر از انتظار یعنی بازار کار ضعیف‌تر: دلار معمولاً پایین می‌آید و شرط‌بندی روی کاهش نرخ بهره زیاد می‌شود.", fdown: "پایین‌تر از انتظار یعنی بازار کار سفت‌تر: دلار و بازدهی معمولاً بالا می‌روند." },
  { re: /rate decision|interest rate|fomc|federal funds|bank rate|policy rate|cash rate/i, label: "Central-bank decision", up: "More hawkish than expected (higher rate or tougher tone): currency up, stocks, gold and crypto down.", down: "More dovish than expected (cut or softer tone): currency down, stocks, gold and crypto up.", fl: "تصمیم بانک مرکزی", fup: "تندروتر از انتظار (نرخ بالاتر یا لحن سخت‌تر): ارز بالا، سهام، طلا و کریپتو پایین.", fdown: "ملایم‌تر از انتظار (کاهش یا لحن نرم‌تر): ارز پایین، سهام، طلا و کریپتو بالا." },
  { re: /gdp|retail sales|pmi|ism|consumer confidence|sentiment|durable|industrial production/i, label: "Growth", up: "Stronger than expected: supports the currency and risk assets; can lift yields.", down: "Weaker than expected: pressures the currency and cyclical stocks; raises rate-cut bets.", fl: "رشد اقتصادی", fup: "قوی‌تر از انتظار: از ارز و دارایی‌های ریسکی حمایت می‌کند؛ می‌تواند بازدهی را بالا ببرد.", fdown: "ضعیف‌تر از انتظار: به ارز و سهام چرخه‌ای فشار می‌آورد و شرط‌بندی روی کاهش نرخ بهره را زیاد می‌کند." },
];
export const rateFa = (r: Rates) => {
  const mid = (r.hintText.match(/about ([\d.]+)%/) || [])[1];
  const y6 = r.yields["6M"];
  const act = r.hint === "hold" ? "تغییر بزرگی نیست" : r.hint === "cuts" ? "کاهش نرخ" : "افزایش نرخ";
  return `بازدهی اوراق خزانه ۶‌ماهه ${y6?.toFixed(2)}٪ است و نرخ سیاستی حدود ${mid ?? "?"}٪ → بازار اوراق به نظر «${act}» را قیمت‌گذاری می‌کند. برآورد تقریبی است، نه CME FedWatch (CME دسترسی خودکار را می‌بندد).`.replace(/٪/g, "%");
};
function KeyPoints(p: { ev?: NewsEv; fa: boolean }) {
  const e = p.ev;
  if (!e?.notes?.length) return null;
  const list = p.fa && e.notesFa?.length ? e.notesFa : e.notes;
  const tr = p.fa && !e.notesFa?.length;
  return (
    <>
      <h3>{p.fa ? "نکات مهم بعد از انتشار" : "Key points after publication"}</h3>
      <ul className="rp-facts rp-keys">
        {list.map((x, i) => (
          <li key={i}>
            {x}
            {tr && (
              <>
                {" "}
                <a className="rp-tr" href={"https://translate.google.com/?sl=en&tl=fa&op=translate&text=" + encodeURIComponent(x)} target="_blank" rel="noreferrer">
                  ترجمه
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
      {p.fa && e.notesFa?.length && e.notes.length > e.notesFa.length ? (
        <ul className="rp-facts rp-keys en" dir="ltr">
          {e.notes.slice(e.notesFa.length).map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : null}
      {e.noteSrc && (
        <a className="rp-src" href={e.noteSrc.url} target="_blank" rel="noreferrer">
          {p.fa ? "متن کامل: " : "Full text: "}
          {e.noteSrc.title} ↗
        </a>
      )}
      <p className="rp-hint">{p.fa ? "این خلاصه را خود سیستم از متن رسمی بیرون کشیده است، نه برداشت شخصی." : "Picked automatically from the official text; not a personal opinion."}</p>
    </>
  );
}

function MacroReport(p: { ev: NewsEv; rates?: Rates; onClose: () => void }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const [act, setAct] = useState("");
  const e = p.ev;
  const k = KINDS.find((x) => x.re.test(e.title));
  const f = num(e.forecast), a = num(e.actual ?? act);
  const diff = a != null && f != null ? a - f : null;
  const fomc = /fomc|federal funds|interest rate/i.test(e.title) && e.currency === "USD";
  return (
    <Modal onClose={p.onClose} title={fa ? faText(e.title) : e.title} sub={new Date(e.t).toLocaleString(dloc(fa) || [], { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (e.currency ? " · " + e.currency : "")}>
      <table className="rp-tab small">
        <thead>
          <tr>
            <th />
            <th>{T("Previous", "قبلی")}</th>
            <th>{T("Forecast", "پیش‌بینی")}</th>
            <th className="now">{T("Actual", "عدد واقعی")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{T("Value", "مقدار")}</th>
            <td className="act">{e.previous || "—"}</td>
            <td className="an">{e.forecast || "—"}</td>
            {e.actual ? (
              <td className="act">{e.actual}</td>
            ) : (
              <td className="empty">
                <input value={act} placeholder={e.t > Date.now() ? T("after release", "بعد از انتشار") : T("not filled in yet", "هنوز ثبت نشده")} onChange={(x) => setAct(x.target.value)} />
              </td>
            )}
          </tr>
        </tbody>
      </table>
      {diff != null && <div className="rp-verdict"><span className={diff > 0 ? "high" : diff < 0 ? "low" : "inline"}>{T("Actual", "واقعی")} {e.actual ?? act} {T("vs forecast", "در برابر پیش‌بینی")} {e.forecast} → {diff > 0 ? T("higher", "بالاتر") : diff < 0 ? T("lower", "پایین‌تر") : T("in line", "مطابق")}</span></div>}
      <KeyPoints ev={e} fa={fa} />
      <h3>{T("How the market usually reacts", "واکنش معمول بازار")} {k ? "· " + (fa ? k.fl : k.label) : ""}</h3>
      {k ? (
        <div className="rp-scen two">
          <div className={"rp-sc low" + (diff != null && diff < 0 ? " on" : "")}>
            <b>{T("If LOWER than forecast", "اگر کمتر از پیش‌بینی باشد")}</b>
            <ul>
              <li>{fa ? k.fdown : k.down}</li>
            </ul>
          </div>
          <div className={"rp-sc high" + (diff != null && diff > 0 ? " on" : "")}>
            <b>{T("If HIGHER than forecast", "اگر بیشتر از پیش‌بینی باشد")}</b>
            <ul>
              <li>{fa ? k.fup : k.up}</li>
            </ul>
          </div>
        </div>
      ) : (
        <p className="rp-hint">{T("No ready-made reading for this release. In general a surprise away from the forecast moves the currency first, then rate expectations, then stocks.", "برای این رویداد متن آماده‌ای نداریم. به‌طور کلی انحراف از پیش‌بینی اول ارز، بعد انتظارات نرخ بهره و بعد سهام را تکان می‌دهد.")}</p>
      )}
      {fomc && p.rates && (
        <>
          <h3>{T("Rate-path hint", "اشاره به مسیر نرخ بهره")}</h3>
          <p className="rp-hint">{fa ? rateFa(p.rates) : p.rates.hintText}</p>
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
      <p className="rp-foot">{T("Source: ", "منبع: ")}{e.source}. {T("Typical reactions are general rules of thumb, not forecasts and not trading advice.", "واکنش‌های معمول فقط قاعده‌های کلی‌اند؛ نه پیش‌بینی و نه توصیه معاملاتی.")}</p>
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
  if (!ev) return <Modal title="…" onClose={close}>{h ? "Event not found in the latest data. / رویداد در داده‌های اخیر پیدا نشد." : "Loading… / در حال بارگذاری…"}</Modal>;
  return <MacroReport ev={ev} rates={h?.rates} onClose={close} />;
}
