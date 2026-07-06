# LocalSend — Transferencia P2P Local

Implementación de LocalSend: transferencia de archivos entre dispositivos en la misma red Wi-Fi, sin servidor central, cero configuración.

## Arquitectura

```
┌───────────────────────────────────────────────────────────────────┐
│  Red Wi-Fi Local                                                  │
│                                                                    │
│  [PC — Electron]  ←──UDP 53317 (broadcast)──→  [PC — Electron]    │
│        │  ↑                                                       │
│        │  └── HTTP GET /info + POST /register ──┐                 │
│        │                                        │                 │
│   WS/HTTP server (TCP 53318)              [Android — Expo Go]     │
│   recibe archivos            ←──WS persistente──  registrado      │
│   Y empuja archivos al          (register)        como receptor   │
│   móvil sobre esa misma conexión                                  │
└───────────────────────────────────────────────────────────────────┘
```

**Desktop ↔ Desktop:** se descubren por UDP broadcast (puerto `53317`).
**Mobile → Desktop:** el móvil no participa del broadcast UDP (Expo Go no expone sockets UDP crudos). En su lugar escanea el rango de IPs de su propia subred vía HTTP (`GET /info` puerto `53318`) y, al encontrar un desktop, se registra con `POST /register` para aparecer en su lista de dispositivos.
**Desktop → Mobile:** el móvil no puede correr un servidor de recepción dentro de Expo Go (no hay sockets TCP de escucha sin módulos nativos custom). En su lugar, al descubrir un desktop, el móvil abre una conexión WebSocket persistente y se anuncia con `{type:"register"}`; el desktop guarda esa conexión y, cuando el usuario elige enviarle un archivo a ese móvil, la reutiliza para empujarle los datos con el mismo protocolo (`metadata`/`decision`/`chunk`/`chunkAck`/`done`/`ack`), solo que con los roles invertidos. Ver `desktop/src/main/wsServer.ts` (`pushFile`) y `mobile/src/services/receiver.ts`.

### Protocolo de Descubrimiento

**UDP (solo desktop↔desktop)** — `desktop/src/main/udpServer.ts`
- Puerto fijo `53317`, broadcast `255.255.255.255`
- Cada dispositivo envía beacons cada 3s: `{"type":"hello","alias":"...","deviceType":"desktop","port":53318}`
- TTL de 10s: si un dispositivo no responde, se elimina de la lista

**HTTP scan (mobile→desktop)** — `mobile/src/services/discovery.ts` / `desktop/src/main/wsServer.ts`
- El móvil prueba `GET http://<ip>:53318/info` contra las 254 IPs de su subred (en lotes de 25, timeout 800ms) cada 5s
- Al encontrar un desktop, hace `POST /register` con su propio alias/tipo/puerto para aparecer en el radar de esa PC
- Health-check cada 4s mantiene vivo el registro (equivalente al TTL del UDP)

### Protocolo de Transferencia (WebSocket sobre TCP, puerto 53318)

1. **Emisor** envía: `{type:"metadata", filename, size, mime, senderAlias}`
2. **Receptor** espera la decisión del usuario (Aceptar/Rechazar) y responde `{type:"decision", accepted}`
3. Si fue rechazado o hay colisión de nombre sin resolver → se cierra la conexión
4. **Emisor** envía chunks: `{type:"chunk", data:"<base64>"}` (48KB por chunk desde mobile)
5. **Receptor** escribe el chunk a disco y responde `{type:"chunkAck"}` — el emisor espera este ack antes de mandar el siguiente chunk (backpressure; ver nota abajo)
6. **Emisor** envía `{type:"done"}` → **Receptor** confirma `{type:"ack"}`

> **Por qué el ack por chunk:** `WebSocket.send()` en React Native no expone un `bufferedAmount` confiable — es "fire and forget" sobre el puente nativo. Sin control de flujo, el emisor encola cientos de chunks antes de que la red los procese, lo que satura el puente y corta la conexión en archivos grandes. Esperar el ack por chunk acota cuánto queda "en vuelo" a la vez y hace que la barra de progreso refleje bytes realmente entregados, no solo encolados.

### Manejo de Memoria (Streams)
- Desktop (recibe): `fs.createWriteStream` — escribe cada chunk directo a disco sin acumular el archivo en RAM
- Desktop (envía, `wsClient.ts`): lee con streams de Node en chunks, nunca carga el archivo completo
- Mobile (envía): `expo-file-system` `readAsStringAsync` con `position`/`length` — lee 48KB a la vez

## Limitaciones conocidas

- **Colisión de nombres en mobile:** al recibir, si el archivo ya existe se renombra automáticamente (`foto (1).jpg`) — no hay diálogo de Reemplazar/Omitir como en desktop.
- **Reconexión mobile→desktop:** si la conexión persistente de recepción se cae (app en background, cambio de red), el móvil reintenta cada 4s; durante ese lapso el desktop no puede empujarle archivos.
- **Sin reanudación de transferencias.** Si se corta la conexión a mitad de un envío, hay que reiniciarlo desde cero (no se guarda el offset).
- **Sin verificación de integridad end-to-end** (hash) — solo se compara el tamaño recibido.

## Entregables
- `desktop/` — código fuente Electron app
- `mobile/` — código fuente React Native app
- `INSTRUCCIONES.md` — guía de configuración de red y build
- `GuíadeDefensa.md` — guía de defensa para el código

Ver [INSTRUCCIONES.md](./INSTRUCCIONES.md) para ejecutar el proyecto.

Ver [GuíadeDefensa.md](GuíadeDefensa.md) para defender el código.
