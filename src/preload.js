const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catApi', {
  onForeground: (cb) => ipcRenderer.on('activity:foreground', (_e, payload) => cb(payload)),
  onState: (cb) => ipcRenderer.on('pet:state', (_e, payload) => cb(payload)),
  onFrameAdvance: (cb) => ipcRenderer.on('pet:frame-advance', () => cb()),
  onNotify: (cb) => ipcRenderer.on('pet:notify', (_e, payload) => cb(payload)),
  dragBegin: () => ipcRenderer.send('pet:drag-begin'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  testWalk: () => ipcRenderer.send('pet:test-walk'),
  setPassthrough: (passthrough) => ipcRenderer.send('pet:set-passthrough', passthrough),
  openUrl: (url) => ipcRenderer.send('pet:open-url', url),
  notifyResize: (count) => ipcRenderer.send('pet:notify-resize', count),
  quit: () => ipcRenderer.invoke('app:quit'),
});
