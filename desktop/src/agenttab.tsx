/* Agent tab — multi-market momentum scanner (Dow theory + price action).
   Stage 1: live prices keep the watchlist and the open signals up to date.
   Stage 2: after each 15-minute candle closes, every symbol of the switched-on exchanges is re-analysed on CLOSED candles only
   (1D trend/levels -> 4H structure/zones -> 1H trigger -> 15M confirmation). The rules live in engine.ts. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bi, FA_NAME, TF_SEC } from "./agent";
import { Cfg, DEF_CFG, STRATS, Sig2, StratId, SymInfo, analyzeSymbol, closedRows, trendTxt } from "./engine";
import { setLang, useLang } from "./lang";
import { VoiceControl, getVoice, speak } from "./voice";
import type { SetupLines } from "./analysispanel";
import type { QCandle } from "./qfex";

export type AgSym = { symbol: string; base: string; ex: string; market: string };
type Hist = { key: string; symbol: string; base: string; side: "long" | "short"; strat: StratId; tf: string; entry: number; stop: number; tp: number; rr: number; score: number; time: number; candleTime: number; st: "open" | "win" | "loss" | "exp"; r: number; auto?: boolean };
type Toast = { id: number; text: string; side?: "long" | "short" };
type View = "ready" | "watch" | "long" | "short" | "market" | "history" | "settings";
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
const fmt = (v: number) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const keyOf = (s: Sig2) => [s.symbol, s.strat, s.side, s.tf, s.candleTime].join("|");
const TFS: ("1d" | "4h" | "1h" | "15m")[] = ["1d", "4h", "1h", "15m"];

function Ladder({ s, live }: { s: Sig2; live: number }) {
  const vals = [s.stop, s.entry, s.tp, live];
  const lo = Math.min(...vals), hi = Math.max(...vals), W = 300, H = 46, x = (v: number) => 8 + ((v - lo) / (hi - lo || 1)) * (W - 16);
  const L = s.side === "long";
  return (
    <svg className="sx-lad" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x={Math.min(x(s.stop), x(s.entry))} y="16" width={Math.abs(x(s.entry) - x(s.stop))} height="10" rx="3" fill="rgba(255,92,92,.28)" />
      <rect x={Math.min(x(s.entry), x(s.tp))} y="16" width={Math.abs(x(s.tp) - x(s.entry))} height="10" rx="3" fill="rgba(61,220,151,.28)" />
      {[[s.stop, "#ff5c5c", "SL"], [s.entry, "#00dcd2", "E"], [s.tp, "#3ddc97", "TP"]].map(([v, c, t]) => (
        <g key={String(t)}>
          <line x1={x(v as number)} x2={x(v as number)} y1="10" y2="32" stroke={c as string} strokeWidth="2" />
          <text x={x(v as number)} y="8" textAnchor="middle" fontSize="9" fontWeight="700" fill={c as string}>{t as string}</text>
        </g>
      ))}
      <path d={`M${x(live)} 44 l-5 -8 h10 z`} fill="#fff" />
      <text x={x(live)} y={H - 1} textAnchor="middle" fontSize="8" fill="#9fb5cf" style={{ display: "none" }}>{L ? "▲" : "▼"}</text>
    </svg>
  );
}

export function AgentTab(p: {
  priceOf?: (symbol: string) => number | undefined;
  syms: AgSym[];
  fetchCandles: (symbol: string, tf: string, signal: AbortSignal) => Promise<QCandle[]>;
  onOpenChart?: (symbol: string, tf: string, setup: SetupLines | null) => boolean;
}) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const L = (x: Bi) => (fa ? x.fa : x.en);
  const [on, setOn] = useState<boolean>(() => jget("arcus.ag3.on", false));
  const [cfg, setCfg] = useState<Cfg>(() => {
    const st = jget<Partial<Cfg> & { ver?: number }>("arcus.ag3.cfg", {});
    const keep = st.ver === 2;
    return { ...DEF_CFG, ...(keep ? st : {}), on: { ...DEF_CFG.on, ...(keep ? st.on || {} : {}) }, minRR: 2, minScore: 70 };
  });
  const [acct, setAcct] = useState<number>(() => jget("arcus.ag3.acct", 1000));
  const [riskPct, setRiskPct] = useState<number>(() => jget("arcus.ag3.risk", 1));
  const [soundOn, setSoundOn] = useState<boolean>(() => jget("arcus.ag3.sound", true));
  const [notifOn, setNotifOn] = useState<boolean>(() => jget("arcus.ag3.notif", true));
  const [view, setView] = useState<View>("ready");
  const [ready, setReady] = useState<Sig2[]>(() => jget("arcus.ag3.ready", []));
  const [watch, setWatch] = useState<Sig2[]>(() => jget("arcus.ag3.watch", []));
  const [infos, setInfos] = useState<SymInfo[]>([]);
  const [meta, setMeta] = useState<{ at: number; n: number; ms: number; failed: number } | null>(() => jget("arcus.ag3.meta", null));
  const [hist, setHist] = useState<Hist[]>(() => jget("arcus.ag3.hist", []));
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [perm, setPerm] = useState<string>(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const [msg, setMsg] = useState("");
  const symsRef = useRef(p.syms);
  symsRef.current = p.syms;
  const fetchRef = useRef(p.fetchCandles);
  fetchRef.current = p.fetchCandles;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const histRef = useRef(hist);
  histRef.current = hist;
  const [autoJ, setAutoJ] = useState<boolean>(() => jget("arcus.ag3.autoj", true));
  const autoRef = useRef(autoJ);
  autoRef.current = autoJ;
  useEffect(() => { jset("arcus.ag3.autoj", autoJ); }, [autoJ]);
  const soundRef = useRef(soundOn), notifRef = useRef(notifOn), faRef = useRef(fa);
  soundRef.current = soundOn;
  notifRef.current = notifOn;
  faRef.current = fa;
  const cache = useRef<Map<string, { rows: QCandle[] | null; until: number }>>(new Map());
  const busy = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  const lastKey = useRef<number>(jget("arcus.ag3.lastKey", 0));

  useEffect(() => { jset("arcus.ag3.on", on); }, [on]);
  useEffect(() => { jset("arcus.ag3.cfg", { ...cfg, ver: 2 }); }, [cfg]);
  useEffect(() => { jset("arcus.ag3.acct", acct); jset("arcus.ag3.risk", riskPct); jset("arcus.ag3.sound", soundOn); jset("arcus.ag3.notif", notifOn); }, [acct, riskPct, soundOn, notifOn]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => ctl.current?.abort(), []);

  const getRows = async (sym: string, tf: "1d" | "4h" | "1h" | "15m", sig: AbortSignal): Promise<QCandle[] | null> => {
    const k = sym + "|" + tf, t = Date.now(), hit = cache.current.get(k);
    if (hit && hit.until > t) return hit.rows;
    const sec = TF_SEC[tf];
    try {
      const rows = await fetchRef.current(sym, tf, sig);
      const until = (Math.floor(t / 1000 / sec) + 1) * sec * 1000 + 3000;
      cache.current.set(k, { rows, until });
      return rows;
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      cache.current.set(k, { rows: null, until: t + 60000 });
      return null;
    }
  };

  const runScan = useCallback(async () => {
    if (busy.current) return;
    const list = symsRef.current;
    if (!list.length) return;
    busy.current = true;
    const c = (ctl.current = new AbortController());
    const t0 = Date.now();
    const cf = cfgRef.current;
    const allSigs: Sig2[] = [], allInfo: SymInfo[] = [];
    let i = 0, done = 0, failed = 0;
    const open: Hist[] = histRef.current.map((h) => ({ ...h }));
    setProg({ done: 0, total: list.length });
    const worker = async () => {
      while (!c.signal.aborted) {
        const k = i++;
        if (k >= list.length) return;
        const s = list[k];
        try {
          const [d1, h4, h1] = await Promise.all([getRows(s.symbol, "1d", c.signal), getRows(s.symbol, "4h", c.signal), getRows(s.symbol, "1h", c.signal)]);
          const data: any = {};
          if (d1) data["1d"] = d1;
          if (h4) data["4h"] = h4;
          if (h1) data["1h"] = h1;
          let r = analyzeSymbol(s, data, Date.now(), cf);
          if (r.sigs.length || r.info.need15) {
            const m15 = await getRows(s.symbol, "15m", c.signal);
            if (m15) {
              data["15m"] = m15;
              r = analyzeSymbol(s, data, Date.now(), cf);
            }
          }
          if (!d1 || !h4 || !h1) failed++;
          allInfo.push(r.info);
          allSigs.push(...r.sigs);
          // resolve outcomes of signals already in the history with the freshly closed 1H candles
          if (h1) {
            for (const e of open) {
              if (e.st !== "open" || e.symbol !== s.symbol) continue;
              const sec = TF_SEC[e.tf] || 3600, R = Math.abs(e.entry - e.stop) || 1, dir = e.side === "long" ? 1 : -1;
              let q = 0;
              for (const cd of closedRows(h1, "1h", Date.now())) {
                if (cd.time < e.candleTime + sec) continue;
                q++;
                const sh = dir > 0 ? cd.low <= e.stop : cd.high >= e.stop, th = dir > 0 ? cd.high >= e.tp : cd.low <= e.tp;
                if (sh) { e.st = "loss"; e.r = -1; break; }
                if (th) { e.st = "win"; e.r = e.rr; break; }
                if (q >= 48) { e.st = "exp"; e.r = Math.max(-1, Math.min(e.rr, ((cd.close - e.entry) / R) * dir)); break; }
              }
            }
          }
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          failed++;
        }
        done++;
        if (done % 4 === 0 || done === list.length) setProg({ done, total: list.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: 8 }, worker));
    } finally {
      busy.current = false;
      setProg(null);
    }
    if (c.signal.aborted) return;
    const rd = allSigs.filter((x) => x.status === "ready").sort((a, b) => b.score - a.score);
    const wt = allSigs.filter((x) => x.status === "watch").sort((a, b) => b.score - a.score);
    setReady(rd);
    setWatch(wt);
    setInfos(allInfo);
    const mt = { at: Date.now(), n: list.length, ms: Date.now() - t0, failed };
    setMeta(mt);
    jset("arcus.ag3.ready", rd.slice(0, 120));
    jset("arcus.ag3.watch", wt.slice(0, 120));
    jset("arcus.ag3.meta", mt);
    // new READY signals (never seen before) -> history + alerts. The same candle never alerts twice.
    const seen = new Set<string>(jget<string[]>("arcus.ag3.seen", []));
    const fresh = rd.filter((x) => !seen.has(keyOf(x)));
    fresh.forEach((x) => seen.add(keyOf(x)));
    jset("arcus.ag3.seen", Array.from(seen).slice(-600));
    // READY signals go into the journal automatically (switchable in Settings) so their outcome is tracked; watch items never do
    if (autoRef.current) {
      const have = new Set(open.map((h) => h.key));
      for (const x of rd) if (!have.has(keyOf(x))) open.push({ key: keyOf(x), symbol: x.symbol, base: x.base, side: x.side, strat: x.strat, tf: x.tf, entry: x.entry, stop: x.stop, tp: x.tp, rr: x.rr, score: x.score, time: x.time, candleTime: x.candleTime, st: "open", r: 0, auto: true });
    }
    const nh = open.slice(-300);
    setHist(nh);
    jset("arcus.ag3.hist", nh);
    if (fresh.length) {
      const f = faRef.current;
      const nm = (x: Sig2) => (f ? FA_NAME[x.base] || x.base : x.base);
      const line = fresh.slice(0, 4).map((x) => `${nm(x)} ${x.side === "long" ? (f ? "خرید" : "LONG") : f ? "فروش" : "SHORT"} (${x.score})`).join(" · ");
      setToasts((t) => t.concat(fresh.slice(0, 4).map((x, q) => ({ id: Date.now() + q, text: `${nm(x)} ${x.side === "long" ? "LONG" : "SHORT"} · ${L2(x.strat, f)} · ${x.score}/100 · R:R ${x.rr.toFixed(1)}`, side: x.side }))).slice(-6));
      if (soundRef.current) speak("agent", { en: `${fresh.length} new ready ${fresh.length === 1 ? "signal" : "signals"}.`, fa: `${fresh.length} سیگنال آماده‌ی معامله‌ی جدید.` });
      if (notifRef.current) sendNotification(f ? "✅ سیگنال آماده‌ی معامله" : "✅ Ready to trade", line, "ag3-" + Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const L2 = (id: StratId, f: boolean) => (f ? STRATS[id].name.fa : STRATS[id].name.en);

  // Stage 2 schedule: once after every 15-minute candle close
  useEffect(() => {
    if (!on || !p.syms.length || busy.current) return;
    const t = Date.now(), lastClose = Math.floor(t / 1000 / 900) * 900 * 1000;
    if (lastKey.current !== lastClose && (t - lastClose >= 8000 || lastKey.current === 0)) {
      lastKey.current = lastClose;
      jset("arcus.ag3.lastKey", lastClose);
      runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, on, p.syms.length]);

  // Stage 1: live prices — drop signals that are spent, keep distances fresh
  const liveOf = (s: Sig2) => {
    const lp = p.priceOf?.(s.symbol);
    return lp && lp > 0 && Math.abs(lp - s.entry) / s.entry < 0.2 ? lp : s.price;
  };
  const alive = (s: Sig2) => {
    const lp = liveOf(s), Lg = s.side === "long";
    return !(Lg ? lp <= s.stop || lp >= s.tp : lp >= s.stop || lp <= s.tp);
  };
  const readyLive = useMemo(() => ready.filter(alive), [ready, Math.floor(now / 5000)]);
  const droppedN = ready.length - readyLive.length;
  const sizeOf = (s: Sig2) => {
    const risk$ = (acct * Math.min(5, riskPct)) / 100, qty = risk$ / Math.max(1e-12, Math.abs(s.entry - s.stop));
    return { risk$, qty, notional: qty * s.entry };
  };
  const open = (s: Sig2) => {
    const sec = TF_SEC[s.tf] || 3600;
    const setup: SetupLines = {
      base: s.base, tf: s.tf, side: s.side, sid: "sig", entry: s.entry, stop: s.stop, t: [s.tp], labels: ["TP"],
      sig: { strats: [{ name: STRATS[s.strat].name, basis: STRATS[s.strat].basis }], why: s.why, grade: String(s.score), score: s.score, rr: s.rr, closed: new Date((s.candleTime + sec) * 1000).toLocaleTimeString() },
    };
    const ok = p.onOpenChart?.(s.symbol, s.tf, setup);
    setMsg(ok === false ? T("This symbol is not in the chart list right now.", "این نماد الان در لیست چارت نیست.") : "");
  };
  const inJ = (x: Sig2) => hist.some((h) => h.key === keyOf(x));
  const addJ = (x: Sig2) => {
    if (x.status2 || inJ(x)) return;
    const nh = hist.concat({ key: keyOf(x), symbol: x.symbol, base: x.base, side: x.side, strat: x.strat, tf: x.tf, entry: x.entry, stop: x.stop, tp: x.tp, rr: x.rr, score: x.score, time: x.time, candleTime: x.candleTime, st: "open", r: 0 }).slice(-300);
    setHist(nh);
    jset("arcus.ag3.hist", nh);
  };
  const delJ = (k: string) => {
    const nh = hist.filter((h) => h.key !== k);
    setHist(nh);
    jset("arcus.ag3.hist", nh);
  };
  const askPerm = async () => {
    if (!("Notification" in window)) return setPerm("unsupported");
    setPerm(await Notification.requestPermission());
  };
  const toggleStrat = (id: StratId) => setCfg((c) => ({ ...c, on: { ...c.on, [id]: !c.on[id] } }));
  const toggleTrig = (t: "1h" | "4h") => setCfg((c) => ({ ...c, triggers: c.triggers.includes(t) ? (c.triggers.length > 1 ? c.triggers.filter((x) => x !== t) : c.triggers) : [...c.triggers, t] }));

  const next15 = (Math.floor(now / 1000 / 900) + 1) * 900 * 1000;
  const mm = Math.max(0, next15 - now), cd = `${Math.floor(mm / 60000)}:${String(Math.floor((mm % 60000) / 1000)).padStart(2, "0")}`;
  const longs = readyLive.filter((x) => x.side === "long"), shorts = readyLive.filter((x) => x.side === "short");
  const stats = useMemo(() => {
    const c = hist.filter((h) => h.st !== "open");
    const w = c.filter((h) => h.r > 0).length;
    return { n: c.length, w, avg: c.length ? c.reduce((a, h) => a + h.r, 0) / c.length : 0, open: hist.length - c.length };
  }, [hist]);
  const ov = useMemo(() => {
    const cnt = (k: "d1" | "h4" | "h1") => ({ up: infos.filter((x) => x[k] === "up").length, down: infos.filter((x) => x[k] === "down").length, range: infos.filter((x) => x[k] === "range").length });
    const by: Record<string, number> = {};
    infos.forEach((x) => (by[x.market + " · " + x.ex] = (by[x.market + " · " + x.ex] || 0) + 1));
    return { d1: cnt("d1"), h4: cnt("h4"), h1: cnt("h1"), by, stale: infos.filter((x) => x.stale), missing: infos.filter((x) => x.issues.filter((q) => q !== "stale").length) };
  }, [infos]);

  const Row = (s: Sig2) => {
    const id = s.id, o = openId === id, lp = liveOf(s), z = sizeOf(s);
    const Lg = s.side === "long";
    const toTrig = s.trig ? ((lp - s.trig) / s.trig) * 100 : null;
    return (
      <article key={id} className={"sx-card " + (Lg ? "up" : "dn") + (o ? " open" : "") + (s.grade === "excellent" ? " exc" : "")}>
        <header role="button" tabIndex={0} aria-expanded={o} onClick={() => setOpenId(o ? null : id)} onKeyDown={(e: any) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(o ? null : id))}>
          <span className={"sx-score " + s.grade} title={T("Quality score", "امتیاز کیفیت")}>{s.status2 ? "—" : s.score}</span>
          <div className="sx-id"><b>{fa ? FA_NAME[s.base] || s.base : s.base}</b><span className="sx-mk">{s.market}</span></div>
          {s.status === "watch" ? (
            <span className={"sg-side ghost " + s.side} title={T("Not a signal yet — this is the side to take IF the trigger happens", "هنوز سیگنال نیست — سمتی که اگر ماشه بخورد باید گرفت")}>👁 {s.trig ? `${T("close", "کلوز")} ${Lg ? ">" : "<"} ${fmt(s.trig)} → ` : T("if confirmed → ", "اگر تأیید شد → ")}{Lg ? "LONG" : "SHORT"}</span>
          ) : (
            <span className={"sg-side " + s.side}>{Lg ? "▲ LONG" : "▼ SHORT"}</span>
          )}
          <span className="sx-tag">{L(STRATS[s.strat].name)}{s.status2 ? " · " + L(s.status2) : ""}</span>{s.tag && <span className="sx-tag bx">{L(s.tag)}</span>}
          <span className="sg-tfc">{s.tf}</span>
          {!s.status2 && <span className={"sx-rr " + (s.rr >= 3 ? "g" : "")} title={T("Net reward-to-risk after costs", "نسبت سود به ریسک خالص پس از هزینه")}>R:R {s.rr.toFixed(1)}</span>}
          <span className="sx-px">{fmt(lp)}</span>
          <i className="sg-chev">{o ? "▴" : "▾"}</i>
        </header>
        {o && (
          <div className="sx-more">
            {s.status === "watch" && s.wait && <p className="sx-wait">⏳ {L(s.wait)}{toTrig != null ? ` · ${T("distance to trigger", "فاصله تا ماشه")} ${toTrig >= 0 ? "+" : ""}${toTrig.toFixed(2)}%` : ""}</p>}
            {!s.status2 && <Ladder s={s} live={lp} />}
            <dl className="sx-grid">
              <div><dt>{T("Symbol", "نماد")}</dt><dd>{s.symbol.replace(/^[A-Z]+:/, "")} <small>{s.ex}</small></dd></div>
              <div><dt>{T("Market", "بازار")}</dt><dd>{s.market}</dd></div>
              <div><dt>{T("Direction", "جهت")}</dt><dd className={s.side}>{Lg ? "LONG" : "SHORT"}</dd></div>
              <div><dt>{T("Strategy", "استراتژی")}</dt><dd>{L(STRATS[s.strat].name)}</dd></div>
              <div><dt>{T("Daily trend", "روند روزانه")}</dt><dd>{L(trendTxt(s.d1))}</dd></div>
              <div><dt>{T("4H trend", "روند ۴ ساعته")}</dt><dd>{L(trendTxt(s.h4))}</dd></div>
              <div><dt>{T("1H structure", "ساختار ۱ ساعته")}</dt><dd>{L(trendTxt(s.h1))}</dd></div>
              <div className={s.m15.ok ? "g" : s.m15.ok === false ? "w" : ""}><dt>{T("15M confirmation", "تأیید ۱۵ دقیقه")}</dt><dd>{L(s.m15.text)}</dd></div>
              {!s.status2 && (
                <>
                  <div><dt>{T("Entry", "ورود")}</dt><dd>{fmt(s.entry)} <small>{s.method === "retest" ? T("retest", "ریتست") : s.method === "immediate" ? T("immediate", "فوری") : T("planned", "برنامه‌ای")}</small></dd></div>
                  <div className="r"><dt>{T("Stop loss", "حد ضرر")}</dt><dd>{fmt(s.stop)} <small>{((Math.abs(s.entry - s.stop) / s.entry) * 100).toFixed(2)}%</small></dd></div>
                  <div className="g"><dt>{T("Take profit", "حد سود")}</dt><dd>{fmt(s.tp)} <small>{L(s.tpNote)}</small></dd></div>
                  <div><dt>{T("Risk / reward", "ریسک به ریوارد")}</dt><dd>1 : {s.rr.toFixed(2)} <small>{T("net of costs", "پس از هزینه")} · {T("gross", "ناخالص")} {s.rrGross.toFixed(2)}</small></dd></div>
                  <div><dt>{T("Position size", "حجم پوزیشن")}</dt><dd>{fmt(z.qty)} {s.base} <small>≈ ${z.notional.toFixed(0)}</small></dd></div>
                  <div><dt>{T("Risk", "ریسک")}</dt><dd>{Math.min(5, riskPct)}% <small>${z.risk$.toFixed(2)} {T("of", "از")} ${acct}</small></dd></div>
                </>
              )}
              <div><dt>{T("Quality score", "امتیاز کیفیت")}</dt><dd>{s.status2 ? "—" : s.score + " / 100"} <small>{s.grade === "excellent" ? T("Excellent", "عالی") : s.grade === "good" ? T("Good", "خوب") : T("Watchlist only", "فقط مراقبت")}</small></dd></div>
              <div><dt>{T("Signal time", "زمان سیگنال")}</dt><dd>{new Date(s.time).toLocaleString()} <small>{T("closed", "بسته‌شده")} {s.tf} {T("candle", "کندل")}</small></dd></div>
            </dl>
            {!s.status2 && (
              <div className="sx-parts" aria-label="score breakdown">
                {([["structure", 20, T("Structure", "ساختار")], ["setup", 20, T("Setup", "ستاپ")], ["pa", 20, T("Price action", "پرایس اکشن")], ["vol", 10, T("Volume", "حجم")], ["rsi", 7, "RSI"], ["macd", 7, "MACD"], ["entryQ", 8, T("Entry", "ورود")], ["rr", 8, "R:R"]] as const).map(([k, mx, nm]) => (
                  <div key={k}><span>{nm}</span><i><u style={{ width: Math.min(100, ((s.parts as any)[k] / mx) * 100) + "%" }} /></i><em>{Math.round((s.parts as any)[k])}/{mx}</em></div>
                ))}
              </div>
            )}
            <h5>{T("Technical explanation", "توضیح تکنیکال")}</h5>
            <ul className="sx-why">{s.why.map((w, i) => <li key={i}>{L(w)}</li>)}</ul>
            {s.missing.length > 0 && <p className="sx-miss">⚠ {T("Missing / incomplete data", "داده‌ی ناقص یا موجود‌نبودن")}: {s.missing.join(", ")}</p>}
            {!s.status2 && <button type="button" className="sg-open" disabled={inJ(s)} onClick={() => addJ(s)}>{inJ(s) ? "📒 " + T("In journal", "در دفتر است") : "📒 " + T("Add to journal", "افزودن به دفتر")}</button>} <button type="button" className="sg-open" onClick={() => open(s)}>📈 {T("Open chart & analysis", "باز کردن چارت و تحلیل")}</button>
          </div>
        )}
      </article>
    );
  };
  const List = (arr: Sig2[], empty: string) => (arr.length ? <div className="sx-list">{arr.map(Row)}</div> : <p className="sg-empty">{empty}</p>);

  const tabs: [View, string, string, number | null][] = [
    ["ready", "✅", T("Ready", "آماده"), readyLive.length],
    ["watch", "👁", T("Watchlist", "مراقبت"), watch.length],
    ["long", "▲", "LONG", longs.length],
    ["short", "▼", "SHORT", shorts.length],
    ["market", "🌐", T("Market", "بازار"), null],
    ["history", "📒", T("Journal", "دفتر"), hist.length || null],
    ["settings", "⚙", T("Settings", "تنظیمات"), null],
  ];

  return (
    <div className="sg sx" dir={fa ? "rtl" : "ltr"}>
      <div className={"sg-bar" + (on ? " on" : "")}>
        <button type="button" role="switch" aria-checked={on} className={"sg-sw" + (on ? " on" : "")} onClick={() => setOn(!on)} title={T("Turn the scanner on or off", "روشن / خاموش کردن اسکنر")}><i /></button>
        <b className="sg-t">🧠 {on ? T("Scanner on", "اسکنر روشن") : T("Scanner off", "اسکنر خاموش")}</b>
        {on && <span className="sg-cd" title={T("Next 15-minute close (scan time)", "بسته‌شدن بعدی کندل ۱۵ دقیقه (زمان اسکن)")}>⏱ 15m · {cd}</span>}
        {meta && <span className="sx-last">{T("Last scan", "آخرین اسکن")} {new Date(meta.at).toLocaleTimeString()} · {meta.n} {T("symbols", "نماد")} · {(meta.ms / 1000).toFixed(0)}s{meta.failed ? ` · ${meta.failed} ${T("with missing data", "با داده‌ی ناقص")}` : ""}</span>}
        <span className="sg-sp" />
        <button type="button" className="sg-go" disabled={!!prog} onClick={() => runScan()}>{prog ? "…" : "🔍 " + T("Scan now", "اسکن همین حالا")}</button>
        <button type="button" className="sg-lang" onClick={() => setLang(fa ? "en" : "fa")}>{fa ? "EN" : "فا"}</button>
      </div>
      {prog && (
        <div className="sg-prog" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <i style={{ width: (prog.done / Math.max(1, prog.total)) * 100 + "%" }} />
          <span>{T("Scanning", "در حال اسکن")} {prog.done}/{prog.total}</span>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="sx-toasts" role="status">
          {toasts.map((t) => (
            <div key={t.id} className={t.side}>
              <span>🔔 {t.text}</span>
              <button type="button" aria-label="dismiss" onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="sg-tabs sx-tabs" role="tablist">
        {tabs.map(([k, ic, nm, n]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{ic} <span>{nm}</span>{n ? <b>{n}</b> : null}</button>
        ))}
      </div>
      {msg && <p className="sg-msg">{msg}</p>}

      {view === "ready" && (
        <div className="sg-pane">
          <p className="sx-hint">{T("Confirmed on a CLOSED candle · stop is structural · net R:R ≥ 1:2 · score ≥ 70 · risk ≤ 5%.", "تأییدشده با کندل بسته‌شده · حد ضرر ساختاری · R:R خالص ≥ ۱:۲ · امتیاز ≥ ۷۰ · ریسک ≤ ۵٪.")}</p>
          {droppedN > 0 && <p className="sg-drop">🧹 {T(`${droppedN} signal(s) hidden: the live price already reached the stop or the target.`, `${droppedN} سیگنال پنهان شد: قیمت زنده به حد ضرر یا حد سود رسیده.`)}</p>}
          {List(readyLive, meta ? T("No confirmed signal right now. The scanner is selective on purpose — the goal is the best setups, not the most.", "فعلاً سیگنال تأییدشده‌ای نیست. اسکنر عمداً سخت‌گیر است — هدف بهترین ستاپ‌هاست نه بیشترین.") : T("Turn the scanner on or press Scan now.", "اسکنر را روشن کن یا اسکن بزن."))}
        </div>
      )}
      {view === "watch" && (
        <div className="sg-pane">
          <p className="sx-hint">{T("Developing setups — NOT entry signals. Each one says what must happen first.", "ستاپ‌های در حال شکل‌گیری — سیگنال ورود نیستند. هرکدام می‌گوید اول چه باید رخ دهد.")}</p>
          {List(watch, T("Nothing developing right now.", "فعلاً چیزی در حال شکل‌گیری نیست."))}
        </div>
      )}
      {view === "long" && <div className="sg-pane">{List(longs, T("No confirmed LONG signal.", "سیگنال خرید تأییدشده‌ای نیست."))}</div>}
      {view === "short" && <div className="sg-pane">{List(shorts, T("No confirmed SHORT signal.", "سیگنال فروش تأییدشده‌ای نیست."))}</div>}

      {view === "market" && (
        <div className="sg-pane">
          {!infos.length ? <p className="sg-empty">{T("Run a scan to see the market overview.", "برای دیدن نمای بازار یک اسکن بزن.")}</p> : (
            <>
              <div className="sx-ov">
                {(["d1", "h4", "h1"] as const).map((k) => {
                  const o = ov[k], tot = Math.max(1, o.up + o.down + o.range);
                  return (
                    <div key={k} className="sx-ovc">
                      <h5>{k === "d1" ? T("Daily trend (Dow)", "روند روزانه (داو)") : k === "h4" ? T("4H trend", "روند ۴ ساعته") : T("1H structure", "ساختار ۱ ساعته")}</h5>
                      <div className="sx-bar"><i className="u" style={{ width: (o.up / tot) * 100 + "%" }} /><i className="r" style={{ width: (o.range / tot) * 100 + "%" }} /><i className="d" style={{ width: (o.down / tot) * 100 + "%" }} /></div>
                      <small>▲ {o.up} · ▬ {o.range} · ▼ {o.down}</small>
                    </div>
                  );
                })}
              </div>
              <div className="sx-ovc wide"><h5>{T("Coverage", "پوشش")}</h5><p>{Object.entries(ov.by).map(([k, n]) => <em key={k}>{k} {n}</em>)}</p></div>
              <div className="sx-ovc wide"><h5>{T("Signals now", "سیگنال‌های فعلی")}</h5><p><em>✅ {readyLive.length}</em><em>👁 {watch.length}</em><em className="up">▲ {longs.length}</em><em className="dn">▼ {shorts.length}</em></p></div>
              <div className="sx-ovc wide">
                <h5>{T("Data integrity", "صحت داده")}</h5>
                <p>{T("Only closed candles confirm signals. Symbols without enough 1D/4H/1H history are skipped, never guessed.", "فقط کندل بسته‌شده سیگنال را تأیید می‌کند. نمادهای بدون تاریخچه‌ی کافی ۱D/۴H/۱H رد می‌شوند، نه حدس.")}</p>
                {ov.stale.length > 0 && <p className="sx-miss">⏸ {T("Stale / market closed", "داده‌ی کهنه / بازار بسته")}: {ov.stale.length} — {ov.stale.slice(0, 10).map((x) => x.base).join(", ")}{ov.stale.length > 10 ? "…" : ""}</p>}
                {ov.missing.length > 0 && <p className="sx-miss">⚠ {T("Incomplete data", "داده‌ی ناقص")}: {ov.missing.length} — {ov.missing.slice(0, 10).map((x) => x.base + " (" + x.issues.filter((q) => q !== "stale").join("/") + ")").join(", ")}{ov.missing.length > 10 ? "…" : ""}</p>}
              </div>
            </>
          )}
        </div>
      )}

      {view === "history" && (
        <div className="sg-pane">
          <div className="sx-stats">
            <div><b>{hist.length}</b><span>{T("Entries", "ورودی")}</span></div>
            <div><b>{stats.n ? Math.round((stats.w / stats.n) * 100) + "%" : "—"}</b><span>{T("Win rate", "درصد برد")}</span></div>
            <div><b className={stats.avg >= 0 ? "g" : "r"}>{stats.n ? stats.avg.toFixed(2) : "—"}</b><span>{T("Avg R", "میانگین R")}</span></div>
            <div><b>{stats.open}</b><span>{T("Open", "باز")}</span></div>
          </div>
          <p className="sx-hint">{T("Win = target reached before the stop; loss = stop first (both in one candle counts as a loss); expires after 48 candles. Small samples mean little — wait for 30+.", "برد = رسیدن به حد سود پیش از حد ضرر؛ باخت = اول حد ضرر (اگر هر دو در یک کندل باشند باخت حساب می‌شود)؛ بعد از ۴۸ کندل منقضی می‌شود. نمونه‌ی کم معنا ندارد — منتظر ۳۰+ بمان.")}</p>
          <div className="sx-hist">
            {hist.slice().reverse().map((h) => (
              <div key={h.key} className={h.st}>
                <b>{fa ? FA_NAME[h.base] || h.base : h.base}</b>
                <span className={"sg-side " + h.side}>{h.side === "long" ? "LONG" : "SHORT"}</span>
                <span>{L(STRATS[h.strat as StratId].name)}{h.auto ? " · " + T("auto", "خودکار") : ""}</span>
                <span>{fmt(h.entry)} → {fmt(h.tp)}</span>
                <span>{h.score}</span>
                <small>{new Date(h.time).toLocaleString()}</small><button type="button" aria-label="remove" className="sx-del" onClick={() => delJ(h.key)}>✕</button>
                <em>{h.st === "open" ? "⏳" : h.st === "win" ? "✅ +" + h.r.toFixed(1) + "R" : h.st === "loss" ? "🛑 −1R" : "⌛ " + h.r.toFixed(1) + "R"}</em>
              </div>
            ))}
            {!hist.length && <p className="sg-empty">{T("The journal is empty. New READY signals are added automatically (Settings → Journal); you can also add one by hand from its card.", "دفتر خالی است. سیگنال‌های آماده‌ی جدید خودکار اضافه می‌شوند (تنظیمات ← دفتر)؛ از روی کارت هم می‌توانی دستی اضافه کنی.")}</p>}
          </div>
          {hist.length > 0 && <button type="button" className="sg-go" onClick={() => { if (confirm(T("Clear the history?", "تاریخچه پاک شود؟"))) { setHist([]); jset("arcus.ag3.hist", []); } }}>{T("Clear history", "پاک کردن تاریخچه")}</button>}
        </div>
      )}

      {view === "settings" && (
        <div className="sg-pane">
          <section className="sx-set">
            <h5>{T("Risk & costs", "ریسک و هزینه")}</h5>
            <div className="sg-form">
              <label>{T("Account size ($)", "اندازه‌ی حساب ($)")}<input type="number" min={0} value={acct} onChange={(e) => setAcct(Math.max(0, Number(e.target.value)))} /></label>
              <label>{T("Risk per trade (%) — absolute max 5", "ریسک هر معامله (٪) — سقف مطلق ۵")}<input type="number" min={0.1} max={5} step={0.1} value={riskPct} onChange={(e) => setRiskPct(clampRisk(Number(e.target.value)))} /></label>
              <label>{T("Fees + spread + slippage (% round trip)", "کارمزد + اسپرد + لغزش (٪ رفت‌وبرگشت)")}<input type="number" min={0} max={2} step={0.05} value={cfg.costPct} onChange={(e) => setCfg((c) => ({ ...c, costPct: Math.max(0, Number(e.target.value)) }))} /></label>
              <label>{T("Minimum R:R (fixed)", "حداقل R:R (ثابت)")}<input value="1 : 2" disabled /></label>
            </div>
          </section>
          <section className="sx-set">
            <h5>{T("Trigger timeframe", "تایم‌فریم ماشه")}</h5>
            <span className="sg-chips">
              {(["1h", "4h"] as const).map((t) => <button key={t} type="button" className={cfg.triggers.includes(t) ? "on" : ""} onClick={() => toggleTrig(t)}>{t === "1h" ? "1H (15M confirms)" : "4H (1H confirms)"}</button>)}
            </span>
            <p className="sx-hint">{T("1D = trend & major levels · 4H = structure, BOS/CHoCH, zones · trigger = the setup · confirmation = precise entry.", "۱D = روند و سطوح اصلی · ۴H = ساختار، BOS/CHoCH، نواحی · ماشه = ستاپ · تأیید = ورود دقیق.")}</p>
          </section>
          <section className="sx-set">
            <h5>{T("Strategies", "استراتژی‌ها")}</h5>
            <div className="sg-set-list">
              {(Object.keys(STRATS) as StratId[]).map((id) => (
                <label key={id} className="sg-set-row">
                  <input type="checkbox" checked={cfg.on[id]} onChange={() => toggleStrat(id)} />
                  <span><b>{L(STRATS[id].name)}</b><small>{L(STRATS[id].basis)}</small></span>
                </label>
              ))}
            </div>
          </section>
          <section className="sx-set">
            <h5>{T("Journal", "دفتر")}</h5>
            <label className="sg-nt"><input type="checkbox" checked={autoJ} onChange={(e) => setAutoJ(e.target.checked)} /> 📒 {T("Add every new READY signal to the journal automatically (to track its result)", "هر سیگنال آماده‌ی جدید خودکار وارد دفتر شود (برای پیگیری نتیجه)")}</label>
            <p className="sx-hint">{T("Watchlist items are never added automatically. You can still add or remove entries by hand.", "موارد مراقبت هیچ‌وقت خودکار اضافه نمی‌شوند. دستی هم می‌توانی اضافه یا حذف کنی.")}</p>
          </section>
          <section className="sx-set">
            <h5>{T("Alerts", "هشدارها")}</h5>
            <label className="sg-nt"><input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} /> 🔊 {T("Sound alert for a new Ready signal", "هشدار صوتی برای سیگنال آماده‌ی جدید")}</label>
            <label className="sg-nt"><input type="checkbox" checked={notifOn} onChange={(e) => setNotifOn(e.target.checked)} /> 🔔 {T("Browser notification", "اعلان مرورگر")}</label>
            {notifOn && perm === "default" && <button type="button" className="sg-perm" onClick={askPerm}>🔔 {T("Allow notifications", "اجازه‌ی اعلان")}</button>}
            {notifOn && perm === "denied" && <p className="sx-miss">{T("Notifications are blocked in this browser.", "اعلان‌ها در این مرورگر مسدود است.")}</p>}
            {perm === "unsupported" && <p className="sx-miss">{T("This browser has no notification support.", "این مرورگر اعلان را پشتیبانی نمی‌کند.")}</p>}
            <VoiceControl chan="agent" label={T("Voice & sound", "صدا")} sample={{ en: "2 new ready signals.", fa: "۲ سیگنال آماده‌ی معامله‌ی جدید." }} />
            <p className="sx-hint">{T("Alerts work while the app is open. No Telegram messages are sent.", "هشدارها تا وقتی برنامه باز است کار می‌کنند. هیچ پیام تلگرامی فرستاده نمی‌شود.")}</p>
          </section>
          <section className="sx-set">
            <h5>{T("Coverage & data", "پوشش و داده")}</h5>
            <p className="sx-hint">{T(`Scans every symbol of the exchanges switched on at the top of the app (${p.syms.length} now). Candles come from each exchange's public data; nothing is invented. Live prices refresh the watchlist between scans; confirmation always waits for a closed candle. Forex and indices appear only if the connected exchanges list them.`, `همه‌ی نمادهای صرافی‌هایی که بالای برنامه روشن‌اند را اسکن می‌کند (الان ${p.syms.length} نماد). کندل‌ها از داده‌ی عمومی هر صرافی می‌آیند و چیزی ساخته نمی‌شود. قیمت زنده بین اسکن‌ها لیست مراقبت را به‌روز نگه می‌دارد؛ تأیید همیشه منتظر کندل بسته‌شده است. فارکس و شاخص‌ها فقط اگر صرافی‌های وصل‌شده فهرستشان کنند می‌آیند.`)}</p>
          </section>
        </div>
      )}
      <p className="sg-note">{T("Rule-based analysis for review, not financial advice. Scores and thresholds are heuristics — verify results in the History tab before trusting them.", "تحلیل قاعده‌محور برای بررسی است، نه توصیه‌ی مالی. امتیازها و آستانه‌ها ابتکاری‌اند — پیش از اعتماد، نتیجه را در تاریخچه بسنج.")}</p>
    </div>
  );
}
const clampRisk = (v: number) => (Number.isFinite(v) ? Math.max(0.1, Math.min(5, v)) : 1);
