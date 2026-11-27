/* Rehuman tab — tools A–E from the "Sepehr Irandoust" framework skill: cycle analyzer, rebalance tracker, freedom/compound calculator, recession alert, Q&A.
   Educational only. No prices are hard-coded: data comes from Yahoo/FRED or from the user. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { YF_WRAP } from "./exchanges";
import { setLang, useLang } from "./lang";
import { daily } from "./analysislib";
import { Asset, DISCLAIMER, PRESETS, SECTORS, STAGES, STAGE_SECTORS, Zone, deflate, detectStage, doublingYears, freedomNumber, fv, growthSeries, parseFredCsv, rebalance, valAgo, yearsToReach, zoneOf, dirOf } from "./rehumanlib";
import type { Dir } from "./rehumanlib";
import { KB_LIST, ask } from "./rehumankb";

type Sec = "A" | "B" | "C" | "D" | "E";
const jget = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const jset = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
function usePersist<T>(k: string, d: T): [T, (v: T) => void] {
  const [v, s] = useState<T>(() => jget(k, d));
  return [v, (x: T) => { s(x); jset(k, x); }];
}
const arrow = (d: Dir) => (d === "up" ? "↑" : d === "down" ? "↓" : "→");
const tone = (d: Dir) => (d === "up" ? "up" : d === "down" ? "dn" : "");
const today = () => new Date().toISOString().slice(0, 10);
const Badge = ({ doc, T }: { doc: boolean; T: (a: string, b: string) => string }) => <span className={"rh-b " + (doc ? "doc" : "asm")}>{doc ? T("from source", "از سند") : T("tool assumption", "فرض ابزار")}</span>;

export function RehumanTab() {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const [dig, setDig] = usePersist<"fa" | "en">("arcus.rh.dig", "en");
  const N = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(dig === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const [sec, setSec] = usePersist<Sec>("arcus.rh.sec", "A");
  const [q, setQ] = useState("");
  const tabs: [Sec, string, string][] = [["A", "🔄 Cycle", "🔄 چرخه اقتصادی"], ["B", "⚖ Rebalance", "⚖ ریبالانس"], ["C", "🏁 Freedom", "🏁 آزادی مالی"], ["D", "🚨 Recession alert", "🚨 هشدار رکود"], ["E", "💬 Q&A", "💬 پرسش‌وپاسخ"]];
  const goAsk = (s: string) => { setQ(s); setSec("E"); };
  return (
    <div className="ax rh" dir={fa ? "rtl" : "ltr"}>
      <div className="sg-bar">
        <b className="sg-t">🧭 Rehuman</b>
        <span className="sg-sp" />
        <button type="button" className="sg-lang" title={T("Digits", "ارقام")} onClick={() => setDig(dig === "fa" ? "en" : "fa")}>{dig === "fa" ? "۱۲۳" : "123"}</button>
        <button type="button" className="sg-lang" onClick={() => setLang(fa ? "en" : "fa")}>{fa ? "EN" : "فا"}</button>
      </div>
      <p className="sx-hint">{T("Framework-based tools (cycle, allocation, freedom line, recession gauge) from the Human Renaissance video notes. Rules and frameworks last; prices don't — every price here comes from live data or your input.", "ابزارهای چارچوب‌محور (چرخه، تخصیص دارایی، خط آزادی مالی، شاخص رکود) بر پایه‌ی یادداشت ویدیوهای انسان رنسانس. قواعد و چارچوب‌ها ماندگارند، قیمت‌ها نه — هر قیمتی اینجا از داده‌ی زنده یا ورودی خودت می‌آید.")}</p>
      <div className="sg-tabs ax-tabs" role="tablist">{tabs.map(([id, en, f]) => <button key={id} type="button" role="tab" aria-selected={sec === id} className={sec === id ? "on" : ""} onClick={() => setSec(id)}>{fa ? f : en}</button>)}</div>
      {sec === "A" && <ToolA T={T} N={N} goAsk={goAsk} />}
      {sec === "B" && <ToolB T={T} N={N} />}
      {sec === "C" && <ToolC T={T} N={N} />}
      {sec === "D" && <ToolD T={T} N={N} />}
      {sec === "E" && <ToolE T={T} q={q} setQ={setQ} setSec={setSec} />}
      <p className="ax-disc">⚠ {fa ? DISCLAIMER.fa : DISCLAIMER.en}</p>
    </div>
  );
}
type TT = (a: string, b: string) => string;
type NN = (v: number | null | undefined, d?: number) => string;

/* ---------- A. cycle ---------- */
const IDX_DEF = { bonds: "TLT", stocks: "SPY", comm: "DBC" };
function Arc({ stage }: { stage: number | null }) {
  const W = 560, H = 150, xs = (i: number) => 40 + i * ((W - 80) / 5), ys = (i: number) => 75 - Math.sin((i / 5) * Math.PI * 2 - Math.PI / 2) * -0; // placeholder
  // boom arc: stage 3 on top, stage 6 at the bottom
  const y = (n: number) => [95, 55, 30, 45, 100, 125][n - 1];
  const path = STAGES.map((s, i) => `${i ? "L" : "M"}${xs(i)},${y(s.n)}`).join(" ");
  void ys;
  return (
    <svg className="ax-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="cycle">
      <line x1="10" x2={W - 10} y1="78" y2="78" stroke="rgba(255,255,255,.18)" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke="#4aa3ff" strokeWidth="2.5" strokeLinejoin="round" />
      {STAGES.map((s, i) => (
        <g key={s.n}>
          <circle cx={xs(i)} cy={y(s.n)} r={stage === s.n ? 11 : 6} fill={stage === s.n ? "#ffb877" : "#1c3048"} stroke="#4aa3ff" />
          <text x={xs(i)} y={y(s.n) + 4} fontSize="11" textAnchor="middle" fill={stage === s.n ? "#0a1a2e" : "#cfe2f7"} fontWeight="700">{s.n}</text>
        </g>
      ))}
    </svg>
  );
}
function ToolA({ T, N, goAsk }: { T: TT; N: NN; goAsk: (s: string) => void }) {
  const fa = T("a", "b") === "b";
  const [months, setMonths] = usePersist("arcus.rh.a.m", 3);
  const [thr, setThr] = usePersist("arcus.rh.a.thr", 0.5);
  const [idx, setIdx] = usePersist("arcus.rh.a.idx", IDX_DEF);
  const [manual, setManual] = usePersist<{ on: boolean; bonds: string; stocks: string; comm: string }>("arcus.rh.a.man", { on: false, bonds: "", stocks: "", comm: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<any>(null);
  const [hist, setHist] = usePersist<{ d: string; stage: number | null; m: number }[]>("arcus.rh.a.hist", []);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const bars = months * 21;
      let chg: { bonds: number; stocks: number; comm: number }, secRows: any[] = [], fails: string[] = [];
      if (manual.on) {
        chg = { bonds: Number(manual.bonds), stocks: Number(manual.stocks), comm: Number(manual.comm) };
        if (![chg.bonds, chg.stocks, chg.comm].every(Number.isFinite)) throw new Error(T("Enter the three % changes.", "سه تغییر درصدی را وارد کن."));
      } else {
        const pct = async (s: string) => {
          const b = (await daily(s, "2y")).bars;
          if (b.length <= bars) throw new Error("short");
          return (b[b.length - 1].c / b[b.length - 1 - bars].c - 1) * 100;
        };
        const g = async (s: string) => { try { return await pct(s); } catch { fails.push(s); return NaN; } };
        const [bo, st, co] = await Promise.all([g(idx.bonds), g(idx.stocks), g(idx.comm)]);
        if (![bo, st, co].every(Number.isFinite)) throw new Error(T(`No data for ${fails.join(", ")} (Yahoo may be unreachable from this network). Use manual entry below.`, `داده‌ای برای ${fails.join("، ")} نیامد (Yahoo شاید از این شبکه در دسترس نیست). ورود دستی را استفاده کن.`));
        chg = { bonds: bo, stocks: st, comm: co };
        secRows = await Promise.all(SECTORS.map(async (x) => {
          try {
            const b = (await daily(x.etf, "2y")).bars, f = (n: number) => (b.length > n ? (b[b.length - 1].c / b[b.length - 1 - n].c - 1) * 100 : NaN);
            return { ...x, m1: f(21), m3: f(63), m6: f(126) };
          } catch {
            return { ...x, m1: NaN, m3: NaN, m6: NaN };
          }
        }));
      }
      const st = detectStage(chg, thr);
      setRes({ chg, st, secRows, at: Date.now() });
      const rec = { d: today(), stage: st.stage, m: months };
      setHist([...hist.filter((h) => h.d !== rec.d), rec].slice(-120));
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  };
  const st = res?.st, S = st?.stage ? STAGES[st.stage - 1] : null;
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Three indicators on a monthly-scale window (not daily): commodities, the whole stock market, long bonds (TLT — inverse to the 10-year yield). Their directions point to one of 6 stages. Stages 3, 5, 6 are stated in the source; 1, 2, 4 are from its chart + the classic cycle model (lower confidence). The market runs ~6 months ahead of the real economy.", "سه شاخص روی بازه‌ی ماهانه (نه روزانه): کالاها، کل بازار سهام، اوراق بلندمدت (TLT — وارونه‌ی نرخ ۱۰ ساله). جهت‌هایشان یکی از ۶ مرحله را نشان می‌دهد. مراحل ۳، ۵، ۶ صریحاً در سند است؛ ۱، ۲، ۴ از نمودار سند + مدل کلاسیک چرخه (اطمینان کمتر). بازار حدود ۶ ماه جلوتر از اقتصاد واقعی است.")}</p>
      <div className="ax-row">
        <label>{T("Window (months)", "بازه (ماه)")}<select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[1, 2, 3].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label>{T("Noise band ±%", "نویز ±٪")} <Badge doc={false} T={T} /><input type="number" step="0.1" min="0" value={thr} onChange={(e) => setThr(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80 }} /></label>
        <label>{T("Bonds", "اوراق")}<input className="ax-in" value={idx.bonds} onChange={(e) => setIdx({ ...idx, bonds: e.target.value.toUpperCase() })} style={{ width: 80 }} /></label>
        <label>{T("Stocks", "سهام")}<input className="ax-in" value={idx.stocks} onChange={(e) => setIdx({ ...idx, stocks: e.target.value.toUpperCase() })} style={{ width: 80 }} /></label>
        <label>{T("Commodities", "کالا")}<input className="ax-in" value={idx.comm} onChange={(e) => setIdx({ ...idx, comm: e.target.value.toUpperCase() })} style={{ width: 80 }} /></label>
        <button type="button" className="sg-go" disabled={busy} onClick={run}>{busy ? "…" : "▶ " + T("Analyze cycle", "تحلیل چرخه")}</button>
      </div>
      <details className="ax-det"><summary>{T("Manual entry (if data can't be fetched)", "ورود دستی (اگر داده نمی‌آید)")}</summary>
        <div className="ax-row">
          <label><input type="checkbox" checked={manual.on} onChange={(e) => setManual({ ...manual, on: e.target.checked })} /> {T("Use my numbers", "از اعداد من استفاده کن")}</label>
          {(["bonds", "stocks", "comm"] as const).map((k) => <label key={k}>{k === "bonds" ? T("Bonds %", "اوراق ٪") : k === "stocks" ? T("Stocks %", "سهام ٪") : T("Commodities %", "کالا ٪")}<input className="ax-in" type="number" step="any" value={manual[k]} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} style={{ width: 90 }} /></label>)}
        </div>
      </details>
      {err && <p className="ax-err">⚠ {err}</p>}
      {res && (
        <>
          <Arc stage={st.stage} />
          <div className="ax-cards">
            <div className="ax-card"><span>{T("Stage", "مرحله")}</span><b>{st.stage ? `${N(st.stage)} — ${fa ? S!.fa : S!.en}` : T("Unclear / transitional", "نامشخص / انتقالی")}</b>{S && <em>{S.src === "doc" ? T("stated in the source", "صریحاً در سند") : T("lower confidence (chart + classic model)", "اطمینان کمتر (نمودار + مدل کلاسیک)")}</em>}{!st.stage && <em>{T("closest: stage ", "نزدیک‌ترین: مرحله ")}{st.near.map((n: number) => N(n)).join(" / ")}</em>}</div>
          </div>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Indicator", "شاخص")}</th><th>{T("Change", "تغییر")} ({months}m)</th><th>{T("Direction", "جهت")}</th></tr></thead>
            <tbody>
              {([["bonds", T("Bonds", "اوراق"), idx.bonds], ["stocks", T("Stocks", "سهام"), idx.stocks], ["comm", T("Commodities", "کالا"), idx.comm]] as const).map(([k, nm, sy]) => (
                <tr key={k}><td>{nm} {!manual.on && <small>({sy})</small>}</td><td className={tone(st.dirs[k])}>{N(res.chg[k], 2)}%</td><td className={tone(st.dirs[k])}>{arrow(st.dirs[k])}</td></tr>
              ))}
            </tbody></table></div>
          {S && S.n === 6 && <p className="sx-miss">⚠ {T("Stage 6 vs 1: we enter a real stage 1 only when TLT actually rises — until then we are still on the way into recession.", "تفاوت مرحله ۶ و ۱: وارد مرحله ۱ واقعی وقتی می‌شویم که TLT واقعاً صعود کند — تا آن موقع هنوز در حال ورود به رکودیم.")}</p>}
          {st.stage && (
            <>
              <h4 className="ax-h">{T("Sectors the rotation points to", "بخش‌های پیشنهادی طبق چرخش")} <Badge doc={false} T={T} /></h4>
              <p className="ax-small">{STAGE_SECTORS[st.stage].map((id) => { const s = SECTORS.find((x) => x.id === id)!; return `${fa ? s.fa : s.en} (${s.etf})`; }).join(" · ")}</p>
            </>
          )}
          <p className="ax-small">⏱ {T("Reminder: the market is ~6 months ahead of the real economy; an official recession is announced ≥6 months late.", "یادآوری: بازار ~۶ ماه جلوتر از اقتصاد واقعی است؛ رکود رسمی حداقل ۶ ماه دیر اعلام می‌شود.")}</p>
          <button type="button" className="ax-ghost" onClick={() => goAsk(st.stage === 6 ? "مرحله ۶ کدوم بخش" : "چرخش بخش‌ها")}>💬 {T("Ask about this stage", "درباره‌ی این مرحله بپرس")}</button>
          {res.secRows.length > 0 && (
            <>
              <h4 className="ax-h">{T("Sector ETFs — performance", "ETFهای بخشی — عملکرد")}</h4>
              <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Sector", "بخش")}</th><th>ETF</th><th>1m</th><th>3m</th><th>6m</th><th>{T("Place in cycle (source)", "جایگاه در چرخه (سند)")}</th></tr></thead>
                <tbody>{res.secRows.slice().sort((a: any, b: any) => (Number.isFinite(b.m3) ? b.m3 : -1e9) - (Number.isFinite(a.m3) ? a.m3 : -1e9)).map((r: any) => <tr key={r.id}><td>{fa ? r.fa : r.en}</td><td>{r.etf}</td>{[r.m1, r.m3, r.m6].map((v: number, i: number) => <td key={i} className={v >= 0 ? "up" : "dn"}>{Number.isFinite(v) ? (v >= 0 ? "+" : "") + N(v, 1) + "%" : "—"}</td>)}<td>{fa ? r.phase : r.phaseEn}</td></tr>)}</tbody></table></div>
              <p className="ax-small">{T("Phase rule: the further from tech toward materials/energy, the closer to the cycle peak; strong tech = recession bottom.", "قاعده‌ی فاز: هر چه از تکنولوژی به سمت مواد/انرژی دور شوی به اوج چرخه نزدیک‌تری؛ تکنولوژی قوی = کف رکود.")}</p>
            </>
          )}
        </>
      )}
      {hist.length > 0 && (
        <>
          <h4 className="ax-h">{T("Stage history", "تاریخچه‌ی مرحله‌ها")}</h4>
          <p className="ax-small">{hist.slice(-12).map((h) => `${h.d}: ${h.stage ? N(h.stage) : "?"}`).join("  ·  ")} <button type="button" className="ax-ghost" onClick={() => setHist([])}>{T("clear", "پاک")}</button></p>
        </>
      )}
    </section>
  );
}

