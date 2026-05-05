import React from 'react'
import type { ActiveTransfer } from '../App'

interface Props {
  transfers: ActiveTransfer[]
  onOpenPath: (p: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`
}

function formatEta(progress: ActiveTransfer['progress']): string {
  if (!progress || progress.speedBps === 0) return '—'
  const remaining = progress.totalBytes - progress.bytesReceived
  const secs = remaining / progress.speedBps
  if (secs < 60) return `${Math.round(secs)}s`
  return `${Math.round(secs / 60)}m ${Math.round(secs % 60)}s`
}

export default function TransferMonitor({ transfers, onOpenPath }: Props): JSX.Element {
  if (transfers.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
        <p style={{ fontWeight: 600 }}>Sin transferencias activas</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
          Los archivos recibidos aparecerán aquí
        </p>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>
        Transferencias
        <span style={styles.badge}>{transfers.length}</span>
      </h2>
      <div style={styles.list}>
        {transfers.map((t) => {
          const pct = t.progress
            ? Math.round((t.progress.bytesReceived / t.progress.totalBytes) * 100)
            : t.status === 'done' ? 100 : 0

          return (
            <div key={t.meta.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.filename}>{t.meta.filename}</span>
                <StatusBadge status={t.status} />
              </div>
              <div style={styles.meta}>
                <span style={styles.metaItem}>De: {t.meta.senderAlias}</span>
                <span style={styles.metaItem}>{formatBytes(t.meta.size)}</span>
              </div>
              <div style={styles.barBg}>
                <div
                  style={{
                    ...styles.barFill,
                    width: `${pct}%`,
                    background: t.status === 'error' ? 'var(--red)'
                      : t.status === 'done' ? 'var(--green)'
                      : 'var(--accent)'
                  }}
                />
              </div>
              <div style={styles.stats}>
                <span>{pct}%</span>
                {t.progress && t.status === 'receiving' && (
                  <>
                    <span>{formatSpeed(t.progress.speedBps)}</span>
                    <span>ETA: {formatEta(t.progress)}</span>
                  </>
                )}
                {t.status === 'done' && t.savedPath && (
                  <button style={styles.openBtn} onClick={() => onOpenPath(t.savedPath!)}>
                    Abrir carpeta
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ActiveTransfer['status'] }): JSX.Element {
  const map = {
    receiving: { color: 'var(--accent)', label: 'Recibiendo' },
    done: { color: 'var(--green)', label: 'Completo' },
    error: { color: 'var(--red)', label: 'Error' }
  }
  const { color, label } = map[status]
  return (
    <span style={{ ...styles.statusBadge, background: color }}>{label}</span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--text)',
    padding: 32
  },
  container: {
    padding: 20,
    height: '100%',
    display: 'flex',
    flexDirection: 'column'
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  badge: {
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 99,
    padding: '1px 7px',
    fontSize: 11,
    fontWeight: 700
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflow: 'auto',
    flex: 1
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    boxShadow: 'var(--shadow)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  filename: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    borderRadius: 99,
    padding: '2px 8px',
    flexShrink: 0
  },
  meta: {
    display: 'flex',
    gap: 12
  },
  metaItem: {
    fontSize: 12,
    color: 'var(--text-muted)'
  },
  barBg: {
    height: 8,
    background: 'var(--surface2)',
    borderRadius: 99,
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
    transition: 'width 0.3s ease'
  },
  stats: {
    display: 'flex',
    gap: 16,
    fontSize: 12,
    color: 'var(--text-muted)',
    alignItems: 'center'
  },
  openBtn: {
    marginLeft: 'auto',
    background: 'var(--surface2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 12
  }
}
