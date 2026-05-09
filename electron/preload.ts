import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  downloadFile: (data: { url: string; fileName: string; songId: number; downloadDir: string }) =>
    ipcRenderer.invoke('download-file', data),
  pauseDownload: (songId: number) =>
    ipcRenderer.send('pause-download', songId),
  resumeDownload: (data: { url: string; fileName: string; songId: number; downloadDir: string }) =>
    ipcRenderer.invoke('resume-download', data),
  cancelDownload: (songId: number) =>
    ipcRenderer.send('cancel-download', songId),
  onDownloadProgress: (callback: (data: { songId: number; percent: number; downloaded: number; totalSize: number }) => void) => {
    ipcRenderer.on('download-progress', (_e, data) => callback(data))
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress')
  },
  checkFile: (filePath: string) =>
    ipcRenderer.invoke('check-file', filePath),
  openFolder: (filePath: string) =>
    ipcRenderer.invoke('open-folder', filePath),
  selectFolder: () =>
    ipcRenderer.invoke('select-folder'),
  getDownloadPath: () =>
    ipcRenderer.invoke('get-download-path'),
  checkUpdate: () =>
    ipcRenderer.invoke('check-update'),
})
