/*
 * ChartX (lean): SMA 7, RSI 14, OHLC legend and a trend-line tool, attached to the existing
 * lightweight-charts chart. Everything is optional, default off, and costs nothing while off.
 * It never replaces the main candlestick series, so alerts and horizontal lines are untouched.
 */
import { HistogramSeries, LineSeries, PriceScaleMode } from "lightweight-charts";
import "./chartx.css";
import { Candle, Pt, barSpan, fmtPrice, fmtVol, rsi, sma } from "./math";
import { indexToTime, timeToIndex } from "./geometry";
import { NotesLayer } from "./notes";
import { undoManager } from "../undo";
import type { Ev } from "../events";
import { Built, DASH, Kind, Level, LineStyle, NEED, P, Shape, TOOLS, applyDrag, build, defLevels, newPosition, pickDistance } from "./drawings";

const PREFS_KEY = "arcus.chartx.prefs.v2",
  DRAW_KEY = "arcus.chartx.drawings.v1";
type Prefs = {
  sma: { on: boolean; period: number; color: string; width: number };
  rsi: { on: boolean; period: number; color: string; h: number };
  vol: { on: boolean };
};
type Theme = { bg: string; text: string; vOn: boolean; vGrid: string; hOn: boolean; hGrid: string; up: string; down: string };
const THEME_KEY = "arcus.chartx.theme.v1";
const DEF_THEME: Theme = { bg: "#000000", text: "#91a7c3", vOn: true, vGrid: "#101820", hOn: true, hGrid: "#101820", up: "#00c9a7", down: "#f06470" };
const DEF_PREFS: Prefs = {
  sma: { on: false, period: 7, color: "#f2b84b", width: 2 },
  rsi: { on: false, period: 14, color: "#b388ff", h: 1 },
  vol: { on: false },
};
const DEF_COLOR: Record<Kind, string> = { trend: "#4aa3ff", arrow: "#4aa3ff", vline: "#4aa3ff", hray: "#4aa3ff", channel: "#4aa3ff", fibret: "#f2b84b", fibext: "#b388ff", rect: "#4aa3ff", long: "#089981", short: "#f23645" };
const migrate = (raw: any[]): Shape[] =>
  raw
    .map((x: any) =>
      x && x.kind && Array.isArray(x.pts)
        ? { width: 1.5, ...x }
        : x && x.a && x.b
          ? { id: x.id, kind: "trend" as Kind, pts: [x.a, x.b], color: x.color || "#4aa3ff", width: 1.5 }
          : null,
    )
    .filter(Boolean) as Shape[];

const load = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
};
const stop = (el: HTMLElement) =>
  ["pointerdown", "pointerup", "click", "dblclick", "wheel", "contextmenu"].forEach((ev) =>
    el.addEventListener(ev, (e) => e.stopPropagation()),
  );

type Draft = { kind: Kind; pts: P[]; cur: P };
type Drag = { id: string; i: number; orig: Shape; start: P; before: Shape[]; moved: boolean };

export class ChartX {
  private candles: Candle[] = [];
  private symbol = "";
  private prefs: Prefs;
  private theme: Theme;
  private shapes: Shape[] = [];
  private draft: Draft | null = null;
  private tool: Kind | null = null;
  private drag: Drag | null = null;
  private notes!: NotesLayer;
  private toolBtns = new Map<Kind, HTMLButtonElement>();
  private evLayer = h("div", "cx-evlayer");
  private evPop = h("div", "cx-evpop");
  private evs: Ev[] = [];
  private evOn = load<boolean>("arcus.chartx.events.v1", true);
  private evSig = "";
  onEventsToggle: ((on: boolean) => void) | null = null;
  isEventsOn() {
    return this.evOn;
  }
  private evEls = new Map<string, HTMLElement>();
  private evEdge = h("button", "cx-ev-edge");
  private evBtn = h("button", "cx-ev-listbtn");
  private evList = h("div", "cx-evlist");
  private favBar = h("div", "cx-favbar");
  private favBtns = new Map<string, HTMLButtonElement>();
  private extBtns = new Map<string, HTMLButtonElement>();
  private extObs: MutationObserver | null = null;
  private favs: string[] = (() => {
    try {
      return JSON.parse(localStorage.getItem("arcus.chartx.favtools.v1") || "[]");
    } catch {
      return [];
    }
  })();
  private favPos: { x: number; y: number } | null = (() => {
    try {
      return JSON.parse(localStorage.getItem("arcus.chartx.favbar.v1") || "null");
    } catch {
      return null;
    }
  })();
  private railText = h("button", "cx-rail-part", "T");
  private railLock = h("button", "cx-rail-part", "🔓");
  private railClear = h("button", "cx-rail-part", "🗑");
  private extObs2: MutationObserver | null = null;
  private smaS: any = null;
  private rsiS: any = null;
  private volS: any = null;
  private destroyed = false;
  private refreshTimer: number | undefined;
  private raf = 0;
  private lastSig = "";
  private cleanups: (() => void)[] = [];

  private legend = h("div", "cx-legend");
  private countEl = h("div", "cx-count");
  private span = 0;
  private countTxt = "";
  private srcEl = h("div", "cx-src");
  private bar = h("div", "cx-bar");
  private svg = svgEl("svg", { class: "cx-svg" }) as SVGSVGElement;
  private catcher = h("div", "cx-catcher");
  private smaBtn = h("button", "cx-btn", "SMA 7");
  private rsiBtn = h("button", "cx-btn", "RSI");
  private volBtn = h("button", "cx-btn", "Vol");
  private selected: string | null = null;
  private pop = h("div", "line-actions cx-pop");
  private popColor = h("input");
  private popWidth = h("select");
  private moreBtn = h("button", "cx-btn cx-more", "ƒx");
  private tools = h("div", "cx-tools");
  private panel = h("div", "cx-panel");
  private panelClose: (() => void) | null = null;
  private scaleBox = h("div", "cx-scale");
  private logOn = false;
  private built = new Map<string, Built>();
  private hoverId: string | null = null;
  private shareBtn = h("button", "cx-btn", "⤴ Share");
  private indWrap = h("div", "cx-ind");
  private indBtn = h("button", "cx-ind-btn", "Indicators ▾");
  private indMenu = h("div", "cx-ind-menu");
  private indOpen: "sma" | "rsi" | "vol" | null = null;

