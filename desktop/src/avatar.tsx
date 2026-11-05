/* The Agent's talking head: a fixed 3D trading robot (raw WebGL, no images, nothing to upload).
   It breathes, follows the pointer, blinks, and while an alert is being spoken its mouth is a bar equaliser and its antenna flashes. */
import React, { useEffect, useRef, useState } from "react";

export type SpeakEvent = { on: boolean; text?: string };
export const emitSpeaking = (d: SpeakEvent) => window.dispatchEvent(new CustomEvent("arcus:speaking", { detail: d }));
export const emitPulse = () => window.dispatchEvent(new Event("arcus:pulse"));
type PE = any;

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
const mat3 = (m: number[]) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];

/* ---------------- geometry: superellipsoids (box ↔ sphere ↔ cylinder) ---------------- */
const sp = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
function superellipsoid(e1: number, e2: number, nu = 36, nv = 24) {
  const v: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const b = -Math.PI / 2 + (j / nv) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const a = -Math.PI + (i / nu) * Math.PI * 2;
      const cb = Math.cos(b), sb = Math.sin(b), ca = Math.cos(a), sa = Math.sin(a);
      const x = sp(cb, e1) * sp(ca, e2), y = sp(sb, e1), z = sp(cb, e1) * sp(sa, e2);
      let nx = sp(cb, 2 - e1) * sp(ca, 2 - e2), ny = sp(sb, 2 - e1), nz = sp(cb, 2 - e1) * sp(sa, 2 - e2);
      const l = Math.hypot(nx, ny, nz) || 1;
      v.push(x, y, z, nx / l, ny / l, nz / l);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  return { v: new Float32Array(v), idx: new Uint16Array(idx) };
}

