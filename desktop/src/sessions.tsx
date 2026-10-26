/* Thin bar under the header: which forex/trading sessions are open now, US stock hours, and a yellow "closed" state. */
import React, { useEffect, useState } from "react";

type Sess = { name: string; tz: string; from: number; to: number; color: string };
const SESSIONS: Sess[] = [
  { name: "Sydney", tz: "Australia/Sydney", from: 7 * 60, to: 16 * 60, color: "#4aa3ff" },
  { name: "Tokyo", tz: "Asia/Tokyo", from: 9 * 60, to: 18 * 60, color: "#ff6fae" },
  { name: "London", tz: "Europe/London", from: 8 * 60, to: 16 * 60 + 30, color: "#00dcd2" },
  { name: "New York", tz: "America/New_York", from: 8 * 60, to: 17 * 60, color: "#b388ff" },
];
const US = { tz: "America/New_York", from: 9 * 60 + 30, to: 16 * 60 };
const fmts: Record<string, Intl.DateTimeFormat> = {};
const parts = (tz: string, t: number) => {
  const f = (fmts[tz] = fmts[tz] || new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  let wd = "", h = 0, m = 0;
  for (const p of f.formatToParts(new Date(t))) {
    if (p.type === "weekday") wd = p.value;
    else if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  return { wd, min: h * 60 + m };
};
const isOpen = (s: { tz: string; from: number; to: number }, t: number) => {
  const { wd, min } = parts(s.tz, t);
  return wd !== "Sat" && wd !== "Sun" && min >= s.from && min < s.to;
};
const anyForex = (t: number) => SESSIONS.some((s) => isOpen(s, t));
/** minutes until `open(t)` flips (scans in 5-minute steps, up to 8 days) */
const untilFlip = (open: (t: number) => boolean, now: number) => {
  const cur = open(now);
  for (let k = 1; k <= 8 * 288; k++) if (open(now + k * 300000) !== cur) return k * 5;
  return null;
};
const dur = (min: number | null) => {
  if (min == null) return "";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return (d ? d + "d " : "") + (h ? h + "h " : "") + (!d ? m + "m" : "").trim();
};

export function SessionBar(p: { notifPerm: string; onEnable: () => void; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const open = SESSIONS.filter((s) => isOpen(s, now));
  const fxOpen = open.length > 0;
  const usOpen = isOpen(US, now);
  const fxNext = fxOpen ? untilFlip(anyForex, now) : untilFlip(anyForex, now);
  const usNext = untilFlip((t) => isOpen(US, t), now);
  const showBell = p.notifPerm !== "granted" && p.notifPerm !== "unsupported";
  return (
    <div className={"sess-bar" + (fxOpen ? "" : " closed") + (p.compact ? " compact fs-keep" : "")}>
      {fxOpen ? (
        <span className="sess-list" title="Forex sessions that are open right now">
          {open.map((s) => (
            <b key={s.name} style={{ color: s.color }}>
              <i style={{ background: s.color }} /> {s.name}
            </b>
          ))}
          {open.length > 1 && <small>overlap</small>}
        </span>
      ) : (
        <span className="sess-list">
          <b>
            <i /> Markets closed
          </b>
          <small>opens in {dur(fxNext)}</small>
        </span>
      )}
      <span className={"sess-us" + (usOpen ? "" : " off")} title="NYSE / Nasdaq regular hours, 9:30–16:00 New York time (holidays not included)">
        US stocks {usOpen ? "open" : "closed"} · {usOpen ? "closes" : "opens"} in {dur(usNext)}
      </span>
      {!p.compact && <span className="sess-note">Crypto trades 24/7</span>}
      {showBell && (
        <button className="sess-bell" title={p.notifPerm === "denied" ? "Notifications are blocked in the browser settings" : "Turn on desktop notifications"} onClick={p.onEnable}>
          🔕
        </button>
      )}
    </div>
  );
}
