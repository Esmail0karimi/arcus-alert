/* "What is this market?" window: description from Wikipedia (CORS-enabled) in many languages. */
import React, { useEffect, useState } from "react";
import { AssetStats, YfName, assetStats, companyName } from "./exchanges";

export const LANGS: { code: string; name: string; rtl?: boolean }[] = [
  { code: "en", name: "English" }, { code: "fa", name: "فارسی", rtl: true }, { code: "ar", name: "العربية", rtl: true },
  { code: "tr", name: "Türkçe" }, { code: "ru", name: "Русский" }, { code: "es", name: "Español" }, { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" }, { code: "pt", name: "Português" }, { code: "it", name: "Italiano" }, { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" }, { code: "ko", name: "한국어" }, { code: "hi", name: "हिन्दी" }, { code: "id", name: "Indonesia" },
  { code: "ur", name: "اردو", rtl: true }, { code: "he", name: "עברית", rtl: true }, { code: "uk", name: "Українська" },
];
const ALIAS: Record<string, string> = {
  XAU: "Gold", XAG: "Silver", XPT: "Platinum", XPD: "Palladium", XCU: "Copper", WTI: "West Texas Intermediate", CL: "West Texas Intermediate",
  BRENT: "Brent Crude", NG: "Natural gas", USOIL: "West Texas Intermediate", UKOIL: "Brent Crude", SPX: "S&P 500", SPY: "SPDR S&P 500 ETF Trust",
  NATGAS: "Natural gas", NGAS: "Natural gas", NATGASUSD: "Natural gas", GAS: "Natural gas", HENRYHUB: "Henry Hub", OIL: "West Texas Intermediate", CRUDE: "West Texas Intermediate",
  GOLD: "Gold", SILVER: "Silver", COPPER: "Copper", PLATINUM: "Platinum", PALLADIUM: "Palladium", CORN: "Corn", WHEAT: "Wheat", SOYBEAN: "Soybean", SOYBEANS: "Soybean",
  COFFEE: "Coffee", SUGAR: "Sugar", COTTON: "Cotton", COCOA: "Cocoa bean", GASOLINE: "Gasoline", HEATINGOIL: "Heating oil", LUMBER: "Lumber", URANIUM: "Uranium", ALUMINUM: "Aluminium", ALUMINIUM: "Aluminium", NICKEL: "Nickel", ZINC: "Zinc",
  NDX: "Nasdaq-100", QQQ: "Invesco QQQ", DJI: "Dow Jones Industrial Average", EURUSD: "Euro", GBPUSD: "Pound sterling", USDJPY: "Japanese yen",
};
export const assetBase = (display: string) =>
  display.replace(/ ·[A-Z]$/, "").toUpperCase().replace(/^[A-Z0-9]+:/, "").replace(/-(USD[CT]?|PERP|SWAP)(-.*)?$/, "").replace(/^1000(?=[A-Z])/, "");

