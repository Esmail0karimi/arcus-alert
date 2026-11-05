/* Agent tab: one slim bar (on/off, timeframes, minutes before close). While it is on, shortly before each chosen candle closes it scans
   EVERY symbol of the exchanges that are switched on, grades technical signals, announces them once (voice + notification) and lists them. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bi, FA_NAME, TF_SEC, left } from "./agent";
import { setLang, useLang } from "./lang";
import { STRAT_LIST, Sig, evaluate } from "./signals";
import { VoiceControl, speak } from "./voice";
import type { SetupLines } from "./analysispanel";
import type { QCandle } from "./qfex";

export type AgSym = { symbol: string; base: string; ex: string };
type Hist = { at: number; tf: string; en: string; fa: string };
const TFS = ["15m", "1h", "4h", "1d"];
const HTF: Record<string, string | null> = { "15m": "4h", "1h": "1d", "4h": "1d", "1d": null };
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
const sendNotification = (title: string, body: string, tag: string) => {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opt: any = { body, tag, requireInteraction: true, renotify: true };
    const fall = () => {
      try {
        new Notification(title, opt);
      } catch {}
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistration().then((r) => (r ? r.showNotification(title, opt) : fall())).catch(fall);
    else fall();
  } catch {}
};
export const isHot = (s: Sig) => s.grade !== "C" && s.vol.ratio >= 1.3;
type Grp = Sig & { all: Sig[] };
const nOf = (g: any): number => g.all?.length || 1;
const rank = (a: Sig, b: Sig) => Number(nOf(b) > 1) - Number(nOf(a) > 1) || nOf(b) - nOf(a) || Number(isHot(b)) - Number(isHot(a)) || b.score - a.score || b.vol.ratio - a.vol.ratio;
const fmt = (v: number) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const TFN: Record<string, { en: string; fa: string }> = { "15m": { en: "15-minute", fa: "۱۵ دقیقه‌ای" }, "1h": { en: "1-hour", fa: "یک‌ساعته" }, "4h": { en: "4-hour", fa: "۴ ساعته" }, "1d": { en: "daily", fa: "روزانه" } };

function Mini({ s }: { s: Sig }) {
  const bars = s.bars;
  const vals = bars.flatMap((x) => [x[1], x[2]]).concat([s.stop, s.entry, s.t[0]]);
  if (s.level) vals.push(s.level.price);
  const hi = Math.max(...vals), lo = Math.min(...vals), W = 220, H = 74, bw = W / bars.length;
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
  const line = (v: number, c: string, d = "3 3") => <line x1="0" x2={W} y1={y(v)} y2={y(v)} stroke={c} strokeDasharray={d} strokeWidth="1" />;
  return (
    <svg className="sg-mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {s.level && line(s.level.price, "#f2c94c", "5 3")}
      {line(s.entry, "#00dcd2")}
      {line(s.stop, "#ff5c5c")}
      {line(s.t[1], "#3ddc97")}
      {bars.map((b, i) => {
        const up = b[3] >= b[0], c = up ? "#3ddc97" : "#ff5c5c", x = i * bw + bw / 2;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(b[1])} y2={y(b[2])} stroke={c} strokeWidth="1" />
            <rect x={x - bw * 0.32} width={bw * 0.64} y={Math.min(y(b[0]), y(b[3]))} height={Math.max(1, Math.abs(y(b[0]) - y(b[3])))} fill={c} />
          </g>
        );
      })}
    </svg>
  );
}

export function AgentTab(p: {
  syms: AgSym[];
  fetchCandles: (symbol: string, tf: string, signal: AbortSignal) => Promise<QCandle[]>;
  onOpenChart?: (symbol: string, tf: string, setup: SetupLines | null) => boolean;
}) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const L = (x: Bi) => (fa ? x.fa : x.en);
  const [on, setOn] = useState<boolean>(() => jget("arcus.ag2.on", false));
  const [tfs, setTfs] = useState<string[]>(() => jget("arcus.ag2.tfs", ["4h"]));
  const [mins, setMins] = useState<number>(() => jget("arcus.ag2.min", 2));
  const [side, setSide] = useState<"all" | "hot" | "long" | "short">("all");
  const [strat, setStrat] = useState<string>("all");
  const [sigs, setSigs] = useState<Sig[]>(() => jget<Sig[]>("arcus.ag2.sigs", []));
  const [every, setEvery] = useState<number>(() => jget("arcus.ag2.every", 60));
  const [prog, setProg] = useState<{ done: number; total: number; tf: string } | null>(null);
  const [scanned, setScanned] = useState<{ at: number; tf: string; n: number; live: boolean } | null>(() => jget("arcus.ag2.scanned", null));
  const [hist, setHist] = useState<Hist[]>(() => jget("arcus.ag2.hist", []));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState("");
  const [perm, setPerm] = useState<string>(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const ctl = useRef<AbortController | null>(null);
  const done = useRef<Record<string, number>>({});
  const htfCache = useRef<Record<string, { at: number; rows: QCandle[] }>>({});
  const sigsRef = useRef<Sig[]>([]);
  sigsRef.current = sigs;
  const symsRef = useRef(p.syms);
  symsRef.current = p.syms;
  const fetchRef = useRef(p.fetchCandles);
  fetchRef.current = p.fetchCandles;

  useEffect(() => { jset("arcus.ag2.on", on); }, [on]);
  useEffect(() => { jset("arcus.ag2.tfs", tfs); }, [tfs]);
  useEffect(() => { jset("arcus.ag2.min", mins); }, [mins]);
  useEffect(() => { jset("arcus.ag2.every", every); }, [every]);
  useEffect(() => { jset("arcus.ag2.sigs", sigs.slice(0, 150)); }, [sigs]);
  useEffect(() => { jset("arcus.ag2.scanned", scanned); }, [scanned]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const runScan = useCallback((tf: string, live: boolean): Promise<Sig[]> => {
    const p2 = chain.current.then(() => scanOne(tf, live));
    chain.current = p2.catch(() => {});
    return p2;
  }, []);
  const scanOne = useCallback(async (tf: string, live: boolean): Promise<Sig[]> => {
    const c = ctl.current && !ctl.current.signal.aborted ? ctl.current : (ctl.current = new AbortController());
    const list = symsRef.current;
    if (!list.length) return [];
    const out: Sig[] = [];
    let i = 0, finished = 0, got = 0;
    setProg({ done: 0, total: list.length, tf });
    const htfTf = HTF[tf];
    const worker = async () => {
      while (!c.signal.aborted) {
        const k = i++;
        if (k >= list.length) return;
        const s = list[k];
        try {
          const rows = await fetchRef.current(s.symbol, tf, c.signal);
          if (rows.length > 60) {
            got++;
            let h: QCandle[] | null = null;
            if (htfTf) {
              const key = s.symbol + "|" + htfTf, hit = htfCache.current[key];
              if (hit && Date.now() - hit.at < 600000) h = hit.rows;
              else {
                try {
                  h = await fetchRef.current(s.symbol, htfTf, c.signal);
                  htfCache.current[key] = { at: Date.now(), rows: h };
                } catch {}
              }
            }
            const r = evaluate(s.symbol, s.base, tf, rows, h, htfTf, Date.now(), live);
            out.push(...r);
          }
        } catch {}
        finished++;
        if (finished % 4 === 0 || finished === list.length) setProg({ done: finished, total: list.length, tf });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (c.signal.aborted) return out;
    out.sort(rank);
    setSigs((old) => old.filter((x) => x.tf !== tf).concat(out).sort(rank));
    setScanned({ at: Date.now(), tf, n: got, live });
    setProg(null);
    return out;
  }, []);

  const announce = useCallback((tf: string, closeAt: number, res: Sig[], minLeft: number) => {
    const n = new Set(res.map((x) => x.symbol + x.side)).size;
    const en = `${TFN[tf].en} candle closes in ${minLeft} minute${minLeft === 1 ? "" : "s"}. ${n ? `${n} signal${n === 1 ? " is" : "s are"} available from the latest scan.` : "No signals in the latest scan."}`;
    const faT = `کندل ${TFN[tf].fa} تا ${minLeft} دقیقه دیگر بسته می‌شود. ${n ? `${n} سیگنال از اسکن اخیر موجود است.` : "در اسکن اخیر سیگنالی نبود."}`;
    speak("agent", { en, fa: faT });
    const lang = localStorage.getItem("arcus.news.lang") === "fa" || fa;
    sendNotification(lang ? "🧠 ایجنت · " + TFN[tf].fa : "🧠 Agent · " + TFN[tf].en, lang ? faT : en, "ag2-" + tf + closeAt);
    setHist((h) => {
      const nh = [{ at: Date.now(), tf, en, fa: faT }, ...h].slice(0, 20);
      jset("arcus.ag2.hist", nh);
      return nh;
    });
  }, [fa]);

  // schedule: pre-scan a little earlier, announce `mins` minutes before the close (one announcement per timeframe)
  useEffect(() => {
    if (!on) return;
    const t = Date.now();
    for (const tf of tfs) {
      const sec = TF_SEC[tf];
      if (!sec) continue;
      const closeAt = (Math.floor(t / 1000 / sec) + 1) * sec * 1000;
      const key = tf + "|" + closeAt;
      const toClose = closeAt - t;
      if (toClose <= mins * 60000 && toClose > 5000 && done.current[key] !== 2) {
        done.current[key] = 2;
        const minLeft = Math.max(1, Math.round(toClose / 60000));
        announce(tf, closeAt, sigsRef.current.filter((x) => x.tf === tf), minLeft);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, on, tfs, mins]);

  useEffect(() => () => ctl.current?.abort(), []);
  // close-based scans: right after each chosen candle closes, and every `every` minutes
  useEffect(() => {
    if (!on || !p.syms.length) return;
    const t = Date.now();
    for (const tf of tfs) {
      const sec = TF_SEC[tf];
      if (!sec) continue;
      const lastClose = Math.floor(t / 1000 / sec) * sec * 1000;
      const key = tf + "|" + lastClose + "|c";
      if (t - lastClose >= 8000 && t - lastClose < 600000 && !done.current[key]) {
        done.current[key] = 1;
        runScan(tf, false);
      }
    }
    const lastAuto = jget<number>("arcus.ag2.lastAuto", 0);
    if (every > 0 && t - lastAuto >= every * 60000) {
      jset("arcus.ag2.lastAuto", t);
      (async () => { for (const tf of tfs) await runScan(tf, false); })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, on, tfs, every]);

  const toggleTf = (tf: string) => setTfs((a) => (a.includes(tf) ? (a.length > 1 ? a.filter((x) => x !== tf) : a) : [...a, tf]));
  const nextClose = useMemo(() => {
    let best: { tf: string; at: number } | null = null;
    for (const tf of tfs) {
      const sec = TF_SEC[tf];
      const at = (Math.floor(now / 1000 / sec) + 1) * sec * 1000;
      if (!best || at < best.at) best = { tf, at };
    }
    return best;
  }, [now, tfs]);
  const groups = useMemo(() => {
    const m: Record<string, number> = {};
    p.syms.forEach((s) => (m[s.ex] = (m[s.ex] || 0) + 1));
    return Object.entries(m);
  }, [p.syms]);
  const merged: Grp[] = useMemo(() => {
    const m = new Map<string, Sig[]>();
    for (const x of sigs) {
      const k = x.symbol + "|" + x.tf + "|" + x.side;
      m.set(k, (m.get(k) || []).concat(x));
    }
    return Array.from(m.values())
      .map((g) => {
        const top = g.slice().sort((a, b) => b.score - a.score)[0];
        return { ...top, all: g, score: top.score + g.length - 1 } as Grp;
      })
      .sort(rank);
  }, [sigs]);
  const shown = merged.filter((x) => (side === "all" || (side === "hot" ? isHot(x) : x.side === side)) && (strat === "all" || x.all.some((y) => y.strat.id === strat)));
  const trendTxt = (t: string) => (t === "up" ? T("Up", "صعودی") : t === "down" ? T("Down", "نزولی") : T("Sideways", "خنثی"));
  const arrow = (t: string) => (t === "up" ? "▲" : t === "down" ? "▼" : "▬");
  const askPerm = async () => {
    if (!("Notification" in window)) return setPerm("unsupported");
    setPerm(await Notification.requestPermission());
  };
  const open = (s: Sig) => {
    const ok = p.onOpenChart?.(s.symbol, s.tf, { base: s.base, tf: s.tf, side: s.side, sid: "sig", entry: s.entry, stop: s.stop, t: s.t });
    setMsg(ok === false ? T("This symbol is not in the chart list right now.", "این نماد الان در لیست چارت نیست.") : "");
  };

  return (
    <div className="sg" dir={fa ? "rtl" : "ltr"}>
      <div className={"sg-bar" + (on ? " on" : "")}>
        <button type="button" role="switch" aria-checked={on} className={"sg-sw" + (on ? " on" : "")} onClick={() => setOn(!on)} title={T("Turn the Agent on or off", "روشن / خاموش کردن ایجنت")}>
          <i />
        </button>
        <b className="sg-t">🧠 {on ? T("Agent on", "ایجنت روشن") : T("Agent off", "ایجنت خاموش")}</b>
        <span className="sg-chips" role="group" aria-label="Timeframes">
          {TFS.map((tf) => (
            <button key={tf} type="button" className={tfs.includes(tf) ? "on" : ""} onClick={() => toggleTf(tf)}>{tf}</button>
          ))}
        </span>
        <label className="sg-min">{T("Tell me", "اطلاع")}
          <select value={mins} onChange={(e) => setMins(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map((m) => <option key={m} value={m}>{m} {T("min before", "دقیقه قبل")}</option>)}
          </select>
        </label>
        <label className="sg-min">{T("Auto-scan", "اسکن خودکار")}
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            <option value={0}>{T("off", "خاموش")}</option>
            {[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m >= 60 ? m / 60 + " " + T("h", "ساعت") : m + " " + T("min", "دقیقه")}</option>)}
          </select>
        </label>
        {on && nextClose && <span className="sg-cd" title={T("Next close", "بسته‌شدن بعدی")}>⏱ {nextClose.tf} · {left(nextClose.at, now)}</span>}
        <span className="sg-sp" />
        <button type="button" className="sg-go" disabled={!!prog} onClick={async () => { for (const tf of tfs) await runScan(tf, false); }}>{prog ? "…" : "🔍 " + T("Scan now", "اسکن همین حالا")}</button>
        <VoiceControl chan="agent" label={T("Voice", "صدا")} sample={{ en: "4-hour candle closes in 2 minutes. 4 signals are available from the latest scan.", fa: "کندل ۴ ساعته تا ۲ دقیقه دیگر بسته می‌شود. ۴ سیگنال از اسکن اخیر موجود است." }} />
        <button type="button" className="sg-lang" onClick={() => setLang(fa ? "en" : "fa")}>{fa ? "EN" : "فا"}</button>
      </div>
      <div className="sg-sub">
        <span>{T("Checks every symbol of", "همه نمادهای")}: {groups.length ? groups.map(([e, n]) => <em key={e}>{e} {n}</em>) : <em>—</em>} <small>{T("(switch exchanges on/off at the top of the app)", "(صرافی‌ها را از بالای برنامه روشن/خاموش کن)")}</small></span>
        {on && perm === "default" && <button type="button" className="sg-perm" onClick={askPerm}>🔔 {T("Allow notifications", "اجازه‌ی اعلان")}</button>}
        {on && <span className="sg-hint">{T("Scans after each candle close and on the auto-scan timer; works while the app stays open (any tab).", "بعد از بسته‌شدن هر کندل و با تایمر اسکن خودکار کار می‌کند؛ تا وقتی برنامه باز است (در هر تب).")}</span>}
      </div>
      {prog && (
        <div className="sg-prog" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <i style={{ width: (prog.done / Math.max(1, prog.total)) * 100 + "%" }} />
          <span>{T("Scanning", "در حال اسکن")} {prog.tf} · {prog.done}/{prog.total}</span>
        </div>
      )}
      <div className="sg-head">
        <b>{T("Signals", "سیگنال‌ها")} <small>{shown.length}</small></b>
        <span className="sg-chips">
          {(["all", "hot", "long", "short"] as const).map((k) => (
            <button key={k} type="button" className={side === k ? "on" : ""} onClick={() => setSide(k)}>{k === "all" ? T("All", "همه") : k === "hot" ? "🔥 " + T("Momentum", "مومنتوم") : k === "long" ? T("Long", "خرید") : T("Short", "فروش")}</button>
          ))}
        </span>
        <select className="sg-strat" value={strat} onChange={(e) => setStrat(e.target.value)} aria-label="Strategy">
          <option value="all">{T("All strategies", "همه استراتژی‌ها")}</option>
          {STRAT_LIST.map((x) => <option key={x.id} value={x.id}>{L(x.name)} ({sigs.filter((g) => g.strat.id === x.id).length})</option>)}
        </select>
        {scanned && <small className="sg-when">{T("Last scan", "آخرین اسکن")} {new Date(scanned.at).toLocaleTimeString()} · {scanned.tf} · {scanned.n} {T("symbols", "نماد")}{scanned.live ? " · " + T("candle still forming", "کندل هنوز بسته نشده") : ""}</small>}
      </div>
      {msg && <p className="sg-msg">{msg}</p>}
      {!shown.length && <p className="sg-empty">{scanned ? T("No signal passed the checks. That is normal — most of the time there is nothing worth taking.", "هیچ سیگنالی از فیلترها رد نشد. طبیعی است — بیشتر وقت‌ها چیز خوبی نیست.") : T("Turn the Agent on, or press Scan now. Signals appear here for you to review.", "ایجنت را روشن کن یا اسکن بزن. سیگنال‌ها اینجا برای بررسی می‌آیند.")}</p>}
      <div className="sg-list">
        {shown.map((s) => (
          <article key={s.symbol + s.tf + s.strat.id + s.side} className={"sg-card " + (s.side === "long" ? "up" : "dn") + (isHot(s) || s.all.length > 1 ? " hot" : "") + (s.all.length > 1 ? " multi" : "")}>
            <header>
              <b>{fa ? FA_NAME[s.base] || s.base : s.base}</b>
              {s.all.length > 1 && <span className="sg-multi">✅ {T(`${s.all.length} strategies confirm`, `${s.all.length} استراتژی تأیید کرده‌اند`)}</span>}
              {isHot(s) && <span className="sg-hot">🔥 {T("Strong + volume", "قوی + حجم")}</span>}
              <span className={"sg-side " + s.side}>{s.side === "long" ? T("LONG", "خرید") : T("SHORT", "فروش")}</span>
              <span className={"sg-grade g" + s.grade} title={T("Signal grade", "درجه‌ی سیگنال")}>{s.grade}</span>
              <small>{s.tf}{s.forming ? " · " + T("forming", "در حال شکل‌گیری") : ""}</small>
              <em>{fmt(s.price)}</em>
            </header>
            {s.all.map((x) => (
              <p key={x.strat.id} className={"sg-strat-l " + x.strat.id}><b>🏷 {L(x.strat.name)}</b> <span>{L(x.strat.basis)}</span></p>
            ))}
            <div className="sg-body">
              <Mini s={s} />
              <ul className="sg-facts">
                {s.htf && <li className={s.htf.trend}><i>{arrow(s.htf.trend)}</i> {s.htf.tf}: {trendTxt(s.htf.trend)}</li>}
                <li className={s.trend}><i>{arrow(s.trend)}</i> {s.tf}: {trendTxt(s.trend)}</li>
                {s.level && <li className="lvl">📍 {s.level.kind === "support" ? T("Support", "حمایت") : T("Resistance", "مقاومت")} {fmt(s.level.price)} {s.level.state === "broken" ? T("broken", "شکسته شد") : T("retested", "ریتست")}</li>}
                <li>🕯 {L(s.candle.name)}</li>
                <li><i className="sg-vol"><u style={{ width: Math.min(100, (s.vol.ratio / 2) * 100) + "%" }} /></i> {L(s.vol.label)} ×{s.vol.ratio.toFixed(1)}</li>
                <li>RSI <b>{s.rsi.toFixed(0)}</b> · SMA20 {s.sma.above20 ? "▲" : "▼"} SMA50 {s.sma.above50 ? "▲" : "▼"}</li>
              </ul>
            </div>
            <details>
              <summary>{T("Why this signal", "چرا این سیگنال")}</summary>
              <ul>{Array.from(new Set(s.all.flatMap((x) => x.why.map((w) => L(w))))).map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
            <footer>
              <span>{T("Entry", "ورود")} {fmt(s.entry)} · {T("Stop", "حد ضرر")} {fmt(s.stop)} ({s.riskPct.toFixed(1)}%) · 1R {fmt(s.t[0])} · 2R {fmt(s.t[1])} · 3R {fmt(s.t[2])}</span>
              <button type="button" onClick={() => open(s)}>📈 {T("Open chart & analysis", "باز کردن چارت و تحلیل")}</button>
            </footer>
          </article>
        ))}
      </div>
      {hist.length > 0 && (
        <details className="sg-hist">
          <summary>{T("Announcements", "اعلان‌های گذشته")} ({hist.length})</summary>
          {hist.map((h) => <p key={h.at}><small>{new Date(h.at).toLocaleString()}</small> {fa ? h.fa : h.en}</p>)}
        </details>
      )}
      <p className="sg-note">{T("Signals come from standard technical-analysis rules (trend, support/resistance breaks, candle shape, volume, RSI, SMA). They are leads to review, not advice.", "سیگنال‌ها از قواعد استاندارد تحلیل تکنیکال می‌آیند (روند، شکست حمایت/مقاومت، شکل کندل، حجم، RSI، SMA). فقط سرنخ برای بررسی‌اند، نه توصیه.")}</p>
    </div>
  );
}
