/* Talking 3D head. You give it one photo of yourself, frame your face and mark your mouth; it wraps the face on a curved
   3D mesh (raw WebGL) that turns, breathes and opens its jaw while an alert is being spoken.
   The photo is stored ONLY in this browser (localStorage) and is never uploaded anywhere. */
import React, { useCallback, useEffect, useRef, useState } from "react";

type PE = any;
export type AvatarData = { img: string; mx: number; my: number };
const KEY = "arcus.avatar.v1", POS = "arcus.avatar.pos.v1", MIN = "arcus.avatar.min.v1";
export const getAvatar = (): AvatarData | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && typeof v.img === "string" ? v : null;
  } catch {
    return null;
  }
};
const saveAvatar = (d: AvatarData | null) => {
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event("arcus:avatar-changed"));
};
export const openAvatarSetup = () => window.dispatchEvent(new Event("arcus:avatar-setup"));
export type SpeakEvent = { on: boolean; text?: string };
export const emitSpeaking = (d: SpeakEvent) => window.dispatchEvent(new CustomEvent("arcus:speaking", { detail: d }));
export const emitPulse = () => window.dispatchEvent(new Event("arcus:pulse"));

/* ---------------- tiny matrix helpers ---------------- */
const persp = (f: number, a: number, n: number, fa: number) => {
  const t = 1 / Math.tan(f / 2), r = 1 / (n - fa);
  return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + fa) * r, -1, 0, 0, 2 * n * fa * r, 0];
};
const mul = (a: number[], b: number[]) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const rotY = (t: number) => [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1];
const rotX = (t: number) => [1, 0, 0, 0, 0, Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1];
const trans = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

const VS = `
precision mediump float;
attribute vec2 aPos; attribute vec2 aUv;
uniform mat4 uMVP; uniform float uJaw; uniform vec2 uMouth;
varying vec2 vUv; varying vec3 vN; varying vec2 vP0;
void main(){
  vec2 p = aPos;
  float r2 = p.x*p.x*0.82 + p.y*p.y*0.66;
  float s = sqrt(max(0.04, 1.0 - r2));
  float z = s * 0.62;
  vec3 n = normalize(vec3(p.x*0.82*0.62/s, p.y*0.66*0.62/s, 1.0));
  float below = smoothstep(uMouth.y + 0.04, uMouth.y - 0.34, p.y);
  float side = 1.0 - smoothstep(0.30, 0.95, abs(p.x - uMouth.x));
  float mv = uJaw * 0.2 * below * side;
  p.y -= mv; z += mv * 0.25;
  vUv = aUv; vN = n; vP0 = aPos;
  gl_Position = uMVP * vec4(p, z, 1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uJaw; uniform vec2 uMouth;
varying vec2 vUv; varying vec3 vN; varying vec2 vP0;
void main(){
  vec4 c = texture2D(uTex, vUv);
  float d = length(vec2(vP0.x * 0.97, vP0.y * 0.93));
  float a = 1.0 - smoothstep(0.84, 1.0, d);
  float l = 0.78 + 0.32 * dot(normalize(vN), normalize(vec3(-0.35, 0.45, 0.8)));
  vec3 col = c.rgb * l;
  vec2 q = vP0 - vec2(uMouth.x, uMouth.y - uJaw * 0.05);
  float ry = 0.005 + uJaw * 0.074;
  float e = length(vec2(q.x / 0.125, q.y / ry));
  float cav = (1.0 - smoothstep(0.55, 1.0, e)) * smoothstep(0.05, 0.25, uJaw) * 0.92;
  vec3 inner = mix(vec3(0.17, 0.05, 0.05), vec3(0.03, 0.008, 0.01), smoothstep(0.0, 0.8, 1.0 - e));
  float teeth = smoothstep(0.35, 0.0, abs(q.y - ry * 0.55)) * smoothstep(0.9, 0.4, e) * smoothstep(0.25, 0.7, uJaw);
  inner = mix(inner, vec3(0.78, 0.74, 0.68) * l, teeth * 0.3);
  col = mix(col, inner, cav);
  gl_FragColor = vec4(col * a, a);
}`;

