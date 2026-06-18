import { contextBridge, ipcRenderer } from 'electron'
import type { DiscoveredDevice } from '../main/udpServer'
import type { TransferMetadata, TransferProgress } from '../main/wsServer'

/*
  Why contextBridge?
  The renderer runs in a sandboxed context — it cannot import Node.js or Electron modules
  directly. contextBridge exposes a safe, typed surface area so React code never touches
  raw IPC or the filesystem.
*/
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setAlias: (alias: string) => ipcRenderer.invoke('config:setAlias', alias),
  setDownloadDir: () => ipcRenderer.invoke('config:setDownloadDir'),

  // Devices
  listDevices: () => ipcRenderer.invoke('devices:list'),

  // Transfer actions
  decideTransfer: (id: string, accepted: boolean) =>
    ipcRenderer.invoke('transfer:decide', id, accepted),
  resolveCollision: (id: string, choice: 'replace' | 'rename' | 'skip') =>
    ipcRenderer.invoke('transfer:resolveCollision', id, choice),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),

  // Push events → renderer
  onDeviceFound: (cb: (d: DiscoveredDevice) => void) => {
    ipcRenderer.on('device:found', (_, d) => cb(d))
  },
  onDeviceUpdated: (cb: (d: DiscoveredDevice) => void) => {
    ipcRenderer.on('device:updated', (_, d) => cb(d))
  },
  onDeviceLost: (cb: (ip: string) => void) => {
    ipcRenderer.on('device:lost', (_, ip) => cb(ip))
  },
  onTransferRequest: (cb: (meta: TransferMetadata) => void) => {
    ipcRenderer.on('transfer:request', (_, meta) => cb(meta))
  },
  onTransferStart: (cb: (meta: TransferMetadata) => void) => {
    ipcRenderer.on('transfer:start', (_, meta) => cb(meta))
  },
  onTransferProgress: (cb: (p: TransferProgress) => void) => {
    ipcRenderer.on('transfer:progress', (_, p) => cb(p))
  },
  onTransferDone: (cb: (meta: TransferMetadata) => void) => {
    ipcRenderer.on('transfer:done', (_, meta) => cb(meta))
  },
  onTransferError: (cb: (payload: { id: string; reason: string }) => void) => {
    ipcRenderer.on('transfer:error', (_, payload) => cb(payload))
  },
  onTransferDecision: (cb: (d: { id: string; accepted: boolean }) => void) => {
    ipcRenderer.on('transfer:decision', (_, d) => cb(d))
  },
  onTransferCollision: (cb: (d: { id: string; filename: string }) => void) => {
    ipcRenderer.on('transfer:collision', (_, d) => cb(d))
  },

  // Outgoing file send
  sendFiles: (device: DiscoveredDevice, filePaths: string[]) =>
    ipcRenderer.invoke('transfer:sendFiles', device, filePaths),

  onSendStart: (cb: (t: Record<string, unknown>) => void) => {
    ipcRenderer.on('send:start', (_, t) => cb(t))
  },
  onSendProgress: (cb: (p: Record<string, unknown>) => void) => {
    ipcRenderer.on('send:progress', (_, p) => cb(p))
  },
  onSendStatus: (cb: (d: { id: string; status: string }) => void) => {
    ipcRenderer.on('send:status', (_, d) => cb(d))
  },
  onSendDone: (cb: (d: { id: string }) => void) => {
    ipcRenderer.on('send:done', (_, d) => cb(d))
  },
  onSendError: (cb: (e: { id: string; reason: string }) => void) => {
    ipcRenderer.on('send:error', (_, e) => cb(e))
  },

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
