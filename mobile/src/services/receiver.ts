import { EventEmitter } from 'eventemitter3'
import { File, Paths } from 'expo-file-system'
import type { TransferProgress, LinkLoss } from './transfer'

const RECONNECT_DELAY_MS = 4000
// Si se corta el Wi-Fi, el socket puede quedar abierto pero mudo (sin 'close').
// Si no llega ningún chunk en este tiempo damos la transferencia por perdida.
const RECV_IDLE_TIMEOUT_MS = 15000

export interface IncomingTransferMeta {
  filename: string
  size: number
  mime: string
  senderAlias: string
}

// Cliente WebSocket persistente hacia cada desktop conocido. El móvil no puede
// correr un servidor propio dentro de Expo Go, así que en su lugar abre la
// conexión él mismo y la deja abierta: el desktop reutiliza esa misma conexión
// para empujarnos archivos más adelante (ver wsServer.ts `pushFile`/`register`).
export class ReceiverService extends EventEmitter {
  private sockets = new Map<string, WebSocket>()
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopped = false
  private alias: string

  private activeMeta: IncomingTransferMeta | null = null
  private activeFile: File | null = null
  private bytesReceived = 0
  private startTime = 0
  private decisionResolve: ((accepted: boolean) => void) | null = null
  private activeSocket: WebSocket | null = null
  private activeIp: string | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(alias: string) {
    super()
    this.alias = alias
  }

  connectTo(ip: string, port: number): void {
    if (this.stopped || this.sockets.has(ip)) return
    this.openSocket(ip, port)
  }

  disconnectFrom(ip: string): void {
    const timer = this.reconnectTimers.get(ip)
    if (timer) clearTimeout(timer)
    this.reconnectTimers.delete(ip)
    this.sockets.get(ip)?.close()
    this.sockets.delete(ip)
  }

  // Llamar desde la UI tras mostrar el diálogo Aceptar/Rechazar tras 'transferRequest'.
  decide(accepted: boolean): void {
    this.decisionResolve?.(accepted)
    this.decisionResolve = null
  }

  // Corta la recepción en curso (si hay) y avisa a la UI con 'error'.
  // Si estamos recibiendo desde `ip`, cortamos (ej. la PC dejó de responder)
  failIfFrom(ip: string, reason: LinkLoss): void {
    if (this.activeIp === ip) this.failActive(reason)
  }

  failActive(reason: LinkLoss): void {
    if (!this.activeMeta) return
    this.clearIdleTimer()
    const meta = this.activeMeta
    // Borramos el archivo a medio escribir para no dejar basura
    try { if (this.activeFile?.exists) this.activeFile.delete() } catch {}
    this.activeMeta = null
    this.activeFile = null
    this.activeSocket?.close()
    this.activeSocket = null
    this.activeIp = null
    this.emit('error', { ...meta, reason })
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(
      () => this.failActive('peer-offline'), // dejó de llegar el archivo
      RECV_IDLE_TIMEOUT_MS
    )
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  stop(): void {
    this.stopped = true
    this.clearIdleTimer()
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
    for (const ws of this.sockets.values()) ws.close()
    this.sockets.clear()
  }

  private openSocket(ip: string, port: number): void {
    const ws = new WebSocket(`ws://${ip}:${port}`)
    this.sockets.set(ip, ws)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', alias: this.alias, deviceType: 'mobile' }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        this.handleMessage(ws, ip, msg)
      } catch {
        // mensaje malformado — ignorar
      }
    }

    ws.onclose = () => {
      this.sockets.delete(ip)
      if (this.activeSocket === ws) {
        this.failActive('closed')
      }
      if (this.stopped) return
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(ip)
        this.connectTo(ip, port)
      }, RECONNECT_DELAY_MS)
      this.reconnectTimers.set(ip, timer)
    }

    ws.onerror = () => {
      // onclose se dispara igual y maneja la reconexión
    }
  }

  private handleMessage(ws: WebSocket, ip: string, msg: Record<string, unknown>): void {
    if (msg.type === 'metadata') {
      this.activeMeta = {
        filename: String(msg.filename),
        size: Number(msg.size),
        mime: String(msg.mime ?? 'application/octet-stream'),
        senderAlias: String(msg.senderAlias ?? 'Desconocido')
      }
      new Promise<boolean>((resolve) => {
        this.decisionResolve = resolve
        this.emit('transferRequest', this.activeMeta)
      }).then((accepted) => {
        // Si la conexión se cayó mientras el usuario decidía, no hay a quién responder
        if (ws.readyState !== WebSocket.OPEN) {
          const meta = this.activeMeta
          this.activeMeta = null
          if (accepted) this.emit('error', { ...meta, reason: 'closed' satisfies LinkLoss })
          return
        }
        ws.send(JSON.stringify({ type: 'decision', accepted }))
        if (!accepted) {
          this.activeMeta = null
          return
        }
        this.activeSocket = ws
        this.activeIp = ip
        this.beginReceiving()
      })

    } else if (msg.type === 'chunk') {
      if (!this.activeMeta || !this.activeFile) return
      const data = String(msg.data)
      this.activeFile.write(data, { encoding: 'base64', append: true })
      // Largo aproximado en bytes de un string base64 (sin contar el padding exacto) —
      // suficiente para una barra de progreso, no hace falta decodificar para medirlo.
      this.bytesReceived += Math.floor((data.length * 3) / 4)
      this.resetIdleTimer()

      const elapsed = (Date.now() - this.startTime) / 1000 || 0.001
      this.emit('progress', {
        bytesSent: this.bytesReceived,
        totalBytes: this.activeMeta.size,
        speedBps: this.bytesReceived / elapsed
      } as TransferProgress)

      ws.send(JSON.stringify({ type: 'chunkAck' }))

    } else if (msg.type === 'done') {
      this.clearIdleTimer()
      this.activeSocket = null
      this.activeIp = null
      ws.send(JSON.stringify({ type: 'ack' }))
      this.emit('done', { ...this.activeMeta, savedPath: this.activeFile?.uri })
      this.activeFile = null
      this.activeMeta = null
    }
  }

  private beginReceiving(): void {
    if (!this.activeMeta) return
    const file = this.resolveDestFile(this.activeMeta.filename)
    file.create({ intermediates: true })
    this.activeFile = file
    this.bytesReceived = 0
    this.startTime = Date.now()
    this.emit('start', this.activeMeta)
    this.resetIdleTimer()
  }

  // Si el nombre ya existe, renombra automáticamente (mismo criterio que el desktop).
  private resolveDestFile(filename: string): File {
    const dot = filename.lastIndexOf('.')
    const base = dot > 0 ? filename.slice(0, dot) : filename
    const ext = dot > 0 ? filename.slice(dot) : ''

    let candidate = new File(Paths.document, filename)
    let counter = 1
    while (candidate.exists) {
      candidate = new File(Paths.document, `${base} (${counter})${ext}`)
      counter++
    }
    return candidate
  }
}
