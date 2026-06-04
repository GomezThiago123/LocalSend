# Guía de Defensa del Código
## Proyecto de Transferencia de Archivos LAN

---

# Bloque A — Red y Conectividad

## A1 — Socket UDP, IP de Broadcast y Puerto

**Archivo:** `desktop/src/main/udpServer.ts`

```ts
export const DISCOVERY_PORT = 53317
const BROADCAST_ADDR = '255.255.255.255'

this.socket = dgram.createSocket({
  type: 'udp4',
  reuseAddr: true
})

this.socket.setBroadcast(true)
```

### Qué decir

- Utilizamos `255.255.255.255` porque es la dirección de broadcast limitado que alcanza a todos los dispositivos de la red local sin necesidad de conocer la máscara de subred.
- El puerto `53317` coincide con el utilizado por LocalSend para evitar conflictos con servicios comunes.
- Cada 3 segundos se envía un beacon `hello`.
- Cada dispositivo descubierto posee un TTL de 10 segundos.
- Si un equipo deja de responder, se elimina automáticamente de la lista.

---

## A2 — Diferenciar JSON de Datos Binarios

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
ws.on('message', async (data, isBinary) => {
  if (!isBinary) {
    if (msg.type === 'metadata') {
      ...
    } else if (msg.type === 'chunk') {
      ...
    } else if (msg.type === 'done') {
      ...
    }
  }
})
```

### Qué decir

- WebSocket entrega el parámetro `isBinary`.
- Cuando vale `false`, el mensaje contiene texto JSON.
- Los mensajes JSON utilizados son:
  - `metadata`
  - `chunk`
  - `done`
- Si `isBinary` fuera `true`, se trataría de bytes crudos.
- Actualmente Expo Go no soporta correctamente frames binarios WebSocket, por eso los datos se envían codificados en Base64 dentro de JSON.
- El soporte binario queda preparado para futuras transferencias Desktop ↔ Desktop.

---

## A3 — Handshake y Espera de Aceptación

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
const accepted = await new Promise<boolean>((resolve) => {
  transfer = { ..., resolve }

  this.emit('transferRequest', meta)
})

if (!accepted) {
  ws.close()
  return
}
```

```ts
resolveTransfer(id, accepted) {
  transfer.resolve(accepted)
}
```

### Qué decir

- Se crea una Promise y se guarda su función `resolve`.
- El flujo se detiene en el `await`.
- Se notifica a la interfaz que existe una solicitud de transferencia.
- Cuando el usuario presiona Aceptar o Rechazar:
  - se llama a `resolveTransfer()`
  - se ejecuta el `resolve`
  - el código continúa.
- Esto permite que la transferencia no avance sin autorización del usuario.

---

# Bloque B — Sistema de Archivos y Memoria

## B1 — Streams y Chunking

### Móvil

**Archivo:** `mobile/src/services/transfer.ts`

```ts
const CHUNK_BYTES = 48 * 1024

let offset = 0

while (offset < size) {
  const length = Math.min(CHUNK_BYTES, size - offset)

  const chunkB64 = await readAsStringAsync(fileUri, {
    position: offset,
    length
  })

  offset += length

  await new Promise<void>((r) =>
    setTimeout(() => r(), 1)
  )
}
```

### Desktop

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
transfer.writeStream =
  fs.createWriteStream(destPath)

transfer.writeStream.write(chunk)
```

### Qué decir

- El archivo se divide en bloques de 48 KB.
- El móvil solamente lee un bloque a la vez utilizando `position` y `length`.
- Nunca se carga el archivo completo en memoria.
- El desktop utiliza `fs.createWriteStream()`.
- Cada chunk se escribe directamente al disco apenas llega.
- Incluso para archivos de varios GB, el consumo de RAM permanece prácticamente constante.

---

## B2 — Colisiones de Nombre de Archivo

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
if (fs.existsSync(baseDest)) {
  const choice =
    await new Promise(...)

  this.emit(
    'transferCollision',
    { id, filename }
  )
}
```

```ts
candidate =
  `${base} (${counter})${ext}`

counter++
```

### Qué decir

Cuando el archivo ya existe:

