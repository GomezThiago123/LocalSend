import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
  shell,
  nativeTheme
} from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, statSync } from 'fs'
import Store from 'electron-store'
import { UdpDiscoveryServer } from './udpServer'
import { WsTransferServer, WS_PORT } from './wsServer'

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

let mainWindow: BrowserWindow | null = null
let udpServer: UdpDiscoveryServer | null = null
let wsServer: WsTransferServer | null = null

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
  const downloadDir = store.get('downloadDir')

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
  wsServer.on('transferError', (payload: { id: string; reason: string }) => {
    mainWindow?.webContents.send('transfer:error', payload)
  })

  await udpServer.start()
}

// IPC Handlers
ipcMain.handle('config:get', () => ({
  alias: store.get('alias'),
  downloadDir: store.get('downloadDir'),
  localIp: udpServer?.getLocalIp() ?? '127.0.0.1'
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  udpServer?.stop()
  wsServer?.stop()
  if (process.platform !== 'darwin') app.quit()
})
