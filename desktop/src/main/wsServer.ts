import { WebSocketServer, WebSocket } from 'ws'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'

export const WS_PORT = 53318

export interface TransferMetadata {
  id: string
  filename: string
  size: number
  mime: string
  senderIp: string
  senderAlias: string
}

export interface TransferProgress {
  id: string
  bytesReceived: number
  totalBytes: number
  speedBps: number
}

type TransferState = 'pending' | 'accepted' | 'rejected' | 'receiving' | 'done' | 'error'

interface ActiveTransfer {
  meta: TransferMetadata
  state: TransferState
  writeStream: fs.WriteStream | null
  bytesReceived: number
  startTime: number
  savedPath: string
  resolve: (accepted: boolean) => void
}

// 256 KB: el desktop lee de disco sin problema y el móvil parsea el JSON sin
// trabarse. Con 48 KB un video de 500 MB eran ~11.000 idas y vueltas de ack.
const PUSH_CHUNK_BYTES = 256 * 1024

// Si se corta el Wi-Fi de golpe, TCP no avisa: el socket queda "abierto" pero
// mudo y nunca llega 'close'. Sin estos timeouts la transferencia quedaría
// colgada para siempre en vez de mostrar el error.
const ACK_TIMEOUT_MS = 15000
const RECV_IDLE_TIMEOUT_MS = 15000

// Latido: cada 3s mandamos un ping a cada conexión. El WebSocket del móvil
// responde el pong solo (a nivel nativo, aunque el JS esté ocupado). Si se
// pierden 2 seguidos, el otro dispositivo se quedó sin red.
const HEARTBEAT_MS = 3000
const MAX_MISSED_PONGS = 2

// Por qué se cortó una conexión — define qué mensaje ve el usuario:
//  - 'local-offline': ESTA PC perdió la red
//  - 'peer-offline':  el OTRO dispositivo dejó de responder (se quedó sin Wi-Fi)
//  - 'connection':    el otro cerró la conexión normalmente (cerró la app, etc.)
export type DropReason = 'local-offline' | 'peer-offline' | 'connection'

interface PushWaiter<T = void> {
  resolve: (v: T) => void
  reject: (err: Error) => void
}

interface PushWaiters {
  decision?: PushWaiter<boolean>
  chunkAck?: PushWaiter
  finalAck?: PushWaiter
}

export interface PushProgress {
  bytesSent: number
  totalBytes: number
  speedBps: number
}

export class WsTransferServer extends EventEmitter {
  private httpServer: http.Server
  private wss: WebSocketServer
  private downloadDir: string
  private pendingDecisions = new Map<string, ActiveTransfer>()

  // Conexiones WebSocket persistentes que un móvil abre para poder recibir
  // archivos (Desktop→Mobile). El móvil no puede correr un servidor propio
  // dentro de Expo Go, así que en su lugar mantiene abierta la conexión que
  // él mismo inició y la usamos en ambos sentidos.
  private receivers = new Map<string, WebSocket>()
  private receiverAliases = new Map<string, string>()
  private pushWaiters = new Map<string, PushWaiters>()