1. Se pausa la transferencia.
2. Se muestra un diálogo al usuario.
3. Existen tres opciones:
   - Reemplazar
   - Renombrar
   - Saltar

Si se elige Renombrar:

```text
foto.jpg
↓
foto (1).jpg
↓
foto (2).jpg
```

La función sigue incrementando el contador hasta encontrar un nombre libre.

---

# Bloque C — Arquitectura Electron y React Native

## C1 — ¿Por qué usar ContextBridge?

**Archivo:** `desktop/src/preload/index.ts`

```ts
import {
  contextBridge,
  ipcRenderer
} from 'electron'

contextBridge.exposeInMainWorld(
  'electronAPI',
  { ... }
)
```

### Qué decir

- El renderer de Electron funciona dentro de Chromium.
- Por seguridad, no debe acceder directamente a APIs de Node.js.
- Si React pudiera importar `fs` o `child_process`, cualquier vulnerabilidad XSS tendría acceso al sistema operativo.
- `contextBridge` expone únicamente funciones controladas.
- El proceso Main conserva los privilegios y valida todas las operaciones.

Ventajas:

- Mayor seguridad.
- Menor superficie de ataque.
- API controlada y tipada.

---

## C2 — Permisos en React Native

**Archivo:** `mobile/src/services/permissions.ts`

```ts
const { status } =
  await ImagePicker
    .requestMediaLibraryPermissionsAsync()

if (status !== 'granted') {
  Alert.alert(...)
  return false
}
```

### Qué decir

- Si el permiso no es concedido, la función retorna `false`.
- El componente que la llama detecta el resultado y cancela el flujo.
- No se abre el selector de archivos.
- Se informa al usuario mediante un Alert.

Además:

- Android puede marcar el permiso como `never_ask_again`.
- En ese caso ya no aparece el diálogo nativo.
- El usuario debe habilitar el permiso manualmente desde Ajustes.

---

# Escenario de Fallo

## ¿Qué ocurre si se corta la red durante una transferencia?

### Desktop

**Archivo:** `desktop/src/main/wsServer.ts`

```ts
ws.on('close', ...)
ws.on('error', ...)
```

### Qué decir

- El WriteStream se destruye.
- Se emite un evento `transferError`.
- La transferencia se marca como fallida.
- El usuario recibe una notificación del error.

---

### Móvil

**Archivo:** `mobile/src/services/transfer.ts`

```ts
ws.onerror = ...
ws.onclose = ...
```

### Qué decir

- Se rechaza la Promise principal.
- El usuario recibe un mensaje descriptivo.
- La aplicación detecta inmediatamente que la transferencia no finalizó correctamente.

---

# Posibles Mejoras

## 1. Transferencias Reanudables

Actualmente:

```text
Conexión perdida
↓
Transferencia cancelada
```

Mejora propuesta:

```text
Conexión perdida
↓
Guardar offset
↓
Reconectar
↓
Continuar desde el último chunk recibido
```

---

## 2. Verificación de Integridad

Actualmente:

- Se verifica tamaño recibido.

Mejora propuesta:

- Calcular SHA-256 o MD5.
- Comparar hash origen y destino.
- Garantizar integridad end-to-end.

---

# Resumen Rápido para la Defensa

| Pregunta | Archivo | Líneas |
|-----------|----------|----------|
| UDP + Broadcast | udpServer.ts | 5-6, 53, 95, 117 |
| JSON vs Binario | wsServer.ts | 109-203 |
| Handshake | wsServer.ts | 126-138, 238-244 |
| Chunking | transfer.ts | 4, 108-130 |
| WriteStream | wsServer.ts | 168, 179 |
| Colisiones | wsServer.ts | 149-166, 223-235 |
| ContextBridge | preload/index.ts | 1-63 |
| Permisos | permissions.ts | 5-22 |

---

# Frase de cierre para la defensa

> El objetivo principal del proyecto fue implementar una solución de transferencia de archivos en red local con descubrimiento automático de dispositivos, control de permisos, confirmación explícita del usuario y transferencia eficiente mediante chunking y streams, manteniendo una arquitectura segura tanto en Electron como en React Native.