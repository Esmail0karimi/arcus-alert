/* Language switch (English / فارسی) for the News tab and the report window. Numbers stay Latin so figures read the same in both. */
import { useEffect, useState } from "react";

export type Lang = "en" | "fa";
const K = "arcus.news.lang";
export const getLang = (): Lang => {
  try {
    return localStorage.getItem(K) === "fa" ? "fa" : "en";
  } catch {
    return "en";
  }
};
export const setLang = (l: Lang) => {
  try {
    localStorage.setItem(K, l);
  } catch {}
  window.dispatchEvent(new Event("arcus:lang"));
};
export function useLang(): Lang {
  const [l, s] = useState<Lang>(getLang());
  useEffect(() => {
    const f = () => s(getLang());
    window.addEventListener("arcus:lang", f);
    return () => window.removeEventListener("arcus:lang", f);
  }, []);
  return l;
}
export const dloc = (fa: boolean) => (fa ? "fa-IR-u-ca-gregory-nu-latn" : undefined);

const TITLES: [RegExp, string][] = [
  [/Non-Farm Employment Change/gi, "تغییر اشتغال غیرکشاورزی (NFP)"],
  [/ADP Non-Farm Employment Change/gi, "اشتغال بخش خصوصی ADP"],
  [/Unemployment Claims/gi, "درخواست بیمه بیکاری"],
  [/Unemployment Rate/gi, "نرخ بیکاری"],
  [/Employment Change/gi, "تغییر اشتغال"],
  [/Average Hourly Earnings/gi, "میانگین دستمزد ساعتی"],
  [/Core PCE Price Index/gi, "شاخص قیمت PCE هسته"],
  [/PCE Price Index/gi, "شاخص قیمت PCE"],
  [/Core CPI/gi, "CPI هسته"],
  [/Flash Manufacturing PMI/gi, "PMI تولیدی (اولیه)"],
  [/Flash Services PMI/gi, "PMI خدمات (اولیه)"],
  [/Manufacturing PMI/gi, "PMI تولیدی"],
  [/Services PMI/gi, "PMI خدمات"],
  [/ISM Manufacturing PMI/gi, "PMI تولیدی ISM"],
  [/ISM Services PMI/gi, "PMI خدمات ISM"],
  [/\bCPI\b/g, "شاخص قیمت مصرف‌کننده (CPI)"],
  [/\bPPI\b/g, "شاخص قیمت تولیدکننده (PPI)"],
  [/Prelim GDP Price Index/gi, "شاخص قیمت GDP (مقدماتی)"],
  [/Advance GDP/gi, "GDP (برآورد اولیه)"],
  [/Prelim GDP/gi, "GDP (مقدماتی)"],
  [/\bGDP\b/g, "تولید ناخالص داخلی (GDP)"],
  [/Core Retail Sales/gi, "خرده‌فروشی هسته"],
  [/Retail Sales/gi, "خرده‌فروشی"],
  [/FOMC Press Conference/gi, "کنفرانس خبری فدرال رزرو (FOMC)"],
  [/FOMC Statement/gi, "بیانیه فدرال رزرو (FOMC)"],
  [/FOMC Meeting Minutes/gi, "صورت‌جلسه فدرال رزرو (FOMC)"],
  [/FOMC interest-rate decision & statement/gi, "تصمیم نرخ بهره و بیانیه فدرال رزرو (FOMC)"],
  [/Federal Funds Rate/gi, "نرخ بهره فدرال"],
  [/Official Bank Rate/gi, "نرخ بهره رسمی بانک"],
  [/Monetary Policy Statement/gi, "بیانیه سیاست پولی"],
  [/Rate Statement/gi, "بیانیه نرخ بهره"],
  [/Cash Rate/gi, "نرخ بهره نقدی"],
  [/Main Refinancing Rate/gi, "نرخ بازتأمین مالی اصلی"],
  [/Press Conference/gi, "کنفرانس خبری"],
  [/Crude Oil Inventories/gi, "ذخایر نفت خام"],
  [/Natural Gas Storage/gi, "ذخایر گاز طبیعی"],
  [/Consumer Confidence/gi, "اعتماد مصرف‌کننده"],
  [/Consumer Sentiment/gi, "احساسات مصرف‌کننده"],
  [/Trade Balance/gi, "تراز تجاری"],
  [/Industrial Production/gi, "تولید صنعتی"],
  [/Durable Goods Orders/gi, "سفارش کالاهای بادوام"],
  [/Building Permits/gi, "مجوزهای ساخت"],
  [/Housing Starts/gi, "شروع ساخت مسکن"],
  [/Existing Home Sales/gi, "فروش خانه‌های موجود"],
  [/New Home Sales/gi, "فروش خانه‌های نو"],
  [/Treasury Auction|Bond Auction|Note Auction/gi, "حراج اوراق"],
  [/Bank Holiday/gi, "تعطیلی بانکی"],
  [/Speaks/gi, "سخنرانی"],
  [/\bm\/m\b/gi, "ماهانه"],
  [/\bq\/q\b/gi, "فصلی"],
  [/\by\/y\b/gi, "سالانه"],
  [/ earnings report$/i, " · گزارش سود"],
];
const WORDS: Record<string, string> = {
  "All markets": "همه بازارها",
  "USD pairs, gold, US indices & crypto": "جفت‌ارزهای دلار، طلا، شاخص‌های آمریکا و کریپتو",
  "EUR pairs & European indices": "جفت‌ارزهای یورو و شاخص‌های اروپا",
  "GBP pairs & UK indices": "جفت‌ارزهای پوند و شاخص‌های بریتانیا",
  "JPY pairs & Nikkei": "جفت‌ارزهای ین و نیکی",
  "AUD pairs": "جفت‌ارزهای دلار استرالیا",
  "NZD pairs": "جفت‌ارزهای دلار نیوزیلند",
  "CAD pairs & oil": "جفت‌ارزهای دلار کانادا و نفت",
  "CHF pairs": "جفت‌ارزهای فرانک",
  "CNY, commodities & Asian markets": "یوان، کالاها و بازارهای آسیا",
  High: "زیاد",
  Medium: "متوسط",
  Low: "کم",
  Holiday: "تعطیلی",
};
/** Event title / scope text in Persian (best effort: known indicator names are translated, company names stay as they are). */
export const faText = (s: string): string => {
  if (WORDS[s]) return WORDS[s];
  if (/^Only /.test(s)) return "فقط " + s.slice(5);
  if (/^Global · /.test(s)) return "جهانی · " + s.slice(9);
  let out = s;
  for (const [re, r] of TITLES) out = out.replace(re, r);
  return out;
};
