# Guía de Defensa del Código
## Proyecto de Transferencia de Archivos LAN

---

## ⚠️ Antes de empezar: lo que hay que saber de memoria

- **La rúbrica pide una "Prueba de Estrés": video >500MB de PC → Móvil.** Esta dirección **sí funciona**, pero con un truco: el móvil no corre un servidor (imposible en Expo Go sin módulos nativos). En su lugar, al descubrir el desktop abre una conexión WebSocket persistente y se queda escuchando en ella; cuando el desktop quiere enviarle algo, reutiliza esa misma conexión y "empuja" el archivo con el mismo protocolo, invirtiendo los roles. Ver Bloque A4. Si preguntan "¿dónde escucha el móvil conexiones entrantes?" — en ningún lado, y hay que poder explicar por qué (ver Bloque A1 y A4).
- **Descubrimiento:** PC↔PC es UDP broadcast real. Móvil→PC es un escaneo HTTP de la subred, no UDP (Expo Go no expone sockets UDP crudos). Si preguntan "muéstrenme el socket UDP en el móvil" — no existe, y hay que poder explicar por qué (ver Bloque A1).
- **Colisión de nombres en mobile** (al recibir) es más simple que en desktop: renombra automático, no hay diálogo Reemplazar/Omitir. Aclarar esto si preguntan por la paridad de UX entre plataformas.

---

# Bloque A — Red y Conectividad

## A1 — Socket UDP, IP de Broadcast y Puerto

**Archivo:** `desktop/src/main/udpServer.ts`

```ts
export const DISCOVERY_PORT = 53317              // línea 5
const BROADCAST_ADDR = '255.255.255.255'         // línea 6

this.socket = dgram.createSocket({               // línea 53
  type: 'udp4',
  reuseAddr: true
})

this.socket.bind(DISCOVERY_PORT, () => {         // línea 94
  this.socket!.setBroadcast(true)
  this.startBeaconing()
  this.startTtlCleanup()
})
```

### Qué decir

- Usamos `255.255.255.255` (broadcast limitado) porque llega a todos los hosts de la subred local sin necesitar conocer la máscara de red de antemano.
- El puerto `53317` es el mismo que usa LocalSend original — lo mantuvimos por compatibilidad conceptual, elegido para no chocar con puertos de sistema conocidos.
- Cada 3s (`BEACON_INTERVAL_MS`) se emite un beacon `{type:"hello", alias, deviceType, port}`.
- Cada dispositivo descubierto tiene TTL de 10s (`DEVICE_TTL_MS`); si deja de sonar, `startTtlCleanup()` lo elimina y emite `deviceLost`.
- **Esto es solo desktop↔desktop.** El móvil no tiene este socket: en Expo Go no se puede abrir un socket UDP crudo, así que en su lugar el móvil escanea la subred por HTTP (ver A1-bis).

## A1-bis — Cómo descubre el móvil al desktop (sin UDP)

**Archivo:** `mobile/src/services/discovery.ts`

```ts
// línea 57
const res = await fetch(`http://${ip}:${WS_PORT}/info`, { signal: controller.signal })
```

```ts
// desktop/src/main/wsServer.ts, línea 51
if (req.method === 'GET' && req.url === '/info') {
  res.end(JSON.stringify({ alias: this.alias, deviceType: 'desktop', port: WS_PORT }))
}
```

### Qué decir

- El móvil calcula el prefijo `/24` de su propia IP (`getSubnetPrefix()`, discovery.ts línea 42) y prueba `GET /info` contra las 254 IPs posibles, en lotes de 25 con timeout de 800ms, cada 5 segundos.
- Al recibir una respuesta válida, hace `POST /register` (discovery.ts línea 76) para que el desktop lo agregue a su lista de dispositivos — el desktop no tiene forma de "broadcast-descubrir" al móvil, por eso el móvil se anuncia activamente.
- Es más lento y menos elegante que UDP multicast, pero es la única opción viable dentro de Expo Go sin módulos nativos custom.

---

## A2 — Diferenciar JSON de "chunk" de datos

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
// línea 109
ws.on('message', async (data, isBinary) => {
  if (!isBinary) {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'metadata') { ... }       // línea 115
    else if (msg.type === 'chunk') { ... }     // línea 176
    else if (msg.type === 'done') { ... }      // línea 195
  }
  // binary frames kept for future desktop↔desktop transfers — línea 213
})
```

### Qué decir