function setupGl(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  const sh = (t: number, s: string) => {
    const o = gl.createShader(t)!;
    gl.shaderSource(o, s);
    gl.compileShader(o);
    return o;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.warn("avatar shader:", gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const N = 44;
  const v: number[] = [], idx: number[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = (i / N) * 2 - 1, y = 1 - (j / N) * 2;
    v.push(x, y, i / N, j / N);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(pr, "aPos"), aUv = gl.getAttribLocation(pr, "aUv");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const U = (n: string) => gl.getUniformLocation(pr, n);
  return { gl, n: idx.length, mvp: U("uMVP"), jaw: U("uJaw"), mouth: U("uMouth") };
}

export function AvatarHead() {
  const [data, setData] = useState<AvatarData | null>(() => getAvatar());
  const [setup, setSetup] = useState(false);
  const [text, setText] = useState("");
  const [talking, setTalking] = useState(false);
  const [min, setMin] = useState(() => localStorage.getItem(MIN) === "1");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS) || "null");
    } catch {
      return null;
    }
  });
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useRef({ talking: false, amp: 0, jaw: 0, mx: 0, my: 0, yaw: 0, pitch: 0 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const ch = () => setData(getAvatar());
    const op = () => setSetup(true);
    const sp = (e: Event) => {
      const d = (e as CustomEvent<SpeakEvent>).detail;
      st.current.talking = d.on;
      setTalking(d.on);
      if (d.on) setText(d.text || "");
      else window.setTimeout(() => !st.current.talking && setText(""), 2500);
    };
    const pu = () => (st.current.amp = 1);
    const mv = (e: PointerEvent) => {
      st.current.mx = (e.clientX / window.innerWidth) * 2 - 1;
      st.current.my = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("arcus:avatar-changed", ch);
    window.addEventListener("arcus:avatar-setup", op);
    window.addEventListener("arcus:speaking", sp);
    window.addEventListener("arcus:pulse", pu);
    window.addEventListener("pointermove", mv);
    return () => {
      window.removeEventListener("arcus:avatar-changed", ch);
      window.removeEventListener("arcus:avatar-setup", op);
      window.removeEventListener("arcus:speaking", sp);
      window.removeEventListener("arcus:pulse", pu);
      window.removeEventListener("pointermove", mv);
    };
  }, []);

  useEffect(() => {
    if (!data || min || !cv.current) return;
    const canvas = cv.current;
    let raf = 0, alive = true;
    const img = new Image();
    img.onload = () => {
      const g = setupGl(canvas, img);
      if (!g || !alive) return;
      const { gl } = g;
      const mouth = [data.mx * 2 - 1, 1 - data.my * 2];
      const t0 = performance.now();
      let last = t0;
      const frame = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        const s = st.current, t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        s.amp = Math.max(0, s.amp - dt * 3.2);
        const talk = s.talking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 11.5 + Math.sin(t * 3.1) * 2)) * (0.55 + 0.45 * Math.min(1, s.amp + 0.4)) : 0;
        s.jaw += (talk - s.jaw) * Math.min(1, dt * 18);
        s.yaw += (s.mx * 0.42 + Math.sin(t * 0.8) * 0.06 + (s.talking ? Math.sin(t * 2.3) * 0.08 : 0) - s.yaw) * Math.min(1, dt * 4);
        s.pitch += (s.my * 0.22 + Math.sin(t * 1.1) * 0.03 + (s.talking ? Math.sin(t * 5) * 0.035 : 0) - s.pitch) * Math.min(1, dt * 4);
        const breathe = 1 + Math.sin(t * 1.6) * 0.012;
        const m = mul(persp(0.62, 1, 0.1, 20), mul(trans(0, 0, -3.3), mul(rotX(s.pitch), mul(rotY(s.yaw), [breathe, 0, 0, 0, 0, breathe, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniformMatrix4fv(g.mvp, false, new Float32Array(m));
        gl.uniform1f(g.jaw, s.jaw);
        gl.uniform2f(g.mouth, mouth[0], mouth[1]);
        gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
      };
      raf = requestAnimationFrame(frame);
    };
    img.src = data.img;
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [data, min]);

  const place = pos || { x: -1, y: 70 };
  const onDown = (e: PE) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PE) => {
    if (!drag.current) return;
    setPos({ x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - drag.current.dy)) });
  };
  const onUp = () => {
    if (drag.current && pos) {
      try {
        localStorage.setItem(POS, JSON.stringify(pos));
      } catch {}
    }
    drag.current = null;
  };
  const toggleMin = () => {
    const n = !min;
    setMin(n);
    try {
      localStorage.setItem(MIN, n ? "1" : "0");
    } catch {}
  };

  return (
    <>
      {data && (
        <div
          className={"av-wrap" + (talking ? " talking" : "") + (min ? " min" : "")}
          style={place.x < 0 ? { top: place.y, right: 14 } : { top: place.y, left: place.x }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          role="img"
          aria-label="Talking agent"
        >
          {!min && <canvas ref={cv} width={300} height={300} className="av-cv" />}
          {min && <img className="av-thumb" src={data.img} alt="" />}
          <div className="av-btns">
            <button onClick={toggleMin} title={min ? "Expand" : "Minimise"} aria-label="Minimise">{min ? "▢" : "–"}</button>
            {!min && <button onClick={() => setSetup(true)} title="Change my photo" aria-label="Change photo">✎</button>}
          </div>
          {!min && text && <div className="av-say" dir="auto">{text}</div>}
        </div>
      )}
      {setup && <AvatarSetup onClose={() => setSetup(false)} />}
    </>
  );
}

/* ---------------- photo framing dialog ---------------- */
const S = 320;
export function AvatarSetup({ onClose }: { onClose: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [mouth, setMouth] = useState<{ x: number; y: number } | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fa = localStorage.getItem("arcus.news.lang") === "fa";
  const T = (en: string, f: string) => (fa ? f : en);

  const base = img ? S / Math.min(img.width, img.height) : 1;
  const draw = useCallback(() => {
    const c = cv.current;
    if (!c || !img) return;
    const x = c.getContext("2d")!;
    x.fillStyle = "#06121f";
    x.fillRect(0, 0, S, S);
    const sc = base * zoom;
    x.drawImage(img, off.x, off.y, img.width * sc, img.height * sc);
  }, [img, off, zoom, base]);
  useEffect(draw, [draw]);

  const load = (f?: File) => {
    if (!f) return;
    const u = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      setZoom(1);
      setOff({ x: (S - i.width * (S / Math.min(i.width, i.height))) / 2, y: (S - i.height * (S / Math.min(i.width, i.height))) / 2 });
      setStep(1);
      setMouth(null);
    };
    i.src = u;
  };
  const setZ = (z: number) => {
    // zoom around the centre of the frame
    const sc0 = base * zoom, sc1 = base * z, cx = (S / 2 - off.x) / sc0, cy = (S / 2 - off.y) / sc0;
    setOff({ x: S / 2 - cx * sc1, y: S / 2 - cy * sc1 });
    setZoom(z);
  };
  const save = () => {
    if (!img || !mouth) return;
    const o = document.createElement("canvas");
    o.width = o.height = 512;
    const x = o.getContext("2d")!;
    const k = 512 / S, sc = base * zoom * k;
    x.drawImage(img, off.x * k, off.y * k, img.width * sc, img.height * sc);
    saveAvatar({ img: o.toDataURL("image/jpeg", 0.9), mx: mouth.x / S, my: mouth.y / S });
    onClose();
  };
  const pt = (e: PE) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
  };

  return (
    <div className="av-modal" role="dialog" aria-modal="true" aria-label="Create my avatar" dir={fa ? "rtl" : "ltr"}>
      <div className="av-card">
        <button className="av-close" onClick={onClose} aria-label="Close">✕</button>
        <h3>{T("Make my talking avatar", "ساخت آواتار سخنگوی من")}</h3>
        <p className="muted">{T("Your photo is stored only in this browser. It is never uploaded.", "عکس فقط داخل همین مرورگر ذخیره می‌شود و جایی آپلود نمی‌شود.")}</p>
        {!img && (
          <label className="av-pick">
            <input type="file" accept="image/*" onChange={(e) => load(e.target.files?.[0])} />
            <span>📷 {T("Choose a photo of your face", "انتخاب یک عکس از صورتت")}</span>
          </label>
        )}
        {img && (
          <>
            <p className="av-step">{step === 1 ? T("1 of 2 · Drag the photo and zoom so your face fills the oval (hair to chin).", "۱ از ۲ · عکس را بکش و زوم کن تا صورتت (از مو تا چانه) داخل بیضی بیفتد.") : T("2 of 2 · Tap the middle of your lips.", "۲ از ۲ · روی وسط لب‌هایت بزن.")}</p>
            <div
              className="av-frame"
              style={{ width: S, height: S, cursor: step === 1 ? "grab" : "crosshair" }}
              onPointerDown={(e) => {
                if (step === 2) return setMouth(pt(e));
                drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => drag.current && setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })}
              onPointerUp={() => (drag.current = null)}
              onWheel={(e) => step === 1 && setZ(Math.max(1, Math.min(5, zoom * (e.deltaY < 0 ? 1.06 : 0.94))))}
            >
              <canvas ref={cv} width={S} height={S} />
              <svg viewBox={"0 0 " + S + " " + S} width={S} height={S}>
                <defs><mask id="avm"><rect width={S} height={S} fill="#fff" /><ellipse cx={S / 2} cy={S / 2} rx={S * 0.47} ry={S * 0.5} fill="#000" /></mask></defs>
                <rect width={S} height={S} fill="rgba(5,12,22,.62)" mask="url(#avm)" />
                <ellipse cx={S / 2} cy={S / 2} rx={S * 0.47} ry={S * 0.5} fill="none" stroke="#00dcd2" strokeWidth="1.5" strokeDasharray="5 4" />
                {mouth && <g stroke="#ff5c5c" strokeWidth="2"><line x1={mouth.x - 12} x2={mouth.x + 12} y1={mouth.y} y2={mouth.y} /><line x1={mouth.x} x2={mouth.x} y1={mouth.y - 12} y2={mouth.y + 12} /></g>}
              </svg>
            </div>
            {step === 1 && <input className="av-zoom" type="range" min="1" max="5" step="0.01" value={zoom} onChange={(e) => setZ(Number(e.target.value))} aria-label="Zoom" />}
            <div className="av-actions">
              {step === 2 && <button className="secondary" onClick={() => setStep(1)}>{T("Back", "بازگشت")}</button>}
              <label className="secondary av-again">{T("Other photo", "عکس دیگر")}<input type="file" accept="image/*" onChange={(e) => load(e.target.files?.[0])} /></label>
              {getAvatar() && <button className="secondary" onClick={() => { saveAvatar(null); onClose(); }}>{T("Remove avatar", "حذف آواتار")}</button>}
              {step === 1 ? <button onClick={() => setStep(2)}>{T("Next", "بعدی")}</button> : <button disabled={!mouth} onClick={save}>{T("Save", "ذخیره")}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
