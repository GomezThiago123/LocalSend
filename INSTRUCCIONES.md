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
- En la PC: verificar desde `ipconfig` (Windows) que estés en la red correcta.

### Firewall en Windows

Por defecto, Windows bloquea conexiones entrantes. Permitir los puertos:

```
Puerto 53317 (UDP) — descubrimiento
Puerto 53318 (TCP) — transferencia de archivos
```

**Pasos rápidos:**

1. Buscar "Firewall de Windows Defender" en el menú de inicio.
2. Clic en "Configuración avanzada".
3. "Reglas de entrada" → "Nueva regla...".
4. Tipo: **Puerto** → UDP → `53317` → "Permitir la conexión" → aplicar a los 3 perfiles.
5. Repetir para TCP puerto `53318`.

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

### Opción A — Expo Go (desarrollo rápido, sin UDP nativo)

```bash
cd mobile
npm install
npx expo start
```

Escaneá el QR con la app **Expo Go** (disponible en Play Store).

> Nota: `react-native-udp` requiere el bare workflow. En Expo Go el descubrimiento UDP no funciona. Usá la Opción B para la demo completa.

### Opción B — APK con EAS Build (recomendado para la demo)

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

### Desktop → otro dispositivo Desktop

1. Arrastrá archivos al panel inferior izquierdo de la app Desktop (o hacé click para seleccionar).
2. Los dispositivos detectados en la lista se resaltan con borde azul.
3. Hacé click en el dispositivo destino → confirmá en el diálogo.
4. El panel derecho "Transferencias" muestra el progreso en tiempo real (↑ Enviando / ↓ Recibiendo).
5. Al completar, aparece una notificación nativa del sistema.

### Resolución de nombres de archivo duplicados

Si el archivo ya existe en la carpeta destino, se renombra automáticamente:
- `foto.jpg` → `foto (1).jpg` → `foto (2).jpg`...

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
│   │   ├── services/       # discovery, transfer, permissions
│   │   ├── components/     # RadarView, FileCard, ProgressModal
│   │   └── screens/        # HomeScreen
│   ├── App.tsx
│   └── package.json
└── INSTRUCCIONES.md
```

---

## 6. Preguntas Frecuentes

**¿Los dispositivos no se detectan?**
- Verificá que ambos estén en la **misma subred** (los primeros 3 octetos de la IP deben coincidir, ej: `192.168.1.X`).
- Desactivá VPNs activas.
- Revisá las reglas del Firewall de Windows (ver sección 1).

**¿La app desktop se congela durante una transferencia grande?**
- No debería: el servidor usa `fs.createWriteStream` para escribir en chunks sin bloquear el hilo principal de Electron.

**¿Cómo cambio la carpeta de descargas?**
- En la app Desktop, hacé clic en el botón "📁 Descargas" en la barra superior.
