const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let quitting = false;
let pollTimer = null;
let alarmTimer = null;
let alarmUntil = 0;
async function pollArcusPrices() {
  try {
    const response = await fetch('https://api.arcus.xyz/v1/prices', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('Arcus HTTP ' + response.status);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected Arcus response');
    const prices = {};
    for (const [marketId, item] of Object.entries(data)) {
      if (!item || !item.marketDisplayName) continue;
      const raw = item.markPrice ?? item.oraclePrice;
      const price = Number(raw);
      if (Number.isFinite(price)) prices[String(item.marketDisplayName).toUpperCase()] = { price, source: item.markPrice != null ? 'mark' : 'oracle', marketId };
    }
    if (!Object.keys(prices).length) throw new Error('No Arcus market prices returned');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:prices', { prices, updatedAt: Date.now() });
  } catch (error) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:price-error', error.message); }
}


const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#09182a"/><path d="M5 26 15 5h5l7 21h-6l-4-13-6 13z" fill="#00dcd2"/></svg>`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
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
});

app.on('before-quit', () => { quitting = true; if (pollTimer) clearInterval(pollTimer); });
app.on('window-all-closed', event => { event.preventDefault?.(); });
app.on('activate', showWindow);
ipcMain.on('arcus:minimize-to-tray', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.on('arcus:alert', (_event, payload) => {
  const title = String(payload?.title || 'Arcus Alert');
  const body = String(payload?.body || 'Price alert triggered');
  if (Notification.isSupported()) new Notification({ title, body, urgency: 'critical' }).show();
  if (alarmTimer) clearInterval(alarmTimer);
  alarmUntil = Date.now() + 60000;
  shell.beep();
  alarmTimer = setInterval(() => {
    if (Date.now() >= alarmUntil) { clearInterval(alarmTimer); alarmTimer = null; return; }
    shell.beep();
  }, 5000);
});
ipcMain.on('arcus:stop-sound', () => { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = null; alarmUntil = 0; });
