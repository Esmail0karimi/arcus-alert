/* Visual how-to: screenshots with numbered markers + short steps, English and Persian. */
import React, { useEffect, useState } from "react";
import g1 from "./guide/g1.jpg";
import g2 from "./guide/g2.jpg";
import g3 from "./guide/g3.jpg";
import g4 from "./guide/g4.jpg";
import g5 from "./guide/g5.jpg";
import g6 from "./guide/g6.jpg";
import g7 from "./guide/g7.jpg";
import g8 from "./guide/g8.jpg";
import g9 from "./guide/g9.jpg";

type Item = { img: string; en: [string, string[]]; fa: [string, string[]] };
const ITEMS: Item[] = [
  { img: g1,
    en: ["Markets from several exchanges", ["Each line at the top is an exchange with its live status. Click a line to show or hide that exchange.", "The category chips split the list into Crypto, RWA (stocks, indices) and Commodities.", "ⓘ explains what a market is, in your language.", "☆ adds a market to one of your watchlists."]],
    fa: ["بازارهای چند صرافی", ["هر خط بالای صفحه یک صرافی است و وضعیت زنده‌اش را نشان می‌دهد. با کلیک روی آن، نمادهای آن صرافی نمایش داده یا پنهان می‌شوند.", "دسته‌بندی‌ها لیست را به کریپتو، RWA (سهام و شاخص) و کامودیتی تقسیم می‌کنند.", "دکمه ⓘ توضیح می‌دهد این بازار چیست، به زبان خودتان.", "ستاره ☆ بازار را به یکی از واچ‌لیست‌هایتان اضافه می‌کند."]] },
  { img: g2,
    en: ["What is this market?", ["Press ⓘ next to any symbol (also in the chart tab).", "Pick a language: the description is taken from Wikipedia in that language.", "Open the full article, translate it or search the web with the buttons below.", "Open chart jumps straight to the chart."]],
    fa: ["این بازار چیست؟", ["کنار هر نماد (و در تب چارت) روی ⓘ بزنید.", "زبان را انتخاب کنید: توضیح از ویکی‌پدیای همان زبان می‌آید.", "با دکمه‌های پایین مقاله‌ی کامل را باز کنید، ترجمه کنید یا در وب جستجو کنید.", "Open chart شما را مستقیم به چارت می‌برد."]] },
  { img: g3,
    en: ["The chart tab", ["Left rail: drawing tools. T adds text notes.", "Timeframe selector.", "Lin / Log switches the price scale (bottom right).", "ƒx opens indicators, ⤴ Share shares your analysis, ★ saves the market to a watchlist."]],
    fa: ["تب چارت", ["نوار سمت چپ: ابزارهای رسم. دکمه T یادداشت متنی می‌گذارد.", "انتخاب تایم‌فریم.", "Lin / Log مقیاس قیمت را معمولی یا لگاریتمی می‌کند (پایین سمت راست).", "ƒx اندیکاتورها را باز می‌کند، ⤴ Share تحلیل را به اشتراک می‌گذارد و ★ بازار را در واچ‌لیست ذخیره می‌کند."]] },
  { img: g4,
    en: ["Drawing and editing", ["Pick a tool, click the chart (trend line 2 clicks, channel 3, long/short 1).", "Click a shape to select it; drag the body to move it, drag the dots to resize.", "Double-click a shape (or press ⚙) for its settings: colours, line style, fibonacci levels, extend lines…", "Del deletes, Ctrl+Z / Ctrl+Y undo and redo everything."]],
    fa: ["رسم و ویرایش", ["یک ابزار را انتخاب و روی چارت کلیک کنید (خط روند ۲ کلیک، کانال ۳ کلیک، لانگ/شورت ۱ کلیک).", "روی شکل کلیک کنید تا انتخاب شود؛ بدنه را بکشید تا جابه‌جا شود و نقطه‌ها را بکشید تا اندازه عوض شود.", "روی شکل دوبار کلیک کنید (یا ⚙) تا تنظیماتش باز شود: رنگ، سبک خط، سطح‌های فیبوناچی، امتداد خط و…", "Del حذف می‌کند و Ctrl+Z / Ctrl+Y همه چیز را برمی‌گرداند."]] },
  { img: g5,
    en: ["Indicators", ["Open ƒx.", "SMA, RSI and Vol buttons switch an indicator on or off.", "⚙ next to SMA / RSI sets period, colour and width. RSI has its own pane: drag its border to resize it.", "Volume sits at the bottom of the main chart."]],
    fa: ["اندیکاتورها", ["ƒx را باز کنید.", "دکمه‌های SMA و RSI و Vol اندیکاتور را روشن یا خاموش می‌کنند.", "⚙ کنار SMA و RSI دوره، رنگ و ضخامت را تنظیم می‌کند. RSI پنل جدا دارد و با کشیدن مرزش بزرگ و کوچک می‌شود.", "حجم (Vol) پایین خود چارت اصلی قرار می‌گیرد."]] },
  { img: g6,
    en: ["Make the chart yours", ["Right-click anywhere on the chart.", "Change the background, text, vertical and horizontal grid lines (or hide them) and the candle colours.", "Reset to default restores everything."]],
    fa: ["چارت را شخصی کنید", ["روی هر جای چارت راست‌کلیک کنید.", "رنگ پس‌زمینه، متن، خطوط شبکه‌ی عمودی و افقی (یا مخفی کردنشان) و رنگ کندل‌ها را عوض کنید.", "Reset to default همه را به حالت اول برمی‌گرداند."]] },
  { img: g7,
    en: ["Watchlists", ["Press ☆ on the chart or on a market: choose which watchlist(s) it goes to, or create a new one.", "Tabs in the watchlist panel switch lists; ✎ renames and 🗑 deletes.", "Type in the search box to find any market and press ＋ to add it."]],
    fa: ["واچ‌لیست‌ها", ["روی ☆ در چارت یا در لیست بازارها بزنید: انتخاب کنید به کدام واچ‌لیست برود یا یکی جدید بسازید.", "تب‌های پنل واچ‌لیست بین لیست‌ها جابه‌جا می‌شوند؛ ✎ تغییر نام و 🗑 حذف است.", "در کادر جستجو هر بازاری را پیدا کنید و با ＋ اضافه کنید."]] },
  { img: g8,
    en: ["Share your analysis", ["Press ⤴ Share above the chart.", "Download or copy a picture of the chart with all your drawings.", "Copy analysis code: a friend pastes it with Import and gets your lines on their chart."]],
    fa: ["اشتراک تحلیل", ["روی ⤴ Share بالای چارت بزنید.", "تصویر چارت را با همه‌ی خط‌هایتان دانلود یا کپی کنید.", "Copy analysis code: دوستتان با Import آن را می‌چسباند و خطوط شما روی چارت او می‌آید."]] },
  { img: g9,
    en: ["Price alerts", ["Open the Create tab (or press + Alert on the chart).", "Choose a market and a price; Arcus Alert rings when the price reaches it.", "Alerts sync with the Android app when you sign in."]],
    fa: ["هشدار قیمت", ["تب Create را باز کنید (یا در چارت + Alert را بزنید).", "بازار و قیمت را انتخاب کنید؛ وقتی قیمت به آن برسد آلارم به صدا درمی‌آید.", "با ورود به حساب، آلارم‌ها با اپ اندروید همگام می‌شوند."]] },
];