  private dropReasons = new WeakMap<WebSocket, DropReason>()
  private missedPongs = new WeakMap<WebSocket, number>()
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(downloadDir: string) {
    super()
    this.downloadDir = downloadDir
    this.httpServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')

      // Mobile discovery: GET /info returns this device's metadata
      if (req.method === 'GET' && req.url === '/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ alias: this.alias, deviceType: 'desktop', port: WS_PORT }))
        return
      }

      // Mobile registration: POST /register → desktop shows mobile in its device list
      if (req.method === 'POST' && req.url === '/register') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const senderIp = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown'
            this.emit('deviceFound', {
              alias: data.alias ?? senderIp,
              deviceType: data.deviceType ?? 'mobile',
              ip: senderIp,
              port: data.port ?? WS_PORT,
              lastSeen: Date.now()
            })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400)
            res.end()
          }
        })
        return
      }

      // DELETE /register → mobile going offline
      if (req.method === 'DELETE' && req.url === '/register') {
        const senderIp = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown'
        this.emit('deviceLost', senderIp)
        res.writeHead(200)
        res.end()
        return
      }

      res.writeHead(404)
      res.end()
    })
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
  }

  // Corta la conexión recordando el motivo, que lee el handler de 'close'
  private drop(ws: WebSocket, reason: DropReason): void {
    if (!this.dropReasons.has(ws)) this.dropReasons.set(ws, reason)
    ws.terminate()
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.wss.clients) {
        const missed = this.missedPongs.get(ws) ?? 0
        if (missed >= MAX_MISSED_PONGS) {
          this.drop(ws, 'peer-offline')
          continue
        }
        this.missedPongs.set(ws, missed + 1)
        ws.ping()
      }
    }, HEARTBEAT_MS)
  }

  private peerName(ip: string): string {
    return this.receiverAliases.get(ip) ?? ip
  }

  // Mensaje para el usuario según por qué se cortó la conexión con `ip`
  private dropMessage(reason: DropReason, ip: string): string {
    if (reason === 'local-offline') return 'Esta PC se quedó sin conexión Wi-Fi.'
    if (reason === 'peer-offline') return `El celular "${this.peerName(ip)}" se quedó sin conexión Wi-Fi.`
    return `El celular "${this.peerName(ip)}" cerró la conexión.`
  }

  private alias = 'LocalSend Desktop'

  setAlias(alias: string): void {
    this.alias = alias
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const senderIp = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown'
    let transfer: ActiveTransfer | null = null
    let idleTimer: NodeJS.Timeout | null = null

    this.missedPongs.set(ws, 0)
    ws.on('pong', () => this.missedPongs.set(ws, 0))

    // Mientras recibimos, si el emisor deja de mandar chunks cortamos la conexión:
    // terminate() dispara 'close', que marca la transferencia como fallida.
    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => this.drop(ws, 'peer-offline'), RECV_IDLE_TIMEOUT_MS)
    }
    const clearIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = null
    }

    ws.on('message', async (data, isBinary) => {
      if (!isBinary) {
        // JSON control message
        try {
          const msg = JSON.parse(data.toString())

          if (msg.type === 'register') {
            // El móvil se anuncia como receptor: guardamos esta conexión para
            // poder empujarle archivos más adelante (Desktop→Mobile).
            this.receivers.set(senderIp, ws)
            this.receiverAliases.set(senderIp, String(msg.alias ?? senderIp))
            ws.send(JSON.stringify({ type: 'registered' }))

          } else if (msg.type === 'decision' && this.pushWaiters.has(senderIp)) {
            // Respuesta del móvil a un envío que nosotros iniciamos
            this.pushWaiters.get(senderIp)?.decision?.resolve(msg.accepted)

          } else if (msg.type === 'chunkAck' && this.pushWaiters.has(senderIp)) {
            this.pushWaiters.get(senderIp)?.chunkAck?.resolve()

          } else if (msg.type === 'ack' && this.pushWaiters.has(senderIp)) {
            this.pushWaiters.get(senderIp)?.finalAck?.resolve()

          } else if (msg.type === 'metadata') {
            const id = uuidv4()
            const meta: TransferMetadata = {
              id,
              filename: path.basename(msg.filename),
              size: msg.size,
              mime: msg.mime ?? 'application/octet-stream',
              senderIp,
              senderAlias: msg.senderAlias ?? senderIp
            }

            const accepted = await new Promise<boolean>((resolve) => {
              transfer = {
                meta,
                state: 'pending',
                writeStream: null,
                bytesReceived: 0,
                startTime: 0,
                savedPath: '',
                resolve
              }
              this.pendingDecisions.set(id, transfer)
              this.emit('transferRequest', meta)
            })

            if (!accepted) {
              ws.send(JSON.stringify({ type: 'decision', accepted: false }))
              this.pendingDecisions.delete(id)
              transfer = null
              ws.close()
              return
            }

            // Check for filename collision and ask user how to handle it
            const baseDest = path.join(this.downloadDir, path.basename(meta.filename))
            let destPath: string
            if (fs.existsSync(baseDest)) {
              const choice = await new Promise<'replace' | 'rename' | 'skip'>((res) => {
                this.collisionResolvers.set(meta.id, res)
                this.emit('transferCollision', { id: meta.id, filename: meta.filename })
              })
              if (choice === 'skip') {
                ws.send(JSON.stringify({ type: 'decision', accepted: false }))
                this.pendingDecisions.delete(id)
                transfer = null
                ws.close()
                return
              }
              destPath = choice === 'replace' ? baseDest : this.resolveDestPath(meta.filename)
            } else {
              destPath = baseDest
            }

            fs.mkdirSync(this.downloadDir, { recursive: true })
            transfer!.writeStream = fs.createWriteStream(destPath)
            transfer!.state = 'receiving'
            transfer!.startTime = Date.now()
            transfer!.savedPath = destPath
            ws.send(JSON.stringify({ type: 'decision', accepted: true }))
            this.emit('transferStart', meta)
            resetIdleTimer()

          } else if (msg.type === 'chunk') {
            // Base64 text chunk from mobile (Expo Go compatible protocol)
            if (!transfer || transfer.state !== 'receiving' || !transfer.writeStream) return
            const chunk = Buffer.from(msg.data, 'base64')
            transfer.writeStream.write(chunk)
            transfer.bytesReceived += chunk.byteLength
            resetIdleTimer()

            const elapsed = (Date.now() - transfer.startTime) / 1000 || 0.001
            this.emit('transferProgress', {
              id: transfer.meta.id,
              bytesReceived: transfer.bytesReceived,
              totalBytes: transfer.meta.size,
              speedBps: transfer.bytesReceived / elapsed
            } as TransferProgress)

            // Backpressure: el remitente espera este ack antes de mandar el próximo
            // chunk, para no saturar el puente nativo ni desincronizar el progreso.
            ws.send(JSON.stringify({ type: 'chunkAck' }))

          } else if (msg.type === 'done') {
            if (transfer?.state === 'receiving') {
              clearIdleTimer()
              transfer.writeStream?.end()
              transfer.state = 'done'
              this.emit('transferDone', { ...transfer.meta, savedPath: transfer.savedPath })
              ws.send(JSON.stringify({ type: 'ack' }))
              this.pendingDecisions.delete(transfer.meta.id)
            }
          }
        } catch {
          if (transfer?.state === 'receiving') {
            transfer.writeStream?.destroy()
            this.emit('transferError', { id: transfer.meta.id, reason: 'protocol' })
            this.pendingDecisions.delete(transfer.meta.id)
          }
          ws.close()
        }
      }
      // binary frames kept for future desktop↔desktop transfers
    })

    const cleanupPushSession = (reason: DropReason): void => {
      if (this.receivers.get(senderIp) === ws) {
        this.receivers.delete(senderIp)
        // El celular dejó de estar alcanzable: lo sacamos de la lista de la UI
        if (reason !== 'connection') this.emit('deviceLost', senderIp)
        if (reason === 'peer-offline') {
          this.emit('peerOffline', { ip: senderIp, alias: this.peerName(senderIp) })
        }
      }
      const waiters = this.pushWaiters.get(senderIp)
      if (waiters) {
        const err = new Error(this.dropMessage(reason, senderIp))
        waiters.decision?.reject(err)
        waiters.chunkAck?.reject(err)
        waiters.finalAck?.reject(err)
        this.pushWaiters.delete(senderIp)
      }
    }

    // 'error' siempre viene seguido de 'close', que es quien limpia y avisa
    ws.on('error', () => {})

    ws.on('close', () => {
      clearIdleTimer()
      const reason = this.dropReasons.get(ws) ?? 'connection'
      cleanupPushSession(reason)
      if (transfer?.state === 'receiving') {
        transfer.state = 'error'
        transfer.writeStream?.destroy()
        this.emit('transferError', { id: transfer.meta.id, reason, senderAlias: transfer.meta.senderAlias })
        this.pendingDecisions.delete(transfer.meta.id)
      }
    })
  }

  // Envía un archivo a un móvil ya registrado como receptor (ver msg.type === 'register').
  // Reutiliza el mismo protocolo JSON (metadata/decision/chunk/chunkAck/done/ack) que
  // usa el móvil para enviar, pero con los roles invertidos sobre la misma conexión.
  async pushFile(
    ip: string,
    filePath: string,
    senderAlias: string,
    onProgress: (p: PushProgress) => void
  ): Promise<void> {
    const ws = this.receivers.get(ip)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('El celular no está conectado: puede haberse quedado sin Wi-Fi. Esperá a que vuelva a aparecer en la lista.')
    }

    const filename = path.basename(filePath)
    const { size } = fs.statSync(filePath)
    const startTime = Date.now()

    // Espera la respuesta del móvil (chunkAck / ack final). Si no llega a tiempo
    // asumimos que se cayó la red: cerramos el socket y fallamos el envío.
    const waitForAck = (key: 'chunkAck' | 'finalAck'): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        // Si vence, drop() dispara 'close' → cleanupPushSession rechaza esta
        // misma espera con el mensaje "el celular se quedó sin Wi-Fi".
        const timer = setTimeout(() => this.drop(ws, 'peer-offline'), ACK_TIMEOUT_MS)
        const waiters = this.pushWaiters.get(ip) ?? {}
        waiters[key] = {
          resolve: () => { clearTimeout(timer); resolve() },
          reject: (err) => { clearTimeout(timer); reject(err) }
        }
        this.pushWaiters.set(ip, waiters)
      })

    const accepted = await new Promise<boolean>((resolve, reject) => {
      this.pushWaiters.set(ip, { decision: { resolve, reject } })
      ws.send(JSON.stringify({ type: 'metadata', filename, size, mime: 'application/octet-stream', senderAlias }))
    })

    if (!accepted) {
      this.pushWaiters.delete(ip)
      throw new Error('rejected')
    }

    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(PUSH_CHUNK_BYTES)
      let offset = 0
      while (offset < size) {
        const bytesToRead = Math.min(PUSH_CHUNK_BYTES, size - offset)
        const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, offset)
        const chunkB64 = buffer.subarray(0, bytesRead).toString('base64')

        ws.send(JSON.stringify({ type: 'chunk', data: chunkB64 }))

        // Backpressure: esperamos el chunkAck del móvil antes de seguir (mismo
        // mecanismo que usa el móvil al enviarnos archivos a nosotros).
        await waitForAck('chunkAck')

        offset += bytesRead
        const elapsed = (Date.now() - startTime) / 1000 || 0.001
        onProgress({ bytesSent: offset, totalBytes: size, speedBps: offset / elapsed })
      }

      ws.send(JSON.stringify({ type: 'done' }))
      await waitForAck('finalAck')
    } finally {
      fs.closeSync(fd)
      this.pushWaiters.delete(ip)
    }
  }

  private resolveDestPath(filename: string): string {
    const dest = path.join(this.downloadDir, filename)
    if (!fs.existsSync(dest)) return dest

    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    let counter = 1
    let candidate: string
    do {
      candidate = path.join(this.downloadDir, `${base} (${counter})${ext}`)
      counter++
    } while (fs.existsSync(candidate))
    return candidate
  }

  resolveTransfer(id: string, accepted: boolean): void {
    const transfer = this.pendingDecisions.get(id)
    if (transfer?.state === 'pending') {
      transfer.state = accepted ? 'accepted' : 'rejected'
      transfer.resolve(accepted)
    }
  }

  private collisionResolvers = new Map<string, (choice: 'replace' | 'rename' | 'skip') => void>()

  resolveCollision(id: string, choice: 'replace' | 'rename' | 'skip'): void {
    const resolver = this.collisionResolvers.get(id)
    if (resolver) {
      resolver(choice)
      this.collisionResolvers.delete(id)
    }
  }

  // Llamado cuando la PC pierde la red: cortamos todas las conexiones para que
  // las transferencias en curso fallen ya, en vez de esperar al timeout.
  dropAllConnections(): void {
    for (const client of this.wss.clients) this.drop(client, 'local-offline')
  }

  setDownloadDir(dir: string): void {
    this.downloadDir = dir
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(WS_PORT, () => {
        this.startHeartbeat()
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
      this.wss.close(() => {
        this.httpServer.close(() => resolve())
      })
    })
  }
}
