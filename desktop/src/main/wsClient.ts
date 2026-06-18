import { WebSocket } from 'ws'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'

const CHUNK_BYTES = 256 * 1024 // 256 KB — desktop tiene más RAM que mobile

export interface SendProgress {
  bytesSent: number
  totalBytes: number
  speedBps: number
}

export type SendStatus = 'waiting' | 'sending' | 'done' | 'rejected' | 'error'

export class WsTransferClient extends EventEmitter {
  private ws: WebSocket | null = null

  async sendFile(ip: string, port: number, filePath: string, senderAlias: string): Promise<void> {
    const filename = path.basename(filePath)
    const { size } = fs.statSync(filePath)

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${ip}:${port}`)
      this.ws = ws
      let settled = false
      const settle = (fn: () => void): void => {
        if (!settled) { settled = true; fn() }
      }

      ws.on('open', () => {
        this.emit('status', 'waiting' as SendStatus)
        ws.send(JSON.stringify({
          type: 'metadata',
          filename,
          size,
          mime: 'application/octet-stream',
          senderAlias
        }))
      })

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'decision') {
            if (!msg.accepted) {
              this.emit('status', 'rejected' as SendStatus)
              ws.close()
              settle(() => reject(new Error('rejected')))
              return
            }
            this.emit('status', 'sending' as SendStatus)
            await this.streamFile(filePath, size, ws)
            ws.send(JSON.stringify({ type: 'done' }))
          } else if (msg.type === 'ack') {
            this.emit('status', 'done' as SendStatus)
            ws.close()
            settle(() => resolve())
          }
        } catch (err) {
          settle(() => reject(err))
        }
      })

      ws.on('error', (err) => settle(() => reject(err)))
      ws.on('close', () => settle(() => reject(new Error('connection closed unexpectedly'))))
    })
  }

  private async streamFile(filePath: string, size: number, ws: WebSocket): Promise<void> {
    const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_BYTES })
    let bytesSent = 0
    const startTime = Date.now()

    for await (const rawChunk of stream) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('connection closed during transfer')
      const chunk = rawChunk as Buffer
      ws.send(JSON.stringify({ type: 'chunk', data: chunk.toString('base64') }))
      bytesSent += chunk.byteLength
      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      this.emit('progress', { bytesSent, totalBytes: size, speedBps: bytesSent / elapsed } as SendProgress)
    }
  }

  cancel(): void {
    this.ws?.close()
  }
}
