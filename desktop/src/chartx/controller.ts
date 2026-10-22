/*
 * ChartX (lean): SMA 7, RSI 14, OHLC legend and a trend-line tool, attached to the existing
 * lightweight-charts chart. Everything is optional, default off, and costs nothing while off.
 * It never replaces the main candlestick series, so alerts and horizontal lines are untouched.
 */
import { LineSeries } from "lightweight-charts";
import "./chartx.css";
import { Candle, Pt, barSpan, fmtPrice, fmtVol, rsi, sma } from "./math";
import { indexToTime, timeToIndex } from "./geometry";

const PREFS_KEY = "arcus.chartx.prefs.v2",
  DRAW_KEY = "arcus.chartx.drawings.v1";
type P = { time: number; price: number };
type Shape = { id: string; a: P; b: P; color: string };
type Prefs = { sma7: boolean; rsi: boolean };

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

export class ChartX {
  private candles: Candle[] = [];
  private symbol = "";
  private prefs: Prefs;
  private shapes: Shape[] = [];
  private draft: { a: P; b: P } | null = null;
  private drawing = false;
  private smaS: any = null;
  private rsiS: any = null;
  private destroyed = false;
  private refreshTimer: number | undefined;
  private raf = 0;
  private lastSig = "";
  private cleanups: (() => void)[] = [];

  private legend = h("div", "cx-legend");
  private bar = h("div", "cx-bar");
  private svg = svgEl("svg", { class: "cx-svg" }) as SVGSVGElement;
  private catcher = h("div", "cx-catcher");
  private smaBtn = h("button", "cx-btn", "SMA 7");
  private rsiBtn = h("button", "cx-btn", "RSI");
  private lineBtn = h("button", "cx-btn", "Line");
  private clearBtn = h("button", "cx-btn", "Clear lines");

