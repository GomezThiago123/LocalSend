# LocalSend — Instrucciones de Configuración y Ejecución

## Requisitos Previos

| Herramienta | Versión mínima | Descarga |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| npm | 10+ | incluido con Node.js |
| Expo CLI | — | `npm install -g expo-cli` |
| EAS CLI (para APK) | — | `npm install -g eas-cli` |
| Android Studio | Flamingo+ | Para emulador Android |

---

## 1. Requisito de Red: Misma Red Wi-Fi

> **Crítico:** Tanto la PC como el celular deben estar conectados a la **misma red Wi-Fi**.

- En el celular: ir a Ajustes → Wi-Fi → conectarse a la misma red que la PC.
- En la PC: verificar la IP local con `ipconfig` (Windows) o `ip -4 addr` (Linux/Mac) y confirmar que los primeros 3 octetos coincidan con los del celular.

### Firewall

Por defecto, el firewall del sistema bloquea conexiones entrantes. Hay que permitir los puertos:

```
Puerto 53317 (UDP) — descubrimiento entre desktops
Puerto 53318 (TCP) — descubrimiento HTTP desde mobile + transferencia de archivos
```

**Windows (Firewall de Windows Defender):**

1. Buscar "Firewall de Windows Defender" en el menú de inicio.
2. Clic en "Configuración avanzada".
3. "Reglas de entrada" → "Nueva regla...".
4. Tipo: **Puerto** → UDP → `53317` → "Permitir la conexión" → aplicar a los 3 perfiles.
5. Repetir para TCP puerto `53318`.

**Linux (ufw):**

Si `sudo ufw status` muestra `Estado: activo`, por defecto rechaza todo lo entrante y hay que abrir los puertos explícitamente (reemplazá `192.168.1.0/24` por el rango real de tu red, visible con `ip -4 addr`):

```bash
sudo ufw allow from 192.168.1.0/24 to any port 53318 proto tcp comment 'LocalSend HTTP/WS'
sudo ufw allow from 192.168.1.0/24 to any port 53317 proto udp comment 'LocalSend UDP beacon'
```

> Ojo si usás VPN: una regla de `ufw` que solo permite un rango de subred viejo (ej. de una VPN anterior) no cubre tu Wi-Fi actual. Verificá con `ip -4 addr` cuál es tu subred real antes de escribir la regla.

**macOS:** al ejecutar la app por primera vez, macOS pregunta si permite conexiones entrantes para Electron — aceptar el diálogo alcanza, no requiere configuración manual de puertos.

---

## 2. Ejecutar la Aplicación de Escritorio

```bash
cd desktop
npm install
npm run dev
```

La ventana de Electron se abre automáticamente. El LED verde en la barra superior indica que el servidor está activo.

### Build para distribución

```bash
cd desktop
npm install
npx electron-vite build        # compila TypeScript + Vite
npx electron-builder --linux   # genera .AppImage (Linux)
npx electron-builder --win     # genera .exe (Windows, requiere Wine en Linux)
# Binario generado en: desktop/dist/LocalSend-1.0.0.AppImage
```

---

## 3. Ejecutar la Aplicación Móvil

### Opción A — Expo Go (desarrollo rápido)

```bash
cd mobile
npx expo start --tunnel   # --tunnel si el celular no puede llegar por LAN al Metro bundler
```

Escaneá el QR con la app **Expo Go** (disponible en Play Store).

> El descubrimiento de dispositivos **sí funciona en Expo Go**: el móvil no usa sockets UDP crudos (Expo Go no los expone), sino que escanea la subred por HTTP (`GET /info` al puerto `53318`) y se registra con el desktop que encuentra. No hace falta compilar un APK solo para probar el descubrimiento o el envío Mobile→Desktop.
>
> Lo que **no** funciona en Expo Go es la notificación persistente de "transferencia en curso" (Android bloqueó `expo-notifications` para push en Expo Go desde el SDK 53) — la app lo detecta y la omite automáticamente sin romper el resto del flujo.

### Opción B — APK con EAS Build (para tener el binario entregable)

```bash
cd mobile
npm install
eas login                                      # requiere cuenta en expo.dev (gratuita)
eas build -p android --profile preview         # genera APK en la nube (~10 min)
```

Una vez completado, EAS te da un link para descargar el `.apk`. Instalalo en el celular con:

```bash
adb install LocalSend_Mobile.apk
```

O transferí el APK al celular y abrilo desde el administrador de archivos (habilitar "Instalar apps de fuentes desconocidas" en Ajustes → Seguridad).

---

## 4. Flujo de Transferencia

### Mobile → Desktop

