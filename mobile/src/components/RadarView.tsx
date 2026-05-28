import React, { useEffect, useRef } from 'react'
import {
  View,
  Text,
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  Dimensions
} from 'react-native'
import type { DiscoveredDevice } from '../services/discovery'

const { width } = Dimensions.get('window')
const RADAR_SIZE = Math.min(width - 48, 280)

interface Props {
  devices: DiscoveredDevice[]
  onDevicePress: (device: DiscoveredDevice) => void
}

export default function RadarView({ devices, onDevicePress }: Props): React.JSX.Element {
  const rotation = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 2500,
        easing: Easing.linear,
        useNativeDriver: true
      })
    ).start()

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true })
      ])
    ).start()
  }, [])

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const devicePositions = placeDevicesOnCircle(devices.length)

  const DEVICE_ICONS: Record<DiscoveredDevice['deviceType'], string> = {
    desktop: '🖥',
    laptop: '💻',
    mobile: '📱',
    tablet: '📟'
  }

  return (
    <View style={styles.container}>
      {/* Radar rings */}
      <Animated.View style={[styles.radar, { transform: [{ scale: pulse }] }]}>
        <View style={[styles.ring, { width: RADAR_SIZE, height: RADAR_SIZE, borderRadius: RADAR_SIZE / 2 }]} />
        <View style={[styles.ring, { width: RADAR_SIZE * 0.66, height: RADAR_SIZE * 0.66, borderRadius: RADAR_SIZE * 0.33 }]} />
        <View style={[styles.ring, { width: RADAR_SIZE * 0.33, height: RADAR_SIZE * 0.33, borderRadius: RADAR_SIZE * 0.165 }]} />

        {/* Sweep */}
        <Animated.View style={[styles.sweep, { transform: [{ rotate: spin }] }]} />

        {/* Center dot */}
        <View style={styles.center}>
          <Text style={{ fontSize: 18 }}>📱</Text>
        </View>

        {/* Devices on radar */}
        {devices.map((device, idx) => {
          const pos = devicePositions[idx]
          const radius = RADAR_SIZE / 2 - 24
          const x = Math.cos(pos) * radius * 0.7
          const y = Math.sin(pos) * radius * 0.7
          return (
            <TouchableOpacity
              key={device.ip}
              style={[styles.deviceDot, { transform: [{ translateX: x }, { translateY: y }] }]}
              onPress={() => onDevicePress(device)}
              activeOpacity={0.7}
            >
              <View style={styles.deviceBubble}>
                <Text style={{ fontSize: 16 }}>{DEVICE_ICONS[device.deviceType] ?? '📡'}</Text>
              </View>
              <Text style={styles.deviceLabel} numberOfLines={1}>{device.alias}</Text>
            </TouchableOpacity>
          )
        })}
      </Animated.View>

      {devices.length === 0 && (
        <Text style={styles.noDevices}>Buscando dispositivos...</Text>
      )}
    </View>
  )
}

function placeDevicesOnCircle(count: number): number[] {
  if (count === 0) return []
  return Array.from({ length: count }, (_, i) => (i * 2 * Math.PI) / count - Math.PI / 2)
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 20
  },
  radar: {
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)'
  },
  sweep: {
    position: 'absolute',
    width: RADAR_SIZE / 2,
    height: 2,
    left: RADAR_SIZE / 2,
    backgroundColor: 'transparent',
    borderTopWidth: 2,
    borderTopColor: 'rgba(99,102,241,0.7)',
    transformOrigin: 'left center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.8
  },
  center: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2
  },
  deviceDot: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 3
  },
  deviceBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    shadowOpacity: 0.6,
    elevation: 4
  },
  deviceLabel: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
    maxWidth: 70,
    textAlign: 'center'
  },
  noDevices: {
    marginTop: 16,
    color: '#94a3b8',
    fontSize: 14
  }
})
