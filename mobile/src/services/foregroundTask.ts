import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const KEEP_AWAKE_TAG = 'localsend-transfer'
const CHANNEL_ID = 'localsend-transfer'

// Llamar una vez al iniciar la app (solo Android necesita el canal)
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Transferencia de archivos',
    importance: Notifications.AndroidImportance.LOW,
    sound: false,
    vibrationPattern: [0],
    showBadge: false,
  })
}

// Inicia keep-awake + muestra notificación persistente.
// Devuelve el ID de la notificación para poder descartarla al terminar.
export async function startForegroundTask(filename: string): Promise<string | null> {
  await activateKeepAwakeAsync(KEEP_AWAKE_TAG)

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
  if (notifId) {
    await Notifications.dismissNotificationAsync(notifId)
  }
}