1. La app Desktop aparece en el radar del celular (≤5 segundos).
2. Seleccioná uno o más archivos en la app móvil (botón "Galería" o "Archivos").
3. Tocá el ícono de la PC en el radar.
4. Confirmá "Enviar".
5. En la PC aparece el diálogo "Aceptar / Rechazar".
6. Al aceptar, el/los archivo(s) se guardan en la carpeta de Descargas configurada.

### Desktop → Mobile

1. El celular aparece en la lista de dispositivos del Desktop apenas se registra (mismo mecanismo del descubrimiento).
2. Arrastrá o seleccioná archivos en la app Desktop → hacé click en el ícono del celular → confirmá.
3. En el celular aparece una alerta nativa "Archivo entrante" con el nombre del remitente y el tamaño → Aceptar/Rechazar.
4. Al aceptar, se muestra un modal de progreso en el celular y el archivo se guarda en el directorio de documentos de la app.

> El móvil no corre un servidor de escucha (no es posible dentro de Expo Go): en su lugar mantiene abierta la conexión que él mismo inició al descubrir el Desktop, y esa misma conexión se reutiliza para el envío en sentido contrario. Si el celular estuvo desconectado un rato (background, cambio de red), puede tardar unos segundos en reconectar antes de que el Desktop pueda enviarle algo — si el botón de enviar da error "no tiene una conexión activa", esperá el próximo ciclo de descubrimiento (≤5s) y reintentá.

### Desktop → otro dispositivo Desktop

1. Arrastrá archivos al panel inferior izquierdo de la app Desktop (o hacé click para seleccionar).
2. Los dispositivos detectados en la lista se resaltan con borde azul.
3. Hacé click en el dispositivo destino → confirmá en el diálogo.
4. El panel derecho "Transferencias" muestra el progreso en tiempo real (↑ Enviando / ↓ Recibiendo).
5. Al completar, aparece una notificación nativa del sistema.

### Resolución de nombres de archivo duplicados

Si el archivo ya existe en la carpeta destino, se renombra automáticamente:
- `foto.jpg` → `foto (1).jpg` → `foto (2).jpg`...

En el celular aplica el mismo criterio de renombrado automático (no hay diálogo Reemplazar/Omitir del lado mobile).

---

## 5. Estructura del Proyecto

```
LocalSend/
├── desktop/                # Electron + Vite + React
│   ├── src/
│   │   ├── main/           # Proceso main: UDP, WebSocket, IPC
│   │   ├── preload/        # contextBridge seguro
│   │   └── renderer/       # UI React
│   └── package.json
├── mobile/                 # React Native + Expo
│   ├── src/
│   │   ├── services/       # discovery, transfer, receiver, permissions
│   │   ├── components/     # RadarView, FileCard, ProgressModal
│   │   └── screens/        # HomeScreen
│   ├── App.tsx
│   └── package.json
└── INSTRUCCIONES.md
```

---

## 6. Preguntas Frecuentes

**¿Los dispositivos no se detectan?**
- Verificá que ambos estén en la **misma subred** (los primeros 3 octetos de la IP deben coincidir, ej: `192.168.1.X`) — probalo comparando la IP que muestra la cabecera de la app Desktop contra la del celular.
- Desactivá VPNs activas (cambian tu subred efectiva).
- Revisá el firewall (sección 1) — en Linux, una regla de `ufw` para una subred vieja (ej. de VPN) no cubre tu Wi-Fi actual aunque el firewall esté "activo" con reglas.
- Confirmá que ambos estén en la misma red Wi-Fi y no en "red de invitados" (muchos routers aíslan clientes entre sí en esa red).

**¿La app desktop se congela durante una transferencia grande?**
- No debería: el servidor usa `fs.createWriteStream` para escribir en chunks sin bloquear el hilo principal de Electron.

**¿La transferencia se corta o queda "pegada" al enviar archivos grandes desde el móvil?**
- El emisor espera un ack por chunk antes de mandar el siguiente (ver protocolo en el README). Si tras actualizar el código la transferencia se queda colgada en 0%, asegurate de haber reiniciado **completamente** la app de escritorio (no alcanza con hot-reload del renderer) para que tome el `wsServer.ts` actualizado.

**¿Cómo cambio la carpeta de descargas?**
- En la app Desktop, hacé clic en el botón "📁 Descargas" en la barra superior. Por defecto usa la carpeta de descargas real del sistema operativo (respeta el idioma: `Descargas`, `Downloads`, etc.), no un nombre hardcodeado.

**¿Al enviar Desktop→Mobile da error "no tiene una conexión activa para recibir archivos"?**
- El celular todavía no terminó de registrarse como receptor (recién descubierto, o reconectando tras perder la red). Esperá unos segundos al próximo ciclo de descubrimiento y reintentá — la app Desktop no reintenta sola.
