/* Analysis panel shown on top of the Chart tab: the Agent's read of the coin and timeframe you are looking at. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { externalCandles } from "./exchanges";
import { Analysis, Bi, FA_NAME, TF_SEC, analyze, fmtPrice, left } from "./agent";
import { setLang, useLang } from "./lang";
import { STRATEGIES, matchesFor, type Match } from "./strategies";
import type { QCandle } from "./qfex";

export type SetupLines = { base: string; tf: string; side: "long" | "short"; sid: string; entry: number; stop: number; t: [number, number, number]; sig?: { strats: { name: Bi; basis: Bi }[]; why: Bi[]; grade: string; score: number; rr: number | null; closed: string } };

export function AnalysisPanel(p: { base: string; tf: string; tradfi: boolean; setup: SetupLines | null; onClose: () => void; onTf: (tf: string) => void }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const L = (x: Bi) => (fa ? x.fa : x.en);
  const [rows, setRows] = useState<QCandle[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState("");
  const ok = !!TF_SEC[p.tf];
  useEffect(() => {
    setRows(null);
    setErr("");
    if (!ok) return;
    const ctl = new AbortController();
    const run = async () => {
      try {
        const r = await externalCandles(p.base, p.tf, ctl.signal, p.tradfi);
        if (ctl.signal.aborted) return;
        if (r.rows.length > 40) setRows(r.rows);
        else setErr(T("Could not load candles for this coin.", "کندل‌های این ارز لود نشد."));
      } catch {}
    };
    run();
    const id = window.setInterval(run, 20000);
    return () => {
      ctl.abort();
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.base, p.tf, p.tradfi, ok]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const tick = Math.floor(now / 5000);
  const a: Analysis | null = useMemo(() => (rows ? analyze(p.base, p.tf, rows, Date.now()) : null), [rows, p.base, p.tf, tick]);
  const ms: Match[] = useMemo(() => (rows ? matchesFor(rows, p.tf, Date.now()) : []), [rows, p.tf, tick]);
  const nm = fa ? FA_NAME[p.base] || p.base : p.base;
  const col = a ? (a.bias === "bull" ? "ag-bull" : a.bias === "bear" ? "ag-bear" : "ag-flat") : "";
  const el = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("arcus.an.pos.v1") || "null");
    } catch {
      return null;
    }
  });
  const drag = (e: any) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = el.current, par = box?.offsetParent as HTMLElement | null;
    if (!box || !par) return;
    const pr = par.getBoundingClientRect(), br = box.getBoundingClientRect();
    const dx = e.clientX - br.left, dy = e.clientY - br.top;
    let last = { x: br.left - pr.left, y: br.top - pr.top };
    const mv = (m: PointerEvent) => {
      last = {
        x: Math.max(0, Math.min(pr.width - 60, m.clientX - pr.left - dx)),
        y: Math.max(0, Math.min(pr.height - 40, m.clientY - pr.top - dy)),
      };
      setPos(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("arcus.an.pos.v1", JSON.stringify(last));
      } catch {}
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };
  const sd = (s: "long" | "short") => (s === "long" ? T("LONG", "خرید") : T("SHORT", "فروش"));
  return (
    <aside ref={el as any} className={"an-panel " + col} dir={fa ? "rtl" : "ltr"} aria-label="Analysis" style={pos ? { left: pos.x, top: pos.y, insetInlineStart: "auto" } : undefined}>
      <header onPointerDown={drag} className="an-drag" title={T("Drag to move", "برای جابه‌جایی بکش")}>
        <b>🧠 {T("Analysis", "تحلیل")} · {nm} <small>{p.tf}</small></b>
        <span>
          <button onClick={() => setLang(fa ? "en" : "fa")} title="English / فارسی">{fa ? "EN" : "فا"}</button>
          <button onClick={p.onClose} aria-label="Close">✕</button>
        </span>
      </header>
      {!ok && (
        <div className="an-note">
          {T("Analysis supports 5m, 15m, 1h, 4h and 1d. Switch timeframe:", "تحلیل برای تایم‌فریم‌های ۵m، ۱۵m، ۱h، ۴h و ۱d است. تایم‌فریم را عوض کن:")}
          <div className="an-tfs">{["5m", "15m", "1h", "4h", "1d"].map((f) => <button key={f} onClick={() => p.onTf(f)}>{f}</button>)}</div>
        </div>
      )}
      {ok && !a && <div className="an-note">{err || T("Reading candles…", "در حال خواندن کندل‌ها…")}</div>}
      {a && (
        <div className="an-body">
          {p.setup && p.setup.base === p.base && (
            <section className={"an-setup " + p.setup.side}>
              <h4>{T("Setup you opened", "ستاپی که باز کردی")}: <span className={"ag-badge " + p.setup.side}>{sd(p.setup.side)}</span> {p.setup.sid === "sig" ? T("Agent signal", "سیگنال ایجنت") : L(STRATEGIES.find((x) => x.id === p.setup!.sid)?.name || { en: p.setup.sid, fa: p.setup.sid })}</h4>
              <dl className="ag-lv">
                <div><dt>{T("Entry", "ورود")}</dt><dd>{fmtPrice(p.setup.entry)}</dd></div>
                <div className="s"><dt>{T("Stop", "حدضرر")}</dt><dd>{fmtPrice(p.setup.stop)}</dd></div>
                <div className="t"><dt>1R</dt><dd>{fmtPrice(p.setup.t[0])}</dd></div>
                <div className="t"><dt>2R</dt><dd>{fmtPrice(p.setup.t[1])}</dd></div>
                <div className="t"><dt>3R</dt><dd>{fmtPrice(p.setup.t[2])}</dd></div>
              </dl>
              {p.setup.sig && (
                <div className="an-sig">
                  <h4>{T("Why the Agent signalled", "چرا ایجنت سیگنال داد")} · {p.setup.sig.grade} ({p.setup.sig.score}) · {p.setup.tf}{p.setup.sig.rr != null ? " · R:R " + p.setup.sig.rr.toFixed(1) : ""}</h4>
                  {p.setup.sig.strats.map((x, i) => <p key={i}><b>🏷 {L(x.name)}</b> — {L(x.basis)}</p>)}
                  <ul>{p.setup.sig.why.map((w, i) => <li key={i}>{L(w)}</li>)}</ul>
                  <small>{T(`The signal was read from the ${p.setup.tf} candle that closed at ${p.setup.sig.closed}. The live reading below also counts the candle that is still forming, so its volume and candle shape can look different.`, `سیگنال از کندل ${p.setup.tf} که ${p.setup.sig.closed} بسته شد خوانده شده. تحلیل زنده‌ی پایین کندلِ در حال شکل‌گیری را هم می‌شمارد، پس حجم و شکل کندل می‌تواند فرق کند.`)}</small>
                </div>
              )}
              <small>{T("These levels are drawn on the chart.", "این سطوح روی چارت کشیده شده‌اند.")}</small>
            </section>
          )}
          <div className="an-head">
            <div>
              <strong className={col}>{a.score > 0 ? "+" : ""}{a.score}</strong> {L(a.label)}
              <div className="an-sub">{L(a.setup)}</div>
            </div>
            <div className="ag-clock"><small>{T("closes in", "بسته‌شدن تا")}</small><b>{left(a.closeAt, now)}</b></div>
          </div>
          <span className="ag-gauge"><i className="mid" /><i className={"fill " + (a.score >= 0 ? "pos" : "neg")} style={a.score >= 0 ? { left: "50%", width: a.score / 2 + "%" } : { right: "50%", width: -a.score / 2 + "%" }} /></span>
          <h4>{T("Why", "چرا")}</h4>
          <ul>{a.why.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
          <h4>{T("Strategies matching now", "استراتژی‌های منطبق")}</h4>
          {!ms.length && <p className="muted">{p.setup?.sig ? T("The Agent signal above uses its own rules; these older presets do not apply.", "سیگنال ایجنت (بالا) قواعد خودش را دارد؛ این پیش‌تنظیم‌های قدیمی‌تر اینجا کاربرد ندارند.") : T("None of the momentum strategies match this coin right now.", "فعلاً هیچ‌کدام از استراتژی‌های مومنتوم با این ارز نمی‌خواند.")}</p>}
          {ms.map((m) => (
            <div key={m.sid + m.side} className={"an-m " + m.side}>
              <b><span className={"ag-badge " + m.side}>{sd(m.side)}</span> {L(STRATEGIES.find((x) => x.id === m.sid)!.name)} <em>{m.q}</em></b>
              <small>{T("Entry", "ورود")} {fmtPrice(m.entry)} · {T("Stop", "حدضرر")} {fmtPrice(m.stop)} ({m.riskPct.toFixed(1)}%) · 2R {fmtPrice(m.t[1])}</small>
            </div>
          ))}
          <h4>{T("Candle structure", "ساختار کندل")}</h4>
          <ul>{a.candleLines.map((x, i) => <li key={i}>{L(x)}</li>)}{a.patterns.map((x, i) => <li key={"p" + i} className="pat">{L(x)}</li>)}</ul>
          <h4>{T("Trend & levels", "روند و سطوح")}</h4>
          <ul>
            <li>{L(a.structure)}</li>
            <li>RSI {a.ind.rsi.toFixed(0)} · ATR {fmtPrice(a.ind.atr)} · MACD {a.ind.hist > 0 ? T("positive", "مثبت") : T("negative", "منفی")}</li>
            <li>{T("Resistance ", "مقاومت ")}{a.res ? fmtPrice(a.res) : "—"} · {T("Support ", "حمایت ")}{a.sup ? fmtPrice(a.sup) : "—"}</li>
          </ul>
          <div className="ag-sc2">
            <div className="up"><h4>▲ {T("If buyers win", "اگر خریداران برنده شوند")}</h4><p>{L(a.bull)}</p></div>
            <div className="dn"><h4>▼ {T("If sellers win", "اگر فروشندگان برنده شوند")}</h4><p>{L(a.bear)}</p></div>
          </div>
          <h4>{T("Before the close", "پیش از بسته‌شدن کندل")}</h4>
          <p>{L(a.plan)}</p>
          <h4>{T("Risks", "ریسک‌ها")}</h4>
          <ul>{a.risks.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
          <p className="muted an-foot">{T("Rule-based reading, not financial advice.", "تحلیل قاعده‌محور است و توصیه‌ی مالی نیست.")}</p>
        </div>
      )}
    </aside>
  );
}
