/* Rehuman tab — pure maths for tools A–D (framework: Sepehr Irandoust videos, via the skill). No prices are hard-coded; everything comes from data or user input.
   Educational only — not financial advice. */
export const DISCLAIMER = { fa: "این ابزار آموزشی است و توصیه مالی نیست؛ مسئولیت تصمیم با خود شماست.", en: "This tool is educational and not financial advice; the decision and its responsibility are yours." };

/* ---------- A. 6-stage economic cycle ---------- */
export type Dir = "up" | "down" | "flat";
export const dirOf = (pct: number, thr: number): Dir => (pct > thr ? "up" : pct < -thr ? "down" : "flat");
/** [bonds, stocks, commodities] per stage. Stages 3, 5, 6 are stated in the source; 1, 2, 4 come from the source's chart + the classic cycle model (lower confidence). */
export const STAGES: { n: number; fa: string; en: string; bonds: Dir; stocks: Dir; comm: Dir; src: "doc" | "model" }[] = [
  { n: 1, fa: "آغاز بهبود", en: "Early recovery", bonds: "up", stocks: "down", comm: "down", src: "model" },
  { n: 2, fa: "رونق اولیه", en: "Early boom", bonds: "up", stocks: "up", comm: "down", src: "model" },
  { n: 3, fa: "رونق کامل", en: "Full boom", bonds: "up", stocks: "up", comm: "up", src: "doc" },
  { n: 4, fa: "داغ شدن", en: "Overheating", bonds: "down", stocks: "up", comm: "up", src: "model" },
  { n: 5, fa: "کندی", en: "Slowdown", bonds: "down", stocks: "down", comm: "up", src: "doc" },
  { n: 6, fa: "رکود", en: "Recession", bonds: "down", stocks: "down", comm: "down", src: "doc" },
];
export type Sector = { id: string; fa: string; en: string; etf: string; phase: string; phaseEn: string; order: number };
/** order = position in the source's rotation: tech (bottom of recession) -> comm/industrials -> materials/energy -> staples -> health/utilities -> real estate */
export const SECTORS: Sector[] = [
  { id: "tech", fa: "تکنولوژی", en: "Technology", etf: "XLK", phase: "کف رکود؛ سریع‌ترین بازگشت", phaseEn: "Recession bottom; fastest rebound", order: 1 },
  { id: "comm", fa: "ارتباطات", en: "Communication", etf: "XLC", phase: "بهبود اولیه", phaseEn: "Early recovery", order: 2 },
  { id: "ind", fa: "صنعتی", en: "Industrials", etf: "XLI", phase: "بهبود اولیه", phaseEn: "Early recovery", order: 2 },
  { id: "mat", fa: "مواد", en: "Materials", etf: "XLB", phase: "نزدیک اوج بازار", phaseEn: "Near market peak", order: 3 },
  { id: "en", fa: "انرژی", en: "Energy", etf: "XLE", phase: "نزدیک اوج بازار", phaseEn: "Near market peak", order: 3 },
  { id: "stap", fa: "کالاهای اساسی", en: "Staples", etf: "XLP", phase: "آستانه رکود", phaseEn: "Threshold of recession", order: 4 },
  { id: "hc", fa: "سلامت", en: "Health care", etf: "XLV", phase: "رکود", phaseEn: "Recession", order: 5 },
  { id: "ut", fa: "آب‌وبرق", en: "Utilities", etf: "XLU", phase: "رکود", phaseEn: "Recession", order: 5 },
  { id: "re", fa: "املاک", en: "Real estate", etf: "XLRE", phase: "آخرین بخش", phaseEn: "Last sector", order: 6 },
];
/** tool assumption: which sectors the rotation chain points at for each stage */
export const STAGE_SECTORS: Record<number, string[]> = { 1: ["tech", "comm", "ind"], 2: ["tech", "comm", "ind"], 3: ["ind", "mat", "en"], 4: ["mat", "en"], 5: ["stap", "en"], 6: ["hc", "ut", "stap"] };
export type StageRes = { stage: number | null; exact: boolean; near: number[]; dirs: { bonds: Dir; stocks: Dir; comm: Dir }; note: string[] };
export function detectStage(chg: { bonds: number; stocks: number; comm: number }, thr: number): StageRes {
  const dirs = { bonds: dirOf(chg.bonds, thr), stocks: dirOf(chg.stocks, thr), comm: dirOf(chg.comm, thr) };
  const hit = STAGES.find((s) => s.bonds === dirs.bonds && s.stocks === dirs.stocks && s.comm === dirs.comm);
  if (hit) return { stage: hit.n, exact: true, near: [], dirs, note: [] };
  const dist = STAGES.map((s) => ({ n: s.n, d: (["bonds", "stocks", "comm"] as const).filter((k) => s[k] !== dirs[k]).length }));
  const best = Math.min(...dist.map((x) => x.d));
  return { stage: null, exact: false, near: dist.filter((x) => x.d === best).map((x) => x.n), dirs, note: ["pattern is not in the table (or an index is flat inside the noise band): transitional / unclear"] };
}

