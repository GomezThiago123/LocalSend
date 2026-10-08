import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  Alert,
  useColorScheme
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import * as Network from 'expo-network'
import { DiscoveryService, type DiscoveredDevice } from '../services/discovery'
import { TransferClient, type TransferProgress, type TransferStatus, type LinkLoss } from '../services/transfer'
import { ReceiverService, type IncomingTransferMeta } from '../services/receiver'
import { getOrCreateAlias } from '../services/deviceAlias'
import { requestMediaPermission } from '../services/permissions'
import { setupNotificationChannel, startForegroundTask, stopForegroundTask } from '../services/foregroundTask'
import type { SelectedFile } from '../components/FileCard'
import FileCard from '../components/FileCard'
import RadarView from '../components/RadarView'
import TransferProgressModal from '../components/TransferProgressModal'
import { useTheme } from '../theme'

// Texto para el usuario según quién perdió la red. El que se queda sin Wi-Fi
// no puede avisar nada, así que es el otro lado el que lo deduce y lo muestra.
function lossMessage(kind: LinkLoss, peerAlias: string, dir: 'send' | 'receive'): string {
  const verb = dir === 'send' ? 'enviar' : 'recibir'
  switch (kind) {
    case 'local-offline':
      return `Este celular se quedó sin Wi-Fi. El archivo no se pudo ${verb}.`
    case 'peer-offline':
      return `La PC "${peerAlias}" se quedó sin conexión Wi-Fi. El archivo no se pudo ${verb}.`
    case 'connect':
      return `No se pudo conectar con "${peerAlias}". Verificá que estén en la misma red Wi-Fi.`
    default:
      return `La PC "${peerAlias}" cerró la conexión. El archivo no se pudo ${verb}.`
  }
}

const LOSS_KINDS: LinkLoss[] = ['peer-offline', 'closed', 'local-offline', 'connect']

