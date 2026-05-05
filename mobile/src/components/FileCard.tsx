import React from 'react'
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native'

export interface SelectedFile {
  uri: string
  name: string
  size: number
  mimeType: string
  thumbnail?: string
}

interface Props {
  file: SelectedFile
  onRemove: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function FileCard({ file, onRemove }: Props): JSX.Element {
  const isImage = file.mimeType.startsWith('image/')

  return (
    <View style={styles.card}>
      {isImage && file.thumbnail ? (
        <Image source={{ uri: file.thumbnail }} style={styles.thumb} />
      ) : (
        <View style={styles.iconBox}>
          <Text style={styles.icon}>{getFileIcon(file.mimeType)}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{file.name}</Text>
        <Text style={styles.size}>{formatBytes(file.size)}</Text>
      </View>
      <TouchableOpacity onPress={onRemove} style={styles.remove}>
        <Text style={styles.removeText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('rar')) return '🗜'
  return '📁'
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center'
  },
  icon: { fontSize: 24 },
  info: {
    flex: 1,
    marginLeft: 10
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f1f5f9'
  },
  size: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2
  },
  remove: {
    padding: 8
  },
  removeText: {
    color: '#94a3b8',
    fontSize: 14
  }
})