- WebSocket entrega el parámetro `isBinary` en cada evento `message`.
- En nuestro protocolo, **todo** viaja como texto JSON (incluso los chunks de archivo, codificados en Base64 dentro de `{type:"chunk", data:"..."}"`) — el camino de frames binarios crudos existe en el código pero no se usa todavía.
- **Por qué Base64 y no binario crudo:** el WebSocket de React Native en Expo Go tiene soporte limitado/inconsistente para frames binarios (`ArrayBuffer`/`Blob`) según versión; Base64-sobre-JSON es el mínimo común denominador que funciona igual en Expo Go y en un build nativo. El costo es ~33% más de bytes en el aire, aceptable en LAN.
- El diferenciador real de "qué es cada mensaje" no es `isBinary` sino el campo `type` del JSON: `metadata` / `chunk` / `chunkAck` / `done` / `ack` / `decision`.

---

## A3 — Handshake y Espera de Aceptación

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
// línea 126
const accepted = await new Promise<boolean>((resolve) => {
  transfer = { meta, state: 'pending', ..., resolve }
  this.pendingDecisions.set(id, transfer)
  this.emit('transferRequest', meta)   // la UI muestra el diálogo Aceptar/Rechazar
})

if (!accepted) {
  ws.send(JSON.stringify({ type: 'decision', accepted: false }))
  ws.close()
  return
}
```

```ts
// línea 248 — se llama desde el IPC cuando el usuario clickea Aceptar/Rechazar
resolveTransfer(id, accepted) {
  const transfer = this.pendingDecisions.get(id)
  if (transfer?.state === 'pending') {
    transfer.resolve(accepted)   // esto "despierta" el await de arriba
  }
}
```

### Qué decir

- Al llegar el mensaje `metadata`, se crea una `Promise` cuyo `resolve` se guarda en el objeto `transfer` — el código literalmente se congela en el `await` hasta que alguien llame a ese `resolve`.
- Mientras tanto se emite `transferRequest` hacia la UI de React, que muestra el diálogo modal.
- Cuando el usuario clickea "Aceptar" o "Rechazar" en el renderer, un IPC handler (`transfer:decide` en `index.ts`) llama a `wsServer.resolveTransfer(id, accepted)`, que ejecuta el `resolve` guardado y el `await` continúa con el valor correspondiente.
- Este mismo patrón (Promise + resolve guardado) se reutiliza para el diálogo de colisión de nombres (línea 152).

---

## A4 — Desktop → Mobile: empujar un archivo sin que el móvil tenga servidor

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
private receivers = new Map<string, WebSocket>()        // línea 67 — ip → conexión persistente
private pushWaiters = new Map<string, PushWaiters>()     // línea 68 — callbacks del envío en curso

// dentro del handler de mensajes:
if (msg.type === 'register') {                            // línea 141
  this.receivers.set(senderIp, ws)                         // guarda la conexión que abrió el móvil
  ws.send(JSON.stringify({ type: 'registered' }))
} else if (msg.type === 'decision' && this.pushWaiters.has(senderIp)) {  // línea 147
  this.pushWaiters.get(senderIp)?.decision?.resolve(msg.accepted)
}
// (mismo patrón para 'chunkAck' línea 151 y 'ack' línea 154)
```

```ts
// pushFile(), línea 292 — llamado desde index.ts cuando el destino es un móvil
async pushFile(ip, filePath, senderAlias, onProgress) {
  const ws = this.receivers.get(ip)                        // línea 298
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('...')

  const accepted = await new Promise<boolean>((resolve, reject) => {   // línea 307
    this.pushWaiters.set(ip, { decision: { resolve, reject } })
    ws.send(JSON.stringify({ type: 'metadata', filename, size, senderAlias }))
  })
  // ...loop de chunks con fs.readSync + await chunkAck (línea 321-339), igual que B1
}
```

**Archivo:** `mobile/src/services/receiver.ts`

```ts
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'register', alias: this.alias, deviceType: 'mobile' }))
}
// al llegar 'metadata': se emite 'transferRequest' → HomeScreen muestra un Alert Aceptar/Rechazar
// al aceptar: file.create() y por cada 'chunk': file.write(base64, { encoding: 'base64', append: true })
```

### Qué decir

