// Probe: which sources give the ACTUAL value of a released economic event, and Fed statements / speeches?
import fs from "node:fs";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
fs.mkdirSync("out/samples", { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const wk = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);
const wb = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
const H = { "User-Agent": UA };
const tests = [
  ["FF json this", "https://nfs.faireconomy.media/ff_calendar_thisweek.json", H],
  ["FF csv", "https://nfs.faireconomy.media/ff_calendar_thisweek.csv", H],
  ["FF xml", "https://nfs.faireconomy.media/ff_calendar_thisweek.xml", H],
  ["FF html", "https://www.forexfactory.com/calendar?week=this", H],
  ["TE guest", "https://api.tradingeconomics.com/calendar?c=guest:guest&f=json", H],
  ["TE guest US", `https://api.tradingeconomics.com/calendar/country/united%20states/${wb}/${wk}?c=guest:guest&f=json`, H],
  ["FXStreet", `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${wb}/${wk}`, { ...H, Origin: "https://www.fxstreet.com", Referer: "https://www.fxstreet.com/" }],
  ["Investing widget", `https://sslecal2.investing.com/?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&importance=1,2,3&calType=week&timeZone=55&lang=1`, H],
  ["MQL5", `https://www.mql5.com/en/economic-calendar/content?date_mode=1&from=${wb}T00:00:00&to=${wk}T23:59:59&importance=12&currencies=127`, { ...H, "X-Requested-With": "XMLHttpRequest" }],
  ["Fed press rss", "https://www.federalreserve.gov/feeds/press_monetary.xml", H],
  ["Fed speeches rss", "https://www.federalreserve.gov/feeds/speeches.xml", H],
  ["Fed all press rss", "https://www.federalreserve.gov/feeds/press_all.xml", H],
  ["Fed statement 1028", "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm", H],
  ["Fed monetary page", "https://www.federalreserve.gov/newsevents/pressreleases.htm", H],
  ["Fed testimony rss", "https://www.federalreserve.gov/feeds/testimony.xml", H],
  ["BLS CPI v1", "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0", H],
  ["BLS NFP v1", "https://api.bls.gov/publicAPI/v1/timeseries/data/CES0000000001", H],
  ["BLS schedule", "https://www.bls.gov/schedule/news_release/", H],
  ["BEA", "https://www.bea.gov/news/schedule", H],
  ["ECB press rss", "https://www.ecb.europa.eu/rss/press.html", H],
  ["BoE news", "https://www.bankofengland.co.uk/rss/news", H],
  ["Yahoo econ cal", "https://finance.yahoo.com/calendar/economic", H],
  ["Nasdaq econ", "https://api.nasdaq.com/api/calendar/economicevents?date=" + today, { ...H, Accept: "application/json", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" }],
  ["Finnhub-free", "https://finnhub.io/api/v1/calendar/economic?token=demo", H],
];
for (const [name, url, headers] of tests) {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 30000);
    const r = await fetch(url, { headers, signal: ctl.signal });
    const txt = await r.text();
    clearTimeout(to);
    if (r.status === 200) fs.writeFileSync("out/samples/" + name.replace(/\W+/g, "_") + ".txt", txt.slice(0, 300000));
    console.log(`${r.status === 200 ? "OK  " : "FAIL"} ${name.padEnd(18)} ${r.status} ${txt.length}B  ${txt.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(18)} ${e.name}: ${e.message}`);
  }
}
