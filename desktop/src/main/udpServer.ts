import * as dgram from 'dgram'
import { networkInterfaces } from 'os'
import { EventEmitter } from 'events'

export const DISCOVERY_PORT = 53317
const BROADCAST_ADDR = '255.255.255.255'
const BEACON_INTERVAL_MS = 3000
const DEVICE_TTL_MS = 10000

export interface DiscoveredDevice {
  alias: string
  deviceType: 'desktop' | 'laptop' | 'mobile' | 'tablet'
  ip: string
  port: number
  lastSeen: number
}

export interface BeaconPayload {
  type: 'hello' | 'bye'
  alias: string
  deviceType: DiscoveredDevice['deviceType']
  port: number
}

export class UdpDiscoveryServer extends EventEmitter {
  private socket: dgram.Socket | null = null
  private beaconTimer: NodeJS.Timeout | null = null
  private ttlTimer: NodeJS.Timeout | null = null
  private devices = new Map<string, DiscoveredDevice>()
  private alias: string
  private tcpPort: number

  constructor(alias: string, tcpPort: number) {
    super()
    this.alias = alias
    this.tcpPort = tcpPort
  }

  getLocalIp(): string {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]!) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address
        }
      }
    }
    return '127.0.0.1'
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      this.socket.on('error', (err) => {
        this.emit('error', err)
        reject(err)
      })

      this.socket.on('message', (msg, rinfo) => {
        try {
          const payload: BeaconPayload = JSON.parse(msg.toString())
          const localIp = this.getLocalIp()
          if (rinfo.address === localIp) return // ignore self

          if (payload.type === 'hello') {
            const device: DiscoveredDevice = {
              alias: payload.alias,
              deviceType: payload.deviceType,
              ip: rinfo.address,
              port: payload.port,
              lastSeen: Date.now()
            }
            const isNew = !this.devices.has(rinfo.address)
            this.devices.set(rinfo.address, device)
            if (isNew) {
              this.emit('deviceFound', device)
              // unicast reply so they know about us
              this.sendBeacon(rinfo.address)
            } else {
              this.emit('deviceUpdated', device)
            }
          } else if (payload.type === 'bye') {
            if (this.devices.has(rinfo.address)) {
              this.devices.delete(rinfo.address)
              this.emit('deviceLost', rinfo.address)
            }
          }
        } catch {
          // malformed packet — ignore
        }
      })

      this.socket.bind(DISCOVERY_PORT, () => {
        this.socket!.setBroadcast(true)
        this.startBeaconing()
        this.startTtlCleanup()
        resolve()
      })
    })
  }

  private sendBeacon(target = BROADCAST_ADDR): void {
    if (!this.socket) return
    const payload: BeaconPayload = {
      type: 'hello',
      alias: this.alias,
      deviceType: 'desktop',
      port: this.tcpPort
    }
    const msg = Buffer.from(JSON.stringify(payload))
    this.socket.send(msg, DISCOVERY_PORT, target)
  }

  private startBeaconing(): void {
    this.sendBeacon()
    this.beaconTimer = setInterval(() => this.sendBeacon(), BEACON_INTERVAL_MS)
  }

  private startTtlCleanup(): void {
    this.ttlTimer = setInterval(() => {
      const now = Date.now()
      for (const [ip, device] of this.devices) {
        if (now - device.lastSeen > DEVICE_TTL_MS) {
          this.devices.delete(ip)
          this.emit('deviceLost', ip)
        }
      }
    }, DEVICE_TTL_MS)
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values())
  }

  stop(): void {
    if (this.beaconTimer) clearInterval(this.beaconTimer)
    if (this.ttlTimer) clearInterval(this.ttlTimer)
    if (this.socket) {
      const bye: BeaconPayload = {
        type: 'bye',
        alias: this.alias,
        deviceType: 'desktop',
        port: this.tcpPort
      }
      const msg = Buffer.from(JSON.stringify(bye))
      try {
        this.socket.send(msg, DISCOVERY_PORT, BROADCAST_ADDR, () => {
          this.socket!.close()
          this.socket = null
        })
      } catch {
        this.socket.close()
        this.socket = null
      }
    }
  }
}
