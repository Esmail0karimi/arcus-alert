/* Auto-scan for the Analysis sections that can produce trade candidates (Momentum Burst, Analysis Pro) -> Agent.
   Same two-step flow as the Agent: WATCH first (setup exists, nothing confirmed), READY only after a CLOSED daily candle confirms it.
   Long-only, daily candles, stocks. Nothing here places or sends an order. */
import type { Bi } from "./agent";
import type { Sig2 } from "./engine";
import { Bar, Burst, Ctx, atr, burst, daily, expectedSession, loadCtx, mean, marketCtx, pool, pro, ySym } from "./analysislib";

export type AutoSrc = "burst" | "pro";
const b = (en: string, fa: string): Bi => ({ en, fa });
const TAG: Record<AutoSrc, Bi> = { burst: b("Momentum Burst", "مومنتوم بِرست"), pro: b("Analysis Pro", "آنالیز Pro") };
const STRAT: Record<AutoSrc, "mbs" | "apr"> = { burst: "mbs", pro: "apr" };

type Core = { symbol: string; base: string; src: AutoSrc; status: "watch" | "ready"; entry: number; stop: number; tp: number; score: number; candleTime: number; price: number; why: Bi[]; wait?: Bi; trig?: number; label: Bi };
const mk = (c: Core): Sig2 => {
  const risk = Math.max(1e-9, c.entry - c.stop), rr = (c.tp - c.entry) / risk;
  return {
    id: [c.src, c.symbol, c.status, c.candleTime].join("|"), symbol: c.symbol, base: c.base, market: "Stocks", ex: "Daily",
    side: "long", strat: STRAT[c.src], status: c.status, method: "none", tf: "1d",
    d1: null, h4: null, h1: null, m15: { ok: null, text: b("daily setup — no 15M step", "ستاپ روزانه — بدون مرحله‌ی ۱۵ دقیقه") },
    entry: c.entry, stop: c.stop, tp: c.tp, tpNote: b("Measured 2R (no level-based target in daily auto-scan)", "هدف ۲R اندازه‌گیری‌شده (در اسکن خودکار روزانه هدف سطحی نیست)"), rr, rrGross: rr,
    score: Math.round(c.score), grade: c.score >= 80 ? "excellent" : c.score >= 65 ? "good" : "watchlist",
    parts: { structure: 0, setup: 0, pa: 0, vol: 0, rsi: 0, macd: 0, entryQ: 0, rr: 0 },
    time: Date.now(), candleTime: c.candleTime, price: c.price, why: c.why, wait: c.wait, trig: c.trig, missing: [], tag: TAG[c.src], status2: c.label,
  };
};
const sec = (d: string) => Math.floor(new Date(d + "T00:00:00Z").getTime() / 1000);