export default function HomeScreen(): React.JSX.Element {
  const t = useTheme()
  const scheme = useColorScheme()
  const [alias, setAlias] = useState('')
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [isOnWifi, setIsOnWifi] = useState(true)
  // Aviso cuando la PC vinculada desaparece estando nosotros conectados
  const [peerNotice, setPeerNotice] = useState<string | null>(null)
  const [transferModal, setTransferModal] = useState(false)
  const [transferDevice, setTransferDevice] = useState<DiscoveredDevice | null>(null)
  const [transferFile, setTransferFile] = useState<SelectedFile | null>(null)
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('connecting')
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)

  const [incomingModal, setIncomingModal] = useState(false)
  const [incomingMeta, setIncomingMeta] = useState<IncomingTransferMeta | null>(null)
  const [incomingStatus, setIncomingStatus] = useState<TransferStatus>('receiving')
  const [incomingProgress, setIncomingProgress] = useState<TransferProgress | null>(null)
  const [incomingError, setIncomingError] = useState<string | null>(null)

  const discoveryRef = useRef<DiscoveryService | null>(null)
  const receiverRef = useRef<ReceiverService | null>(null)
  const activeClientRef = useRef<TransferClient | null>(null)
  const isOnWifiRef = useRef(true)
  // Tipo de red por el que llegamos a la PC. Normalmente WIFI, pero si el
  // celular comparte su hotspot es CELLULAR: ahí "sin Wi-Fi" no es un error.
  const netTypeRef = useRef<Network.NetworkStateType | null>(null)
  const linkTypeRef = useRef<Network.NetworkStateType | null>(null)

  const isLocalLinkUp = (state: Network.NetworkState): boolean =>
    state.isConnected !== false && state.type === (linkTypeRef.current ?? Network.NetworkStateType.WIFI)

  // Si el corte parece culpa de la PC, primero confirmamos que NUESTRA red
  // siga arriba: si no, el que se quedó sin Wi-Fi es este celular.
  async function resolveLoss(kind: LinkLoss): Promise<LinkLoss> {
    if (kind === 'local-offline' || kind === 'connect') return kind
    try {
      const state = await Network.getNetworkStateAsync()
      return isLocalLinkUp(state) ? kind : 'local-offline'
    } catch {
      return kind
    }
  }

  useEffect(() => {
    let mounted = true

    async function init(): Promise<void> {
      await setupNotificationChannel()
      const a = await getOrCreateAlias()
      if (!mounted) return
      setAlias(a)

      const discovery = new DiscoveryService(a)
      discoveryRef.current = discovery

      const receiver = new ReceiverService(a)
      receiverRef.current = receiver

      // El desktop pide permiso para enviarnos un archivo sobre la conexión
      // persistente que abrimos al descubrirlo (ver receiver.ts).
      receiver.on('transferRequest', (meta: IncomingTransferMeta) => {
        if (!mounted) return
        const sizeMb = (meta.size / (1024 * 1024)).toFixed(1)
        Alert.alert(
          'Archivo entrante',
          `${meta.senderAlias} quiere enviarte "${meta.filename}" (${sizeMb} MB)`,
          [
            { text: 'Rechazar', style: 'cancel', onPress: () => receiver.decide(false) },
            { text: 'Aceptar', onPress: () => receiver.decide(true) }
          ]
        )
      })
      receiver.on('start', (meta: IncomingTransferMeta) => {
        if (!mounted) return
        setIncomingMeta(meta)
        setIncomingStatus('receiving')
        setIncomingProgress(null)
        setIncomingError(null)
        setIncomingModal(true)
      })
      receiver.on('error', async (e: IncomingTransferMeta & { reason: LinkLoss }) => {
        const kind = await resolveLoss(e.reason)
        if (!mounted) return
        setIncomingMeta(e)
        setIncomingStatus('error')
        setIncomingError(lossMessage(kind, e.senderAlias, 'receive'))
        setIncomingModal(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      })
      receiver.on('progress', (p: TransferProgress) => {
        if (!mounted) return
        setIncomingProgress(p)
      })
      receiver.on('done', async () => {
        if (!mounted) return
        setIncomingStatus('done')
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      })

      discovery.on('deviceFound', (d: DiscoveredDevice) => {
        if (!mounted) return
        setDevices((prev) => (prev.find((x) => x.ip === d.ip) ? prev : [...prev, d]))
        setPeerNotice(null)
        linkTypeRef.current = netTypeRef.current
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        if (d.deviceType === 'desktop' || d.deviceType === 'laptop') {
          receiver.connectTo(d.ip, d.port)
        }
      })
      discovery.on('deviceUpdated', (d: DiscoveredDevice) => {
        if (!mounted) return
        setDevices((prev) => prev.map((x) => (x.ip === d.ip ? d : x)))
      })
      discovery.on('deviceLost', async (ip: string, device?: DiscoveredDevice) => {
        if (!mounted) return
        setDevices((prev) => prev.filter((x) => x.ip !== ip))
        // La PC dejó de responder: cortamos lo que estuviera en curso con ella
        // ANTES de cerrar el socket (si no, se reportaría como 'closed').
        if (activeClientRef.current?.targetIp === ip) activeClientRef.current.cancel('peer-offline')
        receiver.failIfFrom(ip, 'peer-offline')
        receiver.disconnectFrom(ip)
        if ((await resolveLoss('peer-offline')) === 'peer-offline' && mounted) {
          setPeerNotice(`La PC "${device?.alias ?? ip}" se quedó sin conexión Wi-Fi.`)
        }
      })

      try {
        await discovery.start()
      } catch (err) {
        console.warn('Discovery failed:', err)
      }
    }

    init()

    // Poll network state every 3 seconds using expo-network (no native subscription needed)
    const applyNetState = (state: Network.NetworkState): void => {
      netTypeRef.current = state.type ?? null
      const up = isLocalLinkUp(state)
      const wasUp = isOnWifiRef.current
      isOnWifiRef.current = up
      setIsOnWifi(up)
      if (wasUp && !up) {
        // Este celular perdió la red: ningún dispositivo es alcanzable y
        // cualquier transferencia en curso falla ya, sin esperar al timeout.
        setDevices([])
        setPeerNotice(null)
        activeClientRef.current?.cancel('local-offline')
        receiverRef.current?.failActive('local-offline')
      }
    }
    const wifiTimer = setInterval(async () => {
      applyNetState(await Network.getNetworkStateAsync())
    }, 3000)
    Network.getNetworkStateAsync().then(applyNetState)

    return () => {
      mounted = false
      discoveryRef.current?.stop()
      receiverRef.current?.stop()
      clearInterval(wifiTimer)
    }
  }, [])

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true })
    if (!result.canceled) {
      const files: SelectedFile[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        size: a.size ?? 0,
        mimeType: a.mimeType ?? 'application/octet-stream'
      }))
      setSelectedFiles((prev) => [...prev, ...files])
    }
  }, [])

  const pickImage = useCallback(async () => {
    const granted = await requestMediaPermission()
    if (!granted) return

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 1
    })
    if (!result.canceled) {
      const files: SelectedFile[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        size: a.fileSize ?? 0,
        mimeType: a.type === 'video' ? 'video/mp4' : 'image/jpeg',
        thumbnail: a.uri
      }))
      setSelectedFiles((prev) => [...prev, ...files])
    }
  }, [])

  const sendToDevice = useCallback(
    async (device: DiscoveredDevice) => {
      if (!isOnWifiRef.current) {
        Alert.alert('Sin conexión', 'Este celular no tiene Wi-Fi. Conectate a la misma red que la PC para enviar.')
        return
      }
      if (selectedFiles.length === 0) {
        Alert.alert('Sin archivos', 'Seleccioná al menos un archivo para enviar.')
        return
      }

      // 3-tap flow: file selected → device tapped → confirm
      const filesToSend = [...selectedFiles]
      Alert.alert(
        'Enviar archivos',
        `Enviar ${filesToSend.length} archivo(s) a "${device.alias}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Enviar',
            onPress: async () => {
              for (const file of filesToSend) {
                await startTransfer(device, file)
              }
            }
          }
        ]
      )
    },
    [selectedFiles]
  )

  async function startTransfer(device: DiscoveredDevice, file: SelectedFile): Promise<void> {
    setTransferDevice(device)
    setTransferFile(file)
    setTransferStatus('connecting')
    setTransferProgress(null)
    setTransferError(null)
    setTransferModal(true)

    const client = new TransferClient()
    activeClientRef.current = client
    client.on('status', (s: TransferStatus) => setTransferStatus(s))
    client.on('progress', (p: TransferProgress) => setTransferProgress(p))

    // Mantiene la pantalla encendida y muestra notificación persistente
    // para que Android no mate el proceso si el usuario cambia de app.
    const notifId = await startForegroundTask(file.name)
    try {
      await client.send({
        deviceIp: device.ip,
        devicePort: device.port,
        senderAlias: alias,
        fileUri: file.uri,
        filename: file.name,
        size: file.size,
        mime: file.mimeType
      })
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg !== 'rejected') {
        const kind = await resolveLoss(LOSS_KINDS.includes(msg as LinkLoss) ? (msg as LinkLoss) : 'closed')
        setTransferStatus('error')
        setTransferError(lossMessage(kind, device.alias, 'send'))
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } finally {
      if (activeClientRef.current === client) activeClientRef.current = null
      await stopForegroundTask(notifId)
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <Text style={[styles.logo, { color: t.accent }]}>⇄ LocalSend</Text>
        <View style={styles.headerRight}>
          <View style={[styles.wifiDot, { backgroundColor: isOnWifi ? t.green : t.red }]} />
          <Text style={[styles.aliasText, { color: t.textMuted }]}>{alias}</Text>
        </View>
      </View>

      {!isOnWifi && (
        <View style={styles.wifiBanner}>
          <Text style={styles.wifiBannerText}>
            ⚠ Este celular no tiene Wi-Fi. Conectate para descubrir dispositivos.
          </Text>
        </View>
      )}

      {isOnWifi && peerNotice && (
        <TouchableOpacity style={styles.wifiBanner} onPress={() => setPeerNotice(null)}>
          <Text style={styles.wifiBannerText}>⚠ {peerNotice} (tocá para cerrar)</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <RadarView devices={devices} onDevicePress={sendToDevice} />

        {/* File picker section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Archivos seleccionados</Text>
          <View style={styles.pickerRow}>
            <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: t.surface, borderColor: t.border }]} onPress={pickImage}>
              <Text style={[styles.pickerBtnText, { color: t.text }]}>🖼 Galería</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: t.surface, borderColor: t.border }]} onPress={pickDocument}>
              <Text style={[styles.pickerBtnText, { color: t.text }]}>📁 Archivos</Text>
            </TouchableOpacity>
          </View>
          {selectedFiles.length === 0 ? (
            <Text style={[styles.noFiles, { color: t.textMuted }]}>Ningún archivo seleccionado</Text>
          ) : (
            selectedFiles.map((f, i) => (
              <FileCard
                key={`${f.uri}-${i}`}
                file={f}
                onRemove={() => setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))
          )}
        </View>

        {/* Devices list (below radar for quick access) */}
        {devices.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Dispositivos ({devices.length})</Text>
            {devices.map((d) => (
              <TouchableOpacity
                key={d.ip}
                style={[styles.deviceRow, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => sendToDevice(d)}
                activeOpacity={0.7}
              >
                <Text style={styles.deviceIcon}>
                  {d.deviceType === 'desktop' ? '🖥' : d.deviceType === 'mobile' ? '📱' : '💻'}
                </Text>
                <View style={styles.deviceInfo}>
                  <Text style={[styles.deviceName, { color: t.text }]}>{d.alias}</Text>
                  <Text style={[styles.deviceIp, { color: t.textMuted }]}>{d.ip}</Text>
                </View>
                <Text style={[styles.chevron, { color: t.accent }]}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {transferModal && transferDevice && transferFile && (
        <TransferProgressModal
          visible={transferModal}
          deviceAlias={transferDevice.alias}
          filename={transferFile.name}
          thumbnail={transferFile.thumbnail}
          status={transferStatus}
          progress={transferProgress}
          errorMessage={transferError}
          onClose={() => setTransferModal(false)}
          onRetry={() => {
            setTransferModal(false)
            setTimeout(() => startTransfer(transferDevice, transferFile), 300)
          }}
        />
      )}

      {incomingModal && incomingMeta && (
        <TransferProgressModal
          visible={incomingModal}
          direction="receive"
          deviceAlias={incomingMeta.senderAlias}
          filename={incomingMeta.filename}
          status={incomingStatus}
          progress={incomingProgress}
          errorMessage={incomingError}
          onClose={() => setIncomingModal(false)}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  logo: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6366f1'
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  wifiDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  aliasText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500'
  },
  wifiBanner: {
    backgroundColor: '#7c2d12',
    padding: 10,
    paddingHorizontal: 16
  },
  wifiBannerText: {
    color: '#fca5a5',
    fontSize: 12
  },
  scroll: {
    flex: 1
  },
  section: {
    padding: 16
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  pickerBtnText: {
    color: '#f1f5f9',
    fontWeight: '600',
    fontSize: 14
  },
  noFiles: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  deviceIcon: { fontSize: 22 },
  deviceInfo: {
    flex: 1,
    marginLeft: 10
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9'
  },
  deviceIp: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: 1
  },
  chevron: {
    fontSize: 22,
    color: '#6366f1'
  }
})
