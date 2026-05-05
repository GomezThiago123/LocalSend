import { EventEmitter } from 'eventemitter3'
import * as Network from 'expo-network'

export const WS_PORT = 53318
const SCAN_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 800
const PROBE_BATCH = 25        // IPs simultáneas por batch
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

  async start(): Promise<void> {
    await this.scan()
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL_MS)
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_INTERVAL_MS)
  }

  private async getSubnetPrefix(): Promise<string | null> {
    try {
      const ip = await Network.getIpAddressAsync()
      // e.g. "192.168.1.15" → "192.168.1."
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
      const res = await fetch(`http://${ip}:${WS_PORT}/info`, {
        signal: controller.signal
      })
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

  private async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true

    try {
      const prefix = await this.getSubnetPrefix()
      if (!prefix) return

      // Scan in batches to avoid flooding the network stack
      for (let start = 1; start <= 254; start += PROBE_BATCH) {
        const batch: Promise<void>[] = []
        for (let i = start; i < start + PROBE_BATCH && i <= 254; i++) {
          const ip = `${prefix}${i}`
          batch.push(
            this.probeIp(ip).then((device) => {
              if (!device) return
              const existing = this.devices.get(ip)
              device.lastSeen = Date.now()
              this.devices.set(ip, device)
              if (!existing) {
                this.emit('deviceFound', device)
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
      }
    }
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values())
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.healthTimer) clearInterval(this.healthTimer)
  }
}
