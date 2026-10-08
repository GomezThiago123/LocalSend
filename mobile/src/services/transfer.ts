import { EventEmitter } from 'eventemitter3'
import { readAsStringAsync, copyAsync, cacheDirectory, EncodingType } from 'expo-file-system/legacy'

const CHUNK_BYTES = 48 * 1024 // 48 KB por chunk
// Si se corta el Wi-Fi el socket puede quedar mudo sin disparar onclose:
// sin respuesta en este tiempo damos el envío por fallido.
const CONNECT_TIMEOUT_MS = 10000
const ACK_TIMEOUT_MS = 15000

// Motivo de un corte, usado como message del Error. La pantalla lo traduce a un
// texto ("este celular se quedó sin Wi-Fi" vs "la PC se quedó sin Wi-Fi").
//  - 'peer-offline':  la PC dejó de responder (se quedó sin red)
//  - 'closed':        la conexión se cerró (la PC cerró la app, o nos quedamos sin red)
//  - 'local-offline': este celular perdió el Wi-Fi
//  - 'connect':       no se pudo conectar con la PC
export type LinkLoss = 'peer-offline' | 'closed' | 'local-offline' | 'connect'

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

export type TransferStatus = 'connecting' | 'waiting' | 'rejected' | 'sending' | 'receiving' | 'done' | 'error'

export class TransferClient extends EventEmitter {
  private ws: WebSocket | null = null
  private status: TransferStatus = 'connecting'
  private pendingChunkAck: { resolve: () => void; reject: (err: Error) => void } | null = null
  private abort: ((err: Error) => void) | null = null
  private target: string | null = null

  async send(opts: TransferOptions): Promise<void> {
    this.target = opts.deviceIp
    const url = `ws://${opts.deviceIp}:${opts.devicePort}`
    this.ws = new WebSocket(url)
    this.status = 'connecting'

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!
      let settled = false
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; clearTimeout(connectTimer); fn() }
      }

      // Permite que cancel() haga fallar el envío al instante, sin esperar a
      // que llegue onclose (que con el Wi-Fi caído puede tardar mucho).
      this.abort = (err) => {
        this.status = 'error'
        this.emit('status', this.status)
        this.pendingChunkAck?.reject(err)
        this.pendingChunkAck = null
        settle(() => reject(err))
      }

      const connectTimer = setTimeout(() => {
        if (this.status !== 'connecting') return
        this.status = 'error'
        this.emit('status', this.status)
        ws.close()
        settle(() => reject(new Error('connect' satisfies LinkLoss)))
      }, CONNECT_TIMEOUT_MS)

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

          } else if (msg.type === 'chunkAck') {
            this.pendingChunkAck?.resolve()
            this.pendingChunkAck = null

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
        this.pendingChunkAck?.reject(new Error('closed' satisfies LinkLoss))
        this.pendingChunkAck = null
        settle(() => reject(new Error('closed' satisfies LinkLoss)))
      }

      ws.onclose = () => {
        if (this.status !== 'done' && this.status !== 'rejected') {
          this.status = 'error'
          this.emit('status', this.status)
          this.pendingChunkAck?.reject(new Error('closed' satisfies LinkLoss))
          this.pendingChunkAck = null
          settle(() => reject(new Error('closed' satisfies LinkLoss)))
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

      // Backpressure: RN no expone bufferedAmount real, así que esperamos el ack
      // del receptor antes de mandar el siguiente chunk. Sin esto, ws.send() encola
      // todo de golpe y termina cortando la conexión en archivos grandes.
      await new Promise<void>((res, rej) => {
        // La PC no confirmó el chunk a tiempo: dejó de responder
        const timer = setTimeout(() => this.cancel('peer-offline'), ACK_TIMEOUT_MS)
        this.pendingChunkAck = {
          resolve: () => { clearTimeout(timer); res() },
          reject: (err) => { clearTimeout(timer); rej(err) }
        }
      })

      offset += length

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      this.emit('progress', {
        bytesSent: offset,
        totalBytes: size,
        speedBps: offset / elapsed
      } as TransferProgress)
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

  get targetIp(): string | null {
    return this.target
  }

  cancel(reason: LinkLoss): void {
    this.abort?.(new Error(reason))
    this.ws?.close()
  }
}
