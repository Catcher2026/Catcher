import { chromium, firefox, webkit } from 'playwright'
import type { BrowserContext, BrowserType } from 'playwright'
import { promises as fs } from 'node:fs'
import * as storage from './storage'
import type { AuthProfile, Settings } from '../shared/types'

interface PendingLogin {
  siteId: string
  profileName: string
  context: BrowserContext
  dir: string
}

const pending = new Map<string, PendingLogin>()

function pickBrowser(name: string): BrowserType {
  if (name === 'firefox') return firefox
  if (name === 'webkit') return webkit
  return chromium
}

function uid(p: string) { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

// Args + channel that make the browser look like a real Chrome to anti-bot checks
// (Google OAuth, Cloudflare, etc.). Tries the system-installed Chrome first, falls
// back to bundled Chromium with stealth flags.
async function launchLoginContext(dir: string, settings: Settings) {
  const browser = pickBrowser(settings.engine.browser)
  const stealthArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
  ]
  const baseOpts: any = {
    headless: false,
    viewport: settings.engine.viewport,
    args: stealthArgs,
    ignoreDefaultArgs: ['--enable-automation'],
  }
  // Only chromium has the `channel` option for using installed Chrome
  if (settings.engine.browser === 'chromium' || settings.engine.browser === undefined) {
    try {
      return await browser.launchPersistentContext(dir, { ...baseOpts, channel: 'chrome' })
    } catch (e) {
      // Real Chrome not installed — fall back to bundled Chromium with stealth args
    }
  }
  return browser.launchPersistentContext(dir, baseOpts)
}

export async function startLogin(siteId: string, profileName: string, settings: Settings): Promise<{ sessionId: string; profileId: string }> {
  const profileId = uid('profile')
  const dir = storage.authProfileDir(siteId, profileId)
  await fs.mkdir(dir, { recursive: true })

  const context = await launchLoginContext(dir, settings)

  const sites = await storage.listSites()
  const site = sites.find((s) => s.id === siteId)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(site?.url ?? 'about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {})

  const sessionId = uid('session')
  pending.set(sessionId, { siteId, profileName, context, dir })

  // safety: auto-cancel after 10 minutes
  setTimeout(() => {
    const entry = pending.get(sessionId)
    if (entry) {
      entry.context.close().catch(() => {})
      pending.delete(sessionId)
    }
  }, 10 * 60 * 1000)

  return { sessionId, profileId }
}

export async function finishLogin(sessionId: string, profileId: string): Promise<AuthProfile> {
  const entry = pending.get(sessionId)
  if (!entry) throw new Error('Login session not found or expired')
  // close the browser so the persistent context flushes to disk
  await entry.context.close()
  pending.delete(sessionId)

  const profile: AuthProfile = {
    id: profileId,
    name: entry.profileName,
    status: 'logged_in',
    lastLoginAt: new Date().toISOString(),
  }
  await storage.saveAuthProfile(entry.siteId, profile)
  return profile
}

export async function cancelLogin(sessionId: string): Promise<void> {
  const entry = pending.get(sessionId)
  if (!entry) return
  await entry.context.close().catch(() => {})
  // remove the empty profile dir
  await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {})
  pending.delete(sessionId)
}
