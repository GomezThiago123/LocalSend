import { networkInterfaces } from 'os'

// Interfaces virtuales que tienen IPv4 aunque no haya red real (Docker, VMs,
// VPN bridges). Si no las ignoramos, al cortar el Wi-Fi la PC seguiría
// "teniendo IP" (ej. 172.17.0.1 de docker0) y nunca detectaríamos la desconexión.
const VIRTUAL_IFACE = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|zt)/

// Devuelve la IP de la red local real (Wi-Fi / Ethernet), o null si no hay ninguna.
export function getLanIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    if (VIRTUAL_IFACE.test(name)) continue
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}
