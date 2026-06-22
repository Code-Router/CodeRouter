import { contextBridge, ipcRenderer } from 'electron';

/**
 * Typed bridge between the renderer and main. We only expose the daemon
 * URL resolution — all data flows over plain HTTP/SSE to the loopback
 * daemon, which keeps the renderer identical whether it runs in Electron
 * or a plain browser (handy for development).
 */
contextBridge.exposeInMainWorld('coderouter', {
  getDaemonUrl: (): Promise<string> => ipcRenderer.invoke('daemon:url'),
  isElectron: true,
  platform: process.platform,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
});