/* ---------- B. rebalancing ---------- */
export type Asset = { name: string; value: number; target: number };
export type RebRow = { name: string; value: number; target: number; now: number; dev: number; flag: boolean; delta: number; buyOnly: number };
export function rebalance(assets: Asset[], threshold = 5, cash = 0) {
  const V = assets.reduce((a, x) => a + (x.value || 0), 0), T = V + (cash || 0);
  const tsum = assets.reduce((a, x) => a + (x.target || 0), 0);
  const rows: RebRow[] = assets.map((x) => {
    const tgt = tsum ? (x.target / tsum) * 100 : 0, now = V ? (x.value / V) * 100 : 0, dev = now - tgt;
    return { name: x.name, value: x.value, target: tgt, now, dev, flag: Math.abs(dev) > threshold, delta: (tgt / 100) * T - x.value, buyOnly: 0 };
  });
  const pos = rows.filter((r) => r.delta > 0).reduce((a, r) => a + r.delta, 0), f = pos > 0 && cash > 0 ? Math.min(1, cash / pos) : 0;
  rows.forEach((r) => (r.buyOnly = r.delta > 0 ? r.delta * f : 0));
  return { rows, total: V, needs: rows.some((r) => r.flag), targetSum: tsum, cashLeft: cash > 0 ? Math.max(0, cash - rows.reduce((a, r) => a + r.buyOnly, 0)) : 0 };
}
/** the source's example portfolios (user-adjustable) */
export const PRESETS: { id: string; fa: string; en: string; items: [string, string, number][] }[] = [
  { id: "m", fa: "سبد ۴۰/۴۰/۲۰ (ریسک متوسط)", en: "40/40/20 (medium risk)", items: [["اوراق قرضه / Bonds", "", 40], ["بورس / Stocks", "", 40], ["کریپتو / Crypto", "", 20]] },
  { id: "y", fa: "سبد جوان (با ~۱۰٪ طلا)", en: "Young investor (~10% gold)", items: [["بورس / Stocks", "", 60], ["کریپتو / Crypto", "", 20], ["طلا / Gold", "", 10], ["اوراق / Bonds", "", 10]] },
  { id: "h", fa: "۳۰ ساله خریدار خانه", en: "30-year-old home buyer", items: [["املاک / Real estate", "", 70], ["بورس / Stocks", "", 20], ["کریپتو / Crypto", "", 10]] },
];

/* ---------- C. financial-freedom number + compound growth ---------- */
export const fvLump = (P: number, r: number, n: number) => P * Math.pow(1 + r, n);
export const fvMonthly = (pmt: number, r: number, n: number) => (r === 0 ? pmt * 12 * n : pmt * ((Math.pow(1 + r / 12, 12 * n) - 1) / (r / 12)));
export const fv = (P: number, pmt: number, r: number, n: number) => fvLump(P, r, n) + fvMonthly(pmt, r, n);
/** gross yearly spend (expenses grossed-up for tax) / expected return = capital needed */
export const freedomNumber = (annualExpense: number, taxPct: number, returnPct: number) => annualExpense / (1 - taxPct / 100) / (returnPct / 100);
/** months until capital P + monthly saving reaches the target (monthly compounding of the annual rate, as in the source formula); null if > 100 years */
export function yearsToReach(target: number, P: number, pmt: number, r: number): number | null {
  if (P >= target) return 0;
  let v = P;
  for (let m = 1; m <= 1200; m++) {
    v = v * (1 + r / 12) + pmt;
    if (v >= target) return m / 12;
  }
  return null;
}
export const doublingYears = (ratePct: number) => 72 / ratePct;
export const deflate = (v: number, infPct: number, years: number) => v / Math.pow(1 + infPct / 100, years);
export function growthSeries(P: number, pmt: number, r: number, years: number) {
  const out: number[] = [];
  for (let y = 0; y <= years; y++) out.push(fv(P, pmt, r, y));
  return out;
}

/* ---------- D. recession alert ---------- */
export type Zone = "green" | "yellow" | "red";
export const zoneOf = (spread: number, green = 0.5): Zone => (spread < 0 ? "red" : spread < green ? "yellow" : "green");
export function parseFredCsv(txt: string): { d: string; v: number }[] {
  return txt.split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((a) => a.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(a[0]) && a[1] !== "." && Number.isFinite(Number(a[1]))).map((a) => ({ d: a[0], v: Number(a[1]) }));
}
export const valAgo = (s: { d: string; v: number }[], days: number) => {
  if (!s.length) return null;
  const last = new Date(s[s.length - 1].d + "T00:00:00Z").getTime(), cut = last - days * 86400000;
  for (let i = s.length - 1; i >= 0; i--) if (new Date(s[i].d + "T00:00:00Z").getTime() <= cut) return s[i];
  return s[0];
};
