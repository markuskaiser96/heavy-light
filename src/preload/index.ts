import { contextBridge, ipcRenderer } from 'electron'
import type { FromEngine, ToEngine } from '@shared/types'

const api = {
  platform: process.platform,
  send: (message: ToEngine): void => ipcRenderer.send('engine:send', message),
  onEngine: (listener: (message: FromEngine) => void): void => {
    ipcRenderer.on('engine:message', (_e, message: FromEngine) => listener(message))
  },
  onEngineRestarted: (listener: () => void): void => {
    ipcRenderer.on('engine:restarted', () => listener())
  },
  onSaveAndClose: (listener: () => void): void => {
    ipcRenderer.on('app:save-and-close', () => listener())
  },
  setDirty: (dirty: boolean, title: string): void => ipcRenderer.send('app:dirty', dirty, title),
  close: (): void => ipcRenderer.send('app:close'),
  lastShow: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('file:last'),
  openShow: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('file:open'),
  saveShow: (args: { path: string | null; text: string; name: string }): Promise<string | null> => ipcRenderer.invoke('file:save', args),
  forgetShow: (): Promise<void> => ipcRenderer.invoke('file:forget'),
  importFixtures: (): Promise<{ name: string; text: string }[]> => ipcRenderer.invoke('file:import-fixtures')
}

export type HeavyApi = typeof api

contextBridge.exposeInMainWorld('heavy', api)
