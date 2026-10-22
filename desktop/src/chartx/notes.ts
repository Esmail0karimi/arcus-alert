/* Text notes on the chart: place, edit, drag, recolour, resize, delete. Stored per symbol (localStorage). */
import { Candle, barSpan } from "./math";
import { indexToTime, timeToIndex } from "./geometry";

const KEY = "arcus.chartx.notes.v1";
type Note = {
  id: string;
  time: number;
  price: number;
  text: string;
  color: string;
  size: number;
};

const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
};
const btn = (text: string, title: string, cls = "") => {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  if (cls) b.className = cls;
  return b;
};

export class NotesLayer {
  private notes: Note[] = [];
  private symbol = "";
  private selected: string | null = null;
  private placing = false;
  private drag: { id: string; moved: boolean } | null = null;
  private dirty = true;
  private lastSig = "";
  private boxes = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  private cleanups: (() => void)[] = [];
  private editing = false;
  private color = "#f2b84b";

  private svg = svgEl("svg", { class: "cx-svg cx-notes" }) as SVGSVGElement;
  private catcher = document.createElement("div");
  private pop = document.createElement("div");
  private popColor = document.createElement("input");

  constructor(
    private chart: any,
    private candle: any,
    private host: HTMLElement,
    private getCandles: () => Candle[],
    private onSelected: () => void,
  ) {
    this.catcher.className = "cx-catcher cx-text-catcher";
    this.pop.className = "line-actions cx-npop";
    this.pop.style.display = "none";
    this.popColor.type = "color";
    this.popColor.title = "Text colour";
    this.popColor.oninput = () => this.patch({ color: this.popColor.value });
    const smaller = btn("A−", "Smaller text"),
      bigger = btn("A+", "Bigger text"),
      edit = btn("✎", "Edit text"),
      del = btn("🗑", "Delete text (Del)", "danger");
    smaller.onclick = () =>
      this.patch({ size: Math.max(8, (this.sel()?.size || 14) - 2) });
    bigger.onclick = () =>
      this.patch({ size: Math.min(64, (this.sel()?.size || 14) + 2) });
    edit.onclick = () => this.editSelected();
    del.onclick = () => this.deleteSelected();
    this.pop.append(this.popColor, smaller, bigger, edit, del);
    ["pointerdown", "pointerup", "click", "dblclick"].forEach((ev) =>
      this.pop.addEventListener(ev, (e) => e.stopPropagation()),
    );
    host.append(this.svg, this.catcher, this.pop);

    // Registered before ChartX's own listeners so a hit on a note wins over lines underneath.
    const onDown = (e: PointerEvent) => {
      if (this.editing || this.placing) return;
      if (
        (e.target as HTMLElement)?.closest?.(
          ".cx-bar,.line-actions,.cx-note-input",
        )
      )
        return;
      const r = host.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      if (!hit) {
        if (this.selected) this.select(null);
        return;
      }
      e.stopImmediatePropagation();
      e.preventDefault();
      this.select(hit);
      this.drag = { id: hit, moved: false };
      this.onSelected();
    };
    const onMove = (e: PointerEvent) => {
      if (!this.drag) return;
      const n = this.notes.find((x) => x.id === this.drag!.id);
      const p = this.point(e.clientX, e.clientY);
      if (!n || !p) return;
      this.drag.moved = true;
      n.time = p.time;
      n.price = p.price;
      this.dirty = true;
    };
    const onUp = (e: PointerEvent) => {
      if (!this.drag) return;
      e.stopImmediatePropagation();
      if (this.drag.moved) this.persist();
      this.drag = null;
    };
    const onDbl = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      const hit = this.hit(e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        e.stopImmediatePropagation();
        this.select(hit);
        this.editSelected();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        this.setPlacing(false);
        this.select(null);
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        this.selected
      ) {
        e.preventDefault();
        this.deleteSelected();
      }
    };
    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, true);
    host.addEventListener("dblclick", onDbl, true);
    window.addEventListener("keydown", onKey);
    this.cleanups.push(() => {
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp, true);
      host.removeEventListener("dblclick", onDbl, true);
      window.removeEventListener("keydown", onKey);
    });
    this.catcher.addEventListener("mousedown", (e) => e.preventDefault());
    this.catcher.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.placing) return;
      const p = this.point(e.clientX, e.clientY);
      if (!p) return;
      const r = host.getBoundingClientRect();
      this.setPlacing(false);
      this.openEditor(null, p, e.clientX - r.left, e.clientY - r.top, "");
    });
  }

  /* ---------- public ---------- */
  setSymbol(symbol: string) {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      this.notes = Array.isArray(all[symbol]) ? all[symbol] : [];
    } catch {
      this.notes = [];
    }
    this.selected = null;
    this.dirty = true;
  }
  setPlacing(on: boolean) {
    this.placing = on;
    this.catcher.classList.toggle("on", on);
    this.onPlacing?.(on);
  }
  onPlacing?: (on: boolean) => void;
  deselect() {
    if (this.selected) this.select(null);
  }
  isBusy() {
    return this.placing || this.editing;
  }
  destroy() {
    this.cleanups.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
    [this.svg, this.catcher, this.pop].forEach((el) => el.remove());
    this.host.querySelectorAll(".cx-note-input").forEach((el) => el.remove());
  }

  /** Called every animation frame by ChartX; only redraws when the view or the notes changed. */
  tick() {
    const ts = this.chart.timeScale();
    const sig = [
      ts.logicalToCoordinate(0),
      ts.logicalToCoordinate(50),
      this.candle.coordinateToPrice(0),
      this.candle.coordinateToPrice(300),
      this.host.clientWidth,
      this.host.clientHeight,
    ].join("|");
    if (!this.dirty && sig === this.lastSig) return;
    this.lastSig = sig;
    this.dirty = false;
    this.render();
  }

  /* ---------- internals ---------- */
  private sel() {
    return this.notes.find((n) => n.id === this.selected);
  }
  private select(id: string | null) {
    this.selected = id;
    const n = this.sel();
    if (n) this.popColor.value = n.color;
    this.dirty = true;
  }
  private patch(p: Partial<Note>) {
    const n = this.sel();
    if (!n) return;
    Object.assign(n, p);
    this.persist();
    this.dirty = true;
  }
  private persist() {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || "{}");
      all[this.symbol] = this.notes;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }
  private deleteSelected() {
    if (!this.selected) return;
    this.notes = this.notes.filter((n) => n.id !== this.selected);
    this.selected = null;
    this.persist();
    this.dirty = true;
  }
  private point(clientX: number, clientY: number) {
    const c = this.getCandles();
    const r = this.host.getBoundingClientRect();
    const logical = this.chart
      .timeScale()
      .coordinateToLogical(clientX - r.left);
    const price = this.candle.coordinateToPrice(clientY - r.top);
    if (logical == null || price == null || !c.length) return null;
    return {
      time: indexToTime(c, barSpan(c), Number(logical)),
      price: Number(price),
    };
  }
  private xy(n: Note) {
    const c = this.getCandles();
    if (!c.length) return null;
    const x = this.chart
      .timeScale()
      .logicalToCoordinate(timeToIndex(c, barSpan(c), n.time));
    const y = this.candle.priceToCoordinate(n.price);
    return x == null || y == null ? null : { x: Number(x), y: Number(y) };
  }
  private hit(px: number, py: number): string | null {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const b = this.boxes.get(this.notes[i].id);
      if (
        b &&
        px >= b.x - 4 &&
        px <= b.x + b.w + 4 &&
        py >= b.y - 4 &&
        py <= b.y + b.h + 4
      )
        return this.notes[i].id;
    }
    return null;
  }
  private editSelected() {
    const n = this.sel();
    const pos = n && this.xy(n);
    if (!n || !pos) return;
    this.openEditor(n, { time: n.time, price: n.price }, pos.x, pos.y, n.text);
  }

  private openEditor(
    existing: Note | null,
    p: { time: number; price: number },
    x: number,
    y: number,
    value: string,
  ) {
    this.editing = true;
    const size = existing?.size || 14;
    const input = document.createElement("input");
    input.className = "cx-note-input";
    input.value = value;
    input.placeholder = "Type text…";
    input.style.cssText = `left:${Math.max(2, x)}px;top:${Math.max(2, y - size - 4)}px;font-size:${size}px;color:${existing?.color || this.color}`;
    this.host.append(input);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      this.editing = false;
      if (commit) {
        if (existing) {
          if (text) existing.text = text;
          else this.notes = this.notes.filter((n) => n.id !== existing.id);
        } else if (text) {
          const n: Note = {
            id: Date.now().toString(36),
            time: p.time,
            price: p.price,
            text,
            color: this.color,
            size: 14,
          };
          this.notes.push(n);
          this.select(n.id);
          this.onSelected();
        }
        this.persist();
      }
      this.dirty = true;
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    const openedAt = Date.now();
    input.addEventListener("blur", () => {
      // ignore the blur caused by the click that opened the editor
      if (Date.now() - openedAt < 250)
        setTimeout(() => !done && input.focus(), 0);
      else finish(true);
    });
    ["pointerdown", "pointerup", "click", "dblclick"].forEach((ev) =>
      input.addEventListener(ev, (e) => e.stopPropagation()),
    );
    setTimeout(() => {
      input.focus();
      input.select();
    }, 30);
  }

  private render() {
    this.svg.replaceChildren();
    this.svg.setAttribute("width", String(this.host.clientWidth));
    this.svg.setAttribute("height", String(this.host.clientHeight));
    this.boxes.clear();
    this.pop.style.display = "none";
    for (const n of this.notes) {
      const pos = this.xy(n);
      if (!pos) continue;
      const t = svgEl("text", {
        x: pos.x,
        y: pos.y,
        fill: n.color,
        "font-size": n.size,
        "font-weight": 600,
        class: "cx-svg-text",
      });
      t.textContent = n.text;
      this.svg.append(t);
      let bb = {
        x: pos.x,
        y: pos.y - n.size,
        width: n.text.length * n.size * 0.6,
        height: n.size * 1.3,
      };
      try {
        const m = (t as unknown as SVGGraphicsElement).getBBox();
        if (m.width) bb = m;
      } catch {}
      this.boxes.set(n.id, { x: bb.x, y: bb.y, w: bb.width, h: bb.height });
      if (n.id === this.selected) {
        this.svg.append(
          svgEl("rect", {
            x: bb.x - 3,
            y: bb.y - 2,
            width: bb.width + 6,
            height: bb.height + 4,
            fill: "none",
            stroke: "#4aa3ff",
            "stroke-dasharray": "4 3",
          }),
        );
        this.pop.style.display = "flex";
        this.pop.style.right = "auto";
        this.pop.style.left =
          Math.max(4, Math.min(bb.x, this.host.clientWidth - 230)) + "px";
        this.pop.style.top = Math.max(4, bb.y - 40) + "px";
      }
    }
  }
}