  constructor(
    private chart: any,
    private candle: any,
    private host: HTMLElement,
  ) {
    const raw = load<any>(PREFS_KEY, {});
    this.prefs = {
      sma: { ...DEF_PREFS.sma, ...(raw.sma || {}), on: raw.sma ? !!raw.sma.on : !!raw.sma7 },
      rsi: { ...DEF_PREFS.rsi, ...(typeof raw.rsi === "object" ? raw.rsi : { on: !!raw.rsi }) },
      vol: { ...DEF_PREFS.vol, ...(raw.vol || {}) },
    };
    this.theme = load<Theme>(THEME_KEY, { ...DEF_THEME });
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    this.buildUi();
    this.applyTheme();
    this.notes = new NotesLayer(chart, candle, host, () => this.candles, () => this.select(null));
    this.notes.onPlacing = (on) => this.railText.classList.toggle("selected", on);
    this.syncIndicators();
    const onMove = (p: any) => this.updateLegend(p);
    this.chart.subscribeCrosshairMove(onMove);
    this.cleanups.push(() => this.chart.unsubscribeCrosshairMove(onMove));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.setTool(null);
        this.notes.setPlacing(false);
        this.select(null);
        this.hidePanel();
      } else if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
        const t = e.target as HTMLElement | null;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== "color") return;
        e.preventDefault();
        this.deleteSelected();
      }
    };
    /* pointer: pick / drag shapes (capture phase so the chart does not pan while dragging a shape) */
    let down: { x: number; y: number } | null = null;
    const ui = (e: Event) => !!(e.target as HTMLElement)?.closest?.(".cx-bar,.cx-pop,.cx-panel,.line-actions");
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || ui(e)) return;
      down = { x: e.clientX, y: e.clientY };
      this.hidePanel();
      if (this.tool) return;
      const r = this.host.getBoundingClientRect();
      const lx = e.clientX - r.left, ly = e.clientY - r.top;
      let i = -2, id: string | null = null;
      const cur = this.shapes.find((x) => x.id === this.selected);
      const b = cur && this.built.get(cur.id);
      if (cur && b) {
        const k = b.handles.findIndex((q) => Math.hypot(q.x - lx, q.y - ly) <= 10);
        if (k >= 0) (i = k), (id = cur.id);
      }
      if (!id) {
        const hit = this.hitTest(lx, ly);
        if (hit) (id = hit), (i = -1);
      }
      const p = this.pt(e);
      if (!id || !p) return;
      const sh = this.shapes.find((x) => x.id === id)!;
      if (this.selected !== id) this.select(id);
      if (this.lockAll || sh.locked) return; // locked: selectable, but cannot be moved or reshaped
      this.drag = { id, i, orig: JSON.parse(JSON.stringify(sh)), start: p, before: this.cloneShapes(), moved: false };
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const onDragMove = (e: PointerEvent) => {
      const d = this.drag;
      if (!d) return;
      const p = this.pt(e);
      if (!p) return;
      if (!d.moved && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 3) return;
      d.moved = true;
      const k = this.shapes.findIndex((x) => x.id === d.id);
      if (k < 0) return;
      this.shapes[k] = applyDrag(d.orig, d.i, p, d.start);
      this.lastSig = "";
    };
    const onUp = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      const dn = down;
      down = null;
      if (d) {
        if (d.moved) {
          this.record(d.before);
          this.persistShapes();
        }
        this.lastSig = "";
        return;
      }
      if (!dn || this.tool || Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5 || ui(e)) return;
      const r = this.host.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit || this.selected) this.select(hit);
    };
    const onCtx = (e: MouseEvent) => {
      if (ui(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = this.host.getBoundingClientRect();
      this.openThemePanel(e.clientX - r.left, e.clientY - r.top);
    };
    /* wheel zoom: our own, so zooming out is never capped at the "standard" view (anchored under the cursor) */
    try {
      this.chart.applyOptions({ handleScale: { mouseWheel: false }, timeScale: { minBarSpacing: 0.02 } } as any);
    } catch {}
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.closest?.(".cx-panel,.cx-evlist,.cx-evpop,.cx-ind-menu,.cx-scale")) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways wheel: let the chart scroll
      const ts = this.chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = this.host.getBoundingClientRect();
      const dy = Math.max(-400, Math.min(400, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
      const k = Math.exp(dy * 0.0013); // wheel down => k > 1 => more candles, narrower
      const a = ts.coordinateToLogical(e.clientX - rect.left);
      const anchor = a == null ? r.to : Number(a);
      const from = anchor - (anchor - r.from) * k, to = anchor + (r.to - anchor) * k;
      if (to - from < 5) return;
      ts.setVisibleLogicalRange({ from, to } as any);
    };
    this.host.addEventListener("wheel", onWheel, { capture: true, passive: false });
    this.cleanups.push(() => this.host.removeEventListener("wheel", onWheel, true));
    this.host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onDragMove);
    this.host.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointerup", onUp);
    this.host.addEventListener("contextmenu", onCtx, true);
    const onHover = (e: PointerEvent) => {
      if (this.drag || this.tool || e.buttons) return;
      const r = this.host.getBoundingClientRect();
      const id = ui(e) ? null : this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.lastSig = "";
      }
    };
    this.host.addEventListener("pointermove", onHover, true);
    const onLeave = () => {
      if (this.hoverId) (this.hoverId = null), (this.lastSig = "");
    };
    this.host.addEventListener("pointerleave", onLeave);
    const onDbl = (e: MouseEvent) => {
      if (ui(e) || this.tool) return;
      const r = this.host.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (!hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.select(hit);
      this.openShapePanel(hit);
    };
    this.host.addEventListener("dblclick", onDbl, true);
    this.cleanups.push(() => {
      this.host.removeEventListener("dblclick", onDbl, true);
      this.host.removeEventListener("pointermove", onHover, true);
      this.host.removeEventListener("pointerleave", onLeave);
      this.host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onDragMove);
      this.host.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointerup", onUp);
      this.host.removeEventListener("contextmenu", onCtx, true);
    });
    window.addEventListener("keydown", onKey);
    this.cleanups.push(() => window.removeEventListener("keydown", onKey));
    this.hookDrawing();
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------- hooks used by main.tsx ---------- */
  setCandles(candles: Candle[], symbol: string) {
    this.candles = candles.map((c) => ({ ...c }));
    if (symbol !== this.symbol) {
      this.symbol = symbol;
      const all = load<Record<string, any[]>>(DRAW_KEY, {});
      this.shapes = Array.isArray(all[symbol]) ? migrate(all[symbol]) : [];
      this.notes.setSymbol(symbol);
      undoManager.drop("cx");
      this.draft = null;
      this.selected = null;
    }
    this.fill(true);
    this.updateLegend(null);
    this.lastSig = "";
  }
  private evStatus = "";
  private evStatusEl: HTMLElement | null = null;
  setEventsStatus(t: string) {
    this.evStatus = t;
    if (this.evStatusEl) this.evStatusEl.textContent = t ? " · " + t : "";
  }
  setEvents(list: Ev[]) {
    this.evs = list;
    this.evSig = "";
    this.evPop.style.display = "none";
  }
  private evX(t: number): number | null {
    const c = this.candles;
    if (!c.length) return null;
    const ts = this.chart.timeScale();
    const last = c[c.length - 1];
    if (t > last.time) {
      const span = this.span || (c.length > 1 ? c[c.length - 1].time - c[c.length - 2].time : 900);
      return ts.logicalToCoordinate((c.length - 1 + (t - last.time) / span) as any);
    }
    if (t < c[0].time) return null;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (c[m].time <= t) lo = m;
      else hi = m - 1;
    }
    return ts.timeToCoordinate(c[lo].time as any);
  }
  private updateEvents() {
    const on = this.evOn && this.evs.length > 0;
    this.evLayer.style.display = on ? "block" : "none";
    if (!on) this.evEdge.style.display = "none";
    this.evBtn.style.display = on ? "block" : "none";
    if (!on) this.evList.style.display = "none";
    if (on && this.evBtn.dataset.n !== String(this.evs.length)) {
      this.evBtn.dataset.n = String(this.evs.length);
      this.evBtn.textContent = "🗓 " + this.evs.length;
      this.evBtn.title = "All events & news for this symbol";
      this.evBtn.onpointerdown = (e) => e.stopPropagation();
      this.evBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleEvList();
      };
    }
    if (!on) {
      if (this.evEls.size) {
        this.evLayer.replaceChildren();
        this.evEls.clear();
      }
      return;
    }
    const ts = this.chart.timeScale();
    const w = this.host.clientWidth, hh = this.host.clientHeight;
    const sig = [ts.logicalToCoordinate(0 as any), ts.logicalToCoordinate(50 as any), w, hh, this.evs.length, this.candles.length, this.span].join("|");
    if (sig === this.evSig) return;
    this.evSig = sig;
    const maxX = w - (this.chart.priceScale("right").width() || 60);
    if (!this.evEls.size) {
      for (const e of this.evs) {
        const box = h("div", "cx-ev " + e.kind + (e.future ? " future" : ""));
        const dot = h("button", "cx-ev-dot", e.kind === "earnings" ? "E" : e.kind === "news" ? "N" : e.kind === "dividend" ? "$" : "S");
        dot.title = (e.future ? "Upcoming · " : "") + e.title;
        dot.onclick = (ev) => {
          ev.stopPropagation();
          this.showEv(e, box);
        };
        dot.onpointerdown = (ev) => ev.stopPropagation();
        box.append(h("i", "cx-ev-line"), dot);
        this.evLayer.append(box);
        this.evEls.set(e.id, box);
      }
    }
    let edge: Ev | null = null;
    for (const e of this.evs) {
      const box = this.evEls.get(e.id);
      if (!box) continue;
      const x = this.evX(e.t);
      if (x != null && x > maxX && e.future && !edge) edge = e;
      if (x == null || x < 0 || x > maxX) {
        box.style.display = "none";
        continue;
      }
      box.style.display = "block";
      box.style.left = x + "px";
      box.style.height = hh + "px";
    }
    this.stagger();
    const E = this.evEdge;
    if (edge) {
      const d = Math.max(0, Math.round((edge.t * 1000 - Date.now()) / 864e5));
      E.textContent = (edge.kind === "earnings" ? "E" : "●") + " in " + d + "d ▶";
      E.title = "Upcoming: " + edge.title + ". Click to scroll there.";
      E.style.display = "block";
      E.style.right = maxX < w ? w - maxX + 6 + "px" : "70px";
      E.onclick = () => {
        const c = this.candles;
        const span = this.span || 900;
        const n = c.length - 1 + (edge!.t - c[c.length - 1].time) / span;
        const r = ts.getVisibleLogicalRange();
        const width = r ? r.to - r.from : 120;
        ts.setVisibleLogicalRange({ from: n - width * 0.7, to: n + width * 0.3 } as any);
      };
    } else E.style.display = "none";
  }
  private stagger() {
    const rows: number[][] = [];
    for (const e of this.evs) {
      const box = this.evEls.get(e.id);
      if (!box || box.style.display === "none") continue;
      const x = parseFloat(box.style.left);
      let r = 0;
      while ((rows[r] || []).some((u) => Math.abs(u - x) < 18)) r++;
      (rows[r] = rows[r] || []).push(x);
      (box.firstChild!.nextSibling as HTMLElement).style.top = 4 + r * 20 + "px";
    }
  }
  private toggleEvList() {
    const L = this.evList;
    if (L.style.display === "block") {
      L.style.display = "none";
      return;
    }
    L.replaceChildren();
    L.append(h("div", "cx-evlist-h", "Events & news"));
    const list = [...this.evs].sort((a, b) => b.t - a.t);
    for (const e of list) {
      const row = h("button", "cx-evlist-row" + (e.future ? " future" : ""));
      const k = h("i", "cx-evlist-k " + e.kind, e.kind === "earnings" ? "E" : e.kind === "news" ? "N" : e.kind === "dividend" ? "$" : "S");
      const d = h("span", "cx-evlist-d", new Date(e.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }));
      const t = h("span", "cx-evlist-t", (e.future ? "Upcoming · " : "") + e.title);
      row.append(k, d, t);
      row.onclick = () => {
        L.style.display = "none";
        this.showEv(e, this.evEls.get(e.id) || null);
      };
      L.append(row);
    }
    L.style.display = "block";
  }
  private showEv(e: Ev, box: HTMLElement | null) {
    const P = this.evPop;
    P.replaceChildren();
    const when = new Date(e.t * 1000);
    const head = h("div", "cx-evpop-h");
    head.append(h("b", "", (e.future ? "Upcoming · " : "") + (e.kind === "earnings" ? "Earnings" : e.kind === "news" ? "News" : e.kind === "dividend" ? "Dividend" : "Split")), h("span", "", when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: e.kind === "news" ? "short" : undefined })));
    const x = h("button", "cx-evpop-x", "✕");
    x.onclick = () => (P.style.display = "none");
    head.append(x);
    P.append(head, h("div", "cx-evpop-t", e.title));
    if (e.detail) P.append(h("div", "cx-evpop-d", e.detail));
    if (e.future) {
      const d = Math.max(0, Math.round((e.t * 1000 - Date.now()) / 864e5));
      P.append(h("div", "cx-evpop-d", d === 0 ? "Happens today." : "In about " + d + " day" + (d === 1 ? "" : "s") + "."));
    }
    if (e.url) {
      const a = document.createElement("a");
      a.href = e.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "Open article ↗";
      P.append(a);
    }
    if (e.source) P.append(h("small", "", "Source: " + e.source));
    P.style.display = "block";
    const w = this.host.clientWidth;
    const left = box && box.style.display !== "none" ? parseFloat(box.style.left) || 0 : w / 2;
    P.style.left = Math.max(6, Math.min(w - 280, left - 130)) + "px";
    P.style.top = "34px";
  }
  updateBar(bar: Candle) {
    const n = this.candles.length;
    if (!n) return;
    const last = this.candles[n - 1];
    if (bar.time === last.time) this.candles[n - 1] = { ...last, ...bar };
    else if (bar.time > last.time) this.candles.push({ ...bar });
    else return;
    if (this.refreshTimer || (!this.smaS && !this.rsiS && !this.volS)) {
      if (!this.refreshTimer) this.updateLegend(null);
      return;
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.fill(false);
      this.updateLegend(null);
    }, 500);
  }
  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.refreshTimer);
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
    this.extObs?.disconnect();
    this.extObs2?.disconnect();
    this.extBtns.forEach((b) => {
      b.removeAttribute("data-fav");
      b.querySelector(".cx-fav-star")?.remove();
    });
    this.notes.destroy();
    undoManager.drop("cx");
    [this.legend, this.countEl, this.indWrap, this.bar, this.svg, this.catcher, this.pop, this.panel, this.scaleBox, this.favBar, this.evLayer, this.evPop, this.evEdge, this.evBtn, this.evList, this.railText, this.railLock, this.railClear, this.shareBtn, ...this.toolBtns.values()].forEach((el) => el.remove());
  }

  /* ---------- UI ---------- */
  private buildUi() {
    this.labels();
    const rail = this.host.closest(".chart-workspace")?.querySelector(".drawing-rail") as HTMLElement | null;
    for (const t of TOOLS) {
      const b = h("button", "cx-rail-part", t.icon);
      b.title = t.title + " (Esc cancels)";
      b.style.fontSize = t.icon.length > 1 ? "12px" : "";
      b.onclick = () => {
        this.notes?.setPlacing(false);
        this.setTool(this.tool === t.kind ? null : t.kind);
      };
      const st = h("i", "cx-fav-star", "★");
      st.title = "Favourite (show on the floating bar)";
      st.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleFav(t.kind);
      };
      b.append(st);
      this.toolBtns.set(t.kind, b);
      rail?.append(b);
    }
    this.railText.title = "Text: click a spot on the chart and type";
    this.railText.onclick = () => {
      this.setTool(null);
      this.notes.setPlacing(!this.notes.isBusy());
    };
    rail?.append(this.railText);
    {
      const st = h("i", "cx-fav-star", "★");
      st.title = "Favourite (show on the floating bar)";
      st.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleFav("text");
      };
      this.railText.append(st);
      this.extBtns.set("text", this.railText);
      this.extObs2 = new MutationObserver(() => {
        const b = this.favBtns.get("text");
        if (b) b.classList.toggle("selected", this.railText.classList.contains("selected"));
      });
      this.extObs2.observe(this.railText, { attributes: true, attributeFilter: ["class"] });
    }
    this.railLock.title = "Lock all drawings (they cannot be moved or reshaped)";
    this.railLock.textContent = this.lockAll ? "🔒" : "🔓";
    this.railLock.classList.toggle("selected", this.lockAll);
    this.railLock.onclick = () => {
      this.lockAll = !this.lockAll;
      save("arcus.chartx.lockall.v1", this.lockAll);
      this.railLock.textContent = this.lockAll ? "🔒" : "🔓";
      this.railLock.classList.toggle("selected", this.lockAll);
    };
    this.railClear.title = "Delete all drawings and text notes on this symbol";
    this.railClear.onclick = () => {
      const n = this.shapes.length + this.notes.count();
      if (!n) return;
      if (!window.confirm("Delete all " + n + " drawings and notes on " + this.symbol.replace(/^[A-Z]+:/, "") + "? (Ctrl+Z undoes it)")) return;
      const before = this.cloneShapes();
      this.shapes = [];
      this.record(before);
      this.persistShapes();
      this.notes.clearAll();
      this.selected = null;
      this.draft = null;
      this.lastSig = "";
    };
    rail?.append(this.railLock, this.railClear);
    const hb = rail?.querySelector('button[title="Horizontal line"]') as HTMLButtonElement | null;
    if (hb) {
      this.extBtns.set("hline", hb);
      const st = h("i", "cx-fav-star", "★");
      st.title = "Favourite (show on the floating bar)";
      st.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleFav("hline");
      };
      hb.append(st);
      this.extObs = new MutationObserver(() => {
        const b = this.favBtns.get("hline");
        if (b) b.classList.toggle("selected", hb.classList.contains("selected"));
      });
      this.extObs.observe(hb, { attributes: true, attributeFilter: ["class"] });
    }
    this.buildIndMenu();
    this.buildFavBar();
    this.popColor.type = "color";
    this.popColor.title = "Colour";
    this.popColor.onchange = () => {
      if (this.colorBefore) this.record(this.colorBefore);
      this.colorBefore = null;
    };
    this.popColor.oninput = () => {
      const sh = this.shapes.find((x) => x.id === this.selected);
      if (!sh) return;
      if (!this.colorBefore) this.colorBefore = this.cloneShapes();
      sh.color = this.popColor.value;
      this.remember(sh);
      this.persistShapes();
      this.lastSig = "";
    };
    for (const w of [1, 1.5, 2, 3, 4]) this.popWidth.append(new Option(w + "px", String(w)));
    this.popWidth.title = "Line width";
    this.popWidth.onchange = () => {
      const sh = this.shapes.find((x) => x.id === this.selected);
      if (!sh) return;
      const before = this.cloneShapes();
      sh.width = Number(this.popWidth.value);
      this.remember(sh);
      this.record(before);
      this.persistShapes();
      this.lastSig = "";
    };
    const del = h("button", "danger", "🗑");
    del.title = "Delete (Del)";
    del.onclick = () => this.deleteSelected();
    const gearBtn = h("button", "", "⚙");
    gearBtn.title = "Settings (double-click the shape)";
    gearBtn.onclick = () => this.selected && this.openShapePanel(this.selected);
    this.lockBtn.title = "Lock / unlock this drawing";
    this.lockBtn.onclick = () => {
      const sh = this.shapes.find((x) => x.id === this.selected);
      if (!sh) return;
      const before = this.cloneShapes();
      sh.locked = !sh.locked;
      this.lockBtn.textContent = sh.locked ? "🔒" : "🔓";
      this.record(before);
      this.persistShapes();
      this.lastSig = "";
    };
    this.pop.append(this.popColor, this.popWidth, this.lockBtn, gearBtn, del);
    this.pop.style.display = "none";
    stop(this.pop);
    this.panel.style.display = "none";
    stop(this.panel);
    this.host.append(this.svg, this.legend, this.countEl, this.srcEl, this.catcher, this.pop, this.panel, this.scaleBox, this.favBar, this.evLayer, this.evPop, this.evEdge, this.evBtn, this.evList);
    this.buildScale();
  }
  private labels() {
    this.smaBtn.textContent = "SMA " + this.prefs.sma.period;
    this.rsiBtn.textContent = "RSI " + this.prefs.rsi.period;
  }

  /* small form helpers for the floating panels */
  private row(label: string, input: HTMLElement) {
    const r = h("label", "cx-row");
    r.append(h("span", "", label), input);
    return r;
  }
  private colorIn(value: string, on: (v: string) => void) {
    const i = h("input");
    i.type = "color";
    i.value = value;
    i.oninput = () => on(i.value);
    return i;
  }
  private numIn(value: number, min: number, max: number, step: number, on: (v: number) => void) {
    const i = h("input");
    i.type = "number";
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(value);
    i.onchange = () => {
      const v = Math.min(max, Math.max(min, Number(i.value) || value));
      i.value = String(v);
      on(v);
    };
    return i;
  }
  private checkIn(value: boolean, on: (v: boolean) => void) {
    const i = h("input");
    i.type = "checkbox";
    i.checked = value;
    i.onchange = () => on(i.checked);
    return i;
  }
  private hidePanel() {
    this.panel.style.display = "none";
    const fn = this.panelClose;
    this.panelClose = null;
    fn?.();
  }
  private showPanel(title: string, rows: HTMLElement[], x: number, y: number, foot?: HTMLElement, onClose?: () => void) {
    const p = this.panel;
    this.hidePanel();
    this.panelClose = onClose || null;
    p.replaceChildren();
    const head = h("div", "cx-phead");
    const close = h("button", "cx-x", "✕");
    close.onclick = () => this.hidePanel();
    head.append(h("b", "", title), close);
    p.append(head, ...rows);
    if (foot) p.append(foot);
    p.style.display = "block";
    const W = 250, H = Math.min(p.offsetHeight || 260, this.host.clientHeight - 8);
    p.style.left = Math.max(4, Math.min(x, this.host.clientWidth - W - 4)) + "px";
    p.style.top = Math.max(4, Math.min(y, this.host.clientHeight - H - 4)) + "px";
  }

  private openThemePanel(x: number, y: number) {
    const T = this.theme;
    const set = <K extends keyof Theme>(k: K) => (v: Theme[K]) => {
      T[k] = v;
      save(THEME_KEY, T);
      this.applyTheme();
    };
    const reset = h("button", "cx-btn cx-reset", "Reset to default");
    reset.onclick = () => {
      Object.assign(T, DEF_THEME);
      save(THEME_KEY, T);
      this.applyTheme();
      this.openThemePanel(x, y);
    };
    this.showPanel(
      "Chart appearance",
      [
        this.row("Background", this.colorIn(T.bg, set("bg"))),
        this.row("Text / axis", this.colorIn(T.text, set("text"))),
        this.row("Vertical grid", this.colorIn(T.vGrid, set("vGrid"))),
        this.row("Show vertical grid", this.checkIn(T.vOn, set("vOn"))),
        this.row("Horizontal grid", this.colorIn(T.hGrid, set("hGrid"))),
        this.row("Show horizontal grid", this.checkIn(T.hOn, set("hOn"))),
        this.row("Candle up", this.colorIn(T.up, set("up"))),
        this.row("Candle down", this.colorIn(T.down, set("down"))),
      ],
      x,
      y,
      reset,
    );
  }
  private selIn(opts: [string, string][], value: string, on: (v: string) => void) {
    const el = h("select");
    for (const [v, t] of opts) el.append(new Option(t, v));
    el.value = value;
    el.onchange = () => on(el.value);
    return el;
  }

  private buildScale() {
    const mk = (label: string, log: boolean) => {
      const b = h("button", "cx-btn", label);
      b.title = log ? "Logarithmic price scale" : "Normal (linear) price scale";
      b.onclick = () => this.setLog(log);
      return b;
    };
    this.scaleBox.append(mk("Lin", false), mk("Log", true));
    ["pointerdown", "wheel", "dblclick", "contextmenu"].forEach((ev) => this.scaleBox.addEventListener(ev, (e) => e.stopPropagation()));
    this.logOn = load<{ log: boolean }>("arcus.chartx.scale.v1", { log: false }).log;
    this.setLog(this.logOn);
  }
  private setLog(on: boolean) {
    this.logOn = on;
    save("arcus.chartx.scale.v1", { log: on });
    try {
      this.chart.priceScale("right").applyOptions({ mode: on ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    } catch {}
    const [lin, lg] = Array.from(this.scaleBox.children);
    lin?.classList.toggle("on", !on);
    lg?.classList.toggle("on", on);
    this.lastSig = "";
  }

  private openShapePanel(id: string, before?: Shape[], pos?: { x: number; y: number }) {
    const sh = this.shapes.find((x) => x.id === id);
    if (!sh) return;
    const snap = before || this.cloneShapes();
    const at = pos || { x: Math.max(4, this.host.clientWidth - 330), y: 50 };
    const cur = () => this.shapes.find((x) => x.id === id);
    const upd = (fn: (s: Shape) => void, redraw = false) => {
      const s2 = cur();
      if (!s2) return;
      fn(s2);
      this.remember(s2);
      this.persistShapes();
      this.lastSig = "";
      if (redraw) {
        this.panelClose = null; // same editing session: keep the original undo snapshot
        this.openShapePanel(id, snap, at);
      }
    };
    const chk = (label: string, get: boolean, set: (s: Shape, v: boolean) => void) =>
      this.row(label, this.checkIn(get, (v) => upd((s2) => set(s2, v))));
    const col = (label: string, get: string, set: (s: Shape, v: string) => void) =>
      this.row(label, this.colorIn(get, (v) => upd((s2) => set(s2, v))));
    const num = (label: string, get: number, min: number, max: number, step: number, set: (s: Shape, v: number) => void) =>
      this.row(label, this.numIn(get, min, max, step, (v) => upd((s2) => set(s2, v))));
    const STYLE: [string, string][] = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];
    const k = sh.kind;
    const rows: HTMLElement[] = [];
    const isPos = k === "long" || k === "short";
    const isFib = k === "fibret" || k === "fibext";
    if (!isPos) rows.push(col(isFib ? "Trend line colour" : "Colour", sh.color, (s2, v) => (s2.color = v)));
    rows.push(num("Width", sh.width, 0.5, 8, 0.5, (s2, v) => (s2.width = v)));
    rows.push(this.row("Locked", this.checkIn(!!sh.locked, (v) => { const s2 = cur(); if (s2) { s2.locked = v; this.persistShapes(); this.lastSig = ""; } })));
    rows.push(this.row("Style", this.selIn(STYLE, sh.style || "solid", (v) => upd((s2) => (s2.style = v as LineStyle)))));
    if (k === "trend" || k === "channel" || isFib || k === "hray") {
      rows.push(chk("Extend left", !!sh.extL, (s2, v) => (s2.extL = v)));
      rows.push(chk("Extend right", k === "hray" ? sh.extR !== false : !!sh.extR, (s2, v) => (s2.extR = v)));
    }
    if (k === "channel") {
      rows.push(col("Fill colour", sh.fill || sh.color, (s2, v) => (s2.fill = v)));
      rows.push(num("Fill opacity", sh.fillOp ?? 0.1, 0, 1, 0.05, (s2, v) => (s2.fillOp = v)));
      rows.push(chk("Middle line", sh.mid !== false, (s2, v) => (s2.mid = v)));
    }
    if (k === "rect") {
      rows.push(col("Fill colour", sh.fill || sh.color, (s2, v) => (s2.fill = v)));
      rows.push(num("Fill opacity", sh.fillOp ?? 0.14, 0, 1, 0.05, (s2, v) => (s2.fillOp = v)));
    }
    if (isPos) {
      rows.push(col("Target colour", sh.pc || "#089981", (s2, v) => (s2.pc = v)));
      rows.push(col("Stop colour", sh.sc || "#f23645", (s2, v) => (s2.sc = v)));
      rows.push(num("Background opacity", sh.fillOp ?? 0.22, 0, 1, 0.05, (s2, v) => (s2.fillOp = v)));
      rows.push(chk("Labels on hover", sh.labels !== false, (s2, v) => (s2.labels = v)));
      rows.push(num("Account size", sh.acct ?? 1000, 1, 1e9, 100, (s2, v) => (s2.acct = v)));
      rows.push(num("Risk %", sh.riskP ?? 1, 0.01, 100, 0.25, (s2, v) => (s2.riskP = v)));
    }
    if (isFib) {
      rows.push(chk("Trend line", sh.showTrend !== false, (s2, v) => (s2.showTrend = v)));
      rows.push(chk("Background", sh.bg !== false, (s2, v) => (s2.bg = v)));
      rows.push(num("Background opacity", sh.fillOp ?? 0.1, 0, 1, 0.05, (s2, v) => (s2.fillOp = v)));
      rows.push(chk("Show level", sh.showLvl !== false, (s2, v) => (s2.showLvl = v)));
      rows.push(chk("Show price", sh.showPrice !== false, (s2, v) => (s2.showPrice = v)));
      if (k === "fibret") rows.push(chk("Reverse", !!sh.rev, (s2, v) => (s2.rev = v)));
      rows.push(h("div", "cx-sub", "Levels"));
      const lv = sh.levels || defLevels(k);
      lv.forEach((q, i) => {
        const r = h("div", "cx-lvl");
        const on = this.checkIn(q.on, (v) => upd((s2) => ((s2.levels ||= defLevels(k))[i].on = v)));
        const val = this.numIn(q.v, -10, 20, 0.001, (v) => upd((s2) => ((s2.levels ||= defLevels(k))[i].v = v)));
        const c = this.colorIn(q.color, (v) => upd((s2) => ((s2.levels ||= defLevels(k))[i].color = v)));
        const x = h("button", "cx-x", "✕");
        x.title = "Remove level";
        x.onclick = () => upd((s2) => (s2.levels = (s2.levels || defLevels(k)).filter((_, j) => j !== i)), true);
        r.append(on, val, c, x);
        rows.push(r);
      });
      const add = h("button", "cx-btn cx-reset", "+ Add level");
      add.onclick = () =>
        upd((s2) => {
          const l = (s2.levels ||= defLevels(k)) as Level[];
          l.push({ v: Number(((l.length ? Math.max(...l.map((q) => q.v)) : 0) + 1).toFixed(3)), on: true, color: "#9aa7b8" });
        }, true);
      const reset = h("button", "cx-btn cx-reset", "Reset levels");
      reset.onclick = () => upd((s2) => (s2.levels = defLevels(k)), true);
      rows.push(add, reset);
    }
    const names: Record<Kind, string> = { trend: "Trend line", arrow: "Arrow", vline: "Vertical line", hray: "Horizontal ray", channel: "Parallel channel", fibret: "Fib retracement", fibext: "Fib extension", rect: "Rectangle", long: "Long position", short: "Short position" };
    this.showPanel(names[k] + " settings", rows, at.x, at.y, undefined, () => this.record(snap));
  }

  /** PNG of the chart including drawings, with a small caption. */
  private async snapshot(): Promise<Blob | null> {
    const shot: HTMLCanvasElement = this.chart.takeScreenshot();
    const k = shot.width / Math.max(1, this.host.clientWidth);
    const out = document.createElement("canvas");
    const cap = 26 * k;
    out.width = shot.width;
    out.height = shot.height + cap;
    const g = out.getContext("2d")!;
    g.fillStyle = this.theme.bg;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(shot, 0, cap);
    try {
      const xml = new XMLSerializer().serializeToString(this.svg);
      const img = new Image();
      const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad();
        img.src = url;
      });
      g.drawImage(img, 0, cap, this.host.clientWidth * k, this.host.clientHeight * k);
      URL.revokeObjectURL(url);
    } catch {}
    g.fillStyle = "#d5e2f3";
    g.font = "bold " + 13 * k + "px system-ui,sans-serif";
    g.fillText(this.symbolLabel() + "  ·  " + new Date().toLocaleString() + "  ·  Arcus Alert", 10 * k, 18 * k);
    return new Promise((ok) => out.toBlob((b) => ok(b), "image/png"));
  }
  private symbolLabel() {
    return this.symbol.replace(/^[A-Z]+:/, "");
  }
  private code(): string {
    const data = { v: 1, symbol: this.symbol, shapes: this.shapes };
    return "ARCUS1:" + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }
  private importCode(txt: string): string {
    try {
      const m = /ARCUS1:([A-Za-z0-9+/=]+)/.exec(txt);
      if (!m) return "Code not recognised";
      const data = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      const list = migrate(Array.isArray(data.shapes) ? data.shapes : []);
      if (!list.length) return "No drawings in this code";
      const before = this.cloneShapes();
      for (const s of list) this.shapes.push({ ...s, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
      this.record(before);
      this.persistShapes();
      this.lastSig = "";
      return "Imported " + list.length + " drawing(s)" + (data.symbol && data.symbol !== this.symbol ? " (from " + data.symbol + ")" : "");
    } catch {
      return "Code is damaged";
    }
  }
  private openSharePanel() {
    const msg = h("div", "cx-hint", "");
    const say = (t: string) => (msg.textContent = t);
    const btn = (label: string, fn: () => unknown) => {
      const b = h("button", "cx-btn cx-wide", label);
      b.onclick = () => Promise.resolve(fn()).catch(() => say("Failed"));
      return b;
    };
    const name = () => "arcus-" + this.symbolLabel().replace(/[^\w-]+/g, "_") + ".png";
    const rows = [
      btn("⬇ Download image (PNG)", async () => {
        const b = await this.snapshot();
        if (!b) return say("Image failed");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = name();
        a.click();
        say("Saved " + name());
      }),
      btn("📋 Copy image", async () => {
        const b = await this.snapshot();
        if (!b) return say("Image failed");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
        say("Image copied: paste it in Telegram, X, etc.");
      }),
      btn("📤 Share…", async () => {
        const b = await this.snapshot();
        if (!b) return say("Image failed");
        const f = new File([b], name(), { type: "image/png" });
        const nav: any = navigator;
        if (nav.canShare && nav.canShare({ files: [f] })) await nav.share({ files: [f], title: this.symbolLabel() + " analysis" });
        else say("Sharing is not supported here: use Download or Copy");
      }),
      btn("🔗 Copy analysis code", async () => {
        await navigator.clipboard.writeText(this.code());
        say("Code copied. A friend can paste it with Import.");
      }),
      btn("📥 Import analysis code", async () => {
        let txt = "";
        try {
          txt = await navigator.clipboard.readText();
        } catch {}
        if (!/ARCUS1:/.test(txt)) txt = window.prompt("Paste the analysis code") || "";
        if (txt) say(this.importCode(txt));
      }),
      msg,
    ];
    this.showPanel("Share analysis", rows, Math.max(4, this.host.clientWidth - 300), 50);
  }

  /** Indicators dropdown (lives in the chart header, next to the timeframe). Click a row to open its settings. */
  private buildIndMenu() {
    this.indBtn.title = "Indicators: SMA, RSI, Volume";
    this.indBtn.onclick = () => {
      const o = this.indMenu.style.display === "none";
      this.indMenu.style.display = o ? "block" : "none";
      this.indBtn.classList.toggle("on", o);
      if (o) this.renderInd();
    };
    this.indMenu.style.display = "none";
    stop(this.indMenu);
    this.indWrap.append(this.indBtn, this.indMenu);
    const slot = this.host.closest(".chart-workspace")?.querySelector(".ind-slot");
    (slot || this.host).append(this.indWrap);
    const away = (e: PointerEvent) => {
      if (this.indMenu.style.display !== "none" && !this.indWrap.contains(e.target as Node)) {
        this.indMenu.style.display = "none";
        this.indBtn.classList.remove("on");
      }
    };
    document.addEventListener("pointerdown", away, true);
    this.cleanups.push(() => document.removeEventListener("pointerdown", away, true));
    this.updateIndLabel();
  }
  private updateIndLabel() {
    const n = [this.prefs.sma.on, this.prefs.rsi.on, this.prefs.vol.on].filter(Boolean).length;
    this.indBtn.textContent = "Indicators" + (n ? " (" + n + ")" : "") + " ▾";
  }
  private renderInd() {
    const P = this.prefs;
    const commit = (full = true) => {
      save(PREFS_KEY, P);
      this.labels();
      this.syncIndicators();
      if (full) this.fill(true);
      this.updateIndLabel();
    };
    this.indMenu.replaceChildren();
    {
      const row = h("div", "cx-ind-row");
      const cb = this.checkIn(this.evOn, (v) => {
        this.evOn = v;
        save("arcus.chartx.events.v1", v);
        this.evSig = "";
        this.evPop.style.display = "none";
        this.onEventsToggle?.(v);
      });
      const nm = h("span", "cx-ind-name", "Events & news (stocks)");
      nm.title = "Earnings, dividends, splits and news as dashed lines with a dot on top. Click a dot for details.";
      const st = h("small", "cx-ev-status", this.evStatus ? " · " + this.evStatus : "");
      this.evStatusEl = st;
      row.append(cb, nm, st);
      this.indMenu.append(row);
    }
    const defs: ["sma" | "rsi" | "vol", string][] = [["sma", "SMA (moving average)"], ["rsi", "RSI"], ["vol", "Volume"]];
    for (const [k, label] of defs) {
      const row = h("div", "cx-ind-row" + (this.indOpen === k ? " open" : ""));
      const cb = this.checkIn(P[k].on, (v) => {
        P[k].on = v;
        commit();
        this.renderInd();
      });
      const name = h("button", "cx-ind-name", label + (k === "sma" ? " · " + P.sma.period : k === "rsi" ? " · " + P.rsi.period : ""));
      name.title = "Click for settings";
      name.onclick = () => {
        this.indOpen = this.indOpen === k ? null : k;
        if (this.indOpen && !P[k].on) {
          P[k].on = true;
          commit();
        }
        this.renderInd();
      };
      row.append(cb, name, h("span", "cx-ind-caret", this.indOpen === k ? "▴" : "▾"));
      this.indMenu.append(row);
      if (this.indOpen === k) {
        const box = h("div", "cx-ind-set");
        if (k === "sma")
          box.append(
            this.row("Period", this.numIn(P.sma.period, 2, 500, 1, (v) => ((P.sma.period = v), commit(), (name.textContent = label + " · " + v)))),
            this.row("Colour", this.colorIn(P.sma.color, (v) => ((P.sma.color = v), commit(false)))),
            this.row("Width", this.numIn(P.sma.width, 1, 5, 1, (v) => ((P.sma.width = v), commit(false)))),
          );
        else if (k === "rsi")
          box.append(
            this.row("Period", this.numIn(P.rsi.period, 2, 200, 1, (v) => ((P.rsi.period = v), commit(), (name.textContent = label + " · " + v)))),
            this.row("Colour", this.colorIn(P.rsi.color, (v) => ((P.rsi.color = v), commit(false)))),
            this.row("Pane height", this.numIn(P.rsi.h, 0.3, 3, 0.1, (v) => ((P.rsi.h = v), commit(false)))),
            h("div", "cx-hint", "You can also drag the line between the chart and RSI."),
          );
        else box.append(h("div", "cx-hint", "Volume bars sit at the bottom of the main chart and use the candle colours (right-click the chart to change them)."));
        this.indMenu.append(box);
      }
    }
  }
  openShare() {
    this.openSharePanel();
  }

  private applyTheme() {
    const T = this.theme;
    try {
      this.chart.applyOptions({
        layout: { background: { color: T.bg }, textColor: T.text },
        grid: { vertLines: { color: T.vGrid, visible: T.vOn }, horzLines: { color: T.hGrid, visible: T.hOn } },
      });
      this.candle.applyOptions({
        upColor: T.up, downColor: T.down, borderUpColor: T.up, borderDownColor: T.down, wickUpColor: T.up, wickDownColor: T.down,
      });
    } catch {}
    this.fill(true);
  }

  private cloneShapes(): Shape[] {
    return JSON.parse(JSON.stringify(this.shapes));
  }
  private setShapes(list: Shape[]) {
    this.shapes = JSON.parse(JSON.stringify(list));
    if (!this.shapes.some((x) => x.id === this.selected)) this.selected = null;
    this.persistShapes();
    this.lastSig = "";
  }
  /** Register an undo step: `before` is the list as it was, the current list is the "after". */
  private record(before: Shape[]) {
    const after = this.cloneShapes();
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    const sym = this.symbol;
    undoManager.push({
      tag: "cx",
      undo: () => this.symbol === sym && this.setShapes(before),
      redo: () => this.symbol === sym && this.setShapes(after),
    });
  }
  private colorBefore: Shape[] | null = null;
  /** Style changes become the default for the next shape of the same kind (kept until you change it again). */
  private remember(sh: Shape) {
    const d = load<Record<string, Partial<Shape>>>("arcus.chartx.kdef.v1", {});
    const { id, kind, pts, locked, ...style } = sh as any;
    d[sh.kind] = style;
    save("arcus.chartx.kdef.v1", d);
  }
  private newShape(id: string, kind: Kind, pts: P[]): Shape {
    const d = load<Record<string, Partial<Shape>>>("arcus.chartx.kdef.v1", {})[kind] || {};
    return { color: DEF_COLOR[kind], width: kind === "trend" || kind === "arrow" ? 1.5 : 2, ...d, id, kind, pts } as Shape;
  }
  private lockAll = load<boolean>("arcus.chartx.lockall.v1", false);
  private lockBtn = h("button", "", "🔓");

  private persistShapes() {
    const all = load<Record<string, Shape[]>>(DRAW_KEY, {});
    all[this.symbol] = this.shapes;
    save(DRAW_KEY, all);
  }

  /* ---------- indicators ---------- */
  private syncIndicators() {
    const kill = (s: any) => {
      try {
        this.chart.removeSeries(s);
      } catch {}
    };
    const P = this.prefs;
    if (!P.sma.on && this.smaS) (kill(this.smaS), (this.smaS = null));
    if (!P.rsi.on && this.rsiS) (kill(this.rsiS), (this.rsiS = null));
    if (!P.vol.on && this.volS) (kill(this.volS), (this.volS = null));
    if (P.sma.on && !this.smaS)
      this.smaS = this.chart.addSeries(LineSeries, {
        color: P.sma.color, lineWidth: P.sma.width, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });
    else if (this.smaS) this.smaS.applyOptions({ color: P.sma.color, lineWidth: P.sma.width });
    if (P.rsi.on && !this.rsiS) {
      this.rsiS = this.chart.addSeries(LineSeries, { color: P.rsi.color, lineWidth: 2, priceLineVisible: false }, 1);
      for (const price of [70, 30])
        this.rsiS.createPriceLine({ price, color: "#556a85", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    } else if (this.rsiS) this.rsiS.applyOptions({ color: P.rsi.color });
    if (P.vol.on && !this.volS) {
      this.volS = this.chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceScaleId: "cx-vol", lastValueVisible: false, priceLineVisible: false,
      });
      this.volS.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    try {
      this.candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: P.vol.on ? 0.22 : 0.08 } });
    } catch {}
    try {
      const panes = this.chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        panes[1].setStretchFactor(3 * P.rsi.h * 0.33 + 0.0001);
      }
    } catch {}
  }

  /** full=true: setData; otherwise only push the last point (cheap, used for live ticks). */
  private fill(full: boolean) {
    if (this.destroyed || !this.candles.length) return;
    const put = (s: any, d: any[]) => {
      if (!s || !d.length) return;
      if (full) s.setData(d);
      else s.update(d[d.length - 1]);
    };
    try {
      const P = this.prefs;
      const tail = full ? this.candles : this.candles.slice(-Math.max(200, P.sma.period * 8, P.rsi.period * 12));
      put(this.smaS, sma(tail, P.sma.period));
      put(this.rsiS, rsi(tail, P.rsi.period));
      if (this.volS) {
        const vt = full ? this.candles : this.candles.slice(-2);
        put(this.volS, vt.map((c) => ({ time: c.time, value: c.volume || 0, color: (c.close >= c.open ? this.theme.up : this.theme.down) + "88" })));
      }
    } catch {}
  }

  /** Seconds per candle (from the timeframe selector); 0 = guess from the data. */
  setSpan(sec: number) {
    this.span = sec;
  }
  /** Countdown to the close of the current candle, under the last-price label on the right scale. */
  private tickCount() {
    const c = this.candles;
    const el = this.countEl;
    if (!c.length) return void (el.style.display = "none");
    const span = this.span || barSpan(c);
    const last = c[c.length - 1];
    const y = this.candle.priceToCoordinate(last.close);
    let w = 0;
    try {
      w = this.chart.priceScale("right").width();
    } catch {}
    if (y == null || !w || !span) return void (el.style.display = "none");
    const now = Date.now() / 1000;
    let left = Math.floor(last.time / span) * span + span - now;
    if (left < 0) left = 0;
    const d = Math.floor(left / 86400),
      hh = Math.floor((left % 86400) / 3600),
      mm = Math.floor((left % 3600) / 60),
      ss = Math.floor(left % 60);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const txt = (d ? d + "d " : "") + (d || hh ? p2(hh) + ":" : "") + p2(mm) + ":" + p2(ss);
    const col = last.close >= last.open ? this.theme.up : this.theme.down;
    if (txt !== this.countTxt) {
      this.countTxt = txt;
      el.textContent = txt;
    }
    el.style.display = "block";
    el.style.background = col;
    el.style.width = w + "px";
    el.style.left = this.host.clientWidth - w + "px";
    el.style.top = Math.min(Number(y) + 11, this.host.clientHeight - 60) + "px";
  }

  /** Small label at the top left telling where the candles come from. */
  setSource(text: string) {
    this.srcEl.textContent = text;
  }

  /* ---------- legend ---------- */
  private updateLegend(param: any) {
    const c = this.candles;
    if (!c.length) return;
    let i = c.length - 1;
    if (param?.time !== undefined) {
      let lo = 0,
        hi = c.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (c[mid].time === Number(param.time)) {
          i = mid;
          break;
        }
        if (c[mid].time < Number(param.time)) lo = mid + 1;
        else hi = mid - 1;
      }
    }
    const x = c[i],
      prev = i > 0 ? c[i - 1].close : x.open,
      chg = x.close - prev,
      pct = prev ? (chg / prev) * 100 : 0,
      cls = chg >= 0 ? "cx-up" : "cx-dn";
    this.legend.innerHTML =
      `<b>O</b> <i class="${cls}">${fmtPrice(x.open)}</i> <b>H</b> <i class="${cls}">${fmtPrice(x.high)}</i> ` +
      `<b>L</b> <i class="${cls}">${fmtPrice(x.low)}</i> <b>C</b> <i class="${cls}">${fmtPrice(x.close)}</i> ` +
      `<i class="${cls}">${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%</i>` +
      (x.volume ? ` <b>Vol</b> <i>${fmtVol(x.volume)}</i>` : "");
  }

  /* ---------- drawing tools ---------- */
  private setTool(k: Kind | null) {
    this.tool = k;
    this.draft = null;
    this.catcher.classList.toggle("on", !!k);
    for (const [kind, b] of this.toolBtns) b.classList.toggle("selected", kind === k);
    for (const [kind, b] of this.favBtns) if (!this.extBtns.has(kind)) b.classList.toggle("selected", kind === k);
    this.lastSig = "";
  }

  private toggleFav(k: string) {
    this.favs = this.favs.includes(k) ? this.favs.filter((x) => x !== k) : [...this.favs, k];
    try {
      localStorage.setItem("arcus.chartx.favtools.v1", JSON.stringify(this.favs));
    } catch {}
    this.buildFavBar();
  }

  private placeFavBar() {
    const hw = this.host.clientWidth,
      hh = this.host.clientHeight,
      bw = this.favBar.offsetWidth || 120,
      bh = this.favBar.offsetHeight || 30;
    let x = this.favPos ? this.favPos.x : (hw - bw) / 2,
      y = this.favPos ? this.favPos.y : 8;
    x = Math.max(0, Math.min(hw - bw, x));
    y = Math.max(0, Math.min(hh - bh, y));
    this.favBar.style.left = x + "px";
    this.favBar.style.top = y + "px";
  }

  private buildFavBar() {
    for (const [k, b] of this.toolBtns) b.classList.toggle("fav", this.favs.includes(k));
    for (const [k, b] of this.extBtns) {
      if (this.favs.includes(k)) b.setAttribute("data-fav", "1");
      else b.removeAttribute("data-fav");
    }
    this.favBar.replaceChildren();
    this.favBtns.clear();
    const list = this.favs.filter((k) => this.toolBtns.has(k as Kind) || this.extBtns.has(k));
    this.favBar.style.display = list.length ? "flex" : "none";
    if (!list.length) return;
    const grip = h("span", "cx-fav-grip", "⋮⋮");
    grip.title = "Drag to move";
    grip.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.favBar.getBoundingClientRect(),
        hr = this.host.getBoundingClientRect(),
        dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      const mv = (ev: PointerEvent) => {
        this.favPos = { x: ev.clientX - hr.left - dx, y: ev.clientY - hr.top - dy };
        this.placeFavBar();
      };
      const up = () => {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem("arcus.chartx.favbar.v1", JSON.stringify(this.favPos));
        } catch {}
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    };
    this.favBar.append(grip);
    for (const k of list) {
      const ext = this.extBtns.get(k);
      const src = ext || this.toolBtns.get(k as Kind)!;
      const b = h("button", "cx-fav-btn", src.firstChild?.textContent || "");
      b.title = src.title;
      b.style.fontSize = src.style.fontSize;
      b.onpointerdown = (e) => e.stopPropagation();
      b.onclick = () => {
        this.notes?.setPlacing(false);
        if (ext) {
          this.setTool(null);
          ext.click();
          return;
        }
        this.setTool(this.tool === k ? null : (k as Kind));
      };
      b.classList.toggle("selected", ext ? ext.classList.contains("selected") : this.tool === k);
      this.favBtns.set(k, b);
      this.favBar.append(b);
    }
    requestAnimationFrame(() => this.placeFavBar());
  }

  private pt(e: { clientX: number; clientY: number }): P | null {
    const r = this.host.getBoundingClientRect();
    const logical = this.chart.timeScale().coordinateToLogical(e.clientX - r.left);
    const price = this.candle.coordinateToPrice(e.clientY - r.top);
    if (logical == null || price == null || !this.candles.length) return null;
    return { time: indexToTime(this.candles, barSpan(this.candles), Number(logical)), price: Number(price) };
  }

  private hookDrawing() {
    this.catcher.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const p = this.pt(e);
      const kind = this.tool;
      if (!p || !kind) return;
      const pts = [...(this.draft?.pts || []), p];
      const need = NEED[kind];
      if (kind === "long" || kind === "short" || pts.length >= need) {
        const before = this.cloneShapes();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const final = kind === "long" || kind === "short" ? newPosition(kind, p, barSpan(this.candles)) : pts;
        this.shapes.push(this.newShape(id, kind, final));
        this.record(before);
        this.persistShapes();
        this.setTool(null);
        this.select(id);
      } else this.draft = { kind, pts, cur: p };
      this.lastSig = "";
    });
    this.catcher.addEventListener("pointermove", (e) => {
      if (!this.draft) return;
      const p = this.pt(e);
      if (p) {
        this.draft.cur = p;
        this.lastSig = "";
      }
    });
  }

  private select(id: string | null) {
    if (id) this.notes?.deselect();
    this.selected = id;
    const sh = this.shapes.find((x) => x.id === id);
    if (sh) {
      this.popColor.value = sh.color;
      this.lockBtn.textContent = sh.locked ? "🔒" : "🔓";
      this.popWidth.value = String(sh.width);
      if (this.popWidth.value !== String(sh.width)) this.popWidth.value = "2";
    }
    this.lastSig = "";
  }
  private deleteSelected() {
    if (!this.selected) return;
    const before = this.cloneShapes();
    this.shapes = this.shapes.filter((x) => x.id !== this.selected);
    this.record(before);
    this.selected = null;
    this.persistShapes();
    this.lastSig = "";
  }
  /** Nearest shape within 9px of the point (generous so lines are easy to pick); newest wins ties. */
  private hitTest(px: number, py: number): string | null {
    let best: string | null = null,
      bestD = 9;
    for (const s of this.shapes) {
      const b = this.built.get(s.id);
      if (!b) continue;
      const d = pickDistance(b, px, py);
      if (d <= bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  private xy(p: P) {
    const x = this.chart.timeScale().logicalToCoordinate(timeToIndex(this.candles, barSpan(this.candles), p.time));
    const y = this.candle.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }

  /** Redraw only when something that affects the shapes changed (no work while idle). */
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.notes.tick();
    this.tickCount();
    this.updateEvents();
    if (!this.shapes.length && !this.draft) {
      if (this.svg.firstChild) this.svg.replaceChildren();
      this.built.clear();
      this.pop.style.display = "none";
      return;
    }
    const ts = this.chart.timeScale();
    const sig = [
      ts.logicalToCoordinate(0),
      ts.logicalToCoordinate(50),
      this.candle.coordinateToPrice(0),
      this.candle.coordinateToPrice(300),
      this.host.clientWidth,
      this.host.clientHeight,
      this.shapes.length,
      this.draft?.cur.time,
      this.draft?.cur.price,
    ].join("|");
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.svg.replaceChildren();
    const w = this.host.clientWidth, hh = this.host.clientHeight;
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(hh));
    this.pop.style.display = "none";
    this.built.clear();
    const draw = (s: Shape, selected: boolean, draft: boolean) => {
      const b = build(s, { xy: (p) => this.xy(p), w, h: hh, selected, draft, hover: s.id === this.hoverId });
      if (!b) return null;
      b.els.forEach((el) => this.svg.append(el));
      return b;
    };
    for (const s of this.shapes) {
      const b = draw(s, s.id === this.selected, false);
      if (!b) continue;
      this.built.set(s.id, b);
      if (s.id === this.selected) {
        this.pop.style.display = "flex";
        this.pop.style.top = Math.max(4, b.mid.y - 36) + "px";
      }
    }
    if (this.draft)
      draw({ ...this.newShape("d", this.draft.kind, [...this.draft.pts, this.draft.cur]), width: 1.5 }, false, true);
  };
}

export const attachChartX = (chart: any, candle: any, host: HTMLElement) => new ChartX(chart, candle, host);
