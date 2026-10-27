/* Screener tab: filter and rank the symbols you trade by volume, momentum, range and funding. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StatResult, StatRow, fetchStats } from "./screenerdata";

type Item = { sym: string; name: string; base: string; change?: number | null; price?: number };
type Preset = { id: string; label: string; hint: string; sort: (r: Row) => number | undefined; dir?: 1 | -1; keep?: (r: Row, t: { vol: number; spike: number }) => boolean; needs?: string };
type Row = StatRow & Item;

const fmtMoney = (v?: number) => (v == null ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0));
const fmtPct = (v?: number | null, d = 2) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%");
const cls = (v?: number | null) => (v == null ? "muted" : v >= 0 ? "positive" : "negative");

const PRESETS: Preset[] = [
  { id: "vol", label: "Top volume", hint: "Most dollars traded in the last 24 hours", sort: (r) => r.vol24, needs: "vol" },
  { id: "gain", label: "Top gainers", hint: "Biggest 24h rise", sort: (r) => r.chg24 ?? r.change ?? undefined, keep: (r) => (r.chg24 ?? r.change ?? 0) > 0 },
  { id: "lose", label: "Top losers", hint: "Biggest 24h fall", sort: (r) => r.chg24 ?? r.change ?? undefined, dir: -1, keep: (r) => (r.chg24 ?? r.change ?? 0) < 0 },
  { id: "above", label: "Volume above…", hint: "24h volume above the amount you set", sort: (r) => r.vol24, keep: (r, t) => (r.vol24 || 0) >= t.vol, needs: "vol" },
  { id: "spike", label: "Sudden volume", hint: "Last hour's volume vs the average hour of the previous day (×)", sort: (r) => r.spike, keep: (r, t) => (r.spike || 0) >= t.spike, needs: "spike" },
  { id: "mom", label: "Fast movers (1h)", hint: "Biggest move in the last hour, up or down", sort: (r) => (r.chg1h == null ? undefined : Math.abs(r.chg1h)), needs: "spike" },
  { id: "high", label: "Near 24h high", hint: "Price in the top 5% of its 24h range (breakout watch)", sort: (r) => r.pos, keep: (r) => (r.pos ?? 0) >= 95, needs: "vol" },
  { id: "low", label: "Near 24h low", hint: "Price in the bottom 5% of its 24h range", sort: (r) => r.pos, dir: -1, keep: (r) => r.pos != null && r.pos <= 5, needs: "vol" },
  { id: "range", label: "Most volatile", hint: "Widest 24h high–low range", sort: (r) => r.range, needs: "vol" },
  { id: "fund", label: "Funding extremes", hint: "Most one-sided perpetual funding (crowded longs or shorts)", sort: (r) => (r.funding == null ? undefined : Math.abs(r.funding)), needs: "fund" },
  { id: "oi", label: "Open interest", hint: "Largest open positions (USD)", sort: (r) => r.oi, needs: "fund" },
];

export function Screener(p: { items: Item[]; onOpen: (sym: string) => void }) {
  const [res, setRes] = useState<StatResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pre, setPre] = useState(() => localStorage.getItem("arcus.scr.pre") || "vol");
  const [volMin, setVolMin] = useState(() => Number(localStorage.getItem("arcus.scr.vol")) || 50);
  const [spikeMin, setSpikeMin] = useState(() => Number(localStorage.getItem("arcus.scr.spike")) || 3);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "data">("all");
  const itemsRef = useRef(p.items);
  itemsRef.current = p.items;
  const load = () => {
    const bases = Array.from(new Set<string>(itemsRef.current.map((i) => i.base)));
    if (!bases.length) return;
    setBusy(true);
    fetchStats(bases)
      .then(setRes)
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [p.items.length > 0]);
  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const preset = PRESETS.find((x) => x.id === pre) || PRESETS[0];
  const rows = useMemo(() => {
    const all: Row[] = p.items.map((i) => ({ ...(res?.rows[i.base] || { base: i.base, src: [] }), ...i, price: res?.rows[i.base]?.price ?? i.price }));
    const t = { vol: volMin * 1e6, spike: spikeMin };
    const ql = q.trim().toLowerCase();
    return all
      .filter((r) => (!ql || r.name.toLowerCase().includes(ql)) && (only === "all" || r.vol24 != null || r.chg24 != null))
      .filter((r) => (preset.keep ? preset.keep(r, t) : true) && preset.sort(r) != null)
      .sort((a, b) => ((preset.sort(b) as number) - (preset.sort(a) as number)) * (preset.dir || 1))
      .slice(0, 100);
  }, [p.items, res, pre, volMin, spikeMin, q, only]);
  const noData = res && Object.keys(res.rows).length === 0;
  return (
    <div className="scr-tab">
      <div className="heading">
        <div>
          <small>FILTER</small>
          <h1>Screener</h1>
          <p>Find what is moving right now across the symbols you trade. Updates every minute.</p>
        </div>
        <button className="secondary" onClick={load} disabled={busy}>
          {busy ? "Loading…" : "⟳ Refresh"}
        </button>
      </div>
      <div className="scr-presets">
        {PRESETS.map((x) => (
          <button
            key={x.id}
            className={pre === x.id ? "on" : ""}
            title={x.hint}
            onClick={() => {
              setPre(x.id);
              save("arcus.scr.pre", x.id);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="scr-bar">
        <span className="scr-hint">{preset.hint}</span>
        {pre === "above" && (
          <label>
            Min volume $
            <input type="number" min={0} value={volMin} onChange={(e) => (setVolMin(Number(e.target.value) || 0), save("arcus.scr.vol", String(e.target.value)))} />M
          </label>
        )}
        {pre === "spike" && (
          <label>
            Min spike ×
            <input type="number" min={1} step={0.5} value={spikeMin} onChange={(e) => (setSpikeMin(Number(e.target.value) || 1), save("arcus.scr.spike", String(e.target.value)))} />
          </label>
        )}
        <input className="scr-q" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="scr-chk">
          <input type="checkbox" checked={only === "data"} onChange={(e) => setOnly(e.target.checked ? "data" : "all")} /> only with market data
        </label>
      </div>
      {res && (
        <div className="news-status">
          {res.status.map((s) => (
            <span key={s.name} className={s.ok ? "ok" : "bad"}>
              {s.ok ? "●" : "○"} {s.name}
              {s.note ? " · " + s.note : ""}
            </span>
          ))}
          <span>updated {new Date(res.at).toLocaleTimeString()}</span>
        </div>
      )}
      {noData && <div className="empty">Volume data could not be loaded (exchange APIs blocked here). Price-change filters still work for symbols that report a 24h change.</div>}
      <div className="scr-table">
        <div className="scr-row head">
          <span>Symbol</span>
          <span>Price</span>
          <span>24h</span>
          <span>1h</span>
          <span>Volume 24h</span>
          <span>Spike</span>
          <span>Range</span>
          <span>Funding/8h</span>
          <span>Open int.</span>
        </div>
        {!rows.length && <div className="empty small">{res ? "Nothing matches this filter right now." : "Loading…"}</div>}
        {rows.map((r) => (
          <div key={r.sym} className="scr-row" onClick={() => p.onOpen(r.sym)}>
            <b>{r.name}</b>
            <span>{r.price != null ? r.price.toLocaleString(undefined, { maximumFractionDigits: r.price < 10 ? 5 : 2 }) : "—"}</span>
            <span className={cls(r.chg24 ?? r.change)}>{fmtPct(r.chg24 ?? r.change)}</span>
            <span className={cls(r.chg1h)}>{fmtPct(r.chg1h)}</span>
            <span>{fmtMoney(r.vol24)}</span>
            <span className={r.spike != null && r.spike >= 3 ? "hot" : ""}>{r.spike != null ? r.spike.toFixed(1) + "×" : "—"}</span>
            <span>{r.range != null ? r.range.toFixed(1) + "%" : "—"}</span>
            <span className={cls(r.funding == null ? null : -r.funding)}>{r.funding != null ? fmtPct(r.funding, 4) : "—"}</span>
            <span>{fmtMoney(r.oi)}</span>
          </div>
        ))}
      </div>
      <p className="news-foot">Volume, range and funding come from Binance and Hyperliquid and only exist for symbols they list; stocks and commodities show price change only. “Sudden volume” covers the 40 most-traded symbols. Funding: positive means longs pay shorts. Not trading advice.</p>
    </div>
  );
}
