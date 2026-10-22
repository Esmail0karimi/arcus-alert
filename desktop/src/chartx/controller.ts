/*
 * ChartX: additive analysis tools for the Arcus chart (chart types, scales, OHLC legend,
 * indicators, drawing tools). It only *attaches* to an existing lightweight-charts chart and
 * its candlestick series; it never replaces them, so alerts, the horizontal-line tool and
 * cloud-synced drawings in main.tsx keep working exactly as before.
 */
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
} from "lightweight-charts";
import "./chartx.css";
import {
  Candle,
  Pt,
  barSpan,
  bollinger,
  ema,
  fibLevels,
  fmtCountdown,
  fmtPrice,
  fmtVol,
  heikinAshi,
  macd,
  rsi,
  sma,
} from "./math";
import { extendRay, indexToTime, measure, timeToIndex } from "./geometry";
import { mountTradingView, tvInterval, tvSymbol } from "./tvwidget";

const UP = "#00c9a7",
  DN = "#f06470",
  CLEAR = "rgba(0,0,0,0)";
const PREFS_KEY = "arcus.chartx.prefs.v1",
  DRAW_KEY = "arcus.chartx.drawings.v1";

export type ChartType = "candles" | "ha" | "bars" | "line" | "area";
export type ScaleMode = "normal" | "log" | "percent";
type IndKey =
  | "vol"
  | "sma20"
  | "sma50"
  | "ema20"
  | "ema50"
  | "bb"
  | "rsi"
  | "macd";
type Kind = "trend" | "ray" | "rect" | "fib" | "vline" | "measure";
type P = { time: number; price: number };
type Shape = { id: string; kind: Kind; a: P; b?: P; color: string };
type Prefs = {
  type: ChartType;
  scale: ScaleMode;
  ind: Partial<Record<IndKey, boolean>>;
};

const IND_LABEL: Record<IndKey, string> = {
  vol: "Volume",
  sma20: "SMA 20",
  sma50: "SMA 50",
  ema20: "EMA 20",
  ema50: "EMA 50",
  bb: "Bollinger (20, 2)",
  rsi: "RSI (14)",
  macd: "MACD (12, 26, 9)",
};
const TOOLS: { kind: Kind; icon: string; title: string }[] = [
  { kind: "trend", icon: "╱", title: "Trend line" },
  { kind: "ray", icon: "↗", title: "Ray" },
  { kind: "vline", icon: "┃", title: "Vertical line" },
  { kind: "rect", icon: "▭", title: "Rectangle" },
  { kind: "fib", icon: "Fib", title: "Fibonacci retracement" },
  { kind: "measure", icon: "⟷", title: "Measure (price, %, bars)" },
];
const FIB_COLORS = [
  "#8aa0b8",
  "#f06470",
  "#f2b84b",
  "#00c9a7",
  "#4aa3ff",
  "#b388ff",
  "#8aa0b8",
];

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
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
};
const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

export class ChartX {
  private candles: Candle[] = [];
  private symbol = "";
  private prefs: Prefs;
  private shapes: Shape[] = [];
  private draft: { kind: Kind; a: P; b?: P } | null = null;
  private tool: Kind | null = null;
  private measureShape: { a: P; b: P } | null = null;
  private color = "#4aa3ff";

  private alt: any = null;
  private ind: Partial<Record<IndKey, any[]>> = {};
  private destroyed = false;
  private refreshTimer: number | undefined;
  private raf = 0;
  private lastSig = "";
  private cleanups: (() => void)[] = [];

  private legend = h("div", "cx-legend");
  private legendOhlc = h("div", "cx-legend-row");
  private legendInd = h("div", "cx-legend-row cx-legend-ind");
  private countdown = h("span", "cx-countdown");
  private bar = h("div", "cx-bar");
  private svg: SVGSVGElement;
  private catcher = h("div", "cx-catcher");
  private toolButtons = new Map<Kind, HTMLButtonElement>();
  private typeSel = h("select");
  private scaleSel = h("select");
  private indMenu = h("div", "cx-menu");
  private tvBox = h("div", "cx-tv");
  private tvOn = false;
  private tvBtn = h("button", "cx-btn", "TradingView");

  constructor(
    private chart: any,
    private candle: any,
    private host: HTMLElement,
  ) {
    this.prefs = load<Prefs>(PREFS_KEY, {
      type: "candles",
      scale: "normal",
      ind: {},
    });
    this.svg = svgEl("svg", { class: "cx-svg" }) as SVGSVGElement;
    this.buildUi();
    this.applyScale();
    this.applyType();
    this.rebuildIndicators();
    this.hookEvents();
    this.loop();
  }

