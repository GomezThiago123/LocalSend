import React, { useState } from 'react'

interface Props {
  alias: string
  localIp: string
  serverActive: boolean
  downloadDir: string
  onAliasChange: (alias: string) => void
  onPickDownloadDir: () => void
  onOpenDownloadDir: () => void
}

export default function Header({
  alias,
  localIp,
  serverActive,
  downloadDir,
  onAliasChange,
  onPickDownloadDir,
  onOpenDownloadDir
}: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(alias)

  function commitAlias(): void {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== alias) onAliasChange(trimmed)
    setEditing(false)
  }

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        <span style={styles.logo}>⇄ LocalSend</span>
        {editing ? (
          <input
            style={styles.aliasInput}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitAlias}
            onKeyDown={(e) => e.key === 'Enter' && commitAlias()}
          />
        ) : (
          <button style={styles.aliasBtn} onClick={() => { setDraft(alias); setEditing(true) }}>
            {alias} ✎
          </button>
        )}
        <span style={styles.ip}>{localIp}</span>
      </div>
      <div style={styles.right}>
        <span style={{ ...styles.led, background: serverActive ? 'var(--green)' : 'var(--red)' }} />
        <span style={styles.ledLabel}>{serverActive ? 'Activo' : 'Inactivo'}</span>
        <button
          style={styles.dirBtn}
          onClick={onOpenDownloadDir}
          onContextMenu={(e) => { e.preventDefault(); onPickDownloadDir() }}
          title={`${downloadDir}\n(click derecho para cambiar)`}
        >
          📁 Descargas
        </button>
      </div>
    </header>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    WebkitAppRegion: 'drag' as any,
    flexShrink: 0
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    WebkitAppRegion: 'no-drag' as any
  },
  logo: {
    fontWeight: 700,
    fontSize: 16,
    color: 'var(--accent)',
    letterSpacing: '-0.5px'
  },
  aliasBtn: {
    background: 'var(--surface2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 13,
    WebkitAppRegion: 'no-drag' as any
  },
  aliasInput: {
    background: 'var(--surface2)',
    color: 'var(--text)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 13,
    WebkitAppRegion: 'no-drag' as any
  },
  ip: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontFamily: 'monospace'
  },
  led: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
    boxShadow: '0 0 6px currentColor'
  },
  ledLabel: {
    fontSize: 12,
    color: 'var(--text-muted)'
  },
  dirBtn: {
    background: 'var(--surface2)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 12,
    maxWidth: 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
}
