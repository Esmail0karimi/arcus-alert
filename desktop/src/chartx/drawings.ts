/* Geometry + SVG for the drawing tools. Pure: it only needs a price/time -> pixel converter. */
import { fmtPrice } from "./math";

export type P = { time: number; price: number };
export type Kind = "trend" | "arrow" | "vline" | "hray" | "channel" | "fibret" | "fibext" | "rect" | "long" | "short";
export type Level = { v: number; on: boolean; color: string };
export type LineStyle = "solid" | "dashed" | "dotted";
export type Shape = {
  id: string; kind: Kind; pts: P[]; color: string; width: number;
  style?: LineStyle; fill?: string; fillOp?: number; extL?: boolean; extR?: boolean;
  levels?: Level[]; bg?: boolean; showTrend?: boolean; showPrice?: boolean; showLvl?: boolean; mid?: boolean; rev?: boolean;
  locked?: boolean; labels?: boolean; pc?: string; sc?: string; acct?: number; riskP?: number;
};
export const DASH: Record<LineStyle, string> = { solid: "", dashed: "7 5", dotted: "1.5 4" };
export const defLevels = (kind: Kind): Level[] =>
  (kind === "fibext" ? FIB_EXT : FIB_RET).map((v) => ({ v, on: true, color: FIB_COL[String(v)] || "#9aa7b8" }));
export type XY = { x: number; y: number };
export type Env = { xy: (p: P) => XY | null; w: number; h: number; selected: boolean; draft?: boolean; hover?: boolean };
export type Built = { els: SVGElement[]; segs: [number, number, number, number][]; polys: XY[][]; handles: XY[]; mid: XY };

export const NEED: Record<Kind, number> = { trend: 2, arrow: 2, vline: 1, hray: 1, channel: 3, fibret: 2, fibext: 3, rect: 2, long: 1, short: 1 };
export const TOOLS: { kind: Kind; icon: string; title: string }[] = [
  { kind: "trend", icon: "╱", title: "Trend line: click two points" },
  { kind: "arrow", icon: "↗", title: "Arrow: click the start, then the tip" },
  { kind: "vline", icon: "│", title: "Vertical line: click once" },
  { kind: "hray", icon: "→", title: "Horizontal ray: click once" },
  { kind: "channel", icon: "⫽", title: "Parallel channel: click 3 points (start, end, width)" },
  { kind: "fibret", icon: "Fr", title: "Fibonacci retracement: click two points" },
  { kind: "fibext", icon: "Fe", title: "Fibonacci extension: click 3 points (A, B, C)" },
  { kind: "rect", icon: "▭", title: "Rectangle: click two corners" },
  { kind: "long", icon: "L▲", title: "Long position: click the entry" },
  { kind: "short", icon: "S▼", title: "Short position: click the entry" },
];
export const FIB_RET = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT = [0, 0.618, 1, 1.618, 2.618];
const FIB_COL: Record<string, string> = { "0": "#9aa7b8", "0.236": "#f23645", "0.382": "#ff9800", "0.5": "#4caf50", "0.618": "#089981", "0.786": "#00bcd4", "1": "#9aa7b8", "1.618": "#4aa3ff", "2.618": "#b388ff" };

export const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el as SVGElement;
};
const text = (x: number, y: number, s: string, color: string, anchor = "start") => {
  const t = svgEl("text", { x, y, fill: color, "font-size": 10.5, "text-anchor": anchor, "font-family": "system-ui,sans-serif" });
  t.textContent = s;
  (t as any).style.pointerEvents = "none";
  return t;
};
const seg = (x1: number, y1: number, x2: number, y2: number, color: string, w: number, dash = "") =>
  svgEl("line", { x1, y1, x2, y2, stroke: color, "stroke-width": w, "stroke-dasharray": dash });
const rectEl = (x1: number, y1: number, x2: number, y2: number, fill: string, stroke: string, w = 1) =>
  svgEl("rect", { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), fill, stroke, "stroke-width": w });
const pct = (a: number, b: number) => (a ? ((b - a) / a) * 100 : 0);

/** Pad a draft (fewer points than needed) with copies of its last point so it can be previewed. */
export const padPts = (kind: Kind, pts: P[]): P[] => {
  const out = pts.slice();
  while (out.length < NEED[kind]) out.push(out[out.length - 1]);
  return out;
};

