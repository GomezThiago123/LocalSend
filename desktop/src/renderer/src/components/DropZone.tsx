import React, { useState, useCallback } from 'react'

interface Props {
  files: string[]
  onFilesChange: (files: string[]) => void
}

export default function DropZone({ files, onFilesChange }: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)

  const api = (window as any).electronAPI

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const onDragLeave = useCallback(() => setDragging(false), [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths: string[] = []
    for (const item of Array.from(e.dataTransfer.files)) {
      paths.push((item as any).path)
    }
    if (paths.length) onFilesChange([...files, ...paths])
  }, [files, onFilesChange])

  const pickFiles = useCallback(async () => {
    const picked: string[] = await api.pickFiles()
    if (picked.length) onFilesChange([...files, ...picked])
  }, [api, files, onFilesChange])

  const removeFile = useCallback((idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx))
  }, [files, onFilesChange])

  return (
    <section style={{ ...styles.zone, ...(dragging ? styles.zoneDrag : {}) }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {files.length === 0 ? (
        <button style={styles.placeholder} onClick={pickFiles}>
          <span style={styles.uploadIcon}>⬆</span>
          <span style={{ fontWeight: 600 }}>Arrastrá archivos aquí</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>o hacé click para seleccionar</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
            Luego tocá un dispositivo para enviar
          </span>
        </button>
      ) : (
        <div style={styles.fileList}>
          <div style={styles.fileListHeader}>
            <span style={styles.fileListTitle}>Archivos a enviar ({files.length})</span>
            <button style={styles.addMore} onClick={pickFiles}>+ Agregar</button>
          </div>
          <ul style={styles.list}>
            {files.map((f, i) => (
              <li key={`${f}-${i}`} style={styles.fileItem}>
                <span style={styles.fileName}>{f.split(/[\\/]/).pop()}</span>
                <button style={styles.removeBtn} onClick={() => removeFile(i)}>✕</button>
              </li>
            ))}
          </ul>
          <p style={styles.hint}>Tocá un dispositivo arriba para enviar</p>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  zone: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    transition: 'background 0.2s, border-color 0.2s',
    borderTop: '1px solid var(--border)',
    overflow: 'hidden'
  },
  zoneDrag: {
    background: 'rgba(99,102,241,0.1)',
    outline: '2px dashed var(--accent)'
  },
  placeholder: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'transparent',
    color: 'var(--text)',
    width: '100%',
    height: '100%',
    cursor: 'pointer',
    padding: 24
  },
  uploadIcon: {
    fontSize: 36,
    marginBottom: 4
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
  },
  fileListHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)'
  },
  fileListTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  addMore: {
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    fontWeight: 600
  },
  list: {
    listStyle: 'none',
    overflow: 'auto',
    flex: 1,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--surface2)',
    borderRadius: 8,
    padding: '6px 10px',
    gap: 8
  },
  fileName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13
  },
  removeBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: 13,
    flexShrink: 0
  },
  hint: {
    fontSize: 11,
    color: 'var(--accent)',
    textAlign: 'center',
    padding: '8px 16px',
    borderTop: '1px solid var(--border)'
  }
}
