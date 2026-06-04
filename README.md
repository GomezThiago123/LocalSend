# LocalSend — Transferencia P2P Local

Implementación de LocalSend: transferencia de archivos entre dispositivos en la misma red Wi-Fi, sin servidor central, cero configuración.

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  Red Wi-Fi Local                                    │
│                                                     │
│  [PC — Electron App]  ←──UDP 53317──→  [Android]   │
│         ↑                                    ↑      │
│    WebSocket server              WebSocket client   │
│      (TCP 53318)     ←──TCP 53318──────────┘        │
└─────────────────────────────────────────────────────┘
```

### Protocolo de Descubrimiento (UDP)
- Puerto fijo `53317`, broadcast `255.255.255.255`
- Cada dispositivo envía "beacons" cada 3 segundos: `{"type":"hello","alias":"...","deviceType":"...","port":53318}`
- TTL de 10 segundos: si un dispositivo no responde, se elimina de la lista

### Protocolo de Transferencia (WebSocket sobre TCP)
1. **Cliente** envia: `{type:"metadata", filename, size, mime, senderAlias}`
2. **Servidor** espera decision del usuario
3. **Servidor** responde: `{type:"decision", accepted: true/false}`
4. **Cliente** envia chunks binarios (48KB mobile / sin limite desktop)
5. **Cliente** envia: `{type:"done"}`
6. **Servidor** confirma: `{type:"ack"}`

### Manejo de Memoria (Streams)
- Desktop: `fs.createWriteStream` — escribe chunks directamente a disco sin cargar en RAM
- Mobile: `FileSystem.readAsStringAsync` con `position` y `length` — lee 48KB a la vez

## Entregables
- `desktop/` — codigo fuente Electron app
- `mobile/` — codigo fuente React Native app
- `INSTRUCCIONES.md` — guia de configuracion de red y build
- `GuíadeDefensa.md` — guia de defensa para mi código

Ver [INSTRUCCIONES.md](./INSTRUCCIONES.md) para ejecutar el proyecto.

Ver [GuíadeDefensa.md](GuíadeDefensa.md) para defender mi código