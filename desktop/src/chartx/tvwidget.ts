/* Optional full TradingView chart (free Advanced Chart embed). Independent of the built-in chart. */

/** Arcus market name -> TradingView symbol. TradingView's own search box can still change it. */
export const tvSymbol = (market: string): string => {
  const m = (market || "BTC-USD").toUpperCase().trim();
  const perp = /^([A-Z0-9]+)[-/_]?USD[TC]?$/.exec(m);
  if (perp && m.includes("-")) return `BINANCE:${perp[1]}USDT`;
  return m; // stock tokens / indices: bare ticker, TradingView resolves it
};

export const tvInterval = (spanSeconds: number): string => {
  if (spanSeconds >= 604800) return "W";
  if (spanSeconds >= 86400) return "D";
  return String(Math.max(1, Math.round(spanSeconds / 60)));
};

export const mountTradingView = (box: HTMLElement, symbol: string, interval: string) => {
  box.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "tradingview-widget-container";
  wrap.style.cssText = "height:100%;width:100%";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  inner.style.cssText = "height:100%;width:100%";
  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.text = JSON.stringify({
    autosize: true,
    symbol,
    interval,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    backgroundColor: "#040c19",
    allow_symbol_change: true,
    save_image: true,
    hide_side_toolbar: false,
    support_host: "https://www.tradingview.com",
  });
  wrap.append(inner, script);
  box.append(wrap);
};