/** Momentum Burst: the trigger day may be today (-> WATCH) or up to 3 sessions back (-> READY when a later close holds above its high on volume and the gate is open) */
export function burstSignals(sym: string, bars: Bar[], cutoff: string, allow: boolean): Sig2[] {
  const out: Sig2[] = [];
  for (let back = 3; back >= 0; back--) {
    const cut = bars.filter((x) => x.d <= cutoff);
    if (cut.length < 30 + back) continue;
    const upTo = cut.slice(0, cut.length - back), tdate = upTo[upTo.length - 1].d;
    const r: Burst = burst(sym, upTo, tdate, "allow", 100000);
    if (r.state === "REJECTED" || r.score < 50) continue;
    const after = cut.slice(cut.length - back); // sessions after the trigger day
    const avg20 = mean(upTo.slice(-21, -1).map((x) => x.v));
    const last = cut[cut.length - 1];
    const broke = after.length > 0 && after.some((x) => x.c > r.entry && x.v >= avg20) && last.c > r.entry && last.c > r.stop && after.every((x) => x.c > r.stop);
    const risk = r.entry - r.stop;
    if (!(risk > 0) || (risk / r.entry) * 100 > 8) continue;
    const base: Omit<Core, "status" | "entry" | "tp"> = { symbol: sym, base: sym, src: "burst", stop: r.stop, score: r.score, candleTime: sec(tdate), price: last.c, why: [b(`${r.triggers.join(" + ")} on ${tdate}: +${r.gain.toFixed(1)}%, volume ×${r.volRatio.toFixed(1)}, close at ${r.loc.toFixed(0)}% of range`, `${r.triggers.join(" + ")} در ${tdate}: حجم ×${r.volRatio.toFixed(1)}، کلوز در ${r.loc.toFixed(0)}٪ دامنه`)], label: b(`grade ${r.rating}`, `درجه ${r.rating}`) } as any;
    if (broke) out.push(mk({ ...base, status: "ready", entry: r.entry, tp: r.entry + 2 * risk, wait: undefined } as Core));
    else if (back === 0 || !after.some((x) => x.c <= r.stop)) out.push(mk({ ...base, status: "watch", entry: r.entry, tp: r.entry + 2 * risk, trig: r.entry, wait: b(`Needs a daily CLOSE above ${r.entry.toFixed(2)} on volume (trigger-day high)${allow ? "" : " — market gate closed (SPY/QQQ below 50DMA): will stay on watch"}`, `نیاز به کلوز روزانه بالای ${r.entry.toFixed(2)} با حجم (سقف روز ماشه)${allow ? "" : " — فیلتر بازار بسته (SPY/QQQ زیر ۵۰DMA): در واچ می‌ماند"}`) } as Core));
  }
  // prefer a confirmed (READY) older trigger; otherwise the most recent watch
  out.sort((a, c) => (a.status === "ready" ? 0 : 1) - (c.status === "ready" ? 0 : 1) || c.candleTime - a.candleTime);
  out.splice(1);
  if (out.length && out[0].status === "ready" && !allow) out[0] = { ...out[0], status: "watch", wait: b("Confirmed on the chart but the market gate is closed (SPY/QQQ below 50DMA) — stays on watch", "روی چارت تأیید شده ولی فیلتر بازار بسته است (SPY/QQQ زیر ۵۰DMA) — در واچ می‌ماند") };
  return out;
}
/** Analysis Pro: WATCH while the lean is FAVORABLE-ish; READY when a daily close breaks the 20-day high on volume above the 50DMA */
export function proSignals(sym: string, d: { bars: Bar[]; meta: any }, ctx: Ctx, allow: boolean): Sig2[] {
  const bars = d.bars;
  if (bars.length < 60) return [];
  const r = pro(sym, d, ctx);
  if (r.lean === "CAUTIOUS" || r.score < 0.15) return [];
  const last = bars[bars.length - 1], hh = Math.max(...bars.slice(-21, -1).map((x) => x.h)), v20 = mean(bars.slice(-21, -1).map((x) => x.v));
  const s50 = mean(bars.slice(-50).map((x) => x.c)), a = atr(bars);
  const stop = last.c - 2 * a, risk = last.c - stop;
  const why = [b(`Lean ${r.lean}, score ${r.score.toFixed(2)}, confidence ${r.confidence}% (price-based factors only)`, `تمایل ${r.lean}، امتیاز ${r.score.toFixed(2)}، اطمینان ${r.confidence}٪ (فقط عامل‌های قیمتی)`)];
  const sc = Math.min(100, 50 + r.score * 60);
  const core = { symbol: sym, base: sym, src: "pro" as const, score: sc, candleTime: sec(last.d), price: last.c, why, label: b(r.lean, r.lean) };
  if (last.c > hh && last.v >= 1.3 * v20 && last.c > s50 && allow && (risk / last.c) * 100 <= 8) return [mk({ ...core, status: "ready", entry: last.c, stop, tp: last.c + 2 * risk })];
  const e = hh, st = e - 2 * a;
  return [mk({ ...core, status: "watch", entry: e, stop: st, tp: e + 2 * (e - st), trig: e, wait: b(`Needs a daily CLOSE above the 20-day high ${e.toFixed(2)} with volume ≥ 1.3× and price above the 50DMA${allow ? "" : " — market gate closed"}`, `نیاز به کلوز روزانه بالای سقف ۲۰ روزه ${e.toFixed(2)} با حجم ≥ ۱٫۳ برابر و بالای ۵۰DMA${allow ? "" : " — فیلتر بازار بسته"}`) })];
}

export async function autoScan(list: string[], srcs: AutoSrc[], onProg?: (d: number, n: number) => void, signal?: AbortSignal): Promise<{ ready: Sig2[]; watch: Sig2[]; failed: number; allow: boolean; n: number }> {
  const ctx = await loadCtx(signal);
  const m = marketCtx(ctx);
  const allow = !!(m.spy50 && m.qqq50) && !(m.vix > 30);
  let cutoff = expectedSession();
  if (ctx.spy && ctx.spy[ctx.spy.length - 1].d < cutoff) cutoff = ctx.spy[ctx.spy.length - 1].d;
  let failed = 0;
  const res = await pool(list, 6, async (s) => {
    try {
      const d = await daily(s, "1y", signal);
      const bars = d.bars.filter((x) => x.d <= cutoff);
      const o: Sig2[] = [];
      if (srcs.includes("burst")) o.push(...burstSignals(ySym(s), bars, cutoff, allow));
      if (srcs.includes("pro")) o.push(...proSignals(ySym(s), { bars, meta: d.meta }, ctx, allow));
      return o;
    } catch {
      failed++;
      return [] as Sig2[];
    }
  }, (d) => onProg?.(d, list.length), signal);
  const all = res.flat().filter(Boolean);
  return { ready: all.filter((x) => x.status === "ready"), watch: all.filter((x) => x.status === "watch"), failed, allow, n: list.length };
}
