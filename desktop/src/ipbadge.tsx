/* Small flag + country code of the IP address the app is connecting from (useful when using a VPN). */
import React, { useEffect, useState } from "react";

type Geo = { cc: string; name: string; ip: string; at: number };
const KEY = "arcus.ipgeo.v1";
const SOURCES: [string, (j: any) => Geo | null][] = [
  ["https://ipwho.is/", (j) => (j && j.success !== false && j.country_code ? { cc: j.country_code, name: j.country, ip: j.ip, at: Date.now() } : null)],
  ["https://api.country.is/", (j) => (j && j.country ? { cc: j.country, name: j.country, ip: j.ip, at: Date.now() } : null)],
  ["https://ipapi.co/json/", (j) => (j && j.country_code ? { cc: j.country_code, name: j.country_name, ip: j.ip, at: Date.now() } : null)],
];
const read = (): Geo | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
async function lookup(): Promise<Geo | null> {
  for (const [url, parse] of SOURCES) {
    try {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      window.clearTimeout(timer);
      if (!r.ok) continue;
      const g = parse(await r.json());
      if (g && /^[A-Za-z]{2}$/.test(g.cc)) return { ...g, cc: g.cc.toUpperCase() };
    } catch {}
  }
  return null;
}
const emoji = (cc: string) => String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function IpBadge() {
  const [g, setG] = useState<Geo | null>(() => read());
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let dead = false;
    const run = async () => {
      const v = await lookup();
      if (dead) return;
      if (v) {
        setG(v);
        setBad(false);
        try {
          localStorage.setItem(KEY, JSON.stringify(v));
        } catch {}
      } else setBad(true);
    };
    run();
    const id = window.setInterval(run, 3 * 60e3); // a VPN can change the country while the app is open
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);
  if (!g) return bad ? <div className="ip-badge off" title="Could not detect your country (IP lookup blocked)"><span>🌐</span><small>--</small></div> : null;
  return (
    <div className="ip-badge" title={g.name + " · " + g.ip + (bad ? " (last known)" : "")}>
      <img src={"https://flagcdn.com/24x18/" + g.cc.toLowerCase() + ".png"} width={24} height={18} alt={emoji(g.cc)} onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
      <small>{g.cc}</small>
    </div>
  );
}