  constructor(
    private chart: any,
    private candle: any,
    private host: HTMLElement,
  ) {
    this.prefs = load<Prefs>(PREFS_KEY, { sma7: false, rsi: false });
    if (getComputedStyle(host).position === "static")
      host.style.position = "relative";
    this.buildUi();
    this.syncIndicators();
    const onMove = (p: any) => this.updateLegend(p);
    this.chart.subscribeCrosshairMove(onMove);
    this.cleanups.push(() => this.chart.unsubscribeCrosshairMove(onMove));
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && this.setDrawing(false);
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
      const all = load<Record<string, Shape[]>>(DRAW_KEY, {});
      this.shapes = Array.isArray(all[symbol]) ? all[symbol] : [];
      this.draft = null;
    }
    this.fill(true);
    this.updateLegend(null);
    this.lastSig = "";
  }
  updateBar(bar: Candle) {
    const n = this.candles.length;
    if (!n) return;
    const last = this.candles[n - 1];
    if (bar.time === last.time) this.candles[n - 1] = { ...last, ...bar };
    else if (bar.time > last.time) this.candles.push({ ...bar });
    else return;
    if (this.refreshTimer || (!this.smaS && !this.rsiS)) {
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
    [this.legend, this.bar, this.svg, this.catcher].forEach((el) =>
      el.remove(),
    );
  }

  /* ---------- UI ---------- */
  private buildUi() {
    const toggle = (btn: HTMLButtonElement, key: keyof Prefs) => {
      btn.classList.toggle("on", this.prefs[key]);
      btn.onclick = () => {
        this.prefs[key] = !this.prefs[key];
        btn.classList.toggle("on", this.prefs[key]);
        save(PREFS_KEY, this.prefs);
        this.syncIndicators();
        this.fill(true);
      };
    };
    toggle(this.smaBtn, "sma7");
    toggle(this.rsiBtn, "rsi");
    this.lineBtn.title = "Draw a trend line: click two points (Esc cancels)";
    this.lineBtn.onclick = () => this.setDrawing(!this.drawing);
    this.clearBtn.title =
      "Remove all trend lines (alerts and horizontal lines are not affected)";
    this.clearBtn.onclick = () => {
      this.shapes = [];
      this.persistShapes();
      this.lastSig = "";
    };
    this.bar.append(this.smaBtn, this.rsiBtn, this.lineBtn, this.clearBtn);
    ["pointerdown", "wheel", "dblclick"].forEach((ev) =>
      this.bar.addEventListener(ev, (e) => e.stopPropagation()),
    );
    this.host.append(this.svg, this.legend, this.bar, this.catcher);
  }

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
    if (!this.prefs.sma7 && this.smaS) {
      kill(this.smaS);
      this.smaS = null;
    }
    if (!this.prefs.rsi && this.rsiS) {
      kill(this.rsiS);
      this.rsiS = null;
    }
    if (this.prefs.sma7 && !this.smaS)
      this.smaS = this.chart.addSeries(LineSeries, {
        color: "#f2b84b",
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    if (this.prefs.rsi && !this.rsiS) {
      this.rsiS = this.chart.addSeries(
        LineSeries,
        { color: "#b388ff", lineWidth: 2, priceLineVisible: false },
        1,
      );
      for (const price of [70, 30])
        this.rsiS.createPriceLine({
          price,
          color: "#556a85",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
    }
    try {
      const panes = this.chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        panes[1].setStretchFactor(1);
      }
    } catch {}
  }

  /** full=true: setData; otherwise only push the last point (cheap, used for live ticks). */
  private fill(full: boolean) {
    if (this.destroyed || !this.candles.length) return;
    const put = (s: any, d: Pt[]) => {
      if (!s || !d.length) return;
      if (full) s.setData(d);
      else s.update(d[d.length - 1]);
    };
    try {
      const tail = full ? this.candles : this.candles.slice(-200);
      put(this.smaS, sma(tail, 7));
      put(this.rsiS, rsi(tail, 14)); // 200 bars is plenty for Wilder smoothing to converge
    } catch {}
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

  /* ---------- trend lines ---------- */
  private setDrawing(on: boolean) {
    this.drawing = on;
    this.draft = null;
    this.catcher.classList.toggle("on", on);
    this.lineBtn.classList.toggle("on", on);
    this.lastSig = "";
  }

  private hookDrawing() {
    const pt = (e: PointerEvent): P | null => {
      const r = this.host.getBoundingClientRect();
      const logical = this.chart
        .timeScale()
        .coordinateToLogical(e.clientX - r.left);
      const price = this.candle.coordinateToPrice(e.clientY - r.top);
      if (logical == null || price == null || !this.candles.length) return null;
      return {
        time: indexToTime(this.candles, barSpan(this.candles), Number(logical)),
        price: Number(price),
      };
    };
    this.catcher.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const p = pt(e);
      if (!p || !this.drawing) return;
      if (!this.draft) this.draft = { a: p, b: p };
      else {
        this.shapes.push({
          id: Date.now().toString(36),
          a: this.draft.a,
          b: p,
          color: "#4aa3ff",
        });
        this.persistShapes();
        this.setDrawing(false);
      }
      this.lastSig = "";
    });
    this.catcher.addEventListener("pointermove", (e) => {
      if (!this.draft) return;
      const p = pt(e);
      if (p) {
        this.draft.b = p;
        this.lastSig = "";
      }
    });
  }

  private xy(p: P) {
    const x = this.chart
      .timeScale()
      .logicalToCoordinate(
        timeToIndex(this.candles, barSpan(this.candles), p.time),
      );
    const y = this.candle.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }

  /** Redraw only when something that affects the lines changed (no work while idle). */
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.shapes.length && !this.draft) {
      if (this.svg.firstChild) this.svg.replaceChildren();
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
      this.draft?.b.time,
      this.draft?.b.price,
    ].join("|");
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.svg.replaceChildren();
    this.svg.setAttribute("width", String(this.host.clientWidth));
    this.svg.setAttribute("height", String(this.host.clientHeight));
    const list = this.draft
      ? [...this.shapes, { id: "d", color: "#4aa3ff", ...this.draft }]
      : this.shapes;
    for (const s of list) {
      const A = this.xy(s.a),
        B = this.xy(s.b);
      if (!A || !B) continue;
      this.svg.append(
        svgEl("line", {
          x1: A.x,
          y1: A.y,
          x2: B.x,
          y2: B.y,
          stroke: s.color,
          "stroke-width": 1.5,
          "stroke-dasharray": s.id === "d" ? "5 4" : "",
        }),
        svgEl("circle", { cx: A.x, cy: A.y, r: 3, fill: s.color }),
        svgEl("circle", { cx: B.x, cy: B.y, r: 3, fill: s.color }),
      );
    }
  };
}

export const attachChartX = (chart: any, candle: any, host: HTMLElement) =>
  new ChartX(chart, candle, host);