export function Guide() {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const [lang, setLang] = useState<"en" | "fa">((): "en" | "fa" => (localStorage.getItem("arcus.guideLang") === "en" ? "en" : navigator.language.startsWith("fa") || localStorage.getItem("arcus.guideLang") === "fa" ? "fa" : "en"));
  const pick = (l: "en" | "fa") => {
    setLang(l);
    try {
      localStorage.setItem("arcus.guideLang", l);
    } catch {}
  };
  return (
    <div className="guide">
      {zoom && (
        <div className="guide-zoom" onClick={() => setZoom(null)}>
          <button className="guide-zoom-x" aria-label="Close">✕</button>
          <div className="guide-zoom-box" onClick={(e) => e.stopPropagation()}>
            <img
              src={zoom.src}
              alt={zoom.alt}
              className={full ? "full" : ""}
              onClick={() => setFull((v) => !v)}
              title={full ? "Click to fit the screen" : "Click for actual size"}
            />
          </div>
          <small>{lang === "fa" ? "کلیک روی تصویر: اندازه واقعی / متناسب با صفحه · Esc: بستن" : "Click the picture: actual size / fit · Esc: close"}</small>
        </div>
      )}
      <div className="heading">
        <div>
          <small>{lang === "fa" ? "آموزش تصویری" : "VISUAL GUIDE"}</small>
          <h1>{lang === "fa" ? "راهنمای استفاده" : "How to use Arcus Alert"}</h1>
          <p>{lang === "fa" ? "هر بخش یک تصویر با شماره دارد؛ شماره‌ها با مراحل زیر تصویر یکی هستند." : "Every picture has numbered markers that match the steps below it."}</p>
        </div>
        <div className="guide-lang">
          <button className={lang === "en" ? "on" : ""} onClick={() => pick("en")}>English</button>
          <button className={lang === "fa" ? "on" : ""} onClick={() => pick("fa")}>فارسی</button>
        </div>
      </div>
      <div className="guide-grid" dir={lang === "fa" ? "rtl" : "ltr"}>
        {ITEMS.map((it, i) => {
          const [title, steps] = it[lang as "en" | "fa"];
          return (
            <section className="guide-card" key={i}>
              <h2>
                <span>{i + 1}</span>
                {title}
              </h2>
              <img src={it.img} alt={title} loading="lazy" title="Click to enlarge" onClick={() => { setFull(false); setZoom({ src: it.img, alt: title }); }} />
              <ol>
                {steps.map((t, k) => (
                  <li key={k}>
                    <b>{k + 1}</b>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
