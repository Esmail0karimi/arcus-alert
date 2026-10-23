const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, ipcMain, net, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;
let tray = null;
let quitting = false;
let socket = null;
let wsRetryTimer = null;
let wsRetryDelay = 1000;
let lastMarketsFetch = 0;
let latestPrices = {};
let alarmTimer = null;
let alarmUntil = 0;
let notificationRepeatTimer = null;
let activeNotification = null;
let activeNotificationSymbol = '';
let activeNotificationTitle = 'Arcus Alert';
let activeNotificationBody = 'Price alert triggered';

function publishPrices() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('arcus:prices', { prices: latestPrices, updatedAt: Date.now() });
  }
}

async function refreshArcusMarketStats() {
  if (Date.now() - lastMarketsFetch < 60000) return;
  lastMarketsFetch = Date.now();
  try {
    const response = await net.fetch('https://api.arcus.xyz/v1/markets', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return;
    const payload = await response.json();
    const markets = Array.isArray(payload) ? payload : payload.markets;
    if (!Array.isArray(markets)) return;
    for (const market of markets) {
      const name = String(market?.marketDisplayName || '').toUpperCase();
      if (!name || !latestPrices[name]) continue;
      const rawChange = market.priceChange24h;
      const fraction = rawChange == null ? NaN : Number(rawChange);
      latestPrices[name].change24h = Number.isFinite(fraction) ? fraction * 100 : null;
    }
    publishPrices();
  } catch {
    // Price delivery stays independent from optional 24h market statistics.
  }
}

function handleArcusPriceMessage(incoming) {
  if (!Array.isArray(incoming)) return;
  for (const item of incoming) {
    const name = String(item?.marketDisplayName || '').toUpperCase();
    const marketId = String(item?.marketId ?? '');
    const price = Number(item?.markPrice ?? item?.price);
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    latestPrices[name] = {
      price,
      source: item?.markPrice != null ? 'mark' : 'oracle',
      marketId: marketId || latestPrices[name]?.marketId || '',
      change24h: latestPrices[name]?.change24h ?? null
    };
  }
  if (Object.keys(latestPrices).length) publishPrices();
}

function scheduleArcusReconnect() {
  if (quitting || wsRetryTimer) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('arcus:price-error', 'Arcus WebSocket disconnected · reconnecting…');
  }
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    connectArcusWebSocket();
  }, wsRetryDelay);
  wsRetryDelay = Math.min(wsRetryDelay * 2, 30000);
}

function connectArcusWebSocket() {
  if (quitting) return;
  const ArcusWebSocket = globalThis.WebSocket;
  if (typeof ArcusWebSocket !== 'function') {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('arcus:price-error', 'This Electron runtime does not provide native WebSocket support.');
    }
    wsRetryDelay = Math.max(wsRetryDelay, 30000);
    scheduleArcusReconnect();
    return;
  }

  try {
    const currentSocket = new ArcusWebSocket('wss://api.arcus.xyz/v1/ws');
    socket = currentSocket;
    currentSocket.addEventListener('open', () => {
      if (socket !== currentSocket) return;
      wsRetryDelay = 1000;
      currentSocket.send(JSON.stringify({ type: 'subscribe', channel: 'oraclePrices' }));
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('arcus:prices', { prices: latestPrices, updatedAt: Date.now() });
      }
      void refreshArcusMarketStats();
    });
    currentSocket.addEventListener('message', event => {
      if (socket !== currentSocket) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message?.type === 'error' || Number(message?.status) >= 400) {
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
            mainWindow.webContents.send('arcus:price-error', 'Arcus WebSocket error · ' + String(message?.message || message?.error || message?.status));
          }
          return;
        }
        if (message?.channel === 'oraclePrices') {
          handleArcusPriceMessage(message.contents?.prices);
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
            mainWindow.webContents.send('arcus:price-status', 'Live · Arcus WebSocket');
          }
        } else if (message?.channel === 'markets') {
          void refreshArcusMarketStats();
        }
      } catch {
        // Ignore malformed frames and keep the live socket connected.
      }
    });
    currentSocket.addEventListener('error', () => {
      if (socket !== currentSocket) return;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('arcus:price-error', 'Arcus WebSocket connection error · reconnecting…');
      }
    });
    currentSocket.addEventListener('close', () => {
      if (socket !== currentSocket) return;
      socket = null;
      scheduleArcusReconnect();
    });
  } catch {
    socket = null;
    scheduleArcusReconnect();
  }
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#09182a"/><path d="M5 26 15 5h5l7 21h-6l-4-13-6 13z" fill="#00dcd2"/></svg>`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    show: true,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  const image = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(iconSvg).toString('base64'));
  tray = new Tray(image);
  tray.setToolTip('Arcus Alert — price monitoring');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Arcus Alert', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Arcus Alert', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showWindow);
}

