/* Market category: Crypto vs RWA (Stocks / Commodities). Prefers what the Arcus API says, falls back to lists. */
export type Category = "Crypto" | "Stocks" | "Commodities";

const COMMODITIES = new Set(
  "XAU XAG XPT XPD GOLD SILVER PLATINUM PALLADIUM WTI BRENT OIL CRUDE NGAS NATGAS COPPER WHEAT CORN SOY GLD SLV IAU PPLT PALL USO UNG CPER DBC DBA GDX GDXJ".split(
    " ",
  ),
);
const STOCKS = new Set(
  (
    "AAPL MSFT NVDA AMZN GOOGL GOOG META TSLA NFLX AMD INTC COIN MSTR SPY QQQ DIA IWM BA JPM GS V MA WMT COST ORCL CRM " +
    "UBER PLTR SHOP SQ PYPL DIS KO PEP MCD NKE HOOD SNOW ABNB BABA TSM ASML SOFI RIVN LCID NIO PFE JNJ UNH XOM CVX BAC C WFC " +
    "MRNA AVGO QCOM MU ARM SMCI CRWD PANW ZM SPOT ROKU SNAP PINS GME AMC CVNA BRK BRKB ADBE CSCO IBM T VZ TMUS LLY ABBV MRK " +
    "TLT HYG LQD XLE XLF XLK XLV XLY XLP XLI XLU ARKK EEM EFA VOO VTI VEA VWO IVV SMH SOXL TQQQ SQQQ SPXL UPRO RDDT DKNG " +
    "MARA RIOT CLSK HUT BITO IBIT FBTC ETHA GBTC BLK SCHW AXP MS USB PG HD LOW TGT SBUX CAT DE GE HON LMT RTX F GM"
  ).split(" "),
);

const fromText = (v: unknown): Category | null => {
  const t = String(v ?? "").toLowerCase();
  if (!t) return null;
  if (/commod|metal|energy|oil|gold|silver/.test(t)) return "Commodities";
  if (/stock|equit|etf|index|indices|rwa|share|fund|forex|fx/.test(t))
    return "Stocks";
  if (/crypto|perp|coin|token/.test(t)) return "Crypto";
  return null;
};

/** Read a category out of a /v1/markets entry, whatever the field is called. */
export const categoryFromMarket = (m: any): Category | null => {
  if (!m || typeof m !== "object") return null;
  for (const k of [
    "category",
    "assetClass",
    "asset_class",
    "assetType",
    "marketCategory",
    "sector",
    "class",
    "type",
    "marketType",
    "kind",
  ]) {
    const c = fromText(m[k]);
    if (c) return c;
  }
  return null;
};

export const classifySymbol = (
  symbol: string,
  meta?: Record<string, Category>,
): Category => {
  const raw = String(symbol || "")
    .toUpperCase()
    .trim();
  const fromMeta = meta?.[raw];
  if (fromMeta) return fromMeta;
  if (/[-/]/.test(raw)) return "Crypto"; // BTC-USD style perpetuals
  const x = raw.replace(/[^A-Z0-9]/g, "").replace(/(USDT|USDC|USD|PERP)$/, "");
  if (COMMODITIES.has(x)) return "Commodities";
  if (STOCKS.has(x)) return "Stocks";
  return "Crypto";
};

/* ---- sub-groups used by the Market tab ---- */
const METALS = new Set("XAU XAG XPT XPD GOLD SILVER PLATINUM PALLADIUM COPPER GLD SLV IAU PPLT PALL CPER GDX GDXJ".split(" "));
const ENERGY = new Set("WTI BRENT OIL CRUDE NGAS NATGAS GAS USO UNG BRENTOIL CL".split(" "));
const ETFS = new Set(
  "SPY QQQ DIA IWM VOO VTI IVV VEA VWO EEM EFA TLT HYG LQD XLE XLF XLK XLV XLY XLP XLI XLU ARKK SMH SOXL TQQQ SQQQ SPXL UPRO IBIT FBTC ETHA GBTC BITO US500 US100 US30 SPX NDX DJI NAS100 XYZ100 JP225 UK100 DE40 EU50 HK50".split(
    " ",
  ),
);
const FOREX = new Set("EUR GBP JPY CHF AUD CAD NZD CNH CNY KRW MXN TRY BRL INR DXY".split(" "));
export type SubGroup = "Stocks" | "ETFs & Indices" | "Forex" | "Metals" | "Energy" | "Agriculture & other" | "Crypto";
/** Which sub-group a symbol belongs to inside its main category. */
export const subGroup = (symbol: string, cat: Category): SubGroup => {
  const raw = String(symbol || "").toUpperCase();
  const afterColon = raw.includes(":") ? raw.split(":").pop()! : raw;
  const x = afterColon.replace(/[^A-Z0-9]/g, "").replace(/(USDT|USDC|USD|PERP|SWAP)$/, "");
  if (cat === "Commodities") return METALS.has(x) ? "Metals" : ENERGY.has(x) ? "Energy" : "Agriculture & other";
  if (cat === "Stocks") return ETFS.has(x) ? "ETFs & Indices" : FOREX.has(x) ? "Forex" : "Stocks";
  return "Crypto";
};
export const categoryLabel = (c: Category) => (c === "Stocks" ? "RWA" : c);