/** Default stop / target for a one-click position. */
export const newPosition = (kind: "long" | "short", entry: P, span: number): P[] => {
  const t = entry.time + span * 25;
  const up = kind === "long";
  return [entry, { time: t, price: entry.price * (up ? 0.99 : 1.01) }, { time: t, price: entry.price * (up ? 1.02 : 0.98) }];
};

export function build(s: Shape, env: Env): Built | null {
  const pts = padPts(s.kind, s.pts);
  const xy = pts.map((p) => env.xy(p));
  if (xy.some((v) => !v)) return null;
  const [A, B, C] = xy as XY[];
  const sel = env.selected || !!env.draft;
  const col = s.color, w = s.width + (env.selected ? 1 : 0);
  const out: Built = { els: [], segs: [], polys: [], handles: [], mid: A };
  const dash = env.draft ? "5 4" : DASH[s.style || "solid"];
  const L = (x1: number, y1: number, x2: number, y2: number, color = col, width = w, d = dash) => {
    out.els.push(seg(x1, y1, x2, y2, color, width, d));
    out.segs.push([x1, y1, x2, y2]);
  };
  /** extend segment P->Q to the chart edges on the chosen sides */
  const ext = (P: XY, Q: XY, l?: boolean, r?: boolean): [XY, XY] => {
    const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1, k = (env.w + env.h) * 4;
    return [l ? { x: P.x - (dx / len) * k, y: P.y - (dy / len) * k } : P, r ? { x: Q.x + (dx / len) * k, y: Q.y + (dy / len) * k } : Q];
  };
  switch (s.kind) {
    case "trend": {
      const [P, Q] = ext(A, B, s.extL, s.extR);
      L(P.x, P.y, Q.x, Q.y);
      out.handles = [A, B];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    }
    case "arrow": {
      const [P, Q] = ext(A, B, s.extL, s.extR);
      L(P.x, P.y, Q.x, Q.y);
      const ang = Math.atan2(B.y - A.y, B.x - A.x), hl = 9 + s.width * 2, sp = 0.45;
      out.els.push(
        svgEl("polygon", {
          points: [B, { x: B.x - hl * Math.cos(ang - sp), y: B.y - hl * Math.sin(ang - sp) }, { x: B.x - hl * Math.cos(ang + sp), y: B.y - hl * Math.sin(ang + sp) }].map((q) => q.x + "," + q.y).join(" "),
          fill: col,
          stroke: col,
          "stroke-width": 1,
          "stroke-linejoin": "round",
        }),
      );
      const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      out.els.push(svgEl("circle", { cx: M.x, cy: M.y, r: 4, fill: "#071629", stroke: col, "stroke-width": 2 }));
      out.handles = [A, B];
      out.mid = M;
      break;
    }
    case "vline":
      L(A.x, 0, A.x, env.h);
      out.handles = [A];
      break;
    case "hray":
      L(s.extL ? 0 : A.x, A.y, s.extR === false ? A.x + 1 : env.w, A.y);
      out.handles = [A];
      break;
    case "channel": {
      const dx = B.x - A.x, k = Math.abs(dx) < 1e-6 ? 0 : (B.y - A.y) / dx;
      const off = C.y - (A.y + (C.x - A.x) * k);
      const A2 = { x: A.x, y: A.y + off }, B2 = { x: B.x, y: B.y + off };
      const [P1, Q1] = ext(A, B, s.extL, s.extR), [P2, Q2] = ext(A2, B2, s.extL, s.extR);
      out.els.push(svgEl("polygon", { points: [P1, Q1, Q2, P2].map((q) => q.x + "," + q.y).join(" "), fill: s.fill || col, "fill-opacity": s.fillOp ?? 0.1, stroke: "none" }));
      out.polys.push([P1, Q1, Q2, P2]);
      L(P1.x, P1.y, Q1.x, Q1.y);
      L(P2.x, P2.y, Q2.x, Q2.y);
      if (s.mid !== false) out.els.push(seg((P1.x + P2.x) / 2, (P1.y + P2.y) / 2, (Q1.x + Q2.x) / 2, (Q1.y + Q2.y) / 2, col, 1, "4 4"));
      out.handles = [A, B, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + off }];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    }
    case "fibret":
    case "fibext": {
      const ret = s.kind === "fibret";
      const lv = (s.levels || defLevels(s.kind)).filter((q) => q.on).sort((p, q) => p.v - q.v);
      const price = (l: number) => (ret ? (s.rev ? pts[0].price + (pts[1].price - pts[0].price) * l : pts[1].price + (pts[0].price - pts[1].price) * l) : pts[2].price + (pts[1].price - pts[0].price) * l);
      const ref = ret ? A : C;
      let x0 = ret ? Math.min(A.x, B.x) : C.x;
      let x1 = ret ? Math.max(Math.max(A.x, B.x), x0 + 80) : Math.min(env.w - 4, x0 + Math.max(180, Math.abs(B.x - A.x) * 1.5));
      if (s.extL) x0 = 0;
      if (s.extR) x1 = env.w;
      const t0 = ret ? pts[0].time : pts[2].time;
      const ys = lv.map((q) => env.xy({ time: t0, price: price(q.v) })!.y);
      if (s.bg !== false)
        for (let i = 0; i < lv.length - 1; i++) {
          const r = rectEl(x0, ys[i], x1, ys[i + 1], lv[i + 1].color, "none", 0);
          r.setAttribute("fill-opacity", String(s.fillOp ?? 0.1));
          out.els.push(r);
        }
      if (s.showTrend !== false) {
        if (ret) out.els.push(seg(A.x, A.y, B.x, B.y, col, 1, "5 4"));
        else out.els.push(seg(A.x, A.y, B.x, B.y, col, 1, "5 4"), seg(B.x, B.y, C.x, C.y, col, 1, "5 4"));
      }
      lv.forEach((q, i) => {
        L(x0, ys[i], x1, ys[i], q.color, env.selected ? s.width + 0.6 : s.width, dash);
        const parts: string[] = [];
        if (s.showLvl !== false) parts.push(String(q.v));
        if (s.showPrice !== false) parts.push("(" + fmtPrice(price(q.v)) + ")");
        if (parts.length) out.els.push(text(x0 + 4, ys[i] - 3, parts.join(" "), q.color));
      });
      if (ys.length) out.polys.push([{ x: x0, y: Math.min(...ys) }, { x: x1, y: Math.min(...ys) }, { x: x1, y: Math.max(...ys) }, { x: x0, y: Math.max(...ys) }]);
      if (!ret) out.segs.push([A.x, A.y, B.x, B.y], [B.x, B.y, C.x, C.y]);
      else out.segs.push([A.x, A.y, B.x, B.y]);
      out.handles = ret ? [A, B] : [A, B, C];
      out.mid = { x: (x0 + x1) / 2, y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : ref.y };
      break;
    }
    case "rect": {
      const r = rectEl(A.x, A.y, B.x, B.y, s.fill || col, col, w);
      r.setAttribute("fill-opacity", String(s.fillOp ?? 0.14));
      r.setAttribute("stroke-dasharray", dash);
      out.els.push(r);
      out.polys.push([A, { x: B.x, y: A.y }, B, { x: A.x, y: B.y }]);
      out.segs.push([A.x, A.y, B.x, A.y], [B.x, A.y, B.x, B.y], [B.x, B.y, A.x, B.y], [A.x, B.y, A.x, A.y]);
      out.handles = [A, B];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    }
    case "long":
    case "short": {
      const E = A, S = B, T = C;
      const x1 = S.x;
      const G = s.pc || "#089981", R = s.sc || "#f23645";
      const rp = rectEl(E.x, E.y, x1, T.y, G, "none", 0), rl = rectEl(E.x, E.y, x1, S.y, R, "none", 0);
      rp.setAttribute("fill-opacity", String(s.fillOp ?? 0.22));
      rl.setAttribute("fill-opacity", String(s.fillOp ?? 0.22));
      out.els.push(rp, rl);
      out.els.push(seg(E.x, E.y, x1, E.y, "#d5e2f3", s.width ? Math.min(s.width, 2) : 1.2, dash));
      out.polys.push([E, { x: x1, y: E.y }, { x: x1, y: T.y }, { x: E.x, y: T.y }], [E, { x: x1, y: E.y }, { x: x1, y: S.y }, { x: E.x, y: S.y }]);
      out.segs.push([E.x, E.y, x1, E.y]);
      const risk = Math.abs(pts[0].price - pts[1].price), reward = Math.abs(pts[2].price - pts[0].price);
      const acct = s.acct ?? 1000, riskAmt = (acct * (s.riskP ?? 1)) / 100;
      const qty = risk ? riskAmt / risk : 0;
      const cx = (E.x + x1) / 2;
      if (s.labels !== false && (env.hover || env.selected)) {
        const tp = pct(pts[0].price, pts[2].price), sp = pct(pts[0].price, pts[1].price);
        const sg = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
        const tl = "Target: " + fmtPrice(pts[2].price) + " (" + sg(tp) + "%)  " + (qty ? "+" + (qty * reward).toFixed(2) : "");
        const sl = "Stop: " + fmtPrice(pts[1].price) + " (" + sg(sp) + "%)  " + (qty ? "-" + riskAmt.toFixed(2) : "");
        const up = T.y < E.y;
        out.els.push(text(cx, up ? T.y + 14 : T.y - 6, tl, G, "middle"), text(cx, S.y < E.y ? S.y + 14 : S.y - 6, sl, R, "middle"));
        const lab = (s.kind === "long" ? "Long" : "Short") + " · R:R " + (risk ? (reward / risk).toFixed(2) : "–") + (qty ? " · Qty " + qty.toFixed(qty < 10 ? 3 : 1) : "");
        const wpx = lab.length * 6.2 + 12;
        const pill = rectEl(cx - wpx / 2, E.y - 9, cx + wpx / 2, E.y + 9, "#0b1a2c", "#d5e2f3", 1);
        pill.setAttribute("rx", "4");
        pill.setAttribute("fill-opacity", "0.9");
        out.els.push(pill, text(cx, E.y + 4, lab, "#d5e2f3", "middle"));
      }
      out.handles = [E, { x: cx, y: S.y }, { x: cx, y: T.y }, { x: x1, y: E.y }];
      out.mid = { x: cx, y: E.y };
      break;
    }
  }
  if (sel && !s.locked) for (const hd of out.handles) out.els.push(svgEl("circle", { cx: hd.x, cy: hd.y, r: env.selected ? 5.5 : 3.5, fill: "#fff", stroke: col, "stroke-width": 2 }));
  else if (s.kind === "trend") for (const hd of out.handles) out.els.push(svgEl("circle", { cx: hd.x, cy: hd.y, r: 3, fill: col }));
  return out;
}

