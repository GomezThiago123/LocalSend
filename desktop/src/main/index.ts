import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
  shell,
  nativeTheme
} from 'electron'
import { join, basename } from 'path'
import { homedir } from 'os'
import { existsSync, statSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import Store from 'electron-store'
import { UdpDiscoveryServer } from './udpServer'
import { WsTransferServer, WS_PORT } from './wsServer'
import { WsTransferClient } from './wsClient'
import { getLanIp } from './network'
import type { DiscoveredDevice } from './udpServer'

interface AppConfig {
  alias: string
  downloadDir: string
}

const store = new Store<AppConfig>({
  defaults: {
    alias: `LocalSend-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    downloadDir: join(homedir(), 'Downloads')
  }
})

// El default de arriba asume inglés; en locales no-inglés (ej. "Descargas" en
// español) esa carpeta no existe. app.getPath resuelve el nombre real vía XDG/SO.
function resolveDownloadDir(): string {
  const configured = store.get('downloadDir')
  if (existsSync(configured)) return configured
  const systemDownloads = app.getPath('downloads')
  store.set('downloadDir', systemDownloads)
  return systemDownloads
}

let mainWindow: BrowserWindow | null = null
let udpServer: UdpDiscoveryServer | null = null
let wsServer: WsTransferServer | null = null

// Envíos desktop→desktop en curso, para poder cortarlos si se cae la red
const activeClients = new Set<WsTransferClient>()

// --- Estado de la red ---
// Cada 2s miramos si la PC sigue teniendo IP en una red real. Al perderla
// avisamos a la UI (banner "Sin conexión") y cortamos las transferencias en
// curso para que fallen con error en vez de quedar colgadas.
const NETWORK_POLL_MS = 2000
let lastLanIp: string | null = getLanIp()

function networkStatus(): { online: boolean; localIp: string } {
  return { online: lastLanIp !== null, localIp: lastLanIp ?? '—' }
}

function startNetworkMonitor(): void {
  setInterval(() => {
    const ip = getLanIp()
    if (ip === lastLanIp) return
    const wasOnline = lastLanIp !== null
    lastLanIp = ip
    if (wasOnline && ip === null) {
      wsServer?.dropAllConnections()
      for (const client of activeClients) client.cancel()
    }
    mainWindow?.webContents.send('network:status', networkStatus())
  }, NETWORK_POLL_MS)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a2e' : '#f8fafc',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function startServers(): Promise<void> {
  const alias = store.get('alias')
  const downloadDir = resolveDownloadDir()

  wsServer = new WsTransferServer(downloadDir)
  wsServer.setAlias(alias)
  await wsServer.start()

  udpServer = new UdpDiscoveryServer(alias, WS_PORT)

  udpServer.on('deviceFound', (device) => {
    mainWindow?.webContents.send('device:found', device)
  })
  udpServer.on('deviceUpdated', (device) => {
    mainWindow?.webContents.send('device:updated', device)
  })
  udpServer.on('deviceLost', (ip: string) => {
    mainWindow?.webContents.send('device:lost', ip)
  })

  // Mobile devices register via HTTP POST /register (Expo Go compatible)
  wsServer.on('deviceFound', (device) => {
    mainWindow?.webContents.send('device:found', device)
  })
  wsServer.on('deviceLost', (ip: string) => {
    mainWindow?.webContents.send('device:lost', ip)
  })
  // Un celular vinculado dejó de responder al latido: se quedó sin Wi-Fi
  wsServer.on('peerOffline', (peer: { ip: string; alias: string }) => {
    mainWindow?.webContents.send('peer:offline', peer)
  })

  wsServer.on('transferRequest', (meta) => {
    mainWindow?.webContents.send('transfer:request', meta)
    // native notification while app is in background
    if (!mainWindow?.isFocused()) {
      const notif = new Notification({
        title: 'LocalSend — Incoming file',
        body: `${meta.senderAlias} wants to send "${meta.filename}"`,
        actions: [
          { type: 'button', text: 'Accept' },
          { type: 'button', text: 'Reject' }
        ],
        closeButtonText: 'Reject'
      })
      notif.on('action', (_, idx) => {
        wsServer!.resolveTransfer(meta.id, idx === 0)
        mainWindow?.webContents.send('transfer:decision', { id: meta.id, accepted: idx === 0 })
      })
      notif.show()
    }
  })

  wsServer.on('transferCollision', (data: { id: string; filename: string }) => {
    mainWindow?.webContents.send('transfer:collision', data)
  })
  wsServer.on('transferStart', (meta) => {
    mainWindow?.webContents.send('transfer:start', meta)
  })
  wsServer.on('transferProgress', (progress) => {
    mainWindow?.webContents.send('transfer:progress', progress)
  })
  wsServer.on('transferDone', (meta) => {
    mainWindow?.webContents.send('transfer:done', meta)
    new Notification({
      title: 'LocalSend — Transfer complete',
      body: `"${meta.filename}" received from ${meta.senderAlias}`
    }).show()
  })
  wsServer.on('transferError', (payload: { id: string; reason: string; senderAlias?: string }) => {
    mainWindow?.webContents.send('transfer:error', payload)
    const who = payload.senderAlias ?? 'El otro dispositivo'
    const body =
      payload.reason === 'local-offline' ? 'Esta PC se quedó sin conexión Wi-Fi. El archivo no se pudo recibir.'
      : payload.reason === 'peer-offline' ? `"${who}" se quedó sin conexión Wi-Fi. El archivo no se pudo recibir.`
      : 'Se perdió la conexión y el archivo no se pudo recibir.'
    new Notification({ title: 'LocalSend — Transferencia interrumpida', body }).show()
  })

  await udpServer.start()
}

// IPC Handlers
ipcMain.handle('config:get', () => ({
  alias: store.get('alias'),
  downloadDir: store.get('downloadDir'),
  ...networkStatus()
}))

ipcMain.handle('config:setAlias', (_, alias: string) => {
  store.set('alias', alias)
  wsServer?.setAlias(alias)
  // restart udp with new alias
  udpServer?.stop()
  udpServer = new UdpDiscoveryServer(alias, WS_PORT)
  udpServer.on('deviceFound', (d) => mainWindow?.webContents.send('device:found', d))
  udpServer.on('deviceUpdated', (d) => mainWindow?.webContents.send('device:updated', d))
  udpServer.on('deviceLost', (ip: string) => mainWindow?.webContents.send('device:lost', ip))
  udpServer.start()
})

ipcMain.handle('config:setDownloadDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    const dir = result.filePaths[0]
    store.set('downloadDir', dir)
    wsServer?.setDownloadDir(dir)
    return dir
  }
  return null
})

ipcMain.handle('transfer:decide', (_, id: string, accepted: boolean) => {
  wsServer?.resolveTransfer(id, accepted)
})

ipcMain.handle('transfer:resolveCollision', (_, id: string, choice: 'replace' | 'rename' | 'skip') => {
  wsServer?.resolveCollision(id, choice)
})

ipcMain.handle('devices:list', () => udpServer?.getDevices() ?? [])

ipcMain.handle('transfer:sendFiles', async (_, device: DiscoveredDevice, filePaths: string[]) => {
  const alias = store.get('alias')
  for (const filePath of filePaths) {
    const id = uuidv4()
    const filename = basename(filePath)
    const { size } = statSync(filePath)
    mainWindow?.webContents.send('send:start', { id, filename, size, targetAlias: device.alias, targetIp: device.ip, bytesSent: 0, speedBps: 0, status: 'waiting' })
    let client: WsTransferClient | null = null
    try {
      if (lastLanIp === null) {
        throw new Error('Sin conexión de red: conectá la PC al Wi-Fi e intentá de nuevo.')
      }
      if (device.deviceType === 'mobile') {
        if (!wsServer) throw new Error('El servidor no está listo todavía')
        // El móvil no corre un servidor propio: reutilizamos la conexión
        // persistente que él mismo registró (ver wsServer.pushFile).
        await wsServer.pushFile(device.ip, filePath, alias, (p) => {
          mainWindow?.webContents.send('send:progress', { id, ...p })
        })
      } else {
        client = new WsTransferClient()
        activeClients.add(client)
        client.on('progress', (p) => mainWindow?.webContents.send('send:progress', { id, ...p }))
        client.on('status', (s) => mainWindow?.webContents.send('send:status', { id, status: s }))
        await client.sendFile(device.ip, device.port, filePath, alias)
      }
      mainWindow?.webContents.send('send:done', { id })
      new Notification({
        title: 'LocalSend — Envío completo',
        body: `"${filename}" enviado a ${device.alias}`
      }).show()
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown'
      mainWindow?.webContents.send('send:error', { id, reason })
      if (reason !== 'rejected') {
        new Notification({
          title: 'LocalSend — No se pudo enviar',
          body: `"${filename}" no llegó a ${device.alias}: ${reason}`
        }).show()
      }
    } finally {
      if (client) activeClients.delete(client)
    }
  }
})

ipcMain.handle('shell:openPath', (_, filePath: string) => {
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    shell.openPath(filePath)
  } else {
    shell.showItemInFolder(filePath)
  }
})

ipcMain.handle('dialog:pickFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections']
  })
  return result.canceled ? [] : result.filePaths
})

app.whenReady().then(async () => {
  createWindow()
  await startServers()
  startNetworkMonitor()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  udpServer?.stop()
  wsServer?.stop()
  if (process.platform !== 'darwin') app.quit()
})
