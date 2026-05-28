import React, { useEffect, useRef } from 'react'
import { View, Text, Modal, StyleSheet, Animated, TouchableOpacity } from 'react-native'
import type { TransferProgress, TransferStatus } from '../services/transfer'

interface Props {
  visible: boolean
  deviceAlias: string
  filename: string
  status: TransferStatus
  progress: TransferProgress | null
  onClose: () => void
  onRetry?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`
}

function formatEta(p: TransferProgress): string {
  if (p.speedBps === 0) return '—'
  const secs = (p.totalBytes - p.bytesSent) / p.speedBps
  if (secs < 60) return `${Math.round(secs)}s`
  return `${Math.round(secs / 60)}m`
}

const STATUS_LABELS: Record<TransferStatus, string> = {
  connecting: 'Conectando...',
  waiting: 'Esperando aprobación...',
  rejected: 'Transferencia rechazada',
  sending: 'Enviando...',
  done: 'Completado',
  error: 'Error de conexión'
}

export default function TransferProgressModal({
  visible, deviceAlias, filename, status, progress, onClose, onRetry
}: Props): React.JSX.Element {
  const barWidth = useRef(new Animated.Value(0)).current

  const pct = progress
    ? progress.bytesSent / progress.totalBytes
    : status === 'done' ? 1 : 0

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: pct,
      duration: 300,
      useNativeDriver: false
    }).start()
  }, [pct])

  const canClose = status === 'done' || status === 'rejected' || status === 'error'

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{STATUS_LABELS[status]}</Text>
          <Text style={styles.device}>→ {deviceAlias}</Text>
          <Text style={styles.filename} numberOfLines={1}>{filename}</Text>

          <View style={styles.barBg}>
            <Animated.View style={[
              styles.barFill,
              {
                width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: status === 'error' ? '#ef4444'
                  : status === 'rejected' ? '#f59e0b'
                  : status === 'done' ? '#22c55e'
                  : '#6366f1'
              }
            ]} />
          </View>

          <View style={styles.stats}>
            <Text style={styles.pct}>{Math.round(pct * 100)}%</Text>
            {progress && status === 'sending' && (
              <>
                <Text style={styles.stat}>{formatSpeed(progress.speedBps)}</Text>
                <Text style={styles.stat}>ETA {formatEta(progress)}</Text>
              </>
            )}
          </View>

          {canClose && (
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              {status === 'error' && onRetry && (
                <TouchableOpacity style={[styles.closeBtn, { flex: 1, backgroundColor: '#334155' }]} onPress={onRetry}>
                  <Text style={styles.closeBtnText}>↺ Reintentar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.closeBtn, { flex: 1 }]} onPress={onClose}>
                <Text style={styles.closeBtnText}>{status === 'error' ? 'Cancelar' : 'Cerrar'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)'
  },
  sheet: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 28,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: '#334155'
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 4
  },
  device: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 8
  },
  filename: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 16
  },
  barBg: {
    height: 10,
    backgroundColor: '#334155',
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 10
  },
  barFill: {
    height: '100%',
    borderRadius: 99
  },
  stats: {
    flexDirection: 'row',
    gap: 16
  },
  pct: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f1f5f9'
  },
  stat: {
    fontSize: 13,
    color: '#94a3b8'
  },
  closeBtn: {
    marginTop: 24,
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center'
  },
  closeBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16
  }
})
