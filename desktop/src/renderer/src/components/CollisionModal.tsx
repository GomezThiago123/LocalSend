import React from 'react'

interface Props {
  filename: string
  onReplace: () => void
  onRename: () => void
  onSkip: () => void
}

export default function CollisionModal({ filename, onReplace, onRename, onSkip }: Props): JSX.Element {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.icon}>⚠️</div>
        <h2 style={styles.heading}>Archivo duplicado</h2>
        <p style={styles.sub}>Ya existe un archivo con ese nombre en la carpeta de descargas:</p>
        <div style={styles.filename}>{filename}</div>
        <p style={styles.question}>¿Qué querés hacer?</p>
        <div style={styles.actions}>
          <button style={styles.skipBtn} onClick={onSkip}>
            Omitir
          </button>
          <button style={styles.renameBtn} onClick={onRename}>
            Mantener ambos
          </button>
          <button style={styles.replaceBtn} onClick={onReplace}>
            Reemplazar
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
    zIndex: 200
  },
  modal: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 32,
    width: 380,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
  },
  icon: { fontSize: 40 },
  heading: { fontSize: 18, fontWeight: 700 },
  sub: { fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' },
  filename: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    width: '100%',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  question: { fontSize: 13, color: 'var(--text-muted)' },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
    width: '100%'
  },
  skipBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    background: 'var(--surface2)',
    color: 'var(--text-muted)',
    fontWeight: 600,
    fontSize: 13,
    border: '1px solid var(--border)'
  },
  renameBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    background: 'var(--surface2)',
    color: 'var(--text)',
    fontWeight: 600,
    fontSize: 13,
    border: '1px solid var(--accent)'
  },
  replaceBtn: {
    flex: 1,
    padding: '10px 0',
    borderRadius: 10,
    background: 'var(--red)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 13
  }
}
