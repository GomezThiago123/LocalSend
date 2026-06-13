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

export class WsTransferServer extends EventEmitter {
  private httpServer: http.Server
  private wss: WebSocketServer
  private downloadDir: string
  private pendingDecisions = new Map<string, ActiveTransfer>()

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

  private alias = 'LocalSend Desktop'

  setAlias(alias: string): void {
    this.alias = alias
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const senderIp = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown'
    let transfer: ActiveTransfer | null = null
    let expectingBinary = false

    ws.on('message', async (data, isBinary) => {
      if (!isBinary) {
        // JSON control message
        try {
          const msg = JSON.parse(data.toString())

          if (msg.type === 'metadata') {
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

            transfer!.writeStream = fs.createWriteStream(destPath)
            transfer!.state = 'receiving'
            transfer!.startTime = Date.now()
            transfer!.savedPath = destPath
            ws.send(JSON.stringify({ type: 'decision', accepted: true }))
            this.emit('transferStart', meta)

          } else if (msg.type === 'chunk') {
            // Base64 text chunk from mobile (Expo Go compatible protocol)
            if (!transfer || transfer.state !== 'receiving' || !transfer.writeStream) return
            const chunk = Buffer.from(msg.data, 'base64')
            transfer.writeStream.write(chunk)
            transfer.bytesReceived += chunk.byteLength

            const elapsed = (Date.now() - transfer.startTime) / 1000 || 0.001
            this.emit('transferProgress', {
              id: transfer.meta.id,
              bytesReceived: transfer.bytesReceived,
              totalBytes: transfer.meta.size,
              speedBps: transfer.bytesReceived / elapsed
            } as TransferProgress)

          } else if (msg.type === 'done') {
            if (transfer?.state === 'receiving') {
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

    ws.on('error', () => {
      if (transfer?.state === 'receiving') {
        transfer.writeStream?.destroy()
        this.emit('transferError', { id: transfer.meta.id, reason: 'connection' })
        this.pendingDecisions.delete(transfer.meta.id)
      }
    })

    ws.on('close', () => {
      if (transfer?.state === 'receiving') {
        transfer.writeStream?.destroy()
        this.emit('transferError', { id: transfer.meta.id, reason: 'connection' })
        this.pendingDecisions.delete(transfer.meta.id)
      }
    })
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

  setDownloadDir(dir: string): void {
    this.downloadDir = dir
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(WS_PORT, () => resolve())
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve())
      })
    })
  }
}
