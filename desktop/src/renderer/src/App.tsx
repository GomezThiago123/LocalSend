import React, { useEffect, useState, useCallback } from 'react'
import type { DiscoveredDevice } from '../../main/udpServer'
import type { TransferMetadata, TransferProgress } from '../../main/wsServer'
import DeviceList from './components/DeviceList'
import DropZone from './components/DropZone'
import TransferMonitor from './components/TransferMonitor'
import TransferRequestModal from './components/TransferRequestModal'
import CollisionModal from './components/CollisionModal'
import Header from './components/Header'

export interface ActiveTransfer {
  meta: TransferMetadata
  progress: TransferProgress | null
  status: 'receiving' | 'done' | 'error'
  savedPath?: string
  errorReason?: string
}

export interface OutgoingTransfer {
  id: string
  filename: string
  size: number
  targetAlias: string
  targetIp: string
  bytesSent: number
  speedBps: number
  status: 'waiting' | 'sending' | 'done' | 'rejected' | 'error'
  errorReason?: string
}

export default function App(): JSX.Element {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const [transfers, setTransfers] = useState<Map<string, ActiveTransfer>>(new Map())
  const [outgoing, setOutgoing] = useState<Map<string, OutgoingTransfer>>(new Map())
  const [pendingRequest, setPendingRequest] = useState<TransferMetadata | null>(null)
  const [pendingCollision, setPendingCollision] = useState<{ id: string; filename: string } | null>(null)
  const [config, setConfig] = useState({ alias: '', downloadDir: '', localIp: '' })
  const [serverActive, setServerActive] = useState(false)
  const [filesToSend, setFilesToSend] = useState<string[]>([])

  const api = (window as any).electronAPI

  useEffect(() => {
    api.getConfig().then((c: typeof config) => {
      setConfig(c)
      setServerActive(true)
    })

    api.listDevices().then((list: DiscoveredDevice[]) => {
      setDevices(list)
    })

    api.onDeviceFound((d: DiscoveredDevice) => {
      setDevices((prev) => {
        if (prev.find((x) => x.ip === d.ip)) return prev
        return [...prev, d]
      })
    })
    api.onDeviceUpdated((d: DiscoveredDevice) => {
      setDevices((prev) => prev.map((x) => (x.ip === d.ip ? d : x)))
    })
    api.onDeviceLost((ip: string) => {
      setDevices((prev) => prev.filter((x) => x.ip !== ip))
    })

    // Incoming transfers
    api.onTransferRequest((meta: TransferMetadata) => {
      setPendingRequest(meta)
    })
    api.onTransferCollision((d: { id: string; filename: string }) => {
      setPendingCollision(d)
    })
    api.onTransferDecision((d: { id: string; accepted: boolean }) => {
      if (pendingRequest?.id === d.id) setPendingRequest(null)
    })
    api.onTransferStart((meta: TransferMetadata) => {
      setTransfers((prev) => {
        const next = new Map(prev)
        next.set(meta.id, { meta, progress: null, status: 'receiving' })
        return next
      })
    })
    api.onTransferProgress((p: TransferProgress) => {
      setTransfers((prev) => {
        const next = new Map(prev)
        const t = next.get(p.id)
        if (t) next.set(p.id, { ...t, progress: p })
        return next
      })
    })
    api.onTransferDone((meta: TransferMetadata & { savedPath?: string }) => {
      setTransfers((prev) => {
        const next = new Map(prev)
        const t = next.get(meta.id)
        if (t) next.set(meta.id, { ...t, status: 'done', savedPath: meta.savedPath })
        return next
      })
      setPendingRequest((prev) => (prev?.id === meta.id ? null : prev))
    })
    api.onTransferError((payload: { id: string; reason: string }) => {
      setTransfers((prev) => {
        const next = new Map(prev)
        const t = next.get(payload.id)
        if (t) next.set(payload.id, { ...t, status: 'error', errorReason: payload.reason })
        return next
      })
    })

    // Outgoing transfers (desktop → device)
    api.onSendStart((t: OutgoingTransfer) => {
      setOutgoing((prev) => {
        const next = new Map(prev)
        next.set(t.id, t)
        return next
      })
    })
    api.onSendProgress((p: { id: string; bytesSent: number; totalBytes: number; speedBps: number }) => {
      setOutgoing((prev) => {
        const next = new Map(prev)
        const t = next.get(p.id)
        if (t) next.set(p.id, { ...t, bytesSent: p.bytesSent, size: p.totalBytes, speedBps: p.speedBps, status: 'sending' })
        return next
      })
    })
    api.onSendStatus((d: { id: string; status: OutgoingTransfer['status'] }) => {
      setOutgoing((prev) => {
        const next = new Map(prev)
        const t = next.get(d.id)
        if (t) next.set(d.id, { ...t, status: d.status })
        return next
      })
    })
    api.onSendDone((d: { id: string }) => {
      setOutgoing((prev) => {
        const next = new Map(prev)
        const t = next.get(d.id)
        if (t) next.set(d.id, { ...t, status: 'done', bytesSent: t.size })
        return next
      })
    })
    api.onSendError((e: { id: string; reason: string }) => {
      setOutgoing((prev) => {
        const next = new Map(prev)
        const t = next.get(e.id)
        if (t) next.set(e.id, { ...t, status: 'error', errorReason: e.reason })
        return next
      })
    })

    return () => {
      const channels = [
        'device:found', 'device:updated', 'device:lost',
        'transfer:request', 'transfer:start', 'transfer:progress',
        'transfer:done', 'transfer:error', 'transfer:decision',
        'transfer:collision',
        'send:start', 'send:progress', 'send:status', 'send:done', 'send:error'
      ]
      channels.forEach((ch) => api.removeAllListeners(ch))
    }
  }, [])

  const handleAccept = useCallback(
    (id: string) => {
      api.decideTransfer(id, true)
      setPendingRequest(null)
    },
    [api]
  )

  const handleReject = useCallback(
    (id: string) => {
      api.decideTransfer(id, false)
      setPendingRequest(null)
    },
    [api]
  )

  const handleAliasChange = useCallback(
    async (newAlias: string) => {
      await api.setAlias(newAlias)
      setConfig((c) => ({ ...c, alias: newAlias }))
    },
    [api]
  )

  const handlePickDownloadDir = useCallback(async () => {
    const dir = await api.setDownloadDir()
    if (dir) setConfig((c) => ({ ...c, downloadDir: dir }))
  }, [api])

  const handleDeviceClick = useCallback(
    (device: DiscoveredDevice) => {
      if (filesToSend.length === 0) return
      const label =
        filesToSend.length === 1
          ? `"${filesToSend[0].split(/[\\/]/).pop()}"`
          : `${filesToSend.length} archivos`
      if (!window.confirm(`¿Enviar ${label} a "${device.alias}"?`)) return
      api.sendFiles(device, filesToSend)
      setFilesToSend([])
    },
    [filesToSend, api]
  )

  const transferList = Array.from(transfers.values())
  const outgoingList = Array.from(outgoing.values())

  return (
    <div style={styles.layout}>
      <Header
        alias={config.alias}
        localIp={config.localIp}
        serverActive={serverActive}
        downloadDir={config.downloadDir}
        onAliasChange={handleAliasChange}
        onPickDownloadDir={handlePickDownloadDir}
        onOpenDownloadDir={() => api.openPath(config.downloadDir)}
      />
      <main style={styles.main}>
        <div style={styles.left}>
          <DeviceList
            devices={devices}
            hasPendingFiles={filesToSend.length > 0}
            onDeviceClick={handleDeviceClick}
          />
          <DropZone files={filesToSend} onFilesChange={setFilesToSend} />
        </div>
        <div style={styles.right}>
          <TransferMonitor
            transfers={transferList}
            outgoing={outgoingList}
            onOpenPath={(p) => api.openPath(p)}
          />
        </div>
      </main>
      {pendingRequest && (
        <TransferRequestModal
          meta={pendingRequest}
          onAccept={() => handleAccept(pendingRequest.id)}
          onReject={() => handleReject(pendingRequest.id)}
        />
      )}
      {pendingCollision && (
        <CollisionModal
          filename={pendingCollision.filename}
          onReplace={() => { api.resolveCollision(pendingCollision.id, 'replace'); setPendingCollision(null) }}
          onRename={() => { api.resolveCollision(pendingCollision.id, 'rename'); setPendingCollision(null) }}
          onSkip={() => { api.resolveCollision(pendingCollision.id, 'skip'); setPendingCollision(null) }}
        />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden'
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    gap: 0
  },
  left: {
    display: 'flex',
    flexDirection: 'column',
    width: 300,
    borderRight: '1px solid var(--border)',
    overflow: 'hidden'
  },
  right: {
    flex: 1,
    overflow: 'auto'
  }
}
