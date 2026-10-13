const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let quitting = false;\nlet pollTimer = null;\nlet alarmTimer = null;\nlet alarmUntil = 0;\nasync function pollArcusPrices() {\n  try {\n    const response = await fetch('https://api.arcus.xyz/v1/prices', { headers: { Accept: 'application/json' }, cache: 'no-store' });\n    if (!response.ok) throw new Error('Arcus HTTP ' + response.status);\n    const data = await response.json();\n    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected Arcus response');\n    const prices = {};\n    for (const [marketId, item] of Object.entries(data)) {\n      if (!item || !item.marketDisplayName) continue;\n      const raw = item.markPrice ?? item.oraclePrice;\n      const price = Number(raw);\n      if (Number.isFinite(price)) prices[String(item.marketDisplayName).toUpperCase()] = { price, source: item.markPrice != null ? 'mark' : 'oracle', marketId };\n    }\n    if (!Object.keys(prices).length) throw new Error('No Arcus market prices returned');\n    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:prices', { prices, updatedAt: Date.now() });\n  } catch (error) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcus:price-error', error.message); }\n}\n

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
app.on('activate', showWindow);\nipcMain.on('arcus:minimize-to-tray', () => { if (mainWindow) mainWindow.hide(); });\nipcMain.on('arcus:alert', (_event, payload) => {\n  const title = String(payload?.title || 'Arcus Alert');\n  const body = String(payload?.body || 'Price alert triggered');\n  if (Notification.isSupported()) new Notification({ title, body, urgency: 'critical' }).show();\n  if (alarmTimer) clearInterval(alarmTimer);\n  alarmUntil = Date.now() + 60000;\n  shell.beep();\n  alarmTimer = setInterval(() => {\n    if (Date.now() >= alarmUntil) { clearInterval(alarmTimer); alarmTimer = null; return; }\n    shell.beep();\n  }, 5000);\n});\nipcMain.on('arcus:stop-sound', () => { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = null; alarmUntil = 0; });
