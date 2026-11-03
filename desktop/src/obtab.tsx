/* Order book tab: resting orders from the big exchanges, summed into price buckets.
   Pick a symbol, then switch the timeframe to zoom the price window and see where the large orders sit. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bucket, EXCHANGES, ExState, buildLadder, loadBooks, loadSymbols } from "./orderbook";

const TFS: { id: string; pct: number; hint: string }[] = [
  { id: "1m", pct: 0.2, hint: "±0.2% around the price" },
  { id: "5m", pct: 0.5, hint: "±0.5%" },
  { id: "15m", pct: 1, hint: "±1%" },
  { id: "1h", pct: 2, hint: "±2%" },
  { id: "4h", pct: 5, hint: "±5%" },
  { id: "1d", pct: 10, hint: "±10%" },
];
const money = (v: number) => (v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0));
const px = (v: number) => (v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const read = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function OrderBook(p: { bases: string[]; initial?: string }) {
  const [base, setBase] = useState(() => read("arcus.ob.base", p.initial || "BTC").toUpperCase());
  const [typed, setTyped] = useState(base);
  const [tf, setTf] = useState(() => read("arcus.ob.tf", "15m"));
  const [off, setOff] = useState<string[]>(() => {
    try {
      return JSON.parse(read("arcus.ob.off", "[]"));
    } catch {
      return [];
    }
  });
  const [states, setStates] = useState<ExState[]>([]);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(0);
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [all, setAll] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    loadSymbols(c.signal).then(setAll);
    return () => c.abort();
  }, []);
  const coins = useMemo(() => {
    const seen = new Set<string>(), out: string[] = [];
    for (const s of [...all, ...p.bases]) if (!seen.has(s)) { seen.add(s); out.push(s); }
    return out;
  }, [all, p.bases]);
  const pct = TFS.find((t) => t.id === tf)?.pct || 1;
  const ids = useMemo(() => EXCHANGES.map((e) => e.id).filter((i) => !off.includes(i)), [off]);
  const seq = useRef(0);

  useEffect(() => {
    const ctl = new AbortController();
    const n = ++seq.current;
    setBusy(true);
    // keep what is already on screen while refreshing; each exchange replaces its own entry the moment it answers
    setStates((cur) => cur.filter((s) => ids.includes(s.id)));
    loadBooks(base, pct, ids, (s) => {
      if (n !== seq.current) return;
      setStates((cur) => [...cur.filter((x) => x.id !== s.id), s]);
      setUpdated(Date.now());
    }, ctl.signal).finally(() => n === seq.current && setBusy(false));
    return () => ctl.abort();
  }, [base, pct, ids, tick]);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 6000);
    return () => window.clearInterval(id);
  }, [auto]);

  const books = useMemo(() => states.filter((s) => s.ok && s.book).map((s) => s.book!), [states]);
  const lad = useMemo(() => buildLadder(books, pct), [books, pct]);
  const walls = useMemo(() => {
    if (!lad) return { set: new Set<Bucket>(), list: [] as { b: Bucket; side: string }[] };
    const all = [...lad.asks.map((b) => ({ b, side: "ask" })), ...lad.bids.map((b) => ({ b, side: "bid" }))].filter((x) => x.b.total > 0);
    const sorted = all.map((x) => x.b.total).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const list = all.filter((x) => x.b.total >= Math.max(med * 2.5, lad.maxTotal * 0.35)).sort((a, b) => b.b.total - a.b.total).slice(0, 8);
    return { set: new Set(list.map((x) => x.b)), list };
  }, [lad]);

  const pick = (b: string) => {
    const v = b.trim().toUpperCase().replace(/[-/ ]?(USD|USDT|PERP)$/, "");
    if (!v) return;
    setBase(v);
    setTyped(v);
    write("arcus.ob.base", v);
  };
  const setFrame = (t: string) => {
    setTf(t);
    write("arcus.ob.tf", t);
  };
  const toggle = (id: string) => {
    const next = off.includes(id) ? off.filter((x) => x !== id) : [...off, id];
    setOff(next);
    write("arcus.ob.off", JSON.stringify(next));
  };
  const dist = (b: Bucket) => (lad ? ((b.mid / lad.mid - 1) * 100).toFixed(2) + "%" : "");
  const total = lad ? lad.bidSum + lad.askSum : 0;
  const bidPct = total ? (lad!.bidSum / total) * 100 : 50;
  const row = (b: Bucket, side: "ask" | "bid") => (
    <div key={side + b.lo} className={"ob-row " + side + (walls.set.has(b) ? " wall" : "")} title={Object.entries(b.by).map(([k, v]) => (EXCHANGES.find((e) => e.id === k)?.label || k) + " " + money(v)).join(" · ")}>
      <span className="ob-px">{px(b.mid)}</span>
      <span className="ob-dist">{dist(b)}</span>
      <span className="ob-bar">
        <span className="ob-fill" style={{ width: (b.total / lad!.maxTotal) * 100 + "%" }}>
          <span className="ob-split">
            {EXCHANGES.filter((e) => b.by[e.id]).map((e) => (
              <i key={e.id} style={{ flex: b.by[e.id], background: e.color }} />
            ))}
          </span>
        </span>
      </span>
      <span className="ob-val">{b.total ? money(b.total) : ""}</span>
    </div>
  );
  const quick = (all.length ? all.slice(0, 14) : ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE"]).filter((q) => q !== base).slice(0, 13);
  const shownCoins = showAll ? coins.filter((c) => !typed || typed === base || c.includes(typed)) : [];
  return (
    <div className="ob-tab">
      <div className="heading">
        <div>
          <small>LIQUIDITY</small>
          <h1>Order book</h1>
        </div>
        <div className="news-head-btns">
          <button className={"secondary" + (auto ? " on" : "")} onClick={() => setAuto(!auto)} title="Refresh every few seconds">
            {auto ? "● Live" : "○ Paused"}
          </button>
          <button className="secondary" onClick={() => setTick((v) => v + 1)} disabled={busy}>
            {busy ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>
      </div>
      <div className="ob-controls">
        <form
          className="ob-sym"
          onSubmit={(e) => {
            e.preventDefault();
            pick(typed);
          }}
        >
          <input list="ob-bases" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} onFocus={(e) => e.currentTarget.select()} placeholder="Symbol, e.g. BTC" aria-label="Symbol" />
          <datalist id="ob-bases">{coins.map((b) => <option key={b} value={b} />)}</datalist>
          <button type="submit" className="secondary">Go</button>
        </form>
        <div className="ob-quick">
          <button className="secondary on" title="Selected symbol">{base}</button>
          {quick.map((q) => (
            <button key={q} className="secondary" onClick={() => pick(q)}>{q}</button>
          ))}
          <button className={"secondary" + (showAll ? " on" : "")} onClick={() => setShowAll(!showAll)} title="Browse every coin">All coins ({coins.length || "…"})</button>
        </div>
        <div className="ob-tfs" role="tablist">
          {TFS.map((t) => (
            <button key={t.id} className={tf === t.id ? "on" : ""} onClick={() => setFrame(t.id)} title={t.hint}>{t.id}</button>
          ))}
          <small>±{pct}%</small>
        </div>
      </div>
      {showAll && (
        <div className="ob-all">
          {shownCoins.length ? shownCoins.map((c) => (
            <button key={c} className={c === base ? "on" : ""} onClick={() => { pick(c); setShowAll(false); }}>{c}</button>
          )) : <span className="muted">No coin matches “{typed}”.</span>}
        </div>
      )}
      <div className="ob-ex">
        {EXCHANGES.map((e) => {
          const s = states.find((x) => x.id === e.id);
          const isOff = off.includes(e.id);
          return (
            <button key={e.id} className={"ob-chip" + (isOff ? " off" : s && !s.ok ? " bad" : "")} onClick={() => toggle(e.id)} title={isOff ? "Click to include" : s && !s.ok ? s.msg || "unavailable" : "Click to hide. “depth” = how far from the price this exchange's order book reaches (not an error)."}>
              <i style={{ background: e.color }} />
              {e.label}
              <small>{isOff ? "off" : s ? (s.ok ? (lad ? "depth " + (lad.coverage[e.id] > 50 ? ">50" : lad.coverage[e.id]?.toFixed(lad.coverage[e.id] < 1 ? 2 : 1)) + "%" : "ok") : s.msg || "n/a") : "…"}</small>
            </button>
          );
        })}
      </div>
      {!lad && !busy && <div className="empty">No order book could be loaded for “{base}”. Try another symbol, or turn on more exchanges.</div>}
      {!lad && busy && <div className="empty">Loading order books…</div>}
      {lad && (
        <div className="ob-main">
          <div className="ob-ladder">
            <div className="ob-sum">
              <b>{base}</b> <span>{px(lad.mid)}</span>
              <div className="ob-imb" title="Resting buy vs sell orders inside this window">
                <i className="b" style={{ width: bidPct + "%" }}>Buy {money(lad.bidSum)}</i>
                <i className="a" style={{ width: 100 - bidPct + "%" }}>Sell {money(lad.askSum)}</i>
              </div>
            </div>
            <div className="ob-head"><span>Price</span><span>From price</span><span>Orders (USD, by exchange)</span><span>Total</span></div>
            {[...lad.asks].reverse().map((b) => row(b, "ask"))}
            <div className="ob-mid">{px(lad.mid)}</div>
            {lad.bids.map((b) => row(b, "bid"))}
          </div>
          <aside className="ob-walls">
            <h3>Biggest walls · {tf}</h3>
            {!walls.list.length && <p className="muted">No clear wall in this window.</p>}
            {walls.list.map((w) => (
              <div key={w.side + w.b.lo} className={"ob-wall " + w.side}>
                <b>{w.side === "bid" ? "Buy" : "Sell"} {money(w.b.total)}</b>
                <span>at {px(w.b.mid)} <em>({dist(w.b)})</em></span>
              </div>
            ))}
            <p className="muted ob-note">Sums resting limit orders from the exchanges switched on above. Orders can be pulled at any time, so a wall is a hint, not a promise. Hover a row to see the exchange split.{updated ? " Updated " + new Date(updated).toLocaleTimeString() + "." : ""}</p>
          </aside>
        </div>
      )}
    </div>
  );
}