app.whenReady().then(() => {
  app.setAppUserModelId('xyz.arcus.alert.desktop');
  Notification.requestPermission?.();
  createTray();
  createWindow();
  // Live prices are delivered by Arcus WebSocket; REST is used only for 24h market metadata.
  connectArcusWebSocket();
});

app.on('before-quit', () => { quitting = true; if (pollTimer) clearTimeout(pollTimer); });
app.on('window-all-closed', event => { event.preventDefault?.(); });
app.on('activate', showWindow);
ipcMain.on('arcus:minimize-to-tray', () => { if (mainWindow) mainWindow.hide(); });
function clearPersistentNotification() {
  if (notificationRepeatTimer) clearInterval(notificationRepeatTimer);
  notificationRepeatTimer = null;
  if (activeNotification) { try { activeNotification.close(); } catch {} }
  activeNotification = null;
}
function showPersistentNotification() {
  if (!Notification.isSupported()) return;
  if (activeNotification) { try { activeNotification.close(); } catch {} }
  const notification = new Notification({
    title: activeNotificationTitle,
    body: activeNotificationBody,
    urgency: 'critical',
    silent: true
  });
  activeNotification = notification;
  notification.on('click', () => {
    const targetSymbol = activeNotificationSymbol;
    clearPersistentNotification();
    showWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const sendNavigation = () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:notification-clicked', targetSymbol);
      };
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', sendNavigation);
      else setTimeout(sendNavigation, 250);
    }
  });
  notification.show();
}
ipcMain.on('arcus:alert', (_event, payload) => {
  const title = String(payload?.title || 'Arcus Alert');
  const body = String(payload?.body || 'Price alert triggered');
  activeNotificationSymbol = String(payload?.symbol || '');
  clearPersistentNotification();
  // Re-show the Windows toast periodically until the user clicks it.
  activeNotificationTitle = title;
  activeNotificationBody = body;
  showPersistentNotification();
  notificationRepeatTimer = setInterval(() => showPersistentNotification(), 10000);
  if (alarmTimer) clearInterval(alarmTimer);
  alarmUntil = Date.now() + 60000;
  const sound = String(payload?.sound || 'double');
  const pattern = sound === 'triple' ? [0, 350, 700] : sound === 'double' ? [0, 500] : sound === 'beep' ? [0] : [];
  if (pattern.length) {
    const play = () => pattern.forEach(delay => setTimeout(() => { if (Date.now() < alarmUntil) shell.beep(); }, delay));
    play();
    alarmTimer = setInterval(() => {
      if (Date.now() >= alarmUntil) { clearInterval(alarmTimer); alarmTimer = null; return; }
      play();
    }, 5000);
  }
});
ipcMain.on('arcus:stop-sound', () => { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = null; alarmUntil = 0; });

ipcMain.handle('arcus:choose-sound', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose alert sound', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3','wav','ogg','m4a'] }] }); return result.canceled || !result.filePaths[0] ? null : pathToFileURL(result.filePaths[0]).href; });
