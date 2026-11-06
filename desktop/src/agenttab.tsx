/* Agent tab: one slim bar (on/off, timeframes, minutes before close). While it is on, shortly before each chosen candle closes it scans
   EVERY symbol of the exchanges that are switched on, grades technical signals, announces them once (voice + notification) and lists them. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bi, FA_NAME, TF_SEC, left } from "./agent";
import { setLang, useLang } from "./lang";
import { STRAT_LIST, Sig, closedOnly, evaluate, trendOf } from "./signals";
import { VoiceControl, speak, chime, getVoice } from "./voice";
import type { SetupLines } from "./analysispanel";
import type { QCandle } from "./qfex";

export type AgSym = { symbol: string; base: string; ex: string };
type JE = { id: string; sym: string; base: string; tf: string; side: "long" | "short"; strat: string; top: boolean; n: number; from: number; entry: number; stop: number; t1: number; st: "open" | "win" | "loss" | "exp"; r: number; bars: number };
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
type Grp = Sig & { all: Sig[]; mtf: string[] };
export const isTop = (g: { all?: Sig[]; score: number; vol: { ratio: number }; tgt?: { rr: number } | null }) => !(g.tgt && g.tgt.rr < 1.5) && (nOf(g) > 1 && g.score >= 7) || (g.score >= 8 && g.vol.ratio >= 1.3);
const nOf = (g: any): number => g.all?.length || 1;
const rank = (a: Sig, b: Sig) => Number(isTop(b as any)) - Number(isTop(a as any)) || Number(nOf(b) > 1) - Number(nOf(a) > 1) || nOf(b) - nOf(a) || Number(isHot(b)) - Number(isHot(a)) || b.score - a.score || b.vol.ratio - a.vol.ratio;
const fmt = (v: number) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
function Ring({ v, g }: { v: number; g: string }) {
  const p = Math.max(0, Math.min(1, v / 10)), r = 15, c = 2 * Math.PI * r;
  return (
    <svg className={"sg-ring g" + g} viewBox="0 0 40 40" aria-label={"score " + v}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="#17304a" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 20 20)" />
      <text x="20" y="24.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="currentColor">{g}</text>
    </svg>
  );
}
const TFN: Record<string, { en: string; fa: string }> = { "15m": { en: "15-minute", fa: "۱۵ دقیقه‌ای" }, "1h": { en: "1-hour", fa: "یک‌ساعته" }, "4h": { en: "4-hour", fa: "۴ ساعته" }, "1d": { en: "daily", fa: "روزانه" } };

function Mini({ s }: { s: Sig }) {
  const bars = s.bars;
  const vals = bars.flatMap((x) => [x[1], x[2]]).concat([s.stop, s.entry, s.t[1]]);
  if (s.level) vals.push(s.level.price);
  const hi = Math.max(...vals), lo = Math.min(...vals), W = 280, H = 110, padR = 46, cw = W - padR, bw = cw / bars.length;
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 12);
  const zone = (a: number, c: number, col: string) => <rect x="0" width={cw} y={Math.min(y(a), y(c))} height={Math.abs(y(a) - y(c))} fill={col} />;
  const tag = (v: number, c: string, t: string, d = "3 3") => (
    <g>
      <line x1="0" x2={cw} y1={y(v)} y2={y(v)} stroke={c} strokeDasharray={d} strokeWidth="1" opacity=".9" />
      <text x={cw + 4} y={y(v) + 3} fill={c} fontSize="9" fontWeight="700">{t}</text>
    </g>
  );
  const lastB = bars[bars.length - 1];
  return (
    <svg className="sg-mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {zone(s.entry, s.t[2], "rgba(61,220,151,.10)")}
      {zone(s.entry, s.stop, "rgba(255,92,92,.12)")}
      {s.level && tag(s.level.price, "#f2c94c", s.level.kind === "support" ? "S" : "R", "5 3")}
      {tag(s.entry, "#00dcd2", "E")}
      {tag(s.stop, "#ff5c5c", "SL")}
      {tag(s.t[1], "#3ddc97", "2R")}
      {bars.map((c, i) => {
        const up = c[3] >= c[0], col = up ? "#3ddc97" : "#ff5c5c", x = i * bw + bw / 2;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(c[1])} y2={y(c[2])} stroke={col} strokeWidth="1" />
            <rect x={x - bw * 0.34} width={bw * 0.68} y={Math.min(y(c[0]), y(c[3]))} height={Math.max(1, Math.abs(y(c[0]) - y(c[3])))} fill={col} />
          </g>
        );
      })}
      <circle cx={(bars.length - 0.5) * bw} cy={y(lastB[3])} r="3.2" fill="#fff" stroke={s.side === "long" ? "#3ddc97" : "#ff5c5c"} strokeWidth="1.5" />
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
  const [on, setOn] = useState<boolean>(() => jget("arcus.ag2.on", false));
  const [tfs, setTfs] = useState<string[]>(() => jget("arcus.ag2.tfs", ["4h"]));
  const [mins, setMins] = useState<number>(() => jget("arcus.ag2.min", 2));
  const [side, setSide] = useState<"all" | "hot" | "long" | "short">("all");
  const [off, setOff] = useState<string[]>(() => jget("arcus.ag2.off", []));
  const [notifyTop, setNotifyTop] = useState<boolean>(() => jget("arcus.ag2.notifyTop", true));
  const [acct, setAcct] = useState<number>(() => jget("arcus.ag2.acct", 1000));
  const [riskPct, setRiskPct] = useState<number>(() => jget("arcus.ag2.risk", 1));
  const [minLiq, setMinLiq] = useState<number>(() => jget("arcus.ag2.liq", 0));
  const [mktMode, setMktMode] = useState<"off" | "warn" | "hide">(() => jget("arcus.ag2.mkt", "warn"));
  const [maxStop, setMaxStop] = useState<number>(() => jget("arcus.ag2.maxstop", 5));
  const [minRR, setMinRR] = useState<number>(() => jget("arcus.ag2.minrr", 0));
  const [watch, setWatch] = useState<{ id: string; symbol: string; base: string; tf: string; side: "long" | "short"; at: number }[]>(() => jget("arcus.ag2.watch", []));
  const [breadth, setBreadth] = useState<{ up: number; n: number } | null>(null);
  const breadthAcc = useRef({ up: 0, n: 0 });
  const trans = useRef<{ e: JE; to: "win" | "loss" }[]>([]);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  const [mkt, setMkt] = useState<"up" | "down" | "flat" | null>(null);
  const jr = useRef<JE[]>(jget<JE[]>("arcus.ag2.journal", []));
  const [jver, setJver] = useState(0);
  const liqRef = useRef(minLiq);
  liqRef.current = minLiq;
  const [strat, setStrat] = useState<string>("all");
  const [sigs, setSigs] = useState<Sig[]>(() => jget<Sig[]>("arcus.ag2.sigs", []));
  const [every, setEvery] = useState<number>(() => jget("arcus.ag2.every", 60));
  const [prog, setProg] = useState<{ done: number; total: number; tf: string } | null>(null);
  const [scanned, setScanned] = useState<{ at: number; tf: string; n: number; live: boolean } | null>(() => jget("arcus.ag2.scanned", null));
  const [hist, setHist] = useState<Hist[]>(() => jget("arcus.ag2.hist", []));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState("");
  const [minGrade, setMinGrade] = useState<"any" | "B" | "A">("any");
  const [view, setView] = useState<"signals" | "journal" | "settings">("signals");
  const [openId, setOpenId] = useState<string | null>(null);
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
  useEffect(() => { jset("arcus.ag2.off", off); }, [off]);
  useEffect(() => { jset("arcus.ag2.minrr", minRR); }, [minRR]);
  useEffect(() => { jset("arcus.ag2.watch", watch); }, [watch]);
  useEffect(() => { jset("arcus.ag2.acct", acct); jset("arcus.ag2.risk", riskPct); jset("arcus.ag2.liq", minLiq); jset("arcus.ag2.mkt", mktMode); jset("arcus.ag2.maxstop", maxStop); }, [acct, riskPct, minLiq, mktMode, maxStop]);
  useEffect(() => { jset("arcus.ag2.notifyTop", notifyTop); }, [notifyTop]);
  const notifyRef = useRef(notifyTop);
  notifyRef.current = notifyTop;
  const offRef = useRef<string[]>(off);
  offRef.current = off;
  useEffect(() => { jset("arcus.ag2.sigs", sigs.slice(0, 150)); }, [sigs]);
  useEffect(() => { jset("arcus.ag2.scanned", scanned); }, [scanned]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const resolveJ = (sym: string, tf: string, rows: QCandle[]) => {
    const sec = TF_SEC[tf] || 1, nowS = Date.now() / 1000;
    for (const e of jr.current) {
      if (e.st !== "open" || e.sym !== sym || e.tf !== tf) continue;
      const R = Math.abs(e.entry - e.stop) || 1, dir = e.side === "long" ? 1 : -1;
      let k = 0;
      for (const c of rows) {
        if (c.time < e.from || c.time + sec > nowS) continue;
        k++;
        const stopHit = dir > 0 ? c.low <= e.stop : c.high >= e.stop, tgtHit = dir > 0 ? c.high >= e.t1 : c.low <= e.t1;
        if (stopHit) { e.st = "loss"; e.r = -1; e.bars = k; trans.current.push({ e, to: "loss" }); break; }
        if (tgtHit) { e.st = "win"; e.r = 1; e.bars = k; trans.current.push({ e, to: "win" }); break; }
        if (k >= 30) { e.st = "exp"; e.r = Math.max(-1, Math.min(3, ((c.close - e.entry) / R) * dir)); e.bars = k; break; }
      }
    }
  };
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
    const btc = list.find((x) => x.base === "BTC");
    if (btc) {
      try {
        const br = await fetchRef.current(btc.symbol, "1d", c.signal);
        setMkt(trendOf(closedOnly(br, "1d")));
      } catch {}
    }
    const out: Sig[] = [];
    let i = 0, finished = 0, got = 0;
    breadthAcc.current = { up: 0, n: 0 };
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
            resolveJ(s.symbol, tf, rows);
            {
              const cl = closedOnly(rows, tf).map((x) => x.close);
              if (cl.length >= 50) {
                breadthAcc.current.n++;
                if (cl[cl.length - 1] > cl.slice(-50).reduce((a, x) => a + x, 0) / 50) breadthAcc.current.up++;
              }
            }
            const lv = rows.slice(-20);
            const lowLiq = liqRef.current > 0 && lv.reduce((a, r) => a + r.close * r.volume, 0) / lv.length < liqRef.current;
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
            let r = evaluate(s.symbol, s.base, tf, rows, h, htfTf, Date.now(), live);
            const cur = rows[rows.length - 1], secN = TF_SEC[tf] || 1;
            if (!live && cur && (cur.time + secN) * 1000 > Date.now()) {
              // the candle that is still forming: if it already hit the stop or the first target, the idea is spent
              r = r.filter((x) => (x.side === "long" ? cur.low > x.stop && cur.high < x.t[0] : cur.high < x.stop && cur.low > x.t[0])).map((x) => ({ ...x, price: cur.close }));
            }
            if (!lowLiq) out.push(...r);
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
    if (breadthAcc.current.n > 5) setBreadth({ ...breadthAcc.current });
    if (!live) {
      const fa3 = localStorage.getItem("arcus.news.lang") === "fa";
      const nm = (b: string) => (fa3 ? FA_NAME[b] || b : b);
      for (const t of trans.current.splice(0)) {
        if (!(t.e.top || t.e.n > 1)) continue;
        sendNotification(
          t.to === "win" ? (fa3 ? "🎯 به 1R رسید" : "🎯 Reached 1R") : (fa3 ? "🛑 حد ضرر خورد" : "🛑 Stopped out"),
          `${nm(t.e.base)} ${t.e.side === "long" ? (fa3 ? "خرید" : "long") : fa3 ? "فروش" : "short"} ${t.e.tf}` + (t.to === "win" ? (fa3 ? " — حد ضرر را به نقطه‌ی ورود ببر" : " — move the stop to breakeven") : ""),
          "ag2-res-" + t.e.id,
        );
      }
      const hit = watchRef.current.filter((w) => out.some((x) => x.symbol === w.symbol && x.side === w.side && x.strat.id !== "dow"));
      if (hit.length) {
        sendNotification(fa3 ? "👁 سیگنال دیده‌بانی شد" : "👁 Watched setup triggered", hit.map((w) => nm(w.base) + " " + (w.side === "long" ? (fa3 ? "خرید" : "long") : fa3 ? "فروش" : "short")).join(" · "), "ag2-watch-" + Date.now());
        setWatch((a) => a.filter((w) => !hit.some((h) => h.id === w.id)));
      }
      const sec0 = TF_SEC[tf] || 1, from = Math.floor(Date.now() / 1000 / sec0) * sec0;
      const gm = new Map<string, number>();
      for (const x of out) gm.set(x.symbol + "|" + x.side, (gm.get(x.symbol + "|" + x.side) || 0) + 1);
      for (const x of out) {
        const id = [x.symbol, tf, x.side, x.strat.id, from].join("|");
        if (jr.current.some((e) => e.id === id)) continue;
        const n = gm.get(x.symbol + "|" + x.side) || 1;
        jr.current.push({ id, sym: x.symbol, base: x.base, tf, side: x.side, strat: x.strat.id, top: isTop({ all: Array(n).fill(x), score: x.score + n - 1, vol: x.vol, tgt: x.tgt }), n, from, entry: x.entry, stop: x.stop, t1: x.t[0], st: "open", r: 0, bars: 0 });
      }
      jr.current = jr.current.slice(-600);
      jset("arcus.ag2.journal", jr.current);
      setJver((v) => v + 1);
    }
    if (!live && notifyRef.current) {
      // very good signals (several strategies agree, or grade A with heavy volume) -> one notification per candle
      const g = new Map<string, Sig[]>();
      for (const x of out) if (!offRef.current.includes(x.strat.id)) g.set(x.symbol + "|" + x.side, (g.get(x.symbol + "|" + x.side) || []).concat(x));
      const sec = TF_SEC[tf] || 1, bucket = Math.floor(Date.now() / 1000 / sec);
      const seen = jget<string[]>("arcus.ag2.notified", []);
      const fresh: { base: string; side: string; n: number }[] = [];
      for (const [k, arr] of g) {
        const top = arr.slice().sort((a, b) => b.score - a.score)[0];
        const grp = { all: arr, score: top.score + arr.length - 1, vol: top.vol, tgt: top.tgt };
        const id = k + "|" + tf + "|" + bucket;
        if (isTop(grp) && !seen.includes(id)) {
          seen.push(id);
          fresh.push({ base: top.base, side: top.side, n: arr.length });
        }
      }
      if (fresh.length) {
        jset("arcus.ag2.notified", seen.slice(-300));
        const fa2 = localStorage.getItem("arcus.news.lang") === "fa";
        const line = (f: { base: string; side: string; n: number }) => (fa2 ? `${FA_NAME[f.base] || f.base} ${f.side === "long" ? "خرید" : "فروش"}${f.n > 1 ? ` (${f.n} استراتژی)` : ""}` : `${f.base} ${f.side}${f.n > 1 ? ` (${f.n} strategies)` : ""}`);
        const body = fresh.slice(0, 5).map(line).join(" · ") + (fresh.length > 5 ? " …" : "");
        sendNotification((fa2 ? "⭐ سیگنال ممتاز " : "⭐ Top signal ") + tf, (fa2 ? "حتماً بررسی کن: " : "Worth checking: ") + body, "ag2-top-" + tf + bucket);
        chime("soft", getVoice("agent").vol);
      }
    }
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
        announce(tf, closeAt, sigsRef.current.filter((x) => x.tf === tf && !offRef.current.includes(x.strat.id)), minLeft);
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
  const dropRef = useRef(0);
  const merged: Grp[] = useMemo(() => {
    let dropped = 0;
    const m = new Map<string, Sig[]>();
    for (let x of sigs) {
      if (off.includes(x.strat.id) || !tfs.includes(x.tf)) continue;
      const lp = p.priceOf?.(x.symbol);
      if (lp && lp > 0 && Math.abs(lp - x.entry) / x.entry < 0.2) { // a feed that disagrees by >20% is a different scale/source: ignore it
        const Lg = x.side === "long";
        const spent = Lg ? lp <= x.stop || lp >= x.t[0] : lp >= x.stop || lp <= x.t[0];
        const failed = x.level?.state === "broken" && (Lg ? lp < x.level.price : lp > x.level.price);
        if (spent || failed) { dropped++; continue; }
        x = { ...x, price: lp };
      }
      const secX = TF_SEC[x.tf] || 1;
      if (now > (Math.floor(x.at / 1000 / secX) + 2) * secX * 1000) continue; // older than one candle: wait for the next scan
      const k = x.symbol + "|" + x.tf + "|" + x.side;
      const cur = m.get(k) || [];
      if (!cur.some((y) => y.strat.id === x.strat.id)) m.set(k, cur.concat(x));
    }
    dropRef.current = dropped;
    return Array.from(m.values())
      .map((g) => {
        const top = g.slice().sort((a, b) => b.score - a.score)[0];
        const sc = top.score + g.length - 1;
        const mt = Array.from(new Set(sigs.filter((y) => y.symbol === top.symbol && y.side === top.side && tfs.includes(y.tf)).map((y) => y.tf)));
        return { ...top, mtf: mt, all: g, score: sc, grade: sc >= 8 ? "A" : sc >= 6 ? "B" : "C" } as Grp;
      })
      .sort(rank);
  }, [sigs, off, tfs, Math.floor(now / 5000)]);
  const counter = (x: Sig) => mktMode !== "off" && mkt != null && ((x.side === "long" && mkt === "down") || (x.side === "short" && mkt === "up"));
  const stats = useMemo(() => {
    const m: Record<string, { n: number; w: number; sum: number; open: number }> = {};
    const add = (k: string, e: JE) => {
      const o = (m[k] ||= { n: 0, w: 0, sum: 0, open: 0 });
      if (e.st === "open") o.open++;
      else { o.n++; o.sum += e.r; if (e.r > 0) o.w++; }
    };
    for (const e of jr.current) { add(e.strat, e); if (e.top) add("_top", e); add("_all", e); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jver]);
  const isStrong = (x: Grp) => !(x.tgt && x.tgt.rr < 1.5) && (isTop(x) || x.grade === "A" || (x.grade === "B" && isHot(x)));
  const csv = () => {
    const rows = [["symbol", "tf", "side", "strategies", "grade", "score", "entry", "stop", "1R", "2R", "3R"]].concat(
      merged.map((g) => [g.symbol, g.tf, g.side, g.all.map((x) => x.strat.id).join("+"), g.grade, String(g.score), String(g.entry), String(g.stop), String(g.t[0]), String(g.t[1]), String(g.t[2])]),
    );
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "arcus-signals.csv";
    a.click();
  };
  const shown0 = merged.filter((x) => (minGrade === "any" || x.grade === "A" || (minGrade === "B" && x.grade === "B")) && !(mktMode === "hide" && counter(x)) && !(minRR > 0 && x.tgt && x.tgt.rr < minRR) && (side === "all" || (side === "hot" ? isHot(x) : x.side === side)) && (strat === "all" || x.all.some((y) => y.strat.id === strat)));
  const shown = shown0.slice().sort((a, b) => Number(isStrong(b)) - Number(isStrong(a)) || rank(a, b));
  const nStrong = shown.filter(isStrong).length;
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
        {on && nextClose && <span className="sg-cd" title={T("Next close", "بسته‌شدن بعدی")}>⏱ {nextClose.tf} · {left(nextClose.at, now)}</span>}
        <span className="sg-sp" />
        <button type="button" className="sg-go" disabled={!!prog} onClick={async () => { for (const tf of tfs) await runScan(tf, false); }}>{prog ? "…" : "🔍 " + T("Scan now", "اسکن همین حالا")}</button>
        <button type="button" className="sg-go" onClick={csv} disabled={!merged.length} title="CSV">⬇ CSV</button>
      </div>
      <div className="sg-tabs" role="tablist">
        {([["signals", "📡", T("Signals", "سیگنال‌ها")], ["journal", "📊", T("Journal", "دفتر و ردیابی")], ["settings", "⚙", T("Settings", "تنظیمات")]] as const).map(([k, ic, nm]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{ic} {nm}{k === "signals" && shown.length ? <b>{shown.length}</b> : null}</button>
        ))}
      </div>
      {view === "signals" && (
      <div className="sg-pane">
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
        <span className="sg-chips" aria-label="Quality">
          {(["any", "B", "A"] as const).map((k) => (
            <button key={k} type="button" className={minGrade === k ? "on" : ""} onClick={() => setMinGrade(k)}>{k === "any" ? T("Any grade", "هر درجه") : k === "B" ? "B+" : T("A only", "فقط A")}</button>
          ))}
        </span>
        <select className="sg-strat" value={strat} onChange={(e) => setStrat(e.target.value)} aria-label="Strategy">
          <option value="all">{T("All strategies", "همه استراتژی‌ها")}</option>
          {STRAT_LIST.filter((x) => !off.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{L(x.name)} ({sigs.filter((g) => g.strat.id === x.id).length})</option>)}
        </select>
        {scanned && <small className="sg-when">{T("Last scan", "آخرین اسکن")} {new Date(scanned.at).toLocaleTimeString()} · {scanned.tf} · {scanned.n} {T("symbols", "نماد")}{scanned.live ? " · " + T("candle still forming", "کندل هنوز بسته نشده") : ""}</small>}
      </div>
      {msg && <p className="sg-msg">{msg}</p>}
      {dropRef.current > 0 && <p className="sg-drop">🧹 {T(`${dropRef.current} signal(s) hidden: price already hit the stop/first target or fell back below the broken level.`, `${dropRef.current} سیگنال پنهان شد: قیمت به حد ضرر/تارگت اول رسیده یا دوباره زیر سطح شکسته‌شده برگشته.`)}</p>}
      {!shown.length && <p className="sg-empty">{scanned ? T("No signal passed the checks. That is normal — most of the time there is nothing worth taking.", "هیچ سیگنالی از فیلترها رد نشد. طبیعی است — بیشتر وقت‌ها چیز خوبی نیست.") : T("Turn the Agent on, or press Scan now. Signals appear here for you to review.", "ایجنت را روشن کن یا اسکن بزن. سیگنال‌ها اینجا برای بررسی می‌آیند.")}</p>}
      {(["long", "short"] as const).map((sd) => {
        const k = shown.filter((x) => x.side === sd).length;
        return k >= 4 ? <p key={sd} className="sg-msg">⚠ {T(`${k} ${sd} signals at once — they are probably one correlated bet; size them together, not separately.`, `${k} سیگنال ${sd === "long" ? "خرید" : "فروش"} هم‌زمان — احتمالاً یک شرط همبسته‌اند؛ ریسک را روی مجموعشان حساب کن، نه تک‌تک.`)}</p> : null;
      })}
      <div className="sg-list">
        {shown.map((s, i) => (
          <React.Fragment key={s.symbol + s.tf + s.side}>
          {i === 0 && nStrong > 0 && <h4 className="sg-sec strong">💪 {T("Strong — everything lines up", "قوی — همه‌چیز هم‌خوان است")} <small>{nStrong}</small></h4>}
          {i === nStrong && shown.length > nStrong && <h4 className="sg-sec rest">{T("The rest — weaker or missing a confirmation", "بقیه — ضعیف‌تر یا بدون یک تأیید")} <small>{shown.length - nStrong}</small></h4>}
          <article key={s.symbol + s.tf + s.side} className={"sg-card " + (openId === s.symbol + s.tf + s.side ? "open " : "") + (s.side === "long" ? "up" : "dn") + (isHot(s) || s.all.length > 1 ? " hot" : "") + (s.all.length > 1 ? " multi" : "") + (isTop(s) ? " top" : "")}>
            <header role="button" tabIndex={0} aria-expanded={openId === s.symbol + s.tf + s.side} onClick={() => setOpenId(openId === s.symbol + s.tf + s.side ? null : s.symbol + s.tf + s.side)} onKeyDown={(e: any) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(openId === s.symbol + s.tf + s.side ? null : s.symbol + s.tf + s.side))}>
              <Ring v={s.score} g={s.grade} />
              <div className="sg-id">
                <b>{fa ? FA_NAME[s.base] || s.base : s.base} <span className="sg-tfc">{s.tf}</span>{s.forming && <small>{T("forming", "در حال شکل‌گیری")}</small>}</b>
                <em>{fmt(s.price)}</em>
              </div>
              <span className={"sg-side " + s.side}>{s.side === "long" ? "▲ " + T("LONG", "خرید") : "▼ " + T("SHORT", "فروش")}</span>
              <span className="sg-mini-b">{isTop(s) && "⭐"}{s.mtf.length > 1 && <b title="multi-timeframe">⏱{s.mtf.join("+")}</b>}{s.tgt && <b className={s.tgt.rr < 1.5 ? "w" : "g"} title={T("Reward-to-risk to the next level", "نسبت سود به ریسک تا سطح بعدی")}>R:R {s.tgt.rr.toFixed(1)}</b>}{(() => { const rr0 = Math.abs(s.entry - s.stop) || 1, pr = ((s.price - s.entry) / rr0) * (s.side === "long" ? 1 : -1); return <b className={pr >= 0 ? "g" : "w"} title={T("Where price is now, in R from the entry", "قیمت الان چند R از نقطه‌ی ورود فاصله دارد")}>{pr >= 0 ? "+" : ""}{pr.toFixed(1)}R</b>; })()}{s.all.length > 1 && <b>✅{s.all.length}</b>}{isHot(s) && "🔥"}</span>
              <span className="sg-strs">{s.all.map((x) => L(x.strat.name)).join(" · ")}</span>
              <i className="sg-chev">{openId === s.symbol + s.tf + s.side ? "▴" : "▾"}</i>
            </header>
            {openId === s.symbol + s.tf + s.side && <div className="sg-more">
            <p className="sg-an">🕒 {T("Analysed on the", "تحلیل روی چارت")} <b>{s.tf}</b> {T("chart", "")}{s.htf ? <> · {T("bigger trend from", "روند بزرگ‌تر از")} <b>{s.htf.tf}</b></> : null} · {s.forming ? T("candle still forming", "کندل هنوز بسته نشده") : <>{T("signal candle closed", "کندل سیگنال بسته شد")} {new Date(Math.floor(s.at / 1000 / (TF_SEC[s.tf] || 1)) * (TF_SEC[s.tf] || 1) * 1000).toLocaleTimeString()}</>} · {T("scanned", "اسکن")} {Math.max(0, Math.round((now - s.at) / 60000))} {T("min ago", "دقیقه پیش")}</p>
            <div className="sg-badges">
              {isTop(s) && <span className="sg-top">⭐ {T("Top signal", "سیگنال ممتاز")}</span>}
              {s.all.length > 1 && <span className="sg-multi">✅ {T(`${s.all.length} strategies confirm`, `${s.all.length} استراتژی تأیید کرده‌اند`)}</span>}
              {counter(s) && <span className="sg-warn">⚠ {T("Against BTC daily trend", "خلاف روند روزانه‌ی بیت‌کوین")}</span>}
              {maxStop > 0 && s.riskPct > maxStop && <span className="sg-warn">⚠ {T("Wide stop", "حد ضرر دور")} {s.riskPct.toFixed(1)}%</span>}
              {isHot(s) && <span className="sg-hot">🔥 {T("Strong + volume", "قوی + حجم")}</span>}
              {s.all.map((x) => <span key={x.strat.id} className={"sg-tag " + x.strat.id} title={L(x.strat.basis)}>🏷 {L(x.strat.name)}</span>)}
            </div>
            <Mini s={s} />
            <div className="sg-chipsrow">
              {s.htf && <span className={"sg-c " + s.htf.trend}>{arrow(s.htf.trend)} {s.htf.tf} {trendTxt(s.htf.trend)}</span>}
              <span className={"sg-c " + s.trend}>{arrow(s.trend)} {s.tf} {trendTxt(s.trend)}</span>
              {s.level && <span className="sg-c lvl">📍 {s.level.kind === "support" ? T("Support", "حمایت") : T("Resistance", "مقاومت")} {fmt(s.level.price)} · {s.level.state === "broken" ? T("broken", "شکسته") : s.level.state === "retest" ? T("retest", "ریتست") : T("near", "نزدیک")}</span>}
              <span className="sg-c">🕯 {L(s.candle.name)}</span>
              <span className="sg-c vol"><i className="sg-vol"><u style={{ width: Math.min(100, (s.vol.ratio / 3) * 100) + "%" }} /></i> {L(s.vol.label)} ×{s.vol.ratio.toFixed(1)}</span>
              <span className="sg-c">RSI {s.rsi.toFixed(0)}</span>
              <span className="sg-c">SMA20 {s.sma.above20 ? "▲" : "▼"} · SMA50 {s.sma.above50 ? "▲" : "▼"}</span>
            </div>
            {s.all.map((x) => (
              <p key={x.strat.id} className={"sg-strat-l " + x.strat.id}><b>{L(x.strat.name)}</b> <span>{L(x.why[0] || x.strat.basis)}</span></p>
            ))}
            {(s.tgt || s.alt) && (
              <p className="sg-tg">
                {s.tgt && <span className={s.tgt.rr < 1.5 ? "w" : ""}>🎯 {T("Next level", "سطح بعدی")} {fmt(s.tgt.price)} · R:R <b>{s.tgt.rr.toFixed(1)}</b>{s.tgt.rr < 1.5 ? " — " + T("little room to run", "جای حرکت کم است") : ""}</span>}
                {s.alt && <span>↩ {T("Retest entry", "ورود با ریتست")} {fmt(s.alt.entry)} · R:R <b>{s.alt.rr.toFixed(1)}</b> <small>({T("limit order at the broken level", "سفارش حد در سطح شکسته‌شده")})</small></span>}
              </p>
            )}
            <div className="sg-lv">
              <div><dt>{T("Entry", "ورود")}</dt><dd>{fmt(s.entry)}</dd></div>
              <div className="r"><dt>{T("Stop", "حد ضرر")}</dt><dd>{fmt(s.stop)}<small>{s.riskPct.toFixed(1)}%</small></dd></div>
              <div className="g"><dt>1R</dt><dd>{fmt(s.t[0])}</dd></div>
              <div className="g"><dt>2R</dt><dd>{fmt(s.t[1])}</dd></div>
              <div className="g"><dt>3R</dt><dd>{fmt(s.t[2])}</dd></div>
            </div>
            {acct > 0 && (() => {
              const riskUsd = (acct * riskPct) / 100, qty = riskUsd / Math.max(1e-12, Math.abs(s.entry - s.stop)), notional = qty * s.entry;
              return <p className="sg-size">💰 {T("Size for", "حجم برای")} {riskPct}% {T("risk", "ریسک")} (${riskUsd.toFixed(0)}): <b>{fmt(qty)}</b> {s.base} ≈ ${notional.toFixed(0)} <small>({(notional / acct).toFixed(1)}×)</small></p>;
            })()}
            <details>
              <summary>{T("All reasons", "همه‌ی دلایل")}</summary>
              <ul>{Array.from(new Set(s.all.flatMap((x) => x.why.map((w) => L(w))))).map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
            <button type="button" className="sg-watch" onClick={() => setWatch((a) => (a.some((w) => w.symbol === s.symbol && w.side === s.side) ? a : a.concat({ id: s.symbol + s.side + Date.now(), symbol: s.symbol, base: s.base, tf: s.tf, side: s.side, at: Date.now() })))}>👁 {T("Watch — notify me when it triggers", "دیده‌بانی — وقتی فعال شد خبر بده")}</button>
            <button type="button" className="sg-open" onClick={() => open(s)}>📈 {T("Open chart & analysis", "باز کردن چارت و تحلیل")}</button>
            </div>}
          </article>
          </React.Fragment>
        ))}
      </div>
      </div>
      )}
      {view === "journal" && (
      <div className="sg-pane">
      <details className="sg-set">
        <summary>📊 {T("Results journal (which strategies work?)", "دفتر نتایج (کدام استراتژی جواب می‌دهد؟)")} · {stats._all ? stats._all.n + stats._all.open : 0}</summary>
        <p className="sg-jn">{T("Every signal from a closed-candle scan is tracked automatically: win = reaches 1R before the stop; loss = stop first; after 30 candles it expires at its current R. Sample sizes are small at first — wait for 30+ per strategy.", "هر سیگنال اسکنِ کندل بسته به‌طور خودکار دنبال می‌شود: برد = رسیدن به 1R پیش از حد ضرر؛ باخت = اول حد ضرر؛ بعد از ۳۰ کندل با R همان لحظه بسته می‌شود. در ابتدا نمونه‌ها کم‌اند — منتظر ۳۰+ سیگنال برای هر استراتژی بمان.")}</p>
        <div className="sg-jt">
          <div className="h"><span>{T("Strategy", "استراتژی")}</span><span>{T("Closed", "بسته")}</span><span>{T("Win %", "برد ٪")}</span><span>{T("Avg R", "میانگین R")}</span><span>{T("Open", "باز")}</span></div>
          {[{ id: "_top", name: { en: "⭐ Top signals", fa: "⭐ سیگنال‌های ممتاز" } }, ...STRAT_LIST.map((x) => ({ id: x.id as string, name: x.name })), { id: "_all", name: { en: "All", fa: "همه" } }].map((x) => {
            const o = stats[x.id] || { n: 0, w: 0, sum: 0, open: 0 };
            return (
              <div key={x.id} className={x.id.startsWith("_") ? "tot" : ""}>
                <span>{L(x.name)}</span><span>{o.n}</span><span>{o.n ? Math.round((o.w / o.n) * 100) + "%" : "—"}</span>
                <span className={o.n && o.sum / o.n > 0 ? "g" : o.n ? "r" : ""}>{o.n ? (o.sum / o.n).toFixed(2) : "—"}</span><span>{o.open}</span>
              </div>
            );
          })}
        </div>
        <button type="button" className="sg-go" onClick={() => { if (confirm(T("Clear the journal?", "دفتر پاک شود؟"))) { jr.current = []; jset("arcus.ag2.journal", []); setJver((v) => v + 1); } }}>{T("Clear journal", "پاک کردن دفتر")}</button>
      </details>
      <details className="sg-hist">
        <summary>📌 {T("Tracked signals (live status)", "سیگنال‌های ردیابی‌شده (وضعیت زنده)")} ({jr.current.length})</summary>
        <div className="sg-trk">
          {jr.current.slice(-20).reverse().map((e) => (
            <div key={e.id} className={e.st}>
              <b>{fa ? FA_NAME[e.base] || e.base : e.base}</b><span>{e.tf} · {e.side === "long" ? T("long", "خرید") : T("short", "فروش")}</span>
              <span>{STRAT_LIST.find((x) => x.id === e.strat)?.name[fa ? "fa" : "en"]}</span>
              <em>{e.st === "open" ? "⏳ " + T("open", "باز") : e.st === "win" ? "✅ 1R · " + e.bars : e.st === "loss" ? "🛑 −1R · " + e.bars : "⌛ " + e.r.toFixed(1) + "R"}</em>
            </div>
          ))}
        </div>
      </details>
      {watch.length > 0 && (
        <details className="sg-hist" open>
          <summary>👁 {T("Watching", "دیده‌بانی")} ({watch.length})</summary>
          {watch.map((w) => (
            <p key={w.id}>{fa ? FA_NAME[w.base] || w.base : w.base} {w.tf} {w.side === "long" ? T("long", "خرید") : T("short", "فروش")} <button type="button" className="sg-go" onClick={() => setWatch((a) => a.filter((x) => x.id !== w.id))}>✕</button></p>
          ))}
        </details>
      )}
      {hist.length > 0 && (
        <details className="sg-hist">
          <summary>{T("Announcements", "اعلان‌های گذشته")} ({hist.length})</summary>
          {hist.map((h) => <p key={h.at}><small>{new Date(h.at).toLocaleString()}</small> {fa ? h.fa : h.en}</p>)}
        </details>
      )}
      </div>
      )}
      {view === "settings" && (
      <div className="sg-pane">
        <div className="sg-grp">
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
        <VoiceControl chan="agent" label={T("Voice", "صدا")} sample={{ en: "4-hour candle closes in 2 minutes. 4 signals are available from the latest scan.", fa: "کندل ۴ ساعته تا ۲ دقیقه دیگر بسته می‌شود. ۴ سیگنال از اسکن اخیر موجود است." }} />
        <button type="button" className="sg-lang" onClick={() => setLang(fa ? "en" : "fa")}>{fa ? "EN" : "فا"}</button>
        </div>
      <div className="sg-sub">
        <span>{T("Checks every symbol of", "همه نمادهای")}: {groups.length ? groups.map(([e, n]) => <em key={e}>{e} {n}</em>) : <em>—</em>} <small>{T("(switch exchanges on/off at the top of the app)", "(صرافی‌ها را از بالای برنامه روشن/خاموش کن)")}</small></span>
        <label className="sg-nt"><input type="checkbox" checked={notifyTop} onChange={(e) => setNotifyTop(e.target.checked)} /> ⭐ {T("Notify me about top signals", "نوتیف برای سیگنال‌های ممتاز")}</label>
        {(mkt || breadth) && (
          <span className="sg-mk2">
            {mkt && <em className={mkt}>₿ 1D {mkt === "up" ? "▲" : mkt === "down" ? "▼" : "▬"}</em>}
            {breadth && <em className={breadth.up / breadth.n >= 0.5 ? "up" : "down"} title={T("Share of scanned symbols above their SMA50", "سهم نمادهای اسکن‌شده بالای SMA50")}>{T("Breadth", "عرض بازار")} {Math.round((breadth.up / breadth.n) * 100)}%</em>}
          </span>
        )}
        {perm === "default" && <button type="button" className="sg-perm" onClick={askPerm}>🔔 {T("Allow notifications", "اجازه‌ی اعلان")}</button>}
        {on && <span className="sg-hint">{T("Scans after each candle close and on the auto-scan timer; works while the app stays open (any tab).", "بعد از بسته‌شدن هر کندل و با تایمر اسکن خودکار کار می‌کند؛ تا وقتی برنامه باز است (در هر تب).")}</span>}
      </div>
      <details className="sg-set">
        <summary>⚙ {T("Strategies on / off", "فعال / غیرفعال کردن استراتژی‌ها")} ({STRAT_LIST.length - off.length}/{STRAT_LIST.length})</summary>
        <div className="sg-set-list">
          {STRAT_LIST.map((x) => (
            <label key={x.id} className={"sg-set-row " + x.id}>
              <input type="checkbox" checked={!off.includes(x.id)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((y) => y !== x.id) : [...o, x.id]))} />
              <span><b>{L(x.name)}</b><small>{L(x.basis)}</small></span>
            </label>
          ))}
        </div>
      </details>
      <details className="sg-set">
        <summary>🛡 {T("Filters & position size", "فیلترها و اندازه‌ی پوزیشن")}</summary>
        <div className="sg-form">
          <label>{T("Account size ($)", "اندازه‌ی حساب ($)")}<input type="number" min={0} value={acct} onChange={(e) => setAcct(Math.max(0, Number(e.target.value)))} /></label>
          <label>{T("Risk per trade (%)", "ریسک هر معامله (٪)")}<input type="number" min={0.1} step={0.1} value={riskPct} onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value)))} /></label>
          <label>{T("Min traded value per candle", "حداقل ارزش معامله در هر کندل")}
            <select value={minLiq} onChange={(e) => setMinLiq(Number(e.target.value))}>
              <option value={0}>{T("No filter", "بدون فیلتر")}</option>
              {[1000, 10000, 50000, 200000, 1000000].map((v) => <option key={v} value={v}>${v.toLocaleString()}</option>)}
            </select>
          </label>
          <label>{T("Against BTC daily trend", "خلاف روند روزانه‌ی بیت‌کوین")}
            <select value={mktMode} onChange={(e) => setMktMode(e.target.value as any)}>
              <option value="off">{T("Ignore", "نادیده")}</option>
              <option value="warn">{T("Warn", "هشدار")}</option>
              <option value="hide">{T("Hide", "پنهان")}</option>
            </select>
          </label>
          <label>{T("Hide if next level is closer than (R)", "پنهان اگر سطح بعدی نزدیک‌تر از (R)")}
            <select value={minRR} onChange={(e) => setMinRR(Number(e.target.value))}>
              <option value={0}>{T("Off", "خاموش")}</option>
              {[1, 1.5, 2, 3].map((v) => <option key={v} value={v}>{v}R</option>)}
            </select>
          </label>
          <label>{T("Warn if stop is wider than (%)", "هشدار اگر حد ضرر دورتر از (٪)")}
            <select value={maxStop} onChange={(e) => setMaxStop(Number(e.target.value))}>
              <option value={0}>{T("Off", "خاموش")}</option>
              {[2, 3, 5, 8, 12].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
        </div>
        {mkt && <p className="sg-mk">₿ {T("BTC daily trend", "روند روزانه‌ی بیت‌کوین")}: <b className={mkt}>{mkt === "up" ? T("Up", "صعودی") : mkt === "down" ? T("Down", "نزولی") : T("Sideways", "خنثی")}</b></p>}
      </details>
      </div>
      )}
      <p className="sg-note">{T("Signals come from standard technical-analysis rules (trend, support/resistance breaks, candle shape, volume, RSI, SMA). They are leads to review, not advice.", "سیگنال‌ها از قواعد استاندارد تحلیل تکنیکال می‌آیند (روند، شکست حمایت/مقاومت، شکل کندل، حجم، RSI، SMA). فقط سرنخ برای بررسی‌اند، نه توصیه.")}</p>
    </div>
  );
}
