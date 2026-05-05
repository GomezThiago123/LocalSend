import React from 'react'
import type { TransferMetadata } from '../../../main/wsServer'

interface Props {
  meta: TransferMetadata
  onAccept: () => void
  onReject: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function TransferRequestModal({ meta, onAccept, onReject }: Props): JSX.Element {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.icon}>📥</div>
        <h2 style={styles.heading}>Transferencia entrante</h2>
        <p style={styles.sender}>
          <strong>{meta.senderAlias}</strong> ({meta.senderIp})
        </p>
        <div style={styles.fileInfo}>
          <span style={styles.filename}>{meta.filename}</span>
          <span style={styles.size}>{formatBytes(meta.size)}</span>
        </div>
        <div style={styles.actions}>
          <button style={styles.rejectBtn} onClick={onReject}>
            ✕ Rechazar
          </button>
          <button style={styles.acceptBtn} onClick={onAccept}>
            ✓ Aceptar
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    animation: 'fadeIn 0.15s ease'
  },
  modal: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 32,
    width: 360,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
  },
  icon: { fontSize: 48 },
  heading: { fontSize: 18, fontWeight: 700 },
  sender: { color: 'var(--text-muted)', fontSize: 13 },
  fileInfo: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '10px 16px',
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  filename: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1
  },
  size: {
    color: 'var(--text-muted)',
    fontSize: 12,
    flexShrink: 0
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 8,
    width: '100%'
  },
  rejectBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    background: 'var(--surface2)',
    color: 'var(--red)',
    fontWeight: 700,
    fontSize: 14,
    border: '1px solid var(--border)'
  },
  acceptBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    background: 'var(--accent)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 14
  }
}