const inPoly = (x: number, y: number, poly: XY[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
export const distToSeg = (px: number, py: number, s: [number, number, number, number]) => {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
};
/** Distance used for picking: 0 inside a filled area, else distance to the nearest line. */
export const pickDistance = (b: Built, px: number, py: number) => {
  let d = Infinity;
  for (const s of b.segs) d = Math.min(d, distToSeg(px, py, s));
  for (const poly of b.polys) if (inPoly(px, py, poly)) d = Math.min(d, 6);
  return d;
};

/** Move handle `i` (or the whole shape for i = -1) to the pointer position. */
export function applyDrag(orig: Shape, i: number, p: P, start: P): Shape {
  const s: Shape = JSON.parse(JSON.stringify(orig));
  if (i < 0) {
    const dt = p.time - start.time, dp = p.price - start.price;
    s.pts = s.pts.map((q) => ({ time: q.time + dt, price: q.price + dp }));
    return s;
  }
  if (s.kind === "long" || s.kind === "short") {
    if (i === 0) {
      const dt = p.time - orig.pts[0].time, dp = p.price - orig.pts[0].price;
      s.pts = s.pts.map((q) => ({ time: q.time + dt, price: q.price + dp }));
    } else if (i === 3) {
      const t = Math.max(p.time, s.pts[0].time + 1);
      s.pts[1].time = t;
      s.pts[2].time = t;
    } else s.pts[i] = { time: s.pts[i].time, price: p.price };
    return s;
  }
  s.pts[i] = { time: p.time, price: p.price };
  return s;
}
