import { Platform, Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

export async function requestMediaPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(
        'Permiso denegado',
        'LocalSend necesita acceso a tu galería para enviar imágenes. Habilitalo en Ajustes.',
        [{ text: 'Entendido' }]
      )
      return false
    }
    return true
  }
  if (Platform.OS === 'ios') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    return status === 'granted'
  }
  return true
}

export async function requestCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync()
  return status === 'granted'
}
