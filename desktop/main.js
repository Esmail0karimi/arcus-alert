const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let quitting = false;

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

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
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

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', event => { event.preventDefault?.(); });
app.on('activate', showWindow);
