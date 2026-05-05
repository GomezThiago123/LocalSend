import { EventEmitter } from 'eventemitter3'
import * as FileSystem from 'expo-file-system'

const CHUNK_SIZE = 48 * 1024 // 48 KB — mobile-safe chunk

export interface TransferOptions {
  deviceIp: string
  devicePort: number
  senderAlias: string
  fileUri: string
  filename: string
  size: number
  mime: string
}

export interface TransferProgress {
  bytesSent: number
  totalBytes: number
  speedBps: number
}

export type TransferStatus = 'connecting' | 'waiting' | 'rejected' | 'sending' | 'done' | 'error'

export class TransferClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: TransferStatus = 'connecting'

  async send(opts: TransferOptions): Promise<void> {
    const url = `ws://${opts.deviceIp}:${opts.devicePort}`
    this.ws = new WebSocket(url)
    this.status = 'connecting'

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!

      ws.onopen = () => {
        this.status = 'waiting'
        this.emit('status', this.status)
        ws.send(
          JSON.stringify({
            type: 'metadata',
            filename: opts.filename,
            size: opts.size,
            mime: opts.mime,
            senderAlias: opts.senderAlias
          })
        )
      }

      ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'decision') {
            if (!msg.accepted) {
              this.status = 'rejected'
              this.emit('status', this.status)
              ws.close()
              reject(new Error('rejected'))
              return
            }
            // Accepted — start streaming
            this.status = 'sending'
            this.emit('status', this.status)
            await this.streamFile(opts, ws)
            ws.send(JSON.stringify({ type: 'done' }))
          } else if (msg.type === 'ack') {
            this.status = 'done'
            this.emit('status', this.status)
            ws.close()
            resolve()
          }
        } catch (err) {
          this.status = 'error'
          this.emit('status', this.status)
          reject(err)
        }
      }

      ws.onerror = (err) => {
        this.status = 'error'
        this.emit('status', this.status)
        reject(err)
      }

      ws.onclose = () => {
        if (this.status !== 'done' && this.status !== 'rejected') {
          this.status = 'error'
          this.emit('status', this.status)
          reject(new Error('connection closed unexpectedly'))
        }
      }
    })
  }

  private async streamFile(opts: TransferOptions, ws: WebSocket): Promise<void> {
    const { size, fileUri } = opts
    let offset = 0
    const startTime = Date.now()

    while (offset < size) {
      const length = Math.min(CHUNK_SIZE, size - offset)
      // Read chunk as base64, convert to ArrayBuffer
      const b64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length
      })
      const binary = atob(b64)
      const buf = new ArrayBuffer(binary.length)
      const view = new Uint8Array(buf)
      for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i)
      }

      // Wait for socket buffer to drain to avoid OOM on large files
      while (ws.bufferedAmount > CHUNK_SIZE * 4) {
        await new Promise((r) => setTimeout(r, 10))
      }

      ws.send(buf)
      offset += length

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      const speedBps = offset / elapsed
      const progress: TransferProgress = { bytesSent: offset, totalBytes: size, speedBps }
      this.emit('progress', progress)
    }
  }

  cancel(): void {
    this.ws?.close()
    this.status = 'error'
  }
}