type Info = { who?: YfName | null; title: string; desc: string; extract: string; thumb?: string; url: string; langs: Record<string, string> };
const CK = "arcus.assetinfo.v3";
const readCache = (): Record<string, { at: number; v: any }> => {
  try {
    return JSON.parse(localStorage.getItem(CK) || "{}");
  } catch {
    return {};
  }
};
const cached = async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
  const c = readCache(),
    hit = c[key];
  if (hit && Date.now() - hit.at < 7 * 864e5) return hit.v;
  const v = await fn();
  try {
    const keys = Object.keys(c);
    if (keys.length > 60) delete c[keys[0]];
    c[key] = { at: Date.now(), v };
    localStorage.setItem(CK, JSON.stringify(c));
  } catch {}
  return v;
};
const j = async (url: string, signal?: AbortSignal) => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
const summary = async (lang: string, title: string, signal?: AbortSignal) => {
  const s = await j("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")), signal);
  return { title: s.title as string, desc: (s.description || "") as string, extract: (s.extract || "") as string, thumb: s.thumbnail?.source as string | undefined, url: (s.content_urls?.desktop?.page || "") as string };
};
const FIN = /(stock|share|ticker|compan|corporation|exchange|nasdaq|nyse|cryptocurrenc|token|blockchain|commodit|futures|\bETF\b|index|currenc|bank|\binc\b|\bplc\b|\bltd\b|trading|biotech|pharmaceutic|\boil\b|\bgas\b|metal|fund|market|financ|bitcoin|ethereum|coin)/i;
const PERSON = /\b(born|actress|actor|singer|rapper|footballer|politician|novelist|film|album|song|television|character|professional wrestler|model|footballer|athlete|journalist|musician)\b/i;
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** Find the best-matching English Wikipedia article for a ticker / asset name. */
export async function findAsset(base: string, signal?: AbortSignal, crypto = false): Promise<Info | null> {
  return cached("find2|" + crypto + "|" + base, async () => {
    let who: YfName | null = null;
    if (!ALIAS[base]) {
      try {
        who = await companyName(base, crypto, signal);
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
      }
    }
    const clean = (who?.name || "").replace(/,?\s+(Inc|Incorporated|Corporation|Corp|Company|Co|Ltd|Limited|PLC|N\.V|S\.A|AG|SE|Holdings?|Group)\.?$/i, "").replace(/\.$/, "").trim();
    const first = (clean.split(/[\s,.-]+/)[0] || "").toLowerCase();
    const queries = ALIAS[base] ? [ALIAS[base]] : [...(who ? [who.name, clean + " " + (crypto ? "cryptocurrency" : "company")] : []), base + " ticker symbol stock exchange", base + " cryptocurrency token"];
    const word = new RegExp("(^|[^A-Za-z0-9])" + base.replace(/[^A-Z0-9]/g, "") + "([^A-Za-z0-9]|$)", "i");
    let pick = ALIAS[base] || "";
    for (let qi = 0; qi < queries.length; qi++) {
      if (pick) break;
      const q = queries[qi];
      const byName = !!who && qi < 2;
      try {
        const r = await j("https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=6&format=json&origin=*&srsearch=" + encodeURIComponent(q), signal);
        const hits: { title: string; snippet: string }[] = r?.query?.search || [];
        const good = hits.find((h) => {
          const txt = strip(h.snippet) + " " + h.title;
          if (PERSON.test(strip(h.snippet))) return false;
          if (byName) return !!first && h.title.toLowerCase().startsWith(first) && FIN.test(txt);
          return (word.test(strip(h.snippet)) || word.test(h.title)) && FIN.test(txt);
        });
        if (good) pick = good.title;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
      }
    }
    if (!pick) return who ? ({ who, title: who.name, desc: [who.type, who.sector, who.industry].filter(Boolean).join(" · "), extract: "", url: "", langs: {} } as Info) : null;
    const s = await summary("en", pick, signal);
    if (!ALIAS[base] && !who && (PERSON.test(s.desc) || !FIN.test(s.desc + " " + s.extract))) return null;
    let langs: Record<string, string> = {};
    try {
      const l = await j("https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllimit=500&format=json&formatversion=2&origin=*&titles=" + encodeURIComponent(s.title), signal);
      for (const x of l?.query?.pages?.[0]?.langlinks || []) langs[x.lang] = x.title;
    } catch {}
    return { ...s, who, langs } as Info;
  });
}

