import { contextBridge, ipcRenderer } from 'electron'
import type { NullProbeAPI } from '../shared/ipc'

function sub(channel: string, cb: (data: any) => void): () => void {
  const handler = (_e: any, data: any) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: NullProbeAPI = {
  listSites: () => ipcRenderer.invoke('sites:list'),
  createSite: (input) => ipcRenderer.invoke('sites:create', input),
  updateSite: (site) => ipcRenderer.invoke('sites:update', site),
  deleteSite: (id) => ipcRenderer.invoke('sites:delete', id),

  listTests: (siteId) => ipcRenderer.invoke('tests:list', siteId),
  getTest: (siteId, testId) => ipcRenderer.invoke('tests:get', siteId, testId),
  saveTest: (siteId, test) => ipcRenderer.invoke('tests:save', siteId, test),
  deleteTest: (siteId, testId) => ipcRenderer.invoke('tests:delete', siteId, testId),

  listRuns: (siteId, testId) => ipcRenderer.invoke('runs:list', siteId, testId),
  runTest: (siteId, testId, runId, authProfileId) => ipcRenderer.invoke('runs:runTest', siteId, testId, runId, authProfileId),
  runAll: (siteId) => ipcRenderer.invoke('runs:runAll', siteId),
  cancelRun: (runId) => ipcRenderer.invoke('runs:cancel', runId),
  getMonthlyCost: () => ipcRenderer.invoke('runs:monthlyCost'),

  onRunFrame: (cb) => sub('run:frame', cb),
  onRunStatus: (cb) => sub('run:status', cb),
  onRunStepStart: (cb) => sub('run:step:start', cb),
  onRunStepEnd: (cb) => sub('run:step:end', cb),
  onRunEnd: (cb) => sub('run:end', cb),

  listAuthProfiles: (siteId) => ipcRenderer.invoke('auth:list', siteId),
  startManualLogin: (siteId, name) => ipcRenderer.invoke('auth:startLogin', siteId, name),
  finishManualLogin: (sessionId, profileId) => ipcRenderer.invoke('auth:finishLogin', sessionId, profileId),
  cancelManualLogin: (sessionId) => ipcRenderer.invoke('auth:cancelLogin', sessionId),
  deleteAuthProfile: (siteId, id) => ipcRenderer.invoke('auth:delete', siteId, id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

  generateTest: (siteId, desc, authProfileId) =>
    ipcRenderer.invoke('ai:generate', siteId, desc, authProfileId),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDataDir: () => ipcRenderer.invoke('app:dataDir'),
}

contextBridge.exposeInMainWorld('nullprobe', api)
