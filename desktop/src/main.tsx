import React, { useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { createRoot } from "react-dom/client";
import { createChart, CandlestickSeries, CrosshairMode } from "lightweight-charts";
import { attachChartX, type ChartX } from "./chartx/controller";
import { fetchEvents } from "./events";
import { SessionBar } from "./sessions";
import { IpBadge } from "./ipbadge";
import { News } from "./news";
import { ReportHost } from "./report";
import { Screener } from "./screener";
import { categoryFromMarket, classifySymbol, subGroup, categoryLabel, type Category } from "./category";
import { undoManager } from "./undo";
import { AssetInfo, assetBase, findAsset } from "./assetinfo";
import { Guide } from "./guide";
import "./style.css";
import { auth, db } from "./firebase";
import { ADAPTERS, adapterOf, displayName, startAdapter, sampleCandles, candleNote, candleSrc, getCandles, externalCandles } from "./exchanges";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
type Price = { price: number; source: string; marketId: string; change24h?: number | null };
type Level = { id: string; symbol: string; price: number; mode: string; nearPct: number };
type AlertEvent = { id: string; symbol: string; price: number; actual: number; time: number };
type DrawingPoint = { time: any; price: number; color?: string; width?: number };
type ChartDrawing = {
  id: string;
  tool: string;
  symbol?: string;
  points: DrawingPoint[];
  color?: string;
  width?: number;
};
const TF_SEC: Record<string, number> = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800 };
/** Candle that contains time t. Aligned to the LAST candle we actually have: some sources start candles off the UTC grid (stocks at :30, weekly on Monday, daily at another hour), and an epoch-aligned bucket then falls before the last candle and every live tick was dropped. */
const bucketFrom = (t: number, span: number, anchor?: number) => (anchor ? anchor + Math.floor((t - anchor) / span) * span : Math.floor(t / span) * span);
const TF_LIST = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"];
const STOCKY = /^(AAPL|MSFT|NVDA|TSLA|AMZN|GOOGL|META|NFLX|AMD|COIN|PLTR|MSTR|HOOD|SPY|QQQ)$/;
const DRAWINGS = "arcus-alert-chart-drawings-v1",
  DRAWING_STYLE = "arcus-alert-drawing-style-v1";
declare global {
  interface Window {
    arcusDesktop: any;
  }
}
const TABS = ["Market", "Watchlist", "Chart", "News", "Screener", "Alerts", "Create", "Guide"];
const CANDLE_CACHE = new Map<string, { at: number; candles: any[] }>();
let candle429Until = 0,
  candle429Delay = 15000;
const KEY = "arcus-alert-levels-v1",
  FAV = "arcus-alert-favorites-v1",
  HISTORY = "arcus-alert-history-v1",
  SOUND = "arcus-alert-sound-v1";
