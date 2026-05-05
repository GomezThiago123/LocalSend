/// <reference types="vite/client" />

import type { DiscoveredDevice } from '../../main/udpServer'
import type { TransferMetadata, TransferProgress } from '../../main/wsServer'

declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<{ alias: string; downloadDir: string; localIp: string }>
      setAlias: (alias: string) => Promise<void>
      setDownloadDir: () => Promise<string | null>
      listDevices: () => Promise<DiscoveredDevice[]>
      decideTransfer: (id: string, accepted: boolean) => Promise<void>
      pickFiles: () => Promise<string[]>
      openPath: (filePath: string) => Promise<void>
      onDeviceFound: (cb: (d: DiscoveredDevice) => void) => void
      onDeviceUpdated: (cb: (d: DiscoveredDevice) => void) => void
      onDeviceLost: (cb: (ip: string) => void) => void
      onTransferRequest: (cb: (meta: TransferMetadata) => void) => void
      onTransferStart: (cb: (meta: TransferMetadata) => void) => void
      onTransferProgress: (cb: (p: TransferProgress) => void) => void
      onTransferDone: (cb: (meta: TransferMetadata) => void) => void
      onTransferError: (cb: (id: string) => void) => void
      onTransferDecision: (cb: (d: { id: string; accepted: boolean }) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}
