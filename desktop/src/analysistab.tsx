/* Analysis tab — five sections built from five skills (Momentum Burst · Market Pro · Correlation · Analysis Pro · Analysis).
   Everything is computed in the browser from Yahoo daily candles. Research / education only — not advice. Nothing here touches the Agent or any other tab. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { setLang, useLang } from "./lang";
import { AutoSrc, autoScan } from "./autoscan";
import type { Sig2 } from "./engine";
import { Bar, Burst, Daily, Fund, Gate, Pro, alignReturns, burst, cluster, corr, daily, expectedSession, fundRows, loadCtx, mean, pairStats, pool, pro, realized, rolling, sma, tech, ySym } from "./analysislib";

type Sec = "burst" | "market" | "corr" | "pro" | "an";
const STARTER = "NVDA AAPL MSFT AMZN GOOGL META TSLA AMD AVGO NFLX CRM ORCL PLTR SMCI COIN MU QCOM ADBE UBER SHOP";
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
const parseList = (s: string) => Array.from(new Set(s.toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Z0-9.\-^=]{1,15}$/.test(x))));
const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));
const pc = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%");
const n2 = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
const big = (v: number) => (v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v)));

/* ---------- chart (candles / line + MA + volume) ---------- */
function PriceChart({ bars, all, kind }: { bars: Bar[]; all: Bar[]; kind: "candle" | "line" }) {
  const W = 900, H = 430, PH = 320, n = bars.length, off = all.length - n;
  const xw = (W - 56) / n, X = (i: number) => 6 + i * xw + xw / 2;
  const ma = (w: number) => sma(all.map((b) => b.c), w).slice(off);
  const lines: [number, string, number[]][] = [[20, "#ff9800", ma(20)], [50, "#b388ff", ma(50)], [200, "#90a4ae", ma(200)]];
  const vals = bars.flatMap((b) => [b.h, b.l]).concat(lines.flatMap(([, , a]) => a.filter(Number.isFinite)));
  const hi = Math.max(...vals), lo = Math.min(...vals), Y = (v: number) => 8 + ((hi - v) / (hi - lo || 1)) * (PH - 16);
  const vmax = Math.max(...bars.map((b) => b.v), 1), VY = (v: number) => H - 6 - (v / vmax) * 84;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  const step = Math.max(1, Math.floor(n / 6));
  return (
    <svg className="ax-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="price chart">
      {grid.map((g) => (
        <g key={g}>
          <line x1="0" x2={W - 50} y1={Y(g)} y2={Y(g)} stroke="rgba(255,255,255,.07)" />
          <text x={W - 46} y={Y(g) + 4} fontSize="11" fill="#8aa0bb">{px(g)}</text>
        </g>
      ))}
      {kind === "line" ? (
        <polyline fill="none" stroke="#4aa3ff" strokeWidth="1.8" points={bars.map((b, i) => `${X(i)},${Y(b.c)}`).join(" ")} />
      ) : (
        bars.map((b, i) => {
          const up = b.c >= b.o, col = up ? "#26a69a" : "#ef5350", bw = Math.max(1, xw * 0.65);
          return (
            <g key={b.t}>
              <line x1={X(i)} x2={X(i)} y1={Y(b.h)} y2={Y(b.l)} stroke={col} />
              <rect x={X(i) - bw / 2} y={Math.min(Y(b.o), Y(b.c))} width={bw} height={Math.max(1, Math.abs(Y(b.o) - Y(b.c)))} fill={col} />
            </g>
          );
        })
      )}
      {lines.map(([w, col, a]) => {
        const pts = a.map((v, i) => (Number.isFinite(v) ? `${X(i)},${Y(v)}` : "")).filter(Boolean);
        return pts.length > 1 ? <polyline key={w} fill="none" stroke={col} strokeWidth="1.2" points={pts.join(" ")} /> : null;
      })}
      {bars.map((b, i) => <rect key={"v" + b.t} x={X(i) - Math.max(0.5, xw * 0.35)} y={VY(b.v)} width={Math.max(1, xw * 0.7)} height={H - 6 - VY(b.v)} fill={b.c >= b.o ? "rgba(38,166,154,.55)" : "rgba(239,83,80,.55)"} />)}
      {bars.map((b, i) => (i % step === 0 ? <text key={"d" + b.t} x={X(i)} y={PH + 12} fontSize="10" fill="#8aa0bb" textAnchor="middle">{b.d.slice(5)}</text> : null))}
      <g fontSize="11">
        {lines.map(([w, col], i) => <text key={w} x={8 + i * 62} y="14" fill={col}>MA{w}</text>)}
      </g>
    </svg>
  );
}

/* ---------- shared bits ---------- */
const Err = ({ e }: { e: string }) => (e ? <p className="ax-err">⚠ {e}</p> : null);
const Disc = ({ t }: { t: (a: string, b: string) => string }) => <p className="ax-disc">{t("Research / education only — not financial advice. Yahoo data can be delayed or incomplete; past behaviour does not predict the future.", "فقط برای پژوهش و آموزش — توصیه‌ی مالی نیست. داده‌ی Yahoo ممکن است تأخیر یا نقص داشته باشد؛ رفتار گذشته آینده را تضمین نمی‌کند.")}</p>;

