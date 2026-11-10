# Arcus Alert — qfex experiment (branch `experiment/qfex`)

Backup notes written 2026-11-10. This branch is experimental; `main` and the live release are untouched.
Test site: https://esmail0karimi.github.io/arcus-alert/qfex-test/ (deployed by `deploy-qfex-test.yml` from `preview/build-20`).

## What was built (web app, `desktop/`)

### Agent tab (scanner) — `src/agenttab.tsx`, `src/engine.ts`
- Scans every symbol of the exchanges switched on, on CLOSED candles only (1D trend/levels → 4H structure → 1H trigger → 15M confirmation), after each 15-minute close.
- Dow-theory structure (pivot swings, HH/HL, LH/LL, BOS/CHoCH), supply/demand + swing zones.
- Two separate lists: **Watchlist** (developing, never an entry) and **Ready** (confirmed). Tabs: Ready, Watchlist, LONG, SHORT, Market overview (trend counts, coverage, stale/missing data), Journal, Settings.
- Hard rules: structural stop, net R:R ≥ 1:2 after fees/spread (default 0.1%), quality score ≥ 70, risk per trade ≤ 5% (user setting, default 1%), target = nearest opposing level, and **no READY without a 1H level break** (candle CLOSE beyond a 1H level, strong candle, volume ≥ 1.3× average; a 15M close is enough for the confirming candle).
- Strategies (all toggleable in Settings):
  - Own setups (default ON): `fbk` fake break of the last swing in a 4H trend + 15M range break; `pbw` weak pullback inside a 4H trend (15M box or high-volume reversal candle); `prz` range at a major daily level / Fibonacci zone, then a strong 1H break; `box` ≥2 touches of top and ≥2 of bottom (1% tolerance), a CLOSE outside = signal, main-trend side preferred.
  - Tradecity skill (default ON, tagged "Tradecity"): `tca` level breakout (1D+4H both trending, 1H/15M close beyond last pivot with volume ≥ 1.5×), `tcb` momentum candle setup (pullback on falling volume + engulfing + RSI side of 50), `tcf` fake-out of a pivot level.
  - Earlier generic setups (default OFF): `brk`, `fbo`, `vsh` (V-shape), `mom`.
- Every signal shows: symbol, market, direction, strategy, 1D/4H/1H trend, 15M confirmation, entry (+ method), stop, take profit, net R:R, position size, risk %, score with breakdown, timestamp, technical explanation, and (for watch items) what must happen first.
- Journal: new READY signals are added automatically (switchable); manual add/remove; outcome tracked on closed 1H candles (win = TP before stop, loss = stop first, expires after 48 candles).
- Alerts: in-dashboard toasts, sound/voice, browser notifications (permission), switchable. No Telegram. Alerts only run while the app is open.
- Opening a signal draws entry/stop/TP on the chart and shows the signal basis in the analysis panel.

### Order book tab — `src/orderbook.ts`, `src/obtab.tsx`, `src/zones.ts`, `src/zonespanel.tsx`
- Added Bybit, OKX, Gate, KuCoin, MEXC, Bitget books (reachable when Binance is blocked); clearer "not listed / unreachable" messages.
- New section: symbols in an **accumulation**, **distribution** or **compression box** (4H/1D, closed candles, heuristic).

### Other
- News tab: fixed a crash on incomplete Fed-rates data; `src/errbound.tsx` (`Guard`) keeps a crashing tab from blanking the app.
- Small fixed robot avatar (`src/avatar.tsx`); voice (`src/voice.tsx`).

## Update 2026-11-10
Only the three Tradecity strategies (`tca`, `tcb`, `tcf`) are active in the Agent tab (`ACTIVE` in `src/engine.ts`). All other strategies are disabled in code and hidden from Settings; their code remains for reference and can be re-enabled by extending `ACTIVE`.

## Scalp mode (added 2026-11-10)
Agent tab has a Swing / ⚡ Scalp switch. Scalp reuses the same engine one level down (1H trend, 15M structure, 5M trigger, 1M confirmation; `cfg.scalp` remaps the candle keys), scans ONLY when the user presses the button (scope: favorites + watchlists, or all symbols), and has its own minimum net R:R (default 1:1, setting). Results/journal entries are tagged per mode (⚡ in the journal).

## Known limits (be honest with yourself)
- Strategy rules are NOT backtested. Judge them from the Journal (needs 30+ entries to mean anything).
- Scanning/alerts work only while the app is open.
- Data coverage = exchanges connected in the app; no claim of global coverage. Forex/indices appear only if a connected exchange lists them.
- Tradecity items not implemented (need other data): altcoin filter (BTC/USDT dominance, PAIR/BTC), order-book wall filter, session filter.
- Order books are crypto-oriented; stock/ETF symbols usually have none.

## Working agreements
- Never change the live version; experiments only on `experiment/qfex` and the `qfex-test/` path; nothing to `main`/Release until the owner says so.
- No personal photo is committed or published.
- Test deploy: `gh workflow run deploy-qfex-test.yml --ref preview/build-20` (the workflow sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; the web build does not need Electron).
