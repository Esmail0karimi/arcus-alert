const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcusDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  minimizeToTray: () => ipcRenderer.send('arcus:minimize-to-tray')
}));
