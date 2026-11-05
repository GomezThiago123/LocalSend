import { EventEmitter } from 'eventemitter3'
import * as Network from 'expo-network'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const WS_PORT = 53318
const MANUAL_HOSTS_KEY = '@localsend/manualHosts'

export function isIpv4(ip: string): boolean {
  const parts = ip.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
const SCAN_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 800
const PROBE_BATCH = 25
const HEALTH_INTERVAL_MS = 4000
// En el chequeo de salud somos más tolerantes que en el escaneo: una red lenta
// o la PC ocupada en una transferencia no deben hacerla "desaparecer".
const HEALTH_PROBE_TIMEOUT_MS = 2000
const HEALTH_MAX_MISSES = 2

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
  private misses = new Map<string, number>()
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private scanning = false
  private alias: string

  // El escaneo automático solo cubre el /24 del celular (expo-network no expone
  // la máscara de subred). En redes más grandes (ej. una /21 de facultad) la PC
  // puede estar en otro bloque, así que estas IPs se prueban aparte en cada escaneo:
  //  - devHost: en Expo Go, la PC que nos sirvió la app con Metro
  //  - manualHosts: las que el usuario cargó a mano (persisten entre aperturas)
  private devHost: string | null = null
  private manualHosts = new Set<string>()

  constructor(alias: string) {
    super()
    this.alias = alias
  }

  async start(): Promise<void> {
    await this.loadExtraHosts()
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

  private async probeIp(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<DiscoveredDevice | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
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

  private async loadExtraHosts(): Promise<void> {
    const host = Constants.expoConfig?.hostUri?.split(':')[0]
    if (host && isIpv4(host)) this.devHost = host
    try {
      const saved = JSON.parse((await AsyncStorage.getItem(MANUAL_HOSTS_KEY)) ?? '[]')
      if (Array.isArray(saved)) saved.filter(isIpv4).forEach((ip) => this.manualHosts.add(ip))
    } catch {
      // storage corrupto — se ignora
    }
  }

  private extraHosts(): string[] {
    const hosts = new Set(this.manualHosts)
    if (this.devHost) hosts.add(this.devHost)
    return [...hosts]
  }

  // Agrega a mano la IP de una PC (la que muestra la app desktop en su barra superior).
  // Devuelve true si en esa IP respondió una app LocalSend; en ese caso se recuerda.
  async addManualHost(ip: string): Promise<boolean> {
    if (!isIpv4(ip)) return false
    const found = await this.probeAndTrack(ip, HEALTH_PROBE_TIMEOUT_MS)
    if (!found) return false
    this.manualHosts.add(ip)
    try {
      await AsyncStorage.setItem(MANUAL_HOSTS_KEY, JSON.stringify([...this.manualHosts]))
    } catch {
      // best-effort: si no se guarda, igual quedó conectada en esta sesión
    }
    return true
  }

  // Prueba una IP y, si hay un desktop, lo agrega/actualiza y nos registramos con él
  private async probeAndTrack(ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
    const device = await this.probeIp(ip, timeoutMs)
    if (!device) return false
    const isNew = !this.devices.has(ip)
    this.devices.set(ip, device)
    if (isNew) {
      this.emit('deviceFound', device)
      await this.registerWith(ip) // tell desktop about us
    } else {
      this.emit('deviceUpdated', device)
    }
    return true
  }

  private async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      // Primero las IPs conocidas fuera del /24 (con más timeout: son pocas)
      const extra = this.extraHosts()
      await Promise.all(extra.map((ip) => this.probeAndTrack(ip, HEALTH_PROBE_TIMEOUT_MS)))

      const prefix = await this.getSubnetPrefix()
      if (!prefix) return

      for (let start = 1; start <= 254; start += PROBE_BATCH) {
        const batch: Promise<boolean>[] = []
        for (let i = start; i < start + PROBE_BATCH && i <= 254; i++) {
          const ip = `${prefix}${i}`
          if (!extra.includes(ip)) batch.push(this.probeAndTrack(ip))
        }
        await Promise.all(batch)
      }
    } finally {
      this.scanning = false
    }
  }

  private async healthCheck(): Promise<void> {
    for (const [ip, device] of this.devices) {
      const alive = await this.probeIp(ip, HEALTH_PROBE_TIMEOUT_MS)
      if (!alive) {
        const misses = (this.misses.get(ip) ?? 0) + 1
        this.misses.set(ip, misses)
        if (misses < HEALTH_MAX_MISSES) continue
        this.misses.delete(ip)
        this.devices.delete(ip)
        this.emit('deviceLost', ip, device)
      } else {
        this.misses.delete(ip)
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
