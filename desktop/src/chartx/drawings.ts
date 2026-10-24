/* Geometry + SVG for the drawing tools. Pure: it only needs a price/time -> pixel converter. */
import { fmtPrice } from "./math";

export type P = { time: number; price: number };
export type Kind = "trend" | "vline" | "hray" | "channel" | "fibret" | "fibext" | "rect" | "long" | "short";
export type Shape = { id: string; kind: Kind; pts: P[]; color: string; width: number };
export type XY = { x: number; y: number };
export type Env = { xy: (p: P) => XY | null; w: number; h: number; selected: boolean; draft?: boolean };
export type Built = { els: SVGElement[]; segs: [number, number, number, number][]; polys: XY[][]; handles: XY[]; mid: XY };

export const NEED: Record<Kind, number> = { trend: 2, vline: 1, hray: 1, channel: 3, fibret: 2, fibext: 3, rect: 2, long: 1, short: 1 };
export const TOOLS: { kind: Kind; icon: string; title: string }[] = [
  { kind: "trend", icon: "╱", title: "Trend line: click two points" },
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
  const L = (x1: number, y1: number, x2: number, y2: number, color = col, width = w, dash = "") => {
    out.els.push(seg(x1, y1, x2, y2, color, width, dash));
    out.segs.push([x1, y1, x2, y2]);
  };
  const dash = env.draft ? "5 4" : "";
  switch (s.kind) {
    case "trend":
      L(A.x, A.y, B.x, B.y, col, w, dash);
      out.handles = [A, B];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    case "vline":
      L(A.x, 0, A.x, env.h, col, w, dash);
      out.handles = [A];
      break;
    case "hray":
      L(A.x, A.y, env.w, A.y, col, w, dash);
      out.handles = [A];
      break;
    case "channel": {
      const dx = B.x - A.x, k = Math.abs(dx) < 1e-6 ? 0 : (B.y - A.y) / dx;
      const off = C.y - (A.y + (C.x - A.x) * k);
      const A2 = { x: A.x, y: A.y + off }, B2 = { x: B.x, y: B.y + off };
      out.els.push(svgEl("polygon", { points: [A, B, B2, A2].map((q) => q.x + "," + q.y).join(" "), fill: col, "fill-opacity": 0.1, stroke: "none" }));
      out.polys.push([A, B, B2, A2]);
      L(A.x, A.y, B.x, B.y, col, w, dash);
      L(A2.x, A2.y, B2.x, B2.y, col, w, dash);
      out.els.push(seg((A.x + A2.x) / 2, (A.y + A2.y) / 2, (B.x + B2.x) / 2, (B.y + B2.y) / 2, col, 1, "4 4"));
      out.handles = [A, B, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + off }];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    }
    case "fibret": {
      const x0 = Math.min(A.x, B.x), x1 = Math.max(Math.max(A.x, B.x), x0 + 80);
      const price = (l: number) => pts[1].price + (pts[0].price - pts[1].price) * l;
      const ys = FIB_RET.map((l) => env.xy({ time: pts[0].time, price: price(l) })!.y);
      FIB_RET.forEach((l, i) => {
        const c = FIB_COL[String(l)];
        if (i < FIB_RET.length - 1) out.els.push(rectEl(x0, ys[i], x1, ys[i + 1], c, "none", 0)), ((out.els[out.els.length - 1] as any).setAttribute("fill-opacity", "0.07"));
        L(x0, ys[i], x1, ys[i], c, env.selected ? 1.8 : 1.2, dash);
        out.els.push(text(x0 + 4, ys[i] - 3, l + " (" + fmtPrice(price(l)) + ")", c));
      });
      out.els.push(seg(A.x, A.y, B.x, B.y, col, 1, "5 4"));
      out.polys.push([{ x: x0, y: Math.min(...ys) }, { x: x1, y: Math.min(...ys) }, { x: x1, y: Math.max(...ys) }, { x: x0, y: Math.max(...ys) }]);
      out.handles = [A, B];
      out.mid = { x: (x0 + x1) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      break;
    }
    case "fibext": {
      const price = (l: number) => pts[2].price + (pts[1].price - pts[0].price) * l;
      const x0 = C.x, x1 = Math.min(env.w - 4, x0 + Math.max(180, Math.abs(B.x - A.x) * 1.5));
      const ys = FIB_EXT.map((l) => env.xy({ time: pts[2].time, price: price(l) })!.y);
      out.els.push(seg(A.x, A.y, B.x, B.y, col, 1, "5 4"), seg(B.x, B.y, C.x, C.y, col, 1, "5 4"));
      FIB_EXT.forEach((l, i) => {
        const c = FIB_COL[String(l)];
        L(x0, ys[i], x1, ys[i], c, env.selected ? 1.8 : 1.2, dash);
        out.els.push(text(x0 + 4, ys[i] - 3, l + " (" + fmtPrice(price(l)) + ")", c));
      });
      out.polys.push([{ x: x0, y: Math.min(...ys) }, { x: x1, y: Math.min(...ys) }, { x: x1, y: Math.max(...ys) }, { x: x0, y: Math.max(...ys) }]);
      out.segs.push([A.x, A.y, B.x, B.y], [B.x, B.y, C.x, C.y]);
      out.handles = [A, B, C];
      out.mid = { x: (x0 + x1) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      break;
    }
    case "rect": {
      const r = rectEl(A.x, A.y, B.x, B.y, col, col, w);
      r.setAttribute("fill-opacity", "0.14");
      if (env.draft) r.setAttribute("stroke-dasharray", "5 4");
      out.els.push(r);
      const P4 = [A, { x: B.x, y: A.y }, B, { x: A.x, y: B.y }];
      out.polys.push(P4);
      out.segs.push([A.x, A.y, B.x, A.y], [B.x, A.y, B.x, B.y], [B.x, B.y, A.x, B.y], [A.x, B.y, A.x, A.y]);
      out.handles = [A, B];
      out.mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      break;
    }
    case "long":
    case "short": {
      const E = A, S = B, T = C;
      const x1 = S.x;
      const G = "#089981", R = "#f23645";
      const rp = rectEl(E.x, E.y, x1, T.y, G, G, 1), rl = rectEl(E.x, E.y, x1, S.y, R, R, 1);
      rp.setAttribute("fill-opacity", "0.22");
      rl.setAttribute("fill-opacity", "0.22");
      out.els.push(rp, rl);
      if (env.selected) { rp.setAttribute("stroke-width", "2"); rl.setAttribute("stroke-width", "2"); }
      out.els.push(seg(E.x, E.y, x1, E.y, "#d5e2f3", 1.2));
      out.polys.push([E, { x: x1, y: E.y }, { x: x1, y: T.y }, { x: E.x, y: T.y }], [E, { x: x1, y: E.y }, { x: x1, y: S.y }, { x: E.x, y: S.y }]);
      out.segs.push([E.x, E.y, x1, E.y]);
      const tp = pct(pts[0].price, pts[2].price), sp = pct(pts[0].price, pts[1].price);
      const risk = Math.abs(pts[0].price - pts[1].price), reward = Math.abs(pts[2].price - pts[0].price);
      const lx = Math.min(E.x, x1) + 6;
      out.els.push(
        text(lx, (E.y + T.y) / 2 + 4, "Target " + (tp >= 0 ? "+" : "") + tp.toFixed(2) + "%  " + fmtPrice(pts[2].price), G),
        text(lx, (E.y + S.y) / 2 + 4, "Stop " + (sp >= 0 ? "+" : "") + sp.toFixed(2) + "%  " + fmtPrice(pts[1].price), R),
        text(lx, E.y - 4, (s.kind === "long" ? "Long" : "Short") + " · R:R " + (risk ? (reward / risk).toFixed(2) : "–") + " · " + fmtPrice(pts[0].price), "#d5e2f3"),
      );
      out.handles = [E, S, T];
      out.mid = { x: (E.x + x1) / 2, y: E.y };
      break;
    }
  }
  if (sel) for (const hd of out.handles) out.els.push(svgEl("circle", { cx: hd.x, cy: hd.y, r: env.selected ? 5.5 : 3.5, fill: "#fff", stroke: col, "stroke-width": 2 }));
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
    } else {
      s.pts[i] = { time: Math.max(p.time, s.pts[0].time + 1), price: p.price };
      const t = s.pts[i].time;
      s.pts[1].time = t;
      s.pts[2].time = t;
    }
    return s;
  }
  s.pts[i] = { time: p.time, price: p.price };
  return s;
}
