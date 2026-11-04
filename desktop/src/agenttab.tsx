/* Agent tab: scans the coins you watch, reads momentum and candle structure, and warns you shortly before a candle closes. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { externalCandles } from "./exchanges";
import { Analysis, Bi, FA_NAME, TF_LIST, TF_SEC, analyze, fmtPrice, left } from "./agent";
import { setLang, useLang } from "./lang";
import type { QCandle } from "./qfex";

type Rule = { id: string; base: string; tf: string; min: number; minScore: number };
type Hist = { id: string; at: number; base: string; tf: string; title: string; body: string; score: number };
const DEF_WATCH = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB", "LINK"];
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
const beep = () => {
  try {
    const A = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.22].forEach((d) => {
      const o = A.createOscillator(), g = A.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, A.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.25, A.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + d + 0.18);
      o.connect(g).connect(A.destination);
      o.start(A.currentTime + d);
      o.stop(A.currentTime + d + 0.2);
    });
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

export function AgentTab(p: { bases: string[] }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const L = (x: Bi) => (fa ? x.fa : x.en);
  const [tf, setTf] = useState(() => localStorage.getItem("arcus.ag.tf") || "4h");
  const [watch, setWatch] = useState<string[]>(() => jget("arcus.ag.watch.v1", DEF_WATCH));
  const [rules, setRules] = useState<Rule[]>(() => jget("arcus.ag.rules.v1", [{ id: "r1", base: "*", tf: "4h", min: 2, minScore: 25 }]));
  const [hist, setHist] = useState<Hist[]>(() => jget("arcus.ag.hist.v1", []));
  const [sel, setSel] = useState<string>("");
  const [data, setData] = useState<Record<string, { rows: QCandle[]; at: number; src: string }>>({});
  const [now, setNow] = useState(Date.now());
  const [add, setAdd] = useState("");
  const [perm, setPerm] = useState<string>(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const fired = useRef<Record<string, number>>(jget("arcus.ag.fired.v1", {}));
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => jset("arcus.ag.watch.v1", watch), [watch]);
  useEffect(() => jset("arcus.ag.rules.v1", rules), [rules]);
  useEffect(() => jset("arcus.ag.hist.v1", hist), [hist]);
  useEffect(() => {
    try {
      localStorage.setItem("arcus.ag.tf", tf);
    } catch {}
  }, [tf]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async (base: string, frame: string, signal?: AbortSignal) => {
    const r = await externalCandles(base, frame, signal);
    if (signal?.aborted) return null;
    if (r.rows.length > 1) {
      const v = { rows: r.rows, at: Date.now(), src: r.source };
      dataRef.current = { ...dataRef.current, [base + "|" + frame]: v };
      setData((d) => ({ ...d, [base + "|" + frame]: v }));
      return v;
    }
    return null;
  }, []);

  // keep the chosen timeframe fresh for every watched coin (3 at a time), plus all timeframes for the selected coin
  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    const run = async () => {
      setBusy(true);
      const jobs: [string, string][] = watch.map((w) => [w, tf]);
      if (sel) for (const f of TF_LIST) if (f !== tf) jobs.push([sel, f]);
      const bad: string[] = [];
      let i = 0;
      const worker = async () => {
        while (alive && i < jobs.length) {
          const [b, f] = jobs[i++];
          try {
            if (!(await load(b, f, ctl.signal)) && f === tf) bad.push(b);
          } catch {
            if (f === tf) bad.push(b);
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (alive) {
        setFailed(bad);
        setBusy(false);
      }
    };
    run();
    const id = window.setInterval(run, 30000);
    return () => {
      alive = false;
      ctl.abort();
      window.clearInterval(id);
    };
  }, [watch, tf, sel, load]);

  const tick = Math.floor(now / 10000);
  const results = useMemo(() => {
    const out: Analysis[] = [];
    for (const w of watch) {
      const d = data[w + "|" + tf];
      const a = d ? analyze(w, tf, d.rows, Date.now()) : null;
      if (a) out.push(a);
    }
    return out.sort((x, y) => Math.abs(y.score) - Math.abs(x.score));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, watch, tf, tick]);
  const selected = sel || results[0]?.base || "";
  useEffect(() => {
    if (!sel && results[0]) setSel(results[0].base);
  }, [sel, results]);
  const detail = results.find((r) => r.base === selected) || null;
  const multi = useMemo(
    () => TF_LIST.map((f) => ({ f, a: data[selected + "|" + f] ? analyze(selected, f, data[selected + "|" + f].rows, Date.now()) : null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selected, tick],
  );

  // pre-close alerts: checked every few seconds while this page is open
  useEffect(() => {
    const check = async () => {
      const t = Date.now();
      for (const r of rules) {
        const span = TF_SEC[r.tf];
        if (!span) continue;
        const closeAt = (Math.floor(t / 1000 / span) + 1) * span * 1000;
        const ms = closeAt - t;
        if (ms > r.min * 60000 || ms < 3000) continue;
        const targets = r.base === "*" ? watch : [r.base];
        for (const base of targets) {
          const key = r.id + "|" + base + "|" + r.tf + "|" + closeAt;
          if (fired.current[key]) continue;
          fired.current[key] = t;
          const cut = t - 3 * 86400000;
          for (const k of Object.keys(fired.current)) if (fired.current[k] < cut) delete fired.current[k];
          jset("arcus.ag.fired.v1", fired.current);
          let rows = dataRef.current[base + "|" + r.tf]?.rows;
          try {
            const v = await load(base, r.tf);
            if (v) rows = v.rows;
          } catch {}
          const a = rows ? analyze(base, r.tf, rows, Date.now()) : null;
          if (!a || (r.base === "*" && Math.abs(a.score) < r.minScore)) continue;
          const mins = Math.max(1, Math.round((closeAt - Date.now()) / 60000));
          const nm = FA_NAME[base] || base;
          const lang = localStorage.getItem("arcus.news.lang") === "fa";
          const title = lang ? nm + " · " + mins + " دقیقه تا بسته‌شدن کندل " + r.tf : base + " · " + r.tf + " candle closes in " + mins + " min";
          const body = (lang ? a.label.fa + " (" + a.score + ")\n" + a.candleLines[0].fa + "\n" + a.plan.fa : a.label.en + " (" + a.score + ")\n" + a.candleLines[0].en + "\n" + a.plan.en);
          sendNotification(title, body, "ag-" + key);
          beep();
          setHist((h) => [{ id: key, at: Date.now(), base, tf: r.tf, title, body, score: a.score }, ...h].slice(0, 40));
        }
      }
    };
    const id = window.setInterval(check, 4000);
    check();
    return () => window.clearInterval(id);
  }, [rules, watch, load]);

  const enableAlerts = async () => {
    if (!("Notification" in window)) return setPerm("unsupported");
    setPerm(await Notification.requestPermission());
  };
  const addCoin = (v: string) => {
    const c = v.trim().toUpperCase().replace(/[-/ ]?(USD|USDT|PERP)$/, "");
    if (!/^[A-Z0-9]{2,12}$/.test(c) || watch.includes(c)) return setAdd("");
    setWatch([...watch, c]);
    setSel(c);
    setAdd("");
  };
  const addRule = () => setRules([...rules, { id: "r" + Date.now(), base: "*", tf: "1h", min: 2, minScore: 25 }]);
  const patch = (id: string, v: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...v } : r)));
  const col = (a: { bias: string }) => (a.bias === "bull" ? "ag-bull" : a.bias === "bear" ? "ag-bear" : "ag-flat");
  const nm = (b: string) => (fa ? FA_NAME[b] || b : b);

  const Gauge = ({ v }: { v: number }) => (
    <span className="ag-gauge" aria-label={"score " + v}>
      <i className="mid" />
      <i className={"fill " + (v >= 0 ? "pos" : "neg")} style={v >= 0 ? { left: "50%", width: v / 2 + "%" } : { right: "50%", width: -v / 2 + "%" }} />
    </span>
  );
  const Candle = ({ a }: { a: Analysis }) => {
    const c = a.candle, lo = c.l, hi = c.h, r = hi - lo || 1, y = (v: number) => 8 + ((hi - v) / r) * 104;
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    const color = c.green ? "#3ddc97" : "#ff5c5c";
    return (
      <svg className="ag-candle" viewBox="0 0 70 120" role="img" aria-label="Candle shape">
        <line x1="35" x2="35" y1="8" y2="112" stroke={color} strokeWidth="2" />
        <rect x="21" width="28" y={top} height={Math.max(2, bot - top)} rx="2" fill={color} />
        <text x="2" y="12" className="t">H</text>
        <text x="2" y="116" className="t">L</text>
      </svg>
    );
  };

  return (
    <div className={"ag-tab" + (fa ? " fa" : "")} dir={fa ? "rtl" : "ltr"}>
      <div className="heading">
        <div>
          <small>{T("TRADING AGENT", "ایجنت معاملاتی")}</small>
          <h1>{T("Setups & candle alerts", "فرصت‌ها و هشدار کندل")}</h1>
        </div>
        <div className="news-head-btns">
          <button className="secondary" onClick={() => setLang(fa ? "en" : "fa")} title="English / فارسی">{fa ? "EN" : "فا"}</button>
          <button className={"secondary" + (perm === "granted" ? " on" : "")} onClick={enableAlerts} disabled={perm === "granted" || perm === "unsupported"}>
            {perm === "granted" ? T("🔔 Alerts on", "🔔 هشدار فعال") : perm === "denied" ? T("Alerts blocked in browser", "هشدار در مرورگر مسدود است") : T("🔔 Enable alerts", "🔔 فعال‌سازی هشدار")}
          </button>
        </div>
      </div>
      <p className="ag-lead">{T("It reads trend, momentum and the shape of the forming candle for every coin you watch, ranks them, and tells you what to watch before the candle closes. Rule-based analysis, not financial advice.", "برای هر ارزی که دنبال می‌کنی روند، مومنتوم و شکل کندلِ در حال تشکیل را می‌خواند، رتبه‌بندی می‌کند و می‌گوید پیش از بسته‌شدن کندل به چه چیزی نگاه کنی. تحلیل قاعده‌محور است و توصیه‌ی مالی نیست.")}</p>

      <div className="ag-bar">
        <div className="ob-tfs" role="tablist" aria-label="Timeframe">
          {TF_LIST.map((f) => (
            <button key={f} role="tab" aria-selected={tf === f} className={tf === f ? "on" : ""} onClick={() => setTf(f)}>{f}</button>
          ))}
        </div>
        <form className="ag-add" onSubmit={(e) => { e.preventDefault(); addCoin(add); }}>
          <input list="ag-bases" value={add} onChange={(e) => setAdd(e.target.value.toUpperCase())} placeholder={T("Add coin…", "افزودن ارز…")} aria-label="Add coin" />
          <datalist id="ag-bases">{p.bases.slice(0, 500).map((b) => <option key={b} value={b} />)}</datalist>
          <button className="secondary" type="submit">＋</button>
        </form>
        <span className="ag-stat">{busy ? T("Scanning…", "در حال بررسی…") : T("Updated", "به‌روز شد") + " " + new Date(Math.max(0, ...Object.values(data).map((d) => d.at))).toLocaleTimeString()}</span>
      </div>
      {failed.length > 0 && <div className="ag-warn">{T("No candle data for: ", "داده‌ی کندل پیدا نشد برای: ")}{failed.join(", ")}</div>}

      <div className="ag-grid">
        <div className="ag-list">
          {!results.length && <div className="empty">{busy ? T("Reading candles…", "در حال خواندن کندل‌ها…") : T("No data yet. Check your connection or add a coin.", "هنوز داده‌ای نیست. اتصال را بررسی کن یا ارز اضافه کن.")}</div>}
          {results.map((a) => (
            <button key={a.base} className={"ag-card " + col(a) + (a.base === selected ? " on" : "")} onClick={() => setSel(a.base)}>
              <span className="ag-top">
                <b>{nm(a.base)}</b>
                <em>{fmtPrice(a.price)}</em>
                <span className="ag-left" title={T("Time until this candle closes", "زمان تا بسته‌شدن کندل")}>⏱ {left(a.closeAt, now)}</span>
              </span>
              <Gauge v={a.score} />
              <span className="ag-sc"><strong>{a.score > 0 ? "+" : ""}{a.score}</strong> {L(a.label)}</span>
              <span className="ag-set">{L(a.setup)}</span>
              <span className="ag-x" onClick={(e) => { e.stopPropagation(); setWatch(watch.filter((w) => w !== a.base)); }} role="button" aria-label="Remove" title={T("Remove from list", "حذف از فهرست")}>✕</span>
            </button>
          ))}
        </div>

        {detail && (
          <section className={"ag-detail " + col(detail)}>
            <div className="ag-dh">
              <div>
                <h2>{nm(detail.base)} <small>{detail.tf}</small></h2>
                <p>{L(detail.headline)}</p>
              </div>
              <div className="ag-clock" title={T("Time until this candle closes", "زمان تا بسته‌شدن کندل")}>
                <small>{T("candle closes in", "بسته‌شدن کندل تا")}</small>
                <b>{left(detail.closeAt, now)}</b>
              </div>
            </div>
            <div className="ag-mtf" aria-label="Other timeframes">
              {multi.map(({ f, a }) => (
                <button key={f} className={"ag-m " + (a ? col(a) : "") + (f === tf ? " on" : "")} onClick={() => setTf(f)} title={a ? L(a.label) : ""}>
                  <small>{f}</small>
                  <b>{a ? (a.score > 0 ? "+" : "") + a.score : "…"}</b>
                </button>
              ))}
            </div>
            <div className="ag-cols">
              <div className="ag-cn">
                <Candle a={detail} />
                <dl>
                  <dt>O</dt><dd>{fmtPrice(detail.candle.o)}</dd>
                  <dt>H</dt><dd>{fmtPrice(detail.candle.h)}</dd>
                  <dt>L</dt><dd>{fmtPrice(detail.candle.l)}</dd>
                  <dt>C</dt><dd>{fmtPrice(detail.candle.c)}</dd>
                </dl>
              </div>
              <div className="ag-tx">
                <h3>{T("Candle structure", "ساختار کندل")}</h3>
                <ul>{detail.candleLines.map((x, i) => <li key={i}>{L(x)}</li>)}{detail.patterns.map((x, i) => <li key={"p" + i} className="pat">{L(x)}</li>)}</ul>
                <h3>{T("Trend & levels", "روند و سطوح")}</h3>
                <ul>
                  <li>{L(detail.structure)}</li>
                  <li>{T("Price vs EMA20 / EMA50: ", "قیمت نسبت به EMA20 و EMA50: ")}{detail.price > detail.ind.ema20 ? T("above", "بالا") : T("below", "پایین")} {fmtPrice(detail.ind.ema20)} / {detail.price > detail.ind.ema50 ? T("above", "بالا") : T("below", "پایین")} {fmtPrice(detail.ind.ema50)}</li>
                  <li>RSI {detail.ind.rsi.toFixed(0)} · MACD {detail.ind.hist > 0 ? T("positive", "مثبت") : T("negative", "منفی")} · ATR {fmtPrice(detail.ind.atr)}</li>
                  <li>{T("Resistance ", "مقاومت ")}{detail.res ? fmtPrice(detail.res) : "—"} · {T("Support ", "حمایت ")}{detail.sup ? fmtPrice(detail.sup) : "—"}</li>
                </ul>
              </div>
            </div>
            <div className="ag-sc2">
              <div className="up"><h4>▲ {T("If buyers win", "اگر خریداران برنده شوند")}</h4><p>{L(detail.bull)}</p></div>
              <div className="dn"><h4>▼ {T("If sellers win", "اگر فروشندگان برنده شوند")}</h4><p>{L(detail.bear)}</p></div>
            </div>
            <div className="ag-plan"><h4>{T("Before the close", "پیش از بسته‌شدن کندل")}</h4><p>{L(detail.plan)}</p></div>
            <div className="ag-risk"><h4>{T("Risks", "ریسک‌ها")}</h4><ul>{detail.risks.map((x, i) => <li key={i}>{L(x)}</li>)}</ul></div>
          </section>
        )}
      </div>

      <div className="ag-lower">
        <section className="ag-rules">
          <h3>{T("Pre-close alerts", "هشدار پیش از بسته‌شدن کندل")}</h3>
          <p className="muted">{T("You get a notification with the analysis a few minutes before the candle closes. Works while this app is open in a browser tab or the desktop app.", "چند دقیقه پیش از بسته‌شدن کندل، اعلان همراه با تحلیل می‌گیری. تا وقتی اپ در یک تب مرورگر یا برنامه‌ی دسکتاپ باز باشد کار می‌کند.")}</p>
          {rules.map((r) => (
            <div className="ag-rule" key={r.id}>
              <select value={r.base} onChange={(e) => patch(r.id, { base: e.target.value })} aria-label="Coin">
                <option value="*">{T("All watched coins", "همه‌ی ارزهای فهرست")}</option>
                {watch.map((w) => <option key={w} value={w}>{nm(w)}</option>)}
              </select>
              <select value={r.tf} onChange={(e) => patch(r.id, { tf: e.target.value })} aria-label="Timeframe">
                {TF_LIST.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={r.min} onChange={(e) => patch(r.id, { min: Number(e.target.value) })} aria-label="Minutes before">
                {[1, 2, 3, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} {T("min before", "دقیقه قبل")}</option>)}
              </select>
              {r.base === "*" && (
                <select value={r.minScore} onChange={(e) => patch(r.id, { minScore: Number(e.target.value) })} aria-label="Minimum score">
                  <option value={0}>{T("any score", "هر امتیازی")}</option>
                  <option value={25}>{T("score ≥ 25", "امتیاز ≥ ۲۵")}</option>
                  <option value={50}>{T("score ≥ 50", "امتیاز ≥ ۵۰")}</option>
                </select>
              )}
              <button className="secondary" onClick={() => setRules(rules.filter((x) => x.id !== r.id))} aria-label="Delete rule">✕</button>
            </div>
          ))}
          <button className="secondary" onClick={addRule}>＋ {T("Add alert", "افزودن هشدار")}</button>
        </section>
        <section className="ag-hist">
          <h3>{T("Recent alerts", "هشدارهای اخیر")}</h3>
          {!hist.length && <p className="muted">{T("None yet.", "هنوز هشداری نیامده.")}</p>}
          {hist.slice(0, 8).map((h) => (
            <button key={h.id} className="ag-h" onClick={() => { setSel(h.base); setTf(h.tf); }}>
              <b>{h.title}</b>
              <span>{h.body.split("\n")[0]}</span>
              <em>{new Date(h.at).toLocaleString()}</em>
            </button>
          ))}
        </section>
      </div>
      <p className="muted ag-foot">{T("Candle times follow UTC, like most exchanges. Scores are a summary of EMA trend, RSI, MACD, recent move, swing structure and the current candle; they describe what price is doing, not what it will do.", "زمان کندل‌ها مثل بیشتر صرافی‌ها بر اساس UTC است. امتیاز خلاصه‌ی روند EMA، RSI، MACD، حرکت اخیر، ساختار سقف و کف و کندل جاری است؛ توضیح می‌دهد قیمت چه می‌کند، نه اینکه چه خواهد کرد.")}</p>
    </div>
  );
}
