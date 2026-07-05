import Constants, { ExecutionEnvironment } from 'expo-constants'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { Platform } from 'react-native'

const KEEP_AWAKE_TAG = 'localsend-transfer'
const CHANNEL_ID = 'localsend-transfer'

// expo-notifications rompe al importarse en Android dentro de Expo Go (SDK 53+):
// registra un listener de push tokens como efecto secundario que siempre lanza
// en ese entorno. Cargarlo solo fuera de Expo Go evita el crash al probar la app.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
const Notifications = isExpoGo
  ? null
  : (require('expo-notifications') as typeof import('expo-notifications'))

// Llamar una vez al iniciar la app (solo Android necesita el canal)
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Transferencia de archivos',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: [0],
    showBadge: false,
  })
}

// Inicia keep-awake + muestra notificación persistente.
// Devuelve el ID de la notificación para poder descartarla al terminar.
export async function startForegroundTask(filename: string): Promise<string | null> {
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG)

  if (!Notifications) return null

  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return null

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '⇄ LocalSend — Enviando',
      body: filename,
      data: { type: 'transfer' },
      sticky: true,
    },
    trigger: null,
  })
  return id
}

// Detiene keep-awake y descarta la notificación.
export async function stopForegroundTask(notifId: string | null): Promise<void> {
  deactivateKeepAwake(KEEP_AWAKE_TAG)
  if (notifId && Notifications) {
    await Notifications.dismissNotificationAsync(notifId)
  }
}
