const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, ipcMain, net, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;
let tray = null;
let quitting = false;
let pollTimer = null;
let pollDelay = 15000;
let pollInFlight = false;
let alarmTimer = null;
let alarmUntil = 0;
let notificationRepeatTimer = null;
let activeNotification = null;
let activeNotificationSymbol = '';
let activeNotificationTitle = 'Arcus Alert';
let activeNotificationBody = 'Price alert triggered';
async function pollArcusPrices() {
  if (pollInFlight) return;
  pollInFlight = true;
  let failed = false;
  try {
    // Use Electron's Chromium-backed network stack instead of Node's global fetch.
    const response = await net.fetch('https://api.arcus.xyz/v1/prices', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) {
      failed = true;
      const detail = (await response.text()).slice(0, 240);
      throw new Error('Arcus HTTP ' + response.status + (detail ? ': ' + detail : ''));
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected Arcus response');
    const prices = {};
    for (const [marketId, item] of Object.entries(data)) {
      if (!item || !item.marketDisplayName) continue;
      const raw = item.markPrice ?? item.oraclePrice;
      const price = Number(raw);
      if (Number.isFinite(price)) {
        prices[String(item.marketDisplayName).toUpperCase()] = { price, source: item.markPrice != null ? 'mark' : 'oracle', marketId, change24h: null };
      }
    }
    // Arcus exposes 24h market statistics on /v1/markets (not /v1/prices).
    // priceChange24h is a fraction, so convert it to percentage points for the UI.
    try {
      const marketResponse = await net.fetch('https://api.arcus.xyz/v1/markets', {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (marketResponse.ok) {
        const marketPayload = await marketResponse.json();
        const markets = Array.isArray(marketPayload) ? marketPayload : marketPayload.markets;
        if (Array.isArray(markets)) {
          for (const market of markets) {
            const name = String(market?.marketDisplayName || '').toUpperCase();
            if (!name || !prices[name]) continue;
            const rawChange = market.priceChange24h;
            const fraction = rawChange == null ? NaN : Number(rawChange);
            prices[name].change24h = Number.isFinite(fraction) ? fraction * 100 : null;
          }
        }
      }
    } catch (marketStatsError) {
      // Keep live prices available if the separate 24h statistics request fails.
    }
    if (!Object.keys(prices).length) throw new Error('No Arcus market prices returned');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:prices', { prices, updatedAt: Date.now() });
  } catch (error) { failed = true; if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) mainWindow.webContents.send('arcus:price-error', error.message); }
  finally {
    pollInFlight = false;
    pollDelay = failed ? Math.min(Math.max(pollDelay * 2, 30000), 120000) : 15000;
    if (!quitting) { clearTimeout(pollTimer); pollTimer = setTimeout(pollArcusPrices, pollDelay); }
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
  // Start Arcus market polling immediately and keep the desktop feed fresh.
  pollArcusPrices();
  pollTimer = setTimeout(pollArcusPrices, 15000);
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