- El desktop **nunca abre una conexión saliente hacia el móvil** — no podría, el móvil no escucha en ningún puerto. En cambio, cuando el móvil descubre un desktop (mismo mecanismo HTTP de A1-bis), abre él mismo una conexión WebSocket y la deja viva enviando `{type:"register"}`. El desktop guarda esa conexión en un `Map<ip, WebSocket>`.
- Cuando el usuario elige enviarle un archivo a ese móvil desde la UI del desktop, **no se abre una conexión nueva**: se reutiliza la ya existente, y el desktop pasa a jugar el rol de "cliente" sobre ella — manda `metadata`, espera `decision`, manda `chunk` y espera `chunkAck` (mismo protocolo de siempre, pero invertido).
- El truco para que esto no choque con el manejo de mensajes ya existente (que asume que el que se conecta es un emisor): se guardan callbacks pendientes (`pushWaiters`) por IP, y los tipos `decision`/`chunkAck`/`ack` solo se interpretan como respuesta a un push nuestro si hay un callback pendiente para esa IP — si no, esos tipos de mensaje ni se procesan (nunca llegan de un emisor normal, ya que en ese rol el desktop es quien los *envía*, no quien los recibe).
- Del lado del móvil, la escritura incremental sin cargar el archivo completo en RAM se logra con `File.write(base64Chunk, { encoding: 'base64', append: true })` de `expo-file-system` — es sincrónico y decodifica+agrega cada chunk directo a disco, chunk por chunk, igual de "streaming" que el `fs.createWriteStream` del desktop.

---

# Bloque B — Sistema de Archivos y Memoria

## B1 — Streams y Chunking (con control de flujo)

### Móvil (emisor) — `mobile/src/services/transfer.ts`

```ts
const CHUNK_BYTES = 48 * 1024   // línea 4

let offset = 0
while (offset < size) {                              // línea 117
  const length = Math.min(CHUNK_BYTES, size - offset)

  const chunkB64 = await readAsStringAsync(fileUri, { // línea 120
    encoding: EncodingType.Base64,
    position: offset,
    length
  })

  ws.send(JSON.stringify({ type: 'chunk', data: chunkB64 }))   // línea 127

  // Backpressure: esperamos el ack del receptor antes de seguir
  await new Promise<void>((res, rej) => {              // línea 132
    this.pendingChunkAck = { resolve: res, reject: rej }
  })

  offset += length
}
```

### Desktop (receptor) — `desktop/src/main/wsServer.ts`

```ts
fs.mkdirSync(this.downloadDir, { recursive: true })   // línea 168
transfer.writeStream = fs.createWriteStream(destPath) // línea 169

// al llegar cada chunk (línea 176):
const chunk = Buffer.from(msg.data, 'base64')
transfer.writeStream.write(chunk)
transfer.bytesReceived += chunk.byteLength
ws.send(JSON.stringify({ type: 'chunkAck' }))          // línea 193
```

### Qué decir

- El archivo se lee/escribe en bloques de 48KB, nunca completo en memoria: el móvil usa `position`/`length` para leer solo el fragmento que toca, y el desktop usa `fs.createWriteStream` para volcar cada chunk a disco apenas llega.
- **El detalle que suelen preguntar:** ¿por qué esperar un ack por chunk en vez de mandar todo seguido? Porque `WebSocket.send()` en React Native es "fire and forget" — no hay forma confiable de saber cuánto queda en el buffer de salida (`bufferedAmount` existe en la interfaz pero React Native nunca lo actualiza). Sin este control de flujo, el emisor encola cientos de chunks más rápido de lo que la red los puede procesar, lo que en la práctica saturaba el puente nativo y cortaba la conexión en archivos grandes (lo detectamos probando con un video de ~48MB). Agregar un ack por chunk acota cuánto queda "en vuelo" y de paso hace que el progreso reportado sea el real, no uno adelantado.
- Costo de este diseño: un round-trip de red por cada 48KB. En LAN (latencia ~1-5ms) es un overhead aceptable; en una red con más latencia sería mejor una ventana deslizante (permitir varios chunks sin ack antes de frenar) en vez de lock-step estricto — lo mencionamos como mejora posible más abajo.

---