  /* ---------- public hooks used by main.tsx ---------- */
  setCandles(candles: Candle[], symbol: string) {
    this.candles = candles.map((c) => ({ ...c }));
    if (symbol !== this.symbol) {
      this.symbol = symbol;
      const all = load<Record<string, Shape[]>>(DRAW_KEY, {});
      this.shapes = Array.isArray(all[symbol]) ? all[symbol] : [];
      this.measureShape = null;
      this.draft = null;
      if (this.tvOn) this.mountTv();
    }
    this.refreshNow();
  }
  updateBar(bar: Candle) {
    const n = this.candles.length;
    if (!n) return;
    const last = this.candles[n - 1];
    if (bar.time === last.time) this.candles[n - 1] = { ...last, ...bar };
    else if (bar.time > last.time) this.candles.push({ ...bar });
    else return;
    this.scheduleRefresh();
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
    [this.legend, this.bar, this.svg, this.catcher, this.tvBox].forEach((el) =>
      el.remove(),
    );
    document.querySelectorAll(".cx-rail-part").forEach((el) => el.remove());
  }

  /* ---------- UI ---------- */
  private buildUi() {
    const host = this.host;
    if (getComputedStyle(host).position === "static")
      host.style.position = "relative";
    this.legend.append(this.legendOhlc, this.legendInd);
    this.legendOhlc.append(h("span"), this.countdown);
    host.append(this.svg, this.legend, this.bar, this.catcher);

    const types: [ChartType, string][] = [
      ["candles", "Candles"],
      ["ha", "Heikin Ashi"],
      ["bars", "Bars"],
      ["line", "Line"],
      ["area", "Area"],
    ];
    types.forEach(([v, t]) => this.typeSel.append(new Option(t, v)));
    this.typeSel.value = this.prefs.type;
    this.typeSel.title = "Chart type";
    this.typeSel.onchange = () => {
      this.prefs.type = this.typeSel.value as ChartType;
      this.persist();
      this.applyType();
      this.refreshNow();
    };
    const scales: [ScaleMode, string][] = [
      ["normal", "Price"],
      ["log", "Log"],
      ["percent", "%"],
    ];
    scales.forEach(([v, t]) => this.scaleSel.append(new Option(t, v)));
    this.scaleSel.value = this.prefs.scale;
    this.scaleSel.title = "Price scale";
    this.scaleSel.onchange = () => {
      this.prefs.scale = this.scaleSel.value as ScaleMode;
      this.persist();
      this.applyScale();
    };

    const indBtn = h("button", "cx-btn", "Indicators ▾");
    indBtn.onclick = (e) => {
      e.stopPropagation();
      this.indMenu.classList.toggle("open");
    };
    (Object.keys(IND_LABEL) as IndKey[]).forEach((k) => {
      const row = h("label", "cx-menu-row");
      const cb = h("input");
      cb.type = "checkbox";
      cb.checked = !!this.prefs.ind[k];
      cb.onchange = () => {
        this.prefs.ind[k] = cb.checked;
        this.persist();
        this.rebuildIndicators();
        this.refreshNow();
      };
      row.append(cb, h("span", "", IND_LABEL[k]));
      this.indMenu.append(row);
    });
    const closeMenu = () => this.indMenu.classList.remove("open");
    document.addEventListener("click", closeMenu);
    this.cleanups.push(() => document.removeEventListener("click", closeMenu));
    this.indMenu.onclick = (e) => e.stopPropagation();
    const wrap = h("div", "cx-menu-wrap");
    wrap.append(indBtn, this.indMenu);
    this.tvBtn.title = "Switch between the built-in chart and the full TradingView chart";
    this.tvBtn.onclick = () => this.toggleTv();
    this.bar.append(this.tvBtn, this.typeSel, this.scaleSel, wrap);
    host.append(this.tvBox);
    ["pointerdown", "wheel", "dblclick"].forEach((ev) =>
      this.bar.addEventListener(ev, (e) => e.stopPropagation()),
    );

    // Drawing tools go into the existing left rail (appended below the horizontal-line tool).
    const rail =
      (host
        .closest(".chart-workspace")
        ?.querySelector(".drawing-rail") as HTMLElement | null) || this.bar;
    const sep = h("div", "cx-rail-sep cx-rail-part");
    rail.append(sep);
    TOOLS.forEach((t) => {
      const b = h("button", "cx-tool cx-rail-part", t.icon);
      b.title = t.title;
      b.onclick = () => this.setTool(this.tool === t.kind ? null : t.kind);
      this.toolButtons.set(t.kind, b);
      rail.append(b);
    });
    const col = h("input", "cx-rail-part cx-color");
    col.type = "color";
    col.value = this.color;
    col.title = "Drawing color";
    col.oninput = () => (this.color = col.value);
    const undo = h("button", "cx-tool cx-rail-part", "↶");
    undo.title = "Remove last drawing";
    undo.onclick = () => {
      this.shapes.pop();
      this.measureShape = null;
      this.saveShapes();
      this.render(true);
    };
    const clear = h("button", "cx-tool cx-rail-part", "🗑");
    clear.title =
      "Clear all analysis drawings (horizontal lines are not affected)";
    clear.onclick = () => {
      this.shapes = [];
      this.measureShape = null;
      this.saveShapes();
      this.render(true);
    };
    rail.append(col, undo, clear);
  }