const VS = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aN;
uniform mat4 uMVP; uniform mat3 uRot; uniform vec3 uOff; uniform vec3 uScl;
varying vec3 vL; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 p = aPos * uScl + uOff;
  vL = aPos;
  vN = normalize(uRot * (aN / uScl));
  vW = p;
  gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS = `
precision mediump float;
uniform int uMat; uniform float uJaw; uniform float uTime; uniform float uOpen; uniform float uTalk; uniform float uAmp;
varying vec3 vL; varying vec3 vN; varying vec3 vW;
float box(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main(){
  vec3 N = normalize(vN);
  vec3 L1 = normalize(vec3(-0.45, 0.65, 0.75)), L2 = normalize(vec3(0.7, -0.2, 0.4));
  float dif = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.25 + 0.22;
  float rim = pow(1.0 - max(N.z, 0.0), 2.6);
  float spec = pow(max(dot(reflect(-L1, N), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  vec3 col;
  if (uMat == 1) {
    // visor glass with eyes and an equaliser mouth
    vec2 p = vL.xy;
    col = mix(vec3(0.015, 0.04, 0.09), vec3(0.03, 0.11, 0.19), p.y * 0.5 + 0.5);
    col *= 0.9 + 0.1 * sin(p.y * 80.0 + uTime * 2.0);
    for (int s = 0; s < 2; s++) {
      float sx = s == 0 ? -1.0 : 1.0;
      vec2 q = p - vec2(sx * 0.42, 0.36);
      float d = box(q, vec2(0.19, 0.15 * max(uOpen, 0.08)), 0.06);
      col += vec3(0.05, 0.95, 0.9) * (smoothstep(0.012, -0.012, d) * 0.95 + exp(-max(d, 0.0) * 14.0) * 0.35);
    }
    float cell = floor((p.x + 0.76) / 0.19);
    if (cell >= 0.0 && cell < 8.0) {
      float cx = -0.76 + (cell + 0.5) * 0.19;
      float h = 0.035 + uTalk * (0.05 + 0.34 * (0.5 + 0.5 * sin(uTime * (7.0 + cell * 2.3) + cell * 1.9)) * (0.45 + 0.55 * uAmp));
      float d = box(vec2(p.x - cx, p.y + 0.46), vec2(0.062, h), 0.025);
      vec3 bc = mod(cell, 3.0) == 2.0 ? vec3(1.0, 0.36, 0.36) : (cell < 4.0 ? vec3(0.2, 0.95, 0.55) : vec3(0.1, 0.9, 0.85));
      col += bc * (smoothstep(0.01, -0.01, d) * 0.9 + exp(-max(d, 0.0) * 22.0) * 0.25);
    }
    col += vec3(0.5, 0.8, 1.0) * spec * 0.35 + rim * 0.25;
  } else if (uMat == 3) {
    float ring = 0.5 + 0.5 * sin(uTime * 3.0);
    col = vec3(0.12, 0.16, 0.22) * dif + vec3(0.05, 0.9, 0.85) * (0.35 + 0.35 * ring) * smoothstep(0.55, 0.9, abs(vL.x));
    col += rim * vec3(0.1, 0.5, 0.55);
  } else if (uMat == 4) {
    float f = uTalk > 0.5 ? 0.5 + 0.5 * sin(uTime * 14.0) : 0.5 + 0.5 * sin(uTime * 2.2);
    vec3 a = mix(vec3(0.15, 0.95, 0.5), vec3(1.0, 0.3, 0.3), step(0.5, 0.5 + 0.5 * sin(uTime * (uTalk > 0.5 ? 6.0 : 0.9))));
    col = a * (0.55 + 0.6 * f) + spec * 0.6;
  } else {
    col = vec3(0.17, 0.22, 0.31) * dif + vec3(0.62, 0.78, 0.95) * spec * 0.55 + rim * vec3(0.0, 0.45, 0.5);
    float band = smoothstep(0.80, 0.86, vL.y) * (1.0 - smoothstep(0.93, 0.99, vL.y));
    col = mix(col, vec3(0.05, 0.95, 0.85) * (0.8 + 0.2 * sin(uTime * 2.0)), band * step(0.0, vL.z + 0.7));
    float seam = smoothstep(0.012, 0.0, abs(abs(vL.x) - 0.6)) * step(0.0, vL.y) * 0.18;
    col -= seam;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

type Part = { vb: WebGLBuffer; ib: WebGLBuffer; n: number; mat: number; off: number[]; scl: number[] };
function setupGl(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true, premultipliedAlpha: true });
  if (!gl) return null;
  const sh = (t: number, s: string) => {
    const o = gl.createShader(t)!;
    gl.shaderSource(o, s);
    gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn("avatar shader:", gl.getShaderInfoLog(o));
    return o;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) console.warn("avatar program:", gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const mk = (e1: number, e2: number, mat: number, off: number[], scl: number[]): Part => {
    const g = superellipsoid(e1, e2);
    const vb = gl.createBuffer()!, ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, g.v, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
    return { vb, ib, n: g.idx.length, mat, off, scl };
  };
  const parts: Part[] = [
    mk(0.3, 0.3, 0, [0, 0.05, 0], [1.0, 0.86, 0.9]), // head shell
    mk(0.22, 0.22, 1, [0, 0.07, 0.8], [0.8, 0.6, 0.14]), // visor screen
    mk(0.14, 1.0, 3, [-1.04, 0.05, 0], [0.13, 0.32, 0.32]), // left ear
    mk(0.14, 1.0, 3, [1.04, 0.05, 0], [0.13, 0.32, 0.32]), // right ear
    mk(0.2, 1.0, 0, [0, 1.17, 0], [0.045, 0.3, 0.045]), // antenna rod
    mk(1.0, 1.0, 4, [0, 1.52, 0], [0.12, 0.12, 0.12]), // antenna tip
    mk(0.2, 0.6, 0, [0, -0.95, 0], [0.42, 0.2, 0.42]), // neck
  ];
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const U = (n: string) => gl.getUniformLocation(pr, n);
  const loc = { aPos: gl.getAttribLocation(pr, "aPos"), aN: gl.getAttribLocation(pr, "aN"), mvp: U("uMVP"), rot: U("uRot"), off: U("uOff"), scl: U("uScl"), mat: U("uMat"), jaw: U("uJaw"), time: U("uTime"), open: U("uOpen"), talk: U("uTalk"), amp: U("uAmp") };
  return { gl, parts, loc };
}

export function AvatarHead() {
  const [text, setText] = useState("");
  const [talking, setTalking] = useState(false);
  const min = false;
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useRef({ talking: false, amp: 0, talk: 0, mx: 0, my: 0, yaw: 0, pitch: 0 });

  useEffect(() => {
    // an earlier version stored a photo of the user here; remove it
    try {
      localStorage.removeItem("arcus.avatar.v1");
    } catch {}
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
    window.addEventListener("arcus:speaking", sp);
    window.addEventListener("arcus:pulse", pu);
    window.addEventListener("pointermove", mv);
    return () => {
      window.removeEventListener("arcus:speaking", sp);
      window.removeEventListener("arcus:pulse", pu);
      window.removeEventListener("pointermove", mv);
    };
  }, []);

  useEffect(() => {
    if (min || !cv.current) return;
    const canvas = cv.current;
    const g = setupGl(canvas);
    if (!g) return;
    const { gl, parts, loc } = g;
    let raf = 0, alive = true;
    const t0 = performance.now();
    let last = t0;
    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const s = st.current, t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      s.amp = Math.max(0, s.amp - dt * 3.2);
      s.talk += ((s.talking ? 1 : 0) - s.talk) * Math.min(1, dt * 14);
      s.yaw += (s.mx * 0.5 + Math.sin(t * 0.7) * 0.07 + (s.talking ? Math.sin(t * 2.4) * 0.1 : 0) - s.yaw) * Math.min(1, dt * 4);
      s.pitch += (s.my * 0.24 + Math.sin(t * 1.1) * 0.025 + (s.talking ? Math.sin(t * 6) * 0.04 : 0) - s.pitch) * Math.min(1, dt * 4);
      const bp = t % 3.6, open = bp > 3.4 ? Math.abs((bp - 3.5) / 0.1) : 1;
      const breathe = 1 + Math.sin(t * 1.6) * 0.01;
      const rot = mul(rotX(s.pitch), rotY(s.yaw));
      const model = mul(trans(0, -0.12 + Math.sin(t * 1.6) * 0.012, -5.1), mul(rot, [breathe, 0, 0, 0, 0, breathe, 0, 0, 0, 0, breathe, 0, 0, 0, 0, 1]));
      const mvp = mul(persp(0.64, 1, 0.1, 30), model);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(mvp));
      gl.uniformMatrix3fv(loc.rot, false, new Float32Array(mat3(rot)));
      gl.uniform1f(loc.time, t);
      gl.uniform1f(loc.open, open);
      gl.uniform1f(loc.talk, s.talk);
      gl.uniform1f(loc.amp, s.amp);
      gl.uniform1f(loc.jaw, s.talk);
      for (const p of parts) {
        gl.bindBuffer(gl.ARRAY_BUFFER, p.vb);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.ib);
        gl.enableVertexAttribArray(loc.aPos);
        gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(loc.aN);
        gl.vertexAttribPointer(loc.aN, 3, gl.FLOAT, false, 24, 12);
        gl.uniform3fv(loc.off, p.off);
        gl.uniform3fv(loc.scl, p.scl);
        gl.uniform1i(loc.mat, p.mat);
        gl.drawElements(gl.TRIANGLES, p.n, gl.UNSIGNED_SHORT, 0);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [min]);

  return (
    <div className={"av-wrap av-fixed" + (talking ? " talking" : "")} role="img" aria-label="Trading robot agent">
      <canvas ref={cv} width={192} height={192} className="av-cv" />
      {text && <div className="av-say" dir="auto">{text}</div>}
    </div>
  );
}
