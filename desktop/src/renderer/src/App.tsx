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
}

export default function App(): JSX.Element {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([])
  const [transfers, setTransfers] = useState<Map<string, ActiveTransfer>>(new Map())
  const [pendingRequest, setPendingRequest] = useState<TransferMetadata | null>(null)
  const [pendingCollision, setPendingCollision] = useState<{ id: string; filename: string } | null>(null)
  const [config, setConfig] = useState({ alias: '', downloadDir: '', localIp: '' })
  const [serverActive, setServerActive] = useState(false)

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
    api.onTransferError((id: string) => {
      setTransfers((prev) => {
        const next = new Map(prev)
        const t = next.get(id)
        if (t) next.set(id, { ...t, status: 'error' })
        return next
      })
    })

    return () => {
      const channels = [
        'device:found', 'device:updated', 'device:lost',
        'transfer:request', 'transfer:start', 'transfer:progress',
        'transfer:done', 'transfer:error', 'transfer:decision'
      ]
      channels.push('transfer:collision')
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

  const transferList = Array.from(transfers.values())

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
          <DeviceList devices={devices} />
          <DropZone />
        </div>
        <div style={styles.right}>
          <TransferMonitor transfers={transferList} onOpenPath={(p) => api.openPath(p)} />
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
