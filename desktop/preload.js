const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcusDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  minimizeToTray: () => ipcRenderer.send('arcus:minimize-to-tray'),
  onPrices: callback => ipcRenderer.on('arcus:prices', (_event, data) => callback(data)),
  onPriceError: callback => ipcRenderer.on('arcus:price-error', (_event, message) => callback(message)),
  alert: payload => ipcRenderer.send('arcus:alert', payload),
  onNotificationClick: callback => ipcRenderer.on('arcus:notification-clicked', (_event, symbol) => callback(symbol)),
  chooseSound: () => ipcRenderer.invoke('arcus:choose-sound'),
  stopSound: () => ipcRenderer.send('arcus:stop-sound')
}));
