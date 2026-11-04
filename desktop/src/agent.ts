/* Trading-setup engine for the Agent tab. Plain, transparent maths (EMAs, RSI, MACD, ATR, swing structure and the shape of the
   forming candle) turned into a score and a written read in English and Persian. No outside AI service is involved. */
import type { QCandle } from "./qfex";

export type Bi = { en: string; fa: string };
export const TF_SEC: Record<string, number> = { "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
export const TF_LIST = ["5m", "15m", "1h", "4h", "1d"];
const b = (en: string, fa: string): Bi => ({ en, fa });

export const FA_NAME: Record<string, string> = {
  BTC: "بیت‌کوین", ETH: "اتریوم", SOL: "سولانا", XRP: "ریپل", DOGE: "دوج‌کوین", BNB: "بایننس‌کوین", ADA: "کاردانو", LINK: "چین‌لینک",
  AVAX: "آوالانچ", TRX: "ترون", DOT: "پولکادات", LTC: "لایت‌کوین", HYPE: "هایپرلیکوید", SUI: "سویی", TON: "تون", PEPE: "پپه",
};

export type Analysis = {
  base: string;
  tf: string;
  price: number;
  score: number;
  bias: "bull" | "bear" | "flat";
  label: Bi;
  setup: Bi;
  headline: Bi;
  closeAt: number; // ms
  forming: boolean;
  candle: { o: number; h: number; l: number; c: number; bodyPct: number; upPct: number; loPct: number; closePos: number; rangeAtr: number; volPace: number | null; green: boolean };
  ind: { ema20: number; ema50: number; rsi: number; hist: number; atr: number; roc: number };
  res: number | null;
  sup: number | null;
  structure: Bi;
  candleLines: Bi[];
  patterns: Bi[];
  bull: Bi;
  bear: Bi;
  risks: Bi[];
  plan: Bi;
  why: Bi[];
  confirmations: number;
};

export const ema = (v: number[], n: number) => {
  const k = 2 / (n + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i ? x * k + out[i - 1] * (1 - k) : x));
  return out;
};
export const rsiOf = (c: number[], n = 14) => {
  if (c.length <= n) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    d >= 0 ? (g += d) : (l -= d);
  }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
};
export const atrOf = (r: QCandle[], n = 14) => {
  if (r.length < 2) return 0;
  const tr = r.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - r[i - 1].close), Math.abs(x.low - r[i - 1].close)) : x.high - x.low));
  let a = tr.slice(1, n + 1).reduce((s, v) => s + v, 0) / Math.min(n, tr.length - 1);
  for (let i = n + 1; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
};
const fmt = (v: number) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4));
const pct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function analyze(base: string, tf: string, rows: QCandle[], nowMs = Date.now()): Analysis | null {
  const span = TF_SEC[tf];
  if (!span || rows.length < 40) return null;
  const last = rows[rows.length - 1];
  const forming = (last.time + span) * 1000 > nowMs && last.time * 1000 <= nowMs;
  const closed = forming ? rows.slice(0, -1) : rows;
  const cur = forming ? last : closed[closed.length - 1];
  const prev = closed[closed.length - 1];
  const prev2 = closed[closed.length - 2];
  if (!prev2) return null;
  const closeAt = forming ? (last.time + span) * 1000 : (Math.floor(nowMs / 1000 / span) + 1) * span * 1000;
  const price = cur.close;
  const cl = closed.map((x) => x.close);
  const e20 = ema(cl, 20), e50 = ema(cl, 50);
  const e26 = ema(cl, 26);
  const macdLine = ema(cl, 12).map((v, i) => v - e26[i]);
  const sig = ema(macdLine, 9);
  const hist = macdLine.map((v, i) => v - sig[i]);
  const H = hist[hist.length - 1], H1 = hist[hist.length - 2];
  const atr = atrOf(closed) || price * 0.005;
  const rsi = rsiOf(cl);
  const roc = (cl[cl.length - 1] - cl[Math.max(0, cl.length - 11)]) / atr;
  const E20 = e20[e20.length - 1], E50 = e50[e50.length - 1];

  // swing structure (3 candles each side)
  const sh: number[] = [], sl: number[] = [];
  const from = Math.max(3, closed.length - 120);
  for (let i = from; i < closed.length - 3; i++) {
    let hi = true, lo = true;
    for (let k = 1; k <= 3; k++) {
      if (closed[i].high <= closed[i - k].high || closed[i].high < closed[i + k].high) hi = false;
      if (closed[i].low >= closed[i - k].low || closed[i].low > closed[i + k].low) lo = false;
    }
    if (hi) sh.push(closed[i].high);
    if (lo) sl.push(closed[i].low);
  }
  const up = sh.length >= 2 && sl.length >= 2 && sh[sh.length - 1] > sh[sh.length - 2] && sl[sl.length - 1] > sl[sl.length - 2];
  const dn = sh.length >= 2 && sl.length >= 2 && sh[sh.length - 1] < sh[sh.length - 2] && sl[sl.length - 1] < sl[sl.length - 2];
  const structure = up ? b("Higher highs and higher lows (uptrend structure)", "سقف‌ها و کف‌های بالاتر (ساختار روند صعودی)") : dn ? b("Lower highs and lower lows (downtrend structure)", "سقف‌ها و کف‌های پایین‌تر (ساختار روند نزولی)") : b("Mixed highs and lows (range / transition)", "سقف و کف‌های مخلوط (رنج یا گذار)");
  const recent = closed.slice(-60);
  const resAbove = [...sh, ...recent.map((x) => x.high)].filter((v) => v > price * 1.0005).sort((x, y) => x - y)[0];
  const supBelow = [...sl, ...recent.map((x) => x.low)].filter((v) => v < price * 0.9995).sort((x, y) => y - x)[0];
  const res = resAbove ?? null, sup = supBelow ?? null;

  // the (forming) candle
  const range = Math.max(cur.high - cur.low, 1e-12);
  const body = Math.abs(cur.close - cur.open);
  const green = cur.close >= cur.open;
  const upW = cur.high - Math.max(cur.open, cur.close), loW = Math.min(cur.open, cur.close) - cur.low;
  const closePos = (cur.close - cur.low) / range;
  const avgVol = closed.slice(-20).reduce((s, x) => s + (x.volume || 0), 0) / Math.min(20, closed.length);
  const frac = forming ? clamp((nowMs / 1000 - cur.time) / span, 0.08, 1) : 1;
  const volPace = avgVol > 0 && cur.volume ? cur.volume / frac / avgVol : null;
  const rangeAtr = range / atr;
  const cd = { o: cur.open, h: cur.high, l: cur.low, c: cur.close, bodyPct: (body / range) * 100, upPct: (upW / range) * 100, loPct: (loW / range) * 100, closePos, rangeAtr, volPace, green };

  // patterns
  const patterns: Bi[] = [];
  const bodyP = body / range;
  const pBody = [Math.min(prev.open, prev.close), Math.max(prev.open, prev.close)];
  const cBody = [Math.min(cur.open, cur.close), Math.max(cur.open, cur.close)];
  const prevGreen = prev.close >= prev.open;
  if (forming && frac < 0.35) patterns.push(b("The candle is still young, so its shape can change a lot.", "کندل هنوز تازه است و شکلش می‌تواند خیلی عوض شود."));
  if (bodyP < 0.12) patterns.push(b("Doji: open and close are almost equal, so buyers and sellers are balanced for now.", "دوجی: قیمت باز و بسته‌شدن تقریباً برابرند؛ فعلاً خریدار و فروشنده برابرند."));
  if (loW >= 2 * body && upW <= body * 0.8 && closePos >= 0.6 && bodyP >= 0.05) patterns.push(b("Hammer shape: price dipped and was pushed back up, a sign of buyers defending the low.", "شکل چکش: قیمت پایین رفت و دوباره بالا آمد؛ نشانه‌ی دفاع خریداران از کف."));
  if (upW >= 2 * body && loW <= body * 0.8 && closePos <= 0.4 && bodyP >= 0.05) patterns.push(b("Shooting-star shape: price spiked up and was sold back down, a sign of sellers rejecting the high.", "شکل ستاره‌ی دنباله‌دار: قیمت بالا رفت و فروش آن را پایین آورد؛ نشانه‌ی رد شدن سقف توسط فروشندگان."));
  if (green && !prevGreen && cBody[0] <= pBody[0] && cBody[1] >= pBody[1] && body > 0) patterns.push(b("Bullish engulfing: the green body covers the previous red body.", "انگالفینگ صعودی: بدنه‌ی سبز کل بدنه‌ی قرمز قبلی را پوشانده است."));
  if (!green && prevGreen && cBody[0] <= pBody[0] && cBody[1] >= pBody[1] && body > 0) patterns.push(b("Bearish engulfing: the red body covers the previous green body.", "انگالفینگ نزولی: بدنه‌ی قرمز کل بدنه‌ی سبز قبلی را پوشانده است."));
  if (cur.high < prev.high && cur.low > prev.low) patterns.push(b("Inside bar: the candle sits inside the previous one, a pause that often comes before a bigger move.", "اینساید بار: کندل داخل کندل قبلی است؛ مکثی که معمولاً پیش از حرکت بزرگ‌تر می‌آید."));
  if (bodyP >= 0.7 && rangeAtr >= 0.8) patterns.push(green ? b("Strong green body with little wick: buyers dominated this candle.", "بدنه‌ی سبز قوی با سایه‌ی کم: خریداران بر این کندل مسلط بودند.") : b("Strong red body with little wick: sellers dominated this candle.", "بدنه‌ی قرمز قوی با سایه‌ی کم: فروشندگان بر این کندل مسلط بودند."));
  if (cur.close > prev.high) patterns.push(b("Trading above the previous candle's high (" + fmt(prev.high) + ").", "قیمت بالای سقف کندل قبلی (" + fmt(prev.high) + ") است."));
  if (cur.close < prev.low) patterns.push(b("Trading below the previous candle's low (" + fmt(prev.low) + ").", "قیمت پایین کف کندل قبلی (" + fmt(prev.low) + ") است."));

  const candleLines: Bi[] = [
    b((green ? "Green" : "Red") + " candle, body " + Math.round(cd.bodyPct) + "% of its range; upper wick " + Math.round(cd.upPct) + "%, lower wick " + Math.round(cd.loPct) + "%.", (green ? "کندل سبز" : "کندل قرمز") + "، بدنه " + Math.round(cd.bodyPct) + "٪ کل دامنه؛ سایه‌ی بالا " + Math.round(cd.upPct) + "٪ و سایه‌ی پایین " + Math.round(cd.loPct) + "٪."),
    closePos >= 0.75 ? b("It is trading in the top " + Math.round((1 - closePos) * 100) + "% of its range: buyers are in control right now.", "قیمت در " + Math.round((1 - closePos) * 100) + "٪ بالای دامنه است: فعلاً خریداران کنترل را دارند.") : closePos <= 0.25 ? b("It is trading in the bottom " + Math.round(closePos * 100) + "% of its range: sellers are in control right now.", "قیمت در " + Math.round(closePos * 100) + "٪ پایین دامنه است: فعلاً فروشندگان کنترل را دارند.") : b("It is in the middle of its range, with no clear winner yet.", "قیمت وسط دامنه است و هنوز برنده‌ی مشخصی نیست."),
    b("Range so far is " + rangeAtr.toFixed(1) + "× the average candle (ATR)" + (rangeAtr > 1.6 ? ": a wide, stretched candle." : rangeAtr < 0.5 ? ": a quiet candle." : "."), "دامنه‌ی تا اینجا " + rangeAtr.toFixed(1) + " برابر کندل میانگین (ATR) است" + (rangeAtr > 1.6 ? ": کندلی بزرگ و کشیده." : rangeAtr < 0.5 ? ": کندلی آرام." : ".")),
  ];
  if (volPace != null) candleLines.push(b("Volume pace is " + volPace.toFixed(1) + "× the 20-candle average" + (volPace > 1.4 ? " (heavy participation)." : volPace < 0.6 ? " (thin participation, moves are less trustworthy)." : "."), "سرعت حجم " + volPace.toFixed(1) + " برابر میانگین ۲۰ کندل است" + (volPace > 1.4 ? " (مشارکت بالا)." : volPace < 0.6 ? " (مشارکت کم؛ حرکت‌ها کمتر قابل‌اعتمادند)." : ".")));

  // score
  let s = 0;
  s += (price > E20 ? 8 : -8) + (E20 > E50 ? 10 : -10) + (price > E50 ? 7 : -7);
  s += (H > 0 ? 10 : -10) + (H > H1 ? 6 : -6) + (macdLine[macdLine.length - 1] > 0 ? 4 : -4);
  const rs = clamp((rsi - 50) * 0.6, -15, 15);
  s += Math.abs(rsi - 50) > 25 ? rs * 0.45 : rs;
  s += clamp(roc * 5, -15, 15);
  s += up ? 15 : dn ? -15 : 0;
  s += (closePos - 0.5) * 2 * Math.min(1, rangeAtr) * 10;
  if (volPace && volPace > 1.3) s += Math.sign(s) * 5;
  const score = Math.round(clamp(s, -100, 100));
  const bias: "bull" | "bear" | "flat" = score >= 25 ? "bull" : score <= -25 ? "bear" : "flat";
  const strong = Math.abs(score) >= 60;
  const label = bias === "bull" ? (strong ? b("Strong bullish momentum", "مومنتوم صعودی قوی") : b("Bullish momentum", "مومنتوم صعودی")) : bias === "bear" ? (strong ? b("Strong bearish momentum", "مومنتوم نزولی قوی") : b("Bearish momentum", "مومنتوم نزولی")) : b("No clear momentum", "مومنتوم مشخصی نیست");

  const conf = [price > E20 && E20 > E50, H > 0 && H > H1, rsi > 52 && rsi < 78, up, closePos > 0.6].filter(Boolean).length;
  const confBear = [price < E20 && E20 < E50, H < 0 && H < H1, rsi < 48 && rsi > 22, dn, closePos < 0.4].filter(Boolean).length;
  const confirmations = bias === "bear" ? confBear : conf;

  // what kind of setup is this
  let setup: Bi;
  const nearRes = res != null && (res - price) / atr < 0.6, nearSup = sup != null && (price - sup) / atr < 0.6;
  if (bias === "bull" && nearRes) setup = b("Breakout attempt at resistance", "تلاش برای شکست مقاومت");
  else if (bias === "bear" && nearSup) setup = b("Breakdown attempt at support", "تلاش برای شکست حمایت");
  else if (bias === "bull") setup = b("Trend continuation (long bias)", "ادامه‌ی روند (تمایل به خرید)");
  else if (bias === "bear") setup = b("Trend continuation (short bias)", "ادامه‌ی روند (تمایل به فروش)");
  else if (cur.high < prev.high && cur.low > prev.low) setup = b("Compression: waiting for a breakout", "فشردگی: منتظر شکست");
  else if (nearSup && closePos > 0.55) setup = b("Possible bounce from support", "احتمال برگشت از حمایت");
  else if (nearRes && closePos < 0.45) setup = b("Possible rejection at resistance", "احتمال برگشت از مقاومت");
  else setup = b("No clear edge, better to wait", "مزیت مشخصی نیست؛ بهتر است منتظر بمانیم");

  const tfFa = tf.replace("m", " دقیقه").replace("h", " ساعته").replace("d", " روزه").replace(/ دقیقه$/, " دقیقه‌ای");
  const nameFa = FA_NAME[base] || base;
  const sc = (score > 0 ? "+" : "") + score;
  const headline = b(base + " shows " + label.en.toLowerCase() + " on the " + tf + " (score " + sc + ").", nameFa + " روی تایم‌فریم " + tfFa + " " + label.fa + " دارد (امتیاز " + sc + ").");

  const bull = res != null
    ? b("A candle close above " + fmt(res) + " (" + pct((res / price - 1) * 100) + ") would confirm buyers. A first target is about " + fmt(res + atr) + " (one ATR beyond it).", "بسته‌شدن کندل بالای " + fmt(res) + " (" + pct((res / price - 1) * 100) + ") خریداران را تأیید می‌کند. هدف اول حدود " + fmt(res + atr) + " (یک ATR بالاتر از آن) است.")
    : b("Price is at its recent highs, so there is no nearby resistance; momentum can run, but chasing is risky.", "قیمت در سقف‌های اخیر است و مقاومت نزدیکی نیست؛ مومنتوم می‌تواند ادامه دهد ولی دنبال‌کردن پرریسک است.");
  const bear = sup != null
    ? b("A candle close below " + fmt(sup) + " (" + pct((sup / price - 1) * 100) + ") would break the recent floor. A first downside area is about " + fmt(sup - atr) + ".", "بسته‌شدن کندل زیر " + fmt(sup) + " (" + pct((sup / price - 1) * 100) + ") کف اخیر را می‌شکند. اولین ناحیه‌ی ریزش حدود " + fmt(sup - atr) + " است.")
    : b("Price is at its recent lows, so there is no nearby support; selling can extend, but a sharp bounce is also possible.", "قیمت در کف‌های اخیر است و حمایت نزدیکی نیست؛ ریزش می‌تواند ادامه یابد ولی برگشت تند هم ممکن است.");

  const risks: Bi[] = [];
  if (rsi >= 72) risks.push(b("RSI is " + rsi.toFixed(0) + " (overbought): a pullback or a long upper wick is more likely.", "RSI برابر " + rsi.toFixed(0) + " است (اشباع خرید): پولبک یا سایه‌ی بالایی بلند محتمل‌تر است."));
  if (rsi <= 28) risks.push(b("RSI is " + rsi.toFixed(0) + " (oversold): a relief bounce is more likely.", "RSI برابر " + rsi.toFixed(0) + " است (اشباع فروش): برگشت کوتاه محتمل‌تر است."));
  if (rangeAtr > 1.8) risks.push(b("The candle is already very wide; late entries have a poor risk-to-reward.", "کندل از قبل خیلی بزرگ است؛ ورود دیرهنگام نسبت ریسک به سود ضعیفی دارد."));
  if (volPace != null && volPace < 0.6) risks.push(b("Volume is thin, so a breakout may fail.", "حجم کم است و ممکن است شکست ناموفق باشد."));
  if (bias === "bull" && upW / range > 0.35 && forming) risks.push(b("A long upper wick is forming: sellers are leaning on the high.", "سایه‌ی بالایی بلندی در حال شکل‌گیری است: فروشندگان روی سقف فشار می‌آورند."));
  if (bias === "bear" && loW / range > 0.35 && forming) risks.push(b("A long lower wick is forming: buyers are stepping in at the low.", "سایه‌ی پایینی بلندی در حال شکل‌گیری است: خریداران در کف وارد می‌شوند."));
  if (bias !== "flat" && H * (bias === "bull" ? 1 : -1) < H1 * (bias === "bull" ? 1 : -1)) risks.push(b("MACD momentum is fading compared with the last candle.", "قدرت MACD نسبت به کندل قبل در حال کم‌شدن است."));
  if (!risks.length) risks.push(b("No special warning signs; normal market risk applies.", "نشانه‌ی هشدار خاصی نیست؛ ریسک معمول بازار برقرار است."));

  const plan = bias === "bull"
    ? b("If the candle closes near its high" + (res ? " and above " + fmt(res) : "") + ", the structure stays bullish. If it gives back most of its gains before the close, the top becomes an upper wick and the signal weakens.", "اگر کندل نزدیک سقفش" + (res ? " و بالای " + fmt(res) : "") + " ببندد، ساختار صعودی می‌ماند. اگر پیش از بسته‌شدن بیشتر سودش را پس بدهد، سقف به سایه‌ی بالایی تبدیل می‌شود و سیگنال ضعیف می‌شود.")
    : bias === "bear"
      ? b("If the candle closes near its low" + (sup ? " and below " + fmt(sup) : "") + ", the structure stays bearish. If it recovers most of its loss before the close, the low becomes a lower wick and the signal weakens.", "اگر کندل نزدیک کفش" + (sup ? " و زیر " + fmt(sup) : "") + " ببندد، ساختار نزولی می‌ماند. اگر پیش از بسته‌شدن بیشتر ضررش را جبران کند، کف به سایه‌ی پایینی تبدیل می‌شود و سیگنال ضعیف می‌شود.")
      : b("Wait for a close beyond " + (sup ? fmt(sup) : "the recent low") + " or " + (res ? fmt(res) : "the recent high") + " before acting.", "منتظر بسته‌شدن کندل بیرون از " + (sup ? fmt(sup) : "کف اخیر") + " یا " + (res ? fmt(res) : "سقف اخیر") + " بمان.");

  const why: Bi[] = [];
  const sgn = bias === "bear" ? -1 : 1;
  if (bias !== "flat") {
    if ((price - E20) * sgn > 0 && (E20 - E50) * sgn > 0) why.push(sgn > 0 ? b("price is above EMA20 and EMA50 (trend up)", "قیمت بالای EMA20 و EMA50 است (روند صعودی)") : b("price is below EMA20 and EMA50 (trend down)", "قیمت زیر EMA20 و EMA50 است (روند نزولی)"));
    if (H * sgn > 0) why.push(sgn > 0 ? b("MACD momentum is positive" + (H > H1 ? " and rising" : ""), "مومنتوم MACD مثبت است" + (H > H1 ? " و در حال رشد" : "")) : b("MACD momentum is negative" + (H < H1 ? " and falling" : ""), "مومنتوم MACD منفی است" + (H < H1 ? " و در حال افت" : "")));
    if ((rsi - 50) * sgn > 4) why.push(b("RSI is " + rsi.toFixed(0), "RSI برابر " + rsi.toFixed(0) + " است"));
    if ((sgn > 0 && up) || (sgn < 0 && dn)) why.push(sgn > 0 ? b("highs and lows keep rising", "سقف و کف‌ها مدام بالاتر می‌روند") : b("highs and lows keep falling", "سقف و کف‌ها مدام پایین‌تر می‌روند"));
    if ((closePos - 0.5) * sgn > 0.25) why.push(sgn > 0 ? b("the candle is trading near its high", "کندل نزدیک سقف خودش معامله می‌شود") : b("the candle is trading near its low", "کندل نزدیک کف خودش معامله می‌شود"));
    if (volPace && volPace > 1.3) why.push(b("volume is " + volPace.toFixed(1) + "x its average", "حجم " + volPace.toFixed(1) + " برابر میانگین است"));
  } else why.push(b("trend, momentum and candle do not agree with each other", "روند، مومنتوم و کندل با هم هم‌جهت نیستند"));
  return { base, tf, price, score, bias, label, setup, headline, closeAt, forming, candle: cd, ind: { ema20: E20, ema50: E50, rsi, hist: H, atr, roc }, res, sup, structure, candleLines, patterns, bull, bear, risks, plan, why, confirmations };
}

export const left = (closeAt: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((closeAt - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(sec).padStart(2, "0");
};
export const fmtPrice = fmt;
