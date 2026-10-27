// One-off probe: which data sources answer from a GitHub runner (server side, no CORS)?
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SEC_UA = "ArcusAlert research contact karimiesmail37@gmail.com";
const T = "META";
const tests = [
  ["ForexFactory", "https://nfs.faireconomy.media/ff_calendar_thisweek.json", {}],
  ["Nasdaq cal", "https://api.nasdaq.com/api/calendar/earnings?date=2026-10-29", { "User-Agent": UA, Accept: "application/json" }],
  ["Nasdaq surprise", `https://api.nasdaq.com/api/company/${T}/earnings-surprise`, { "User-Agent": UA, Accept: "application/json" }],
  ["Nasdaq forecast", `https://api.nasdaq.com/api/analyst/${T}/earnings-forecast`, { "User-Agent": UA, Accept: "application/json" }],
  ["Nasdaq date", `https://api.nasdaq.com/api/analyst/${T}/earnings-date`, { "User-Agent": UA, Accept: "application/json" }],
  ["Nasdaq eps", `https://api.nasdaq.com/api/quote/${T}/eps`, { "User-Agent": UA, Accept: "application/json" }],
  ["Yahoo chart", `https://query1.finance.yahoo.com/v8/finance/chart/${T}?range=1mo&interval=1d`, { "User-Agent": UA }],
  ["Yahoo ZQ", "https://query1.finance.yahoo.com/v8/finance/chart/ZQZ26.CBT?range=5d&interval=1d", { "User-Agent": UA }],
  ["Yahoo fc cookie", "https://fc.yahoo.com", { "User-Agent": UA }],
  ["SEC tickers", "https://www.sec.gov/files/company_tickers.json", { "User-Agent": SEC_UA }],
  ["SEC submissions", "https://data.sec.gov/submissions/CIK0001326801.json", { "User-Agent": SEC_UA }],
  ["SEC facts", "https://data.sec.gov/api/xbrl/companyfacts/CIK0001326801.json", { "User-Agent": SEC_UA }],
  ["FRED csv", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS", { "User-Agent": UA }],
  ["FRED release cal", "https://fred.stlouisfed.org/releases/calendar", { "User-Agent": UA }],
  ["CME FedWatch", "https://www.cmegroup.com/CmeWS/mvc/MeetingCalendar/GetMeetingDetail", { "User-Agent": UA }],
  ["CME fedwatch page", "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html", { "User-Agent": UA }],
  ["investing earnings", "https://www.investing.com/earnings-calendar/", { "User-Agent": UA }],
  ["investing econ", "https://www.investing.com/economic-calendar/", { "User-Agent": UA }],
  ["StockAnalysis fin", `https://stockanalysis.com/stocks/${T.toLowerCase()}/financials/?p=quarterly`, { "User-Agent": UA }],
  ["StockAnalysis fcst", `https://stockanalysis.com/stocks/${T.toLowerCase()}/forecast/`, { "User-Agent": UA }],
  ["StockAnalysis earn", "https://stockanalysis.com/stocks/meta/earnings/", { "User-Agent": UA }],
  ["Macrotrends rev", `https://www.macrotrends.net/stocks/charts/${T}/meta/revenue`, { "User-Agent": UA }],
  ["Fed calendar", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { "User-Agent": UA }],
  ["Treasury", "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202610", { "User-Agent": UA }],
  ["GDELT", "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=3&query=%22Meta%20Platforms%22", { "User-Agent": UA }],
  ["Finviz", `https://finviz.com/quote.ashx?t=${T}`, { "User-Agent": UA }],
];
for (const [name, url, headers] of tests) {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers, signal: ctl.signal });
    const txt = await r.text();
    clearTimeout(to);
    console.log(`${r.status === 200 ? "OK  " : "FAIL"} ${name.padEnd(18)} ${r.status} ${txt.length}B  ${txt.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(18)} ${e.name}: ${e.message}`);
  }
}
