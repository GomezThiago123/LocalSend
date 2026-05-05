import { EventEmitter } from 'eventemitter3'
import { readAsStringAsync, copyAsync, cacheDirectory, EncodingType } from 'expo-file-system/legacy'

const CHUNK_BYTES = 48 * 1024 // 48 KB por chunk

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
      let settled = false
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn() }
      }

      ws.onopen = () => {
        this.status = 'waiting'
        this.emit('status', this.status)
        ws.send(JSON.stringify({
          type: 'metadata',
          filename: opts.filename,
          size: opts.size,
          mime: opts.mime,
          senderAlias: opts.senderAlias
        }))
      }

      ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data as string)

          if (msg.type === 'decision') {
            if (!msg.accepted) {
              this.status = 'rejected'
              this.emit('status', this.status)
              ws.close()
              settle(() => reject(new Error('rejected')))
              return
            }
            this.status = 'sending'
            this.emit('status', this.status)
            await this.streamFile(opts, ws)
            ws.send(JSON.stringify({ type: 'done' }))

          } else if (msg.type === 'ack') {
            this.status = 'done'
            this.emit('status', this.status)
            ws.close()
            settle(() => resolve())
          }
        } catch (err) {
          this.status = 'error'
          this.emit('status', this.status)
          settle(() => reject(err))
        }
      }

      ws.onerror = () => {
        this.status = 'error'
        this.emit('status', this.status)
        settle(() => reject(new Error('WebSocket error')))
      }

      ws.onclose = () => {
        if (this.status !== 'done' && this.status !== 'rejected') {
          this.status = 'error'
          this.emit('status', this.status)
          settle(() => reject(new Error('Conexión cerrada inesperadamente')))
        }
      }
    })
  }

  private async streamFile(opts: TransferOptions, ws: WebSocket): Promise<void> {
    const { size } = opts
    const startTime = Date.now()

    // content:// URIs no soportan lectura por posición — copiamos a file:// primero
    const fileUri = await this.toFileUri(opts.fileUri, opts.filename)

    let offset = 0

    // Leemos el archivo en chunks de CHUNK_BYTES — nunca se carga completo en RAM
    while (offset < size) {
      const length = Math.min(CHUNK_BYTES, size - offset)

      const chunkB64 = await readAsStringAsync(fileUri, {
        encoding: EncodingType.Base64,
        position: offset,
        length
      })

      // Enviamos el chunk como JSON base64 — compatible con Expo Go
      ws.send(JSON.stringify({ type: 'chunk', data: chunkB64 }))

      offset += length

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      this.emit('progress', {
        bytesSent: offset,
        totalBytes: size,
        speedBps: offset / elapsed
      } as TransferProgress)

      // Cede el hilo para que la UI no se congele
      await new Promise<void>((r) => setTimeout(() => r(), 1))
    }
  }

  // Convierte cualquier URI a file:// accesible por FileSystem
  private async toFileUri(uri: string, filename: string): Promise<string> {
    if (!uri.startsWith('content://')) return uri
    const ext = filename.includes('.') ? filename.split('.').pop() : 'bin'
    const dest = `${cacheDirectory}ls_${Date.now()}.${ext}`
    await copyAsync({ from: uri, to: dest })
    return dest
  }

  cancel(): void {
    this.ws?.close()
    this.status = 'error'
  }
}
