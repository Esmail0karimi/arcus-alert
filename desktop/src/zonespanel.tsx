/* Order-book tab section: symbols that look like they are in an accumulation zone, a distribution zone, or squeezed into a tight box. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FA_NAME, TF_SEC } from "./agent";
import { closedRows } from "./engine";
import { useLang } from "./lang";
import { detectZone, ZoneHit, ZoneKind } from "./zones";
import type { QCandle } from "./qfex";
import type { AgSym } from "./agenttab";

const fmt = (v: number) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const jget = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const jset = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function ZonesPanel(p: { syms: AgSym[]; fetchCandles: (symbol: string, tf: string, signal: AbortSignal) => Promise<QCandle[]>; onOpenChart?: (symbol: string, tf: string, setup: null) => boolean }) {
  const fa = useLang() === "fa";
  const T = (en: string, f: string) => (fa ? f : en);
  const [tf, setTf] = useState<"4h" | "1d">(() => jget("arcus.zn.tf", "4h"));
  const [kinds, setKinds] = useState<Record<ZoneKind, boolean>>(() => jget("arcus.zn.kinds", { acc: true, dist: true, box: true }));
  const [res, setRes] = useState<Record<string, { at: number; hits: ZoneHit[]; n: number; failed: number }>>(() => jget("arcus.zn.res", {}));
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [open, setOpen] = useState(true);
  const ctl = useRef<AbortController | null>(null);
  const symsRef = useRef(p.syms), fetchRef = useRef(p.fetchCandles);
  symsRef.current = p.syms;
  fetchRef.current = p.fetchCandles;
  useEffect(() => { jset("arcus.zn.tf", tf); jset("arcus.zn.kinds", kinds); }, [tf, kinds]);
  useEffect(() => () => ctl.current?.abort(), []);

  const scan = async () => {
    if (prog) return;
    const list = symsRef.current;
    if (!list.length) return;
    const c = (ctl.current = new AbortController());
    const hits: ZoneHit[] = [];
    let i = 0, done = 0, failed = 0;
    setProg({ done: 0, total: list.length });
    const worker = async () => {
      while (!c.signal.aborted) {
        const k = i++;
        if (k >= list.length) return;
        const s = list[k];
        try {
          const rows = closedRows(await fetchRef.current(s.symbol, tf, c.signal), tf, Date.now());
          const z = rows.length ? detectZone(rows) : null;
          if (!rows.length) failed++;
          else if (z) hits.push({ ...z, symbol: s.symbol, base: s.base, ex: s.ex, market: s.market, tf, lastTime: rows[rows.length - 1].time });
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          failed++;
        }
        done++;
        if (done % 5 === 0 || done === list.length) setProg({ done, total: list.length });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    setProg(null);
    if (c.signal.aborted) return;
    hits.sort((a, b) => b.score - a.score);
    const next = { ...res, [tf]: { at: Date.now(), hits: hits.slice(0, 150), n: list.length, failed } };
    setRes(next);
    jset("arcus.zn.res", next);
  };
  const cur = res[tf];
  const shown = useMemo(() => (cur?.hits || []).filter((h) => h.kinds.some((k) => kinds[k])), [cur, kinds]);
  const label = (k: ZoneKind) => (k === "acc" ? T("Accumulation", "انباشت") : k === "dist" ? T("Distribution", "توزیع") : T("Compression box", "فشرده در باکس"));
  const cnt = (k: ZoneKind) => (cur?.hits || []).filter((h) => h.kinds.includes(k)).length;

  return (
    <section className="zn" dir={fa ? "rtl" : "ltr"}>
      <header className="zn-h" onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        <b>🧭 {T("Accumulation / Distribution / Compression", "انباشت / توزیع / فشردگی")}</b>
        <span>{cur ? `${shown.length} ${T("symbols", "نماد")} · ${new Date(cur.at).toLocaleTimeString()}` : T("not scanned", "اسکن نشده")}</span>
        <i>{open ? "▴" : "▾"}</i>
      </header>
      {open && (
        <div className="zn-b">
          <div className="zn-bar">
            <span className="sg-chips">{(["4h", "1d"] as const).map((t) => <button key={t} type="button" className={tf === t ? "on" : ""} onClick={() => setTf(t)}>{t.toUpperCase()}</button>)}</span>
            <span className="sg-chips">{(["acc", "dist", "box"] as ZoneKind[]).map((k) => <button key={k} type="button" className={kinds[k] ? "on" : ""} onClick={() => setKinds({ ...kinds, [k]: !kinds[k] })}>{label(k)} {cur ? cnt(k) : ""}</button>)}</span>
            <button type="button" className="sg-go" disabled={!!prog} onClick={scan}>{prog ? `${prog.done}/${prog.total}` : "🔍 " + T("Scan", "اسکن")}</button>
          </div>
          {!cur && <p className="sx-hint">{T("Press Scan: it reads the last closed candles of every symbol on the exchanges switched on and lists the ones sitting in a sideways box after a decline (accumulation), after a rally (distribution), or squeezed tight (compression).", "اسکن را بزن: کندل‌های بسته‌شده‌ی همه‌ی نمادهای صرافی‌های روشن را می‌خواند و آن‌هایی را فهرست می‌کند که بعد از ریزش در یک باکس خنثی‌اند (انباشت)، بعد از رشد در باکس‌اند (توزیع)، یا فشرده شده‌اند.")}</p>}
          {cur && !shown.length && <p className="sx-hint">{T("Nothing matches right now.", "فعلاً موردی نیست.")}</p>}
          <div className="zn-list">
            {shown.map((h) => (
              <div key={h.symbol} className="zn-row" role="button" tabIndex={0} onClick={() => p.onOpenChart?.(h.symbol, h.tf, null)} title={T("Open chart", "باز کردن چارت")}>
                <b>{fa ? FA_NAME[h.base] || h.base : h.base}</b>
                <span className="zn-tags">{h.kinds.map((k) => <em key={k} className={k}>{label(k)}</em>)}</span>
                <span className="zn-box" title={T("Price position inside the box", "جای قیمت داخل باکس")}><i style={{ left: Math.min(98, Math.max(0, h.pos * 100)) + "%" }} /></span>
                <small>{fmt(h.lo)} – {fmt(h.hi)} · {h.bars} {T("candles", "کندل")}</small>
                <small>{h.prior >= 0 ? "▲" : "▼"} {Math.abs(h.prior).toFixed(0)}% {T("before", "قبلش")} · {T("vol up/down", "حجم صعودی/نزولی")} {h.tilt.toFixed(2)} · {T("squeeze", "فشردگی")} {h.squeeze.toFixed(2)}</small>
                <span className="zn-sc">{h.score}</span>
              </div>
            ))}
          </div>
          <p className="sx-hint">{T("Heuristic, from closed candles: a sideways box, what came before it, volume on up vs down candles, and ATR shrinking. It flags candidates to inspect — a box can break either way. Not advice.", "ابتکاری و از کندل بسته‌شده: باکس خنثی، حرکت قبل از آن، حجم کندل‌های صعودی در برابر نزولی و کوچک‌شدن ATR. فقط کاندیدا نشان می‌دهد — باکس به هر دو سمت می‌تواند بشکند. توصیه نیست.")}{cur && cur.failed ? ` ${T("Symbols without enough history", "نمادهای بدون تاریخچه‌ی کافی")}: ${cur.failed}.` : ""}</p>
        </div>
      )}
    </section>
  );
}