  private toggleTv() {
    this.tvOn = !this.tvOn;
    this.tvBtn.classList.toggle("on", this.tvOn);
    this.tvBox.classList.toggle("on", this.tvOn);
    if (this.tvOn) this.mountTv();
    else this.tvBox.replaceChildren();
  }
  private mountTv() {
    mountTradingView(this.tvBox, tvSymbol(this.symbol), tvInterval(barSpan(this.candles)));
  }

  private persist() {
    save(PREFS_KEY, this.prefs);
  }
  private saveShapes() {
    const all = load<Record<string, Shape[]>>(DRAW_KEY, {});
    all[this.symbol] = this.shapes;
    save(DRAW_KEY, all);
  }

  /* ---------- scale + type ---------- */
  private applyScale() {
    const mode =
      this.prefs.scale === "log"
        ? PriceScaleMode.Logarithmic
        : this.prefs.scale === "percent"
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    this.chart.priceScale("right").applyOptions({ mode });
    this.render(true);
  }

  private applyType() {
    if (this.alt) {
      try {
        this.chart.removeSeries(this.alt);
      } catch {}
      this.alt = null;
    }
    const t = this.prefs.type;
    if (t === "candles") {
      this.candle.applyOptions({
        upColor: UP,
        downColor: DN,
        borderUpColor: UP,
        borderDownColor: DN,
        wickUpColor: UP,
        wickDownColor: DN,
        lastValueVisible: true,
        priceLineVisible: true,
      });
      return;
    }
    // The original candlestick series stays (hline/alerts depend on it) but is made invisible.
    this.candle.applyOptions({
      upColor: CLEAR,
      downColor: CLEAR,
      borderUpColor: CLEAR,
      borderDownColor: CLEAR,
      wickUpColor: CLEAR,
      wickDownColor: CLEAR,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    if (t === "ha")
      this.alt = this.chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DN,
        borderUpColor: UP,
        borderDownColor: DN,
        wickUpColor: UP,
        wickDownColor: DN,
      });
    else if (t === "bars")
      this.alt = this.chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DN,
      });
    else if (t === "line")
      this.alt = this.chart.addSeries(LineSeries, {
        color: "#4aa3ff",
        lineWidth: 2,
      });
    else
      this.alt = this.chart.addSeries(AreaSeries, {
        lineColor: "#4aa3ff",
        topColor: "rgba(74,163,255,.35)",
        bottomColor: "rgba(74,163,255,0)",
        lineWidth: 2,
      });
  }

  private altData(): any[] {
    const t = this.prefs.type;
    if (t === "ha") return heikinAshi(this.candles);
    if (t === "line" || t === "area")
      return this.candles.map((c) => ({ time: c.time, value: c.close }));
    return this.candles.map(({ time, open, high, low, close }) => ({
      time,
      open,
      high,
      low,
      close,
    }));
  }

  /* ---------- indicators ---------- */
  private clearInd() {
    for (const k of Object.keys(this.ind) as IndKey[])
      (this.ind[k] || []).forEach((s) => {
        try {
          this.chart.removeSeries(s);
        } catch {}
      });
    this.ind = {};
  }

  private rebuildIndicators() {
    this.clearInd();
    const on = this.prefs.ind;
    const line = (color: string, pane = 0, width = 1) =>
      this.chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: width,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        },
        pane,
      );
    if (on.vol) {
      const s = this.chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "cx-vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      this.chart
        .priceScale("cx-vol")
        .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.ind.vol = [s];
    }
    if (on.sma20) this.ind.sma20 = [line("#f2b84b")];
    if (on.sma50) this.ind.sma50 = [line("#b388ff")];
    if (on.ema20) this.ind.ema20 = [line("#4aa3ff")];
    if (on.ema50) this.ind.ema50 = [line("#ff8a65")];
    if (on.bb)
      this.ind.bb = [line("#8aa0b8"), line("#8aa0b8"), line("#8aa0b8")];
    let pane = 1;
    if (on.rsi) {
      const s = line("#b388ff", pane, 2);
      s.createPriceLine({
        price: 70,
        color: "#556a85",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
      s.createPriceLine({
        price: 30,
        color: "#556a85",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
      this.ind.rsi = [s];
      pane++;
    }
    if (on.macd) {
      const hist = this.chart.addSeries(
        HistogramSeries,
        { lastValueVisible: false, priceLineVisible: false },
        pane,
      );
      this.ind.macd = [
        hist,
        line("#4aa3ff", pane, 2),
        line("#f2b84b", pane, 1),
      ];
      pane++;
    }
    try {
      const panes = this.chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
      }
    } catch {}
  }

  private fillIndicators() {
    const c = this.candles,
      I = this.ind;
    const set = (s: any, d: Pt[]) => s && s.setData(d);
    if (I.vol)
      I.vol[0].setData(
        c.map((x) => ({
          time: x.time,
          value: x.volume || 0,
          color:
            x.close >= x.open ? "rgba(0,201,167,.4)" : "rgba(240,100,112,.4)",
        })),
      );
    if (I.sma20) set(I.sma20[0], sma(c, 20));
    if (I.sma50) set(I.sma50[0], sma(c, 50));
    if (I.ema20) set(I.ema20[0], ema(c, 20));
    if (I.ema50) set(I.ema50[0], ema(c, 50));
    if (I.bb) {
      const b = bollinger(c, 20, 2);
      set(I.bb[0], b.upper);
      set(I.bb[1], b.middle);
      set(I.bb[2], b.lower);
    }
    if (I.rsi) set(I.rsi[0], rsi(c, 14));
    if (I.macd) {
      const m = macd(c);
      I.macd[0].setData(
        m.hist.map((p) => ({
          time: p.time,
          value: p.value,
          color: p.value >= 0 ? "rgba(0,201,167,.6)" : "rgba(240,100,112,.6)",
        })),
      );
      set(I.macd[1], m.macd);
      set(I.macd[2], m.signal);
    }
  }

  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.refreshNow();
    }, 250);
  }
  private refreshNow() {
    if (this.destroyed) return;
    try {
      if (this.alt) this.alt.setData(this.altData());
      this.fillIndicators();
    } catch {}
    this.updateLegend(null);
    this.render(true);
  }

  /* ---------- legend + countdown ---------- */
  private indexAt(time: number): number {
    const c = this.candles;
    let lo = 0,
      hi = c.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].time === time) return mid;
      if (c[mid].time < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private updateLegend(param: any) {
    const c = this.candles;
    if (!c.length) return;
    let i = c.length - 1;
    if (param?.time !== undefined) {
      const j = this.indexAt(Number(param.time));
      if (j >= 0) i = j;
    }
    const x = c[i],
      prev = i > 0 ? c[i - 1].close : x.open;
    const chg = x.close - prev,
      pct = prev ? (chg / prev) * 100 : 0,
      cls = chg >= 0 ? "cx-up" : "cx-dn";
    const o = this.legendOhlc.firstElementChild as HTMLElement;
    o.innerHTML =
      `<b>O</b> <i class="${cls}">${fmtPrice(x.open)}</i> <b>H</b> <i class="${cls}">${fmtPrice(x.high)}</i> ` +
      `<b>L</b> <i class="${cls}">${fmtPrice(x.low)}</i> <b>C</b> <i class="${cls}">${fmtPrice(x.close)}</i> ` +
      `<i class="${cls}">${chg >= 0 ? "+" : ""}${fmtPrice(chg)} (${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%)</i>` +
      (x.volume ? ` <b>Vol</b> <i>${fmtVol(x.volume)}</i>` : "");
    // indicator values at this bar
    const parts: string[] = [];
    const val = (k: IndKey, idx: number, f = fmtPrice) => {
      const s = this.ind[k]?.[idx];
      const d =
        param?.seriesData?.get(s) ?? (s ? s.data?.().at?.(-1) : undefined);
      const v = d?.value;
      return v === undefined || v === null ? null : f(Number(v));
    };
    const on = this.prefs.ind;
    const colors: Record<string, string> = {
      sma20: "#f2b84b",
      sma50: "#b388ff",
      ema20: "#4aa3ff",
      ema50: "#ff8a65",
      bb: "#8aa0b8",
      rsi: "#b388ff",
      macd: "#4aa3ff",
    };
    const add = (k: IndKey, label: string, idx = 0, f = fmtPrice) => {
      if (!on[k]) return;
      const v = val(k, idx, f);
      if (v !== null)
        parts.push(`<span style="color:${colors[k]}">${label} ${v}</span>`);
    };
    add("sma20", "SMA20");
    add("sma50", "SMA50");
    add("ema20", "EMA20");
    add("ema50", "EMA50");
    add("bb", "BB mid", 1);
    add("rsi", "RSI", 0, (n) => n.toFixed(2));
    add("macd", "MACD", 1, (n) => n.toFixed(4));
    this.legendInd.innerHTML = parts.join(" ");
  }

  private tickCountdown() {
    const c = this.candles;
    if (!c.length) return (this.countdown.textContent = "");
    const span = barSpan(c);
    const left = c[c.length - 1].time + span - Date.now() / 1000;
    this.countdown.textContent = "⏱ " + fmtCountdown(left);
  }

  /* ---------- events ---------- */
  private hookEvents() {
    const onMove = (p: any) => this.updateLegend(p);
    this.chart.subscribeCrosshairMove(onMove);
    this.cleanups.push(() => this.chart.unsubscribeCrosshairMove(onMove));
    const timer = window.setInterval(() => this.tickCountdown(), 1000);
    this.cleanups.push(() => window.clearInterval(timer));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.setTool(null);
    };
    window.addEventListener("keydown", onKey);
    this.cleanups.push(() => window.removeEventListener("keydown", onKey));

    const c = this.catcher;
    c.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.tool) return;
      const pt = this.pointFromEvent(e);
      if (!pt) return;
      if (this.tool === "vline") return this.commit({ kind: "vline", a: pt });
      if (!this.draft) {
        this.measureShape = null;
        this.draft = { kind: this.tool, a: pt, b: pt };
        this.render(true);
      } else {
        this.commit({ ...this.draft, b: pt });
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.draft) return;
      const pt = this.pointFromEvent(e);
      if (pt) {
        this.draft.b = pt;
        this.render(true);
      }
    });
    c.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  }

  private setTool(k: Kind | null) {
    this.tool = k;
    this.draft = null;
    this.catcher.classList.toggle("on", !!k);
    this.toolButtons.forEach((b, kind) =>
      b.classList.toggle("selected", kind === k),
    );
    this.render(true);
  }

  private pointFromEvent(e: PointerEvent): P | null {
    const r = this.host.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    const logical = this.chart.timeScale().coordinateToLogical(x);
    const price = this.candle.coordinateToPrice(y);
    if (logical == null || price == null || !this.candles.length) return null;
    return {
      time: indexToTime(this.candles, barSpan(this.candles), Number(logical)),
      price: Number(price),
    };
  }

  private commit(s: { kind: Kind; a: P; b?: P }) {
    if (s.kind === "measure") this.measureShape = { a: s.a, b: s.b as P };
    else {
      this.shapes.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        kind: s.kind,
        a: s.a,
        b: s.b,
        color: this.color,
      });
      this.saveShapes();
    }
    this.setTool(null);
  }

  /* ---------- drawing overlay ---------- */
  private loop = () => {
    if (this.destroyed) return;
    this.render(false);
    this.raf = requestAnimationFrame(this.loop);
  };

  private xy(p: P): { x: number; y: number } | null {
    const span = barSpan(this.candles);
    const x = this.chart
      .timeScale()
      .logicalToCoordinate(timeToIndex(this.candles, span, p.time));
    const y = this.candle.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }

  private render(force: boolean) {
    if (!this.candles.length) return;
    const ts = this.chart.timeScale();
    const w = ts.width?.() ?? this.host.clientWidth,
      hgt = this.host.clientHeight;
    const sig = [
      ts.logicalToCoordinate(0),
      ts.logicalToCoordinate(50),
      this.candle.coordinateToPrice(0),
      this.candle.coordinateToPrice(300),
      w,
      hgt,
      this.candles.length,
    ].join("|");
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    const svg = this.svg;
    svg.replaceChildren();
    svg.setAttribute("width", String(this.host.clientWidth));
    svg.setAttribute("height", String(hgt));
    const list: { kind: Kind; a: P; b?: P; color: string; draft?: boolean }[] =
      [...this.shapes];
    if (this.measureShape)
      list.push({ kind: "measure", ...this.measureShape, color: "#4aa3ff" });
    if (this.draft)
      list.push({ ...this.draft, color: this.color, draft: true });
    for (const s of list) this.drawShape(svg, s, w, hgt);
  }

  private drawShape(
    svg: SVGSVGElement,
    s: { kind: Kind; a: P; b?: P; color: string; draft?: boolean },
    w: number,
    hgt: number,
  ) {
    const A = this.xy(s.a),
      B = s.b ? this.xy(s.b) : null;
    if (!A) return;
    const dash = s.draft ? "5 4" : "";
    const line = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color = s.color,
      width = 1.5,
      d = dash,
    ) =>
      svg.append(
        svgEl("line", {
          x1,
          y1,
          x2,
          y2,
          stroke: color,
          "stroke-width": width,
          "stroke-dasharray": d,
        }),
      );
    const label = (
      x: number,
      y: number,
      text: string,
      color = s.color,
      anchor = "start",
    ) => {
      const t = svgEl("text", {
        x,
        y,
        fill: color,
        "font-size": 11,
        "text-anchor": anchor,
        class: "cx-svg-text",
      });
      t.textContent = text;
      svg.append(t);
    };
    if (s.kind === "vline") return line(A.x, 0, A.x, hgt);
    if (!B) return;
    if (s.kind === "trend") {
      line(A.x, A.y, B.x, B.y);
      svg.append(svgEl("circle", { cx: A.x, cy: A.y, r: 3, fill: s.color }));
      svg.append(svgEl("circle", { cx: B.x, cy: B.y, r: 3, fill: s.color }));
    } else if (s.kind === "ray") {
      const E = extendRay(A, B, w);
      line(A.x, A.y, E.x, E.y);
      svg.append(svgEl("circle", { cx: A.x, cy: A.y, r: 3, fill: s.color }));
    } else if (s.kind === "rect") {
      svg.append(
        svgEl("rect", {
          x: Math.min(A.x, B.x),
          y: Math.min(A.y, B.y),
          width: Math.abs(B.x - A.x),
          height: Math.abs(B.y - A.y),
          fill: s.color,
          "fill-opacity": 0.12,
          stroke: s.color,
          "stroke-width": 1.5,
          "stroke-dasharray": dash,
        }),
      );
    } else if (s.kind === "fib" && s.b) {
      const x1 = Math.min(A.x, B.x),
        x2 = Math.max(A.x, B.x);
      line(A.x, A.y, B.x, B.y, "#6b7f99", 1, "4 4");
      fibLevels.forEach((lv, i) => {
        const price = s.b!.price + (s.a.price - s.b!.price) * lv;
        const y = this.candle.priceToCoordinate(price);
        if (y == null) return;
        line(x1, Number(y), x2, Number(y), FIB_COLORS[i], 1, "");
        label(
          x1 + 4,
          Number(y) - 3,
          `${lv} (${fmtPrice(price)})`,
          FIB_COLORS[i],
        );
      });
    } else if (s.kind === "measure" && s.b) {
      const m = measure(
        {
          index: timeToIndex(this.candles, barSpan(this.candles), s.a.time),
          price: s.a.price,
        },
        {
          index: timeToIndex(this.candles, barSpan(this.candles), s.b.time),
          price: s.b.price,
        },
      );
      const up = m.dPrice >= 0,
        col = up ? UP : DN;
      svg.append(
        svgEl("rect", {
          x: Math.min(A.x, B.x),
          y: Math.min(A.y, B.y),
          width: Math.abs(B.x - A.x),
          height: Math.abs(B.y - A.y),
          fill: col,
          "fill-opacity": 0.14,
          stroke: col,
          "stroke-width": 1,
        }),
      );
      line(A.x, A.y, B.x, B.y, col, 1.5, "");
      const text = `${up ? "+" : ""}${fmtPrice(m.dPrice)} (${up ? "+" : ""}${m.pct.toFixed(2)}%) · ${m.bars} bars`;
      const bx = (A.x + B.x) / 2,
        by = up ? Math.min(A.y, B.y) - 8 : Math.max(A.y, B.y) + 16;
      label(bx, by, text, col, "middle");
    }
  }
}

export const attachChartX = (chart: any, candle: any, host: HTMLElement) =>
  new ChartX(chart, candle, host);