export function AnalysisTab(p: { syms: { symbol: string; base: string; ex: string; market: string }[]; onExtra?: (x: { ready: Sig2[]; watch: Sig2[] }) => void }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const [sec, setSec] = usePersist<Sec>("arcus.an.sec", "burst");
  // universe = the symbols of the exchanges that are switched on in the app (Arcus, QFEX, …): stocks and crypto
  const [scope, setScope] = usePersist<"stocks" | "all">("arcus.an.scope", "stocks");
  const exs = useMemo(() => Array.from(new Set(p.syms.map((x) => x.ex))), [p.syms]);
  const uni = useMemo(() => {
    const pick = p.syms.filter((x) => x.market === "Stocks" || (scope === "all" && x.market === "Crypto"));
    const out = Array.from(new Set(pick.map((x) => (x.market === "Crypto" ? x.base + "-USD" : x.base))));
    return out.length ? out : p.syms.length ? [] : parseList(STARTER);
  }, [p.syms, scope]);
  const defList = uni.join(" ");
  const tabs: [Sec, string, string][] = [
    ["burst", "🚀 Momentum Burst", "🚀 مومنتوم بِرست"],
    ["market", "📈 Market Pro", "📈 بازار (Pro)"],
    ["corr", "🔗 Correlation", "🔗 همبستگی"],
    ["pro", "🧮 Analysis Pro", "🧮 آنالیز Pro"],
    ["an", "🔬 Analysis", "🔬 آنالیز"],
  ];
  // ---- auto-scan -> Agent (Momentum Burst / Analysis Pro). Runs while the app is open, even when this tab is hidden. ----
  const [autoOn, setAutoOn] = usePersist("arcus.an.auto.on", false);
  const [autoSrc, setAutoSrc] = usePersist<AutoSrc[]>("arcus.an.auto.src", ["burst", "pro"]);
  const [autoSt, setAutoSt] = useState<{ at: number; n: number; r: number; w: number; failed: number; allow: boolean } | null>(() => jget("arcus.an.auto.st", null));
  const [autoBusy, setAutoBusy] = useState<{ d: number; n: number } | null>(null);
  const [autoErr, setAutoErr] = useState("");
  const onExtraRef = useRef(p.onExtra);
  onExtraRef.current = p.onExtra;
  const busyRef = useRef(false);
  const uniRef = useRef(uni);
  uniRef.current = uni;
  const runAuto = async () => {
    if (busyRef.current) return;
    const custom = parseList(jget<string>("arcus.an.b.syms", ""));
    const list = (custom.length ? custom : uniRef.current).slice(0, 300);
    if (!list.length || !autoSrc.length) return;
    busyRef.current = true;
    setAutoErr("");
    setAutoBusy({ d: 0, n: list.length });
    try {
      const r = await autoScan(list, autoSrc, (d, n) => setAutoBusy({ d, n }));
      if (r.failed === list.length) throw new Error("no data");
      onExtraRef.current?.({ ready: r.ready, watch: r.watch });
      const st = { at: Date.now(), n: r.n, r: r.ready.length, w: r.watch.length, failed: r.failed, allow: r.allow };
      setAutoSt(st);
      jset("arcus.an.auto.st", st);
    } catch (e: any) {
      setAutoErr((e?.message || "failed") + " — " + T("data sources unreachable; will retry", "منابع داده در دسترس نیست؛ دوباره تلاش می‌شود"));
    } finally {
      busyRef.current = false;
      setAutoBusy(null);
    }
  };
  const runRef = useRef(runAuto);
  runRef.current = runAuto;
  useEffect(() => {
    if (!autoOn) return;
    const first = window.setTimeout(() => runRef.current(), 1500);
    const id = window.setInterval(() => runRef.current(), 30 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, autoSrc.join(",")]);
  const toggleSrc = (s: AutoSrc) => setAutoSrc(autoSrc.includes(s) ? autoSrc.filter((x) => x !== s) : [...autoSrc, s]);
  return (
    <div className="ax">
      <div className="ax-auto">
        <button type="button" role="switch" aria-checked={autoOn} className={"sg-sw" + (autoOn ? " on" : "")} onClick={() => setAutoOn(!autoOn)} title={T("Auto-scan → Agent", "اسکن خودکار ← ایجنت")}><i /></button>
        <b>{T("Auto-scan → Agent", "اسکن خودکار ← ایجنت")}</b>
        <label><input type="checkbox" checked={autoSrc.includes("burst")} onChange={() => toggleSrc("burst")} /> Momentum Burst</label>
        <label><input type="checkbox" checked={autoSrc.includes("pro")} onChange={() => toggleSrc("pro")} /> Analysis Pro</label>
        <button type="button" className="ax-ghost" disabled={!!autoBusy} onClick={() => runAuto()}>{autoBusy ? `${autoBusy.d}/${autoBusy.n}…` : "🔍 " + T("Scan now", "اسکن همین حالا")}</button>
        {autoSt && <span className="ax-small">{T("Last", "آخرین")} {new Date(autoSt.at).toLocaleTimeString()} · {autoSt.n} {T("symbols", "نماد")} · 👁 {autoSt.w} · ✅ {autoSt.r}{autoSt.failed ? ` · ⚠ ${autoSt.failed}` : ""} · {T("market gate", "فیلتر بازار")} {autoSt.allow ? T("open", "باز") : T("closed", "بسته")}</span>}
      </div>
      {autoOn && <p className="ax-small">{T("Scans the symbols of your switched-on exchanges (or the Momentum Burst list if you typed one). Daily candles, long-only, every 30 min while the app is open. WATCH first; READY only after a CLOSED daily candle confirms and SPY/QQQ are above their 50DMA. Signals appear in the Agent tab tagged with the section name, with the same sound + notification alarms.", "نمادهای صرافی‌های روشن را اسکن می‌کند (یا لیست Momentum Burst اگر خودت نوشته‌ای). کندل روزانه، فقط خرید، هر ۳۰ دقیقه تا وقتی برنامه باز است. اول واچ‌لیست؛ آماده فقط بعد از تأیید کندل روزانه‌ی بسته‌شده و وقتی SPY/QQQ بالای ۵۰DMA باشند. سیگنال‌ها در تب Agent با برچسب نام بخش می‌آیند، با همان هشدار صدا + اعلان.")}</p>}
      <Err e={autoErr} />
      <p className="ax-small">{T("Universe", "دامنه")}: {exs.length ? exs.join(" + ") : T("no exchange switched on", "هیچ صرافی‌ای روشن نیست")} · {uni.length} {T("symbols", "نماد")} ·{" "}
        <span className="sg-chips"><button type="button" className={scope === "stocks" ? "on" : ""} onClick={() => setScope("stocks")}>{T("Stocks", "سهام")}</button><button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>{T("Stocks + crypto", "سهام + کریپتو")}</button></span>
        {" "}{T("— only the exchanges you switched on in Market are used.", "— فقط صرافی‌هایی که در بازار روشن کرده‌ای استفاده می‌شود.")}</p>
      <div className="sg-tabs ax-tabs" role="tablist">
        {tabs.map(([id, en, f]) => (
          <button key={id} type="button" role="tab" aria-selected={sec === id} className={sec === id ? "on" : ""} onClick={() => setSec(id)}>{fa ? f : en}</button>
        ))}
      </div>
      {sec === "burst" && <BurstSec T={T} uni={uni} />}
      {sec === "market" && <MarketSec T={T} />}
      {sec === "corr" && <CorrSec T={T} uni={uni} />}
      {sec === "pro" && <ProSec T={T} />}
      {sec === "an" && <AnSec T={T} />}
      <Disc t={T} />
    </div>
  );
}
type TT = (a: string, b: string) => string;

/* ---------- 1. Momentum Burst ---------- */
function BurstSec({ T, uni }: { T: TT; uni: string[] }) {
  const [syms, setSyms] = usePersist("arcus.an.b.syms", "");
  const [gate, setGate] = usePersist<Gate>("arcus.an.b.gate", "unknown");
  const [minVol, setMinVol] = usePersist("arcus.an.b.vol", 100000);
  const [busy, setBusy] = useState<{ d: number; n: number } | null>(null);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<{ cutoff: string; list: Burst[]; regime: string; n: number; stale: number } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async () => {
    const custom = parseList(syms);
    const list = (custom.length ? custom : uni).slice(0, 300);
    if (!list.length) return setErr(T("Enter at least one ticker.", "حداقل یک نماد وارد کن."));
    setErr("");
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    setBusy({ d: 0, n: list.length });
    try {
      let cutoff = expectedSession(), regime = "";
      try {
        const spy = (await daily("SPY", "6mo", c.signal)).bars, qqq = (await daily("QQQ", "6mo", c.signal)).bars;
        if (spy[spy.length - 1].d < cutoff) cutoff = spy[spy.length - 1].d; // holiday / provider not yet published
        const a50 = (b: Bar[]) => b[b.length - 1].c > mean(b.slice(-50).map((x) => x.c));
        regime = `SPY ${a50(spy) ? "▲" : "▼"} 50DMA · QQQ ${a50(qqq) ? "▲" : "▼"} 50DMA`;
      } catch {}
      let failed = 0;
      const out = await pool(list, 6, async (s) => {
        try {
          return burst(s, (await daily(s, "6mo", c.signal)).bars, cutoff, gate, minVol);
        } catch {
          failed++;
          return { symbol: s, state: "REJECTED", rating: "-", score: 0, triggers: [], gain: 0, dollar: 0, volRatio: 0, loc: 0, baseRatio: 0, entry: 0, stop: 0, risk: 0, comp: {}, rejects: ["no_data"], tags: [], date: "", age: 0, price: 0 } as Burst;
        }
      }, (d) => setBusy({ d, n: list.length }), c.signal);
      if (c.signal.aborted) return;
      setRes({ cutoff, list: out.filter(Boolean), regime, n: list.length, stale: out.filter((x) => x?.rejects.includes("stale_price_data")).length });
      if (failed === list.length) setErr(T("No data came back (Yahoo unreachable from this network?).", "هیچ داده‌ای نیامد (Yahoo از این شبکه در دسترس نیست؟)."));
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message || "failed");
    } finally {
      setBusy(null);
    }
  };
  const groups: [Burst["state"], string, string][] = [
    ["ACTIONABLE_DAY1", "A / A- — chart-review first", "A / A- — اول چارت را بررسی کن"],
    ["MANUAL_REVIEW", "Manual review (market gate not 'allow')", "بررسی دستی (فیلتر بازار 'allow' نیست)"],
    ["WATCHLIST", "B — watchlist", "B — واچ‌لیست"],
    ["WATCH_ONLY", "C/D — watch only", "C/D — فقط مشاهده"],
  ];
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Stockbee-style Momentum Burst: 4% breakout, dollar breakout or range expansion on the last COMPLETED daily bar, scored 0–100 (trigger, volume, base contraction, close location, risk to the trigger-day low). Candidate generation only — never an order.", "مومنتوم بِرست به سبک Stockbee: بریک‌اوت ۴٪، بریک‌اوت دلاری یا گسترش دامنه روی آخرین کندل روزانه‌ی بسته‌شده؛ امتیاز ۰–۱۰۰ (ماشه، حجم، فشردگی پایه، محل کلوز، ریسک تا کف کندل ماشه). فقط تولید کاندید — هرگز دستور خرید نیست.")}</p>
      <textarea className="ax-ta" rows={2} value={syms} onChange={(e) => setSyms(e.target.value)} placeholder={T(`Empty = all ${uni.length} symbols of your switched-on exchanges. Or type tickers: NVDA SMCI PLTR …`, `خالی = همه‌ی ${uni.length} نماد صرافی‌های روشن. یا نمادها را بنویس: NVDA SMCI PLTR …`)} spellCheck={false} />
      <div className="ax-row">
        <label>{T("Market gate", "فیلتر بازار")}
          <select value={gate} onChange={(e) => setGate(e.target.value as Gate)}>
            <option value="unknown">{T("unknown (cap at manual review)", "نامشخص (سقف: بررسی دستی)")}</option>
            <option value="allow">{T("allow (market regime OK)", "allow (رژیم بازار خوب است)")}</option>
            <option value="block">{T("block", "بلاک")}</option>
          </select>
        </label>
        <label>{T("Min volume", "حداقل حجم")}<input type="number" min={0} step={50000} value={minVol} onChange={(e) => setMinVol(Math.max(0, Number(e.target.value) || 0))} /></label>
        <button type="button" className="sg-go" disabled={!!busy} onClick={run}>{busy ? `${busy.d}/${busy.n}…` : "🔍 " + T("Screen", "اسکرین")}</button>
        <button type="button" className="ax-ghost" onClick={() => setSyms("")}>{T("Use my exchanges", "نمادهای صرافی‌های من")}</button>
      </div>
      <p className="sx-hint">{T("Never set the gate to 'allow' without checking the market regime yourself (SPY/QQQ trend). Empty list = every symbol of your switched-on exchanges (max 300 per scan).", "بدون بررسی رژیم بازار (روند SPY/QQQ) گیت را روی allow نگذار. لیست خالی = همه‌ی نمادهای صرافی‌های روشن (حداکثر ۳۰۰ در هر اسکن).")}</p>
      <Err e={err} />
      {res && (
        <>
          <p className="sx-hint">{T("Session", "جلسه")}: <b>{res.cutoff}</b> · {res.n} {T("symbols", "نماد")} · {res.regime || T("market regime unavailable", "رژیم بازار در دسترس نیست")} {res.stale > 0 && <span className="ax-warn">· ⏸ {res.stale} {T("stale (market closed / not published)", "کهنه (بازار بسته / منتشر نشده)")}</span>}</p>
          {groups.map(([st, en, f]) => {
            const g = res.list.filter((x) => x.state === st).sort((a, b) => b.score - a.score);
            return g.length ? (
              <div key={st}>
                <h4 className="ax-h">{T(en, f)} <small>({g.length})</small></h4>
                <div className="ax-scroll">
                  <table className="ax-t">
                    <thead><tr><th>{T("Symbol", "نماد")}</th><th>{T("Grade", "درجه")}</th><th>{T("Score", "امتیاز")}</th><th>{T("Trigger", "ماشه")}</th><th>{T("Gain", "رشد")}</th><th>Vol×</th><th>{T("Close loc", "محل کلوز")}</th><th>{T("Entry ref", "ورود (مرجع)")}</th><th>{T("Stop ref", "حد ضرر (مرجع)")}</th><th>{T("Risk", "ریسک")}</th></tr></thead>
                    <tbody>
                      {g.map((x) => (
                        <tr key={x.symbol}>
                          <td><b>{x.symbol}</b></td><td>{x.rating}</td><td>{x.score}</td><td>{x.triggers.join(", ")}</td><td className="up">{pc(x.gain, 1)}</td><td>{n2(x.volRatio, 1)}</td><td>{n2(x.loc, 0)}%</td><td>{px(x.entry)}</td><td>{px(x.stop)}</td><td>{n2(x.risk, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null;
          })}
          {!res.list.some((x) => x.state !== "REJECTED") && <p className="sg-empty">{T("No candidates on this session.", "در این جلسه کاندیدی پیدا نشد.")}</p>}
          <details className="ax-det"><summary>{T("Rejected / no trigger", "ردشده / بدون ماشه")} ({res.list.filter((x) => x.state === "REJECTED").length})</summary>
            <p className="ax-small">{res.list.filter((x) => x.state === "REJECTED").map((x) => `${x.symbol}: ${x.rejects.join("/")}`).join(" · ")}</p>
          </details>
          <p className="sx-hint">{T("Entry reference = trigger-day high (act only on a break above it next session, after chart validation); stop reference = trigger-day low. Many momentum-burst traders review after ~3–5 sessions — a template, not advice.", "مرجع ورود = سقف کندل ماشه (فقط با شکستش در جلسه‌ی بعد و بعد از بررسی چارت)؛ مرجع حد ضرر = کف کندل ماشه. بسیاری از معامله‌گران بِرست بعد از حدود ۳–۵ جلسه بازبینی می‌کنند — یک الگو است، نه توصیه.")}</p>
        </>
      )}
    </section>
  );
}

/* ---------- 2. Market Pro ---------- */
const PER: Record<string, number> = { "1mo": 21, "3mo": 63, "6mo": 126, "1y": 252, "2y": 504 };
function MarketSec({ T }: { T: TT }) {
  const [sym, setSym] = usePersist("arcus.an.m.sym", "NVDA");
  const [inp, setInp] = useState(sym);
  const [per, setPer] = usePersist("arcus.an.m.per", "6mo");
  const [kind, setKind] = usePersist<"candle" | "line">("arcus.an.m.kind", "candle");
  const [d, setD] = useState<Daily | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (s: string) => {
    setBusy(true);
    setErr("");
    try {
      setD(await daily(s, "2y"));
      setSym(ySym(s));
    } catch (e: any) {
      setErr(e?.message || "failed");
      setD(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load(sym);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const b = d?.bars || [], last = b[b.length - 1], prev = b[b.length - 2];
  const y = b.slice(-252), hi = y.length ? Math.max(...y.map((x) => x.h)) : 0, lo = y.length ? Math.min(...y.map((x) => x.l)) : 0;
  const t10 = b.slice(-10), tlo = t10.length ? Math.min(...t10.map((x) => x.c)) : 0, thi = t10.length ? Math.max(...t10.map((x) => x.c)) : 1;
  return (
    <section className="ax-sec">
      <div className="ax-row">
        <input className="ax-in" value={inp} onChange={(e) => setInp(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && load(inp)} placeholder="AAPL · BTC-USD · 005930.KS" aria-label="ticker" />
        <button type="button" className="sg-go" disabled={busy} onClick={() => load(inp)}>{busy ? "…" : T("Load", "بارگذاری")}</button>
        <select value={per} onChange={(e) => setPer(e.target.value)}>{Object.keys(PER).map((k) => <option key={k}>{k}</option>)}</select>
        <span className="sg-chips">
          <button type="button" className={kind === "candle" ? "on" : ""} onClick={() => setKind("candle")}>{T("Candles", "کندل")}</button>
          <button type="button" className={kind === "line" ? "on" : ""} onClick={() => setKind("line")}>{T("Line", "خطی")}</button>
        </span>
      </div>
      <Err e={err} />
      {d && last && prev && (
        <>
          <div className="ax-cards">
            <div className="ax-card"><span>{d.meta.name || sym}</span><b>{px(last.c)} <small>{d.meta.currency}</small></b><em className={last.c >= prev.c ? "up" : "dn"}>{pc((last.c / prev.c - 1) * 100, 2)}</em></div>
            <div className="ax-card"><span>{T("Day range", "محدوده‌ی روز")}</span><b>{px(last.l)} – {px(last.h)}</b></div>
            <div className="ax-card"><span>{T("52-week range", "محدوده‌ی ۵۲ هفته")}</span><b>{px(lo)} – {px(hi)}</b><em>{n2(((last.c - lo) / (hi - lo || 1)) * 100, 0)}% {T("of range", "از محدوده")}</em></div>
            <div className="ax-card"><span>{T("Volume", "حجم")}</span><b>{big(last.v)}</b><em>{last.d}</em></div>
          </div>
          <PriceChart bars={b.slice(-PER[per])} all={b} kind={kind} />
          <h4 className="ax-h">{T("Last 10 sessions", "۱۰ جلسه‌ی اخیر")}</h4>
          <div className="ax-scroll">
            <table className="ax-t">
              <thead><tr><th>{T("Date", "تاریخ")}</th><th>{T("Close", "کلوز")}</th><th>{T("Chg", "تغییر")}</th><th>{T("Volume", "حجم")}</th><th /></tr></thead>
              <tbody>
                {t10.map((x, i) => {
                  const pr = b[b.length - 10 + i - 1], ch = pr ? (x.c / pr.c - 1) * 100 : NaN;
                  return (
                    <tr key={x.d}>
                      <td>{x.d}</td><td>{px(x.c)}</td><td className={ch >= 0 ? "up" : "dn"}>{pc(ch, 2)}</td><td>{big(x.v)}</td>
                      <td><i className="ax-bar" style={{ width: 8 + ((x.c - tlo) / (thi - tlo || 1)) * 120 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sx-hint">{T("Fundamentals (P/E, ROE, margins) and the earnings calendar are not available here: Yahoo's quote/fundamentals API needs a login token the browser can't get. Use the Analysis section to type them in by hand.", "بنیادی‌ها (P/E، ROE، حاشیه سود) و تقویم سود فصلی اینجا در دسترس نیست: API بنیادی Yahoo توکن ورود می‌خواهد که مرورگر نمی‌تواند بگیرد. در بخش «آنالیز» می‌توانی دستی واردشان کنی.")}</p>
        </>
      )}
    </section>
  );
}

/* ---------- 3. Correlation ---------- */
type CM = "discover" | "pair" | "cluster" | "realized";
const heat = (c: number) => (Number.isFinite(c) ? (c >= 0 ? `rgba(61,220,151,${0.12 + 0.7 * c})` : `rgba(255,92,92,${0.12 + 0.7 * -c})`) : "transparent");
function CorrSec({ T, uni }: { T: TT; uni: string[] }) {
  const [mode, setMode] = usePersist<CM>("arcus.an.c.mode", "discover");
  const [a, setA] = usePersist("arcus.an.c.a", "NVDA");
  const [b2, setB] = usePersist("arcus.an.c.b", "AMD");
  const [list, setList] = usePersist("arcus.an.c.list", "");
  const [range, setRange] = usePersist("arcus.an.c.range", "1y");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [out, setOut] = useState<any>(null);
  const text = list || uni.slice(0, 30).join(" ");
  const run = async () => {
    setErr("");
    setOut(null);
    setBusy(true);
    try {
      const A = ySym(a), B = ySym(b2);
      const need = mode === "discover" ? [A, ...parseList(text).filter((x) => x !== A)].slice(0, 40) : mode === "cluster" ? parseList(text).slice(0, 40) : [A, B];
      if (need.length < 2) throw new Error(T("Need at least two tickers.", "حداقل دو نماد لازم است."));
      const rng = mode === "realized" && range === "1y" ? "2y" : range;
      const data: Record<string, Bar[]> = {}, names: Record<string, string> = {};
      await pool(need, 6, async (s) => {
        try {
          const d = await daily(s, rng);
          data[s] = d.bars;
          names[s] = d.meta.name || "";
        } catch {}
      });
      if (!data[A] && mode !== "cluster") throw new Error(T("No data for ", "داده‌ای نیست برای ") + A);
      const al = alignReturns(data);
      const R = al.ret, ok = Object.keys(R);
      if (ok.length < 2) throw new Error(T("Not enough overlapping data.", "داده‌ی مشترک کافی نیست."));
      const closesOf = (s: string) => al.dates.length ? data[s].filter((x) => al.dates.includes(x.d)).map((x) => x.c) : [];
      if (mode === "discover") {
        const rows = ok.filter((s) => s !== A).map((s) => ({ s, c: corr(R[A], R[s]), name: names[s] })).filter((x) => Number.isFinite(x.c)).sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
        setOut({ mode, rows, n: R[A].length, dropped: al.dropped, A });
      } else if (mode === "pair") {
        setOut({ mode, st: pairStats(R[A], R[B], closesOf(A), closesOf(B)), A, B, dropped: al.dropped });
      } else if (mode === "realized") {
        setOut({ mode, rz: realized(R[A], R[B]), A, B, n: R[A].length, dropped: al.dropped });
      } else {
        setOut({ mode, cl: cluster(ok, R), ok, n: R[ok[0]].length, dropped: al.dropped });
      }
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  };
  const modes: [CM, string, string][] = [["discover", "Discover", "پیدا کردن هم‌حرکت‌ها"], ["pair", "Pair", "جفت"], ["cluster", "Cluster", "خوشه‌بندی"], ["realized", "Rolling / regimes", "غلتان / رژیم‌ها"]];
  return (
    <section className="ax-sec">
      <div className="sg-chips ax-modes">{modes.map(([id, en, f]) => <button key={id} type="button" className={mode === id ? "on" : ""} onClick={() => { setMode(id); setOut(null); }}>{T(en, f)}</button>)}</div>
      <p className="sx-hint">
        {mode === "discover" && T("One ticker vs a list of candidates: who moves with it (and who moves against it). Daily log returns, Pearson.", "یک نماد در برابر لیستی از کاندیدها: چه کسی با آن هم‌حرکت است (و چه کسی خلاف آن). بازده لگاریتمی روزانه، پیرسون.")}
        {mode === "pair" && T("Two tickers: correlation, beta, R², rolling-60d stability and the current price-spread z-score.", "دو نماد: همبستگی، بتا، R²، پایداری غلتان ۶۰ روزه و z-score فعلی اسپرد قیمت.")}
        {mode === "cluster" && T("A group: strongest / weakest pairs and clusters (average-linkage, correlation ≥ 0.6).", "یک گروه: قوی‌ترین / ضعیف‌ترین جفت‌ها و خوشه‌ها (میانگین‌پیوند، همبستگی ≥ ۰٫۶).")}
        {mode === "realized" && T("How correlation changes over time (20/60/120d) and in up / down / high-vol / sell-off regimes.", "تغییر همبستگی در زمان (۲۰/۶۰/۱۲۰ روز) و در رژیم‌های صعودی / نزولی / نوسان بالا / ریزش.")}
      </p>
      <div className="ax-row">
        {mode !== "cluster" && <input className="ax-in" value={a} onChange={(e) => setA(e.target.value.toUpperCase())} placeholder="A" aria-label="ticker A" />}
        {(mode === "pair" || mode === "realized") && <input className="ax-in" value={b2} onChange={(e) => setB(e.target.value.toUpperCase())} placeholder="B" aria-label="ticker B" />}
        <select value={range} onChange={(e) => setRange(e.target.value)}>{["6mo", "1y", "2y", "5y"].map((k) => <option key={k}>{k}</option>)}</select>
        <button type="button" className="sg-go" disabled={busy} onClick={run}>{busy ? "…" : "▶ " + T("Run", "اجرا")}</button>
      </div>
      {(mode === "discover" || mode === "cluster") && <textarea className="ax-ta" rows={2} value={text} onChange={(e) => setList(e.target.value)} spellCheck={false} />}
      <Err e={err} />
      {out?.dropped?.length > 0 && <p className="ax-small">{T("Dropped (no/short data)", "حذف‌شده (داده‌ی ناکافی)")}: {out.dropped.join(", ")}</p>}
      {out?.mode === "discover" && (
        <>
          <p className="ax-small">{out.n} {T("trading days", "روز معاملاتی")}</p>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>#</th><th>{T("Ticker", "نماد")}</th><th>{T("Company", "شرکت")}</th><th>{T("Correlation", "همبستگی")}</th></tr></thead>
            <tbody>{out.rows.slice(0, 15).map((r: any, i: number) => <tr key={r.s}><td>{i + 1}</td><td><b>{r.s}</b></td><td>{r.name}</td><td style={{ background: heat(r.c) }}>{n2(r.c)}</td></tr>)}</tbody></table></div>
          {out.rows.filter((r: any) => r.c < 0.2).length > 0 && <p className="ax-small">{T("Lowest / negative (hedge or diversifier candidates)", "کمترین / منفی (کاندید پوشش ریسک یا تنوع)")}: {out.rows.slice().sort((x: any, y: any) => x.c - y.c).slice(0, 5).map((r: any) => `${r.s} ${n2(r.c)}`).join(" · ")}</p>}
        </>
      )}
      {out?.mode === "pair" && (
        <div className="ax-cards">
          {[["Correlation", "همبستگی", n2(out.st.corr, 3)], ["Beta (B per A)", "بتا (B به A)", n2(out.st.beta, 3)], ["R²", "R²", n2(out.st.r2, 3)], ["Rolling 60d mean", "میانگین غلتان ۶۰ر", n2(out.st.r60mean, 2)], ["Rolling range", "بازه‌ی غلتان", `${n2(out.st.r60min, 2)} … ${n2(out.st.r60max, 2)}`], ["Rolling std", "انحراف غلتان", n2(out.st.r60std, 2)], ["Spread z now", "z اسپرد فعلی", n2(out.st.spreadZ, 2)], ["Observations", "تعداد مشاهده", String(out.st.n)]].map(([en, f, v]) => (
            <div className="ax-card" key={en}><span>{T(en, f)}</span><b>{v}</b></div>
          ))}
          <p className="ax-small ax-wide">{out.st.corr > 0.8 ? T("Strong co-movement.", "هم‌حرکتی قوی.") : out.st.corr > 0.5 ? T("Moderate: shared drivers plus independent factors.", "متوسط: عوامل مشترک + عوامل مستقل.") : T("Weak relationship.", "رابطه‌ی ضعیف.")} {Math.abs(out.st.spreadZ) > 2 && T("Spread is unusually stretched (|z| > 2).", "اسپرد غیرعادی کشیده شده (|z| > ۲).")} {out.st.r60std > 0.15 && T("Unstable over time (high rolling std).", "در طول زمان ناپایدار (انحراف غلتان بالا).")}</p>
        </div>
      )}
      {out?.mode === "realized" && (
        <>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Window", "پنجره")}</th><th>{T("Now", "الان")}</th><th>{T("Mean", "میانگین")}</th><th>Min</th><th>Max</th><th>Std</th></tr></thead>
            <tbody>{out.rz.wins.map((w: any) => <tr key={w.w}><td>{w.w}d</td><td style={{ background: heat(w.now) }}>{n2(w.now)}</td><td>{n2(w.mean)}</td><td>{n2(w.min)}</td><td>{n2(w.max)}</td><td>{n2(w.std)}</td></tr>)}</tbody></table></div>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Regime (on A's moves)", "رژیم (روی حرکات A)")}</th><th>{T("Correlation", "همبستگی")}</th><th>{T("Days", "روز")}</th></tr></thead>
            <tbody>{out.rz.regimes.map((r: any) => <tr key={r.name}><td>{r.name}</td><td style={{ background: heat(r.corr) }}>{n2(r.corr)}</td><td>{r.days}</td></tr>)}</tbody></table></div>
          <p className="ax-small">{out.n} {T("trading days", "روز معاملاتی")} · {T("If correlation rises in sell-offs, diversification helps less exactly when you need it.", "اگر همبستگی در ریزش‌ها بالا برود، تنوع درست وقتی لازم است کمتر کمک می‌کند.")}</p>
        </>
      )}
      {out?.mode === "cluster" && (
        <>
          <p className="ax-small">{out.n} {T("trading days", "روز معاملاتی")}</p>
          {out.ok.length <= 14 && (
            <div className="ax-scroll"><table className="ax-t ax-hm"><thead><tr><th />{out.cl.order.map((s: string) => <th key={s}>{s}</th>)}</tr></thead>
              <tbody>{out.cl.order.map((r: string) => <tr key={r}><th>{r}</th>{out.cl.order.map((c: string) => <td key={c} style={{ background: heat(out.cl.m[r][c]) }}>{n2(out.cl.m[r][c])}</td>)}</tr>)}</tbody></table></div>
          )}
          <h4 className="ax-h">{T("Clusters", "خوشه‌ها")}</h4>
          <ul className="ax-ul">{out.cl.groups.map((g: any, i: number) => <li key={i}><b>{g.members.join(", ")}</b>{g.members.length > 1 ? ` — ${T("avg corr", "میانگین همبستگی")} ${n2(g.avg)}` : ` — ${T("outlier (diversifier)", "تک‌افتاده (تنوع‌بخش)")}`}</li>)}</ul>
          <p className="ax-small">{T("Strongest", "قوی‌ترین")}: {out.cl.top.map((x: any) => `${x.a}/${x.b} ${n2(x.c)}`).join(" · ")}</p>
          <p className="ax-small">{T("Weakest", "ضعیف‌ترین")}: {out.cl.bottom.map((x: any) => `${x.a}/${x.b} ${n2(x.c)}`).join(" · ")}</p>
        </>
      )}
      <p className="sx-hint">{T("Correlation is not causation, and it shifts between market regimes. Short windows are noisy; long ones can hide regime change. There is no screener in the browser, so the candidate list is yours (default: your stocks / a starter list).", "همبستگی علیت نیست و بین رژیم‌های بازار تغییر می‌کند. پنجره‌ی کوتاه نویزی است و بلند می‌تواند تغییر رژیم را پنهان کند. در مرورگر اسکرینر نداریم، پس لیست کاندیدها با خودت است (پیش‌فرض: سهام تو / لیست اولیه).")}</p>
    </section>
  );
}

/* ---------- 4. Analysis Pro (+ portfolio) ---------- */
type Hold = { t: string; q: number; c: number };
const leanCls = (l: string) => (l === "FAVORABLE" ? "up" : l === "CAUTIOUS" ? "dn" : "");
function ProCard({ r, T }: { r: Pro; T: TT }) {
  return (
    <div className="ax-pro">
      <header>
        <b>{r.ticker}</b> <small>{r.name}</small>
        <span className={"ax-lean " + leanCls(r.lean)}>{r.lean}</span>
        <em>{T("confidence", "اطمینان")} {r.confidence}%</em><em>{T("score", "امتیاز")} {r.score >= 0 ? "+" : ""}{r.score.toFixed(2)}</em><em>{px(r.price)} · {r.asof}</em>
      </header>
      <div className="sx-parts">
        {Object.entries(r.comps).map(([k, v]) => (
          <div key={k} title={v.detail}><span>{k}</span><i><u style={{ width: ((v.score + 1) / 2) * 100 + "%", background: v.score >= 0.25 ? "#3ddc97" : v.score <= -0.25 ? "#ff5c5c" : "#8896a8" }} /></i><b>{v.score >= 0 ? "+" : ""}{v.score.toFixed(2)}</b></div>
        ))}
      </div>
      <ul className="ax-ul">{Object.entries(r.comps).map(([k, v]) => <li key={k}><b>{k}</b>: {v.detail}</li>)}</ul>
      {r.caveats.map((c, i) => <p key={i} className="sx-miss">⚠ {c}</p>)}
    </div>
  );
}
function ProSec({ T }: { T: TT }) {
  const [inp, setInp] = usePersist("arcus.an.p.syms", "NVDA AAPL BTC-USD");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rs, setRs] = useState<Pro[]>([]);
  const [hold, setHold] = usePersist<Hold[]>("arcus.an.p.pf", []);
  const [nt, setNt] = useState(""), [nq, setNq] = useState(""), [nc, setNc] = useState("");
  const [per, setPer] = usePersist("arcus.an.p.per", "monthly");
  const [pf, setPf] = useState<any>(null);
  const analyze = async (syms: string[]) => {
    const ctx = await loadCtx();
    const out: Pro[] = [], errs: string[] = [];
    await pool(syms, 4, async (s) => {
      try {
        out.push(pro(s, await daily(s, "1y"), ctx));
      } catch (e: any) {
        errs.push(s + ": " + (e?.message || "failed"));
      }
    });
    return { out: syms.map((s) => out.find((x) => x.ticker === ySym(s))).filter(Boolean) as Pro[], errs };
  };
  const run = async () => {
    const l = parseList(inp).slice(0, 12);
    if (!l.length) return;
    setBusy(true);
    setErr("");
    try {
      const { out, errs } = await analyze(l);
      setRs(out);
      if (errs.length) setErr(errs.join(" · "));
    } catch (e: any) {
      setErr(T("Market context failed to load: ", "بارگذاری زمینه‌ی بازار ناموفق بود: ") + (e?.message || ""));
    } finally {
      setBusy(false);
    }
  };
  const addHold = () => {
    const t = ySym(nt), q = Number(nq), c = Number(nc);
    if (!/^[A-Z0-9.\-^=]{1,15}$/.test(t) || !(q > 0) || !(c >= 0)) return setErr(T("Ticker, quantity > 0 and cost ≥ 0 are required.", "نماد، تعداد > ۰ و قیمت خرید ≥ ۰ لازم است."));
    const cur = hold.find((h) => h.t === t);
    setHold(cur ? hold.map((h) => (h.t === t ? { t, q: h.q + q, c: (h.q * h.c + q * c) / (h.q + q) } : h)) : hold.concat({ t, q, c }));
    setNt(""); setNq(""); setNc(""); setErr("");
  };
  const runPf = async () => {
    if (!hold.length) return;
    setBusy(true);
    setErr("");
    try {
      const bars = { daily: 1, weekly: 5, monthly: 21, quarterly: 63, yearly: 252 }[per] || 21;
      const ctx = await loadCtx();
      const rows: any[] = [];
      await pool(hold, 4, async (h) => {
        try {
          const d = await daily(h.t, "2y"), c = d.bars.map((x) => x.c), price = c[c.length - 1];
          rows.push({ h, price, value: h.q * price, pnl: h.q * (price - h.c), then: c.length > bars ? h.q * c[c.length - 1 - bars] : null, an: pro(h.t, d, ctx) });
        } catch {
          rows.push({ h, err: true });
        }
      });
      const ok = rows.filter((r) => !r.err), tv = ok.reduce((a, r) => a + r.value, 0), tc = hold.reduce((a, h) => a + h.q * h.c, 0);
      const thenT = ok.filter((r) => r.then != null).reduce((a, r) => a + r.then, 0), nowT = ok.filter((r) => r.then != null).reduce((a, r) => a + r.value, 0);
      setPf({ rows: hold.map((h) => rows.find((r) => r.h === h)), tv, tc, per: thenT ? (nowT / thenT - 1) * 100 : null, warn: ok.filter((r) => tv && r.value / tv > 0.3).map((r) => `${r.h.t} ${(r.value / tv * 100).toFixed(0)}%`), lean: { FAVORABLE: ok.filter((r) => r.an.lean === "FAVORABLE").length, NEUTRAL: ok.filter((r) => r.an.lean === "NEUTRAL").length, CAUTIOUS: ok.filter((r) => r.an.lean === "CAUTIOUS").length } });
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Multi-factor lean (FAVORABLE / NEUTRAL / CAUTIOUS) for US stocks and top crypto (use -USD, e.g. BTC-USD). In the browser only the price-based factors can be computed — momentum, market context (VIX, SPY/QQQ), VIX term structure, BTC correlation — so the confidence is scaled down and the missing factors are listed. A lean describes how the data looks; it is not a buy/sell call.", "تمایل چندعاملی (مطلوب / خنثی / محتاطانه) برای سهام آمریکا و کریپتوهای برتر (با -USD مثل BTC-USD). در مرورگر فقط عامل‌های قیمتی قابل محاسبه‌اند — مومنتوم، زمینه‌ی بازار (VIX، SPY/QQQ)، ساختار زمانی VIX، همبستگی با BTC — پس اطمینان کم می‌شود و عامل‌های ناموجود فهرست می‌شوند. تمایل یعنی داده چطور به نظر می‌رسد؛ سیگنال خرید/فروش نیست.")}</p>
      <div className="ax-row">
        <input className="ax-in wide" value={inp} onChange={(e) => setInp(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && run()} aria-label="tickers" />
        <button type="button" className="sg-go" disabled={busy} onClick={run}>{busy ? "…" : "▶ " + T("Analyze", "آنالیز")}</button>
      </div>
      <Err e={err} />
      {rs.map((r) => <ProCard key={r.ticker} r={r} T={T} />)}
      <h4 className="ax-h">💼 {T("Portfolio (saved in this browser only)", "پرتفوی (فقط در همین مرورگر ذخیره می‌شود)")}</h4>
      <div className="ax-row">
        <input className="ax-in" placeholder={T("Ticker", "نماد")} value={nt} onChange={(e) => setNt(e.target.value.toUpperCase())} />
        <input className="ax-in" type="number" placeholder={T("Quantity", "تعداد")} value={nq} onChange={(e) => setNq(e.target.value)} />
        <input className="ax-in" type="number" placeholder={T("Cost / unit", "قیمت خرید هر واحد")} value={nc} onChange={(e) => setNc(e.target.value)} />
        <button type="button" className="ax-ghost" onClick={addHold}>＋ {T("Add", "افزودن")}</button>
      </div>
      {hold.length > 0 && (
        <>
          <div className="ax-chips2">{hold.map((h) => <span key={h.t}>{h.t} {h.q} @ {px(h.c)} <button type="button" aria-label="remove" onClick={() => setHold(hold.filter((x) => x.t !== h.t))}>✕</button></span>)}</div>
          <div className="ax-row">
            <select value={per} onChange={(e) => setPer(e.target.value)}>{["daily", "weekly", "monthly", "quarterly", "yearly"].map((k) => <option key={k}>{k}</option>)}</select>
            <button type="button" className="sg-go" disabled={busy} onClick={runPf}>{busy ? "…" : T("Value & analyze portfolio", "ارزش‌گذاری و آنالیز پرتفوی")}</button>
          </div>
        </>
      )}
      {pf && (
        <>
          <div className="ax-cards">
            <div className="ax-card"><span>{T("Cost", "هزینه")}</span><b>{px(pf.tc)}</b></div>
            <div className="ax-card"><span>{T("Value", "ارزش")}</span><b>{px(pf.tv)}</b></div>
            <div className="ax-card"><span>P&L</span><b className={pf.tv >= pf.tc ? "up" : "dn"}>{pc((pf.tv / pf.tc - 1) * 100, 1)}</b></div>
            <div className="ax-card"><span>{per}</span><b>{pc(pf.per, 1)}</b></div>
          </div>
          {pf.warn.length > 0 && <p className="sx-miss">⚠ {T("Concentration > 30%", "تمرکز > ۳۰٪")}: {pf.warn.join(", ")}</p>}
          <p className="ax-small">{T("Lean", "تمایل")}: {pf.lean.FAVORABLE} {T("favorable", "مطلوب")} · {pf.lean.NEUTRAL} {T("neutral", "خنثی")} · {pf.lean.CAUTIOUS} {T("cautious", "محتاطانه")} · {T("Mixed currencies are not converted.", "ارزهای مختلف تبدیل نمی‌شوند.")}</p>
          <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Ticker", "نماد")}</th><th>{T("Qty", "تعداد")}</th><th>{T("Cost", "خرید")}</th><th>{T("Price", "قیمت")}</th><th>{T("Value", "ارزش")}</th><th>P&L</th><th>{T("Lean", "تمایل")}</th></tr></thead>
            <tbody>{pf.rows.map((r: any) => r.err ? <tr key={r.h.t}><td>{r.h.t}</td><td colSpan={6}>{T("no data", "داده نیست")}</td></tr> : <tr key={r.h.t}><td><b>{r.h.t}</b></td><td>{r.h.q}</td><td>{px(r.h.c)}</td><td>{px(r.price)}</td><td>{px(r.value)}</td><td className={r.pnl >= 0 ? "up" : "dn"}>{px(r.pnl)}</td><td className={leanCls(r.an.lean)}>{r.an.lean} {r.an.confidence}%</td></tr>)}</tbody></table></div>
        </>
      )}
    </section>
  );
}

/* ---------- 5. Analysis (technical review + manual fundamentals) ---------- */
function AnSec({ T }: { T: TT }) {
  const [sym, setSym] = usePersist("arcus.an.a.sym", "AAPL");
  const [inp, setInp] = useState(sym);
  const [fund, setFund] = usePersist<Record<string, Fund>>("arcus.an.a.fund", {});
  const [d, setD] = useState<Daily | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const x = await daily(inp, "2y");
      setD(x);
      setSym(ySym(inp));
    } catch (e: any) {
      setErr(e?.message || "failed");
      setD(null);
    } finally {
      setBusy(false);
    }
  };
  const t = useMemo(() => (d && d.bars.length > 30 ? tech(d.bars) : null), [d]);
  const key = ySym(inp), f = fund[key] || {};
  const setF = (k: keyof Fund, v: string) => setFund({ ...fund, [key]: { ...f, [k]: v === "" ? undefined : Number(v) } });
  const rows = fundRows(f);
  const F = (k: keyof Fund, en: string, fa: string, ph: string) => <label className="ax-fl">{T(en, fa)}<input type="number" step="any" placeholder={ph} value={f[k] ?? ""} onChange={(e) => setF(k, e.target.value)} /></label>;
  return (
    <section className="ax-sec">
      <p className="sx-hint">{T("Structured report: trend, momentum, support / resistance, patterns, risk, bull / bear case. Technicals are computed from Yahoo daily candles. Fundamentals can't be fetched in the browser — type the numbers you have (they're saved per ticker) and they're assessed against rule-of-thumb benchmarks.", "گزارش ساختارمند: روند، مومنتوم، حمایت/مقاومت، الگوها، ریسک، سناریوی صعودی/نزولی. تکنیکال از کندل‌های روزانه‌ی Yahoo محاسبه می‌شود. بنیادی‌ها در مرورگر قابل دریافت نیست — اعدادی که داری را وارد کن (برای هر نماد ذخیره می‌شود) و با معیارهای سرانگشتی سنجیده می‌شوند.")}</p>
      <div className="ax-row">
        <input className="ax-in" value={inp} onChange={(e) => setInp(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="AAPL · 0700.HK · 600519.SS" aria-label="ticker" />
        <button type="button" className="sg-go" disabled={busy} onClick={run}>{busy ? "…" : "▶ " + T("Analyze", "آنالیز")}</button>
      </div>
      <Err e={err} />
      {d && t && (
        <article className="ax-rep">
          <h3>{d.meta.name || key} <small>({key}{d.meta.exchange ? " · " + d.meta.exchange : ""})</small></h3>
          <p className="ax-small">{T("Data as of", "داده تا")} {t.asof} · {T("analysis date", "تاریخ آنالیز")} {new Date().toISOString().slice(0, 10)}</p>
          <div className="ax-cards">
            <div className="ax-card"><span>{T("Overall (technical)", "کلی (تکنیکال)")}</span><b className={t.assessment === "Favorable" ? "up" : t.assessment === "Cautious" ? "dn" : ""}>{t.assessment}</b></div>
            <div className="ax-card"><span>{T("Risk level", "سطح ریسک")}</span><b>{t.risk}</b></div>
            <div className="ax-card"><span>{T("Price", "قیمت")}</span><b>{px(t.price)} {d.meta.currency}</b></div>
            <div className="ax-card"><span>1m / 3m / 1y</span><b>{pc(t.r1m == null ? null : t.r1m * 100, 0)} / {pc(t.r3m == null ? null : t.r3m * 100, 0)} / {pc(t.r1y == null ? null : t.r1y * 100, 0)}</b></div>
          </div>
          <h4 className="ax-h">{T("Technical analysis", "تحلیل تکنیکال")}</h4>
          <ul className="ax-ul">
            <li><b>{T("Trend", "روند")}:</b> {t.trend}{t.cross ? " — " + t.cross : ""}</li>
            <li><b>50DMA / 200DMA:</b> {px(t.sma50)} / {px(t.sma200)}</li>
            <li><b>RSI(14):</b> {n2(t.rsi, 0)} {t.rsi != null && (t.rsi > 70 ? `(${T("overbought", "اشباع خرید")})` : t.rsi < 30 ? `(${T("oversold", "اشباع فروش")})` : "")}</li>
            <li><b>MACD:</b> {n2(t.macd.line, 2)} / {T("signal", "سیگنال")} {n2(t.macd.sig, 2)} / {T("hist", "هیستوگرام")} {n2(t.macd.hist, 2)} {t.macd.hist > 0 && t.macd.prevHist <= 0 ? "— " + T("bullish cross just now", "تقاطع صعودی همین الان") : t.macd.hist < 0 && t.macd.prevHist >= 0 ? "— " + T("bearish cross just now", "تقاطع نزولی همین الان") : ""}</li>
            <li><b>{T("52-week range", "محدوده ۵۲ هفته")}:</b> {px(t.lo52)} – {px(t.hi52)} ({n2(t.pos * 100, 0)}%)</li>
            <li><b>{T("Support", "حمایت")}:</b> {t.sup.length ? t.sup.map((l) => `${px(l.price)} (${l.touches}×)`).join(" · ") : "—"}</li>
            <li><b>{T("Resistance", "مقاومت")}:</b> {t.res.length ? t.res.map((l) => `${px(l.price)} (${l.touches}×)`).join(" · ") : "—"}</li>
            <li><b>{T("Patterns", "الگوها")}:</b> {t.patterns.join(" · ")}</li>
          </ul>
          <h4 className="ax-h">{T("Fundamentals (manual input)", "بنیادی (ورودی دستی)")}</h4>
          <div className="ax-fg">{F("pe", "P/E", "P/E", "e.g. 24")}{F("indPe", "Industry P/E", "P/E صنعت", "e.g. 22")}{F("pb", "P/B", "P/B", "e.g. 3.1")}{F("roe", "ROE %", "ROE ٪", "e.g. 18")}{F("growth", "Revenue growth %", "رشد درآمد ٪", "e.g. 9")}{F("margin", "Net margin %", "حاشیه سود خالص ٪", "e.g. 14")}{F("de", "Debt/Equity", "بدهی/حقوق صاحبان", "e.g. 0.8")}</div>
          {rows.length > 0 ? (
            <div className="ax-scroll"><table className="ax-t"><thead><tr><th>{T("Metric", "شاخص")}</th><th>{T("Value", "مقدار")}</th><th>{T("Assessment", "ارزیابی")}</th></tr></thead><tbody>{rows.map((r) => <tr key={r.k}><td>{r.k}</td><td>{r.v}</td><td className={r.tone === "g" ? "up" : r.tone === "r" ? "dn" : ""}>{r.a}</td></tr>)}</tbody></table></div>
          ) : (
            <p className="ax-small">{T("No fundamentals entered — the report above is technical only.", "بنیادی وارد نشده — گزارش بالا فقط تکنیکال است.")}</p>
          )}
          <p className="ax-small">{T("Benchmarks vary by industry; compare with the company's own history and peers.", "معیارها بین صنایع فرق می‌کند؛ با تاریخچه‌ی خود شرکت و رقبا مقایسه کن.")}</p>
          <h4 className="ax-h">{T("Risk factors", "عوامل ریسک")}</h4>
          <ul className="ax-ul">{t.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="ax-two">
            <div><h4 className="ax-h up">{T("Bull case", "سناریوی صعودی")}</h4><ul className="ax-ul">{t.bull.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <div><h4 className="ax-h dn">{T("Bear case", "سناریوی نزولی")}</h4><ul className="ax-ul">{t.bear.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
          </div>
          <p className="ax-small">{T("'Overall' describes how the technical numbers look — it is not a buy/sell instruction and has no price target.", "«کلی» توصیف ظاهر اعداد تکنیکال است — دستور خرید/فروش نیست و هدف قیمتی ندارد.")}</p>
        </article>
      )}
    </section>
  );
}
