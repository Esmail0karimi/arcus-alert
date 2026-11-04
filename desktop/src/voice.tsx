/* Spoken alerts. Two completely separate channels, each with its own settings:
   "price"  = the price alerts you place on the chart
   "agent"  = the Agent tab's candle-close warnings
   Uses the device's built-in text-to-speech; if it has no voice for the chosen language the English text is spoken instead. */
import React, { useEffect, useRef, useState } from "react";
import { getLang, useLang } from "./lang";

export type Chan = "price" | "agent";
export type VoiceCfg = { on: boolean; lang: "auto" | "fa" | "en"; voice: string; rate: number; vol: number; chime: "off" | "soft" | "double" };
export type Say = { en: string; fa: string };
const DEF: VoiceCfg = { on: true, lang: "auto", voice: "", rate: 1, vol: 1, chime: "soft" };
const key = (c: Chan) => "arcus.voice." + c + ".v1";
export const getVoice = (c: Chan): VoiceCfg => {
  try {
    return { ...DEF, ...(JSON.parse(localStorage.getItem(key(c)) || "{}") as Partial<VoiceCfg>) };
  } catch {
    return DEF;
  }
};
const setVoice = (c: Chan, v: VoiceCfg) => {
  try {
    localStorage.setItem(key(c), JSON.stringify(v));
  } catch {}
};

export const chime = (kind: "soft" | "double" | "off", vol = 1) => {
  if (kind === "off") return;
  try {
    const A = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = kind === "double" ? [880, 880] : [660, 880, 1100];
    notes.forEach((f, i) => {
      const o = A.createOscillator(), g = A.createGain(), t = A.currentTime + i * 0.2;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g).connect(A.destination);
      o.start(t);
      o.stop(t + 0.19);
    });
  } catch {}
};

const voices = () => ("speechSynthesis" in window ? window.speechSynthesis.getVoices() : []);
const pick = (cfg: VoiceCfg, lang: "fa" | "en") => {
  const all = voices();
  const named = cfg.voice ? all.find((v) => v.name === cfg.voice) : undefined;
  if (named && named.lang.toLowerCase().startsWith(lang)) return named;
  return all.find((v) => v.lang.toLowerCase().startsWith(lang) && v.localService) || all.find((v) => v.lang.toLowerCase().startsWith(lang));
};
/** Speak a sentence on one channel (chime first, then the voice). Returns the language actually used, or "" if nothing was spoken. */
export function speak(c: Chan, say: Say, force = false): "fa" | "en" | "" {
  const cfg = getVoice(c);
  if (!cfg.on && !force) return "";
  chime(cfg.chime, cfg.vol);
  if (!("speechSynthesis" in window)) return "";
  const want: "fa" | "en" = cfg.lang === "auto" ? getLang() : cfg.lang;
  let lang: "fa" | "en" = want;
  let v = pick(cfg, lang);
  if (!v && lang === "fa") {
    lang = "en";
    v = pick(cfg, "en");
  }
  const u = new SpeechSynthesisUtterance(lang === "fa" ? say.fa : say.en);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  } else u.lang = lang === "fa" ? "fa-IR" : "en-US";
  u.rate = cfg.rate;
  u.volume = cfg.vol;
  window.setTimeout(() => window.speechSynthesis.speak(u), cfg.chime === "off" ? 0 : 700);
  return lang;
}

export function VoiceControl(p: { chan: Chan; label: string; sample: Say }) {
  const appFa = useLang() === "fa";
  const [cfg, setCfg] = useState<VoiceCfg>(() => getVoice(p.chan));
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SpeechSynthesisVoice[]>([]);
  const [used, setUsed] = useState<"" | "fa" | "en">("");
  const box = useRef<HTMLDivElement>(null);
  const T = (en: string, f: string) => (appFa ? f : en);
  useEffect(() => {
    const load = () => setList(voices());
    load();
    if ("speechSynthesis" in window) window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  const set = (v: Partial<VoiceCfg>) => {
    const n = { ...cfg, ...v };
    setCfg(n);
    setVoice(p.chan, n);
  };
  const hasFa = list.some((v) => v.lang.toLowerCase().startsWith("fa"));
  const want = cfg.lang === "auto" ? (appFa ? "fa" : "en") : cfg.lang;
  const shown = list.filter((v) => v.lang.toLowerCase().startsWith(want)).concat(list.filter((v) => !v.lang.toLowerCase().startsWith(want)).slice(0, 0));
  return (
    <div className="vx" ref={box} dir={appFa ? "rtl" : "ltr"}>
      <button type="button" className={"vx-btn" + (cfg.on ? " on" : "")} onClick={() => setOpen(!open)} title={p.label} aria-expanded={open}>
        {cfg.on ? "🗣" : "🔇"} <span>{p.label}</span>
      </button>
      {open && (
        <div className="vx-pop" role="dialog" aria-label={p.label}>
          <h4>{p.label}</h4>
          <label className="vx-row"><input type="checkbox" checked={cfg.on} onChange={(e) => set({ on: e.target.checked })} /> {T("Speak the alert aloud", "هشدار را با صدا بخوان")}</label>
          <label className="vx-row">{T("Language", "زبان")}
            <select value={cfg.lang} onChange={(e) => set({ lang: e.target.value as VoiceCfg["lang"], voice: "" })}>
              <option value="auto">{T("Same as app", "مثل زبان اپ")}</option>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="vx-row">{T("Voice", "صدا")}
            <select value={cfg.voice} onChange={(e) => set({ voice: e.target.value })}>
              <option value="">{T("Automatic", "خودکار")}</option>
              {shown.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
          <label className="vx-row">{T("Speed", "سرعت")} <input type="range" min="0.6" max="1.5" step="0.05" value={cfg.rate} onChange={(e) => set({ rate: Number(e.target.value) })} /></label>
          <label className="vx-row">{T("Volume", "بلندی")} <input type="range" min="0.2" max="1" step="0.05" value={cfg.vol} onChange={(e) => set({ vol: Number(e.target.value) })} /></label>
          <label className="vx-row">{T("Sound before speech", "صدای پیش از گفتار")}
            <select value={cfg.chime} onChange={(e) => set({ chime: e.target.value as VoiceCfg["chime"] })}>
              <option value="soft">{T("Rising 3 notes", "سه نت صعودی")}</option>
              <option value="double">{T("Double beep", "بوق دوتایی")}</option>
              <option value="off">{T("None", "بدون صدا")}</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => setUsed(speak(p.chan, p.sample, true))}>▶ {T("Test", "آزمایش")}</button>
          {used === "en" && want === "fa" && <p className="vx-note">{T("This device has no Persian voice, so it spoke English.", "این دستگاه صدای فارسی ندارد، پس انگلیسی خواند.")}</p>}
          {!hasFa && list.length > 0 && want === "fa" && used === "" && <p className="vx-note">{T("No Persian voice found on this device; English will be spoken.", "صدای فارسی روی این دستگاه پیدا نشد؛ انگلیسی خوانده می‌شود.")}</p>}
          <p className="vx-note">{p.chan === "price" ? T("These settings are only for the price alerts you set on the chart.", "این تنظیمات فقط برای هشدار قیمتی است که روی چارت می‌گذاری.") : T("These settings are only for the Agent's candle warnings, separate from your price alerts.", "این تنظیمات فقط برای هشدار کندل ایجنت است و از هشدار قیمت جداست.")}</p>
        </div>
      )}
    </div>
  );
}