## B2 — Colisiones de Nombre de Archivo

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
// línea 151
if (fs.existsSync(baseDest)) {
  const choice = await new Promise<'replace' | 'rename' | 'skip'>((res) => {
    this.collisionResolvers.set(meta.id, res)
    this.emit('transferCollision', { id: meta.id, filename: meta.filename })
  })
  ...
  destPath = choice === 'replace' ? baseDest : this.resolveDestPath(meta.filename)
}
```

```ts
// resolveDestPath, línea 233
let counter = 1
do {
  candidate = path.join(this.downloadDir, `${base} (${counter})${ext}`)
  counter++
} while (fs.existsSync(candidate))
```

### Qué decir

Cuando el archivo destino ya existe:
1. Se pausa el flujo (mismo patrón Promise+resolve que el handshake de aceptación).
2. Se emite `transferCollision` y la UI muestra un modal con 3 opciones: **Reemplazar**, **Mantener ambos (renombrar)**, **Omitir**.
3. Si elige renombrar, `resolveDestPath` prueba `foto (1).jpg`, `foto (2).jpg`... incrementando hasta encontrar un nombre libre en disco.

---

# Bloque C — Arquitectura Electron y React Native

## C1 — ¿Por qué `contextBridge` en vez de importar `fs` directo?

**Archivo:** `desktop/src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'   // línea 1

contextBridge.exposeInMainWorld('electronAPI', {        // línea 11
  getConfig: () => ipcRenderer.invoke('config:get'),
  sendFiles: (device, filePaths) => ipcRenderer.invoke('transfer:sendFiles', device, filePaths),
  onTransferProgress: (cb) => ipcRenderer.on('transfer:progress', (_, p) => cb(p)),
  // ...resto de la API expuesta
})
```

### Qué decir

- El renderer corre con `contextIsolation: true` y `nodeIntegration: false` (configurado en `desktop/src/main/index.ts`, `createWindow()`) — es decir, el proceso de React/Vite corre en un contexto aislado de Node.js, como si fuera una página web común.
- Si React pudiera hacer `import fs from 'fs'` directamente, cualquier vulnerabilidad XSS en el renderer (por ejemplo, contenido malicioso mostrado en pantalla) tendría acceso directo al sistema de archivos y a `child_process`.
- `contextBridge.exposeInMainWorld` publica un objeto `window.electronAPI` con **solo** las funciones que decidimos exponer, cada una mapeada a un canal IPC específico manejado por el proceso Main (`ipcMain.handle(...)` en `index.ts`). El Main valida y ejecuta la operación real (leer archivos, escribir, abrir diálogos) — el renderer nunca toca el filesystem directamente, solo pide "hacé esto" y recibe una respuesta.

## C2 — Permisos en React Native: ¿qué pasa si el usuario rechaza?

**Archivo:** `mobile/src/services/permissions.ts`

```ts
export async function requestMediaPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permiso denegado', 'LocalSend necesita acceso a tu galería...', [{ text: 'Entendido' }])
      return false
    }
    return true
  }
  ...
}
```

### Qué decir

- La función retorna un `boolean`; quien la llama (en `HomeScreen.tsx`, antes de abrir el Image/Document Picker) revisa el resultado y **no abre el picker** si es `false` — corta el flujo ahí mismo en vez de dejar que el picker nativo falle silenciosamente.
- Se informa al usuario con un `Alert` nativo explicando por qué se necesita el permiso.
- Dato importante para la defensa: en Android, si el usuario rechaza dos veces, el sistema marca el permiso como "no volver a preguntar" (`never_ask_again`) y la promesa de `requestMediaLibraryPermissionsAsync()` sigue devolviendo `denied` sin mostrar el diálogo nativo de nuevo — en ese caso la única salida es que el usuario lo habilite manualmente desde Ajustes del sistema; nuestra app no implementa un deep-link a esa pantalla, solo el `Alert` explicativo.

---

# Escenario de Fallo: "voy a desconectar la red a mitad de la transferencia"

### Desktop — `desktop/src/main/wsServer.ts`

```ts
ws.on('error', () => {                       // línea 216
  if (transfer?.state === 'receiving') {
    transfer.writeStream?.destroy()
    this.emit('transferError', { id: transfer.meta.id, reason: 'connection' })
  }
})

ws.on('close', () => { /* misma lógica */ }) // línea 224
```

### Qué decir (desktop)

- El `WriteStream` se destruye (`destroy()`), no queda un archivo a medio escribir bloqueado ni corrupto de forma silenciosa — el archivo parcial queda en disco pero el estado se marca `transferError`.
- La UI recibe el evento `transfer:error` y muestra "Conexión interrumpida — pedile al remitente que reintente" en vez de quedarse cargando indefinidamente.

### Móvil — `mobile/src/services/transfer.ts`

```ts
ws.onerror = () => {                                              // línea 87
  this.pendingChunkAck?.reject(new Error('WebSocket error'))
  settle(() => reject(new Error('WebSocket error')))
}

