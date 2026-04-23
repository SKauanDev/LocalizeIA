import { contextBridge, ipcRenderer } from 'electron'

const platform = typeof process !== 'undefined' ? process.platform : 'unknown'

try {
  contextBridge.exposeInMainWorld('desktop', {
    platform,
    searchLeads: (payload) => ipcRenderer.invoke('scraper:search-leads', payload),
    notifySearchComplete: (message) => ipcRenderer.invoke('notification:search-complete', message),
  })
} catch (error) {
  console.error('Falha ao expor bridge do preload:', error)
}
