import { EventEmitter } from 'eventemitter3'
import * as Network from 'expo-network'

export const WS_PORT = 53318
const SCAN_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 800
const PROBE_BATCH = 25
const HEALTH_INTERVAL_MS = 4000

export interface DiscoveredDevice {
  alias: string
  deviceType: 'desktop' | 'laptop' | 'mobile' | 'tablet'
  ip: string
  port: number
  lastSeen: number
}

interface DeviceInfo {
  alias: string
  deviceType: DiscoveredDevice['deviceType']
  port: number
}

export class DiscoveryService extends EventEmitter {
  private devices = new Map<string, DiscoveredDevice>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private scanning = false
  private alias: string

  constructor(alias: string) {
    super()
    this.alias = alias
  }

  async start(): Promise<void> {
    await this.scan()
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL_MS)
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_INTERVAL_MS)
  }

  private async getSubnetPrefix(): Promise<string | null> {
    try {
      const ip = await Network.getIpAddressAsync()
      const parts = ip.split('.')
      if (parts.length !== 4) return null
      return `${parts[0]}.${parts[1]}.${parts[2]}.`
    } catch {
      return null
    }
  }

  private async probeIp(ip: string): Promise<DiscoveredDevice | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://${ip}:${WS_PORT}/info`, { signal: controller.signal })
      if (!res.ok) return null
      const data: DeviceInfo = await res.json()
      if (!data.alias) return null
      return {
        alias: data.alias,
        deviceType: data.deviceType ?? 'desktop',
        ip,
        port: data.port ?? WS_PORT,
        lastSeen: Date.now()
      }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  // Tell the desktop we exist so it shows us in its device list
  private async registerWith(ip: string): Promise<void> {
    try {
      await fetch(`http://${ip}:${WS_PORT}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: this.alias, deviceType: 'mobile', port: WS_PORT })
      })
    } catch {
      // best-effort
    }
  }

  private async unregisterFrom(ip: string): Promise<void> {
    try {
      await fetch(`http://${ip}:${WS_PORT}/register`, { method: 'DELETE' })
    } catch {}
  }

  private async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const prefix = await this.getSubnetPrefix()
      if (!prefix) return

      for (let start = 1; start <= 254; start += PROBE_BATCH) {
        const batch: Promise<void>[] = []
        for (let i = start; i < start + PROBE_BATCH && i <= 254; i++) {
          const ip = `${prefix}${i}`
          batch.push(
            this.probeIp(ip).then(async (device) => {
              if (!device) return
              const isNew = !this.devices.has(ip)
              device.lastSeen = Date.now()
              this.devices.set(ip, device)
              if (isNew) {
                this.emit('deviceFound', device)
                await this.registerWith(ip) // tell desktop about us
              } else {
                this.emit('deviceUpdated', device)
              }
            })
          )
        }
        await Promise.all(batch)
      }
    } finally {
      this.scanning = false
    }
  }

  private async healthCheck(): Promise<void> {
    for (const [ip, device] of this.devices) {
      const alive = await this.probeIp(ip)
      if (!alive) {
        this.devices.delete(ip)
        this.emit('deviceLost', ip)
      } else {
        this.devices.set(ip, { ...device, lastSeen: Date.now() })
        await this.registerWith(ip) // keep desktop's TTL alive
      }
    }
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values())
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.healthTimer) clearInterval(this.healthTimer)
    // unregister from all known desktops
    for (const [ip] of this.devices) {
      this.unregisterFrom(ip)
    }
  }
}
