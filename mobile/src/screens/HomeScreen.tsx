import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  Alert
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import * as Network from 'expo-network'
import { DiscoveryService, type DiscoveredDevice } from '../services/discovery'
import { TransferClient, type TransferProgress, type TransferStatus } from '../services/transfer'
import { getOrCreateAlias } from '../services/deviceAlias'
import { requestMediaPermission } from '../services/permissions'
import type { SelectedFile } from '../components/FileCard'
import FileCard from '../components/FileCard'
import RadarView from '../components/RadarView'
import TransferProgressModal from '../components/TransferProgressModal'

export default function HomeScreen(): JSX.Element {
  const [alias, setAlias] = useState('')
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [isOnWifi, setIsOnWifi] = useState(true)
  const [transferModal, setTransferModal] = useState(false)
  const [transferDevice, setTransferDevice] = useState<DiscoveredDevice | null>(null)
  const [transferFile, setTransferFile] = useState<SelectedFile | null>(null)
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('connecting')
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null)

  const discoveryRef = useRef<DiscoveryService | null>(null)

  useEffect(() => {
    let mounted = true

    async function init(): Promise<void> {
      const a = await getOrCreateAlias()
      if (!mounted) return
      setAlias(a)

      const discovery = new DiscoveryService(a)
      discoveryRef.current = discovery

      discovery.on('deviceFound', (d: DiscoveredDevice) => {
        if (!mounted) return
        setDevices((prev) => (prev.find((x) => x.ip === d.ip) ? prev : [...prev, d]))
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      })
      discovery.on('deviceUpdated', (d: DiscoveredDevice) => {
        if (!mounted) return
        setDevices((prev) => prev.map((x) => (x.ip === d.ip ? d : x)))
      })
      discovery.on('deviceLost', (ip: string) => {
        if (!mounted) return
        setDevices((prev) => prev.filter((x) => x.ip !== ip))
      })

      try {
        await discovery.start()
      } catch (err) {
        console.warn('Discovery failed:', err)
      }
    }

    init()

    // Poll Wi-Fi state every 3 seconds using expo-network (no native subscription needed)
    const wifiTimer = setInterval(async () => {
      const type = await Network.getNetworkStateAsync()
      setIsOnWifi(type.type === Network.NetworkStateType.WIFI)
    }, 3000)
    Network.getNetworkStateAsync().then((s) => {
      setIsOnWifi(s.type === Network.NetworkStateType.WIFI)
    })

    return () => {
      mounted = false
      discoveryRef.current?.stop()
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
      if (selectedFiles.length === 0) {
        Alert.alert('Sin archivos', 'Seleccioná al menos un archivo para enviar.')
        return
      }

      // 3-tap flow: file selected → device tapped → confirm
      Alert.alert(
        'Enviar archivos',
        `Enviar ${selectedFiles.length} archivo(s) a "${device.alias}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Enviar',
            onPress: () => startTransfer(device, selectedFiles[0])
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
    setTransferModal(true)

    const client = new TransferClient()
    client.on('status', (s: TransferStatus) => setTransferStatus(s))
    client.on('progress', (p: TransferProgress) => setTransferProgress(p))

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
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <View style={styles.header}>
        <Text style={styles.logo}>⇄ LocalSend</Text>
        <View style={styles.headerRight}>
          <View style={[styles.wifiDot, { backgroundColor: isOnWifi ? '#22c55e' : '#ef4444' }]} />
          <Text style={styles.aliasText}>{alias}</Text>
        </View>
      </View>

      {!isOnWifi && (
        <View style={styles.wifiBanner}>
          <Text style={styles.wifiBannerText}>
            ⚠ No estás conectado a Wi-Fi. Conectate para descubrir dispositivos.
          </Text>
        </View>
      )}

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <RadarView devices={devices} onDevicePress={sendToDevice} />

        {/* File picker section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Archivos seleccionados</Text>
          <View style={styles.pickerRow}>
            <TouchableOpacity style={styles.pickerBtn} onPress={pickImage}>
              <Text style={styles.pickerBtnText}>🖼 Galería</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerBtn} onPress={pickDocument}>
              <Text style={styles.pickerBtnText}>📁 Archivos</Text>
            </TouchableOpacity>
          </View>
          {selectedFiles.length === 0 ? (
            <Text style={styles.noFiles}>Ningún archivo seleccionado</Text>
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
            <Text style={styles.sectionTitle}>Dispositivos ({devices.length})</Text>
            {devices.map((d) => (
              <TouchableOpacity
                key={d.ip}
                style={styles.deviceRow}
                onPress={() => sendToDevice(d)}
                activeOpacity={0.7}
              >
                <Text style={styles.deviceIcon}>
                  {d.deviceType === 'desktop' ? '🖥' : d.deviceType === 'mobile' ? '📱' : '💻'}
                </Text>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName}>{d.alias}</Text>
                  <Text style={styles.deviceIp}>{d.ip}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
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
          status={transferStatus}
          progress={transferProgress}
          onClose={() => setTransferModal(false)}
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