ws.onclose = () => {                                              // línea 95
  if (this.status !== 'done' && this.status !== 'rejected') {
    this.pendingChunkAck?.reject(new Error('Conexión cerrada inesperadamente'))
    settle(() => reject(new Error('Conexión cerrada inesperadamente')))
  }
}
```

### Qué decir (móvil)

- Si la conexión se cae mientras `streamFile()` está esperando el ack de un chunk (línea 132), ese `await` quedaría colgado para siempre si no hiciéramos nada — por eso `onerror`/`onclose` también rechazan explícitamente la promesa pendiente del chunk (`pendingChunkAck?.reject(...)`), no solo la promesa general de `send()`.
- El usuario ve el error inmediatamente en el modal de progreso, con botón de reintentar, en vez de una barra de progreso congelada sin explicación.

---

# Posibles Mejoras (para cuando pregunten "¿qué mejorarían?")

## 1. Colisión de nombres en mobile con diálogo (no solo auto-rename)

Actualmente, al recibir en el móvil, si el archivo ya existe se renombra automáticamente (`foto (1).jpg`) sin preguntar — a diferencia del desktop, que ofrece Reemplazar/Mantener/Omitir. Agregar ese mismo diálogo en mobile (un modal simple antes de `beginReceiving()` en `receiver.ts`) daría paridad de UX entre plataformas.

## 2. Reconexión más robusta del canal de recepción

La conexión persistente que el móvil abre para poder recibir (`receiver.ts`) se reintenta cada 4 segundos si se cae, pero mientras tanto el desktop no tiene forma de saber que está reconectando — solo ve "conexión no disponible" si intenta un envío en ese lapso. Se podría agregar un estado "reconectando" visible en la lista de dispositivos del desktop.

## 3. Transferencias reanudables

```text
Conexión perdida → offset guardado → reconexión → continuar desde el último chunk (en vez de reiniciar desde 0)
```

## 4. Verificación de integridad end-to-end

Actualmente solo se compara el tamaño recibido contra el tamaño anunciado en `metadata`. Una mejora sería calcular SHA-256 en el emisor, enviarlo en el mensaje `done`, y que el receptor lo verifique contra el archivo escrito en disco.

## 5. Backpressure con ventana deslizante

El ack estricto por chunk (lock-step) es simple y correcto pero no aprovecha al máximo el ancho de banda disponible en redes con más latencia que una LAN típica. Una ventana de N chunks sin ack (en vez de 1) reduciría el overhead de round-trips manteniendo el control de flujo.

---

# Resumen Rápido para la Defensa

| Pregunta | Archivo | Líneas |
|---|---|---|
| UDP + Broadcast (solo desktop↔desktop) | udpServer.ts | 5-6, 53, 94-101 |
| Cómo descubre el móvil sin UDP | discovery.ts / wsServer.ts | 42-73, 76-86 / 77-81 |
| Desktop→Mobile: conexión persistente + push | wsServer.ts / receiver.ts | 67-68, 141-155, 292-351 / completo |
| JSON vs chunk | wsServer.ts | 135-256 |
| Handshake de aceptación | wsServer.ts / index.ts | 168-188, 368-374 |
| Chunking + backpressure (ack por chunk) | transfer.ts / wsServer.ts | 4, 117-142 / 210-235 |
| WriteStream | wsServer.ts | 210-211 |
| Colisiones de nombre | wsServer.ts / receiver.ts | 190-208, 353-366 / `resolveDestFile` |
| ContextBridge | preload/index.ts | 1-83 |
| Permisos (rechazo del usuario) | permissions.ts | 1-22 |
| Manejo de desconexión | wsServer.ts / transfer.ts | 258-286 / 87-103 |

---

# Frase de cierre para la defensa

> El objetivo principal del proyecto fue implementar una solución de transferencia de archivos en red local con descubrimiento automático de dispositivos, control de permisos, confirmación explícita del usuario y transferencia eficiente mediante chunking, streams y control de flujo, manteniendo una arquitectura segura tanto en Electron (contextBridge) como en React Native (permisos en runtime). La transferencia funciona en ambas direcciones (Mobile↔Desktop) pese a que el móvil no puede correr un servidor propio dentro de Expo Go, reutilizando la conexión WebSocket que el móvil inicia al descubrir un desktop para empujarle archivos en el sentido contrario con el mismo protocolo.