export function AssetInfo(p: {
  symbol: string; shown: string; category: string; price?: number; change?: number | null; exchange: string;
  onClose: () => void; onChart: () => void;
}) {
  const base = assetBase(p.shown);
  const [lang, setLang] = useState<string>(() => {
    try {
      const s = localStorage.getItem("arcus.infoLang");
      if (s) return s;
    } catch {}
    const nav = (navigator.language || "en").slice(0, 2);
    return LANGS.some((l) => l.code === nav) ? nav : "en";
  });
  const [base0, setBase0] = useState<Info | null | undefined>(undefined); // undefined = loading
  const [stats, setStats] = useState<AssetStats | null | undefined>(undefined);
  const [view, setView] = useState<{ title: string; desc: string; extract: string; url: string; same: boolean } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setBase0(undefined);
    findAsset(base, ctl.signal, p.category === "Crypto")
      .then((v) => !ctl.signal.aborted && setBase0(v))
      .catch(() => !ctl.signal.aborted && setBase0(null));
    return () => ctl.abort();
  }, [base]);
  useEffect(() => {
    const ctl = new AbortController();
    setStats(undefined);
    assetStats(base, p.category === "Crypto", ctl.signal)
      .then((v) => !ctl.signal.aborted && setStats(v))
      .catch(() => !ctl.signal.aborted && setStats(null));
    return () => ctl.abort();
  }, [base]);
  useEffect(() => {
    if (!base0) return setView(null);
    if (lang === "en" || !base0.langs[lang]) return setView({ ...base0, same: lang === "en" });
    const ctl = new AbortController();
    cached("sum|" + lang + "|" + base0.langs[lang], () => summary(lang, base0.langs[lang], ctl.signal))
      .then((s) => !ctl.signal.aborted && setView({ ...s, same: true }))
      .catch(() => !ctl.signal.aborted && setView({ ...base0, same: false }));
    return () => ctl.abort();
  }, [base0, lang]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const L = LANGS.find((l) => l.code === lang)!;
  const pick = (code: string) => {
    setLang(code);
    try {
      localStorage.setItem("arcus.infoLang", code);
    } catch {}
  };
  const fa = lang === "fa";
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 });
  const trendFa = (t: string | undefined, f: boolean) =>
    !t ? "—" : !f ? t : t === "Uptrend" ? "صعودی" : t === "Downtrend" ? "نزولی" : t.startsWith("Sideways") ? "خنثی / مختلط" : t.startsWith("Above") ? "بالای میانگین ۲۰ روزه" : t.startsWith("Below") ? "زیر میانگین ۲۰ روزه" : "تاریخچه کافی نیست";
  const q = encodeURIComponent(base + " " + (p.category === "Crypto" ? "crypto" : "stock ticker"));
  const chg = p.change;
  return (
    <div className="info-bg" onClick={p.onClose}>
      <div className="info-card" onClick={(e) => e.stopPropagation()}>
        <button className="info-x" onClick={p.onClose} aria-label="Close">✕</button>
        <div className="info-head">
          <div>
            <b>{p.shown}</b>
            <span className="info-cat">{p.category}</span>
            <small>{p.exchange}</small>
            {(base0?.who?.name || stats?.name) && (
              <div className="info-fullname">
                {base0?.who?.name || stats?.name}
                {base0?.who && [base0.who.exchange, base0.who.sector, base0.who.industry].filter(Boolean).length > 0 && (
                  <small> · {[base0.who.exchange, base0.who.sector, base0.who.industry].filter(Boolean).join(" · ")}</small>
                )}
              </div>
            )}
          </div>
          <div className="info-price">
            {p.price != null ? p.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
            {chg != null && <i className={chg >= 0 ? "positive" : "negative"}>{(chg >= 0 ? "+" : "") + chg.toFixed(2)}%</i>}
          </div>
        </div>
        <div className="info-langs" title="Language">
          <span>🌐</span>
          {LANGS.map((l) => (
            <button key={l.code} className={l.code === lang ? "on" : ""} onClick={() => pick(l.code)}>
              {l.name}
            </button>
          ))}
        </div>
        <div className="info-body" dir={L.rtl && view?.same ? "rtl" : "ltr"}>
          {base0 === undefined && <div className="info-load"><i /> Looking up “{base}”…</div>}
          {base0 === null && (
            <div className="info-none">
              <b>No encyclopedia entry found for “{base}”.</b>
              <p>It may be a new token, a small company or an exchange-specific product. Try the links below.</p>
            </div>
          )}
          {view && (
            <>
              {base0?.thumb && lang === "en" && <img className="info-img" src={base0.thumb} alt="" />}
              <h3>{view.title}</h3>
              {view.desc && <em>{view.desc}</em>}
              {view.extract && <p>{view.extract}</p>}
              {!view.same && lang !== "en" && (
                <small className="info-note">No article in this language: showing English. Use the translate button.</small>
              )}
            </>
          )}
        </div>
        <div className="info-stats">
          {stats === undefined && <div className="info-load"><i /> Loading market profile and trend…</div>}
          {stats === null && <small className="info-note">Profile and trend are not available for this market right now.</small>}
          {stats && (
            <>
              <h4>{fa ? "پروفایل بازار" : "Market profile"}</h4>
              <div className="info-grid">
                {stats.name && <div><span>{fa ? "نام" : "Name"}</span><b>{stats.name}</b></div>}
                {stats.exchange && <div><span>{fa ? "بورس" : "Listed on"}</span><b>{stats.exchange}</b></div>}
                {stats.country && <div><span>{fa ? "کشور" : "Country"}</span><b>{stats.country}</b></div>}
                {stats.type && <div><span>{fa ? "نوع" : "Type"}</span><b>{stats.type}</b></div>}
                {stats.currency && <div><span>{fa ? "ارز" : "Currency"}</span><b>{stats.currency}</b></div>}
                {stats.lo52 != null && stats.hi52 != null && (
                  <div><span>{fa ? "بازه ۵۲ هفته" : "52-week range"}</span><b>{fmt(stats.lo52)} – {fmt(stats.hi52)}</b></div>
                )}
              </div>
              <h4>{fa ? "روند" : "Trend"}</h4>
              <div className="info-trend">
                {([["d1", fa ? "روزانه" : "Daily"], ["d7", fa ? "هفتگی" : "Weekly"], ["d30", fa ? "ماهانه" : "Monthly"]] as const).map(([k, l]) => {
                  const v = stats[k];
                  return (
                    <div key={k}>
                      <span>{l}</span>
                      <b className={v == null ? "" : v >= 0 ? "positive" : "negative"}>{v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"}</b>
                    </div>
                  );
                })}
                <div>
                  <span>{fa ? "وضعیت" : "Status"}</span>
                  <b className={/^Up/.test(stats.trend || "") ? "positive" : /^Down/.test(stats.trend || "") ? "negative" : ""}>{trendFa(stats.trend, fa)}</b>
                </div>
              </div>
              <small className="info-note2">
                {fa ? "بر پایه‌ی کندل‌های روزانه و میانگین‌های ۲۰ و ۵۰ روزه · منبع: " : "From daily candles and the 20 / 50-day averages · source: "}
                {stats.source || "—"}
              </small>
            </>
          )}
        </div>
        <div className="info-actions">
          {view?.url && <a href={view.url} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
          {view && (
            <a
              href={"https://translate.google.com/?sl=auto&tl=" + lang + "&op=translate&text=" + encodeURIComponent((view.title + ". " + view.extract).slice(0, 1800))}
              target="_blank"
              rel="noreferrer"
            >
              Translate ↗
            </a>
          )}
          <a href={"https://www.google.com/search?q=" + q} target="_blank" rel="noreferrer">Google ↗</a>
          {p.category === "Crypto" && <a href={"https://www.coingecko.com/en/search?query=" + encodeURIComponent(base)} target="_blank" rel="noreferrer">CoinGecko ↗</a>}
          <button className="info-chart" onClick={p.onChart}>Open chart</button>
        </div>
        <small className="info-foot">Descriptions come from Wikipedia and may not match the exact contract an exchange lists. Not financial advice.</small>
      </div>
    </div>
  );
}