/* ---------- B. rebalance ---------- */
function Pie({ items, label }: { items: { v: number; c: string }[]; label: string }) {
  const tot = items.reduce((a, x) => a + Math.max(0, x.v), 0) || 1;
  let a0 = -Math.PI / 2;
  return (
    <figure className="rh-pie"><svg viewBox="-60 -60 120 120" width="120" height="120" role="img" aria-label={label}>
      {items.map((x, i) => {
        const a1 = a0 + (Math.max(0, x.v) / tot) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, p = [Math.cos(a0) * 55, Math.sin(a0) * 55, Math.cos(a1) * 55, Math.sin(a1) * 55];
        const d = items.length === 1 || a1 - a0 >= Math.PI * 2 - 1e-6 ? "M0,-55 A55,55 0 1 1 -0.01,-55 Z" : `M0,0 L${p[0]},${p[1]} A55,55 0 ${big} 1 ${p[2]},${p[3]} Z`;
        a0 = a1;
        return <path key={i} d={d} fill={x.c} stroke="#07121f" />;
      })}
    </svg><figcaption>{label}</figcaption></figure>
  );
}
const PAL = ["#4aa3ff", "#3ddc97", "#ffb877", "#b388ff", "#ff7a7a", "#26c6da", "#ffd54f"];
function ToolB({ T, N }: { T: TT; N: NN }) {
  const fa = T("a", "b") === "b";
  const [assets, setAssets] = usePersist<{ name: string; value: string; target: string }[]>("arcus.rh.b.a", [{ name: "Bonds", value: "45", target: "40" }, { name: "Stocks", value: "45", target: "40" }, { name: "Crypto", value: "10", target: "20" }]);
  const [thr, setThr] = usePersist("arcus.rh.b.thr", 5);
  const [cash, setCash] = usePersist("arcus.rh.b.cash", "");
  const [log, setLog] = usePersist<{ d: string; t: string }[]>("arcus.rh.b.log", []);
  const [snaps, setSnaps] = usePersist<{ d: string; v: number }[]>("arcus.rh.b.snap", []);
  const [note, setNote] = useState("");
  const as: Asset[] = assets.map((a) => ({ name: a.name || "?", value: Number(a.value) || 0, target: Number(a.target) || 0 }));
  const r = useMemo(() => rebalance(as, thr, Number(cash) || 0), [JSON.stringify(as), thr, cash]);
  const upd = (i: number, k: "name" | "value" | "target", v: string) => setAssets(assets.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const c = Number(cash) || 0;
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Rule: when any asset drifts more than the threshold (default 5 points) from its target, sell what rose and buy what fell — you sell high and buy low without forecasting. New money first buys the laggards. Review monthly (1–2 h). Golden rule: wait for the price to come to you.", "قاعده: هر وقت سهم یک دارایی بیش از آستانه (پیش‌فرض ۵ واحد درصد) از هدف منحرف شد، از بالا‌رفته بفروش و افتاده را بخر — بدون پیش‌بینی، بالا می‌فروشی و پایین می‌خری. پول تازه اول دارایی‌های عقب‌افتاده را می‌خرد. بازبینی ماهانه (۱–۲ ساعت). قاعده‌ی طلایی: صبر کن قیمت بیاید سمت تو.")}</p>
      <div className="sg-chips">{PRESETS.map((p) => <button key={p.id} type="button" onClick={() => setAssets(p.items.map(([n, , t]) => ({ name: n, value: "", target: String(t) })))}>{fa ? p.fa : p.en}</button>)}</div>
      <p className="ax-small">{T("Sample portfolios from the source (examples, not advice) — enter your current values.", "نمونه سبدهای سند (مثال، نه توصیه) — ارزش فعلی‌ات را وارد کن.")}</p>
      <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Asset", "دارایی")}</th><th>{T("Current value", "ارزش فعلی")}</th><th>{T("Target %", "هدف ٪")}</th><th /></tr></thead>
        <tbody>{assets.map((a, i) => <tr key={i}><td><input className="ax-in" value={a.name} onChange={(e) => upd(i, "name", e.target.value)} /></td><td><input className="ax-in" type="number" value={a.value} onChange={(e) => upd(i, "value", e.target.value)} style={{ width: 110 }} /></td><td><input className="ax-in" type="number" value={a.target} onChange={(e) => upd(i, "target", e.target.value)} style={{ width: 80 }} /></td><td><button type="button" className="ax-ghost" aria-label="remove" onClick={() => setAssets(assets.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table></div>
      <div className="ax-row">
        <button type="button" className="ax-ghost" onClick={() => setAssets([...assets, { name: "", value: "", target: "" }])}>＋ {T("Add asset", "افزودن دارایی")}</button>
        <label>{T("Threshold (points)", "آستانه (واحد)")} <Badge doc={true} T={T} /><input type="number" min="0" step="0.5" value={thr} onChange={(e) => setThr(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80 }} /></label>
        <label>{T("New money to add", "پول تازه برای افزودن")}<input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} style={{ width: 120 }} /></label>
      </div>
      {Math.abs(r.targetSum - 100) > 0.01 && <p className="ax-err">⚠ {T(`Targets sum to ${N(r.targetSum, 1)}%, not 100% — shown normalised.`, `جمع هدف‌ها ${N(r.targetSum, 1)}٪ است نه ۱۰۰٪ — نرمال‌شده نمایش داده می‌شود.`)}</p>}
      <p className={r.needs ? "sx-miss" : "ax-small"}>{r.needs ? "⚠ " + T("Rebalance needed: at least one asset is beyond the threshold.", "ریبالانس لازم است: حداقل یک دارایی از آستانه گذشته.") : "✅ " + T("Within threshold — no action.", "در محدوده‌ی آستانه — اقدامی لازم نیست.")}</p>
      <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Asset", "دارایی")}</th><th>{T("Target", "هدف")}</th><th>{T("Now", "فعلی")}</th><th>{T("Deviation", "انحراف")}</th><th>{T("Status", "وضعیت")}</th><th>{T("Action to reach target", "اقدام برای رسیدن به هدف")}</th>{c > 0 && <th>{T("Buy-only with new money", "فقط خرید با پول تازه")}</th>}</tr></thead>
        <tbody>{r.rows.map((x, i) => <tr key={i}><td>{x.name}</td><td>{N(x.target, 1)}%</td><td>{N(x.now, 1)}%</td><td className={x.dev >= 0 ? "up" : "dn"}>{x.dev >= 0 ? "+" : ""}{N(x.dev, 1)}</td><td>{x.flag ? "⚠" : "✓"}</td><td className={x.delta >= 0 ? "up" : "dn"}>{Math.abs(x.delta) < 0.005 ? "—" : (x.delta > 0 ? T("BUY ", "بخر ") : T("SELL ", "بفروش ")) + N(Math.abs(x.delta), 2)}</td>{c > 0 && <td>{x.buyOnly > 0 ? N(x.buyOnly, 2) : "—"}</td>}</tr>)}</tbody></table></div>
      {c > 0 && <p className="ax-small">{T("Buy-only mode spends the new money on the underweight assets proportionally to their shortfall; leftover: ", "حالت فقط‌خرید پول تازه را به نسبت کمبود روی دارایی‌های عقب‌افتاده خرج می‌کند؛ باقی‌مانده: ")}{N(r.cashLeft, 2)}</p>}
      <div className="rh-pies"><Pie label={T("Target", "هدف")} items={r.rows.map((x, i) => ({ v: x.target, c: PAL[i % PAL.length] }))} /><Pie label={T("Current", "فعلی")} items={r.rows.map((x, i) => ({ v: x.value, c: PAL[i % PAL.length] }))} />
        <ul className="ax-ul">{r.rows.map((x, i) => <li key={i}><i className="rh-dot" style={{ background: PAL[i % PAL.length] }} /> {x.name}</li>)}</ul></div>
      <h4 className="ax-h">{T("Log & history", "لاگ و تاریخچه")}</h4>
      <div className="ax-row">
        <button type="button" className="ax-ghost" disabled={!r.total} onClick={() => setSnaps([...snaps.filter((s) => s.d !== today()), { d: today(), v: r.total }].slice(-120))}>📸 {T("Save value snapshot", "ثبت ارزش پورتفو")}</button>
        <input className="ax-in wide" placeholder={T("Note: e.g. sold 5 bonds, bought crypto", "یادداشت: مثلاً ۵ اوراق فروختم، کریپتو خریدم")} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="ax-ghost" disabled={!note.trim()} onClick={() => { setLog([{ d: today(), t: note.trim() }, ...log].slice(0, 100)); setNote(""); }}>{T("Add to log", "افزودن به لاگ")}</button>
      </div>
      {snaps.length > 0 && <p className="ax-small">{snaps.slice(-8).map((s) => `${s.d}: ${N(s.v, 0)}`).join("  ·  ")}</p>}
      {log.length > 0 && <ul className="ax-ul">{log.slice(0, 8).map((l, i) => <li key={i}>{l.d} — {l.t}</li>)}</ul>}
    </section>
  );
}

/* ---------- C. freedom / compound ---------- */
function ToolC({ T, N }: { T: TT; N: NN }) {
  const [f, setF] = usePersist("arcus.rh.c", { age: "30", target: "60", spend: "30000", tax: "20", ret: "10", save: "500", cap: "0", inf: "", income: "" });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const age = Number(f.age), tgt = Number(f.target), n = Math.max(0, tgt - age), spend = Number(f.spend), tax = Number(f.tax), ret = Number(f.ret), save = Number(f.save), cap = Number(f.cap) || 0, inf = Number(f.inf), income = Number(f.income);
  const valid = n > 0 && spend > 0 && ret > 0 && tax >= 0 && tax < 100 && save >= 0;
  const num = valid ? freedomNumber(spend, tax, ret) : NaN;
  const scen = [ret - 2, ret, ret + 2].filter((x) => x > 0);
  const series = valid ? scen.map((s) => growthSeries(cap, save, s / 100, n)) : [];
  const yrs = valid ? scen.map((s) => yearsToReach(num, cap, save, s / 100)) : [];
  const W = 560, H = 190, ymax = Math.max(num * 1.1, ...series.map((s) => s[s.length - 1] || 0), 1);
  const X = (i: number) => 40 + (i / Math.max(1, n)) * (W - 50), Y = (v: number) => H - 20 - (v / ymax) * (H - 40);
  const cols = ["#ffb877", "#4aa3ff", "#3ddc97"];
  const delays = valid ? [0, 5, 10].filter((d) => d < n).map((d) => ({ d, v: fv(cap, save, ret / 100, n - d) })) : [];
  const pcts = valid && income > 0 ? [10, 15, 20].map((p) => ({ p, pmt: (income * p) / 100, v: fv(cap, (income * p) / 100, ret / 100, n) })) : [];
  const L = (k: keyof typeof f, en: string, fa: string, ph = "") => <label className="ax-fl">{T(en, fa)}<input type="number" step="any" placeholder={ph} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>;
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Freedom line = yearly spending (grossed up for tax) ÷ expected yearly return. Compound growth monthly: FV = PMT·[((1+r/12)^(12n) − 1)/(r/12)] + P·(1+r)^n. Starting early matters more than the amount; it is never too late.", "خط آزادی مالی = هزینه‌ی سالانه (با مالیات) ÷ بازده سالانه‌ی مورد انتظار. رشد مرکب ماهانه: FV = PMT·[((1+r/12)^(12n) − 1)/(r/12)] + P·(1+r)^n. شروع زود مهم‌تر از مبلغ است؛ هیچ‌وقت دیر نیست.")}</p>
      <div className="ax-fg">
        {L("age", "Your age", "سن فعلی")}{L("target", "Target age", "سن هدف")}{L("spend", "Yearly spending (after tax)", "هزینه‌ی سالانه (بعد از مالیات)")}{L("tax", "Tax %", "مالیات ٪")}{L("ret", "Expected return % (source default 10)", "بازده مورد انتظار ٪ (پیش‌فرض سند ۱۰)")}{L("save", "Monthly saving", "پس‌انداز ماهانه")}{L("cap", "Current capital", "سرمایه‌ی فعلی")}{L("inf", "Inflation % (optional)", "تورم ٪ (اختیاری)")}{L("income", "Monthly income (optional)", "درآمد ماهانه (اختیاری)")}
      </div>
      {!valid && <p className="ax-err">⚠ {T("Check the inputs: target age > age, spending > 0, return > 0.", "ورودی‌ها را بررسی کن: سن هدف > سن، هزینه > ۰، بازده > ۰.")}</p>}
      {valid && (
        <>
          <div className="ax-cards">
            <div className="ax-card"><span>{T("Freedom number", "عدد خط آزادی")}</span><b>{N(num)}</b><em>{T("gross spend", "هزینه‌ی ناخالص")} {N(spend / (1 - tax / 100))}</em></div>
            <div className="ax-card"><span>{T("Capital at target age", "سرمایه در سن هدف")} ({ret}%)</span><b className={series[1][n] >= num ? "up" : "dn"}>{N(series[1][n])}</b>{inf > 0 && <em>{T("real", "واقعی")} {N(deflate(series[1][n], inf, n))}</em>}</div>
            <div className="ax-card"><span>{T("Reach the line in", "رسیدن به خط در")}</span><b>{yrs[1] == null ? T("> 100 y", "> ۱۰۰ سال") : yrs[1] === 0 ? T("already", "هم‌اکنون") : N(yrs[1]!, 1) + " " + T("years", "سال")}</b>{yrs[1] != null && yrs[1] > 0 && <em>{T("age", "سن")} {N(age + yrs[1]!, 0)}</em>}</div>
            <div className="ax-card"><span>{T("Doubling time (rule of 72)", "زمان دو برابر شدن (قاعده ۷۲)")}</span><b>{N(doublingYears(ret), 1)} {T("y", "سال")}</b></div>
          </div>
          <svg className="ax-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="growth">
            <line x1="40" x2={W - 10} y1={Y(num)} y2={Y(num)} stroke="#ff7a7a" strokeDasharray="5 4" />
            <text x="44" y={Y(num) - 4} fontSize="10" fill="#ff9a9a">{T("freedom line", "خط آزادی")}</text>
            {series.map((s, k) => <polyline key={k} fill="none" stroke={cols[k + (scen.length === 3 ? 0 : 1)]} strokeWidth="2" points={s.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />)}
            {scen.map((s, k) => <text key={k} x={W - 70} y={16 + k * 13} fontSize="11" fill={cols[k + (scen.length === 3 ? 0 : 1)]}>{s}%</text>)}
            <text x="40" y={H - 4} fontSize="10" fill="#8aa0bb">{age}</text><text x={W - 24} y={H - 4} fontSize="10" fill="#8aa0bb">{tgt}</text>
          </svg>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Scenario return", "بازده سناریو")}</th><th>{T("Capital at target age", "سرمایه در سن هدف")}</th><th>{T("Reaches the line", "به خط می‌رسد")}</th></tr></thead>
            <tbody>{scen.map((s, k) => <tr key={s}><td>{s}%</td><td>{N(series[k][n])}</td><td>{yrs[k] == null ? "—" : N(yrs[k]!, 1) + " " + T("y", "سال")}</td></tr>)}</tbody></table></div>
          <h4 className="ax-h">{T("Start now vs later (same monthly saving)", "شروع الان در برابر بعداً (همان پس‌انداز ماهانه)")}</h4>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Delay", "تأخیر")}</th><th>{T("Capital at target age", "سرمایه در سن هدف")}</th><th>{T("vs now", "نسبت به الان")}</th></tr></thead>
            <tbody>{delays.map((x) => <tr key={x.d}><td>{x.d ? `+${N(x.d)} ${T("y", "سال")}` : T("now", "الان")}</td><td>{N(x.v)}</td><td>{x.d ? N((x.v / delays[0].v) * 100, 0) + "%" : "100%"}</td></tr>)}</tbody></table></div>
          {pcts.length > 0 && (
            <>
              <h4 className="ax-h">{T("If you invest 10% / 15% / 20% of income", "اگر ۱۰٪ / ۱۵٪ / ۲۰٪ درآمد را بگذاری")}</h4>
              <div className="ax-scroll"><table className="ax-t"><thead><tr><th>%</th><th>{T("Monthly", "ماهانه")}</th><th>{T("Capital at target age", "سرمایه در سن هدف")}</th></tr></thead><tbody>{pcts.map((x) => <tr key={x.p}><td>{x.p}%</td><td>{N(x.pmt)}</td><td>{N(x.v)}</td></tr>)}</tbody></table></div>
            </>
          )}
          <p className="ax-small">{T("Source example (rough): $200/month at 10% from 18 to 60 ≈ over $1M; $400/month ≈ over $2M. Scenarios use your return ±2 points (tool assumption).", "مثال سند (تقریبی): ماهی ۲۰۰ دلار با ۱۰٪ از ۱۸ تا ۶۰ سالگی ≈ بیش از ۱ میلیون؛ ماهی ۴۰۰ ≈ بیش از ۲ میلیون. سناریوها بازده تو ±۲ واحد هستند (فرض ابزار).")}</p>
        </>
      )}
    </section>
  );
}

/* ---------- D. recession alert ---------- */
async function fredCsv(id: string): Promise<{ d: string; v: number }[]> {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id + "&cosd=" + new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  let last: any = new Error("FRED unreachable");
  for (const w of YF_WRAP) {
    const ctl = new AbortController(), t = window.setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(w(url), { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const s = parseFredCsv(await r.text());
      if (s.length > 30) return s;
      throw new Error("empty");
    } catch (e) {
      last = e;
    } finally {
      window.clearTimeout(t);
    }
  }
  throw last;
}
function Spark({ s }: { s: { d: string; v: number }[] }) {
  if (s.length < 2) return null;
  const W = 560, H = 120, lo = Math.min(0, ...s.map((x) => x.v)), hi = Math.max(0.01, ...s.map((x) => x.v)), X = (i: number) => 6 + (i / (s.length - 1)) * (W - 12), Y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  return <svg className="ax-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="spread"><line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#ff7a7a" strokeDasharray="4 4" /><polyline fill="none" stroke="#4aa3ff" strokeWidth="1.8" points={s.map((x, i) => `${X(i)},${Y(x.v)}`).join(" ")} /></svg>;
}
function ToolD({ T, N }: { T: TT; N: NN }) {
  const [green, setGreen] = usePersist("arcus.rh.d.green", 0.5);
  const [jump, setJump] = usePersist("arcus.rh.d.jump", 1.0);
  const [man, setMan] = usePersist<{ d: string; y10: number; y2: number }[]>("arcus.rh.d.man", []);
  const [in10, setIn10] = useState(""), [in2, setIn2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<{ spread: { d: string; v: number }[]; y10: { d: string; v: number }[]; src: string } | null>(null);
  const [banner, setBanner] = useState("");
  const load = async () => {
    setBusy(true);
    setErr("");
    try {
      const sp = await fredCsv("T10Y2Y");
      let y10: { d: string; v: number }[] = [];
      try { y10 = await fredCsv("DGS10"); } catch {}
      setData({ spread: sp, y10, src: "FRED T10Y2Y / DGS10" });
    } catch {
      if (man.length > 1) setData({ spread: man.map((m) => ({ d: m.d, v: m.y10 - m.y2 })), y10: man.map((m) => ({ d: m.d, v: m.y10 })), src: T("your manual entries", "ورودی‌های دستی تو") });
      setErr(T("FRED couldn't be reached from this network — enter the two yields by hand below (they're saved).", "FRED از این شبکه در دسترس نیست — دو نرخ را پایین دستی وارد کن (ذخیره می‌شوند)."));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const addMan = () => {
    const a = Number(in10), b = Number(in2);
    if (!Number.isFinite(a) || !Number.isFinite(b) || in10 === "" || in2 === "") return;
    const m = [...man.filter((x) => x.d !== today()), { d: today(), y10: a, y2: b }].slice(-500);
    setMan(m);
    setIn10(""); setIn2("");
    setData({ spread: m.map((x) => ({ d: x.d, v: x.y10 - x.y2 })), y10: m.map((x) => ({ d: x.d, v: x.y10 })), src: T("your manual entries", "ورودی‌های دستی تو") });
    setErr("");
  };
  const s = data?.spread || [], cur = s.length ? s[s.length - 1] : null, z: Zone | null = cur ? zoneOf(cur.v, green) : null;
  const a3 = valAgo(s, 91), a6 = valAgo(s, 182), y = data?.y10 || [], y3 = valAgo(y, 91), yc = y.length ? y[y.length - 1] : null;
  const speed = yc && y3 ? yc.v - y3.v : null;
  useEffect(() => {
    if (!z) return;
    const prev = jget<Zone | null>("arcus.rh.d.zone", null);
    if (prev && prev !== "red" && z === "red") {
      const m = T("🚨 The 10y−2y spread crossed below zero (inverted curve) since your last visit.", "🚨 اختلاف نرخ ۱۰ ساله منهای ۲ ساله از آخرین بازدیدت زیر صفر رفت (منحنی وارونه).");
      setBanner(m);
      try { if ("Notification" in window && Notification.permission === "granted") new Notification("Rehuman", { body: m }); } catch {}
    } else if (prev === "red" && z !== "red") setBanner(T("ℹ The spread moved back above zero.", "ℹ اختلاف نرخ‌ها دوباره بالای صفر آمد."));
    jset("arcus.rh.d.zone", z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [z]);
  const stage = jget<{ d: string; stage: number | null }[]>("arcus.rh.a.hist", []).slice(-1)[0];
  const zc = z === "red" ? "dn" : z === "green" ? "up" : "";
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Gauge: 10-year minus 2-year Treasury yield; horizon 6–18 months. Below zero = inverted curve = recession signal (every historical inversion was followed by a recession). On day one the market usually drops ~5%, but until the real start of the recession it usually rises 10–20%.", "شاخص: نرخ ۱۰ ساله منهای ۲ ساله‌ی خزانه؛ افق ۶ تا ۱۸ ماه. زیر صفر = منحنی وارونه = سیگنال رکود (هر بار تاریخی زیر صفر رفته، رکود آمده). روز اول معمولاً ~۵٪ افت می‌کند ولی تا شروع واقعی رکود معمولاً ۱۰–۲۰٪ بالا می‌رود.")}</p>
      {banner && <p className="sx-miss">{banner}</p>}
      <div className="ax-row">
        <button type="button" className="sg-go" disabled={busy} onClick={load}>{busy ? "…" : "🔄 " + T("Refresh from FRED", "به‌روزرسانی از FRED")}</button>
        <label>{T("Green above", "سبز بالای")} <Badge doc={false} T={T} /><input type="number" step="0.1" value={green} onChange={(e) => setGreen(Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
        <label>{T("10y jump flag (pts / 3m)", "هشدار جهش ۱۰ ساله (واحد / ۳ماه)")} <Badge doc={false} T={T} /><input type="number" step="0.1" value={jump} onChange={(e) => setJump(Number(e.target.value) || 0)} style={{ width: 70 }} /></label>
        <button type="button" className="ax-ghost" onClick={() => { try { Notification.requestPermission(); } catch {} }}>🔔 {T("Allow notifications", "اجازه‌ی اعلان")}</button>
      </div>
      <p className="ax-err">{err}</p>
      {cur && (
        <>
          <div className="ax-cards">
            <div className="ax-card"><span>{T("10y − 2y now", "۱۰ منهای ۲ ساله الان")} ({cur.d})</span><b className={zc}>{N(cur.v, 2)}</b><em className={zc}>{z === "red" ? T("RED — inverted", "قرمز — وارونه") : z === "yellow" ? T("YELLOW — thin", "زرد — کم") : T("GREEN", "سبز")}</em></div>
            <div className="ax-card"><span>{T("3m / 6m ago", "۳ / ۶ ماه پیش")}</span><b>{N(a3?.v, 2)} / {N(a6?.v, 2)}</b><em>{a3 ? (cur.v - a3.v >= 0 ? T("rising", "در حال صعود") : T("falling", "در حال نزول")) : ""}</em></div>
            <div className="ax-card"><span>{T("10y yield / 3m change", "نرخ ۱۰ ساله / تغییر ۳ماهه")}</span><b>{N(yc?.v, 2)} / {speed == null ? "—" : (speed >= 0 ? "+" : "") + N(speed, 2)}</b><em className={speed != null && speed >= jump ? "dn" : ""}>{speed != null && speed >= jump ? T("⚠ unusual jump — a warning line", "⚠ جهش غیرعادی — خط اخطار") : yc && yc.v >= 5 ? T("≥5%: pressure zone for firms", "≥۵٪: ناحیه‌ی فشار برای شرکت‌ها") : yc && yc.v >= 4 ? T("~4%: firms' tolerance limit", "~۴٪: حد تحمل شرکت‌ها") : ""}</em></div>
            <div className="ax-card"><span>{T("Cycle stage (tool A)", "مرحله‌ی چرخه (ابزار A)")}</span><b>{stage ? (stage.stage ? N(stage.stage) : "?") : "—"}</b><em>{stage?.d || T("run tool A", "ابزار A را اجرا کن")}</em></div>
          </div>
          <Spark s={s.slice(-600)} />
          <p className="ax-small">{T("Source", "منبع")}: {data?.src} · {T("zones are tool conventions (green > threshold, yellow 0–threshold, red < 0), not source rules.", "منطقه‌ها قرارداد ابزارند (سبز > آستانه، زرد ۰ تا آستانه، قرمز < ۰)، نه قاعده‌ی سند.")}</p>
        </>
      )}
      <h4 className="ax-h">{T("Manual entry (fallback)", "ورود دستی (جایگزین)")}</h4>
      <div className="ax-row">
        <label>10y %<input className="ax-in" type="number" step="0.01" value={in10} onChange={(e) => setIn10(e.target.value)} style={{ width: 90 }} /></label>
        <label>2y %<input className="ax-in" type="number" step="0.01" value={in2} onChange={(e) => setIn2(e.target.value)} style={{ width: 90 }} /></label>
        <button type="button" className="ax-ghost" onClick={addMan}>＋ {T("Save today", "ثبت امروز")}</button>
        {man.length > 0 && <span className="ax-small">{man.length} {T("saved", "ثبت‌شده")}</span>}
      </div>
      <p className="ax-small">{T("Alerts and notifications fire only while the app is open.", "هشدار و اعلان فقط وقتی برنامه باز است کار می‌کند.")}</p>
    </section>
  );
}

/* ---------- E. Q&A ---------- */
function ToolE({ T, q, setQ, setSec }: { T: TT; q: string; setQ: (s: string) => void; setSec: (s: Sec) => void }) {
  const fa = T("a", "b") === "b";
  const [asked, setAsked] = useState("");
  const [msgs, setMsgs] = useState<{ q: string; hits: typeof KB_LIST; live: boolean }[]>([]);
  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const r = ask(t);
    setMsgs((m) => [{ q: t, hits: r.hits, live: r.live }, ...m].slice(0, 12));
    setQ("");
    setAsked(t);
  };
  const lastQ = useRef("");
  useEffect(() => {
    if (q && q !== lastQ.current) {
      lastQ.current = q;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const ex = [["در مرحله ۶ چه بخش‌هایی؟", "Which sectors in stage 6?"], ["کریپتو ۵۰٪ افتاد چه کنم؟", "Crypto fell 50%, what now?"], ["برای سرمایه‌گذاری بلندمدت چی بخرم؟", "What should I buy for the long term?"], ["شاخص رکود چیه؟", "What is the recession gauge?"], ["خط آزادی مالی یعنی چی؟", "What is the freedom line?"], ["پس‌انداز در تورم ایران", "Saving under inflation in Iran"]];
  const link: Record<string, Sec> = { A: "A", B: "B", C: "C", D: "D" };
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Answers come from the framework notes (a local rule-based Q&A, not an AI model). Each answer separates the framework from the speaker's view, never quotes a live price, and 'buy or not?' questions are answered with portfolio, target weights and risk tolerance — not signals.", "پاسخ‌ها از یادداشت‌های چارچوب می‌آیند (پرسش‌وپاسخ محلی قاعده‌محور، نه مدل هوش مصنوعی). هر پاسخ چارچوب را از نظر گوینده جدا می‌کند، هرگز قیمت زنده نمی‌گوید و سؤال «بخرم یا نه؟» با سبد، درصد هدف و ریسک‌پذیری جواب داده می‌شود — نه سیگنال.")}</p>
      <div className="ax-row">
        <input className="ax-in wide" placeholder={T("Ask about the cycle, rebalancing, recession gauge, mindset, inflation…", "درباره‌ی چرخه، ریبالانس، شاخص رکود، ذهنیت، تورم… بپرس")} id="rh-q" onKeyDown={(e) => { if (e.key === "Enter") { send((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ""; } }} />
        <button type="button" className="sg-go" onClick={() => { const el = document.getElementById("rh-q") as HTMLInputElement; send(el.value); el.value = ""; }}>{T("Ask", "بپرس")}</button>
      </div>
      <div className="sg-chips">{ex.map(([f, e]) => <button key={e} type="button" onClick={() => send(fa ? f : e)}>{fa ? f : e}</button>)}</div>
      {msgs.map((m, i) => (
        <div key={i} className="ax-pro">
          <p><b>❓ {m.q}</b></p>
          {m.live && <p className="sx-miss">{T("I don't quote live prices from notes — use the tools (they read live data) for any number.", "از روی یادداشت‌ها قیمت زنده نمی‌گویم — برای هر عدد از ابزارها (که داده‌ی زنده می‌خوانند) استفاده کن.")}</p>}
          {m.hits.length === 0 ? (
            <><p>{T("No matching topic in the notes. Topics I can answer:", "موضوع مطابقی در یادداشت‌ها نبود. موضوع‌هایی که می‌توانم جواب بدهم:")}</p><p className="ax-small">{T("economic cycle & stages, sector rotation, recession gauge (10y−2y), interest rates, rebalancing, DCA, 40/40/20 portfolio, historical returns, freedom number, compound growth, mindset, inflation & Iran, crypto, AI bubble, Musk lessons, scams, debt", "چرخه و مراحل، چرخش بخش‌ها، شاخص رکود (۱۰−۲)، نرخ بهره، ریبالانس، DCA، سبد ۴۰/۴۰/۲۰، بازده تاریخی، خط آزادی، سود مرکب، ذهنیت، تورم و ایران، کریپتو، حباب AI، درس‌های ماسک، کلاهبرداری، قرض")}</p></>
          ) : (
            m.hits.map((h) => (
              <div key={h.id} className="rh-ans">
                <p>{fa ? h.fa : h.en}</p>
                {h.view && <p className="ax-small">🗣 {T("This part is the speaker's view, not an established fact.", "این بخش نظر گوینده است، نه حقیقت اثبات‌شده.")}</p>}
                {h.tool && <button type="button" className="ax-ghost" onClick={() => setSec(link[h.tool!])}>🔧 {T("Open tool ", "باز کردن ابزار ")}{h.tool}</button>}
              </div>
            ))
          )}
          <p className="ax-small">⚠ {fa ? DISCLAIMER.fa : DISCLAIMER.en}</p>
        </div>
      ))}
    </section>
  );
}