function App() {
  const [history, setHistory] = useState<AlertEvent[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(HISTORY) || "[]");
      } catch {
        return [];
      }
    }),
    [showHistory, setShowHistory] = useState(false),
    [sound, setSound] = useState(() => localStorage.getItem(SOUND) || "double"),
    [customSound, setCustomSound] = useState(""),
    [soundStorageReady, setSoundStorageReady] = useState(false),
    [alarmActive, setAlarmActive] = useState(false);
  const [hoverLevel, setHoverLevel] = useState<{ y: number; price: number } | null>(null),
    [chartSearchOpen, setChartSearchOpen] = useState(false),
    [activeTool, setActiveTool] = useState("cursor"),
    [lineColor, setLineColor] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem(DRAWING_STYLE) || "{}").color || "#39c9c2";
      } catch {
        return "#39c9c2";
      }
    }),
    [lineWidth, setLineWidth] = useState(() => {
      try {
        return Number(JSON.parse(localStorage.getItem(DRAWING_STYLE) || "{}").width) || 2;
      } catch {
        return 2;
      }
    }),
    [drawings, setDrawings] = useState<ChartDrawing[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(DRAWINGS) || "[]");
      } catch {
        return [];
      }
    }),
    [editingDrawing, setEditingDrawing] = useState<string | null>(null),
    [editLinePrice, setEditLinePrice] = useState(""),
    [editLineColor, setEditLineColor] = useState("#39c9c2"),
    [editLineWidth, setEditLineWidth] = useState(2),
    [favName, setFavName] = useState(() => localStorage.getItem("arcus.favName") || "Favorites"),
    [flags, setFlags] = useState<Record<string, string>>(() => {
      try {
        return JSON.parse(localStorage.getItem("arcus.flags.v1") || "{}") || {};
      } catch {
        return {};
      }
    }),
    [flagNames, setFlagNames] = useState<Record<string, string>>(() => {
      try {
        return JSON.parse(localStorage.getItem("arcus.flagNames.v1") || "{}") || {};
      } catch {
        return {};
      }
    }),
    [listOrder, setListOrder] = useState<string[]>(() => {
      try {
        const v = JSON.parse(localStorage.getItem("arcus.listOrder.v1") || "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }),
    [tabsOpen, setTabsOpen] = useState(false),
    [bulk, setBulk] = useState(false),
    [sel, setSel] = useState<string[]>([]),
    [flagMenu, setFlagMenu] = useState<{ sym: string; x: number; y: number } | null>(null),
    [flagFilter, setFlagFilter] = useState(""),
    [infoSym, setInfoSym] = useState<string | null>(null),
    [listMenu, setListMenu] = useState<{ sym: string; x: number; y: number } | null>(null),
    [watchGroup, setWatchGroup] = useState("Favorites");
  const [tab, setTab] = useState("Market"),
    [prices, setPrices] = useState<Record<string, Price>>({}),
    [status, setStatus] = useState("Connecting to Arcus…"),
    [exMsg, setExMsg] = useState<Record<string, string>>({}),
    [exLive, setExLive] = useState<Record<string, string>>({}),
    [symbol, setSymbol] = useState(""),
    [query, setQuery] = useState(""),
    [tf, setTf] = useState("15m"),
    [tfMenu, setTfMenu] = useState(false),
    [tfFavs, setTfFavs] = useState<string[]>(() => {
      try {
        const v = JSON.parse(localStorage.getItem("arcus.tfFavs.v1") || "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }),
    [levels, setLevels] = useState<Level[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || "[]");
      } catch {
        return [];
      }
    }),
    [wlists, setWlists] = useState<{ id: string; name: string; items: string[] }[]>(() => {
      try {
        const v = JSON.parse(localStorage.getItem("arcus.watchlists.v1") || "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }),
    [favorites, setFavorites] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(FAV) || "[]");
      } catch {
        return [];
      }
    }),
    [target, setTarget] = useState(""),
    [mode, setMode] = useState("CROSS"),
    [chartStatus, setChartStatus] = useState("Chart is waiting for market data…"),
    [qrOpen, setQrOpen] = useState(false),
    [textOnly, setTextOnly] = useState(false),
    [qrTitle, setQrTitle] = useState("All alerts"),
    [selectedAlert, setSelectedAlert] = useState<string | null>(null),
    [qrImage, setQrImage] = useState(""),
    [qrImages, setQrImages] = useState<string[]>([]),
    [qrIndex, setQrIndex] = useState(0),
    [qrText, setQrText] = useState(""),
    [qrError, setQrError] = useState(""),
    [scannerOpen, setScannerOpen] = useState(false),
    [scanStatus, setScanStatus] = useState("Point your camera at the QR code");
  const qrVideo = useRef<HTMLVideoElement | null>(null),
    cameraStream = useRef<MediaStream | null>(null),
    qrParts = useRef<Record<string, { total: number; parts: Record<number, string> }>>({}),
    lastScannedQr = useRef("");
  const previousPrices = useRef<Record<string, number>>({}),
    alarmAudio = useRef<HTMLAudioElement | null>(null),
    marketChanges = useRef<Record<string, number>>({}),
    marketCategories = useRef<Record<string, Category>>({}),
    marketMetaAt = useRef(0);
  const [user, setUser] = useState<User | null>(null),
    [showAuth, setShowAuth] = useState(false),
    [authMode, setAuthMode] = useState<"login" | "signup">("login"),
    [authEmail, setAuthEmail] = useState(""),
    [authPassword, setAuthPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [authError, setAuthError] = useState("");
  const cloudSyncReady = useRef(false),
    latestCloudState = useRef({ levels, favorites, history, drawings });
  latestCloudState.current = { levels, favorites, history, drawings };
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem("arcus.railOpen") !== "0";
    } catch {
      return true;
    }
  });
  const [watchOpen, setWatchOpen] = useState(() => {
    try {
      const v = localStorage.getItem("arcus.watchOpen");
      return v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("arcus.railOpen", railOpen ? "1" : "0");
      localStorage.setItem("arcus.watchOpen", watchOpen ? "1" : "0");
    } catch {}
  }, [railOpen, watchOpen]);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  // Ids of alerts the user (or another device) deleted. Kept locally so a stale cloud copy can never bring them back.
  const [deletedSet] = useState(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("arcus.deletedLevels") || "[]"));
    } catch {
      return new Set<string>();
    }
  });
  const deletedLevelIds = useRef(deletedSet),
    prevLevelIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const now = new Set(levels.map((l: any) => String(l.id))),
      tomb = deletedLevelIds.current;
    let changed = false;
    now.forEach((id) => {
      if (tomb.delete(id)) changed = true;
    });
    prevLevelIds.current?.forEach((id) => {
      if (!now.has(id) && !tomb.has(id)) {
        tomb.add(id);
        changed = true;
      }
    });
    prevLevelIds.current = now;
    if (changed) {
      const list = Array.from(tomb).slice(-300);
      deletedLevelIds.current = new Set(list);
      try {
        localStorage.setItem("arcus.deletedLevels", JSON.stringify(list));
      } catch {}
    }
  }, [levels]);
  const chartHost = useRef<HTMLDivElement>(null),
    chartApi = useRef<any>(null),
    series = useRef<any>(null);
  const chartSymbolRef = useRef(symbol),
    chartTfRef = useRef(tf),
    liveBarRef = useRef<{ key: string; bar: any } | null>(null),
    chartX = useRef<ChartX | null>(null),
    latestWsPriceRef = useRef<Record<string, { price: number; time: number }>>({});
  const importQrPayload = async (raw: string) => {
    try {
      if (raw.startsWith("ARCUS2PART|")) {
        const fields = raw.split("|");
        if (fields.length !== 5) throw new Error("Invalid QR part");
        const [, id, indexText, totalText, part] = fields;
        const index = Number(indexText),
          total = Number(totalText);
        if (
          !id ||
          !Number.isInteger(index) ||
          !Number.isInteger(total) ||
          total < 2 ||
          index < 0 ||
          index >= total ||
          !part
        )
          throw new Error("Invalid QR part");
        const entry = qrParts.current[id] || (qrParts.current[id] = { total, parts: {} });
        if (entry.total !== total) throw new Error("QR parts do not match");
        entry.parts[index] = part;
        const received = Object.keys(entry.parts).length;
        setScanStatus(
          "Received QR part " +
            received +
            " of " +
            total +
            " · " +
            Math.round((received / total) * 100) +
            "%",
        );
        if (received < total) return false;
        const joined = Array.from({ length: total }, (_, i) => entry.parts[i]).join("");
        delete qrParts.current[id];
        return await importQrPayload("ARCUS2:" + joined);
      }
      let parsed: any;
      if (raw.startsWith("ARCUS2:")) {
        if (!("DecompressionStream" in window))
          throw new Error("Compressed QR import needs a recent Chrome or Edge browser");
        const binary = atob(raw.slice(7));
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        parsed = JSON.parse(await new Response(stream).text());
      } else {
        parsed = JSON.parse(raw);
      }
      if (
        parsed?.app !== "arcus-alert" ||
        ![1, 2].includes(parsed?.version) ||
        !Array.isArray(parsed?.alerts)
      )
        throw new Error("This QR code is not a valid Arcus Alert backup");
      const incoming = parsed.alerts
        .filter(
          (l: any) =>
            l &&
            typeof l.symbol === "string" &&
            Number.isFinite(Number(l.price)) &&
            Number(l.price) > 0,
        )
        .map((l: any) => ({
          id: String(l.id || crypto.randomUUID()),
          symbol: l.symbol,
          price: Number(l.price),
          mode:
            typeof l.mode === "string"
              ? l.mode
              : typeof l.modeName === "string"
                ? l.modeName
                : "CROSS",
          nearPct: Number(l.nearPct) || 0.1,
        }));
      if (!incoming.length) throw new Error("No valid alerts were found in this QR code");
      setLevels((current) => {
        const merged = [...current];
        for (const item of incoming) {
          if (
            !merged.some(
              (existing) =>
                existing.id === item.id ||
                (existing.symbol === item.symbol &&
                  existing.price === item.price &&
                  existing.mode === item.mode),
            )
          )
            merged.push(item);
        }
        return merged;
      });
      setScanStatus("Imported " + incoming.length + " alert(s)");
      setStatus("QR import complete · " + incoming.length + " alert(s) scanned");
      setScannerOpen(false);
      return true;
    } catch (e: any) {
      setScanStatus(e?.message || "Could not read alerts from QR");
      return false;
    }
  };
  const openQrSync = async (alertSet: Level[] = levels, title = "All alerts") => {
    setTextOnly(false);
    if (!alertSet.length) {
      setStatus("No alerts in this group");
      return;
    }
    const payload = JSON.stringify({
      app: "arcus-alert",
      version: 1,
      alerts: alertSet.map(({ symbol, price }) => ({ symbol, price, mode: 1, enabled: true })),
    });
    setQrText(payload);
    setQrError("");
    setQrImage("");
    setQrImages([]);
    setQrIndex(0);
    setQrOpen(true);
    setQrTitle(title);
    try {
      const image = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 8,
        width: 1400,
        scale: 16,
      });
      setQrImages([image]);
      setQrIndex(0);
      setQrImage(image);
    } catch (e: any) {
      setQrError("Could not prepare the QR code. " + (e?.message || ""));
    }
  };
  const openTextExport = () => {
    if (!levels.length) {
      setStatus("No alerts to export");
      return;
    }
    const payload = JSON.stringify({
      app: "arcus-alert",
      version: 1,
      alerts: levels.map(({ symbol, price, mode }) => ({
        symbol,
        price,
        mode: mode === "NEAR" ? 2 : mode === "CROSS" ? 0 : 1,
        enabled: true,
      })),
    });
    setTextOnly(true);
    setQrText(payload);
    setQrError("");
    setQrImage("");
    setQrImages([]);
    setQrIndex(0);
    setQrOpen(true);
    setQrTitle("All alerts · Text export");
  };
  // Exchanges: each one is a toggle; only symbols of enabled exchanges are listed.
  const [exOn, setExOn] = useState<Record<string, boolean>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("arcus.exchanges") || "");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  });
  const isOn = (id: string) => exOn[id] !== false;
  useEffect(() => {
    try {
      localStorage.setItem("arcus.exchanges", JSON.stringify(exOn));
    } catch {}
  }, [exOn]);
  const manyOn = [isOn("arcus"), ...ADAPTERS.map((a) => isOn(a.id))].filter(Boolean).length > 1;
  const dn = (s: string) => {
    const a = adapterOf(s);
    return a ? displayName(s) + (manyOn ? " ·" + a.prefix[0] : "") : s;
  };
  const [mergeDup, setMergeDup] = useState<boolean>(() => localStorage.getItem("arcus.mergeDup") !== "0");
  const symEnabled = (s: string) => {
    const a = adapterOf(s);
    return a ? exOn[a.id] !== false : exOn.arcus !== false;
  };
  const symbols = useMemo(() => {
    const on = Object.keys(prices).filter((s) => {
      const a = adapterOf(s);
      return a ? exOn[a.id] !== false : exOn.arcus !== false;
    });
    if (!mergeDup) return on.sort();
    // Same asset on several exchanges: keep one, the exchange with the best chart/data (own candles and 24h change first).
    const rank: Record<string, number> = { arcus: 5, hyperliquid: 4, lighter: 3, qfex: 2, variational: 1 };
    const keyOf = (s: string) =>
      displayName(s).toUpperCase().replace(/^[A-Z0-9]+:/, "").replace(/-(USD[CT]?|PERP|SWAP)(-.*)?$/, "").replace(/^1000(?=[A-Z])/, "");
    const score = (s: string) => (rank[adapterOf(s)?.id || "arcus"] || 0) + (prices[s]?.change24h != null ? 0.5 : 0);
    const best = new Map<string, string>();
    for (const s of on) {
      const k = keyOf(s),
        cur = best.get(k);
      if (!cur || score(s) > score(cur)) best.set(k, s);
    }
    return Array.from(best.values()).sort();
  }, [prices, exOn, mergeDup]);
  const newsBases = useMemo(() => new Set(symbols.filter((x) => classifySymbol(x, marketCategories.current) === "Stocks").map((x) => assetBase(dn(x)))), [symbols]);
  const [hdrFull, setHdrFull] = useState<boolean>(() => {
    try {
      return localStorage.getItem("arcus.hdrFull") === "1";
    } catch {
      return false;
    }
  });
  const openBase = (b: string) => {
    const hit = symbols.find((x) => assetBase(dn(x)) === b);
    if (hit) {
      setSymbol(hit);
      setTab("Chart");
    }
  };
  const screenerItems = useMemo(
    () => symbols.map((x) => ({ sym: x, name: dn(x), base: assetBase(dn(x)), change: prices[x]?.change24h ?? null, price: prices[x]?.price })),
    [symbols, prices],
  );
  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        const previous = localStorage.getItem("arcus-alert-account-uid") || "";
        if (next && previous && previous !== next.uid) {
          setLevels([]);
          setFavorites([]);
          setHistory([]);
          setDrawings([]);
        }
        if (next) localStorage.setItem("arcus-alert-account-uid", next.uid);
        setUser(next);
      }),
    [],
  );
  useEffect(() => {
    const onPushMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.type === "ARCUS_ALERT_OPEN") {
        if (data.symbol) setSymbol(String(data.symbol));
        setTab("Chart");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onPushMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onPushMessage);
  }, []);
  useEffect(() => {
    if (
      !user ||
      !("serviceWorker" in navigator) ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    let cancelled = false;
    const registerPush = async () => {
      try {
        if (!(await isSupported())) return;
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!vapidKey) return;
        const registration = await navigator.serviceWorker.register("./sw.js");
        const token = await getToken(getMessaging(auth.app), {
          vapidKey,
          serviceWorkerRegistration: registration,
        });
        if (!cancelled && token) {
          localStorage.setItem("arcus-alert-fcm-token", token);
          await setDoc(
            doc(db, "users", user.uid, "devices", token),
            { token, platform: "web", updatedAt: serverTimestamp() },
            { merge: true },
          );
        }
      } catch (error: any) {
        setStatus("Push setup error: " + (error?.message || "Unknown error"));
      }
    };
    void registerPush();
    return () => {
      cancelled = true;
    };
  }, [user]);
  useEffect(() => {
    if (!scannerOpen) return;
    let cancelled = false;
    let frame = 0;
    let busy = false;
    let lastRaw = "";
    let lastReadAt = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const Detector = (window as any).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera access requires HTTPS or localhost.");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        cameraStream.current = stream;
        const video = qrVideo.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const scan = async () => {
          if (cancelled) return;
          const current = qrVideo.current;
          if (current && current.readyState >= 2 && !busy) {
            busy = true;
            try {
              let raw = "";
              if (detector) {
                const codes = await detector.detect(current);
                raw = String(codes.find((code: any) => code.rawValue)?.rawValue || "");
              }
              if (!raw && context && current.videoWidth > 0 && current.videoHeight > 0) {
                const maxWidth = 1280,
                  scale = Math.min(1, maxWidth / current.videoWidth);
                canvas.width = Math.max(1, Math.round(current.videoWidth * scale));
                canvas.height = Math.max(1, Math.round(current.videoHeight * scale));
                context.drawImage(current, 0, 0, canvas.width, canvas.height);
                const frameData = context.getImageData(0, 0, canvas.width, canvas.height);
                const decoded = jsQR(frameData.data, frameData.width, frameData.height, {
                  inversionAttempts: "attemptBoth",
                });
                raw = decoded?.data || "";
              }
              if (raw && (raw !== lastRaw || Date.now() - lastReadAt > 1500)) {
                lastRaw = raw;
                lastReadAt = Date.now();
                await importQrPayload(raw);
              }
            } catch (e: any) {
              setScanStatus(
                e?.message ||
                  "Could not decode this QR code. Adjust distance or lighting and try again.",
              );
            } finally {
              busy = false;
            }
          }
          if (!cancelled) frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (e: any) {
        setScanStatus(
          "Camera unavailable. Allow camera access and try again. " + (e?.message || ""),
        );
      }
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cameraStream.current?.getTracks().forEach((t) => t.stop());
      cameraStream.current = null;
    };
  }, [scannerOpen]);
  useEffect(() => {
    if (!window.arcusDesktop?.isDesktop && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(levels));
  }, [levels]);
  useEffect(() => {
    localStorage.setItem(DRAWINGS, JSON.stringify(drawings));
  }, [drawings]);
  useEffect(() => {
    localStorage.setItem(DRAWING_STYLE, JSON.stringify({ color: lineColor, width: lineWidth }));
  }, [lineColor, lineWidth]);
  useEffect(() => {
    try {
      localStorage.setItem("arcus.listOrder.v1", JSON.stringify(listOrder));
    } catch {}
  }, [listOrder]);
  useEffect(() => {
    try {
      localStorage.setItem("arcus.flagNames.v1", JSON.stringify(flagNames));
    } catch {}
  }, [flagNames]);
  useEffect(() => {
    try {
      localStorage.setItem("arcus.flags.v1", JSON.stringify(flags));
    } catch {}
  }, [flags]);
  useEffect(() => {
    try {
      localStorage.setItem("arcus.watchlists.v1", JSON.stringify(wlists));
    } catch {}
  }, [wlists]);
  useEffect(() => {
    localStorage.setItem(FAV, JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem(HISTORY, JSON.stringify(history.slice(0, 200)));
  }, [history]);
  useEffect(() => {
    localStorage.setItem(SOUND, sound);
  }, [sound]);
  useEffect(() => {
    let active = true;
    const request = indexedDB.open("arcus-alert-settings", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("settings"))
        request.result.createObjectStore("settings");
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("settings", "readonly");
      const get = tx.objectStore("settings").get("customSound");
      get.onsuccess = () => {
        const saved =
          typeof get.result === "string"
            ? get.result
            : localStorage.getItem("arcus-alert-custom-sound") || "";
        if (active && saved) setCustomSound(saved);
      };
      tx.oncomplete = () => {
        db.close();
        if (active) setSoundStorageReady(true);
      };
      tx.onerror = () => {
        db.close();
        if (active) setSoundStorageReady(true);
      };
    };
    request.onerror = () => {
      if (active) setSoundStorageReady(true);
    };
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!soundStorageReady) return;
    const request = indexedDB.open("arcus-alert-settings", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("settings"))
        request.result.createObjectStore("settings");
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("settings", "readwrite");
      if (customSound) tx.objectStore("settings").put(customSound, "customSound");
      else tx.objectStore("settings").delete("customSound");
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  }, [customSound, soundStorageReady]);
  // The web app is the master copy. Nothing is written to the cloud automatically on every edit:
  // the user presses "Sync to Android" (and an automatic push runs at most every 4 hours when there
  // are changes). The cloud is read only once after signing in, to restore an empty browser.
  const SYNC_EVERY_MS = 4 * 60 * 60 * 1000;
  const lastPushedJson = useRef<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [unsynced, setUnsynced] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stateJson = (v: { levels: any[]; favorites: any[]; history: any[]; drawings: any[] }) =>
    JSON.stringify({
      levels: v.levels,
      favorites: v.favorites,
      history: v.history.slice(0, 200),
      drawings: v.drawings,
    });
  useEffect(() => {
    cloudSyncReady.current = false;
    setCloudReady(false);
    if (!user) return;
    let finished = false;
    let unsub: (() => void) | null = null;
    const stateRef = doc(db, "users", user.uid, "appData", "state");
    unsub = onSnapshot(
      stateRef,
      (snapshot) => {
        if (finished) return;
        finished = true;
        setTimeout(() => unsub?.(), 0); // read once
        try {
          const remote = snapshot.exists() ? snapshot.data() : null;
          const cur = latestCloudState.current;
          const localEmpty = !cur.levels.length && !cur.favorites.length && !cur.drawings.length;
          if (remote && localEmpty) {
            const tomb = deletedLevelIds.current;
            const rl = (Array.isArray(remote.levels) ? remote.levels : []).filter(
              (l: any) => !tomb.has(String(l?.id)),
            );
            const rf = Array.isArray(remote.favorites) ? remote.favorites : [];
            const rh = Array.isArray(remote.history) ? remote.history : [];
            const rd = Array.isArray(remote.drawings) ? remote.drawings : [];
            skipUndoOnce();
            setLevels(rl);
            setFavorites(rf);
            setHistory(rh);
            setDrawings(rd);
            lastPushedJson.current = stateJson({
              levels: rl,
              favorites: rf,
              history: rh,
              drawings: rd,
            });
            setSyncMsg({ ok: true, text: "Restored from your account" });
          } else {
            lastPushedJson.current = null; // this browser's data is the master; push when ready
          }
          cloudSyncReady.current = true;
          setCloudReady(true);
        } catch (error: any) {
          setSyncMsg({ ok: false, text: "Could not read your account data: " + (error?.message || error) });
        }
      },
      (error: any) =>
        setSyncMsg({ ok: false, text: "Cloud error: " + (error?.code ? error.code + " · " : "") + error.message }),
    );
    return () => {
      finished = true;
      cloudSyncReady.current = false;
      unsub?.();
    };
  }, [user]);
  useEffect(() => {
    if (!user || !cloudReady) {
      setUnsynced(false);
      return;
    }
    const dirty = lastPushedJson.current !== stateJson({ levels, favorites, history, drawings });
    setUnsynced(dirty);
    if (dirty && syncMsg?.ok) setSyncMsg(null);
  }, [user, cloudReady, levels, favorites, history, drawings]);
  const unsyncedRef = useRef(false);
  unsyncedRef.current = unsynced;
  const syncToCloud = async (auto = false) => {
    if (!user) {
      accountAction();
      return;
    }
    if (!cloudSyncReady.current) {
      setSyncMsg({ ok: false, text: "Still connecting to your account — try again in a moment" });
      return;
    }
    setSyncBusy(true);
    const cur = latestCloudState.current;
    const json = stateJson(cur);
    try {
      await Promise.race([
        setDoc(
          doc(db, "users", user.uid, "appData", "state"),
          {
            levels: cur.levels,
            favorites: cur.favorites,
            history: cur.history.slice(0, 200),
            drawings: cur.drawings,
            schemaVersion: 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("no response from the server within 20 s (check the connection / VPN)")),
            20000,
          ),
        ),
      ]);
      lastPushedJson.current = json;
      try {
        localStorage.setItem("arcus.lastSyncAt", String(Date.now()));
      } catch {}
      setUnsynced(false);
      setSyncMsg({
        ok: true,
        text: (auto ? "Auto-synced " : "Synced to Android ") + new Date().toLocaleTimeString(),
      });
    } catch (error: any) {
      setSyncMsg({
        ok: false,
        text: "Sync failed: " + (error?.code ? error.code + " · " : "") + (error?.message || "unknown error"),
      });
    } finally {
      setSyncBusy(false);
    }
  };
  const syncToCloudRef = useRef(syncToCloud);
  syncToCloudRef.current = syncToCloud;
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      let last = 0;
      try {
        last = Number(localStorage.getItem("arcus.lastSyncAt")) || 0;
      } catch {}
      if (cloudSyncReady.current && unsyncedRef.current && Date.now() - last >= SYNC_EVERY_MS)
        void syncToCloudRef.current(true);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [user]);
  useEffect(() => {
    if (window.arcusDesktop?.isDesktop) {
      window.arcusDesktop.onPrices((d: any) => {
        setPrices(d.prices || {});
        setStatus(
          "Connected · " +
            Object.keys(d.prices || {}).length +
            " markets · " +
            new Date(d.updatedAt).toLocaleTimeString(),
        );
      });
      window.arcusDesktop.onPriceError((e: string) => setStatus("Arcus connection error: " + e));
      return;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1000;
    let lastMarketsFetch = 0;
    let pendingPrices: Record<string, { price: number; source: string; marketId: string }> = {};
    let flushTimer: number | undefined;
    const updateLiveChartCandle = (marketName: string, price: number, time: number) => {
      if (!series.current || marketName.toUpperCase() !== String(chartSymbolRef.current || "").toUpperCase()) return;
      const nowS = Date.now() / 1000;
      if (!Number.isFinite(time) || Math.abs(time - nowS) > 90) time = nowS; // a feed clock that is off must not freeze the candle
      const span = TF_SEC[chartTfRef.current] || 900;
      const anchor = liveBarRef.current?.bar.time ?? chartX.current?.lastCandleTime();
      if (!anchor) return; // candles are still loading; the loader applies the latest tick itself
      const bucket = bucketFrom(time, span, anchor);
      if (bucket < anchor) return; // tick older than the newest candle
      const key = marketName + "|" + chartTfRef.current + "|" + bucket;
      let bar: any;
      if (liveBarRef.current?.key === key) {
        const previous = liveBarRef.current.bar;
        bar = { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price };
      } else if (bucket === anchor && liveBarRef.current) {
        const previous = liveBarRef.current.bar;
        bar = { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price };
      } else bar = { time: bucket, open: liveBarRef.current && bucket > anchor ? liveBarRef.current.bar.close : price, high: price, low: price, close: price, volume: 0 };
      if (bar.time === bucket && bar.open !== price) {
        bar.high = Math.max(bar.high, bar.open);
        bar.low = Math.min(bar.low, bar.open);
      }
      liveBarRef.current = { key, bar };
      // two separate tries: a failing chart series must not stop the module (legend, indicators, countdown) from seeing the tick
      try {
        series.current.update(bar);
      } catch {}
      try {
        chartX.current?.updateBar(bar);
      } catch {}
    };
    const applyPrices = (incoming: any[]) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      // Chart candle updates happen immediately; the React price state is flushed in batches
      // (max ~3 times/second) so a busy feed does not re-render the whole app on every tick.
      for (const item of incoming) {
        const name = String(item?.marketDisplayName || "").toUpperCase();
        const marketId = String(item?.marketId ?? "");
        const price = Number(item?.markPrice ?? item?.price);
        if (!name || !Number.isFinite(price) || price <= 0) continue;
        if (Number.isFinite(item?.change24h)) marketChanges.current[name] = Number(item.change24h);
        pendingPrices[name] = {
          price,
          source: item?.markPrice != null ? "mark" : "oracle",
          marketId,
        };
        let rawTime = Number(item?.markEpochNanos ?? item?.timestamp ?? item?.time);
        const tickTime =
          Number.isFinite(rawTime) && rawTime > 0
            ? rawTime > 1e14
              ? rawTime / 1e9
              : rawTime > 1e11
                ? rawTime / 1000
                : rawTime
            : Date.now() / 1000;
        latestWsPriceRef.current[name] = { price, time: tickTime };
        updateLiveChartCandle(name, price, tickTime);
      }
      if (flushTimer === undefined)
        flushTimer = window.setTimeout(() => {
          flushTimer = undefined;
          const batch = pendingPrices;
          pendingPrices = {};
          setPrices((current) => {
            const next = { ...current };
            for (const name of Object.keys(batch)) {
              const item = batch[name];
              next[name] = {
                price: item.price,
                source: item.source,
                marketId: item.marketId || next[name]?.marketId || "",
                change24h: marketChanges.current[name] ?? next[name]?.change24h ?? null,
              };
            }
            return next;
          });
        }, 350);
    };
    const refreshMarketMeta = async () => {
      if (Date.now() - lastMarketsFetch < 60000) return;
      lastMarketsFetch = Date.now();
      try {
        const response = await fetch("https://api.arcus.xyz/v1/markets", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        const markets = Array.isArray(body) ? body : body.markets;
        if (!Array.isArray(markets)) return;
        const changes: Record<string, number> = {};
        for (const market of markets) {
          const name = String(market?.marketDisplayName || "").toUpperCase();
          const cat = categoryFromMarket(market);
          if (name && cat) marketCategories.current[name] = cat;
          const value = Number(market?.priceChange24h);
          if (name && Number.isFinite(value)) changes[name] = value * 100;
        }
        marketChanges.current = { ...marketChanges.current, ...changes };
        setPrices((current) => {
          const next = { ...current };
          for (const name of Object.keys(next))
            if (Number.isFinite(changes[name]))
              next[name] = { ...next[name], change24h: changes[name] };
          return next;
        });
      } catch {}
    };
    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket("wss://api.arcus.xyz/v1/ws");
        socket.onopen = () => {
          retryDelay = 1000;
          socket?.send(JSON.stringify({ type: "subscribe", channel: "oraclePrices" }));
          void refreshMarketMeta();
          setStatus("Arcus live feed connected · subscribing…");
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data));
            if (message?.type === "error" || Number(message?.status) >= 400) {
              setStatus(
                "Arcus WebSocket error · " +
                  String(message?.message || message?.error || message?.status),
              );
              return;
            }
            if (message?.channel === "oraclePrices") {
              const contents = message.contents;
              if (contents && Array.isArray(contents.prices)) {
                applyPrices(contents.prices);
                setStatus(
                  "Live · " +
                    contents.prices.length +
                    " Arcus prices · " +
                    new Date().toLocaleTimeString(),
                );
              }
            } else if (message?.channel === "markets") {
              void refreshMarketMeta();
            }
          } catch {}
        };
        socket.onerror = () => {
          if (!stopped) setStatus("Arcus live feed interrupted · reconnecting…");
        };
        socket.onclose = () => {
          if (stopped) return;
          setStatus("Arcus WebSocket disconnected · reconnecting…");
          if (retryTimer !== undefined) window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        };
      } catch {
        if (!stopped) {
          setStatus("Arcus WebSocket disconnected · reconnecting…");
          retryTimer = window.setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      }
    };
    connect();
    // EXPERIMENT: extra exchanges (symbols are prefixed, e.g. "QFEX:", "HL:", "LT:", "VR:")
    const exSeen: Record<string, Record<string, number>> = {};
    const liveTimer = window.setInterval(() => {
      const now = Date.now();
      const next: Record<string, string> = {};
      for (const ad of ADAPTERS) {
        const seen = exSeen[ad.id] || {};
        let n = 0,
          last = 0;
        for (const k of Object.keys(seen)) {
          if (seen[k] > now - 15000) n++;
          if (seen[k] > last) last = seen[k];
        }
        if (n) next[ad.id] = "Live · " + n + " " + ad.label + " prices · " + new Date(last).toLocaleTimeString();
      }
      setExLive((v) => (JSON.stringify(v) === JSON.stringify(next) ? v : next));
    }, 1000);
    const stops = ADAPTERS.map((ad) =>
      startAdapter(
        ad,
        (items) => {
          const t = Date.now(),
            seen = (exSeen[ad.id] ||= {});
          for (const it of items) seen[it.marketDisplayName] = t;
          applyPrices(items);
        },
        (rows) => {
          for (const { name: n, cat } of rows) {
            const base = n.slice(ad.prefix.length).replace(/-(USD|PERP|SWAP)$/, "");
            const fromApi = /commod|metal|energy/i.test(cat)
              ? "Commodities"
              : /equit|stock/i.test(cat)
                ? "Stocks"
                : null;
            const guess = classifySymbol(base);
            marketCategories.current[n] =
              fromApi ||
              (guess === "Commodities"
                ? "Commodities"
                : ad.defaultCat === "Stocks" || STOCKY.test(base)
                  ? "Stocks"
                  : "Crypto");
          }
        },
        (msg) => setExMsg((v) => (v[ad.id] === msg ? v : { ...v, [ad.id]: msg })),
      ),
    );
    return () => {
      stops.forEach((s) => s());
      window.clearInterval(liveTimer);
      stopped = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, []);
  useEffect(() => {
    if (!window.arcusDesktop?.isDesktop) return;
    window.arcusDesktop.onNotificationClick((s: string) => {
      if (s) setSymbol(s);
      setChartSearchOpen(false);
      setQuery("");
      setTab("Chart");
    });
  }, []);
  useEffect(() => {
    if (!symbol && symbols.length) setSymbol(symbols[0]);
  }, [symbols, symbol]);
  useEffect(() => {
    chartSymbolRef.current = symbol;
    chartTfRef.current = tf;
    liveBarRef.current = null;
  }, [symbol, tf]);
  useEffect(() => {
    const next = { ...previousPrices.current };
    const fired: AlertEvent[] = [];
    for (const [s, data] of Object.entries(prices)) {
      const now = Number(data.price),
        before = previousPrices.current[s];
      if (Number.isFinite(now) && Number.isFinite(before)) {
        for (const l of levels) {
          if (l.symbol !== s) continue;
          const crossed = (before - l.price) * (now - l.price) <= 0 && before !== now;
          const triggered =
            (l.mode === "NEAR" && Math.abs(now - l.price) / l.price <= 0.001) ||
            ((l.mode === "CROSS" || l.mode === "TOUCH") && crossed);
          if (triggered)
            fired.push({ id: l.id, symbol: s, price: l.price, actual: now, time: Date.now() });
        }
      }
      if (Number.isFinite(now)) next[s] = now;
    }
    previousPrices.current = next;
    if (fired.length) {
      skipUndoOnce();
      setAlertBanners((b) => [...fired, ...b].slice(0, 20));
      setHistory((h) => [...fired, ...h].slice(0, 200));
      setLevels((v) => v.filter((l) => !fired.some((f) => f.id === l.id)));
      for (const f of fired) {
        setAlarmActive(true);
        const title = "Arcus Alert · " + f.symbol,
          body = "Target " + f.price.toLocaleString() + " · Current " + f.actual.toLocaleString();
        if (window.arcusDesktop?.isDesktop) {
          if (sound === "custom" && customSound) {
            window.arcusDesktop.alert({ title, body, sound: "off", symbol: f.symbol });
            try {
              if (alarmAudio.current) {
                alarmAudio.current.pause();
                alarmAudio.current.currentTime = 0;
              }
              alarmAudio.current = new Audio(customSound);
              alarmAudio.current.loop = true;
              void alarmAudio.current.play();
            } catch {}
          } else window.arcusDesktop.alert({ title, body, sound, symbol: f.symbol });
        } else {
          if ("Notification" in window && Notification.permission === "granted") {
            const options: any = {
              body,
              tag: "arcus-" + f.id,
              requireInteraction: true, // stays on screen until you click it
              renotify: true,
              data: { symbol: f.symbol },
            };
            const fallback = () => {
              try {
                const n = new Notification(title, options);
                n.onclick = () => {
                  window.focus();
                  setSymbol(f.symbol);
                  setTab("Chart");
                  n.close();
                };
              } catch {}
            };
            if ("serviceWorker" in navigator)
              navigator.serviceWorker
                .getRegistration()
                .then((reg) => (reg ? reg.showNotification(title, options) : fallback()))
                .catch(fallback);
            else fallback();
          }
          if (sound === "custom" && customSound) {
            try {
              if (alarmAudio.current) {
                alarmAudio.current.pause();
                alarmAudio.current.currentTime = 0;
              }
              alarmAudio.current = new Audio(customSound);
              alarmAudio.current.loop = true;
              void alarmAudio.current.play();
            } catch {}
          } else if (sound !== "off") {
            try {
              const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
              const ctx = new Ctx();
              const count = sound === "triple" ? 3 : sound === "beep" ? 1 : 2;
              for (let i = 0; i < count; i++) {
                const osc = ctx.createOscillator(),
                  gain = ctx.createGain();
                osc.frequency.value = 880;
                gain.gain.value = 0.08;
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime + i * 0.22);
                osc.stop(ctx.currentTime + i * 0.22 + 0.12);
              }
              window.setTimeout(() => void ctx.close(), 1200);
            } catch {}
          }
        }
      }
    }
  }, [prices, levels, sound]);
  useEffect(() => {
    const onChartReset = (event: KeyboardEvent) => {
      if (!(event.altKey && (event.code === "KeyR" || event.key.toLowerCase() === "r"))) return;
      if (tab !== "Chart") return;
      event.preventDefault();
      event.stopPropagation();
      (event as any).stopImmediatePropagation?.();
      resetChart();
    };
    window.addEventListener("keydown", onChartReset, { capture: true });
    document.addEventListener("keydown", onChartReset, { capture: true });
    return () => {
      window.removeEventListener("keydown", onChartReset, true);
      document.removeEventListener("keydown", onChartReset, true);
    };
  }, [tab]);
  useEffect(() => {
    if (tab !== "Chart" || !chartHost.current) return;
    const chart = createChart(chartHost.current, {
      width: chartHost.current.clientWidth,
      height: chartHost.current.clientHeight,
      layout: { background: { color: "#000000" }, textColor: "#91a7c3", attributionLogo: false },
      grid: { vertLines: { color: "#101820" }, horzLines: { color: "#101820" } },
      rightPriceScale: { borderColor: "#24364e" },
      timeScale: { borderColor: "#24364e", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chartApi.current = chart;
    series.current = chart.addSeries(CandlestickSeries, {
      upColor: "#00c9a7",
      downColor: "#f06470",
      borderUpColor: "#00c9a7",
      borderDownColor: "#f06470",
      wickUpColor: "#00c9a7",
      wickDownColor: "#f06470",
    });
    /* Analysis tools (chart types, indicators, drawings, OHLC legend) attach without touching the series. */
    try {
      if (chartHost.current) chartX.current = attachChartX(chart, series.current, chartHost.current);
    } catch (e) {
      console.warn("ChartX unavailable", e);
    }
    const resize = () =>
      chart.applyOptions({
        width: chartHost.current?.clientWidth || 800,
        height: chartHost.current?.clientHeight || 480,
      });
    const observer = new ResizeObserver(resize);
    if (chartHost.current) observer.observe(chartHost.current);
    const onCrosshair = (param: any) => {
      if (!param.point || !series.current) return;
      const p = series.current.coordinateToPrice(param.point.y);
      if (p == null || !Number.isFinite(Number(p))) return;
      setHoverLevel({ y: param.point.y, price: Number(p) });
    };
    chart.subscribeCrosshairMove(onCrosshair);
    window.addEventListener("resize", resize);
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      window.removeEventListener("resize", resize);
      observer.disconnect();
      setHoverLevel(null);
      chartX.current?.destroy();
      chartX.current = null;
      chart.remove();
      chartApi.current = null;
      series.current = null;
    };
  }, [tab]);
  useEffect(() => {
    if (tab !== "Chart" || !symbol) return;
    let cancelled = false;
    const controller = new AbortController();
    const requestSymbol = symbol,
      requestTf = tf;
    setChartStatus("Loading " + requestSymbol + " · " + requestTf + " candles…");
    if (series.current) series.current.setData([]);
    const ex = adapterOf(requestSymbol);
    const isQ = !!ex;
    const load = async () => {
      try {
        const readyAt = Date.now() + 2500;
        while (!cancelled && (!series.current || !chartApi.current) && Date.now() < readyAt)
          await new Promise((r) => setTimeout(r, 40));
        if (cancelled) return;
        if (!series.current || !chartApi.current) throw new Error("Chart is not ready");
        // The live feed provides the numeric market id; wait briefly for it instead of trying the name first
        // (the name is rejected with HTTP 400) and then restarting the whole load when the id arrives.
        const idWaitUntil = Date.now() + 3000;
        while (
          !cancelled &&
          !isQ &&
          !pricesRef.current[requestSymbol]?.marketId &&
          Date.now() < idWaitUntil
        )
          await new Promise((r) => setTimeout(r, 60));
        if (cancelled) return;
        const marketId = pricesRef.current[requestSymbol]?.marketId;
        const marketKeys = isQ ? [] : [
          ...(marketId ? [marketId] : []),
          ...(marketId && marketId !== requestSymbol
            ? [requestSymbol]
            : marketId
              ? []
              : [requestSymbol]),
        ];
        let candles: any[] = [];
        let lastError = "No candle data returned";
        const cacheKey = requestSymbol + "|" + requestTf;
        const cached = CANDLE_CACHE.get(cacheKey);
        if (cached && Date.now() - cached.at < 30000) candles = cached.candles;
        let srcLabel = ex ? (candles.length ? candleSrc[requestSymbol] || ex.label : "") : "Arcus";
        if (ex && !candles.length) {
          try {
            const res = await getCandles(ex, requestSymbol, requestTf, controller.signal);
            candles = res.rows;
            lastError = res.err || lastError;
            srcLabel = res.source;
            if (candles.length) CANDLE_CACHE.set(cacheKey, { at: Date.now(), candles });
            if (candles.length && candleNote[requestSymbol]) setChartStatus(candleNote[requestSymbol]);
          } catch (err: any) {
            if (err?.name === "AbortError" || cancelled) return;
            lastError = err?.message || ex.label + " candle request failed";
          }
          if (!candles.length && ex.ownHistory) {
            const own = sampleCandles(requestSymbol, requestTf);
            if (own.length > 1) {
              candles = own;
              srcLabel = "prices saved by this app";
              setChartStatus(ex.label + ": candles built from prices saved by this app (" + lastError + ")");
            }
          }
          if (!candles.length) {
            // No history available (or blocked): start the chart from the live price and build candles from ticks.
            const until = Date.now() + 4000;
            while (!cancelled && !pricesRef.current[requestSymbol]?.price && Date.now() < until)
              await new Promise((r) => setTimeout(r, 100));
            const px = pricesRef.current[requestSymbol]?.price;
            if (px) {
              const sp = ({ "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800 } as Record<string, number>)[requestTf] || 900;
              const t0 = Math.floor(Date.now() / 1000 / sp) * sp;
              candles = [{ time: t0, open: px, high: px, low: px, close: px, volume: 0 }];
              srcLabel = "live ticks only";
              setChartStatus(ex.label + ": no candle history (" + lastError + ") · building live candles");
            }
          }
        }
        // Phase 1: a small request (250 candles) so the chart appears quickly; the full history follows.
        let fastShown = false;
        const spanByTf: Record<string, number> = {
          "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
          "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800,
        };
        let fullDone = false;
        const quickPhase = async () => {
          if (candles.length || !marketKeys.length) return;
          try {
            const quick = await fetch(
              "https://api.arcus.xyz/v1/candles?market=" +
                encodeURIComponent(marketKeys[0]) +
                "&timeframe=" +
                encodeURIComponent(requestTf) +
                "&to=" +
                Date.now() * 1000 +
                "&countback=250",
              { headers: { Accept: "application/json" }, signal: controller.signal },
            );
            if (quick.ok) {
              const qb = await quick.json();
              const fast = (Array.isArray(qb.candles) ? qb.candles : [])
                .map((c: any) => {
                  const rawTime = Number(c.openTime ?? c.time ?? c.timestamp);
                  return {
                    time: Math.floor(rawTime > 100000000000 ? rawTime / 1000 : rawTime),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close),
                    volume: Number(c.volume ?? c.vol ?? c.v ?? 0),
                  };
                })
                .filter(
                  (c: any) =>
                    Number.isFinite(c.time) &&
                    c.time > 0 &&
                    Number.isFinite(c.open) &&
                    Number.isFinite(c.high) &&
                    Number.isFinite(c.low) &&
                    Number.isFinite(c.close),
                )
                .sort((a: any, b: any) => a.time - b.time)
                .filter((c: any, i: number, a: any[]) => i === 0 || c.time > a[i - 1].time);
              if (fast.length && !cancelled && !fullDone && series.current && chartApi.current) {
                series.current.setData(fast);
                chartX.current?.setSpan(TF_SEC[requestTf] || 0);
                chartX.current?.setCandles(fast, requestSymbol);
                const sp = spanByTf[requestTf] || 900,
                  lastFast = fast[fast.length - 1];
                liveBarRef.current = {
                  key: requestSymbol + "|" + requestTf + "|" + Math.floor(lastFast.time / sp) * sp,
                  bar: lastFast,
                };
                refit(chartApi.current);
                fastShown = true;
                setChartStatus(requestSymbol + " · " + requestTf + " · loading full history…");
              }
            }
          } catch (err: any) {
            if (err?.name === "AbortError" || cancelled) return;
          }
        };
        void quickPhase(); // runs in parallel with the full request below
        for (const marketKey of candles.length ? [] : marketKeys) {
          if (cancelled) return;
          try {
            const wait = Math.max(0, candle429Until - Date.now());
            if (wait) {
              setChartStatus(
                "Arcus candle API rate limited · retrying in " + Math.ceil(wait / 1000) + "s",
              );
              await new Promise((resolve) => setTimeout(resolve, wait));
              if (cancelled) return;
            }
            const to = Date.now() * 1000;
            const url =
              "https://api.arcus.xyz/v1/candles?market=" +
              encodeURIComponent(marketKey) +
              "&timeframe=" +
              encodeURIComponent(requestTf) +
              "&to=" +
              to +
              "&countback=1500";
            const response = await fetch(url, {
              headers: { Accept: "application/json" },
              cache: "no-store",
              signal: controller.signal,
            });
            if (response.status === 429) {
              lastError = "Arcus HTTP 429";
              candle429Until = Date.now() + candle429Delay;
              candle429Delay = Math.min(candle429Delay * 2, 180000);
              break;
            }
            if (!response.ok) {
              lastError = "Arcus API HTTP " + response.status;
              continue;
            }
            const body = await response.json();
            if (!Array.isArray(body.candles) || !body.candles.length) {
              lastError = "No candles for " + marketKey;
              continue;
            }
            const parsed = body.candles
              .map((c: any) => {
                const rawTime = Number(c.openTime ?? c.time ?? c.timestamp);
                return {
                  time: Math.floor(rawTime > 100000000000 ? rawTime / 1000 : rawTime),
                  open: Number(c.open),
                  high: Number(c.high),
                  low: Number(c.low),
                  close: Number(c.close),
                  volume: Number(c.volume ?? c.vol ?? c.v ?? 0),
                };
              })
              .filter(
                (c: any) =>
                  Number.isFinite(c.time) &&
                  c.time > 0 &&
                  Number.isFinite(c.open) &&
                  Number.isFinite(c.high) &&
                  Number.isFinite(c.low) &&
                  Number.isFinite(c.close),
              )
              .sort((a: any, b: any) => a.time - b.time)
              .filter((c: any, i: number, a: any[]) => i === 0 || c.time > a[i - 1].time);
            if (parsed.length) {
              candles = parsed;
              CANDLE_CACHE.set(cacheKey, { at: Date.now(), candles });
              candle429Delay = 15000;
              candle429Until = 0;
              break;
            }
            lastError = "Invalid candle data for " + marketKey;
          } catch (err: any) {
            if (err?.name === "AbortError" || cancelled) return;
            lastError = err?.message || "Candle request failed";
          }
        }
        if (!candles.length && !ex && !fastShown) {
          // Arcus history unavailable (rate limit / error): borrow candles for the same asset from public exchanges
          try {
            const base = requestSymbol.split("-")[0].toUpperCase();
            const alt = await externalCandles(base, requestTf, controller.signal);
            if (alt.rows.length) {
              candles = alt.rows;
              srcLabel = alt.source;
              setChartStatus("Arcus history unavailable (" + lastError + "): candles from " + alt.source);
              lastError = "";
            }
          } catch (err: any) {
            if (err?.name === "AbortError" || cancelled) return;
          }
        }
        if (!candles.length && lastError === "Arcus HTTP 429") {
          const retryIn = Math.max(1000, candle429Until - Date.now());
          setChartStatus(
            "Arcus candle API rate limited (429) · retry in " +
              Math.ceil(retryIn / 1000) +
              "s · live prices remain connected",
          );
          window.setTimeout(() => {
            if (!cancelled) void load();
          }, retryIn);
          return;
        }
        if (!candles.length && fastShown) {
          setChartStatus(requestSymbol + " · " + requestTf + " · recent candles only (" + lastError + ")");
          return;
        }
        if (!candles.length) throw new Error(lastError + " · " + requestSymbol + " " + requestTf);
        if (cancelled || requestSymbol !== symbol || requestTf !== tf) return;
        const activeSeries = series.current,
          activeChart = chartApi.current;
        if (!activeSeries || !activeChart) return;
        fullDone = true;
        activeSeries.setData(candles);
        chartX.current?.setSpan(TF_SEC[requestTf] || 0);
        chartX.current?.setCandles(candles, requestSymbol);
        chartX.current?.setSource("Candles: " + (srcLabel || ex?.label || "Arcus"));
        const span = TF_SEC[requestTf] || 900,
          last = candles[candles.length - 1];
        liveBarRef.current = { key: requestSymbol + "|" + requestTf + "|" + last.time, bar: last };
        const latest = latestWsPriceRef.current[requestSymbol];
        if (latest && latest.time >= last.time) {
          const bucket = bucketFrom(latest.time, span, last.time);
          const key = requestSymbol + "|" + requestTf + "|" + bucket;
          const bar =
            bucket === last.time
              ? { ...last, high: Math.max(last.high, latest.price), low: Math.min(last.low, latest.price), close: latest.price }
              : { time: bucket, open: last.close, high: Math.max(last.close, latest.price), low: Math.min(last.close, latest.price), close: latest.price, volume: 0 };
          liveBarRef.current = { key, bar };
          try {
            activeSeries.update(bar);
          } catch {}
          try {
            chartX.current?.updateBar(bar);
          } catch {}
        }
        refit(activeChart, fastShown && candles.length > 250 ? candles.length : 0);
        requestAnimationFrame(() => {
          if (!cancelled) refit(activeChart, fastShown && candles.length > 250 ? candles.length : 0);
        });
        const gaps = candles.slice(-30).map((x: any, i: number, arr: any[]) => (i ? x.time - arr[i - 1].time : 0)).filter((g: number) => g > 0).sort((p: number, q: number) => p - q);
        const dataSpan = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        if (dataSpan > span * 1.5) candleNote[requestSymbol] = "⚠ this source only has " + (dataSpan >= 86400 ? "daily" : Math.round(dataSpan / 60) + "-minute") + " candles for " + requestTf + " (live candles still follow " + requestTf + ")";
        setChartStatus(
          requestSymbol + " · " + requestTf + " · " + candles.length + " candles · live WebSocket" +
            (candleNote[requestSymbol] ? " · " + candleNote[requestSymbol] : ""),
        );
      } catch (e: any) {
        if (!cancelled && e?.name !== "AbortError") {
          if (series.current) series.current.setData([]);
          setChartStatus(
            "Chart error · " + requestSymbol + ": " + (e?.message || "Loading failed"),
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tab, symbol, tf]);

  useEffect(() => {
    const sec = TF_SEC[tf] || 0;
    chartX.current?.setSpan(sec);
  }, [tab, tf, symbol]);
  const [evTick, setEvTick] = useState(0);
  useEffect(() => {
    const cx = chartX.current;
    if (tab !== "Chart" || !cx || !symbol) return;
    cx.onEventsToggle = () => setEvTick((n) => n + 1);
    const evBase = assetBase(dn(symbol));
    const CRYPTO_BASES = /^(BTC|ETH|SOL|XRP|DOGE|BNB|ADA|AVAX|LINK|DOT|MATIC|POL|LTC|BCH|TRX|TON|SUI|APT|ARB|OP|NEAR|ATOM|UNI|AAVE|SHIB|PEPE|WIF|HYPE|XLM|ETC|FIL|INJ|TIA|SEI|ENA|WLD|JUP|ONDO|TAO|PENDLE|BONK|FET|RENDER|ICP|HBAR|ALGO|VET|MKR|LDO|CRV|SNX|COMP|RUNE|FTM|S|KAS|XMR|ZEC|DASH|EOS|NEO|IOTA|XTZ|MANA|SAND|AXS|GALA|APE|IMX)$/;
    const eligible = catOfSymbol(symbol) !== "Crypto" || (/^QFEX:/i.test(symbol) && !CRYPTO_BASES.test(evBase));
    if (!cx.isEventsOn()) {
      cx.setEvents([]);
      cx.setEventsStatus("off");
      return;
    }
    if (!eligible) {
      cx.setEvents([]);
      cx.setEventsStatus("not available for crypto");
      return;
    }
    const ctl = new AbortController();
    cx.setEvents([]);
    cx.setEventsStatus("loading…");
    findAsset(evBase, ctl.signal)
      .catch(() => null)
      .then((info) => fetchEvents(evBase, ctl.signal, info?.who?.name || info?.title))
      .then((r) => {
        if (ctl.signal.aborted) return;
        chartX.current?.setEvents(r.list);
        chartX.current?.setEventsStatus(
          r.list.length ? r.list.length + " found" + (r.failed ? " · unavailable: " + r.names.join(", ") : "") : r.failed === r.total ? "sources unreachable" : "nothing found for this symbol",
        );
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [tab, symbol, evTick]);
  const addAlert = (p?: number) => {
    const value = Number(p ?? target);
    if (!symbol || !Number.isFinite(value) || value <= 0) return;
    setLevels((v) => [...v, { id: crypto.randomUUID(), symbol, price: value, mode, nearPct: 0.1 }]);
    setTarget("");
  };
  const stopAlarm = () => {
    if (alarmAudio.current) {
      alarmAudio.current.pause();
      alarmAudio.current.currentTime = 0;
      alarmAudio.current = null;
    }
    if (window.arcusDesktop?.isDesktop) window.arcusDesktop.stopSound();
    setAlarmActive(false);
  };
  const chooseCustomSound = async () => {
    if (window.arcusDesktop?.isDesktop) {
      const path = await window.arcusDesktop.chooseSound?.();
      if (path) {
        setCustomSound(path);
        setSound("custom");
      }
      return;
    }
    document.getElementById("arcus-custom-sound-input")?.click();
  };
  const loadCustomSound = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setStatus("Please choose an audio file");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setStatus("Audio file must be 15 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomSound(reader.result);
        setSound("custom");
        setStatus("Custom alert sound added");
      }
    };
    reader.onerror = () => setStatus("Could not read audio file");
    reader.readAsDataURL(file);
  };
  const refit = (chart: any, n = 0) => {
    try {
      chart.priceScale("right").applyOptions({ autoScale: true });
      chart.applyOptions({ timeScale: { rightOffset: 5 } });
      if (n) chart.timeScale().setVisibleLogicalRange({ from: n - 250, to: n + 3 });
      else chart.timeScale().fitContent();
    } catch {}
  };
  const resetChart = () => {
    const chart = chartApi.current;
    if (!chart || !series.current) return;
    try {
      chart.applyOptions({
        rightPriceScale: { autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { rightOffset: 5 },
      });
      chart.timeScale().fitContent();
      chart.priceScale("right").applyOptions({ autoScale: true });
    } catch (e) {
      console.error("Chart reset failed", e);
    }
  };
  const previewCustomSound = () => {
    if (!customSound) return;
    try {
      if (alarmAudio.current) {
        alarmAudio.current.pause();
        alarmAudio.current.currentTime = 0;
      }
      alarmAudio.current = new Audio(customSound);
      alarmAudio.current.loop = false;
      void alarmAudio.current
        .play()
        .catch(() => setStatus("Click Preview again to allow audio playback"));
    } catch {
      setStatus("Could not play this audio file");
    }
  };
  const enableBrowserNotifications = async () => {
    if (!("Notification" in window)) {
      setStatus("This browser does not support notifications");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotifPerm(permission);
    setStatus(
      permission === "granted"
        ? "Browser notifications enabled"
        : "Notification permission: " + permission,
    );
    if (permission === "granted" && user) {
      try {
        if (await isSupported()) {
          const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
          if (vapidKey) {
            const registration = await navigator.serviceWorker.register(
              "./firebase-messaging-sw.js",
            );
            const token = await getToken(getMessaging(auth.app), {
              vapidKey,
              serviceWorkerRegistration: registration,
            });
            if (token) {
              localStorage.setItem("arcus-alert-fcm-token", token);
              await setDoc(
                doc(db, "users", user.uid, "devices", token),
                { token, platform: "web", updatedAt: serverTimestamp() },
                { merge: true },
              );
            }
          } else
            setStatus(
              "Add the Firebase Web Push VAPID key to VITE_FIREBASE_VAPID_KEY to enable background push.",
            );
        }
      } catch (error: any) {
        setStatus("Push setup error: " + (error?.message || "Unknown error"));
      }
    }
  };
  const toggleFav = (s: string) =>
    setFavorites((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]));
  const drawingDrag = useRef<string | null>(null),
    drawingMoved = useRef(false);
  // ---- Undo / redo (Ctrl+Z, Ctrl+Y) for alerts, favourites and horizontal lines ----
  const appPrev = useRef({ levels, favorites, drawings }),
    appSkip = useRef(true),
    appLastPush = useRef(0);
  const skipUndoOnce = () => {
    appSkip.current = true;
    window.setTimeout(() => (appSkip.current = false), 120);
  };
  useEffect(() => {
    const prev = appPrev.current;
    appPrev.current = { levels, favorites, drawings };
    if (appSkip.current) {
      appSkip.current = false;
      return;
    }
    if (prev.levels === levels && prev.favorites === favorites && prev.drawings === drawings) return;
    const now = Date.now();
    // a drag produces many changes in a row: keep one undo step for the whole gesture
    if (now - appLastPush.current > 700) {
      const before = prev;
      let after = { levels, favorites, drawings };
      const restore = (v: { levels: any[]; favorites: any[]; drawings: any[] }) => {
        skipUndoOnce();
        setLevels(v.levels);
        setFavorites(v.favorites);
        setDrawings(v.drawings);
      };
      undoManager.push({
        tag: "app",
        undo: () => {
          const c = latestCloudState.current;
          after = { levels: c.levels, favorites: c.favorites, drawings: c.drawings };
          restore(before);
        },
        redo: () => restore(after),
      });
    }
    appLastPush.current = now;
  }, [levels, favorites, drawings]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          (t.tagName === "INPUT" && /^(text|search|number|email|password|url|tel)$/.test((t as HTMLInputElement).type || "text")));
      if (typing) return; // let text fields use their own undo
      // e.code works on every keyboard layout (Persian, etc.); e.key does not
      const k = e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        setStatus(undoManager.undo() ? "Undone (Ctrl+Z)" : "Nothing to undo");
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        setStatus(undoManager.redo() ? "Redone (Ctrl+Y)" : "Nothing to redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [alertBanners, setAlertBanners] = useState<AlertEvent[]>([]);
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  // Flash the tab title while an alert banner is waiting, so it is visible even from another tab.
  useEffect(() => {
    if (!alertBanners.length) return;
    const base = document.title.replace(/^🔔 .* — /, "");
    let on = true;
    const t = window.setInterval(() => {
      document.title = on ? "🔔 " + alertBanners[0].symbol + " — " + base : base;
      on = !on;
    }, 900);
    return () => {
      window.clearInterval(t);
      document.title = base;
    };
  }, [alertBanners]);
  // Clicking a system notification (handled by the service worker) opens that symbol.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "arcus-open-symbol" && e.data.symbol) {
        setSymbol(String(e.data.symbol));
        setTab("Chart");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, []);
  const watchNavRef = useRef<string[]>([]),
    symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const [watchW, setWatchW] = useState(() => {
    try {
      const v = Number(localStorage.getItem("arcus.watchW"));
      return v >= 170 && v <= 560 ? v : 255;
    } catch {
      return 255;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("arcus.watchW", String(watchW));
    } catch {}
  }, [watchW]);
  const [chartFull, setChartFull] = useState(false);
  const [tfBuffer, setTfBuffer] = useState("");
  const tfBufRef = useRef("");
  const toggleFull = () => {
    const next = !chartFull;
    setChartFull(next);
    try {
      if (next) void document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) void document.exitFullscreen();
    } catch {}
  };
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setChartFull(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  // Type a timeframe (15, 60, 4h, D ...) and press Enter, like TradingView. Delete removes the selected line.
  useEffect(() => {
    if (tab !== "Chart") return;
    const TFS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"];
    const parse = (raw: string): string | null => {
      const m = /^(\d*)([a-z]?)$/i.exec(raw.trim());
      if (!m) return null;
      const n = m[1] ? Number(m[1]) : 1,
        u = m[2].toLowerCase();
      let out = "";
      if (!u) out = n >= 1440 ? n / 1440 + "d" : n >= 60 && n % 60 === 0 ? n / 60 + "h" : n + "m";
      else out = n + u;
      return TFS.includes(out) ? out : null;
    };
    const setBuf = (v: string) => {
      tfBufRef.current = v;
      setTfBuffer(v);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const buf = tfBufRef.current;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !buf) {
        const list = watchNavRef.current;
        if (!list.length) return;
        const i = list.indexOf(symbolRef.current);
        const next =
          i < 0
            ? 0
            : e.key === "ArrowDown"
              ? Math.min(list.length - 1, i + 1)
              : Math.max(0, i - 1);
        e.preventDefault();
        if (list[next] !== symbolRef.current) setSymbol(list[next]);
        requestAnimationFrame(() =>
          document
            .querySelector(".watch-items button.current")
            ?.scrollIntoView({ block: "nearest" }),
        );
        return;
      }
      if (e.key === "Escape") {
        if (buf) setBuf("");
        else if (selectedLine) setSelectedLine(null);
        else if (chartFull) toggleFull();
        return;
      }
      if (e.key === "Enter" && buf) {
        const next = parse(buf);
        setBuf("");
        if (next) setTf(next);
        else setStatus("Unknown timeframe: " + buf);
        e.preventDefault();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !buf && selectedLine) {
        e.preventDefault();
        setDrawings((v) => v.filter((d) => d.id !== selectedLine));
        setSelectedLine(null);
        return;
      }
      if (e.key === "Backspace" && buf) {
        setBuf(buf.slice(0, -1));
        return;
      }
      if (e.key.length === 1 && /[0-9a-z]/i.test(e.key)) {
        if (!buf && !/[0-9dwDW]/.test(e.key)) return;
        if (buf.length < 5) setBuf(buf + e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, selectedLine, chartFull]);
  const copyLine = (id: string) => {
    const src = drawings.find((d) => d.id === id);
    if (!src) return;
    const nid = crypto.randomUUID();
    const price = (src.points[0]?.price ?? 0) * 1.003; // slightly above, so the copy is visible; drag it where needed
    setDrawings((v) => [
      ...v,
      { ...src, id: nid, points: src.points.map((q, i) => (i === 0 ? { ...q, price } : q)) },
    ]);
    setSelectedLine(nid);
  };
  const openDrawingEditor = (d: ChartDrawing) => {
    setEditingDrawing(d.id);
    setEditLinePrice(String(d.points[0]?.price ?? ""));
    setEditLineColor(d.color || d.points[0]?.color || "#39c9c2");
    setEditLineWidth(d.width || d.points[0]?.width || 2);
  };
  const saveDrawingEdit = () => {
    const price = Number(editLinePrice);
    if (!Number.isFinite(price) || price <= 0) return;
    setDrawings((v) =>
      v.map((d) =>
        d.id === editingDrawing
          ? {
              ...d,
              color: editLineColor,
              width: editLineWidth,
              points: d.points.map((p, i) =>
                i === 0 ? { ...p, price, color: editLineColor, width: editLineWidth } : p,
              ),
            }
          : d,
      ),
    );
    setLineColor(editLineColor);
    setLineWidth(editLineWidth);
    setEditingDrawing(null);
  };
  const submitAuth = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const email = authEmail.trim();
      if (authMode === "signup") await createUserWithEmailAndPassword(auth, email, authPassword);
      else await signInWithEmailAndPassword(auth, email, authPassword);
      setShowAuth(false);
      setAuthPassword("");
    } catch (error: any) {
      const code = error?.code || "";
      const messages: any = {
        "auth/email-already-in-use": "This email already has an account. Sign in instead.",
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/too-many-requests": "Too many attempts. Try again later.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/unauthorized-domain":
          "This website domain is not authorized in Firebase Authentication.",
      };
      setAuthError(messages[code] || error?.message || "Could not authenticate. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };
  const accountAction = () => {
    if (user) {
      void (async () => {
        const token = localStorage.getItem("arcus-alert-fcm-token");
        if (token) {
          try {
            await deleteDoc(doc(db, "users", user.uid, "devices", token));
          } catch {}
          localStorage.removeItem("arcus-alert-fcm-token");
        }
        await signOut(auth);
      })();
      return;
    }
    setAuthMode("login");
    setAuthError("");
    setShowAuth(true);
  };
  const FLAG_COLORS = ["#f23645", "#ff9800", "#f2c94c", "#089981", "#4aa3ff", "#b388ff", "#ff6fae"];
  const flagBtn = (s: string) => (
    <u
      className={"flag-i" + (flags[s] ? " on" : "")}
      title="Colour flag"
      style={flags[s] ? { color: flags[s] } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setFlagMenu(flagMenu ? null : { sym: s, x: r.left, y: r.bottom + 4 });
      }}
    >
      ⚑
    </u>
  );
  const flagBar = (
    <div className="flag-bar" title="Filter by colour flag">
      <button
        className={"bulk-t" + (bulk ? " on" : "")}
        title="Select several symbols, then set one flag colour for all"
        onClick={() => {
          setBulk((v) => !v);
          setSel([]);
        }}
      >
        ☑
      </button>
      <span>⚑</span>
      <button className={"all" + (!flagFilter ? " on" : "")} onClick={() => setFlagFilter("")}>
        All
      </button>
      {FLAG_COLORS.map((c) => {
        const n = Object.values(flags).filter((v) => v === c).length;
        return (
          <button
            key={c}
            className={"dot" + (flagFilter === c ? " on" : "")}
            style={{ background: c, opacity: n || flagFilter === c ? 1 : 0.35 }}
            title={n + " flagged"}
            onClick={() => setFlagFilter(flagFilter === c ? "" : c)}
          />
        );
      })}
    </div>
  );
  const toggleSel = (x: string) => setSel((v) => (v.includes(x) ? v.filter((y) => y !== x) : [...v, x]));
  const bulkBar = (items: string[]) =>
    bulk ? (
      <div className="bulk-bar">
        <b>{sel.length} selected</b>
        <button onClick={() => setSel(sel.length === items.length ? [] : [...items])}>{sel.length === items.length ? "None" : "All"}</button>
        {FLAG_COLORS.map((c) => (
          <button
            key={c}
            className="dot"
            style={{ background: c }}
            title={"Flag " + sel.length + " symbols"}
            disabled={!sel.length}
            onClick={() => setFlags((v) => ({ ...v, ...Object.fromEntries(sel.map((x) => [x, c])) }))}
          />
        ))}
        <button
          disabled={!sel.length}
          title="Remove the flag from the selected symbols"
          onClick={() =>
            setFlags((v) => {
              const n = { ...v };
              sel.forEach((x) => delete n[x]);
              return n;
            })
          }
        >
          ✕ flag
        </button>
        <button
          onClick={() => {
            setBulk(false);
            setSel([]);
          }}
        >
          Done
        </button>
      </div>
    ) : null;
  const filtered = symbols.filter(
    (s) => s.toLowerCase().includes(query.toLowerCase()) && (!flagFilter || flags[s] === flagFilter),
  );
  // Market tab: Crypto / RWA / Commodities (+ sub-groups)
  const [marketCat, setMarketCat] = useState<string>(() => {
    try {
      return localStorage.getItem("arcus.marketCat") || "All";
    } catch {
      return "All";
    }
  });
  const catOfSymbol = (s: string): Category => classifySymbol(s, marketCategories.current);
  const marketGroups = (() => {
    const counts: Record<string, number> = { Crypto: 0, Stocks: 0, Commodities: 0 };
    const sections: Record<string, string[]> = {};
    for (const s of filtered) {
      const c = catOfSymbol(s);
      counts[c] = (counts[c] || 0) + 1;
      if (marketCat !== "All" && marketCat !== c) continue;
      const g = c === "Crypto" ? "Crypto" : subGroup(s, c);
      (sections[g] ||= []).push(s);
    }
    return { counts, sections };
  })();
  const FLAG_NAMES: Record<string, string> = { "#f23645": "Red", "#ff9800": "Orange", "#f2c94c": "Yellow", "#089981": "Green", "#4aa3ff": "Blue", "#b388ff": "Purple", "#ff6fae": "Pink" };
  const flagged = (c: string) => Object.keys(flags).filter((k) => flags[k] === c);
  const flagGroups = Object.keys(FLAG_NAMES).filter((c) => flagged(c).length).map((c) => "flag:" + c);
  const curGroup =
    (watchGroup.startsWith("wl:") && wlists.some((l) => "wl:" + l.id === watchGroup)) || flagGroups.includes(watchGroup)
      ? watchGroup
      : "Favorites";
  const flagColorOf = (g: string) => (g.startsWith("flag:") ? g.slice(5) : "");
  const activeList = curGroup.startsWith("wl:") ? wlists.find((l) => "wl:" + l.id === curGroup) : undefined;
  const groupItems = (g: string): string[] =>
    g === "Favorites" ? favorites : g.startsWith("flag:") ? flagged(g.slice(5)) : g.startsWith("wl:") ? wlists.find((l) => "wl:" + l.id === g)?.items || [] : [];
  const groupName = (g: string) => (g === "Favorites" ? favName : g.startsWith("flag:") ? flagNames[g.slice(5)] || FLAG_NAMES[g.slice(5)] + " flag" : wlists.find((l) => "wl:" + l.id === g)?.name || "");
  const addList = () => {
    const name = (window.prompt("Watchlist name", "My list") || "").trim();
    if (!name) return null;
    const id = Date.now().toString(36);
    setWlists((v) => [...v, { id, name: name.slice(0, 24), items: [] }]);
    return id;
  };
  const renameList = () => {
    const name = (window.prompt("Rename watchlist", groupName(curGroup)) || "").trim().slice(0, 24);
    if (!name) return;
    if (flagColorOf(curGroup)) setFlagNames((v) => ({ ...v, [flagColorOf(curGroup)]: name }));
    else if (activeList) setWlists((v) => v.map((l) => (l.id === activeList.id ? { ...l, name } : l)));
    else {
      setFavName(name);
      localStorage.setItem("arcus.favName", name);
    }
  };
  const deleteList = () => {
    const fc = flagColorOf(curGroup);
    if (fc) {
      if (!window.confirm("Remove the " + FLAG_NAMES[fc] + " flag from all " + flagged(fc).length + " markets?")) return;
      setFlags((v) => Object.fromEntries(Object.entries(v).filter(([, c]) => c !== fc)));
      setWatchGroup("Favorites");
    } else if (activeList) {
      if (!window.confirm('Delete watchlist "' + activeList.name + '"?')) return;
      setWlists((v) => v.filter((l) => l.id !== activeList.id));
      setWatchGroup("Favorites");
    } else if (favorites.length && window.confirm("Remove every symbol from " + favName + "?")) setFavorites([]);
  };
  const toggleInList = (id: string, sym: string) =>
    setWlists((v) =>
      v.map((l) => (l.id === id ? { ...l, items: l.items.includes(sym) ? l.items.filter((x) => x !== sym) : [...l.items, sym] } : l)),
    );
  const toggleIn = (g: string, sym: string) =>
    g.startsWith("flag:")
      ? setFlags((v) => {
          const n = { ...v };
          if (n[sym] === g.slice(5)) delete n[sym];
          else n[sym] = g.slice(5);
          return n;
        })
      : (g === "Favorites" ? toggleFav(sym) : toggleInList(g.slice(3), sym));
  const inAnyList = (sym: string) => favorites.includes(sym) || wlists.some((l) => l.items.includes(sym));
  const allGroups = ["Favorites", ...wlists.map((l) => "wl:" + l.id), ...flagGroups];
  const orderedGroups = [...allGroups].sort((x, y) => {
    const ix = listOrder.indexOf(x),
      iy = listOrder.indexOf(y);
    return (ix < 0 ? 1e6 + allGroups.indexOf(x) : ix) - (iy < 0 ? 1e6 + allGroups.indexOf(y) : iy);
  });
  const moveGroup = (g: string, dir: -1 | 1) => {
    const arr = [...orderedGroups],
      i = arr.indexOf(g),
      j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setListOrder(arr);
  };
  const tabLabel = (g: string, full = false) => (
    <>
      {g.startsWith("flag:") && <i className="tab-dot" style={{ background: g.slice(5) }} />}
      {full ? (
        <span>{groupName(g)}</span>
      ) : g.startsWith("flag:") ? null : (
        <span className="tab-name">{Array.from(groupName(g))[0] || "?"}</span>
      )}
      {full && g.startsWith("flag:") && <em className="tab-n">{flagged(g.slice(5)).length}</em>}
    </>
  );
  const listTabs = (
    <div className="wl-tabs-wrap">
      <div className="watch-tabs wl-tabs">
        {orderedGroups.map((g) => (
          <button
            key={g}
            ref={(el) => {
              if (el && curGroup === g) el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            }}
            className={curGroup === g ? "active" : ""}
            title={groupName(g)}
            onClick={() => setWatchGroup(g)}
          >
            {tabLabel(g)}
          </button>
        ))}
      </div>
      <button className={"wl-more" + (tabsOpen ? " on" : "")} title="All watchlists (reorder)" onClick={() => setTabsOpen((v) => !v)}>
        ▾
      </button>
      <button
        className="wl-add"
        title="New watchlist"
        onClick={() => {
          const id = addList();
          if (id) setWatchGroup("wl:" + id);
        }}
      >
        ＋
      </button>
      {tabsOpen && (
        <div className="wl-drop">
          {orderedGroups.map((g, i) => (
            <div key={g} className={"wl-drop-row" + (curGroup === g ? " active" : "")}>
              <button
                className="wl-drop-name"
                onClick={() => {
                  setWatchGroup(g);
                  setTabsOpen(false);
                }}
              >
                {tabLabel(g, true)}
              </button>
              <button title="Move up (shown earlier)" disabled={i === 0} onClick={() => moveGroup(g, -1)}>
                ▲
              </button>
              <button title="Move down" disabled={i === orderedGroups.length - 1} onClick={() => moveGroup(g, 1)}>
                ▼
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const listTools = (
    <div className="wl-tools">
      <span>{groupName(curGroup)}</span>
      <button title="Rename" onClick={renameList}>
        ✎
      </button>
      <button title={activeList ? "Delete this list" : "Clear this list"} onClick={deleteList}>
        🗑
      </button>
    </div>
  );
  const wlTabItems = groupItems(curGroup).filter((s) => symEnabled(s) && (!flagFilter || flags[s] === flagFilter));
  const panelItems = query.trim() ? filtered : wlTabItems;
  watchNavRef.current = panelItems;
  return (
    <div className="app">
      {infoSym && (
        <AssetInfo
          symbol={infoSym}
          shown={dn(infoSym)}
          category={categoryLabel(catOfSymbol(infoSym))}
          price={prices[infoSym]?.price}
          change={prices[infoSym]?.change24h}
          exchange={adapterOf(infoSym)?.label || "Arcus"}
          onClose={() => setInfoSym(null)}
          onChart={() => {
            setSymbol(infoSym);
            setTab("Chart");
            setInfoSym(null);
          }}
        />
      )}
      {flagMenu && (
        <>
          <div className="wl-menu-bg" onClick={() => setFlagMenu(null)} />
          <div className="wl-menu flag-menu" style={{ left: Math.min(flagMenu.x, window.innerWidth - 200), top: flagMenu.y }}>
            <b>{dn(flagMenu.sym)} · flag</b>
            <div className="flag-pick">
              {FLAG_COLORS.map((c) => (
                <button
                  key={c}
                  className={flags[flagMenu.sym] === c ? "on" : ""}
                  style={{ background: c }}
                  onClick={() => {
                    setFlags((v) => ({ ...v, [flagMenu.sym]: c }));
                    setFlagMenu(null);
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                setFlags((v) => {
                  const n = { ...v };
                  delete n[flagMenu.sym];
                  return n;
                });
                setFlagMenu(null);
              }}
            >
              ✕ No flag
            </button>
          </div>
        </>
      )}
      {listMenu && (
        <>
          <div className="wl-menu-bg" onClick={() => setListMenu(null)} />
          <div className="wl-menu" style={{ left: Math.min(listMenu.x, window.innerWidth - 230), top: listMenu.y }}>
            <b>{dn(listMenu.sym)} → watchlist</b>
            {["Favorites", ...wlists.map((l) => "wl:" + l.id)].map((g) => (
              <label key={g}>
                <input type="checkbox" checked={groupItems(g).includes(listMenu.sym)} onChange={() => toggleIn(g, listMenu.sym)} />
                {groupName(g)}
              </label>
            ))}
            <button
              onClick={() => {
                const id = addList();
                if (id) toggleInList(id, listMenu.sym);
              }}
            >
              ＋ New watchlist…
            </button>
          </div>
        </>
      )}
      <header className={tab === "Chart" && !hdrFull ? "slim" : ""}>
        <div className="brand" title="ARCUS ALERT">
          <div className="mark"><img src="./icon.svg" alt="Arcus" /></div>
          <div>
            <b>ARCUS</b>
            <small>ALERT</small>
          </div>
        </div>
        <div className="connection ex-grid">
          {(() => {
            const line = (id: string, text: string, st: string) => (
              <button
                key={id}
                className={"ex-line " + (isOn(id) ? "on " : "off ") + st}
                title={text + " — " + (isOn(id) ? "click to hide this exchange" : "click to show this exchange")}
                onClick={() => setExOn((v) => ({ ...v, [id]: v[id] === false }))}
              >
                <i /> {text}
              </button>
            );
            const stateOf = (msg: string) => (/^Live/.test(msg) ? "ok" : /error|blocked|disconnect|interrupt/i.test(msg) ? "err" : "wait");
            return (
              <>
                {line("arcus", status, stateOf(status))}
                {ADAPTERS.map((ad) => {
                  const warn = /error|blocked/i.test(exMsg[ad.id] || "") ? " · ⚠ " + exMsg[ad.id] : "";
                  const text = exLive[ad.id] ? exLive[ad.id] + warn : exMsg[ad.id] || ad.label + " · connecting…";
                  return line(ad.id, text, exLive[ad.id] ? "ok" : stateOf(text));
                })}
              </>
            );
          })()}
        </div>
        <div className="header-actions">
          <label className="sound-control" title="Notification sound">
            🔊
            <select
              aria-label="Notification sound"
              value={sound}
              onChange={(e) => setSound(e.target.value)}
            >
              <option value="beep">Beep</option>
              <option value="double">Double beep</option>
              <option value="triple">Triple beep</option>
              <option value="off">Silent</option>
              {customSound && <option value="custom">My sound</option>}
            </select>
            <button type="button" title="Choose audio file" onClick={chooseCustomSound}>
              Add ♪
            </button>
            {!window.arcusDesktop?.isDesktop && (
              <input
                id="arcus-custom-sound-input"
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                style={{ display: "none" }}
                onChange={(e) => {
                  loadCustomSound(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            )}
          </label>
          <button
            className={"history-button sync-button" + (unsynced ? " dirty" : "")}
            disabled={syncBusy}
            title={
              user
                ? "Send everything from the web app to your account so the Android app gets it"
                : "Sign in first, then sync to Android"
            }
            onClick={() => void syncToCloud(false)}
          >
            {syncBusy ? "…" : "⇅"}<span className="lbl">{syncBusy ? "Syncing…" : " Sync to Android"}</span>
          </button>
          {user && (syncMsg || unsynced) && (
            <span
              className={"sync-msg " + (syncMsg ? (syncMsg.ok ? "ok" : "err") : "warn")}
              title={syncMsg?.text}
            >
              {syncMsg ? syncMsg.text : "● Unsynced changes"}
            </span>
          )}
          <button
            className="history-button account-button"
            title={user?.email || "Sign in to sync alerts across devices"}
            onClick={accountAction}
          >
            <span className="ico">👤</span>
            <span className="lbl">{user ? "Sign out" : "Sign in"}</span>
          </button>
          <button
            className="history-button"
            title="Alert history"
            onClick={() => setShowHistory((v) => !v)}
          >
            ◷<span className="lbl"> History</span>
            {history.length > 0 && <b>{history.length}</b>}
          </button>
          <IpBadge />
          {tab === "Chart" && (
            <button className="history-button hdr-toggle" title={hdrFull ? "Slim top bar (more room for the chart)" : "Show the full top bar"} onClick={() => setHdrFull((v) => { try { localStorage.setItem("arcus.hdrFull", v ? "0" : "1"); } catch {} return !v; })}>
              {hdrFull ? "⌃" : "⌄"}
            </button>
          )}
        </div>
      </header>
      {tab !== "Chart" && <SessionBar notifPerm={window.arcusDesktop?.isDesktop ? "granted" : notifPerm} onEnable={enableBrowserNotifications} />}
      {alertBanners.length > 0 && (
        <div className="alert-toasts">
          {alertBanners.map((a, i) => (
            <div className="alert-toast" key={a.id + "-" + a.time}>
              <div
                className="alert-toast-body"
                onClick={() => {
                  setSymbol(a.symbol);
                  setTab("Chart");
                  setAlertBanners((b) => b.filter((x) => x !== a));
                }}
              >
                <b>🔔 {dn(a.symbol)}</b>
                <span>
                  Target {a.price.toLocaleString()} · now {a.actual.toLocaleString()} ·{" "}
                  {new Date(a.time).toLocaleTimeString()}
                </span>
              </div>
              <button title="Dismiss" onClick={() => setAlertBanners((b) => b.filter((x) => x !== a))}>
                ×
              </button>
            </div>
          ))}
          {alertBanners.length > 1 && (
            <button className="alert-toast-clear" onClick={() => setAlertBanners([])}>
              Dismiss all
            </button>
          )}
        </div>
      )}
      <main className={(chartFull && tab === "Chart" ? "chart-full" : "") + (tab === "Chart" ? " chart-wide" : "")}>
        {tab === "Market" && (
          <>
            <div className="heading">
              <div>
                <small>MARKETS</small>
                <h1>Market overview</h1>
                <p>Live prices from Arcus</p>
              </div>
              <span className="count">{symbols.length} markets</span>
            </div>
            <input
              placeholder="Search markets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {flagBar}
            {bulkBar(filtered)}
            <label className="ex-merge" title="Show one market per asset: the exchange with the best chart and data">
                  <input
                    type="checkbox"
                    checked={mergeDup}
                    onChange={(e) => {
                      setMergeDup(e.target.checked);
                      localStorage.setItem("arcus.mergeDup", e.target.checked ? "1" : "0");
                    }}
                  />{" "}
                  One market per asset
                </label>
            <div className="market-cats">
              {[
                ["All", "All", filtered.length],
                ["Crypto", "Crypto", marketGroups.counts.Crypto],
                ["Stocks", "RWA", marketGroups.counts.Stocks],
                ["Commodities", "Commodities", marketGroups.counts.Commodities],
              ].map(([id, label, n]) => (
                <button
                  key={String(id)}
                  className={marketCat === id ? "active" : ""}
                  onClick={() => {
                    setMarketCat(String(id));
                    try {
                      localStorage.setItem("arcus.marketCat", String(id));
                    } catch {}
                  }}
                >
                  {label} <small>{n}</small>
                </button>
              ))}
            </div>
            {["Crypto", "Stocks", "ETFs & Indices", "Forex", "Metals", "Energy", "Agriculture & other"]
              .filter((g) => marketGroups.sections[g]?.length)
              .map((g) => {
                const list = marketGroups.sections[g];
                return (
                  <section key={g} className="market-section">
                    {(marketCat !== "All" || g !== "Crypto") && marketCat !== "Crypto" && (
                      <h3 className="market-sub">
                        {g} <small>{list.length}</small>
                      </h3>
                    )}
                    <div className="marketlist">
              {list.map((s) => (
                <div
                  className={"marketrow" + (bulk && sel.includes(s) ? " picked" : "")}
                  key={s}
                  onClick={(e) => {
                    if (bulk || e.ctrlKey || e.metaKey) {
                      if (!bulk) setBulk(true);
                      toggleSel(s);
                      return;
                    }
                    setSymbol(s);
                    setTab("Chart");
                  }}
                >
                  <b>
                    {bulk && <em className="bulk-ck">{sel.includes(s) ? "☑" : "☐"}</em>}
                    {dn(s)}
                    <u className="info-i" title="What is this market?" onClick={(e) => { e.stopPropagation(); setInfoSym(s); }}>i</u>
                    {flagBtn(s)}
                  </b>
                  <button
                    className="market-favorite"
                    aria-label="Add to a watchlist"
                    title="Add to a watchlist"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setListMenu({ sym: s, x: r.left - 120, y: r.bottom + 4 });
                    }}
                  >
                    {inAnyList(s) ? "★" : "☆"}
                  </button>
                  <small
                    className={
                      prices[s]?.change24h == null
                        ? "muted"
                        : prices[s].change24h >= 0
                          ? "positive"
                          : "negative"
                    }
                  >
                    {prices[s]?.change24h == null
                      ? "—"
                      : (prices[s].change24h >= 0 ? "+" : "") +
                        prices[s].change24h.toFixed(2) +
                        "%"}
                  </small>
                  <strong>
                    {prices[s]?.price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ??
                      "—"}
                  </strong>
                </div>
              ))}
                    </div>
                  </section>
                );
              })}
          </>
        )}
        {tab === "News" && <News trackedBases={newsBases} onOpen={openBase} />}
        {tab === "Screener" && (
          <Screener
            items={screenerItems}
            onOpen={(sym) => {
              setSymbol(sym);
              setTab("Chart");
            }}
          />
        )}
        {tab === "Guide" && <Guide />}
        <ReportHost onOpenChart={openBase} />
        {tab === "Watchlist" && (
          <>
            <div className="heading">
              <div>
                <small>YOUR MARKETS</small>
                <h1>Watchlist</h1>
                <p>Favorite markets and your own lists</p>
              </div>
            </div>
            {listTabs}
            {listTools}
            {flagBar}
            {bulkBar(wlTabItems)}
            {wlTabItems.length ? (
              <div className="marketlist">
              {wlTabItems.map((s) => (
                <div
                  className={"marketrow" + (bulk && sel.includes(s) ? " picked" : "")}
                  key={s}
                  onClick={(e) => {
                    if (bulk || e.ctrlKey || e.metaKey) {
                      if (!bulk) setBulk(true);
                      toggleSel(s);
                      return;
                    }
                    setSymbol(s);
                    setTab("Chart");
                  }}
                >
                  <b>
                    {bulk && <em className="bulk-ck">{sel.includes(s) ? "☑" : "☐"}</em>}
                    {dn(s)}
                    <u className="info-i" title="What is this market?" onClick={(e) => { e.stopPropagation(); setInfoSym(s); }}>i</u>
                    {flagBtn(s)}
                  </b>
                  <button
                    className="market-favorite"
                    aria-label="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeList) toggleInList(activeList.id, s);
                      else toggleFav(s);
                    }}
                  >
                    ★
                  </button>
                  <small
                    className={
                      prices[s]?.change24h == null
                        ? "muted"
                        : prices[s].change24h >= 0
                          ? "positive"
                          : "negative"
                    }
                  >
                    {prices[s]?.change24h == null
                      ? "—"
                      : (prices[s].change24h >= 0 ? "+" : "") +
                        prices[s].change24h.toFixed(2) +
                        "%"}
                  </small>
                  <strong>
                    {prices[s]?.price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ??
                      "—"}
                  </strong>
                </div>
              ))}
              </div>
            ) : (
              <div className="empty">This list is empty. Open the chart tab → Watchlist → Market and press ＋ next to a symbol (or ☆ in Market for Favorites).</div>
            )}
          </>
        )}
        {tab === "Chart" && (
          <>
            <div
              style={{ ["--watch-w" as any]: watchW + "px" }}
              className={
                "chart-workspace cw2" + (railOpen ? "" : " rail-closed") + (watchOpen ? "" : " watch-closed")
              }
            >
            <div className="chartbar">
              <div className="chart-symbol-area">
                <small>CHART</small>
                <div className="chart-symbol-row">
                <button
                  className={"chart-star" + (symbol && inAnyList(symbol) ? " on" : "")}
                  title="Add to a watchlist"
                  onClick={(e) => {
                    if (!symbol) return;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setListMenu(listMenu ? null : { sym: symbol, x: r.left, y: r.bottom + 6 });
                  }}
                >
                  {symbol && inAnyList(symbol) ? "★" : "☆"}
                </button>
                <button
                  className="chart-star"
                  title="Colour flag"
                  style={symbol && flags[symbol] ? { color: flags[symbol], borderColor: flags[symbol] } : undefined}
                  onClick={(e) => {
                    if (!symbol) return;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setFlagMenu(flagMenu ? null : { sym: symbol, x: r.left, y: r.bottom + 6 });
                  }}
                >
                  ⚑
                </button>
                <button className="chart-star" title="What is this market?" onClick={() => symbol && setInfoSym(symbol)}>
                  ⓘ
                </button>
                <div className="chart-symbol-picker">
                  <button
                    className="chart-symbol-trigger"
                    onClick={() => {
                      setChartSearchOpen((v) => !v);
                      setQuery("");
                    }}
                  >
                    <span>{symbol ? dn(symbol) : "Select market"}</span>
                    <b>⌕</b>
                  </button>
                  {chartSearchOpen && (
                    <div className="chart-symbol-menu">
                      <input
                        autoFocus
                        placeholder="Search markets…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <div className="chart-symbol-results">
                        {filtered.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setSymbol(s);
                              setChartSearchOpen(false);
                              setQuery("");
                            }}
                          >
                            {dn(s)}
                            <span>{prices[s]?.price?.toLocaleString() ?? "—"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </div>
              </div>
              <b className="fs-only fs-keep">{dn(symbol)}</b>
              <div className="price fs-keep">
                {prices[symbol]?.price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ??
                  "—"}
              </div>
              <div className="tf-wrap fs-keep">
                <button className="tf-cur" title="Timeframe" onClick={() => setTfMenu((v) => !v)}>
                  {tf} ▾
                </button>
                {tfMenu && (
                  <>
                    <div className="wl-menu-bg" onClick={() => setTfMenu(false)} />
                    <div className="tf-menu">
                      {TF_LIST.map((x) => (
                        <div key={x} className={"tf-row" + (x === tf ? " on" : "")}>
                          <button
                            onClick={() => {
                              setTf(x);
                              setTfMenu(false);
                            }}
                          >
                            {x}
                          </button>
                          <u
                            className={tfFavs.includes(x) ? "on" : ""}
                            title={tfFavs.includes(x) ? "Remove from the bar" : "Show on the bar"}
                            onClick={() => {
                              const n = tfFavs.includes(x) ? tfFavs.filter((y) => y !== x) : [...tfFavs, x].sort((a, b) => TF_LIST.indexOf(a) - TF_LIST.indexOf(b));
                              setTfFavs(n);
                              try {
                                localStorage.setItem("arcus.tfFavs.v1", JSON.stringify(n));
                              } catch {}
                            }}
                          >
                            ★
                          </u>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {tfFavs.map((x) => (
                  <button key={x} className={"tf-fav" + (x === tf ? " on" : "")} onClick={() => setTf(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <span className="ind-slot fs-keep" />
              <button
                className="secondary drawer-toggle fs-keep"
                title="Full screen chart (Esc to exit). Type a timeframe like 15 and press Enter."
                onClick={toggleFull}
              >
                {chartFull ? "✕ Exit" : "⛶ Full"}
              </button>
              <SessionBar compact notifPerm={window.arcusDesktop?.isDesktop ? "granted" : notifPerm} onEnable={enableBrowserNotifications} />
              {!railOpen && (
                <button className="secondary reopen" title="Show drawing tools" onClick={() => setRailOpen(true)}>
                  ✎
                </button>
              )}
              {!watchOpen && (
                <button className="secondary reopen" title="Show the watchlist" onClick={() => setWatchOpen(true)}>
                  ☰
                </button>
              )}
            </div>
              <aside className="drawing-rail">
                <button className="rail-hide" title="Hide the drawing tools" onClick={() => setRailOpen(false)}>
                  «
                </button>
                <button
                  className={activeTool === "hline" ? "selected" : ""}
                  title="Horizontal line"
                  onClick={() => setActiveTool(activeTool === "hline" ? "cursor" : "hline")}
                >
                  ↔
                </button>
                <label className="drawing-style" title="Line color">
                  <input
                    type="color"
                    value={lineColor}
                    onChange={(e) => setLineColor(e.target.value)}
                  />
                </label>
                <select
                  className="drawing-width"
                  aria-label="Line thickness"
                  value={lineWidth}
                  onChange={(e) => setLineWidth(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}px
                    </option>
                  ))}
                </select>
              </aside>
              <section className="chart-center">
                {tfBuffer && (
                  <div className="tf-input">
                    {tfBuffer} <small>↵ Enter</small>
                  </div>
                )}
                <div
                  className={
                    "chartnote" +
                    (activeTool === "hline" || /error|limit|only|fail/i.test(chartStatus)
                      ? " show"
                      : "")
                  }
                >
                  {chartStatus} ·{" "}
                  {activeTool === "hline"
                    ? "Click chart to place a horizontal line"
                    : "Select the horizontal-line tool to draw"}
                </div>
                {/^Chart error|no candle history|rate limited|unavailable/i.test(chartStatus) && (
                  <div className="chart-note">{chartStatus}</div>
                )}
                <div
                  className={"chartbox " + (activeTool !== "cursor" ? "drawing-active" : "")}
                  ref={chartHost}
                  onPointerDown={(e) => {
                    if (selectedLine) setSelectedLine(null);
                    if (activeTool !== "hline" || !chartApi.current || !series.current) return;
                    const r = e.currentTarget.getBoundingClientRect(),
                      x = e.clientX - r.left,
                      y = e.clientY - r.top,
                      vr = chartApi.current.timeScale().getVisibleRange(),
                      t = chartApi.current.timeScale().coordinateToTime(x) ?? (vr ? vr.to : null),
                      p = series.current.coordinateToPrice(y);
                    if (t == null || p == null) return;
                    const point = { time: t, price: Number(p), color: lineColor, width: lineWidth };
                    setDrawings((v) => [
                      ...v,
                      {
                        id: crypto.randomUUID(),
                        tool: "hline",
                        symbol,
                        points: [point],
                        color: lineColor,
                        width: lineWidth,
                      },
                    ]);
                    setActiveTool("cursor");
                  }}
                  onPointerMove={(e) => {
                    const el = e.currentTarget;
                    if ((el as any)._dragAlert && series.current) {
                      const r = el.getBoundingClientRect(),
                        p = series.current.coordinateToPrice(e.clientY - r.top);
                      if (p != null)
                        setLevels((v) =>
                          v.map((l) =>
                            l.id === (el as any)._dragAlert ? { ...l, price: Number(p) } : l,
                          ),
                        );
                    }
                  }}
                  onPointerUp={(e) => {
                    (e.currentTarget as any)._dragAlert = null;
                  }}
                >
                  <svg
                    className="drawing-overlay"
                    viewBox={`0 0 ${chartHost.current?.clientWidth || 800} ${chartHost.current?.clientHeight || 400}`}
                    preserveAspectRatio="none"
                    style={{ pointerEvents: "none" }}
                  >
                    {drawings
                      .filter((d) => !d.symbol || d.symbol === symbol)
                      .map((d) => {
                        const p = d.points.map((q) => ({
                          x: chartApi.current?.timeScale().timeToCoordinate(q.time),
                          y: series.current?.priceToCoordinate(q.price),
                        }));
                        const a = p[0];
                        if (d.tool === "hline") {
                          if (a?.y == null) return null;
                          return (
                            <g key={d.id}>
                            <line
                              x1="0"
                              x2={chartHost.current?.clientWidth || 800}
                              y1={a.y}
                              y2={a.y}
                              stroke={d.color || d.points[0]?.color || "#39c9c2"}
                              strokeWidth={(d.width || d.points[0]?.width || 2) + (selectedLine === d.id ? 1.5 : 0)}
                              strokeDasharray={selectedLine === d.id ? "8 4" : undefined}
                              style={{ pointerEvents: "none" }}
                            />
                            <line
                              x1="0"
                              x2={chartHost.current?.clientWidth || 800}
                              y1={a.y}
                              y2={a.y}
                              stroke="transparent"
                              strokeWidth={16}
                              style={{ pointerEvents: "stroke", cursor: "ns-resize" }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                drawingDrag.current = d.id;
                                drawingMoved.current = false;
                                e.currentTarget.setPointerCapture(e.pointerId);
                              }}
                              onPointerMove={(e) => {
                                if (
                                  drawingDrag.current !== d.id ||
                                  !series.current ||
                                  !chartHost.current
                                )
                                  return;
                                const r = chartHost.current.getBoundingClientRect(),
                                  p = series.current.coordinateToPrice(e.clientY - r.top);
                                if (p != null) {
                                  drawingMoved.current = true;
                                  setDrawings((v) =>
                                    v.map((x) =>
                                      x.id === d.id
                                        ? {
                                            ...x,
                                            points: x.points.map((q, i) =>
                                              i === 0 ? { ...q, price: Number(p) } : q,
                                            ),
                                          }
                                        : x,
                                    ),
                                  );
                                }
                              }}
                              onPointerUp={(e) => {
                                e.stopPropagation();
                                drawingDrag.current = null;
                              }}
                              onPointerCancel={() => {
                                drawingDrag.current = null;
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!drawingMoved.current) setSelectedLine(d.id);
                                drawingMoved.current = false;
                              }}
                            />
                            </g>
                          );
                        }
                        if (p.some((q) => q.x == null || q.y == null)) return null;
                        return null;
                      })}
                  </svg>
                  {levels
                    .filter((l) => l.symbol === symbol)
                    .map((l) => {
                      const y = series.current?.priceToCoordinate(l.price);
                      if (y == null) return null;
                      return (
                        <div
                          className="alert-price-overlay"
                          key={l.id}
                          style={{ top: y }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            (e.currentTarget.parentElement as any)._dragAlert = l.id;
                            (e.currentTarget.parentElement as any).setPointerCapture(e.pointerId);
                          }}
                        >
                          <span>ALERT {l.price.toLocaleString()}</span>
                          <button
                            title="Delete alert"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => setLevels((v) => v.filter((x) => x.id !== l.id))}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  {selectedLine &&
                    (() => {
                      const d = drawings.find((x) => x.id === selectedLine);
                      const y = d ? series.current?.priceToCoordinate(d.points[0]?.price) : null;
                      if (!d || y == null) return null;
                      return (
                        <div
                          className="line-actions"
                          style={{ top: Math.max(4, Number(y) - 15) }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <input
                            type="color"
                            title="Line colour"
                            value={d.color || d.points[0]?.color || "#39c9c2"}
                            onChange={(e) => {
                              const c = e.target.value;
                              setDrawings((v) =>
                                v.map((x) =>
                                  x.id === d.id
                                    ? { ...x, color: c, points: x.points.map((q, i) => (i === 0 ? { ...q, color: c } : q)) }
                                    : x,
                                ),
                              );
                            }}
                          />
                          <button title="Copy this line" onClick={() => copyLine(d.id)}>
                            ⧉ Copy
                          </button>
                          <button
                            title="Edit price / colour"
                            onClick={() => {
                              openDrawingEditor(d);
                              setSelectedLine(null);
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="danger"
                            title="Delete this line"
                            onClick={() => {
                              setDrawings((v) => v.filter((x) => x.id !== d.id));
                              setSelectedLine(null);
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      );
                    })()}
                  {hoverLevel && (
                    <button
                      className="chart-crosshair-add"
                      style={{
                        top: Math.max(
                          4,
                          Math.min(
                            hoverLevel.y - 16,
                            (chartHost.current?.clientHeight || 480) - 36,
                          ),
                        ),
                      }}
                      onClick={() => addAlert(hoverLevel.price)}
                    >
                      ＋
                    </button>
                  )}
                </div>
                {editingDrawing && (
                  <div className="line-editor-backdrop" onClick={() => setEditingDrawing(null)}>
                    <div className="line-editor" onClick={(e) => e.stopPropagation()}>
                      <div className="line-editor-head">
                        <b>Edit horizontal line</b>
                        <button onClick={() => setEditingDrawing(null)}>×</button>
                      </div>
                      <label>
                        Price
                        <input
                          type="number"
                          value={editLinePrice}
                          onChange={(e) => setEditLinePrice(e.target.value)}
                        />
                      </label>
                      <label>
                        Color
                        <input
                          type="color"
                          value={editLineColor}
                          onChange={(e) => setEditLineColor(e.target.value)}
                        />
                      </label>
                      <label>
                        Thickness
                        <select
                          value={editLineWidth}
                          onChange={(e) => setEditLineWidth(Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}px
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="line-editor-actions">
                        <button
                          className="danger"
                          onClick={() => {
                            setDrawings((v) => v.filter((d) => d.id !== editingDrawing));
                            setEditingDrawing(null);
                          }}
                        >
                          Delete line
                        </button>
                        <button className="secondary" onClick={() => setEditingDrawing(null)}>
                          Cancel
                        </button>
                        <button onClick={saveDrawingEdit}>Save</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="chartfoot">
                  Wheel: zoom · Drag: pan · Drawings save automatically
                </div>
              </section>
              <aside className="watchlist-panel">
                <div
                  className="watch-resizer"
                  title="Drag to resize"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX,
                      startW = watchW,
                      el = e.currentTarget;
                    el.setPointerCapture(e.pointerId);
                    const move = (ev: PointerEvent) =>
                      setWatchW(Math.max(170, Math.min(560, startW + (startX - ev.clientX))));
                    const up = () => {
                      el.removeEventListener("pointermove", move);
                      el.removeEventListener("pointerup", up);
                    };
                    el.addEventListener("pointermove", move);
                    el.addEventListener("pointerup", up);
                  }}
                />
                <div className="watch-head">
                  <button className="wh-btn" title="Hide the watchlist" onClick={() => setWatchOpen(false)}>
                    »
                  </button>
                  <b>Watchlist</b>
                  <span className="wh-n">{symbols.length}</span>
                  <button className="wh-btn" title="Reset chart view (Alt+R)" onClick={resetChart}>
                    ⟲ Reset
                  </button>
                  <button className="wh-btn" title="Share this analysis (image or code)" onClick={() => chartX.current?.openShare()}>
                    ⤴ Share
                  </button>
                </div>
                <input
                  placeholder="Search symbol…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {listTabs}
                {listTools}
                {flagBar}
                {bulkBar(panelItems)}
                <div className="watch-items">
                  {!panelItems.length && (
                    <div className="empty small">This list is empty. Type a symbol in the search box above and press ＋.</div>
                  )}
                  {panelItems.map((s) => (
                    <button
                      className={(s === symbol ? "current" : "") + (bulk && sel.includes(s) ? " picked" : "")}
                      key={s}
                      onClick={(e) => {
                        if (bulk || e.ctrlKey || e.metaKey) {
                          if (!bulk) setBulk(true);
                          toggleSel(s);
                        } else setSymbol(s);
                      }}
                    >
                      <b>
                        {bulk && <em className="bulk-ck">{sel.includes(s) ? "☑" : "☐"}</em>}
                        <span className="sym">{dn(s)}</span>
                        <u
                          className="wl-pick"
                          title={(groupItems(curGroup).includes(s) ? "Remove from " : "Add to ") + groupName(curGroup)}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleIn(curGroup, s);
                          }}
                        >
                          {groupItems(curGroup).includes(s) ? "✓" : "＋"}
                        </u>
                        {flagBtn(s)}
                      </b>
                      <i
                        className={
                          prices[s]?.change24h == null
                            ? "muted"
                            : prices[s].change24h >= 0
                              ? "positive"
                              : "negative"
                        }
                      >
                        {prices[s]?.change24h == null
                          ? "—"
                          : (prices[s].change24h >= 0 ? "+" : "") +
                            prices[s].change24h.toFixed(2) +
                            "%"}
                      </i>
                      <span>
                        {prices[s]?.price?.toLocaleString(undefined, {
                          maximumFractionDigits: 5,
                        }) ?? "—"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="watch-detail">
                  <b>{symbol ? dn(symbol) : "Select market"}</b>
                  <strong>
                    {prices[symbol]?.price?.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    }) ?? "—"}
                  </strong>
                  <small>Arcus live market</small>
                </div>
              </aside>
            </div>
            {alarmActive && (
              <button className="stop-alarm" onClick={stopAlarm}>
                ■ Stop alarm sound
              </button>
            )}
          </>
        )}
        {tab === "Alerts" && (
          <>
            <div className="heading">
              <div>
                <small>PRICE MONITOR</small>
                <h1>My Alerts</h1>
                <p>Grouped by market type · maximum 10 alerts per column</p>
              </div>
              <div className="alert-heading-actions">
                <button className="secondary" onClick={() => openQrSync(levels, "All alerts")}>
                  ▦ Export all QR
                </button>
                <button className="secondary" onClick={openTextExport}>
                  ▤ Export all as text
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (window.confirm("Delete every alert? This cannot be undone.")) setLevels([]);
                  }}
                >
                  Delete All
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setScanStatus("Point your camera at the QR code");
                    setScannerOpen(true);
                  }}
                >
                  ⌗ Scan QR
                </button>
                <button onClick={() => setTab("Create")}>＋ New alert</button>
              </div>
            </div>
            {levels.length ? (
              (() => {
                const classify = (sym: string) => classifySymbol(sym, marketCategories.current);
                const groups: Record<string, Level[]> = {
                  Crypto: [],
                  Stocks: [],
                  Commodities: [],
                  Other: [],
                };
                levels.forEach((l) => groups[classify(l.symbol)].push(l));
                return (
                  <div className="alert-groups">
                    {Object.entries(groups)
                      .filter(([, items]) => items.length)
                      .map(([category, items]) => {
                        const chunks = Array.from({ length: Math.ceil(items.length / 10) }, (_, i) =>
                          items.slice(i * 10, (i + 1) * 10),
                        );
                        return (
                          <section className="alert-category" key={category}>
                            <div className="alert-category-head">
                              <div>
                                <h2>
                                  {category === "Crypto"
                                    ? "₿"
                                    : category === "Stocks"
                                      ? "📈"
                                      : "🛢️"}{" "}
                                  {category}
                                </h2>
                                <small>{items.length} alerts</small>
                              </div>
                            </div>
                            <div className="alert-columns">
                              {chunks.map((chunk, index) => (
                                <div className="alert-column" key={category + "-" + index}>
                                  <div className="alert-column-head">
                                    <b>
                                      {category} · {index + 1}
                                    </b>
                                    <span>{chunk.length}/10</span>
                                  </div>
                                  {chunk.map((l) => (
                                    <div
                                      className={
                                        "alert-card " + (selectedAlert === l.id ? "selected" : "")
                                      }
                                      key={l.id}
                                      onClick={() =>
                                        setSelectedAlert(selectedAlert === l.id ? null : l.id)
                                      }
                                    >
                                      <div>
                                        <b>{dn(l.symbol)}</b>
                                        <strong>{l.price.toLocaleString()}</strong>
                                        <small>
                                          {l.mode === "NEAR" ? "Near · 0.1%" : "Touch / cross"} ·
                                          Live {prices[l.symbol]?.price?.toLocaleString() ?? "—"}
                                        </small>
                                      </div>
                                      {selectedAlert === l.id && (
                                        <div className="alert-card-actions">
                                          <button
                                            className="secondary"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSymbol(l.symbol);
                                              setTarget(String(l.price));
                                              setMode(l.mode);
                                              setTab("Create");
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            className="danger"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setLevels((v) => v.filter((x) => x.id !== l.id));
                                              setSelectedAlert(null);
                                            }}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  <button
                                    className="secondary alert-column-qr"
                                    onClick={() =>
                                      openQrSync(chunk, category + " · Column " + (index + 1))
                                    }
                                  >
                                    ▦ QR for this column
                                  </button>
                                  <button
                                    className="danger alert-column-delete"
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "Delete all " + chunk.length + " alerts in this column?",
                                        )
                                      )
                                        setLevels((v) =>
                                          v.filter((l) => !chunk.some((x) => x.id === l.id)),
                                        );
                                    }}
                                  >
                                    Delete column
                                  </button>
                                </div>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                  </div>
                );
              })()
            ) : (
              <div className="empty">No active alerts. Create your first price alert.</div>
            )}
          </>
        )}
        {tab === "Create" && (
          <>
            <div className="heading">
              <div>
                <small>NEW PRICE LEVEL</small>
                <h1>Create alert</h1>
                <p>Choose a market and target price</p>
              </div>
            </div>
            <section className="formcard">
              <label>Market</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {symbols.map((s) => (
                  <option value={s}>{dn(s)}</option>
                ))}
              </select>
              <label>Target price</label>
              <input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Enter target price"
              />
              <label>Condition</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="CROSS">At price</option>
                <option value="TOUCH">Touch / cross</option>
                <option value="NEAR">Near · 0.1%</option>
              </select>
              <button className="primary" onClick={() => addAlert()}>
                Create alert
              </button>
            </section>
          </>
        )}
      </main>
      {qrOpen && (
        <div className="qr-modal-backdrop" onClick={() => setQrOpen(false)}>
          <section className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-head">
              <div>
                <small>ARCUS ALERT</small>
                <h2>{qrTitle}</h2>
              </div>
              <button onClick={() => setQrOpen(false)}>✕</button>
            </div>
            <p>
              {textOnly
                ? "Copy this single text backup and paste it into Import from Text in the Android app. It includes every alert across all columns."
                : "Scan this standard JSON QR code with the Android app. Each column contains up to 9 alerts."}
            </p>
            {!textOnly && qrImage && (
              <img className="qr-image" src={qrImage} alt="Arcus Alert transfer QR code" />
            )}
            {qrImages.length > 1 && (
              <div className="qr-parts">
                <button
                  className="secondary"
                  disabled={qrIndex === 0}
                  onClick={() => {
                    const next = qrIndex - 1;
                    setQrIndex(next);
                    setQrImage(qrImages[next]);
                  }}
                >
                  Previous
                </button>
                <b>
                  QR part {qrIndex + 1} of {qrImages.length}
                </b>
                <button
                  className="secondary"
                  disabled={qrIndex === qrImages.length - 1}
                  onClick={() => {
                    const next = qrIndex + 1;
                    setQrIndex(next);
                    setQrImage(qrImages[next]);
                  }}
                >
                  Next
                </button>
              </div>
            )}
            {qrError && <div className="qr-scan-status">{qrError}</div>}
            {!textOnly && (
              <small className="qr-note">{qrTitle} · Standard JSON · High-resolution QR</small>
            )}
            <label className="qr-text-label">Text backup</label>
            <textarea className="qr-text-export" readOnly value={qrText} />
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(qrText);
                  setStatus("Alert backup copied to clipboard");
                } catch {
                  const el = document.querySelector(
                    ".qr-text-export",
                  ) as HTMLTextAreaElement | null;
                  if (el) {
                    el.focus();
                    el.select();
                    document.execCommand("copy");
                    setStatus("Alert backup copied");
                  }
                }
              }}
            >
              Copy text backup
            </button>
            <button className="primary" onClick={() => setQrOpen(false)}>
              Done
            </button>
          </section>
        </div>
      )}
      {scannerOpen && (
        <div className="qr-modal-backdrop" onClick={() => setScannerOpen(false)}>
          <section className="qr-modal scanner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-modal-head">
              <div>
                <small>ARCUS ALERT</small>
                <h2>Scan alert QR</h2>
              </div>
              <button onClick={() => setScannerOpen(false)}>✕</button>
            </div>
            <p>Allow camera access and point it at the QR code shown on your other device.</p>
            <video ref={qrVideo} className="qr-camera" muted playsInline />
            <div className="qr-scan-status">{scanStatus}</div>
            <button className="secondary" onClick={() => setScannerOpen(false)}>
              Cancel
            </button>
          </section>
        </div>
      )}
      {showAuth && (
        <div className="auth-overlay" onClick={() => setShowAuth(false)}>
          <form
            className="auth-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAuth();
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-heading">
              <div>
                <small>ARCUS ALERT ACCOUNT</small>
                <h2>{authMode === "signup" ? "Create your account" : "Welcome back"}</h2>
                <p>Sync alerts between your laptop and phone.</p>
              </div>
              <button type="button" onClick={() => setShowAuth(false)}>
                ×
              </button>
            </div>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            {authError && <div className="auth-error">{authError}</div>}
            <button className="primary" type="submit" disabled={authBusy}>
              {authBusy ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"}
            </button>
            <button
              className="auth-switch"
              type="button"
              onClick={() => {
                setAuthMode((v) => (v === "login" ? "signup" : "login"));
                setAuthError("");
              }}
            >
              {authMode === "signup"
                ? "Already have an account? Sign in"
                : "New to Arcus Alert? Create an account"}
            </button>
          </form>
        </div>
      )}
      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <section className="history-panel" onClick={(e) => e.stopPropagation()}>
            <div className="history-heading">
              <div>
                <small>TRIGGER LOG</small>
                <h2>Alert History</h2>
              </div>
              <button onClick={() => setShowHistory(false)}>✕</button>
            </div>
            {history.length > 0 ? (
              <>
                <div className="history-list">
                  {history.map((h) => (
                    <div className="history-item" key={h.id + "-" + h.time}>
                      <div>
                        <b>
                          {dn(h.symbol)} · {h.price.toLocaleString()}
                        </b>
                        <small>Triggered at {h.actual.toLocaleString()}</small>
                      </div>
                      <time>{new Date(h.time).toLocaleString()}</time>
                    </div>
                  ))}
                </div>
                <button className="danger" onClick={() => setHistory([])}>
                  Clear history
                </button>
              </>
            ) : (
              <div className="empty">No triggered alerts yet.</div>
            )}
          </section>
        </div>
      )}
      <nav>
        {TABS.map((t, i) => (
          <button className={tab === t ? "active" : ""} onClick={() => setTab(t)} key={t}>
            <span>{["▦", "☆", "⌁", "◔", "⌕", "♧", "＋", "?"][i]}</span>
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
