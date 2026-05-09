const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  downloadFile: (data) => ipcRenderer.invoke('download-file', data),
  pauseDownload: (songId) => ipcRenderer.send('pause-download', songId),
  resumeDownload: (data) => ipcRenderer.invoke('resume-download', data),
  cancelDownload: (songId) => ipcRenderer.send('cancel-download', songId),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_e, data) => callback(data))
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress')
  },
  checkFile: (filePath) => ipcRenderer.invoke('check-file', filePath),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  setCookie: (cookieStr) => ipcRenderer.invoke('set-cookie', cookieStr),
  clearCookies: () => ipcRenderer.invoke('clear-cookies'),
})
