import React from 'react'
import type { DiscoveredDevice } from '../../../main/udpServer'

interface Props {
  devices: DiscoveredDevice[]
  hasPendingFiles?: boolean
  onDeviceClick?: (device: DiscoveredDevice) => void
}

const DEVICE_ICONS: Record<DiscoveredDevice['deviceType'], string> = {
  desktop: '🖥',
  laptop: '💻',
  mobile: '📱',
  tablet: '📟'
}

export default function DeviceList({ devices, hasPendingFiles = false, onDeviceClick }: Props): JSX.Element {
  return (
    <section style={styles.section}>
      <h2 style={styles.title}>
        Dispositivos en red
        <span style={styles.count}>{devices.length}</span>
      </h2>
      {devices.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>📡</div>
          <p>Buscando dispositivos...</p>
          <p style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
            Asegurate de estar en la misma red Wi-Fi
          </p>
        </div>
      ) : (
        <>
          {hasPendingFiles && (
            <p style={styles.sendHint}>Tocá un dispositivo para enviar ↓</p>
          )}
          <ul style={styles.list}>
            {devices.map((d) => (
              <li
                key={d.ip}
                style={{
                  ...styles.item,
                  ...(onDeviceClick && hasPendingFiles ? styles.itemClickable : {})
                }}
                onClick={() => onDeviceClick?.(d)}
              >
                <span style={styles.icon}>{DEVICE_ICONS[d.deviceType] ?? '📡'}</span>
                <div style={styles.info}>
                  <span style={styles.name}>{d.alias}</span>
                  <span style={styles.ip}>{d.ip}:{d.port}</span>
                </div>
                <span style={styles.dot} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: 16,
    borderBottom: '1px solid var(--border)'
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  count: {
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 99,
    padding: '1px 7px',
    fontSize: 11,
    fontWeight: 700
  },
  empty: {
    textAlign: 'center',
    color: 'var(--text-muted)',
    padding: '20px 0',
    fontSize: 13
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
    animation: 'pulse 2s infinite'
  },
  sendHint: {
    fontSize: 11,
    color: 'var(--accent)',
    fontWeight: 600,
    marginBottom: 8,
    textAlign: 'center'
  },
  list: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'var(--surface2)',
    cursor: 'default',
    transition: 'background 0.15s, outline 0.15s'
  },
  itemClickable: {
    cursor: 'pointer',
    outline: '2px solid var(--accent)',
    outlineOffset: -2
  },
  icon: { fontSize: 20 },
  info: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  name: {
    fontWeight: 600,
    fontSize: 13
  },
  ip: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontFamily: 'monospace'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--green)',
    boxShadow: '0 0 4px var(--green)'
  }
}
