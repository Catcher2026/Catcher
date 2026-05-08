import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Point Playwright at the Chromium bundled inside our packaged Resources dir.
// Playwright reads this env var at launch() time (lazy), so setting it here
// before chromium.launch() is ever called is sufficient.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'playwright-browsers')
}

import * as storage from './storage'
import * as runner from './runner'
import * as auth from './auth'
import { generateTest } from './generate'
import type { Site, TestCase, Settings } from '../shared/types'

const DEV_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Catcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (DEV_URL) {
    await mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerIpc()
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc() {
  ipcMain.handle('sites:list', () => storage.listSites())
  ipcMain.handle('sites:create', (_e, input: { name: string; url: string }) => storage.createSite(input))
  ipcMain.handle('sites:update', (_e, site: Site) => storage.updateSite(site))
  ipcMain.handle('sites:delete', (_e, id: string) => storage.deleteSite(id))

  ipcMain.handle('tests:list', (_e, siteId: string) => storage.listTests(siteId))
  ipcMain.handle('tests:get', (_e, siteId: string, testId: string) => storage.getTest(siteId, testId))
  ipcMain.handle('tests:save', (_e, siteId: string, test: TestCase) => storage.saveTest(siteId, test))
  ipcMain.handle('tests:delete', (_e, siteId: string, testId: string) => storage.deleteTest(siteId, testId))

  ipcMain.handle('runs:list', (_e, siteId: string, testId?: string) => storage.listRuns(siteId, testId))
  ipcMain.handle('runs:runTest', async (_e, siteId: string, testId: string, runId?: string, authProfileId?: string) => {
    const test = await storage.getTest(siteId, testId)
    if (!test) throw new Error('Test not found')
    const settings = await storage.getSettings()
    return runner.runTest(siteId, test, settings, { runId, authProfileId })
  })
  ipcMain.handle('runs:runAll', async (_e, siteId: string) => {
    const settings = await storage.getSettings()
    return runner.runAllTests(siteId, settings)
  })
  ipcMain.handle('runs:cancel', (_e, runId: string) => runner.cancelRun(runId))
  ipcMain.handle('runs:monthlyCost', () => storage.getMonthlyCost())

  ipcMain.handle('auth:list', (_e, siteId: string) => storage.listAuthProfiles(siteId))
  ipcMain.handle('auth:startLogin', async (_e, siteId: string, name: string) => {
    const settings = await storage.getSettings()
    return auth.startLogin(siteId, name, settings)
  })
  ipcMain.handle('auth:finishLogin', (_e, sessionId: string, profileId: string) =>
    auth.finishLogin(sessionId, profileId)
  )
  ipcMain.handle('auth:cancelLogin', (_e, sessionId: string) => auth.cancelLogin(sessionId))
  ipcMain.handle('auth:delete', (_e, siteId: string, profileId: string) =>
    storage.deleteAuthProfile(siteId, profileId)
  )

  ipcMain.handle('settings:get', () => storage.getSettings())
  ipcMain.handle('settings:save', (_e, s: Settings) => storage.saveSettings(s))

  ipcMain.handle('ai:generate', async (_e, siteId: string, desc: string, authProfileId?: string) => {
    const settings = await storage.getSettings()
    return generateTest(siteId, desc, settings, authProfileId)
  })

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:dataDir', () => storage.getDataDir())
}
