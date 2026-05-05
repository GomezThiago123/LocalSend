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
    const startTime = Date.now()

    // Read entire file as base64 — more reliable than position-based reads
    // across all Android URI types (content://, file://)
    const fullB64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64
    })

    // Each 3 bytes → 4 base64 chars, so chunk in base64 chars (multiple of 4)
    const b64CharsPerChunk = Math.ceil((CHUNK_SIZE / 3) * 4 / 4) * 4
    let charOffset = 0
    let bytesSent = 0

    while (charOffset < fullB64.length) {
      const chunkB64 = fullB64.slice(charOffset, charOffset + b64CharsPerChunk)
      const binary = atob(chunkB64)
      const buf = new ArrayBuffer(binary.length)
      const view = new Uint8Array(buf)
      for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i)
      }

      ws.send(buf)
      charOffset += b64CharsPerChunk
      bytesSent = Math.min(bytesSent + binary.length, size)

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      const speedBps = bytesSent / elapsed
      this.emit('progress', { bytesSent, totalBytes: size, speedBps } as TransferProgress)

      // Yield to keep UI responsive between chunks
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  cancel(): void {
    this.ws?.close()
    this.status = 'error'
  }
}
