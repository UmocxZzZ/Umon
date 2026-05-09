/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  require?: (module: string) => unknown
  electronAPI?: {
    minimize: () => void
    maximize: () => void
    close: () => void
    downloadFile: (data: { url: string; fileName: string; songId: number; downloadDir: string }) => Promise<{ ok: boolean; filePath?: string; error?: string }>
    pauseDownload: (songId: number) => void
    resumeDownload: (data: { url: string; fileName: string; songId: number; downloadDir: string }) => Promise<{ ok: boolean; filePath?: string; error?: string }>
    cancelDownload: (songId: number) => void
    onDownloadProgress: (callback: (data: { songId: number; percent: number; downloaded: number; totalSize: number }) => void) => void
    removeDownloadProgressListener: () => void
    checkFile: (filePath: string) => Promise<boolean>
    openFolder: (filePath: string) => void
    selectFolder: () => Promise<string | null>
    getDownloadPath: () => Promise<string>
    checkUpdate: () => Promise<{ hasUpdate: boolean; latestVersion?: string; currentVersion: string }>
    setCookie: (cookieStr: string) => Promise<void>
    clearCookies: () => Promise<void>
  }
}
